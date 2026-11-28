package com.haruhay.backend.access;

import com.haruhay.backend.registration.FlowException;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ResidentAccessService {
    public enum Direction { ENTRY, EXIT }
    public record RecordMovement(@NotNull UUID tenancyId,@NotNull UUID requestId,@NotNull Direction direction,
                                 @NotBlank @Size(max=80) String entryPoint,boolean identityConfirmed) {}
    public record Amend(@Min(0) int revision,@NotNull Direction direction,@NotBlank @Size(max=80) String entryPoint,
                        boolean voided,@NotBlank @Size(max=1000) String reason) {}
    public record Resident(UUID tenancyId,String name,String propertyName,String roomLabel) {}
    public record Movement(UUID id,Direction direction,String entryPoint,String propertyName,String roomLabel,
                           boolean identityConfirmed,OffsetDateTime occurredAt) {}
    public record StaffMovement(Movement movement,String residentName,int revision,boolean voided) {}
    public record HistoryPage(List<StaffMovement> records,boolean hasNext) {}
    public record Correction(int revision,Direction direction,String entryPoint,boolean voided,String reason,
                             String correctedBy,OffsetDateTime correctedAt) {}
    public record Audit(Movement original,String recordedBy,List<Correction> corrections) {}
    private record Stay(UUID id,String status,String roomLabel) {}
    private record Existing(UUID eventId,UUID actor,Direction direction,String entryPoint) {}
    private record CorrectionSource(UUID stay,Direction direction,String entryPoint) {}

    private static final ZoneId MANILA=ZoneId.of("Asia/Manila");
    private static final int PAGE_SIZE=25;
    private static final String CURRENT="""
        FROM resident_access_events e
        JOIN tenancies t ON t.id=e.tenancy_id
        JOIN accounts resident ON resident.id=t.account_id
        JOIN properties p ON p.id=e.property_id
        LEFT JOIN resident_access_corrections c ON c.event_id=e.id AND c.revision=(
            SELECT MAX(previous.revision) FROM resident_access_corrections previous WHERE previous.event_id=e.id
        )
        """;
    private static final String DIRECTION="COALESCE(c.direction,e.direction)";
    private static final String VOIDED="COALESCE(c.voided,FALSE)";
    private static final String COLUMNS="""
        e.id,p.name AS property_name,e.room_label,e.identity_confirmed,e.occurred_at,
        COALESCE(c.direction,e.direction) AS direction,COALESCE(c.entry_point,e.entry_point) AS entry_point
        """;

    private final JdbcTemplate db;
    private final Clock clock;

    public ResidentAccessService(JdbcTemplate db,Clock clock) {
        this.db=db;
        this.clock=clock;
    }

    public List<Resident> residents(String email,UUID property,String query) {
        staff(email,property,false);
        if (query==null || query.isBlank()) return List.of();
        String term=searchTerm(query);
        return db.query("""
            SELECT t.id,a.full_name,p.name,r.label FROM tenancies t JOIN accounts a ON a.id=t.account_id
            JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=r.property_id
            WHERE p.id=? AND t.status='ACTIVE' AND
                (POSITION(? IN LOWER(a.full_name))>0 OR POSITION(? IN LOWER(r.label))>0)
            ORDER BY a.full_name,r.label,t.id LIMIT 25
            """,(row,index)->new Resident(row.getObject(1,UUID.class),row.getString(2),row.getString(3),row.getString(4)),
            property,term,term);
    }

    @Transactional
    public UUID record(String email,UUID property,RecordMovement request) {
        UUID actor=staff(email,property,false);
        if (!request.identityConfirmed()) throw new FlowException(400,"ACCESS_IDENTITY_REQUIRED","Confirm the resident’s identity first.");
        String point=entryPoint(request.entryPoint());
        // Serialize recording and corrections for a stay with move-out and transfers.
        Stay stay=lockStay(property,request.tenancyId());
        if (!"ACTIVE".equals(stay.status())) throw new FlowException(409,"ACCESS_STAY_ENDED","This stay has ended. Search for the resident’s current room.");

        var original=db.query("""
            SELECT id,recorded_by,direction,entry_point FROM resident_access_events WHERE tenancy_id=? AND request_id=?
            """,(row,index)->new Existing(row.getObject("id",UUID.class),row.getObject("recorded_by",UUID.class),
                Direction.valueOf(row.getString("direction")),row.getString("entry_point")),
            stay.id(),request.requestId()).stream().findFirst();
        if (original.isPresent()) {
            var event=original.get();
            if (event.actor().equals(actor) && event.direction()==request.direction() && event.entryPoint().equals(point)) return event.eventId();
            throw new FlowException(409,"ACCESS_REQUEST_USED","This request was already used. Start a new movement.");
        }

        String last=db.queryForList("SELECT "+DIRECTION+" "+CURRENT+
            " WHERE e.tenancy_id=? AND NOT "+VOIDED+" ORDER BY e.event_order DESC LIMIT 1",String.class,stay.id())
            .stream().findFirst().orElse(null);
        if (request.direction().name().equals(last))
            throw new FlowException(409,"ACCESS_DUPLICATE_MOVEMENT","The latest movement for this stay is already an "+(request.direction()==Direction.ENTRY?"entry.":"exit."));

        UUID id=UUID.randomUUID();
        db.update("""
            INSERT INTO resident_access_events(id,request_id,tenancy_id,property_id,room_label,direction,entry_point,
                identity_confirmed,recorded_by,occurred_at) VALUES(?,?,?,?,?,?,?,TRUE,?,?)
            """,id,request.requestId(),stay.id(),property,stay.roomLabel(),request.direction().name(),point,actor,now());
        return id;
    }

    public List<Movement> residentHistory(String email) {
        return db.query("SELECT "+COLUMNS+CURRENT+" WHERE resident.email=? AND t.status='ACTIVE' AND p.sample=FALSE AND NOT "+
            VOIDED+" ORDER BY e.occurred_at DESC,e.event_order DESC",(row,index)->movement(row),email);
    }

    public HistoryPage ownerHistory(String email,UUID property,String query,Direction direction,LocalDate from,LocalDate through,int page) {
        staff(email,property,true);
        if (page<0) throw new FlowException(400,"ACCESS_PAGE","Choose a valid history page.");
        var filter=new StringBuilder(" WHERE e.property_id=?");
        var args=new ArrayList<Object>();
        args.add(property);
        if (query!=null && !query.isBlank()) {
            filter.append(" AND (POSITION(? IN LOWER(resident.full_name))>0 OR POSITION(? IN LOWER(e.room_label))>0)");
            String term=searchTerm(query);
            args.add(term);
            args.add(term);
        }
        if (direction!=null) {
            filter.append(" AND ").append(DIRECTION).append("=?");
            args.add(direction.name());
        }
        if ((from!=null && (from.getYear()<1 || from.getYear()>9999)) ||
                (through!=null && (through.getYear()<1 || through.getYear()>9999)) ||
                (from!=null && through!=null && from.isAfter(through)))
            throw new FlowException(400,"ACCESS_DATE_RANGE","Choose a valid date range in Philippine time.");
        if (from!=null) {
            filter.append(" AND e.occurred_at>=?");
            args.add(from.atStartOfDay(MANILA).toOffsetDateTime());
        }
        if (through!=null) {
            filter.append(" AND e.occurred_at<?");
            args.add(through.plusDays(1).atStartOfDay(MANILA).toOffsetDateTime());
        }
        args.add(PAGE_SIZE+1);
        args.add((long)page*PAGE_SIZE);
        var rows=db.query("SELECT "+COLUMNS+",resident.full_name AS resident_name,"+
            "COALESCE(c.revision,0) AS revision,"+VOIDED+" AS voided "+CURRENT+
            filter+" ORDER BY e.occurred_at DESC,e.event_order DESC LIMIT ? OFFSET ?",
            (row,index)->new StaffMovement(movement(row),row.getString("resident_name"),
                row.getInt("revision"),row.getBoolean("voided")),args.toArray());
        return new HistoryPage(rows.stream().limit(PAGE_SIZE).toList(),rows.size()>PAGE_SIZE);
    }

    public Audit audit(String email,UUID property,UUID eventId) {
        staff(email,property,true);
        var original=db.query("""
            SELECT e.*,p.name AS property_name,a.full_name AS actor_name FROM resident_access_events e
            JOIN properties p ON p.id=e.property_id JOIN accounts a ON a.id=e.recorded_by
            WHERE e.id=? AND e.property_id=?
            """,(row,index)->new Audit(movement(row),row.getString("actor_name"),List.of()),eventId,property)
            .stream().findFirst().orElseThrow(this::notFound);
        return new Audit(original.original(),original.recordedBy(),corrections(eventId));
    }

    @Transactional
    public void amend(String email,UUID property,UUID eventId,Amend request) {
        UUID owner=staff(email,property,true);
        var source=db.query("SELECT tenancy_id,direction,entry_point FROM resident_access_events WHERE id=? AND property_id=?",
            (row,index)->new CorrectionSource(row.getObject(1,UUID.class),Direction.valueOf(row.getString(2)),row.getString(3)),
            eventId,property).stream().findFirst().orElseThrow(this::notFound);
        lockStay(property,source.stay());
        var history=corrections(eventId);
        var current=history.isEmpty()?null:history.getLast();
        int revision=current==null?0:current.revision();
        if (revision!=request.revision() || (current!=null && current.voided()))
            throw new FlowException(409,"ACCESS_HISTORY_CHANGED","This movement has changed. Refresh the history to review its latest version.");
        Direction direction=current==null?source.direction():current.direction();
        String point=current==null?source.entryPoint():current.entryPoint();
        if (!request.voided()) {
            String correctedPoint=entryPoint(request.entryPoint());
            if (direction==request.direction() && point.equals(correctedPoint))
                throw new FlowException(400,"ACCESS_CORRECTION_EMPTY","Change the direction or entry point, or void the movement.");
            direction=request.direction();
            point=correctedPoint;
        }
        db.update("""
            INSERT INTO resident_access_corrections(event_id,revision,direction,entry_point,voided,reason,corrected_by,corrected_at)
            VALUES(?,?,?,?,?,?,?,?)
            """,eventId,revision+1,direction.name(),point,request.voided(),request.reason().strip(),owner,now());
    }

    private List<Correction> corrections(UUID eventId) {
        return db.query("""
            SELECT c.*,a.full_name FROM resident_access_corrections c JOIN accounts a ON a.id=c.corrected_by
            WHERE c.event_id=? ORDER BY c.revision
            """,(row,index)->new Correction(row.getInt("revision"),Direction.valueOf(row.getString("direction")),
                row.getString("entry_point"),row.getBoolean("voided"),row.getString("reason"),row.getString("full_name"),
                row.getObject("corrected_at",OffsetDateTime.class)),eventId);
    }

    private UUID staff(String email,UUID property,boolean ownerOnly) {
        return db.query("""
            SELECT a.id FROM accounts a JOIN properties p ON p.id=? WHERE a.email=? AND p.sample=FALSE AND
                ((a.role='OWNER' AND p.owner_id=a.id) OR (?=FALSE AND EXISTS(
                    SELECT 1 FROM property_guard_assignments g WHERE g.account_id=a.id AND g.property_id=p.id AND g.enabled=TRUE
                )))
            """,(row,index)->row.getObject(1,UUID.class),property,email,ownerOnly).stream().findFirst()
            .orElseThrow(()->new FlowException(403,"ACCESS_PROPERTY_SCOPE","You are not authorized for this property or action."));
    }

    private Stay lockStay(UUID property,UUID tenancy) {
        return db.query("""
            SELECT t.id,t.status,(SELECT r.label FROM rooms r WHERE r.id=t.room_id) AS room_label FROM tenancies t
            WHERE t.id=? AND EXISTS(SELECT 1 FROM rooms r WHERE r.id=t.room_id AND r.property_id=?) FOR UPDATE
            """,(row,index)->new Stay(row.getObject("id",UUID.class),row.getString("status"),row.getString("room_label")),
            tenancy,property).stream().findFirst().orElseThrow(this::notFound);
    }

    private Movement movement(ResultSet row) throws SQLException {
        return new Movement(row.getObject("id",UUID.class),Direction.valueOf(row.getString("direction")),
            row.getString("entry_point"),row.getString("property_name"),row.getString("room_label"),
            row.getBoolean("identity_confirmed"),row.getObject("occurred_at",OffsetDateTime.class));
    }

    private String searchTerm(String query) {
        if (query.length()>100) throw new FlowException(400,"ACCESS_SEARCH","Search for a name or room using up to 100 characters.");
        return query.strip().toLowerCase(Locale.ROOT);
    }

    private String entryPoint(String value) {
        if (value.codePoints().anyMatch(Character::isISOControl))
            throw new FlowException(400,"ACCESS_ENTRY_POINT","Enter a single-line entry point.");
        return value.strip();
    }

    private OffsetDateTime now() { return clock.instant().atOffset(ZoneOffset.UTC); }
    private FlowException notFound() { return new FlowException(404,"ACCESS_NOT_FOUND","Movement or tenancy not found for this property."); }
}
