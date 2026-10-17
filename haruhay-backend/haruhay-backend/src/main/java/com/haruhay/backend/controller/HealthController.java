
package com.haruhay.backend.controller;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/public")
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of(
            "status", "success",
            "message", "Haruhay backend is connected!"
        );
    }
}
