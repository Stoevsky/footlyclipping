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

const campaignId = 'orgcamp_current';
const campaignFixture = () => {
  const creators = Array.from({ length: 4 }, (_, i) => ({ id: `creator_${i}`, user: { name: `Creator ${i}`, email: 'private@example.test' }, accounts: i ? [{ id: `account_${i}`, platform: 'tiktok', platformAccountId: `native_${i}`, username: `new_${i}`, isCompetitor: false }] : [], campaignDisplay: { id: campaignId, assignmentValidFrom: '2026-11-03T00:00:00Z', assignmentValidUntil: null } }));
  const data = creators.map(c => ({ id: c.id, creatorId: c.id, campaign: { id: campaignId }, totalViews: 0, totalPosts: 0, totalVideosEligible: 0, totalLikes: 0, totalComments: 0, totalShares: 0, totalBookmarks: 0, engagementRate: 0 }));
  return {
    creators,
    api: {
      campaign: async () => ({ id: campaignId, name: 'Newest campaign', validFrom: '2026-11-01', validUntil: null, timeZone: 'UTC', creatorSummary: { activeCount: 4, activeCreators: creators } }),
      campaignCreators: async () => creators,
      campaignPerformance: async () => ({ data, totals: { rowCount: 4, totalViews: 0, totalPosts: 0, totalVideosEligible: 0, totalLikes: 0, totalComments: 0, totalShares: 0, totalBookmarks: 0 }, timeZone: 'UTC', eligibilityRefreshedAt: '2026-11-03T08:00:00Z' }),
      campaignKpis: async () => ({ metrics: { totalViews: 0, publishedVideos: 0, eligibleVideos: 0 }, timeZone: 'UTC' }),
      campaignVideos: async () => [],
      accounts: async () => assert.fail('campaign must never read organization totals'),
      videos: async () => assert.fail('campaign must never read organization videos'),
    },
  };
};

test('campaign ingestion retains all four zero-view creators, including one without accounts, and preserves organization storage', async () => {
  assert.equal(typeof sync.createCampaignSynchronizer, 'function');
  const { api } = campaignFixture();
  let saved;
  const run = sync.createSynchronizer({ campaignId, api, campaignInventory: async () => null, persistCampaign: async value => { saved = value; }, persist: async () => assert.fail('must not replace organization inventory'), failure: async () => {} });
  const result = await run(new Date('2026-11-03T09:00:00Z'));
  assert.equal(saved.campaign.id, campaignId);
  assert.equal(saved.campaign.key, `campaign:${campaignId}`);
  assert.equal(saved.creators.length, 4);
  assert.equal(saved.creators[0].accounts.length, 0);
  assert.equal(result.creators, 4);
  assert.deepEqual(saved.periods.map(p => p.key), ['all','today','yesterday','week','month','previous_week','last30']);
  assert.ok(saved.periods.every(p => p.creators.length === 4 && p.creators.every(c => c.viewCount === 0)));
  assert.equal(JSON.stringify(saved).includes('private@example.test'), false);
  assert.deepEqual(saved.events, []);
});

test('campaign missing metrics remain unknown and wrong-scope responses cannot replace a good snapshot', async () => {
  const { api } = campaignFixture();
  api.campaignPerformance = async () => ({ data: [], totals: {}, timeZone: 'UTC' });
  api.campaignKpis = async () => ({ metrics: { totalViews: 10, eligibleVideos: 1, publishedVideos: 1 } });
  let saved;
  const run = sync.createCampaignSynchronizer({ campaignId, api, inventory: async () => null, persist: async value => { saved = value; }, failure: async () => {} });
  await run(new Date('2026-11-03T09:00:00Z'));
  assert.ok(saved.periods.every(p => p.creators.every(c => c.viewCount === null) && p.coverage.performanceComplete === false));
  api.campaignPerformance = async () => ({ data: [{ id: 'old_assignment', creatorId: 'old_creator', campaign: { id: 'orgcamp_old' }, totalViews: 9000000 }], totals: {} });
  saved = null;
  await assert.rejects(run(), /sync failed/i);
  assert.equal(saved, null);
});

