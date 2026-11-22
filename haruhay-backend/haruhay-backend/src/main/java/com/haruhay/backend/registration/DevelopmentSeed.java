package com.haruhay.backend.registration;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Explicit local owner bootstrap; sample inventory is opt-in and never creates residents. */
@Component
@Profile("dev")
public class DevelopmentSeed implements CommandLineRunner {
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final String email,password,name;
    private final boolean sample;
    public DevelopmentSeed(JdbcTemplate db,PasswordEncoder passwords,
            @Value("${haruhay.dev-owner-email}") String email,@Value("${haruhay.dev-owner-password}") String password,
            @Value("${haruhay.dev-owner-name:Property owner}") String name,@Value("${haruhay.dev-sample-data:false}") boolean sample) {
        this.db=db; this.passwords=passwords; this.email=email.trim().toLowerCase(java.util.Locale.ROOT); this.password=password; this.name=name; this.sample=sample;
    }
    @Override @Transactional public void run(String... args) {
        if(email.isBlank() && password.isBlank()) return;
        if(!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new IllegalStateException("Set DEV_OWNER_EMAIL to your own valid email address.");
        if (password.length()<12 || password.getBytes(StandardCharsets.UTF_8).length>72)
            throw new IllegalStateException("DEV_OWNER_PASSWORD must have at least 12 characters, at most 72 UTF-8 bytes.");
        if (db.queryForObject("SELECT count(*) FROM accounts WHERE email=?",Integer.class,email)>0) return;
        UUID owner=UUID.randomUUID(), property=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,?,'OWNER',TRUE,?)",
            owner,email,passwords.encode(password),name.trim(),"",OffsetDateTime.now());
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,'DEV_OWNER_BOOTSTRAPPED',?,?,?)",
            UUID.randomUUID(),owner,owner,OffsetDateTime.now(),"Explicit local owner credentials");
        if(!sample) return;
        db.update("INSERT INTO properties(id,owner_id,name,sample) VALUES(?,?,?,TRUE)",property,owner,"LOCAL SAMPLE — Haruhay House");
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",UUID.randomUUID(),property,"101 (private)");
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,3)",UUID.randomUUID(),property,"102 (shared)");
        db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,'DEV_SAMPLE_CREATED',?,?,?)",
            UUID.randomUUID(),property,owner,OffsetDateTime.now(),"Explicit dev profile; isolated sample records");
    }
}
