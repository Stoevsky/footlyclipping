import { config } from './config.js';
import { pool, getInventory } from './db.js';
import { reportingPeriod } from './utils.js';

export function metricNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
const knownSum = values => values.reduce((sum, value) => sum + (metricNumber(value) ?? 0), 0);
const completeSum = values => values.every(value => metricNumber(value) !== null) ? knownSum(values) : null;
const rate = (views, likes, comments) => views !== null && likes !== null && comments !== null && views > 0 ? (likes + comments) / views : null;

function observedChanges(snapshots, idField, id, period, now) {
  const rows = snapshots.filter(row => String(row[idField]) === String(id) &&
    new Date(row.observed_at) >= period.start && new Date(row.observed_at) < period.end && new Date(row.observed_at) <= now)
    .sort((a,b) => new Date(a.observed_at) - new Date(b.observed_at));
  if (rows.length < 2) return {};
  const first = rows[0], last = rows.at(-1);
  const changes = {from:first.observed_at,to:last.observed_at};
  for (const field of ['viewCount','likeCount','commentCount','followerCount']) {
    const begin = metricNumber(first.payload[field]), end = metricNumber(last.payload[field]);
    changes[field] = begin !== null && end !== null && end >= begin ? end - begin : null;
  }
  return changes;
}

export function calculateAnalytics({ accounts:sourceAccounts = [], videos:sourceVideos = [],
  period = 'week', now = new Date(), timezone = 'Europe/Skopje', syncedAt = null,
  inventoryCoverage = {complete:false}, periodCoverage = {}, periodMetrics = [],
  videoSnapshots = [], creatorSnapshots = [], milestones = [], periodAvailable = false, periodObservedAt = null,
} = {}) {
  now = new Date(now);
  const range = typeof period === 'string' ? reportingPeriod(period, timezone, now) : period;
  const metrics = new Map(periodMetrics.map(row => [`${row.entity_type}:${row.entity_id}`,row.payload]));
  const hasOfficialMetrics = periodMetrics.length > 0;
  const sourceById = new Map(sourceAccounts.filter(a => !a.isCompetitor).map(account => [String(account.id),account]));
  let observed = false;
  const videos = sourceVideos.filter(video => !video.isCompetitor).map(video => {
    const account = sourceById.get(String(video.accountId));
    const currentViews = metricNumber(video.viewCount), likes = metricNumber(video.likeCount), comments = metricNumber(video.commentCount);
    const official = metrics.get(`video:${video.id}`);
    const changes = observedChanges(videoSnapshots, 'video_id', video.id, range, now);
    const officialGain = metricNumber(official?.viewCountInPeriod);
    const gain = hasOfficialMetrics ? officialGain : changes.viewCount ?? null;
    if (officialGain === null && gain !== null) observed = true;
    return {...video, accountUsername:video.accountUsername || video.username || account?.username,
      viewCount:currentViews, likeCount:likes,commentCount:comments,shareCount:metricNumber(video.shareCount),
      viewCountInPeriod:gain, engagementRate:rate(currentViews,likes,comments),
      engagementRateInPeriod:hasOfficialMetrics ? rate(officialGain,metricNumber(official?.likeCountInPeriod),metricNumber(official?.commentCountInPeriod)) : rate(changes.viewCount ?? null, changes.likeCount ?? null, changes.commentCount ?? null),
      periodSource:officialGain !== null ? 'viral_api' : gain !== null ? 'observed_snapshots' : null,
      observedFrom:changes.from ?? null, observedTo:changes.to ?? null,
      analyticsUpdatedAt:video.loadAt || null, fetchedAt:syncedAt,
    };
  });
  const accounts = [...sourceById.values()].map(account => {
    const owned = videos.filter(video => String(video.accountId) === String(account.id));
    const official = metrics.get(`account:${account.id}`);
    const count = metricNumber(account.videoCount) ?? (inventoryCoverage.complete === true ? owned.length : null);
    const inventoryHasAllVideos = inventoryCoverage.complete !== false && count === owned.length;
    const canSumVideos = inventoryHasAllVideos && owned.length > 0;
    const views = metricNumber(account.viewCount) ?? (canSumVideos ? completeSum(owned.map(video => video.viewCount)) : null);
    const likes = metricNumber(account.likeCount) ?? (canSumVideos ? completeSum(owned.map(video => video.likeCount)) : null);
    const comments = metricNumber(account.commentCount) ?? (canSumVideos ? completeSum(owned.map(video => video.commentCount)) : null);
    const changes = observedChanges(creatorSnapshots, 'creator_id', account.id, range, now);
    const officialGain = metricNumber(official?.viewCountInPeriod);
    const videoGain = canSumVideos ? completeSum(owned.map(video => video.viewCountInPeriod)) : null;
    const gain = hasOfficialMetrics ? officialGain : changes.viewCount ?? videoGain ?? null;
    if (officialGain === null && gain !== null && (changes.viewCount !== undefined || owned.some(video => video.periodSource === 'observed_snapshots'))) observed = true;
    const publicationsKnown = inventoryHasAllVideos && owned.every(video => Number.isFinite(Date.parse(video.publishedAt)));
    const posts = publicationsKnown ? owned.filter(video => new Date(video.publishedAt) >= range.start && new Date(video.publishedAt) < range.end && new Date(video.publishedAt) <= now).length : null;
    return {...account, viewCount:views, followerCount:metricNumber(account.followerCount),
      viewCountInPeriod:gain,videoCount:count,videoCountInPeriod:posts,
      averageViews:views !== null && count > 0 ? views / count : null,
      averageViewsPerVideo:views !== null && count > 0 ? views / count : null,
      engagementRate:rate(views,likes,comments),
      engagementRateInPeriod:hasOfficialMetrics ? rate(officialGain,metricNumber(official?.likeCountInPeriod),metricNumber(official?.commentCountInPeriod)) : rate(changes.viewCount ?? null,changes.likeCount ?? null,changes.commentCount ?? null),
      followerGrowth:changes.followerCount ?? null,
      periodSource:officialGain !== null ? 'viral_api' : gain !== null ? 'observed_snapshots' : null,
      observedFrom:changes.from ?? null,observedTo:changes.to ?? null,
      analyticsUpdatedAt:account.loadAt || null,fetchedAt:syncedAt,
    };
  });
  const metricsTimezone = periodCoverage.metricsTimezone || inventoryCoverage.metricTimezone || null;
  const uniqueMilestones = new Map();
  for (const event of milestones) {
    const when = new Date(event.data?.observedAt || event.timestamp || event.receivedAt);
    const video = event.data?.video;
    if (!(when >= range.start && when < range.end && when <= now) || !video?.platform || !video.platformVideoId || !metricNumber(event.data?.milestone)) continue;
    const key = `${video.platform}:${video.platformVideoId}:${event.data.milestone}`;
    if (!uniqueMilestones.has(key)) uniqueMilestones.set(key,event);
  }
  const allGainsKnown = accounts.length > 0 && accounts.every(account => account.viewCountInPeriod !== null);
  const inventoryComplete = inventoryCoverage.complete === true;
  const sourceRows = [...sourceAccounts,...sourceVideos];
  const sourceTimes = sourceRows.map(row => Date.parse(row.loadAt)).filter(Number.isFinite).sort((a,b)=>a-b);
  const unknownSourceTimestamps = sourceRows.length-sourceTimes.length;
  const staleSourceEntities = sourceTimes.filter(at=>now-at>86400000).length;
  const notes = [];
  if (!syncedAt) notes.push('Se ushte nema zavrshena sinhronizacija so Viral.app.');
  if (!inventoryComplete) notes.push('Popisot na profili ili videa e necelosen.');
  if (range.key !== 'all') {
    if (!allGainsKnown) notes.push('Nema celosna istorija za pregledi vo ovoj period; nepoznatite vrednosti ne se nula.');
    if (periodCoverage.accountCoverage === 'top100' || periodCoverage.videoCoverage === 'top100') notes.push('Periodnite API podatoci imaat top-100 opfat; rangiranjeto mozhe da bide delumno.');
    if (metricsTimezone === 'UTC' && timezone !== 'UTC') notes.push(`Pregledite od Viral.app se po UTC denovi; rasporedot e ${timezone}.`);
    if (observed) notes.push('Del od rastot e izmeren megju dostapnite snapshot zapisi vo periodot, ne za celiot period.');
  }
  if (sourceVideos.some(video => video.shareCount == null)) notes.push('Shares se prikazhuvaat samo koga se dostapni. Engagement = (likes + komentari) / pregledi.');
  if (syncedAt && now - new Date(syncedAt) > 2 * 60 * 60 * 1000) notes.push('Poslednata sinhronizacija e postara od 2 chasa.');
  if (staleSourceEntities) notes.push(`Izvornite metrics za ${staleSourceEntities} profili/videa se postari od 24 chasa; novoto prezemanje ne gi osvezhuva.`);
  if (unknownSourceTimestamps) notes.push(`Za ${unknownSourceTimestamps} profili/videa ne e poznato vremeto na poslednata izvorna proverka.`);
  return {period:range,accounts,videos,syncedAt,milestones:[...uniqueMilestones.values()],
    totals:{views:syncedAt ? completeSum(accounts.map(a => a.viewCount)) : null,knownViews:knownSum(accounts.map(a => a.viewCount)),
      viewsGained:syncedAt ? completeSum(accounts.map(a => a.viewCountInPeriod)) : null,knownViewsGained:knownSum(accounts.map(a => a.viewCountInPeriod)),
      posts:syncedAt ? completeSum(accounts.map(a => a.videoCountInPeriod)) : null,followers:syncedAt ? completeSum(accounts.map(a => a.followerCount)) : null,
      accounts:accounts.length,videos:videos.length},
    coverage:{inventoryComplete,periodComplete:range.key === 'all' ? inventoryComplete : inventoryComplete && allGainsKnown && !observed && periodCoverage.accountCoverage === 'complete' && (!metricsTimezone || metricsTimezone === timezone),
      metricsTimezone,notes,periodAvailable,periodObservedAt,engagementFormula:'(likes + comments) / views',
      unknownSourceTimestamps,staleSourceEntities,sourceOldestUpdatedAt:sourceTimes.length ? new Date(sourceTimes[0]).toISOString() : null,
      sourceNewestUpdatedAt:sourceTimes.length ? new Date(sourceTimes.at(-1)).toISOString() : null,
      knownAccountGains:accounts.filter(a => a.viewCountInPeriod !== null).length,totalAccounts:accounts.length},
  };
}

