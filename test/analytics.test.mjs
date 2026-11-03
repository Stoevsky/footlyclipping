import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as utils from '../src/utils.js';

test('reporting calendar week and month use Skopje date, not rolling days', () => {
  assert.equal(typeof utils.reportingPeriod, 'function');
  const now = new Date('2026-11-02T23:30:00Z');
  const week = utils.reportingPeriod('week', 'Europe/Skopje', now);
  assert.equal(week.from, '2026-11-02');
  assert.equal(week.to, '2026-11-03');
  assert.equal(week.start.toISOString(), '2026-11-01T23:00:00.000Z');
  const month = utils.reportingPeriod('month', 'Europe/Skopje', now);
  assert.equal(month.from, '2026-11-01');
  assert.equal(month.to, '2026-11-03');
  assert.equal(utils.reportingPeriod('previous_week', 'Europe/Skopje', now).to, '2026-11-01');
});

test('yesterday covers 23 and 25 hour daylight saving days', () => {
  assert.equal(typeof utils.reportingPeriod, 'function');
  const spring = utils.reportingPeriod('yesterday', 'Europe/Skopje', new Date('2026-03-30T10:00:00Z'));
  const autumn = utils.reportingPeriod('yesterday', 'Europe/Skopje', new Date('2026-10-26T10:00:00Z'));
  assert.equal((spring.end - spring.start) / 3600000, 23);
  assert.equal((autumn.end - autumn.start) / 3600000, 25);
});

test('injected clock makes rolling API dates deterministic', () => {
  assert.deepEqual(utils.datesFor(30, 'Europe/Skopje', 0, new Date('2026-03-01T12:00:00Z')), {from:'2026-01-31',to:'2026-03-01'});
});

async function calculate(input) {
  const module = await import('../src/analytics.js').catch(() => ({}));
  assert.equal(typeof module.calculateAnalytics, 'function');
  return module.calculateAnalytics(input);
}

const now = new Date('2026-11-03T12:00:00Z');
const fixture = {
  now, period:'week', timezone:'Europe/Skopje', syncedAt:now.toISOString(), inventoryCoverage:{complete:true},
  accounts:[{id:'a',username:'alpha',platform:'tiktok',followerCount:100},{id:'b',username:'beta',platform:'instagram',followerCount:null}],
  videos:[
    {id:'v1',accountId:'a',viewCount:1000,likeCount:100,commentCount:20,shareCount:null,publishedAt:'2026-11-02T08:00:00Z'},
    {id:'v2',accountId:'a',viewCount:9000,likeCount:90,commentCount:10,publishedAt:'2026-10-01T00:00:00Z'},
    {id:'v3',accountId:'b',viewCount:null,likeCount:null,commentCount:null,publishedAt:'2026-11-02T08:00:00Z'},
  ],
};

test('analytics preserves unknown totals and computes weighted comparable engagement', async () => {
  const data = await calculate(fixture);
  assert.equal(data.accounts[0].viewCount,10000);
  assert.equal(data.accounts[0].averageViews,5000);
  assert.equal(data.accounts[0].engagementRate,0.022);
  assert.equal(data.accounts[0].viewCountInPeriod,null);
  assert.equal(data.accounts[1].viewCount,null);
  assert.equal(data.totals.views,null);
  assert.equal(data.totals.knownViews,10000);
  assert.equal(data.totals.posts,2);
  assert.equal(data.coverage.periodComplete,false);
});

test('official period counts match all entity ids and expose UTC aggregation limits', async () => {
  const data = await calculate({...fixture,periodCoverage:{accountCoverage:'complete',videoCoverage:'complete',metricsTimezone:'UTC'},periodMetrics:[
    {entity_type:'account',entity_id:'a',payload:{viewCountInPeriod:200}},
    {entity_type:'account',entity_id:'b',payload:{viewCountInPeriod:30}},
    {entity_type:'video',entity_id:'v1',payload:{viewCountInPeriod:200}},
  ]});
  assert.equal(data.totals.viewsGained,230);
  assert.equal(data.accounts[0].viewCountInPeriod,200);
  assert.equal(data.videos[0].viewCountInPeriod,200);
  assert.ok(data.coverage.notes.some(note => note.includes('UTC')));
  assert.equal(data.coverage.periodComplete,false);
});

