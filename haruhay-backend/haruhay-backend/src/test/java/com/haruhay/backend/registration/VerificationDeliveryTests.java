package com.haruhay.backend.registration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

class VerificationDeliveryTests {
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
