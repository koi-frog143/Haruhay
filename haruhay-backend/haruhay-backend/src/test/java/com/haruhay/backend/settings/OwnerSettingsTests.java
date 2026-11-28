package com.haruhay.backend.settings;

import static org.hamcrest.Matchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class OwnerSettingsTests {
    private static final String OWNER="settings-owner@example.test", OUTSIDE="settings-outside@example.test";
    private static final String GUARD="settings-guard@example.test", TECH="settings-tech@example.test";
    private static final String PASSWORD="Settings-fixture-staff-password";
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    private UUID property;
    private String path;

    @BeforeEach
    void setup() {
        property=UUID.randomUUID();
        var owner=owner(OWNER);
        owner(OUTSIDE);
        db.update("INSERT INTO properties(id,owner_id,name) VALUES(?,?,'Garden House')",property,owner);
        path="/api/owner/properties/"+property+"/settings";
    }

    @Test
    void detailsAndRetentionSurviveReloadAndOnlyTheOwnerCanSeeTheirAudit() throws Exception {
        var owner=user(OWNER).roles("OWNER");
        var outsider=user(OUTSIDE).roles("OWNER");
        var details="""
            {"name":" Garden Suites ","contact":"Front desk 09171234567","amenities":"Wi-Fi","houseRules":"Quiet after 10 pm"}
            """;
        mvc.perform(get(path).with(owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$.billing.dueDay").value(1)).andExpect(jsonPath("$.billing.graceDays").value(0))
            .andExpect(jsonPath("$.notifications.announcements").value(true));
        mvc.perform(get(path).with(outsider)).andExpect(status().isNotFound());
        mvc.perform(put(path+"/details").with(outsider).with(csrf()).contentType("application/json").content(details))
            .andExpect(status().isNotFound());
        mvc.perform(put(path+"/details").with(owner).with(csrf()).contentType("application/json").content(details))
            .andExpect(status().isNoContent());
        mvc.perform(put(path+"/details").with(owner).with(csrf()).contentType("application/json").content(details))
            .andExpect(status().isNoContent());
        mvc.perform(put(path+"/records").with(owner).with(csrf()).contentType("application/json").content("{\"retentionDays\":365}"))
            .andExpect(status().isNoContent());
        mvc.perform(put(path+"/billing").with(owner).with(csrf()).contentType("application/json").content("{\"dueDay\":31,\"graceDays\":-1}"))
            .andExpect(status().isBadRequest());
        mvc.perform(get(path).with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$.details.name").value("Garden Suites"))
            .andExpect(jsonPath("$.details.contact").value("Front desk 09171234567"))
            .andExpect(jsonPath("$.details.amenities").value("Wi-Fi")).andExpect(jsonPath("$.details.houseRules").value("Quiet after 10 pm"))
            .andExpect(jsonPath("$.records.retentionDays").value(365));
        mvc.perform(get(path+"/history").with(owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].action",containsInAnyOrder("Property details updated","Retention policy updated")))
            .andExpect(jsonPath("$[0].actor").value(OWNER)).andExpect(jsonPath("$[0].occurredAt").isString());
        mvc.perform(get(path+"/history").with(outsider)).andExpect(status().isNotFound());
        mvc.perform(get(path).with(user(GUARD))).andExpect(status().isForbidden());
    }

    @Test
    void existingStaffSessionsLoseAccessAndPropertyHistoryRecordsTheChanges() throws Exception {
        var owner=user(OWNER).roles("OWNER");
        String guards="/api/logbook/properties/"+property+"/guards", staff="/api/maintenance/properties/"+property+"/technicians";
        mvc.perform(post(guards).with(owner).with(csrf()).contentType("application/json").content("""
            {"email":"%s","fullName":"Front desk guard","password":"%s","canReview":true}
            """.formatted(GUARD,PASSWORD))).andExpect(status().isNoContent());
        mvc.perform(post(staff).with(owner).with(csrf()).contentType("application/json").content("""
            {"email":"%s","name":"Repair technician","password":"%s"}
            """.formatted(TECH,PASSWORD))).andExpect(status().isNoContent());
        UUID guard=id(GUARD), tech=id(TECH);
        var guardSession=login(GUARD);
        var techSession=login(TECH);
        mvc.perform(get("/api/logbook/properties").session(guardSession)).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].can_review").value(true));
        mvc.perform(get("/api/maintenance/tickets").session(techSession)).andExpect(status().isOk());

        mvc.perform(post(guards+"/"+guard).with(owner).with(csrf()).contentType("application/json")
            .content("{\"enabled\":true,\"canReview\":false}")).andExpect(status().isNoContent());
        mvc.perform(get("/api/logbook/properties").session(guardSession)).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].can_review").value(false));
        mvc.perform(post(guards+"/"+guard).with(owner).with(csrf()).contentType("application/json")
            .content("{\"enabled\":false,\"canReview\":false}")).andExpect(status().isNoContent());
        mvc.perform(post(staff+"/"+tech).with(owner).with(csrf()).contentType("application/json")
            .content("{\"enabled\":false}")).andExpect(status().isNoContent());
        mvc.perform(get("/api/logbook/properties").session(guardSession)).andExpect(status().isForbidden());
        mvc.perform(get("/api/maintenance/tickets").session(techSession)).andExpect(status().isForbidden());
        mvc.perform(get(staff).with(user(OUTSIDE).roles("OWNER"))).andExpect(status().isForbidden());
        mvc.perform(get(path+"/history").with(owner)).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].action",containsInAnyOrder("Guard account created","Technician account created",
                "Guard access updated","Guard access updated","Technician access updated")))
            .andExpect(content().string(not(containsString(PASSWORD))));
    }

    private UUID owner(String email) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,'','OWNER',TRUE,?)",
            id,email,"unused-test-hash",email,OffsetDateTime.now());
        return id;
    }

    private UUID id(String email) {
        return db.queryForObject("SELECT id FROM accounts WHERE email=?",UUID.class,email);
    }

    private MockHttpSession login(String email) throws Exception {
        return (MockHttpSession)mvc.perform(post("/api/auth/login").with(csrf()).param("username",email).param("password",PASSWORD))
            .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }
}
