package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties={
    "haruhay.password-reset-ttl=15m","haruhay.password-reset-ip-limit=4","haruhay.password-reset-email-limit=2"
})
@AutoConfigureMockMvc(print=MockMvcPrint.NONE)
@ActiveProfiles("test")
class PasswordRecoveryTests {
    private static final String PATH="/api/public/password-reset";
    private static final String OLD_PASSWORD="Reset-test-old-passphrase";
    private static final String NEW_PASSWORD="Reset-test-new-passphrase";
    private static final String IP="192.0.2.10";
    private static final AtomicLong TEST_HOUR=new AtomicLong();

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired PasswordRecoveryService recovery;
    @MockitoBean VerificationDelivery delivery;
    @MockitoBean Clock clock;
    @MockitoBean(name="passwordRecoveryExecutor") TaskExecutor executor;

    private final Queue<Runnable> queued=new ArrayDeque<>();
    private final HashMap<String,String> delivered=new HashMap<>();
    private final List<Identity> accounts=new ArrayList<>();
    private final List<UUID> applications=new ArrayList<>();
    private Instant time;
    private UUID property,room,reservation,stay;
    private Identity owner;
    private String initialHash;
    private record Identity(UUID id,String email) {}

    @BeforeEach
    void setup() {
        time=Instant.parse("2026-11-28T01:00:00Z").plus(Duration.ofHours(TEST_HOUR.incrementAndGet()));
        when(clock.instant()).thenAnswer(ignored->time);
        when(clock.millis()).thenAnswer(ignored->time.toEpochMilli());
        initialHash=passwords.encode(OLD_PASSWORD);
        doAnswer(task->{ queued.add(task.getArgument(0,Runnable.class)); return null; }).when(executor).execute(any(Runnable.class));
        when(delivery.deliverPasswordReset(any(UUID.class),anyString(),anyString())).thenAnswer(call->{
            delivered.put(call.getArgument(1),call.getArgument(2));
            return "SMTP_ACCEPTED";
        });
        owner=account("owner","OWNER",true);
    }

    @AfterEach
    void removeFixtures() {
        if (stay!=null) db.update("DELETE FROM tenancies WHERE id=?",stay);
        for (var application:applications) db.update("DELETE FROM registration_applications WHERE id=?",application);
        if (reservation!=null) db.update("DELETE FROM reservations WHERE id=?",reservation);
        if (room!=null) db.update("DELETE FROM rooms WHERE id=?",room);
        if (property!=null) {
            db.update("DELETE FROM property_guard_assignments WHERE property_id=?",property);
            db.update("DELETE FROM maintenance_staff WHERE property_id=?",property);
            db.update("DELETE FROM properties WHERE id=?",property);
        }
        for (var account:accounts) {
            db.update("DELETE FROM registration_audit WHERE actor_id=?",account.id());
            db.update("DELETE FROM accounts WHERE id=?",account.id());
        }
    }

    @Test
    void residentResetsPasswordWithoutChangingTheirTenancyAndBothOldSessionsAreRejected() throws Exception {
        var resident=activeResident();
        var current=login(resident,OLD_PASSWORD);
        var stale=login(resident,OLD_PASSWORD);
        mvc.perform(get("/api/resident/bills").session(stale)).andExpect(status().isOk());

        String token=issue(resident,IP);
        mvc.perform(get(PATH+"/complete")).andExpect(status().isMethodNotAllowed());
        assertThat(storedHash(resident)).isEqualTo(RegistrationService.hash(token)).isNotEqualTo(token);
        mvc.perform(reset(token,NEW_PASSWORD,"different-passphrase")).andExpect(status().isBadRequest());
        assertThat(storedHash(resident)).isNotNull();
        mvc.perform(reset(token,NEW_PASSWORD,NEW_PASSWORD).session(current)).andExpect(status().isNoContent());
        assertThat(current.isInvalid()).isTrue();
        mvc.perform(get("/api/resident/bills").session(stale)).andExpect(status().isUnauthorized());
        mvc.perform(reset(token,NEW_PASSWORD,NEW_PASSWORD)).andExpect(status().isGone());
        mvc.perform(signIn(resident,OLD_PASSWORD)).andExpect(status().isUnauthorized());
        var newSession=login(resident,NEW_PASSWORD);
        mvc.perform(get("/api/resident/bills").session(newSession)).andExpect(status().isOk());
        assertThat(db.queryForObject("SELECT status FROM tenancies WHERE id=?",String.class,stay)).isEqualTo("ACTIVE");
        assertThat(db.queryForObject("SELECT credential_version FROM accounts WHERE id=?",Long.class,resident.id())).isEqualTo(1L);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM registration_audit WHERE entity_id=? AND event='PASSWORD_RESET'",Integer.class,resident.id())).isOne();
    }

