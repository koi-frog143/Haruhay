ALTER TABLE rooms ADD COLUMN description VARCHAR(4000) NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN room_type VARCHAR(16) NOT NULL DEFAULT 'SHARED';
UPDATE rooms SET room_type='PRIVATE' WHERE capacity=1;
ALTER TABLE rooms ADD COLUMN terms_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN accepting_applications BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'PHP';
ALTER TABLE rooms ADD COLUMN monthly_rent DECIMAL(12,2);
ALTER TABLE rooms ADD COLUMN pricing_basis VARCHAR(16) NOT NULL DEFAULT 'PER_PERSON';
ALTER TABLE rooms ADD COLUMN applicant_monthly_quote DECIMAL(12,2);
ALTER TABLE rooms ADD COLUMN security_deposit DECIMAL(12,2);
ALTER TABLE rooms ADD COLUMN advance_months INTEGER;
ALTER TABLE rooms ADD COLUMN inclusions VARCHAR(4000) NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN house_rules VARCHAR(4000) NOT NULL DEFAULT '';
ALTER TABLE rooms ADD CONSTRAINT room_kind CHECK(room_type IN ('PRIVATE','SHARED'));
ALTER TABLE rooms ADD CONSTRAINT room_private_capacity CHECK(room_type<>'PRIVATE' OR capacity=1);
ALTER TABLE rooms ADD CONSTRAINT room_pricing_basis CHECK(pricing_basis IN ('PER_PERSON','PER_ROOM'));
ALTER TABLE rooms ADD CONSTRAINT room_amounts CHECK((monthly_rent IS NULL OR monthly_rent>=0) AND (applicant_monthly_quote IS NULL OR applicant_monthly_quote>=0) AND (security_deposit IS NULL OR security_deposit>=0) AND (advance_months IS NULL OR advance_months BETWEEN 0 AND 24));
CREATE TABLE room_charges (
 id UUID PRIMARY KEY, room_id UUID NOT NULL REFERENCES rooms(id), name VARCHAR(120) NOT NULL,
 basis VARCHAR(24) NOT NULL CHECK(basis IN ('INCLUDED','FIXED_MONTHLY','FIXED_MOVE_IN','USAGE_BASED','TO_CONFIRM')),
 amount DECIMAL(12,2), notes VARCHAR(500) NOT NULL DEFAULT '', position INTEGER NOT NULL,
 CHECK((basis IN ('FIXED_MONTHLY','FIXED_MOVE_IN') AND amount IS NOT NULL AND amount>=0) OR (basis NOT IN ('FIXED_MONTHLY','FIXED_MOVE_IN') AND amount IS NULL))
);
ALTER TABLE registration_applications ADD COLUMN preferred_room_id UUID REFERENCES rooms(id);
CREATE TABLE application_offers (
 id UUID PRIMARY KEY, application_id UUID NOT NULL REFERENCES registration_applications(id),
 version INTEGER NOT NULL, room_id UUID NOT NULL REFERENCES rooms(id), room_version BIGINT NOT NULL,
 snapshot TEXT NOT NULL, created_by UUID NOT NULL REFERENCES accounts(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 reason VARCHAR(1000) NOT NULL, accepted_by UUID REFERENCES accounts(id), accepted_at TIMESTAMP WITH TIME ZONE,
 UNIQUE(application_id,version)
);
CREATE INDEX offers_application_version ON application_offers(application_id,version);
