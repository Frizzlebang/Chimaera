ALTER TABLE events
  ADD COLUMN correlation_id uuid NULL;

CREATE INDEX IF NOT EXISTS ix_events_correlation
  ON events (correlation_id);

-- (optional) backfill nulls with random values for older rows
UPDATE events SET correlation_id = gen_random_uuid()
WHERE correlation_id IS NULL;