test('campaign polling uses only verified campaign videos and distinct campaign event identities', async () => {
  const { api } = campaignFixture();
  const v = { ...video, orgAccountId: 'account_1', platformAccountId: 'native_1', viewCount: 9000000, viewCountInPeriod: 12000 };
  api.campaignVideos = async () => [v];
  let saved;
  const run = sync.createCampaignSynchronizer({ campaignId, api, inventory: async () => ({ campaign: { id: campaignId }, periods: [{ key: 'all', videos: [{ ...sync.normalizeVideo(v), viewCount: 9000 }] }] }), persist: async value => { saved = value; }, failure: async () => {}, milestones: [10000] });
  await run(new Date('2026-11-03T09:00:00Z'));
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].campaignId, campaignId);
  assert.ok(saved.events[0].id.startsWith(`poll_campaign_${campaignId}_`));
  assert.equal(saved.events[0].data.account.id, 'account_1');
  assert.equal(saved.events[0].data.viewCount, 12000);
  assert.equal(saved.periods[0].videos[0].viewCount, 12000);
});

test('campaign videos with nullable organization account ids resolve only through unique roster platform identity', async () => {
  const { api } = campaignFixture();
  api.campaignVideos = async () => [{ ...video, orgAccountId: null, platformAccountId: 'native_1', viewCountInPeriod: 0 }];
  let saved;
  const run = sync.createCampaignSynchronizer({ campaignId, api, inventory: async () => null, persist: async value => { saved = value; }, failure: async () => {} });
  await run(new Date('2026-11-03T09:00:00Z'));
  assert.equal(saved.periods[0].videos[0].accountId, 'account_1');
  api.campaignVideos = async () => [{ ...video, orgAccountId: null, platformAccountId: 'unknown_account', viewCountInPeriod: 0 }];
  await run(new Date('2026-11-03T10:00:00Z'));
  assert.deepEqual(saved.periods[0].videos, []);
  assert.equal(saved.periods[0].coverage.unverifiedVideos, 1);
  assert.equal(saved.periods[0].totals.viewCount, 0);
});

test('empty campaign performance may prove four zero rows only with explicit empty source totals and KPIs', async () => {
  const { api } = campaignFixture();
  const performance = await api.campaignPerformance();
  api.campaignPerformance = async () => ({ ...performance, data: [] });
  let saved;
  const run = sync.createCampaignSynchronizer({ campaignId, api, inventory: async () => null, persist: async value => { saved = value; }, failure: async () => {} });
  await run(new Date('2026-11-03T09:00:00Z'));
  assert.ok(saved.periods.every(period => period.creators.length === 4 && period.creators.every(creator => creator.viewCount === 0) && period.coverage.performanceComplete));
  assert.ok(saved.creators.flatMap(creator => creator.accounts).every(account => account.followerCount === null));
});

test('AI organization refresh explicitly bypasses campaign scope and emits no organization alerts', async t => {
  const { config } = await import('../src/config.js');
  const configuredCampaign = config.campaignId;
  config.campaignId = campaignId;
  t.after(() => { config.campaignId = configuredCampaign; });
  const sourceVideo = { ...video, viewCount: 9000000 };
  const previousVideo = { ...sync.normalizeVideo(sourceVideo), viewCount: 9000 };
  const periodRequests = [];
  let saved;
  const run = sync.createSynchronizer({
    campaignId: null, milestones: [],
    api: {
      accounts: async () => [{ ...account, totalViews: 9000000 }], videos: async () => [sourceVideo],
      periodAccounts: async (ids, range) => { periodRequests.push({ ids, range }); return [{ id: account.id, viewCountInPeriod: 60000 }]; },
      periodVideos: async () => [{ ...sourceVideo, viewCountInPeriod: 60000 }],
      campaign: async () => assert.fail('organization AI refresh must not request campaign metrics'),
    },
    inventory: async () => ({ accounts: [sync.normalizeAccount(account)], videos: [previousVideo] }),
    persist: async value => { saved = value; },
    campaignInventory: async () => assert.fail('organization AI refresh must not read campaign storage'),
    persistCampaign: async () => assert.fail('organization AI refresh must not write campaign storage'),
    failure: async () => {},
  });
  const result = await run(new Date('2026-11-03T09:00:00Z'));
  assert.equal(saved.accounts[0].viewCount, 9000000);
  assert.equal(saved.videos[0].viewCount, 9000000);
  assert.ok(periodRequests.length > 0 && periodRequests.every(request => request.ids.includes(account.id)));
  assert.ok(saved.periods.every(period => period.accounts[0].viewCountInPeriod === 60000 && period.videoCoverage === 'top100'));
  assert.deepEqual(saved.events, []);
  assert.equal(result.events, 0);
  assert.equal(result.campaignId, undefined);
});
