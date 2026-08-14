-- Social Fusion Kan duplicate filtering. A queue row can now record the
-- event-level dedupe fingerprint used before a real Kan dispatch.

ALTER TABLE social_kan_queue
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT '';

ALTER TABLE social_kan_queue
  ADD COLUMN IF NOT EXISTS dedupe_fingerprint_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE social_kan_queue
  ADD COLUMN IF NOT EXISTS duplicate_of_queue_id TEXT;

CREATE INDEX IF NOT EXISTS idx_social_kan_queue_dedupe_key
  ON social_kan_queue (dedupe_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_kan_queue_fused_key_recent
  ON social_kan_queue (fused_event_key, created_at DESC);
