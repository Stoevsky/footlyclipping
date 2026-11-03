import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { verifySignature, datesFor, safeLink } from '../src/utils.js';

test('Standard Webhooks potpisi: validna i nevalidna', () => {
  const secret = `whsec_${randomBytes(32).toString('base64')}`;
  const body = '{"id":"event_1","type":"webhook.test"}';
  const ts = String(Math.floor(Date.now()/1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`event_1.${ts}.${body}`).digest('base64');
  const h = { 'webhook-id': 'event_1', 'webhook-timestamp': ts, 'webhook-signature': `v1,${signature}` };
  assert.equal(verifySignature(body, h, secret), true);
  assert.equal(verifySignature(body + ' ', h, secret), false);
  assert.equal(verifySignature(body, { ...h, 'webhook-timestamp': String(Number(ts)-600) }, secret), false);
  assert.equal(verifySignature(body, { ...h, 'webhook-signature': 'v1,abc' }, secret), false);
});

test('Datumi so timezone se validni', () => {
  const d = datesFor(7, 'Europe/Skopje');
  assert.match(d.from, /^\d{4}-\d\d-\d\d$/);
  assert.match(d.to, /^\d{4}-\d\d-\d\d$/);
  assert.equal((Date.parse(d.to)-Date.parse(d.from))/86400000,6);
});

test('Zashtita od opasni linkovi', () => {
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('https://example.com/x'), 'https://example.com/x');
});
