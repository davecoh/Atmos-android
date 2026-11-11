/* Atmos GPT weather agent — ChatGPT plan OAuth, local tools, no OpenAI API key. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const pending=new Map();let seq=0,history=[],busy=false,lastDetailedQuestion='';
function contextualQuestion(q){
 const follow=/^(?:ו?ב(?:שנת|אבני|מרום|גמלא|תחנת)|ומה|ואיך|ולגבי|ומה לגבי|לעומת|גם ב|באותה|באותו)/.test(q)||/^20\d{2}$/.test(q);
 return follow&&lastDetailedQuestion ? 'הבקשה הקודמת: '+lastDetailedQuestion+'; השינוי המבוקש כעת: '+q+' (יש לשנות רק את הפרט ששונה)' : q;
}
const getNative=()=>window.AtmosGPT;
const isoLocal=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const jsonText=s=>{let t=String(s||'').trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');return JSON.parse(t)};
function status(v){$('gptStatus').textContent=v}
function model(){return $('gptModel').value}
function callGPT(prompt){return new Promise((resolve,reject)=>{
 if(!prompt||prompt.length>15600){reject(Error('TOOL_EVIDENCE_TOO_LONG'));return;}
 const id='ai'+(++seq);
 const timer=setTimeout(()=>{
  if(pending.has(id)){pending.delete(id);reject(Error('AI_TIMEOUT'));}
 },100000);
 pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
 try{getNative().ask(prompt,model(),id);}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
});}
window.atmosAIResult=(id,result,error)=>{const p=pending.get(id);if(!p)return;pending.delete(id);if(error)p.reject(Error(error));else p.resolve(result);};
window.atmosModelsResult=(id,raw,error)=>{
 if(error){status('לא ניתן לטעון מודלים: '+error);return;}
 try{
  const data=JSON.parse(raw),models=(data.models||data.data||[]).filter(m=>m&&((m.visibility==='list')||!m.visibility));
  $('gptModel').replaceChildren();
  for(const m of models){const option=document.createElement('option');option.value=m.slug||m.id;option.textContent=m.display_name||m.name||option.value;$('gptModel').appendChild(option);}
  if(!models.length)status('אין מודלים זמינים בחשבון עבור מסלול ההתחברות.');
  else {status('מחובר למנוי ChatGPT. ניתן לשאול שאלות.');if(typeof window.AtmosRunMapAnalysis==='function')window.AtmosRunMapAnalysis();}
 }catch(e){status('תגובת רשימת המודלים אינה תקינה: '+e.message);}
};
window.atmosLoginResult=(type,message)=>{
 if(type==='progress')status(message);
 if(type==='error')status('ההתחברות נכשלה: '+message);
 if(type==='signedout'){status('התנתקת מקומית. ביטול ההרשאה בשרת לא אומת.');$('gptModel').replaceChildren();}
 if(type==='success'){status('אושרה התחברות: '+message);getNative().listModels('models'+(++seq));}
};
let wasConnected=false;
function refreshLoginStatus(){
 const g=getNative();if(!g)return;
 const connected=g.connected();
 let info={};
 try{info=JSON.parse(g.diagnostic());}catch(e){info={state:"idle",message:"יש להתחבר עם ChatGPT"};}
 if(connected){
   if(!wasConnected||!$('gptModel').value){
     status('ההתחברות נשמרה. טוען מודלים זמינים…');
     g.listModels('models'+(++seq));
   }
 }else if(info.state==="error"){
   status('שגיאת התחברות: '+info.message);
 }else if(info.state==="progress"){
   status(info.message+' אם הדפדפן כבר נסגר, המתן לתוצאה או נסה שוב.');
 }else{
   status('יש להתחבר עם ChatGPT ולאשר שימוש במכסת המנוי.');
 }
 wasConnected=connected;
}
async function setup(){
 const g=getNative();if(!g){status('נדרשת גרסה תומכת בהתחברות ChatGPT');return;}
 refreshLoginStatus();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLoginStatus()});
 window.addEventListener('focus',refreshLoginStatus);
 window.addEventListener('pageshow',refreshLoginStatus);

 $('gptLogin').onclick=()=>{status('ממתין להתחברות…');g.signIn()};
 $('gptLogout').onclick=()=>{g.logout()};
}
function messages(role,text){let node=document.createElement('div');node.className='chat-bubble '+role;node.textContent=text;$('chatMessages').append(node);$('chatMessages').scrollTop=$('chatMessages').scrollHeight;return node}
function isHistoricalQuestion(q){
 const t=String(q||'');
 return /גשם|משקע|ירד|טמפרטור|מעלות|רוח|לחות|מדידות|תחנות|תחנה|היסטורי|שנת|בשנת|מרץ|ינואר|פברואר|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|199[0-9]|20[0-2][0-9]/i.test(t)
   && !/תחזית|מודל|מחר|בעוד|בשבת הבאה/.test(t);
}
function nationwideForecastQuestion(q){
 const t=String(q||'');
 const national=/בארץ|בישראל|בכל הארץ|רחבי הארץ|Israel|across the country|nationwide|around Israel/i.test(t);
 const comparative=/איפה|היכן|אזור|אזורים|הכי הרבה|יותר|מרבית|most|where|which areas|highest/i.test(t);
 const rain=/גשם|גשמים|משקע|ממטר|ירד|ירדו|יירד|rain|precipitation/i.test(t);
 const future=/הלילה|הערב|מחר|היום|תחזית|צפוי|ירד|שבת|סוף שבוע|tonight|tomorrow|forecast|expected|will rain/i.test(t);
 return national&&comparative&&rain&&future&&!/ירד בעבר|אשתקד|בשנה שעברה|last year|yesterday/i.test(t);
}
function nationwideObservedQuestion(q){
 const t=String(q||'');
 const national=/בארץ|בישראל|בכל הארץ|רחבי הארץ|Israel|across the country|nationwide/i.test(t);
 const geographic=/איפה|היכן|אזור|אזורים|הכי הרבה|יותר|most|where|which areas|highest/i.test(t);
 const precipitation=/גשם|משקע|ממטר|ירד|ירדו|rain|precipitation/i.test(t);
 const previousNight=/הלילה|אמש|בלילה שעבר|last night/i.test(t);
 const past=/ירד|ירדו|נמדד|היה|fell|rained|recorded|last night/i.test(t);
 const nowHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
 return national&&geographic&&precipitation&&previousNight&&past&&nowHour<11;
}
function inferNationalPeriod(q){
 const t=String(q||'');
 return /הלילה|הערב|tonight/i.test(t)?'tonight':
  /מחר|tomorrow/i.test(t)?'tomorrow':
  /סוף השבוע|סופש|weekend/i.test(t)?'weekend':'today';
}
function isStationDirectoryQuestion(q){return /רשימ[הת]|אילו תחנות|איזה תחנות|תן לי.*תחנות|הצג.*תחנות/.test(String(q||''));}
async function requireIMSStations(){
 if(!window.AtmosIMS)throw Error('רכיב השמ״ט אינו זמין בגרסה הזאת.');
 if(!window.AtmosIMS.isConfigured())throw Error('חסר טוקן שמ״ט בגרסת אטמוס GPT. פתח את לשונית היסטוריה, לחץ על הזנת טוקן חד־פעמית, והזן את הטוקן פעם אחת.');
 let raw;
 try{raw=await window.imsRequest('');}catch(e){throw Error('קריאת רשימת התחנות מהשמ״ט נכשלה: '+e.message+'. בדוק את טעינת התחנות בלשונית היסטוריה.');}
 if(raw?._httpStatus===204)throw Error('שרת השמ״ט החזיר HTTP 204 (ללא תוכן) לבקשת רשימת התחנות. זו אינה הוכחה שאין מדידות לשנת 1992. בדוק את טוקן השמ״ט ונסה טעינת תחנות בלשונית היסטוריה.');
 let stations=stationList(raw);
 if(!stations.length)throw Error('השמ״ט לא החזיר תחנות מזוהות. בדוק את הטוקן או נסה שוב.');
 return stations;
}
function stationLocation(x){
 let loc=x.location||x.coordinates||x.geo||{};
 if(typeof loc==="string"){try{loc=JSON.parse(loc)}catch(e){loc={}}}
 const lat=Number(loc.latitude??loc.lat??x.latitude??x.lat);
 const lon=Number(loc.longitude??loc.lon??loc.lng??x.longitude??x.lon);
 return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=29&&lat<=34&&lon>=34&&lon<=37?{latitude:lat,longitude:lon}:null;
}
function stationMonitors(x){
 return (Array.isArray(x.monitors)?x.monitors:[]).filter(m=>m.active!==false)
 .map(m=>String(m.name||'').toLowerCase().replace(/[^a-z0-9]/g,''));
}
function stationList(raw){
 let data=window.imsList(raw);
 return data.map(x=>({id:Number(x.stationId??x.id),name:window.hebrewStationName(x.name??x.stationName??''),original:String(x.name??x.stationName??''),location:stationLocation(x),monitors:stationMonitors(x)}))
 .filter(x=>Number.isInteger(x.id)&&x.id>0);
}
const LOCATIONS=[
 {name:'דרום רמת הגולן',aliases:['דרום רמת הגולן','דרום הגולן','רמת הגולן הדרומית','דרום הרמה','Southern Golan','South Golan','southern Golan Heights','southern part of the Golan'],lat:32.763,lon:35.663,region:true},
 {name:'רמת הגולן',aliases:['רמת הגולן','Golan Heights','the Golan'],lat:32.91,lon:35.75,region:true},
 {name:'צפון רמת הגולן',aliases:['צפון רמת הגולן','צפון הגולן','Northern Golan'],lat:33.13,lon:35.78,region:true},
 {name:'כפר חרוב',aliases:['כפר חרוב','כפר חרוב דרום הגולן'],lat:32.763,lon:35.663},
 {name:'קצרין',aliases:['קצרין'],lat:32.996,lon:35.689},
 {name:'אבני איתן',aliases:['אבני איתן'],lat:32.821,lon:35.762},
 {name:'טבריה',aliases:['טבריה'],lat:32.795,lon:35.53},
 {name:'חיפה',aliases:['חיפה'],lat:32.814,lon:34.99},
 {name:'תל אביב',aliases:['תל אביב','תל אביב יפו'],lat:32.085,lon:34.782},
 {name:'ירושלים',aliases:['ירושלים'],lat:31.769,lon:35.216},
 {name:'מרום גולן',aliases:['מרום גולן'],lat:33.133,lon:35.777}
];
function kmDistance(a,b){
 const R=6371,toRad=v=>v*Math.PI/180;
 const dlat=toRad(b.latitude-a.latitude),dlon=toRad(b.longitude-a.longitude);
 const h=Math.sin(dlat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dlon/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function desiredMonitor(metric){
 return {rain:['rain','rain1min'],temp:['td'],max:['tdmax','td'],min:['tdmin','td'],wind:['ws'],gust:['wsmax'],humid:['rh']}[metric]||[];
}
async function geocode(place){
 const name=String(place||'').trim();
 if(!name||name.length>80)throw Error('נדרש שם יישוב קצר כדי לאתר תחנה סמוכה.');
 const known=[...LOCATIONS].sort((a,b)=>Math.max(...b.aliases.map(x=>x.length))-Math.max(...a.aliases.map(x=>x.length))).find(x=>x.aliases.some(a=>name.toLowerCase()===a.toLowerCase()||name.toLowerCase().includes(a.toLowerCase())));
 if(known)return {latitude:known.lat,longitude:known.lon,label:known.name,source:known.region?'regional reference point, NOT exact town':'defined locality',is_region:!!known.region};
 const url='https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name,count:5,language:'en',format:'json'});
 let resp=await fetch(url);
 if(!resp.ok)throw Error('שירות זיהוי היישובים לא זמין ('+resp.status+')');
 let data=await resp.json();
 const matches=(data.results||[]).filter(x=>['IL','PS'].includes(x.country_code)||/Israel|Palestine/i.test(x.country||''));
 if(!matches.length)throw Error('לא נמצאו קואורדינטות מאומתות עבור ״'+name+'״. נסה שם יישוב אחר או תחנה מהרשימה.');
 let first=matches[0];
 return {latitude:first.latitude,longitude:first.longitude,label:first.name,source:'Open-Meteo Geocoding'};
}
function chooseNearby(stations,location,metric){
 const desired=desiredMonitor(metric);
 const eligible=stations.filter(s=>s.location&&(!s.monitors.length||s.monitors.some(m=>desired.includes(m))));
 if(!eligible.length)throw Error('לא התקבלו מהשמ״ט תחנות עם מיקום ופרמטר מתאים.');
 return eligible.map(s=>({...s,distanceKm:kmDistance(location,s.location)})).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,3);
}
function explicitPlaceInQuestion(q,stations){
 const names=LOCATIONS.map(x=>x.name).sort((a,b)=>b.length-a.length);
 let place=names.find(x=>q.includes(x));
 if(!place)return null;
 if(stations.some(s=>s.name===place||s.name.startsWith(place+' –')))return null;
 return place;
}
const METRICS=['rain','temp','max','min','wind','gust','humid'];
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;let d=new Date(s+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s}
function dateDiff(a,b){return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000)}
function chunks(from,to){
 let parts=[],d=new Date(from+'T12:00:00Z'),last=new Date(to+'T12:00:00Z');
 while(d<=last){let end=new Date(d);end.setUTCDate(end.getUTCDate()+25);if(end>last)end=new Date(last);parts.push([isoLocal(d),isoLocal(end)]);d=new Date(end);d.setUTCDate(d.getUTCDate()+1);}
 return parts;
}
async function historyTool(plan,stations){
 if(!window.AtmosIMS?.isConfigured())throw Error('IMS_NOT_CONFIGURED');
 if(!METRICS.includes(plan.metric))throw Error('INVALID_METRIC');
 let ss=Array.isArray(plan.stations)?plan.stations:[],rr=Array.isArray(plan.periods)?plan.periods:[];
 if(ss.length>2||rr.length===0||rr.length>2)throw Error('INVALID_QUERY');
 const requested=String(plan.place||plan.locationName||'').trim();
 let nearestMatch=null, alternatives=[];
 if(plan.match_strategy==='nearest'||(requested&&!ss.length)){
   const geo=await geocode(requested);
   alternatives=chooseNearby(stations,geo,plan.metric);
   nearestMatch={place:geo.label,source:geo.source,candidates:alternatives.map(x=>({name:x.name,id:x.id,distance_km:Math.round(x.distanceKm*10)/10}))};
   ss=[alternatives[0].id];
 }
 if(!ss.length)throw Error('STATION_NOT_FOUND');
 const output=[];
 const channelKey=({rain:'Rain',temp:'TD',max:'TDmax',min:'TDmin',wind:'WS',gust:'WSmax',humid:'RH'})[plan.metric];
 const unit=({rain:'mm',temp:'C',max:'C',min:'C',wind:'m/s',gust:'m/s',humid:'%'})[plan.metric];
 let attempts=0;
 async function readRange(station,from,to){
   // A broad query can return no content even if a shorter request works.
   // Probe weekly only after a genuinely empty broad response.
   async function probe(a,b){
     if(attempts>=28)return [];
     attempts++;
     const path='/'+station.id+'/data?from='+a.replaceAll('-','/')+'&to='+b.replaceAll('-','/');
     const reply=await window.imsRequest(path);
     return reply?._httpStatus===204?[]:window.imsList(reply);
   }
   let rows=[],missing=[];
   for(const [a,b] of chunks(from,to)){
     let part=[];
     try{part=await probe(a,b);}catch(err){console.warn('IMS query unavailable for requested period',String(err));}
     if(!part.length&&dateDiff(a,b)>=7){
       let cursor=new Date(a+'T12:00:00Z'),stop=new Date(b+'T12:00:00Z');
       while(cursor<=stop){
         const begin=isoLocal(cursor),until=new Date(cursor);
         until.setUTCDate(until.getUTCDate()+6);if(until>stop)until.setTime(stop.getTime());
         const finish=isoLocal(until);
         try{const weekly=await probe(begin,finish);if(weekly.length)part.push(...weekly);else missing.push({from:begin,to:finish});}
         catch(err){missing.push({from:begin,to:finish});console.warn('IMS weekly query unavailable',String(err));}
         cursor=new Date(until);cursor.setUTCDate(cursor.getUTCDate()+1);
       }
     }else if(!part.length)missing.push({from:a,to:b});
     rows.push(...part);
   }
   return {rows,missing};
 }
 async function measure(station,from,to){
   let meta={};
   try{meta=await window.imsRequest('/'+station.id);}catch(err){console.warn('Station metadata unavailable',String(err));}
   const {rows,missing}=await readRange(station,from,to);
   if(!rows.length)return {station:station.name,id:station.id,available:false,reason:'no_observations',missing_segments:missing,records:0,matching_measurements:0};
   const stats=window.imsStatistics(rows,meta);
   const count=stats.counts[channelKey]||0;
   if(!count||stats[plan.metric]===null)
     return {station:station.name,id:station.id,available:false,reason:'requested_measurement_missing',missing_segments:missing,records:stats.samples,matching_measurements:count};
   return {station:station.name,id:station.id,available:true,partial_value:stats[plan.metric],value:missing.length&&plan.metric==='rain'?null:stats[plan.metric],missing_segments:missing,records:stats.samples,matching_measurements:count,completeness:missing.length?'partial':'not_verified'};
 }
 for(const range of rr){
   const from=String(range.from),to=String(range.to);
   if(!validDate(from)||!validDate(to)||dateDiff(from,to)<0||dateDiff(from,to)>185)throw Error('INVALID_DATE_RANGE');
   for(const stationId of ss){
     const primary=stations.find(x=>x.id===Number(stationId));
     if(!primary)throw Error('STATION_NOT_FOUND');
     // For an unavailable explicit station, try geographically close alternatives,
     // but disclose the substituted station and never present it as the requested one.
     let candidates=nearestMatch?alternatives:[primary];
     if(!nearestMatch&&primary.location){
       const nearby=chooseNearby(stations,primary.location,plan.metric)
         .filter(x=>x.id!==primary.id && x.distanceKm<=35).slice(0,2);
       candidates=[primary,...nearby];
     }
     let picked=null,attempted=[];
     for(const station of candidates){
       const result=await measure(station,from,to);
       attempted.push({station:station.name,id:station.id,available:result.available,reason:result.reason||null});
       if(result.available){picked=result;break;}
     }
     if(!picked){
       output.push({status:'unavailable',requested_place:nearestMatch?.place||primary.name,
         period:{from,to},metric:plan.metric,unit,attempted_stations:attempted,nearest_station_match:nearestMatch,
         message:'No usable measurements were retrieved. This does not mean zero precipitation.'});
       continue;
     }
     const chosen=stations.find(x=>x.id===picked.id);
     output.push({status:'measured',requested_place:nearestMatch?.place||primary.name,
       station:picked.station,station_id:picked.id,station_coordinates:chosen?.location||null,
       station_distance_km:nearestMatch?.candidates.find(x=>x.id===picked.id)?.distance_km??
         ((picked.id!==primary.id&&primary.location&&chosen?.location)?
           Math.round(kmDistance(primary.location,chosen.location)*10)/10:null),
       station_selection:nearestMatch?'nearest_with_available_data':
         (picked.id===primary.id?'explicit_station':'nearby_fallback'),
       attempted_stations:attempted,period:{from,to},metric:plan.metric,unit,
       value:picked.value,partial_value:picked.partial_value,
       completeness:picked.completeness,missing_segments:picked.missing_segments,
       matching_measurements:picked.matching_measurements,records:picked.records});
   }
 }
 return {kind:'IMS_observations',results:output,attempted_api_requests:attempts,
 notes:'These are automatic weather-station observations, not necessarily controlled official climatology. If value=null and partial_value exists, it is NOT a full-period total. A nearby station is not a measurement at the requested town. If status=unavailable, say that the requested data could not be found; NEVER invent a number or switch years without user consent.'};
}
async function analogueTool(plan){
 if(!window.AtmosAnalogues?.search)throw Error('ANALOGUE_UNAVAILABLE');
 const place=String(plan.place||plan.locationName||'').trim();
 let position;
 if(place)position=await geocode(place);
 else {
  const value=$('place').value.split(',').map(Number);
  position={latitude:value[0],longitude:value[1],label:$('place').selectedOptions[0]?.textContent||'selected location'};
 }
 const result=await window.AtmosAnalogues.search({
  latitude:position.latitude,longitude:position.longitude,date:plan.date,
  years:3
 });
 result.place_name=position.label;
 return result;
}
async function forecastTool(plan={}){
 const place=String(plan.place||plan.locationName||'').trim();
 let geo;
 if(place)geo=await geocode(place);
 else{
  const [latitude,longitude]=$('place').value.split(',').map(Number);
  geo={latitude,longitude,label:$('place').selectedOptions[0]?.textContent||'selected location'};
 }
 const today=isoLocal(new Date());
 const target=String(plan.date||today);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(target)||target<today)throw Error('FORECAST_DATE_UNAVAILABLE');
 const params=new URLSearchParams({
  latitude:geo.latitude,longitude:geo.longitude,
  timezone:'Asia/Jerusalem',forecast_days:'7',
  hourly:'pressure_msl,temperature_850hPa,geopotential_height_500hPa,precipitation_probability',
  daily:'precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min'
 });
 const out=await Promise.allSettled([
  fetch('https://api.open-meteo.com/v1/forecast?'+params,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('model unavailable');return r.json()}),
  ...[["ECMWF","ecmwf"],["ICON","dwd-icon"],["GFS","gfs"]].map(async ([name,path])=>{
   const p=new URLSearchParams({latitude:geo.latitude,longitude:geo.longitude,
    timezone:'Asia/Jerusalem',forecast_days:'7',
    daily:'precipitation_sum,temperature_2m_max,temperature_2m_min'});
   const r=await fetch('https://api.open-meteo.com/v1/'+path+'?'+p,{cache:'no-store'});
   if(!r.ok)throw Error('model unavailable');
   return {name,data:await r.json()};
  })
 ]);
 const best=out[0].status==='fulfilled'?out[0].value:null;
 const dailyIndex=(best?.daily?.time||[]).indexOf(target);
 if(!best||dailyIndex<0)throw Error('FORECAST_DATE_UNAVAILABLE');
 const value=(a,i)=>typeof a?.[i]==='number'?a[i]:null;
 const regionalModels=out.slice(1).filter(x=>x.status==='fulfilled').map(x=>{
  const {name,data}=x.value,i=(data.daily?.time||[]).indexOf(target);
  return {name,valid_date:target,precipitation_mm:i<0?null:value(data.daily.precipitation_sum,i),
   high_c:i<0?null:value(data.daily.temperature_2m_max,i),
   low_c:i<0?null:value(data.daily.temperature_2m_min,i)};
 });
 const hour=(best.hourly?.time||[]).findIndex(t=>t.startsWith(target+'T12:'));
 const fields=hour<0?null:{
  pressure_msl_hpa:value(best.hourly.pressure_msl,hour),
  temperature_850hPa_c:value(best.hourly.temperature_850hPa,hour),
  geopotential_height_500hPa_m:value(best.hourly.geopotential_height_500hPa,hour)
 };
 return {kind:'forecast_research',place:geo.label,requested_date:target,
  best_match:{source:'Open-Meteo best match',precipitation_mm:value(best.daily.precipitation_sum,dailyIndex),
   precipitation_probability_max_percent:value(best.daily.precipitation_probability_max,dailyIndex),
   low_c:value(best.daily.temperature_2m_min,dailyIndex),
   high_c:value(best.daily.temperature_2m_max,dailyIndex),
   atmospheric_fields_at_12_local:fields},
  latest_model_forecasts:regionalModels,
  recentCommunityPosts:(window.latestAtmosNews?.posts||[]).slice(0,5).map(x=>({source:x.source,time:x.time,excerpt:x.text,url:x.url})),
  limits:'This is a comparison of numerical model output, not a literal visual reading of latest Weather2day chart imagery. Precipitation_probability_max_percent = maximum hourly probability within the day, NOT calibrated daily rain probability. Do not invent a daily percentage or take average percentages from three models. State model run issue times only if provided.'};
}
async function send(raw,options={}){
 let q=String(raw||'').trim();
 const spoken=options?.spoken===true;
 if(!q)return;
 if(busy){
   if(spoken)window.AtmosVoiceUI?.onAnswer('אטמוס עדיין עונה לשאלה הקודמת. אפשר לנסות שוב עוד רגע.',true);
   return;
 }
 messages('user',q);$('chatInput').value='';
 const fullQuestion=contextualQuestion(q);
 if(q.length>35&&!/^(ו?ב|ומה|ולגבי)/.test(q))lastDetailedQuestion=q;
 history.push({role:'user',text:q});history=history.slice(-10);
 if(!getNative()?.connected()){
 const answer='בוא נתחבר ל-ChatGPT, ואז נדבר על מזג האוויר ☀️';
 messages('assistant',answer);
 if(spoken)window.AtmosVoiceUI?.onAnswer(answer,true);
 return;
}
 if(!model()){
 const answer='חסר לי מודל לשיחה. בוא ננסה להתחבר שוב 🙂';
 messages('assistant',answer);
 if(spoken)window.AtmosVoiceUI?.onAnswer(answer,true);
 return;
}
 busy=true;$('chatSend').disabled=true;
 const bubble=messages('assistant','רגע, מציץ בעננים ☁️');bubble.classList.add('loading');
 try{
  const now=isoLocal(new Date());
  const recent=history.slice(-8).map(x=>x.role+': '+x.text).join('\n');
  const observedIntent=nationwideObservedQuestion(fullQuestion);
  const nationwideIntent=nationwideForecastQuestion(fullQuestion)&&!observedIntent;
  const synopticIntent=/(?:מפות|סינופט|מפות מודלים|מודלים|מערכות מזג|מגמ(?:ה|ות)|מה צפוי|השבוע הקרוב|שבוע הבא|בימים הקרובים|next week|coming week|synoptic|weather maps|forecast maps|weather systems|model runs|next seven days|next 7 days|week ahead)/i.test(fullQuestion)&&
   /(?:ישראל|בארץ|האזור|המזרח התיכון|כללי|באזור|שבוע|ימים|מגמ|מערכ|Israel|Middle East|week|synoptic|maps|systems)/i.test(fullQuestion)&&
   !/(?:היסטורי|בעבר|דומים בעבר|analog|historical|similar past)/i.test(fullQuestion);
  let stations=[];
  const planning='You are a tool router for Atmos, a FREESTYLE conversational weather analyst. Israel local date is '+now+'. '+
   'Understand the whole conversation without inventing data. User request: '+fullQuestion+
   '\nRecent dialogue:\n'+recent+
   '\nOutput ONLY one short valid JSON object containing action and necessary parameters. Actions: general, synoptic, forecast, nationwide_rain, nationwide_observed, analogues, historical. '+
   'SYNOPTIC: open-ended questions about next week, general outlook in Israel, synoptic maps, model runs, evolving weather systems, broader trends; choose synoptic even when no village is specified. '+
   'FORECAST: specific upcoming weather for one town/region or date; use forecast with place and ISO date when specified. '+
   'NATIONWIDE_RAIN: where in Israel will it rain most tonight/tomorrow; set period. NATIONWIDE_OBSERVED: where has it rained across Israel or last night, actual measurements. '+
   'ANALOGUES: explicitly asks for similar past weather patterns. HISTORICAL: explicitly requests actual past observed rain/temperature/weather station measurements; provide metric and periods ISO, place or station name, do not invent station IDs. '+
   'GENERAL: any other conversational question, explanation, or brainstorming. No station required. Do not demand a station for any forecast or synoptic question. '+
   'Never present knowledge of current maps or weather without tool output. "Southern Golan" is a region. For a seven-day map analysis select synoptic (no place necessary).';
  let plan;
  try{plan=jsonText(await callGPT(planning));}catch(e){throw Error('לא ניתן לפענח תוכנית שאילתות מהמודל: '+e.message)}
  if(observedIntent){
    // At 07:28 "where did it rain last night in Israel" asks for observed station data.
    plan={action:'nationwide_observed'};
  }else if(nationwideIntent){
    // Guardrail: countrywide forecast questions must use nationwide data,
    // even if the planning model confuses a comparison with a local query.
    plan={action:'nationwide_rain',period:inferNationalPeriod(fullQuestion)};
  }else if(synopticIntent&&plan.action!=='analogues'&&plan.action!=='historical'){
    plan={action:'synoptic'};
  }
  if(plan.action==='historical'&&!stations.length){
    bubble.textContent='מחפש תחנות מדידה 🌦️';
    stations=await requireIMSStations();
    const options=stations.slice(0,180).map(x=>x.id+':'+x.name).join('; ');
    plan=jsonText(await callGPT('The user requests actual historical weather measurements: '+fullQuestion+
      '. IMS station list: '+options+
      '. Choose only JSON action historical with metric, stations numeric IDs, and periods ISO dates. If the requested town is not a listed station, set match_strategy nearest, place exact town name, stations empty. Do not invent data.'));
  }
  const knownPlace=explicitPlaceInQuestion(fullQuestion,stations);
  if(plan.action==='historical'&&knownPlace){
    plan.match_strategy='nearest';
    plan.place=knownPlace;
    plan.stations=[]; // Never claim an unrelated station belongs to this town.
  }
  let result;
  if(plan.action==='historical'){bubble.textContent='מחפש טיפות של מידע 💧';result=await historyTool(plan,stations);}
  else if(plan.action==='synoptic'){
    bubble.textContent='קורא מפות מודלים לכמה ימים ומחפש מגמות 🗺️';
    if(!window.AtmosSynoptic?.analyze)throw Error('SYNOPTIC_DATA_UNAVAILABLE');
    result=await window.AtmosSynoptic.analyze();
  }
  else if(plan.action==='nationwide_observed'){
    bubble.textContent='משווה מדידות גשם מתחנות שמ״ט ברחבי הארץ 🌧️';
    if(!window.AtmosNationwide?.observedLastNight)throw Error('NATIONAL_OBSERVATIONS_UNAVAILABLE');
    result=await window.AtmosNationwide.observedLastNight({
      onProgress:(done,total)=>{bubble.textContent='בודק תחנות גשם ברחבי הארץ: '+done+' מתוך '+total+' ☔';}
    });
  }
  else if(plan.action==='nationwide_rain'){
    bubble.textContent='בודק איפה המודלים מצפים לגשם בישראל 🌧️';
    if(!window.AtmosNationwide?.compare)throw Error('NATIONAL_FORECAST_UNAVAILABLE');
    result=await window.AtmosNationwide.compare({period:plan.period||inferNationalPeriod(fullQuestion)});
  }
  else if(plan.action==='forecast'){
    bubble.textContent='משווה מפות ונתוני מודלים 🗺️';
    const forecast=await forecastTool(plan);
    let maps=null;
    if(window.AtmosPrecipMaps?.analyze){
      try{
       const placeName=String(plan.place||plan.locationName||'').trim();
       const geo=placeName?await geocode(placeName):{
        latitude:Number($('place').value.split(',')[0]),
        longitude:Number($('place').value.split(',')[1]),
        label:$('place').selectedOptions[0]?.textContent};
       const today=isoLocal(new Date());
       const requested=String(plan.date||today);
       maps=await window.AtmosPrecipMaps.analyze({
        latitude:geo.latitude,longitude:geo.longitude,place:geo.label,
        start_date:requested,end_date:plan.end_date||requested
       });
      }catch(e){console.warn('Map aggregation not available',String(e));}
    }
    result={kind:'combined_forecast_map_research',forecast,precipitation_maps:maps};
  }
  else if(plan.action==='analogues'){
    bubble.textContent='משווה למערכות מזג אוויר מהעבר 🗺️';
    result=await analogueTool(plan);
  }
  else if(plan.action==='general'){
    // Free conversation: no automatic IMS lookup, no artificial station prompts.
    result={kind:'general_conversation',note:'No live weather/map source queried for this message.',
      instruction:'Answer the conversational question naturally. For up-to-date weather claims, offer a synoptic/forecast analysis instead of fabricating recent data.'};
  }
  else throw Error('המודל החזיר פעולה לא מאושרת');
  bubble.textContent='מחבר את הנקודות ✨';
  // Android's model bridge caps prompts at 16K chars. Keep the full
  // seven-day model-by-model timeline, reduce only verbose grid snapshots.
  let evidence=result;
  if(result?.kind==='synoptic_multi_day_forecast'&&JSON.stringify(result).length>10000){
    evidence={...result,
     representative_synoptic_maps:result.representative_synoptic_maps?.map(m=>({
      model:m.model,days:m.days?.filter((d,i)=>i%2===0)
     }))};
  }
  if(JSON.stringify(evidence).length>11700&&evidence?.kind==='synoptic_multi_day_forecast'){
    evidence={...evidence,representative_synoptic_maps:
     evidence.representative_synoptic_maps?.map(m=>({model:m.model,days:m.days?.slice(0,2)}))};
  }
  const responsePrompt='You are Atmos, a careful meteorological analyst and natural conversational partner. User question: '+fullQuestion+
  '\nEarlier dialog:\n'+recent+'\nRETRIEVED TOOL EVIDENCE (source of numerical truth):\n'+JSON.stringify(evidence)+
  '\nAnswer in the USER QUESTION LANGUAGE (Hebrew or English), concisely and naturally. Never expose internal API statuses, debug details, or fabricate observations.'+
  ' For synoptic_multi_day_forecast, this is a genuine MULTI-DAY numerically sampled synoptic analysis over Israel and the eastern Mediterranean, based on model outputs at multiple valid times. Discuss chronological changes in pressure, 500hPa geopotential heights, 850hPa temperature and model rainfall for the NEXT 7 days; discuss model disagreement, likelihood of wet/dry periods, and which days trend more unsettled. Make a grounded interpretation, not a list of numbers. Explain that charts are derived from model fields, not retrieved Wetterzentrale images. Name only model data sources actually available. Earlier model runs are comparable ONLY if earlier_forecast_comparison is non-null with values. Recent commentary is supplementary and only if valid timestamps. For weekly synoptic research allow 2-4 short paragraphs, more than the short 3-sentence limit. No fictional probabilities.'+
  ' For regional_analogue_research: explain these are exploratory regional near-surface analogues based on ERA5 reanalysis, NOT full historic weather-map image matching.'+
  ' Identify actual analogue dates and ERA5 rain amounts, and if available the forecast model estimated precipitation and maximum hourly precipitation probability.'+
  ' NEVER turn the wet-day count among the top analogues into a calibrated rain probability; it is just a tiny retrospective comparison.'+
  ' If the user requests a numeric rain chance, give the model probability only with its exact meaning, or say that no defensible calibrated probability is available.'+
  ' For ims_nationwide_observed_last_night: compare measured IMS station totals for the reported 18:00-06:00 window. Mention actual station names and how many stations returned valid samples; DO NOT treat missing samples as zero, or claim a verified national record if coverage incomplete. These are observations, not forecasts. NEVER ask to pick a town for a nationwide question.'+
  ' For israel_national_precipitation_comparison: compare the ranked sampled locations, list 3-5 leading regions with model mean rainfall in mm and the exact Israel-local hours. Do NOT claim you checked all IMS stations: these are MODEL forecast grid points, not observations. No city clarification is needed. If all amounts are zero say so. A sampled maximum is not a verified nationwide maximum.'+
  ' For combined_forecast_map_research, summarize the numeric 3x3 model precipitation maps, model disagreement and synoptic context. These are derived from Open-Meteo, NOT downloaded Weather2day/Wetterzentrale images. For a region like Southern Golan say a representative reference point was used and local elevation may change rainfall.'+
  ' Keep it to roughly 3-5 sentences unless the user explicitly asks for detailed analysis; show specific relevant model rain totals if present. Never invent a precise daily probability. Use plain text only, no Markdown syntax (no **, ###, or bullets).'+
  ' Do not claim the data are real IMS gauge measurements when they are ERA5 reanalysis. For other tools distinguish observations from forecasts.'+
  ' When near-station fallback is used, disclose the station name and distance. If data are missing, state uncertainty and offer a relevant next step.';
  const answer=await callGPT(responsePrompt);
  bubble.textContent=answer;
  if(result?.kind==='synoptic_multi_day_forecast'){
   const refs=document.createElement('div');
   refs.className='precip-links';
   for(const source of result.original_maps||[]){
    const link=document.createElement('a');link.href=source.url;link.target='_blank';
    link.rel='noopener noreferrer';link.textContent=source.name;refs.appendChild(link);
   }
   bubble.insertAdjacentElement('afterend',refs);
  }
  if(result?.kind==='combined_forecast_map_research'&&result.precipitation_maps){
    try{window.AtmosPrecipMaps?.render(result.precipitation_maps,bubble);}catch(err){console.warn('Map display unavailable',String(err));}
  }
  if(spoken)window.AtmosVoiceUI?.onAnswer(answer,true);
  history.push({role:'assistant',text:answer});
  history=history.slice(-10);
 }catch(e){
   console.warn('Atmos weather request failed',String(e));
   const problem=String(e?.message||'');
   let message='לא הצלחתי להשלים את הבדיקה כרגע 🌦️ אפשר לנסות שוב בעוד רגע או לנסח את השאלה אחרת.';
   if(problem.includes('SYNOPTIC_DATA_UNAVAILABLE'))
     message='לא הצלחתי לטעון כרגע מספיק מפות מודלים לניתוח אמין של השבוע. אפשר לנסות שוב בעוד כמה דקות.';
   if(problem.includes('IMS_NOT_CONFIGURED')||problem.includes('טוקן שמ״ט'))
     message='חסר לי חיבור לנתוני המדידות. אפשר לבדוק אותו בלשונית היסטוריה.';
   else if(problem.includes('INVALID_DATE_RANGE')||problem.includes('טווח תאריכים'))
     message='בוא ננסה טווח קצר יותר — עד כחצי שנה בכל שאלה 🙂';
   else if(problem.includes('STATION_NOT_FOUND')||problem.includes('לא נמצאו קואורדינטות'))
     message='לא הצלחתי לזהות את המקום. אפשר לנסות שם יישוב אחר?';
   bubble.textContent=message;
   if(spoken)window.AtmosVoiceUI?.onAnswer(message,true);
   history.push({role:'assistant',text:message});history=history.slice(-10);
}
 finally{bubble.classList.remove('loading');busy=false;$('chatSend').disabled=false;}
}
window.AtmosGPTChat={setup,send};
})();
