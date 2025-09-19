-- 0004_membership_add_is_active.sql
-- Track active/inactive memberships (default active)
ALTER TABLE membership
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Optional: helpful index for lookups by active memberships
CREATE INDEX IF NOT EXISTS ix_membership_active
  ON membership (campaign_id, user_id)
  WHERE is_active = TRUE;