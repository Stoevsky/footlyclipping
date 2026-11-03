import test from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../src/presentation.js';
import * as ai from '../src/ai.js';
import * as botModule from '../src/bot.js';

const snapshot = {
  period: {key:'week',from:'2026-11-02',to:'2026-11-03',timezone:'Europe/Skopje'},
  syncedAt:'2026-11-03T08:00:00Z',
  coverage:{inventoryComplete:true,periodComplete:false,notes:['Pregledite od Viral.app se po UTC denovi; rasporedot e Europe/Skopje.']},
  accounts:[{id:'1',username:'creator',platform:'tiktok',viewCount:100000,viewCountInPeriod:3000,followerCount:2000,videoCount:5,videoCountInPeriod:2,engagementRate:.05,engagementRateInPeriod:.1,followerGrowth:10,averageViewsPerVideo:20000},
    {id:'2',username:'unknown',platform:'instagram',viewCount:null,viewCountInPeriod:null,followerCount:null,videoCountInPeriod:null}],
  videos:[{id:'v',accountUsername:'creator',platform:'tiktok',url:'https://tiktok.com/@creator/video/1',viewCount:100000,viewCountInPeriod:3000,likeCount:4000,commentCount:1000,shareCount:null}],
  totals:{views:null,viewsGained:null,posts:2,accounts:2,videos:1,followers:null},milestones:[],
};

test('requested slash commands are registered and command definitions contain Latin text',()=>{
  const commands = botModule.commands.map(command=>command.toJSON());
  for (const name of ['leaderboard','topvideos','kreator','statistika','osvezi','prasaj','top']) assert.ok(commands.some(command=>command.name===name),name);
  assert.doesNotMatch(JSON.stringify(commands),/[\u0400-\u04ff]/u);
});

test('reports expose coverage and unknown totals, top videos and recommendations',()=>{
  assert.equal(typeof presentation.reportEmbeds,'function');
  const daily = presentation.reportEmbeds(snapshot,'daily').map(embed=>embed.toJSON());
  const weekly = presentation.reportEmbeds(snapshot,'weekly').map(embed=>embed.toJSON());
  for(const embeds of [daily,weekly]) {
    const text = JSON.stringify(embeds);
    assert.match(text,/UTC denovi/);
    assert.match(text,/Nema podatoci/);
    assert.match(text,/creator/);
    assert.match(text,/Preporak/);
    assert.ok(text.length<12000);
  }
});

test('all Discord strings transliterate Cyrillic and preserve missing values',()=>{
  assert.equal(typeof presentation.latinText,'function');
  assert.equal(presentation.latinText('Најдобар креатор Ѓорѓи'), 'Najdobar kreator Gjorgji');
  assert.equal(presentation.numberText(null),'Nema podatoci');
  const data = presentation.creatorEmbed(snapshot.accounts[1],snapshot).toJSON();
  assert.match(JSON.stringify(data),/Nema podatoci/);
});

test('AI chooses the requested period and deterministic facts survive provider downtime',async()=>{
  assert.equal(typeof ai.questionPeriod,'function');
  assert.equal(ai.questionPeriod('Koj ima najgolem rast vo poslednite 30 dena?'),'last30');
  assert.equal(ai.questionPeriod('Koi videa stanale viralni denes?'),'today');
  assert.equal(ai.questionPeriod('Koj ima najdobar engagement ovaa nedela?'),'week');
  let period;
  const answer = await ai.answerQuestion('Koj ima najmnogu pregledi ovaa nedela?',{
    getAnalytics:async options=>{period=options.period;return snapshot;},apiKey:'test',fetch:async()=>{throw new Error('secret should not appear');},
  });
  assert.equal(period,'week');
  assert.match(answer,/3,000/);
  assert.match(answer,/UTC denovi/);
  assert.doesNotMatch(answer,/secret should not appear/);
  assert.ok(answer.length<=1950);
});

