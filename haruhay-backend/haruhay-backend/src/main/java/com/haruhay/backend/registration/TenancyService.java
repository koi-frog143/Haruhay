package com.haruhay.backend.registration;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TenancyService {
    private static final String STAY = """
        SELECT t.*,r.label AS room_label,p.id AS property_id,p.name AS property_name,
          p.owner_id,u.full_name
        FROM tenancies t JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=r.property_id
        JOIN accounts u ON u.id=t.account_id WHERE t.id=?
        """;
    private static final String TRANSFER = """
        SELECT x.*,o.room_id AS destination_room_id,o.room_version,r.label AS destination_room_label,old_room.label AS source_room_label
        FROM room_transfers x JOIN application_offers o ON o.id=x.offer_id
        JOIN rooms r ON r.id=o.room_id
        JOIN tenancies old_stay ON old_stay.id=x.source_tenancy_id JOIN rooms old_room ON old_room.id=old_stay.room_id
        """;
    private final JdbcTemplate db;
    private final RoomAgreementService agreements;
    private final Clock clock;

    public TenancyService(JdbcTemplate db, RoomAgreementService agreements, Clock clock) {
        this.db=db;
        this.agreements=agreements;
        this.clock=clock;
    }

    public Map<String,Object> summary(String email, UUID tenancy) {
        var stay=ownerStay(email,tenancy);
        UUID application=id(stay,"application_id");
        stay.put("open_bills",count("SELECT COUNT(*) FROM billing_balances WHERE application_id=? AND balance>0",application));
        stay.put("outstanding_balance",db.queryForObject(
            "SELECT COALESCE(SUM(balance),0) FROM billing_balances WHERE application_id=?",BigDecimal.class,application));
        stay.put("unclaimed_packages",count("SELECT COUNT(*) FROM holding_items WHERE application_id=? AND status='READY'",application));
        stay.put("open_repairs",count("""
            SELECT COUNT(*) FROM maintenance_tickets m JOIN tenancies t ON t.id=m.tenancy_id
            WHERE t.application_id=? AND m.status NOT IN ('CLOSED','CANCELLED')
            """,application));
        stay.put("pending_visits",count("SELECT COUNT(*) FROM visitor_requests WHERE tenancy_id=? AND status='PENDING'",tenancy));
        stay.put("ready_passes",db.queryForObject("""
            SELECT COUNT(*) FROM visitor_requests q JOIN visitor_visits v ON v.request_id=q.id
            WHERE q.tenancy_id=? AND v.status='EXPECTED' AND v.voided=FALSE AND q.departure>?
            """,Integer.class,tenancy,now()));
        stay.put("guests_inside",count("""
            SELECT COUNT(*) FROM visitor_requests q JOIN visitor_visits v ON v.request_id=q.id
            JOIN tenancies t ON t.id=q.tenancy_id
            WHERE t.application_id=? AND v.status='CHECKED_IN' AND v.voided=FALSE
            """,application));
        return stay;
    }

    @Transactional
    public Map<String,Object> moveOut(String email, UUID tenancy, String reason) {
        var stay=ownerStay(email,tenancy);
        lockRoom(id(stay,"room_id"));
        var locked=lockStay(tenancy);
        if ("MOVE_OUT".equals(locked.get("end_kind"))) return summary(email,tenancy);
        requireActive(locked);
        UUID owner=id(stay,"owner_id");
        OffsetDateTime effective=now();
        end(locked,owner,"MOVE_OUT",reason,effective);
        cancelProposals(tenancy,owner,"Tenancy ended");
        audit(tenancy,"TENANCY_ENDED",owner,effective,reason);
        return summary(email,tenancy);
    }

    public List<Map<String,Object>> ownerTransfers(String email, UUID tenancy) {
        var stay=ownerStay(email,tenancy);
        return transfers(TRANSFER+" WHERE old_stay.application_id=? ORDER BY o.created_at DESC",id(stay,"application_id"));
    }

    public List<Map<String,Object>> residentTransfers(String email) {
        return transfers(TRANSFER+"""
             JOIN tenancies t ON t.id=x.source_tenancy_id JOIN accounts a ON a.id=t.account_id
             JOIN rooms source ON source.id=t.room_id JOIN properties p ON p.id=source.property_id
             WHERE a.email=? AND t.status='ACTIVE' AND x.status IN ('PROPOSED','ACCEPTED')
             ORDER BY o.created_at DESC
             """,email);
    }

    @Transactional
    public Map<String,Object> propose(String email, UUID source, UUID destination, long version, BigDecimal monthlyRent) {
        var stay=ownerStay(email,source);
        var room=lockRoom(destination);
        var locked=lockStay(source);
        requireActive(locked);
        if (destination.equals(id(stay,"room_id")) || !id(stay,"property_id").equals(id(room,"property_id")))
            throw new FlowException(400,"ROOM_MISMATCH","Choose a different room in the same property.");
        checkTermsVersion(room,version);
        checkCapacity(room);
        UUID owner=id(stay,"owner_id");
        cancelProposals(source,owner,"A newer transfer was proposed");
        UUID offer=agreements.transferOffer(id(stay,"application_id"),destination,owner,monthlyRent);
        UUID transfer=UUID.randomUUID();
        db.update("INSERT INTO room_transfers(id,source_tenancy_id,offer_id,status) VALUES(?,?,?,'PROPOSED')",transfer,source,offer);
        audit(transfer,"ROOM_TRANSFER_PROPOSED",owner,now(),null);
        return transfer(transfer);
    }

    @Transactional
    public Map<String,Object> accept(String email, UUID transfer) {
        var proposal=transferPointer(transfer);
        UUID source=id(proposal,"source_tenancy_id");
        UUID resident=id(one("SELECT id FROM accounts WHERE email=? AND email_verified=TRUE",email),"id");
        if (!resident.equals(id(one(STAY,source),"account_id"))) throw missing();
        var room=lockRoom(id(proposal,"destination_room_id"));
        var stay=lockStay(source);
        var latest=transferPointer(transfer);
        if ("COMPLETED".equals(latest.get("status"))) return transfer(transfer);
        requireActive(stay);
        requireOpen(latest);
        checkTermsVersion(room,((Number)latest.get("room_version")).longValue());
        if ("PROPOSED".equals(latest.get("status"))) {
            OffsetDateTime accepted=now();
            db.update("UPDATE application_offers SET accepted_by=?,accepted_at=? WHERE id=?",resident,accepted,id(latest,"offer_id"));
            db.update("UPDATE room_transfers SET status='ACCEPTED' WHERE id=?",transfer);
            audit(transfer,"ROOM_TRANSFER_ACCEPTED",resident,accepted,null);
        }
        return transfer(transfer);
    }

    @Transactional
    public Map<String,Object> complete(String email, UUID source, UUID transfer) {
        var stay=ownerStay(email,source);
        var pointer=transferPointer(transfer);
        if (!source.equals(id(pointer,"source_tenancy_id"))) throw missing();
        UUID oldRoom=id(stay,"room_id"), destination=id(pointer,"destination_room_id");
        // Both rooms use the same capacity locks as invitations and approvals.
        boolean oldFirst=oldRoom.compareTo(destination)<0;
        if (oldFirst) lockRoom(oldRoom);
        var newRoom=lockRoom(destination);
        if (!oldFirst) lockRoom(oldRoom);
        var locked=lockStay(source);
        var proposal=transferPointer(transfer);
        if ("COMPLETED".equals(proposal.get("status"))) return transfer(transfer);
        requireActive(locked);
        if (!"ACCEPTED".equals(proposal.get("status")))
            throw new FlowException(409,"TRANSFER_NOT_ACCEPTED","The resident must accept the latest transfer terms first.");
        checkTermsVersion(newRoom,((Number)proposal.get("room_version")).longValue());
        checkCapacity(newRoom);
        UUID owner=id(stay,"owner_id"), reservation=UUID.randomUUID(), next=UUID.randomUUID();
        OffsetDateTime effective=now();
        end(locked,owner,"TRANSFER","Moved to "+newRoom.get("label"),effective);
        db.update("""
            INSERT INTO reservations(id,room_id,status,created_by,created_at,updated_by,updated_at,reason)
            VALUES(?,?,'CONVERTED',?,?,?,?,'Room transfer')
            """,reservation,destination,owner,effective,owner,effective);
        db.update("""
            INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by,offer_id)
            VALUES(?,?,?,?,?,'ACTIVE',?,?,?)
            """,next,reservation,id(stay,"application_id"),id(stay,"account_id"),destination,effective,owner,id(proposal,"offer_id"));
        db.update("""
            UPDATE room_transfers SET status='COMPLETED',destination_tenancy_id=?,completed_at=?,completed_by=? WHERE id=?
            """,next,effective,owner,transfer);
        audit(transfer,"ROOM_TRANSFER_COMPLETED",owner,effective,stay.get("room_label")+" → "+newRoom.get("label"));
        return transfer(transfer);
    }

    private void end(Map<String,Object> stay, UUID owner, String kind, String reason, OffsetDateTime effective) {
        db.update("""
            UPDATE tenancies SET status='ENDED',ended_at=?,ended_by=?,end_kind=?,end_reason=? WHERE id=?
            """,effective,owner,kind,reason,id(stay,"id"));
        db.update("""
            UPDATE reservations SET status='RELEASED',updated_at=?,updated_by=?,reason=? WHERE id=?
            """,effective,owner,reason,id(stay,"reservation_id"));
    }

    private void cancelProposals(UUID tenancy, UUID owner, String reason) {
        var ids=db.queryForList("""
            SELECT id FROM room_transfers WHERE source_tenancy_id=? AND status IN ('PROPOSED','ACCEPTED')
            """,UUID.class,tenancy);
        for (UUID id : ids) {
            db.update("UPDATE room_transfers SET status='CANCELLED' WHERE id=?",id);
            audit(id,"ROOM_TRANSFER_CANCELLED",owner,now(),reason);
        }
    }

    private Map<String,Object> ownerStay(String email, UUID tenancy) {
        return one(STAY+" AND p.owner_id=(SELECT id FROM accounts WHERE email=? AND role='OWNER')",tenancy,email);
    }

    private Map<String,Object> lockRoom(UUID room) {
        return one("SELECT * FROM rooms WHERE id=? FOR UPDATE",room);
    }

    private Map<String,Object> lockStay(UUID stay) {
        return one("SELECT * FROM tenancies WHERE id=? FOR UPDATE",stay);
    }

    private Map<String,Object> transferPointer(UUID transfer) {
        return one(TRANSFER+" WHERE x.id=?",transfer);
    }

    private Map<String,Object> transfer(UUID transfer) {
        return withOffer(transferPointer(transfer));
    }

    private List<Map<String,Object>> transfers(String sql, Object... args) {
        return db.queryForList(sql,args).stream().map(this::withOffer).toList();
    }

    private Map<String,Object> withOffer(Map<String,Object> transfer) {
        transfer.put("offer",agreements.offer(id(transfer,"offer_id")));
        return transfer;
    }

    private void requireActive(Map<String,Object> stay) {
        if (!"ACTIVE".equals(stay.get("status")))
            throw new FlowException(409,"TENANCY_ENDED","This tenancy has ended. Refresh the resident record.");
    }

    private void requireOpen(Map<String,Object> proposal) {
        if (!List.of("PROPOSED","ACCEPTED").contains(proposal.get("status")))
            throw new FlowException(409,"TRANSFER_CLOSED","This proposal is closed. Review the latest transfer.");
    }

    private void checkTermsVersion(Map<String,Object> room, long version) {
        if (((Number)room.get("terms_version")).longValue()!=version)
            throw new FlowException(409,"ROOM_CHANGED","Room terms changed. The owner needs to propose the updated terms.");
    }

    private void checkCapacity(Map<String,Object> room) {
        UUID id=id(room,"id");
        int occupied=count("SELECT COUNT(*) FROM tenancies WHERE room_id=? AND status='ACTIVE'",id);
        int held=count("SELECT COUNT(*) FROM reservations WHERE room_id=? AND status='HELD'",id);
        if (occupied+held>=((Number)room.get("capacity")).intValue())
            throw new FlowException(409,"ROOM_FULL","This room has no available place. Choose another room.");
    }

    private void audit(UUID id,String event,UUID actor,OffsetDateTime time,String reason) {
        db.update("""
            INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)
            """,UUID.randomUUID(),id,event,actor,time,reason);
    }

    private Map<String,Object> one(String sql,Object... args) {
        return db.queryForList(sql,args).stream().findFirst().orElseThrow(this::missing);
    }

    private FlowException missing() {
        return new FlowException(404,"NOT_FOUND","Tenancy or transfer not found.");
    }

    private int count(String sql,UUID id) {
        return db.queryForObject(sql,Integer.class,id);
    }

    private UUID id(Map<String,Object> row,String column) {
        return UUID.fromString(row.get(column).toString());
    }

    private OffsetDateTime now() {
        return OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC);
    }
}
