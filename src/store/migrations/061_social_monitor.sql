-- Autonomous social monitoring runs. These tables sit beside the earlier
-- platform/fusion report tables and keep the UI as a read-only observer of
-- backend state.

CREATE TABLE IF NOT EXISTS social_monitor_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  mode TEXT NOT NULL DEFAULT 'probe',
  selected_platforms_json TEXT NOT NULL DEFAULT '[]',
  discovery_query TEXT NOT NULL DEFAULT '',
  max_candidates INTEGER NOT NULL DEFAULT 1,
  limit_per_platform INTEGER NOT NULL DEFAULT 3,
  current_cycle INTEGER NOT NULL DEFAULT 1,
  current_step TEXT NOT NULL DEFAULT '',
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  fusion_json TEXT,
  rendered_fusion_text TEXT NOT NULL DEFAULT '',
  kan_decision_json TEXT,
  started_at BIGINT NOT NULL,
  stopped_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_monitor_runs_created
  ON social_monitor_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_monitor_runs_status
  ON social_monitor_runs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_candidate_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES social_monitor_runs(id) ON DELETE CASCADE,
  source_platform TEXT NOT NULL,
  event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  discovered_at BIGINT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'discovered',
  china_relevance_json TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_candidate_events_run
  ON social_candidate_events (run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_social_candidate_events_key
  ON social_candidate_events (event_key, discovered_at DESC);

CREATE TABLE IF NOT EXISTS social_platform_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES social_monitor_runs(id) ON DELETE CASCADE,
  candidate_event_id TEXT NOT NULL REFERENCES social_candidate_events(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_found',
  title TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  report_json TEXT,
  rendered_report_text TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_platform_evidence_candidate
  ON social_platform_evidence (candidate_event_id, platform);

CREATE INDEX IF NOT EXISTS idx_social_platform_evidence_run
  ON social_platform_evidence (run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS social_kan_queue (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES social_monitor_runs(id) ON DELETE CASCADE,
  fused_event_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'held',
  reason TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_kan_queue_run
  ON social_kan_queue (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_kan_queue_status
  ON social_kan_queue (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_agent_step_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES social_monitor_runs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_agent_step_logs_run
  ON social_agent_step_logs (run_id, created_at ASC);
