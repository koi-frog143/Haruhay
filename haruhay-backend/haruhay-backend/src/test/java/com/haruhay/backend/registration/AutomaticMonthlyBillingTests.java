package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AutomaticMonthlyBillingTests {
    private static final String OWNER="automatic-billing-owner@example.test";
    private static final String OUTSIDER="automatic-billing-outsider@example.test";
    private static final String RESIDENT="automatic-billing-resident@example.test";

    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired MonthlyBillController manual;
    @Autowired MonthlyBillingJob job;
    @Autowired MonthlyBillingService billing;
    @Autowired TenancyService tenancies;
    @MockitoBean Clock clock;
    private UUID owner,outsider,resident,property,otherProperty;
    private Stay stay;
    private Instant time;
    private record Stay(UUID id,UUID app,UUID room,UUID reservation) {}

    @BeforeEach
    void setup() {
        time("2026-11-02T10:00:00+08:00");
        when(clock.instant()).thenAnswer(ignored->time);
        owner=account(OWNER,"Owner","OWNER");
        outsider=account(OUTSIDER,"Other owner","OWNER");
        resident=account(RESIDENT,"Ana Resident","APPLICANT");
        property=property(owner);
        otherProperty=property(outsider);
        stay=stay(resident,property,owner,"Room 101","2026-10-01T00:00:00+08:00","2500");
    }

    @Test
    void optInPostsExactlyOneBillAndResidentCanSeeTheAcceptedChargesAndSavedRules() throws Exception {
        job.postDue();
        assertThat(billCount(property)).isZero();
        mvc.perform(get(settings(property)).with(user(OWNER).roles("OWNER"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.billing.automaticEnabled").value(false));
        save(property,true,29,18,4).andExpect(status().isBadRequest());
        save(property,true,10,18,4).andExpect(status().isNoContent());
        scheduleStatus(property).andExpect(jsonPath("$.nextPostingDate").value("2026-11-10"));
        job.postDue();
        assertThat(billCount(property)).isZero();
        time("2026-11-09T16:00:00Z");
        job.postDue();
        job.postDue();
        assertThat(billCount(property)).isOne();

        mvc.perform(get("/api/resident/bills").with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].period").value("2026-11"))
            .andExpect(jsonPath("$[0].rent").value(2500))
            .andExpect(jsonPath("$[0].fixed_charges").value(125))
            .andExpect(jsonPath("$[0].due_date").value("2026-11-18"))
            .andExpect(jsonPath("$[0].billing_grace_through").value("2026-11-22"));
        scheduleStatus(property).andExpect(jsonPath("$.nextPostingDate").value("2026-12-10"))
            .andExpect(jsonPath("$.runs.length()").value(1)).andExpect(jsonPath("$.runs[0].postedCount").value(1));

        UUID original=(UUID)manual.post(()->OWNER,new MonthlyBillController.PostBill(stay.app(),"2026-11",LocalDate.of(2026,11,27))).get("id");
        save(property,false,10,26,0).andExpect(status().isNoContent());
        time("2026-12-11T00:00:00+08:00");
        job.postDue();
        assertThat(billCount(property)).isOne();
        assertThat(db.queryForObject("SELECT due_date FROM monthly_bills WHERE id=?",LocalDate.class,original)).isEqualTo(LocalDate.of(2026,11,18));
        scheduleStatus(property).andExpect(jsonPath("$.nextPostingDate").doesNotExist()).andExpect(jsonPath("$.runs.length()").value(1));
    }

    @Test
    void catchUpPostsOnlyTheCurrentMonthAndReportsLateAndUnpricedStays() throws Exception {
        UUID unpriced=account("unpriced-billing@example.test","Unpriced Resident","APPLICANT");
        UUID late=account("late-billing@example.test","Late Resident","APPLICANT");
        UUID earlier=account("manual-billing@example.test","Manual Resident","APPLICANT");
        UUID former=account("ended-billing@example.test","Former Resident","APPLICANT");
        stay(unpriced,property,owner,"Room 102","2026-10-01T00:00:00+08:00","null");
        var lateStay=stay(late,property,owner,"Room 103","2026-12-11T00:00:00+08:00","2100");
        var already=stay(earlier,property,owner,"Room 104","2026-10-01T00:00:00+08:00","2000");
        var ended=stay(former,property,owner,"Room 105","2026-10-01T00:00:00+08:00","2000");
        var other=stay(resident,otherProperty,outsider,"Other room","2026-10-01T00:00:00+08:00","3000");
        save(property,true,10,20,2).andExpect(status().isNoContent());

        time("2026-12-12T09:00:00+08:00");
        tenancies.moveOut(OWNER,ended.id(),"Left before catch-up");
        manual.post(()->OWNER,new MonthlyBillController.PostBill(already.app(),"2026-12",null));
        scheduleStatus(property).andExpect(jsonPath("$.nextPostingDate").value("2026-12-12")).andExpect(jsonPath("$.catchUp").value(true));
        job.postDue();
        job.postDue();
        assertThat(db.queryForList("SELECT period FROM monthly_bills WHERE property_id=?",String.class,property)).containsOnly("2026-12").hasSize(2);
        assertThat(billCount(otherProperty)).isZero();
        assertThat(db.queryForObject("SELECT COUNT(*) FROM monthly_bills WHERE application_id=?",Integer.class,other.app())).isZero();
        scheduleStatus(property).andExpect(jsonPath("$.runs.length()").value(1))
            .andExpect(jsonPath("$.runs[0].scheduledFor").value("2026-12-10"))
            .andExpect(jsonPath("$.runs[0].postedCount").value(1))
            .andExpect(jsonPath("$.runs[0].existingCount").value(1))
            .andExpect(jsonPath("$.runs[0].issues[*].residentName",containsInAnyOrder("Unpriced Resident","Late Resident")))
            .andExpect(jsonPath("$.runs[0].issues[0].reason",containsString("after the posting cutoff")))
            .andExpect(jsonPath("$.runs[0].issues[1].reason",containsString("explicit monthly rent")));
        mvc.perform(get(settings(property)+"/billing/runs").with(user(OUTSIDER).roles("OWNER"))).andExpect(status().isNotFound());
        mvc.perform(get(settings(property)+"/billing/runs").with(user(RESIDENT))).andExpect(status().isForbidden());
        save(otherProperty,true,10,20,2).andExpect(status().isNotFound());
        manual.post(()->OWNER,new MonthlyBillController.PostBill(lateStay.app(),"2026-12",null));
        scheduleStatus(property).andExpect(jsonPath("$.runs[0].issues[0].billPosted").value(true))
            .andExpect(jsonPath("$.runs[0].issues[1].billPosted").value(false));
    }

    @Test
    void enablingAPastPostingDayStartsNextMonthAndUsesThePhilippineMonthBoundary() throws Exception {
        time("2026-11-28T10:00:00+08:00");
        save(property,true,1,12,0).andExpect(status().isNoContent());
        scheduleStatus(property).andExpect(jsonPath("$.nextPostingDate").value("2026-12-01"));
        time("2026-11-30T15:59:59Z");
        job.postDue();
        assertThat(billCount(property)).isZero();
        time("2026-11-30T16:00:00Z");
        job.postDue();
        scheduleStatus(property).andExpect(jsonPath("$.runs[0].period").value("2026-12"))
            .andExpect(jsonPath("$.runs[0].scheduledFor").value("2026-12-01"))
            .andExpect(jsonPath("$.nextPostingDate").value("2027-01-01"));
    }

    @Test
    void aTransferKeepsThePostedMonthAndUsesTheNewAcceptedTermsInTheNextMonth() throws Exception {
        save(property,true,10,20,1).andExpect(status().isNoContent());
        time("2026-11-10T00:00:00+08:00");
        job.postDue();
        var first=bill("2026-11");
        time("2026-11-15T12:00:00+08:00");
        UUID destination=room(property,"Room 210",3200);
        UUID proposal=(UUID)tenancies.propose(OWNER,stay.id(),destination,1,null).get("id");
        tenancies.accept(RESIDENT,proposal);
        UUID destinationStay=(UUID)tenancies.complete(OWNER,stay.id(),proposal).get("destination_tenancy_id");
        assertThat(manual.post(()->OWNER,new MonthlyBillController.PostBill(stay.app(),"2026-11",null)).get("id")).isEqualTo(first);
        time("2026-12-10T00:00:00+08:00");
        job.postDue();
        assertThat(db.queryForObject("SELECT rent FROM monthly_bills WHERE id=?",BigDecimal.class,first)).isEqualByComparingTo("2500");
        assertThat(db.queryForObject("SELECT rent FROM monthly_bills WHERE id=?",BigDecimal.class,bill("2026-12"))).isEqualByComparingTo("3200");
        assertThat(db.queryForObject("SELECT tenancy_id FROM monthly_bills WHERE id=?",UUID.class,bill("2026-12"))).isEqualTo(destinationStay);
    }

    @Test
    @Transactional(propagation=Propagation.NOT_SUPPORTED)
    void concurrentSchedulersAndManualPostingCreateOneRunAndOneBill() throws Exception {
        try {
            save(property,true,10,20,1).andExpect(status().isNoContent());
            time("2026-11-10T00:00:00+08:00");
            var barrier=new CyclicBarrier(3);
            try (var workers=Executors.newFixedThreadPool(3)) {
                var auto=workers.submit(startTogether(barrier,()->{ billing.postDue(property); return null; }));
                var competingAuto=workers.submit(startTogether(barrier,()->{ billing.postDue(property); return null; }));
                var manualBill=workers.submit(startTogether(barrier,()->manual.post(()->OWNER,new MonthlyBillController.PostBill(stay.app(),"2026-11",null))));
                auto.get(20,TimeUnit.SECONDS);
                competingAuto.get(20,TimeUnit.SECONDS);
                assertThat(manualBill.get(20,TimeUnit.SECONDS).get("id")).isEqualTo(bill("2026-11"));
            }
            assertThat(billCount(property)).isOne();
            var runs=db.queryForList("SELECT posted_count+existing_count FROM monthly_billing_runs WHERE property_id=?",Integer.class,property);
            assertThat(runs).containsExactly(1);
        } finally {
            db.update("DELETE FROM monthly_billing_runs WHERE property_id=?",property);
            db.update("DELETE FROM monthly_bills WHERE application_id=?",stay.app());
            db.update("DELETE FROM registration_audit WHERE actor_id=?",owner);
            db.update("DELETE FROM tenancies WHERE id=?",stay.id());
            db.update("DELETE FROM application_offers WHERE application_id=?",stay.app());
            db.update("DELETE FROM registration_applications WHERE id=?",stay.app());
            db.update("DELETE FROM reservations WHERE id=?",stay.reservation());
            db.update("DELETE FROM rooms WHERE id=?",stay.room());
            db.update("DELETE FROM properties WHERE id IN (?,?)",property,otherProperty);
            db.update("DELETE FROM accounts WHERE id IN (?,?,?)",owner,outsider,resident);
        }
    }

    private <T> Callable<T> startTogether(CyclicBarrier barrier,Callable<T> task) {
        return ()->{ barrier.await(10,TimeUnit.SECONDS); return task.call(); };
    }

    private ResultActions save(UUID property,boolean enabled,int posting,int due,int grace) throws Exception {
        return mvc.perform(put(settings(property)+"/billing").with(user(OWNER).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("""
                {"dueDay":%d,"graceDays":%d,"postingDay":%d,"automaticEnabled":%b}
                """.formatted(due,grace,posting,enabled)));
    }

    private ResultActions scheduleStatus(UUID property) throws Exception {
        return mvc.perform(get(settings(property)+"/billing/runs").with(user(OWNER).roles("OWNER"))).andExpect(status().isOk());
    }

    private String settings(UUID property) { return "/api/owner/properties/"+property+"/settings"; }

    private void time(String value) { time=OffsetDateTime.parse(value).toInstant(); }

    private int billCount(UUID property) {
        return db.queryForObject("SELECT COUNT(*) FROM monthly_bills WHERE property_id=?",Integer.class,property);
    }

    private UUID bill(String period) {
        return db.queryForObject("SELECT id FROM monthly_bills WHERE application_id=? AND period=?",UUID.class,stay.app(),period);
    }

    private UUID account(String email,String name,String role) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,'unused',?,'',?,TRUE,?)",
            id,email,name,role,OffsetDateTime.parse("2026-09-01T00:00:00+08:00"));
        return id;
    }

    private UUID property(UUID owner) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,'Billing test property')",id,owner);
        return id;
    }

    private UUID room(UUID property,String label,int rent) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO rooms(id,property_id,label,capacity,monthly_rent,published,accepting_applications) VALUES(?,?,?,1,?,TRUE,TRUE)",
            id,property,label,rent);
        return id;
    }

    private Stay stay(UUID resident,UUID property,UUID owner,String label,String start,String rent) {
        UUID room=room(property,label,2600),app=UUID.randomUUID(),offer=UUID.randomUUID(),reservation=UUID.randomUUID(),stay=UUID.randomUUID();
        var started=OffsetDateTime.parse(start);
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,'Resident','','APPROVED',?)",
            app,resident,property,started);
        db.update("""
            INSERT INTO application_offers(id,application_id,version,room_id,room_version,snapshot,created_by,created_at,reason,accepted_by,accepted_at)
            VALUES(?,?,1,?,1,?,?,?,'Accepted billing terms',?,?)
            """,offer,app,room,"{\"applicant_monthly_rent\":"+rent+",\"fixed_monthly_charges\":125}",owner,started,resident,started);
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,started);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by,offer_id) VALUES(?,?,?,?,?,'ACTIVE',?,?,?)",
            stay,reservation,app,resident,room,started,owner,offer);
        return new Stay(stay,app,room,reservation);
    }
}
