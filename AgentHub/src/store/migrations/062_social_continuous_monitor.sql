-- Continuous social patrol state. This keeps each platform agent's own
-- patrol memory separate so the UI can recover state after navigation.

ALTER TABLE social_monitor_runs
  ADD COLUMN IF NOT EXISTS continuous BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE social_monitor_runs
  ADD COLUMN IF NOT EXISTS cycle_interval_seconds INTEGER NOT NULL DEFAULT 300;

ALTER TABLE social_monitor_runs
  ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE social_monitor_runs
  ADD COLUMN IF NOT EXISTS platform_states_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE social_monitor_runs
  ADD COLUMN IF NOT EXISTS last_cycle_started_at BIGINT;

ALTER TABLE social_monitor_runs
  ADD COLUMN IF NOT EXISTS last_cycle_completed_at BIGINT;
