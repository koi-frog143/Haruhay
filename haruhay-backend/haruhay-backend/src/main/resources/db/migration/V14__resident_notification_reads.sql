CREATE TABLE resident_notification_reads (
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    notification_id VARCHAR(64) NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (account_id,notification_id)
);
