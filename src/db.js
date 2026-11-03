import pg from 'pg';
import { config } from './config.js';
import { readFile } from 'node:fs/promises';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 6,
  connectionTimeoutMillis: 6000,
  idleTimeoutMillis: 30000,
  statement_timeout: 20000,
  ...(config.databaseSSL ? { ssl: { rejectUnauthorized: true } } : {}),
});
pool.on('error', error => console.error('[database] Idle connection error', /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'CONNECTION_ERROR'));
// pg-pool removes its own client error listener while a connection is checked
// out. Delivery/queue workers can hold one across a Discord/API await, so a
// disconnect in that interval must not become an unhandled EventEmitter error.
pool.on('connect', client => client.on('error', error => {
  console.error('[database] Client connection error', /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'CONNECTION_ERROR');
}));

export async function transaction(database, operation) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function setupDatabase(database = pool) {
  const migrations = await Promise.all(['001_analytics.sql','002_event_observation.sql'].map(async (file,index) => ({version:index+1,sql:await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')})));
  await transaction(database, async client => {
    await client.query('SELECT pg_advisory_xact_lock(706923004)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const migration of migrations) {
      const applied = await client.query('SELECT version FROM schema_migrations WHERE version=$1',[migration.version]);
      if (!applied.rowCount) {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[migration.version]);
      }
    }
    await client.query("UPDATE viral_events SET status='pending',available_at=now(),processing_at=NULL WHERE status='processing' AND (processing_at IS NULL OR processing_at < now() - interval '5 minutes')");
  });
}

export async function enqueueEvent(event, database = pool) {
  const delaySeconds = event.type === 'video.views_milestone' ? 45 : 0;
  const sourceDate = event.data?.observedAt || event.timestamp;
  const observedAt = sourceDate && Number.isFinite(Date.parse(sourceDate)) ? new Date(sourceDate) : null;
  const result = await database.query(`
    INSERT INTO viral_events (id, event_type, payload, available_at, observed_at)
    VALUES ($1, $2, $3::jsonb, now() + ($4::integer * interval '1 second'), $5)
    ON CONFLICT (id) DO NOTHING RETURNING id
  `, [event.id, event.type, JSON.stringify(event), delaySeconds, observedAt]);
  return result.rowCount > 0;
}

function requireId(row) {
  if (!row || row.id === undefined || row.id === null || String(row.id).trim() === '') throw new Error('Inventory row requires an ID');
  return String(row.id);
}

export async function saveSync(input, database = pool) {
  const { accounts, videos, periods = [], periodMetrics = [], events = [], coverage = {complete:true} } = input;
  if (!Array.isArray(accounts) || !Array.isArray(videos)) throw new Error('Complete account and video inventories required');
  accounts.forEach(requireId); videos.forEach(requireId);
  const at = new Date(input.syncedAt || input.observedAt || new Date());
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid synchronization timestamp');
  return transaction(database, async client => {
    await client.query('SELECT pg_advisory_xact_lock(706923005)');
    if (coverage.complete !== false) {
      await client.query('UPDATE creators SET active=false WHERE active');
      await client.query('UPDATE tracked_videos SET active=false WHERE active');
    }
    for (const account of accounts) {
      const id = requireId(account);
      await client.query(`INSERT INTO creators(id,platform,username,payload,updated_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET platform=EXCLUDED.platform,username=EXCLUDED.username,payload=EXCLUDED.payload,active=true,updated_at=EXCLUDED.updated_at`, [id,account.platform ?? null,account.username ?? null,account,at]);
      await client.query('INSERT INTO creator_metrics(creator_id,observed_at,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id,at,account]);
    }
    for (const video of videos) {
      const id = requireId(video);
      const published = video.publishedAt && Number.isFinite(Date.parse(video.publishedAt)) ? video.publishedAt : null;
      await client.query(`INSERT INTO tracked_videos(id,account_id,platform,published_at,payload,updated_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET account_id=EXCLUDED.account_id,platform=EXCLUDED.platform,published_at=EXCLUDED.published_at,payload=EXCLUDED.payload,active=true,updated_at=EXCLUDED.updated_at`, [id,video.accountId == null ? null : String(video.accountId),video.platform ?? null,published,video,at]);
      await client.query('INSERT INTO video_metrics(video_id,observed_at,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id,at,video]);
    }
    for (const period of periods) {
      const periodCoverage = {accountCoverage:period.accountCoverage || 'unknown',videoCoverage:period.videoCoverage || 'unknown',metricsTimezone:period.metricsTimezone || coverage.metricTimezone || null};
      await client.query('DELETE FROM analytics_snapshots WHERE date_from=$1 AND date_to=$2', [period.from,period.to]);
      await client.query(`INSERT INTO analytics_periods(date_from,date_to,observed_at,coverage) VALUES($1,$2,$3,$4)
        ON CONFLICT(date_from,date_to) DO UPDATE SET observed_at=EXCLUDED.observed_at,coverage=EXCLUDED.coverage`, [period.from,period.to,at,periodCoverage]);
      for (const [type, rows] of [['account',period.accounts || []],['video',period.videos || []]]) {
        for (const row of rows) {
          const id = String(row.id ?? (type === 'video' ? `${row.platform}:${row.platformVideoId}` : row.orgAccountId ?? ''));
          if (!id || id.includes('undefined')) throw new Error('Period metric requires an entity ID');
          await client.query(`INSERT INTO analytics_snapshots(entity_type,entity_id,date_from,date_to,observed_at,payload) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(entity_type,entity_id,date_from,date_to) DO UPDATE SET observed_at=EXCLUDED.observed_at,payload=EXCLUDED.payload`, [type,id,period.from,period.to,at,row]);
        }
      }
    }
    for (const metric of periodMetrics) {
      await client.query(`INSERT INTO analytics_snapshots(entity_type,entity_id,date_from,date_to,observed_at,payload) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(entity_type,entity_id,date_from,date_to) DO UPDATE SET observed_at=EXCLUDED.observed_at,payload=EXCLUDED.payload`, [metric.entityType,String(metric.entityId),metric.from,metric.to,at,metric]);
    }
    for (const event of events) await enqueueEvent(event, client);
    await client.query(`INSERT INTO synchronization_history(completed_at,status,account_count,video_count,coverage) VALUES($1,'success',$2,$3,$4)`, [at,accounts.length,videos.length,coverage]);
    return {accounts:accounts.length,videos:videos.length,syncedAt:at.toISOString()};
  });
}
export const persistAnalytics = saveSync;

export async function getInventory(database = pool) {
  const accounts = await database.query('SELECT payload FROM creators WHERE active ORDER BY id');
  const videos = await database.query('SELECT payload FROM tracked_videos WHERE active ORDER BY id');
  const latest = await database.query("SELECT completed_at,coverage FROM synchronization_history WHERE status='success' ORDER BY completed_at DESC,id DESC LIMIT 1");
  return { accounts:accounts.rows.map(row => row.payload), videos:videos.rows.map(row => row.payload),
    syncedAt:latest.rows[0]?.completed_at?.toISOString() ?? null, coverage:latest.rows[0]?.coverage ?? {complete:false} };
}

export async function recordSyncFailure(error, database = pool) {
  const code = typeof error === 'string' ? error : error?.code;
  const safeCode = /^[A-Z0-9_]{1,60}$/.test(code || '') ? code : 'SYNC_FAILED';
  await database.query("INSERT INTO synchronization_history(completed_at,status,error_code) VALUES(now(),'failed',$1)", [safeCode]);
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
