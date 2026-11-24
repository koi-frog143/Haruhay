package com.haruhay.backend.registration;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
@RestControllerAdvice
public class FlowErrors {
    @ExceptionHandler(FlowException.class) ResponseEntity<?> flow(FlowException e) {
        return ResponseEntity.status(e.status).body(Map.of("code",e.code,"message",e.getMessage()));
    }
    @ExceptionHandler(MethodArgumentNotValidException.class) ResponseEntity<?> validation(MethodArgumentNotValidException e) {
        return ResponseEntity.badRequest().body(Map.of("message", "Check the form fields.", "fields",e.getBindingResult().getFieldErrors().stream()
            .map(f -> Map.of("field", f.getField(), "message", String.valueOf(f.getDefaultMessage()))).toList()));
    }
    @ExceptionHandler(HttpMessageNotReadableException.class) ResponseEntity<?> malformed() {
        return ResponseEntity.badRequest().body(Map.of("message","Invalid request. Check identifiers and required fields."));
    }
    @ExceptionHandler(MaxUploadSizeExceededException.class) ResponseEntity<?> uploadSize() {
        return ResponseEntity.status(413).body(Map.of("message","Choose a photo up to 5 MB."));
    }
    @ExceptionHandler(DataIntegrityViolationException.class) ResponseEntity<?> conflict() {
        return ResponseEntity.status(409).body(Map.of("message","This record already exists or changed. Refresh and try again."));
    }
}
