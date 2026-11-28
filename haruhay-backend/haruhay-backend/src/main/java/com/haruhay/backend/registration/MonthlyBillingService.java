package com.haruhay.backend.registration;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MonthlyBillingService {
    static final String MANILA_ZONE="Asia/Manila";
    private static final ZoneId MANILA=ZoneId.of(MANILA_ZONE);
    private static final String RULES="""
        SELECT p.id,p.owner_id,p.billing_due_day,p.billing_grace_days,p.auto_billing_enabled,
            p.auto_billing_posting_day,p.auto_billing_first_period FROM properties p
        """;

    public record Issue(UUID applicationId,String residentName,String roomLabel,String reason,boolean billPosted) {}
    public record Run(UUID id,String period,LocalDate scheduledFor,OffsetDateTime completedAt,
                      int postedCount,int existingCount,List<Issue> issues) {}
    public record ScheduleStatus(LocalDate nextPostingDate,boolean catchUp,List<Run> runs) {}
    private record Rules(UUID id,UUID owner,int dueDay,int graceDays,boolean enabled,int postingDay,YearMonth firstPeriod) {}
    private record Stay(UUID id,UUID application,UUID offer,OffsetDateTime startedAt,String roomLabel) {}
    private record PendingIssue(UUID application,String roomLabel,String reason) {}

    private final JdbcTemplate db;
    private final RoomAgreementService agreements;
    private final Clock clock;

    public MonthlyBillingService(JdbcTemplate db,RoomAgreementService agreements,Clock clock) {
        this.db=db;
        this.agreements=agreements;
        this.clock=clock;
    }

    @Transactional
    public UUID manual(String email,UUID application,YearMonth month,LocalDate dueDate) {
        Rules rules=db.query(RULES+"""
            WHERE p.owner_id=(SELECT id FROM accounts WHERE email=? AND role='OWNER')
              AND EXISTS(SELECT 1 FROM tenancies t JOIN rooms r ON r.id=t.room_id
                         WHERE t.application_id=? AND r.property_id=p.id)
            FOR UPDATE
            """,this::rules,email,application).stream().findFirst()
            .orElseThrow(this::missingStay);
        Stay stay=lockActiveStay(rules.id(),application).orElseThrow(this::missingStay);
        return existing(application,month).orElseGet(()->post(stay,rules,month,dueDate,"MONTHLY_BILL_POSTED"));
    }

    List<UUID> dueProperties() {
        LocalDate today=today();
        String period=YearMonth.from(today).toString();
        return db.queryForList("""
            SELECT p.id FROM properties p JOIN accounts a ON a.id=p.owner_id
            WHERE p.auto_billing_enabled=TRUE AND p.sample=FALSE AND a.role='OWNER'
                AND p.auto_billing_first_period<=? AND p.auto_billing_posting_day<=?
                AND NOT EXISTS(SELECT 1 FROM monthly_billing_runs r WHERE r.property_id=p.id AND r.period=?)
            ORDER BY p.id
            """,UUID.class,period,today.getDayOfMonth(),period);
    }

    @Transactional
    public void postDue(UUID property) {
        // The same property lock covers settings writes and every manual or automatic post.
        Optional<Rules> found=db.query(RULES+"""
            WHERE p.id=? AND p.sample=FALSE AND p.owner_id IN (SELECT id FROM accounts WHERE role='OWNER') FOR UPDATE
            """,this::rules,property).stream().findFirst();
        if (found.isEmpty() || !found.get().enabled()) return;
        Rules rules=found.get();
        LocalDate today=today();
        YearMonth month=YearMonth.from(today);
        LocalDate scheduled=month.atDay(rules.postingDay());
        if (month.isBefore(rules.firstPeriod()) || today.isBefore(scheduled) || completed(property,month)) return;

        var applications=db.queryForList("""
            SELECT t.application_id FROM tenancies t JOIN rooms r ON r.id=t.room_id
            WHERE r.property_id=? AND t.status='ACTIVE' ORDER BY t.application_id
            """,UUID.class,property);
        OffsetDateTime cutoff=scheduled.atStartOfDay(MANILA).toOffsetDateTime();
        var issues=new ArrayList<PendingIssue>();
        int posted=0;
        int alreadyPosted=0;
        for (UUID application:applications) {
            var active=lockActiveStay(property,application);
            if (active.isEmpty()) continue;
            Stay stay=active.get();
            if (existing(application,month).isPresent()) {
                alreadyPosted++;
                continue;
            }
            if (stay.startedAt().isAfter(cutoff)) {
                issues.add(new PendingIssue(application,stay.roomLabel(),"This stay started after the posting cutoff. Review this month for manual posting."));
                continue;
            }
            try {
                post(stay,rules,month,null,"MONTHLY_BILL_AUTO_POSTED");
                posted++;
            } catch (FlowException error) {
                if (!"QUOTE_REQUIRED".equals(error.code) && !"TERMS_REQUIRED".equals(error.code)) throw error;
                issues.add(new PendingIssue(application,stay.roomLabel(),error.getMessage()));
            }
        }

        UUID run=UUID.randomUUID();
        db.update("""
            INSERT INTO monthly_billing_runs(id,property_id,period,scheduled_for,completed_at,posted_count,existing_count)
            VALUES(?,?,?,?,?,?,?)
            """,run,property,month.toString(),scheduled,now(),posted,alreadyPosted);
        for (PendingIssue issue:issues) {
            db.update("""
                INSERT INTO monthly_billing_run_issues(run_id,application_id,room_label,reason) VALUES(?,?,?,?)
                """,run,issue.application(),issue.roomLabel(),issue.reason());
        }
    }

    public String firstPeriod(int postingDay) {
        LocalDate today=today();
        YearMonth current=YearMonth.from(today);
        return (today.getDayOfMonth()>postingDay?current.plusMonths(1):current).toString();
    }

    public ScheduleStatus status(String email,UUID property) {
        var rules=db.query(RULES+"""
            WHERE p.id=? AND p.sample=FALSE AND p.owner_id=(SELECT id FROM accounts WHERE email=? AND role='OWNER')
            """,this::rules,property,email).stream().findFirst()
            .orElseThrow(()->new FlowException(404,"SETTINGS_PROPERTY_NOT_FOUND","Choose a property you manage."));
        var summaries=db.query("""
            SELECT id,period,scheduled_for,completed_at,posted_count,existing_count FROM monthly_billing_runs
            WHERE property_id=? ORDER BY period DESC LIMIT 12
            """,(row,index)->new Run(row.getObject("id",UUID.class),row.getString("period"),
                row.getObject("scheduled_for",LocalDate.class),row.getObject("completed_at",OffsetDateTime.class),
                row.getInt("posted_count"),row.getInt("existing_count"),List.of()),property);
        var runs=summaries.stream().map(run->new Run(run.id(),run.period(),run.scheduledFor(),run.completedAt(),
            run.postedCount(),run.existingCount(),issues(run.id(),run.period()))).toList();
        if (!rules.enabled()) return new ScheduleStatus(null,false,runs);

        LocalDate today=today();
        YearMonth next=YearMonth.from(today);
        if (next.isBefore(rules.firstPeriod())) next=rules.firstPeriod();
        if (!runs.isEmpty()) {
            YearMonth processed=YearMonth.parse(runs.getFirst().period());
            if (!next.isAfter(processed)) next=processed.plusMonths(1);
        }
        LocalDate scheduled=next.atDay(rules.postingDay());
        boolean catchUp=scheduled.isBefore(today);
        return new ScheduleStatus(catchUp?today:scheduled,catchUp,runs);
    }

    private UUID post(Stay stay,Rules rules,YearMonth month,LocalDate dueDate,String event) {
        var offers=agreements.tenancyOffers(stay.application(),stay.offer());
        if (offers.isEmpty() || offers.getFirst().get("accepted_at")==null)
            throw new FlowException(409,"TERMS_REQUIRED","Accepted room terms are required before posting a bill.");
        var offer=offers.getFirst();
        @SuppressWarnings("unchecked") var terms=(Map<String,Object>)offer.get("terms");
        if (terms.get("applicant_monthly_rent")==null)
            throw new FlowException(409,"QUOTE_REQUIRED","The accepted agreement needs an explicit monthly rent.");
        if (terms.get("fixed_monthly_charges")==null)
            throw new FlowException(409,"TERMS_REQUIRED","The accepted agreement needs a confirmed fixed monthly charge total.");
        var rent=new BigDecimal(terms.get("applicant_monthly_rent").toString());
        var fixed=new BigDecimal(terms.get("fixed_monthly_charges").toString());
        UUID id=UUID.randomUUID();
        OffsetDateTime now=now();
        LocalDate due=dueDate==null?month.atDay(rules.dueDay()):dueDate;
        db.update("""
            INSERT INTO monthly_bills(id,tenancy_id,application_id,property_id,offer_id,period,due_date,
                rent,fixed_charges,posted_by,posted_at,grace_days) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,id,stay.id(),stay.application(),rules.id(),offer.get("id"),month.toString(),due,rent,fixed,rules.owner(),now,rules.graceDays());
        db.update("""
            INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)
            """,UUID.randomUUID(),id,event,rules.owner(),now,"Accepted offer "+offer.get("version")+"; period "+month+"; metered and unconfirmed costs excluded");
        return id;
    }

    private Optional<Stay> lockActiveStay(UUID property,UUID application) {
        // Re-read once if a concurrently completed transfer ended the row selected for locking.
        var stays=activeStays(property,application);
        if (stays.isEmpty()) stays=activeStays(property,application);
        return stays.stream().findFirst();
    }

    private List<Stay> activeStays(UUID property,UUID application) {
        return db.query("""
            SELECT t.id,t.application_id,t.offer_id,t.started_at,
                (SELECT r.label FROM rooms r WHERE r.id=t.room_id) AS room_label
            FROM tenancies t WHERE t.application_id=? AND t.status='ACTIVE'
                AND EXISTS(SELECT 1 FROM rooms r WHERE r.id=t.room_id AND r.property_id=?)
            ORDER BY t.started_at DESC,t.id FOR UPDATE
            """,(row,index)->new Stay(row.getObject("id",UUID.class),row.getObject("application_id",UUID.class),
                row.getObject("offer_id",UUID.class),row.getObject("started_at",OffsetDateTime.class),row.getString("room_label")),application,property);
    }

    private Rules rules(ResultSet row,int index) throws SQLException {
        String first=row.getString("auto_billing_first_period");
        return new Rules(row.getObject("id",UUID.class),row.getObject("owner_id",UUID.class),row.getInt("billing_due_day"),
            row.getInt("billing_grace_days"),row.getBoolean("auto_billing_enabled"),row.getInt("auto_billing_posting_day"),
            first==null?null:YearMonth.parse(first));
    }

    private Optional<UUID> existing(UUID application,YearMonth month) {
        return db.queryForList("SELECT id FROM monthly_bills WHERE application_id=? AND period=?",UUID.class,application,month.toString())
            .stream().findFirst();
    }

    private boolean completed(UUID property,YearMonth month) {
        return db.queryForObject("SELECT COUNT(*) FROM monthly_billing_runs WHERE property_id=? AND period=?",Integer.class,property,month.toString())>0;
    }

    private List<Issue> issues(UUID run,String period) {
        return db.query("""
            SELECT i.application_id,i.room_label,i.reason,a.full_name,(b.id IS NOT NULL) AS bill_posted FROM monthly_billing_run_issues i
            JOIN registration_applications app ON app.id=i.application_id JOIN accounts a ON a.id=app.account_id
            LEFT JOIN monthly_bills b ON b.application_id=i.application_id AND b.period=?
            WHERE i.run_id=? ORDER BY a.full_name,i.application_id
            """,(row,index)->new Issue(row.getObject("application_id",UUID.class),row.getString("full_name"),
                row.getString("room_label"),row.getString("reason"),row.getBoolean("bill_posted")),period,run);
    }

    private LocalDate today() { return LocalDate.ofInstant(clock.instant(),MANILA); }
    private OffsetDateTime now() { return OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC); }
    private FlowException missingStay() { return new FlowException(404,"NOT_FOUND","Active tenancy not found for your property."); }
}
