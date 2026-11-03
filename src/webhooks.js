import http from 'node:http';
import { config } from './config.js';
import { verifySignature } from './utils.js';
import { enqueueEvent, getHighest, setHighest, pool, markDone } from './db.js';
import { viralEmbed, followersEmbed, publishedEmbed } from './presentation.js';
import { sendToChannel, updateLeaderboard } from './bot.js';
import { clearCache } from './viral.js';

const MAX_BODY = 1024 * 1024;
let workerBusy = false;

export function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      try {
        await pool.query('SELECT 1');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'footly-growth-bot' }));
      } catch {
        res.writeHead(503); res.end('DB unavailable');
      }
      return;
    }
    if (req.url !== '/webhooks/viral-app' || req.method !== 'POST') {
      res.writeHead(404); res.end('Not found'); return;
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) { res.writeHead(413); res.end('Too large'); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!verifySignature(raw, req.headers, config.webhookSecret)) {
        res.writeHead(401); res.end('Invalid signature'); return;
      }
      const event = JSON.parse(raw);
      if (!event?.id || event.id !== req.headers['webhook-id'] || typeof event.type !== 'string' || !event.data ||
          (config.organizationId && event.organizationId !== config.organizationId)) {
        res.writeHead(400); res.end('Invalid event'); return;
      }
      // Durably queue FIRST, then ack. Ne povikuvame Discord pred 204.
      await enqueueEvent(event);
      res.writeHead(204); res.end();
    } catch (err) {
      console.error('[webhook] greshka', err);
      res.writeHead(503); res.end('Temporary error');
    }
  });
  server.listen(config.port, '0.0.0.0', () => console.info(`[http] Slusham na port ${config.port}`));
  return server;
}

async function handleVideoMilestone(row) {
  const event = row.payload;
  const { video, account } = event.data || {};
  const platform = String(video?.platform || account?.platform || '');
  const vid = String(video?.platformVideoId || '');
  if (!platform || !vid) return [row.id];
  // 45 sec buffer: ako eden sync generira 50k,100k,250k, objavi samo najvisok.
  const { rows } = await pool.query(`SELECT id,payload FROM viral_events
    WHERE status='pending' AND event_type='video.views_milestone'
    AND payload #>> '{data,video,platformVideoId}'=$1
    AND payload #>> '{data,video,platform}'=$2`, [vid, platform]);
  const batch = [{ id: row.id, payload: event }, ...rows];
  const highest = [...batch].sort((a,b) => Number(b.payload?.data?.milestone || 0) - Number(a.payload?.data?.milestone || 0))[0];
  const milestone = Number(highest.payload?.data?.milestone || 0);
  const key = `${platform}:${vid}`;
  const previous = await getHighest('video_milestones', key);
  if (milestone > previous && milestone >= config.minViews && !account?.isCompetitor) {
    await sendToChannel(config.channels.viral, viralEmbed(highest.payload));
  }
  await setHighest('video_milestones', key, milestone);
  return batch.map(b => b.id);
}

async function handleEvent(row) {
  const event = row.payload;
  if (event.type === 'video.views_milestone') return handleVideoMilestone(row);
  if (event.type === 'account.followers_milestone') {
    const { account, milestone } = event.data || {};
    const key = String(account?.id || `${account?.platform}:${account?.platformAccountId}`);
    const val = Number(milestone || 0);
    const previous = await getHighest('account_milestones', key);
    if (val > previous && val >= config.minFollowers && !account?.isCompetitor) {
      await sendToChannel(config.channels.growth, followersEmbed(event));
    }
    await setHighest('account_milestones', key, val);
  } else if (event.type === 'video.published') {
    if (config.channels.videos && !event.data?.account?.isCompetitor) await sendToChannel(config.channels.videos, publishedEmbed(event));
  } else if (event.type === 'organization.synced' || event.type === 'sync.completed') {
    clearCache();
    // Debounced, not every sync posts a new message.
    try { await updateLeaderboard(false); }
    catch (err) { console.error('[leaderboard] update po sync ne uspea', err); }
  } else if (event.type === 'webhook.test') {
    console.info('[webhook] Test event primen i verifikuvan.');
  }
  return [row.id];
}

export async function processQueue() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    // Oslobodi eventi zaglaveni pri nenadejno gasenje.
    await pool.query("UPDATE viral_events SET status='pending' WHERE status='processing' AND received_at < now() - interval '5 minutes'");
    for (let i = 0; i < 30; i++) {
      const { rows } = await pool.query(`UPDATE viral_events SET status='processing', attempts=attempts+1
        WHERE id=(SELECT id FROM viral_events WHERE status='pending' AND available_at<=now()
          ORDER BY received_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING *`);
      const row = rows[0];
      if (!row) break;
      try {
        const ids = await handleEvent(row);
        await markDone(ids);
      } catch (err) {
        console.error(`[worker] ${row.event_type}: ${err.message}`);
        const backoff = Math.min(3600, 20 * Math.pow(2, Math.min(row.attempts || 1, 7)));
        await pool.query(`UPDATE viral_events SET status=$2,error=$3,available_at=now()+($4::integer*interval '1 second') WHERE id=$1`,
          [row.id, (row.attempts || 1) >= 12 ? 'failed' : 'pending', String(err.message).slice(0, 500), backoff]);
      }
    }
  } catch (err) { console.error('[worker] greshka', err); }
  finally { workerBusy = false; }
}
