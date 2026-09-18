-- Global Radar adds durable event IDs and evidence snapshots to the existing
-- social fusion pipeline. Existing event rows remain valid and receive an ID
-- the next time they are updated.

ALTER TABLE social_fused_events
  ADD COLUMN IF NOT EXISTS radar_event_id TEXT;

ALTER TABLE social_fused_events
  ADD COLUMN IF NOT EXISTS radar_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE social_fused_events
  ADD COLUMN IF NOT EXISTS first_seen_at BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_fused_events_radar_event_id
  ON social_fused_events (radar_event_id)
  WHERE radar_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_radar_snapshots (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  captured_at BIGINT NOT NULL,
  verified_count INTEGER NOT NULL DEFAULT 0,
  platform_counts_json TEXT NOT NULL DEFAULT '{}',
  found_platforms_json TEXT NOT NULL DEFAULT '[]',
  attention_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'stable',
  trend TEXT NOT NULL DEFAULT 'uncertain',
  impact_level TEXT NOT NULL DEFAULT 'Low'
);

CREATE INDEX IF NOT EXISTS idx_social_radar_snapshots_event_captured
  ON social_radar_snapshots (event_key, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_radar_snapshots_captured
  ON social_radar_snapshots (captured_at DESC);
