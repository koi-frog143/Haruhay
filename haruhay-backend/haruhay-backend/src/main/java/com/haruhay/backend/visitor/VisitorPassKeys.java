package com.haruhay.backend.visitor;

import com.haruhay.backend.registration.FlowException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class VisitorPassKeys {
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private final byte[] key;

    VisitorPassKeys(@Value("${haruhay.visitor-pass-key:}") String configured,
                    @Value("${haruhay.visitor-pass-key-file:}") String localFile) throws IOException {
        String encoded = configured;
        if (encoded.isBlank() && !localFile.isBlank()) {
            Path path = Path.of(localFile).toAbsolutePath();
            Files.createDirectories(path.getParent());
            if (!Files.exists(path)) {
                byte[] generated = new byte[32];
                new SecureRandom().nextBytes(generated);
                try {
                    Files.writeString(path, ENCODER.encodeToString(generated), StandardOpenOption.CREATE_NEW);
                } catch (FileAlreadyExistsException ignored) {
                    // Another local instance created the key first.
                }
            }
            encoded = Files.readString(path).trim();
        }
        if (encoded.isBlank() && localFile.isBlank()) {
            key = null;
            return;
        }
        byte[] decoded;
        try {
            decoded = Base64.getUrlDecoder().decode(encoded.replace('+', '-').replace('/', '_'));
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Configure a base64-encoded visitor pass key.");
        }
        if (decoded.length != 32) throw new IllegalArgumentException("Configure a 32-byte visitor pass key.");
        key = decoded;
    }

    String scan(UUID credential) { return "haruhay:visit:" + derive(credential, "scan"); }
    String share(UUID credential) { return derive(credential, "share"); }

    private String derive(UUID credential, String purpose) {
        if (key == null) throw new FlowException(503, "VISITOR_FLOW", "Visitor pass sharing is not configured.");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            String input = "haruhay:visitor:v1:" + purpose + ":" + credential;
            return ENCODER.encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("Could not derive visitor pass.", ex);
        }
    }
}
