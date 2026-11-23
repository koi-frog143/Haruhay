package com.haruhay.backend.visitor;

import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.registration.RegistrationService;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VisitorService {
    private static final ZoneId PHILIPPINE_TIME = ZoneId.of("Asia/Manila");
    private final JdbcTemplate db; private final Clock clock; private final PasswordEncoder passwords;
    private final VisitorPassKeys passKeys;
    public VisitorService(JdbcTemplate db, Clock clock, PasswordEncoder passwords, VisitorPassKeys passKeys) { this.db=db; this.clock=clock; this.passwords=passwords; this.passKeys=passKeys; }
    private OffsetDateTime now() { return clock.instant().atOffset(ZoneOffset.UTC); }
    private List<Map<String,Object>> rows(String sql,Object... args) {
        var result=db.queryForList(sql,args);
        result.forEach(r->r.replaceAll((k,v)->v instanceof java.sql.Timestamp t?t.toInstant().atOffset(ZoneOffset.UTC):v instanceof java.sql.Date d?d.toLocalDate():v)); return result;
    }
    private Map<String,Object> one(String sql,Object... args) { return rows(sql,args).stream().findFirst().orElseThrow(()->error(404,"Record not found.")); }
    private FlowException error(int status,String message) { return new FlowException(status,"VISITOR_FLOW",message); }
    private UUID id(Map<String,Object> r,String key) { return UUID.fromString(r.get(key).toString()); }
    private UUID actor(String email) { return id(one("SELECT id FROM accounts WHERE email=?",email),"id"); }
    private boolean yes(String sql,Object... args) { return db.queryForObject(sql,Integer.class,args)>0; }
    public boolean isGuard(UUID account) { return yes("SELECT count(*) FROM property_guard_assignments WHERE account_id=? AND enabled=TRUE",account); }
    private void staff(UUID actor,UUID property,boolean review) {
        if (yes("SELECT count(*) FROM properties WHERE id=? AND owner_id=?",property,actor)) return;
        if (!yes("SELECT count(*) FROM property_guard_assignments WHERE account_id=? AND property_id=? AND enabled=TRUE"+(review?" AND can_review=TRUE":""),actor,property)) throw error(403,"You are not authorized for this property or action.");
    }
    private void active(UUID tenancy) { if (!yes("SELECT count(*) FROM tenancies WHERE id=? AND status='ACTIVE'",tenancy)) throw error(409,"The host no longer has an active tenancy."); }
    private void audit(UUID property,UUID visit,UUID actor,String event,String reason) {
        db.update("INSERT INTO visitor_audit(id,property_id,visit_id,actor_id,event,occurred_at,reason) VALUES(?,?,?,?,?,?,?)",UUID.randomUUID(),property,visit,actor,event,now(),reason);
    }
    private String required(String value,int max) { if(value==null||value.isBlank()||value.length()>max)throw error(400,"Complete all required fields within the displayed limits.");return value.trim(); }
    public record Request(UUID tenancyId,String fullName,String contact,String purpose,OffsetDateTime arrival,OffsetDateTime departure,LocalDate plannedDate) {
        public Request(UUID tenancyId,String fullName,String contact,String purpose,OffsetDateTime arrival,OffsetDateTime departure) {
            this(tenancyId,fullName,contact,purpose,arrival,departure,null);
        }
    }
    public record Review(String action,String reason) {}
    public record Pass(boolean replace) {}
    public record Scan(String token) { @Override public String toString(){return "Scan[REDACTED]";} }
    public record IssuedPass(String token,String shareToken,UUID visitId,OffsetDateTime startsAt,OffsetDateTime expiresAt,String propertyName,boolean entryWindowEnded) {
        @Override public String toString(){return "IssuedPass[REDACTED]";}
    }
    public record GuestPass(String token,OffsetDateTime startsAt,OffsetDateTime expiresAt,String propertyName,boolean entryWindowEnded) {
        @Override public String toString(){return "GuestPass[REDACTED]";}
    }
    public record Movement(String action,String method,String token,boolean identityConfirmed,String idType,String idLastFour,String reason) { @Override public String toString(){return "Movement[REDACTED]";} }
    public record Guard(String email,String fullName,String password,boolean canReview) { @Override public String toString(){return "Guard[REDACTED]";} }
    public record Assignment(boolean enabled,boolean canReview) {}
    public record WalkIn(Request visitor,boolean hostAuthorized,String reason) {}
    public List<Map<String,Object>> properties(String email) {
        UUID a=actor(email);var result=rows("SELECT p.id,p.name,p.owner_id FROM properties p WHERE p.owner_id=? OR EXISTS(SELECT 1 FROM property_guard_assignments g WHERE g.property_id=p.id AND g.account_id=? AND g.enabled=TRUE) ORDER BY p.name",a,a);
        for(var p:result){p.put("can_review",id(p,"owner_id").equals(a)||yes("SELECT count(*) FROM property_guard_assignments WHERE account_id=? AND property_id=? AND enabled=TRUE AND can_review=TRUE",a,p.get("id")));p.remove("owner_id");}return result;
    }
    public List<Map<String,Object>> hosts(String email,UUID property) {
        UUID a=actor(email); if(property!=null) staff(a,property,false);
        return rows("SELECT t.id,a.full_name,r.label,p.name AS property_name,p.id AS property_id FROM tenancies t JOIN accounts a ON a.id=t.account_id JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=r.property_id WHERE t.status='ACTIVE' AND "+(property==null?"t.account_id=?":"p.id=?")+" ORDER BY a.full_name",property==null?a:property);
    }
    public List<Map<String,Object>> guards(String email,UUID property) { owner(email,property);return rows("SELECT a.id,a.email,a.full_name,g.can_review,g.enabled FROM property_guard_assignments g JOIN accounts a ON a.id=g.account_id WHERE g.property_id=?",property); }
    private void owner(String email,UUID property) { if(!yes("SELECT count(*) FROM properties WHERE id=? AND owner_id=?",property,actor(email)))throw error(403,"Property owner access required."); }
    @Transactional public void createGuard(String email,UUID property,Guard g) {
        owner(email,property); String address=required(g.email(),254).toLowerCase(Locale.ROOT);
        if(!address.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))throw error(400,"Enter a valid email address.");
        if(g.password()==null||g.password().length()<12||g.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72)throw error(400,"Use at least 12 characters and at most 72 UTF-8 bytes.");
        if(yes("SELECT count(*) FROM accounts WHERE email=?",address))throw error(409,"This email already has an account. Use a dedicated staff email.");
        UUID a=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,'APPLICANT',TRUE,?)",a,address,passwords.encode(g.password()),required(g.fullName(),100),"",now());
        db.update("INSERT INTO property_guard_assignments(account_id,property_id,can_review,enabled,created_by,created_at) VALUES(?,?,?,TRUE,?,?)",a,property,g.canReview(),actor(email),now());audit(property,null,actor(email),"GUARD_CREATED",address);
    }
    @Transactional public void assignment(String email,UUID property,UUID guard,Assignment g) {
        owner(email,property);if(db.update("UPDATE property_guard_assignments SET enabled=?,can_review=? WHERE account_id=? AND property_id=?",g.enabled(),g.canReview(),guard,property)!=1)throw error(404,"Guard assignment not found.");audit(property,null,actor(email),"GUARD_UPDATED",guard.toString());
    }
    @Transactional public UUID request(String email,Request r) { return createRequest(actor(email),r,false); }
    private UUID createRequest(UUID a,Request r,boolean walkin) {
        if(r==null)throw error(400,"Enter visitor details.");
        if(r.tenancyId()==null)throw error(400,"Choose an active host.");
        var host=one("SELECT t.*,r.property_id FROM tenancies t JOIN rooms r ON r.id=t.room_id WHERE t.id=? FOR UPDATE",r.tenancyId());
        active(r.tenancyId()); if(walkin)staff(a,id(host,"property_id"),true);else if(!id(host,"account_id").equals(a))throw error(403,"Choose your own active tenancy.");
        OffsetDateTime created=now();
        boolean legacy=r.arrival()!=null||r.departure()!=null;
        if(legacy&&(r.plannedDate()!=null||r.arrival()==null||r.departure()==null||!r.departure().isAfter(r.arrival())||!r.departure().isAfter(created)||(!walkin&&r.arrival().isBefore(created.minusMinutes(5))))) throw error(400,"Choose a valid arrival and later departure in the future.");
        LocalDate today=created.atZoneSameInstant(PHILIPPINE_TIME).toLocalDate();
        if(r.plannedDate()!=null&&(walkin||r.plannedDate().isBefore(today))) throw error(400,"Choose today or a future visit date in Philippine time.");
        String contact=r.contact()==null?"":r.contact().trim();
        if(!contact.isEmpty()&&(!contact.matches("[+()0-9 -]{7,30}")||contact.replaceAll("[^0-9]", "").length()<7))throw error(400,"Enter a valid visitor contact number or leave it blank.");
        UUID visitor=UUID.randomUUID(),request=UUID.randomUUID();db.update("INSERT INTO visitor_profiles(id,full_name,contact) VALUES(?,?,?)",visitor,required(r.fullName(),100),contact);
        db.update("INSERT INTO visitor_requests(id,visitor_id,tenancy_id,property_id,purpose,arrival,departure,status,created_at,window_policy,planned_date) VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?)",request,visitor,r.tenancyId(),id(host,"property_id"),required(r.purpose(),500),r.arrival(),r.departure(),created,legacy?"LEGACY":"FLEXIBLE",r.plannedDate());
        audit(id(host,"property_id"),null,a,"REQUEST_CREATED",request.toString());return request;
    }
    private static final String LIST="""
        SELECT q.*,p.full_name,p.contact,a.full_name AS host_name,t.application_id AS host_application_id,
               r.label AS room_label,v.id AS visit_id,v.status AS visit_status,v.checked_in,v.checked_out,v.voided,
               EXISTS(SELECT 1 FROM visitor_qr_credentials c
                      WHERE c.visit_id=v.id AND c.status='ACTIVE' AND c.share_hash IS NOT NULL) AS has_shareable_pass
        FROM visitor_requests q JOIN visitor_profiles p ON p.id=q.visitor_id
        JOIN tenancies t ON t.id=q.tenancy_id JOIN accounts a ON a.id=t.account_id
        JOIN rooms r ON r.id=t.room_id LEFT JOIN visitor_visits v ON v.request_id=q.id
        """;
    public List<Map<String,Object>> list(String email,UUID property) {
        UUID a=actor(email);
        if(property!=null)staff(a,property,false);
        var result=property!=null?rows(LIST+"WHERE q.property_id=? ORDER BY q.created_at DESC",property):
            rows(LIST+"WHERE t.account_id=? OR EXISTS(SELECT 1 FROM properties owned WHERE owned.id=q.property_id AND owned.owner_id=?) ORDER BY q.created_at DESC",a,a);
        OffsetDateTime at=now();
        return result.stream().map(record->displayStatus(record,at)).toList();
    }
    private Map<String,Object> displayStatus(Map<String,Object> record,OffsetDateTime at) {
        Object state=record.get("visit_status");
        if(state==null)state=record.get("status");
        if(Boolean.TRUE.equals(record.get("voided")))state="VOIDED";
        else if("EXPECTED".equals(state)&&!((OffsetDateTime)record.get("departure")).isAfter(at))state="EXPIRED";
        record.put("display_status",state);
        return record;
    }
    private Map<String,Object> lockRequest(UUID request) { return one("SELECT * FROM visitor_requests WHERE id=? FOR UPDATE",request); }
    @Transactional public UUID review(String email,UUID request,Review r) {
        UUID a=actor(email);var q=lockRequest(request);UUID p=id(q,"property_id");staff(a,p,true);
        if(r.action()==null||!Set.of("APPROVE","DECLINE").contains(r.action()))throw error(400,"Choose approve or decline.");
        if(r.reason()!=null&&r.reason().length()>1000)throw error(400,"Use at most 1000 characters for the review reason.");
        if(q.get("status").equals("APPROVED")&&r.action().equals("APPROVE"))return id(one("SELECT id FROM visitor_visits WHERE request_id=?",request),"id");
        if(!q.get("status").equals("PENDING"))throw error(409,"This request has already been reviewed.");
        active(id(q,"tenancy_id"));
        boolean approve=r.action().equals("APPROVE");
        String reason=approve?r.reason():required(r.reason(),1000);
        OffsetDateTime reviewed=now(),arrival=(OffsetDateTime)q.get("arrival"),departure=(OffsetDateTime)q.get("departure");
        if(approve&&q.get("window_policy").equals("FLEXIBLE")){
            LocalDate planned=(LocalDate)q.get("planned_date");
            arrival=reviewed;
            departure=reviewed.plusHours(24);
            if(planned!=null){
                OffsetDateTime start=planned.atStartOfDay(PHILIPPINE_TIME).toInstant().atOffset(ZoneOffset.UTC);
                departure=planned.plusDays(1).atStartOfDay(PHILIPPINE_TIME).toInstant().atOffset(ZoneOffset.UTC);
                if(!departure.isAfter(reviewed))throw error(409,"The planned date has passed. Decline this request and ask the resident to invite the guest again with a new date.");
                if(start.isAfter(reviewed))arrival=start;
            }
        }
        db.update("UPDATE visitor_requests SET status=?,reviewed_by=?,reviewed_at=?,reason=?,arrival=?,departure=? WHERE id=?",approve?"APPROVED":"DECLINED",a,reviewed,reason,arrival,departure,request);
        UUID visit=null;if(approve){visit=UUID.randomUUID();db.update("INSERT INTO visitor_visits(id,request_id,status) VALUES(?,?,'EXPECTED')",visit,request);}
        audit(p,visit,a,"REQUEST_"+r.action(),reason);return visit;
    }
    @Transactional public UUID walkin(String email,WalkIn w) {
        if(!w.hostAuthorized())throw error(400,"Confirm authorization with the active host first.");required(w.reason(),1000);
        UUID request=createRequest(actor(email),w.visitor(),true);UUID visit=review(email,request,new Review("APPROVE",w.reason()));audit(id(lockRequest(request),"property_id"),visit,actor(email),"WALK_IN_AUTHORIZED",w.reason());return visit;
    }
    private Map<String,Object> visit(UUID visit) {
        // Cancellation, credential changes and movement always lock the request before the visit.
        var reference=one("SELECT request_id FROM visitor_visits WHERE id=?",visit);lockRequest(id(reference,"request_id"));
        return one("SELECT v.*,q.property_id,q.tenancy_id,q.arrival,q.departure,q.status AS request_status,t.account_id FROM visitor_visits v JOIN visitor_requests q ON q.id=v.request_id JOIN tenancies t ON t.id=q.tenancy_id WHERE v.id=? FOR UPDATE",visit);
    }
    private void ownsVisit(UUID actor,Map<String,Object> v) { if(!id(v,"account_id").equals(actor))staff(actor,id(v,"property_id"),false); }
    @Transactional public IssuedPass issue(String email,UUID visit,Pass pass) {
        UUID a=actor(email);var v=visit(visit);ownsVisit(a,v);active(id(v,"tenancy_id"));
        boolean expected=v.get("status").equals("EXPECTED"),inside=v.get("status").equals("CHECKED_IN");
        if((!expected&&!inside)||Boolean.TRUE.equals(v.get("voided")))throw error(409,"This visit no longer has a shareable pass.");
        OffsetDateTime expiry=(OffsetDateTime)v.get("departure");
        if(expected&&!expiry.isAfter(now()))throw error(410,"The entry window has ended. Invite the guest again for a new pass.");
        var earlier=rows("SELECT id,token_hash,share_hash FROM visitor_qr_credentials WHERE visit_id=? AND status='ACTIVE'",visit).stream().findFirst();
        String propertyName=one("SELECT name FROM properties WHERE id=?",v.get("property_id")).get("name").toString();
        if(!pass.replace()&&earlier.isPresent()&&earlier.get().get("share_hash")!=null){
            var credential=earlier.get(); UUID existing=id(credential,"id");
            String token=passKeys.scan(existing),share=passKeys.share(existing);
            if(RegistrationService.hash(token).equals(credential.get("token_hash"))&&RegistrationService.hash(share).equals(credential.get("share_hash")))
                return new IssuedPass(token,share,visit,(OffsetDateTime)v.get("arrival"),expiry,propertyName,!expiry.isAfter(now()));
        }
        if(inside)throw error(409,"A new pass cannot be issued after check-in. The front desk can look up the visit to check out.");
        if(!pass.replace()&&yes("SELECT count(*) FROM visitor_qr_credentials WHERE visit_id=?",visit))throw error(409,"The previous pass cannot be reopened. Replace it to get a new link and QR.");
        UUID credential=UUID.randomUUID();
        String raw=passKeys.scan(credential),share=passKeys.share(credential);
        db.update("UPDATE visitor_qr_credentials SET status='REPLACED' WHERE visit_id=? AND status IN ('ACTIVE','REVOKED')",visit);
        db.update("INSERT INTO visitor_qr_credentials(id,visit_id,token_hash,share_hash,status,issued_at,expires_at) VALUES(?,?,?,?,'ACTIVE',?,?)",credential,visit,RegistrationService.hash(raw),RegistrationService.hash(share),now(),expiry);
        audit(id(v,"property_id"),visit,a,pass.replace()?"PASS_REPLACED":"PASS_ISSUED",null);
        return new IssuedPass(raw,share,visit,(OffsetDateTime)v.get("arrival"),expiry,propertyName,false);
    }
    public GuestPass guestPass(Scan link) {
        String token=link.token();
        if(token==null||!token.matches("[A-Za-z0-9_-]{43}"))throw error(404,"This guest pass link is invalid.");
        var credential=rows("""
            SELECT c.id,c.token_hash,c.status,q.arrival,c.expires_at,v.status AS visit_status,v.voided,p.name,
                   t.status AS tenancy_status
            FROM visitor_qr_credentials c JOIN visitor_visits v ON v.id=c.visit_id
            JOIN visitor_requests q ON q.id=v.request_id JOIN properties p ON p.id=q.property_id
            JOIN tenancies t ON t.id=q.tenancy_id WHERE c.share_hash=?
            """,RegistrationService.hash(token)).stream().findFirst().orElseThrow(()->error(404,"This guest pass link is invalid."));
        OffsetDateTime expiry=(OffsetDateTime)credential.get("expires_at");
        if(!credential.get("status").equals("ACTIVE")||Boolean.TRUE.equals(credential.get("voided")))throw error(410,"This guest pass is no longer available. Contact your host.");
        if(!credential.get("visit_status").equals("CHECKED_IN")&&(!credential.get("visit_status").equals("EXPECTED")||!expiry.isAfter(now())||!credential.get("tenancy_status").equals("ACTIVE")))throw error(410,"This pass is no longer valid for entry. Ask your host for a new invitation.");
        String raw=passKeys.scan(id(credential,"id"));
        if(!RegistrationService.hash(raw).equals(credential.get("token_hash")))throw error(410,"This pass is no longer available. Ask your host for a new link.");
        return new GuestPass(raw,(OffsetDateTime)credential.get("arrival"),expiry,credential.get("name").toString(),!expiry.isAfter(now()));
    }
    @Transactional public void revokePass(String email,UUID visit,Review review) {
        UUID a=actor(email);var v=visit(visit);UUID p=id(v,"property_id");
        if(!id(v,"account_id").equals(a))staff(a,p,true);
        String reason=required(review.reason(),1000);
        if(db.update("UPDATE visitor_qr_credentials SET status='REVOKED' WHERE visit_id=? AND status='ACTIVE'",visit)>0)
            audit(p,visit,a,"REVOKE",reason);
    }
    @Transactional public void cancel(String email,UUID request) {
        UUID a=actor(email);var q=lockRequest(request);var host=one("SELECT account_id FROM tenancies WHERE id=?",q.get("tenancy_id"));
        if(!id(host,"account_id").equals(a))staff(a,id(q,"property_id"),true);
        var visits=rows("SELECT id,status FROM visitor_visits WHERE request_id=? FOR UPDATE",request);
        if(!visits.isEmpty()&&!Set.of("EXPECTED","CANCELLED").contains(visits.get(0).get("status")))throw error(409,"A visit with entry evidence cannot be cancelled. Use checkout or an audited correction.");
        if(q.get("status").equals("DECLINED"))throw error(409,"This request was declined.");
        db.update("UPDATE visitor_requests SET status='CANCELLED' WHERE id=?",request);
        for(var v:visits){db.update("UPDATE visitor_visits SET status='CANCELLED' WHERE id=?",v.get("id"));db.update("UPDATE visitor_qr_credentials SET status='REVOKED' WHERE visit_id=? AND status='ACTIVE'",v.get("id"));}
        audit(id(q,"property_id"),visits.isEmpty()?null:id(visits.get(0),"id"),a,"REQUEST_CANCELLED",null);
    }
    private String tokenProblem(UUID property,String token,Map<String,Object> v,boolean entry) {
        if(token==null||!token.matches("haruhay:visit:[A-Za-z0-9_-]{43}"))return "Unreadable or non-Haruhay pass.";
        var found=rows("SELECT * FROM visitor_qr_credentials WHERE token_hash=?",RegistrationService.hash(token));
        if(found.isEmpty())return "Invalid pass.";var c=found.get(0);
        if(!id(c,"visit_id").equals(id(v,"id"))||!id(v,"property_id").equals(property))return "This pass belongs to a different visit or property.";
        if(c.get("status").equals("REPLACED"))return "This pass was replaced. Ask for the current pass or find the guest.";
        if(v.get("status").equals("CHECKED_IN")&&!entry)return null; // Expiry/revocation never prevents controlled departure.
        if(!c.get("status").equals("ACTIVE"))return "This pass is replaced, revoked or completed.";
        if(!((OffsetDateTime)c.get("expires_at")).isAfter(now()))return "This pass has expired. Ask the resident to send a new invitation.";
        return entryProblem(v);
    }
    private String entryProblem(Map<String,Object> v) {
        if(!v.get("status").equals("EXPECTED")||Boolean.TRUE.equals(v.get("voided"))||!v.get("request_status").equals("APPROVED"))return "This visit is not awaiting arrival. Do not record another entry.";
        if(!yes("SELECT count(*) FROM tenancies WHERE id=? AND status='ACTIVE'",v.get("tenancy_id")))return "The host no longer has an active tenancy.";
        if(yes("SELECT count(*) FROM visitor_qr_credentials WHERE visit_id=? AND status='REVOKED'",v.get("id"))&&!yes("SELECT count(*) FROM visitor_qr_credentials WHERE visit_id=? AND status='ACTIVE'",v.get("id")))return "This visit pass was revoked. An authorized replacement is required before entry.";
        if(now().isBefore((OffsetDateTime)v.get("arrival")))return "This visit is scheduled for later. Check the approved entry window.";
        if(!now().isBefore((OffsetDateTime)v.get("departure")))return "The entry window has ended. Ask the resident to send a new invitation.";
        return null;
    }
    @Transactional public Map<String,Object> scan(String email,UUID property,Scan scan) {
        UUID a=actor(email);staff(a,property,false);String raw=scan.token();
        var credentials=raw==null||raw.length()>100?List.<Map<String,Object>>of():rows("SELECT visit_id FROM visitor_qr_credentials WHERE token_hash=?",RegistrationService.hash(raw));
        if(credentials.isEmpty()){audit(property,null,a,"SCAN_DENIED","Invalid pass");return Map.of("allowed",false,"message","Invalid or non-Haruhay pass.");}
        UUID visit=id(credentials.get(0),"visit_id");var v=visit(visit);String problem=tokenProblem(property,raw,v,false);
        if(problem!=null){audit(property,null,a,"SCAN_DENIED",problem);return Map.of("allowed",false,"message",problem);}
        audit(property,visit,a,"PASS_VALIDATED",null);return Map.of("allowed",true,"record",displayStatus(one(LIST+"WHERE v.id=?",visit),now()));
    }
    @Transactional public Map<String,Object> movement(String email,UUID property,UUID visit,Movement m) {
        UUID a=actor(email);staff(a,property,false);var v=visit(visit);if(!property.equals(id(v,"property_id")))throw error(403,"Visit not in this property.");
        if(m.action()==null||m.method()==null||!Set.of("ENTRY","EXIT").contains(m.action())||!Set.of("QR","MANUAL").contains(m.method()))throw error(400,"Choose an explicit entry or exit and verification method.");
        if(m.reason()!=null&&m.reason().length()>1000||m.idType()!=null&&m.idType().length()>80)throw error(400,"Keep verification details within the displayed limits.");
        if(m.action().equals("ENTRY")&&v.get("status").equals("CHECKED_IN")||m.action().equals("EXIT")&&v.get("status").equals("CHECKED_OUT"))return Map.of("allowed",true,"message","This movement was already recorded.");
        String problem=m.action().equals("ENTRY")?entryProblem(v):v.get("status").equals("CHECKED_IN")?null:"Only an open visit can be checked out.";
        if(problem==null&&m.method().equals("QR"))problem=tokenProblem(property,m.token(),v,m.action().equals("ENTRY"));
        if(problem!=null){audit(property,visit,a,"MOVEMENT_DENIED",problem);return Map.of("allowed",false,"message",problem);}
        if(m.action().equals("ENTRY")&&!m.identityConfirmed())throw error(400,"Confirm the visitor's presented identity first.");
        String idType=m.action().equals("ENTRY")?required(m.idType(),80):m.idType();
        if(m.idLastFour()!=null&&!m.idLastFour().isBlank()&&!m.idLastFour().matches("[A-Za-z0-9]{4}"))throw error(400,"Record only the last four alphanumeric ID characters, or leave blank.");
        String reason=m.method().equals("MANUAL")?required(m.reason(),1000):m.reason();
        OffsetDateTime occurred=now();
        db.update("INSERT INTO visitor_movements(id,visit_id,movement,actor_id,occurred_at,method,id_type,id_last_four,reason) VALUES(?,?,?,?,?,?,?,?,?)",UUID.randomUUID(),visit,m.action(),a,occurred,m.method(),idType,m.idLastFour(),reason);
        db.update("UPDATE visitor_visits SET status=?,"+(m.action().equals("ENTRY")?"checked_in":"checked_out")+"=? WHERE id=?",m.action().equals("ENTRY")?"CHECKED_IN":"CHECKED_OUT",occurred,visit);
        if(m.action().equals("EXIT"))db.update("UPDATE visitor_qr_credentials SET status='COMPLETE' WHERE visit_id=? AND status='ACTIVE'",visit);
        audit(property,visit,a,m.action()+"_"+m.method(),reason);return Map.of("allowed",true,"message",m.action().equals("ENTRY")?"Visitor checked in.":"Visitor checked out.");
    }
    @Transactional public void amend(String email,UUID property,UUID visit,Review r) {
        UUID a=actor(email);staff(a,property,true);var v=visit(visit);if(!property.equals(id(v,"property_id")))throw error(403,"Visit not in this property.");String reason=required(r.reason(),1000);
        if(r.action()==null)throw error(400,"Choose a correction action.");
        if(r.action().equals("REVOKE"))db.update("UPDATE visitor_qr_credentials SET status='REVOKED' WHERE visit_id=? AND status='ACTIVE'",visit);
        else if(r.action().equals("VOID")){if(v.get("status").equals("CHECKED_IN"))throw error(409,"Check out the open visit before voiding it.");db.update("UPDATE visitor_visits SET voided=TRUE,status=CASE WHEN status='EXPECTED' THEN 'CANCELLED' ELSE status END WHERE id=?",visit);db.update("UPDATE visitor_qr_credentials SET status='REVOKED' WHERE visit_id=? AND status='ACTIVE'",visit);}
        else if(!r.action().equals("CORRECTION"))throw error(400,"Choose correction, revoke or void.");
        audit(property,visit,a,r.action(),reason);
    }
    public List<Map<String,Object>> history(String email,UUID property,UUID visit) {UUID a=actor(email);staff(a,property,false);if(!yes("SELECT count(*) FROM visitor_visits v JOIN visitor_requests q ON q.id=v.request_id WHERE v.id=? AND q.property_id=?",visit,property))throw error(404,"Visit not found.");return rows("SELECT h.event,h.occurred_at,h.reason,a.full_name AS actor FROM visitor_audit h JOIN accounts a ON a.id=h.actor_id WHERE h.visit_id=? ORDER BY h.occurred_at",visit);}
    public List<Map<String,Object>> activity(String email,UUID property) {staff(actor(email),property,false);return rows("SELECT h.event,h.occurred_at,h.reason,a.full_name AS actor FROM visitor_audit h JOIN accounts a ON a.id=h.actor_id WHERE h.property_id=? ORDER BY h.occurred_at DESC LIMIT 250",property);}
}
