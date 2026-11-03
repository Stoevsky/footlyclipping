import cron from 'node-cron';
import { config, validateConfig } from './config.js';
import { setupDatabase, pool } from './db.js';
import { bot, registerCommands, updateLeaderboard, postDailyReport } from './bot.js';
import { startHttpServer, processQueue } from './webhooks.js';

validateConfig();
await setupDatabase();
startHttpServer();

bot.once('ready', async () => {
  console.info(`[discord] Online kako ${bot.user.tag}`);
  try { await registerCommands(); }
  catch (err) { console.error('[discord] Registracija na komandi ne uspea', err); }
  try { await updateLeaderboard(false); }
  catch (err) { console.error('[leaderboard] Pochetno osvezhuvanje ne uspea', err); }
});

await bot.login(config.token);
const queueTimer = setInterval(() => { void processQueue(); }, 15000);
queueTimer.unref();

cron.schedule(config.reportCron, () => {
  void postDailyReport().catch(err => console.error('[daily] Greshka', err));
}, { timezone: config.timezone, noOverlap: true });

async function close() {
  console.info('[shutdown] Iskluchuvanje...');
  clearInterval(queueTimer);
  bot.destroy();
  await pool.end();
  process.exit(0);
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
