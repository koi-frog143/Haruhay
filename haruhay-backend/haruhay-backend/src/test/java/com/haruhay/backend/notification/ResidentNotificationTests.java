package com.haruhay.backend.notification;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.announcement.AnnouncementController;
import com.haruhay.backend.maintenance.MaintenanceService;
import com.haruhay.backend.payment.PaymentService;
import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.registration.TenancyService;
import java.math.BigDecimal;
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
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ResidentNotificationTests {
    private static final String OWNER="inbox-owner@example.test", RESIDENT="inbox-resident@example.test";
    private static final String ROOMMATE="inbox-roommate@example.test", OUTSIDE="inbox-outside@example.test";
    private static final String PENDING="inbox-pending@example.test", TECHNICIAN="inbox-technician@example.test";
    private static final String PATH="/api/resident/notifications";
    private record Stay(UUID id,UUID application,UUID room) {}

    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired AnnouncementController announcements;
    @Autowired MaintenanceService maintenance;
    @Autowired PaymentService payments;
    @Autowired TenancyService tenancies;

    private UUID ownerId,residentId,property,otherProperty;
    private Stay mainStay;

    @BeforeEach
    void setup() {
        ownerId=account(OWNER,"OWNER");
        residentId=account(RESIDENT,"APPLICANT");
        UUID roommate=account(ROOMMATE,"APPLICANT"), outside=account(OUTSIDE,"APPLICANT");
        account(PENDING,"APPLICANT");
        property=property("Garden House");
        otherProperty=property("Hill House");
        mainStay=stay(residentId,property);
        stay(roommate,property);
        stay(outside,otherProperty);
    }

    @Test
    void publishedAnnouncementHasIndependentPersistentReadStatePerAccount() throws Exception {
        UUID id=announcement(property,true), draft=announcement(property,false);
        var key="announcement:"+id;
        inbox(RESIDENT).andExpect(jsonPath("$[*].id",contains(key))).andExpect(jsonPath("$[0].targetId").value(id.toString()))
            .andExpect(jsonPath("$[0].createdAt").isString()).andExpect(jsonPath("$[0].readAt").doesNotExist());
        inbox(OUTSIDE).andExpect(content().json("[]"));
        inboxCount(OUTSIDE,0);
        readAll(OUTSIDE).andExpect(status().isNoContent());
        read(OUTSIDE,key).andExpect(status().isNotFound());
        read(RESIDENT,"announcement:"+draft).andExpect(status().isNotFound());
        inboxCount(RESIDENT,1);
        read(RESIDENT,key).andExpect(status().isNoContent());
        read(RESIDENT,key).andExpect(status().isNoContent());
        inbox(RESIDENT).andExpect(jsonPath("$[0].readAt").isString());
        inboxCount(RESIDENT,0);
        inboxCount(ROOMMATE,1);
        readAll(ROOMMATE).andExpect(status().isNoContent());
        inboxCount(ROOMMATE,0);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM resident_notification_reads WHERE notification_id=?",Integer.class,key)).isEqualTo(2);
        mvc.perform(get(PATH).with(user(PENDING))).andExpect(status().isForbidden());
        mvc.perform(get(PATH+"/unread-count").with(user(PENDING))).andExpect(status().isForbidden());
        readAll(PENDING).andExpect(status().isForbidden());
        mvc.perform(post(PATH+"/read-all").with(user(RESIDENT))).andExpect(status().isForbidden());
    }

    @Test
    void archivedAndEndedStayNotificationsAreUnavailableAndOtherStayRemains() throws Exception {
        UUID archived=announcement(property,true), notice=announcement(property,true), other=announcement(otherProperty,true);
        Stay second=stay(residentId,otherProperty);
        UUID ticket=maintenance.report(RESIDENT,new MaintenanceService.Report(UUID.randomUUID(),mainStay.id(),"PLUMBING","A leak",false,null));
        UUID maintenanceId=UUID.randomUUID();
        db.update("INSERT INTO maintenance_notifications(id,ticket_id,recipient_id,message,created_at) VALUES(?,?,?,?,?)",
            maintenanceId,ticket,residentId,"Maintenance update",OffsetDateTime.now());
        inboxCount(RESIDENT,4);
        announcements.archive(()->OWNER,archived,new AnnouncementController.Archive(1));
        inboxCount(RESIDENT,3);
        read(RESIDENT,"announcement:"+archived).andExpect(status().isNotFound());
        tenancies.moveOut(OWNER,mainStay.id(),"Resident moved out");
        inbox(RESIDENT).andExpect(jsonPath("$[*].id",contains("announcement:"+other)));
        inboxCount(RESIDENT,1);
        read(RESIDENT,"announcement:"+notice).andExpect(status().isNotFound());
        read(RESIDENT,"maintenance:"+maintenanceId).andExpect(status().isNotFound());
        assertThat(maintenance.notifications(RESIDENT)).isEmpty();
        readAll(RESIDENT).andExpect(status().isNoContent());
        assertThat(db.queryForObject("SELECT read_at FROM maintenance_notifications WHERE id=?",OffsetDateTime.class,maintenanceId)).isNull();
        tenancies.moveOut(OWNER,second.id(),"Resident moved out");
        mvc.perform(get(PATH).with(user(RESIDENT))).andExpect(status().isForbidden());
        mvc.perform(get("/api/resident/payments").with(user(RESIDENT))).andExpect(status().isOk());
    }

    @Test
    void maintenanceRetriesStaySingleAndBothPanelsUseTheSameReadState() throws Exception {
        UUID technician=account(TECHNICIAN,"APPLICANT");
        db.update("INSERT INTO maintenance_staff(account_id,property_id,created_by,created_at) VALUES(?,?,?,?)",technician,property,ownerId,OffsetDateTime.now());
        UUID ticket=maintenance.report(RESIDENT,new MaintenanceService.Report(UUID.randomUUID(),mainStay.id(),"PLUMBING","Broken tap",false,null));
        var assign=new MaintenanceService.Change(0,"ASSIGN",technician,"ROUTINE",null,null);
        maintenance.change(OWNER,ticket,assign);
        assertThatThrownBy(()->maintenance.change(OWNER,ticket,assign)).isInstanceOf(FlowException.class);
        maintenance.change(TECHNICIAN,ticket,new MaintenanceService.Change(1,"START",null,null,null,null));
        var ready=new MaintenanceService.Change(2,"READY",null,null,"Tap repaired",null);
        maintenance.change(TECHNICIAN,ticket,ready);
        assertThatThrownBy(()->maintenance.change(TECHNICIAN,ticket,ready)).isInstanceOf(FlowException.class);
        inbox(RESIDENT).andExpect(jsonPath("$[*].targetId",contains(ticket.toString(),ticket.toString())))
            .andExpect(jsonPath("$[*].title",contains("Your repair is ready to confirm","A technician was assigned to your request")));
        var rows=maintenance.notifications(RESIDENT);
        UUID newest=(UUID)rows.getFirst().get("id"), assignment=(UUID)rows.getLast().get("id");
        read(ROOMMATE,"maintenance:"+newest).andExpect(status().isNotFound());
        maintenance.readNotifications(RESIDENT,assignment);
        inboxCount(RESIDENT,1);
        readAll(RESIDENT).andExpect(status().isNoContent());
        inboxCount(RESIDENT,0);
        assertThat(maintenance.notifications(RESIDENT)).allSatisfy(row->assertThat(row.get("read_at")).isNotNull());
    }

    @Test
    void paymentDecisionsUseReviewIdsAndSurviveRetriesWithoutCopies() throws Exception {
        UUID bill=bill(), approved=report(bill,"GC-1"), declined=report(bill,"GC-2");
        var approve=new PaymentService.Review(true,null,new BigDecimal("2500"));
        payments.review(OWNER,approved,"APPROVED",approve);
        payments.review(OWNER,approved,"APPROVED",approve);
        var reject=new PaymentService.Review(false,"Reference mismatch",null);
        payments.review(OWNER,declined,"DECLINED",reject);
        payments.review(OWNER,declined,"DECLINED",reject);
        var reverse=new PaymentService.Review(false,"Bank reversed the transfer",null);
        payments.review(OWNER,approved,"REVERSED",reverse);
        payments.review(OWNER,approved,"REVERSED",reverse);
        inbox(RESIDENT).andExpect(jsonPath("$[*].type",contains("PAYMENT_REVERSED","PAYMENT_DECLINED","PAYMENT_APPROVED")))
            .andExpect(jsonPath("$[*].targetId",contains(approved.toString(),declined.toString(),approved.toString())));
        inbox(ROOMMATE).andExpect(content().json("[]"));
        readAll(RESIDENT).andExpect(status().isNoContent());
        inboxCount(RESIDENT,0);
        stay(residentId,otherProperty);
        tenancies.moveOut(OWNER,mainStay.id(),"Resident moved out");
        inbox(RESIDENT).andExpect(content().json("[]"));
        inboxCount(RESIDENT,0);
        mvc.perform(get("/api/resident/payments/"+approved+"/receipt").with(user(RESIDENT))).andExpect(status().isOk());
    }

    private ResultActions inbox(String account) throws Exception {
        return mvc.perform(get(PATH).with(user(account))).andExpect(status().isOk());
    }

    private void inboxCount(String account,int expected) throws Exception {
        mvc.perform(get(PATH+"/unread-count").with(user(account))).andExpect(status().isOk()).andExpect(jsonPath("$.unread").value(expected));
    }

    private ResultActions read(String account,String id) throws Exception {
        return mvc.perform(post(PATH+"/read").with(user(account)).with(csrf()).contentType("application/json")
            .content("{\"id\":\""+id+"\"}"));
    }

    private ResultActions readAll(String account) throws Exception {
        return mvc.perform(post(PATH+"/read-all").with(user(account)).with(csrf()));
    }

    private UUID announcement(UUID propertyId,boolean publish) {
        UUID id=UUID.randomUUID();
        var content=new AnnouncementController.Content("Water service update",AnnouncementController.Category.MAINTENANCE,"Work today","Work is scheduled today.");
        announcements.create(()->OWNER,new AnnouncementController.Create(id,propertyId,content,publish));
        return id;
    }

    private UUID account(String email,String role) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,'',?,TRUE,?)",
            id,email,"unused-test-hash",email,role,OffsetDateTime.now());
        return id;
    }

    private UUID property(String name) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",id,ownerId,name);
        return id;
    }

    private Stay stay(UUID account,UUID propertyId) {
        UUID room=UUID.randomUUID(),reservation=UUID.randomUUID(),application=UUID.randomUUID(),id=UUID.randomUUID();
        var now=OffsetDateTime.now();
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",room,propertyId,"Room "+room.toString().substring(0,8));
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,ownerId,now);
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,'Resident','','APPROVED',?)",
            application,account,propertyId,now);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            id,reservation,application,account,room,now,ownerId);
        return new Stay(id,application,room);
    }

    private UUID bill() {
        UUID offer=UUID.randomUUID(),id=UUID.randomUUID();
        var now=OffsetDateTime.now();
        db.update("""
            INSERT INTO application_offers(id,application_id,version,room_id,room_version,snapshot,created_by,created_at,reason,accepted_by,accepted_at)
            VALUES(?,?,1,?,1,'{}',?,?,'Billing fixture',?,?)
            """,offer,mainStay.application(),mainStay.room(),ownerId,now,residentId,now);
        db.update("""
            INSERT INTO monthly_bills(id,tenancy_id,application_id,property_id,offer_id,period,due_date,rent,fixed_charges,posted_by,posted_at)
            VALUES(?,?,?,?,?,'2026-11',?,2500,0,?,?)
            """,id,mainStay.id(),mainStay.application(),property,offer,LocalDate.of(2026,11,10),ownerId,now);
        return id;
    }

    private UUID report(UUID bill,String reference) {
        return payments.report(RESIDENT,new PaymentService.Report(bill,UUID.randomUUID(),null,new BigDecimal("1500"),
            "GCASH",LocalDate.now(ZoneId.of("Asia/Manila")),reference));
    }
}
