package com.haruhay.backend.holding;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HoldingStationTests {
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired MockMvc mvc;

    private UUID ownerId;
    private UUID residentId;
    private UUID applicationId;
    private String ownerEmail;
    private String residentEmail;

    @BeforeEach
    void setUp() {
        String url = db.execute((java.sql.Connection connection) -> connection.getMetaData().getURL());
        assertThat(url).containsAnyOf("registration-tests", "haruhay_registration_test");
        for (String table : List.of("visitor_movements","visitor_audit","visitor_qr_credentials","visitor_visits","visitor_requests","visitor_profiles","property_guard_assignments","holding_item_transactions", "holding_inquiries", "holding_items",
                "registration_audit", "monthly_bills", "application_offers", "room_charges",
                "tenancy_activation_codes", "email_verifications", "tenancies",
                "registration_applications", "invitations", "reservations", "rooms", "properties", "accounts")) {
            db.update("DELETE FROM " + table);
        }

        ownerEmail = "holding-owner@example.test";
        residentEmail = "holding-resident@example.test";
        ownerId = seedAccount(ownerEmail, "OWNER", "Property Owner");
        residentId = seedAccount(residentEmail, "APPLICANT", "Resident One");
        UUID propertyId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        UUID reservationId = UUID.randomUUID();
        UUID invitationId = UUID.randomUUID();
        applicationId = UUID.randomUUID();
        UUID tenancyId = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();

        db.update("INSERT INTO properties(id,owner_id,name,sample) VALUES(?,?,?,FALSE)",
            propertyId, ownerId, "Holding Test Property");
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",
            roomId, propertyId, "Room 1");
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,?,?,?)",
            reservationId, roomId, "CONVERTED", ownerId, now);
        db.update("""
            INSERT INTO invitations(id,reservation_id,email,token_hash,token_expires_at,status,created_by,created_at)
            VALUES(?,?,?,?,?,'CLAIMED',?,?)
            """, invitationId, reservationId, residentEmail, UUID.randomUUID().toString(),
            now.plusDays(1), ownerId, now);
        db.update("""
            INSERT INTO registration_applications(id,invitation_id,account_id,full_name,contact,status,
                submitted_at,reviewed_by,reviewed_at,review_reason)
            VALUES(?,?,?,?,?,'APPROVED',?,?,?,?)
            """, applicationId, invitationId, residentId, "Resident One", "09171234567",
            now, ownerId, now, "Approved for test");
        db.update("""
            INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by)
            VALUES(?,?,?,?,?,'ACTIVE',?,?)
            """, tenancyId, reservationId, applicationId, residentId, roomId, now, ownerId);
    }

    private UUID seedAccount(String email, String role, String name) {
        UUID id = UUID.randomUUID();
        db.update("""
            INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at)
            VALUES(?,?,?,?,?,?,TRUE,?)
            """, id, email, passwords.encode("Local-test-password42"), name, "09171234567", role, OffsetDateTime.now());
        return id;
    }

    private String itemRequest(String slot) {
        return """
            {"applicationId":"%s","category":"Parcel","description":"Test package","sender":"Courier",
             "depositor":"Courier / sender","tracking":"TRACK-001","slot":"%s"}
            """.formatted(applicationId, slot);
    }

    private long createItem(String slot) throws Exception {
        mvc.perform(post("/api/owner/holding-items").with(user(ownerEmail).roles("OWNER")).with(csrf())
                .contentType("application/json").content(itemRequest(slot)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("Ready"))
            .andExpect(jsonPath("$.code").exists());
        return db.queryForObject("SELECT id FROM holding_items WHERE slot=?", Long.class, slot);
    }

    @Test
    void ownerCanRecordWhileResidentSeesOnlyTheirOwnItemAndPickupCode() throws Exception {
        createItem("A-1");

        mvc.perform(get("/api/owner/holding-items").with(user(ownerEmail).roles("OWNER")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].residentName").value("Resident One"))
            .andExpect(jsonPath("$[0].pin").doesNotExist());
        mvc.perform(get("/api/resident/holding-items").with(user(residentEmail).roles("APPLICANT")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].residentName").value("Resident One"))
            .andExpect(jsonPath("$[0].pin").value(org.hamcrest.Matchers.matchesPattern("\\d{6}")));
        mvc.perform(get("/api/owner/holding-items").with(user(residentEmail).roles("APPLICANT")))
            .andExpect(status().isForbidden());
    }

    @Test
    void releaseRequiresManualIdVerificationAndReceiptThenArchiveRetainsHistory() throws Exception {
        long id = createItem("A-1");
        String base = "/api/owner/holding-items/" + id + "/release";
        String unverified = """
            {"claimedBy":"Resident One","relationship":"Owner","idType":"National ID",
             "idLastFour":"1234","verifiedId":false,"authorized":false,"signed":true}
            """;
        mvc.perform(post(base).with(user(ownerEmail).roles("OWNER")).with(csrf())
                .contentType("application/json").content(unverified))
            .andExpect(status().isBadRequest());
        assertThat(db.queryForObject("SELECT status FROM holding_items WHERE id=?", String.class, id)).isEqualTo("READY");

        String verified = unverified.replace("\"verifiedId\":false", "\"verifiedId\":true");
        mvc.perform(post(base).with(user(ownerEmail).roles("OWNER")).with(csrf())
                .contentType("application/json").content(verified))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("Claimed"))
            .andExpect(jsonPath("$.history[1]").value(org.hamcrest.Matchers.containsString("1234")));
        assertThat(db.queryForObject("SELECT id_last_four FROM holding_items WHERE id=?", String.class, id)).isEqualTo("1234");
        assertThat(db.queryForObject("SELECT receipt_confirmed FROM holding_items WHERE id=?", Boolean.class, id)).isTrue();

        mvc.perform(post("/api/owner/holding-items/" + id + "/delete")
                .with(user(ownerEmail).roles("OWNER")).with(csrf()))
            .andExpect(status().isNoContent());
        mvc.perform(get("/api/owner/holding-items").with(user(ownerEmail).roles("OWNER")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isEmpty());
        assertThat(db.queryForObject("SELECT count(*) FROM holding_item_transactions WHERE item_id=?", Integer.class, id))
            .isEqualTo(3);
    }

    @Test
    void shelfCannotBeDoubleBooked() throws Exception {
        createItem("A-1");
        mvc.perform(post("/api/owner/holding-items").with(user(ownerEmail).roles("OWNER")).with(csrf())
                .contentType("application/json").content(itemRequest("A-1")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("SLOT_OCCUPIED"));
    }
}
