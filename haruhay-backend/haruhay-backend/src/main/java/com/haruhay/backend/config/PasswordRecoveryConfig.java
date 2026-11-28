package com.haruhay.backend.config;

import com.haruhay.backend.registration.AttemptLimiter;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
class PasswordRecoveryConfig {
    @Bean(defaultCandidate=false)
    AttemptLimiter passwordRecoveryIpLimiter(@Value("${haruhay.password-reset-ip-limit:20}") int limit,Clock clock) {
        return new AttemptLimiter(limit,clock);
    }

    @Bean(defaultCandidate=false)
    ThreadPoolTaskExecutor passwordRecoveryExecutor() {
        var executor=new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(32);
        executor.setThreadNamePrefix("password-recovery-");
        return executor;
    }
}
