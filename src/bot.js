import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { getState, setState, pool } from './db.js';
import { getAnalytics } from './analytics.js';
import { localDate } from './utils.js';
import { METRICS, rankingEmbed, videosEmbed, creatorEmbed, statisticsEmbed, reportEmbeds, latinText, creatorAliases } from './presentation.js';
import { answerQuestion } from './ai.js';
import { deliverOnce, guildChannel, scopedDeliveryKey } from './delivery.js';

export const bot = new Client({intents:[GatewayIntentBits.Guilds]});
const lastAIRequest=new Map();
let lastLeaderboardRun=0, leaderboardUpdating=false;
const inConfiguredScope=(snapshot,configuration=config)=>!configuration.campaignId || snapshot.scope?.type==='campaign' && snapshot.scope.id===configuration.campaignId;
const PERIOD_CHOICES=[{name:'Denes',value:'today'},{name:'Vchera',value:'yesterday'},{name:'Ovaa nedela',value:'week'},
  {name:'Minatata nedela',value:'previous_week'},{name:'Ovoj mesec',value:'month'},{name:'Poslednite 30 dena',value:'last30'},{name:'Vkupno',value:'all'}];
const withPeriod=command=>command.addStringOption(option=>option.setName('period').setDescription('Izberi period za izvestajot').addChoices(...PERIOD_CHOICES));
const withMetric=command=>command.addStringOption(option=>option.setName('metrika').setDescription('Kako da gi rangirame kreatorite?')
  .addChoices(...Object.entries(METRICS).map(([value,meta])=>({name:meta.title,value}))));

