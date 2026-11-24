package com.haruhay.backend.payment;

import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.storage.PrivateImage;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentService {
    private static final ZoneId MANILA = ZoneId.of("Asia/Manila");
    private static final String BILL_JOINS = """
        JOIN tenancies t ON t.id=b.tenancy_id
        JOIN properties p ON p.id=b.property_id
        JOIN accounts resident ON resident.id=t.account_id
        JOIN accounts owner ON owner.id=p.owner_id
        JOIN rooms room ON room.id=t.room_id
        """;
    private static final String PAYMENT_VIEW = """
        SELECT s.id,s.bill_id,s.corrects_id,s.property_id,s.amount,s.method,s.payment_date,s.reference,s.status,s.submitted_at,
               b.period,b.due_date,b.total,b.balance,b.application_id,b.bill_status,p.name AS property_name,
               resident.full_name AS resident_name,room.label AS room_label,
               review.reason AS decline_reason,reverse.reason AS reversal_reason,receipt.number AS receipt_number,
               receipt.issued_at AS verified_at,
               EXISTS(SELECT 1 FROM bill_payment_proofs proof WHERE proof.payment_id=s.id) AS has_proof,
               EXISTS(SELECT 1 FROM bill_payment_submissions x WHERE x.id<>s.id AND x.property_id=s.property_id
                   AND x.method=s.method AND x.reference_key=s.reference_key AND x.status IN ('PENDING','APPROVED')) AS duplicate_reference,
               EXISTS(SELECT 1 FROM bill_payment_submissions x WHERE x.corrects_id=s.id) AS has_correction
        FROM bill_payment_submissions s JOIN billing_balances b ON b.id=s.bill_id
        """ + BILL_JOINS + """
        LEFT JOIN bill_payment_reviews review ON review.payment_id=s.id AND review.action='DECLINED'
        LEFT JOIN bill_payment_reviews reverse ON reverse.payment_id=s.id AND reverse.action='REVERSED'
        LEFT JOIN bill_payment_receipts receipt ON receipt.payment_id=s.id
        """;

    private final JdbcTemplate db;
    private final Clock clock;

    public PaymentService(JdbcTemplate db, Clock clock) {
        this.db=db;
        this.clock=clock;
    }

    public record Report(UUID billId, UUID requestKey, UUID correctsId, BigDecimal amount, String method, LocalDate paymentDate, String reference) {
        @Override public String toString() { return "PaymentReport[REDACTED]"; }
    }
    public record Review(boolean verified, String reason, BigDecimal expectedBalance) {
        @Override public String toString() { return "PaymentReview[REDACTED]"; }
    }
    private OffsetDateTime now() { return clock.instant().atOffset(ZoneOffset.UTC); }
    private FlowException missing() { return new FlowException(404,"PAYMENT_NOT_FOUND","This bill or payment is unavailable."); }
    private FlowException conflict(String code,String message) { return new FlowException(409,code,message); }
    private FlowException invalid(String message) { return new FlowException(400,"PAYMENT_INPUT",message); }
    private String scope(boolean owner) { return owner ? "owner.email=?" : "resident.email=?"; }
    private UUID id(Map<String,Object> row,String field) { return (UUID)row.get(field); }
    private BigDecimal money(Map<String,Object> row,String field) { return (BigDecimal)row.get(field); }

    private List<Map<String,Object>> rows(String sql,Object... args) {
        var result=db.queryForList(sql,args);
        result.forEach(row -> row.replaceAll((key,value) ->
            value instanceof Timestamp time ? time.toInstant().atOffset(ZoneOffset.UTC)
                : value instanceof java.sql.Date date ? date.toLocalDate() : value));
        return result;
    }
    private Map<String,Object> one(String sql,Object... args) {
        return rows(sql,args).stream().findFirst().orElseThrow(this::missing);
    }
    private Map<String,Object> bill(String email, UUID id) {
        return one("SELECT b.id,b.property_id,b.balance FROM billing_balances b "+BILL_JOINS+" WHERE b.id=? AND "+scope(false),id,email);
    }
    private void lockBill(UUID bill) { one("SELECT id FROM monthly_bills WHERE id=? FOR UPDATE",bill); }
    private String required(String value,int max,String message) {
        if (value==null || value.isBlank() || value.trim().length()>max) throw invalid(message);
        return value.trim();
    }
    private BigDecimal amount(BigDecimal value) {
        if (value==null || value.signum()<=0 || value.compareTo(new BigDecimal("9999999999.99"))>0)
            throw invalid("Enter a positive amount in pesos.");
        try { return value.setScale(2,RoundingMode.UNNECESSARY); }
        catch (ArithmeticException e) { throw invalid("Enter an amount with up to two decimal places."); }
    }

    public List<Map<String,Object>> list(String email,boolean owner) {
        return rows(PAYMENT_VIEW+"WHERE "+scope(owner)+" ORDER BY s.submitted_at DESC,s.id",email);
    }
    public Map<String,Object> payment(String email,boolean owner,UUID payment) {
        return one(PAYMENT_VIEW+"WHERE s.id=? AND "+scope(owner),payment,email);
    }

    @Transactional
    public UUID report(String email,Report request) {
        if (request.billId()==null || request.requestKey()==null) throw invalid("Open a posted bill before reporting a payment.");
        BigDecimal amount=amount(request.amount());
        String method=required(request.method(),20,"Choose a payment method.");
        if (!Set.of("GCASH","BANK_TRANSFER","FRONT_DESK").contains(method)) throw invalid("Choose a payment method.");
        String reference=required(request.reference(),120,"Enter a transaction or front desk reference of up to 120 characters.");
        String referenceKey=reference.toUpperCase(Locale.ROOT);
        if (referenceKey.length()>120) throw invalid("Enter a shorter transaction reference.");
        if (request.paymentDate()==null || request.paymentDate().isAfter(LocalDate.now(clock.withZone(MANILA))))
            throw invalid("Enter a payment date on or before today in Philippine time.");

        UUID billId=request.billId();
        bill(email,billId);
        lockBill(billId);
        var balance=bill(email,billId);
        var earlier=rows("SELECT * FROM bill_payment_submissions WHERE bill_id=? AND request_key=?",billId,request.requestKey());
        if (!earlier.isEmpty()) {
            var saved=earlier.getFirst();
            if (amount.compareTo(money(saved,"amount"))!=0 || !method.equals(saved.get("method")) ||
                !reference.equals(saved.get("reference")) || !request.paymentDate().equals(saved.get("payment_date")) ||
                !Objects.equals(request.correctsId(),saved.get("corrects_id")))
                throw conflict("PAYMENT_REQUEST_USED","This submission was already saved with different details. Open your payment history.");
            return id(saved,"id");
        }
        if (amount.compareTo(money(balance,"balance"))>0)
            throw conflict("PAYMENT_BALANCE","The reported amount exceeds the bill’s current balance. Refresh billing to see the remaining amount.");
        if (request.correctsId()!=null) {
            one("SELECT id FROM bill_payment_submissions WHERE id=? AND bill_id=? AND status='DECLINED'",request.correctsId(),billId);
            if (!rows("SELECT id FROM bill_payment_submissions WHERE corrects_id=?",request.correctsId()).isEmpty())
                throw conflict("PAYMENT_ALREADY_CORRECTED","Corrected details were already submitted. Open payment history.");
        }
        UUID id=UUID.randomUUID();
        db.update("""
            INSERT INTO bill_payment_submissions(id,bill_id,property_id,request_key,corrects_id,amount,method,payment_date,
                reference,reference_key,status,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',?)
            """,id,billId,balance.get("property_id"),request.requestKey(),request.correctsId(),amount,method,
            request.paymentDate(),reference,referenceKey,now());
        return id;
    }

    @Transactional
    public void review(String email,UUID paymentId,String decision,Review review) {
        var initial=payment(email,true,paymentId);
        UUID propertyId=id(initial,"property_id");
        // Every approval and reversal locks property, then bill. Duplicate references can span bills.
        one("SELECT id FROM properties WHERE id=? FOR UPDATE",propertyId);
        lockBill(id(initial,"bill_id"));
        var payment=payment(email,true,paymentId);
        String status=(String)payment.get("status");
        if (decision.equals(status)) return;
        var at=now();
        String note=null;
        switch (decision) {
            case "APPROVED" -> {
                if (!status.equals("PENDING")) throw alreadyReviewed();
                if (!review.verified()) throw invalid("Confirm you checked this payment against your own records.");
                if (review.expectedBalance()==null || review.expectedBalance().compareTo(money(payment,"balance"))!=0)
                    throw conflict("PAYMENT_BALANCE_CHANGED","The bill balance changed. Reopen this payment to review the latest balance.");
                if (money(payment,"amount").compareTo(money(payment,"balance"))>0)
                    throw conflict("PAYMENT_OVER_BALANCE","The payment exceeds the remaining balance. Verify the amount before deciding.");
                var duplicate=rows("""
                    SELECT x.id FROM bill_payment_submissions x JOIN bill_payment_submissions target ON target.id=?
                    WHERE x.property_id=target.property_id AND x.method=target.method AND x.active_reference=target.reference_key
                    """,paymentId);
                if (!duplicate.isEmpty())
                    throw conflict("PAYMENT_DUPLICATE","An approved payment in this property already uses that method and reference.");
                db.update("UPDATE bill_payment_submissions SET status='APPROVED',active_reference=reference_key WHERE id=?",paymentId);
                ledger(paymentId,"PAYMENT",money(payment,"amount"),at);
                db.update("""
                    INSERT INTO bill_payment_receipts(payment_id,property_name,resident_name,room_label,issued_at)
                    VALUES(?,?,?,?,?)
                    """,paymentId,payment.get("property_name"),payment.get("resident_name"),payment.get("room_label"),at);
            }
            case "DECLINED" -> {
                if (!status.equals("PENDING")) throw alreadyReviewed();
                note=required(review.reason(),1000,"Enter a decline reason of up to 1000 characters.");
                db.update("UPDATE bill_payment_submissions SET status='DECLINED' WHERE id=?",paymentId);
            }
            case "REVERSED" -> {
                if (!status.equals("APPROVED")) throw alreadyReviewed();
                note=required(review.reason(),1000,"Enter a reversal reason of up to 1000 characters.");
                db.update("UPDATE bill_payment_submissions SET status='REVERSED',active_reference=NULL WHERE id=?",paymentId);
                ledger(paymentId,"REVERSAL",money(payment,"amount").negate(),at);
            }
            default -> throw invalid("Choose an available payment action.");
        }
        db.update("""
            INSERT INTO bill_payment_reviews(payment_id,actor_id,action,reason,reviewed_at)
            VALUES(?,(SELECT id FROM accounts WHERE email=?),?,?,?)
            """,paymentId,email,decision,note,at);
    }
    private FlowException alreadyReviewed() {
        return conflict("PAYMENT_ALREADY_REVIEWED","The payment has already changed. Reopen it to see the current status.");
    }
    private void ledger(UUID payment,String kind,BigDecimal amount,OffsetDateTime at) {
        db.update("INSERT INTO bill_payment_ledger(id,payment_id,kind,amount,recorded_at) VALUES(?,?,?,?,?)",
            UUID.randomUUID(),payment,kind,amount,at);
    }

    public Map<String,Object> receipt(String email,boolean owner,UUID payment) {
        return one("""
            SELECT r.number,r.property_name,r.resident_name,r.room_label,r.issued_at,s.amount,s.method,s.reference,
                   s.payment_date,s.status,b.period,b.due_date,rev.reason AS reversal_reason,rev.reviewed_at AS reversed_at
            FROM bill_payment_receipts r JOIN bill_payment_submissions s ON s.id=r.payment_id
            JOIN monthly_bills b ON b.id=s.bill_id
            """+BILL_JOINS+"""
            LEFT JOIN bill_payment_reviews rev ON rev.payment_id=s.id AND rev.action='REVERSED'
            WHERE s.id=? AND
            """+scope(owner),payment,email);
    }
    public void checkUpload(String email,UUID payment) {
        if (!"PENDING".equals(payment(email,false,payment).get("status"))) throw alreadyReviewed();
    }
    @Transactional
    public void attach(String email,UUID paymentId,PrivateImage.Image image) {
        var payment=payment(email,false,paymentId);
        lockBill(id(payment,"bill_id"));
        payment=payment(email,false,paymentId);
        if (Boolean.TRUE.equals(payment.get("has_proof"))) return;
        if (!"PENDING".equals(payment.get("status"))) throw alreadyReviewed();
        db.update("INSERT INTO bill_payment_proofs(payment_id,content_type,content,uploaded_at) VALUES(?,?,?,?)",
            paymentId,image.type(),image.data(),now());
    }
    public PrivateImage.Image proof(String email,boolean owner,UUID payment) {
        return db.query("""
            SELECT f.content_type,f.content FROM bill_payment_proofs f
            JOIN bill_payment_submissions s ON s.id=f.payment_id JOIN monthly_bills b ON b.id=s.bill_id
            """+BILL_JOINS+"WHERE s.id=? AND "+scope(owner),
            (row,index)->new PrivateImage.Image(row.getString(1),row.getBytes(2)),payment,email)
            .stream().findFirst().orElseThrow(this::missing);
    }

    public Map<String,Object> collections(String email) {
        int year=LocalDate.now(clock.withZone(MANILA)).getYear();
        var start=LocalDate.of(year,1,1).atStartOfDay(MANILA).toOffsetDateTime();
        var records=rows("""
            SELECT l.amount,l.recorded_at FROM bill_payment_ledger l JOIN bill_payment_submissions s ON s.id=l.payment_id
            JOIN properties p ON p.id=s.property_id JOIN accounts owner ON owner.id=p.owner_id
            WHERE owner.email=? AND l.recorded_at>=? AND l.recorded_at<?
            """,email,start,start.plusYears(1));
        var months=new TreeMap<String,BigDecimal>();
        for (var row:records) {
            var eventTime=(OffsetDateTime)row.get("recorded_at");
            String period=YearMonth.from(eventTime.atZoneSameInstant(MANILA)).toString();
            months.merge(period,money(row,"amount"),BigDecimal::add);
        }
        BigDecimal outstanding=db.queryForObject("""
            SELECT COALESCE(SUM(b.balance),0) FROM billing_balances b JOIN properties p ON p.id=b.property_id
            JOIN accounts owner ON owner.id=p.owner_id WHERE owner.email=?
            """,BigDecimal.class,email);
        return Map.of("outstanding",outstanding,"months",months,"period",YearMonth.now(clock.withZone(MANILA)).toString());
    }
}
