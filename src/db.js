import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 6,
  connectionTimeoutMillis: 6000,
  idleTimeoutMillis: 30000,
  ...(config.databaseSSL ? { ssl: { rejectUnauthorized: true } } : {}),
});

export async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viral_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS viral_events_queue_idx ON viral_events (status, available_at, received_at);
    CREATE TABLE IF NOT EXISTS video_milestones (
      video_key TEXT PRIMARY KEY,
      highest_milestone BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_milestones (
      account_key TEXT PRIMARY KEY,
      highest_milestone BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sent_reports (
      report_key TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Vrakjame eventovi na koi prethodniot proces se izgasil posle claim.
  await pool.query("UPDATE viral_events SET status='pending', available_at=now() WHERE status='processing' AND received_at < now() - interval '5 minutes'");
}

export async function enqueueEvent(event) {
  const delaySeconds = event.type === 'video.views_milestone' ? 45 : 0;
  await pool.query(`
    INSERT INTO viral_events (id, event_type, payload, available_at)
    VALUES ($1, $2, $3::jsonb, now() + ($4::integer * interval '1 second'))
    ON CONFLICT (id) DO NOTHING
  `, [event.id, event.type, JSON.stringify(event), delaySeconds]);
}

export async function getState(key) {
  const { rows } = await pool.query('SELECT value FROM bot_state WHERE key=$1', [key]);
  return rows[0]?.value ?? null;
}
export async function setState(key, value) {
  await pool.query(`INSERT INTO bot_state(key,value) VALUES ($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [key, String(value)]);
}
export async function getHighest(table, key) {
  if (!['video_milestones','account_milestones'].includes(table)) throw new Error('Nevalidna tabela');
  const field = table === 'video_milestones' ? 'video_key' : 'account_key';
  const { rows } = await pool.query(`SELECT highest_milestone FROM ${table} WHERE ${field}=$1`, [key]);
  return Number(rows[0]?.highest_milestone ?? 0);
}
export async function setHighest(table, key, milestone) {
  if (!['video_milestones','account_milestones'].includes(table)) throw new Error('Nevalidna tabela');
  const field = table === 'video_milestones' ? 'video_key' : 'account_key';
  await pool.query(`INSERT INTO ${table}(${field},highest_milestone) VALUES($1,$2)
     ON CONFLICT(${field}) DO UPDATE SET highest_milestone=GREATEST(${table}.highest_milestone,EXCLUDED.highest_milestone)`, [key, milestone]);
}
export async function markDone(ids) {
  await pool.query("UPDATE viral_events SET status='done',processed_at=now(),error=NULL WHERE id=ANY($1::text[])", [ids]);
}
