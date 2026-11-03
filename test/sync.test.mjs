import test from 'node:test';
import assert from 'node:assert/strict';
const sync = await import('../src/sync.js').catch(() => ({}));

const account = { id: 'orgacc_a', platform: 'tiktok', platformAccountId: 'a', username: 'creator', totalViews: 20000, totalVideosTracked: 1, totalVideosRetained: 0, totalVideosExcluded: 0, followerCount: null, creatorEmail: 'private@example.test' };
const video = { id: 'source_video', platform: 'tiktok', platformVideoId: '1234567890123456789', orgAccountId: 'orgacc_a', accountUsername: 'creator', viewCount: 20000, likeCount: null, publishedAt: '2026-11-01T12:00:00Z', loadAt: '2026-11-03T08:00:00Z' };

test('normalizes official responses without creating zeros or copying creator email', () => {
  assert.equal(typeof sync.normalizeAccount, 'function');
  const a = sync.normalizeAccount(account);
  const v = sync.normalizeVideo(video);
  assert.equal(a.viewCount, 20000);
  assert.equal(a.videoCount, 1);
  assert.equal(a.followerCount, null);
  assert.equal(a.creatorEmail, undefined);
  assert.equal(v.id, `tiktok:${video.platformVideoId}`);
  assert.equal(v.accountId, 'orgacc_a');
  assert.equal(v.likeCount, null);
  assert.equal(v.url, `https://www.tiktok.com/@creator/video/${video.platformVideoId}`);
});

test('polling establishes baselines then emits every crossed threshold only for known videos', () => {
  assert.equal(typeof sync.crossingEvents, 'function');
  const a = sync.normalizeAccount(account);
  const v = sync.normalizeVideo(video);
  assert.deepEqual(sync.crossingEvents([], [v], [a], [10000, 50000, 100000]), []);
  const now = new Date('2026-11-03T09:00:00Z');
  const events = sync.crossingEvents([{ ...v, viewCount: 9000 }], [{ ...v, viewCount: 110000 }], [a], [10000, 50000, 100000], { now, organizationId: 'org_test' });
  assert.deepEqual(events.map(e => e.data.milestone), [10000, 50000, 100000]);
  assert.ok(events.every(e => e.type === 'video.views_milestone' && e.organizationId === 'org_test'));
  assert.equal(new Set(events.map(e => e.id)).size, 3);
  assert.deepEqual(sync.crossingEvents([{ ...v, viewCount: null }], [v], [a], [10000]), []);
});

test('sync writes inventory, source period metrics and fallback events in one persistence call', async () => {
  assert.equal(typeof sync.createSynchronizer, 'function');
  const saved = [];
  const api = {
    accounts: async () => [account], videos: async () => [video],
    periodAccounts: async () => [{ id: account.id, viewCountInPeriod: 3000 }],
    periodVideos: async () => [{ ...video, viewCountInPeriod: 3000 }],
  };
  const run = sync.createSynchronizer({ api, inventory: async () => ({ accounts: [], videos: [], syncedAt: null }), persist: async value => saved.push(value), failure: async () => {}, timezone: 'Europe/Skopje', milestones: [10000] });
  await run(new Date('2026-11-03T09:00:00Z'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].accounts.length, 1);
  assert.equal(saved[0].videos.length, 1);
  assert.equal(saved[0].events.length, 0);
  assert.equal(saved[0].coverage.complete, true);
  assert.ok(saved[0].periods.some(p => p.from === '2026-11-02' && p.to === '2026-11-02'));
  assert.ok(saved[0].periods.every(p => p.accounts[0].viewCountInPeriod === 3000 && p.videoCoverage === 'top100'));
});

test('failed inventory fetch never overwrites the last successful dataset', async () => {
  assert.equal(typeof sync.createSynchronizer, 'function');
  let saved = false;
  let failure;
  const run = sync.createSynchronizer({ api: { accounts: async () => { throw new Error('upstream secret body'); } }, inventory: async () => ({ videos: [] }), persist: async () => { saved = true; }, failure: async code => { failure = code; } });
  await assert.rejects(run(), /sync failed/i);
  assert.equal(saved, false);
  assert.equal(failure, 'VIRAL_SYNC_FAILED');
});

test('new accounts without source history remain visible with explicit partial period coverage', async () => {
  let saved;
  const run = sync.createSynchronizer({
    api: { accounts: async () => [account], videos: async () => [], periodAccounts: async (_ids, _range, options) => { assert.equal(options.allowMissing, true); return []; }, periodVideos: async () => [] },
    inventory: async () => ({ accounts: [], videos: [] }), persist: async value => { saved = value; }, failure: async () => {},
  });
  await run(new Date('2026-11-03T09:00:00Z'));
  assert.equal(saved.accounts.length, 1);
  assert.ok(saved.periods.every(p => p.accountCoverage === 'partial'));
  assert.ok(saved.coverage.missingPeriodAccounts > 0);
});

test('account video count matches visible source analytics and never invents excluded counts', () => {
  const value = sync.normalizeAccount({ ...account, totalVideosTracked: 10, totalVideosRetained: 2, totalVideosExcluded: 3 });
  assert.equal(value.videoCount, 9);
  assert.equal(value.totalVideosTracked, 10);
  assert.equal(value.totalVideosRetained, 2);
  assert.equal(value.totalVideosExcluded, 3);
  assert.equal(sync.normalizeAccount({ ...account, totalVideosExcluded: undefined }).videoCount, null);
  assert.equal(sync.normalizeAccount({ ...account, totalVideosExcluded: 9 }).videoCount, null);
});

test('sync failures retain safe upstream HTTP status for actionable diagnostics without response secrets', async () => {
  let failure;
  const run = sync.createSynchronizer({ api: { accounts: async () => { throw Object.assign(new Error('private credential'), { status: 401 }); } }, failure: async code => { failure = code; } });
  await assert.rejects(run(), error => error.message.includes('VIRAL_HTTP_401') && !error.message.includes('private credential'));
  assert.equal(failure, 'VIRAL_HTTP_401');
});
