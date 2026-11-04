/**
 * Atmos IMS proxy for Cloudflare Workers.
 * Required secret: IMS_API_TOKEN (Cloudflare dashboard > Worker > Settings > Variables and Secrets).
 * Secrets must never be committed or embedded in the Android APK.
 * GET /api/stations
 * GET /api/history?station=ID&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
const BASE = 'https://api.ims.gov.il/v1/envista/stations';
const CORS = {'Access-Control-Allow-Origin': 'https://appassets.androidplatform.net', 'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=900'}})}
function error(message,status=400){return response({error:message},status)}
async function ims(path,env){const result=await fetch(BASE+path,{headers:{Authorization:'ApiToken '+env.IMS_API_TOKEN,Accept:'application/json'},cf:{cacheTtl:600,cacheEverything:true}});if(!result.ok)throw new Error('IMS HTTP '+result.status);return result.json()}
function unwrap(x){return Array.isArray(x)?x:Array.isArray(x?.data)?x.data:Array.isArray(x?.stations)?x.stations:[]}
function num(x){return typeof x==='number'&&Number.isFinite(x)?x:null}
function mean(x){return x.length?x.reduce((a,b)=>a+b,0)/x.length:null}
function round(x){return x===null?null:Math.round(x*100)/100}
function group(type){let s=String(type||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(s==='RAIN')return 'rain';if(s==='TD')return 'temp';if(s==='TDMAX')return 'tempMax';if(s==='TDMIN')return 'tempMin';if(s==='RH')return 'humidity';if(s==='WS')return 'wind';if(s==='WSMAX')return 'gust';return null}
function aggregate(obs,stationMeta){let channelNames=new Map();for(let x of (stationMeta.monitors||[]))channelNames.set(String(x.channelId??x.id),x.name);
let bucket={temp:[],tempMax:[],tempMin:[],rain:[],wind:[],gust:[],humidity:[]},dayRain=new Map();let seen=0,rejected=0;
for(let item of obs){let date=String(item.datetime||'').slice(0,10);for(let channel of (item.channels||[])){let val=num(channel.value);if(val===null||channel.valid===false||channel.status===2){rejected++;continue}
let name=channel.name||channelNames.get(String(channel.id));let type=group(name);if(!type)continue;bucket[type].push(val);seen++;if(type==='rain'&&/^\d{4}-\d{2}-\d{2}$/.test(date))dayRain.set(date,(dayRain.get(date)||0)+val)
}}
let days=[...dayRain].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,rain])=>({date,rain_mm:round(rain)}));
let dailyCount=days.filter(x=>x.rain_mm>=0.1).length;
return {station:stationMeta.name||stationMeta.stationName||String(stationMeta.stationId||stationMeta.id),statistics:{temperature_mean_c:round(mean(bucket.temp)),temperature_max_c:bucket.tempMax.length?round(Math.max(...bucket.tempMax)):bucket.temp.length?round(Math.max(...bucket.temp)):null,temperature_min_c:bucket.tempMin.length?round(Math.min(...bucket.tempMin)):bucket.temp.length?round(Math.min(...bucket.temp)):null,humidity_mean_pct:round(mean(bucket.humidity)),wind_mean_ms:round(mean(bucket.wind)),gust_max_ms:bucket.gust.length?round(Math.max(...bucket.gust)):null,rain_sum_mm:round(bucket.rain.reduce((a,b)=>a+b,0)),rainy_days_observed:dailyCount},counts:Object.fromEntries(Object.entries(bucket).map(([key,values])=>[key,values.length])),observation_count:obs.length,accepted_values:seen,ignored_values:rejected,rain_by_day:days,notice:'הנתונים הם מדידות אוטומטיות ולא בהכרח נתונים מבוקרים. ממוצעים הם ממוצעי דגימות זמינות, לא ממוצעים אקלימיים תקניים. ימי גשם נספרים רק בימים שבהם יש רישומי גשם.'}}
export default {async fetch(request,env){try{if(request.method==='OPTIONS')return new Response(null,{headers:CORS});if(request.method!=='GET')return error('Method not allowed',405);if(!env.IMS_API_TOKEN)return error('Server not configured: IMS_API_TOKEN missing',503);let u=new URL(request.url);if(u.pathname==='/health')return response({ok:true});if(u.pathname==='/api/stations'){let all=unwrap(await ims('',env));return response(all.map(x=>({id:x.stationId??x.id,name:x.name??x.stationName??String(x.stationId??x.id),regionId:x.regionId})).filter(x=>x.id!=null).sort((a,b)=>a.name.localeCompare(b.name)));}
if(u.pathname==='/api/history'){let station=u.searchParams.get('station')||'',from=u.searchParams.get('from')||'',to=u.searchParams.get('to')||'';if(!/^\d{1,5}$/.test(station)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return error('Invalid station or dates');let fromDate=new Date(from+'T00:00:00Z'),toDate=new Date(to+'T00:00:00Z');let days=(toDate-fromDate)/86400000;if(!Number.isFinite(days)||days<0||days>31)return error('בחר טווח של עד 32 ימים. טווחים ארוכים יתווספו בהמשך.');let [meta,raw]=await Promise.all([ims('/'+station,env),ims('/'+station+'/data?from='+from.replaceAll('-','/')+'&to='+to.replaceAll('-','/'),env)]);let obs=unwrap(raw);return response({summary:aggregate(obs,meta),source:'Israel Meteorological Service',from,to,stationId:Number(station)});}
return error('Not found',404);}catch(e){return error('Upstream service failed: '+e.message,502)}}};
