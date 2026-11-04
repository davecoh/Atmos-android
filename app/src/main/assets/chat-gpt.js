/* Atmos GPT weather agent — ChatGPT plan OAuth, local tools, no OpenAI API key. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const pending=new Map();let seq=0,history=[],busy=false;
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
 let stations=stationList(raw);
 if(!stations.length)throw Error('השמ״ט לא החזיר תחנות מזוהות. בדוק את הטוקן או נסה שוב.');
 return stations;
}
function stationList(raw){
 let data=window.imsList(raw);
 return data.map(x=>({id:Number(x.stationId??x.id),name:window.hebrewStationName(x.name??x.stationName??''),original:String(x.name??x.stationName??'')}))
 .filter(x=>Number.isInteger(x.id)&&x.id>0);
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
 if(!window.AtmosIMS?.isConfigured())throw Error('חסר טוקן שמ״ט. פתח את לשונית היסטוריה והזן אותו פעם אחת.');
 if(!METRICS.includes(plan.metric))throw Error('פרמטר לא נתמך');
 const ss=Array.isArray(plan.stations)?plan.stations:[],rr=Array.isArray(plan.periods)?plan.periods:[];
 if(ss.length===0||ss.length>2||rr.length===0||rr.length>2||ss.length*rr.length>4)throw Error('מותר להשוות עד שתי תחנות ושתי תקופות');
 const output=[];
 for(const stationId of ss){
  const info=stations.find(s=>s.id===Number(stationId));if(!info)throw Error('מזהה התחנה אינו ברשימה');
  const meta=await window.imsRequest('/'+info.id);
  for(const range of rr){
   let from=String(range.from),to=String(range.to);
   if(!validDate(from)||!validDate(to)||dateDiff(from,to)<0||dateDiff(from,to)>185)throw Error('טווח תאריכים לא חוקי (עד 186 ימים לתקופה)');
   let rows=[];
   for(const [a,b] of chunks(from,to)){
    let path='/'+info.id+'/data?from='+a.replaceAll('-','/')+'&to='+b.replaceAll('-','/');
    rows.push(...window.imsList(await window.imsRequest(path)));
   }
   const s=window.imsStatistics(rows,meta);
   const key=({rain:'Rain',temp:'TD',max:'TDmax',min:'TDmin',wind:'WS',gust:'WSmax',humid:'RH'})[plan.metric];
   output.push({station:info.name,station_id:info.id,period:{from,to},metric:plan.metric,value:s[plan.metric],matching_measurements:s.counts[key]||0,records:s.samples,invalid:s.rejected,units:({rain:'mm',temp:'C',max:'C',min:'C',wind:'m/s',gust:'m/s',humid:'%'})[plan.metric]});
  }
 }
 return {kind:'IMS_observations',results:output,notes:'Automatic non-climatological measurements, unverified completeness. Null means unavailable; zero means a measured zero. Rain is summed from measured interval Rain values.'};
}
function forecastTool(){
 if(!Array.isArray(window.current)&&typeof current==='undefined')throw Error('יש לפתוח קודם את לשונית תחזית כדי לטעון מודלים');
 const data=typeof current!=='undefined'?current:window.current;
 if(!data.length)throw Error('תחזית עדיין לא נטענה');
 return {kind:'model_forecast',location:$('place').selectedOptions[0]?.textContent,models:data.map(m=>({name:m.id,days:m.days})),note:'Numeric forecast model data, not weather-map visual interpretation or calibrated precipitation probabilities.'};
}
async function send(raw){
 let q=String(raw||'').trim();if(!q||busy)return;
 messages('user',q);$('chatInput').value='';
 if(!getNative()?.connected()){messages('assistant','כדי לקבל תשובה ממודל GPT, לחץ על ״התחבר עם ChatGPT״ ואשר את הגישה למנוי.');return;}
 if(!model()){messages('assistant','לא נבחר מודל. התחבר מחדש או בדוק את הרשאות המנוי.');return;}
 busy=true;$('chatSend').disabled=true;
 const bubble=messages('assistant','GPT מנתח את השאלה…');
 try{
  const now=isoLocal(new Date());
  const historical=isHistoricalQuestion(q);
  let stations=[];
  if(historical){
    bubble.textContent='בודק חיבור לשמ״ט וטוען רשימת תחנות…';
    stations=await requireIMSStations();
  }else if(window.AtmosIMS?.isConfigured()){
    try{stations=stationList(await window.imsRequest(''));}catch(e){stations=[];}
  }
  if(isStationDirectoryQuestion(q)){
    const names=stations.slice(0,35).map(x=>x.name+' (מספר '+x.id+')');
    const answer='תחנות שמ״ט זמינות ('+stations.length+' בסך הכול):\\n'+names.join('\\n')+
      (stations.length>names.length?'\\n… ותחנות נוספות.':'');
    bubble.textContent=answer;history.push({role:'user',text:q},{role:'assistant',text:answer});history=history.slice(-8);
    return;
  }
  const list=stations.slice(0,180).map(s=>s.id+':'+s.name).join('; ');
  const recent=history.slice(-4).map(x=>x.role+': '+x.text).join('\n');
  const planning='You are an Atmos weather query planner for Israel. Today is '+now+'. Question: '+q+
   '\\nPrior dialogue: '+recent+'\\nIMS station IDs and names: '+list+
   '\\nHistorical observations required: '+historical+
   '. Reply ONLY with a JSON object: action historical, forecast or general. For questions requesting historical measurements, select historical if the station is listed. Do not ask the user to provide stations or raw data; the application fetches them.'+
   ' For historical provide metric rain,temp,max,min,wind,gust,humid, stations array of 1 or 2 numeric IDs FROM THE LIST, periods array of 1 or 2 objects {from,to} ISO dates (each at most 186 days). Preserve years including 1992.'+
   ' For forecast use action forecast. For general explanation or ambiguous station use action general with answer. Do not invent weather measurements or station IDs.';
  let plan;
  try{plan=jsonText(await callGPT(planning));}catch(e){throw Error('לא ניתן לפענח תוכנית שאילתות מהמודל: '+e.message)}
  let result;
  if(plan.action==='historical'){bubble.textContent='GPT בחר תחנות ותאריכים. מוריד נתוני שמ״ט…';result=await historyTool(plan,stations);}
  else if(plan.action==='forecast'){bubble.textContent='GPT בחר ניתוח תחזית המודלים…';result=forecastTool();}
  else if(plan.action==='general'){
    if(historical&&stations.length&&!isStationDirectoryQuestion(q)){
      bubble.textContent='מנסה לזהות תחנה ותקופה לשאילתה…';
      const retry='Return only JSON. Weather station data exists in the app, not your model memory. Question: '+q+
      '. Station IDs and Hebrew names: '+list+
      '. Choose action historical, metric and stations numeric IDs from list, periods ISO from/to. Never request the station list from user. If location cannot be matched, choose general with a short clarification.';
      const next=jsonText(await callGPT(retry));
      if(next.action==='historical')result=await historyTool(next,stations);
      else throw Error('לא זוהתה תחנה מתאימה. בחר תחנה המופיעה בלשונית היסטוריה ונסה שוב.');
    }else result={kind:'general',note:'No weather database queried',answer:String(plan.answer||'לא נבחרה שאילתה')};
  }
  else throw Error('המודל החזיר פעולה לא מאושרת');
  bubble.textContent='GPT מנתח את התוצאות…';
  const responsePrompt='You are Atmos, a careful Hebrew weather assistant. Respond in Hebrew. User question: '+q+
  '\nEarlier dialog:\n'+recent+'\nVERIFIED TOOL OUTPUT (source of numerical truth):\n'+JSON.stringify(result)+
  '\nNever invent values, station identifiers or missing observations. Explain precisely what is measured, dates, units, and source. Distinguish automatic observations from climatological normals and numerical forecasts. If no records, say unavailable. Be succinct and insightful.';
  const answer=await callGPT(responsePrompt);
  bubble.textContent=answer;
  history.push({role:'user',text:q},{role:'assistant',text:answer});
  history=history.slice(-8);
 }catch(e){bubble.textContent='השאילתה לא הושלמה: '+e.message;}
 finally{busy=false;$('chatSend').disabled=false;}
}
window.AtmosGPTChat={setup,send};
})();
