CREATE TABLE IF NOT EXISTS kan_inbound_messages (
  external_id TEXT PRIMARY KEY,
  received_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS kan_deliveries (
  id TEXT PRIMARY KEY,
  event_key TEXT,
  destination_type TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  user_id TEXT,
  message_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kan_deliveries_destination
  ON kan_deliveries (destination_type, destination_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kan_deliveries_event
  ON kan_deliveries (event_key, created_at DESC);
