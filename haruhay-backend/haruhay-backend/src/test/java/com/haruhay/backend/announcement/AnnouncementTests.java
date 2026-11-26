package com.haruhay.backend.announcement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AnnouncementTests {
    private static final String OWNER="notices-owner@example.test", OTHER_OWNER="notices-other-owner@example.test";
    private static final String RESIDENT="notices-resident@example.test", OTHER_RESIDENT="notices-other-resident@example.test";
    private static final String PENDING="notices-pending@example.test";
    private static final String OWNER_PATH="/api/owner/announcements", RESIDENT_PATH="/api/resident/announcements";
    private static final String CONTENT="""
        {"title":"Water interruption","category":"MAINTENANCE","summary":"Plan for Tuesday.","message":"Water resumes at noon."}
        """;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    private UUID ownerId, otherOwnerId, residentId, ownProperty, otherProperty, tenancy;

    @BeforeEach
    void setup() {
        ownerId=account(OWNER,"OWNER","Property owner");
        otherOwnerId=account(OTHER_OWNER,"OWNER","Other owner");
        residentId=account(RESIDENT,"APPLICANT","Resident");
        UUID otherResident=account(OTHER_RESIDENT,"APPLICANT","Other resident");
        account(PENDING,"APPLICANT","Pending resident");
        ownProperty=property(ownerId,"Garden House",false);
        otherProperty=property(otherOwnerId,"Hill House",false);
        tenancy=stay(residentId,ownerId,ownProperty);
        stay(otherResident,otherOwnerId,otherProperty);
    }

    @Test
    void draftPublishesAcrossAccountsAndIsArchivedWithItsHistory() throws Exception {
        UUID id=UUID.randomUUID();
        create(id,ownProperty,false,OWNER).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DRAFT"))
            .andExpect(jsonPath("$.author").value("Property owner")).andExpect(jsonPath("$.createdAt").isString())
            .andExpect(jsonPath("$.publishedAt").doesNotExist());
        create(id,ownProperty,false,OWNER).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id.toString()));
        assertThat(db.queryForObject("SELECT COUNT(*) FROM property_announcements WHERE id=?",Integer.class,id)).isOne();
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get(RESIDENT_PATH+"/"+id).with(user(RESIDENT))).andExpect(status().isNotFound());
        edit(id,1,true,OWNER).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PUBLISHED"))
            .andExpect(jsonPath("$.publishedAt").isString()).andExpect(jsonPath("$.version").value(2));
        var firstPublication=db.queryForObject("SELECT published_at FROM property_announcements WHERE id=?",OffsetDateTime.class,id);
        mvc.perform(put(OWNER_PATH+"/"+id).with(user(OWNER).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("{\"version\":2,\"publish\":false,\"content\":"+CONTENT.replace("Water resumes at noon.","Water resumes at 1 PM.")+"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PUBLISHED"));
        assertThat(db.queryForObject("SELECT published_at FROM property_announcements WHERE id=?",OffsetDateTime.class,id)).isEqualTo(firstPublication);
        edit(id,2,false,OWNER).andExpect(status().isConflict());
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].propertyName").value("Garden House"))
            .andExpect(jsonPath("$[0].id").value(id.toString())).andExpect(jsonPath("$[0].message").doesNotExist());
        mvc.perform(get(RESIDENT_PATH+"/"+id).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("Water resumes at 1 PM."));
        archive(id,3,OWNER).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ARCHIVED"))
            .andExpect(jsonPath("$.archivedAt").isString()).andExpect(jsonPath("$.version").value(4));
        archive(id,3,OWNER).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(4));
        mvc.perform(get(OWNER_PATH+"/"+id).with(user(OWNER).roles("OWNER"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.content.message").value("Water resumes at 1 PM.")).andExpect(jsonPath("$.publishedAt").isString());
        mvc.perform(get(RESIDENT_PATH+"/"+id).with(user(RESIDENT))).andExpect(status().isNotFound());
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk()).andExpect(content().json("[]"));
        edit(id,4,true,OWNER).andExpect(status().isConflict());
    }

    @Test
    void ownersAndResidentsCannotReadOrChangeAnotherPropertyNotice() throws Exception {
        UUID id=UUID.randomUUID();
        create(id,ownProperty,true,OWNER).andExpect(status().isOk());
        create(UUID.randomUUID(),otherProperty,true,OWNER).andExpect(status().isNotFound());
        create(UUID.randomUUID(),property(ownerId,"Sample",true),true,OWNER).andExpect(status().isNotFound());
        mvc.perform(get(OWNER_PATH).with(user(OTHER_OWNER).roles("OWNER"))).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get(OWNER_PATH+"/"+id).with(user(OTHER_OWNER).roles("OWNER"))).andExpect(status().isNotFound());
        edit(id,1,true,OTHER_OWNER).andExpect(status().isNotFound());
        archive(id,1,OTHER_OWNER).andExpect(status().isNotFound());
        mvc.perform(get(RESIDENT_PATH+"/"+id).with(user(OTHER_RESIDENT))).andExpect(status().isNotFound());
        mvc.perform(get(RESIDENT_PATH).with(user(OTHER_RESIDENT))).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get(RESIDENT_PATH).with(user(PENDING))).andExpect(status().isForbidden());
        mvc.perform(get(OWNER_PATH).with(user(RESIDENT))).andExpect(status().isForbidden());
    }

    @Test
    void moveOutRemovesJustTheEndedPropertyFromTheResidentBoard() throws Exception {
        UUID id=UUID.randomUUID(), otherId=UUID.randomUUID();
        UUID secondStay=stay(residentId,otherOwnerId,otherProperty);
        create(id,ownProperty,true,OWNER).andExpect(status().isOk());
        create(otherId,otherProperty,true,OTHER_OWNER).andExpect(status().isOk());
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk())
            .andExpect(jsonPath("$[*].id",contains(otherId.toString(),id.toString())));
        moveOut(tenancy,OWNER);
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isOk()).andExpect(jsonPath("$[*].id",contains(otherId.toString())));
        mvc.perform(get(RESIDENT_PATH+"/"+id).with(user(RESIDENT))).andExpect(status().isNotFound());
        moveOut(secondStay,OTHER_OWNER);
        mvc.perform(get(RESIDENT_PATH).with(user(RESIDENT))).andExpect(status().isForbidden());
    }

    @Test
    void validatesFieldsAndAllowsArchivingAnUnpublishedDraft() throws Exception {
        UUID id=UUID.randomUUID();
        mvc.perform(post(OWNER_PATH).with(user(OWNER).roles("OWNER")).with(csrf()).contentType("application/json")
            .content(request(id,ownProperty,true,CONTENT.replace("Water resumes at noon.","  ")))).andExpect(status().isBadRequest());
        create(id,ownProperty,false,OWNER).andExpect(status().isOk());
        archive(id,1,OWNER).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ARCHIVED"))
            .andExpect(jsonPath("$.publishedAt").doesNotExist());
    }

    private void moveOut(UUID id,String email) throws Exception {
        mvc.perform(post("/api/owner/tenancies/"+id+"/move-out").with(user(email).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("{\"reason\":\"Moved out\",\"confirmed\":true}")).andExpect(status().isOk());
    }

    private ResultActions create(UUID id,UUID property,boolean publish,String email) throws Exception {
        return mvc.perform(post(OWNER_PATH).with(user(email).roles("OWNER")).with(csrf()).contentType("application/json")
            .content(request(id,property,publish,CONTENT)));
    }

    private String request(UUID id,UUID property,boolean publish,String content) {
        return "{\"requestId\":\""+id+"\",\"propertyId\":\""+property+"\",\"publish\":"+publish+",\"content\":"+content+"}";
    }

    private ResultActions edit(UUID id,int version,boolean publish,String email) throws Exception {
        return mvc.perform(put(OWNER_PATH+"/"+id).with(user(email).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("{\"version\":"+version+",\"publish\":"+publish+",\"content\":"+CONTENT+"}"));
    }

    private ResultActions archive(UUID id,int version,String email) throws Exception {
        return mvc.perform(post(OWNER_PATH+"/"+id+"/archive").with(user(email).roles("OWNER")).with(csrf()).contentType("application/json")
            .content("{\"version\":"+version+"}"));
    }

    private UUID account(String email,String role,String name) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,password_hash,full_name,contact,role,email_verified,created_at) VALUES(?,?,?,?,'',?,TRUE,?)",
            id,email,"unused-test-hash",name,role,OffsetDateTime.now());
        return id;
    }

    private UUID property(UUID owner,String name,boolean sample) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO properties(id,owner_id,name,sample) VALUES(?,?,?,?)",id,owner,name,sample);
        return id;
    }

    private UUID stay(UUID resident,UUID owner,UUID property) {
        UUID room=UUID.randomUUID(),reservation=UUID.randomUUID(),application=UUID.randomUUID(),id=UUID.randomUUID();
        var now=OffsetDateTime.now();
        db.update("INSERT INTO rooms(id,property_id,label,capacity) VALUES(?,?,?,1)",room,property,"Room "+room.toString().substring(0,8));
        db.update("INSERT INTO reservations(id,room_id,status,created_by,created_at) VALUES(?,?,'CONVERTED',?,?)",reservation,room,owner,now);
        db.update("INSERT INTO registration_applications(id,account_id,property_id,full_name,contact,status,submitted_at) VALUES(?,?,?,'Resident','','APPROVED',?)",
            application,resident,property,now);
        db.update("INSERT INTO tenancies(id,reservation_id,application_id,account_id,room_id,status,started_at,approved_by) VALUES(?,?,?,?,?,'ACTIVE',?,?)",
            id,reservation,application,resident,room,now,owner);
        return id;
    }
}
