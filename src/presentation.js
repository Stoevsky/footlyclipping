import { EmbedBuilder } from 'discord.js';
import { safeLink } from './utils.js';

const GREEN = 0x34db83, GOLD = 0xf7c75b, BLUE = 0x6499ff;
const alphabet = {'а':'a','б':'b','в':'v','г':'g','д':'d','ѓ':'gj','е':'e','ж':'zh','з':'z','ѕ':'dz','и':'i','ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n','њ':'nj','о':'o','п':'p','р':'r','с':'s','т':'t','ќ':'kj','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','џ':'dzh','ш':'sh','ё':'jo','й':'j','щ':'sht','ъ':'','ы':'i','ь':'','э':'e','ю':'ju','я':'ja'};
export function latinText(value) {
  return String(value ?? '').replace(/[\u0400-\u04ff]/gu,letter=>{
    const replacement=alphabet[letter.toLowerCase()] ?? '';
    return letter === letter.toUpperCase() ? replacement.charAt(0).toUpperCase()+replacement.slice(1) : replacement;
  }).normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/\u0000/gu,'');
}
const short = (value,max=1000) => latinText(value).slice(0,max);
export const numberText = value => value == null || !Number.isFinite(Number(value)) ? 'Nema podatoci' : Math.round(Number(value)).toLocaleString('en-US');
export const percentText = value => value == null || !Number.isFinite(Number(value)) ? 'Nema podatoci' : `${(Number(value)*100).toFixed(1)}%`;
export const accountLabel = account => `@${short(account?.username || account?.accountUsername || 'nepoznat',45).replace(/^@/,'').replace(/([\\`*_~|>])/g,'\\$1')}`;
const field = (name,value,inline=false) => ({name:short(name,250),value:short(value || 'Nema podatoci',1024),inline});
const base = (title,color=GREEN) => new EmbedBuilder().setTitle(short(title,256)).setColor(color).setFooter({text:'Footly • Viral.app'}).setTimestamp();
export const periodText = snapshot => `${snapshot.period.from} - ${snapshot.period.to} (${snapshot.period.timezone})`;

export function withCoverage(embed,snapshot) {
  const notes=snapshot.coverage?.notes || [];
  if(notes.length) embed.addFields(field('Opfat i ogranichuvanja',notes.join('\n')));
  if(snapshot.syncedAt) embed.setTimestamp(new Date(snapshot.syncedAt));
  return embed;
}

export const METRICS = {
  nedela:{field:'viewCountInPeriod',title:'Pregledi ovaa nedela',period:'week',unit:'pregledi'},
  mesec:{field:'viewCountInPeriod',title:'Pregledi ovoj mesec',period:'month',unit:'pregledi'},
  vkupno:{field:'viewCount',title:'Vkupno sledeni pregledi',period:'all',unit:'pregledi'},
  sledbenici:{field:'followerCount',title:'Najgolemi profili',period:'all',unit:'sledbenici'},
  objavi:{field:'videoCountInPeriod',title:'Najredovni kreatori',period:'week',unit:'objavi'},
  engagement:{field:'engagementRateInPeriod',title:'Najdobar engagement',period:'week',unit:'engagement'},
  rast:{field:'followerGrowth',title:'Rast na sledbenici',period:'week',unit:'sledbenici'},
};
export function rankRows(rows,fieldName,limit=10) {
  return rows.filter(row=>row[fieldName]!=null && Number.isFinite(Number(row[fieldName])))
    .sort((a,b)=>Number(b[fieldName])-Number(a[fieldName]) || String(a.id).localeCompare(String(b.id))).slice(0,limit);
}

export function rankingEmbed(accounts,count,metricName,{snapshot,isPartial=false}={}) {
  const metric=METRICS[metricName] || METRICS.nedela;
  const fieldName=snapshot?.period.key==='all' ? (metricName==='engagement'?'engagementRate':['nedela','mesec'].includes(metricName)?'viewCount':metric.field) : metric.field;
  const ranked=rankRows(accounts,fieldName);
  const lines=ranked.map((account,index)=>`${index+1}. **${accountLabel(account)}** · ${short(account.platform,30)}\n${metricName==='engagement'?percentText(account[fieldName]):numberText(account[fieldName])} ${metricName==='engagement'?'':metric.unit}`);
  const title=['nedela','mesec'].includes(metricName) && snapshot ? (snapshot.period.key==='all'?'Vkupno sledeni pregledi':'Pregledi vo izbraniot period') : metric.title;
  const embed=base(`🏆 FOOTLY LEADERBOARD — ${title}`).setDescription(lines.join('\n\n') || 'Nema podatoci za ovoj period.');
  embed.addFields(field('Opfat',`${accounts.length} od ${count} sledeni profili; rangirani se samo poznati vrednosti.`));
  if(snapshot) {embed.addFields(field('Period',periodText(snapshot)));withCoverage(embed,snapshot);}
  else if(isPartial) embed.addFields(field('Ogranichuvanje','Ovoj leaderboard sodrzhi delumni podatoci.'));
  if(metricName==='engagement') embed.addFields(field('Formula','Engagement = (likes + komentari) / pregledi. Shares ne se del od formulata.'));
  return embed;
}

export function videosEmbed(snapshot,metric='vkupno',limit=10) {
  const fieldName=metric==='period'?'viewCountInPeriod':'viewCount';
  const lines=rankRows(snapshot.videos,fieldName,limit).map((video,index)=>{
    const url=safeLink(video.url);
    const title=`${index+1}. ${accountLabel(video)} · ${short(video.platform,25)}`;
    return `${url ? `[${title}](${url.replace(/[()]/g,encodeURIComponent)})` : title} — **${numberText(video[fieldName])}** pregledi`;
  });
  return withCoverage(base(`🎬 Najdobri videa — ${metric==='period'?'novi':'vkupno'} pregledi`,GOLD)
    .setDescription(short(lines.join('\n') || 'Nema podatoci za ovoj period.',3500)).addFields(field('Period',periodText(snapshot))),snapshot);
}

export function creatorEmbed(account,snapshot) {
  const embed=base(`📈 ${accountLabel(account)} · ${short(account.platform,40)}`)
    .addFields(field('Vkupno pregledi',numberText(account.viewCount),true),field('Novi pregledi',numberText(account.viewCountInPeriod),true),
      field('Sledbenici',numberText(account.followerCount),true),field('Sledeni videa',numberText(account.videoCount),true),
      field('Novi objavi',numberText(account.videoCountInPeriod),true),field('Prosek po video',numberText(account.averageViewsPerVideo),true),
      field('Engagement',percentText(snapshot.period.key==='all'?account.engagementRate:account.engagementRateInPeriod),true),
      field('Izmeren rast na sledbenici',numberText(account.followerGrowth),true),field('Period',periodText(snapshot)));
  return withCoverage(embed,snapshot);
}

export function statisticsEmbed(snapshot) {
  return withCoverage(base('📊 Footly statistika',BLUE).setDescription(periodText(snapshot))
    .addFields(field('Vkupno sledeni pregledi',numberText(snapshot.totals.views),true),field('Novi pregledi',numberText(snapshot.totals.viewsGained),true),
      field('Novi objavi',numberText(snapshot.totals.posts),true),field('Sledeni kreatori',numberText(snapshot.accounts.length),true),
      field('Sledeni videa',numberText(snapshot.videos.length),true)),snapshot);
}

export function reportEmbeds(snapshot,type='daily') {
  const weekly=type==='weekly';
  const embed=statisticsEmbed(snapshot).setTitle(weekly?'📊 FOOTLY — Nedelen izvestaj':'📊 FOOTLY — Dneven izvestaj');
  const topCreators=rankRows(snapshot.accounts,'viewCountInPeriod',weekly?10:3);
  const leader=topCreators[0];
  const growth=rankRows(snapshot.accounts,'followerGrowth',3).filter(account=>account.followerGrowth>0);
  const engagement=rankRows(snapshot.accounts,'engagementRateInPeriod',3);
  const underperforming=snapshot.accounts.filter(account=>account.viewCountInPeriod!=null && account.videoCountInPeriod!=null)
    .sort((a,b)=>a.viewCountInPeriod-b.viewCountInPeriod).slice(0,3);
  const milestones=(snapshot.milestones || []).slice(0,4).map(event=>`${accountLabel(event.data?.account)}: ${numberText(event.data?.milestone)} pregledi`);
  embed.addFields(field('Najdobri kreatori',topCreators.map((account,index)=>`${index+1}. ${accountLabel(account)} — ${numberText(account.viewCountInPeriod)} pregledi`).join('\n')),
    field('Izmeren rast na sledbenici',growth.length ? growth.map(account=>`${accountLabel(account)} +${numberText(account.followerGrowth)}`).join('\n') : 'Nema podatoci za potvrden rast.'),
    field('Milestones vo periodot',milestones.length?milestones.join('\n'):'Nema zabelezhani novi milestones.'),
    field('Engagement',engagement.map(account=>`${accountLabel(account)} ${percentText(account.engagementRateInPeriod)}`).join('\n') || 'Nema podatoci.'));
  if(weekly) embed.addFields(field('Profili za proverka',underperforming.map(account=>`${accountLabel(account)}: ${numberText(account.viewCountInPeriod)} novi pregledi, ${numberText(account.videoCountInPeriod)} objavi`).join('\n') || 'Nema podatoci za sporedba.'));
  embed.addFields(field('Preporaki',leader ? `Pregledajte go formatot na ${accountLabel(leader)} i testirajte slichni idei. Proverete go opfatot pred odluka za nagradi. Ova se preporaki, ne potvrdeni prichini za rast.` : 'Soberete celosen period so podatoci pred sporedba na kreatorite.'));
  const videoEmbed=videosEmbed(snapshot,'period',weekly?10:1);
  videoEmbed.data.fields = (videoEmbed.data.fields || []).filter(item=>item.name!=='Opfat i ogranichuvanja');
  const size=data=>(data.title?.length||0)+(data.description?.length||0)+(data.footer?.text.length||0)+(data.fields||[]).reduce((sum,item)=>sum+item.name.length+item.value.length,0);
  const room=5800-size(embed.data)-(size(videoEmbed.data)-(videoEmbed.data.description?.length||0));
  if(videoEmbed.data.description.length>room) videoEmbed.setDescription(videoEmbed.data.description.slice(0,Math.max(30,room-50))+'\nPovekje: /topvideos');
  return [embed,videoEmbed];
}
export function dailyEmbed(accounts,count,isPartial=false) {
  return rankingEmbed(accounts,count,'nedela',{isPartial}).setTitle('📊 Footly — Dneven izvestaj');
}

export function viralEmbed(event) {
  const {video,account,milestone,viewCount}=event.data;
  const embed=base('🚀 FOOTLY VIRAL ALERT!',GOLD).setDescription(`🔥 **${accountLabel(account)}** dostigna **${numberText(milestone)} pregledi**! Odlichna rabota!`)
    .addFields(field('👀 Pregledi',numberText(viewCount),true),field('❤️ Likes',numberText(video?.likeCount),true),
      field('💬 Komentari',numberText(video?.commentCount),true),field('📱 Platforma',account?.platform || video?.platform || 'Nema podatoci',true),field('🏆 Milestone',numberText(milestone),true));
  const url=safeLink(video?.url);if(url) embed.setURL(url);
  return embed;
}
export function followersEmbed(event) {
  const {account,milestone,followerCount}=event.data;
  return base(`📈 ${accountLabel(account)} raste!`).setDescription(`Profilot dostigna **${numberText(milestone)} sledbenici**!`)
    .addFields(field('Vkupno sledbenici',numberText(followerCount),true),field('Platforma',account?.platform,true));
}
export function publishedEmbed(event) {
  const {account,video}=event.data;
  const embed=base(`🎬 Novo video — ${accountLabel(account)}`,BLUE).setDescription(`Nova objava na ${short(account?.platform || 'socijalna mrezha',40)}.`);
  const url=safeLink(video?.url);if(url) embed.setURL(url);
  return embed;
}
