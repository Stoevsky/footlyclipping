import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from '../src/ai.js';
import {commands,handleInteraction} from '../src/bot.js';

const campaign={scope:{type:'campaign',id:'orgcamp_current',name:'Footly current'},period:{key:'week',from:'2026-11-02',to:'2026-11-03',timezone:'Europe/Skopje'},syncedAt:'2026-11-03T10:00:00Z',
  accounts:Array.from({length:4},(_,i)=>({id:String(i),username:`current${i}`,viewCount:0,viewCountInPeriod:0,videoCount:0,videoCountInPeriod:0})),videos:[],milestones:[],
  totals:{views:0,viewsGained:0,posts:0,videos:0},coverage:{inventoryComplete:true,notes:[]}};
const organization={...campaign,scope:undefined,accounts:[{id:'org1',username:'history',viewCount:1234567,viewCountInPeriod:50000,followerCount:5000,email:'private@example.com',token:'never-send',aliases:['history'],connectedAccounts:[{email:'also-private@example.com'}]}],totals:{views:1234567,viewsGained:50000,posts:7,videos:100},coverage:{notes:['Organization source is older than campaign source.']}};
const logger={info(){},warn(){}};
const response=payload=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify(payload)}]}]})});

test('OpenAI gets Footly knowledge plus separately labeled campaign and organization data even at zero',async()=>{
  let request,calls=0;
  const answer=await ai.answerQuestion('Daj mi ideja za slideshow so 5 slajdovi.',{getAnalytics:async()=>campaign,getOrganizationAnalytics:async()=>organization,footlyContext:'Footly e aplikacija za fudbalski trening. Slideshow vodi publika kon aplikacijata.',apiKey:'test',logger,
    fetch:async(_url,options)=>{calls++;request=JSON.parse(options.body);return response({answer:'Preporaka: Napravi 5 slajdovi. Pochni so fudbalsko prashanje, dodadi tragovi i zavrshi so jasen povik za akcija.',factIds:[]});}});
  assert.equal(calls,1);
  assert.match(answer,/Napravi 5 slajdovi/);
  assert.match(request.input,/Footly e aplikacija za fudbalski trening/);
  assert.match(request.input,/Footly current/);
  assert.match(request.input,/organization/);
  assert.match(request.input,/1,234,567/);
  assert.doesNotMatch(request.input,/private@example|never-send|connectedAccounts/);
  assert.equal(request.store,false);
  assert.equal(request.text.format.name,'footly_conversation');
  assert.ok(answer.length<=3800);
});

test('selected factual references render their source instead of mixing organization and campaign totals',async()=>{
  const answer=await ai.answerQuestion('Sporedi ja kampanjata so organizacijata.',{getAnalytics:async()=>campaign,getOrganizationAnalytics:async()=>organization,footlyContext:'Footly',apiKey:'test',logger,
    fetch:async()=>response({answer:'Fakti: Kampanjata i organizacijata se razlichni opfati. Preporaka: sledi ja kampanjata oddelno.',factIds:['campaign:views','organization:views']})});
  assert.match(answer,/Kampanja.*Footly current/);
  assert.match(answer,/Organizacija/);
  assert.match(answer,/1,234,567/);
  assert.match(answer,/Vkupno pregledi: 0/);
  assert.match(answer,/2026-11-03T10:00:00Z/);
});

test('context creator caps are explicit and retain named creator outside first hundred',()=>{
  assert.equal(typeof ai.buildConversationContext,'function');
  const big={...organization,accounts:Array.from({length:140},(_,i)=>({id:String(i),username:`creator${i}`,viewCount:i,viewCountInPeriod:i}))};
  const context=ai.buildConversationContext({campaign,organization:big,question:'Kako raboti @creator0?',footlyContext:'Footly'});
  const source=context.sources.find(source=>source.id==='organization');
  assert.equal(source.totalCreators,140);
  assert.ok(source.includedCreators<=100);
  assert.match(JSON.stringify(source),/ogranichen|delumen/i);
  assert.match(JSON.stringify(context),/@creator0/);
  assert.ok(JSON.stringify(context).length<50000);
});

test('invalid fact IDs or obvious unsupported performance claims fall back to measured facts',async()=>{
  for(const payload of [{answer:'Ima 999999999 pregledi.',factIds:[]},{answer:'Odlichno.',factIds:['organization:invented']}]) {
    const answer=await ai.answerQuestion('Kako odi kampanjata?',{getAnalytics:async()=>campaign,getOrganizationAnalytics:async()=>organization,footlyContext:'Footly',apiKey:'test',logger,fetch:async()=>response(payload)});
    assert.doesNotMatch(answer,/999999999|invented/);
    assert.match(answer,/izramneti/);
  }
});

test('knowledge answers still call OpenAI during database outage without inventing analytics',async()=>{
  let input;
  const answer=await ai.answerQuestion('Kako da napravam football slideshow?',{getAnalytics:async()=>{throw new Error('secret database URL');},getOrganizationAnalytics:async()=>{throw new Error('private');},footlyContext:'Footly nasoki za slideshow.',apiKey:'test',logger,fetch:async(_url,options)=>{input=JSON.parse(options.body).input;return response({answer:'Preporaka: Izberi fudbalska tema i jasen hook. Analitikata sega ne e dostapna.',factIds:[]});}});
  assert.match(answer,/Izberi fudbalska tema/);
  assert.doesNotMatch(input,/secret database|private/);
  assert.match(input,/unavailable/);
});

