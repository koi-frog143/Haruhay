package com.haruhay.backend.registration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;
@Component
public class VerificationDelivery {
    private final String mode, frontend, from, folder;
    private final ObjectProvider<JavaMailSender> mail;
    private final Environment environment;
    public VerificationDelivery(@Value("${haruhay.delivery:smtp}") String mode,
            @Value("${haruhay.frontend-url}") String frontend, @Value("${haruhay.mail-from}") String from,
            @Value("${haruhay.local-mail-dir:.local/mail}") String folder,
            ObjectProvider<JavaMailSender> mail, Environment environment) {
        this.mode=mode; this.frontend=frontend; this.from=from; this.folder=folder; this.mail=mail; this.environment=environment;
    }
    public String deliver(UUID account, String email, String token) {
        String text="Verify your Haruhay email: " + frontend + "/#/account/verify?token=" + token;
        return send(account,email,"Verify your Haruhay account",text,".txt");
    }
    public String deliverApproval(UUID account,String email,String property,String room) {
        String text="Your Haruhay application has been approved.\nProperty: "+property+"\nRoom: "+room+
            "\nYour tenancy is now active. No additional verification or activation code is needed.\nView your account: "+frontend+"/#/account/status";
        return send(account,email,"Welcome to Haruhay - application approved",text,".approval.txt");
    }
    public String deliverUpdate(UUID account,String email,String subject,String text) { return send(account,email,subject,text,".update.txt"); }
    private String send(UUID account,String email,String subject,String text,String suffix) {
        try {
            if (mode.equals("local-file") && environment.matchesProfiles("dev", "test")) {
                Path dir=Path.of(folder); Files.createDirectories(dir);
                Files.writeString(dir.resolve(account+suffix), "LOCAL DEVELOPMENT ONLY — no email sent.\nTo: "+email+"\n"+text+"\n",
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
                return "LOCAL_FILE";
            }
            JavaMailSender sender=mail.getIfAvailable();
            if (!mode.equals("smtp") || sender==null) throw new IllegalStateException("Email delivery not configured");
            SimpleMailMessage message=new SimpleMailMessage(); message.setFrom(from); message.setTo(email);
            message.setSubject(subject); message.setText(text); sender.send(message);
            return "SMTP_ACCEPTED";
        } catch (Exception e) {
            // Provider errors may contain the link; never log them. Failure rolls back registration.
            throw new FlowException(503,"DELIVERY_UNAVAILABLE","Email delivery is unavailable. No account or approval changes were saved. Check the mail configuration or try again.");
        }
    }
}
