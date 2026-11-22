package com.haruhay.backend.registration;
import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
@Configuration
public class RegistrationConfig {
    @Bean Clock registrationClock() { return Clock.systemUTC(); }
}
