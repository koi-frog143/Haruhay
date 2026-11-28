package com.haruhay.backend.settings;

import com.haruhay.backend.notification.NotificationPreferences;
import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.settings.PropertySettingsAudit.Action;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/owner/properties/{property}/settings")
public class PropertySettingsController {
    public record Details(@NotBlank @Size(max=160) String name,@NotNull @Size(max=200) String contact,
                          @NotNull @Size(max=1000) String amenities,@NotNull @Size(max=2000) String houseRules) {
        Details normalized() { return new Details(name.strip(),contact.strip(),amenities.strip(),houseRules.strip()); }
    }
    public record Billing(@NotNull @Min(1) @Max(28) Integer dueDay,@NotNull @Min(0) @Max(30) Integer graceDays) {}
    public record Records(@Min(1) @Max(3650) Integer retentionDays) {}
    public record Settings(Details details,Billing billing,NotificationPreferences notifications,Records records) {}
    private record Owned(UUID owner,Settings settings) {}

    private final JdbcTemplate db;
    private final PropertySettingsAudit audit;

    public PropertySettingsController(JdbcTemplate db,PropertySettingsAudit audit) {
        this.db=db;
        this.audit=audit;
    }

    @GetMapping
    public Settings get(Principal owner,@PathVariable UUID property) {
        return owned(owner,property,false).settings();
    }

    @PutMapping("/details")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void details(Principal owner,@PathVariable UUID property,@Valid @RequestBody Details request) {
        var current=owned(owner,property,true);
        var details=request.normalized();
        if (current.settings().details().equals(details)) return;
        db.update("UPDATE properties SET name=?,contact_details=?,amenities=?,property_house_rules=? WHERE id=?",
            details.name(),details.contact(),details.amenities(),details.houseRules(),property);
        audit.record(property,current.owner(),Action.PROPERTY_DETAILS,"Saved property name, contact, amenities and house rules.");
    }

    @PutMapping("/billing")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void billing(Principal owner,@PathVariable UUID property,@Valid @RequestBody Billing request) {
        var current=owned(owner,property,true);
        if (current.settings().billing().equals(request)) return;
        db.update("UPDATE properties SET billing_due_day=?,billing_grace_days=? WHERE id=?",request.dueDay(),request.graceDays(),property);
        audit.record(property,current.owner(),Action.BILLING_RULES,
            "Default due day "+request.dueDay()+" · Grace period "+request.graceDays()+" days");
    }

    @PutMapping("/notifications")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void notifications(Principal owner,@PathVariable UUID property,@Valid @RequestBody NotificationPreferences request) {
        var current=owned(owner,property,true);
        if (current.settings().notifications().equals(request)) return;
        db.update("UPDATE properties SET notify_announcements=?,notify_maintenance=?,notify_payments=? WHERE id=?",
            request.announcements(),request.maintenance(),request.payments(),property);
        audit.record(property,current.owner(),Action.NOTIFICATIONS,"Announcements "+state(request.announcements())+
            " · Maintenance "+state(request.maintenance())+" · Payment decisions "+state(request.payments()));
    }

    @PutMapping("/records")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void records(Principal owner,@PathVariable UUID property,@Valid @RequestBody Records request) {
        var current=owned(owner,property,true);
        if (current.settings().records().equals(request)) return;
        db.update("UPDATE properties SET retention_days=? WHERE id=?",request.retentionDays(),property);
        audit.record(property,current.owner(),Action.RETENTION,request.retentionDays()==null?"Retention policy cleared."
            :"Recorded a "+request.retentionDays()+"-day retention policy.");
    }

    @GetMapping("/history")
    public List<PropertySettingsAudit.Entry> history(Principal owner,@PathVariable UUID property) {
        owned(owner,property,false);
        return audit.history(property);
    }

    private Owned owned(Principal user,UUID property,boolean lock) {
        return db.query("""
            SELECT p.* FROM properties p WHERE p.id=? AND p.sample=FALSE AND p.owner_id=(
              SELECT id FROM accounts WHERE email=? AND role='OWNER')
            """+(lock?" FOR UPDATE":""),(row,index)->new Owned(row.getObject("owner_id",UUID.class),
                new Settings(new Details(row.getString("name"),row.getString("contact_details"),row.getString("amenities"),
                    row.getString("property_house_rules")),new Billing(row.getInt("billing_due_day"),row.getInt("billing_grace_days")),
                    NotificationPreferences.read(row),new Records(row.getObject("retention_days",Integer.class)))),
            property,user.getName()).stream().findFirst()
            .orElseThrow(()->new FlowException(404,"SETTINGS_PROPERTY_NOT_FOUND","Choose a property you manage."));
    }

    private String state(boolean enabled) { return enabled?"on":"off"; }
}
