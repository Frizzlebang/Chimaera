-- Canonical v0.3 baseline (DDL only, idempotent)

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Enum type (guarded; CREATE TYPE has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_role') THEN
    CREATE TYPE campaign_role AS ENUM ('owner','dm','player','viewer');
  END IF;
END$$;

-- 2) Core tables
CREATE TABLE IF NOT EXISTS app_user (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name  text NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,
  title      text NOT NULL,
  created_by uuid  -- <- This was missing!
);

-- Add FK only if missing (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_created_by_fkey'
      AND conrelid = 'campaign'::regclass
  ) THEN
    ALTER TABLE campaign
      ADD CONSTRAINT campaign_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS membership (
  user_id     uuid NOT NULL,
  campaign_id uuid NOT NULL,
  role        campaign_role NOT NULL,
  is_active   boolean NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, campaign_id)
);

-- FKs for membership (guarded)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'membership_user_id_fkey'
      AND conrelid = 'membership'::regclass
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT membership_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'membership_campaign_id_fkey'
      AND conrelid = 'membership'::regclass
  ) THEN
    ALTER TABLE membership
      ADD CONSTRAINT membership_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES campaign(id) ON DELETE CASCADE;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS streams (
  stream_id   uuid PRIMARY KEY,
  stream_type text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id      uuid NOT NULL,
  version        bigint NOT NULL,
  type           text   NOT NULL,
  payload        jsonb  NOT NULL,
  created_at     timestamptz DEFAULT now(),
  correlation_id uuid
);

-- FK + indexes for events (guarded)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_stream_id_fkey'
      AND conrelid = 'events'::regclass
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_stream_id_fkey
      FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS events_stream_version_uidx ON events(stream_id, version);
CREATE INDEX IF NOT EXISTS idx_events_stream_version ON events(stream_id, version);
CREATE INDEX IF NOT EXISTS ix_events_correlation ON events(correlation_id);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   uuid NOT NULL,
  version     bigint NOT NULL,
  state       jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- FK + indexes for snapshots (guarded)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'snapshots_stream_id_fkey'
      AND conrelid = 'snapshots'::regclass
  ) THEN
    ALTER TABLE snapshots
      ADD CONSTRAINT snapshots_stream_id_fkey
      FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS snapshots_stream_version_uidx ON snapshots(stream_id, version);
CREATE INDEX IF NOT EXISTS snapshots_stream_version_idx ON snapshots(stream_id, version DESC);

-- Optional ACL table
CREATE TABLE IF NOT EXISTS room_acl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES campaign(id),
  room_kind     text NOT NULL,
  can_join_roles campaign_role[] NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (campaign_id, room_kind)
);