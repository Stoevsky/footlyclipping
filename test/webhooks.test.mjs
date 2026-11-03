import http from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as hooks from '../src/webhooks.js';

const secret = `whsec_${Buffer.from('test-signing-secret').toString('base64')}`;
const event = () => ({ id: 'event_1', type: 'video.views_milestone', timestamp: new Date().toISOString(), organizationId: 'org_test', data: { video: { platform: 'tiktok', platformVideoId: '123', publishedAt: '2026-11-01T12:00:00Z' }, account: { id: 'orgacc_a', platform: 'tiktok', platformAccountId: 'account_a', username: 'creator', isCompetitor: false }, milestone: 10000, viewCount: 12000, previousViewCount: 9000, observedAt: new Date().toISOString() } });
const signed = (raw, id = 'event_1', offset = 0) => {
  const timestamp = String(Math.floor(Date.now() / 1000) + offset);
  return { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${createHmac('sha256', Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64')}` };
};
async function server(t, options = {}) {
  assert.equal(typeof hooks.createHttpHandler, 'function');
  const httpServer = http.createServer(hooks.createHttpHandler({ secret, organizationId: 'org_test', readiness: async () => ({ ready: true, database: true, discord: true }), enqueue: async () => {}, ...options }));
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  t.after(() => new Promise(resolve => { httpServer.closeAllConnections(); httpServer.close(resolve); }));
  return `http://127.0.0.1:${httpServer.address().port}`;
}

test('liveness stays healthy while readiness reports unavailable dependencies safely', async t => {
  const base = await server(t, { readiness: async () => ({ ready: false, configuration: false, database: false, discord: false, analytics: false, token: 'never-return' }) });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const ready = await fetch(`${base}/ready`);
  assert.equal(ready.status, 503);
  const body = await ready.json();
  assert.equal(JSON.stringify(body).includes('never-return'), false);
  assert.equal(body.configuration, false);
  assert.equal(body.analytics, false);
});

test('signed supported webhook is persisted before acknowledgement and duplicate id is preserved', async t => {
  const queued = [];
  const base = await server(t, { enqueue: async value => queued.push(value) });
  const raw = JSON.stringify(event());
  for (let i=0;i<2;i++) assert.equal((await fetch(`${base}/webhooks/viral-app`, { method: 'POST', headers: signed(raw), body: raw })).status, 204);
  assert.deepEqual(queued.map(e => e.id), ['event_1','event_1']);
});

test('rejects bad signatures, replay, wrong organization and invalid nested metrics', async t => {
  const base = await server(t, { enqueue: async () => assert.fail('invalid event persisted') });
  const raw = JSON.stringify(event());
  assert.equal((await fetch(`${base}/webhooks/viral-app`, { method: 'POST', body: raw, headers: { ...signed(raw), 'webhook-signature': 'v1,wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/webhooks/viral-app`, { method: 'POST', body: raw, headers: signed(raw, 'event_1', -400) })).status, 401);
  for (const changed of [{ ...event(), organizationId: 'org_other' }, { ...event(), data: { ...event().data, viewCount: 'made-up' } }]) {
    const body = JSON.stringify(changed);
    assert.equal((await fetch(`${base}/webhooks/viral-app`, { method: 'POST', body, headers: signed(body) })).status, 400);
  }
});

test('malformed signed JSON returns 400; storage outage and missing secret return 503', async t => {
  const base = await server(t, { enqueue: async () => { throw new Error('password=secret'); } });
  const raw = JSON.stringify(event());
  assert.equal((await fetch(`${base}/webhooks/viral-app`, { method: 'POST', body: '{', headers: signed('{') })).status, 400);
  const failed = await fetch(`${base}/webhooks/viral-app`, { method: 'POST', body: raw, headers: signed(raw) });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('secret'), false);
  const missing = await server(t, { secret: undefined });
  assert.equal((await fetch(`${missing}/webhooks/viral-app`, { method: 'POST', body: raw, headers: signed(raw) })).status, 503);
});

test('out-of-order thresholds use distinct durable delivery keys and suppress competitors', async () => {
  assert.equal(typeof hooks.handleQueuedEvent, 'function');
  const calls = [];
  const options = { deliver: async (...args) => calls.push(args), legacyHighest: async () => 0, channels: { viral: 'channel_1' }, minViews: 10000 };
  await hooks.handleQueuedEvent({ payload: { ...event(), data: { ...event().data, milestone: 100000, viewCount: 120000 } } }, options);
  await hooks.handleQueuedEvent({ payload: event() }, options);
  await hooks.handleQueuedEvent({ payload: { ...event(), data: { ...event().data, account: { ...event().data.account, isCompetitor: true } } } }, options);
  assert.deepEqual(calls.map(c => c[0]), ['video:tiktok:123:100000', 'video:tiktok:123:10000']);
});

test('queue uses processing leases and records sanitized retry state before releasing its lock', async () => {
  assert.equal(typeof hooks.createQueueProcessor, 'function');
  const queries = [];
  let claims = 0;
  let released = false;
  const connection = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('RETURNING *')) return { rows: claims++ === 0 ? [{ id: 'event_1', attempts: 1, payload: event() }] : [] };
      return { rows: [] };
    },
    release: () => { released = true; },
  };
  const process = hooks.createQueueProcessor({ database: { pool: { connect: async () => connection } }, handle: async () => { throw new Error('private token'); } });
  await process();
  assert.ok(queries.some(q => q.sql.includes('processing_at < now()')));
  const retry = queries.find(q => q.params?.[2] === 'EVENT_PROCESSING_FAILED');
  assert.deepEqual(retry.params, ['event_1', 'pending', 'EVENT_PROCESSING_FAILED', 40]);
  assert.ok(queries.at(-1).sql.includes('pg_advisory_unlock'));
  assert.equal(released, true);
});

test('another queue owner prevents a second replica from processing', async () => {
  assert.equal(typeof hooks.createQueueProcessor, 'function');
  let reads = 0;
  await hooks.createQueueProcessor({ database: { pool: { connect: async () => ({ query: async () => { reads++; return { rows: [{ acquired: false }] }; }, release() {} }) } }, handle: async () => assert.fail('duplicate worker') })();
  assert.equal(reads, 1);
});

test('migration respects previously delivered highest milestones without reposting history', async () => {
  const calls = [];
  const legacyKeys = [];
  const options = { deliver: async (...args) => calls.push(args), legacyHighest: async (...args) => { legacyKeys.push(args); return 50000; }, channels: { viral: 'channel_1' }, minViews: 10000 };
  await hooks.handleQueuedEvent({ payload: event() }, options);
  assert.equal(calls.length, 0);
  assert.deepEqual(legacyKeys, [['video_milestones','tiktok:123']]);
  await hooks.handleQueuedEvent({ payload: { ...event(), data: { ...event().data, milestone: 100000, viewCount: 120000 } } }, options);
  assert.equal(calls.length, 1);
});

test('webhook sync bursts coalesce and debounce successful refreshes', async () => {
  assert.equal(typeof hooks.createWebhookRefresher, 'function');
  let clock = 1000000;
  let calls = 0;
  const refresh = hooks.createWebhookRefresher({ sync: async () => { calls++; }, update: async () => {}, now: () => clock, minIntervalMs: 60000 });
  await Promise.all([refresh(), refresh(), refresh()]);
  await refresh();
  assert.equal(calls, 1);
  clock += 60000;
  await refresh();
  assert.equal(calls, 2);
});

test('queue discards a connection whose session advisory lock could not be released', async () => {
  let discarded;
  const connection = {
    query: async sql => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('pg_advisory_unlock')) throw new Error('unlock interrupted');
      return { rows: [] };
    },
    release: value => { discarded = value; },
  };
  await hooks.createQueueProcessor({ database: { pool: { connect: async () => connection } } })();
  assert.equal(discarded, true);
});
