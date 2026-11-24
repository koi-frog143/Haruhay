package com.haruhay.backend.storage;

import com.haruhay.backend.registration.FlowException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MultipartFile;

public final class PrivateImage {
    private static final int MAX_BYTES=5*1024*1024;
    private static final long MAX_PIXELS=16_000_000;

    private PrivateImage() {}

    public record Image(String type,byte[] data) {
        @Override public String toString() { return "PrivateImage[type="+type+"]"; }
    }

    public static Image read(MultipartFile upload,String errorCode) {
        if (upload.isEmpty() || upload.getSize()>MAX_BYTES)
            throw new FlowException(400,errorCode,"Choose a JPEG or PNG photo up to 5 MB.");
        try {
            byte[] bytes=upload.getBytes();
            try (var input=new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw invalid(errorCode);
                var reader=readers.next();
                try {
                    String format=reader.getFormatName().toLowerCase(Locale.ROOT);
                    if (!format.equals("jpeg") && !format.equals("png")) throw invalid(errorCode);
                    reader.setInput(input,true,true);
                    if ((long)reader.getWidth(0)*reader.getHeight(0)>MAX_PIXELS)
                        throw new FlowException(400,errorCode,"Choose a photo of 16 megapixels or less.");
                    var decoded=reader.read(0);
                    if (decoded==null) throw invalid(errorCode);
                    decoded.flush();
                    return new Image(format.equals("jpeg")?"image/jpeg":"image/png",bytes);
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException | IllegalArgumentException ex) {
            throw invalid(errorCode);
        }
    }
    public static ResponseEntity<byte[]> response(String type,byte[] bytes) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .header("X-Content-Type-Options","nosniff")
            .contentType(MediaType.parseMediaType(type))
            .body(bytes);
    }
    private static FlowException invalid(String errorCode) {
        return new FlowException(400,errorCode,"Choose a valid JPEG or PNG photo.");
    }
}