test('observed history cannot invent missing baseline gains or negative resets', async () => {
  const data = await calculate({...fixture,videoSnapshots:[
    {video_id:'v1',observed_at:'2026-11-02T02:00:00Z',payload:{viewCount:100,likeCount:10,commentCount:1}},
    {video_id:'v1',observed_at:'2026-11-03T10:00:00Z',payload:{viewCount:140,likeCount:15,commentCount:2}},
    {video_id:'v2',observed_at:'2026-11-02T02:00:00Z',payload:{viewCount:100}},
    {video_id:'v2',observed_at:'2026-11-03T10:00:00Z',payload:{viewCount:90}},
  ]});
  assert.equal(data.videos[0].viewCountInPeriod,40);
  assert.equal(data.videos[1].viewCountInPeriod,null);
  assert.equal(data.accounts[0].viewCountInPeriod,null);
  assert.ok(data.coverage.notes.some(note => note.includes('snapshot')));
});

test('UTC API gains are never summed with partial local snapshot gains', async () => {
  const data = await calculate({...fixture,periodMetrics:[{entity_type:'account',entity_id:'a',payload:{viewCountInPeriod:200}}],
    creatorSnapshots:[
      {creator_id:'b',observed_at:'2026-11-02T02:00:00Z',payload:{viewCount:100}},
      {creator_id:'b',observed_at:'2026-11-03T10:00:00Z',payload:{viewCount:140}},
    ]});
  assert.equal(data.accounts[1].viewCountInPeriod,null);
  assert.equal(data.totals.viewsGained,null);
  assert.equal(data.totals.knownViewsGained,200);
});

test('before first sync all summary metrics remain unknown', async () => {
  const data = await calculate({now});
  assert.equal(data.totals.views,null);
  assert.equal(data.totals.viewsGained,null);
  assert.equal(data.totals.posts,null);
});

test('official period engagement uses counts with the same weighted formula', async () => {
  const data = await calculate({...fixture,periodMetrics:[
    {entity_type:'account',entity_id:'a',payload:{viewCountInPeriod:200,likeCountInPeriod:20,commentCountInPeriod:5}},
    {entity_type:'video',entity_id:'v1',payload:{viewCountInPeriod:100,likeCountInPeriod:10,commentCountInPeriod:2}},
  ]});
  assert.equal(data.accounts[0].engagementRateInPeriod,0.125);
  assert.equal(data.videos[0].engagementRateInPeriod,0.12);
  assert.equal(data.accounts[1].engagementRateInPeriod,null);
});

test('lifetime reports have no missing period history warning', async () => {
  const data = await calculate({...fixture,period:'all'});
  assert.equal(data.coverage.notes.some(note => note.includes('istorija')),false);
  assert.equal(data.coverage.notes.some(note => note.includes('snapshot')),false);
});

test('partial video inventory does not fabricate creator video count or average', async () => {
  const data = await calculate({...fixture,inventoryCoverage:{complete:false}});
  assert.equal(data.accounts[0].videoCount,null);
  assert.equal(data.accounts[0].averageViews,null);
});

test('an empty loaded video list is not a zero historical gain for an unknown account', async () => {
  const data = await calculate({...fixture,accounts:[{id:'new',viewCount:null,videoCount:null}],videos:[]});
  assert.equal(data.accounts[0].viewCountInPeriod,null);
  assert.equal(data.accounts[0].viewCount,null);
});

test('reports deduplicate provider and poll milestones and use source observation day', async () => {
  const base={type:'video.views_milestone',timestamp:'2026-11-03T10:00:00Z',receivedAt:'2026-11-03T11:00:00Z',data:{video:{platform:'tiktok',platformVideoId:'123'},milestone:10000,observedAt:'2026-11-03T09:00:00Z'}};
  const data=await calculate({...fixture,period:'today',milestones:[
    {...base,id:'poll_one'}, {...base,id:'provider_one'},
    {...base,id:'delayed',data:{...base.data,milestone:50000,observedAt:'2026-11-02T20:00:00Z'}},
  ]});
  assert.equal(data.milestones.length,1);
  assert.equal(data.milestones[0].data.milestone,10000);
});

test('scheduled reporting can inspect source period availability and refresh time', async () => {
  const data=await calculate({...fixture,periodAvailable:true,periodObservedAt:'2026-11-03T12:00:00Z'});
  assert.equal(data.coverage.periodAvailable,true);
  assert.equal(data.coverage.periodObservedAt,'2026-11-03T12:00:00Z');
});

test('fresh fetches do not conceal stale or unknown provider observation timestamps', async () => {
  const data=await calculate({...fixture,accounts:[{...fixture.accounts[0],loadAt:'2026-11-01T10:00:00Z'}],videos:[fixture.videos[0]]});
  assert.equal(data.videos[0].analyticsUpdatedAt,null);
  assert.equal(data.coverage.unknownSourceTimestamps,1);
  assert.equal(data.coverage.staleSourceEntities,1);
  assert.equal(data.coverage.sourceOldestUpdatedAt,'2026-11-01T10:00:00.000Z');
  assert.ok(data.coverage.notes.some(note=>note.includes('24 chasa')));
});
