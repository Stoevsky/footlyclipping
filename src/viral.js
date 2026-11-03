import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { datesFor } from './utils.js';

const BASE = 'https://viral.app/api/v1';
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

// Injectable transport keeps tests offline; production always uses the official origin.
export function createViralClient({ apiKey, fetchImpl = fetch, sleep = delay, maxAttempts = 4, minIntervalMs = 250 } = {}) {
  let lastRequest = 0;
  let cooldownUntil = 0;
  let cooldownStatus = 429;
  let queue = Promise.resolve();
  const rateSlot = () => {
    const slot = queue.then(async () => {
      const remaining = minIntervalMs - (Date.now() - lastRequest);
      if (remaining > 0) await sleep(remaining);
      lastRequest = Date.now();
    });
    queue = slot.catch(() => {});
    return slot;
  };
  async function get(path, params = {}) {
    if (!apiKey) throw new Error('VIRAL_API_KEY is not configured');
    if (Date.now() < cooldownUntil) throw Object.assign(new Error(`Viral.app API HTTP ${cooldownStatus}; provider cooldown active`), { status: cooldownStatus });
    const url = new URL(`${BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((item, index) => url.searchParams.set(`${key}[${index}]`, String(item)));
      else url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await rateSlot();
      let response;
      try {
        response = await fetchImpl(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      } catch {
        if (attempt === maxAttempts - 1) throw new Error('Viral.app network request failed');
        await sleep(Math.min(8000, 500 * 2 ** attempt));
        continue;
      }
      if (response.ok) {
        try { return await response.json(); }
        catch { throw new Error('Viral.app returned invalid JSON'); }
      }
      // Never include upstream response text: it can contain account data or credentials.
      const error = new Error(`Viral.app API HTTP ${response.status}`);
      error.status = response.status;
      const retry = response.headers.get('retry-after');
      const retryMs = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
      if (retryMs > 30000) { cooldownUntil = Date.now() + retryMs; cooldownStatus = response.status; }
      await response.body?.cancel();
      if (!TRANSIENT.has(response.status) || attempt === maxAttempts - 1 || retryMs > 30000) throw error;
      await sleep(Math.max(Number.isFinite(retryMs) ? retryMs : 0, Math.min(8000, 500 * 2 ** attempt)));
    }
    throw new Error('Viral.app request attempts exhausted');
  }
  async function all(path, params = {}) {
    const rows = [];
    const ids = new Set();
    let expected;
    let pages;
    for (let page = 1; page <= 10000; page++) {
      const result = await get(path, { ...params, viewMode: 'internal', page, perPage: 100 });
      if (!Array.isArray(result?.data) || !Number.isInteger(result.pageCount) || result.pageCount < 0 || result.pageCount > 10000 || !Number.isInteger(result.totalRows) || result.totalRows < 0) throw new Error('Viral.app pagination response is invalid');
      if (page === 1) { expected = result.totalRows; pages = result.pageCount; }
      if (expected !== result.totalRows || pages !== result.pageCount) throw new Error('Viral.app pagination changed during sync; retry required');
      for (const row of result.data) {
        // /videos has a nullable internal id until analytics load; platform identity is stable.
        const id = path === '/videos' ? (typeof row?.platform === 'string' && row.platform && typeof row?.platformVideoId === 'string' && row.platformVideoId ? `${row.platform}:${row.platformVideoId}` : null) : row?.id;
        if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('Viral.app pagination has duplicate or invalid ids');
        ids.add(id);
        rows.push(row);
      }
      if (page >= pages) {
        if (rows.length !== expected) throw new Error('Viral.app pagination is incomplete');
        return rows;
      }
      if (!result.data.length) throw new Error('Viral.app pagination ended prematurely');
    }
    throw new Error('Viral.app pagination exceeded safety limit');
  }
  async function periodAccounts(ids, { from, to }, { allowMissing = false } = {}) {
    const rows = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const data = await get('/analytics/top-accounts', { accounts: batch, 'dateRange[from]': from, 'dateRange[to]': to, limit: 100, metric: 'viewCountInPeriod', viewMode: 'internal' });
      if (!Array.isArray(data) || (!allowMissing && data.length !== batch.length) || new Set(data.map(a => a.id)).size !== data.length || data.some(a => !batch.includes(a.id) || a.isCompetitor)) throw new Error('Viral.app account metric coverage is incomplete');
      rows.push(...data);
    }
    return rows;
  }
  async function periodVideos({ from, to }) {
    const data = await get('/analytics/top-videos', { 'dateRange[from]': from, 'dateRange[to]': to, limit: 100, metric: 'viewCountInPeriod', viewMode: 'internal' });
    if (!Array.isArray(data) || data.some(v => v.isCompetitor)) throw new Error('Viral.app video metrics response is invalid');
    return data;
  }
  return { get, accounts: () => all('/accounts', { sortCol: 'createdAt', sortDir: 'asc' }), videos: () => all('/videos', { sortCol: 'publishedAt', sortDir: 'asc' }), periodAccounts, periodVideos };
}

export const viralClient = createViralClient({ apiKey: config.apiKey });
// Compatibility exports; commands use persisted analytics after synchronization.
export function clearCache() {}
export async function trackedCount() { return (await viralClient.accounts()).length; }
export async function topAccounts({ days = 7, yesterday = false } = {}) {
  const accounts = await viralClient.accounts();
  return viralClient.periodAccounts(accounts.filter(a => !a.isCompetitor).map(a => a.id), datesFor(days, config.timezone, yesterday ? 1 : 0));
}
export async function topVideos({ days = 7 } = {}) { return viralClient.periodVideos(datesFor(days, config.timezone)); }
