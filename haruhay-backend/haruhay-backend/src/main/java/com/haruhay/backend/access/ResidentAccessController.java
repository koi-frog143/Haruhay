package com.haruhay.backend.access;

import jakarta.validation.Valid;
import java.security.Principal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ResidentAccessController {
    private static final String STAFF="/logbook/properties/{property}/resident-access";
    private final ResidentAccessService access;

    public ResidentAccessController(ResidentAccessService access) { this.access=access; }

    @GetMapping("/resident/access-history")
    public List<ResidentAccessService.Movement> resident(Principal user) {
        return access.residentHistory(user.getName());
    }

    @GetMapping(STAFF+"/residents")
    public List<ResidentAccessService.Resident> residents(Principal user,@PathVariable UUID property,@RequestParam String query) {
        return access.residents(user.getName(),property,query);
    }

    @PostMapping(STAFF+"/movements")
    public Map<String,UUID> record(Principal user,@PathVariable UUID property,@Valid @RequestBody ResidentAccessService.RecordMovement request) {
        return Map.of("id",access.record(user.getName(),property,request));
    }

    @GetMapping(STAFF+"/history")
    public ResidentAccessService.HistoryPage history(Principal user,@PathVariable UUID property,
            @RequestParam(required=false) String query,@RequestParam(required=false) ResidentAccessService.Direction direction,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate through,
            @RequestParam(defaultValue="0") int page) {
        return access.ownerHistory(user.getName(),property,query,direction,from,through,page);
    }

    @GetMapping(STAFF+"/history/{eventId}")
    public ResidentAccessService.Audit audit(Principal user,@PathVariable UUID property,@PathVariable UUID eventId) {
        return access.audit(user.getName(),property,eventId);
    }

    @PostMapping(STAFF+"/history/{eventId}/corrections")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void amend(Principal user,@PathVariable UUID property,@PathVariable UUID eventId,
                      @Valid @RequestBody ResidentAccessService.Amend request) {
        access.amend(user.getName(),property,eventId,request);
    }
}
