package com.haruhay.backend.registration;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** All room occupancy writes lock the same room first; reservations never expire with their tokens. */
@Service
public class RegistrationService {
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final VerificationDelivery delivery;
    private final Clock clock;
    private final Duration invitationTtl, verificationTtl;
    private final String frontend;
    private final SecureRandom random=new SecureRandom();
    public RegistrationService(JdbcTemplate db, PasswordEncoder passwords, VerificationDelivery delivery, Clock clock,
            @Value("${haruhay.invitation-ttl:72h}") Duration invitationTtl,
            @Value("${haruhay.verification-ttl:24h}") Duration verificationTtl,
            @Value("${haruhay.frontend-url}") String frontend) {
        this.db=db; this.passwords=passwords; this.delivery=delivery; this.clock=clock;
        this.invitationTtl=invitationTtl; this.verificationTtl=verificationTtl; this.frontend=frontend;
        if (invitationTtl.isNegative() || invitationTtl.isZero() || verificationTtl.isNegative() || verificationTtl.isZero())
            throw new IllegalArgumentException("Token lifetimes must be positive.");
    }
    private OffsetDateTime now() { return OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC); }
    private UUID id(Map<String,Object> r,String k) { return UUID.fromString(r.get(k).toString()); }
    private String str(Map<String,Object> r,String k) { return String.valueOf(r.get(k)); }
    private List<Map<String,Object>> rows(String sql,Object... args) {
        List<Map<String,Object>> result=db.queryForList(sql,args);
        // PostgreSQL returns Timestamp for timestamptz; H2 returns OffsetDateTime.
        result.forEach(row -> row.replaceAll((key,value) -> value instanceof java.sql.Timestamp t
            ? t.toInstant().atOffset(ZoneOffset.UTC) : value));
        return result;
    }
    private Map<String,Object> one(String sql,Object... args) {
        return rows(sql,args).stream().findFirst().orElseThrow(() -> new FlowException(404,"NOT_FOUND","Record not found."));
    }
    private String token() { byte[] bytes=new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    public static String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    private void audit(UUID entity,String event,UUID actor,String reason) {
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)",
            UUID.randomUUID(),entity,event,actor,now(),reason);
    }
    public Map<String,Object> account(String email) {
        var account=one("SELECT id,email,full_name,contact,role,email_verified FROM accounts WHERE email=?",email);
        if (!account.get("role").equals("OWNER") && db.queryForObject("SELECT count(*) FROM property_guard_assignments WHERE account_id=? AND enabled=TRUE",Integer.class,account.get("id"))>0) account.put("role","GUARD");
        if ("APPLICANT".equals(account.get("role")) && db.queryForObject("SELECT count(*) FROM maintenance_staff WHERE account_id=?",Integer.class,account.get("id"))>0) account.put("role","TECHNICIAN");
        return account;
    }
    private UUID owner(String email) {
        Map<String,Object> account=account(email);
        if (!str(account,"role").equals("OWNER")) throw new FlowException(403,"FORBIDDEN","Owner access required.");
        return id(account,"id");
    }
    private void owns(UUID actor,UUID room) {
        if (db.queryForObject("SELECT count(*) FROM rooms r JOIN properties p ON p.id=r.property_id WHERE r.id=? AND p.owner_id=?",
                Integer.class,room,actor)!=1) throw new FlowException(404,"NOT_FOUND","Property or room not found.");
    }
    public List<Map<String,Object>> rooms(String email) {
        return rows("""
            SELECT r.id,r.property_id,r.label,r.capacity,p.name AS property_name,p.sample,
            (SELECT count(*) FROM reservations h WHERE h.room_id=r.id AND h.status='HELD') AS held,
            (SELECT count(*) FROM tenancies t WHERE t.room_id=r.id AND t.status='ACTIVE') AS active
            FROM rooms r JOIN properties p ON p.id=r.property_id WHERE p.owner_id=? ORDER BY p.name,r.label
            """,owner(email));
    }
    private Map<String,Object> lockRoom(UUID room) { return one("SELECT * FROM rooms WHERE id=? FOR UPDATE",room); }
    @Transactional
    public Map<String,Object> createInvitation(String email,UUID property,UUID room,String invitee) {
        UUID actor=owner(email); owns(actor,room);
        Map<String,Object> r=lockRoom(room);
        if (!id(r,"property_id").equals(property)) throw new FlowException(400,"ROOM_MISMATCH","Choose a room in the selected property.");
        int held=db.queryForObject("SELECT count(*) FROM reservations WHERE room_id=? AND status='HELD'",Integer.class,room);
        int active=db.queryForObject("SELECT count(*) FROM tenancies WHERE room_id=? AND status='ACTIVE'",Integer.class,room);
        if (held+active>=((Number)r.get("capacity")).intValue()) throw new FlowException(409,"ROOM_FULL","This room has no available occupancy slots.");
        UUID reservation=UUID.randomUUID(), invitation=UUID.randomUUID();
        String raw=token(); OffsetDateTime expiry=now().plus(invitationTtl);
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'HELD',?,?)",reservation,room,actor,now());
        db.update("""
            INSERT INTO invitations(id,reservation_id,email,token_hash,token_expires_at,status,created_by,created_at)
            VALUES(?,?,?,?,?,'OPEN',?,?)
            """,invitation,reservation,invitee.trim().toLowerCase(Locale.ROOT),hash(raw),expiry,actor,now());
        audit(reservation,"RESERVATION_HELD",actor,"Invitation created");
        audit(invitation,"INVITATION_CREATED",actor,null);
        return issued(invitation,raw,expiry);
    }
    private Map<String,Object> issued(UUID invitation,String raw,OffsetDateTime expiry) {
        return Map.of("id",invitation,"link",frontend+"/#/account/invitation?token="+raw,"token",raw,"expiresAt",expiry,
            "message","Copy this private link now. It is shown only once. The slot stays reserved until explicitly released.");
    }
    private Map<String,Object> lockInvitation(UUID invitation) {
        Map<String,Object> pointer=one("SELECT h.room_id FROM invitations i JOIN reservations h ON h.id=i.reservation_id WHERE i.id=?",invitation);
        lockRoom(id(pointer,"room_id"));
        return one("SELECT i.*,h.room_id,h.status AS reservation_status FROM invitations i JOIN reservations h ON h.id=i.reservation_id WHERE i.id=? FOR UPDATE",invitation);
    }
    @Transactional
    public Map<String,Object> invitationAction(String email,UUID invitation,String action,String reason) {
        UUID actor=owner(email); Map<String,Object> i=lockInvitation(invitation); owns(actor,id(i,"room_id"));
        if (!str(i,"reservation_status").equals("HELD")) throw new FlowException(409,"NOT_HELD","This reservation is no longer held.");
        if (action.equals("cancel")) {
            db.update("UPDATE invitations SET status='CANCELLED',updated_by=?,updated_at=?,reason=? WHERE id=?",actor,now(),reason,invitation);
            db.update("UPDATE reservations SET status='RELEASED',updated_by=?,updated_at=?,reason=? WHERE id=?",actor,now(),reason,id(i,"reservation_id"));
            db.update("UPDATE registration_applications SET status='CANCELLED',reviewed_by=?,reviewed_at=?,review_reason=? WHERE invitation_id=?",actor,now(),reason,invitation);
            audit(invitation,"INVITATION_CANCELLED",actor,reason); audit(id(i,"reservation_id"),"RESERVATION_RELEASED",actor,reason);
        } else {
            if (str(i,"status").equals("CLAIMED")) throw new FlowException(409,"CLAIMED","This invitation already has an application. Review or explicitly cancel it.");
            if (action.equals("replace")) {
                String raw=token(); OffsetDateTime expiry=now().plus(invitationTtl);
                db.update("UPDATE invitations SET token_hash=?,token_expires_at=?,status='OPEN',updated_by=?,updated_at=?,reason=? WHERE id=?",
                    hash(raw),expiry,actor,now(),reason,invitation);
                audit(invitation,"TOKEN_REPLACED",actor,reason); return issued(invitation,raw,expiry);
            }
            if (!action.equals("revoke")) throw new FlowException(400,"ACTION","Unknown action.");
            db.update("UPDATE invitations SET status='REVOKED',updated_by=?,updated_at=?,reason=? WHERE id=?",actor,now(),reason,invitation);
            audit(invitation,"TOKEN_REVOKED",actor,reason);
        }
        return Map.of("message",action.equals("cancel") ? "Invitation cancelled and reservation released." : "Token revoked. Reservation remains held.");
    }
    private void usable(Map<String,Object> i) {
        String status=str(i,"status");
        if (status.equals("CLAIMED")) throw new FlowException(409,"CLAIMED","This invitation was already claimed. Sign in to view your application.");
        if (!status.equals("OPEN")) throw new FlowException(410,status,"This invitation is "+status.toLowerCase(Locale.ROOT)+". Contact the owner.");
        Instant expiry=((OffsetDateTime)i.get("token_expires_at")).toInstant();
        if (!clock.instant().isBefore(expiry)) throw new FlowException(410,"EXPIRED","This invitation token has expired. Ask the owner for a replacement; the reservation remains held.");
        if (!str(i,"reservation_status").equals("HELD")) throw new FlowException(410,"RELEASED","The reservation is no longer available.");
    }
    private UUID invitationForToken(String raw) {
        if (raw==null || raw.length()!=43) throw new FlowException(404,"INVALID","Invitation is invalid. Check the private link.");
        List<Map<String,Object>> rows=rows("SELECT id FROM invitations WHERE token_hash=?",hash(raw));
        if (rows.isEmpty()) throw new FlowException(404,"INVALID","Invitation is invalid or has been replaced. Contact the owner.");
        return id(rows.getFirst(),"id");
    }
    @Transactional(readOnly=true)
    public Map<String,Object> inspect(String raw) {
        UUID invitation=invitationForToken(raw);
        Map<String,Object> i=one("""
            SELECT i.status,i.token_expires_at,h.status AS reservation_status,p.name AS property_name,r.label AS room_label,r.capacity,p.sample
            FROM invitations i JOIN reservations h ON h.id=i.reservation_id JOIN rooms r ON r.id=h.room_id
            JOIN properties p ON p.id=r.property_id WHERE i.id=?
            """,invitation);
        usable(i);
        return Map.of("propertyName",i.get("property_name"),"roomLabel",i.get("room_label"),"capacity",i.get("capacity"),
            "sample",i.get("sample"),"expiresAt",i.get("token_expires_at"));
    }
    @Transactional
    public Map<String,Object> claim(String raw,String email,String name,String contact,String password,String authenticatedEmail) {
        UUID invitation=invitationForToken(raw); Map<String,Object> i=lockInvitation(invitation); usable(i);
        String normalized=email.trim().toLowerCase(Locale.ROOT);
        if (!normalized.equals(str(i,"email"))) throw new FlowException(400,"EMAIL_MISMATCH","Email must match the address invited by the owner.");
        UUID user;
        if (authenticatedEmail!=null) {
            Map<String,Object> a=account(authenticatedEmail); user=id(a,"id");
            if ("TECHNICIAN".equals(a.get("role"))) throw new FlowException(403,"STAFF_ACCOUNT","Use a separate resident account to apply.");
            if (!str(a,"email").equals(normalized)) throw new FlowException(403,"EMAIL_MISMATCH","Sign in using the invited email address.");
        } else {
            if (db.queryForObject("SELECT count(*) FROM accounts WHERE email=?",Integer.class,normalized)>0)
                throw new FlowException(409,"ACCOUNT_EXISTS","An account already exists. Sign in, then accept this invitation.");
            if (password==null || password.length()<12 || password.getBytes(StandardCharsets.UTF_8).length>72)
                throw new FlowException(400,"PASSWORD","Use a password with at least 12 characters and at most 72 UTF-8 bytes.");
            user=UUID.randomUUID();
            db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,'APPLICANT',FALSE,?)",
                user,normalized,passwords.encode(password),name.trim(),contact.trim(),now());
            audit(user,"ACCOUNT_CREATED",user,null);
        }
        Map<String,Object> a=one("SELECT email_verified FROM accounts WHERE id=? FOR UPDATE",user);
        boolean verified=Boolean.TRUE.equals(a.get("email_verified"));
        UUID app=UUID.randomUUID();
        db.update("INSERT INTO registration_applications(id,invitation_id,account_id,full_name,contact,status,submitted_at) VALUES(?,?,?,?,?,?,?)",
            app,invitation,user,name.trim(),contact.trim(),verified ? "PENDING_APPROVAL" : "AWAITING_EMAIL",now());
        db.update("UPDATE invitations SET status='CLAIMED',updated_by=?,updated_at=? WHERE id=?",user,now(),invitation);
        audit(invitation,"INVITATION_CLAIMED",user,null); audit(app,"APPLICATION_SUBMITTED",user,null);
        String channel=verified ? "NOT_REQUIRED" : sendVerification(user,normalized);
        return Map.of("applicationId",app,"status",verified ? "PENDING_APPROVAL" : "AWAITING_EMAIL","delivery",channel);
    }
    private String sendVerification(UUID account,String email) {
        String raw=token();
        db.update("DELETE FROM email_verifications WHERE account_id=?",account);
        db.update("INSERT INTO email_verifications(id,account_id,token_hash,expires_at) VALUES(?,?,?,?)",
            UUID.randomUUID(),account,hash(raw),now().plus(verificationTtl));
        return delivery.deliver(account,email,raw);
    }
    @Transactional
    public Map<String,Object> resend(String email) {
        Map<String,Object> a=account(email); UUID user=id(a,"id");
        a=one("SELECT email,email_verified FROM accounts WHERE id=? FOR UPDATE",user);
        if (Boolean.TRUE.equals(a.get("email_verified"))) return Map.of("delivery","NOT_REQUIRED","message","Email already verified.");
        audit(user,"VERIFICATION_REPLACED",user,null);
        return Map.of("delivery",sendVerification(user,email));
    }
    @Transactional
    public Map<String,Object> verify(String raw) {
        if (raw==null || raw.length()!=43) throw new FlowException(400,"INVALID_VERIFICATION","Invalid verification link.");
        Map<String,Object> v=one("SELECT account_id FROM email_verifications WHERE token_hash=?",hash(raw));
        UUID user=id(v,"account_id");
        one("SELECT id FROM accounts WHERE id=? FOR UPDATE",user);
        List<Map<String,Object>> tokens=rows("SELECT * FROM email_verifications WHERE token_hash=?",hash(raw));
        if (tokens.isEmpty()) throw new FlowException(410,"USED_VERIFICATION","Verification link was replaced or already used. Sign in to view status.");
        v=tokens.getFirst();
        if (!clock.instant().isBefore(((OffsetDateTime)v.get("expires_at")).toInstant()))
            throw new FlowException(410,"EXPIRED_VERIFICATION","Verification link expired. Sign in to request another.");
        db.update("UPDATE accounts SET email_verified=TRUE WHERE id=?",user);
        db.update("UPDATE registration_applications SET status='PENDING_APPROVAL' WHERE account_id=? AND status='AWAITING_EMAIL'",user);
        db.update("DELETE FROM email_verifications WHERE account_id=?",user);
        audit(user,"EMAIL_VERIFIED",user,null);
        return Map.of("message","Email verified. Your application is pending owner approval.");
    }
    private static final String APPLICATIONS="""
        SELECT a.id,a.invitation_id,a.full_name,a.contact,a.status,a.submitted_at,a.reviewed_at,a.review_reason,
        u.email,u.email_verified,p.name AS property_name,p.sample,r.label AS room_label,h.status AS reservation_status
        FROM registration_applications a JOIN accounts u ON u.id=a.account_id JOIN invitations i ON i.id=a.invitation_id
        JOIN reservations h ON h.id=i.reservation_id JOIN rooms r ON r.id=h.room_id JOIN properties p ON p.id=r.property_id
        """;
    public List<Map<String,Object>> myApplications(String email) {
        return rows(APPLICATIONS+" WHERE a.account_id=? ORDER BY a.submitted_at DESC",id(account(email),"id"));
    }
    public List<Map<String,Object>> applications(String email) {
        return rows(APPLICATIONS+" WHERE p.owner_id=? ORDER BY a.submitted_at DESC",owner(email));
    }
    public List<Map<String,Object>> invitations(String email) {
        return rows("""
            SELECT i.id,i.email,i.status,i.token_expires_at,i.created_at,i.updated_at,i.reason,
            h.id AS reservation_id,h.status AS reservation_status,p.name AS property_name,p.sample,r.label AS room_label,
            a.id AS application_id,a.status AS application_status
            FROM invitations i JOIN reservations h ON h.id=i.reservation_id JOIN rooms r ON r.id=h.room_id
            JOIN properties p ON p.id=r.property_id LEFT JOIN registration_applications a ON a.invitation_id=i.id
            WHERE p.owner_id=? ORDER BY i.created_at DESC
            """,owner(email));
    }
    private Map<String,Object> lockApplication(UUID application) {
        Map<String,Object> a=one("SELECT invitation_id FROM registration_applications WHERE id=?",application);
        Map<String,Object> i=lockInvitation(id(a,"invitation_id"));
        Map<String,Object> result=new HashMap<>(one("SELECT * FROM registration_applications WHERE id=? FOR UPDATE",application));
        result.put("room_id",i.get("room_id")); result.put("reservation_id",i.get("reservation_id"));
        result.put("reservation_status",i.get("reservation_status"));
        return result;
    }
    @Transactional
    public Map<String,Object> review(String email,UUID application,String action,String reason) {
        UUID actor=owner(email); Map<String,Object> a=lockApplication(application); UUID room=id(a,"room_id"); owns(actor,room);
        String status=str(a,"status");
        if (action.equals("approve") && status.equals("APPROVED")) return Map.of("message","Already approved. No duplicate tenancy created.");
        if (!status.equals("PENDING_APPROVAL")) throw new FlowException(409,"APPLICATION_STATE","Only verified applications pending approval can be reviewed.");
        if (!str(a,"reservation_status").equals("HELD")) throw new FlowException(409,"NOT_HELD","The reservation is no longer held.");
        String next=switch(action) { case "approve" -> "APPROVED"; case "corrections" -> "CORRECTIONS_REQUESTED"; case "reject" -> "REJECTED";
            default -> throw new FlowException(400,"ACTION","Unknown review action."); };
        if (action.equals("approve")) {
            db.update("UPDATE reservations SET status='CONVERTED',updated_by=?,updated_at=?,reason='Approved tenancy' WHERE id=?",actor,now(),id(a,"reservation_id"));
            db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
                UUID.randomUUID(),id(a,"reservation_id"),application,id(a,"account_id"),room,now(),actor);
            audit(id(a,"reservation_id"),"RESERVATION_CONVERTED",actor,reason);
        }
        db.update("UPDATE registration_applications SET status=?,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?",next,actor,now(),reason,application);
        audit(application,"APPLICATION_"+next,actor,reason);
        return Map.of("status",next,"message",next.equals("APPROVED") ? "Approved. Reservation converted to active tenancy." : "Review saved. Reservation remains held.");
    }
    @Transactional
    public Map<String,Object> correct(String email,UUID application,String name,String contact) {
        Map<String,Object> a=lockApplication(application); UUID user=id(account(email),"id");
        if (!id(a,"account_id").equals(user)) throw new FlowException(404,"NOT_FOUND","Application not found.");
        if (!str(a,"status").equals("CORRECTIONS_REQUESTED") || !str(a,"reservation_status").equals("HELD"))
            throw new FlowException(409,"APPLICATION_STATE","This application is not awaiting corrections.");
        db.update("UPDATE registration_applications SET full_name=?,contact=?,status='PENDING_APPROVAL',submitted_at=? WHERE id=?",name.trim(),contact.trim(),now(),application);
        audit(application,"CORRECTIONS_SUBMITTED",user,null);
        return Map.of("message","Corrections submitted. Pending owner approval.");
    }
    public List<Map<String,Object>> tenancies(String email) {
        List<Map<String,Object>> rows=rows("""
            SELECT t.id,t.started_at,p.name AS property_name,r.label AS room_label FROM tenancies t
            JOIN rooms r ON r.id=t.room_id JOIN properties p ON p.id=r.property_id
            WHERE t.account_id=? AND t.status='ACTIVE'
            """,id(account(email),"id"));
        if (rows.isEmpty()) throw new FlowException(403,"APPROVAL_REQUIRED","An approved active tenancy is required for resident services.");
        return rows;
    }
    public List<Map<String,Object>> history(String email,UUID invitation) {
        Map<String,Object> scope=one("SELECT h.room_id,h.id AS reservation_id FROM invitations i JOIN reservations h ON h.id=i.reservation_id WHERE i.id=?",invitation);
        owns(owner(email),id(scope,"room_id"));
        return rows("""
            SELECT e.event,e.occurred_at,e.reason,u.email AS actor_email FROM registration_audit e
            LEFT JOIN accounts u ON u.id=e.actor_id WHERE e.entity_id IN (?,?)
            OR e.entity_id IN (SELECT id FROM registration_applications WHERE invitation_id=?) ORDER BY e.occurred_at
            """,invitation,id(scope,"reservation_id"),invitation);
    }
}
