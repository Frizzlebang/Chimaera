CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Membership role enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role') THEN
    CREATE TYPE membership_role AS ENUM ('owner','dm','player');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  role membership_role NOT NULL DEFAULT 'player',
  PRIMARY KEY (user_id, campaign_id)
);

-- Snapshots
CREATE TABLE IF NOT EXISTS room_snapshots (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  room_type text NOT NULL,
  version int8 NOT NULL,
  state bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, room_type, version)
);

-- Events
CREATE TABLE IF NOT EXISTS room_events (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  room_type text NOT NULL,
  version int8 NOT NULL,
  correlation_id uuid NOT NULL,
  user_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, room_type, version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memberships_campaign_user ON memberships (campaign_id, user_id);
CREATE INDEX IF NOT EXISTS idx_events_campaign_version   ON room_events (campaign_id, room_type, version);
CREATE INDEX IF NOT EXISTS idx_snapshots_campaign_version ON room_snapshots (campaign_id, room_type, version);
