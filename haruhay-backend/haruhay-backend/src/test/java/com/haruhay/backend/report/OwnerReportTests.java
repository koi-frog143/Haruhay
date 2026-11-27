package com.haruhay.backend.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.holding.HoldingStationController;
import com.haruhay.backend.holding.HoldingStationService;
import com.haruhay.backend.maintenance.MaintenanceService;
import com.haruhay.backend.payment.PaymentService;
import com.haruhay.backend.registration.RoomAgreementService;
import com.jayway.jsonpath.JsonPath;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class OwnerReportTests {
    private static final String OWNER="report-owner@example.test", OUTSIDE="report-other-owner@example.test";
    private static final String RESIDENT="report-resident@example.test";
    private static final String PATH="/api/owner/reports";
    private static final String FIRST="2026-11-01", LAST="2026-11-30";
    private static final OffsetDateTime AT=OffsetDateTime.parse("2026-11-03T12:00:00+08:00");
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired PaymentService payments;
    @Autowired RoomAgreementService rooms;
    @Autowired MaintenanceService maintenance;
    @Autowired HoldingStationService holding;
    private UUID owner,resident,property,otherProperty,room,application,stay;

    @BeforeEach
    void setup() {
        owner=account(OWNER,"OWNER","Property owner");
        resident=account(RESIDENT,"APPLICANT","Current resident");
        property=property(owner,"Garden House");
        otherProperty=property(account(OUTSIDE,"OWNER","Other property owner"),"Other House");
        room=UUID.randomUUID();
        application=UUID.randomUUID();
        stay=UUID.randomUUID();
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,'Room 1',4)",room,property);
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,'Resident','','APPROVED',?)",
            application,resident,property,AT);
        UUID reservation=reservation(room,"CONVERTED");
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            stay,reservation,application,resident,room,AT,owner);
    }

    @Test
    void collectionsPreviewAndCsvUseLedgerBoundariesAndNetReversals() throws Exception {
        UUID bill=bill();
        UUID reversed=approve(bill,"1000","REVERSED",5000);
        payments.review(OWNER,reversed,"REVERSED",new PaymentService.Review(false,"Bank reversal",null));
        var retained=approve(bill,"1500","RETAINED",5000);
        var before=approve(bill,"300","BEFORE",3500);
        var after=approve(bill,"250","AFTER",3200);
        ledgerTime(reversed,"PAYMENT","2026-10-31T16:00:00Z");
        ledgerTime(reversed,"REVERSAL","2026-11-01T16:01:00Z");
        ledgerTime(retained,"PAYMENT","2026-11-30T15:59:59Z");
        ledgerTime(before,"PAYMENT","2026-10-31T15:59:59Z");
        ledgerTime(after,"PAYMENT","2026-11-30T16:00:00Z");

        var result=preview("COLLECTIONS",property).andExpect(status().isOk())
            .andExpect(jsonPath("$.rowCount").value(3)).andExpect(jsonPath("$.rows[0][0]").value("2026-11-01 00:00:00"))
            .andExpect(jsonPath("$.rows[1][2]").value("Reversal"))
            .andExpect(jsonPath("$.rows[2][0]").value("2026-11-30 23:59:59"))
            .andExpect(jsonPath("$.summary[0].value").value(2500)).andExpect(jsonPath("$.summary[1].value").value(1000))
            .andExpect(jsonPath("$.summary[2].value").value(1500)).andExpect(jsonPath("$.summary[3].value").value(2950));
        String snapshot=snapshot(result);
        String csv=mvc.perform(request("/csv","COLLECTIONS",property,OWNER).param("snapshot",snapshot))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type",containsString("text/csv")))
            .andExpect(header().string("Content-Disposition",containsString("haruhay-collections-2026-11-01-to-2026-11-30.csv")))
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(csv).startsWith("\uFEFF\"Recorded at (PHT)\"")
            .contains("\"Reversal\",-1000.00,", "\"Verified collections in range (PHP)\",2500.00",
                "\"Reversals in range (PHP)\",1000.00","\"Net collections in range (PHP)\",1500.00",
                "\"Current outstanding balance (PHP)\",2950.00")
            .doesNotContain("Bank reversal","REVERSED","2026-12-01 00:00:00","2026-10-31 23:59:59");
        mvc.perform(request("/preview","COLLECTIONS",property,OUTSIDE)).andExpect(status().isNotFound());
        mvc.perform(request("/csv","COLLECTIONS",property,OUTSIDE).param("snapshot",snapshot)).andExpect(status().isNotFound());
        mvc.perform(request("/preview","COLLECTIONS",otherProperty,OUTSIDE)).andExpect(status().isOk())
            .andExpect(jsonPath("$.rowCount").value(0)).andExpect(jsonPath("$.summary[3].value").value(0));
    }

    @Test
    void occupancyUsesListingCountsAndCsvNeutralizesFormulaText() throws Exception {
        String label="  =1+1,\"Room\"\nSecond line";
        db.update("UPDATE rooms SET label=? WHERE id=?",label,room);
        reservation(room,"HELD");
        reservation(room,"RELEASED");
        var publicInventory=rooms.ownerRooms(OWNER).getFirst();
        var result=preview("OCCUPANCY",property).andExpect(status().isOk()).andExpect(jsonPath("$.rowCount").value(1))
            .andExpect(jsonPath("$.from").doesNotExist()).andExpect(jsonPath("$.rows[0][0]").value(label))
            .andExpect(jsonPath("$.rows[0][1]").value(4)).andExpect(jsonPath("$.rows[0][2]").value(1))
            .andExpect(jsonPath("$.rows[0][3]").value(1)).andExpect(jsonPath("$.rows[0][4]").value(publicInventory.get("available")))
            .andExpect(jsonPath("$.summary[3].value").value(2));
        String snapshot=snapshot(result);
        String csv=mvc.perform(request("/csv","OCCUPANCY",property,OWNER).param("snapshot",snapshot))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(csv).contains("\"'  =1+1,\"\"Room\"\"\nSecond line\",4,1,1,2", "\"Current snapshot\"");
        reservation(room,"HELD");
        mvc.perform(request("/csv","OCCUPANCY",property,OWNER).param("snapshot",snapshot)).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("REPORT_CHANGED"));
    }

    @Test
    void visitorsIncludeActualCheckoutAfterAnEarlierArrivalAndExcludeVoidedAndExpectedVisits() throws Exception {
        UUID visit=visit("Late checkout",false,"CHECKED_OUT"), voided=visit("Voided guest",true,"CHECKED_OUT");
        visit("Expected guest",false,"EXPECTED");
        move(visit,"ENTRY","2026-10-31T15:00:00Z");
        move(visit,"EXIT","2026-10-31T16:15:00Z");
        move(voided,"ENTRY","2026-11-01T10:00:00Z");
        move(voided,"EXIT","2026-11-01T11:00:00Z");
        preview("VISITORS",property).andExpect(status().isOk()).andExpect(jsonPath("$.rowCount").value(1))
            .andExpect(jsonPath("$.summary[0].value").value(0)).andExpect(jsonPath("$.summary[1].value").value(1))
            .andExpect(jsonPath("$.rows[0][0]").value("2026-11-01 00:15:00"))
            .andExpect(jsonPath("$.rows[0][1]").value("Checkout")).andExpect(jsonPath("$.rows[0][2]").value("Late checkout"));
    }

    @Test
    void residentsMaintenanceAndHoldingUseSavedRecordsWithLimitedFields() throws Exception {
        var ticket=maintenance.report(RESIDENT,new MaintenanceService.Report(UUID.randomUUID(),stay,"PLUMBING","Private description",false,null));
        db.update("UPDATE maintenance_tickets SET submitted_at=? WHERE id=?",AT,ticket);
        var item=holding.create(OWNER,new HoldingStationController.CreateItem(application,"Parcel","Private package description",
            "Sender","Courier / sender","PRIVATE-TRACKING","A-1"));
        db.update("UPDATE holding_items SET received_at=? WHERE id=?",AT,item.id());
        preview("RESIDENTS",property).andExpect(status().isOk()).andExpect(jsonPath("$.rowCount").value(1))
            .andExpect(jsonPath("$.rows[0][0]").value("Current resident"));
        preview("MAINTENANCE",property).andExpect(status().isOk()).andExpect(jsonPath("$.rowCount").value(1))
            .andExpect(jsonPath("$.summary[1].value").value(1))
            .andExpect(jsonPath("$.rows[0][3]").value("2026-11-03 12:00:00"));
        var result=preview("HOLDING",property).andExpect(status().isOk()).andExpect(jsonPath("$.rowCount").value(1))
            .andExpect(jsonPath("$.rows[0][0]").value(item.code())).andExpect(jsonPath("$.summary[2].value").value(1));
        var csv=mvc.perform(request("/csv","HOLDING",property,OWNER).param("snapshot",snapshot(result)))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(csv).contains(item.code()).doesNotContain("PRIVATE-TRACKING","Private package description","Pickup PIN");
    }

    @Test
    void invalidRangesAndNonOwnerRequestsAreRejected() throws Exception {
        mvc.perform(get(PATH+"/preview").param("type","COLLECTIONS").param("propertyId",property.toString())
            .param("from",LAST).param("through",FIRST).with(user(OWNER).roles("OWNER"))).andExpect(status().isBadRequest());
        mvc.perform(get(PATH+"/preview").param("type","COLLECTIONS").param("propertyId",property.toString())
            .with(user(OWNER).roles("OWNER"))).andExpect(status().isBadRequest());
        mvc.perform(get(PATH+"/preview").param("type","OCCUPANCY").param("propertyId",property.toString())
            .with(user(RESIDENT).roles("APPLICANT"))).andExpect(status().isForbidden());
    }

    private ResultActions preview(String type,UUID id) throws Exception {
        return mvc.perform(request("/preview",type,id,OWNER));
    }

    private MockHttpServletRequestBuilder request(String action,String type,UUID property,String email) {
        var request=get(PATH+action).param("type",type).param("propertyId",property.toString()).with(user(email).roles("OWNER"));
        if (!"OCCUPANCY".equals(type)) request.param("from",FIRST).param("through",LAST);
        return request;
    }

    private String snapshot(ResultActions result) throws Exception {
        return JsonPath.read(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8),"$.snapshot");
    }

    private UUID account(String email,String role,String name) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,role,full_name,password_hash,contact,email_verified,created_at) VALUES(?,?,?,?,'test-only-hash','',TRUE,?)",
            id,email,role,name,AT);
        return id;
    }

    private UUID property(UUID owner,String name) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",id,owner,name);
        return id;
    }

    private UUID reservation(UUID room,String status) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,?,?,?)",id,room,status,owner,AT);
        return id;
    }

    private UUID bill() {
        UUID offer=UUID.randomUUID(),bill=UUID.randomUUID();
        db.update("""
            INSERT INTO application_offers(id,application_id,version,room_id,room_version,snapshot,created_by,created_at,reason,accepted_by,accepted_at)
            VALUES(?,?,1,?,1,'{}',?,?,'Billing fixture',?,?)
            """,offer,application,room,owner,AT,resident,AT);
        db.update("""
            INSERT INTO monthly_bills(id,tenancy_id,application_id,property_id,offer_id,period,due_date,rent,fixed_charges,posted_by,posted_at)
            VALUES(?,?,?,?,?,'2026-11',?,5000,0,?,?)
            """,bill,stay,application,property,offer,LocalDate.parse("2026-11-10"),owner,AT);
        return bill;
    }

    private UUID approve(UUID bill,String amount,String reference,long balance) {
        UUID id=payments.report(RESIDENT,new PaymentService.Report(bill,UUID.randomUUID(),null,new BigDecimal(amount),"GCASH",
            LocalDate.now(ZoneId.of("Asia/Manila")),reference));
        payments.review(OWNER,id,"APPROVED",new PaymentService.Review(true,null,BigDecimal.valueOf(balance)));
        return id;
    }

    private void ledgerTime(UUID payment,String kind,String timestamp) {
        db.update("UPDATE bill_payment_ledger SET recorded_at=? WHERE payment_id=? AND kind=?",OffsetDateTime.parse(timestamp),payment,kind);
    }

    private UUID visit(String name,boolean voided,String status) {
        UUID guest=UUID.randomUUID(),request=UUID.randomUUID(),id=UUID.randomUUID();
        db.update("INSERT INTO visitor_profiles(id,full_name,contact) VALUES(?,?,'PRIVATE')",guest,name);
        db.update("""
            INSERT INTO visitor_requests(id,visitor_id,tenancy_id,property_id,purpose,arrival,departure,status,created_at)
            VALUES(?,?,?,?,'Visit',?,?,'APPROVED',?)
            """,request,guest,stay,property,AT,AT.plusHours(2),AT);
        db.update("INSERT INTO visitor_visits(id,request_id,status,voided) VALUES(?,?,?,?)",id,request,status,voided);
        return id;
    }

    private void move(UUID visit,String movement,String at) {
        db.update("INSERT INTO visitor_movements(id,visit_id,movement,actor_id,occurred_at,method) VALUES(?,?,?,?,?,'MANUAL')",
            UUID.randomUUID(),visit,movement,owner,OffsetDateTime.parse(at));
    }
}
