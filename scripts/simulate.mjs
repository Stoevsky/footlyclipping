import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function simulate({ url, secret, organizationId = 'org_local_test', fetchImpl = fetch } = {}) {
  let target;
  try { target = new URL(url); } catch { throw new Error('Provide an explicit local webhook URL'); }
  if (target.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname !== '/webhooks/viral-app') throw new Error('Only a local HTTP /webhooks/viral-app URL is permitted');
  if (!secret?.startsWith('whsec_') || Buffer.from(secret.slice(6), 'base64').length < 16) throw new Error('Set FOOTLY_TEST_WEBHOOK_SECRET to the local server test signing secret');
  const id = `whevt_local_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ id, timestamp: new Date().toISOString(), organizationId, type: 'webhook.test', data: { message: 'Local signature verification test; no public notification.' } });
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
  const response = await fetchImpl(target.href, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }, body,
  });
  await response.body?.cancel();
  return response.status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const status = await simulate({ url: process.argv[2], secret: process.env.FOOTLY_TEST_WEBHOOK_SECRET, organizationId: process.env.FOOTLY_TEST_ORG_ID || 'org_local_test' });
    console.log(`Local webhook.test response: ${status}; this event cannot publish a Discord alert.`);
    if (status !== 204) process.exitCode = 1;
  } catch {
    console.error('Local simulation failed. Supply a loopback HTTP URL, FOOTLY_TEST_WEBHOOK_SECRET and matching FOOTLY_TEST_ORG_ID.');
    process.exitCode = 1;
  }
}