export async function getAnalytics({period = 'week',now = new Date(),timezone = config.timezone,database = pool} = {}) {
  const range = reportingPeriod(period,timezone,new Date(now));
  const client = await database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const inventory = await getInventory(client);
    const periodRows = await client.query('SELECT * FROM analytics_snapshots WHERE date_from=$1 AND date_to=$2',[range.from,range.to]);
    const coverage = await client.query('SELECT coverage,observed_at FROM analytics_periods WHERE date_from=$1 AND date_to=$2',[range.from,range.to]);
    // Only first/last observations are needed for measured changes. Keep the result
    // bounded by entity count rather than loading every hourly snapshot into Node.
    const accountHistory = range.key === 'all' ? {rows:[]} : await client.query(`
      (SELECT DISTINCT ON (creator_id) creator_id,observed_at,payload FROM creator_metrics WHERE observed_at >= $1 AND observed_at < $2 AND observed_at <= $3 ORDER BY creator_id,observed_at)
      UNION (SELECT DISTINCT ON (creator_id) creator_id,observed_at,payload FROM creator_metrics WHERE observed_at >= $1 AND observed_at < $2 AND observed_at <= $3 ORDER BY creator_id,observed_at DESC)`,[range.start,range.end,now]);
    const videoHistory = range.key === 'all' ? {rows:[]} : await client.query(`
      (SELECT DISTINCT ON (video_id) video_id,observed_at,payload FROM video_metrics WHERE observed_at >= $1 AND observed_at < $2 AND observed_at <= $3 ORDER BY video_id,observed_at)
      UNION (SELECT DISTINCT ON (video_id) video_id,observed_at,payload FROM video_metrics WHERE observed_at >= $1 AND observed_at < $2 AND observed_at <= $3 ORDER BY video_id,observed_at DESC)`,[range.start,range.end,now]);
    const milestones = await client.query(`SELECT DISTINCT ON (payload #>> '{data,video,platform}',payload #>> '{data,video,platformVideoId}',payload #>> '{data,milestone}') payload,received_at
      FROM viral_events WHERE event_type='video.views_milestone' AND COALESCE(observed_at,received_at) >= $1 AND COALESCE(observed_at,received_at) < $2
      ORDER BY payload #>> '{data,video,platform}',payload #>> '{data,video,platformVideoId}',payload #>> '{data,milestone}',received_at DESC`,[range.start,range.end]);
    await client.query('COMMIT');
    return calculateAnalytics({...inventory,inventoryCoverage:inventory.coverage,period:range,now,timezone,
      periodCoverage:coverage.rows[0]?.coverage,periodMetrics:periodRows.rows,
      periodAvailable:coverage.rowCount > 0,periodObservedAt:coverage.rows[0]?.observed_at?.toISOString() ?? null,
      creatorSnapshots:accountHistory.rows,videoSnapshots:videoHistory.rows,
      milestones:milestones.rows.map(row => ({...row.payload,receivedAt:row.received_at}))});
  } catch(error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
