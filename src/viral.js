import { config } from './config.js';
import { datesFor } from './utils.js';

const BASE = 'https://viral.app/api/v1';
const cache = new Map();

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { 'x-api-key': config.apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 250);
    throw new Error(`Viral.app API: HTTP ${response.status} ${body}`);
  }
  return response.json();
}

async function cached(key, ttlMs, load) {
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return previous.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
export function clearCache() { cache.clear(); }

export async function trackedCount() {
  return cached('count', 20 * 60 * 1000, async () => {
    const data = await apiGet('/accounts/tracked', { page: 1, perPage: 1, viewMode: 'internal' });
    return Number(data.totalRows || 0);
  });
}

// Top-accounts API dozvoluva maksimalno 100 rezultati.
// Za povekje od 100 profili, UI eksplicitno pokazuva deka ranking e ogranichen.
export async function topAccounts({ days = 7, metric = 'viewCountInPeriod', yesterday = false } = {}) {
  const dateRange = datesFor(days, config.timezone, yesterday ? 1 : 0);
  const key = `accounts:${days}:${metric}:${dateRange.from}:${dateRange.to}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const data = await apiGet('/analytics/top-accounts', {
      'dateRange[from]': dateRange.from,
      'dateRange[to]': dateRange.to,
      metric,
      limit: 100,
      viewMode: 'internal',
    });
    if (!Array.isArray(data)) throw new Error('Neocekhuvan format od /analytics/top-accounts');
    return data.filter(a => !a.isCompetitor);
  });
}

export async function topVideos({ days = 7, metric = 'viewCountInPeriod' } = {}) {
  const { from, to } = datesFor(days, config.timezone);
  const key = `videos:${days}:${metric}:${from}:${to}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const data = await apiGet('/analytics/top-videos', {
      'dateRange[from]': from, 'dateRange[to]': to,
      metric, limit: 12, viewMode: 'internal',
    });
    if (!Array.isArray(data)) throw new Error('Neocekhuvan format od /analytics/top-videos');
    return data.filter(v => !v.isCompetitor);
  });
}
