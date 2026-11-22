package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.OffsetDateTime;
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
class OnboardingTests {
    @Autowired OnboardingService flow;
    @Autowired MonthlyBillController bills;
    @Autowired RoomAgreementService agreements;
    @Autowired RegistrationService identities;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired MockMvc mvc;
    @MockitoBean VerificationDelivery delivery;
    UUID owner,property,room;
    final String password="Test-only-long-password42";
    final String ownerEmail="owner@onboarding.test", residentEmail="resident@onboarding.test";
    final AtomicReference<String> verification=new AtomicReference<>(), activation=new AtomicReference<>();
    @BeforeEach void setup() {
        String url=db.execute((java.sql.Connection c) -> c.getMetaData().getURL());
        assertThat(url).containsAnyOf("registration-tests","haruhay_registration_test");
        for(String table:List.of("registration_audit","monthly_bills","application_offers","room_charges","tenancy_activation_codes","email_verifications","tenancies","registration_applications","invitations","reservations","rooms","properties","accounts")) db.update("DELETE FROM "+table);
        owner=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,'OWNER',TRUE,?)",
            owner,ownerEmail,passwords.encode(password),"Owner","",OffsetDateTime.now());
        property=(UUID)flow.createProperty(ownerEmail,"Own property").get("id");
        room=(UUID)flow.createRoom(ownerEmail,property,"Private",1).get("id");
        when(delivery.deliver(any(),anyString(),anyString())).thenAnswer(a -> { verification.set(a.getArgument(2)); return "LOCAL_FILE"; });
        when(delivery.deliverApproval(any(),anyString(),anyString(),anyString())).thenReturn("LOCAL_FILE");
    }
    UUID signup(String email) { UUID app=(UUID)flow.signup(email,"Real applicant","09171234567",password,property,null).get("applicationId"); db.update("UPDATE rooms SET monthly_rent=2500 WHERE id=?",room);var r=agreements.ownerRooms(ownerEmail).getFirst();agreements.initial(app,r,(UUID)db.queryForMap("SELECT account_id FROM registration_applications WHERE id=?",app).get("account_id"));return app; }
    UUID verifiedSignup(String email) { UUID id=signup(email); identities.verify(verification.get()); return id; }
    int count(String table) { return db.queryForObject("SELECT count(*) FROM "+table,Integer.class); }
    void fails(String code,Runnable action) { assertThatThrownBy(action::run).isInstanceOfSatisfying(FlowException.class,e -> assertThat(e.code).isEqualTo(code)); }

    @Test void oneEmailVerificationThenOwnerApprovalImmediatelyStartsTenancy() throws Exception {
        UUID app=signup(residentEmail);
        assertThat(count("tenancies")).isZero(); assertThat(count("reservations")).isZero();
        fails("APPLICATION_STATE",() -> flow.approve(ownerEmail,app,room,"Review"));
        identities.verify(verification.get());
        var result=flow.approve(ownerEmail,app,room,"Agreement checked");
        assertThat(result).containsEntry("status","APPROVED").containsEntry("delivery","LOCAL_FILE").doesNotContainKeys("code","token","link");
        assertThat(flow.mine(residentEmail).getFirst()).containsEntry("status","APPROVED").containsEntry("reservation_status","CONVERTED");
        assertThat(count("tenancies")).isEqualTo(1); assertThat(count("tenancy_activation_codes")).isZero();
        mvc.perform(get("/api/resident/tenancies").with(user(residentEmail).roles("APPLICANT"))).andExpect(status().isOk());
        flow.approve(ownerEmail,app,room,"Retry"); assertThat(count("tenancies")).isEqualTo(1);
        verify(delivery,times(1)).deliver(any(),anyString(),anyString());
        verify(delivery,times(1)).deliverApproval(any(),eq(residentEmail),anyString(),anyString());
    }

    @Test void correctionsAndRejectionRemainAvailableBeforeApproval() {
        UUID app=verifiedSignup(residentEmail);
        flow.review(ownerEmail,app,"corrections","Correct contact"); flow.correct(residentEmail,app,"Corrected name","09991234567");
        flow.review(ownerEmail,app,"reject","Agreement declined");
        assertThat(flow.mine(residentEmail).getFirst()).containsEntry("status","REJECTED").containsEntry("reservation_status",null);
        assertThat(count("tenancies")).isZero();
        UUID second=verifiedSignup("second@onboarding.test"); flow.approve(ownerEmail,second,room,"Approved");
        fails("APPLICATION_STATE",() -> flow.review(ownerEmail,second,"reject","Cannot reject active tenancy"));
        assertThat(count("tenancies")).isEqualTo(1);
    }

    @Test void migrationCompletesPreviouslyApprovedApplicationsWithoutAnotherCode() {
        UUID app=verifiedSignup(residentEmail); flow.approve(ownerEmail,app,room,"Already approved");
        db.update("DELETE FROM tenancies"); db.update("UPDATE reservations SET status='HELD'");
        db.update("UPDATE registration_applications SET status='PENDING_APPROVAL',activation_pending=TRUE WHERE id=?",app);
        var context=mock(org.flywaydb.core.api.migration.Context.class);
        for(int n=0;n<2;n++) db.execute((java.sql.Connection c) -> {
            when(context.getConnection()).thenReturn(c);
            try { new db.migration.V3__owner_approval_starts_tenancy().migrate(context); } catch(Exception e) { throw new RuntimeException(e); }
            return true;
        });
        assertThat(count("tenancies")).isEqualTo(1);
        assertThat(flow.mine(residentEmail).getFirst()).containsEntry("status","APPROVED").containsEntry("reservation_status","CONVERTED");
    }

    @Test void approvalNotificationFailureDoesNotUndoApproval() {
        UUID app=verifiedSignup(residentEmail);
        when(delivery.deliverApproval(any(),anyString(),anyString(),anyString())).thenThrow(new FlowException(503,"DELIVERY_UNAVAILABLE","Mail unavailable"));
        assertThat(flow.approve(ownerEmail,app,room,"Approve")).containsEntry("status","APPROVED").containsEntry("delivery","FAILED");
        assertThat(count("tenancies")).isEqualTo(1);
    }

    @Test void duplicateAccountsPropertyOwnershipAndApplicantIsolation() throws Exception {
        UUID app=verifiedSignup(residentEmail);
        fails("ACCOUNT_EXISTS",() -> signup(residentEmail));
        fails("APPLICATION_EXISTS",() -> flow.signup(residentEmail,"Resident","0999",null,property,residentEmail));
        UUID stranger=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,'OWNER',TRUE,?)",
            stranger,"stranger@onboarding.test",passwords.encode(password),"Stranger","",OffsetDateTime.now());
        fails("NOT_FOUND",() -> flow.approve("stranger@onboarding.test",app,room,"Unauthorized"));
        assertThat(flow.pending("stranger@onboarding.test")).isEmpty();
        fails("NOT_FOUND",() -> flow.activate("stranger@onboarding.test",app,"GUESS"));
        mvc.perform(get("/api/owner/admissions").with(user(residentEmail).roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(post("/api/account/admissions/"+app+"/activate").with(user(residentEmail).roles("APPLICANT"))
            .contentType("application/json").content("{\"code\":\"GUESS\"}")).andExpect(status().isForbidden());
        mvc.perform(get("/api/account/admissions")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/owner/applications/"+app+"/approve").with(csrf()).with(user(ownerEmail).roles("OWNER"))
            .contentType("application/json").content("{\"reason\":\"Old API cannot bypass activation\"}")).andExpect(status().isGone());
    }
    @Test void concurrentApprovalsCannotReserveTheLastPlaceTwice() throws Exception {
        UUID first=verifiedSignup(residentEmail),second=verifiedSignup("second@onboarding.test");
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch gate=new CountDownLatch(1);
        try {
            var a=pool.submit(() -> { gate.await(); try { flow.approve(ownerEmail,first,room,"Approve"); return "OK"; } catch(FlowException e) { return e.code; } });
            var b=pool.submit(() -> { gate.await(); try { flow.approve(ownerEmail,second,room,"Approve"); return "OK"; } catch(FlowException e) { return e.code; } });
            gate.countDown();
            assertThat(List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder("OK","ROOM_FULL");
            assertThat(count("reservations")).isEqualTo(1); assertThat(count("tenancies")).isEqualTo(1);
        } finally { pool.shutdownNow(); }
    }
    @Test void simultaneousActivationCreatesOneTenancy() throws Exception {
        UUID app=verifiedSignup(residentEmail); flow.approve(ownerEmail,app,room,"Approve"); String code=activation.get();
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch gate=new CountDownLatch(1);
        try {
            Callable<?> task=() -> { gate.await(); return flow.approve(ownerEmail,app,room,"Repeated concurrent approval"); };
            var a=pool.submit(task); var b=pool.submit(task); gate.countDown(); a.get(20,TimeUnit.SECONDS); b.get(20,TimeUnit.SECONDS);
            assertThat(count("tenancies")).isEqualTo(1);
            assertThat(identities.rooms(ownerEmail).getFirst()).containsEntry("held",0L).containsEntry("active",1L);
        } finally { pool.shutdownNow(); }
    }
    @Test void existingVerifiedAccountCanApplyToAnotherPropertyWithoutDuplicateIdentity() {
        verifiedSignup(residentEmail);
        UUID another=(UUID)flow.createProperty(ownerEmail,"Another property").get("id");
        var result=flow.signup(residentEmail,"Existing resident","0999",null,another,residentEmail);
        assertThat(result).containsEntry("delivery","NOT_REQUIRED").containsEntry("status","PENDING_APPROVAL");
        assertThat(count("accounts")).isEqualTo(2);
        assertThat(flow.mine(residentEmail)).hasSize(2);
        assertThat(count("reservations")).isZero();
    }
    @Test void localBootstrapCreatesOnlyConfiguredOwnerAndNoDummyInventory() {
        int beforeAccounts=count("accounts"), beforeProperties=count("properties"), beforeRooms=count("rooms");
        new DevelopmentSeed(db,passwords,"","","",false).run();
        assertThat(count("accounts")).isEqualTo(beforeAccounts);
        new DevelopmentSeed(db,passwords,"configured-owner@onboarding.test",password,"Configured Owner",false).run();
        assertThat(count("accounts")).isEqualTo(beforeAccounts+1);
        assertThat(count("properties")).isEqualTo(beforeProperties);
        assertThat(count("rooms")).isEqualTo(beforeRooms);
        assertThat(count("registration_applications")).isZero();
    }

    @Test void snapshotsAndRevisedOffersRequireCurrentConsent() {
        UUID app=verifiedSignup(residentEmail);
        var initial=agreements.offers(app).getFirst();
        db.update("UPDATE rooms SET monthly_rent=3000,terms_version=terms_version+1 WHERE id=?",room);
        fails("ROOM_CHANGED",()->flow.approve(ownerEmail,app,room,"Stale price"));
        var first=agreements.propose(ownerEmail,app,room,2,null,"Revised rent");
        var second=agreements.propose(ownerEmail,app,room,2,null,"Latest offer");
        fails("OFFER_SUPERSEDED",()->agreements.accept(residentEmail,app,(UUID)first.get("offerId")));
        fails("OFFER_NOT_ACCEPTED",()->flow.approve(ownerEmail,app,room,"No consent"));
        agreements.accept(residentEmail,app,(UUID)second.get("offerId"));
        assertThat(count("tenancies")).isZero();
        flow.approve(ownerEmail,app,room,"Accepted final terms");
        assertThat(count("tenancies")).isEqualTo(1);
        assertThat(initial.get("terms").toString()).contains("2500");
    }
    @Test void publishedSignupNeedsExactRoomConsentAndReservesNothing() {
        db.update("UPDATE rooms SET published=TRUE,accepting_applications=TRUE,monthly_rent=2500,security_deposit=2500,advance_months=1 WHERE id=?",room);
        assertThat(agreements.publicRooms(property)).hasSize(1);
        fails("ROOM_CHANGED",()->agreements.signup(flow,new OnboardingController.Signup(residentEmail,"Resident","0999",password,property,room,99L,true),null));
        assertThat(count("registration_applications")).isZero();
        var result=agreements.signup(flow,new OnboardingController.Signup(residentEmail,"Resident","0999",password,property,room,1L,true),null);
        assertThat(count("reservations")).isZero();assertThat(count("application_offers")).isEqualTo(1);
        identities.verify(verification.get());flow.approve(ownerEmail,(UUID)result.get("applicationId"),room,"Confirmed");
        assertThat(agreements.publicRooms(property).getFirst()).containsEntry("available",0);
        assertThat(agreements.publicRooms(property).getFirst()).doesNotContainKeys("email","owner_id","active","held");
    }
    @Test void unpublishedRoomsAndSharedRoomQuotesAreNotInvented() {
        assertThat(agreements.publicRooms(property)).isEmpty();
        fails("ROOM_UNAVAILABLE",()->agreements.lockForApplication(room,property,1));
        db.update("UPDATE rooms SET room_type='SHARED',capacity=2,pricing_basis='PER_ROOM',monthly_rent=6000 WHERE id=?",room);
        var snapshot=agreements.snapshot(agreements.ownerRooms(ownerEmail).getFirst(),null);
        assertThat(snapshot.get("applicant_monthly_rent")).isNull();assertThat(snapshot.get("estimate_incomplete")).isEqualTo(true);
    }

    @Test void approvalCannotSubstituteAnotherRoomForTheAcceptedRoom() {
        UUID app=verifiedSignup(residentEmail);
        UUID other=(UUID)flow.createRoom(ownerEmail,property,"Other room",1).get("id");
        fails("OFFER_NOT_ACCEPTED",()->flow.approve(ownerEmail,app,other,"Substitute"));
        assertThat(count("tenancies")).isZero();
        flow.approve(ownerEmail,app,room,"Accepted room only");assertThat(count("tenancies")).isEqualTo(1);
    }
    @Test void monthlyBillUsesAcceptedAmountsAndStaysScopedAndIdempotent() throws Exception {
        db.update("INSERT INTO room_charges(id,room_id,name,basis,amount,notes,position) VALUES(?,?,?,'FIXED_MONTHLY',125,'',0)",UUID.randomUUID(),room,"Internet");
        db.update("INSERT INTO room_charges(id,room_id,name,basis,amount,notes,position) VALUES(?,?,?,'USAGE_BASED',NULL,'Metered monthly',1)",UUID.randomUUID(),room,"Electricity");
        UUID app=verifiedSignup(residentEmail);flow.approve(ownerEmail,app,room,"Accepted");
        var request=new MonthlyBillController.PostBill(app,"2026-11",java.time.LocalDate.of(2026,11,20));
        var bill=bills.post(()->ownerEmail,request);
        assertThat(bill.get("rent").toString()).startsWith("2500");assertThat(bill.get("fixed_charges").toString()).startsWith("125");
        assertThat(bills.resident(()->residentEmail)).hasSize(1);assertThat(bills.resident(()->"another@example.test")).isEmpty();
        db.update("UPDATE rooms SET monthly_rent=4000,terms_version=terms_version+1 WHERE id=?",room);
        var retry=bills.post(()->ownerEmail,new MonthlyBillController.PostBill(app,"2026-11",java.time.LocalDate.of(2026,11,25)));
        assertThat(retry.get("id")).isEqualTo(bill.get("id"));assertThat(count("monthly_bills")).isEqualTo(1);
        assertThat(retry.get("due_date")).isEqualTo(request.dueDate());
        fails("BILL_DATE",()->bills.post(()->ownerEmail,new MonthlyBillController.PostBill(app,"2026-12",java.time.LocalDate.of(2026,11,25))));
        mvc.perform(post("/api/owner/bills").with(user(residentEmail).roles("APPLICANT")).with(csrf()).contentType("application/json").content("{}" )).andExpect(status().isForbidden());
        fails("NOT_FOUND",()->bills.post(()->residentEmail,request));
    }
    @Test void concurrentPostingOfTheSameMonthCreatesOneBill() throws Exception {
        UUID app=verifiedSignup(residentEmail);flow.approve(ownerEmail,app,room,"Confirmed");
        var request=new MonthlyBillController.PostBill(app,"2026-11",java.time.LocalDate.of(2026,11,20));
        var executor=Executors.newFixedThreadPool(2);
        try{var first=executor.submit(()->bills.post(()->ownerEmail,request));var second=executor.submit(()->bills.post(()->ownerEmail,request));assertThat(first.get(15,TimeUnit.SECONDS).get("id")).isEqualTo(second.get(15,TimeUnit.SECONDS).get("id"));}
        finally{executor.shutdownNow();}
        assertThat(count("monthly_bills")).isEqualTo(1);
    }
}
