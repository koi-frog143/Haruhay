package com.haruhay.backend.support;

import com.haruhay.backend.registration.FlowException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ResidentSupportService {
    public enum Status { OPEN, WAITING_FOR_RESIDENT, RESOLVED }
    public enum Role { OWNER, RESIDENT }
    public record Create(@NotNull UUID requestId,@NotNull UUID propertyId,
                         @NotBlank @Size(max=100) String subject,@NotBlank @Size(max=1000) String message) {}
    public record Reply(@NotNull UUID requestId,@NotBlank @Size(max=1000) String message) {}
    public record Change(@NotNull UUID requestId,@NotNull Status expectedStatus,@NotNull Status status) {}
    public record Summary(UUID id,UUID propertyId,String propertyName,String residentName,String subject,
                          Status status,OffsetDateTime createdAt,OffsetDateTime updatedAt) {}
    public record Event(long id,String author,Role authorRole,String message,Status previousStatus,Status newStatus,OffsetDateTime occurredAt) {}
    public record Detail(Summary request,List<Event> events) {}
    public record Page(List<Summary> requests,boolean hasNext) {}
    private record Actor(UUID id,Role role) {}
    private record Locked(UUID property,Status status) {}
    private record SavedEvent(String message,Status previous,Status next) {}
    private static final int PAGE_SIZE=25;

    private static final String STAY="""
        FROM tenancies t JOIN rooms r ON r.id=t.room_id
        WHERE t.account_id=? AND t.status='ACTIVE' AND
        """;
    private static final String RESIDENT_SCOPE="""
        s.resident_id=? AND EXISTS(
            SELECT 1
        """+STAY+" r.property_id=s.property_id)";
    private static final String OWNER_SCOPE="p.owner_id=?";
    private static final String SUMMARY="""
        SELECT s.*,p.name AS property_name,a.full_name AS resident_name
        FROM support_threads s JOIN properties p ON p.id=s.property_id JOIN accounts a ON a.id=s.resident_id
        WHERE p.sample=FALSE AND
        """;
    private final JdbcTemplate db;
    private final Clock clock;

    public ResidentSupportService(JdbcTemplate db,Clock clock) {
        this.db=db;
        this.clock=clock;
    }

    public List<Summary> mine(String email) {
        Actor resident=actor(email,Role.RESIDENT);
        return db.query(SUMMARY+RESIDENT_SCOPE+" ORDER BY s.updated_at DESC,s.id DESC",
            this::summary,resident.id(),resident.id());
    }

    public Page ownerInbox(String email,UUID property,String query,Status status,int page) {
        Actor owner=actor(email,Role.OWNER);
        if (db.queryForObject("SELECT COUNT(*) FROM properties WHERE id=? AND owner_id=? AND sample=FALSE",
                Integer.class,property,owner.id())==0) throw missing();
        if (page<0 || (query!=null && query.length()>100))
            throw new FlowException(400,"SUPPORT_FILTER","Enter up to 100 characters and choose a valid page.");
        String term=query==null?"":query.strip().toLowerCase(Locale.ROOT);
        // A nonempty literal term avoids treating user-entered '%' or '_' as wildcards.
        var rows=db.query(SUMMARY+OWNER_SCOPE+" "+"""
            AND p.id=? AND (?='' OR POSITION(? IN LOWER(s.subject))>0 OR POSITION(? IN LOWER(a.full_name))>0)
            AND (?='' OR s.status=?)
            ORDER BY s.updated_at DESC,s.id DESC LIMIT ? OFFSET ?
            """,this::summary,owner.id(),property,term,term,term,status==null?"":status.name(),status==null?"":status.name(),
            PAGE_SIZE+1,(long)page*PAGE_SIZE);
        return new Page(rows.stream().limit(PAGE_SIZE).toList(),rows.size()>PAGE_SIZE);
    }

    public Detail detail(String email,Role role,UUID id) {
        return detail(actor(email,role),id);
    }

    @Transactional
    public Detail create(String email,Create request) {
        Actor resident=actor(email,Role.RESIDENT);
        String subject=request.subject().strip();
        String message=request.message().strip();
        db.queryForList("SELECT id FROM accounts WHERE id=? FOR UPDATE",UUID.class,resident.id());
        requireActiveStay(resident.id(),request.propertyId());
        var prior=db.query(SUMMARY+"s.resident_id=? AND s.request_id=?",this::summary,resident.id(),request.requestId()).stream().findFirst();
        if (prior.isPresent()) {
            var saved=prior.get();
            var first=existing(saved.id(),resident,request.requestId()).orElseThrow(this::missing);
            if (!saved.propertyId().equals(request.propertyId()) || !saved.subject().equals(subject) || !message.equals(first.message()))
                throw requestUsed();
            return detail(resident,saved.id());
        }

        UUID id=UUID.randomUUID();
        OffsetDateTime now=now();
        db.update("""
            INSERT INTO support_threads(id,property_id,resident_id,request_id,subject,status,created_at,updated_at)
            VALUES(?,?,?,?,?,'OPEN',?,?)
            """,id,request.propertyId(),resident.id(),request.requestId(),subject,now,now);
        append(id,resident,request.requestId(),message,null,null,now);
        return detail(resident,id);
    }

    @Transactional
    public Detail reply(String email,Role role,UUID id,Reply request) {
        Actor actor=actor(email,role);
        Locked current=lock(actor,id);
        String message=request.message().strip();
        var prior=existing(id,actor,request.requestId());
        if (prior.isPresent()) {
            if (!message.equals(prior.get().message())) throw requestUsed();
            return detail(actor,id);
        }
        if (current.status()==Status.RESOLVED)
            throw new FlowException(409,"SUPPORT_RESOLVED","Reopen the request before sending another reply.");
        boolean answered=role==Role.RESIDENT && current.status()==Status.WAITING_FOR_RESIDENT;
        append(id,actor,request.requestId(),message,answered?current.status():null,answered?Status.OPEN:null,now());
        return detail(actor,id);
    }

    @Transactional
    public Detail change(String email,Role role,UUID id,Change request) {
        Actor actor=actor(email,role);
        Locked current=lock(actor,id);
        var prior=existing(id,actor,request.requestId());
        if (prior.isPresent()) {
            var event=prior.get();
            if (event.message()!=null || event.previous()!=request.expectedStatus() || event.next()!=request.status()) throw requestUsed();
            return detail(actor,id);
        }
        if (current.status()!=request.expectedStatus())
            throw new FlowException(409,"SUPPORT_STATUS_CHANGED","The request status changed. Refresh the conversation and try again.");
        boolean reopening=current.status()==Status.RESOLVED && request.status()==Status.OPEN;
        boolean ownerUpdate=role==Role.OWNER && current.status()!=Status.RESOLVED && current.status()!=request.status();
        if (!reopening && !ownerUpdate)
            throw new FlowException(409,"SUPPORT_STATUS_ACTION","This status change is unavailable.");
        append(id,actor,request.requestId(),null,current.status(),request.status(),now());
        return detail(actor,id);
    }

    private Detail detail(Actor actor,UUID id) {
        var request=(actor.role()==Role.OWNER
            ?db.query(SUMMARY+OWNER_SCOPE+" AND s.id=?",this::summary,actor.id(),id)
            :db.query(SUMMARY+RESIDENT_SCOPE+" AND s.id=?",this::summary,actor.id(),actor.id(),id))
            .stream().findFirst().orElseThrow(this::missing);
        var events=db.query("""
            SELECT e.*,a.full_name FROM support_events e JOIN accounts a ON a.id=e.author_id
            WHERE e.thread_id=? ORDER BY e.event_order
            """,(row,index)->new Event(row.getLong("event_order"),row.getString("full_name"),
                Role.valueOf(row.getString("author_role")),row.getString("message"),
                status(row.getString("previous_status")),status(row.getString("new_status")),
                row.getObject("occurred_at",OffsetDateTime.class)),id);
        return new Detail(request,events);
    }

    private Locked lock(Actor actor,UUID id) {
        String scope=actor.role()==Role.OWNER?"p.owner_id=?":"s.resident_id=?";
        Locked thread=db.query("""
            SELECT s.property_id,s.status FROM support_threads s WHERE s.id=? AND EXISTS(
                SELECT 1 FROM properties p WHERE p.id=s.property_id AND p.sample=FALSE AND
            """+scope+") FOR UPDATE",(row,index)->new Locked(row.getObject("property_id",UUID.class),status(row.getString("status"))),
            id,actor.id()).stream().findFirst().orElseThrow(this::missing);
        if (actor.role()==Role.RESIDENT) requireActiveStay(actor.id(),thread.property());
        return thread;
    }

    private void requireActiveStay(UUID resident,UUID property) {
        if (db.queryForList("""
            SELECT t.id FROM tenancies t WHERE t.account_id=? AND t.status='ACTIVE' AND EXISTS(
                SELECT 1 FROM rooms r JOIN properties p ON p.id=r.property_id
                WHERE r.id=t.room_id AND p.id=? AND p.sample=FALSE
            ) FOR UPDATE
            """,UUID.class,resident,property).isEmpty()) throw missing();
    }

    private Actor actor(String email,Role role) {
        String scope=role==Role.OWNER?"a.role='OWNER'":"""
            a.role='APPLICANT'
            AND NOT EXISTS(SELECT 1 FROM property_guard_assignments g WHERE g.account_id=a.id)
            AND NOT EXISTS(SELECT 1 FROM maintenance_staff m WHERE m.account_id=a.id)
            """;
        return db.query("SELECT a.id FROM accounts a WHERE a.email=? AND "+scope,
            (row,index)->new Actor(row.getObject(1,UUID.class),role),email).stream().findFirst().orElseThrow(this::missing);
    }

    private Optional<SavedEvent> existing(UUID id,Actor actor,UUID request) {
        return db.query("""
            SELECT message,previous_status,new_status FROM support_events WHERE thread_id=? AND author_id=? AND request_id=?
            """,(row,index)->new SavedEvent(row.getString("message"),status(row.getString("previous_status")),status(row.getString("new_status"))),
            id,actor.id(),request).stream().findFirst();
    }

    private void append(UUID id,Actor actor,UUID request,String message,Status previous,Status next,OffsetDateTime time) {
        db.update("""
            INSERT INTO support_events(thread_id,author_id,author_role,request_id,message,previous_status,new_status,occurred_at)
            VALUES(?,?,?,?,?,?,?,?)
            """,id,actor.id(),actor.role().name(),request,message,previous==null?null:previous.name(),next==null?null:next.name(),time);
        db.update("UPDATE support_threads SET updated_at=?,status=COALESCE(?,status) WHERE id=?",time,next==null?null:next.name(),id);
    }

    private Summary summary(ResultSet row,int index) throws SQLException {
        return new Summary(row.getObject("id",UUID.class),row.getObject("property_id",UUID.class),row.getString("property_name"),
            row.getString("resident_name"),row.getString("subject"),status(row.getString("status")),
            row.getObject("created_at",OffsetDateTime.class),row.getObject("updated_at",OffsetDateTime.class));
    }

    private Status status(String name) { return name==null?null:Status.valueOf(name); }
    private OffsetDateTime now() { return clock.instant().atOffset(ZoneOffset.UTC); }
    private FlowException missing() { return new FlowException(404,"SUPPORT_UNAVAILABLE","This request or property is unavailable to your account."); }
    private FlowException requestUsed() { return new FlowException(409,"SUPPORT_REQUEST_USED","This submission was already used for different details. Refresh the request and try again."); }
}
