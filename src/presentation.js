import { EmbedBuilder } from 'discord.js';
import { fmt, label, n, pct, safeLink } from './utils.js';

const GREEN = 0x34db83;
const GOLD = 0xf7c75b;
const BLUE = 0x6499ff;
const RANK = ['🥇', '🥈', '🥉'];

export function viralEmbed(event) {
  const { video, account, milestone, viewCount } = event.data;
  const handle = label(account);
  const e = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🚀 VIRAL ALERT — ${handle}`)
    .setDescription(`Video od **${handle}** stigna do **${fmt(milestone)} pregledi**! 🔥`)
    .addFields(
      { name: '👀 Momentalni pregledi', value: fmt(viewCount), inline: true },
      { name: '📱 Platforma', value: String(account?.platform || video?.platform || '—'), inline: true },
      { name: '🏆 Milestone', value: fmt(milestone), inline: true },
    )
    .setFooter({ text: 'Footly Growth Bot • Podatoci od Viral.app' }).setTimestamp(new Date());
  const url = safeLink(video?.url);
  if (url) e.setURL(url);
  const image = safeLink(video?.thumbnailUrl);
  if (image) e.setThumbnail(image);
  return e;
}
export function followersEmbed(event) {
  const { account, milestone, followerCount } = event.data;
  return new EmbedBuilder().setColor(GREEN).setTitle(`📈 ${label(account)} raste!`)
    .setDescription(`Profilot ja pomina granicata od **${fmt(milestone)} sledbenici**. 🎉`)
    .addFields({ name: '👥 Vkupno sledbenici', value: fmt(followerCount), inline: true },
      { name: '📱 Platforma', value: String(account?.platform || '—'), inline: true })
    .setFooter({ text: 'Footly Growth Bot • Viral.app' }).setTimestamp();
}
export function publishedEmbed(event) {
  const { account, video } = event.data;
  const e = new EmbedBuilder().setColor(BLUE).setTitle(`🎬 Novo video — ${label(account)}`)
    .setDescription(`Nova objava na ${String(account?.platform || 'socijalna mrezha')}.`)
    .setFooter({ text: 'Footly Growth Bot' }).setTimestamp();
  const url = safeLink(video?.url);
  if (url) e.setURL(url);
  return e;
}

export const METRICS = {
  nedela: { api: 'viewCountInPeriod', field: 'viewCountInPeriod', title: 'Pregledi vo poslednite 7 dena', days: 7 },
  mesec: { api: 'viewCountInPeriod', field: 'viewCountInPeriod', title: 'Pregledi vo poslednite 30 dena', days: 30 },
  vkupno: { api: 'viewCount', field: 'viewCount', title: 'Vkupno pregledi (lifetime)', days: 30 },
  sledbenici: { api: 'viewCount', field: 'followerCount', title: 'Najgolemi profili po sledbenici', days: 30 },
  objavi: { api: 'videoCountInPeriod', field: 'videoCountInPeriod', title: 'Najmnogu objavi vo poslednite 7 dena', days: 7 },
  engagement: { api: 'engagementRateInPeriod', field: 'engagementRateInPeriod', title: 'Engagement vo poslednite 7 dena', days: 7 },
};

export function rankingEmbed(accounts, count, metricName, { isPartial = false } = {}) {
  const m = METRICS[metricName] || METRICS.nedela;
  const sorted = [...accounts].filter(a => a[m.field] != null).sort((a, b) => n(b[m.field]) - n(a[m.field])).slice(0, 10);
  const formatted = sorted.map((a, i) => {
    const val = metricName === 'engagement' ? pct(a[m.field]) : fmt(a[m.field]);
    return `${RANK[i] || `\`${i + 1}.\``} **${label(a)}** · ${a.platform || '—'}\n     ${val}${metricName === 'engagement' ? '' : metricName === 'sledbenici' ? ' sledbenici' : metricName === 'objavi' ? ' objavi' : ' pregledi'}`;
  });
  const e = new EmbedBuilder().setColor(GREEN)
    .setTitle(`🏆 FOOTLY LEADERBOARD — ${m.title}`)
    .setDescription(formatted.length ? formatted.join('\n\n') : 'Se ushte nema podatoci za ovoj period.')
    .setTimestamp().setFooter({ text: 'Avtomatski azhurirano • Viral.app' });
  if (isPartial) e.addFields({ name: '⚠️ Opfat', value: 'Viral.app top-accounts API vrakja do 100 profili. Ova e ranking od prvite 100 po API sortiranjeto, ne od site profili.' });
  return e;
}

export function dailyEmbed(accounts, count, isPartial = false) {
  const total = accounts.reduce((sum, a) => sum + n(a.viewCountInPeriod), 0);
  const posts = accounts.reduce((sum, a) => sum + n(a.videoCountInPeriod), 0);
  const leaders = [...accounts].sort((a,b) => n(b.viewCountInPeriod) - n(a.viewCountInPeriod)).slice(0,3);
  const e = new EmbedBuilder().setColor(BLUE).setTitle('📊 FOOTLY — Dneven growth izvestaj')
    .setDescription('Pregled za **vcherashniot den** (Europe/Skopje).')
    .addFields(
      { name: '👀 Novi pregledi', value: fmt(total), inline: true },
      { name: '🎬 Novi objavi', value: fmt(posts), inline: true },
      { name: '👥 Sledeni profili', value: String(count), inline: true },
      { name: '🔥 Najdobri profili', value: leaders.length ? leaders.map((a,i) => `${i+1}. ${label(a)} — ${fmt(a.viewCountInPeriod)} pregledi`).join('\n') : 'Nema podatoci.' },
    ).setTimestamp().setFooter({ text: 'Footly Growth Bot • Viral.app' });
  if (isPartial) e.addFields({ name: '⚠️ Delumni podatoci', value: 'Zbirot gi pokriva samo profilite vrateni od top-100 API, ne celata organizacija.' });
  return e;
}
