import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import * as db from '../src/db.js';
import { getAnalytics } from '../src/analytics.js';
import { createSynchronizer } from '../src/sync.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('database persistence contract exists', () => {
  assert.equal(typeof db.saveSync, 'function');
  assert.equal(typeof db.getInventory, 'function');
});

test('checked-out PostgreSQL connection failure does not crash the service', {skip:!process.env.TEST_DATABASE_URL}, async () => {
  const script=`
    import {pool} from './src/db.js';
    const client=await pool.connect();
    const {rows}=await client.query('SELECT pg_backend_pid() AS pid');
    await pool.query('SELECT pg_terminate_backend($1)',[rows[0].pid]);
    await new Promise(resolve=>setTimeout(resolve,100));
    client.release(true);
    await pool.query('SELECT 1');
    await pool.end();
    console.log('RECOVERED');
  `;
  const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,DATABASE_SSL:'false'},timeout:10000,
  });
  assert.match(result.stdout,/RECOVERED/);
  assert.match(result.stderr,/database/);
});

test('real PostgreSQL migrations preserve old data, repeat, and sync atomically', {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const database = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    await database.query('CREATE TABLE bot_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await database.query("INSERT INTO bot_state(key,value) VALUES('leaderboard_message','existing123')");
    await db.setupDatabase(database);
    await db.setupDatabase(database);
    assert.equal((await database.query('SELECT value FROM bot_state')).rows[0].value, 'existing123');
    assert.equal((await database.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '3');
    const input = {
      accounts:[{id:'a1',username:'real_creator',platform:'tiktok',followerCount:null}],
      videos:[{id:'tiktok:v1',accountId:'a1',viewCount:100,likeCount:10,commentCount:2,shareCount:null}],
      syncedAt:new Date('2026-11-03T12:00:00Z'),
      periods:[{from:'2026-11-02',to:'2026-11-03',accounts:[{id:'a1',viewCountInPeriod:40}],videos:[],accountCoverage:'complete',videoCoverage:'top100'}],
      events:[{id:'event_1',type:'video.views_milestone',data:{milestone:10000}}],
    };
    await db.saveSync(input, database);
    await db.saveSync(input, database);
    const inventory = await db.getInventory(database);
    assert.equal(inventory.accounts.length, 1);
    assert.equal(inventory.videos[0].shareCount, null);
    assert.equal((await database.query('SELECT count(*) FROM viral_events')).rows[0].count, '1');
    assert.equal((await database.query('SELECT count(*) FROM video_metrics')).rows[0].count, '1');
    const analytics = await getAnalytics({period:'week',now:input.syncedAt,timezone:'Europe/Skopje',database});
    assert.equal(analytics.accounts[0].viewCountInPeriod,40);
    assert.equal(analytics.videos[0].viewCount,100);
    assert.equal(analytics.syncedAt,input.syncedAt.toISOString());
    assert.equal(analytics.coverage.periodAvailable,true);
    assert.equal(analytics.coverage.periodObservedAt,input.syncedAt.toISOString());
    await assert.rejects(db.saveSync({...input,accounts:[{id:'new'}],videos:[{}]}, database));
    assert.equal((await db.getInventory(database)).accounts[0].id, 'a1');
    await assert.rejects(db.saveSync({...input,accounts:[{id:'new'}],periods:[{from:'invalid-date',to:'2026-11-03'}]}, database));
    assert.equal((await db.getInventory(database)).accounts[0].id, 'a1');
    await database.query("UPDATE viral_events SET status='processing', received_at=now()-interval '1 day',processing_at=now() WHERE id='event_1'");
    await db.setupDatabase(database);
    assert.equal((await database.query("SELECT status FROM viral_events WHERE id='event_1'")).rows[0].status,'processing');
    await database.query("UPDATE viral_events SET processing_at=now()-interval '6 minutes' WHERE id='event_1'");
    await db.setupDatabase(database);
    assert.equal((await database.query("SELECT status FROM viral_events WHERE id='event_1'")).rows[0].status,'pending');
    await db.saveSync({...input,accounts:[],videos:[],events:[],syncedAt:new Date('2026-11-03T13:00:00Z')}, database);
    assert.equal((await db.getInventory(database)).accounts.length, 0);
    assert.equal((await database.query('SELECT count(*) FROM creators')).rows[0].count, '1');
    assert.equal((await database.query('SELECT count(*) FROM video_metrics')).rows[0].count, '1');
    const rawAccount = {id:'org_1',platform:'tiktok',platformAccountId:'platform_1',username:'creator',totalViews:15000,totalLikes:1000,totalComments:500,totalVideosTracked:1,totalVideosRetained:0};
    const rawVideo = {id:'source_1',platform:'tiktok',platformVideoId:'1234567890123456789',orgAccountId:'org_1',accountUsername:'creator',viewCount:15000,likeCount:1000,commentCount:500,publishedAt:'2026-11-02T08:00:00Z'};
    const run = createSynchronizer({
      api:{accounts:async()=>[rawAccount],videos:async()=>[rawVideo],periodAccounts:async()=>[{id:'org_1',viewCountInPeriod:1000,likeCountInPeriod:100,commentCountInPeriod:10}],periodVideos:async()=>[{...rawVideo,viewCountInPeriod:1000,likeCountInPeriod:100,commentCountInPeriod:10}]},
      inventory:()=>db.getInventory(database),persist:value=>db.saveSync(value,database),failure:code=>db.recordSyncFailure(code,database),timezone:'Europe/Skopje',milestones:[10000],
    });
    await run(input.syncedAt);
    const report = await getAnalytics({period:'week',now:input.syncedAt,timezone:'Europe/Skopje',database});
    assert.equal(report.accounts[0].engagementRateInPeriod,0.11);
    assert.equal(report.videos[0].id,'tiktok:1234567890123456789');
    assert.equal(report.videos[0].viewCountInPeriod,1000);
    assert.equal(report.coverage.metricsTimezone,'UTC');
    assert.ok(report.coverage.notes.some(note => note.includes('UTC')));
    assert.equal(report.totals.posts,1);
    const milestone={type:'video.views_milestone',timestamp:'2026-11-02T20:00:00Z',data:{video:{platform:'tiktok',platformVideoId:'1234567890123456789'},milestone:10000,observedAt:'2026-11-02T20:00:00Z'}};
    await db.enqueueEvent({...milestone,id:'late_provider'},database);
    await db.enqueueEvent({...milestone,id:'late_poll'},database);
    await db.enqueueEvent({...milestone,id:'campaign_only',scope:{type:'campaign',id:'orgcamp_test'},data:{...milestone.data,milestone:50000}},database);
    const yesterday = await getAnalytics({period:'yesterday',now:input.syncedAt,timezone:'Europe/Skopje',database});
    assert.equal(yesterday.milestones.length,1);
    assert.equal(yesterday.milestones[0].data.milestone,10000);
  } finally {
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test('campaign persistence is isolated from organization data and fails closed on absent scope', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  assert.equal(typeof db.persistCampaignSnapshot,'function');
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const database=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    await db.setupDatabase(database);
    await db.saveSync({accounts:[{id:'old',viewCount:9000000}],videos:[],syncedAt:'2026-11-03T16:00:00Z'},database);
    const before=await getAnalytics({period:'all',campaignId:'orgcamp_test',database});
    assert.equal(before.accounts.length,0);
    assert.equal(before.syncedAt,null);
    const zero={viewCount:0,videoCount:0,eligibleVideoCount:0};
    const creators=[1,2,3,4].map(index=>({id:`creator${index}`,username:`new${index}`,accounts:[]}));
    const snapshot={campaign:{id:'orgcamp_test',name:'New'},creators,syncedAt:'2026-11-03T17:00:00Z',periods:[{key:'all',from:'1970-01-01',to:'2026-11-03',creators:creators.map(c=>({id:c.id,...zero})),videos:[],totals:zero,coverage:{performanceComplete:true},timeZone:'UTC'}]};
    await db.persistCampaignSnapshot(snapshot,database);
    await db.persistCampaignSnapshot(snapshot,database);
    assert.equal((await db.getInventory(database)).accounts[0].viewCount,9000000);
    assert.equal((await db.getCampaignSnapshot('orgcamp_test',database)).creators.length,4);
    assert.equal(db.getCachedCampaignSnapshot('orgcamp_test').creators.length,4);
    const current=await getAnalytics({period:'all',campaignId:'orgcamp_test',database,now:new Date(snapshot.syncedAt)});
    assert.equal(current.accounts.length,4);
    assert.equal(current.totals.views,0);
    assert.equal((await database.query("SELECT count(*) FROM campaign_analytics_snapshots")).rows[0].count,'1');
    assert.equal((await database.query("SELECT scope_key FROM synchronization_history ORDER BY id DESC LIMIT 1")).rows[0].scope_key,'campaign:orgcamp_test');
    await assert.rejects(db.persistCampaignSnapshot({...snapshot,creators:[creators[0],creators[0]]},database));
    assert.equal((await db.getCampaignSnapshot('orgcamp_test',database)).creators.length,4);
  }finally{
    await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
