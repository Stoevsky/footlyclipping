import cron from 'node-cron';

export function loadConfig(env = process.env) {
  const text = key => env[key]?.trim() || undefined;
  const number = (key, fallback) => text(key) === undefined ? fallback : Number(text(key));
  return {
    token: text('DISCORD_BOT_TOKEN'), clientId: text('DISCORD_CLIENT_ID'), guildId: text('DISCORD_GUILD_ID'),
    apiKey: text('VIRAL_API_KEY'), webhookSecret: text('VIRAL_WEBHOOK_SECRET'), organizationId: text('VIRAL_ORG_ID') || null,
    databaseUrl: text('DATABASE_URL'), databaseSSL: text('DATABASE_SSL') === 'true', port: number('PORT',3000),
    channels: {viral:text('CHANNEL_VIRAL_ALERTS'), leaderboard:text('CHANNEL_LEADERBOARD'), daily:text('CHANNEL_DAILY_ANALYTICS'), weekly:text('CHANNEL_WEEKLY_ANALYTICS') || text('CHANNEL_DAILY_ANALYTICS'), growth:text('CHANNEL_CREATOR_GROWTH'), ai:text('CHANNEL_FOOTLY_AI'), videos:text('CHANNEL_NEW_VIDEOS')},
    minViews:number('MIN_VIRAL_VIEWS',10000), minFollowers:number('MIN_FOLLOWERS',10000),
    milestones:[...new Set((text('VIRAL_MILESTONES') || '10000,50000,100000,250000,500000,1000000,5000000,10000000').split(',').map(Number))].sort((a,b)=>a-b),
    reportCron:text('DAILY_REPORT_CRON') || '0 9 * * *', weeklyReportCron:text('WEEKLY_REPORT_CRON') || '0 9 * * 1',
    timezone:text('REPORT_TIMEZONE') || 'Europe/Skopje', syncIntervalMinutes:number('SYNC_INTERVAL_MINUTES',60), startupRetryMs:number('STARTUP_RETRY_MS',5000),
    openaiKey:text('OPENAI_API_KEY'), openaiModel:text('OPENAI_MODEL') || 'gpt-4.1-mini',
  };
}
export const config = loadConfig();

export function configIssues(c = config) {
  const issues = [];
  for (const [name,value] of [['DISCORD_BOT_TOKEN',c.token],['VIRAL_API_KEY',c.apiKey],['DATABASE_URL',c.databaseUrl]]) if (!value) issues.push(name);
  const ids = {DISCORD_CLIENT_ID:c.clientId, DISCORD_GUILD_ID:c.guildId, CHANNEL_VIRAL_ALERTS:c.channels.viral, CHANNEL_LEADERBOARD:c.channels.leaderboard, CHANNEL_DAILY_ANALYTICS:c.channels.daily, CHANNEL_CREATOR_GROWTH:c.channels.growth, CHANNEL_FOOTLY_AI:c.channels.ai};
  for(const [name,value] of Object.entries(ids)) if (!/^\d{17,20}$/.test(value || '')) issues.push(name);
  for(const [name,value] of [['CHANNEL_WEEKLY_ANALYTICS',c.channels.weekly],['CHANNEL_NEW_VIDEOS',c.channels.videos]]) if(value && !/^\d{17,20}$/.test(value)) issues.push(name);
  if(c.databaseUrl) { try { if(!['postgres:','postgresql:'].includes(new URL(c.databaseUrl).protocol)) issues.push('DATABASE_URL'); } catch { issues.push('DATABASE_URL'); } }
  if(!Number.isInteger(c.port) || c.port<1 || c.port>65535) issues.push('PORT');
  for(const [name,value] of [['MIN_VIRAL_VIEWS',c.minViews],['MIN_FOLLOWERS',c.minFollowers],['SYNC_INTERVAL_MINUTES',c.syncIntervalMinutes],['STARTUP_RETRY_MS',c.startupRetryMs]]) if(!Number.isSafeInteger(value) || value<1) issues.push(name);
  if(c.syncIntervalMinutes>1440) issues.push('SYNC_INTERVAL_MINUTES');
  if(!c.milestones.length || c.milestones.some(v=>!Number.isSafeInteger(v)||v<1)) issues.push('VIRAL_MILESTONES');
  try { new Intl.DateTimeFormat('en',{timeZone:c.timezone}).format(); } catch { issues.push('REPORT_TIMEZONE'); }
  if(!/^\d{1,2} \d{1,2} \* \* \*$/.test(c.reportCron) || !cron.validate(c.reportCron)) issues.push('DAILY_REPORT_CRON');
  if(!/^\d{1,2} \d{1,2} \* \* 1$/.test(c.weeklyReportCron) || !cron.validate(c.weeklyReportCron)) issues.push('WEEKLY_REPORT_CRON');
  return [...new Set(issues)];
}
export function validateConfig(c = config) {
  const issues=configIssues(c);
  if(issues.length) throw new Error(`Missing or invalid configuration: ${issues.join(', ')}`);
  return c;
}
