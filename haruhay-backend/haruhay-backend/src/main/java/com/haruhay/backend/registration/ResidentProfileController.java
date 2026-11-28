package com.haruhay.backend.registration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ResidentProfileController {
    public record Profile(@NotBlank @Size(max=100) String fullName,
                          @NotBlank @Pattern(regexp="[+()0-9 .-]{7,25}") String mobile) {}
    public record EmailRequest(@NotBlank @Email @Size(max=254) String email,
                               @NotBlank @Size(max=72) String currentPassword) {
        @Override public String toString() { return "EmailRequest[redacted]"; }
    }
    public record EmailVerification(@NotBlank @Pattern(regexp="[A-Za-z0-9_-]{43}") String token) {
        @Override public String toString() { return "EmailVerification[redacted]"; }
    }
    private record PendingEmail(String address,OffsetDateTime expiresAt) {}

    private final JdbcTemplate db;
    private final RegistrationService accounts;
    private final PasswordEncoder passwords;
    private final VerificationDelivery delivery;
    private final Clock clock;
    private final Duration ttl;
    private final SecureRandom random=new SecureRandom();

    public ResidentProfileController(JdbcTemplate db,RegistrationService accounts,PasswordEncoder passwords,
            VerificationDelivery delivery,Clock clock,@Value("${haruhay.verification-ttl:24h}") Duration ttl) {
        this.db=db;
        this.accounts=accounts;
        this.passwords=passwords;
        this.delivery=delivery;
        this.clock=clock;
        this.ttl=ttl;
    }

    @PutMapping("/resident/profile")
    @Transactional
    public Map<String,Object> save(Principal user,@Valid @RequestBody Profile profile) {
        if (profile.mobile().replaceAll("[^0-9]","").length()<7)
            throw new FlowException(400,"MOBILE_INVALID","Enter a valid mobile number.");
        UUID account=(UUID)activeAccount(user.getName()).get("id");
        db.update("UPDATE accounts SET full_name=?,contact=? WHERE id=?",profile.fullName().strip(),profile.mobile().strip(),account);
        audit(account,"PROFILE_UPDATED",null);
        return accounts.account(user.getName());
    }

    @PostMapping("/resident/profile/email")
    @Transactional
    public Map<String,String> requestEmail(Principal user,@Valid @RequestBody EmailRequest request) {
        var account=activeAccount(user.getName());
        if (!passwords.matches(request.currentPassword(),account.get("password_hash").toString()))
            throw new FlowException(400,"PASSWORD_MISMATCH","Enter your current password.");
        String address=request.email().strip().toLowerCase(Locale.ROOT);
        requireAvailable(address);
        UUID id=(UUID)account.get("id");
        byte[] secret=new byte[32];
        random.nextBytes(secret);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        db.update("DELETE FROM account_email_changes WHERE account_id=?",id);
        db.update("INSERT INTO account_email_changes(account_id,new_email,token_hash,expires_at) VALUES(?,?,?,?)",
            id,address,RegistrationService.hash(token),now().plus(ttl));
        return Map.of("delivery",delivery.deliverEmailChange(id,address,token));
    }

    @PostMapping("/public/profile/email/verify")
    @Transactional
    public Map<String,String> verify(Principal user,@Valid @RequestBody EmailVerification request) {
        String hash=RegistrationService.hash(request.token());
        UUID account=db.query("SELECT account_id FROM account_email_changes WHERE token_hash=?",
            (r,n)->r.getObject(1,UUID.class),hash).stream().findFirst().orElseThrow(this::invalidLink);
        var identity=db.queryForMap("SELECT email FROM accounts WHERE id=? FOR UPDATE",account);
        String current=identity.get("email").toString();
        if (user==null || !current.equals(user.getName()))
            throw new FlowException(403,"EMAIL_SIGN_IN","Sign in with your current email address, then open this link again.");
        var change=db.query("SELECT new_email,expires_at FROM account_email_changes WHERE account_id=? AND token_hash=?",
                (row,index)->new PendingEmail(row.getString(1),row.getObject(2,OffsetDateTime.class)),account,hash)
            .stream().findFirst().orElseThrow(this::invalidLink);
        if (!change.expiresAt().isAfter(now())) throw invalidLink();
        String address=change.address();
        requireAvailable(address);
        try {
            db.update("UPDATE accounts SET email=?,email_verified=TRUE WHERE id=?",address,account);
        } catch (DuplicateKeyException conflict) {
            throw emailInUse();
        }
        db.update("DELETE FROM account_email_changes WHERE account_id=?",account);
        db.update("DELETE FROM account_password_resets WHERE account_id=?",account);
        audit(account,"SIGN_IN_EMAIL_CHANGED",current+" → "+address);
        return Map.of("message","Email updated. Sign in with your new email address.");
    }

    private Map<String,Object> activeAccount(String email) {
        var account=db.queryForList("SELECT id,password_hash FROM accounts WHERE email=? FOR UPDATE",email)
            .stream().findFirst().orElseThrow(()->new FlowException(403,"ACTIVE_STAY_REQUIRED","An active tenancy is required."));
        if (db.queryForObject("SELECT COUNT(*) FROM tenancies WHERE account_id=? AND status='ACTIVE'",Integer.class,account.get("id"))==0)
            throw new FlowException(403,"ACTIVE_STAY_REQUIRED","An active tenancy is required.");
        return account;
    }

    private void requireAvailable(String address) {
        if (db.queryForObject("SELECT COUNT(*) FROM accounts WHERE email=?",Integer.class,address)>0) throw emailInUse();
    }

    private FlowException emailInUse() {
        return new FlowException(409,"EMAIL_IN_USE","This email is already in use.");
    }

    private FlowException invalidLink() {
        return new FlowException(410,"EMAIL_CHANGE_EXPIRED","This email change link is invalid, expired, or already used. Request a new link from your profile.");
    }

    private OffsetDateTime now() {
        return OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC);
    }

    private void audit(UUID account,String event,String reason) {
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)",
            UUID.randomUUID(),account,event,account,now(),reason);
    }
}
