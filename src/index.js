import cron from 'node-cron';
import { config, configIssues } from './config.js';
import { setupDatabase, pool, getCampaignSnapshot } from './db.js';
import { bot, registerCommands, updateLeaderboard, postDailyReport, postWeeklyReport, postCampaignSummary } from './bot.js';
import { startHttpServer, processQueue } from './webhooks.js';
import { syncAnalytics } from './sync.js';
import { retryUntilReady, createJob, safeError, shouldRetryInitialSync } from './runtime.js';
import { recoverPendingDeliveries } from './delivery.js';

const controller = new AbortController();
const timers = [];
const schedules = [];
const issues = configIssues();
let databaseInitialized = false;
let discordConfigured = false;
let shuttingDown = false;
let jobsInitialized = false;
let initialSyncComplete = false;
let initialSyncRetryable = true;

async function readiness() {
  let database = false;
  let lastSync = null;
  if(databaseInitialized && !shuttingDown) {
    try {
      if(config.campaignId) {
        const snapshot=await getCampaignSnapshot(config.campaignId);
        lastSync=snapshot?.syncedAt ? new Date(snapshot.syncedAt).getTime() : null;
      } else {
        const {rows}=await pool.query("SELECT completed_at FROM synchronization_history WHERE status='success' AND scope_key='organization' ORDER BY completed_at DESC LIMIT 1");
        lastSync=rows[0]?.completed_at?.getTime() ?? null;
      }
      database = true;
    } catch { /* readiness must fail closed */ }
  }
  const discord = discordConfigured && bot.isReady();
  const analytics = (!config.campaignId || initialSyncComplete) && lastSync !== null && Date.now()-lastSync < Math.max(config.syncIntervalMinutes*120000,300000);
  return {ready:!shuttingDown && !issues.length && database && discord && analytics && jobsInitialized, configuration:issues.length===0, database, discord, analytics, jobs:jobsInitialized};
}
const server = startHttpServer({readiness});
server.on('error', error=>{console.error(`[http] Listener failed (${safeError(error)})`);void close(1);});

const syncJob = createJob('sync', async()=>{
  if(!databaseInitialized || !config.apiKey || shuttingDown || issues.some(key=>['REPORT_TIMEZONE','VIRAL_MILESTONES','SYNC_INTERVAL_MINUTES','VIRAL_CAMPAIGN_ID'].includes(key))) return;
  let result;
  try { result = await syncAnalytics(); }
  catch(error) {initialSyncRetryable=shouldRetryInitialSync(error);throw error;}
  initialSyncComplete = true;
  console.info(`[sync] Stored ${result.accounts} creators, ${result.videos} videos, ${result.events} new milestone events`);
  if(discordConfigured && bot.isReady()) {
    await updateLeaderboard(false);
    await campaignSummaryJob();
  }
});
const campaignSummaryJob = createJob('campaign-summary',async()=>{
  if(databaseInitialized && discordConfigured && bot.isReady() && !shuttingDown) await postCampaignSummary();
});
const queueJob = createJob('queue',async()=>{
  if(databaseInitialized && discordConfigured && bot.isReady() && !shuttingDown) await processQueue();
});
const recoveryJob = createJob('delivery-recovery',async()=>{
  if(!databaseInitialized || !discordConfigured || !bot.isReady() || shuttingDown) return;
  const results = await recoverPendingDeliveries();
  const failures = results.filter(result=>result.error).length;
  if(failures) console.warn(`[delivery] ${failures} pending messages await retry`);
});
const dailyJob = createJob('daily',async()=>{
  if(databaseInitialized && bot.isReady() && !shuttingDown) await postDailyReport();
});
const weeklyJob = createJob('weekly',async()=>{
  if(databaseInitialized && bot.isReady() && !shuttingDown) await postWeeklyReport();
});

bot.on('error', error=>console.error(`[discord] Client error (${safeError(error)})`));
bot.on('shardError', error=>console.error(`[discord] Gateway error (${safeError(error)})`));
bot.on('clientReady',()=>{console.info('[discord] Gateway ready');});

