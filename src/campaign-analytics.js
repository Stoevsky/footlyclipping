import {reportingPeriod,zonedMidnight,localDate} from './utils.js';

const number=value=>value==null || value==='' || typeof value==='boolean' || !Number.isFinite(Number(value)) || Number(value)<0 ? null : Number(value);
const sum=values=>values.every(value=>value!==null) ? values.reduce((total,value)=>total+value,0) : null;
const engagement=(views,likes,comments)=>views!==null && likes!==null && comments!==null && views>0 ? (likes+comments)/views : null;

// Campaign performance is a different data domain from account lifetime totals.
// Deliberately do not fall through to organization inventory or snapshots here.
export function calculateCampaignAnalytics(source,{campaignId,period='week',now=new Date(),timezone='Europe/Skopje',milestones=[]}={}) {
  const range=reportingPeriod(period,timezone,new Date(now));
  const snapshot=source?.campaign?.id===campaignId ? source : null;
  const scope={type:'campaign',id:campaignId,name:snapshot?.campaign.name || 'Izbranata kampanja',key:`campaign:${campaignId}`};
  const roster=snapshot?.creators || [];
  const all=snapshot?.periods.find(item=>item.key==='all');
  const campaignStart=Date.parse(snapshot?.campaign.validFrom);
  const assignmentStarts=roster.map(creator=>Date.parse(creator.assignmentValidFrom));
  const knownAssignmentStart=assignmentStarts.length && assignmentStarts.every(Number.isFinite) ? Math.min(...assignmentStarts) : null;
  const availableBegin=Number.isFinite(campaignStart) ? Math.max(campaignStart,knownAssignmentStart ?? campaignStart) : knownAssignmentStart;
  const beforeParticipation=range.key!=='all' && availableBegin!==null && range.end.getTime()<=availableBegin;
  const selected=beforeParticipation ? null : snapshot?.periods.find(item=>item.key===range.key && (range.key==='all' || (item.from===range.from && item.to===range.to)));
  if(range.key==='all' && (Number.isFinite(campaignStart) || /^\d{4}-\d{2}-\d{2}$/.test(all?.from || ''))) {
    range.from=Number.isFinite(campaignStart) ? localDate(new Date(campaignStart),timezone) : all.from;
    range.start=zonedMidnight(range.from,timezone);
  }
  const lifetime=new Map((all?.creators || []).map(row=>[String(row.id),row]));
  const current=new Map((selected?.creators || []).map(row=>[String(row.id),row]));
  const accounts=roster.map(creator=>{
    const full=lifetime.get(String(creator.id)), row=current.get(String(creator.id));
    const connection=creator.accounts?.[0];
    const views=number(full?.viewCount), videoCount=number(full?.eligibleVideoCount);
    const likes=number(full?.likeCount),comments=number(full?.commentCount);
    const gained=number(row?.viewCount);
    return {id:String(creator.id),orgCreatorId:String(creator.id),
      username:creator.username || connection?.username || creator.name || 'nepoznat',displayName:creator.name,
      aliases:[...new Set([creator.username,creator.name,...(creator.accounts || []).flatMap(account=>[account.username,account.displayName])].filter(value=>typeof value==='string' && value))],
      platform:creator.accounts?.length>1 ? 'povekje platformi' : connection?.platform || null,
      connectedAccounts:creator.accounts || [],viewCount:views,videoCount,viewCountInPeriod:gained,
      videoCountInPeriod:number(row?.videoCount),likeCount:likes,commentCount:comments,shareCount:number(full?.shareCount),
      averageViews:views!==null && videoCount>0 ? views/videoCount : null,
      averageViewsPerVideo:views!==null && videoCount>0 ? views/videoCount : null,
      engagementRate:engagement(views,likes,comments),engagementRateInPeriod:engagement(gained,number(row?.likeCount),number(row?.commentCount)),
      followerCount:null,followerGrowth:null,periodSource:row?'campaign_performance':null,
      analyticsUpdatedAt:selected?.coverage?.eligibilityRefreshedAt || null,fetchedAt:snapshot?.syncedAt || null,
    };
  });
  const allVideos=new Map((all?.videos || []).map(video=>[video.id,video]));
  const selectedVideos=new Map((selected?.videos || []).map(video=>[video.id,video]));
  const merged=new Map([...allVideos,...selectedVideos]);
  const videos=[...merged.values()].map(video=>{
    const full=allVideos.get(video.id),row=selectedVideos.get(video.id);
    const views=number(full?.viewCountInPeriod),likes=number(full?.likeCountInPeriod),comments=number(full?.commentCountInPeriod);
    return {...video,accountUsername:video.accountUsername || video.username,
      viewCount:views,viewCountInPeriod:number(row?.viewCountInPeriod),likeCount:likes,commentCount:comments,shareCount:number(full?.shareCountInPeriod),
      engagementRate:engagement(views,likes,comments),engagementRateInPeriod:engagement(number(row?.viewCountInPeriod),number(row?.likeCountInPeriod),number(row?.commentCountInPeriod)),
      analyticsUpdatedAt:video.loadAt || null,fetchedAt:snapshot?.syncedAt || null};
  });
  const totals={views:number(all?.totals?.viewCount),viewsGained:number(selected?.totals?.viewCount),
    posts:number(selected?.totals?.videoCount),followers:null,accounts:accounts.length,videos:number(all?.totals?.eligibleVideoCount),
    knownViews:accounts.reduce((total,row)=>total+(row.viewCount ?? 0),0),knownViewsGained:accounts.reduce((total,row)=>total+(row.viewCountInPeriod ?? 0),0)};
  const inventoryComplete=Boolean(snapshot && all && all.coverage?.performanceComplete);
  const complete=Boolean(selected?.coverage?.performanceComplete && accounts.every(row=>row.viewCountInPeriod!==null));
  const metricTimezone=selected?.timeZone || snapshot?.campaign.timeZone || null;
  const sourceUpdatedAt=selected?.coverage?.eligibilityRefreshedAt || all?.coverage?.eligibilityRefreshedAt || null;
  const notes=[`Opfat: samo kampanjata ${scope.name}. Istorijata na organizacijata ne e vkluchena.`];
  if(!snapshot) notes.push('Se ushte nema potvrdena sinhronizacija za ovaa kampanja.');
  if(beforeParticipation) notes.push('Izbraniot period e pred pochetokot na kampanjata ili pred prikluchuvanjeto na tekovnite kreatori.');
  else if(snapshot && !selected) notes.push('Nema azhurirani kampanjski podatoci za izbraniot period.');
  if(selected && !complete) notes.push('Del od kampanjskite metrics ne se dostapni; nepoznatite vrednosti ne se nula.');
  if(snapshot && totals.videos===0 && totals.views===0) notes.push('Kampanjata se ushte nema podobni videa. Potvrdenite metrics se 0.');
  if(totals.videos!==null && totals.videos>allVideos.size) notes.push('Listata na videa e ogranicena na top 300; vkupnite kampanjski brojki se od celosniot performance izvestaj.');
  if(range.key!=='all' && metricTimezone && metricTimezone!==timezone) notes.push(`Pregledite se po ${metricTimezone} denovi; rasporedot e ${timezone}.`);
  if(snapshot?.syncedAt && new Date(now)-new Date(snapshot.syncedAt)>7200000) notes.push('Poslednata sinhronizacija e postara od 2 chasa.');
  if(sourceUpdatedAt && new Date(now)-new Date(sourceUpdatedAt)>86400000) notes.push('Izvornata proverka na kampanjskite podatoci e postara od 24 chasa; novoto prezemanje ne ja osvezhuva.');
  if(snapshot && !sourceUpdatedAt) notes.push('Vremeto na poslednata izvorna proverka na kampanjata ne e poznato.');
  const eligibleIds=new Set(videos.map(video=>video.id));
  const scopedMilestones=milestones.filter(event=>event.scope?.id===campaignId && eligibleIds.has(`${event.data?.video?.platform}:${event.data?.video?.platformVideoId}`));
  return {scope,period:range,accounts,videos,totals,milestones:scopedMilestones,syncedAt:snapshot?.syncedAt || null,
    coverage:{inventoryComplete,periodComplete:complete,periodAvailable:Boolean(selected),periodObservedAt:selected?snapshot.syncedAt:null,
      metricsTimezone:metricTimezone,notes,engagementFormula:'(likes + comments) / views',
      sourceUpdatedAt,availableFrom:availableBegin!==null ? new Date(availableBegin).toISOString() : null,
      knownAccountGains:accounts.filter(row=>row.viewCountInPeriod!==null).length,totalAccounts:accounts.length,
      campaignId,participantCount:accounts.length,zeroActivity:totals.videos===0&&totals.views===0,
      completeRosterSum:sum(accounts.map(row=>row.viewCountInPeriod))},
  };
}
