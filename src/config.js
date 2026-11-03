export const config = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  apiKey: process.env.VIRAL_API_KEY,
  webhookSecret: process.env.VIRAL_WEBHOOK_SECRET,
  organizationId: process.env.VIRAL_ORG_ID || null,
  databaseUrl: process.env.DATABASE_URL,
  databaseSSL: process.env.DATABASE_SSL === 'true',
  port: Number(process.env.PORT) || 3000,
  channels: {
    viral: process.env.CHANNEL_VIRAL_ALERTS,
    leaderboard: process.env.CHANNEL_LEADERBOARD,
    daily: process.env.CHANNEL_DAILY_ANALYTICS,
    growth: process.env.CHANNEL_CREATOR_GROWTH,
    ai: process.env.CHANNEL_FOOTLY_AI,
    videos: process.env.CHANNEL_NEW_VIDEOS,
  },
  minViews: Number(process.env.MIN_VIRAL_VIEWS) || 50000,
  minFollowers: Number(process.env.MIN_FOLLOWERS) || 10000,
  reportCron: process.env.DAILY_REPORT_CRON || '0 9 * * *',
  timezone: process.env.REPORT_TIMEZONE || 'Europe/Skopje',
  openaiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
};

export function validateConfig() {
  const missing = [
    ['DISCORD_BOT_TOKEN', config.token],
    ['DISCORD_CLIENT_ID', config.clientId],
    ['DISCORD_GUILD_ID', config.guildId],
    ['VIRAL_API_KEY', config.apiKey],
    ['VIRAL_WEBHOOK_SECRET', config.webhookSecret],
    ['DATABASE_URL', config.databaseUrl],
    ['CHANNEL_VIRAL_ALERTS', config.channels.viral],
    ['CHANNEL_LEADERBOARD', config.channels.leaderboard],
    ['CHANNEL_DAILY_ANALYTICS', config.channels.daily],
    ['CHANNEL_CREATOR_GROWTH', config.channels.growth],
    ['CHANNEL_FOOTLY_AI', config.channels.ai],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Nedostasuvaat env promenlivi: ${missing.join(', ')}`);
  if (!config.channels.videos) console.info('[setup] CHANNEL_NEW_VIDEOS ne e postaven: novi objavi nema da se prakaat.');
}
