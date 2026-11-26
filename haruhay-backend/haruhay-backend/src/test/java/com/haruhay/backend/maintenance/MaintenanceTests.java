package com.haruhay.backend.maintenance;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.registration.RegistrationService;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MaintenanceTests {
    @Autowired JdbcTemplate db;
    @Autowired MaintenanceService service;
    @Autowired RegistrationService registration;
    @Autowired MockMvc mvc;

    private static final String OWNER="maintenance-owner@example.test", OTHER="maintenance-other@example.test";
    private static final String RESIDENT="maintenance-resident@example.test", PENDING="maintenance-pending@example.test";
    private static final String TECH="maintenance-tech@example.test", REPLACEMENT="maintenance-other-tech@example.test";
    private UUID property, otherProperty, tenancy, tech, replacement;

    @BeforeEach void fixtures() {
        clearFixtures();
        UUID owner=account(OWNER,"OWNER"), other=account(OTHER,"OWNER");
        UUID resident=account(RESIDENT,"APPLICANT");
        account(PENDING,"APPLICANT");
        property=UUID.randomUUID();
        otherProperty=UUID.randomUUID();
        UUID room=UUID.randomUUID(), reservation=UUID.randomUUID(), invitation=UUID.randomUUID(), application=UUID.randomUUID();
        tenancy=UUID.randomUUID();
        var now=OffsetDateTime.now();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",property,owner,"Maintenance House");
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",otherProperty,other,"Other House");
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,2)",room,property,"Room 1");
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,now);
        db.update("INSERT INTO invitations(id,reservation_id,email,token_hash,token_expires_at,status,created_by,created_at) VALUES(?,?,?,?,?,'CLAIMED',?,?)",
            invitation,reservation,RESIDENT,"maintenance-fixture",now.plusDays(1),owner,now);
        db.update("INSERT INTO registration_applications(id,invitation_id,account_id,full_name,contact,status,submitted_at) VALUES(?,?,?,?,?,'APPROVED',?)",
            application,invitation,resident,"Resident One","",now);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            tenancy,reservation,application,resident,room,now,owner);
        tech=technician(OWNER,property,TECH,"Technician One");
        replacement=technician(OWNER,property,REPLACEMENT,"Technician Two");
    }

    @AfterEach void clearFixtures() {
        String url=db.execute((java.sql.Connection c)->c.getMetaData().getURL());
        assertThat(url).containsAnyOf("registration-tests","haruhay_registration_test");
        for(String table:List.of("maintenance_notifications","maintenance_photos","maintenance_completions","maintenance_activity",
            "maintenance_assignments","maintenance_tickets","maintenance_staff","visitor_movements","visitor_audit","visitor_qr_credentials",
            "visitor_visits","visitor_requests","visitor_profiles","property_guard_assignments","holding_item_transactions","holding_inquiries",
            "holding_items","registration_audit","monthly_bills","application_offers","room_charges","tenancy_activation_codes","email_verifications",
            "tenancies","registration_applications","invitations","reservations","rooms","properties","accounts")) {
            db.update("DELETE FROM "+table);
        }
    }
    private UUID account(String email,String role) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,?,TRUE,?)",
            id,email,"unused-test-hash",email,"",role,OffsetDateTime.now());
        return id;
    }
    private UUID technician(String owner,UUID property,String email,String name) {
        service.createStaff(owner,property,new MaintenanceService.Staff(name,email,"Maintenance-fixture-password42"));
        return (UUID)registration.account(email).get("id");
    }
    private MaintenanceService.Report report() {
        return new MaintenanceService.Report(UUID.randomUUID(),tenancy,"PLUMBING","Tap is dripping.",false,null);
    }
    private MaintenanceService.Change action(int version,String action,String note) {
        return new MaintenanceService.Change(version,action,null,null,note,null);
    }
    private MaintenanceService.Change assignment(int version,UUID staff,String priority,String note) {
        return new MaintenanceService.Change(version,"ASSIGN",staff,priority,note,null);
    }
    @SuppressWarnings("unchecked")
    private List<Map<String,Object>> timeline(UUID id) {
        return (List<Map<String,Object>>)service.detail(RESIDENT,id).get("activity");
    }
    private void ready(UUID ticket) {
        service.change(OWNER,ticket,assignment(0,tech,"ROUTINE",null));
        service.change(TECH,ticket,action(1,"START",null));
        service.change(TECH,ticket,new MaintenanceService.Change(2,"READY",null,null,"Replaced the seal.","Seal"));
    }

    @Test void residentTechnicianAndOwnerShareOneAuditedLifecycle() throws Exception {
        UUID ticket=service.report(RESIDENT,report());
        assertThat(service.detail(RESIDENT,ticket)).containsEntry("location","Room 1").containsEntry("status","SUBMITTED");
        assertThat(service.notifications(OWNER)).singleElement().satisfies(n->assertThat(n).containsEntry("ticket_id",ticket));
        assertThat(service.list(TECH)).isEmpty();
        assertThat(registration.account(TECH)).containsEntry("role","TECHNICIAN");
        service.change(OWNER,ticket,assignment(0,tech,"HIGH",null));
        assertThat(service.list(TECH)).singleElement().satisfies(row->assertThat(row).containsEntry("status","ASSIGNED"));
        var notice=service.notifications(TECH).getFirst();
        service.readNotifications(TECH,(UUID)notice.get("id"));
        assertThat(service.notifications(TECH).getFirst().get("read_at")).isNotNull();
        service.change(TECH,ticket,action(1,"START",null));
        service.comment(RESIDENT,ticket,new MaintenanceService.Note("The tap is in the kitchen."));
        service.change(TECH,ticket,action(2,"PROGRESS","Inspected the fitting."));
        assertThatThrownBy(()->service.change(TECH,ticket,action(3,"READY"," "))).isInstanceOf(FlowException.class);
        service.change(TECH,ticket,new MaintenanceService.Change(3,"READY",null,null,"Replaced the seal.","Seal"));
        assertThat(service.notifications(RESIDENT)).hasSize(2)
            .allSatisfy(n->assertThat(n).containsEntry("ticket_id",ticket))
            .extracting(n->n.get("message")).containsExactlyInAnyOrder(
                "A technician was assigned to your request","Your repair is ready to confirm");
        service.change(RESIDENT,ticket,action(4,"REOPEN","It still leaks on the hot setting."));
        assertThat(service.detail(RESIDENT,ticket)).containsEntry("status","IN_PROGRESS");
        service.change(TECH,ticket,action(5,"READY","Tightened the hot-side valve."));
        service.change(RESIDENT,ticket,action(6,"CLOSE",null));
        assertThat(service.detail(RESIDENT,ticket)).containsEntry("status","CLOSED");
        assertThat(service.detail(RESIDENT,ticket).get("archived_at")).isNotNull();
        assertThat(timeline(ticket)).extracting(row->row.get("kind")).containsExactly(
            "SUBMITTED","ASSIGNED","STARTED","COMMENT","PROGRESS","READY","REOPENED","READY","CLOSED");
        assertThat(service.list(TECH)).isEmpty();
        mvc.perform(get("/api/maintenance/tickets/"+ticket).with(user(RESIDENT).roles("APPLICANT")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.ticket_number").isString());
    }

    @Test void criticalEscalationAndReassignmentRequireCurrentAuthorizedActors() {
        UUID ticket=service.report(RESIDENT,new MaintenanceService.Report(UUID.randomUUID(),tenancy,"ELECTRICAL","Hall light failed",true,"Second-floor hallway"));
        assertThat(service.detail(RESIDENT,ticket)).containsEntry("location","Second-floor hallway");
        UUID outsider=technician(OTHER,otherProperty,"outsider-tech@example.test","Other property technician");
        assertThatThrownBy(()->service.change(OWNER,ticket,assignment(0,outsider,"HIGH",null))).isInstanceOf(FlowException.class);
        service.change(OWNER,ticket,assignment(0,tech,"CRITICAL",null));
        service.change(OWNER,ticket,action(1,"ESCALATE","Electrician contacted. Technician One will follow up."));
        assertThatThrownBy(()->service.change(OWNER,ticket,assignment(1,replacement,"CRITICAL","Wrong version"))).hasMessageContaining("changed");
        assertThatThrownBy(()->service.change(OWNER,ticket,assignment(2,replacement,"CRITICAL",null))).hasMessageContaining("reassignment");
        service.change(OWNER,ticket,assignment(2,replacement,"CRITICAL","First technician is off duty."));
        assertThat(service.notifications(TECH)).isEmpty();
        assertThatThrownBy(()->service.change(TECH,ticket,action(3,"START",null))).isInstanceOf(FlowException.class);
        service.change(REPLACEMENT,ticket,action(3,"START",null));
        service.change(REPLACEMENT,ticket,action(4,"READY","Replaced the fixture."));
        assertThatThrownBy(()->service.change(OWNER,ticket,action(5,"CLOSE"," "))).hasMessageContaining("verified");
        service.change(OWNER,ticket,action(5,"CLOSE","Checked the light with the resident."));
        assertThat(timeline(ticket)).extracting(row->row.get("kind")).contains("ESCALATED","REASSIGNED","CLOSED");
    }

    @Test void reopeningWithoutAnEnabledTechnicianReturnsTheSameTicketToTheQueue() {
        UUID ticket=service.report(RESIDENT,report());
        ready(ticket);
        service.staffStatus(OWNER,property,tech,new MaintenanceService.StaffStatus(false));
        assertThat(service.list(TECH)).isEmpty();
        assertThat(registration.account(TECH)).containsEntry("role","TECHNICIAN");
        service.change(RESIDENT,ticket,action(3,"REOPEN","Leak reappeared."));
        assertThat(service.detail(OWNER,ticket)).containsEntry("status","SUBMITTED").containsEntry("needs_assignment",true);
        service.change(RESIDENT,ticket,action(4,"CANCEL","Issue resolved separately."));
        assertThat(service.detail(OWNER,ticket)).containsEntry("status","CANCELLED");
        assertThat(timeline(ticket)).extracting(row->row.get("kind")).contains("REOPENED","CANCELLED");
    }

    @Test void privateValidatedAttachmentsAndCsrf() throws Exception {
        UUID ticket=service.report(RESIDENT,report());
        var endpoint="/api/maintenance/tickets/"+ticket+"/photos";
        var bad=new MockMultipartFile("photo","bad.png","image/png",new byte[]{1,2,3});
        mvc.perform(multipart(endpoint).file(bad).with(user(RESIDENT).roles("APPLICANT")).with(csrf()))
            .andExpect(status().isBadRequest());
        try(var bytes=new ByteArrayOutputStream()) {
            ImageIO.write(new BufferedImage(16,16,BufferedImage.TYPE_INT_RGB),"png",bytes);
            var photo=new MockMultipartFile("photo","tap.png","image/png",bytes.toByteArray());
            mvc.perform(multipart(endpoint).file(photo).with(user(RESIDENT).roles("APPLICANT"))).andExpect(status().isForbidden());
            mvc.perform(multipart(endpoint).file(photo).with(user(RESIDENT).roles("APPLICANT")).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").exists());
            UUID photoId=db.queryForObject("SELECT id FROM maintenance_photos WHERE ticket_id=?",UUID.class,ticket);
            mvc.perform(get(endpoint+"/"+photoId).with(user(OTHER).roles("OWNER"))).andExpect(status().isNotFound());
            mvc.perform(get(endpoint+"/"+photoId).with(user(PENDING).roles("APPLICANT"))).andExpect(status().isForbidden());
            mvc.perform(get(endpoint+"/"+photoId).with(user(OWNER).roles("OWNER")))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                .andExpect(content().contentType("image/png")).andExpect(content().bytes(bytes.toByteArray()));
        }
        mvc.perform(get("/api/maintenance/tickets")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/maintenance/tickets").with(user(PENDING).roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/resident/bills").with(user(TECH).roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/owner/bills").with(user(TECH).roles("APPLICANT"))).andExpect(status().isForbidden());
    }

    @Test void concurrentSubmissionsAndConflictingAssignmentVersionsAreSafe() throws Exception {
        var request=report();
        List<UUID> results=together(()->service.report(RESIDENT,request));
        UUID ticket=results.getFirst();
        assertThat(results).containsExactly(ticket,ticket);
        assertThat(service.list(RESIDENT)).hasSize(1);
        assertThat(service.notifications(OWNER)).hasSize(1);
        List<Boolean> writes=together(()->{
            try {
                service.change(OWNER,ticket,assignment(0,tech,"ROUTINE",null));
                return true;
            } catch(FlowException error) {
                assertThat(error.getMessage()).contains("changed");
                return false;
            }
        });
        assertThat(writes).containsExactlyInAnyOrder(true,false);
        assertThat(timeline(ticket)).extracting(row->row.get("kind")).containsExactly("SUBMITTED","ASSIGNED");
    }
    private <T> List<T> together(Callable<T> action) throws Exception {
        try(var pool=Executors.newFixedThreadPool(2)) {
            var start=new CountDownLatch(1);
            Callable<T> task=()->{start.await();return action.call();};
            Future<T> first=pool.submit(task), second=pool.submit(task);
            start.countDown();
            return List.of(first.get(15,TimeUnit.SECONDS),second.get(15,TimeUnit.SECONDS));
        }
    }
}
