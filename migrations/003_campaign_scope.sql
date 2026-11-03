ALTER TABLE synchronization_history ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'organization';
CREATE INDEX IF NOT EXISTS synchronization_scope_date_idx ON synchronization_history(scope_key,completed_at DESC);
CREATE TABLE IF NOT EXISTS campaign_analytics_snapshots (
  campaign_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY(campaign_id,observed_at)
);
