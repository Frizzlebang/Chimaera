CREATE TABLE IF NOT EXISTS streams (
  stream_id UUID PRIMARY KEY,
  stream_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY,
  stream_id UUID NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stream_id, version)
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id UUID PRIMARY KEY,
  stream_id UUID NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stream_id, version)
);

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL
);

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_role') THEN
        CREATE TYPE campaign_role AS ENUM ('owner','dm','player','viewer');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS membership (
  user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaign(id) ON DELETE CASCADE,
  role campaign_role NOT NULL,
  PRIMARY KEY (user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_events_stream_version ON events(stream_id, version);

CREATE TABLE IF NOT EXISTS room_acl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaign(id),
  room_kind text NOT NULL,
  can_join_roles campaign_role[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, room_kind)
);

-- Insert default ACL rules
INSERT INTO room_acl (campaign_id, room_kind, can_join_roles)
SELECT c.id, 'demo', ARRAY['owner', 'dm', 'player', 'viewer']::campaign_role[]
FROM campaign c
ON CONFLICT (campaign_id, room_kind) DO NOTHING;