-- 0005_events_event_id_auto.sql
-- Ensure events.event_id is always filled

-- 1) Default at the column level (works when column omitted in INSERT)
ALTER TABLE events
  ALTER COLUMN event_id SET DEFAULT gen_random_uuid();

-- 2) Safety net when INSERT explicitly passes NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_events_event_id'
  ) THEN
    CREATE OR REPLACE FUNCTION set_events_event_id()
    RETURNS trigger AS $fn$
    BEGIN
      IF NEW.event_id IS NULL THEN
        NEW.event_id := gen_random_uuid();
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_events_event_id ON events;

CREATE TRIGGER trg_events_event_id
BEFORE INSERT ON events
FOR EACH ROW
EXECUTE FUNCTION set_events_event_id();
