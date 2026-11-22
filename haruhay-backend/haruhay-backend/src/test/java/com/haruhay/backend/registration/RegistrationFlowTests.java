package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RegistrationFlowTests {
    @Autowired RegistrationService flow;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired MockMvc mvc;
    @MockitoBean VerificationDelivery delivery;
    UUID owner,otherOwner,property,room;
    AtomicReference<String> verification=new AtomicReference<>();
    final String email="resident@example.test";
    final String password="Local-test-password42";

    @BeforeEach void setup() {
        String url=db.execute((java.sql.Connection c) -> c.getMetaData().getURL());
        assertThat(url).containsAnyOf("registration-tests","haruhay_registration_test");
        for (String table: List.of("registration_audit","monthly_bills","application_offers","room_charges","tenancy_activation_codes","email_verifications","tenancies","registration_applications","invitations","reservations","rooms","properties","accounts"))
            db.update("DELETE FROM "+table);
        owner=seedUser("owner@example.test","OWNER",true);
        otherOwner=seedUser("other-owner@example.test","OWNER",true);
        property=UUID.randomUUID(); room=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name,sample) VALUES(?,?,?,TRUE)",property,owner,"Test property");
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",room,property,"Private");
        when(delivery.deliver(any(),anyString(),anyString())).thenAnswer(call -> { verification.set(call.getArgument(2)); return "LOCAL_FILE"; });
    }
    UUID seedUser(String email,String role,boolean verified) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,?,?,?)",
            id,email,passwords.encode(password),"Test Person","09171234567",role,verified,OffsetDateTime.now());
        return id;
    }
    Map<String,Object> invite() { return flow.createInvitation("owner@example.test",property,room,email); }
    UUID invitationId(Map<String,Object> issued) { return (UUID)issued.get("id"); }
    String raw(Map<String,Object> issued) { return (String)issued.get("token"); }
    UUID claim(Map<String,Object> issued) {
        return (UUID)flow.claim(raw(issued),email,"Resident","09171234567",password,null).get("applicationId");
    }
    String reservationStatus() { return db.queryForObject("SELECT status FROM reservations WHERE room_id=?",String.class,room); }
    int count(String table) { return db.queryForObject("SELECT count(*) FROM "+table,Integer.class); }
    void fails(String code,Runnable action) { assertThatThrownBy(action::run).isInstanceOfSatisfying(FlowException.class,e -> assertThat(e.code).isEqualTo(code)); }

    @Test void registrationVerificationApprovalAndIdempotency() {
        var i=invite(); assertThat(reservationStatus()).isEqualTo("HELD");
        assertThat(flow.inspect(raw(i))).containsEntry("capacity",1);
        UUID app=claim(i);
        assertThat(flow.myApplications(email).getFirst()).containsEntry("status","AWAITING_EMAIL");
        fails("APPLICATION_STATE",() -> flow.review("owner@example.test",app,"approve","Welcome"));
        fails("APPROVAL_REQUIRED",() -> flow.tenancies(email));
        flow.verify(verification.get());
        assertThat(flow.myApplications(email).getFirst()).containsEntry("status","PENDING_APPROVAL");
        flow.review("owner@example.test",app,"approve","Welcome");
        flow.review("owner@example.test",app,"approve","Repeated request");
        assertThat(count("tenancies")).isEqualTo(1);
        assertThat(reservationStatus()).isEqualTo("CONVERTED");
        assertThat(flow.rooms("owner@example.test").getFirst()).containsEntry("held",0L).containsEntry("active",1L);
        assertThat(flow.tenancies(email)).hasSize(1);
        fails("ROOM_FULL",this::invite);
        assertThat(db.queryForObject("SELECT token_hash FROM invitations",String.class)).isEqualTo(RegistrationService.hash(raw(i))).doesNotContain(raw(i));
        assertThat(passwords.matches(password,db.queryForObject("SELECT password_hash FROM accounts WHERE email=?",String.class,email))).isTrue();
        assertThat(flow.applications("owner@example.test").toString()).doesNotContain("password");
        fails("CLAIMED",() -> flow.inspect(raw(i)));
    }
    @Test void correctionRejectionAndExplicitRelease() {
        var i=invite(); UUID app=claim(i); flow.verify(verification.get());
        flow.review("owner@example.test",app,"corrections","Please correct contact");
        assertThat(reservationStatus()).isEqualTo("HELD");
        flow.correct(email,app,"Corrected Person","09991234567");
        assertThat(flow.myApplications(email).getFirst()).containsEntry("status","PENDING_APPROVAL").containsEntry("full_name","Corrected Person");
        flow.review("owner@example.test",app,"reject","Agreement declined");
        assertThat(flow.applications("owner@example.test").getFirst()).containsEntry("status","REJECTED").containsEntry("reservation_status","HELD");
        fails("ROOM_FULL",this::invite);
        flow.invitationAction("owner@example.test",invitationId(i),"cancel","Release rejected applicant hold");
        assertThat(reservationStatus()).isEqualTo("RELEASED");
        assertThat(flow.myApplications(email).getFirst()).containsEntry("status","CANCELLED");
        assertThat(count("tenancies")).isZero();
        assertThat(flow.history("owner@example.test",invitationId(i)).stream().map(e -> e.get("event"))).contains("RESERVATION_RELEASED","APPLICATION_REJECTED");
        invite();
        assertThat(count("reservations")).isEqualTo(2);
    }
    @Test void expiryReplacementRevocationNeverReleaseReservation() {
        var i=invite();
        db.update("UPDATE invitations SET token_expires_at=?",OffsetDateTime.now().minusDays(1));
        fails("EXPIRED",() -> flow.inspect(raw(i)));
        fails("EXPIRED",() -> claim(i));
        assertThat(reservationStatus()).isEqualTo("HELD");
        var replacement=flow.invitationAction("owner@example.test",invitationId(i),"replace","Expired token");
        assertThat(count("reservations")).isEqualTo(1);
        fails("INVALID",() -> flow.inspect(raw(i)));
        flow.inspect(raw(replacement));
        flow.invitationAction("owner@example.test",invitationId(i),"revoke","Wrong recipient");
        fails("REVOKED",() -> flow.inspect(raw(replacement)));
        assertThat(reservationStatus()).isEqualTo("HELD");
        flow.invitationAction("owner@example.test",invitationId(i),"cancel","Owner explicitly releases");
        fails("CANCELLED",() -> flow.inspect(raw(replacement)));
        assertThat(reservationStatus()).isEqualTo("RELEASED");
    }
    @Test void existingAccountMustAuthenticateAndNoDuplicateAccountCreated() {
        seedUser(email,"APPLICANT",true); var i=invite();
        fails("ACCOUNT_EXISTS",() -> claim(i));
        fails("EMAIL_MISMATCH",() -> flow.claim(raw(i),"wrong@example.test","Person","0999",password,null));
        fails("EMAIL_MISMATCH",() -> flow.claim(raw(i),email,"Person","0999",null,"other-owner@example.test"));
        var accepted=flow.claim(raw(i),email,"Existing Person","0999",null,email);
        assertThat(accepted).containsEntry("status","PENDING_APPROVAL").containsEntry("delivery","NOT_REQUIRED");
        assertThat(count("accounts")).isEqualTo(3);
        assertThat(count("registration_applications")).isEqualTo(1);
        fails("CLAIMED",() -> flow.claim(raw(i),email,"Again","0999",null,email));
    }
    @Test void deliveryFailureRollsBackClaimAndAccount() {
        var i=invite();
        when(delivery.deliver(any(),anyString(),anyString())).thenThrow(new FlowException(503,"DELIVERY_UNAVAILABLE","Unavailable"));
        fails("DELIVERY_UNAVAILABLE",() -> claim(i));
        assertThat(count("registration_applications")).isZero();
        assertThat(count("accounts")).isEqualTo(2);
        assertThat(reservationStatus()).isEqualTo("HELD");
        flow.inspect(raw(i));
    }
    @Test void expiredEmailVerificationCanBeReplacedWithoutNewReservation() {
        var i=invite(); claim(i); String old=verification.get();
        db.update("UPDATE email_verifications SET expires_at=?",OffsetDateTime.now().minusDays(1));
        fails("EXPIRED_VERIFICATION",() -> flow.verify(old));
        flow.resend(email); assertThat(verification.get()).isNotEqualTo(old);
        fails("NOT_FOUND",() -> flow.verify(old));
        flow.verify(verification.get());
        assertThat(count("reservations")).isEqualTo(1);
    }
    @Test void ownerPropertyAndApplicantIsolation() throws Exception {
        var i=invite(); UUID app=claim(i);
        assertThat(flow.applications("other-owner@example.test")).isEmpty();
        fails("NOT_FOUND",() -> flow.review("other-owner@example.test",app,"approve","Unauthorized"));
        fails("NOT_FOUND",() -> flow.invitationAction("other-owner@example.test",invitationId(i),"cancel","Unauthorized"));
        fails("NOT_FOUND",() -> flow.createInvitation("other-owner@example.test",property,room,"bad@example.test"));
        mvc.perform(get("/api/owner/rooms")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/owner/applications").with(user(email).roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/resident/tenancies").with(user(email).roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/account/applications").with(user("other-owner@example.test").roles("OWNER"))).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post("/api/owner/invitations").with(user("owner@example.test").roles("OWNER"))
            .contentType("application/json").content("{}")).andExpect(status().isForbidden()); // CSRF is required.
        mvc.perform(post("/api/owner/invitations").with(csrf()).with(user("owner@example.test").roles("OWNER"))
            .contentType("application/json").content("{}")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").with(csrf()).param("username",email).param("password",password)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/login").with(csrf()).param("username",email).param("password","wrong")).andExpect(status().isUnauthorized());
    }
    @Test void simultaneousLastSlotReservationsOnlyOneSucceeds() throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch gate=new CountDownLatch(1);
        try {
            Callable<String> task=() -> { gate.await(); try { invite(); return "CREATED"; } catch(FlowException e) { return e.code; } };
            Future<String> first=pool.submit(task), second=pool.submit(task); gate.countDown();
            assertThat(List.of(first.get(20,TimeUnit.SECONDS),second.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder("CREATED","ROOM_FULL");
            assertThat(count("reservations")).isEqualTo(1);
        } finally { pool.shutdownNow(); }
    }
    @Test void sharedRoomSupportsMultipleSlotsAndClaimIsAtomic() throws Exception {
        db.update("UPDATE rooms SET capacity=2 WHERE id=?",room);
        var i=invite(); flow.createInvitation("owner@example.test",property,room,"second@example.test");
        fails("ROOM_FULL",this::invite);
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch gate=new CountDownLatch(1);
        try {
            Callable<String> task=() -> { gate.await(); try { claim(i); return "CLAIMED_OK"; } catch(FlowException e) { return e.code; } };
            Future<String> first=pool.submit(task),second=pool.submit(task); gate.countDown();
            assertThat(List.of(first.get(20,TimeUnit.SECONDS),second.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder("CLAIMED_OK","CLAIMED");
            assertThat(count("registration_applications")).isEqualTo(1);
        } finally { pool.shutdownNow(); }
    }
    @Test void limiterRejectsExcessGuessesAndRecoversAfterWindow() {
        Instant start=Instant.parse("2026-01-01T00:00:00Z");
        Clock clock=mock(Clock.class); when(clock.millis()).thenReturn(start.toEpochMilli());
        AttemptLimiter limiter=new AttemptLimiter(2,clock);
        assertThat(limiter.allow("client")).isTrue(); assertThat(limiter.allow("client")).isTrue();
        assertThat(limiter.allow("client")).isFalse(); assertThat(limiter.allow("another")).isTrue();
        when(clock.millis()).thenReturn(start.plusSeconds(601).toEpochMilli()); assertThat(limiter.allow("client")).isTrue();
    }
    @Test void concurrentApprovalsCreateExactlyOneTenancy() throws Exception {
        var invitation=invite(); UUID app=claim(invitation); flow.verify(verification.get());
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch gate=new CountDownLatch(1);
        try {
            Callable<Map<String,Object>> task=() -> { gate.await(); return flow.review("owner@example.test",app,"approve","Concurrent approval"); };
            var first=pool.submit(task); var second=pool.submit(task); gate.countDown();
            first.get(20,TimeUnit.SECONDS); second.get(20,TimeUnit.SECONDS);
            assertThat(count("tenancies")).isEqualTo(1);
            assertThat(reservationStatus()).isEqualTo("CONVERTED");
            assertThat(flow.rooms("owner@example.test").getFirst()).containsEntry("held",0L).containsEntry("active",1L);
        } finally { pool.shutdownNow(); }
    }
    @Test void approvalRacingReleasePreservesOccupancyInvariant() throws Exception {
        var invitation=invite(); UUID app=claim(invitation); flow.verify(verification.get());
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch gate=new CountDownLatch(1);
        try {
            Future<?> first=pool.submit(() -> { try { gate.await(); flow.review("owner@example.test",app,"approve","Approve"); } catch(FlowException expected) { assertThat(expected.code).isEqualTo("APPLICATION_STATE"); } catch(InterruptedException e) { throw new RuntimeException(e); } });
            Future<?> second=pool.submit(() -> { try { gate.await(); flow.invitationAction("owner@example.test",invitationId(invitation),"cancel","Explicit release"); } catch(FlowException expected) { assertThat(expected.code).isEqualTo("NOT_HELD"); } catch(InterruptedException e) { throw new RuntimeException(e); } });
            gate.countDown(); first.get(20,TimeUnit.SECONDS); second.get(20,TimeUnit.SECONDS);
            if (count("tenancies")==1) assertThat(reservationStatus()).isEqualTo("CONVERTED");
            else { assertThat(reservationStatus()).isEqualTo("RELEASED"); assertThat(flow.myApplications(email).getFirst()).containsEntry("status","CANCELLED"); }
        } finally { pool.shutdownNow(); }
    }
}
