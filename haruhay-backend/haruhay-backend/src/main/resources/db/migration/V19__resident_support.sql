CREATE TABLE support_threads (
    id UUID PRIMARY KEY,
    property_id UUID NOT NULL REFERENCES properties(id),
    resident_id UUID NOT NULL REFERENCES accounts(id),
    request_id UUID NOT NULL,
    subject VARCHAR(100) NOT NULL,
    status VARCHAR(24) NOT NULL CHECK(status IN ('OPEN','WAITING_FOR_RESIDENT','RESOLVED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(resident_id,request_id)
);
CREATE INDEX support_threads_property_activity ON support_threads(property_id,updated_at,id);
CREATE INDEX support_threads_resident_activity ON support_threads(resident_id,updated_at,id);

CREATE TABLE support_events (
    event_order BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES accounts(id),
    author_role VARCHAR(8) NOT NULL CHECK(author_role IN ('OWNER','RESIDENT')),
    request_id UUID NOT NULL,
    message VARCHAR(1000),
    previous_status VARCHAR(24) CHECK(previous_status IN ('OPEN','WAITING_FOR_RESIDENT','RESOLVED')),
    new_status VARCHAR(24) CHECK(new_status IN ('OPEN','WAITING_FOR_RESIDENT','RESOLVED')),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(thread_id,author_id,request_id),
    CHECK(message IS NOT NULL OR new_status IS NOT NULL),
    CHECK((previous_status IS NULL AND new_status IS NULL) OR
        (previous_status IS NOT NULL AND new_status IS NOT NULL AND previous_status<>new_status))
);
CREATE INDEX support_events_thread_order ON support_events(thread_id,event_order);
