CREATE TABLE IF NOT EXISTS viral_events (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(), available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT
);
ALTER TABLE viral_events ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS viral_events_queue_idx ON viral_events(status, available_at, received_at);
CREATE TABLE IF NOT EXISTS video_milestones(video_key TEXT PRIMARY KEY, highest_milestone BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS account_milestones(account_key TEXT PRIMARY KEY, highest_milestone BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_state(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sent_reports(report_key TEXT PRIMARY KEY, sent_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY, platform TEXT, username TEXT, payload JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS tracked_videos (
  id TEXT PRIMARY KEY, account_id TEXT, platform TEXT, published_at TIMESTAMPTZ,
  payload JSONB NOT NULL, active BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS tracked_videos_account_idx ON tracked_videos(account_id);
CREATE INDEX IF NOT EXISTS tracked_videos_publication_idx ON tracked_videos(published_at);
CREATE TABLE IF NOT EXISTS creator_metrics (
  creator_id TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL,
  PRIMARY KEY(creator_id, observed_at)
);
CREATE TABLE IF NOT EXISTS video_metrics (
  video_id TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL,
  PRIMARY KEY(video_id, observed_at)
);
CREATE INDEX IF NOT EXISTS creator_metrics_date_idx ON creator_metrics(observed_at);
CREATE INDEX IF NOT EXISTS video_metrics_date_idx ON video_metrics(observed_at);
CREATE TABLE IF NOT EXISTS analytics_periods (
  date_from DATE NOT NULL, date_to DATE NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  coverage JSONB NOT NULL, PRIMARY KEY(date_from,date_to)
);
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('account','video')),
  entity_id TEXT NOT NULL, date_from DATE NOT NULL, date_to DATE NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL,
  PRIMARY KEY(entity_type,entity_id,date_from,date_to)
);
CREATE INDEX IF NOT EXISTS analytics_snapshots_period_idx ON analytics_snapshots(date_from,date_to);
CREATE TABLE IF NOT EXISTS synchronization_history (
  id BIGSERIAL PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ, status TEXT NOT NULL, account_count INTEGER,
  video_count INTEGER, coverage JSONB, error_code TEXT
);
CREATE INDEX IF NOT EXISTS synchronization_history_date_idx ON synchronization_history(completed_at DESC);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  key TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', claimed_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB
);
