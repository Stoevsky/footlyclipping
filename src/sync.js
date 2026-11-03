import { createHash } from 'node:crypto';
import { config } from './config.js';
import { viralClient } from './viral.js';
import * as db from './db.js';
import { reportingPeriod, safeLink } from './utils.js';

const PLATFORMS = new Set(['tiktok', 'instagram', 'youtube', 'facebook', 'snapchat']);
const metric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = value => typeof value === 'string' && value ? value : null;
const COUNT_FIELDS = ['viewCount', 'likeCount', 'commentCount', 'shareCount', 'bookmarkCount', 'engagementRate'];
const PERIOD_FIELDS = ['viewCountInPeriod', 'likeCountInPeriod', 'commentCountInPeriod', 'shareCountInPeriod', 'bookmarkCountInPeriod', 'videoCountInPeriod', 'engagementRateInPeriod', 'averageViewsPerVideoInPeriod'];

export function normalizeAccount(row) {
  if (!row || !text(row.id) || !PLATFORMS.has(row.platform) || !text(row.platformAccountId)) throw new Error('Viral.app account identity is invalid');
  const tracked = metric(row.totalVideosTracked);
  const retained = metric(row.totalVideosRetained);
  const excluded = metric(row.totalVideosExcluded);
  const visible = tracked !== null && retained !== null && excluded !== null ? tracked + retained - excluded : null;
  return {
    id: row.id, platform: row.platform, platformAccountId: row.platformAccountId,
    username: text(row.username), displayName: text(row.displayName), orgCreatorId: text(row.orgCreatorId),
    followerCount: metric(row.followerCount), viewCount: metric(row.totalViews), likeCount: metric(row.totalLikes),
    commentCount: metric(row.totalComments), shareCount: metric(row.totalShares), bookmarkCount: metric(row.totalBookmarks),
    videoCount: visible !== null && visible >= 0 ? visible : null,
    totalVideosTracked: tracked, totalVideosRetained: retained, totalVideosExcluded: excluded,
    averageViewsPerVideo: metric(row.averageViewsPerVideo), engagementRate: metric(row.engagementRate),
    loadAt: stamp(row.loadAt), isCompetitor: row.isCompetitor === true,
  };
}

