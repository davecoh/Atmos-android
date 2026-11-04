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
 const id='ai'+(++seq);pending.set(id,{resolve,reject});
 getNative().ask(prompt,model(),id);
});}
window.atmosAIResult=(id,result,error)=>{const p=pending.get(id);if(!p)return;pending.delete(id);if(error)p.reject(Error(error));else p.resolve(result);};
window.atmosModelsResult=(id,raw,error)=>{
 if(error){status('לא ניתן לטעון מודלים: '+error);return;}
 try{
  const data=JSON.parse(raw),models=(data.models||data.data||[]).filter(m=>m&&((m.visibility==='list')||!m.visibility));
  $('gptModel').replaceChildren();
  for(const m of models){const option=document.createElement('option');option.value=m.slug||m.id;option.textContent=m.display_name||m.name||option.value;$('gptModel').appendChild(option);}
  if(!models.length)status('אין מודלים זמינים בחשבון עבור מסלול ההתחברות.');
  else status('מחובר למנוי ChatGPT. ניתן לשאול שאלות.');
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
 const known=LOCATIONS.find(x=>x.aliases.some(a=>name===a||name.includes(a)));
 if(known)return {latitude:known.lat,longitude:known.lon,label:known.name,source:'יישוב מוגדר'};
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
function forecastTool(){
 if(!Array.isArray(window.current)&&typeof current==='undefined')throw Error('יש לפתוח קודם את לשונית תחזית כדי לטעון מודלים');
 const data=typeof current!=='undefined'?current:window.current;
 if(!data.length)throw Error('תחזית עדיין לא נטענה');
 return {kind:'model_forecast',location:$('place').selectedOptions[0]?.textContent,models:data.map(m=>({name:m.id,days:m.days})),recentCommunityPosts:(window.latestAtmosNews?.posts||[]).slice(0,6).map(x=>({source:x.source,time:x.time,excerpt:x.text,url:x.url})),note:'Numeric forecasts come ONLY from Open-Meteo models. Community posts are dated qualitative context, NOT location-specific measurements. Weather2day maps are linked for manual inspection; their raster values are NOT analyzed by the app. Do not assert map-based corrections.'};
}
async function send(raw){
 let q=String(raw||'').trim();if(!q||busy)return;
 messages('user',q);$('chatInput').value='';
 const fullQuestion=contextualQuestion(q);
 if(q.length>35&&!/^(ו?ב|ומה|ולגבי)/.test(q))lastDetailedQuestion=q;
 history.push({role:'user',text:q});history=history.slice(-10);
 if(!getNative()?.connected()){messages('assistant','בוא נתחבר ל-ChatGPT, ואז נדבר על מזג האוויר ☀️');return;}
 if(!model()){messages('assistant','חסר לי מודל לשיחה. בוא ננסה להתחבר שוב 🙂');return;}
 busy=true;$('chatSend').disabled=true;
 const bubble=messages('assistant','רגע, מציץ בעננים ☁️');bubble.classList.add('loading');
 try{
  const now=isoLocal(new Date());
  const historical=isHistoricalQuestion(fullQuestion);
  let stations=[];
  if(historical){
    bubble.textContent='מוציא מטרייה לנתונים ☔';
    stations=await requireIMSStations();
  }else if(window.AtmosIMS?.isConfigured()){
    try{stations=stationList(await window.imsRequest(''));}catch(e){stations=[];}
  }
  if(isStationDirectoryQuestion(fullQuestion)){
    const names=stations.slice(0,35).map(x=>x.name+' (מספר '+x.id+')');
    const answer='תחנות שמ״ט זמינות ('+stations.length+' בסך הכול):\\n'+names.join('\\n')+
      (stations.length>names.length?'\\n… ותחנות נוספות.':'');
    bubble.textContent=answer;history.push({role:'assistant',text:answer});history=history.slice(-10);
    return;
  }
  const list=stations.slice(0,180).map(s=>s.id+':'+s.name+(s.location?' @'+s.location.latitude+','+s.location.longitude:'')).join('; ');
  const recent=history.slice(-6).map(x=>x.role+': '+x.text).join('\n');
  const knownPlace=explicitPlaceInQuestion(fullQuestion,stations);
  const planning='You are an Atmos weather query planner for Israel. Today is '+now+'. User request (including previous context): '+fullQuestion+
   '\\nPrior dialogue: '+recent+'\\nIMS station IDs and names: '+list+
   '\\nHistorical observations required: '+historical+
   '. Place without exact station match in the user question: '+(knownPlace||'none')+
   '. Reply ONLY with a JSON object: action historical, forecast or general. For questions requesting historical measurements, select historical. Do not ask the user to provide stations or raw data; the application fetches them.'+
   ' For a requested town with no exact weather station, set match_strategy=nearest, place=the exact town name, stations=[]; the app geocodes it and calculates the closest station with the requested metric. Do not invent station coordinates.'+
   ' For historical provide metric rain,temp,max,min,wind,gust,humid, stations array of 1 or 2 numeric IDs FROM THE LIST, periods array of 1 or 2 objects {from,to} ISO dates (each at most 186 days). Preserve years including 1992.'+
   ' For forecast use action forecast. For general explanation or ambiguous station use action general with answer. Do not invent weather measurements or station IDs. Recent community posts are only contextual and must be dated and attributed.';
  let plan;
  try{plan=jsonText(await callGPT(planning));}catch(e){throw Error('לא ניתן לפענח תוכנית שאילתות מהמודל: '+e.message)}
  if(historical&&knownPlace&&plan.action==='historical'){
    plan.match_strategy='nearest';
    plan.place=knownPlace;
    plan.stations=[]; // Never claim an unrelated station belongs to this town.
  }
  let result;
  if(plan.action==='historical'){bubble.textContent='מחפש טיפות של מידע 💧';result=await historyTool(plan,stations);}
  else if(plan.action==='forecast'){bubble.textContent='מציץ אל העתיד 🔮';result=forecastTool();}
  else if(plan.action==='general'){
    if(historical&&stations.length&&!isStationDirectoryQuestion(fullQuestion)){
      bubble.textContent='עוד רגע, מסדר את העננים ☁️';
      const retry='Return only JSON. Weather station data exists in the app, not your model memory. Question: '+fullQuestion+
      '. Station IDs and Hebrew names: '+list+
      '. Choose action historical, metric and stations numeric IDs from list, periods ISO from/to. Never request the station list from user. If location cannot be matched, choose general with a short clarification.';
      const next=jsonText(await callGPT(retry));
      if(next.action==='historical')result=await historyTool(next,stations);
      else throw Error('לא זוהתה תחנה מתאימה. בחר תחנה המופיעה בלשונית היסטוריה ונסה שוב.');
    }else result={kind:'general',note:'No weather database queried',answer:String(plan.answer||'לא נבחרה שאילתה')};
  }
  else throw Error('המודל החזיר פעולה לא מאושרת');
  bubble.textContent='מחבר את הנקודות ✨';
  const responsePrompt='You are Atmos, a careful Hebrew weather assistant. Respond in Hebrew. User question: '+fullQuestion+
  '\nEarlier dialog:\n'+recent+'\nVERIFIED TOOL OUTPUT (source of numerical truth):\n'+JSON.stringify(result)+
  '\nWrite a SHORT, warm, user-facing answer in natural Hebrew. Never expose internal error messages, API statuses, codes, JSON keys, debugging or data-loading details. Do not mention attempted_api_requests. Never invent measured values, missing observations or stations. When all results have status unavailable, say simply that reliable measurements for the requested years could not be found, and offer to try other years or nearby stations. When nearby_fallback or nearest_with_available_data was used, clearly state which station was measured (not the requested town), and mention distance when available. For partial observations, explicitly call the sum partial, NOT a monthly total. Distinguish observations from forecasts. Keep concise and friendly.';
  const answer=await callGPT(responsePrompt);
  bubble.textContent=answer;
  history.push({role:'assistant',text:answer});
  history=history.slice(-10);
 }catch(e){
   console.warn('Atmos weather request failed',String(e));
   const problem=String(e?.message||'');
   let message='לא מצאתי כרגע תשובה מספיק אמינה 🌦️ אפשר לנסות תקופה אחרת או תחנה סמוכה?';
   if(problem.includes('IMS_NOT_CONFIGURED')||problem.includes('טוקן שמ״ט'))
     message='חסר לי חיבור לנתוני המדידות. אפשר לבדוק אותו בלשונית היסטוריה.';
   else if(problem.includes('INVALID_DATE_RANGE')||problem.includes('טווח תאריכים'))
     message='בוא ננסה טווח קצר יותר — עד כחצי שנה בכל שאלה 🙂';
   else if(problem.includes('STATION_NOT_FOUND')||problem.includes('לא נמצאו קואורדינטות'))
     message='לא הצלחתי לזהות את המקום. אפשר לנסות שם יישוב אחר?';
   bubble.textContent=message;
   history.push({role:'assistant',text:message});history=history.slice(-10);
}
 finally{bubble.classList.remove('loading');busy=false;$('chatSend').disabled=false;}
}
window.AtmosGPTChat={setup,send};
})();
