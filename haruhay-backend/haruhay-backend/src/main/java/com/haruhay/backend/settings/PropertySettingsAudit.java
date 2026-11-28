package com.haruhay.backend.settings;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PropertySettingsAudit {
    public enum Action {
        PROPERTY_DETAILS("Property details updated"),
        BILLING_RULES("Billing defaults updated"),
        NOTIFICATIONS("Notification preferences updated"),
        RETENTION("Retention policy updated"),
        GUARD_CREATED("Guard account created"),
        GUARD_UPDATED("Guard access updated"),
        TECHNICIAN_CREATED("Technician account created"),
        TECHNICIAN_UPDATED("Technician access updated");

        final String label;
        Action(String label) { this.label=label; }
    }

    public record Entry(UUID id,String action,String actor,OffsetDateTime occurredAt,String details) {}

    private static final String PREFIX="PROPERTY-SETTINGS-";
    private final JdbcTemplate db;
    private final Clock clock;

    public PropertySettingsAudit(JdbcTemplate db,Clock clock) {
        this.db=db;
        this.clock=clock;
    }

    public void record(UUID property,UUID actor,Action action,String details) {
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)",
            UUID.randomUUID(),property,PREFIX+action.name(),actor,clock.instant().atOffset(ZoneOffset.UTC),details);
    }

    List<Entry> history(UUID property) {
        return db.query("""
            SELECT h.id,h.event,h.occurred_at,h.reason,COALESCE(a.full_name,'Property owner') AS actor
            FROM registration_audit h LEFT JOIN accounts a ON a.id=h.actor_id
            WHERE h.entity_id=? AND h.event LIKE ? ORDER BY h.occurred_at DESC,h.id LIMIT 100
            """,(row,index)->new Entry(row.getObject("id",UUID.class),
                Action.valueOf(row.getString("event").substring(PREFIX.length())).label,row.getString("actor"),
                row.getObject("occurred_at",OffsetDateTime.class),row.getString("reason")),property,PREFIX+"%");
    }
}
