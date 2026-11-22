-- Preserve existing records. A new signup reserves nothing until owner approval.
ALTER TABLE registration_applications ALTER COLUMN invitation_id DROP NOT NULL;
ALTER TABLE registration_applications ADD COLUMN property_id UUID REFERENCES properties(id);
ALTER TABLE registration_applications ADD COLUMN activation_pending BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE registration_applications SET property_id=(
 SELECT r.property_id FROM invitations i JOIN reservations h ON h.id=i.reservation_id
 JOIN rooms r ON r.id=h.room_id WHERE i.id=registration_applications.invitation_id
);
CREATE INDEX application_property ON registration_applications(property_id);
CREATE TABLE tenancy_activation_codes (
 application_id UUID PRIMARY KEY REFERENCES registration_applications(id),
 token_hash VARCHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
 failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
 sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
 consumed_at TIMESTAMP WITH TIME ZONE
);
