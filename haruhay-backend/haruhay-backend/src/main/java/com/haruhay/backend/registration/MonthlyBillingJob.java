package com.haruhay.backend.registration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MonthlyBillingJob {
    private static final Logger LOG=LoggerFactory.getLogger(MonthlyBillingJob.class);
    private final MonthlyBillingService billing;

    public MonthlyBillingJob(MonthlyBillingService billing) { this.billing=billing; }

    @Scheduled(cron="${haruhay.billing-posting-cron:0 * * * * *}",zone=MonthlyBillingService.MANILA_ZONE)
    public void postDue() {
        for (var property:billing.dueProperties()) {
            try { billing.postDue(property); }
            catch (RuntimeException failure) {
                LOG.warn("Automatic bill posting will retry for property {} ({})",property,failure.getClass().getSimpleName());
            }
        }
    }
}