test('AI cannot add fabricated numeric claims or exceed Discord content limits',async()=>{
  const answer=await ai.answerQuestion('Koj e najdobar?',{getAnalytics:async()=>snapshot,apiKey:'test',fetch:async()=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Ovoj kreator ima 999999999 pregledi.'}]}]})})});
  assert.match(answer,/3,000/);
  assert.doesNotMatch(answer,/999999999/);
  assert.ok(answer.length<=1950);
});

test('AI uses only approved recommendation IDs and rejects written invented statistics',async()=>{
  let request;
  const answer=await ai.answerQuestion('Koj e najdobar?',{getAnalytics:async()=>snapshot,apiKey:'test',fetch:async(_url,options)=>{
    request=options;
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Kreatorot ima milion pregledi.'}]}]})};
  }});
  assert.doesNotMatch(answer,/milion pregledi/);
  assert.equal(JSON.parse(request.body).store,false);
  assert.equal(request.redirect,'error');
  assert.equal(JSON.parse(request.body).text.format.type,'json_schema');
});

test('viral-today AI context uses milestone events and distinguishes videos',()=>{
  const result=ai.buildAIContext({...snapshot,videos:[...snapshot.videos,{id:'v2',accountUsername:'other',viewCountInPeriod:10000000}],milestones:[{data:{video:{id:'v',url:'https://tiktok.com/@creator/video/1'},account:{username:'creator',platform:'tiktok'},milestone:100000}}]},'Koi videa stanale viralni denes?');
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].username,'creator');
  assert.equal(result.rows[0].url,'https://tiktok.com/@creator/video/1');
  assert.equal(result.rows[0].value,100000);
});

test('weekly report with large data stays below combined Discord embed limit',()=>{
  const big={...snapshot,accounts:Array.from({length:10},(_,i)=>({...snapshot.accounts[0],id:String(i),username:'x'.repeat(45)})),
    videos:Array.from({length:10},(_,i)=>({...snapshot.videos[0],id:String(i),accountUsername:'x'.repeat(45),url:`https://example.com/${'x'.repeat(200)}${i}`})),
    coverage:{...snapshot.coverage,notes:['x'.repeat(1024)]}};
  const embeds=presentation.reportEmbeds(big,'weekly').map(embed=>embed.toJSON());
  const length=embeds.reduce((sum,embed)=>sum+(embed.title?.length||0)+(embed.description?.length||0)+(embed.footer?.text.length||0)+(embed.fields||[]).reduce((n,field)=>n+field.name.length+field.value.length,0),0);
  assert.ok(length<=5900,`${length} characters`);
});

test('reports wait for period data and retain durable keys across retries',async()=>{
  const deliveries=[];
  const available={...snapshot,period:{...snapshot.period,key:'yesterday',from:'2026-11-02',to:'2026-11-02',end:new Date('2026-11-02T23:00:00Z')},coverage:{...snapshot.coverage,periodAvailable:true,periodObservedAt:'2026-11-03T08:00:00Z'}};
  const options={now:new Date('2026-11-03T08:05:00Z'),configuration:{timezone:'Europe/Skopje',reportCron:'0 9 * * *',weeklyReportCron:'0 9 * * 1',channels:{daily:'channel'}},isReady:()=>true,database:{query:async()=>({rowCount:0})},deliverOnce:async key=>deliveries.push(key),getAnalytics:async()=>({...available,coverage:{...available.coverage,periodAvailable:false}})};
  assert.equal(await botModule.postDailyReport(options),false);
  options.getAnalytics=async()=>available;
  assert.equal(await botModule.postDailyReport(options),true);
  assert.equal(await botModule.postDailyReport(options),true);
  assert.deepEqual(deliveries,['report:daily:2026-11-02:2026-11-02','report:daily:2026-11-02:2026-11-02']);
  options.getAnalytics=async()=>({...available,coverage:{...available.coverage,periodObservedAt:null}});
  assert.equal(await botModule.postDailyReport(options),false);
});

