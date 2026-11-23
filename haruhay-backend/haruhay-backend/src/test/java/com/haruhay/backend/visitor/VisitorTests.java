package com.haruhay.backend.visitor;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.registration.RegistrationService;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class VisitorTests {
    @Autowired JdbcTemplate db; @Autowired VisitorService service; @Autowired MockMvc mvc; @Autowired RegistrationService registration;
    UUID owner,resident,other,property,otherProperty,tenancy;
    final String ownerEmail="visitor-owner@example.test",residentEmail="visitor-resident@example.test",otherEmail="visitor-other@example.test",guardEmail="visitor-guard@example.test";
    @BeforeEach void setup(){
        String url=db.execute((java.sql.Connection c)->c.getMetaData().getURL());assertThat(url).containsAnyOf("registration-tests","haruhay_registration_test");
        for(String table:List.of("visitor_movements","visitor_audit","visitor_qr_credentials","visitor_visits","visitor_requests","visitor_profiles","property_guard_assignments","holding_item_transactions","holding_inquiries","holding_items","registration_audit","monthly_bills","application_offers","room_charges","tenancy_activation_codes","email_verifications","tenancies","registration_applications","invitations","reservations","rooms","properties","accounts"))db.update("DELETE FROM "+table);
        owner=account(ownerEmail,"OWNER");resident=account(residentEmail,"APPLICANT");other=account(otherEmail,"APPLICANT");property=UUID.randomUUID();otherProperty=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",property,owner,"Visitor Test House");db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",otherProperty,other,"Other House");
        UUID room=UUID.randomUUID(),reservation=UUID.randomUUID(),invitation=UUID.randomUUID(),application=UUID.randomUUID();tenancy=UUID.randomUUID();var now=OffsetDateTime.now(ZoneOffset.UTC);
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,2)",room,property,"Room 1");
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,now);
        db.update("INSERT INTO invitations(id,reservation_id,email,token_hash,token_expires_at,status,created_by,created_at) VALUES(?,?,?,?,?,'CLAIMED',?,?)",invitation,reservation,residentEmail,"fixture",now.plusDays(1),owner,now);
        db.update("INSERT INTO registration_applications(id,invitation_id,account_id,full_name,contact,status,submitted_at) VALUES(?,?,?,?,?,'APPROVED',?)",application,invitation,resident,"Resident One","09171234567",now);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",tenancy,reservation,application,resident,room,now,owner);
    }
    UUID account(String email,String role){UUID id=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,?,TRUE,?)",id,email,"unused-test-hash",email,"09171234567",role,OffsetDateTime.now());return id;}
    VisitorService.Request details(){return new VisitorService.Request(tenancy,"Visitor One","09171234567","Family visit",OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1),OffsetDateTime.now(ZoneOffset.UTC).plusHours(2));}
    UUID pending(){return service.request(residentEmail,details());}
    UUID approved(){return service.review(ownerEmail,pending(),new VisitorService.Review("APPROVE",null));}
    VisitorService.Movement movement(String action,String token){return new VisitorService.Movement(action,token==null?"MANUAL":"QR",token,true,"School ID","1234",token==null?"Presented ID verified with approved visit":null);}
    @Test void lifecycleAndNoEntryFromScan(){
        UUID request=pending();assertThat(service.list(residentEmail,null)).hasSize(1);assertThat(db.queryForObject("SELECT count(*) FROM visitor_visits",Integer.class)).isZero();
        UUID visit=service.review(ownerEmail,request,new VisitorService.Review("APPROVE",null));var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("has_shareable_pass",true);
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(pass.token())).get("allowed")).isEqualTo(true);assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements",Integer.class)).isZero();
        assertThat(service.movement(ownerEmail,property,visit,movement("ENTRY",pass.token())).get("allowed")).isEqualTo(true);
        service.movement(ownerEmail,property,visit,movement("ENTRY",pass.token()));assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements",Integer.class)).isEqualTo(1);
        assertThat(service.movement(ownerEmail,property,visit,movement("EXIT",pass.token())).get("allowed")).isEqualTo(true);service.movement(ownerEmail,property,visit,movement("EXIT",null));
        assertThat(service.movement(ownerEmail,property,visit,movement("ENTRY",pass.token())).get("allowed")).isEqualTo(false);assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements",Integer.class)).isEqualTo(2);
        assertThat(service.history(ownerEmail,property,visit)).extracting(r->r.get("event")).contains("ENTRY_QR","EXIT_QR");
    }
    @Test void replacementRevocationExpiryAndManualDeparture(){
        UUID visit=approved();var first=service.issue(residentEmail,visit,new VisitorService.Pass(false));
        assertThat(service.issue(residentEmail,visit,new VisitorService.Pass(false))).isEqualTo(first);
        assertThat(service.guestPass(new VisitorService.Scan(first.shareToken())).token()).isEqualTo(first.token());
        var second=service.issue(residentEmail,visit,new VisitorService.Pass(true));assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(first.token())).get("allowed")).isEqualTo(false);
        assertThatThrownBy(()->service.guestPass(new VisitorService.Scan(first.shareToken()))).isInstanceOf(FlowException.class);
        service.amend(ownerEmail,property,visit,new VisitorService.Review("REVOKE","Visitor changed plans"));assertThat(service.movement(ownerEmail,property,visit,movement("ENTRY",null)).get("allowed")).isEqualTo(false);
        var third=service.issue(residentEmail,visit,new VisitorService.Pass(true));service.movement(ownerEmail,property,visit,movement("ENTRY",third.token()));
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(second.token())).get("allowed")).isEqualTo(false);
        db.update("UPDATE visitor_qr_credentials SET expires_at=? WHERE visit_id=?",OffsetDateTime.now().minusDays(1),visit);service.amend(ownerEmail,property,visit,new VisitorService.Review("REVOKE","Lost pass"));
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(third.token())).get("allowed")).isEqualTo(true);assertThat(service.movement(ownerEmail,property,visit,movement("EXIT",null)).get("allowed")).isEqualTo(true);
        assertThat(second.token()).isNotEqualTo(third.token());
    }
    @Test void flexibleInvitationsAndPhilippineDatesKeepActualMovementSeparate(){
        var today=LocalDate.now(ZoneId.of("Asia/Manila"));
        UUID request=service.request(residentEmail,new VisitorService.Request(tenancy,"Guest","", "Family",null,null));
        var pending=service.list(residentEmail,null).getFirst();
        assertThat(pending).containsEntry("contact","").containsEntry("display_status","PENDING");
        assertThat(pending.get("arrival")).isNull();
        assertThat(pending.get("departure")).isNull();
        UUID visit=service.review(ownerEmail,request,new VisitorService.Review("APPROVE",null));
        var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));
        assertThat(Duration.between(pass.startsAt(),pass.expiresAt())).isEqualTo(Duration.ofHours(24));

        LocalDate future=today.plusDays(3);
        UUID scheduled=service.request(residentEmail,new VisitorService.Request(tenancy,"Future Guest",null,"Family",null,null,future));
        UUID scheduledVisit=service.review(ownerEmail,scheduled,new VisitorService.Review("APPROVE",null));
        var scheduledPass=service.issue(residentEmail,scheduledVisit,new VisitorService.Pass(false));
        assertThat(scheduledPass.startsAt().withOffsetSameInstant(ZoneOffset.ofHours(8))).isEqualTo(future.atStartOfDay().atOffset(ZoneOffset.ofHours(8)));
        assertThat(Duration.between(scheduledPass.startsAt(),scheduledPass.expiresAt())).isEqualTo(Duration.ofHours(24));
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(scheduledPass.token())).get("allowed")).isEqualTo(false);

        UUID forToday=service.request(residentEmail,new VisitorService.Request(tenancy,"Same-day Guest",null,"Family",null,null,today));
        var currentPass=service.issue(residentEmail,service.review(ownerEmail,forToday,new VisitorService.Review("APPROVE",null)),new VisitorService.Pass(false));
        assertThat(currentPass.startsAt().withOffsetSameInstant(ZoneOffset.ofHours(8)).toLocalDate()).isEqualTo(today);
        assertThat(currentPass.expiresAt().withOffsetSameInstant(ZoneOffset.ofHours(8))).isEqualTo(today.plusDays(1).atStartOfDay().atOffset(ZoneOffset.ofHours(8)));
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements",Integer.class)).isZero();
    }
    @Test void passedPlannedDateCannotBeApprovedAndDeclineReasonIsVisible(){
        var today=LocalDate.now(ZoneId.of("Asia/Manila"));
        var request=service.request(residentEmail,new VisitorService.Request(tenancy,"Guest",null,"Family",null,null,today));
        db.update("UPDATE visitor_requests SET planned_date=? WHERE id=?",today.minusDays(1),request);
        assertThatThrownBy(()->service.review(ownerEmail,request,new VisitorService.Review("APPROVE",null)))
            .isInstanceOf(FlowException.class).hasMessageContaining("invite the guest again");
        service.review(ownerEmail,request,new VisitorService.Review("DECLINE","The planned date passed."));
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("display_status","DECLINED").containsEntry("reason","The planned date passed.");
    }
    @Test void legacyWindowsAndExistingQrRemainValidUntilExplicitReplacement(){
        var input=details();
        UUID request=service.request(residentEmail,input);
        UUID visit=service.review(ownerEmail,request,new VisitorService.Review("APPROVE",null));
        var row=service.list(residentEmail,null).getFirst();
        assertThat(row).containsEntry("window_policy","LEGACY").containsEntry("contact",input.contact());
        assertThat((OffsetDateTime)row.get("arrival")).isCloseTo(input.arrival(),within(1,ChronoUnit.MICROS));
        assertThat((OffsetDateTime)row.get("departure")).isCloseTo(input.departure(),within(1,ChronoUnit.MICROS));
        String original="haruhay:visit:"+"L".repeat(43);
        db.update("INSERT INTO visitor_qr_credentials(id,visit_id,token_hash,status,issued_at,expires_at) VALUES(?,?,?,'ACTIVE',?,?)",
            UUID.randomUUID(),visit,RegistrationService.hash(original),OffsetDateTime.now(),input.departure());
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(original))).containsEntry("allowed",true);
        assertThatThrownBy(()->service.issue(residentEmail,visit,new VisitorService.Pass(false))).hasMessageContaining("Replace it");
        var newPass=service.issue(residentEmail,visit,new VisitorService.Pass(true));
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(original))).containsEntry("allowed",false);
        assertThat(service.guestPass(new VisitorService.Scan(newPass.shareToken())).token()).isEqualTo(newPass.token());
    }
    @Test void expiredEntryIsDeniedButManualCheckoutWorksAfterWindow(){
        UUID request=service.request(residentEmail,new VisitorService.Request(tenancy,"Guest",null,"Family",null,null));
        UUID visit=service.review(ownerEmail,request,new VisitorService.Review("APPROVE",null));
        var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));
        service.movement(ownerEmail,property,visit,movement("ENTRY",pass.token()));
        var now=OffsetDateTime.now(ZoneOffset.UTC);
        db.update("UPDATE visitor_qr_credentials SET expires_at=? WHERE visit_id=?",now.minusHours(1),visit);
        db.update("UPDATE visitor_requests SET arrival=?,departure=? WHERE id=?",now.minusHours(25),now.minusHours(1),request);
        assertThat(service.guestPass(new VisitorService.Scan(pass.shareToken())).entryWindowEnded()).isTrue();
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("display_status","CHECKED_IN");
        assertThat(service.movement(ownerEmail,property,visit,movement("EXIT",null))).containsEntry("allowed",true);
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("display_status","CHECKED_OUT");
        assertThatThrownBy(()->service.guestPass(new VisitorService.Scan(pass.shareToken()))).isInstanceOf(FlowException.class);
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(pass.token()))).containsEntry("allowed",false);

        UUID waiting=approved();
        var waitingPass=service.issue(residentEmail,waiting,new VisitorService.Pass(false));
        db.update("UPDATE visitor_requests SET arrival=?,departure=? WHERE id=(SELECT request_id FROM visitor_visits WHERE id=?)",now.minusHours(4),now.minusHours(1),waiting);
        db.update("UPDATE visitor_qr_credentials SET expires_at=? WHERE visit_id=?",now.minusHours(1),waiting);
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("display_status","EXPIRED");
        assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(waitingPass.token()))).containsEntry("allowed",false);
        assertThatThrownBy(()->service.guestPass(new VisitorService.Scan(waitingPass.shareToken()))).isInstanceOf(FlowException.class);
    }
    @Test void concurrentScansAndPassOpensDoNotMoveOrDuplicateAVisit() throws Exception {
        UUID visit=approved();
        try(var pool=Executors.newFixedThreadPool(2)){
            var start=new CountDownLatch(1);
            Callable<VisitorService.IssuedPass> issue=()->{start.await();return service.issue(residentEmail,visit,new VisitorService.Pass(false));};
            var first=pool.submit(issue);var second=pool.submit(issue);start.countDown();
            var pass=first.get(15,TimeUnit.SECONDS);
            assertThat(second.get(15,TimeUnit.SECONDS)).isEqualTo(pass);
            var scanStart=new CountDownLatch(1);
            Callable<Map<String,Object>> scan=()->{scanStart.await();return service.scan(ownerEmail,property,new VisitorService.Scan(pass.token()));};
            var scanned=pool.submit(scan);var repeated=pool.submit(scan);scanStart.countDown();
            assertThat(scanned.get(15,TimeUnit.SECONDS)).containsEntry("allowed",true);
            assertThat(repeated.get(15,TimeUnit.SECONDS)).containsEntry("allowed",true);
        }
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements",Integer.class)).isZero();
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_qr_credentials",Integer.class)).isEqualTo(1);
    }
    @Test void scopeInactiveHostAndPendingAccount() throws Exception {
        UUID visit=approved();var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));assertThat(service.list(otherEmail,null)).isEmpty();
        assertThatThrownBy(()->service.issue(otherEmail,visit,new VisitorService.Pass(true))).isInstanceOf(FlowException.class);
        assertThatThrownBy(()->service.list(otherEmail,property)).isInstanceOf(FlowException.class);
        assertThat(service.scan(otherEmail,otherProperty,new VisitorService.Scan(pass.token())).get("allowed")).isEqualTo(false);
        assertThatThrownBy(()->service.request(otherEmail,details())).isInstanceOf(FlowException.class);
        db.update("UPDATE tenancies SET status='ENDED' WHERE id=?",tenancy);assertThat(service.movement(ownerEmail,property,visit,movement("ENTRY",pass.token())).get("allowed")).isEqualTo(false);
        mvc.perform(get("/api/logbook/records")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/resident/bills").with(user(otherEmail).roles("APPLICANT"))).andExpect(status().isForbidden());
    }
    @Test void realGuardPermissions() throws Exception {
        service.createGuard(ownerEmail,property,new VisitorService.Guard(guardEmail,"Guard One","Visitor-guard-password42",false));UUID guard=UUID.fromString(registration.account(guardEmail).get("id").toString());assertThat(registration.account(guardEmail).get("role")).isEqualTo("GUARD");
        UUID request=pending();assertThatThrownBy(()->service.review(guardEmail,request,new VisitorService.Review("APPROVE",null))).isInstanceOf(FlowException.class);
        assertThat(service.list(guardEmail,property)).hasSize(1);assertThatThrownBy(()->service.list(guardEmail,otherProperty)).isInstanceOf(FlowException.class);
        mvc.perform(get("/api/owner/bills").with(user(guardEmail).roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/resident/bills").with(user(guardEmail).roles("APPLICANT"))).andExpect(status().isForbidden());
        service.assignment(ownerEmail,property,guard,new VisitorService.Assignment(true,true));UUID visit=service.review(guardEmail,request,new VisitorService.Review("APPROVE",null));assertThat(visit).isNotNull();
        service.assignment(ownerEmail,property,guard,new VisitorService.Assignment(false,true));assertThatThrownBy(()->service.list(guardEmail,property)).isInstanceOf(FlowException.class);
    }
    @Test void concurrentEntryAndExitAreIdempotent() throws Exception {
        UUID visit=approved();var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));
        try(var pool=Executors.newFixedThreadPool(2)){var start=new CountDownLatch(1);List<Future<?>> jobs=new ArrayList<>();for(int i=0;i<2;i++)jobs.add(pool.submit(()->{start.await();return service.movement(ownerEmail,property,visit,movement("ENTRY",pass.token()));}));start.countDown();for(var j:jobs)j.get(15,TimeUnit.SECONDS);}
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements WHERE movement='ENTRY'",Integer.class)).isEqualTo(1);
        service.movement(ownerEmail,property,visit,movement("EXIT",null));assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements WHERE movement='EXIT'",Integer.class)).isEqualTo(1);
    }
    @Test void declineCancelVoidAndCorrectionRetainEvidence(){
        UUID request=pending();assertThatThrownBy(()->service.review(ownerEmail,request,new VisitorService.Review("DECLINE",""))).isInstanceOf(FlowException.class);service.review(ownerEmail,request,new VisitorService.Review("DECLINE","Host unavailable"));
        UUID visit=approved();var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));UUID request2=UUID.fromString(db.queryForObject("SELECT request_id FROM visitor_visits WHERE id=?",String.class,visit));service.cancel(residentEmail,request2);assertThat(service.scan(ownerEmail,property,new VisitorService.Scan(pass.token())).get("allowed")).isEqualTo(false);
        UUID open=approved();service.movement(ownerEmail,property,open,movement("ENTRY",null));assertThatThrownBy(()->service.amend(ownerEmail,property,open,new VisitorService.Review("VOID","Incorrect name"))).isInstanceOf(FlowException.class);service.amend(ownerEmail,property,open,new VisitorService.Review("CORRECTION","Name spelling corrected in this note"));service.movement(ownerEmail,property,open,movement("EXIT",null));service.amend(ownerEmail,property,open,new VisitorService.Review("VOID","Duplicate paper register reconciled"));
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements WHERE visit_id=?",Integer.class,open)).isEqualTo(2);
    }
    @Test void walkinIdentityAndDenialAudits(){
        assertThatThrownBy(()->service.walkin(ownerEmail,new VisitorService.WalkIn(details(),false,"Host called"))).isInstanceOf(FlowException.class);
        UUID visit=service.walkin(ownerEmail,new VisitorService.WalkIn(details(),true,"Host called and confirmed"));
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("has_shareable_pass",false);
        assertThatThrownBy(()->service.movement(ownerEmail,property,visit,new VisitorService.Movement("ENTRY","MANUAL",null,false,"ID",null,"Verified"))).isInstanceOf(FlowException.class);
        db.update("UPDATE visitor_requests SET arrival=?,departure=? WHERE id=(SELECT request_id FROM visitor_visits WHERE id=?)",OffsetDateTime.now().plusHours(1),OffsetDateTime.now().plusHours(2),visit);
        assertThat(service.movement(ownerEmail,property,visit,movement("ENTRY",null)).get("allowed")).isEqualTo(false);service.scan(ownerEmail,property,new VisitorService.Scan("not a pass"));
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_audit WHERE event IN ('MOVEMENT_DENIED','SCAN_DENIED')",Integer.class)).isEqualTo(2);
    }
    @Test void concurrentReplacementLeavesExactlyOneValidCredential() throws Exception {
        UUID visit=approved();service.issue(residentEmail,visit,new VisitorService.Pass(false));List<VisitorService.IssuedPass> passes=new ArrayList<>();
        try(var pool=Executors.newFixedThreadPool(2)){var start=new CountDownLatch(1);List<Future<VisitorService.IssuedPass>> jobs=new ArrayList<>();for(int i=0;i<2;i++)jobs.add(pool.submit(()->{start.await();return service.issue(residentEmail,visit,new VisitorService.Pass(true));}));start.countDown();for(var j:jobs)passes.add(j.get(15,TimeUnit.SECONDS));}
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_qr_credentials WHERE visit_id=? AND status='ACTIVE'",Integer.class,visit)).isEqualTo(1);
        long valid=passes.stream().filter(p->Boolean.TRUE.equals(service.scan(ownerEmail,property,new VisitorService.Scan(p.token())).get("allowed"))).count();assertThat(valid).isEqualTo(1);
        for(var p:passes){assertThat(p.toString()).doesNotContain(p.token());assertThat(new VisitorService.Scan(p.token()).toString()).doesNotContain(p.token());assertThat(db.queryForObject("SELECT count(*) FROM visitor_qr_credentials WHERE token_hash=?",Integer.class,p.token())).isZero();}
    }
    @Test void httpContractRequiresCsrfAndHidesSecrets() throws Exception {
        UUID visit=approved();var pass=service.issue(residentEmail,visit,new VisitorService.Pass(false));
        String linkBody="{\"token\":\""+pass.shareToken()+"\"}";
        mvc.perform(post("/api/public/visitor-pass").with(csrf()).contentType("application/json").content(linkBody))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
            .andExpect(jsonPath("$.propertyName").value("Visitor Test House")).andExpect(jsonPath("$.token").value(pass.token()))
            .andExpect(jsonPath("$.shareToken").doesNotExist()).andExpect(jsonPath("$.visitId").doesNotExist()).andExpect(jsonPath("$.full_name").doesNotExist());
        mvc.perform(post("/api/logbook/properties/"+property+"/visits/"+visit+"/movement").with(csrf()).contentType("application/json").content(linkBody))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/logbook/records").with(user(residentEmail).roles("APPLICANT")))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].share_hash").doesNotExist()).andExpect(jsonPath("$[0].token_hash").doesNotExist());
        mvc.perform(post("/api/logbook/properties/"+property+"/scan").with(user(ownerEmail).roles("OWNER")).contentType("application/json").content("{\"token\":\""+pass.token()+"\"}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/logbook/properties/"+property+"/scan").with(user(ownerEmail).roles("OWNER")).with(csrf()).contentType("application/json").content("{\"token\":\""+pass.token()+"\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(true)).andExpect(jsonPath("$.record.full_name").value("Visitor One")).andExpect(jsonPath("$.record.token_hash").doesNotExist());
        mvc.perform(get("/api/logbook/properties/"+property+"/activity").with(user(ownerEmail).roles("OWNER"))).andExpect(status().isOk()).andExpect(jsonPath("$[0].actor").exists());
        mvc.perform(post("/api/logbook/properties/"+property+"/visits/"+visit+"/amend").with(user(ownerEmail).roles("OWNER")).with(csrf()).contentType("application/json").content("{\"action\":\"CORRECTION\",\"reason\":\"Front desk note\"}")).andExpect(status().isNoContent());
        mvc.perform(post("/api/logbook/visits/"+visit+"/pass/revoke").with(user(residentEmail).roles("APPLICANT")).with(csrf())
            .contentType("application/json").content("{\"reason\":\"The guest lost the link\"}")).andExpect(status().isNoContent());
        mvc.perform(post("/api/public/visitor-pass").with(csrf()).contentType("application/json").content(linkBody)).andExpect(status().isGone());
        assertThat(service.list(residentEmail,null).getFirst()).containsEntry("has_shareable_pass",false);
    }
    @Test void invalidTimesContactAndIdentityDetailsAreRejected(){
        var r=details();assertThatThrownBy(()->service.request(residentEmail,new VisitorService.Request(tenancy,"Visitor","invalid","Visit",r.arrival(),r.departure()))).isInstanceOf(FlowException.class);
        assertThatThrownBy(()->service.request(residentEmail,new VisitorService.Request(tenancy,"Visitor",r.contact(),"Visit",r.departure(),r.arrival()))).isInstanceOf(FlowException.class);
        UUID visit=approved();assertThatThrownBy(()->service.movement(ownerEmail,property,visit,new VisitorService.Movement("ENTRY","MANUAL",null,true,"School ID","full-id-number","Verified at desk"))).isInstanceOf(FlowException.class);
        assertThat(db.queryForObject("SELECT count(*) FROM visitor_movements",Integer.class)).isZero();
    }
}
