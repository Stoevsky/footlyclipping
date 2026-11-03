import test from 'node:test';
import assert from 'node:assert/strict';
import * as subject from '../src/config.js';
const valid = {DISCORD_BOT_TOKEN:'test-token', DISCORD_CLIENT_ID:'123456789012345678', DISCORD_GUILD_ID:'123456789012345679', VIRAL_API_KEY:'test-api', DATABASE_URL:'postgres://localhost/footly', CHANNEL_VIRAL_ALERTS:'123456789012345680',CHANNEL_LEADERBOARD:'123456789012345681',CHANNEL_DAILY_ANALYTICS:'123456789012345682',CHANNEL_CREATOR_GROWTH:'123456789012345683',CHANNEL_FOOTLY_AI:'123456789012345684'};
test('config is testable and webhook/AI credentials are optional with polling fallback',()=>{assert.equal(typeof subject.loadConfig,'function'); const c=subject.loadConfig(valid); assert.doesNotThrow(()=>subject.validateConfig(c)); assert.equal(c.channels.weekly,c.channels.daily); assert.equal(c.minViews,10000);});
test('config reports names without leaking secret values',()=>{assert.equal(typeof subject.configIssues,'function'); const c=subject.loadConfig({...valid,DATABASE_URL:'secret-not-a-url',PORT:'-1'}); const issues=subject.configIssues(c); assert(issues.includes('DATABASE_URL'));assert(issues.includes('PORT')); assert(!JSON.stringify(issues).includes('secret-not-a-url'));});
test('invalid IDs timezone cron and interval are rejected',()=>{assert.equal(typeof subject.loadConfig,'function'); const c=subject.loadConfig({...valid,DISCORD_CLIENT_ID:'wrong',REPORT_TIMEZONE:'bad/time',DAILY_REPORT_CRON:'invalid',SYNC_INTERVAL_MINUTES:'0'}); assert.deepEqual(subject.configIssues(c).sort(),['DAILY_REPORT_CRON','DISCORD_CLIENT_ID','REPORT_TIMEZONE','SYNC_INTERVAL_MINUTES'].sort());});
test('milestones must be unique positive ordered safe integers',()=>{assert.equal(typeof subject.loadConfig,'function'); assert.deepEqual(subject.loadConfig({...valid,VIRAL_MILESTONES:'100000,10000,10000'}).milestones,[10000,100000]); assert(subject.configIssues(subject.loadConfig({...valid,VIRAL_MILESTONES:'-1,x'})).includes('VIRAL_MILESTONES'));});
test('daily and weekly report schedules require one deterministic local time',()=>{const c=subject.loadConfig({...valid,DAILY_REPORT_CRON:'*/5 * * * *',WEEKLY_REPORT_CRON:'0 9 * * 2'});assert(subject.configIssues(c).includes('DAILY_REPORT_CRON'));assert(subject.configIssues(c).includes('WEEKLY_REPORT_CRON'));});
test('campaign scope is pinned to a validated Viral campaign ID',()=>{
  const c=subject.loadConfig({...valid,VIRAL_CAMPAIGN_ID:' orgcamp_UrJnb4ms3ZR8 '});
  assert.equal(c.campaignId,'orgcamp_UrJnb4ms3ZR8');
  assert.deepEqual(subject.configIssues(c),[]);
  assert.equal(subject.loadConfig(valid).campaignId,null);
  assert(subject.configIssues(subject.loadConfig({...valid,VIRAL_CAMPAIGN_ID:'../other'})).includes('VIRAL_CAMPAIGN_ID'));
});
