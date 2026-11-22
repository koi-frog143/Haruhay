package db.migration;

import java.sql.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/** Finish previously approved/verified held applications without asking for another code. */
public class V3__owner_approval_starts_tenancy extends BaseJavaMigration {
    @Override public void migrate(Context context) throws Exception {
        Connection c=context.getConnection();
        try(var select=c.prepareStatement("""
            SELECT a.id,a.account_id,a.reviewed_by,h.id AS reservation_id,h.room_id
            FROM registration_applications a JOIN accounts u ON u.id=a.account_id
            JOIN invitations i ON i.id=a.invitation_id JOIN reservations h ON h.id=i.reservation_id
            WHERE a.activation_pending=TRUE AND a.status='PENDING_APPROVAL' AND u.email_verified=TRUE
            AND a.reviewed_by IS NOT NULL AND h.status='HELD'
            AND NOT EXISTS(SELECT 1 FROM tenancies t WHERE t.application_id=a.id OR t.reservation_id=h.id)
            """); var rows=select.executeQuery()) {
            while(rows.next()) {
                UUID app=rows.getObject("id",UUID.class), actor=rows.getObject("reviewed_by",UUID.class);
                UUID reservation=rows.getObject("reservation_id",UUID.class);
                OffsetDateTime now=OffsetDateTime.now();
                try(var insert=c.prepareStatement("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)")) {
                    insert.setObject(1,UUID.randomUUID()); insert.setObject(2,reservation); insert.setObject(3,app);
                    insert.setObject(4,rows.getObject("account_id",UUID.class)); insert.setObject(5,rows.getObject("room_id",UUID.class));
                    insert.setObject(6,now); insert.setObject(7,actor); insert.executeUpdate();
                }
                try(var update=c.prepareStatement("UPDATE reservations SET status='CONVERTED',updated_by=?,updated_at=?,reason='Owner approval completed; second verification removed' WHERE id=?")) {
                    update.setObject(1,actor); update.setObject(2,now); update.setObject(3,reservation); update.executeUpdate();
                }
                try(var update=c.prepareStatement("UPDATE registration_applications SET status='APPROVED',activation_pending=FALSE WHERE id=?")) {
                    update.setObject(1,app); update.executeUpdate();
                }
                try(var audit=c.prepareStatement("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,'APPROVAL_COMPLETED_BY_MIGRATION',?,?,?)")) {
                    audit.setObject(1,UUID.randomUUID()); audit.setObject(2,app); audit.setObject(3,actor); audit.setObject(4,now);
                    audit.setString(5,"Previously verified account and approved held room; no second verification required"); audit.executeUpdate();
                }
            }
        }
        try(var delete=c.prepareStatement("DELETE FROM tenancy_activation_codes WHERE application_id IN (SELECT id FROM registration_applications WHERE status='APPROVED' AND activation_pending=FALSE)")) {
            delete.executeUpdate();
        }
    }
}
