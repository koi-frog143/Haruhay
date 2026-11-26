package com.haruhay.backend.announcement;

import com.haruhay.backend.registration.FlowException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AnnouncementController {
    public enum Category { GENERAL, MAINTENANCE, COMMUNITY }
    public record Content(@NotBlank @Size(max=150) String title, @NotNull Category category,
                          @NotBlank @Size(max=1000) String summary, @NotBlank @Size(max=2000) String message) {
        Content trimmed() {
            return new Content(title.strip(),category,summary.strip(),message.strip());
        }
    }
    public record Create(@NotNull UUID requestId,@NotNull UUID propertyId,@NotNull @Valid Content content,boolean publish) {}
    public record Edit(@Positive long version,@NotNull @Valid Content content,boolean publish) {}
    public record Archive(@Positive long version) {}
    public record OwnerNotice(UUID id,UUID propertyId,String propertyName,String author,Content content,String status,
                              OffsetDateTime createdAt,OffsetDateTime updatedAt,OffsetDateTime publishedAt,
                              OffsetDateTime archivedAt,long version) {}
    public record ResidentSummary(UUID id,String propertyName,String title,Category category,String summary,OffsetDateTime publishedAt) {}
    public record ResidentDetail(ResidentSummary announcement,String message) {}

    private static final String OWNER_VIEW="""
        SELECT n.*,p.name AS property_name,a.full_name AS author_name
        FROM property_announcements n JOIN properties p ON p.id=n.property_id
        JOIN accounts a ON a.id=n.author_id
        WHERE p.sample=FALSE AND p.owner_id=(SELECT id FROM accounts WHERE email=? AND role='OWNER')
        """;
    private static final String RESIDENT_SCOPE="""
        FROM property_announcements n JOIN properties p ON p.id=n.property_id
        WHERE n.status='PUBLISHED' AND p.sample=FALSE AND EXISTS (
            SELECT 1 FROM tenancies t JOIN rooms r ON r.id=t.room_id JOIN accounts a ON a.id=t.account_id
            WHERE t.status='ACTIVE' AND r.property_id=n.property_id AND a.email=?
              AND a.role='APPLICANT'
              AND NOT EXISTS(SELECT 1 FROM property_guard_assignments g WHERE g.account_id=a.id AND g.enabled=TRUE)
              AND NOT EXISTS(SELECT 1 FROM maintenance_staff s WHERE s.account_id=a.id)
        )
        """;
    private static final String SUMMARY="SELECT n.id,p.name AS property_name,n.title,n.category,n.summary,n.published_at";
    private final JdbcTemplate db;
    private final Clock clock;

    public AnnouncementController(JdbcTemplate db,Clock clock) {
        this.db=db;
        this.clock=clock;
    }

    @GetMapping("/owner/announcements")
    public List<OwnerNotice> ownerList(Principal user) {
        return db.query(OWNER_VIEW+" ORDER BY n.updated_at DESC,n.id DESC",this::ownerNotice,user.getName());
    }

    @GetMapping("/owner/announcements/{id}")
    public OwnerNotice ownerDetail(Principal user,@PathVariable UUID id) {
        return ownerNotice(user.getName(),id);
    }

    @PostMapping("/owner/announcements")
    @Transactional
    public OwnerNotice create(Principal user,@Valid @RequestBody Create request) {
        String email=user.getName();
        // The owner lock serializes retries that use the same client-generated ID.
        UUID author=db.query("SELECT id FROM accounts WHERE email=? AND role='OWNER' FOR UPDATE",
            (row,index)->row.getObject(1,UUID.class),email).stream().findFirst().orElseThrow(this::missing);
        if (db.queryForObject("SELECT COUNT(*) FROM properties WHERE id=? AND owner_id=? AND sample=FALSE",
                Integer.class,request.propertyId(),author)==0)
            throw new FlowException(404,"PROPERTY_NOT_FOUND","Choose a property you manage.");
        Content content=request.content().trimmed();
        var existing=db.query(OWNER_VIEW+" AND n.id=?",this::ownerNotice,email,request.requestId()).stream().findFirst();
        if (existing.isPresent()) {
            var saved=existing.get();
            if (!saved.propertyId().equals(request.propertyId()) || !saved.content().equals(content) ||
                    (saved.publishedAt()!=null)!=request.publish())
                throw new FlowException(409,"ANNOUNCEMENT_ALREADY_SAVED","This form already saved an announcement. Refresh the list to edit it.");
            return saved;
        }
        OffsetDateTime now=now();
        db.update("""
            INSERT INTO property_announcements(id,property_id,author_id,title,category,summary,message,status,created_at,updated_at,published_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,request.requestId(),request.propertyId(),author,content.title(),content.category().name(),content.summary(),
            content.message(),request.publish()?"PUBLISHED":"DRAFT",now,now,request.publish()?now:null);
        return ownerNotice(email,request.requestId());
    }

    @PutMapping("/owner/announcements/{id}")
    @Transactional
    public OwnerNotice edit(Principal user,@PathVariable UUID id,@Valid @RequestBody Edit request) {
        String email=user.getName();
        var notice=ownerNotice(email,id);
        if ("ARCHIVED".equals(notice.status()))
            throw new FlowException(409,"ANNOUNCEMENT_ARCHIVED","This announcement is archived.");
        var content=request.content().trimmed();
        OffsetDateTime now=now();
        OffsetDateTime published=notice.publishedAt()==null && request.publish()?now:notice.publishedAt();
        requireUpdated(db.update("""
            UPDATE property_announcements SET title=?,category=?,summary=?,message=?,status=?,published_at=?,updated_at=?,version=version+1
            WHERE id=? AND version=? AND status<>'ARCHIVED' AND property_id IN
              (SELECT p.id FROM properties p JOIN accounts a ON a.id=p.owner_id WHERE a.email=? AND a.role='OWNER' AND p.sample=FALSE)
            """,content.title(),content.category().name(),content.summary(),content.message(),
            published==null?"DRAFT":"PUBLISHED",published,now,id,request.version(),email));
        return ownerNotice(email,id);
    }

    @PostMapping("/owner/announcements/{id}/archive")
    @Transactional
    public OwnerNotice archive(Principal user,@PathVariable UUID id,@Valid @RequestBody Archive request) {
        String email=user.getName();
        var notice=ownerNotice(email,id);
        if ("ARCHIVED".equals(notice.status())) return notice;
        OffsetDateTime now=now();
        int changed=db.update("""
            UPDATE property_announcements SET status='ARCHIVED',archived_at=?,updated_at=?,version=version+1
            WHERE id=? AND version=? AND status<>'ARCHIVED' AND property_id IN
              (SELECT p.id FROM properties p JOIN accounts a ON a.id=p.owner_id WHERE a.email=? AND a.role='OWNER' AND p.sample=FALSE)
            """,now,now,id,request.version(),email);
        var current=ownerNotice(email,id);
        if (!"ARCHIVED".equals(current.status())) requireUpdated(changed);
        return current;
    }

    @GetMapping("/resident/announcements")
    public List<ResidentSummary> residentList(Principal user) {
        return db.query(SUMMARY+" "+RESIDENT_SCOPE+" ORDER BY n.published_at DESC,n.id DESC",
            this::residentSummary,user.getName());
    }

    @GetMapping("/resident/announcements/{id}")
    public ResidentDetail residentDetail(Principal user,@PathVariable UUID id) {
        return db.query(SUMMARY+",n.message "+RESIDENT_SCOPE+" AND n.id=?",
            (row,index)->new ResidentDetail(residentSummary(row,index),row.getString("message")),
            user.getName(),id).stream().findFirst().orElseThrow(this::missing);
    }

    private OwnerNotice ownerNotice(String email,UUID id) {
        return db.query(OWNER_VIEW+" AND n.id=?",this::ownerNotice,email,id).stream().findFirst().orElseThrow(this::missing);
    }

    private OwnerNotice ownerNotice(ResultSet row,int index) throws SQLException {
        return new OwnerNotice(row.getObject("id",UUID.class),row.getObject("property_id",UUID.class),row.getString("property_name"),
            row.getString("author_name"),new Content(row.getString("title"),Category.valueOf(row.getString("category")),
            row.getString("summary"),row.getString("message")),row.getString("status"),
            row.getObject("created_at",OffsetDateTime.class),row.getObject("updated_at",OffsetDateTime.class),
            row.getObject("published_at",OffsetDateTime.class),row.getObject("archived_at",OffsetDateTime.class),row.getLong("version"));
    }

    private ResidentSummary residentSummary(ResultSet row,int index) throws SQLException {
        return new ResidentSummary(row.getObject("id",UUID.class),row.getString("property_name"),row.getString("title"),
            Category.valueOf(row.getString("category")),row.getString("summary"),row.getObject("published_at",OffsetDateTime.class));
    }

    private void requireUpdated(int count) {
        if (count!=1) throw new FlowException(409,"ANNOUNCEMENT_CHANGED","This announcement changed. Refresh the list and reopen it.");
    }

    private FlowException missing() {
        return new FlowException(404,"ANNOUNCEMENT_NOT_FOUND","This announcement is unavailable.");
    }

    private OffsetDateTime now() {
        return clock.instant().atOffset(ZoneOffset.UTC);
    }
}