test('unsynchronized snapshots are unavailable and cannot create zero activity facts',()=>{
  const unsynchronized={...organization,syncedAt:null,accounts:[],videos:[],milestones:[],totals:{views:null,viewsGained:null,posts:null,videos:0}};
  const context=ai.buildConversationContext({campaign:{...unsynchronized,scope:campaign.scope},organization:unsynchronized,footlyContext:'Footly'});
  assert.ok(context.sources.every(source=>source.status==='unavailable' && source.totalCreators===null && source.totalVideos===null));
  assert.deepEqual(context.facts,[]);
});

test('both AI aliases share an embed response with safe length',async()=>{
  assert.ok(commands.some(command=>command.name==='prashaj'));
  const replies=[];
  const interaction={guildId:'guild',channelId:'ai',isChatInputCommand:()=>true,commandName:'prashaj',user:{id:'unique-ai-alias-test'},options:{getString:()=> 'Daj ideja'},deferReply:async()=>{},editReply:async payload=>replies.push(payload)};
  await handleInteraction(interaction,{guildId:'guild',answerQuestion:async()=> 'A'.repeat(3800)});
  assert.ok(replies[0].embeds);
  assert.equal(replies[0].embeds[0].toJSON().description.length,3800);
});

test('explicit video links are retained outside the highest ten videos',()=>{
  const withVideos={...organization,videos:Array.from({length:20},(_,i)=>({id:`v${i}`,accountUsername:`author${i}`,url:`https://example.com/video/${i}`,viewCount:1000-i,viewCountInPeriod:1000-i}))};
  const context=ai.buildConversationContext({campaign,organization:withVideos,question:'Objasni https://example.com/video/19',footlyContext:'Footly'});
  assert.match(JSON.stringify(context.facts),/example.com\/video\/19/);
});

test('measured claim guards reject metric-first and punctuated value-first statistics',async()=>{
  for(const answer of ['Pregledi: 999999999.','Views = 999999999','Sledbenici — 999999999','Engagement: 99%','999999999: pregledi']) {
    const result=await ai.answerQuestion('Kako odi kampanjata?',{getAnalytics:async()=>campaign,getOrganizationAnalytics:async()=>organization,footlyContext:'Footly',apiKey:'test',logger,fetch:async()=>response({answer,factIds:[]})});
    assert.doesNotMatch(result,/999999999|99%/);
    assert.match(result,/AI odgovorot momentalno ne e dostapen/);
  }
});

test('organization AI facts exclude campaign-scoped milestone events',()=>{
  const withEvents={...organization,milestones:[
    {scope:{type:'campaign',id:'orgcamp_current'},data:{account:{username:'campaign-only'},milestone:10000}},
    {campaignId:'orgcamp_current',data:{account:{username:'campaign-only-too'},milestone:50000}},
    {data:{account:{username:'organization-event'},milestone:100000}},
  ]};
  const context=ai.buildConversationContext({campaign,organization:withEvents,question:'Viral milestones?',footlyContext:'Footly'});
  const milestones=context.facts.filter(fact=>fact.id.startsWith('organization:milestone:'));
  assert.equal(milestones.length,1);
  assert.match(milestones[0].text,/organization-event/);
});

test('AI fallback diagnostics distinguish failures without logging source or provider text',async()=>{
  const cases=[
    ['AI_TIMEOUT',async()=>{throw Object.assign(new Error('SECRETCREDENTIAL'),{name:'TimeoutError'});}],
    ['AI_FETCH_FAILURE',async()=>{throw new Error('SECRETCREDENTIAL');}],
    ['AI_INVALID_JSON',async()=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'{ SECRETCREDENTIAL'}]}]})})],
    ['AI_INCOMPLETE_MAX_TOKENS',async()=>({ok:true,json:async()=>({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]})})],
    ['AI_INVALID_SHAPE',async()=>response({answer:123,factIds:[]})],
    ['AI_MEASURED_NUMBER_GUARD',async()=>response({answer:'Pregledi: 999999999.',factIds:[]})],
    ['AI_UNKNOWN_FACT_REFERENCE',async()=>response({answer:'Preporaka: Nov hook.',factIds:['invented:fact']})],
    ['AI_EMPTY_OUTPUT',async()=>({ok:true,json:async()=>({status:'completed',output:[]})})],
  ];
  for(const [code,fetch] of cases) {
    const logs=[];
    await ai.answerQuestion('PRIVATE QUESTION',{getAnalytics:async()=>campaign,getOrganizationAnalytics:async()=>organization,footlyContext:'PRIVATE GUIDE',apiKey:'SECRETCREDENTIAL',fetch,logger:{info:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)}});
    const text=JSON.stringify(logs);
    assert.match(text,new RegExp(code));
    assert.match(text,/duration_ms=\d+/);
    assert.doesNotMatch(text,/PRIVATE QUESTION|PRIVATE GUIDE|SECRETCREDENTIAL|invented:fact|999999999/);
  }
});
