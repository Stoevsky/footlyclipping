import http from 'node:http';
import { config } from './config.js';
import { verifySignature } from './utils.js';
import * as db from './db.js';
import { viralEmbed, followersEmbed, publishedEmbed } from './presentation.js';
import { syncAnalytics } from './sync.js';

const MAX_BODY = 1024 * 1024;
const PLATFORMS = new Set(['tiktok', 'instagram', 'youtube', 'facebook', 'snapchat']);
const VIDEO_MILESTONES = new Set([10000,50000,100000,250000,500000,1000000,5000000,10000000]);
const FOLLOWER_MILESTONES = new Set([1000,10000,50000,100000,500000,1000000,5000000,10000000]);
const SUPPORTED = new Set(['video.views_milestone', 'account.followers_milestone', 'video.published', 'sync.completed', 'organization.synced', 'webhook.test']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0;

export function validEvent(event, headerId, organizationId) {
  if (!isObject(event) || !isId(event.id) || event.id !== headerId || !isId(event.type) || !isDate(event.timestamp) || !isId(event.organizationId) || (organizationId && event.organizationId !== organizationId) || !isObject(event.data)) return false;
  const { account, video } = event.data;
  if (['video.views_milestone', 'video.published', 'account.followers_milestone'].includes(event.type)) {
    if (!isObject(account) || !isId(account.id) || !PLATFORMS.has(account.platform) || !isId(account.platformAccountId) || typeof account.isCompetitor !== 'boolean') return false;
  }
  if (event.type.startsWith('video.') && SUPPORTED.has(event.type)) {
    if (!isObject(video) || !PLATFORMS.has(video.platform) || video.platform !== account.platform || !isId(video.platformVideoId)) return false;
  }
  if (event.type === 'video.views_milestone') return VIDEO_MILESTONES.has(event.data.milestone) && count(event.data.viewCount) && event.data.viewCount >= event.data.milestone && count(event.data.previousViewCount) && isDate(event.data.observedAt);
  if (event.type === 'account.followers_milestone') return FOLLOWER_MILESTONES.has(event.data.milestone) && count(event.data.followerCount) && event.data.followerCount >= event.data.milestone && count(event.data.previousFollowerCount) && isDate(event.data.observedAt);
  if (event.type === 'video.published') return isDate(video.publishedAt);
  if (event.type === 'organization.synced' || event.type === 'sync.completed') return isObject(event.data.sync) && isId(event.data.sync.id) && ['succeeded','partial','failed'].includes(event.data.sync.status);
  return true;
}

export function createHttpHandler({ readiness = async () => ({ ready: false }), secret = config.webhookSecret, organizationId = config.organizationId, enqueue = db.enqueueEvent } = {}) {
  return async (req, res) => {
    const respond = (status, body) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.url === '/health' && req.method === 'GET') return respond(200, { ok: true, service: 'footly-growth-bot' });
    if (req.url === '/ready' && req.method === 'GET') {
      try {
        const status = await readiness();
        const safe = {};
        for (const key of ['ready','configuration','analytics','configured','database','discord','viral','jobs','schedules','shuttingDown']) if (typeof status?.[key] === 'boolean') safe[key] = status[key];
        safe.ready = status?.ready === true;
        return respond(safe.ready ? 200 : 503, safe);
      } catch { return respond(503, { ready: false }); }
    }
    if (req.url !== '/webhooks/viral-app' || req.method !== 'POST') return respond(404, { error: 'Not found' });
    if (!secret) return respond(503, { error: 'Webhook verification is not configured' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return respond(415, { error: 'Expected application/json' });
    if (Number(req.headers['content-length']) > MAX_BODY) return respond(413, { error: 'Payload too large' });
    let raw;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) return respond(413, { error: 'Payload too large' });
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString('utf8');
    } catch { return respond(400, { error: 'Invalid request body' }); }
    if (!verifySignature(raw, req.headers, secret)) return respond(401, { error: 'Invalid signature' });
    let event;
    try { event = JSON.parse(raw); } catch { return respond(400, { error: 'Invalid JSON' }); }
    if (!validEvent(event, req.headers['webhook-id'], organizationId)) return respond(400, { error: 'Invalid event' });
    // Future unrelated events are acknowledged without storing unnecessary personal data.
    if (!SUPPORTED.has(event.type)) return respond(204);
    try {
      await enqueue(event);
      return respond(204);
    } catch {
      console.error('[webhook] Event persistence failed; delivery may be retried');
      return respond(503, { error: 'Temporary storage failure' });
    }
  };
}