test('admin commands recheck permissions and never expose raw errors',async()=>{
  assert.equal(typeof botModule.handleInteraction,'function');
  const replies=[];
  const interaction={isChatInputCommand:()=>true,guildId:'guild',commandName:'osvezi',memberPermissions:{has:()=>false},reply:async data=>replies.push(data)};
  await botModule.handleInteraction(interaction,{guildId:'guild'});
  assert.match(replies[0].content,/dozvola/);
  assert.equal(replies[0].ephemeral,true);
  const failed={isChatInputCommand:()=>true,guildId:'guild',commandName:'statistika',options:{getString:()=>null},deferReply:async()=>{failed.deferred=true;},editReply:async data=>replies.push(data)};
  await botModule.handleInteraction(failed,{guildId:'guild',getAnalytics:async()=>{throw new Error('api-key-secret');}});
  assert.doesNotMatch(replies.at(-1).content,/api-key-secret/);
});

test('scheduled report due guards respect Skopje DST, morning boundary and weekly catchup',()=>{
  assert.equal(typeof botModule.reportIsDue,'function');
  assert.equal(botModule.reportIsDue('daily',new Date('2026-11-03T07:59:59Z'),'Europe/Skopje','0 9 * * *'),false);
  assert.equal(botModule.reportIsDue('daily',new Date('2026-11-03T08:00:00Z'),'Europe/Skopje','0 9 * * *'),true);
  assert.equal(botModule.reportIsDue('daily',new Date('2026-07-03T07:00:00Z'),'Europe/Skopje','0 9 * * *'),true);
  assert.equal(botModule.reportIsDue('weekly',new Date('2026-11-02T07:59:00Z'),'Europe/Skopje','0 9 * * 1'),false);
  assert.equal(botModule.reportIsDue('weekly',new Date('2026-11-03T02:00:00Z'),'Europe/Skopje','0 9 * * 1'),true);
});

test('command metric and period combinations select matching data and labels',async()=>{
  let loaded;
  const replies=[];
  const interaction={guildId:'guild',isChatInputCommand:()=>true,commandName:'topvideos',options:{getString:name=>name==='metrika'?'period':null},deferReply:async()=>{},editReply:async payload=>replies.push(payload)};
  await botModule.handleInteraction(interaction,{guildId:'guild',getAnalytics:async options=>{loaded=options;return snapshot;}});
  assert.equal(loaded.period,'week');
  const monthlyMetric=presentation.rankingEmbed(snapshot.accounts,2,'mesec',{snapshot}).toJSON();
  assert.doesNotMatch(monthlyMetric.title,/ovoj mesec/);
  const lifetime=presentation.rankingEmbed(snapshot.accounts,2,'nedela',{snapshot:{...snapshot,period:{...snapshot.period,key:'all'}}}).toJSON();
  assert.match(lifetime.description,/100,000/);
});

test('successful AI recommendation selection is Latin and cannot introduce model prose',async()=>{
  const logs=[];
  const answer=await ai.answerQuestion('Koj e najdobar?',{logger:{info:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},getAnalytics:async()=>snapshot,apiKey:'test',fetch:async()=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'{"recommendationIds":["review_top_posts"]}'}]}]})})});
  assert.match(answer,/Pregledajte gi najdobrite objavi/);
  assert.doesNotMatch(answer,/[\u0400-\u04ff]/u);
  assert.match(JSON.stringify(logs),/validated/);
});

test('AI logs provider HTTP failure without key or response body',async()=>{
  const logs=[];
  await ai.answerQuestion('Koj e najdobar?',{logger:{info:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},getAnalytics:async()=>snapshot,apiKey:'secret-key',fetch:async()=>({ok:false,status:429,text:async()=> 'sensitive response'})});
  assert.match(JSON.stringify(logs),/HTTP_429/);
  assert.doesNotMatch(JSON.stringify(logs),/secret-key|sensitive response/);
});