    @Test
    void knownAndUnknownEmailsHaveTheSameResponseAndOnlyTheLatestLinkWorksUntilExpiry() throws Exception {
        when(delivery.isLocalDelivery()).thenReturn(true);
        var known=request(owner.email(),IP).andExpect(status().isAccepted())
            .andExpect(jsonPath("$.localDelivery").value(true)).andReturn().getResponse().getContentAsString();
        var unknown=request("no-matching-reset@example.test",IP).andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        assertThat(known).isEqualTo(unknown);
        verify(delivery,never()).deliverPasswordReset(any(),anyString(),anyString());
        assertThat(storedHash(owner)).isNull();
        queued.remove().run();
        queued.remove().run();
        String first=delivered.get(owner.email());
        assertThat(delivered).hasSize(1);
        String second=issue(owner,IP);
        assertThat(second).isNotEqualTo(first);
        assertThat(storedHash(owner)).isEqualTo(RegistrationService.hash(second));
        mvc.perform(reset(first,NEW_PASSWORD,NEW_PASSWORD)).andExpect(status().isGone());
        time=time.plus(Duration.ofMinutes(15));
        mvc.perform(reset(second,NEW_PASSWORD,NEW_PASSWORD)).andExpect(status().isGone());
        mvc.perform(reset("malformed",NEW_PASSWORD,NEW_PASSWORD)).andExpect(status().isGone());
        login(owner,OLD_PASSWORD);
    }

    @Test
    void recoveryRequestsAreLimitedPerIpAndNormalizedEmail() throws Exception {
        request(owner.email().toUpperCase(java.util.Locale.ROOT),IP).andExpect(status().isAccepted());
        request(owner.email(),"192.0.2.11").andExpect(status().isAccepted());
        request(owner.email(),"192.0.2.12").andExpect(status().isAccepted());
        assertThat(queued).hasSize(2);
        while (!queued.isEmpty()) queued.remove().run();
        verify(delivery,times(2)).deliverPasswordReset(eq(owner.id()),eq(owner.email()),anyString());
        for (int i=0;i<3;i++) request("unmatched-"+i+"@example.test",IP).andExpect(status().isAccepted());
        request("unmatched-limit@example.test",IP).andExpect(status().isTooManyRequests());
        assertThat(queued).hasSize(3);
        mvc.perform(post(PATH+"/request").contentType("application/json")
            .content("{\"email\":\"test@example.test\"}")).andExpect(status().isForbidden());
        time=time.plus(Duration.ofMinutes(10));
        request(owner.email(),IP).andExpect(status().isAccepted());
        for (int i=0;i<3;i++) request("invalid-email",IP).andExpect(status().isBadRequest());
        request("another-unknown@example.test",IP).andExpect(status().isTooManyRequests())
            .andExpect(header().string("Retry-After","600"));
        assertThat(queued).hasSize(4);
    }

    @Test
    void deliveryFailurePreservesThePreviousLinkAndLeavesTheRequestResponseNeutral() throws Exception {
        String first=issue(owner,IP);
        when(delivery.deliverPasswordReset(eq(owner.id()),eq(owner.email()),anyString()))
            .thenThrow(new FlowException(503,"DELIVERY_UNAVAILABLE","Delivery failed."));
        request(owner.email(),IP).andExpect(status().isAccepted()).andExpect(jsonPath("$.localDelivery").value(false));
        queued.remove().run();
        assertThat(storedHash(owner)).isEqualTo(RegistrationService.hash(first));
        mvc.perform(reset(first,NEW_PASSWORD,NEW_PASSWORD)).andExpect(status().isNoContent());
    }

    @Test
    void ownerGuardTechnicianAndUnverifiedApplicantKeepTheirRolesAndPermissions() throws Exception {
        UUID property=property();
        var guard=account("guard","APPLICANT",true);
        var technician=account("technician","APPLICANT",true);
        var applicant=account("applicant","APPLICANT",false);
        db.update("INSERT INTO property_guard_assignments(account_id,property_id,created_by,created_at) VALUES(?,?,?,?)",
            guard.id(),property,owner.id(),now());
        db.update("INSERT INTO maintenance_staff(account_id,property_id,created_by,created_at) VALUES(?,?,?,?)",
            technician.id(),property,owner.id(),now());
        UUID application=application(applicant,"AWAITING_EMAIL");

        var expected=List.of("OWNER","GUARD","TECHNICIAN","APPLICANT");
        var users=List.of(owner,guard,technician,applicant);
        var sessions=new ArrayList<MockHttpSession>();
        for (int i=0;i<users.size();i++) {
            var account=users.get(i);
            String token=issue(account,IP);
            mvc.perform(reset(token,NEW_PASSWORD,NEW_PASSWORD)).andExpect(status().isNoContent());
            var session=login(account,NEW_PASSWORD);
            sessions.add(session);
            mvc.perform(get("/api/account").session(session)).andExpect(status().isOk()).andExpect(jsonPath("$.role").value(expected.get(i)));
        }
        mvc.perform(get("/api/owner/properties").session(sessions.get(0))).andExpect(status().isOk());
        mvc.perform(get("/api/logbook/properties").session(sessions.get(1))).andExpect(status().isOk());
        mvc.perform(get("/api/maintenance/tickets").session(sessions.get(2))).andExpect(status().isOk());
        mvc.perform(get("/api/account/admissions").session(sessions.get(3))).andExpect(status().isOk());
        mvc.perform(get("/api/resident/bills").session(sessions.get(3))).andExpect(status().isForbidden());
        assertThat(db.queryForObject("SELECT status FROM registration_applications WHERE id=?",String.class,application)).isEqualTo("AWAITING_EMAIL");
        assertThat(db.queryForObject("SELECT email_verified FROM accounts WHERE id=?",Boolean.class,applicant.id())).isFalse();
    }