export function startHttpServer(options = {}) {
  const server = http.createServer(createHttpHandler(options));
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  const port = Number.isInteger(config.port) && config.port > 0 && config.port <= 65535 ? config.port : 3000;
  server.listen(port, '0.0.0.0', () => console.info(`[http] Listening on port ${port}`));
  return server;
}

const defaultDeliver = async (...args) => (await import('./delivery.js')).deliverOnce(...args);
export function createWebhookRefresher({ sync = syncAnalytics, update = async () => (await import('./bot.js')).updateLeaderboard(false), now = Date.now, minIntervalMs = 300000 } = {}) {
  let lastSuccess = null;
  let active;
  return function refresh() {
    if (active) return active;
    if (lastSuccess !== null && now() - lastSuccess < minIntervalMs) return Promise.resolve(false);
    active = (async () => {
      try {
        await sync();
        lastSuccess = now();
        await update();
        return true;
      } finally { active = null; }
    })();
    return active;
  };
}
const defaultRefresh = createWebhookRefresher();

export async function handleQueuedEvent(row, { deliver = defaultDeliver, refresh = defaultRefresh, legacyHighest = db.getHighest, channels = config.channels, minViews = config.minViews, minFollowers = config.minFollowers } = {}) {
  const event = row.payload;
  const { account, video, milestone } = event.data || {};
  if (account?.isCompetitor || video?.isCompetitor) return;
  if (event.type === 'video.views_milestone' && milestone >= minViews) {
    // Old installations recorded only the highest sent threshold. Preserve that history
    // while all new deliveries use their separate durable per-threshold keys.
    if (milestone <= await legacyHighest('video_milestones', `${video.platform}:${video.platformVideoId}`)) return;
    await deliver(`video:${video.platform}:${video.platformVideoId}:${milestone}`, channels.viral, viralEmbed(event));
  } else if (event.type === 'account.followers_milestone' && milestone >= minFollowers) {
    if (milestone <= await legacyHighest('account_milestones', account.id || `${account.platform}:${account.platformAccountId}`)) return;
    await deliver(`account:${account.platform}:${account.platformAccountId}:${milestone}`, channels.growth, followersEmbed(event));
  } else if (event.type === 'video.published' && channels.videos) {
    await deliver(`published:${video.platform}:${video.platformVideoId}`, channels.videos, publishedEmbed(event));
  } else if (event.type === 'organization.synced' || event.type === 'sync.completed') {
    await refresh();
  }
}

export function createQueueProcessor({ database = db, handle = handleQueuedEvent } = {}) {
  let busy = false;
  return async function process() {
    if (busy) return;
    busy = true;
    let connection;
    let locked = false;
    try {
      connection = await database.pool.connect();
      const lock = await connection.query("SELECT pg_try_advisory_lock(hashtext('footly:webhook-worker')) AS acquired");
      locked = lock.rows[0]?.acquired === true;
      if (!locked) return;
      await connection.query("UPDATE viral_events SET status='pending', processing_at=NULL WHERE status='processing' AND (processing_at IS NULL OR processing_at < now() - interval '5 minutes')");
      for (let i = 0; i < 30; i++) {
        const { rows } = await connection.query(`UPDATE viral_events SET status='processing', processing_at=now(), attempts=attempts+1
          WHERE id=(SELECT id FROM viral_events WHERE status='pending' AND available_at<=now()
            ORDER BY received_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
        const row = rows[0];
        if (!row) break;
        try {
          await handle(row);
          await connection.query("UPDATE viral_events SET status='done', processed_at=now(), processing_at=NULL, error=NULL WHERE id=$1", [row.id]);
        } catch {
          const backoff = Math.min(3600, 20 * 2 ** Math.min(row.attempts || 1, 7));
          await connection.query(`UPDATE viral_events SET status=$2, error=$3, processing_at=NULL, available_at=now()+($4::integer*interval '1 second') WHERE id=$1`, [row.id, (row.attempts || 1) >= 12 ? 'failed' : 'pending', 'EVENT_PROCESSING_FAILED', backoff]);
          console.error('[worker] Event processing failed; retry state recorded');
        }
      }
    } catch { console.error('[worker] Queue unavailable; will retry'); }
    finally {
      let discard = false;
      if (locked) { try { await connection.query("SELECT pg_advisory_unlock(hashtext('footly:webhook-worker'))"); } catch { discard = true; } }
      connection?.release(discard);
      busy = false;
    }
  };
}
export const processQueue = createQueueProcessor();
