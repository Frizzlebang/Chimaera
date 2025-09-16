BEGIN;

-- 1) Add column with default TRUE, idempotent
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT TRUE;

-- 2) Backfill any NULLs to TRUE (safe if the column just got added)
UPDATE memberships
SET is_active = TRUE
WHERE is_active IS NULL;

-- 3) Make it NOT NULL
ALTER TABLE memberships
  ALTER COLUMN is_active SET NOT NULL;

-- 4) Useful partial index for the common membership check
CREATE INDEX IF NOT EXISTS membership_active_idx
  ON memberships (campaign_id, user_id)
  WHERE is_active = TRUE;

COMMIT;