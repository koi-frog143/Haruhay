package com.haruhay.backend.notification;

import com.haruhay.backend.registration.FlowException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/resident/notifications")
public class ResidentNotificationController {
    public record Notice(String id,String type,UUID targetId,String title,String context,
                         OffsetDateTime createdAt,OffsetDateTime readAt) {}
    public record Count(long unread) {}
    public record Read(@NotBlank @Size(max=64) String id) {}

    private static final String RESIDENT = """
        SELECT a.id FROM accounts a WHERE a.email=? AND a.role='APPLICANT'
          AND EXISTS(SELECT 1 FROM tenancies t WHERE t.account_id=a.id AND t.status='ACTIVE')
          AND NOT EXISTS(SELECT 1 FROM property_guard_assignments g WHERE g.account_id=a.id)
          AND NOT EXISTS(SELECT 1 FROM maintenance_staff s WHERE s.account_id=a.id)
        """;

    // Keep source IDs stable across edits, and keep prior rooms visible after a transfer within the same stay.
    private static final String INBOX = """
        FROM (
          SELECT e.notification_id,e.event_type,e.target_id,e.title,e.context_label,e.created_at,
            COALESCE(e.maintenance_read_at,r.read_at) AS read_at
          FROM (
            SELECT 'announcement:' || CAST(n.id AS VARCHAR(36)) AS notification_id,
              'ANNOUNCEMENT' AS event_type,n.id AS target_id,n.title,p.name AS context_label,
              n.published_at AS created_at,CAST(NULL AS TIMESTAMP WITH TIME ZONE) AS maintenance_read_at
            FROM property_announcements n JOIN properties p ON p.id=n.property_id
            WHERE n.status='PUBLISHED' AND p.sample=FALSE AND p.notify_announcements=TRUE
              AND EXISTS(SELECT 1 FROM tenancies t JOIN rooms r ON r.id=t.room_id
                JOIN accounts resident ON resident.id=t.account_id
                WHERE t.account_id=:accountId AND t.status='ACTIVE' AND r.property_id=n.property_id
                  AND resident.notify_announcements=TRUE)
            UNION ALL
            SELECT 'maintenance:' || CAST(n.id AS VARCHAR(36)), 'MAINTENANCE',t.id,n.message,p.name,n.created_at,n.read_at
            FROM maintenance_notifications n JOIN maintenance_tickets t ON t.id=n.ticket_id
            JOIN tenancies original ON original.id=t.tenancy_id JOIN properties p ON p.id=t.property_id
            JOIN accounts resident ON resident.id=n.recipient_id
            WHERE n.recipient_id=:accountId AND t.resident_id=n.recipient_id AND p.sample=FALSE
              AND p.notify_maintenance=TRUE AND resident.notify_maintenance=TRUE
              AND EXISTS(SELECT 1 FROM tenancies current_stay WHERE current_stay.application_id=original.application_id
                AND current_stay.account_id=n.recipient_id AND current_stay.status='ACTIVE')
            UNION ALL
            SELECT 'payment:' || CAST(review.id AS VARCHAR(20)), 'PAYMENT_' || review.action,s.id,
              CASE review.action WHEN 'APPROVED' THEN 'Payment approved'
                WHEN 'DECLINED' THEN 'Payment declined' ELSE 'Payment reversed' END,
              p.name || ' · ' || b.period,review.reviewed_at,CAST(NULL AS TIMESTAMP WITH TIME ZONE)
            FROM bill_payment_reviews review JOIN bill_payment_submissions s ON s.id=review.payment_id
            JOIN monthly_bills b ON b.id=s.bill_id JOIN properties p ON p.id=b.property_id
            JOIN tenancies original ON original.id=b.tenancy_id JOIN accounts resident ON resident.id=original.account_id
            WHERE original.account_id=:accountId AND p.sample=FALSE
              AND p.notify_payments=TRUE AND resident.notify_payments=TRUE
              AND EXISTS(SELECT 1 FROM tenancies current_stay WHERE current_stay.application_id=original.application_id
                AND current_stay.account_id=original.account_id AND current_stay.status='ACTIVE')
          ) e LEFT JOIN resident_notification_reads r
            ON r.notification_id=e.notification_id AND r.account_id=:accountId
        ) inbox
        """;
    private final JdbcTemplate db;
    private final NamedParameterJdbcTemplate queries;
    private final Clock clock;

