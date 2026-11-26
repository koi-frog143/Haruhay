ALTER TABLE tenancies ADD COLUMN ended_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tenancies ADD COLUMN ended_by UUID REFERENCES accounts(id);
ALTER TABLE tenancies ADD COLUMN end_reason VARCHAR(1000);
ALTER TABLE tenancies ADD COLUMN end_kind VARCHAR(16) CHECK(end_kind IN ('MOVE_OUT','TRANSFER'));
ALTER TABLE tenancies ADD COLUMN offer_id UUID REFERENCES application_offers(id) ON DELETE SET NULL;
CREATE INDEX tenancies_application_status ON tenancies(application_id,status);
CREATE INDEX tenancies_account_status ON tenancies(account_id,status);
CREATE UNIQUE INDEX monthly_bills_application_period ON monthly_bills(application_id,period);

CREATE TABLE room_transfers (
    id UUID PRIMARY KEY,
    source_tenancy_id UUID NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
    destination_tenancy_id UUID UNIQUE REFERENCES tenancies(id) ON DELETE SET NULL,
    offer_id UUID NOT NULL UNIQUE REFERENCES application_offers(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL CHECK(status IN ('PROPOSED','ACCEPTED','COMPLETED','CANCELLED')),
    completed_by UUID REFERENCES accounts(id),
    completed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX room_transfers_source_status ON room_transfers(source_tenancy_id,status);

CREATE TABLE account_email_changes (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    new_email VARCHAR(254) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
