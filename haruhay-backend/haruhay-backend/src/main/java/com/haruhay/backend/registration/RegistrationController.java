package com.haruhay.backend.registration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.security.Principal;
import java.util.*;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class RegistrationController {
    private final RegistrationService flow;
    private final RoomAgreementService agreements;
    public RegistrationController(RegistrationService flow,RoomAgreementService agreements) { this.flow=flow;this.agreements=agreements; }
    public record Token(@NotBlank @Size(max=100) String token) {}
    public record Invite(@NotNull UUID propertyId,@NotNull UUID roomId,@NotBlank @Email @Size(max=254) String email) {}
    public record Claim(@NotBlank @Size(max=100) String token,@NotBlank @Email @Size(max=254) String email,
        @NotBlank @Size(max=100) String fullName,@NotBlank @Size(max=100) String contact,@Size(max=72) String password) {}
    public record Reason(@NotBlank @Size(max=1000) String reason) {}
    public record Correction(@NotBlank @Size(max=100) String fullName,@NotBlank @Size(max=100) String contact) {}

    @GetMapping("/auth/csrf") Map<String,String> csrf(CsrfToken token) {
        return Map.of("headerName",token.getHeaderName(),"token",token.getToken());
    }
    @GetMapping("/account") Map<String,Object> me(Principal user) { return flow.account(user.getName()); }
    // Tokens use POST bodies, never query strings in server access logs.
    @PostMapping("/public/invitations/inspect") Map<String,Object> inspect(@Valid @RequestBody Token token) { return flow.inspect(token.token()); }
    @PostMapping("/public/registrations") Map<String,Object> register(@Valid @RequestBody Claim claim,Principal user) {
        throw new FlowException(410,"SIGN_UP_FIRST","Use Create an account first. The owner will email an activation code after approving your room.");
    }
    @PostMapping("/public/email/verify") Map<String,Object> verify(@Valid @RequestBody Token token) { return flow.verify(token.token()); }
    @PostMapping("/account/verification") Map<String,Object> resend(Principal user) { return flow.resend(user.getName()); }
    @GetMapping("/account/applications") List<Map<String,Object>> status(Principal user) { return flow.myApplications(user.getName()); }
    @PostMapping("/account/applications/{id}/corrections") Map<String,Object> correct(Principal user,@PathVariable UUID id,@Valid @RequestBody Correction c) {
        return flow.correct(user.getName(),id,c.fullName(),c.contact());
    }
    @GetMapping("/resident/tenancies") List<Map<String,Object>> tenancies(Principal user) { return flow.tenancies(user.getName()); }
    @GetMapping("/owner/rooms") List<Map<String,Object>> rooms(Principal user) { return agreements.ownerRooms(user.getName()); }
    @GetMapping("/owner/invitations") List<Map<String,Object>> invitations(Principal user) { return flow.invitations(user.getName()); }
    @PostMapping("/owner/invitations") Map<String,Object> invite(Principal user,@Valid @RequestBody Invite i) {
        throw new FlowException(410,"USE_APPROVAL","Residents now sign up first. Approve their application to email an activation code.");
    }
    @PostMapping("/owner/invitations/{id}/{action:replace|revoke|cancel}") Map<String,Object> action(Principal user,@PathVariable UUID id,@PathVariable String action,@Valid @RequestBody Reason r) {
        if(action.equals("replace")) throw new FlowException(410,"USE_EMAIL_RESEND","Use the application’s resend activation email action.");
        return flow.invitationAction(user.getName(),id,action,r.reason());
    }
    @GetMapping("/owner/invitations/{id}/history") List<Map<String,Object>> history(Principal user,@PathVariable UUID id) { return flow.history(user.getName(),id); }
    @GetMapping("/owner/applications") List<Map<String,Object>> applications(Principal user) { return flow.applications(user.getName()); }
    @PostMapping("/owner/applications/{id}/{action:approve|corrections|reject}") Map<String,Object> review(Principal user,@PathVariable UUID id,@PathVariable String action,@Valid @RequestBody Reason r) {
        throw new FlowException(410,"USE_ADMISSIONS","Review this application through the current admissions workflow.");
    }
}
