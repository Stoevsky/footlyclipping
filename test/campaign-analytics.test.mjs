import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as analytics from '../src/analytics.js';
import {reportingPeriod} from '../src/utils.js';

const now=new Date('2026-11-03T17:00:00Z');
const campaign={id:'orgcamp_test',name:'Current campaign',validFrom:'2026-11-03T00:00:00Z',timeZone:'UTC'};
const creators=['one','two','three','four'].map((name,index)=>({id:`creator_${index}`,name,username:name,accounts:[]}));
const zero={viewCount:0,videoCount:0,eligibleVideoCount:0,likeCount:0,commentCount:0,shareCount:0,bookmarkCount:0};
const periods=['all','today','yesterday','week','month','previous_week','last30'].map(key=>({
  key,...reportingPeriod(key,'Europe/Skopje',now),scope:key==='all'?'allTime':'dateRange',
  creators:creators.map(creator=>({id:creator.id,...zero})),videos:[],totals:zero,
  coverage:{performanceComplete:true,videoCoverage:'top300'},timeZone:'UTC',
}));
const snapshot={campaign,creators,periods,syncedAt:now.toISOString()};
function calculate(value=snapshot,period='week') {
  assert.equal(typeof analytics.calculateCampaignAnalytics,'function');
  return analytics.calculateCampaignAnalytics(value,{campaignId:campaign.id,period,now,timezone:'Europe/Skopje'});
}

test('campaign analytics includes all four zero creators without organization history',()=>{
  const data=calculate();
  assert.deepEqual(data.scope,{type:'campaign',id:campaign.id,name:campaign.name,key:`campaign:${campaign.id}`});
  assert.equal(data.accounts.length,4);
  assert.ok(data.accounts.every(row=>row.viewCount===0&&row.viewCountInPeriod===0&&row.videoCount===0));
  assert.equal(data.totals.views,0);
  assert.equal(data.totals.viewsGained,0);
  assert.equal(data.totals.posts,0);
  assert.equal(data.accounts[0].followerCount,null);
  assert.equal(data.accounts[0].engagementRate,null);
});

test('missing creator metrics remain unknown even when other roster rows are zero',()=>{
  const data=calculate({...snapshot,periods:periods.map(period=>({...period,creators:period.creators.slice(1),coverage:{...period.coverage,performanceComplete:false}}))});
  assert.equal(data.accounts.length,4);
  assert.equal(data.accounts[0].viewCount,null);
  assert.equal(data.accounts[0].viewCountInPeriod,null);
  assert.equal(data.coverage.periodComplete,false);
});

test('campaign reads fail closed for missing snapshot or wrong campaign',()=>{
  const missing=calculate(null);
  assert.equal(missing.syncedAt,null);
  assert.equal(missing.totals.views,null);
  assert.equal(missing.accounts.length,0);
  const wrong=calculate({...snapshot,campaign:{...campaign,id:'orgcamp_old'}});
  assert.equal(wrong.accounts.length,0);
  assert.equal(wrong.coverage.periodAvailable,false);
});

test('stale period dates cannot pass report readiness or leak another date totals',()=>{
  const data=calculate({...snapshot,periods:periods.map(period=>({...period,from:'2026-10-01',to:'2026-10-02'}))});
  assert.equal(data.accounts.length,4);
  assert.equal(data.accounts[0].viewCountInPeriod,null);
  assert.equal(data.coverage.periodAvailable,false);
});

test('campaign video lifetime display uses campaign gains rather than old platform totals',()=>{
  const video={id:'tiktok:123',platform:'tiktok',platformVideoId:'123',viewCount:9000000,likeCount:800000,commentCount:70000,viewCountInPeriod:20,likeCountInPeriod:2,commentCountInPeriod:1};
  const data=calculate({...snapshot,periods:periods.map(period=>({...period,videos:[video]}))});
  assert.equal(data.videos[0].viewCount,20);
  assert.equal(data.videos[0].likeCount,2);
  assert.equal(data.videos[0].engagementRate,0.15);
});

test('campaign creator aliases include exact roster and connected-account identities',()=>{
  const data=calculate({...snapshot,creators:[{...creators[0],accounts:[{username:'known_handle',displayName:'Known Name'}]},...creators.slice(1)]});
  assert.ok(data.accounts[0].aliases.includes('known_handle'));
  assert.ok(data.accounts[0].aliases.includes('Known Name'));
  assert.ok(data.accounts[0].aliases.includes('one'));
});

test('all-time campaign dates begin at the campaign source range, not 1970',()=>{
  const data=calculate({...snapshot,periods:periods.map(period=>period.key==='all'?{...period,from:'2026-11-03'}:period)},'all');
  assert.equal(data.period.from,'2026-11-03');
});

test('reports cannot claim performance before the campaign or all current creators joined',()=>{
  const yesterday=calculate(snapshot,'yesterday');
  assert.equal(yesterday.coverage.periodAvailable,false);
  assert.equal(yesterday.accounts[0].viewCountInPeriod,null);
  const joinedToday={...snapshot,campaign:{...campaign,validFrom:'2026-11-01T00:00:00Z'},creators:creators.map(creator=>({...creator,assignmentValidFrom:'2026-11-03T08:00:00Z'}))};
  const prior=calculate(joinedToday,'yesterday');
  assert.equal(prior.coverage.periodAvailable,false);
  assert.equal(prior.totals.viewsGained,null);
  assert.equal(prior.accounts.length,4);
  assert.equal(prior.accounts[0].viewCount,0);
  assert.equal(calculate(joinedToday,'today').coverage.periodAvailable,true);
});

test('campaign provider eligibility freshness is separate from latest fetch',()=>{
  const data=calculate({...snapshot,periods:periods.map(period=>({...period,coverage:{...period.coverage,eligibilityRefreshedAt:'2026-11-01T00:00:00Z'}}))});
  assert.equal(data.coverage.sourceUpdatedAt,'2026-11-01T00:00:00Z');
  assert.ok(data.coverage.notes.some(note=>note.includes('24 chasa')));
});
