package com.haruhay.backend.registration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class RoomAgreementService {
    public record Charge(@NotBlank @Size(max=120) String name,@NotNull String basis,
        @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal amount,@NotNull @Size(max=500) String notes) {}
    public record Details(@Min(1) long version,@NotBlank @Size(max=80) String label,@Min(1) @Max(100) int capacity,
        @NotNull String roomType,@NotNull @Size(max=4000) String description,boolean published,boolean acceptingApplications,
        @NotNull String pricingBasis,@DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal monthlyRent,
        @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal applicantMonthlyQuote,
        @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal securityDeposit,@Min(0) @Max(24) Integer advanceMonths,
        @NotNull @Size(max=4000) String inclusions,@NotNull @Size(max=4000) String houseRules,
        @NotNull @Size(max=40) List<@Valid Charge> charges) {}
    private final JdbcTemplate db;
    private final RegistrationService identities;
    private final VerificationDelivery mail;
    private final Clock clock;
    private final JsonMapper json=JsonMapper.builder().build();
    public RoomAgreementService(JdbcTemplate db,RegistrationService identities,VerificationDelivery mail,Clock clock) {
        this.db=db;this.identities=identities;this.mail=mail;this.clock=clock;
    }
    private OffsetDateTime now(){return OffsetDateTime.ofInstant(clock.instant(),ZoneOffset.UTC);}
    private UUID id(Map<String,Object> r,String key){return UUID.fromString(r.get(key).toString());}
    private Map<String,Object> one(String sql,Object...args){return db.queryForList(sql,args).stream().findFirst().orElseThrow(()->new FlowException(404,"NOT_FOUND","Room or application not found."));}
    private UUID actor(String email){return id(identities.account(email),"id");}
    private void owns(String email,UUID property){if(db.queryForObject("SELECT count(*) FROM properties p JOIN accounts a ON a.id=p.owner_id WHERE p.id=? AND a.email=? AND a.role='OWNER'",Integer.class,property,email)!=1)throw new FlowException(404,"NOT_FOUND","Property not found.");}
    private void audit(UUID entity,String event,UUID actor,String reason){db.update("INSERT INTO registration_audit(id,entity_id,event,actor_id,occurred_at,reason) VALUES(?,?,?,?,?,?)",UUID.randomUUID(),entity,event,actor,now(),reason);}
    private static final String ROOMS="""
        SELECT r.*,p.name AS property_name,p.sample,
        (SELECT count(*) FROM reservations h WHERE h.room_id=r.id AND h.status='HELD') AS held,
        (SELECT count(*) FROM tenancies t WHERE t.room_id=r.id AND t.status='ACTIVE') AS active
        FROM rooms r JOIN properties p ON p.id=r.property_id
        """;
    private Map<String,Object> decorate(Map<String,Object> room){
        room.put("charges",db.queryForList("SELECT name,basis,amount,notes FROM room_charges WHERE room_id=? ORDER BY position",room.get("id")));
        room.put("available",Math.max(0,((Number)room.get("capacity")).intValue()-((Number)room.get("held")).intValue()-((Number)room.get("active")).intValue()));
        return room;
    }
    public List<Map<String,Object>> ownerRooms(String email){
        return db.queryForList(ROOMS+" WHERE p.owner_id=? ORDER BY p.name,r.label",actor(email)).stream().map(this::decorate).toList();
    }
    public List<Map<String,Object>> publicRooms(UUID property){
        return db.queryForList(ROOMS+" WHERE p.id=? AND p.sample=FALSE AND r.published=TRUE ORDER BY r.label",property).stream().map(this::publicView).toList();
    }
    public Map<String,Object> publicRoom(UUID room){return publicView(one(ROOMS+" WHERE r.id=? AND p.sample=FALSE AND r.published=TRUE",room));}
    private Map<String,Object> publicView(Map<String,Object> r){
        decorate(r);r.remove("held");r.remove("active");r.remove("sample");
        // Public inventory and prices only; never join accounts, tenants or owner notes.
        return r;
    }
    @Transactional public Map<String,Object> update(String email,UUID room,Details d){
        var r=one("SELECT * FROM rooms WHERE id=? FOR UPDATE",room);owns(email,id(r,"property_id"));
        if(((Number)r.get("terms_version")).longValue()!=d.version())throw new FlowException(409,"ROOM_CHANGED","This room was edited. Refresh before saving.");
        if(!Set.of("PRIVATE","SHARED").contains(d.roomType())||!Set.of("PER_PERSON","PER_ROOM").contains(d.pricingBasis()))throw new FlowException(400,"ROOM_DETAILS","Choose a valid room type and pricing basis.");
        if(d.roomType().equals("PRIVATE")&&d.capacity()!=1)throw new FlowException(400,"CAPACITY","A private room has exactly one place.");
        int occupied=db.queryForObject("SELECT count(*) FROM reservations WHERE room_id=? AND status='HELD'",Integer.class,room)+db.queryForObject("SELECT count(*) FROM tenancies WHERE room_id=? AND status='ACTIVE'",Integer.class,room);
        if(d.capacity()<occupied)throw new FlowException(409,"CAPACITY","Capacity cannot be lower than held and active places.");
        if(d.label().isBlank())throw new FlowException(400,"ROOM_DETAILS","Enter a room name.");
        if(d.published()&&d.monthlyRent()==null)throw new FlowException(400,"PRICING","Set the advertised monthly rent before publishing.");
        if(d.acceptingApplications()&&!d.published())throw new FlowException(400,"PUBLICATION","Publish the room before accepting applications.");
        for(var c:d.charges()){
            if(!Set.of("INCLUDED","FIXED_MONTHLY","FIXED_MOVE_IN","USAGE_BASED","TO_CONFIRM").contains(c.basis())||c.name().isBlank())throw new FlowException(400,"CHARGE","Check charge names and billing bases.");
            boolean fixed=c.basis().startsWith("FIXED_");
            if(fixed!=(c.amount()!=null))throw new FlowException(400,"CHARGE","Fixed charges need an amount; included, usage-based and unconfirmed charges must leave it blank.");
            if(Set.of("USAGE_BASED","TO_CONFIRM").contains(c.basis())&&c.notes().isBlank())throw new FlowException(400,"CHARGE","Explain how usage-based or unconfirmed charges will be determined.");
        }
        db.update("""
            UPDATE rooms SET label=?,capacity=?,room_type=?,description=?,published=?,accepting_applications=?,pricing_basis=?,monthly_rent=?,
            applicant_monthly_quote=?,security_deposit=?,advance_months=?,inclusions=?,house_rules=?,terms_version=terms_version+1 WHERE id=?
            """,d.label().trim(),d.capacity(),d.roomType(),d.description().trim(),d.published(),d.acceptingApplications(),d.pricingBasis(),d.monthlyRent(),d.applicantMonthlyQuote(),d.securityDeposit(),d.advanceMonths(),d.inclusions().trim(),d.houseRules().trim(),room);
        db.update("DELETE FROM room_charges WHERE room_id=?",room);int position=0;
        for(var c:d.charges())db.update("INSERT INTO room_charges(id,room_id,name,basis,amount,notes,position) VALUES(?,?,?,?,?,?,?)",UUID.randomUUID(),room,c.name().trim(),c.basis(),c.amount(),c.notes().trim(),position++);
        audit(room,"ROOM_DETAILS_UPDATED",actor(email),"Listing version "+(d.version()+1));
        return decorate(one(ROOMS+" WHERE r.id=?",room));
    }
    @Transactional public Map<String,Object> signup(OnboardingService onboarding,OnboardingController.Signup s,String email){
        if(s.roomId()==null||s.roomVersion()==null||!s.acceptedTerms())throw new FlowException(400,"TERMS_REQUIRED","Choose a room and accept its displayed terms before applying.");
        var room=lockForApplication(s.roomId(),s.propertyId(),s.roomVersion());
        var result=onboarding.signup(s.email(),s.fullName(),s.contact(),s.password(),s.propertyId(),email);
        UUID app=UUID.fromString(result.get("applicationId").toString());
        UUID account=id(one("SELECT account_id FROM registration_applications WHERE id=?",app),"account_id");
        initial(app,room,account);return result;
    }
    /** Caller holds the room lock until signup and its accepted snapshot commit together. */
    public Map<String,Object> lockForApplication(UUID room,UUID property,long version){
        var r=one("SELECT * FROM rooms WHERE id=? FOR UPDATE",room);
        if(!id(r,"property_id").equals(property)||!Boolean.TRUE.equals(r.get("published"))||!Boolean.TRUE.equals(r.get("accepting_applications")))throw new FlowException(409,"ROOM_UNAVAILABLE","This room is not accepting applications. Choose another room.");
        if(((Number)r.get("terms_version")).longValue()!=version)throw new FlowException(409,"ROOM_CHANGED","The room details changed. Review and accept the latest version.");
        var details=decorate(one(ROOMS+" WHERE r.id=?",room));
        if(((Number)details.get("available")).intValue()==0)throw new FlowException(409,"ROOM_FULL","This room has no available place.");
        return details;
    }
    private BigDecimal money(Object value){return value==null?null:new BigDecimal(value.toString());}
    public Map<String,Object> snapshot(Map<String,Object> r,BigDecimal quote){
        var s=new LinkedHashMap<String,Object>();
        for(String key:List.of("id","property_id","property_name","label","capacity","room_type","terms_version","description","currency","monthly_rent","pricing_basis","security_deposit","advance_months","inclusions","house_rules","charges"))s.put(key,r.get(key));
        BigDecimal monthly=quote!=null?quote:money(r.get("applicant_monthly_quote"));
        if(monthly==null&&(r.get("pricing_basis").equals("PER_PERSON")||((Number)r.get("capacity")).intValue()==1))monthly=money(r.get("monthly_rent"));
        s.put("applicant_monthly_rent",monthly);
        BigDecimal recurring=BigDecimal.ZERO,oneTime=BigDecimal.ZERO;boolean uncertain=false;
        @SuppressWarnings("unchecked") var charges=(List<Map<String,Object>>)r.get("charges");
        for(var c:charges){String basis=c.get("basis").toString();if(basis.equals("FIXED_MONTHLY"))recurring=recurring.add(money(c.get("amount")));if(basis.equals("FIXED_MOVE_IN"))oneTime=oneTime.add(money(c.get("amount")));if(Set.of("TO_CONFIRM","USAGE_BASED").contains(basis))uncertain=true;}
        s.put("fixed_monthly_charges",recurring);s.put("fixed_move_in_charges",oneTime);
        s.put("monthly_known_total",monthly==null?null:monthly.add(recurring));
        BigDecimal deposit=money(r.get("security_deposit"));Integer advance=r.get("advance_months")==null?null:((Number)r.get("advance_months")).intValue();
        BigDecimal advanceRent=monthly==null||advance==null?null:monthly.multiply(BigDecimal.valueOf(advance));
        s.put("advance_rent",advanceRent);
        s.put("move_in_known_subtotal",(deposit==null?BigDecimal.ZERO:deposit).add(advanceRent==null?BigDecimal.ZERO:advanceRent).add(oneTime).add(recurring));
        s.put("estimate_incomplete",uncertain||deposit==null||advanceRent==null);
        return s;
    }
    private Map<String,Object> offerView(Map<String,Object> offer){
        offer.put("terms",json.readValue(offer.remove("snapshot").toString(),Map.class));
        offer.replaceAll((k,v)->v instanceof java.sql.Timestamp t?t.toInstant().atOffset(ZoneOffset.UTC):v);
        return offer;
    }
    public List<Map<String,Object>> offers(UUID app){return db.queryForList("SELECT * FROM application_offers WHERE application_id=? ORDER BY version DESC",app).stream().map(this::offerView).toList();}
    public void enrich(Map<String,Object> app){app.put("offers",offers(id(app,"id")));}
    public void initial(UUID app,Map<String,Object> room,UUID account){
        db.update("UPDATE registration_applications SET preferred_room_id=? WHERE id=?",room.get("id"),app);
        insertOffer(app,room,account,"Applicant accepted listing details",null,true,1);
    }
    private UUID insertOffer(UUID app,Map<String,Object> room,UUID creator,String reason,BigDecimal quote,boolean accepted,int version){
        UUID offer=UUID.randomUUID();
        db.update("INSERT INTO application_offers(id,application_id,version,room_id,room_version,snapshot,created_by,created_at,reason,accepted_by,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",offer,app,version,room.get("id"),room.get("terms_version"),json.writeValueAsString(snapshot(room,quote)),creator,now(),reason,accepted?creator:null,accepted?now():null);
        audit(app,accepted?"LISTING_TERMS_ACCEPTED":"REVISED_OFFER_CREATED",creator,"Offer version "+version+": "+reason);return offer;
    }
    @Transactional public Map<String,Object> propose(String email,UUID app,UUID room,long roomVersion,BigDecimal quote,String reason){
        var pointer=one("SELECT property_id FROM registration_applications WHERE id=?",app);owns(email,id(pointer,"property_id"));
        one("SELECT id FROM rooms WHERE id=? FOR UPDATE",room);
        var a=one("SELECT * FROM registration_applications WHERE id=? FOR UPDATE",app);
        if(!Set.of("PENDING_APPROVAL","CORRECTIONS_REQUESTED").contains(a.get("status")))throw new FlowException(409,"APPLICATION_STATE","Only pending applications can receive an offer.");
        var r=decorate(one(ROOMS+" WHERE r.id=?",room));
        if(!id(r,"property_id").equals(id(a,"property_id")))throw new FlowException(400,"ROOM_MISMATCH","Choose a room in the application property.");
        if(((Number)r.get("terms_version")).longValue()!=roomVersion)throw new FlowException(409,"ROOM_CHANGED","Review the latest room details before proposing.");
        var held=db.queryForList("SELECT h.room_id FROM reservations h JOIN invitations i ON i.reservation_id=h.id WHERE i.id=? AND h.status='HELD'",a.get("invitation_id"));
        if(!held.isEmpty()&&!room.equals(id(held.getFirst(),"room_id")))throw new FlowException(409,"ROOM_FIXED","Release the existing held reservation explicitly before assigning another room.");
        if(snapshot(r,quote).get("applicant_monthly_rent")==null)throw new FlowException(400,"QUOTE_REQUIRED","Enter an explicit applicant monthly rent for this shared room.");
        int version=db.queryForObject("SELECT COALESCE(MAX(version),0)+1 FROM application_offers WHERE application_id=?",Integer.class,app);
        UUID offer=insertOffer(app,r,actor(email),reason,quote,false,version);
        String delivery=notifyUpdate(a,"Revised room offer",reason+"\nSign in to review and accept the exact room and pricing details. Acceptance alone does not start your tenancy.");
        return Map.of("offerId",offer,"version",version,"delivery",delivery,"message","Revised offer saved. Applicant acceptance and final owner approval are required.");
    }
    @Transactional public Map<String,Object> accept(String email,UUID app,UUID offer){
        var pointer=one("SELECT room_id FROM application_offers WHERE application_id=? AND id=?",app,offer);
        var r=one("SELECT * FROM rooms WHERE id=? FOR UPDATE",id(pointer,"room_id"));
        var a=one("SELECT * FROM registration_applications WHERE id=? FOR UPDATE",app);
        if(!id(a,"account_id").equals(actor(email)))throw new FlowException(404,"NOT_FOUND","Application not found.");
        if(!Set.of("PENDING_APPROVAL","CORRECTIONS_REQUESTED").contains(a.get("status")))throw new FlowException(409,"APPLICATION_STATE","This application cannot accept new terms.");
        if(!Boolean.TRUE.equals(identities.account(email).get("email_verified")))throw new FlowException(409,"EMAIL_UNVERIFIED","Verify your signup email before accepting a revised offer.");
        var latest=offers(app).getFirst();
        if(!id(latest,"id").equals(offer))throw new FlowException(409,"OFFER_SUPERSEDED","A newer offer is available. Review it before accepting.");
        if(((Number)latest.get("room_version")).longValue()!=((Number)r.get("terms_version")).longValue())throw new FlowException(409,"ROOM_CHANGED","The room terms changed. Ask your owner for an updated offer.");
        if(latest.get("accepted_at")==null){db.update("UPDATE application_offers SET accepted_by=?,accepted_at=? WHERE id=?",actor(email),now(),offer);audit(app,"REVISED_OFFER_ACCEPTED",actor(email),"Offer version "+latest.get("version"));}
        return Map.of("message","Offer accepted. Your owner still needs to give final approval.");
    }
    public void requireAccepted(UUID app,UUID room,Map<String,Object> lockedRoom){
        var list=offers(app);
        if(list.isEmpty())throw new FlowException(409,"TERMS_REQUIRED","Send a room offer and obtain applicant acceptance before approval.");
        var offer=list.getFirst();
        if(!room.equals(id(offer,"room_id"))||offer.get("accepted_at")==null)throw new FlowException(409,"OFFER_NOT_ACCEPTED","The applicant must accept the latest proposed room and terms before approval.");
        if(((Number)offer.get("room_version")).longValue()!=((Number)lockedRoom.get("terms_version")).longValue())throw new FlowException(409,"ROOM_CHANGED","Room details changed after acceptance. Send an updated offer first.");
        @SuppressWarnings("unchecked") var terms=(Map<String,Object>)offer.get("terms");
        if(terms.get("applicant_monthly_rent")==null)throw new FlowException(409,"QUOTE_REQUIRED","An explicit applicant monthly rent must be offered and accepted before approval.");
    }
    public String notifyUpdate(Map<String,Object> application,String subject,String message){
        var account=identities.account(db.queryForObject("SELECT email FROM accounts WHERE id=?",String.class,application.get("account_id")));
        try{String result=mail.deliverUpdate(id(account,"id"),account.get("email").toString(),subject,message);return result==null?"FAILED":result;}
        catch(FlowException unavailable){audit(id(application,"id"),"APPLICATION_NOTIFICATION_FAILED",id(account,"id"),"Saved update remains valid; email delivery unavailable");return "FAILED";}
    }
    public List<Map<String,Object>> agreements(String email){
        return db.queryForList("SELECT a.id FROM registration_applications a JOIN accounts u ON u.id=a.account_id JOIN tenancies t ON t.application_id=a.id WHERE u.email=? AND t.status='ACTIVE'",email).stream().map(a->offers(id(a,"id"))).filter(list->!list.isEmpty()).map(List::getFirst).toList();
    }
}
