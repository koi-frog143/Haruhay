package com.haruhay.backend.visitor;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GuestPassController {
    private final VisitorService service;

    public GuestPassController(VisitorService service) { this.service = service; }

    @PostMapping("/api/public/visitor-pass")
    public ResponseEntity<VisitorService.GuestPass> pass(@RequestBody VisitorService.Scan link) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.guestPass(link));
    }
}
