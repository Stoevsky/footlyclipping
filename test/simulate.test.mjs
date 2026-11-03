import test from 'node:test';
import assert from 'node:assert/strict';
const simulation = await import('../scripts/simulate.mjs').catch(() => ({}));
const secret = `whsec_${Buffer.from('local-test-only-secret').toString('base64')}`;

test('simulator rejects production targets before making a request', async () => {
  assert.equal(typeof simulation.simulate, 'function');
  for (const url of [undefined, 'https://example.com/webhooks/viral-app', 'http://localhost.example.com/webhooks/viral-app', 'http://user:pass@localhost:3000/webhooks/viral-app']) {
    await assert.rejects(simulation.simulate({ url, secret, fetchImpl: async () => assert.fail('external request') }), /local/i);
  }
});

test('simulator requires test secret and emits only a signed non-publishing webhook test', async () => {
  assert.equal(typeof simulation.simulate, 'function');
  await assert.rejects(simulation.simulate({ url: 'http://127.0.0.1:3000/webhooks/viral-app' }), /TEST_WEBHOOK_SECRET/);
  let request;
  const result = await simulation.simulate({ url: 'http://localhost:3000/webhooks/viral-app', secret, fetchImpl: async (url, options) => { request = { url, options }; return new Response(null, { status: 204 }); } });
  assert.equal(result, 204);
  const event = JSON.parse(request.options.body);
  assert.equal(event.type, 'webhook.test');
  assert.equal(event.data.milestone, undefined);
  assert.equal(request.options.redirect, 'error');
  assert.match(request.options.headers['webhook-signature'], /^v1,/);
});
