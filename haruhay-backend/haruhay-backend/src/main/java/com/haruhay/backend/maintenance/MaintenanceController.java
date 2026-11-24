package com.haruhay.backend.maintenance;

import com.haruhay.backend.registration.FlowException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.Principal;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/maintenance")
public class MaintenanceController {
    private static final int MAX_BYTES=5*1024*1024;
    private static final long MAX_PIXELS=16_000_000;
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
        return Map.of("id",service.addPhoto(user.getName(),id,validatedPhoto(upload)));
    }
    @GetMapping("/tickets/{id}/photos/{photoId}")
    public ResponseEntity<byte[]> photo(Principal user,@PathVariable UUID id,@PathVariable UUID photoId) {
        var photo=service.photo(user.getName(),id,photoId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .header("X-Content-Type-Options","nosniff")
            .contentType(MediaType.parseMediaType(photo.type()))
            .body(photo.data());
    }

    private MaintenanceService.Photo validatedPhoto(MultipartFile upload) {
        if (upload.isEmpty() || upload.getSize()>MAX_BYTES)
            throw new FlowException(400,"MAINTENANCE_PHOTO","Choose a JPEG or PNG photo up to 5 MB.");
        try {
            byte[] bytes=upload.getBytes();
            try (var image=new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(image);
                if (!readers.hasNext()) throw invalidPhoto();
                var reader=readers.next();
                try {
                    String format=reader.getFormatName().toLowerCase(Locale.ROOT);
                    if (!format.equals("jpeg") && !format.equals("png")) throw invalidPhoto();
                    reader.setInput(image,true,true);
                    if ((long)reader.getWidth(0)*reader.getHeight(0)>MAX_PIXELS)
                        throw new FlowException(400,"MAINTENANCE_PHOTO","Choose a photo of 16 megapixels or less.");
                    var decoded=reader.read(0);
                    if (decoded==null) throw invalidPhoto();
                    decoded.flush();
                    return new MaintenanceService.Photo(format.equals("jpeg")?"image/jpeg":"image/png",bytes);
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException | IllegalArgumentException ex) {
            throw invalidPhoto();
        }
    }
    private FlowException invalidPhoto() {
        return new FlowException(400,"MAINTENANCE_PHOTO","Choose a valid JPEG or PNG photo.");
    }
}
