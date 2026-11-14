import { readJson } from './radio-now.js';

const BBC = 'https://rms.api.bbc.co.uk/v2/services/bbc_radio_one/segments/latest?experience=domestic&offset=0&limit=1';
const MAX_BYTES = 512 * 1024;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function clean(value) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}
function safeImage(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : '';
  } catch { return ''; }
}
function localClock(date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Warsaw', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
  });
  function read(instant) {
    const parts = formatter.formatToParts(instant);
    const get = type => parts.find(part => part.type === type)?.value;
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    return { day, wallTime:Date.parse(`${day}T${get('hour')}:${get('minute')}:${get('second')}Z`) };
  }
  const local=read(date);
  const now=date.getTime();
  const ambiguous=read(new Date(now-3600000)).wallTime===local.wallTime ||
    read(new Date(now+3600000)).wallTime===local.wallTime;
  return {...local,ambiguous};
}
function wallTime(value) {
  if (typeof value !== 'string') return NaN;
  const iso = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(value);
  if (iso) return Date.parse(`${iso[1]}Z`);
  const rfc = /^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (!rfc || !MONTHS.includes(rfc[2])) return NaN;
  return Date.parse(`${rfc[3]}-${String(MONTHS.indexOf(rfc[2])+1).padStart(2,'0')}-${rfc[1]}T${rfc[4]}Z`);
}
function bbcTrack(data) {
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const title=clean(item?.titles?.secondary), artist=clean(item?.titles?.primary);
  if (item?.offset?.now_playing !== true || !title || !artist) return null;
  const image = typeof item.image_url === 'string' ? item.image_url.replace('{recipe}', '400x400') : '';
  return { title, artist, album:'', cover:safeImage(image, ['ichef.bbci.co.uk']), kind:'track' };
}
function polishTrack(data, station, now) {
  const programmes=station==='trojka' ? data?.data : data;
  if (!Array.isArray(programmes)) return null;
  const modern=station==='trojka';
  let best=null, active=null;
  for (const programme of programmes) {
    const start=wallTime(modern?programme.startTime:programme.Start);
    const end=wallTime(modern?programme.stopTime:programme.Stop);
    if (start<=now && end>now && (!active || start>active.start)) active={start,programme,title:clean(modern?programme.title:programme.Title)};
    const songs=modern?programme.playlistItems:programme.Songs;
    if (!Array.isArray(songs)) continue;
    for (const song of songs) {
      const started=wallTime(modern?song.startTime:song.Start);
      const title=clean(modern?song.title:song.Title), artist=clean(modern?song.artist:song.Artist);
      if (!title || !artist || !Number.isFinite(started) || started>now || (best && started<=best.started)) continue;
      best={started,title,artist,programme,cover:modern?song.cover:song.Photo,duration:modern?song.duration:0};
    }
  }
  if (best) {
    const age=(now-best.started)/1000;
    if (modern && active && best.programme===active.programme &&
        Number.isFinite(best.duration) && best.duration>0 && best.duration<=1800 && age<best.duration)
      return {title:best.title,artist:best.artist,album:'',cover:safeImage(best.cover,['static.prsa.pl','cdn.polskieradio.pl']),kind:'track'};
    if (!modern && age<=900)
      return {title:best.title,artist:best.artist,album:'',cover:safeImage(best.cover,['static.prsa.pl','cdn.polskieradio.pl']),kind:'recent'};
  }
  if (active?.title) return {title:active.title,artist:'Live programme',album:'',cover:'',kind:'programme'};
  return null;
}
export async function onRequestGet({ request }) {
  const station=new URL(request.url).searchParams.get('station');
  if (!['trojka','czworka','bbc1'].includes(station)) return Response.json({error:'unknown_station'},{status:400,headers:{'cache-control':'no-store'}});
  const {day,wallTime:now,ambiguous}=localClock(new Date());
  if (ambiguous && station!=='bbc1') return Response.json({kind:'station'},{headers:{'cache-control':'no-store'}});
  const url=station==='bbc1'?BBC:station==='trojka'?`https://trojka.polskieradio.pl/playlist?date=${day}`:`https://apipr.polskieradio.pl/api/playlist?date=${day}&antenneId=4`;
  try {
    const upstream=await fetch(url,{signal:AbortSignal.timeout(6000),cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':20,'400-599':0}}});
    if(!upstream.ok)throw new Error('upstream unavailable');
    const data=await readJson(upstream,MAX_BYTES);
    const result=station==='bbc1'?bbcTrack(data):polishTrack(data,station,now);
    return Response.json(result || {kind:'station'}, {headers:{'cache-control':'public, max-age=0, s-maxage=20'}});
  } catch {
    return Response.json({error:'metadata_unavailable'}, {status:502,headers:{'cache-control':'no-store'}});
  }
}
