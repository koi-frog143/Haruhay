ALTER TABLE properties ADD COLUMN contact_details VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN amenities VARCHAR(1000) NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN property_house_rules VARCHAR(2000) NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN billing_due_day INTEGER NOT NULL DEFAULT 1 CHECK(billing_due_day BETWEEN 1 AND 28);
ALTER TABLE properties ADD COLUMN billing_grace_days INTEGER NOT NULL DEFAULT 0 CHECK(billing_grace_days BETWEEN 0 AND 30);
ALTER TABLE properties ADD COLUMN notify_announcements BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE properties ADD COLUMN notify_maintenance BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE properties ADD COLUMN notify_payments BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE properties ADD COLUMN retention_days INTEGER CHECK(retention_days BETWEEN 1 AND 3650);

ALTER TABLE accounts ADD COLUMN notify_announcements BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE accounts ADD COLUMN notify_maintenance BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE accounts ADD COLUMN notify_payments BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE monthly_bills ADD COLUMN grace_days INTEGER NOT NULL DEFAULT 0 CHECK(grace_days BETWEEN 0 AND 30);
CREATE INDEX registration_audit_property_history ON registration_audit(entity_id,occurred_at);
