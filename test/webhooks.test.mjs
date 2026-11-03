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

test('campaign queued alerts require verified eligible videos and rebuild metrics from campaign source', async () => {
  const calls = [];
  let refreshes = 0;
  const campaignId = 'orgcamp_current';
  const snapshot = {
    campaign: { id: campaignId, validFrom: '2026-11-01T00:00:00Z' }, syncedAt: new Date().toISOString(),
    creators: [{ id: 'creator_a', assignmentValidFrom: '2026-11-03T00:00:00Z', accounts: [event().data.account] }],
    periods: [{ key: 'all', videos: [{ id: 'tiktok:123', platform: 'tiktok', platformVideoId: '123', accountId: 'orgacc_a', viewCount: 12000, likeCount: 30, publishedAt: '2026-11-03T08:00:00Z' }] }],
  };
  const options = { campaignId, campaignInventory: async () => snapshot, deliver: async (...args) => calls.push(args), refresh: async () => { refreshes++; }, legacyHighest: async () => assert.fail('organization legacy history must not control campaign'), channels: { viral: 'channel_1' }, minViews: 10000 };
  await hooks.handleQueuedEvent({ payload: { ...event(), data: { ...event().data, viewCount: 9000000 } } }, options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `campaign:${campaignId}:video:tiktok:123:10000`);
  assert.match(JSON.stringify(calls[0][2].toJSON()), /12\.000|12,000/);
  assert.doesNotMatch(JSON.stringify(calls[0][2].toJSON()), /9[.,]000[.,]000/);
  await hooks.handleQueuedEvent({ payload: { ...event(), data: { ...event().data, video: { ...event().data.video, platformVideoId: 'old_video' } } } }, options);
  await hooks.handleQueuedEvent({ payload: { ...event(), campaignId: 'orgcamp_old' } }, options);
  await hooks.handleQueuedEvent({ payload: { ...event(), scope: { type: 'campaign', id: 'orgcamp_old' } } }, options);
  await hooks.handleQueuedEvent({ payload: { ...event(), data: { ...event().data, account: { ...event().data.account, id: 'old_account' } } } }, options);
  assert.equal(calls.length, 1);
  assert.ok(refreshes >= 1);
});

test('queue persists only the verified campaign payload after delivery so campaign reports see provider milestones', async () => {
  const campaignId = 'orgcamp_current';
  const raw = { ...event(), data: { ...event().data, viewCount: 9000000 } };
  const snapshot = { campaign: { id: campaignId }, syncedAt: new Date().toISOString(), creators: [{ id: 'creator_a', assignmentValidFrom: '2026-11-03T00:00:00Z', accounts: [event().data.account] }], periods: [{ key: 'all', videos: [{ id: 'tiktok:123', platform: 'tiktok', platformVideoId: '123', accountId: 'orgacc_a', viewCount: 12000 }] }] };
  let claimed = false;
  let payload;
  const connection = {
    query: async (sql, params) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('RETURNING *') && !claimed) { claimed = true; return { rows: [{ id: raw.id, payload: raw }] }; }
      if (sql.includes("status='done'")) payload = params?.[1];
      return { rows: [] };
    }, release() {},
  };
  const process = hooks.createQueueProcessor({ database: { pool: { connect: async () => connection } }, handle: row => hooks.handleQueuedEvent(row, { campaignId, campaignInventory: async () => snapshot, deliver: async () => {}, refresh: async () => {}, channels: { viral: 'channel' }, minViews: 10000 }) });
  await process();
  const scoped = JSON.parse(payload);
  assert.deepEqual(scoped.scope, { type: 'campaign', id: campaignId });
  assert.equal(scoped.data.viewCount, 12000);
  assert.equal(scoped.data.video.viewCount, 12000);
  snapshot.periods[0].videos = [];
  claimed = false; payload = undefined;
  await process();
  assert.equal(payload, null);
});

test('campaign refuses lifetime-only threshold crossings and queued events before assignment', async () => {
  const campaignId = 'orgcamp_current';
  const snapshot = { campaign: { id: campaignId, validFrom: '2026-11-01T00:00:00Z' }, creators: [{ id: 'creator_a', assignmentValidFrom: '2026-11-03T00:00:00Z', accounts: [event().data.account] }], periods: [{ key: 'all', videos: [{ id: 'tiktok:123', accountId: 'orgacc_a', platform: 'tiktok', platformVideoId: '123', viewCount: 0 }] }] };
  const options = { campaignId, campaignInventory: async () => snapshot, refresh: async () => {}, deliver: async () => assert.fail('out of campaign alert sent'), channels: { viral: 'channel_1', growth: 'channel_2' }, minViews: 10000, minFollowers: 1000 };
  await hooks.handleQueuedEvent({ payload: event() }, options);
  await hooks.handleQueuedEvent({ payload: { ...event(), type: 'account.followers_milestone', timestamp: '2026-11-02T00:00:00Z', data: { account: event().data.account, observedAt: '2026-11-02T00:00:00Z', milestone: 1000, followerCount: 1100 } } }, options);
  await hooks.handleQueuedEvent({ payload: event() }, { ...options, campaignInventory: async () => null });
});
