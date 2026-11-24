package com.haruhay.backend.registration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.security.Principal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class MonthlyBillController {
    private final JdbcTemplate db;
    private final RoomAgreementService agreements;
    private final Clock clock;
    public MonthlyBillController(JdbcTemplate db,RoomAgreementService agreements,Clock clock){this.db=db;this.agreements=agreements;this.clock=clock;}
    public record PostBill(@NotNull UUID applicationId,@NotNull @Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])") String period,@NotNull LocalDate dueDate){}
    private static final String VIEW="""
        SELECT b.*,u.full_name,u.email,r.label AS room_label,p.name AS property_name,
            SUM(b.balance) OVER(PARTITION BY b.application_id) AS application_balance,
            SUM(b.total) OVER(PARTITION BY b.application_id) AS application_total,
            SUM(b.paid) OVER(PARTITION BY b.application_id) AS application_paid,
            SUM(b.balance) OVER(PARTITION BY t.account_id) AS account_balance,
            SUM(b.total) OVER(PARTITION BY t.account_id) AS account_total,
            SUM(b.paid) OVER(PARTITION BY t.account_id) AS account_paid
        FROM billing_balances b JOIN tenancies t ON t.id=b.tenancy_id JOIN accounts u ON u.id=t.account_id
        JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=b.property_id
        """;
    private List<Map<String,Object>> rows(String sql,Object...args){
        var result=db.queryForList(sql,args);
        result.forEach(row->row.replaceAll((k,v)->v instanceof java.sql.Date d?d.toLocalDate():v instanceof java.sql.Timestamp t?t.toInstant().atOffset(ZoneOffset.UTC):v));return result;
    }
    @GetMapping("/owner/bills") public List<Map<String,Object>> owner(Principal u){return rows(VIEW+" WHERE p.owner_id=(SELECT id FROM accounts WHERE email=?) ORDER BY b.due_date,b.id",u.getName());}
    @GetMapping("/resident/bills") public List<Map<String,Object>> resident(Principal u){return rows(VIEW+" WHERE u.email=? ORDER BY b.due_date,b.id",u.getName());}
    @PostMapping("/owner/bills") @Transactional public Map<String,Object> post(Principal user,@Valid @RequestBody PostBill request){
        if(request.period()==null||request.dueDate()==null||!request.period().matches("\\d{4}-(0[1-9]|1[0-2])"))throw new FlowException(400,"BILL_DATE","Choose a valid billing month and due date.");
        if(!YearMonth.from(request.dueDate()).toString().equals(request.period()))throw new FlowException(400,"BILL_DATE","The due date must belong to the billing month.");
        var tenants=db.queryForList("SELECT t.*,p.owner_id FROM tenancies t JOIN properties p ON p.id=(SELECT property_id FROM registration_applications WHERE id=t.application_id) JOIN accounts u ON u.id=p.owner_id WHERE t.application_id=? AND t.status='ACTIVE' AND u.email=? AND u.role='OWNER' FOR UPDATE",request.applicationId(),user.getName());
        if(tenants.isEmpty())throw new FlowException(404,"NOT_FOUND","Active tenancy not found for your property.");
        var tenancy=tenants.getFirst();
        var existing=rows(VIEW+" WHERE b.tenancy_id=? AND b.period=?",tenancy.get("id"),request.period());
        if(!existing.isEmpty())return existing.getFirst();
        var offers=agreements.offers(request.applicationId());
        if(offers.isEmpty()||offers.getFirst().get("accepted_at")==null)throw new FlowException(409,"TERMS_REQUIRED","Accepted room terms are required before posting a bill.");
        var offer=offers.getFirst();
        @SuppressWarnings("unchecked") var terms=(Map<String,Object>)offer.get("terms");
        if(terms.get("applicant_monthly_rent")==null)throw new FlowException(409,"QUOTE_REQUIRED","The accepted agreement needs an explicit monthly rent.");
        BigDecimal rent=new BigDecimal(terms.get("applicant_monthly_rent").toString());
        BigDecimal fixed=new BigDecimal(terms.get("fixed_monthly_charges").toString());
        UUID id=UUID.randomUUID();var now=OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC);
        db.update("INSERT INTO monthly_bills(id,tenancy_id,application_id,property_id,offer_id,period,due_date,rent,fixed_charges,posted_by,posted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",id,tenancy.get("id"),request.applicationId(),UUID.fromString(terms.get("property_id").toString()),offer.get("id"),request.period(),request.dueDate(),rent,fixed,tenancy.get("owner_id"),now);
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)",UUID.randomUUID(),id,"MONTHLY_BILL_POSTED",tenancy.get("owner_id"),now,"Accepted offer "+offer.get("version")+"; period "+request.period()+"; metered and unconfirmed costs excluded");
        return rows(VIEW+" WHERE b.id=?",id).getFirst();
    }
}
