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

CREATE INDEX IF NOT EXISTS idx_events_stream_version ON events(stream_id, version);
