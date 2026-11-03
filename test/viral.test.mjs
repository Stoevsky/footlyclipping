import test from 'node:test';
import assert from 'node:assert/strict';
import * as viral from '../src/viral.js';

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const client = (fetchImpl, options = {}) => {
  assert.equal(typeof viral.createViralClient, 'function');
  return viral.createViralClient({ apiKey: 'test-key', fetchImpl, minIntervalMs: 0, sleep: async () => {}, ...options });
};

test('paginates every account and video page using official page metadata', async () => {
  const urls = [];
  const api = client(async url => {
    urls.push(new URL(url));
    const page = Number(new URL(url).searchParams.get('page'));
    return reply({ data: [{ id: String(page), platform: 'tiktok', platformVideoId: String(page) }], pageCount: 2, totalRows: 2 });
  });
  assert.equal((await api.accounts()).length, 2);
  assert.equal((await api.videos()).length, 2);
  assert.deepEqual(urls.map(u => u.pathname), ['/api/v1/accounts', '/api/v1/accounts', '/api/v1/videos', '/api/v1/videos']);
  assert.ok(urls.every(u => u.searchParams.get('perPage') === '100' && u.searchParams.get('viewMode') === 'internal'));
});

test('rejects incomplete and repeating pagination rather than silently ranking a subset', async () => {
  const api = client(async () => reply({ data: [{ id: 'same' }], pageCount: 2, totalRows: 2 }));
  await assert.rejects(api.accounts(), /pagination/i);
  await assert.rejects(client(async () => reply({ data: [], pageCount: 1, totalRows: 2 })).videos(), /pagination/i);
});

test('honors Retry-After and retries transient failures without leaking response contents', async () => {
  let calls = 0;
  const sleeps = [];
  const api = client(async () => ++calls === 1 ? reply({ secret: 'must-not-log' }, 429, { 'retry-after': '2' }) : reply({ data: [], pageCount: 0, totalRows: 0 }), { sleep: async ms => sleeps.push(ms) });
  assert.deepEqual(await api.accounts(), []);
  assert.ok(sleeps.includes(2000));
  calls = 0;
  await assert.rejects(client(async () => { calls++; return reply({ secret: 'must-not-log' }, 401); }).accounts(), err => err.message === 'Viral.app API HTTP 401');
  assert.equal(calls, 1);
});

test('bounds retries on network failure and drops fetch error details', async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls++; throw new Error('test-key'); }, { maxAttempts: 3 }).accounts(), /Viral.app network request failed/);
  assert.equal(calls, 3);
});

test('period accounts cover more than 100 creators with deepObject filter batches', async () => {
  const ids = Array.from({ length: 201 }, (_, i) => `orgacc_${i}`);
  const batches = [];
  const api = client(async url => {
    const q = new URL(url).searchParams;
    const batch = [...q].filter(([k]) => /^accounts\[\d+\]$/.test(k)).map(([,v]) => v);
    batches.push(batch);
    return reply(batch.map(id => ({ id, viewCountInPeriod: 1 })));
  });
  assert.equal((await api.periodAccounts(ids, { from: '2026-11-01', to: '2026-11-03' })).length, 201);
  assert.deepEqual(batches.map(b => b.length), [100, 100, 1]);
});

test('missing requested account metrics are reported as incomplete', async () => {
  const api = client(async () => reply([{ id: 'orgacc_a' }]));
  await assert.rejects(api.periodAccounts(['orgacc_a', 'orgacc_b'], { from: '2026-11-01', to: '2026-11-03' }), /coverage/i);
});

test('rate-limit long Retry-After defers the sync without early retry', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return reply({}, 429, { 'retry-after': '3600' }); });
  await assert.rejects(api.accounts(), /HTTP 429/);
  assert.equal(calls, 1);
});

test('explicit partial analytics mode preserves absent accounts as unknown', async () => {
  const api = client(async () => reply([{ id: 'orgacc_a', viewCountInPeriod: 10 }]));
  assert.deepEqual(await api.periodAccounts(['orgacc_a','orgacc_b'], { from: '2026-11-01', to: '2026-11-03' }, { allowMissing: true }), [{ id: 'orgacc_a', viewCountInPeriod: 10 }]);
});

test('a long provider cooldown also blocks later sync attempts until Retry-After expires', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return reply({}, 429, { 'retry-after': '3600' }); });
  await assert.rejects(api.accounts(), /HTTP 429/);
  await assert.rejects(api.accounts(), /HTTP 429/);
  assert.equal(calls, 1);
});

test('videos not loaded into analytics yet have nullable internal ids and stable platform identities', async () => {
  const api = client(async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    return reply({ data: [{ id: null, platform: 'tiktok', platformVideoId: String(page) }], pageCount: 2, totalRows: 2 });
  });
  assert.equal((await api.videos()).length, 2);
  const duplicate = client(async () => reply({ data: [{ id: null, platform: 'tiktok', platformVideoId: 'same' }], pageCount: 2, totalRows: 2 }));
  await assert.rejects(duplicate.videos(), /pagination/i);
});
