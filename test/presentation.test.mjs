import test from 'node:test';
import assert from 'node:assert/strict';
import {rankingEmbed,reportEmbeds,videosEmbed,creatorEmbed,statisticsEmbed,viralEmbed} from '../src/presentation.js';

const inactive={scope:{type:'campaign',id:'current',name:'Tekovna kampanja'},
  period:{key:'week',from:'2026-11-02',to:'2026-11-03',timezone:'Europe/Skopje'},syncedAt:'2026-11-03T10:00:00Z',
  accounts:Array.from({length:5},(_,i)=>({id:String(i),username:`creator${i+1}`,displayName:`Creator ${i+1}`,viewCount:0,viewCountInPeriod:0,videoCount:0,videoCountInPeriod:0,
    connectedAccounts:i===0?[{username:'creator1'},{username:'secondhandle'}]:[]})),videos:[],milestones:[],totals:{views:0,viewsGained:0,posts:0,videos:0},
  coverage:{notes:['Opfat: samo tekovnata kampanja.','Kampanjata se ushte nema podobni videa. Potvrdenite metrics se 0.','Del od kampanjskite metrics ne se dostapni; nepoznatite vrednosti ne se nula.','Pregledite od Viral.app se po UTC denovi; rasporedot e Europe/Skopje.']}};

test('inactive campaign leaderboard preserves the full roster and connected handles without repeated zero metrics',()=>{
  const embed=rankingEmbed(inactive.accounts,inactive.accounts.length,'nedela',{snapshot:inactive}).toJSON();
  const text=JSON.stringify(embed);
  for(const row of inactive.accounts) assert.ok(text.includes(row.username));
  assert.match(text,/Creator 1/);
  assert.match(text,/secondhandle/);
  assert.match(text,/prvite objavi/);
  assert.match(text,/izramneti/);
  assert.doesNotMatch(text,/Viral\.app|\b0 (?:pregledi|objavi)|na 0|metrics se 0|Nema podatoci|nepoznatite/);
});

test('inactive campaign summary is one concise participant message without empty metric panels',()=>{
  const embeds=reportEmbeds(inactive,'campaign').map(embed=>embed.toJSON());
  assert.equal(embeds.length,1);
  const text=JSON.stringify(embeds);
  for(const row of inactive.accounts) assert.ok(text.includes(row.username));
  assert.match(text,/prvite objavi/);
  assert.doesNotMatch(text,/Viral\.app|\b0 (?:pregledi|objavi)|Nema podatoci|Milestones|Engagement|Sledeni videa|Novi pregledi|nepoznatite/);
});

test('presentation keeps useful metrics and timezone coverage without naming the provider',()=>{
  const active={...inactive,accounts:[{...inactive.accounts[0],viewCount:10000,viewCountInPeriod:2000,videoCount:2,videoCountInPeriod:1}],
    videos:[{id:'v',username:'creator1',viewCount:10000,viewCountInPeriod:2000}],totals:{views:10000,viewsGained:2000,posts:1,videos:2},
    coverage:{notes:['Pregledite od Viral.app se po UTC denovi; rasporedot e Europe/Skopje.']}};
  const embeds=[rankingEmbed(active.accounts,1,'nedela',{snapshot:active}),...reportEmbeds(active),videosEmbed(active),creatorEmbed(active.accounts[0],active),statisticsEmbed(active),
    viralEmbed({data:{account:active.accounts[0],video:active.videos[0],milestone:10000,viewCount:12000}})];
  const text=JSON.stringify(embeds.map(embed=>embed.toJSON()));
  assert.doesNotMatch(text,/Viral\.app/i);
  assert.match(text,/UTC denovi/);
  assert.match(text,/2,000/);
});
