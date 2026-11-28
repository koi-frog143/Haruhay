package com.haruhay.backend.registration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.Principal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class MonthlyBillController {
    private final JdbcTemplate db;
    private final MonthlyBillingService billing;
    public MonthlyBillController(JdbcTemplate db,MonthlyBillingService billing){this.db=db;this.billing=billing;}
    public record PostBill(@NotNull UUID applicationId,@NotNull @Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])") String period,LocalDate dueDate){}
    private static final String VIEW="""
        SELECT b.*,m.grace_days AS billing_grace_days,u.full_name,u.email,r.label AS room_label,p.name AS property_name,
            SUM(b.balance) OVER(PARTITION BY b.application_id) AS application_balance,
            SUM(b.total) OVER(PARTITION BY b.application_id) AS application_total,
            SUM(b.paid) OVER(PARTITION BY b.application_id) AS application_paid,
            SUM(b.balance) OVER(PARTITION BY t.account_id) AS account_balance,
            SUM(b.total) OVER(PARTITION BY t.account_id) AS account_total,
            SUM(b.paid) OVER(PARTITION BY t.account_id) AS account_paid
        FROM billing_balances b JOIN monthly_bills m ON m.id=b.id
        JOIN tenancies t ON t.id=b.tenancy_id JOIN accounts u ON u.id=t.account_id
        JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=b.property_id
        """;
    private List<Map<String,Object>> rows(String sql,Object...args){
        var result=db.queryForList(sql,args);
        result.forEach(row->{
            row.replaceAll((k,v)->v instanceof java.sql.Date d?d.toLocalDate():v instanceof java.sql.Timestamp t?t.toInstant().atOffset(ZoneOffset.UTC):v);
            int graceDays=((Number)row.get("billing_grace_days")).intValue();
            if(graceDays>0 && row.get("due_date") instanceof LocalDate due) row.put("billing_grace_through",due.plusDays(graceDays));
        });
        return result;
    }
    @GetMapping("/owner/bills") public List<Map<String,Object>> owner(Principal u){return rows(VIEW+" WHERE p.owner_id=(SELECT id FROM accounts WHERE email=?) ORDER BY b.due_date,b.id",u.getName());}
    @GetMapping("/resident/bills") public List<Map<String,Object>> resident(Principal u){return rows(VIEW+" WHERE u.email=? ORDER BY b.due_date,b.id",u.getName());}
    @PostMapping("/owner/bills") public Map<String,Object> post(Principal user,@Valid @RequestBody PostBill request){
        if(request.period()==null||!request.period().matches("\\d{4}-(0[1-9]|1[0-2])"))throw new FlowException(400,"BILL_DATE","Choose a valid billing month.");
        YearMonth month=YearMonth.parse(request.period());
        if(request.dueDate()!=null&&!YearMonth.from(request.dueDate()).equals(month))throw new FlowException(400,"BILL_DATE","The due date must belong to the billing month.");
        UUID id=billing.manual(user.getName(),request.applicationId(),month,request.dueDate());
        return rows(VIEW+" WHERE b.id=?",id).getFirst();
    }
}
