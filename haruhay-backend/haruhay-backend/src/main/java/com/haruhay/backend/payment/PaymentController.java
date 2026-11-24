package com.haruhay.backend.payment;

import com.haruhay.backend.storage.PrivateImage;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class PaymentController {
    private final PaymentService service;

    public PaymentController(PaymentService service) { this.service=service; }

    @GetMapping("/{scope:resident|owner}/payments")
    public Object list(Principal user,@PathVariable String scope) {
        return service.list(user.getName(),scope.equals("owner"));
    }
    @GetMapping("/{scope:resident|owner}/payments/{id}")
    public Object payment(Principal user,@PathVariable String scope,@PathVariable UUID id) {
        return service.payment(user.getName(),scope.equals("owner"),id);
    }
    @PostMapping("/resident/payments")
    public Object report(Principal user,@RequestBody PaymentService.Report request) {
        return Map.of("id",service.report(user.getName(),request));
    }
    @PostMapping("/owner/payments/{id}/{action:approve|decline|reverse}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void review(Principal user,@PathVariable UUID id,@PathVariable String action,@RequestBody PaymentService.Review review) {
        String decision=switch (action) { case "approve" -> "APPROVED"; case "decline" -> "DECLINED"; default -> "REVERSED"; };
        service.review(user.getName(),id,decision,review);
    }
    @GetMapping("/{scope:resident|owner}/payments/{id}/receipt")
    public ResponseEntity<Map<String,Object>> receipt(Principal user,@PathVariable String scope,@PathVariable UUID id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.receipt(user.getName(),scope.equals("owner"),id));
    }
    @PostMapping(value="/resident/payments/{id}/proof",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void proof(Principal user,@PathVariable UUID id,@RequestParam("proof") MultipartFile upload) {
        service.checkUpload(user.getName(),id);
        service.attach(user.getName(),id,PrivateImage.read(upload,"PAYMENT_PROOF"));
    }
    @GetMapping("/{scope:resident|owner}/payments/{id}/proof")
    public ResponseEntity<byte[]> proof(Principal user,@PathVariable String scope,@PathVariable UUID id) {
        var image=service.proof(user.getName(),scope.equals("owner"),id);
        return PrivateImage.response(image.type(),image.data());
    }
    @GetMapping("/owner/payment-collections")
    public Object collections(Principal user) { return service.collections(user.getName()); }
}
