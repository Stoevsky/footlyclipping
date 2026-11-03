import test from 'node:test';
import assert from 'node:assert/strict';
const delivery = await import('../src/delivery.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND') return {}; throw error;});

function fixture() {
  const rows=new Map(), messages=[];
  const store={withLock:async(_key,fn)=>fn(),get:async key=>rows.get(key),
    create:async(key,channelId,payload)=>rows.set(key,{key,channel_id:channelId,payload,status:'pending',created_at:new Date()}),
    markSending:async key=>Object.assign(rows.get(key),{status:'sending',claimed_at:new Date()}),
    markSent:async(key,id)=>Object.assign(rows.get(key),{status:'sent',message_id:id}),listPending:async()=>[...rows.values()].filter(row=>row.status!=='sent')};
  const channel={guildId:'guild',isTextBased:()=>true,messages:{fetch:async()=>new Map(messages.map(message=>[message.id,message]))},
    send:async payload=>{const message={id:String(messages.length+1),author:{id:'bot'},createdTimestamp:Date.now(),embeds:payload.embeds};messages.push(message);return message;}};
  const client={user:{id:'bot'},channels:{fetch:async()=>channel}};
  return {store,rows,messages,channel,client};
}

test('delivery rejects absent and foreign-guild channels',async()=>{
  assert.equal(typeof delivery.createDeliveryService,'function');
  const f=fixture(), service=delivery.createDeliveryService({...f,guildId:'guild'});
  await assert.rejects(()=>service.deliverOnce('k',null,{title:'Test'}),/channel/i);
  f.channel.guildId='other';
  await assert.rejects(()=>service.deliverOnce('k','channel',{title:'Test'}),/guild/i);
  assert.equal(f.messages.length,0);
});

test('same delivery key sends once and recovers a crash after Discord send',async()=>{
  assert.equal(typeof delivery.createDeliveryService,'function');
  const f=fixture(),service=delivery.createDeliveryService({...f,guildId:'guild'});
  const original=f.store.markSent;
  f.store.markSent=async()=>{throw new Error('database disconnected after send');};
  await assert.rejects(()=>service.deliverOnce('k','channel',{title:'Test'}));
  assert.equal(f.messages.length,1);
  f.store.markSent=original;
  const id=await service.deliverOnce('k','channel',{title:'Test'});
  assert.equal(id,'1');
  await service.deliverOnce('k','channel',{title:'Test'});
  assert.equal(f.messages.length,1);
  assert.equal(f.rows.get('k').status,'sent');
});

test('failed history lookup never sends a possible duplicate',async()=>{
  assert.equal(typeof delivery.createDeliveryService,'function');
  const f=fixture(),service=delivery.createDeliveryService({...f,guildId:'guild'});
  await f.store.create('k','channel',[{title:'Test'}]);await f.store.markSending('k');
  f.channel.messages.fetch=async()=>{throw new Error('unavailable');};
  await assert.rejects(()=>service.deliverOnce('k','channel',{title:'Test'}));
  assert.equal(f.messages.length,0);
});

test('campaign delivery scopes new keys and never recovers old organization messages',async()=>{
  const f=fixture(),service=delivery.createDeliveryService({...f,guildId:'guild',campaignId:'new'});
  await f.store.create('report:daily:old','channel',[{title:'Old organization data'}]);
  await f.store.create('campaign:old:report:daily:old','channel',[{title:'Old campaign data'}]);
  await service.recoverPendingDeliveries();
  assert.equal(f.messages.length,0);
  await service.deliverOnce('report:daily:today','channel',{title:'Current campaign'});
  assert.equal(f.rows.get('campaign:new:report:daily:today').status,'sent');
  await assert.rejects(()=>service.deliverOnce('campaign:old:alert','channel',{title:'Old campaign'}),/scope/i);
});
