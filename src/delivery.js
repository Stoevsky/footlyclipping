import { createHash } from 'node:crypto';
import { pool } from './db.js';
import { config } from './config.js';

export async function guildChannel(client, channelId, guildId) {
  if (!channelId) throw new Error('Discord channel is not configured');
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.guildId !== guildId) throw new Error('Discord channel is outside the configured guild');
  if (!channel.isTextBased() || typeof channel.send !== 'function') throw new Error('Discord channel cannot receive messages');
  return channel;
}

const markerFor = key => `ref ${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
const plainEmbeds = embeds => (Array.isArray(embeds) ? embeds : [embeds]).map(embed => structuredClone(typeof embed.toJSON === 'function' ? embed.toJSON() : embed));

function deliveryPayload(key, embeds) {
  const result = plainEmbeds(embeds);
  if (!result.length || result.length > 10) throw new Error('Invalid delivery embeds');
  const marker = markerFor(key);
  const oldFooter = result[0].footer?.text || 'Footly';
  result[0].footer = {...result[0].footer,text:oldFooter.includes(marker) ? oldFooter : `${oldFooter.slice(0,1900)} • ${marker}`};
  return result;
}

// A session advisory lock spans the durable claim, network call, and receipt write.
// Releasing the connection always releases this lock, including after a DB failure.
export function postgresDeliveryStore(database = pool) {
  const methods = connection => ({
    get:async key => (await connection.query('SELECT * FROM notification_deliveries WHERE key=$1',[key])).rows[0],
    create:async(key,channelId,payload) => connection.query("INSERT INTO notification_deliveries(key,channel_id,payload,status) VALUES($1,$2,$3,'pending') ON CONFLICT DO NOTHING",[key,channelId,JSON.stringify(payload)]),
    markSending:async key => connection.query("UPDATE notification_deliveries SET status='sending',claimed_at=COALESCE(claimed_at,now()),updated_at=now() WHERE key=$1",[key]),
    markSent:async(key,id) => connection.query("UPDATE notification_deliveries SET status='sent',message_id=$2,sent_at=now(),updated_at=now() WHERE key=$1",[key,id]),
  });
  return {
    ...methods(database),
    async withLock(key,operation) {
      const connection = await database.connect();
      let discard = false;
      try {
        await connection.query('SELECT pg_advisory_lock(hashtextextended($1, 0))',[`footly-delivery:${key}`]);
        return await operation(methods(connection));
      } finally {
        try { await connection.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))',[`footly-delivery:${key}`]); }
        catch { discard = true; }
        connection.release(discard);
      }
    },
    listPending:async()=> (await database.query("SELECT * FROM notification_deliveries WHERE status IN ('pending','sending') ORDER BY created_at LIMIT 50")).rows,
  };
}

async function findDelivered(channel, botId, key, since) {
  const marker = markerFor(key);
  let before;
  // Bound API work; if the history is too long, fail closed for operator recovery.
  for (let page=0;page<50;page++) {
    const batch = await channel.messages.fetch({limit:100,...(before ? {before} : {})});
    const messages = [...batch.values()];
    const found = messages.find(message => message.author?.id === botId && message.embeds?.some(embed => (embed.footer?.text || embed.data?.footer?.text || '').includes(marker)));
    if (found) return found.id;
    if (messages.length < 100) return null;
    const oldest = messages.reduce((a,b)=>a.createdTimestamp < b.createdTimestamp ? a : b);
    if (oldest.createdTimestamp < since) return null;
    if (before === oldest.id) throw new Error('Discord history did not advance');
    before = oldest.id;
  }
  throw new Error('Discord delivery reconciliation needs more message history');
}

export function createDeliveryService({client,guildId,store = postgresDeliveryStore()} = {}) {
  async function deliverOnce(key,channelId,embeds) {
    if (!key || typeof key !== 'string') throw new Error('Delivery key is required');
    const channel = await guildChannel(client,channelId,guildId);
    return store.withLock(key,async(lockedStore = store)=>{
      let row = await lockedStore.get(key);
      if (row && row.channel_id !== channelId) throw new Error('Delivery channel differs from original channel');
      if (row?.status === 'sent') return row.message_id;
      if (!row) {
        await lockedStore.create(key,channelId,deliveryPayload(key,embeds));
        row = await lockedStore.get(key);
      }
      if (row.status === 'sending') {
        const since = new Date(row.claimed_at || row.created_at).getTime() - 60000;
        const existing = await findDelivered(channel,client.user.id,key,since);
        if (existing) { await lockedStore.markSent(key,existing); return existing; }
      }
      await lockedStore.markSending(key);
      const nonce = BigInt(`0x${createHash('sha256').update(key).digest('hex').slice(0,16)}`).toString();
      const message = await channel.send({embeds:row.payload,allowedMentions:{parse:[]},nonce,enforceNonce:true});
      await lockedStore.markSent(key,message.id);
      return message.id;
    });
  }
  return {deliverOnce,async recoverPendingDeliveries() {
    const pending = await store.listPending();
    const results = [];
    for (const row of pending) {
      try { results.push({key:row.key,messageId:await deliverOnce(row.key,row.channel_id,row.payload)}); }
      catch { results.push({key:row.key,error:'DELIVERY_RETRY_FAILED'}); }
    }
    return results;
  }};
}

let service;
async function defaultService() {
  if (!service) {
    const {bot} = await import('./bot.js');
    service = createDeliveryService({client:bot,guildId:config.guildId});
  }
  return service;
}
export async function deliverOnce(key,channelId,embeds) { return (await defaultService()).deliverOnce(key,channelId,embeds); }
export async function recoverPendingDeliveries() { return (await defaultService()).recoverPendingDeliveries(); }
