CREATE TABLE property_guard_assignments (
 account_id UUID NOT NULL REFERENCES accounts(id), property_id UUID NOT NULL REFERENCES properties(id),
 can_review BOOLEAN NOT NULL DEFAULT FALSE, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_by UUID NOT NULL REFERENCES accounts(id), created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 PRIMARY KEY(account_id,property_id)
);
CREATE TABLE visitor_profiles (
 id UUID PRIMARY KEY, full_name VARCHAR(100) NOT NULL, contact VARCHAR(100) NOT NULL
);
CREATE TABLE visitor_requests (
 id UUID PRIMARY KEY, visitor_id UUID NOT NULL REFERENCES visitor_profiles(id),
 tenancy_id UUID NOT NULL REFERENCES tenancies(id), property_id UUID NOT NULL REFERENCES properties(id),
 purpose VARCHAR(500) NOT NULL, arrival TIMESTAMP WITH TIME ZONE NOT NULL, departure TIMESTAMP WITH TIME ZONE NOT NULL,
 status VARCHAR(20) NOT NULL CHECK(status IN ('PENDING','APPROVED','DECLINED','CANCELLED')),
 created_at TIMESTAMP WITH TIME ZONE NOT NULL, reviewed_by UUID REFERENCES accounts(id), reviewed_at TIMESTAMP WITH TIME ZONE,
 reason VARCHAR(1000), CHECK(departure>arrival)
);
CREATE TABLE visitor_visits (
 id UUID PRIMARY KEY, request_id UUID NOT NULL UNIQUE REFERENCES visitor_requests(id),
 status VARCHAR(20) NOT NULL CHECK(status IN ('EXPECTED','CHECKED_IN','CHECKED_OUT','CANCELLED')),
 checked_in TIMESTAMP WITH TIME ZONE, checked_out TIMESTAMP WITH TIME ZONE, voided BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE visitor_qr_credentials (
 id UUID PRIMARY KEY, visit_id UUID NOT NULL REFERENCES visitor_visits(id), token_hash VARCHAR(64) NOT NULL UNIQUE,
 status VARCHAR(20) NOT NULL CHECK(status IN ('ACTIVE','REPLACED','REVOKED','COMPLETE')),
 issued_at TIMESTAMP WITH TIME ZONE NOT NULL, expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE TABLE visitor_movements (
 id UUID PRIMARY KEY, visit_id UUID NOT NULL REFERENCES visitor_visits(id),
 movement VARCHAR(10) NOT NULL CHECK(movement IN ('ENTRY','EXIT')), actor_id UUID NOT NULL REFERENCES accounts(id),
 occurred_at TIMESTAMP WITH TIME ZONE NOT NULL, method VARCHAR(10) NOT NULL CHECK(method IN ('QR','MANUAL')),
 id_type VARCHAR(80), id_last_four VARCHAR(4), reason VARCHAR(1000), UNIQUE(visit_id,movement)
);
CREATE TABLE visitor_audit (
 id UUID PRIMARY KEY, property_id UUID NOT NULL REFERENCES properties(id), visit_id UUID REFERENCES visitor_visits(id),
 actor_id UUID NOT NULL REFERENCES accounts(id), event VARCHAR(40) NOT NULL, occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
 reason VARCHAR(1000)
);
CREATE INDEX visitor_requests_property ON visitor_requests(property_id,created_at);
CREATE INDEX visitor_requests_tenancy ON visitor_requests(tenancy_id);
CREATE INDEX visitor_credentials_visit ON visitor_qr_credentials(visit_id,status);
