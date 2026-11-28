package com.haruhay.backend.support;

import static com.haruhay.backend.support.ResidentSupportService.Role.OWNER;
import static com.haruhay.backend.support.ResidentSupportService.Role.RESIDENT;
import com.haruhay.backend.support.ResidentSupportService.Change;
import com.haruhay.backend.support.ResidentSupportService.Create;
import com.haruhay.backend.support.ResidentSupportService.Detail;
import com.haruhay.backend.support.ResidentSupportService.Page;
import com.haruhay.backend.support.ResidentSupportService.Reply;
import com.haruhay.backend.support.ResidentSupportService.Status;
import com.haruhay.backend.support.ResidentSupportService.Summary;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ResidentSupportController {
    private static final String RESIDENT_PATH="/resident/support";
    private static final String OWNER_PATH="/owner/support";
    private final ResidentSupportService support;

    public ResidentSupportController(ResidentSupportService support) { this.support=support; }

    @GetMapping(RESIDENT_PATH)
    public List<Summary> mine(Principal user) { return support.mine(user.getName()); }

    @PostMapping(RESIDENT_PATH)
    public Detail create(Principal user,@Valid @RequestBody Create request) {
        return support.create(user.getName(),request);
    }

    @GetMapping(RESIDENT_PATH+"/{id}")
    public Detail residentDetail(Principal user,@PathVariable UUID id) { return support.detail(user.getName(),RESIDENT,id); }

    @PostMapping(RESIDENT_PATH+"/{id}/replies")
    public Detail residentReply(Principal user,@PathVariable UUID id,@Valid @RequestBody Reply request) {
        return support.reply(user.getName(),RESIDENT,id,request);
    }

    @PutMapping(RESIDENT_PATH+"/{id}/status")
    public Detail residentStatus(Principal user,@PathVariable UUID id,@Valid @RequestBody Change request) {
        return support.change(user.getName(),RESIDENT,id,request);
    }

    @GetMapping(OWNER_PATH)
    public Page ownerInbox(Principal user,@RequestParam UUID propertyId,@RequestParam(required=false) String query,
                           @RequestParam(required=false) Status status,@RequestParam(defaultValue="0") int page) {
        return support.ownerInbox(user.getName(),propertyId,query,status,page);
    }

    @GetMapping(OWNER_PATH+"/{id}")
    public Detail ownerDetail(Principal user,@PathVariable UUID id) { return support.detail(user.getName(),OWNER,id); }

    @PostMapping(OWNER_PATH+"/{id}/replies")
    public Detail ownerReply(Principal user,@PathVariable UUID id,@Valid @RequestBody Reply request) {
        return support.reply(user.getName(),OWNER,id,request);
    }

    @PutMapping(OWNER_PATH+"/{id}/status")
    public Detail ownerStatus(Principal user,@PathVariable UUID id,@Valid @RequestBody Change request) {
        return support.change(user.getName(),OWNER,id,request);
    }
}
