CREATE TABLE accounts (
 id UUID PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(100) NOT NULL, full_name VARCHAR(100) NOT NULL,
 contact VARCHAR(100) NOT NULL, role VARCHAR(20) NOT NULL CHECK(role IN ('OWNER','APPLICANT')),
 email_verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE TABLE properties (
 id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES accounts(id),
 name VARCHAR(160) NOT NULL, sample BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE rooms (
 id UUID PRIMARY KEY, property_id UUID NOT NULL REFERENCES properties(id),
 label VARCHAR(80) NOT NULL, capacity INTEGER NOT NULL CHECK(capacity > 0),
 UNIQUE(property_id,label)
);
CREATE TABLE reservations (
 id UUID PRIMARY KEY, room_id UUID NOT NULL REFERENCES rooms(id),
 status VARCHAR(20) NOT NULL CHECK(status IN ('HELD','CONVERTED','RELEASED')),
 created_by UUID NOT NULL REFERENCES accounts(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 updated_by UUID REFERENCES accounts(id), updated_at TIMESTAMP WITH TIME ZONE,
 reason VARCHAR(1000)
);
CREATE TABLE invitations (
 id UUID PRIMARY KEY, reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id),
 email VARCHAR(254) NOT NULL, token_hash VARCHAR(64) NOT NULL UNIQUE,
 token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
 status VARCHAR(20) NOT NULL CHECK(status IN ('OPEN','REVOKED','CLAIMED','CANCELLED')),
 created_by UUID NOT NULL REFERENCES accounts(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 updated_by UUID REFERENCES accounts(id), updated_at TIMESTAMP WITH TIME ZONE,
 reason VARCHAR(1000)
);
CREATE TABLE registration_applications (
 id UUID PRIMARY KEY, invitation_id UUID NOT NULL UNIQUE REFERENCES invitations(id),
 account_id UUID NOT NULL REFERENCES accounts(id), full_name VARCHAR(100) NOT NULL,
 contact VARCHAR(100) NOT NULL,
 status VARCHAR(30) NOT NULL CHECK(status IN ('AWAITING_EMAIL','PENDING_APPROVAL','CORRECTIONS_REQUESTED','REJECTED','APPROVED','CANCELLED')),
 submitted_at TIMESTAMP WITH TIME ZONE NOT NULL, reviewed_by UUID REFERENCES accounts(id),
 reviewed_at TIMESTAMP WITH TIME ZONE, review_reason VARCHAR(1000)
);
CREATE TABLE tenancies (
 id UUID PRIMARY KEY, reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id),
 application_id UUID NOT NULL UNIQUE REFERENCES registration_applications(id),
 account_id UUID NOT NULL REFERENCES accounts(id), room_id UUID NOT NULL REFERENCES rooms(id),
 status VARCHAR(20) NOT NULL CHECK(status IN ('ACTIVE','ENDED')),
 started_at TIMESTAMP WITH TIME ZONE NOT NULL, approved_by UUID NOT NULL REFERENCES accounts(id)
);
CREATE TABLE email_verifications (
 id UUID PRIMARY KEY, account_id UUID NOT NULL UNIQUE REFERENCES accounts(id),
 token_hash VARCHAR(64) NOT NULL UNIQUE, expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE TABLE registration_audit (
 id UUID PRIMARY KEY, entity_id UUID NOT NULL, event VARCHAR(80) NOT NULL,
 actor_id UUID REFERENCES accounts(id), occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
 reason VARCHAR(1000)
);
CREATE INDEX reservations_room_status ON reservations(room_id,status);
CREATE INDEX tenancies_room_status ON tenancies(room_id,status);
CREATE INDEX applications_account ON registration_applications(account_id);
