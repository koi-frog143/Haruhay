package com.haruhay.backend.holding;

import com.haruhay.backend.registration.FlowException;
import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HoldingStationService {
    public record Item(
        long id, String code, String residentId, String propertyId, String residentName, String room,
        String category, String description, String sender, String depositor, String tracking,
        String slot, String received, String pin, String status, String claimed, List<String> history
    ) {}
    public record Inquiry(
        String id, String time, String name, String identity,
        String lookingFor, String purpose, String result
    ) {}
    public record InquiryResult(List<Item> matches, Inquiry inquiry) {}

    private static final String ITEM_QUERY = """
        SELECT i.id,i.application_id,i.property_id,i.category,i.description,i.sender,i.depositor,i.tracking,
               i.slot,i.pickup_pin,i.status,i.received_at,i.claimed_at,i.claimed_by,
               a.full_name AS resident_name,r.label AS room
        FROM holding_items i
        JOIN registration_applications a ON a.id=i.application_id
        JOIN tenancies t ON t.id=i.tenancy_id
        JOIN rooms r ON r.id=t.room_id
        """;
    private static final ZoneId DISPLAY_ZONE = ZoneId.of("Asia/Manila");
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("MMM d, yyyy '•' h:mm a", Locale.US).withZone(DISPLAY_ZONE);
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MMM d", Locale.US).withZone(DISPLAY_ZONE);

    private final JdbcTemplate db;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public HoldingStationService(JdbcTemplate db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    public List<Item> ownerItems(String email) {
        UUID ownerId = ownerId(email);
        return items(ITEM_QUERY + """
            JOIN properties p ON p.id=r.property_id
            WHERE i.owner_id=? AND i.status<>'DELETED'
            ORDER BY i.received_at DESC,i.id DESC
            """, ownerId, false);
    }

    public List<Item> residentItems(String email) {
        return items(ITEM_QUERY + """
            WHERE t.account_id=(SELECT id FROM accounts WHERE email=?)
              AND t.status='ACTIVE' AND i.status IN ('READY','CLAIMED')
            ORDER BY i.received_at DESC,i.id DESC
            """, email, true);
    }

    @Transactional
    public Item create(String email, HoldingStationController.CreateItem request) {
        UUID ownerId = ownerId(email);
        lockOwner(ownerId);
        Map<String, Object> tenancy = activeTenancy(ownerId, request.applicationId());
        UUID propertyId = (UUID) tenancy.get("property_id");
        ensureSlotAvailable(propertyId, request.slot(), null);
        OffsetDateTime now = OffsetDateTime.now(clock);
        String pin = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000));
        KeyHolder key = new GeneratedKeyHolder();
        db.update(connection -> {
            PreparedStatement statement = connection.prepareStatement("""
            INSERT INTO holding_items(owner_id,property_id,application_id,tenancy_id,category,description,
                sender,depositor,tracking,slot,pickup_pin,status,received_at,received_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,'READY',?,?)
            """, Statement.RETURN_GENERATED_KEYS);
            statement.setObject(1, ownerId);
            statement.setObject(2, propertyId);
            statement.setObject(3, request.applicationId());
            statement.setObject(4, tenancy.get("tenancy_id"));
            statement.setString(5, request.category().trim());
            statement.setString(6, request.description().trim());
            statement.setString(7, clean(request.sender()));
            statement.setString(8, request.depositor());
            statement.setString(9, clean(request.tracking()));
            statement.setString(10, request.slot());
            statement.setString(11, pin);
            statement.setObject(12, now);
            statement.setObject(13, ownerId);
            return statement;
        }, key);
        Number generatedId = key.getKey();
        if (generatedId == null) throw new IllegalStateException("The database did not return a holding record ID.");
        long id = generatedId.longValue();
        transaction(id, ownerId, "RECEIVED", now, "Received for " + tenancy.get("full_name") + " • Shelf " + request.slot());
        return ownerItem(id, ownerId);
    }

    @Transactional
    public Item edit(String email, long id, HoldingStationController.EditItem request) {
        UUID ownerId = ownerId(email);
        lockOwner(ownerId);
        Map<String, Object> row = ownedItem(ownerId, id, true);
        if ("DELETED".equals(row.get("status"))) throw notFound();
        if ("READY".equals(row.get("status"))) ensureSlotAvailable((UUID) row.get("property_id"), request.slot(), id);
        String oldDescription = (String) row.get("description");
        String oldSlot = (String) row.get("slot");
        String newDescription = request.description().trim();
        String newSlot = request.slot();
        if (!oldDescription.equals(newDescription) || !oldSlot.equals(newSlot)) {
            db.update("UPDATE holding_items SET description=?,slot=? WHERE id=? AND owner_id=?",
                newDescription, newSlot, id, ownerId);
            String details = oldDescription.equals(newDescription) ? "" : "Description updated";
            if (!oldSlot.equals(newSlot)) details += (details.isEmpty() ? "" : "; ") + "Shelf changed from " + oldSlot + " to " + newSlot;
            transaction(id, ownerId, "UPDATED", OffsetDateTime.now(clock), details);
        }
        return ownerItem(id, ownerId);
    }

    @Transactional
    public Item release(String email, long id, HoldingStationController.ReleaseItem request) {
        UUID ownerId = ownerId(email);
        Map<String, Object> item = ownedItem(ownerId, id, true);
        if (!"READY".equals(item.get("status"))) throw new FlowException(409, "ITEM_NOT_READY", "This item is no longer ready for pickup.");
        if (!request.verifiedId()) throw new FlowException(400, "ID_NOT_VERIFIED", "Confirm that the presented ID was checked before release.");
        if (!request.signed()) throw new FlowException(400, "RECEIPT_REQUIRED", "The claimant must confirm receipt.");
        if ("Authorized representative".equals(request.relationship()) && !request.authorized()) {
            throw new FlowException(400, "AUTHORIZATION_REQUIRED", "Confirm the resident's authorization before releasing to a representative.");
        }
        String claimant = request.claimedBy().trim();
        OffsetDateTime now = OffsetDateTime.now(clock);
        db.update("""
            UPDATE holding_items SET status='CLAIMED',claimed_at=?,claimed_by=?,relationship=?,
                id_type=?,id_last_four=?,receipt_confirmed=TRUE
            WHERE id=? AND owner_id=? AND status='READY'
            """, now, claimant, request.relationship(), request.idType().trim(),
            request.idLastFour().toUpperCase(Locale.ROOT), id, ownerId);
        transaction(id, ownerId, "RELEASED", now,
            "Released to " + claimant + " (" + request.relationship() + "); " +
            request.idType().trim() + " ending " + request.idLastFour().toUpperCase(Locale.ROOT) + "; receipt confirmed");
        return ownerItem(id, ownerId);
    }

    @Transactional
    public void archive(String email, long id) {
        UUID ownerId = ownerId(email);
        Map<String, Object> item = ownedItem(ownerId, id, true);
        if ("DELETED".equals(item.get("status"))) throw notFound();
        OffsetDateTime now = OffsetDateTime.now(clock);
        db.update("UPDATE holding_items SET status='DELETED' WHERE id=? AND owner_id=?", id, ownerId);
        transaction(id, ownerId, "ARCHIVED", now, "Record archived; transaction history retained");
    }

    @Transactional
    public InquiryResult search(String email, HoldingStationController.SearchInquiry request) {
        UUID ownerId = ownerId(email);
        UUID applicationId = request.applicationId();
        Map<String, Object> tenancy = null;
        if (applicationId != null) tenancy = activeTenancy(ownerId, applicationId);
        String tracking = clean(request.tracking());
        if (applicationId == null && tracking.isEmpty()) throw new FlowException(400, "SEARCH_REQUIRED", "Enter a resident or tracking number.");
        StringBuilder sql = new StringBuilder(ITEM_QUERY)
            .append("JOIN properties p ON p.id=r.property_id WHERE i.owner_id=? AND i.status='READY' ");
        java.util.ArrayList<Object> args = new java.util.ArrayList<>();
        args.add(ownerId);
        if (applicationId != null) {
            sql.append("AND i.application_id=? ");
            args.add(applicationId);
        }
        if (!tracking.isEmpty()) {
            sql.append("AND LOWER(i.tracking)=LOWER(?) ");
            args.add(tracking);
        }
        sql.append("ORDER BY i.received_at DESC,i.id DESC");
        List<Item> matches = items(sql.toString(), args.toArray(), false);
        String lookingFor = tenancy == null ? tracking : tenancy.get("full_name").toString();
        if (!tracking.isEmpty() && tenancy != null) lookingFor += " • " + tracking;
        String result = matches.size() + " match" + (matches.size() == 1 ? "" : "es");
        OffsetDateTime now = OffsetDateTime.now(clock);
        UUID inquiryId = UUID.randomUUID();
        db.update("""
            INSERT INTO holding_inquiries(id,owner_id,actor_id,visitor_name,id_type,id_last_four,
                looking_for,purpose,result,occurred_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """, inquiryId, ownerId, ownerId, request.visitorName().trim(), request.idType().trim(),
            request.idLastFour().toUpperCase(Locale.ROOT), lookingFor, request.purpose().trim(), result, now);
        return new InquiryResult(matches, inquiry(inquiryId, now, request.visitorName().trim(),
            request.idType().trim(), request.idLastFour(), lookingFor, request.purpose().trim(), result));
    }

    public List<Inquiry> inquiries(String email) {
        UUID ownerId = ownerId(email);
        return db.query("""
            SELECT id,occurred_at,visitor_name,id_type,id_last_four,looking_for,purpose,result
            FROM holding_inquiries WHERE owner_id=? ORDER BY occurred_at DESC,id DESC
            """, (rs, row) -> inquiry(rs), ownerId);
    }

    private List<Item> items(String sql, Object arg, boolean includePin) {
        return items(sql, new Object[]{arg}, includePin);
    }

    private List<Item> items(String sql, Object[] args, boolean includePin) {
        return db.query(sql, (rs, row) -> item(rs, includePin), args);
    }

    private Item item(ResultSet rs, boolean includePin) throws SQLException {
        long id = rs.getLong("id");
        String status = rs.getString("status");
        OffsetDateTime received = rs.getObject("received_at", OffsetDateTime.class);
        OffsetDateTime claimedAt = rs.getObject("claimed_at", OffsetDateTime.class);
        return new Item(id, code(id), rs.getObject("application_id").toString(), rs.getObject("property_id").toString(),
            rs.getString("resident_name"), rs.getString("room"), rs.getString("category"),
            rs.getString("description"), rs.getString("sender"), rs.getString("depositor"),
            rs.getString("tracking"), rs.getString("slot"), DATE_TIME.format(received),
            includePin && "READY".equals(status) ? rs.getString("pickup_pin") : null,
            "READY".equals(status) ? "Ready" : "Claimed",
            claimedAt == null ? null : DATE.format(claimedAt), history(id));
    }

    private Item ownerItem(long id, UUID ownerId) {
        return items(ITEM_QUERY + """
            JOIN properties p ON p.id=r.property_id
            WHERE i.id=? AND i.owner_id=? AND i.status<>'DELETED'
            """, new Object[]{id, ownerId}, false).stream().findFirst().orElseThrow(this::notFound);
    }

    private Map<String, Object> ownedItem(UUID ownerId, long id, boolean lock) {
        String sql = """
            SELECT i.id,i.owner_id,i.property_id,i.application_id,i.tenancy_id,i.category,
                   i.description,i.slot,i.status
            FROM holding_items i WHERE i.id=? AND i.owner_id=?
            """ + (lock ? " FOR UPDATE" : "");
        return db.query(sql, (rs, row) -> Map.<String, Object>of(
            "id", rs.getLong("id"), "owner_id", rs.getObject("owner_id", UUID.class),
            "property_id", rs.getObject("property_id", UUID.class),
            "application_id", rs.getObject("application_id", UUID.class),
            "tenancy_id", rs.getObject("tenancy_id", UUID.class),
            "category", rs.getString("category"), "description", rs.getString("description"),
            "slot", rs.getString("slot"), "status", rs.getString("status")
        ), id, ownerId).stream().findFirst().orElseThrow(this::notFound);
    }

    private Map<String, Object> activeTenancy(UUID ownerId, UUID applicationId) {
        return db.query("""
            SELECT t.id AS tenancy_id,t.account_id,r.property_id,a.id AS application_id,a.full_name
            FROM registration_applications a
            JOIN tenancies t ON t.application_id=a.id AND t.status='ACTIVE'
            JOIN rooms r ON r.id=t.room_id
            JOIN properties p ON p.id=r.property_id
            WHERE a.id=? AND p.owner_id=? AND a.status='APPROVED'
            """, (rs, row) -> Map.<String, Object>of(
                "tenancy_id", rs.getObject("tenancy_id", UUID.class),
                "account_id", rs.getObject("account_id", UUID.class),
                "property_id", rs.getObject("property_id", UUID.class),
                "application_id", rs.getObject("application_id", UUID.class),
                "full_name", rs.getString("full_name")
            ), applicationId, ownerId).stream().findFirst()
            .orElseThrow(() -> new FlowException(404, "RESIDENT_NOT_FOUND", "Choose an active resident in a property you own."));
    }

    private void ensureSlotAvailable(UUID propertyId, String slot, Long exceptId) {
        int occupied = exceptId == null
            ? db.queryForObject("SELECT count(*) FROM holding_items WHERE property_id=? AND slot=? AND status='READY'", Integer.class, propertyId, slot)
            : db.queryForObject("SELECT count(*) FROM holding_items WHERE property_id=? AND slot=? AND status='READY' AND id<>?", Integer.class, propertyId, slot, exceptId);
        if (occupied > 0) throw new FlowException(409, "SLOT_OCCUPIED", "Choose an available storage slot.");
    }

    private void lockOwner(UUID ownerId) {
        db.queryForObject("SELECT id FROM accounts WHERE id=? FOR UPDATE", UUID.class, ownerId);
    }

    private UUID ownerId(String email) {
        return db.queryForObject("SELECT id FROM accounts WHERE email=? AND role='OWNER'", UUID.class, email);
    }

    private void transaction(long itemId, UUID actorId, String event, OffsetDateTime at, String details) {
        db.update("INSERT INTO holding_item_transactions(item_id,actor_id,event_type,occurred_at,details) VALUES(?,?,?,?,?)",
            itemId, actorId, event, at, details);
    }

    private List<String> history(long id) {
        return db.query("""
            SELECT event_type,occurred_at,details FROM holding_item_transactions
            WHERE item_id=? ORDER BY id
            """, (rs, row) -> {
                String event = switch (rs.getString("event_type")) {
                    case "RECEIVED" -> "Received";
                    case "UPDATED" -> "Record updated";
                    case "RELEASED" -> "Collected";
                    case "ARCHIVED" -> "Record archived";
                    default -> rs.getString("event_type");
                };
                OffsetDateTime at = rs.getObject("occurred_at", OffsetDateTime.class);
                String details = rs.getString("details");
                return event + " • " + DATE_TIME.format(at) + (details.isEmpty() ? "" : " • " + details);
            }, id);
    }

    private Inquiry inquiry(ResultSet rs) throws SQLException {
        return inquiry(UUID.fromString(rs.getObject("id").toString()), rs.getObject("occurred_at", OffsetDateTime.class),
            rs.getString("visitor_name"), rs.getString("id_type"), rs.getString("id_last_four"),
            rs.getString("looking_for"), rs.getString("purpose"), rs.getString("result"));
    }

    private Inquiry inquiry(UUID id, OffsetDateTime at, String name, String idType, String lastFour,
                            String lookingFor, String purpose, String result) {
        return new Inquiry(id.toString(), DATE_TIME.format(at), name,
            idType + " ••••" + lastFour.toUpperCase(Locale.ROOT), lookingFor, purpose, result);
    }

    private static String code(long id) { return "HS-" + String.format(Locale.ROOT, "%04d", id); }
    private static String clean(String value) { return value == null ? "" : value.trim(); }
    private FlowException notFound() { return new FlowException(404, "NOT_FOUND", "Holding station record not found."); }
}
