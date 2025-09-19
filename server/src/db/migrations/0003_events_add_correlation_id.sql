-- Adds correlation_id for tracing + index (idempotent)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE INDEX IF NOT EXISTS ix_events_correlation
  ON events(correlation_id);
