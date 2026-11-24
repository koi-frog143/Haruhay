package com.haruhay.backend.maintenance;

import com.haruhay.backend.storage.PrivateImage;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/maintenance")
public class MaintenanceController {
    private final MaintenanceService service;

    public MaintenanceController(MaintenanceService service) { this.service=service; }

    @GetMapping("/categories") public Object categories(Principal user) { return service.categories(user.getName()); }
    @GetMapping("/locations") public Object locations(Principal user) { return service.locations(user.getName()); }
    @GetMapping("/tickets") public Object list(Principal user) { return service.list(user.getName()); }
    @PostMapping("/tickets")
    public Object report(Principal user,@RequestBody MaintenanceService.Report request) {
        return Map.of("id",service.report(user.getName(),request));
    }
    @GetMapping("/tickets/{id}")
    public Object detail(Principal user,@PathVariable UUID id) { return service.detail(user.getName(),id); }
    @PostMapping("/tickets/{id}/actions") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void change(Principal user,@PathVariable UUID id,@RequestBody MaintenanceService.Change request) {
        service.change(user.getName(),id,request);
    }
    @PostMapping("/tickets/{id}/comments") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void comment(Principal user,@PathVariable UUID id,@RequestBody MaintenanceService.Note request) {
        service.comment(user.getName(),id,request);
    }
    @GetMapping("/properties/{id}/technicians")
    public Object staff(Principal user,@PathVariable UUID id) { return service.staff(user.getName(),id); }
    @PostMapping("/properties/{id}/technicians") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void staff(Principal user,@PathVariable UUID id,@RequestBody MaintenanceService.Staff request) {
        service.createStaff(user.getName(),id,request);
    }
    @PostMapping("/properties/{id}/technicians/{staff}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void staffStatus(Principal user,@PathVariable UUID id,@PathVariable UUID staff,@RequestBody MaintenanceService.StaffStatus request) {
        service.staffStatus(user.getName(),id,staff,request);
    }
    @GetMapping("/notifications") public Object notifications(Principal user) { return service.notifications(user.getName()); }
    @PostMapping("/notifications/read") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(Principal user,@RequestBody ReadNotice request) { service.readNotifications(user.getName(),request.id()); }
    public record ReadNotice(UUID id) {}

    @PostMapping(value="/tickets/{id}/photos",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object addPhoto(Principal user,@PathVariable UUID id,@RequestParam("photo") MultipartFile upload) {
        service.checkUpload(user.getName(),id);
        var image=PrivateImage.read(upload,"MAINTENANCE_PHOTO");
        return Map.of("id",service.addPhoto(user.getName(),id,new MaintenanceService.Photo(image.type(),image.data())));
    }
    @GetMapping("/tickets/{id}/photos/{photoId}")
    public ResponseEntity<byte[]> photo(Principal user,@PathVariable UUID id,@PathVariable UUID photoId) {
        var photo=service.photo(user.getName(),id,photoId);
        return PrivateImage.response(photo.type(),photo.data());
    }
}
