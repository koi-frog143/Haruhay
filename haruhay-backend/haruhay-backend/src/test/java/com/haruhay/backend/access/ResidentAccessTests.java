package com.haruhay.backend.access;

import static com.haruhay.backend.access.ResidentAccessService.Direction.ENTRY;
import static com.haruhay.backend.access.ResidentAccessService.Direction.EXIT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.access.ResidentAccessService.Direction;
import com.haruhay.backend.access.ResidentAccessService.RecordMovement;
import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.registration.TenancyService;
import com.jayway.jsonpath.JsonPath;
import java.time.OffsetDateTime;
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
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ResidentAccessTests {
    private static final String OWNER="access-owner@example.test", OUTSIDE="access-outside@example.test";
    private static final String GUARD="access-guard@example.test", RESIDENT="access-resident@example.test", NEIGHBOR="access-neighbor@example.test";
    private static final String PASSWORD="Access-fixture-guard-password";
    private static final String RESIDENT_HISTORY="/api/resident/access-history";
    private static final OffsetDateTime AT=OffsetDateTime.parse("2026-11-01T12:00:00+08:00");

    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired PasswordEncoder passwords;
    @Autowired ResidentAccessService access;
    @Autowired TenancyService tenancies;
    private UUID owner,outsider,guard,resident,neighbor,property,otherProperty;
    private Stay current,other;
    private record Stay(UUID id,UUID application,UUID reservation,UUID room) {}

    @BeforeEach
    void setup() {
        owner=account(OWNER,"Marie Owner","OWNER","unused");
        outsider=account(OUTSIDE,"Other Owner","OWNER","unused");
        guard=account(GUARD,"Day Guard","APPLICANT",passwords.encode(PASSWORD));
        resident=account(RESIDENT,"Ana Resident","APPLICANT","unused");
        neighbor=account(NEIGHBOR,"Nico Neighbor","APPLICANT","unused");
        property=property(owner,"Garden House");
        otherProperty=property(outsider,"Hill House");
        current=stay(resident,property,owner,"Room 201");
        other=stay(neighbor,otherProperty,outsider,"Room 305");
        db.update("INSERT INTO property_guard_assignments(account_id,property_id,created_by,created_at) VALUES(?,?,?,?)",
            guard,property,owner,AT);
    }

    @Test
    void guardRecordsVerifiedMovementThatOnlyTheResidentCanSeeAndRetriesAreSafe() throws Exception {
        var session=guardLogin();
        String path=base(property);
        mvc.perform(get(path+"/residents").session(session).param("query"," 201 ")).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].name",contains("Ana Resident"))).andExpect(jsonPath("$[0].propertyName").value("Garden House"));
        mvc.perform(get(path+"/residents").session(session).param("query","Nico")).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get(base(otherProperty)+"/residents").session(session).param("query","Nico")).andExpect(status().isForbidden());
        mvc.perform(get(path+"/history").session(session)).andExpect(status().isForbidden());
        mvc.perform(get(path+"/history").with(user(OUTSIDE).roles("OWNER"))).andExpect(status().isForbidden());
        mvc.perform(get(path+"/residents").with(user(RESIDENT)).param("query","Ana")).andExpect(status().isForbidden());
        mvc.perform(post(path+"/movements").session(session).with(csrf()).contentType("application/json")
            .content(movement(other.id(),UUID.randomUUID(),ENTRY,true))).andExpect(status().isNotFound());
        mvc.perform(post(path+"/movements").session(session).with(csrf()).contentType("application/json")
            .content(movement(current.id(),UUID.randomUUID(),ENTRY,false))).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("ACCESS_IDENTITY_REQUIRED"));

        UUID request=UUID.randomUUID();
        String entry=movement(current.id(),request,ENTRY,true);
        var result=mvc.perform(post(path+"/movements").session(session).with(csrf()).contentType("application/json").content(entry))
            .andExpect(status().isOk()).andReturn();
        String id=JsonPath.read(result.getResponse().getContentAsString(),"$.id");
        mvc.perform(post(path+"/movements").session(session).with(csrf()).contentType("application/json").content(entry))
            .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        mvc.perform(post(path+"/movements").session(session).with(csrf()).contentType("application/json")
            .content(movement(current.id(),request,EXIT,true))).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("ACCESS_REQUEST_USED"));
        mvc.perform(post(path+"/movements").session(session).with(csrf()).contentType("application/json")
            .content(movement(current.id(),UUID.randomUUID(),ENTRY,true))).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("ACCESS_DUPLICATE_MOVEMENT"));
        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id",contains(id))).andExpect(jsonPath("$[0].direction").value("ENTRY"))
            .andExpect(jsonPath("$[0].identityConfirmed").value(true)).andExpect(jsonPath("$[0].entryPoint").value("Main entrance"))
            .andExpect(jsonPath("$[0].occurredAt").isString()).andExpect(jsonPath("$[0].recordedBy").doesNotExist());
        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(id));
        mvc.perform(get(RESIDENT_HISTORY).with(user(NEIGHBOR))).andExpect(status().isOk()).andExpect(content().json("[]"));
        assertThat(db.queryForObject("SELECT recorded_by FROM resident_access_events WHERE id=?",UUID.class,UUID.fromString(id))).isEqualTo(guard);
    }

    @Test
    void disablingAPropertyAssignmentBlocksAnExistingSessionForThatProperty() throws Exception {
        db.update("INSERT INTO property_guard_assignments(account_id,property_id,created_by,created_at) VALUES(?,?,?,?)",
            guard,otherProperty,outsider,AT);
        var session=guardLogin();
        mvc.perform(post("/api/logbook/properties/"+property+"/guards/"+guard).with(user(OWNER).roles("OWNER")).with(csrf())
            .contentType("application/json").content("{\"enabled\":false,\"canReview\":false}")).andExpect(status().isNoContent());
        mvc.perform(get(base(property)+"/residents").session(session).param("query","Ana")).andExpect(status().isForbidden());
        mvc.perform(post(base(property)+"/movements").session(session).with(csrf()).contentType("application/json")
            .content(movement(current.id(),UUID.randomUUID(),ENTRY,true))).andExpect(status().isForbidden());
        mvc.perform(get(base(otherProperty)+"/residents").session(session).param("query","Nico")).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].name",contains("Nico Neighbor")));
    }

    @Test
    void correctionsAppendReasonsAndAffectResidentHistoryWithoutReplacingTheOriginal() throws Exception {
        UUID id=record(OWNER,property,current.id(),ENTRY);
        var ownerUser=user(OWNER).roles("OWNER");
        String path=base(property)+"/history/"+id;
        mvc.perform(get(path).with(user(OUTSIDE).roles("OWNER"))).andExpect(status().isForbidden());
        mvc.perform(get(base(otherProperty)+"/history/"+id).with(user(OUTSIDE).roles("OWNER"))).andExpect(status().isNotFound());
        mvc.perform(get(path).with(user(GUARD))).andExpect(status().isForbidden());
        mvc.perform(post(path+"/corrections").with(ownerUser).with(csrf()).contentType("application/json")
            .content(correction(0,false,""))).andExpect(status().isBadRequest());
        mvc.perform(post(path+"/corrections").with(ownerUser).with(csrf()).contentType("application/json")
            .content(correction(0,false,"Recorded the wrong direction"))).andExpect(status().isNoContent());
        mvc.perform(post(path+"/corrections").with(ownerUser).with(csrf()).contentType("application/json")
            .content(correction(0,false,"Stale edit"))).andExpect(status().isConflict());
        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].direction").value("EXIT")).andExpect(jsonPath("$[0].entryPoint").value("Side gate"));
        mvc.perform(get(base(property)+"/history").with(ownerUser).param("direction","EXIT").param("query","Ana"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.records[0].revision").value(1));
        mvc.perform(post(path+"/corrections").with(ownerUser).with(csrf()).contentType("application/json")
            .content(correction(1,true,"Entry was recorded for the wrong person"))).andExpect(status().isNoContent());
        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get(path).with(ownerUser)).andExpect(status().isOk())
            .andExpect(jsonPath("$.original.direction").value("ENTRY")).andExpect(jsonPath("$.original.entryPoint").value("Main entrance"))
            .andExpect(jsonPath("$.corrections[0].reason").value("Recorded the wrong direction"))
            .andExpect(jsonPath("$.corrections[1].voided").value(true)).andExpect(jsonPath("$.corrections[1].correctedBy").value("Marie Owner"))
            .andExpect(jsonPath("$.corrections[1].correctedAt").isString());
        record(OWNER,property,current.id(),ENTRY);
    }

    @Test
    void moveOutPreservesOwnerHistoryAndHidesOnlyTheEndedStayFromTheResident() throws Exception {
        UUID movement=record(OWNER,property,current.id(),EXIT);
        Stay second=stay(resident,otherProperty,outsider,"Room 309");
        UUID secondMovement=record(OUTSIDE,otherProperty,second.id(),ENTRY);
        tenancies.moveOut(OWNER,current.id(),"Resident moved out");
        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id",contains(secondMovement.toString())));
        mvc.perform(get(base(property)+"/residents").with(user(GUARD)).param("query","Ana")).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post(base(property)+"/movements").with(user(GUARD)).with(csrf()).contentType("application/json")
            .content(movement(current.id(),UUID.randomUUID(),ENTRY,true))).andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("ACCESS_STAY_ENDED"));
        mvc.perform(get(base(property)+"/history/"+movement).with(user(OWNER).roles("OWNER"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.original.roomLabel").value("Room 201"));
        tenancies.moveOut(OUTSIDE,second.id(),"Resident moved out");
        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isForbidden());
    }

    @Test
    void dateFiltersUsePhilippineCalendarDaysAndIncludeTheWholeEndDay() throws Exception {
        UUID before=record(OWNER,property,current.id(),EXIT);
        UUID first=record(OWNER,property,current.id(),ENTRY);
        UUID last=record(OWNER,property,current.id(),EXIT);
        UUID after=record(OWNER,property,current.id(),ENTRY);
        time(before,"2026-11-06T15:59:59Z");
        time(first,"2026-11-06T16:00:00Z");
        time(last,"2026-11-07T15:59:59Z");
        time(after,"2026-11-07T16:00:00Z");
        history("2026-11-07","2026-11-07").andExpect(status().isOk())
            .andExpect(jsonPath("$.records[*].movement.id",contains(last.toString(),first.toString())));
        history("2026-11-08","2026-11-07").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("ACCESS_DATE_RANGE"));
    }

    @Test
    void transferPreservesOriginalRoomInTheOwnerHistoryAndStartsANewResidentHistory() throws Exception {
        UUID original=record(GUARD,property,current.id(),ENTRY);
        UUID destination=UUID.randomUUID();
        db.update("""
            INSERT INTO rooms(id,property_id,label,capacity,monthly_rent,published,accepting_applications)
            VALUES(?,?,'Room 202',1,2800,TRUE,TRUE)
            """,destination,property);
        UUID transfer=(UUID)tenancies.propose(OWNER,current.id(),destination,1,null).get("id");
        tenancies.accept(RESIDENT,transfer);
        UUID newStay=(UUID)tenancies.complete(OWNER,current.id(),transfer).get("destination_tenancy_id");
        UUID next=record(GUARD,property,newStay,ENTRY);

        mvc.perform(get(RESIDENT_HISTORY).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id",contains(next.toString()))).andExpect(jsonPath("$[0].roomLabel").value("Room 202"));
        mvc.perform(get(base(property)+"/history/"+original).with(user(OWNER).roles("OWNER"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.original.roomLabel").value("Room 201"));
    }

    @Test
    @Transactional(propagation=Propagation.NOT_SUPPORTED)
    void concurrentRetriesAndDistinctDuplicateMovementsAreSerialized() throws Exception {
        var same=new RecordMovement(current.id(),UUID.randomUUID(),EXIT,"Main entrance",true);
        try {
            var repeated=concurrent(()->access.record(GUARD,property,same),()->access.record(GUARD,property,same));
            assertThat(repeated.getFirst()).isEqualTo(repeated.getLast());
            var duplicates=concurrent(this::entryOrConflict,this::entryOrConflict);
            assertThat(duplicates).anyMatch(result->result instanceof UUID).contains("ACCESS_DUPLICATE_MOVEMENT");
            assertThat(db.queryForObject("SELECT COUNT(*) FROM resident_access_events WHERE tenancy_id=?",Integer.class,current.id())).isEqualTo(2);
        } finally {
            db.update("DELETE FROM resident_access_events WHERE tenancy_id=?",current.id());
            db.update("DELETE FROM property_guard_assignments WHERE account_id=?",guard);
            for (Stay stay:List.of(current,other)) {
                db.update("DELETE FROM tenancies WHERE id=?",stay.id());
                db.update("DELETE FROM registration_applications WHERE id=?",stay.application());
                db.update("DELETE FROM reservations WHERE id=?",stay.reservation());
                db.update("DELETE FROM rooms WHERE id=?",stay.room());
            }
            db.update("DELETE FROM properties WHERE id IN (?,?)",property,otherProperty);
            db.update("DELETE FROM accounts WHERE id IN (?,?,?,?,?)",owner,outsider,guard,resident,neighbor);
        }
    }

    private Object entryOrConflict() {
        try { return record(GUARD,property,current.id(),ENTRY); }
        catch (FlowException error) { return error.code; }
    }

    private <T> List<T> concurrent(Callable<T> first,Callable<T> second) throws Exception {
        var workers=Executors.newFixedThreadPool(2);
        var start=new CyclicBarrier(2);
        try {
            var one=workers.submit(()->{ start.await(10,TimeUnit.SECONDS); return first.call(); });
            var two=workers.submit(()->{ start.await(10,TimeUnit.SECONDS); return second.call(); });
            return List.of(one.get(15,TimeUnit.SECONDS),two.get(15,TimeUnit.SECONDS));
        } finally { workers.shutdownNow(); }
    }

    private ResultActions history(String from,String through) throws Exception {
        return mvc.perform(get(base(property)+"/history").with(user(OWNER).roles("OWNER")).param("from",from).param("through",through));
    }

    private void time(UUID event,String timestamp) {
        db.update("UPDATE resident_access_events SET occurred_at=? WHERE id=?",OffsetDateTime.parse(timestamp),event);
    }

    private UUID record(String email,UUID property,UUID stay,Direction direction) {
        return access.record(email,property,new RecordMovement(stay,UUID.randomUUID(),direction,"Main entrance",true));
    }

    private String base(UUID property) { return "/api/logbook/properties/"+property+"/resident-access"; }

    private String movement(UUID stay,UUID request,Direction direction,boolean identity) {
        return """
            {"tenancyId":"%s","requestId":"%s","direction":"%s","entryPoint":"Main entrance","identityConfirmed":%s}
            """.formatted(stay,request,direction,identity);
    }

    private String correction(int revision,boolean voided,String reason) {
        return """
            {"revision":%s,"direction":"EXIT","entryPoint":"Side gate","voided":%s,"reason":"%s"}
            """.formatted(revision,voided,reason);
    }

    private MockHttpSession guardLogin() throws Exception {
        return (MockHttpSession)mvc.perform(post("/api/auth/login").with(csrf()).param("username",GUARD).param("password",PASSWORD))
            .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private UUID account(String email,String name,String role,String password) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,'',?,TRUE,?)",
            id,email,password,name,role,AT);
        return id;
    }

    private UUID property(UUID owner,String name) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",id,owner,name);
        return id;
    }

    private Stay stay(UUID account,UUID property,UUID owner,String label) {
        UUID room=UUID.randomUUID(),reservation=UUID.randomUUID(),application=UUID.randomUUID(),id=UUID.randomUUID();
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",room,property,label);
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,AT);
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,'Resident','','APPROVED',?)",
            application,account,property,AT);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            id,reservation,application,account,room,AT,owner);
        return new Stay(id,application,reservation,room);
    }
}
