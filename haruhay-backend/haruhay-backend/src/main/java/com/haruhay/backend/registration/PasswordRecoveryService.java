package com.haruhay.backend.registration;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordRecoveryService {
    private static final Pattern TOKEN_FORMAT=Pattern.compile("[A-Za-z0-9_-]{43}");
    private final SecureRandom random=new SecureRandom();
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final VerificationDelivery delivery;
    private final Clock clock;
    private final Duration ttl;

    public PasswordRecoveryService(JdbcTemplate db,PasswordEncoder passwords,VerificationDelivery delivery,Clock clock,
            @Value("${haruhay.password-reset-ttl:30m}") Duration ttl) {
        this.db=db;
        this.passwords=passwords;
        this.delivery=delivery;
        this.clock=clock;
        this.ttl=ttl;
        if (ttl.isNegative() || ttl.isZero()) throw new IllegalArgumentException("Password reset lifetime must be positive.");
    }

    @Transactional
    public void issue(String email) {
        var account=db.queryForList("SELECT id FROM accounts WHERE email=? FOR UPDATE",UUID.class,email)
            .stream().findFirst();
        if (account.isEmpty()) return;
        UUID id=account.get();
        byte[] secret=new byte[32];
        random.nextBytes(secret);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        db.update("DELETE FROM account_password_resets WHERE account_id=?",id);
        db.update("INSERT INTO account_password_resets(account_id,token_hash,expires_at) VALUES(?,?,?)",
            id,RegistrationService.hash(token),now().plus(ttl));
        // Delivery failure rolls back replacement, leaving any existing link available.
        delivery.deliverPasswordReset(id,email,token);
    }

    @Transactional
    public void complete(String token,String password,String confirmation) {
        if (token==null || !TOKEN_FORMAT.matcher(token).matches()) throw unusableLink();
        RegistrationService.requirePassword(password);
        if (!password.equals(confirmation))
            throw new FlowException(400,"PASSWORD_CONFIRMATION","Enter the same password in both fields.");
        String hash=RegistrationService.hash(token);
        UUID account=db.queryForList("SELECT account_id FROM account_password_resets WHERE token_hash=?",UUID.class,hash)
            .stream().findFirst().orElseThrow(this::unusableLink);

        // Issuance, email changes, and redemption use the same account lock.
        if (db.queryForList("SELECT id FROM accounts WHERE id=? FOR UPDATE",UUID.class,account).isEmpty())
            throw unusableLink();
        OffsetDateTime expires=db.query("SELECT expires_at FROM account_password_resets WHERE account_id=? AND token_hash=?",
            (row,index)->row.getObject(1,OffsetDateTime.class),account,hash).stream().findFirst().orElseThrow(this::unusableLink);
        if (!expires.isAfter(now())) throw unusableLink();

        db.update("UPDATE accounts SET password_hash=?,credential_version=credential_version+1 WHERE id=?",
            passwords.encode(password),account);
        db.update("DELETE FROM account_password_resets WHERE account_id=?",account);
        db.update("DELETE FROM account_email_changes WHERE account_id=?",account);
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at) VALUES(?,?,'PASSWORD_RESET',?,?)",
            UUID.randomUUID(),account,account,now());
    }

    private OffsetDateTime now() { return clock.instant().atOffset(ZoneOffset.UTC); }

    private FlowException unusableLink() {
        return new FlowException(410,"PASSWORD_RESET_UNAVAILABLE","This reset link is invalid, expired, or already used. Request a new link.");
    }
}
