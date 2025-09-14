BEGIN;

-- Add created_by and wire it to app_user (nullable, safe for existing rows)
ALTER TABLE campaign
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(id) ON DELETE SET NULL;

-- Optional: backfill from an existing owner membership if present
UPDATE campaign c
SET created_by = m.user_id
FROM membership m
WHERE m.campaign_id = c.id
  AND m.role = 'owner'
  AND c.created_by IS NULL;

-- Optional helpful index
CREATE INDEX IF NOT EXISTS idx_campaign_created_by ON campaign(created_by);

COMMIT;
