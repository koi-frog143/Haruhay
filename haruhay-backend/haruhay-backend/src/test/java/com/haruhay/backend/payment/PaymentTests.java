package com.haruhay.backend.payment;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.haruhay.backend.registration.FlowException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
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
class PaymentTests {
    private static final String OWNER="payments-owner@example.test", RESIDENT="payments-resident@example.test";
    private static final String OTHER_OWNER="payments-other-owner@example.test", OTHER_RESIDENT="payments-other-resident@example.test";
    @Autowired PaymentService payments;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    private UUID firstBill, secondBill, outsideBill;

    @BeforeEach void fixtures() {
        clear();
        firstBill=seed(OWNER,RESIDENT);
        secondBill=UUID.randomUUID();
        db.update("""
            INSERT INTO monthly_bills(id,tenancy_id,application_id,property_id,offer_id,period,due_date,rent,fixed_charges,posted_by,posted_at)
            SELECT ?,tenancy_id,application_id,property_id,offer_id,'2025-12',?,rent,fixed_charges,posted_by,posted_at
            FROM monthly_bills WHERE id=?
            """,secondBill,LocalDate.of(2025,12,5),firstBill);
        outsideBill=seed(OTHER_OWNER,OTHER_RESIDENT);
    }
    @AfterEach void clear() {
        String url=db.execute((java.sql.Connection c)->c.getMetaData().getURL());
        assertThat(url).containsAnyOf("registration-tests","haruhay_registration_test");
        for (String table:List.of("maintenance_notifications","maintenance_photos","maintenance_completions","maintenance_activity",
            "maintenance_assignments","maintenance_tickets","maintenance_staff","visitor_movements","visitor_audit","visitor_qr_credentials",
            "visitor_visits","visitor_requests","visitor_profiles","property_guard_assignments","holding_item_transactions","holding_inquiries",
            "holding_items","registration_audit","monthly_bills","application_offers","room_charges","tenancy_activation_codes","email_verifications",
            "tenancies","registration_applications","invitations","reservations","rooms","properties","accounts"))
            db.update("DELETE FROM "+table);
    }
    private UUID seed(String ownerEmail,String residentEmail) {
        UUID owner=account(ownerEmail,"OWNER"),resident=account(residentEmail,"APPLICANT"),property=UUID.randomUUID();
        UUID room=UUID.randomUUID(),reservation=UUID.randomUUID(),invitation=UUID.randomUUID(),application=UUID.randomUUID();
        UUID tenancy=UUID.randomUUID(),offer=UUID.randomUUID(),bill=UUID.randomUUID();
        var now=OffsetDateTime.now();
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,?)",property,owner,"Payment Test House");
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,2)",room,property,"Room 1");
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,now);
        db.update("INSERT INTO invitations(id,reservation_id,email,token_hash,token_expires_at,status,created_by,created_at) VALUES(?,?,?,?,?,'CLAIMED',?,?)",
            invitation,reservation,residentEmail,"fixture-"+invitation,now.plusDays(1),owner,now);
        db.update("INSERT INTO registration_applications(id,invitation_id,account_id,full_name,contact,status,submitted_at) VALUES(?,?,?,?,?,'APPROVED',?)",
            application,invitation,resident,"Resident One","",now);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            tenancy,reservation,application,resident,room,now,owner);
        db.update("""
            INSERT INTO application_offers(id,application_id,version,room_id,room_version,snapshot,created_by,created_at,reason,accepted_by,accepted_at)
            VALUES(?,?,1,?,1,'{}',?,?,'Billing fixture',?,?)
            """,offer,application,room,owner,now,resident,now);
        db.update("""
            INSERT INTO monthly_bills(id,tenancy_id,application_id,property_id,offer_id,period,due_date,rent,fixed_charges,posted_by,posted_at)
            VALUES(?,?,?,?,?,'2026-01',?,3000,500,?,?)
            """,bill,tenancy,application,property,offer,LocalDate.of(2026,1,5),owner,now);
        return bill;
    }
    private UUID account(String email,String role) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,?,TRUE,?)",
            id,email,"unused-fixture-hash",email,"",role,OffsetDateTime.now());
        return id;
    }
    private PaymentService.Report report(UUID bill,String amount,String reference) {
        return new PaymentService.Report(bill,UUID.randomUUID(),null,new BigDecimal(amount),"GCASH",LocalDate.now(ZoneId.of("Asia/Manila")),reference);
    }
    private PaymentService.Review approve(String expectedBalance) {
        return new PaymentService.Review(true,null,new BigDecimal(expectedBalance));
    }
    private void balance(UUID bill,String expected,String status) {
        var result=db.queryForMap("SELECT balance,bill_status FROM billing_balances WHERE id=?",bill);
        assertThat((BigDecimal)result.get("balance")).isEqualByComparingTo(expected);
        assertThat(result).containsEntry("bill_status",status);
    }

    @Test void partialPaymentsReachPaidAndReversalPreservesNumberAndAudit() {
        var report=report(firstBill,"1000","Payment-1");
        UUID first=payments.report(RESIDENT,report);
        assertThat(payments.report(RESIDENT,report)).isEqualTo(first);
        balance(firstBill,"3500","UNPAID");
        assertThatThrownBy(()->payments.receipt(RESIDENT,false,first)).isInstanceOf(FlowException.class);
        assertThatThrownBy(()->payments.review(OWNER,first,"APPROVED",new PaymentService.Review(false,null,new BigDecimal("3500"))))
            .hasMessageContaining("checked");
        payments.review(OWNER,first,"APPROVED",approve("3500"));
        var receipt=payments.receipt(RESIDENT,false,first);
        payments.review(OWNER,first,"APPROVED",approve("3500"));
        assertThat(payments.receipt(RESIDENT,false,first).get("number")).isEqualTo(receipt.get("number"));
        balance(firstBill,"2500","PARTIAL");
        UUID second=payments.report(RESIDENT,report(firstBill,"2500","Payment-2"));
        payments.review(OWNER,second,"APPROVED",approve("2500"));
        balance(firstBill,"0","PAID");
        assertThatThrownBy(()->payments.review(OWNER,first,"REVERSED",new PaymentService.Review(false," ",null))).isInstanceOf(FlowException.class);
        var reversal=new PaymentService.Review(false,"Recorded against the wrong bill",null);
        payments.review(OWNER,first,"REVERSED",reversal);
        payments.review(OWNER,first,"REVERSED",reversal);
        balance(firstBill,"1000","PARTIAL");
        assertThat(payments.receipt(RESIDENT,false,first)).containsEntry("number",receipt.get("number"))
            .containsEntry("status","REVERSED").containsEntry("reversal_reason","Recorded against the wrong bill");
        assertThat(db.queryForObject("SELECT count(*) FROM bill_payment_ledger",Integer.class)).isEqualTo(3);
        assertThat(db.queryForObject("SELECT count(*) FROM bill_payment_reviews",Integer.class)).isEqualTo(3);
        var summary=payments.collections(OWNER);
        assertThat((BigDecimal)((Map<?,?>)summary.get("months")).get(summary.get("period"))).isEqualByComparingTo("2500");
    }

    @Test void correctionKeepsDeclineAndDuplicateMethodReferenceIsScopedToProperty() {
        var input=report(firstBill,"3500","  Shared-ref  ");
        UUID declined=payments.report(RESIDENT,input);
        assertThatThrownBy(()->payments.review(OWNER,declined,"DECLINED",new PaymentService.Review(false,"",null))).isInstanceOf(FlowException.class);
        payments.review(OWNER,declined,"DECLINED",new PaymentService.Review(false,"Please verify the reference",null));
        UUID correction=payments.report(RESIDENT,new PaymentService.Report(firstBill,UUID.randomUUID(),declined,input.amount(),input.method(),input.paymentDate(),"shared-ref"));
        assertThat(payments.payment(RESIDENT,false,declined)).containsEntry("decline_reason","Please verify the reference").containsEntry("has_correction",true);
        assertThat(payments.payment(RESIDENT,false,correction)).containsEntry("corrects_id",declined);
        UUID duplicate=payments.report(RESIDENT,report(secondBill,"400","SHARED-REF"));
        assertThat(payments.payment(OWNER,true,correction)).containsEntry("duplicate_reference",true);
        payments.review(OWNER,correction,"APPROVED",approve("3500"));
        balance(firstBill,"0","PAID");
        assertThatThrownBy(()->payments.review(OWNER,duplicate,"APPROVED",approve("3500"))).hasMessageContaining("already uses");
        UUID outside=payments.report(OTHER_RESIDENT,report(outsideBill,"400","SHARED-REF"));
        payments.review(OTHER_OWNER,outside,"APPROVED",approve("3500"));
        balance(outsideBill,"3100","PARTIAL");
    }

    @Test void concurrentApprovalsRecheckBalanceAndCannotOverpay() throws Exception {
        UUID first=payments.report(RESIDENT,report(firstBill,"2200","Concurrent-1"));
        UUID second=payments.report(RESIDENT,report(firstBill,"2100","Concurrent-2"));
        var start=new CountDownLatch(1);
        try (var executor=Executors.newFixedThreadPool(2)) {
            var one=executor.submit(()->approvalAfter(start,first));
            var two=executor.submit(()->approvalAfter(start,second));
            start.countDown();
            UUID pending=one.get(15,TimeUnit.SECONDS);
            UUID other=two.get(15,TimeUnit.SECONDS);
            assertThat(List.of(pending!=null,other!=null)).containsExactlyInAnyOrder(true,false);
            UUID rejected=pending==null?other:pending;
            var result=payments.payment(OWNER,true,rejected);
            assertThat(result).containsEntry("status","PENDING");
            assertThatThrownBy(()->payments.review(OWNER,rejected,"APPROVED",new PaymentService.Review(true,null,(BigDecimal)result.get("balance"))))
                .hasMessageContaining("exceeds");
        }
        assertThat(db.queryForObject("SELECT count(*) FROM bill_payment_receipts",Integer.class)).isOne();
    }
    private UUID approvalAfter(CountDownLatch start,UUID payment) throws InterruptedException {
        start.await();
        try { payments.review(OWNER,payment,"APPROVED",approve("3500")); return null; }
        catch (FlowException error) { assertThat(error.getMessage()).contains("balance changed"); return payment; }
    }

    @Test void privateProofReceiptsAndReviewAreScopedOnHttpRoutes() throws Exception {
        UUID pending=account("payments-pending@example.test","APPLICANT");
        assertThat(pending).isNotNull();
        var input=report(firstBill,"1000","Private-1");
        UUID id=payments.report(RESIDENT,input);
        assertThatThrownBy(()->payments.report(OTHER_RESIDENT,input)).isInstanceOf(FlowException.class);
        String proof="/api/resident/payments/"+id+"/proof";
        try(var bytes=new ByteArrayOutputStream()) {
            ImageIO.write(new BufferedImage(8,8,BufferedImage.TYPE_INT_RGB),"png",bytes);
            var image=new MockMultipartFile("proof","proof.png","image/png",bytes.toByteArray());
            mvc.perform(multipart(proof).file(image).with(user(RESIDENT).roles("APPLICANT"))).andExpect(status().isForbidden());
            mvc.perform(multipart(proof).file(new MockMultipartFile("proof","fake.png","image/png",new byte[]{0,1}))
                .with(user(RESIDENT).roles("APPLICANT")).with(csrf())).andExpect(status().isBadRequest());
            mvc.perform(multipart(proof).file(image).with(user(RESIDENT).roles("APPLICANT")).with(csrf())).andExpect(status().isNoContent());
            mvc.perform(get(proof).with(user(OTHER_RESIDENT).roles("APPLICANT"))).andExpect(status().isNotFound());
            mvc.perform(get("/api/owner/payments/"+id+"/proof").with(user(OTHER_OWNER).roles("OWNER"))).andExpect(status().isNotFound());
            mvc.perform(get("/api/owner/payments/"+id+"/proof").with(user(OWNER).roles("OWNER")))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store")).andExpect(content().bytes(bytes.toByteArray()));
        }
        mvc.perform(post("/api/owner/payments/"+id+"/approve").with(user(OTHER_OWNER).roles("OWNER")).with(csrf())
            .contentType("application/json").content("{\"verified\":true,\"expectedBalance\":3500}")).andExpect(status().isNotFound());
        mvc.perform(post("/api/owner/payments/"+id+"/approve").with(user(OWNER).roles("OWNER")).with(csrf())
            .contentType("application/json").content("{\"verified\":true,\"expectedBalance\":3500}")).andExpect(status().isNoContent());
        String receipt="/api/resident/payments/"+id+"/receipt";
        mvc.perform(get(receipt).with(user(OTHER_RESIDENT).roles("APPLICANT"))).andExpect(status().isNotFound());
        mvc.perform(get(receipt).with(user("payments-pending@example.test").roles("APPLICANT"))).andExpect(status().isForbidden());
        mvc.perform(get(receipt).with(user(RESIDENT).roles("APPLICANT"))).andExpect(status().isOk()).andExpect(jsonPath("$.number").isNumber());
        mvc.perform(get("/api/resident/bills").with(user(RESIDENT).roles("APPLICANT"))).andExpect(status().isOk())
            .andExpect(jsonPath("$[1].balance").value(2500)).andExpect(jsonPath("$[1].bill_status").value("PARTIAL"));
    }
}
