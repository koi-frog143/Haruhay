ALTER TABLE visitor_requests ALTER COLUMN arrival DROP NOT NULL;
ALTER TABLE visitor_requests ALTER COLUMN departure DROP NOT NULL;

ALTER TABLE visitor_requests ADD COLUMN window_policy VARCHAR(12) NOT NULL DEFAULT 'LEGACY'
    CHECK (window_policy IN ('LEGACY', 'FLEXIBLE'));
ALTER TABLE visitor_requests ADD COLUMN planned_date DATE;
ALTER TABLE visitor_requests ADD CONSTRAINT visitor_window_consistency CHECK (
    (arrival IS NOT NULL AND departure IS NOT NULL)
    OR (arrival IS NULL AND departure IS NULL AND window_policy = 'FLEXIBLE' AND status <> 'APPROVED')
);

ALTER TABLE visitor_qr_credentials ADD COLUMN share_hash VARCHAR(64) UNIQUE;
