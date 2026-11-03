ALTER TABLE viral_events ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS viral_events_observed_idx ON viral_events(event_type, (COALESCE(observed_at,received_at)));
