package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

class VerificationDeliveryTests {
    @Test void passwordResetUsesConfiguredSmtpAndDevelopmentFileDelivery(@TempDir Path folder) throws Exception {
        var sender=mock(JavaMailSender.class);
        var beans=new DefaultListableBeanFactory(); beans.registerSingleton("mail",sender);
        var env=new MockEnvironment(); env.setActiveProfiles("dev");
        UUID account=UUID.randomUUID();
        String address="reset-test@example.test", from="owner@example.test";
        String frontend="https://frontend.example.test/";
        var smtp=new VerificationDelivery("smtp",frontend,from,folder.toString(),beans.getBeanProvider(JavaMailSender.class),env);
        assertThat(smtp.deliverPasswordReset(account,address,"sample-smtp-token")).isEqualTo("SMTP_ACCEPTED");
        var message=ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(sender).send(message.capture());
        assertThat(message.getValue().getTo()).containsExactly(address);
        assertThat(message.getValue().getFrom()).isEqualTo(from);
        assertThat(message.getValue().getText()).contains("https://frontend.example.test/#/reset-password?token=sample-smtp-token");
        var local=new VerificationDelivery("local-file",frontend,from,folder.toString(),beans.getBeanProvider(JavaMailSender.class),env);
        assertThat(local.isLocalDelivery()).isTrue();
        assertThat(local.deliverPasswordReset(account,address,"sample-local-token")).isEqualTo("LOCAL_FILE");
        assertThat(Files.readString(folder.resolve(account+".password-reset.txt"))).contains(
            "LOCAL DEVELOPMENT ONLY","https://frontend.example.test/#/reset-password?token=sample-local-token",address);
        verifyNoMoreInteractions(sender);
    }
    @Test void smtpSendsVerificationAndActivationToTheApplicantFromConfiguredOwner() {
        var sender=mock(JavaMailSender.class);
        var beans=new DefaultListableBeanFactory(); beans.registerSingleton("mail",sender);
        var delivery=new VerificationDelivery("smtp","http://localhost:5173","earldomingo165@gmail.com",
            "unused-local-folder",beans.getBeanProvider(JavaMailSender.class),new MockEnvironment());
        UUID account=UUID.randomUUID(), application=UUID.randomUUID();
        assertThat(delivery.deliver(account,"another-resident@example.test","test-verification-token")).isEqualTo("SMTP_ACCEPTED");
        assertThat(delivery.deliverApproval(account,"another-resident@example.test","Property","Room")).isEqualTo("SMTP_ACCEPTED");
        var messages=ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(sender,times(2)).send(messages.capture());
        for(var message:messages.getAllValues()) {
            assertThat(message.getFrom()).isEqualTo("earldomingo165@gmail.com");
            assertThat(message.getTo()).containsExactly("another-resident@example.test");
        }
        assertThat(messages.getAllValues().get(0).getText()).contains("/#/account/verify?token=test-verification-token");
        assertThat(messages.getAllValues().get(1).getText()).contains("No additional verification").doesNotContain("ABCD-EFGH", "single-use activation code");
    }
    @Test void smtpFailureNeverFallsBackToFakeLocalDelivery() {
        var sender=mock(JavaMailSender.class);
        doThrow(new org.springframework.mail.MailAuthenticationException("Provider details must stay private")).when(sender).send(any(SimpleMailMessage.class));
        var beans=new DefaultListableBeanFactory(); beans.registerSingleton("mail",sender);
        var delivery=new VerificationDelivery("smtp","http://localhost:5173","earldomingo165@gmail.com",
            "unused-local-folder",beans.getBeanProvider(JavaMailSender.class),new MockEnvironment());
        assertThatThrownBy(() -> delivery.deliver(UUID.randomUUID(),"resident@example.test","private-token"))
            .isInstanceOfSatisfying(FlowException.class,e -> { assertThat(e.code).isEqualTo("DELIVERY_UNAVAILABLE"); assertThat(e.getMessage()).doesNotContain("private-token","Provider details"); });
    }
}