export function videoLink(row) {
  const explicit = safeLink(row.url);
  if (explicit) return explicit;
  const id = text(row.platformVideoId);
  if (!id) return null;
  if (row.platform === 'tiktok' && /^\d+$/.test(id) && row.accountUsername) return `https://www.tiktok.com/@${encodeURIComponent(row.accountUsername)}/video/${id}`;
  if (row.platform === 'youtube' && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  // The API's numeric Instagram ID is not its public shortcode. Do not invent a link.
  return null;
}

export function normalizeVideo(row) {
  if (!row || !PLATFORMS.has(row.platform) || !text(row.platformVideoId)) throw new Error('Viral.app video identity is invalid');
  return {
    id: `${row.platform}:${row.platformVideoId}`, platformVideoId: row.platformVideoId,
    accountId: text(row.orgAccountId), platform: row.platform, platformAccountId: text(row.platformAccountId),
    username: text(row.accountUsername), url: videoLink(row), thumbnailUrl: safeLink(row.thumbnailUrl),
    publishedAt: stamp(row.publishedAt), loadAt: stamp(row.loadAt), isCompetitor: row.isCompetitor === true,
    ...Object.fromEntries(COUNT_FIELDS.map(key => [key, metric(row[key])])),
  };
}

export function crossingEvents(previous, videos, accounts, milestones, { now = new Date(), organizationId = null } = {}) {
  const old = new Map(previous.map(v => [v.id, v]));
  const byAccount = new Map(accounts.map(a => [a.id, a]));
  const events = [];
  for (const video of videos) {
    const baseline = old.get(video.id);
    const account = byAccount.get(video.accountId);
    if (!baseline || baseline.viewCount === null || video.viewCount === null || !Number.isFinite(baseline.viewCount) || !Number.isFinite(video.viewCount) || !account || account.isCompetitor || video.isCompetitor) continue;
    for (const milestone of milestones) {
      if (baseline.viewCount >= milestone || video.viewCount < milestone) continue;
      events.push({
        id: `poll_${createHash('sha256').update(`${video.id}:${milestone}`).digest('hex')}`,
        type: 'video.views_milestone', timestamp: now.toISOString(), organizationId,
        data: { video: { ...video, url: video.url || baseline.url }, account, milestone, viewCount: video.viewCount, previousViewCount: baseline.viewCount, observedAt: video.loadAt || now.toISOString(), likeCount: video.likeCount },
      });
    }
  }
  return events;
}

export function createSynchronizer({ api = viralClient, inventory = db.getInventory, persist = db.persistAnalytics, failure = db.recordSyncFailure, timezone = config.timezone, milestones = config.milestones || [10000,50000,100000,250000,500000,1000000,5000000,10000000], organizationId = config.organizationId } = {}) {
  let active;
  return function run(now = new Date()) {
    if (active) return active;
    active = (async () => {
      try {
        const rawAccounts = await api.accounts();
        const rawVideos = await api.videos();
        const previous = await inventory();
        const accounts = rawAccounts.map(normalizeAccount).filter(a => !a.isCompetitor);
        const videos = rawVideos.map(normalizeVideo).filter(v => !v.isCompetitor);
        const oldVideos = new Map((previous.videos || []).map(v => [v.id,v]));
        for (const video of videos) video.url ||= oldVideos.get(video.id)?.url || null;
        const periods = [];
        const seen = new Set();
        for (const key of ['today', 'yesterday', 'week', 'month', 'previous_week', 'last30']) {
          const range = reportingPeriod(key, timezone, now);
          if (seen.has(`${range.from}:${range.to}`)) continue;
          seen.add(`${range.from}:${range.to}`);
          const periodAccounts = await api.periodAccounts(accounts.map(a => a.id), range, { allowMissing: true });
          const periodVideos = await api.periodVideos(range);
          periods.push({
            from: range.from, to: range.to,
            accounts: periodAccounts.map(a => ({ id: a.id, ...Object.fromEntries(PERIOD_FIELDS.map(field => [field, metric(a[field])])) })),
            videos: periodVideos.map(v => ({ ...normalizeVideo(v), ...Object.fromEntries(PERIOD_FIELDS.map(field => [field, metric(v[field])])) })),
            accountCoverage: periodAccounts.length === accounts.length ? 'complete' : 'partial', videoCoverage: 'top100', metricsTimezone: 'UTC',
          });
        }
        const events = crossingEvents(previous.videos || [], videos, accounts, milestones, { now, organizationId });
        const coverage = { complete: true, metricTimezone: 'UTC', videoPeriodCoverage: 'top100', missingPeriodAccounts: periods.reduce((sum,p) => sum + accounts.length - p.accounts.length, 0), missingAccountMetrics: accounts.filter(a => a.viewCount === null).length, missingVideoMetrics: videos.filter(v => v.viewCount === null).length };
        await persist({ accounts, videos, periods, events, syncedAt: now, coverage });
        return { accounts: accounts.length, videos: videos.length, events: events.length, syncedAt: now.toISOString() };
      } catch (error) {
        const code = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? `VIRAL_HTTP_${error.status}` : 'VIRAL_SYNC_FAILED';
        try { await failure(code); } catch { /* The runtime separately monitors database availability. */ }
        throw Object.assign(new Error(`Viral.app sync failed (${code}); the last successful dataset was preserved`), { code });
      } finally { active = null; }
    })();
    return active;
  };
}

// Resolve DB exports on first use, after all module initialization is complete.
let synchronizer;
export function syncAnalytics() {
  synchronizer ||= createSynchronizer();
  return synchronizer();
}
