CREATE TABLE property_announcements (
    id UUID PRIMARY KEY,
    property_id UUID NOT NULL REFERENCES properties(id),
    author_id UUID NOT NULL REFERENCES accounts(id),
    title VARCHAR(150) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('GENERAL','MAINTENANCE','COMMUNITY')),
    summary VARCHAR(1000) NOT NULL,
    message VARCHAR(2000) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE,
    version BIGINT NOT NULL DEFAULT 1,
    CHECK ((status='DRAFT' AND published_at IS NULL AND archived_at IS NULL)
        OR (status='PUBLISHED' AND published_at IS NOT NULL AND archived_at IS NULL)
        OR (status='ARCHIVED' AND archived_at IS NOT NULL))
);

CREATE INDEX property_announcements_visibility ON property_announcements(property_id,status,published_at);
