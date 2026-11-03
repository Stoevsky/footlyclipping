export const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const fmt = (value) => Math.round(n(value)).toLocaleString('en-US');
export const pct = (value) => `${(n(value) * 100).toFixed(1)}%`;
export const label = (account) => `@${String(account?.username || account?.accountUsername || account?.displayName || 'nepoznat').replace(/^@/, '').slice(0, 55)}`;
export const safeLink = (value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};

export function datesFor(days, timezone = 'Europe/Skopje', endOffsetDays = 0, today = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone });
  const parts = formatter.formatToParts(today);
  const vals = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const utc = Date.UTC(Number(vals.year), Number(vals.month) - 1, Number(vals.day));
  const from = new Date(utc - (days - 1 + endOffsetDays) * 86400000).toISOString().slice(0, 10);
  const to = new Date(utc - endOffsetDays * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

export function localDate(date = new Date(), timezone = 'Europe/Skopje') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const shiftDate = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Resolve a wall-clock midnight using the timezone's actual offset on that date.
// Calendar arithmetic occurs on date labels, never by adding 24h to a local instant.
export function zonedMidnight(date, timezone = 'Europe/Skopje') {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const delta = target - wall;
    instant += delta;
    if (!delta) break;
  }
  return new Date(instant);
}

export function reportingPeriod(period = 'week', timezone = 'Europe/Skopje', now = new Date()) {
  const aliases = { nedela: 'week', mesec: 'month', vkupno: 'all', daily: 'yesterday', weekly: 'previous_week' };
  const key = aliases[period] || period;
  const today = localDate(now, timezone);
  let from = today;
  let to = today;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  if (key === 'yesterday') from = to = shiftDate(today, -1);
  else if (key === 'week') from = shiftDate(today, 1 - weekday);
  else if (key === 'previous_week') { from = shiftDate(today, -6 - weekday); to = shiftDate(today, -weekday); }
  else if (key === 'month') from = `${today.slice(0, 7)}-01`;
  else if (key === 'last30') from = shiftDate(today, -29);
  else if (key === 'all') from = '1970-01-01';
  else if (key !== 'today') throw new Error('Unsupported reporting period');
  return { key, from, to, start: zonedMidnight(from, timezone), end: zonedMidnight(shiftDate(to, 1), timezone), timezone };
}

export function verifySignature(rawBody, headers, secret, currentMs = Date.now()) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signatures !== 'string') return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(currentMs / 1000 - Number(timestamp)) > 300) return false;
  if (!secret?.startsWith('whsec_')) return false;
  const key = Buffer.from(secret.substring(6), 'base64');
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signatures.split(' ').some(entry => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    try {
      const received = Buffer.from(signature, 'base64');
      return received.length === expected.length && timingSafeEqual(received, expected);
    } catch { return false; }
  });
}

import { createHmac, timingSafeEqual } from 'node:crypto';
