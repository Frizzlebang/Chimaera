-- UUIDs for events/snapshots if you use gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helpful indexes for Path A
CREATE INDEX IF NOT EXISTS idx_membership_campaign_user ON membership(campaign_id, user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_stream_version ON snapshots(stream_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_events_stream_created    ON events(stream_id, created_at);
