package com.haruhay.backend.registration;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/public/password-reset")
public class PasswordRecoveryController {
    private static final Logger LOG=LoggerFactory.getLogger(PasswordRecoveryController.class);
    public record Request(@NotBlank @Email @Size(max=254) String email) {
        @Override public String toString() { return "PasswordResetRequest[REDACTED]"; }
    }
    public record Complete(String token,String password,String confirmation) {
        @Override public String toString() { return "PasswordResetComplete[REDACTED]"; }
    }
    public record Accepted(boolean localDelivery) {}

    private final PasswordRecoveryService recovery;
    private final VerificationDelivery delivery;
    private final TaskExecutor executor;
    private final AttemptLimiter addresses;
    private final SecurityContextLogoutHandler logout=new SecurityContextLogoutHandler();

    public PasswordRecoveryController(PasswordRecoveryService recovery,VerificationDelivery delivery,
            @Qualifier("passwordRecoveryExecutor") TaskExecutor executor,Clock clock,
            @Value("${haruhay.password-reset-email-limit:5}") int emailLimit) {
        this.recovery=recovery;
        this.delivery=delivery;
        this.executor=executor;
        this.addresses=new AttemptLimiter(emailLimit,clock);
    }

    @PostMapping("/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Accepted request(@Valid @RequestBody Request body) {
        String email=body.email().strip().toLowerCase(Locale.ROOT);
        if (addresses.allow(RegistrationService.hash(email))) {
            try {
                // Keep account lookup and mail delivery off the response path.
                executor.execute(()->issue(email));
            } catch (TaskRejectedException busy) {
                LOG.warn("Password reset delivery queue is busy.");
            }
        }
        return new Accepted(delivery.isLocalDelivery());
    }

    @PostMapping("/complete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void complete(@RequestBody Complete body,HttpServletRequest request,HttpServletResponse response) {
        recovery.complete(body.token(),body.password(),body.confirmation());
        logout.logout(request,response,SecurityContextHolder.getContext().getAuthentication());
    }

    private void issue(String email) {
        try { recovery.issue(email); }
        catch (RuntimeException failure) {
            LOG.warn("Password reset delivery did not complete ({}).",failure.getClass().getSimpleName());
        }
    }
}
