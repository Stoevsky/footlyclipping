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

export function datesFor(days, timezone = 'Europe/Skopje', endOffsetDays = 0) {
  const today = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone });
  const parts = formatter.formatToParts(today);
  const vals = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const utc = Date.UTC(Number(vals.year), Number(vals.month) - 1, Number(vals.day));
  const from = new Date(utc - (days - 1 + endOffsetDays) * 86400000).toISOString().slice(0, 10);
  const to = new Date(utc - endOffsetDays * 86400000).toISOString().slice(0, 10);
  return { from, to };
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