export const commands=[
  withPeriod(withMetric(new SlashCommandBuilder().setName('leaderboard').setDescription('Eve gi najdobrite Footly kreatori'))),
  withPeriod(withMetric(new SlashCommandBuilder().setName('top').setDescription('Footly leaderboard'))),
  withPeriod(new SlashCommandBuilder().setName('topvideos').setDescription('Najviralni videa od sledeni kreatori')
    .addStringOption(option=>option.setName('metrika').setDescription('Pregledi za rangiranje').addChoices({name:'Vkupno pregledi',value:'vkupno'},{name:'Novi pregledi vo periodot',value:'period'}))),
  withPeriod(new SlashCommandBuilder().setName('kreator').setDescription('Statistika za odreden kreator')
    .addStringOption(option=>option.setName('username').setDescription('Korisnichko ime na kreatorot').setRequired(true).setMaxLength(100))
    .addStringOption(option=>option.setName('platforma').setDescription('Platforma, ako kreatorot ima povekje profili').setMaxLength(30))),
  withPeriod(new SlashCommandBuilder().setName('statistika').setDescription('Vkupna Footly analitika i opfat')),
  new SlashCommandBuilder().setName('izvestaj').setDescription('Pregled na dnevniot ili nedelniot izvestaj')
    .addStringOption(option=>option.setName('tip').setDescription('Tip na izvestaj').addChoices({name:'Dneven',value:'daily'},{name:'Nedelen',value:'weekly'})),
  new SlashCommandBuilder().setName('prasaj').setDescription('Prashaj go Footly Growth AI za kreatorite')
    .addStringOption(option=>option.setName('prashanje').setDescription('Shto sakash da znaesh?').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('prashaj').setDescription('Razgovaraj so Footly AI za idei, slideshow i analitika')
    .addStringOption(option=>option.setName('prashanje').setDescription('Shto sakash da znaesh?').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('status').setDescription('Proveri go statusot na botot'),
  new SlashCommandBuilder().setName('osvezi').setDescription('Sinhroniziraj i osvezhi go leaderboardot').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('test').setDescription('Privatna proverka na botot').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

export async function registerCommands() {
  await new REST({version:'10'}).setToken(config.token).put(Routes.applicationGuildCommands(config.clientId,config.guildId),{body:commands.map(command=>command.toJSON())});
  console.info('[discord] Guild commands registered');
}

export async function sendToChannel(channelId,embeds) {
  const channel=await guildChannel(bot,channelId,config.guildId);
  return channel.send({embeds:Array.isArray(embeds)?embeds:[embeds],allowedMentions:{parse:[]}});
}

export async function updateLeaderboard(force=false) {
  if(!config.channels.leaderboard || leaderboardUpdating || !bot.isReady()) return false;
  if(!force && Date.now()-lastLeaderboardRun<10*60*1000) return false;
  leaderboardUpdating=true;
  try {
    const snapshot=await getAnalytics({period:'week'});
    if(!snapshot.syncedAt || !inConfiguredScope(snapshot)) return false;
    const embed=rankingEmbed(snapshot.accounts,snapshot.accounts.length,'nedela',{snapshot});
    const channel=await guildChannel(bot,config.channels.leaderboard,config.guildId);
    const previous=await getState('leaderboard_message');
    let message;
    if(previous) {
      try {
        message=await channel.messages.fetch(previous);
        if(message.author.id!==bot.user.id) throw new Error('Leaderboard message is not owned by this bot');
        await message.edit({embeds:[embed],allowedMentions:{parse:[]}});
      } catch(error) {if(error.code!==10008) throw error;message=undefined;}
    }
    if(!message) {
      const id=await deliverOnce(scopedDeliveryKey(`leaderboard:${config.channels.leaderboard}:${previous || 'initial'}`,snapshot.scope?.type==='campaign'?snapshot.scope.id:null),config.channels.leaderboard,embed);
      await setState('leaderboard_message',id);
    }
    lastLeaderboardRun=Date.now();
    await setState('last_leaderboard_update',new Date().toISOString());
    return true;
  } finally {leaderboardUpdating=false;}
}

export async function buildDailyReport() { return reportEmbeds(await getAnalytics({period:'yesterday'}),'daily'); }
export async function buildWeeklyReport() { return reportEmbeds(await getAnalytics({period:'previous_week'}),'weekly'); }

export function reportIsDue(type,now=new Date(),timezone=config.timezone,schedule=type==='weekly'?config.weeklyReportCron:config.reportCron) {
  const match=/^(\d{1,2}) (\d{1,2}) \* \* (\*|1)$/.exec(schedule);
  if(!match || Number(match[1])>59 || Number(match[2])>23) return false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',weekday:'short'}).formatToParts(now).map(part=>[part.type,part.value]));
  const timeDue=Number(parts.hour)*60+Number(parts.minute)>=Number(match[2])*60+Number(match[1]);
  return type==='weekly' ? parts.weekday!=='Mon' || timeDue : timeDue;
}

export async function postScheduledReport(type,options={}) {
  const now=options.now || new Date(), c=options.configuration || config;
  const ready=options.isReady || (()=>bot.isReady());
  const channelId=type==='weekly' ? c.channels.weekly || c.channels.daily : c.channels.daily;
  if(!channelId || !ready() || !reportIsDue(type,now,c.timezone,type==='weekly'?c.weeklyReportCron:c.reportCron)) return false;
  const snapshot=await (options.getAnalytics || getAnalytics)({period:type==='weekly'?'previous_week':'yesterday',now,timezone:c.timezone});
  if(!inConfiguredScope(snapshot,c)) return false;
  if(!snapshot.syncedAt || !Number.isFinite(Date.parse(snapshot.coverage.periodObservedAt)) || new Date(snapshot.syncedAt)<new Date(snapshot.period.end) || !snapshot.coverage.periodAvailable ||
    new Date(snapshot.coverage.periodObservedAt)<new Date(snapshot.period.end)) return false;
  if(snapshot.accounts.length && !snapshot.accounts.some(account=>account.viewCountInPeriod!=null)) return false;
  const database=options.database || pool;
  // Preserve v1's report claim to avoid repeating a report during an upgrade.
  if(type==='daily' && snapshot.scope?.type!=='campaign') {
    const legacy=await database.query('SELECT report_key FROM sent_reports WHERE report_key=$1',[`daily:${localDate(now,c.timezone)}`]);
    if(legacy.rowCount) return false;
  }
  const key=scopedDeliveryKey(`report:${type}:${snapshot.period.from}:${snapshot.period.to}`,snapshot.scope?.type==='campaign'?snapshot.scope.id:null);
  await (options.deliverOnce || deliverOnce)(key,channelId,reportEmbeds(snapshot,type));
  return true;
}
export async function postDailyReport(options) { return postScheduledReport('daily',options); }
export async function postWeeklyReport(options) { return postScheduledReport('weekly',options); }

export async function postCampaignSummary(options={}) {
  const c=options.configuration || config;
  if(!c.campaignId || !c.channels.daily || !(options.isReady || (()=>bot.isReady()))()) return false;
  const snapshot=await (options.getAnalytics || getAnalytics)({period:'all',now:options.now || new Date(),timezone:c.timezone});
  if(!inConfiguredScope(snapshot,c) || !snapshot.syncedAt || !snapshot.coverage.inventoryComplete) return false;
  await (options.deliverOnce || deliverOnce)(scopedDeliveryKey('launch-summary',snapshot.scope.id),c.channels.daily,reportEmbeds(snapshot,'campaign'));
  return true;
}

const replyPayload=embeds=>({embeds:Array.isArray(embeds)?embeds:[embeds],allowedMentions:{parse:[]}});
export async function handleInteraction(interaction,dependencies={}) {
  const guildId=dependencies.guildId || config.guildId;
  if(!interaction.isChatInputCommand() || interaction.guildId!==guildId) return;
  const load=dependencies.getAnalytics || getAnalytics;
  const name=interaction.commandName;
  try {
    if(['osvezi','test'].includes(name) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({content:'Za ovaa komanda ti treba dozvola Manage Server.',ephemeral:true});return;
    }
    if(name==='test') {
      await interaction.reply({...replyPayload(new EmbedBuilder().setColor(0x34db83).setTitle('✅ Footly botot raboti!').setDescription('Ova e privatna proverka.')),ephemeral:true});return;
    }
    if(name==='prasaj' || name==='prashaj') {
      if(config.channels.ai && interaction.channelId!==config.channels.ai) {
        await interaction.reply({content:`Koristi ja ovaa komanda vo <#${config.channels.ai}>.`,ephemeral:true,allowedMentions:{parse:[]}});return;
      }
      const now=Date.now();
      for(const [id,time] of lastAIRequest) if(now-time>60000) lastAIRequest.delete(id);
      if(now-(lastAIRequest.get(interaction.user.id) || 0)<30000) {
        await interaction.reply({content:'Probaj povtorno za 30 sekundi.',ephemeral:true});return;
      }
      lastAIRequest.set(interaction.user.id,now);
      await interaction.deferReply();
      const answer=await (dependencies.answerQuestion || answerQuestion)(interaction.options.getString('prashanje',true));
      await interaction.editReply({...replyPayload(new EmbedBuilder().setColor(0x34db83).setTitle('🤖 Footly Growth AI').setDescription(latinText(answer).slice(0,3800))),allowedMentions:{parse:[]}});return;
    }
    if(name==='osvezi') {
      await interaction.deferReply({ephemeral:true});
      const sync=dependencies.syncAnalytics || (await import('./sync.js')).syncAnalytics;
      await sync();
      const updated=await (dependencies.updateLeaderboard || updateLeaderboard)(true);
      await interaction.editReply({content:updated?'✅ Podatocite i leaderboardot se osvezheni!':'Podatocite se obrabotuvaat. Probaj povtorno podocna.'});return;
    }
    if(name==='status') {
      await interaction.deferReply({ephemeral:true});
      const snapshot=await load({period:'week'});
      const {rows}=await pool.query("SELECT count(*)::integer AS pending FROM viral_events WHERE status IN ('pending','processing')");
      const timestamp=snapshot.syncedAt ? new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(snapshot.syncedAt)) : 'nema';
      await interaction.editReply({content:`✅ Botot e online.\nNastani vo redica: **${rows[0].pending}**\nPosledna sinhronizacija: **${timestamp}** (${config.timezone}).`});return;
    }
    await interaction.deferReply();
    if(name==='izvestaj') {
      const type=interaction.options.getString('tip') || 'daily';
      await interaction.editReply(replyPayload(reportEmbeds(await load({period:type==='weekly'?'previous_week':'yesterday'}),type)));return;
    }
    const metric=interaction.options.getString('metrika') || 'nedela';
    const period=interaction.options.getString('period') || (name==='topvideos'?(metric==='period'?'week':'all'):METRICS[metric]?.period || 'week');
    const snapshot=await load({period});
    if(['leaderboard','top'].includes(name)) await interaction.editReply(replyPayload(rankingEmbed(snapshot.accounts,snapshot.accounts.length,metric,{snapshot})));
    else if(name==='topvideos') await interaction.editReply(replyPayload(videosEmbed(snapshot,interaction.options.getString('metrika') || 'vkupno')));
    else if(name==='statistika') await interaction.editReply(replyPayload(statisticsEmbed(snapshot)));
    else if(name==='kreator') {
      const username=latinText(interaction.options.getString('username',true)).trim().replace(/^@/,'').toLowerCase();
      const platform=interaction.options.getString('platforma')?.toLowerCase();
      const matches=snapshot.accounts.filter(account=>creatorAliases(account).includes(username) && (!platform || String(account.platform).toLowerCase()===platform || (account.connectedAccounts || []).some(row=>String(row.platform).toLowerCase()===platform)));
      if(matches.length>1) await interaction.editReply({content:'Najdov povekje profili. Dodadi platforma za tochniot kreator.',allowedMentions:{parse:[]}});
      else if(matches.length) await interaction.editReply(replyPayload(creatorEmbed(matches[0],snapshot)));
      else await interaction.editReply({content:'Nema sleden kreator so toa korisnichko ime.',allowedMentions:{parse:[]}});
    } else await interaction.editReply({content:'Ovaa komanda ne e dostapna.'});
  } catch(error) {
    console.error('[discord] Command failed',/^\d+$/.test(String(error.code || '')) ? error.code : 'COMMAND_FAILED');
    const payload={content:'⚠️ Podatocite momentalno ne se dostapni. Probaj povtorno podocna.',embeds:[],allowedMentions:{parse:[]}};
    try {
      if(interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply({...payload,ephemeral:true});
    } catch { /* The interaction may have expired; never leak provider errors. */ }
  }
}
bot.on('interactionCreate',interaction=>{void handleInteraction(interaction);});
