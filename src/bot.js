import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { getState, setState, pool } from './db.js';
import { topAccounts, trackedCount, clearCache } from './viral.js';
import { METRICS, rankingEmbed, dailyEmbed } from './presentation.js';
import { answerQuestion } from './ai.js';

export const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
const lastAIRequest = new Map();
let lastLeaderboardRun = 0;
let leaderboardUpdating = false;

export const commands = [
  new SlashCommandBuilder().setName('top').setDescription('Footly leaderboard od Viral.app')
    .addStringOption(option => option.setName('metrika').setDescription('Kako da gi rangirame profilite?').setRequired(true)
      .addChoices(
        { name: 'Novi pregledi - 7 dena', value: 'nedela' },
        { name: 'Novi pregledi - 30 dena', value: 'mesec' },
        { name: 'Vkupno pregledi', value: 'vkupno' },
        { name: 'Najmnogu sledbenici', value: 'sledbenici' },
        { name: 'Najmnogu novi objavi', value: 'objavi' },
        { name: 'Najdobar engagement', value: 'engagement' },
      )),
  new SlashCommandBuilder().setName('izvestaj').setDescription('Prikazhi izvestaj za vcherashniot den'),
  new SlashCommandBuilder().setName('prasaj').setDescription('Prashaj go Footly Growth AI za Viral.app statistikata')
    .addStringOption(option => option.setName('prashanje').setDescription('Shto sakash da znaesh?').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('status').setDescription('Proveri go statusot na botot'),
  new SlashCommandBuilder().setName('osvezi').setDescription('Rachno osvezhi go glavniot leaderboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('test').setDescription('Testiraj go botot bez javni notifikacii')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands.map(c => c.toJSON()) });
  console.info('[discord] Komandite se registrirani.');
}

export async function sendToChannel(channelId, embeds) {
  if (!channelId) return null;
  const channel = await bot.channels.fetch(channelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error(`Nevaliden Discord kanal: ${channelId}`);
  return channel.send({ embeds: Array.isArray(embeds) ? embeds : [embeds], allowedMentions: { parse: [] } });
}

function metricConfig(metricName) { return METRICS[metricName] || METRICS.nedela; }
async function metricData(metricName) {
  const meta = metricConfig(metricName);
  const [accounts, count] = await Promise.all([topAccounts({ days: meta.days, metric: meta.api }), trackedCount()]);
  return { accounts, count, isPartial: count > 100 };
}

export async function updateLeaderboard(force = false) {
  if (!config.channels.leaderboard || leaderboardUpdating || !bot.isReady()) return false;
  if (!force && Date.now() - lastLeaderboardRun < 10 * 60 * 1000) return false;
  leaderboardUpdating = true;
  try {
    if (force) clearCache();
    const { accounts, count, isPartial } = await metricData('nedela');
    const embed = rankingEmbed(accounts, count, 'nedela', { isPartial });
    const channel = await bot.channels.fetch(config.channels.leaderboard);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error('Leaderboard kanalot e nevaliden.');
    const lastMessageId = await getState('leaderboard_message');
    let message;
    if (lastMessageId) {
      try {
        message = await channel.messages.fetch(lastMessageId);
        await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
      } catch (error) {
        // Ako porakata e izbrishana, se kreira nova. Inaku prijavi ja greshkata.
        if (error.code !== 10008) throw error;
      }
    }
    if (!message) {
      message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await setState('leaderboard_message', message.id);
    }
    lastLeaderboardRun = Date.now();
    await setState('last_leaderboard_update', new Date().toISOString());
    return true;
  } finally { leaderboardUpdating = false; }
}

export async function buildDailyReport() {
  const [accounts, count] = await Promise.all([
    topAccounts({ days: 1, metric: 'viewCountInPeriod', yesterday: true }), trackedCount(),
  ]);
  return dailyEmbed(accounts, count, count > 100);
}

export async function postDailyReport() {
  if (!config.channels.daily) return false;
  const key = `daily:${new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}`;
  // Edna bot instanca. Unique key sprechuva dupla objava pri restart.
  const claim = await pool.query('INSERT INTO sent_reports(report_key) VALUES($1) ON CONFLICT DO NOTHING RETURNING report_key', [key]);
  if (!claim.rowCount) return false;
  try {
    await sendToChannel(config.channels.daily, await buildDailyReport());
    return true;
  } catch (err) {
    await pool.query('DELETE FROM sent_reports WHERE report_key=$1', [key]);
    throw err;
  }
}

bot.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;
  try {
    if (interaction.commandName === 'top') {
      await interaction.deferReply();
      const metric = interaction.options.getString('metrika', true);
      const { accounts, count, isPartial } = await metricData(metric);
      await interaction.editReply({ embeds: [rankingEmbed(accounts, count, metric, { isPartial })], allowedMentions: { parse: [] } });
    } else if (interaction.commandName === 'izvestaj') {
      await interaction.deferReply();
      await interaction.editReply({ embeds: [await buildDailyReport()] });
    } else if (interaction.commandName === 'prasaj') {
      if (config.channels.ai && interaction.channelId !== config.channels.ai) {
        await interaction.reply({ content: 'Koristi ja ovaa komanda vo #footly-ai kanalot.', ephemeral: true });
        return;
      }
      const now = Date.now();
      if (now - (lastAIRequest.get(interaction.user.id) || 0) < 30000) {
        await interaction.reply({ content: 'Probaj povtorno za 30 sekundi.', ephemeral: true });
        return;
      }
      lastAIRequest.set(interaction.user.id, now);
      await interaction.deferReply();
      const answer = await answerQuestion(interaction.options.getString('prashanje', true));
      await interaction.editReply({ content: `🤖 **Footly Growth AI**\n${answer}`, allowedMentions: { parse: [] } });
    } else if (interaction.commandName === 'status') {
      const { rows } = await pool.query("SELECT count(*)::integer AS pending FROM viral_events WHERE status='pending'");
      const last = await getState('last_leaderboard_update');
      await interaction.reply({ content: `✅ Botot e online.\n📥 Webhook eventi vo redica: **${rows[0].pending}**\n🏆 Posledno osvezhuvanje: **${last || 'nema'}**`, ephemeral: true });
    } else if (interaction.commandName === 'osvezi') {
      await interaction.deferReply({ ephemeral: true });
      const updated = await updateLeaderboard(true);
      await interaction.editReply(updated ? '✅ Leaderboard e osvezhen!' : '⚠️ Leaderboard ne mozhe da se osvezhi vo momentov.');
    } else if (interaction.commandName === 'test') {
      const testEmbed = new EmbedBuilder().setColor(0x34db83).setTitle('✅ Footly Growth Bot raboti!')
        .setDescription('Ova e privatna test poraka. Ne e ispratena na kanalite.');
      await interaction.reply({ embeds: [testEmbed], ephemeral: true });
    }
  } catch (err) {
    console.error('[discord] command error', err);
    const message = `⚠️ Nastana greshka. ${String(err.message || '').slice(0, 160)}`;
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, embeds: [] });
      else await interaction.reply({ content: message, ephemeral: true });
    } catch { /* interaction mozhe da isteche */ }
  }
});