    @Test
    void simultaneousSubmissionsOnlyResetThePasswordOnce() throws Exception {
        String token=issue(owner,IP);
        var start=new CyclicBarrier(2);
        try (var threads=Executors.newFixedThreadPool(2)) {
            var first=threads.submit(()->completeTogether(start,token));
            var second=threads.submit(()->completeTogether(start,token));
            assertThat(List.of(first.get(15,TimeUnit.SECONDS),second.get(15,TimeUnit.SECONDS)))
                .containsExactlyInAnyOrder("updated","PASSWORD_RESET_UNAVAILABLE");
        }
        assertThat(db.queryForObject("SELECT credential_version FROM accounts WHERE id=?",Long.class,owner.id())).isEqualTo(1L);
        assertThat(storedHash(owner)).isNull();
    }

    private String completeTogether(CyclicBarrier start,String token) throws Exception {
        start.await(10,TimeUnit.SECONDS);
        try { recovery.complete(token,NEW_PASSWORD,NEW_PASSWORD); return "updated"; }
        catch (FlowException error) { return error.code; }
    }

    private ResultActions request(String email,String ip) throws Exception {
        return mvc.perform(post(PATH+"/request").with(csrf()).with(request->{ request.setRemoteAddr(ip); return request; })
            .contentType("application/json").content("{\"email\":\""+email+"\"}"));
    }

    private String issue(Identity account,String ip) throws Exception {
        request(account.email(),ip).andExpect(status().isAccepted());
        queued.remove().run();
        return delivered.get(account.email());
    }

    private String storedHash(Identity account) {
        return db.queryForList("SELECT token_hash FROM account_password_resets WHERE account_id=?",String.class,account.id()).stream().findFirst().orElse(null);
    }

    private MockHttpServletRequestBuilder reset(String token,String password,String confirmation) {
        return post(PATH+"/complete").with(csrf()).contentType("application/json")
            .content("""
                {"token":"%s","password":"%s","confirmation":"%s"}
                """.formatted(token,password,confirmation));
    }

    private MockHttpServletRequestBuilder signIn(Identity account,String password) {
        return post("/api/auth/login").with(csrf()).param("username",account.email()).param("password",password);
    }

    private MockHttpSession login(Identity account,String password) throws Exception {
        return (MockHttpSession)mvc.perform(signIn(account,password)).andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private Identity activeResident() {
        var account=account("resident","APPLICANT",true);
        property();
        UUID application=application(account,"APPROVED");
        room=UUID.randomUUID();
        reservation=UUID.randomUUID();
        stay=UUID.randomUUID();
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,'Room 1',1)",room,property);
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner.id(),now());
        db.update("""
            INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by)
            VALUES(?,?,?,?,?,'ACTIVE',?,?)
            """,stay,reservation,application,account.id(),room,now(),owner.id());
        return account;
    }

    private UUID property() {
        property=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,'Reset test property')",property,owner.id());
        return property;
    }

    private UUID application(Identity account,String status) {
        UUID id=UUID.randomUUID();
        db.update("""
            INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at)
            VALUES(?,?,?,'Test applicant','',?,?)
            """,id,account.id(),property,status,now());
        applications.add(id);
        return id;
    }

    private Identity account(String name,String role,boolean verified) {
        UUID id=UUID.randomUUID();
        String email=name+"-"+id+"@example.test";
        db.update("""
            INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at)
            VALUES(?,?,?,?,'',?,?,?)
            """,id,email,initialHash,name,role,verified,now());
        var identity=new Identity(id,email);
        accounts.add(identity);
        return identity;
    }

    private OffsetDateTime now() { return time.atOffset(ZoneOffset.UTC); }
}
