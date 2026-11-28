ALTER TABLE properties ADD COLUMN auto_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE properties ADD COLUMN auto_billing_posting_day INTEGER NOT NULL DEFAULT 1 CHECK(auto_billing_posting_day BETWEEN 1 AND 28);
ALTER TABLE properties ADD COLUMN auto_billing_first_period VARCHAR(7);
ALTER TABLE properties ADD CONSTRAINT auto_billing_start_required CHECK(NOT auto_billing_enabled OR auto_billing_first_period IS NOT NULL);

CREATE TABLE monthly_billing_runs (
    id UUID PRIMARY KEY,
    property_id UUID NOT NULL REFERENCES properties(id),
    period VARCHAR(7) NOT NULL,
    scheduled_for DATE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    posted_count INTEGER NOT NULL CHECK(posted_count>=0),
    existing_count INTEGER NOT NULL CHECK(existing_count>=0),
    UNIQUE(property_id,period)
);

CREATE TABLE monthly_billing_run_issues (
    run_id UUID NOT NULL REFERENCES monthly_billing_runs(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES registration_applications(id) ON DELETE CASCADE,
    room_label VARCHAR(80) NOT NULL,
    reason VARCHAR(240) NOT NULL,
    PRIMARY KEY(run_id,application_id)
);