if(issues.length) console.error(`[setup] Missing or invalid variables: ${issues.join(', ')}. Enter them in Railway Variables and redeploy. Service stays unready.`);

async function initialize() {
  // Database setup remains independently verifiable when third-party credentials are absent.
  if(config.databaseUrl && !issues.includes('DATABASE_URL')) {
    await retryUntilReady(async()=>{await setupDatabase();databaseInitialized=true;console.info('[database] Migrations complete and connection verified');},{signal:controller.signal,baseMs:config.startupRetryMs});
  }
  if(shuttingDown || !databaseInitialized) return;
  timers.push(setInterval(()=>void queueJob(),15000));
  if(config.apiKey && !issues.includes('SYNC_INTERVAL_MINUTES')) {
    timers.push(setInterval(()=>void syncJob(),config.syncIntervalMinutes*60000));
    // Recover startup outages within the health-check window; provider Retry-After still applies.
    timers.push(setInterval(()=>{if(!initialSyncComplete && initialSyncRetryable) void syncJob();},30000));
    void syncJob();
  }
  // Invalid configuration is not a transient error; do not repeatedly attempt login.
  if(issues.length) return;
  await retryUntilReady(async()=>{
    if(!bot.isReady()) await bot.login(config.token);
    if(!bot.isReady()) {
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{cleanup();reject(Object.assign(new Error(),{code:'DISCORD_READY_TIMEOUT'}));},45000);
        const ready=()=>{cleanup();resolve();};
        const cleanup=()=>{clearTimeout(timeout);bot.off('clientReady',ready);};
        bot.once('clientReady',ready);
        if(bot.isReady()) ready();
      });
    }
    await registerCommands();
    // Validate every destination before declaring Discord configured.
    for(const id of new Set(Object.values(config.channels).filter(Boolean))) {
      const channel=await bot.channels.fetch(id);
      if(channel?.guildId!==config.guildId || !channel.isTextBased() || typeof channel.send!=='function') throw Object.assign(new Error(),{code:'CHANNEL_ACCESS_INVALID'});
      const permissions=channel.permissionsFor(bot.user);
      if(!permissions?.has(['ViewChannel','SendMessages','EmbedLinks','ReadMessageHistory'])) throw Object.assign(new Error(),{code:'CHANNEL_PERMISSIONS_MISSING'});
    }
    discordConfigured=true;
  },{signal:controller.signal,baseMs:config.startupRetryMs});
  if(shuttingDown) return;
  schedules.push(cron.schedule(config.reportCron,()=>void dailyJob(),{timezone:config.timezone,noOverlap:true}));
  schedules.push(cron.schedule(config.weeklyReportCron,()=>void weeklyJob(),{timezone:config.timezone,noOverlap:true}));
  jobsInitialized=true;
  timers.push(setInterval(()=>void recoveryJob(),60000));
  await recoveryJob();
  // Report functions check local due time + durable keys. Retrying also catches a missed 09:00 after restart.
  timers.push(setInterval(()=>{void dailyJob();void weeklyJob();void campaignSummaryJob();},60000));
  await syncJob();
  await dailyJob();
  await weeklyJob();
  console.info(`[scheduler] Daily ${config.reportCron}; weekly ${config.weeklyReportCron}; timezone ${config.timezone}; sync every ${config.syncIntervalMinutes} minutes`);
}
void initialize().catch(error=>console.error(`[startup] Initialization stopped (${safeError(error)})`));

async function close(exitCode=0) {
  if(shuttingDown) return;
  shuttingDown=true;
  controller.abort();
  timers.forEach(clearInterval);
  schedules.forEach(task=>task.stop());
  const force=setTimeout(()=>process.exit(exitCode),10000);force.unref();
  await Promise.allSettled([bot.destroy(),new Promise(resolve=>server.close(resolve)),pool.end()]);
  clearTimeout(force);
  process.exit(exitCode);
}
process.once('SIGINT',()=>void close());
process.once('SIGTERM',()=>void close());
