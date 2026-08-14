-- Social intelligence pipeline: platform-specific reports, fused events,
-- propagation edges, and model routes for the gate/platform/fusion agents.

INSERT INTO config_overrides (namespace, key, value_json, updated_at) VALUES
  ('model-routing', 'social.gate',     '{"provider":"minimax","model":"MiniMax-M2.7"}', EXTRACT(EPOCH FROM now())::bigint),
  ('model-routing', 'social.platform', '{"provider":"minimax","model":"MiniMax-M2.7"}', EXTRACT(EPOCH FROM now())::bigint),
  ('model-routing', 'social.fusion',   '{"provider":"minimax","model":"MiniMax-M2.7"}', EXTRACT(EPOCH FROM now())::bigint)
ON CONFLICT (namespace, key) DO NOTHING;

CREATE TABLE IF NOT EXISTS social_platform_reports (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  rendered_text TEXT NOT NULL DEFAULT '',
  report_json TEXT NOT NULL,
  china_relevance_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported',
  observed_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_platform_reports_event
  ON social_platform_reports (event_key, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_platform_reports_platform
  ON social_platform_reports (platform, observed_at DESC);

CREATE TABLE IF NOT EXISTS social_fused_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  impact_level TEXT NOT NULL,
  trend TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  rendered_text TEXT NOT NULL DEFAULT '',
  event_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_fused_events_updated
  ON social_fused_events (updated_at DESC);

CREATE TABLE IF NOT EXISTS social_event_edges (
  id TEXT PRIMARY KEY,
  fused_event_id TEXT NOT NULL REFERENCES social_fused_events(id) ON DELETE CASCADE,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  platform TEXT,
  weight DOUBLE PRECISION NOT NULL DEFAULT 1,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_event_edges_fused
  ON social_event_edges (fused_event_id);
