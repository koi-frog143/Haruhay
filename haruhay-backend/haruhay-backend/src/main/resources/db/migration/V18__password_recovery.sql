ALTER TABLE accounts ADD COLUMN credential_version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE account_password_resets (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
