package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.payment.PaymentService;
import com.haruhay.backend.holding.HoldingStationController;
import com.haruhay.backend.holding.HoldingStationService;
import com.haruhay.backend.maintenance.MaintenanceService;
import com.haruhay.backend.visitor.VisitorService;
import java.math.BigDecimal;
import java.security.Principal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TenancyManagementTests {
    private static final String OWNER="tenancy-owner@example.test", OTHER_OWNER="another-owner@example.test";
    private static final String RESIDENT="tenancy-resident@example.test", OTHER="another-resident@example.test";
    private static final String PASSWORD="Test-only-tenancy-password42";
    private static final Principal OWNER_PRINCIPAL=()->OWNER;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired PasswordEncoder passwords;
    @Autowired OnboardingService onboarding;
    @Autowired RoomAgreementService agreements;
    @Autowired TenancyService tenancies;
    @Autowired VisitorService visitors;
    @Autowired MonthlyBillController bills;
    @Autowired PaymentService payments;
    @Autowired HoldingStationService holding;
    @Autowired MaintenanceService maintenance;
    @MockitoBean VerificationDelivery mail;
    private final AtomicReference<String> emailLink=new AtomicReference<>();
    private UUID property, source;
    private Stay stay;

    private record Stay(UUID application, UUID tenancy) {}

    @BeforeEach void prepare() {
        clear();
        when(mail.deliverApproval(any(),anyString(),anyString(),anyString())).thenReturn("LOCAL_FILE");
        when(mail.deliverEmailChange(any(),anyString(),anyString())).thenAnswer(args -> {
            emailLink.set(args.getArgument(2));
            return "LOCAL_FILE";
        });
        account(OWNER,"OWNER");
        account(OTHER_OWNER,"OWNER");
        account(RESIDENT,"APPLICANT");
        account(OTHER,"APPLICANT");
        property=(UUID)onboarding.createProperty(OWNER,"Test property").get("id");
        source=room(property,"Original",2500);
        stay=start(RESIDENT,property,source);
    }

    @AfterEach void clear() {
        String url=db.execute((java.sql.Connection c)->c.getMetaData().getURL());
        assertThat(url).containsAnyOf("registration-tests","haruhay_registration_test");
        for (String table:List.of("maintenance_tickets","maintenance_staff","visitor_movements","visitor_audit",
            "visitor_qr_credentials","visitor_visits","visitor_requests","visitor_profiles","property_guard_assignments",
            "holding_item_transactions","holding_inquiries","holding_items","registration_audit","monthly_bills",
            "room_transfers","application_offers","room_charges","tenancy_activation_codes","email_verifications",
            "tenancies","registration_applications","invitations","reservations","rooms","properties","accounts"))
            db.update("DELETE FROM "+table);
    }

    private void account(String email,String role) {
        db.update("""
            INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at)
            VALUES(?,?,?,?,?,?,TRUE,?)
            """,UUID.randomUUID(),email,passwords.encode(PASSWORD),"Test account","09171234567",role,OffsetDateTime.now());
    }

    private UUID room(UUID property,String name,int rent) {
        UUID id=(UUID)onboarding.createRoom(OWNER,property,name,1).get("id");
        db.update("UPDATE rooms SET monthly_rent=?,published=TRUE,accepting_applications=TRUE WHERE id=?",rent,id);
        return id;
    }

    private Stay start(String email,UUID property,UUID room) {
        UUID app=(UUID)onboarding.signup(email,"Applicant at signup","09171234567",null,property,email).get("applicationId");
        var terms=agreements.ownerRooms(OWNER).stream().filter(r->room.equals(r.get("id"))).findFirst().orElseThrow();
        UUID resident=db.queryForObject("SELECT id FROM accounts WHERE email=?",UUID.class,email);
        agreements.initial(app,terms,resident);
        onboarding.approve(OWNER,app,room,"Approved test stay");
        return new Stay(app,db.queryForObject("SELECT id FROM tenancies WHERE application_id=?",UUID.class,app));
    }

    private UUID bill(String month) {
        return (UUID)bills.post(OWNER_PRINCIPAL,new MonthlyBillController.PostBill(stay.application(),month,LocalDate.parse(month+"-10"))).get("id");
    }

    private UUID report(UUID bill,String amount,String reference) {
        return payments.report(RESIDENT,new PaymentService.Report(bill,UUID.randomUUID(),null,new BigDecimal(amount),
            "GCASH",LocalDate.now(ZoneId.of("Asia/Manila")),reference));
    }

    private UUID visit() {
        UUID request=visitors.request(RESIDENT,new VisitorService.Request(stay.tenancy(),"Test guest",null,"Visiting",null,null));
        return visitors.review(OWNER,request,new VisitorService.Review("APPROVE",null));
    }

    private HoldingStationService.Item packageForStay() {
        return holding.create(OWNER,new HoldingStationController.CreateItem(stay.application(),"Parcel","Test parcel",
            "Courier","Courier / sender","TRACK-1","A-1"));
    }

    @Test void moveOutFreesCapacityKeepsBillingAndPermitsStaffCheckout() throws Exception {
        UUID bill=bill("2026-06");
        UUID deposit=report(bill,"1000","partial-move-out");
        payments.review(OWNER,deposit,"APPROVED",new PaymentService.Review(true,null,new BigDecimal("2500")));
        UUID inside=visit(), expected=visit();
        var parcel=packageForStay();
        UUID ticket=maintenance.report(RESIDENT,new MaintenanceService.Report(UUID.randomUUID(),stay.tenancy(),
            "PLUMBING","Test repair",false,null));
        var manualEntry=new VisitorService.Movement("ENTRY","MANUAL",null,true,"ID",null,"Verified at desk");
        assertThat(visitors.movement(OWNER,property,inside,manualEntry)).containsEntry("allowed",true);
        var pass=visitors.issue(RESIDENT,expected,new VisitorService.Pass(false));
        var summary=tenancies.summary(OWNER,stay.tenancy());
        assertThat(summary).containsEntry("open_bills",1).containsEntry("ready_passes",1).containsEntry("guests_inside",1);
        assertThat(summary).containsEntry("unclaimed_packages",1).containsEntry("open_repairs",1);
        assertThatThrownBy(()->tenancies.moveOut(OTHER_OWNER,stay.tenancy(),"Not my property")).isInstanceOf(FlowException.class);

        String route="/api/owner/tenancies/"+stay.tenancy()+"/move-out";
        mvc.perform(post(route).with(user(OWNER).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("{\"reason\":\"Confirmed departure\",\"confirmed\":false}")).andExpect(status().isBadRequest());
        mvc.perform(post(route).with(user(OWNER).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("{\"reason\":\"Confirmed departure\",\"confirmed\":true}")).andExpect(status().isOk());
        assertThat(tenancies.moveOut(OWNER,stay.tenancy(),"Retry reason")).containsEntry("end_reason","Confirmed departure");
        assertThat(db.queryForObject("SELECT count(*) FROM registration_audit WHERE event='TENANCY_ENDED' AND entity_id=?",Integer.class,stay.tenancy())).isOne();
        assertThat(agreements.publicRoom(source).get("available")).isEqualTo(1);
        assertThat(onboarding.mine(RESIDENT).getFirst()).containsEntry("tenancy_status","ENDED");
        assertThatThrownBy(()->bill("2026-07")).isInstanceOf(FlowException.class);
        assertThat(visitors.movement(OWNER,property,expected,manualEntry)).containsEntry("allowed",false);
        assertThatThrownBy(()->visitors.guestPass(new VisitorService.Scan(pass.shareToken()))).isInstanceOf(FlowException.class);
        assertThat(visitors.movement(OWNER,property,inside,new VisitorService.Movement("EXIT","MANUAL",null,false,null,null,"Guest returned to desk")))
            .containsEntry("allowed",true);
        assertThat(holding.search(OWNER,new HoldingStationController.SearchInquiry("Former resident","ID","1234",
            stay.application(),null,"Pick up item")).matches()).extracting(HoldingStationService.Item::id).containsExactly(parcel.id());
        assertThat(holding.release(OWNER,parcel.id(),new HoldingStationController.ReleaseItem("Former resident","Owner",
            "ID","1234",true,false,true)).status()).isEqualTo("Claimed");
        maintenance.comment(OWNER,ticket,new MaintenanceService.Note("Repair remains scheduled"));

        var resident=user(RESIDENT).roles("APPLICANT");
        mvc.perform(get("/api/resident/bills").with(resident)).andExpect(status().isOk()).andExpect(jsonPath("$[0].balance").value(1500));
        mvc.perform(get("/api/resident/payments/"+deposit+"/receipt").with(resident)).andExpect(status().isOk());
        mvc.perform(get("/api/resident/tenancies").with(resident)).andExpect(status().isForbidden());
        mvc.perform(get("/api/resident/transfers").with(resident)).andExpect(status().isForbidden());
        mvc.perform(get("/api/logbook/hosts").with(resident)).andExpect(status().isForbidden());
        mvc.perform(get("/api/maintenance/tickets").with(resident)).andExpect(status().isForbidden());
        UUID payment=report(bill,"1500","final-move-out");
        payments.review(OWNER,payment,"APPROVED",new PaymentService.Review(true,null,new BigDecimal("1500")));
        mvc.perform(get("/api/resident/payments/"+payment+"/receipt").with(resident)).andExpect(status().isOk());
        start(OTHER,property,source);
        assertThat(agreements.publicRoom(source).get("available")).isEqualTo(0);
        assertThat(onboarding.signup(RESIDENT,"Returning resident","09171234567",null,property,RESIDENT))
            .containsEntry("status","PENDING_APPROVAL");
    }

    @Test void moveOutLeavesAnotherActiveStayAvailable() throws Exception {
        UUID ticket=maintenance.report(RESIDENT,new MaintenanceService.Report(UUID.randomUUID(),stay.tenancy(),
            "PLUMBING","Repair before departure",false,null));
        UUID second=(UUID)onboarding.createProperty(OWNER,"Second property").get("id");
        Stay stillActive=start(RESIDENT,second,room(second,"Other stay",4000));
        tenancies.moveOut(OWNER,stay.tenancy(),"Ended first stay");
        mvc.perform(get("/api/resident/tenancies").with(user(RESIDENT).roles("APPLICANT")))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(stillActive.tenancy().toString()));
        assertThatThrownBy(()->maintenance.comment(RESIDENT,ticket,new MaintenanceService.Note("Closed stay")))
            .isInstanceOfSatisfying(FlowException.class,error->assertThat(error.code).isEqualTo("MAINTENANCE_STAY_ENDED"));
    }

    @Test void transferNeedsAcceptancePreservesEarlierBillAndUsesNewTerms() {
        UUID original=bill("2026-06"), guest=visit(), destination=room(property,"New room",3200);
        var parcel=packageForStay();
        UUID proposal=propose(stay,destination);
        assertThatThrownBy(()->tenancies.complete(OWNER,stay.tenancy(),proposal)).hasMessageContaining("must accept");
        assertThatThrownBy(()->tenancies.accept(OTHER,proposal)).isInstanceOf(FlowException.class);
        tenancies.accept(RESIDENT,proposal);
        var completed=tenancies.complete(OWNER,stay.tenancy(),proposal);
        UUID newTenancy=(UUID)completed.get("destination_tenancy_id");
        assertThat(tenancies.complete(OWNER,stay.tenancy(),proposal).get("destination_tenancy_id")).isEqualTo(newTenancy);
        assertThat(agreements.publicRoom(source).get("available")).isEqualTo(1);
        assertThat(agreements.publicRoom(destination).get("available")).isEqualTo(0);
        assertThat(onboarding.mine(RESIDENT).getFirst()).containsEntry("tenancy_id",newTenancy).containsEntry("room_id",destination);
        assertThat(holding.residentItems(RESIDENT)).anySatisfy(item->{
            assertThat(item.id()).isEqualTo(parcel.id());
            assertThat(item.room()).isEqualTo("Original");
        });
        assertThat(db.queryForObject("""
            SELECT q.tenancy_id FROM visitor_requests q JOIN visitor_visits v ON v.request_id=q.id WHERE v.id=?
            """,UUID.class,guest)).isEqualTo(stay.tenancy());
        assertThat(bill("2026-06")).isEqualTo(original);
        UUID next=bill("2026-07");
        assertThat(db.queryForObject("SELECT rent FROM monthly_bills WHERE id=?",BigDecimal.class,original)).isEqualByComparingTo("2500");
        assertThat(db.queryForObject("SELECT rent FROM monthly_bills WHERE id=?",BigDecimal.class,next)).isEqualByComparingTo("3200");
        assertThat(db.queryForObject("SELECT tenancy_id FROM monthly_bills WHERE id=?",UUID.class,next)).isEqualTo(newTenancy);
    }

    @Test void simultaneousTransfersCannotTakeTheSameLastSlot() throws Exception {
        Stay other=start(OTHER,property,room(property,"Other room",2800));
        UUID destination=room(property,"Last place",3200);
        UUID first=propose(stay,destination), second=propose(other,destination);
        tenancies.accept(RESIDENT,first);
        tenancies.accept(OTHER,second);
        var start=new CountDownLatch(1);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(()->completeAfter(start,stay,first));
            var b=executor.submit(()->completeAfter(start,other,second));
            start.countDown();
            assertThat(List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder("COMPLETED","ROOM_FULL");
        }
        assertThat(db.queryForObject("SELECT count(*) FROM tenancies WHERE room_id=? AND status='ACTIVE'",Integer.class,destination)).isOne();
    }

    @Test void profileAndVerifiedEmailUseTheSameAccountAndRejectStaleSessions() throws Exception {
        String newEmail="verified-new@example.test";
        MockHttpSession browser=login(RESIDENT);
        MockHttpSession stale=login(RESIDENT);
        mvc.perform(put("/api/resident/profile").session(browser).with(csrf()).contentType("application/json")
            .content("{\"fullName\":\"Updated Resident\",\"mobile\":\"09991234567\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.full_name").value("Updated Resident"));
        assertThat(onboarding.pending(OWNER).getFirst()).containsEntry("full_name","Updated Resident").containsEntry("contact","09991234567");
        requestChange(browser,OTHER,PASSWORD,409);
        requestChange(browser,newEmail,"incorrect",400);
        requestChange(browser,newEmail,PASSWORD,200);
        String raw=emailLink.get();
        assertThat(db.queryForObject("SELECT token_hash FROM account_email_changes",String.class)).isEqualTo(RegistrationService.hash(raw)).isNotEqualTo(raw);
        mvc.perform(get("/api/account").session(browser)).andExpect(status().isOk()).andExpect(jsonPath("$.email").value(RESIDENT));
        verifyChange(null,raw,403);
        db.update("UPDATE account_email_changes SET expires_at=?",OffsetDateTime.now().minusHours(1));
        verifyChange(browser,raw,410);
        requestChange(browser,newEmail,PASSWORD,200);
        verifyChange(browser,emailLink.get(),200);
        verifyChange(login(newEmail),emailLink.get(),410);
        account(RESIDENT,"APPLICANT");
        mvc.perform(get("/api/account").session(stale)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/account").session(login(newEmail))).andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value(newEmail)).andExpect(jsonPath("$.full_name").value("Updated Resident"));
        assertThat(db.queryForObject("SELECT count(*) FROM registration_audit WHERE event='SIGN_IN_EMAIL_CHANGED'",Integer.class)).isOne();
    }

    private UUID propose(Stay source,UUID destination) {
        return (UUID)tenancies.propose(OWNER,source.tenancy(),destination,1L,null).get("id");
    }

    private String completeAfter(CountDownLatch start,Stay source,UUID proposal) throws Exception {
        start.await();
        try {
            tenancies.complete(OWNER,source.tenancy(),proposal);
            return "COMPLETED";
        } catch (FlowException error) {
            return error.code;
        }
    }

    private MockHttpSession login(String email) throws Exception {
        return (MockHttpSession)mvc.perform(post("/api/auth/login").param("username",email).param("password",PASSWORD).with(csrf()))
            .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private void requestChange(MockHttpSession session,String address,String password,int statusCode) throws Exception {
        mvc.perform(post("/api/resident/profile/email").session(session).with(csrf()).contentType("application/json")
            .content("{\"email\":\""+address+"\",\"currentPassword\":\""+password+"\"}")).andExpect(status().is(statusCode));
    }

    private void verifyChange(MockHttpSession session,String token,int statusCode) throws Exception {
        var request=post("/api/public/profile/email/verify").with(csrf()).contentType("application/json")
            .content("{\"token\":\""+token+"\"}");
        if (session!=null) request.session(session);
        mvc.perform(request).andExpect(status().is(statusCode));
    }
}
