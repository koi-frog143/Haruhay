package com.haruhay.backend.registration;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.Principal;
import java.util.*;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api")
public class OnboardingController {
    private final OnboardingService onboarding;
    private final RoomAgreementService agreements;
    public OnboardingController(OnboardingService onboarding, RoomAgreementService agreements) { this.onboarding=onboarding;this.agreements=agreements; }
    public record Signup(@NotBlank @Email @Size(max=254) String email,@NotBlank @Size(max=100) String fullName,
        @NotBlank @Size(max=100) String contact,@Size(max=72) String password,@NotNull UUID propertyId, UUID roomId, Long roomVersion, boolean acceptedTerms) {}
    public record Property(@NotBlank @Size(max=160) String name) {}
    public record Room(@NotNull UUID propertyId,@NotBlank @Size(max=80) String label,@Min(1) @Max(100) int capacity) {}
    public record Approval(@NotNull UUID roomId,@NotBlank @Size(max=1000) String reason) {}
    public record Reason(@NotBlank @Size(max=1000) String reason) {}
    public record Code(@NotBlank @Size(max=100) String code) {}
    public record Correction(@NotBlank @Size(max=100) String fullName,@NotBlank @Size(max=100) String contact) {}
    public record Offer(@NotNull UUID roomId,@Min(1) long roomVersion,@jakarta.validation.constraints.DecimalMin("0") @Digits(integer=10,fraction=2) java.math.BigDecimal quote,@NotBlank @Size(max=1000) String reason) {}
    public record Accept(@NotNull UUID offerId) {}
    @GetMapping("/public/rooms") List<Map<String,Object>> publicRooms(@RequestParam UUID propertyId){return agreements.publicRooms(propertyId);}
    @GetMapping("/public/rooms/{id}") Map<String,Object> publicRoom(@PathVariable UUID id){return agreements.publicRoom(id);}
    @PostMapping("/owner/rooms/{id}/details") Map<String,Object> details(Principal u,@PathVariable UUID id,@Valid @RequestBody RoomAgreementService.Details d){return agreements.update(u.getName(),id,d);}
    @PostMapping("/owner/admissions/{id}/offer") Map<String,Object> offer(Principal u,@PathVariable UUID id,@Valid @RequestBody Offer d){return agreements.propose(u.getName(),id,d.roomId(),d.roomVersion(),d.quote(),d.reason());}
    @PostMapping("/account/admissions/{id}/accept-offer") Map<String,Object> accept(Principal u,@PathVariable UUID id,@Valid @RequestBody Accept d){return agreements.accept(u.getName(),id,d.offerId());}
    @GetMapping("/resident/agreements") List<Map<String,Object>> agreements(Principal u){return agreements.agreements(u.getName());}
    @GetMapping("/public/properties") List<Map<String,Object>> properties() { return onboarding.publicProperties(); }
    @PostMapping("/public/accounts/signup") Map<String,Object> signup(@Valid @RequestBody Signup s,Principal user) {
        return agreements.signup(onboarding,s,user==null?null:user.getName());
    }
    @GetMapping("/owner/properties") List<Map<String,Object>> ownerProperties(Principal u) { return onboarding.properties(u.getName()); }
    @PostMapping("/owner/properties") Map<String,Object> createProperty(Principal u,@Valid @RequestBody Property p) { return onboarding.createProperty(u.getName(),p.name()); }
    @PostMapping("/owner/rooms") Map<String,Object> createRoom(Principal u,@Valid @RequestBody Room r) { return onboarding.createRoom(u.getName(),r.propertyId(),r.label(),r.capacity()); }
    @GetMapping("/account/admissions") List<Map<String,Object>> mine(Principal u) { return onboarding.mine(u.getName()); }
    @GetMapping("/owner/admissions") List<Map<String,Object>> pending(Principal u) { return onboarding.pending(u.getName()); }
    @PostMapping("/owner/admissions/{id}/approve") Map<String,Object> approve(Principal u,@PathVariable UUID id,@Valid @RequestBody Approval a) { return onboarding.approve(u.getName(),id,a.roomId(),a.reason()); }
    @PostMapping("/owner/admissions/{id}/{action:corrections|reject|release}") Map<String,Object> review(Principal u,@PathVariable UUID id,@PathVariable String action,@Valid @RequestBody Reason r) { return onboarding.review(u.getName(),id,action,r.reason()); }
    @PostMapping("/owner/admissions/{id}/resend") Map<String,Object> ownerResend(Principal u,@PathVariable UUID id) { return onboarding.resend(u.getName(),id,true); }
    @PostMapping("/account/admissions/{id}/resend") Map<String,Object> resend(Principal u,@PathVariable UUID id) { return onboarding.resend(u.getName(),id,false); }
    @PostMapping("/account/admissions/{id}/activate") Map<String,Object> activate(Principal u,@PathVariable UUID id,@Valid @RequestBody Code c) { return onboarding.activate(u.getName(),id,c.code()); }
    @PostMapping("/account/admissions/{id}/corrections") Map<String,Object> correct(Principal u,@PathVariable UUID id,@Valid @RequestBody Correction c) { return onboarding.correct(u.getName(),id,c.fullName(),c.contact()); }
}
