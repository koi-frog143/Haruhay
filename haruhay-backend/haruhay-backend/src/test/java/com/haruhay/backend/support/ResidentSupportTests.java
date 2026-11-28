package com.haruhay.backend.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.registration.TenancyService;
import com.haruhay.backend.support.ResidentSupportService.Create;
import com.haruhay.backend.support.ResidentSupportService.Reply;
import com.haruhay.backend.support.ResidentSupportService.Role;
import com.jayway.jsonpath.JsonPath;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ResidentSupportTests {
    private static final String RESIDENT_PATH="/api/resident/support",OWNER_PATH="/api/owner/support";
    private static final String OWNER="support-owner@example.test",OUTSIDER="support-outside-owner@example.test",
        RESIDENT="support-resident@example.test",NEIGHBOR="support-neighbor@example.test",PENDING="support-applicant@example.test";
    private static final OffsetDateTime AT=OffsetDateTime.parse("2026-11-01T12:00:00+08:00");

    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired ResidentSupportService support;
    @Autowired TenancyService tenancies;

    private UUID owner,outsider,resident,neighbor,pending,property,otherProperty;
    private UUID stay;
    private final List<Stay> stays=new ArrayList<>();
    private record Stay(UUID id,UUID application,UUID reservation,UUID room) {}

    @BeforeEach
    void setup() {
        owner=account(OWNER,"Joy Owner","OWNER");
        outsider=account(OUTSIDER,"Outside Owner","OWNER");
        resident=account(RESIDENT,"Ana Resident","APPLICANT");
        neighbor=account(NEIGHBOR,"Nico Neighbor","APPLICANT");
        pending=account(PENDING,"Pending Applicant","APPLICANT");
        property=property(owner,"Garden House");
        otherProperty=property(outsider,"Hill House");
        stay=stay(resident,property,owner,"Room 201");
        stay(neighbor,property,owner,"Room 202");
    }

    @Test
    void ownerReplyAppearsOnReloadAndPrivateThreadsStayScoped() throws Exception {
        String id=create(UUID.randomUUID(),property,"Access card question","How do I collect my access card?")
            .andExpect(status().isOk()).andExpect(jsonPath("$.request.status").value("OPEN"))
            .andExpect(jsonPath("$.events[0].author").value("Ana Resident"))
            .andExpect(jsonPath("$.events[0].occurredAt").isString())
            .andExpect(jsonPath("$.events[0].message").value("How do I collect my access card?"))
            .andReturn().getResponse().getContentAsString();
        String thread=JsonPath.read(id,"$.request.id");
        mvc.perform(get(OWNER_PATH).param("propertyId",property.toString()).with(user(OWNER).roles("OWNER")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.requests[0].id").value(thread));
        reply(OWNER_PATH,thread,OWNER,UUID.randomUUID(),"Pick it up at the front desk after 2 pm.")
            .andExpect(status().isOk());

        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk()).andExpect(jsonPath("$[*].id",contains(thread)));
        mvc.perform(get(RESIDENT_PATH+"/"+thread).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$.events[1].message").value("Pick it up at the front desk after 2 pm."))
            .andExpect(jsonPath("$.events[1].author").value("Joy Owner"))
            .andExpect(jsonPath("$.events[1].authorRole").value("OWNER"));
        mvc.perform(get(RESIDENT_PATH+"/"+thread).with(user(NEIGHBOR))).andExpect(status().isNotFound());
        mvc.perform(get(OWNER_PATH+"/"+thread).with(user(OUTSIDER).roles("OWNER"))).andExpect(status().isNotFound());
        reply(OWNER_PATH,thread,OUTSIDER,UUID.randomUUID(),"Outside reply").andExpect(status().isNotFound());
        mvc.perform(get(OWNER_PATH).param("propertyId",property.toString()).with(user(OUTSIDER).roles("OWNER")))
            .andExpect(status().isNotFound());
        mvc.perform(get(RESIDENT_PATH).with(user(PENDING))).andExpect(status().isForbidden());
        mvc.perform(get(OWNER_PATH).param("propertyId",property.toString()).with(user(RESIDENT))).andExpect(status().isForbidden());
        create(UUID.randomUUID(),otherProperty,"Outside property","I do not live here").andExpect(status().isNotFound());
    }

    @Test
    void repliesAndStatusTransitionsAreAuditedAndRetriesDoNotDuplicateEvents() throws Exception {
        UUID createKey=UUID.randomUUID();
        String thread=id(create(createKey,property,"Guest policy","Where can I read it?"));
        UUID waiting=UUID.randomUUID();
        statusChange(OWNER_PATH,thread,OWNER,waiting,"OPEN","WAITING_FOR_RESIDENT")
            .andExpect(status().isOk()).andExpect(jsonPath("$.request.status").value("WAITING_FOR_RESIDENT"));
        statusChange(RESIDENT_PATH,thread,RESIDENT,UUID.randomUUID(),"WAITING_FOR_RESIDENT","RESOLVED")
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SUPPORT_STATUS_ACTION"));
        statusChange(OWNER_PATH,thread,OWNER,UUID.randomUUID(),"OPEN","RESOLVED")
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SUPPORT_STATUS_CHANGED"));
        UUID answer=UUID.randomUUID();
        reply(RESIDENT_PATH,thread,RESIDENT,answer,"I found it in the handbook.").andExpect(status().isOk())
            .andExpect(jsonPath("$.request.status").value("OPEN"))
            .andExpect(jsonPath("$.events[2].previousStatus").value("WAITING_FOR_RESIDENT"))
            .andExpect(jsonPath("$.events[2].newStatus").value("OPEN"));
        UUID resolved=UUID.randomUUID();
        statusChange(OWNER_PATH,thread,OWNER,resolved,"OPEN","RESOLVED").andExpect(status().isOk());
        statusChange(OWNER_PATH,thread,OWNER,resolved,"OPEN","RESOLVED").andExpect(status().isOk())
            .andExpect(jsonPath("$.events.length()").value(4));
        reply(RESIDENT_PATH,thread,RESIDENT,answer,"I found it in the handbook.")
            .andExpect(status().isOk()).andExpect(jsonPath("$.events.length()").value(4));
        reply(RESIDENT_PATH,thread,RESIDENT,answer,"Different message").andExpect(status().isConflict());
        reply(RESIDENT_PATH,thread,RESIDENT,UUID.randomUUID(),"Can I follow up?")
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SUPPORT_RESOLVED"));
        statusChange(RESIDENT_PATH,thread,RESIDENT,UUID.randomUUID(),"RESOLVED","OPEN").andExpect(status().isOk())
            .andExpect(jsonPath("$.events[4].authorRole").value("RESIDENT"))
            .andExpect(jsonPath("$.request.status").value("OPEN"));
        create(createKey,property,"Guest policy","Where can I read it?").andExpect(status().isOk())
            .andExpect(jsonPath("$.request.id").value(thread)).andExpect(jsonPath("$.events.length()").value(5));
        create(createKey,property,"Different subject","Where can I read it?").andExpect(status().isConflict());
    }

    @Test
    void ownerInboxFiltersAreLiteralAndOrderByLatestActivity() throws Exception {
        String first=id(create(UUID.randomUUID(),property,"Parking % permits","Can I apply for one?"));
        String second=id(create(UUID.randomUUID(),property,"Wi-Fi information","Where can I find it?"));
        db.update("UPDATE support_threads SET updated_at=? WHERE id=?",AT,UUID.fromString(first));
        db.update("UPDATE support_threads SET updated_at=? WHERE id=?",AT.plusHours(1),UUID.fromString(second));
        mvc.perform(get(OWNER_PATH).param("propertyId",property.toString()).param("query","aNa").with(user(OWNER).roles("OWNER")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.requests[*].id",contains(second,first)));
        statusChange(OWNER_PATH,first,OWNER,UUID.randomUUID(),"OPEN","RESOLVED").andExpect(status().isOk());
        mvc.perform(get(OWNER_PATH).param("propertyId",property.toString()).param("query","%").param("status","RESOLVED")
            .with(user(OWNER).roles("OWNER"))).andExpect(status().isOk()).andExpect(jsonPath("$.requests[*].id",contains(first)));
        mvc.perform(get(OWNER_PATH).param("propertyId",property.toString()).param("status","OPEN").with(user(OWNER).roles("OWNER")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.requests[*].id",contains(second)));
    }

    @Test
    void moveOutKeepsOwnerHistoryAndResidentAccessOnlyAtTheirRemainingProperty() throws Exception {
        String original=id(create(UUID.randomUUID(),property,"Room follow-up","I have a question about my existing stay."));
        UUID secondStay=stay(resident,otherProperty,outsider,"Room 305");
        String other=id(create(UUID.randomUUID(),otherProperty,"Other stay","Where is the front desk?"));
        tenancies.moveOut(OWNER,stay,"Resident moved out");
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id",contains(other)));
        mvc.perform(get(RESIDENT_PATH+"/"+original).with(user(RESIDENT))).andExpect(status().isNotFound());
        reply(RESIDENT_PATH,original,RESIDENT,UUID.randomUUID(),"Can I add more?").andExpect(status().isNotFound());
        mvc.perform(get(OWNER_PATH+"/"+original).with(user(OWNER).roles("OWNER"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.events[0].message").value("I have a question about my existing stay."));
        tenancies.moveOut(OUTSIDER,secondStay,"Resident moved out");
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isForbidden());
    }

    @Test
    @Transactional(propagation=Propagation.NOT_SUPPORTED)
    void simultaneousRetriesCreateOneRequestAndOneReply() throws Exception {
        try {
            var create=new Create(UUID.randomUUID(),property,"Quiet hours","Could you confirm the quiet hours?");
            var submissions=together(()->support.create(RESIDENT,create),()->support.create(RESIDENT,create));
            UUID id=submissions.getFirst().request().id();
            assertThat(submissions.getLast().request().id()).isEqualTo(id);
            var reply=new Reply(UUID.randomUUID(),"Quiet hours start at 10 pm.");
            together(()->support.reply(OWNER,Role.OWNER,id,reply),()->support.reply(OWNER,Role.OWNER,id,reply));
            assertThat(db.queryForObject("SELECT COUNT(*) FROM support_threads WHERE resident_id=?",Integer.class,resident)).isOne();
            assertThat(db.queryForObject("SELECT COUNT(*) FROM support_events WHERE thread_id=?",Integer.class,id)).isEqualTo(2);
        } finally {
            db.update("DELETE FROM support_threads WHERE property_id=?",property);
            for (Stay stay:stays) {
                db.update("DELETE FROM tenancies WHERE id=?",stay.id());
                db.update("DELETE FROM registration_applications WHERE id=?",stay.application());
                db.update("DELETE FROM reservations WHERE id=?",stay.reservation());
                db.update("DELETE FROM rooms WHERE id=?",stay.room());
            }
            db.update("DELETE FROM properties WHERE id IN (?,?)",property,otherProperty);
            db.update("DELETE FROM accounts WHERE id IN (?,?,?,?,?)",owner,outsider,resident,neighbor,pending);
        }
    }

    private <T> List<T> together(Callable<T> first,Callable<T> second) throws Exception {
        var ready=new CyclicBarrier(2);
        try (var workers=Executors.newFixedThreadPool(2)) {
            var one=workers.submit(()->{ ready.await(10,TimeUnit.SECONDS); return first.call(); });
            var two=workers.submit(()->{ ready.await(10,TimeUnit.SECONDS); return second.call(); });
            return List.of(one.get(15,TimeUnit.SECONDS),two.get(15,TimeUnit.SECONDS));
        }
    }

    private String id(ResultActions response) throws Exception {
        return JsonPath.read(response.andExpect(status().isOk()).andReturn().getResponse().getContentAsString(),"$.request.id");
    }

    private ResultActions create(UUID key,UUID property,String subject,String message) throws Exception {
        return mvc.perform(post(RESIDENT_PATH).with(user(RESIDENT)).with(csrf()).contentType("application/json").content("""
            {"requestId":"%s","propertyId":"%s","subject":"%s","message":"%s"}
            """.formatted(key,property,subject,message)));
    }

    private ResultActions reply(String path,String thread,String author,UUID key,String message) throws Exception {
        return mvc.perform(post(path+"/"+thread+"/replies").with(user(author).roles(path.equals(OWNER_PATH)?"OWNER":"APPLICANT"))
            .with(csrf()).contentType("application/json").content("""
                {"requestId":"%s","message":"%s"}
                """.formatted(key,message)));
    }

    private ResultActions statusChange(String path,String thread,String author,UUID key,String expected,String next) throws Exception {
        return mvc.perform(put(path+"/"+thread+"/status").with(user(author).roles(path.equals(OWNER_PATH)?"OWNER":"APPLICANT"))
            .with(csrf()).contentType("application/json").content("""
                {"requestId":"%s","expectedStatus":"%s","status":"%s"}
                """.formatted(key,expected,next)));
    }

    private UUID account(String email,String name,String role) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,'unused',?,'',?,TRUE,?)",
            id,email,name,role,AT);
        return id;
    }

    private UUID property(UUID owner,String name) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",id,owner,name);
        return id;
    }

    private UUID stay(UUID account,UUID property,UUID owner,String label) {
        UUID room=UUID.randomUUID(),reservation=UUID.randomUUID(),application=UUID.randomUUID(),id=UUID.randomUUID();
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",room,property,label);
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,AT);
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,'Resident','','APPROVED',?)",
            application,account,property,AT);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            id,reservation,application,account,room,AT,owner);
        stays.add(new Stay(id,application,reservation,room));
        return id;
    }
}