    public ResidentNotificationController(JdbcTemplate db,Clock clock) {
        this.db=db;
        this.queries=new NamedParameterJdbcTemplate(db);
        this.clock=clock;
    }

    @GetMapping
    public List<Notice> list(Principal user) {
        return queries.query("SELECT * "+INBOX+" ORDER BY created_at DESC,notification_id DESC",
            Map.of("accountId",resident(user,false)),this::notice);
    }

    @GetMapping("/unread-count")
    public Count count(Principal user) {
        return new Count(queries.queryForObject("SELECT COUNT(*) "+INBOX+" WHERE read_at IS NULL",
            Map.of("accountId",resident(user,false)),Long.class));
    }

    @GetMapping("/preferences")
    public NotificationPreferences preferences(Principal user) {
        return db.queryForObject("""
            SELECT notify_announcements,notify_maintenance,notify_payments FROM accounts WHERE id=?
            """,(row,index)->NotificationPreferences.read(row),resident(user,false));
    }

    @PutMapping("/preferences")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void savePreferences(Principal user,@Valid @RequestBody NotificationPreferences request) {
        UUID resident=resident(user,true);
        db.update("UPDATE accounts SET notify_announcements=?,notify_maintenance=?,notify_payments=? WHERE id=?",
            request.announcements(),request.maintenance(),request.payments(),resident);
    }

    @PostMapping("/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void read(Principal user,@Valid @RequestBody Read request) {
        UUID resident=resident(user,true);
        var notice=queries.query("SELECT * "+INBOX+" WHERE notification_id=:id",Map.of("accountId",resident,"id",request.id()),this::notice)
            .stream().findFirst().orElseThrow(()->new FlowException(404,"NOTIFICATION_NOT_FOUND","This notification is unavailable."));
        if (notice.readAt()==null) mark(resident,List.of(notice));
    }

    @PostMapping("/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void readAll(Principal user) {
        UUID resident=resident(user,true);
        mark(resident,queries.query("SELECT * "+INBOX+" WHERE read_at IS NULL",Map.of("accountId",resident),this::notice));
    }

    private UUID resident(Principal user,boolean lock) {
        // Serialize updates to this account's read state across devices.
        return db.query(RESIDENT+(lock?" FOR UPDATE":""),(row,index)->row.getObject(1,UUID.class),user.getName())
            .stream().findFirst().orElseThrow(()->new FlowException(403,"ACTIVE_STAY_REQUIRED","An active resident stay is required."));
    }

    private Notice notice(ResultSet row,int index) throws SQLException {
        return new Notice(row.getString("notification_id"),row.getString("event_type"),row.getObject("target_id",UUID.class),
            row.getString("title"),row.getString("context_label"),row.getObject("created_at",OffsetDateTime.class),
            row.getObject("read_at",OffsetDateTime.class));
    }

    private void mark(UUID resident,List<Notice> notices) {
        OffsetDateTime at=clock.instant().atOffset(ZoneOffset.UTC);
        var maintenance=notices.stream().filter(notice->"MAINTENANCE".equals(notice.type()))
            .map(notice->new Object[]{at,resident,UUID.fromString(notice.id().substring("maintenance:".length()))}).toList();
        var other=notices.stream().filter(notice->!"MAINTENANCE".equals(notice.type()))
            .map(notice->new Object[]{resident,notice.id(),at}).toList();
        if (!maintenance.isEmpty()) db.batchUpdate(
            "UPDATE maintenance_notifications SET read_at=? WHERE recipient_id=? AND id=? AND read_at IS NULL",maintenance);
        if (!other.isEmpty()) db.batchUpdate(
            "INSERT INTO resident_notification_reads(account_id,notification_id,read_at) VALUES(?,?,?)",other);
    }
}
