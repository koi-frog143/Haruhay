package com.haruhay.backend.registration;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Signup establishes identity. Owner approval holds a place; emailed code consumption starts tenancy. */
@Service
public class OnboardingService {
    private final JdbcTemplate db;
    private final RoomAgreementService agreements;
    private final RegistrationService identities;
    private final PasswordEncoder passwords;
    private final VerificationDelivery mail;
    private final Clock clock;
    private final Duration ttl;
    public OnboardingService(RoomAgreementService agreements,JdbcTemplate db,RegistrationService identities,PasswordEncoder passwords,VerificationDelivery mail,Clock clock,
            @Value("${haruhay.activation-ttl:24h}") Duration ttl) {
        this.agreements=agreements; this.db=db; this.identities=identities; this.passwords=passwords; this.mail=mail; this.clock=clock; this.ttl=ttl;
        if(ttl.isZero()||ttl.isNegative()) throw new IllegalArgumentException("Activation lifetime must be positive.");
    }
    private OffsetDateTime now() { return OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC); }
    private UUID id(Map<String,Object> row,String key) { return UUID.fromString(row.get(key).toString()); }
    private List<Map<String,Object>> rows(String sql,Object... args) {
        var result=db.queryForList(sql,args);
        result.forEach(row -> row.replaceAll((key,value) -> value instanceof java.sql.Timestamp t ? t.toInstant().atOffset(ZoneOffset.UTC) : value));
        return result;
    }
    private Map<String,Object> one(String sql,Object... args) {
        return rows(sql,args).stream().findFirst().orElseThrow(() -> new FlowException(404,"NOT_FOUND","Record not found."));
    }
    private UUID user(String email) { return id(identities.account(email),"id"); }
    private UUID owner(String email) {
        var a=identities.account(email);
        if(!a.get("role").equals("OWNER")) throw new FlowException(403,"FORBIDDEN","Owner access required.");
        return id(a,"id");
    }
    private void propertyOwner(UUID actor,UUID property) {
        if(db.queryForObject("SELECT count(*) FROM properties WHERE id=? AND owner_id=?",Integer.class,property,actor)!=1)
            throw new FlowException(404,"NOT_FOUND","Property not found.");
    }
    private void audit(UUID entity,String event,UUID actor,String reason) {
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)",
            UUID.randomUUID(),entity,event,actor,now(),reason);
    }
    public List<Map<String,Object>> publicProperties() { return rows("SELECT id,name FROM properties WHERE sample=FALSE ORDER BY name"); }
    public List<Map<String,Object>> properties(String email) { return rows("SELECT id,name,sample FROM properties WHERE owner_id=? ORDER BY name",owner(email)); }
    @Transactional public Map<String,Object> createProperty(String email,String name) {
        UUID actor=owner(email), property=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name,sample) VALUES(?,?,?,FALSE)",property,actor,name.trim());
        audit(property,"PROPERTY_CREATED",actor,"Initial inventory setup");
        return Map.of("id",property,"name",name.trim());
    }
    @Transactional public Map<String,Object> createRoom(String email,UUID property,String label,int capacity) {
        UUID actor=owner(email); propertyOwner(actor,property);
        if(capacity<1 || capacity>100) throw new FlowException(400,"CAPACITY","Choose a capacity between 1 and 100.");
        UUID room=UUID.randomUUID();
        db.update("INSERT INTO rooms(id,property_id,label,capacity,room_type) VALUES(?,?,?,?,?)",room,property,label.trim(),capacity,capacity==1?"PRIVATE":"SHARED");
        audit(room,"ROOM_CREATED",actor,"Capacity "+capacity);
        return Map.of("id",room);
    }
    @Transactional public Map<String,Object> signup(String email,String name,String contact,String password,UUID property,String authenticatedEmail) {
        if(db.queryForObject("SELECT count(*) FROM properties WHERE id=? AND sample=FALSE",Integer.class,property)!=1)
            throw new FlowException(400,"PROPERTY_UNAVAILABLE","Choose a property accepting applications.");
        String normalized=email.trim().toLowerCase(Locale.ROOT); UUID account;
        if(authenticatedEmail!=null) {
            var a=identities.account(authenticatedEmail);
            if ("TECHNICIAN".equals(a.get("role"))) throw new FlowException(403,"STAFF_ACCOUNT","Use a separate resident account to apply.");
            if(!normalized.equals(a.get("email"))) throw new FlowException(403,"EMAIL_MISMATCH","Use your signed-in email.");
            account=id(a,"id");
        } else {
            if(db.queryForObject("SELECT count(*) FROM accounts WHERE email=?",Integer.class,normalized)>0)
                throw new FlowException(409,"ACCOUNT_EXISTS","This email already has an account. Sign in to apply.");
            if(password==null || password.length()<12 || password.getBytes(StandardCharsets.UTF_8).length>72)
                throw new FlowException(400,"PASSWORD","Use at least 12 characters and at most 72 UTF-8 bytes.");
            account=UUID.randomUUID();
            db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,'APPLICANT',FALSE,?)",
                account,normalized,passwords.encode(password),name.trim(),contact.trim(),now());
            audit(account,"ACCOUNT_CREATED",account,null);
        }
        var a=one("SELECT email_verified FROM accounts WHERE id=? FOR UPDATE",account);
        if(db.queryForObject("""
            SELECT count(*) FROM registration_applications a WHERE a.account_id=? AND a.property_id=?
            AND (a.status NOT IN ('REJECTED','CANCELLED','APPROVED') OR EXISTS
              (SELECT 1 FROM tenancies t WHERE t.application_id=a.id AND t.status='ACTIVE'))
            """,Integer.class,account,property)>0)
            throw new FlowException(409,"APPLICATION_EXISTS","You already have an application or tenancy at this property.");
        UUID application=UUID.randomUUID(); boolean verified=Boolean.TRUE.equals(a.get("email_verified"));
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,?,?,?,?)",
            application,account,property,name.trim(),contact.trim(),verified ? "PENDING_APPROVAL" : "AWAITING_EMAIL",now());
        audit(application,"APPLICATION_SUBMITTED",account,null);
        String delivery=verified ? "NOT_REQUIRED" : String.valueOf(identities.resend(normalized).get("delivery"));
        return Map.of("applicationId",application,"delivery",delivery,"status",verified ? "PENDING_APPROVAL" : "AWAITING_EMAIL");
    }
    private static final String VIEW="""
        SELECT a.id,a.invitation_id,a.property_id,
        CASE WHEN a.status='APPROVED' THEN u.full_name ELSE a.full_name END AS full_name,
        CASE WHEN a.status='APPROVED' THEN u.contact ELSE a.contact END AS contact,
        a.status,
        a.review_reason,a.reviewed_at,a.submitted_at,a.activation_pending,
        u.email,u.email_verified,p.name AS property_name,p.sample,r.id AS room_id,r.label AS room_label,
        COALESCE(stay_reservation.status,h.status) AS reservation_status,c.expires_at AS code_expires_at,c.failed_attempts,
        t.id AS tenancy_id,t.status AS tenancy_status,t.started_at AS tenancy_started_at,t.ended_at AS tenancy_ended_at,
        t.offer_id AS tenancy_offer_id
        FROM registration_applications a JOIN accounts u ON u.id=a.account_id
        JOIN properties p ON p.id=a.property_id LEFT JOIN invitations i ON i.id=a.invitation_id
        LEFT JOIN reservations h ON h.id=i.reservation_id
        LEFT JOIN tenancies t ON t.id=(
          SELECT stay.id FROM tenancies stay WHERE stay.application_id=a.id
          ORDER BY CASE WHEN stay.status='ACTIVE' THEN 0 ELSE 1 END,stay.started_at DESC,stay.id LIMIT 1
        )
        LEFT JOIN reservations stay_reservation ON stay_reservation.id=t.reservation_id
        LEFT JOIN rooms r ON r.id=COALESCE(t.room_id,h.room_id)
        LEFT JOIN tenancy_activation_codes c ON c.application_id=a.id
        """;
    public List<Map<String,Object>> mine(String email) { var list=rows(VIEW+" WHERE a.account_id=? ORDER BY a.submitted_at DESC",user(email)); list.forEach(agreements::enrich);return list; }
    public List<Map<String,Object>> pending(String email) { var list=rows(VIEW+" WHERE p.owner_id=? ORDER BY a.submitted_at DESC",owner(email));list.forEach(agreements::enrich);return list; }
    private Map<String,Object> pointer(UUID app) {
        return one("""
            SELECT a.property_id,a.invitation_id,h.room_id FROM registration_applications a
            LEFT JOIN invitations i ON i.id=a.invitation_id LEFT JOIN reservations h ON h.id=i.reservation_id WHERE a.id=?
            """,app);
    }
    private Map<String,Object> lockApp(UUID app) {
        var pointer=pointer(app);
        if(pointer.get("room_id")!=null) one("SELECT id FROM rooms WHERE id=? FOR UPDATE",id(pointer,"room_id"));
        return one("SELECT * FROM registration_applications WHERE id=? FOR UPDATE",app);
    }
    @Transactional public Map<String,Object> approve(String email,UUID app,UUID room,String reason) {
        UUID actor=owner(email); var pointer=pointer(app); propertyOwner(actor,id(pointer,"property_id"));
        if(pointer.get("room_id")!=null && !room.equals(id(pointer,"room_id")))
            throw new FlowException(409,"ROOM_FIXED","This application already has a held room. Release it before assigning another.");
        var r=one("SELECT * FROM rooms WHERE id=? FOR UPDATE",room);
        if(!id(r,"property_id").equals(id(pointer,"property_id"))) throw new FlowException(400,"ROOM_MISMATCH","Select a room belonging to this application’s property.");
        var a=one("SELECT * FROM registration_applications WHERE id=? FOR UPDATE",app);
        if(a.get("status").equals("APPROVED"))
            return Map.of("message","Already approved. No duplicate tenancy was created.","delivery","NOT_REQUIRED");
        if(!a.get("status").equals("PENDING_APPROVAL") || !Boolean.TRUE.equals(
                one("SELECT email_verified FROM accounts WHERE id=?",id(a,"account_id")).get("email_verified")))
            throw new FlowException(409,"APPLICATION_STATE","Only verified applications pending approval can be approved.");
        agreements.requireAccepted(app,room,r);
        UUID invitation;
        if(a.get("invitation_id")==null) {
            int held=db.queryForObject("SELECT count(*) FROM reservations WHERE room_id=? AND status='HELD'",Integer.class,room);
            int active=db.queryForObject("SELECT count(*) FROM tenancies WHERE room_id=? AND status='ACTIVE'",Integer.class,room);
            if(held+active>=((Number)r.get("capacity")).intValue()) throw new FlowException(409,"ROOM_FULL","That room has no available place. Choose another.");
            UUID reservation=UUID.randomUUID(); invitation=UUID.randomUUID();
            var account=one("SELECT email FROM accounts WHERE id=?",id(a,"account_id"));
            db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'HELD',?,?)",reservation,room,actor,now());
            // This reference is already claimed; its unused random token is never exposed or delivered.
            db.update("INSERT INTO invitations(id,reservation_id,email,token_hash,token_expires_at,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,'CLAIMED',?,?,?,?)",
                invitation,reservation,account.get("email"),RegistrationService.hash(UUID.randomUUID().toString()+UUID.randomUUID()),now().plus(ttl),actor,now(),id(a,"account_id"),now());
            db.update("UPDATE registration_applications SET invitation_id=? WHERE id=?",invitation,app);
            audit(reservation,"RESERVATION_HELD",actor,"Owner approved room assignment");
            audit(invitation,"APPROVAL_INVITATION_CREATED",actor,reason);
        } else {
            invitation=id(a,"invitation_id");
            var h=one("SELECT h.status FROM reservations h JOIN invitations i ON i.reservation_id=h.id WHERE i.id=?",invitation);
            if(!h.get("status").equals("HELD")) throw new FlowException(409,"NOT_HELD","The reservation is no longer held.");
        }
        var h=one("SELECT h.* FROM reservations h JOIN invitations i ON i.reservation_id=h.id WHERE i.id=?",invitation);
        db.update("UPDATE reservations SET status='CONVERTED',updated_by=?,updated_at=?,reason=? WHERE id=?",actor,now(),reason,id(h,"id"));
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            UUID.randomUUID(),id(h,"id"),app,id(a,"account_id"),room,now(),actor);
        db.update("UPDATE registration_applications SET status='APPROVED',activation_pending=FALSE,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",actor,now(),reason,app);
        db.update("DELETE FROM tenancy_activation_codes WHERE application_id=?",app);
        audit(app,"OWNER_APPROVED",actor,reason); audit(id(h,"id"),"RESERVATION_CONVERTED",actor,"Owner approval started tenancy");
        var details=one(VIEW+" WHERE a.id=?",app);
        String delivery;
        try { delivery=mail.deliverApproval(id(a,"account_id"),String.valueOf(details.get("email")),String.valueOf(details.get("property_name")),String.valueOf(details.get("room_label"))); }
        catch(FlowException unavailable) { delivery="FAILED"; audit(app,"APPROVAL_NOTIFICATION_FAILED",actor,"Approval remains valid; email notification unavailable"); }
        return Map.of("status","APPROVED","delivery",delivery,"message","Approved. The resident tenancy is active; no further email verification is needed.");
    }
    public Map<String,Object> resend(String email,UUID app,boolean asOwner) {
        UUID actor=asOwner ? owner(email) : user(email);
        if(asOwner) propertyOwner(actor,id(pointer(app),"property_id"));
        else if(!id(one("SELECT account_id FROM registration_applications WHERE id=?",app),"account_id").equals(actor))
            throw new FlowException(404,"NOT_FOUND","Application not found.");
        throw new FlowException(410,"ACTIVATION_RETIRED","There is no second email verification. Owner approval activates the tenancy automatically.");
    }
    public Map<String,Object> activate(String email,UUID app,String ignored) {
        UUID actor=user(email); var a=one("SELECT account_id,status FROM registration_applications WHERE id=?",app);
        if(!id(a,"account_id").equals(actor)) throw new FlowException(404,"NOT_FOUND","Application not found.");
        if(a.get("status").equals("APPROVED")) return Map.of("message","Your tenancy is already active. No code is needed.");
        throw new FlowException(410,"ACTIVATION_RETIRED","Wait for owner approval. No second verification code is needed.");
    }
    @Transactional public Map<String,Object> review(String email,UUID app,String action,String reason) {
        UUID actor=owner(email); var p=pointer(app); propertyOwner(actor,id(p,"property_id")); var a=lockApp(app);
        if(action.equals("release")) {
            if(a.get("invitation_id")==null) throw new FlowException(409,"NO_RESERVATION","No place has been reserved for this application.");
            var h=one("SELECT h.* FROM reservations h JOIN invitations i ON i.reservation_id=h.id WHERE i.id=?",id(a,"invitation_id"));
            if(!h.get("status").equals("HELD")) throw new FlowException(409,"NOT_HELD","Only held reservations can be released.");
            db.update("UPDATE reservations SET status='RELEASED',updated_by=?,updated_at=?,reason=? WHERE id=?",actor,now(),reason,id(h,"id"));
            db.update("UPDATE invitations SET status='CANCELLED',updated_by=?,updated_at=?,reason=? WHERE id=?",actor,now(),reason,id(a,"invitation_id"));
            db.update("UPDATE registration_applications SET status='CANCELLED',activation_pending=FALSE,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",actor,now(),reason,app);
            audit(id(h,"id"),"RESERVATION_RELEASED",actor,reason); audit(app,"APPLICATION_CANCELLED",actor,reason);
            return Map.of("message","Application cancelled and reserved place released.");
        }
        if(!List.of("PENDING_APPROVAL","CORRECTIONS_REQUESTED").contains(a.get("status")))
            throw new FlowException(409,"APPLICATION_STATE","This application cannot be reviewed in its current state.");
        String status=switch(action) { case "corrections" -> "CORRECTIONS_REQUESTED"; case "reject" -> "REJECTED"; default -> throw new FlowException(400,"ACTION","Unknown action."); };
        db.update("UPDATE registration_applications SET status=?,activation_pending=FALSE,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",status,actor,now(),reason,app);
        db.update("DELETE FROM tenancy_activation_codes WHERE application_id=?",app);
        audit(app,"APPLICATION_"+status,actor,reason);
        String delivery=agreements.notifyUpdate(one("SELECT * FROM registration_applications WHERE id=?",app),"Application update",reason);
        return Map.of("delivery",delivery,"message",status.equals("REJECTED") ? "Application rejected. Any existing reservation remains held." : "Corrections requested. Any existing reservation remains held.");
    }
    @Transactional public Map<String,Object> correct(String email,UUID app,String name,String contact) {
        UUID actor=user(email); var a=lockApp(app);
        if(!id(a,"account_id").equals(actor)) throw new FlowException(404,"NOT_FOUND","Application not found.");
        if(!a.get("status").equals("CORRECTIONS_REQUESTED")) throw new FlowException(409,"APPLICATION_STATE","Corrections have not been requested.");
        db.update("UPDATE registration_applications SET full_name=?,contact=?,status='PENDING_APPROVAL',submitted_at=? WHERE id=?",name.trim(),contact.trim(),now(),app);
        audit(app,"CORRECTIONS_SUBMITTED",actor,null);
        return Map.of("message","Corrections submitted for owner review.");
    }
}
