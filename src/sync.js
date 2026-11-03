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

export function createSynchronizer({ api = viralClient, inventory = db.getInventory, persist = db.persistAnalytics, failure = db.recordSyncFailure, timezone = config.timezone, milestones = config.milestones || [10000,50000,100000,250000,500000,1000000,5000000,10000000], organizationId = config.organizationId, campaignId = config.campaignId, campaignInventory = db.getCampaignSnapshot, persistCampaign = db.persistCampaignSnapshot } = {}) {
  if (campaignId) return createCampaignSynchronizer({ api, campaignId, inventory: campaignInventory, persist: persistCampaign, failure, timezone, milestones, organizationId });
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

const CAMPAIGN_METRICS = { viewCount: 'totalViews', videoCount: 'totalPosts', eligibleVideoCount: 'totalVideosEligible', likeCount: 'totalLikes', commentCount: 'totalComments', shareCount: 'totalShares', bookmarkCount: 'totalBookmarks' };
const campaignMetrics = row => Object.fromEntries(Object.entries(CAMPAIGN_METRICS).map(([key, source]) => [key, metric(row?.[source])]));

function campaignRoster(source, rows, details) {
  const summary = source.creatorSummary;
  if (!Array.isArray(summary?.activeCreators) || summary.activeCount !== summary.activeCreators.length || new Set(summary.activeCreators.map(c => c.id)).size !== summary.activeCount) throw new Error('Campaign roster is incomplete');
  const byId = new Map([...rows, ...details].map(row => [row.id, row]));
  return summary.activeCreators.map(member => {
    if (!text(member.id)) throw new Error('Campaign creator identity is invalid');
    const row = byId.get(member.id) || member;
    const accounts = (row.accounts || []).map(account => ({
      ...normalizeAccount(account), orgCreatorId: member.id,
      loadAt: stamp(account.analyticsDataRefreshedAt),
    })).filter(account => !account.isCompetitor);
    const assignment = row.campaignDisplay?.id === source.id ? row.campaignDisplay : null;
    return {
      id: member.id, name: text(row.user?.name) || text(member.user?.name),
      username: accounts.find(a => a.username)?.username || text(row.user?.name) || text(member.user?.name), accounts,
      assignmentValidFrom: stamp(assignment?.assignmentValidFrom), assignmentValidUntil: stamp(assignment?.assignmentValidUntil),
    };
  });
}

// Campaign metrics are a separate source and storage scope. Never substitute account
// lifetime totals or the organization's old snapshot when the campaign has no posts.
export function createCampaignSynchronizer({ api = viralClient, campaignId = config.campaignId, inventory = db.getCampaignSnapshot, persist = db.persistCampaignSnapshot, failure = db.recordSyncFailure, timezone = config.timezone, milestones = config.milestones || [10000,50000,100000,250000,500000,1000000,5000000,10000000], organizationId = config.organizationId } = {}) {
  let active;
  return function run(now = new Date()) {
    if (active) return active;
    active = (async () => {
      try {
        const source = await api.campaign(campaignId);
        if (source?.id !== campaignId || !text(source.name) || !stamp(source.validFrom)) throw new Error('Campaign identity is invalid');
        const rows = await api.campaignCreators(campaignId);
        const missing = (source.creatorSummary?.activeCreators || []).filter(member => !rows.some(row => row.id === member.id));
        const details = [];
        for (const member of missing) {
          const detail = await api.creator(member.id);
          if (!detail || detail.id !== member.id) throw new Error('Campaign creator details are incomplete');
          details.push(detail);
        }
        const creators = campaignRoster(source, rows, details);
        const creatorIds = creators.map(creator => creator.id);
        const accounts = creators.flatMap(creator => creator.accounts);
        const accountIds = new Set(accounts.map(account => account.id));
        const previous = await inventory(campaignId);
        const oldVideos = new Map((previous?.campaign?.id === campaignId ? previous.periods?.find(p => p.key === 'all')?.videos || [] : []).map(v => [v.id, v]));
        const campaign = { id: campaignId, campaignId, key: `campaign:${campaignId}`, name: source.name, validFrom: stamp(source.validFrom), validUntil: stamp(source.validUntil), timeZone: text(source.timeZone) || 'UTC' };
        const periods = [];
        const results = new Map();
        for (const key of ['all','today','yesterday','week','month','previous_week','last30']) {
          const range = key === 'all' ? { from: campaign.validFrom.slice(0, 10), to: reportingPeriod('today', timezone, now).to } : reportingPeriod(key, timezone, now);
          const scope = key === 'all' ? 'allTime' : 'dateRange';
          const cacheKey = `${scope}:${range.from}:${range.to}`;
          let result = results.get(cacheKey);
          if (!result) {
            const performance = await api.campaignPerformance(campaignId, range, scope, creatorIds);
            const kpis = await api.campaignKpis(campaignId, range, scope, creatorIds);
            const rawVideos = await api.campaignVideos(campaignId, range, scope, creatorIds);
            if (!Array.isArray(performance?.data) || performance.data.some(row => !creatorIds.includes(row.creatorId) || row.campaign?.id !== campaignId) || new Set(performance.data.map(row => row.creatorId)).size !== performance.data.length) throw new Error('Campaign performance scope is invalid');
            const byCreator = new Map(performance.data.map(row => [row.creatorId, row]));
            const totals = campaignMetrics(performance.totals);
            const empty = performance.data.length === 0 && Object.values(totals).every(value => value === 0) && ['totalViews','eligibleVideos','publishedVideos'].every(field => kpis?.metrics?.[field] === 0);
            const metrics = creators.map(creator => {
              const row = byCreator.get(creator.id);
              const counts = empty ? Object.fromEntries(Object.keys(CAMPAIGN_METRICS).map(field => [field, 0])) : campaignMetrics(row);
              return { id: creator.id, ...counts, engagementRate: counts.viewCount === 0 ? null : metric(row?.engagementRate), viralityRate: metric(row?.viralityRate) };
            });
            const candidates = rawVideos.map(row => ({
              ...normalizeVideo(row),
              // The unqualified source video counters are platform lifetime totals.
              // Only the Creator Hub period counters belong to the requested scope.
              ...Object.fromEntries(COUNT_FIELDS.map(field => [field, metric(row[`${field}InPeriod`])])),
              ...Object.fromEntries(PERIOD_FIELDS.map(field => [field, metric(row[field])])),
            }));
            const videos = [];
            let unverifiedVideos = 0;
            for (const video of candidates) {
              if (!video.accountId) {
                const matches = accounts.filter(account => account.platform === video.platform && account.platformAccountId === video.platformAccountId);
                if (matches.length !== 1) { unverifiedVideos++; continue; }
                video.accountId = matches[0].id;
              }
              videos.push(video);
            }
            if (videos.some(video => video.isCompetitor || !accountIds.has(video.accountId)) || new Set(videos.map(video => video.id)).size !== videos.length) throw new Error('Campaign video scope is invalid');
            for (const video of videos) video.url ||= oldVideos.get(video.id)?.url || null;
            result = {
              scope, creators: metrics, videos, totals,
              kpis: { viewCount: metric(kpis?.metrics?.totalViews), publishedVideos: metric(kpis?.metrics?.publishedVideos), eligibleVideos: metric(kpis?.metrics?.eligibleVideos) },
              timeZone: text(performance.timeZone) || text(kpis.timeZone) || campaign.timeZone,
              resolvedRange: performance.resolvedRange ? { from: text(performance.resolvedRange.from), to: text(performance.resolvedRange.to) } : null,
              coverage: { performanceComplete: empty || metrics.every(row => Object.keys(CAMPAIGN_METRICS).every(field => row[field] !== null)), videoCoverage: 'top300', unverifiedVideos, eligibilityRefreshedAt: stamp(performance.eligibilityRefreshedAt) || stamp(kpis.eligibilityRefreshedAt) },
            };
            results.set(cacheKey, result);
          }
          periods.push({ key, from: range.from, to: range.to, ...result });
        }
        const videos = periods.find(period => period.key === 'all').videos;
        const events = crossingEvents([...oldVideos.values()], videos, accounts, milestones, { now, organizationId }).map(event => ({ ...event, id: `poll_campaign_${campaignId}_${event.id.slice(5)}`, campaignId }));
        await persist({ campaign, creators, periods, syncedAt: now, events });
        return { campaignId, accounts: accounts.length, creators: creators.length, videos: videos.length, events: events.length, syncedAt: now.toISOString() };
      } catch (error) {
        const code = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? `VIRAL_HTTP_${error.status}` : 'VIRAL_SYNC_FAILED';
        try { await failure(code, `campaign:${campaignId}`); } catch { /* Runtime monitors database health separately. */ }
        throw Object.assign(new Error(`Viral.app campaign sync failed (${code}); the last successful dataset was preserved`), { code });
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
