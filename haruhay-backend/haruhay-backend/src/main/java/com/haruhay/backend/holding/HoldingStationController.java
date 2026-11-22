package com.haruhay.backend.holding;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class HoldingStationController {
    public record CreateItem(
        @NotNull UUID applicationId,
        @NotBlank @Size(max=50) String category,
        @NotBlank @Size(max=150) String description,
        @Size(max=100) String sender,
        @NotBlank @Pattern(regexp="Courier / sender|Visitor|Resident") String depositor,
        @Size(max=100) String tracking,
        @NotBlank @Pattern(regexp="A-[1-4]|B-[1-2]") String slot
    ) {}
    public record EditItem(
        @NotBlank @Size(max=150) String description,
        @NotBlank @Pattern(regexp="A-[1-4]|B-[1-2]") String slot
    ) {}
    public record ReleaseItem(
        @NotBlank @Size(max=100) String claimedBy,
        @NotBlank @Pattern(regexp="Owner|Authorized representative") String relationship,
        @NotBlank @Size(max=60) String idType,
        @NotBlank @Pattern(regexp="[A-Za-z0-9]{4}") String idLastFour,
        boolean verifiedId,
        boolean authorized,
        boolean signed
    ) {}
    public record SearchInquiry(
        @NotBlank @Size(max=100) String visitorName,
        @NotBlank @Size(max=60) String idType,
        @NotBlank @Pattern(regexp="[A-Za-z0-9]{4}") String idLastFour,
        UUID applicationId,
        @Size(max=100) String tracking,
        @NotBlank @Size(max=100) String purpose
    ) {}

    private final HoldingStationService holding;

    public HoldingStationController(HoldingStationService holding) {
        this.holding = holding;
    }

    @GetMapping("/owner/holding-items")
    public List<HoldingStationService.Item> ownerItems(Principal user) {
        return holding.ownerItems(user.getName());
    }

    @GetMapping("/resident/holding-items")
    public List<HoldingStationService.Item> residentItems(Principal user) {
        return holding.residentItems(user.getName());
    }

    @PostMapping("/owner/holding-items")
    public HoldingStationService.Item create(Principal user, @Valid @RequestBody CreateItem request) {
        return holding.create(user.getName(), request);
    }

    @PostMapping("/owner/holding-items/{id}/edit")
    public HoldingStationService.Item edit(Principal user, @PathVariable long id, @Valid @RequestBody EditItem request) {
        return holding.edit(user.getName(), id, request);
    }

    @PostMapping("/owner/holding-items/{id}/release")
    public HoldingStationService.Item release(Principal user, @PathVariable long id, @Valid @RequestBody ReleaseItem request) {
        return holding.release(user.getName(), id, request);
    }

    @PostMapping("/owner/holding-items/{id}/delete")
    public ResponseEntity<Void> archive(Principal user, @PathVariable long id) {
        holding.archive(user.getName(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/owner/holding-inquiries")
    public List<HoldingStationService.Inquiry> inquiries(Principal user) {
        return holding.inquiries(user.getName());
    }

    @PostMapping("/owner/holding-inquiries")
    public HoldingStationService.InquiryResult search(Principal user, @Valid @RequestBody SearchInquiry request) {
        return holding.search(user.getName(), request);
    }
}
