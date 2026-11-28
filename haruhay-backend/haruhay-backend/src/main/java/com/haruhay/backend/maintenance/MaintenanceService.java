package com.haruhay.backend.maintenance;

import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.settings.PropertySettingsAudit;
import com.haruhay.backend.settings.PropertySettingsAudit.Action;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MaintenanceService {
    private static final String VIEW = """
        SELECT t.id,t.number,t.property_id,t.resident_id,t.category,t.description,t.location,t.priority,t.status,
               t.shared_area,t.version,t.submitted_at,t.updated_at,t.archived_at,p.name AS property_name,
               r.label AS room_label,c.label AS category_label,a.full_name AS resident_name,
               x.id AS assignment_id,x.technician_id,s.full_name AS technician_name,
               COALESCE(m.enabled,FALSE) AS technician_enabled,p.owner_id,
               EXISTS(SELECT 1 FROM tenancies active_stay WHERE active_stay.application_id=original.application_id
                   AND active_stay.status='ACTIVE') AS resident_can_update
        FROM maintenance_tickets t
        JOIN tenancies original ON original.id=t.tenancy_id
        JOIN properties p ON p.id=t.property_id JOIN rooms r ON r.id=t.room_id
        JOIN maintenance_categories c ON c.code=t.category JOIN accounts a ON a.id=t.resident_id
        LEFT JOIN maintenance_assignments x ON x.active_ticket=t.id
        LEFT JOIN maintenance_staff m ON m.account_id=x.technician_id AND m.property_id=t.property_id
        LEFT JOIN accounts s ON s.id=x.technician_id
        """;

    private final JdbcTemplate db;
    private final Clock clock;
    private final PasswordEncoder passwords;

    private final PropertySettingsAudit settingsAudit;

    public MaintenanceService(JdbcTemplate db, Clock clock, PasswordEncoder passwords, PropertySettingsAudit settingsAudit) {
        this.db=db;
        this.clock=clock;
        this.passwords=passwords;
        this.settingsAudit=settingsAudit;
    }

    public record Report(UUID requestKey, UUID tenancyId, String category, String description, boolean sharedArea, String location) {}
    public record Change(Integer version, String action, UUID technicianId, String priority, String note, String materials) {}
    public record Note(String message) {}
    public record Staff(String name, String email, String password) {
        @Override public String toString() { return "Staff[REDACTED]"; }
    }
    public record StaffStatus(boolean enabled) {}
    public record Photo(String type, byte[] data) {
        @Override public String toString() { return "Photo[type=" + type + "]"; }
    }
    private enum Role { OWNER, TECHNICIAN, RESIDENT }
    private record Actor(UUID id, Role role) {}

    private OffsetDateTime now() { return clock.instant().atOffset(ZoneOffset.UTC); }
    private FlowException error(int status, String code, String message) { return new FlowException(status,code,message); }
    private FlowException forbidden() { return error(403,"MAINTENANCE_ACCESS","You do not have access to this maintenance record."); }
    private FlowException missing() { return error(404,"MAINTENANCE_MISSING","Maintenance record not found."); }
    private FlowException stateError() { return error(409,"MAINTENANCE_STATE","This action is unavailable for the current ticket status. Refresh the ticket and try again."); }

    private List<Map<String,Object>> rows(String sql, Object... args) {
        var result=db.queryForList(sql,args);
        result.forEach(row -> row.replaceAll((key,value) -> value instanceof Timestamp time ? time.toInstant().atOffset(ZoneOffset.UTC) : value));
        return result;
    }
    private Map<String,Object> one(String sql, Object... args) {
        return rows(sql,args).stream().findFirst().orElseThrow(this::missing);
    }
    private boolean exists(String sql, Object... args) { return Boolean.TRUE.equals(db.queryForObject(sql,Boolean.class,args)); }
    private UUID id(Map<String,Object> row, String field) { return (UUID)row.get(field); }
    private String required(String value, int max, String label) {
        if (value==null || value.isBlank() || value.trim().length()>max)
            throw error(400,"MAINTENANCE_INPUT","Enter "+label+" using 1–"+max+" characters.");
        return value.trim();
    }
    private String optional(String value, int max, String label) {
        return value==null || value.isBlank() ? null : required(value,max,label);
    }

    private Actor actor(String email) {
        var account=one("SELECT id,role FROM accounts WHERE email=?",email);
        UUID user=id(account,"id");
        if ("OWNER".equals(account.get("role"))) return new Actor(user,Role.OWNER);
        if (exists("SELECT EXISTS(SELECT 1 FROM maintenance_staff WHERE account_id=? AND enabled=TRUE)",user))
            return new Actor(user,Role.TECHNICIAN);
        if (exists("""
            SELECT EXISTS(SELECT 1 FROM maintenance_staff WHERE account_id=?)
                OR EXISTS(SELECT 1 FROM property_guard_assignments WHERE account_id=?)
            """,user,user)) throw forbidden();
        if (exists("SELECT EXISTS(SELECT 1 FROM tenancies WHERE account_id=? AND status='ACTIVE')",user))
            return new Actor(user,Role.RESIDENT);
        throw forbidden();
    }
    private void requireOwner(Actor actor, UUID property) {
        if (actor.role()!=Role.OWNER || !exists("SELECT EXISTS(SELECT 1 FROM properties WHERE id=? AND owner_id=?)",property,actor.id()))
            throw forbidden();
    }
    private String visible(Actor actor) {
        return switch (actor.role()) {
            case OWNER -> "p.owner_id=?";
            case RESIDENT -> "t.resident_id=?";
            case TECHNICIAN -> "x.technician_id=? AND m.enabled=TRUE";
        };
    }
    private Map<String,Object> view(Map<String,Object> ticket) {
        ticket.put("ticket_number","TCK-"+ticket.remove("number"));
        ticket.put("needs_assignment",!Set.of("READY","CLOSED","CANCELLED").contains(ticket.get("status"))
            && !Boolean.TRUE.equals(ticket.get("technician_enabled")));
        ticket.remove("owner_id");
        ticket.remove("technician_enabled");
        return ticket;
    }
    public List<Map<String,Object>> categories(String email) {
        actor(email);
        return rows("SELECT code,label FROM maintenance_categories ORDER BY CASE WHEN code='OTHER' THEN 1 ELSE 0 END,label");
    }
    public List<Map<String,Object>> locations(String email) {
        Actor actor=actor(email);
        if (actor.role()!=Role.RESIDENT) throw forbidden();
        return rows("""
            SELECT t.id,p.name AS property_name,r.label AS room_label FROM tenancies t
            JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=r.property_id
            WHERE t.account_id=? AND t.status='ACTIVE' ORDER BY p.name,r.label
            """,actor.id());
    }
    public List<Map<String,Object>> list(String email) {
        Actor actor=actor(email);
        return rows(VIEW+"WHERE "+visible(actor)+" ORDER BY t.updated_at DESC,t.id",actor.id()).stream().map(this::view).toList();
    }
    private Map<String,Object> ticket(Actor actor, UUID id) {
        return one(VIEW+"WHERE t.id=? AND "+visible(actor),id,actor.id());
    }
    @Transactional(readOnly=true)
    public Map<String,Object> detail(String email, UUID id) {
        var result=view(ticket(actor(email),id));
        result.put("activity",rows("""
            SELECT e.id,e.kind,e.message,e.occurred_at,a.full_name AS actor,c.materials
            FROM maintenance_activity e JOIN accounts a ON a.id=e.actor_id
            LEFT JOIN maintenance_completions c ON c.activity_id=e.id
            WHERE e.ticket_id=? ORDER BY e.id
            """,id));
        result.put("photos",rows("SELECT id,uploaded_at FROM maintenance_photos WHERE ticket_id=? ORDER BY uploaded_at,id",id));
        return result;
    }

    private long event(UUID ticket, UUID actor, String kind, String note, OffsetDateTime at) {
        var key=new GeneratedKeyHolder();
        db.update(connection -> {
            var statement=connection.prepareStatement("""
                INSERT INTO maintenance_activity(ticket_id,actor_id,kind,message,occurred_at) VALUES(?,?,?,?,?)
                """,new String[]{"id"});
            statement.setObject(1,ticket);
            statement.setObject(2,actor);
            statement.setString(3,kind);
            statement.setString(4,note);
            statement.setObject(5,at);
            return statement;
        },key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }
    private void notify(UUID ticket, UUID recipient, String message, OffsetDateTime at) {
        db.update("INSERT INTO maintenance_notifications(id,ticket_id,recipient_id,message,created_at) VALUES(?,?,?,?,?)",
            UUID.randomUUID(),ticket,recipient,message,at);
    }
    @Transactional
    public UUID report(String email, Report request) {
        Actor actor=actor(email);
        if (actor.role()!=Role.RESIDENT) throw forbidden();
        if (request.requestKey()==null || request.tenancyId()==null)
            throw error(400,"MAINTENANCE_INPUT","Choose where the issue occurred and retry submission.");
        String text=required(request.description(),2000,"a description");
        String category=required(request.category(),32,"a category");
        String area=request.sharedArea()?required(request.location(),200,"a shared-area location"):null;
        // Lock the stay first so moving to another room and reporting against this stay serialize.
        one("SELECT id FROM tenancies WHERE id=? AND account_id=? FOR UPDATE",request.tenancyId(),actor.id());
        // The account lock serializes retries across stays and sessions.
        one("SELECT id FROM accounts WHERE id=? FOR UPDATE",actor.id());
        var previous=rows("""
            SELECT id,tenancy_id,category,description,shared_area,location FROM maintenance_tickets
            WHERE resident_id=? AND request_key=?
            """,actor.id(),request.requestKey());
        if (!previous.isEmpty()) {
            var original=previous.getFirst();
            if (!request.tenancyId().equals(original.get("tenancy_id")) || !category.equals(original.get("category"))
                || !text.equals(original.get("description")) || !Boolean.valueOf(request.sharedArea()).equals(original.get("shared_area"))
                || (request.sharedArea() && !area.equals(original.get("location"))))
                throw error(409,"MAINTENANCE_REQUEST_KEY","This submission was already used. Open your ticket list before reporting another issue.");
            return id(original,"id");
        }
        if (!exists("SELECT EXISTS(SELECT 1 FROM maintenance_categories WHERE code=?)",category))
            throw error(400,"MAINTENANCE_CATEGORY","Choose an available category.");
        var stay=one("""
            SELECT r.id AS room_id,r.label,p.id AS property_id,p.owner_id FROM tenancies t
            JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=r.property_id
            WHERE t.id=? AND t.account_id=? AND t.status='ACTIVE'
            """,request.tenancyId(),actor.id());
        UUID ticket=UUID.randomUUID();
        var at=now();
        db.update("""
            INSERT INTO maintenance_tickets(id,request_key,resident_id,tenancy_id,property_id,room_id,
                category,description,shared_area,location,priority,status,submitted_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,'ROUTINE','SUBMITTED',?,?)
            """,ticket,request.requestKey(),actor.id(),request.tenancyId(),id(stay,"property_id"),id(stay,"room_id"),
            category,text,request.sharedArea(),request.sharedArea()?area:stay.get("label"),at,at);
        event(ticket,actor.id(),"SUBMITTED",null,at);
        notify(ticket,id(stay,"owner_id"),"New maintenance request",at);
        return ticket;
    }

    private boolean available(UUID property, UUID technician) {
        return technician!=null && exists("SELECT EXISTS(SELECT 1 FROM maintenance_staff WHERE account_id=? AND property_id=? AND enabled=TRUE)",technician,property);
    }
    private void endAssignment(UUID ticket, OffsetDateTime at) {
        db.update("UPDATE maintenance_assignments SET active_ticket=NULL,ended_at=? WHERE active_ticket=?",at,ticket);
    }
    private void transition(UUID ticket, String status, OffsetDateTime at) {
        db.update("""
            UPDATE maintenance_tickets SET status=?,version=version+1,updated_at=?,archived_at=?
            WHERE id=?
            """,status,at,Set.of("CLOSED","CANCELLED").contains(status)?at:null,ticket);
    }
    private boolean terminal(String status) { return Set.of("CLOSED","CANCELLED").contains(status); }

    private Map<String,Object> lock(Actor actor, UUID id) {
        // Check visibility before acquiring the lock, then check it again after a concurrent reassignment.
        ticket(actor,id);
        one("SELECT id FROM maintenance_tickets WHERE id=? FOR UPDATE",id);
        var ticket=ticket(actor,id);
        requireOpenStay(actor,ticket);
        return ticket;
    }
    private void requireOpenStay(Actor actor,Map<String,Object> ticket) {
        if (actor.role()==Role.RESIDENT && !Boolean.TRUE.equals(ticket.get("resident_can_update")))
            throw error(403,"MAINTENANCE_STAY_ENDED","The property team can continue working on this request after the stay ends.");
    }
    @Transactional
    public void change(String email, UUID id, Change change) {
        Actor actor=actor(email);
        var ticket=lock(actor,id);
        if (change.version()==null || !change.version().equals(ticket.get("version")))
            throw error(409,"MAINTENANCE_STALE","This ticket changed since you opened it. Refresh before saving.");
        String status=(String)ticket.get("status");
        String action=required(change.action(),24,"a ticket action");
        var at=now();
        UUID property=id(ticket,"property_id"),technician=id(ticket,"technician_id");
        switch (action) {
            case "ASSIGN" -> assign(actor,ticket,change,at);
            case "ESCALATE" -> {
                requireOwner(actor,property);
                if (terminal(status) || !"CRITICAL".equals(ticket.get("priority")) || !available(property,technician))
                    throw error(409,"MAINTENANCE_ESCALATION","Assign an available technician to this critical ticket before recording an escalation.");
                String note=required(change.note(),1000,"the external escalation details");
                transition(id,status,at);
                event(id,actor.id(),"ESCALATED",note,at);
            }
            case "START" -> {
                requireTechnician(actor,ticket);
                if (!"ASSIGNED".equals(status)) throw stateError();
                db.update("UPDATE maintenance_assignments SET started_at=? WHERE active_ticket=? AND started_at IS NULL",at,id);
                transition(id,"IN_PROGRESS",at);
                event(id,actor.id(),"STARTED",null,at);
            }
            case "PROGRESS" -> {
                requireTechnician(actor,ticket);
                if (!"IN_PROGRESS".equals(status)) throw stateError();
                String note=required(change.note(),2000,"a progress update");
                transition(id,status,at);
                event(id,actor.id(),"PROGRESS",note,at);
            }
            case "READY" -> {
                requireTechnician(actor,ticket);
                if (!"IN_PROGRESS".equals(status)) throw stateError();
                String note=required(change.note(),2000,"a completion note");
                String materials=optional(change.materials(),500,"materials used");
                long activity=event(id,actor.id(),"READY",note,at);
                db.update("INSERT INTO maintenance_completions(activity_id,assignment_id,materials) VALUES(?,?,?)",
                    activity,id(ticket,"assignment_id"),materials);
                transition(id,"READY",at);
                notify(id,id(ticket,"resident_id"),"Your repair is ready to confirm",at);
            }
            case "REOPEN" -> {
                if (actor.role()!=Role.RESIDENT) throw forbidden();
                if (!"READY".equals(status)) throw stateError();
                String note=required(change.note(),1000,"what still needs attention");
                boolean assigned=available(property,technician);
                if (!assigned) endAssignment(id,at);
                transition(id,assigned?"IN_PROGRESS":"SUBMITTED",at);
                event(id,actor.id(),"REOPENED",note,at);
                notify(id,assigned?technician:id(ticket,"owner_id"),"A maintenance ticket was reopened",at);
            }
            case "CLOSE" -> {
                if (actor.role()==Role.TECHNICIAN) throw forbidden();
                if (!"READY".equals(status)) throw stateError();
                String note=actor.role()==Role.OWNER?required(change.note(),1000,"how the repair was verified"):null;
                endAssignment(id,at);
                transition(id,"CLOSED",at);
                event(id,actor.id(),"CLOSED",note,at);
            }
            case "CANCEL" -> {
                if (actor.role()==Role.TECHNICIAN) throw forbidden();
                if (terminal(status) || (actor.role()==Role.RESIDENT && !Set.of("SUBMITTED","ASSIGNED").contains(status)))
                    throw stateError();
                String note=required(change.note(),1000,"why this request is being cancelled");
                endAssignment(id,at);
                transition(id,"CANCELLED",at);
                event(id,actor.id(),"CANCELLED",note,at);
            }
            default -> throw error(400,"MAINTENANCE_ACTION","Choose an available ticket action.");
        }
    }
    private void requireTechnician(Actor actor, Map<String,Object> ticket) {
        if (actor.role()!=Role.TECHNICIAN || !actor.id().equals(ticket.get("technician_id"))) throw forbidden();
    }
    private void assign(Actor actor, Map<String,Object> ticket, Change change, OffsetDateTime at) {
        UUID property=id(ticket,"property_id"),id=id(ticket,"id");
        requireOwner(actor,property);
        String status=(String)ticket.get("status");
        if (!Set.of("SUBMITTED","ASSIGNED","IN_PROGRESS").contains(status)) throw stateError();
        UUID previous=id(ticket,"technician_id"),next=change.technicianId();
        String priority=required(change.priority(),12,"a priority");
        if (!Set.of("ROUTINE","HIGH","CRITICAL").contains(priority))
            throw error(400,"MAINTENANCE_PRIORITY","Choose Routine, High or Critical.");
        if (!available(property,next)) throw error(400,"MAINTENANCE_STAFF","Choose an enabled technician for this property.");
        boolean changed=!next.equals(previous);
        String priorityLabel=switch (priority) { case "HIGH" -> "High"; case "CRITICAL" -> "Critical"; default -> "Routine"; };
        if (!changed) {
            if (priority.equals(ticket.get("priority"))) return;
            db.update("UPDATE maintenance_tickets SET priority=? WHERE id=?",priority,id);
            transition(id,status,at);
            event(id,actor.id(),"PRIORITY_CHANGED","Priority set to "+priorityLabel+".",at);
            return;
        }
        String reason=previous==null?null:required(change.note(),1000,"a reassignment reason");
        endAssignment(id,at);
        db.update("""
            INSERT INTO maintenance_assignments(id,ticket_id,technician_id,assigned_by,reason,assigned_at,active_ticket)
            VALUES(?,?,?,?,?,?,?)
            """,UUID.randomUUID(),id,next,actor.id(),reason,at,id);
        db.update("UPDATE maintenance_tickets SET priority=? WHERE id=?",priority,id);
        transition(id,"ASSIGNED",at);
        String name=(String)one("SELECT full_name FROM accounts WHERE id=?",next).get("full_name");
        event(id,actor.id(),previous==null?"ASSIGNED":"REASSIGNED",name+" · "+priorityLabel+" priority."+(reason==null?"":" "+reason),at);
        notify(id,next,"A maintenance job was assigned to you",at);
        notify(id,id(ticket,"resident_id"),previous==null?"A technician was assigned to your request":"Your request has a new technician",at);
    }

    @Transactional
    public void comment(String email, UUID id, Note request) {
        Actor actor=actor(email);
        var ticket=lock(actor,id);
        if (terminal((String)ticket.get("status"))) throw stateError();
        var at=now();
        event(id,actor.id(),"COMMENT",required(request.message(),2000,"a comment"),at);
        db.update("UPDATE maintenance_tickets SET updated_at=? WHERE id=?",at,id);
    }

    public List<Map<String,Object>> staff(String email, UUID property) {
        requireOwner(actor(email),property);
        return rows("""
            SELECT a.id,a.full_name,a.email,s.enabled FROM maintenance_staff s JOIN accounts a ON a.id=s.account_id
            WHERE s.property_id=? ORDER BY a.full_name,a.id
            """,property);
    }
    @Transactional
    public void createStaff(String email, UUID property, Staff request) {
        Actor actor=actor(email);
        requireOwner(actor,property);
        String address=required(request.email(),254,"an email").toLowerCase(Locale.ROOT);
        if (!address.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw error(400,"MAINTENANCE_INPUT","Enter a valid email address.");
        String password=request.password();
        if (password==null || password.length()<12 || password.getBytes(StandardCharsets.UTF_8).length>72)
            throw error(400,"MAINTENANCE_INPUT","Use at least 12 characters and at most 72 UTF-8 bytes.");
        String name=required(request.name(),100,"a technician name");
        UUID id=UUID.randomUUID();
        var at=now();
        try {
            db.update("""
                INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at)
                VALUES(?,?,?,?,'','APPLICANT',TRUE,?)
                """,id,address,passwords.encode(password),name,at);
        } catch (DuplicateKeyException ex) {
            throw error(409,"MAINTENANCE_STAFF","This email already has a Haruhay account. Use a dedicated technician email.");
        }
        db.update("INSERT INTO maintenance_staff(account_id,property_id,created_by,created_at) VALUES(?,?,?,?)",id,property,actor.id(),at);
        settingsAudit.record(property,actor.id(),Action.TECHNICIAN_CREATED,name+" · Enabled");
    }
    @Transactional
    public void staffStatus(String email, UUID property, UUID staff, StaffStatus status) {
        Actor owner=actor(email);
        requireOwner(owner,property);
        var current=one("SELECT enabled FROM maintenance_staff WHERE account_id=? AND property_id=? FOR UPDATE",staff,property);
        if (Boolean.valueOf(status.enabled()).equals(current.get("enabled"))) return;
        db.update("UPDATE maintenance_staff SET enabled=? WHERE account_id=? AND property_id=?",status.enabled(),staff,property);
        String name=db.queryForObject("SELECT full_name FROM accounts WHERE id=?",String.class,staff);
        settingsAudit.record(property,owner.id(),Action.TECHNICIAN_UPDATED,name+" · "+(status.enabled()?"Enabled":"Disabled"));
    }

    private static final String NOTICES = """
        FROM maintenance_notifications n
        JOIN maintenance_tickets t ON t.id=n.ticket_id JOIN properties p ON p.id=t.property_id
        JOIN tenancies original ON original.id=t.tenancy_id
        WHERE n.recipient_id=? AND
        """;

    private String noticeVisibility(Actor actor) {
        return switch (actor.role()) {
            case OWNER -> "p.owner_id=n.recipient_id";
            case RESIDENT -> """
                t.resident_id=n.recipient_id AND EXISTS(SELECT 1 FROM tenancies current_stay
                  WHERE current_stay.application_id=original.application_id
                    AND current_stay.account_id=n.recipient_id AND current_stay.status='ACTIVE')
                """;
            case TECHNICIAN -> """
                EXISTS(SELECT 1 FROM maintenance_assignments x JOIN maintenance_staff s ON s.account_id=x.technician_id
                    WHERE x.active_ticket=t.id AND x.technician_id=n.recipient_id AND s.enabled=TRUE)
                """;
        };
    }
    public List<Map<String,Object>> notifications(String email) {
        Actor actor=actor(email);
        return rows("SELECT n.id,n.ticket_id,n.message,n.created_at,n.read_at "+NOTICES+noticeVisibility(actor)
            +" ORDER BY n.created_at DESC,n.id LIMIT 100",actor.id());
    }
    @Transactional
    public void readNotifications(String email, UUID notice) {
        Actor actor=actor(email);
        String update="UPDATE maintenance_notifications SET read_at=? WHERE read_at IS NULL AND id IN ("
            +"SELECT n.id "+NOTICES+noticeVisibility(actor);
        if (notice==null) {
            db.update(update+")",now(),actor.id());
        } else {
            db.update(update+" AND n.id=?)",now(),actor.id(),notice);
        }
    }

    public void checkUpload(String email, UUID ticketId) {
        Actor actor=actor(email);
        var ticket=ticket(actor,ticketId);
        requireOpenStay(actor,ticket);
        if (terminal((String)ticket.get("status"))) throw stateError();
    }
    @Transactional
    public UUID addPhoto(String email, UUID ticketId, Photo photo) {
        Actor actor=actor(email);
        var ticket=lock(actor,ticketId);
        if (terminal((String)ticket.get("status"))) throw stateError();
        if (db.queryForObject("SELECT count(*) FROM maintenance_photos WHERE ticket_id=?",Integer.class,ticketId)>=4)
            throw error(409,"MAINTENANCE_PHOTOS","This ticket already has four photos.");
        UUID id=UUID.randomUUID();
        var at=now();
        db.update("INSERT INTO maintenance_photos(id,ticket_id,uploaded_by,uploaded_at,content_type,content) VALUES(?,?,?,?,?,?)",
            id,ticketId,actor.id(),at,photo.type(),photo.data());
        event(ticketId,actor.id(),"PHOTO_ADDED",null,at);
        return id;
    }
    @Transactional(readOnly=true)
    public Photo photo(String email, UUID ticketId, UUID photoId) {
        Actor actor=actor(email);
        return db.query("""
            SELECT f.content_type,f.content FROM maintenance_photos f JOIN maintenance_tickets t ON t.id=f.ticket_id
            JOIN properties p ON p.id=t.property_id
            LEFT JOIN maintenance_assignments x ON x.active_ticket=t.id
            LEFT JOIN maintenance_staff m ON m.account_id=x.technician_id AND m.property_id=t.property_id
            WHERE f.id=? AND t.id=? AND
            """+visible(actor),(row,index)->new Photo(row.getString(1),row.getBytes(2)),photoId,ticketId,actor.id())
            .stream().findFirst().orElseThrow(this::missing);
    }
}
