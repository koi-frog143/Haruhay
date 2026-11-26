package com.haruhay.backend.registration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class TenancyController {
    public record MoveOut(@NotBlank @Size(max=1000) String reason, boolean confirmed) {}
    public record Proposal(@NotNull UUID roomId, @Positive long version,
                           @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal monthlyRent) {}

    private final TenancyService service;

    public TenancyController(TenancyService service) {
        this.service=service;
    }

    @GetMapping("/owner/tenancies/{stay}/move-out")
    public Map<String,Object> summary(Principal user,@PathVariable UUID stay) {
        return service.summary(user.getName(),stay);
    }

    @PostMapping("/owner/tenancies/{stay}/move-out")
    public Map<String,Object> moveOut(Principal user,@PathVariable UUID stay,@Valid @RequestBody MoveOut request) {
        if (!request.confirmed()) throw new FlowException(400,"CONFIRM_REQUIRED","Confirm that this tenancy should end now.");
        return service.moveOut(user.getName(),stay,request.reason().strip());
    }

    @GetMapping("/owner/tenancies/{stay}/transfers")
    public List<Map<String,Object>> ownerTransfers(Principal user,@PathVariable UUID stay) {
        return service.ownerTransfers(user.getName(),stay);
    }

    @PostMapping("/owner/tenancies/{stay}/transfers")
    public Map<String,Object> propose(Principal user,@PathVariable UUID stay,@Valid @RequestBody Proposal request) {
        return service.propose(user.getName(),stay,request.roomId(),request.version(),request.monthlyRent());
    }

    @PostMapping("/owner/tenancies/{stay}/transfers/{transfer}/complete")
    public Map<String,Object> complete(Principal user,@PathVariable UUID stay,@PathVariable UUID transfer) {
        return service.complete(user.getName(),stay,transfer);
    }

    @GetMapping("/resident/transfers")
    public List<Map<String,Object>> residentTransfers(Principal user) {
        return service.residentTransfers(user.getName());
    }

    @PostMapping("/resident/transfers/{transfer}/accept")
    public Map<String,Object> accept(Principal user,@PathVariable UUID transfer) {
        return service.accept(user.getName(),transfer);
    }
}
