CREATE TABLE resident_access_events (
    id UUID PRIMARY KEY,
    event_order BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    request_id UUID NOT NULL,
    tenancy_id UUID NOT NULL REFERENCES tenancies(id),
    property_id UUID NOT NULL REFERENCES properties(id),
    room_label VARCHAR(80) NOT NULL,
    direction VARCHAR(5) NOT NULL CHECK(direction IN ('ENTRY','EXIT')),
    entry_point VARCHAR(80) NOT NULL,
    identity_confirmed BOOLEAN NOT NULL CHECK(identity_confirmed=TRUE),
    recorded_by UUID NOT NULL REFERENCES accounts(id),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(tenancy_id,request_id)
);
CREATE INDEX resident_access_property_time ON resident_access_events(property_id,occurred_at,event_order);
CREATE INDEX resident_access_tenancy_order ON resident_access_events(tenancy_id,event_order);

CREATE TABLE resident_access_corrections (
    event_id UUID NOT NULL REFERENCES resident_access_events(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK(revision>0),
    direction VARCHAR(5) NOT NULL CHECK(direction IN ('ENTRY','EXIT')),
    entry_point VARCHAR(80) NOT NULL,
    voided BOOLEAN NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    corrected_by UUID NOT NULL REFERENCES accounts(id),
    corrected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY(event_id,revision)
);
