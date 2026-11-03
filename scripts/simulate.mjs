import { createHmac } from 'node:crypto';
const secret = process.env.VIRAL_WEBHOOK_SECRET;
if (!secret?.startsWith('whsec_')) throw new Error('Dodadi VIRAL_WEBHOOK_SECRET vo .env');
const id = `whevt_demo_${Date.now()}`;
const event = {
  id, timestamp: new Date().toISOString(), organizationId: process.env.VIRAL_ORG_ID || 'org_demo',
  type: 'video.views_milestone', actor: { type: 'system', surface: 'system' },
  data: {
    video: { platform: 'tiktok', platformVideoId: `demo_${Date.now()}`, url: 'https://www.tiktok.com/', thumbnailUrl: null },
    account: { id: 'orgacc_demo', platform: 'tiktok', platformAccountId: 'demo', username: 'footly.test', isCompetitor: false },
    milestone: 100000, viewCount: 103421, previousViewCount: 98000, observedAt: new Date().toISOString(),
  },
};
const body = JSON.stringify(event);
const timestamp = String(Math.floor(Date.now() / 1000));
const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
  .update(`${id}.${timestamp}.${body}`).digest('base64');
const url = process.argv[2] || 'http://localhost:3000/webhooks/viral-app';
const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': id,
  'webhook-timestamp': timestamp, 'webhook-signature': `v1,${sig}` }, body });
console.log(`Status: ${response.status} (204 = primen). TEST EVENTOT MOZHE DA OBJAVI TEST ALERT VO KANALOT.`);
