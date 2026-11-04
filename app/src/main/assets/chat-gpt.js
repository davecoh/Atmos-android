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
  const now=isoLocal(new Date());let stations=[];
  if(window.AtmosIMS?.isConfigured()){try{stations=stationList(await window.imsRequest(''))}catch(e){/* still supports forecasts and general questions */}}
  const list=stations.slice(0,180).map(s=>s.id+':'+s.name).join('; ');
  const recent=history.slice(-4).map(x=>x.role+': '+x.text).join('\n');
  const planning='You are a weather data query planner for Israel. Today is '+now+'. User question: '+q+
   '\nContext:\n'+recent+'\nAvailable IMS station IDs and Hebrew names: '+list+
   '\nReturn ONLY a JSON object with action historical, forecast, or general. For historical include metric (rain,temp,max,min,wind,gust,humid), stations (array of 1-2 numeric IDs from list), periods (1-2 objects with from/to ISO dates). For forecast do not invent external station IDs. For general include answer for general non-data weather concepts. Never invent station IDs, do not claim historical measurements without tool data. Maximum period 186 days each. If ambiguous, return action general and answer asking a precise question.';
  let plan;
  try{plan=jsonText(await callGPT(planning));}catch(e){throw Error('לא ניתן לפענח תוכנית שאילתות מהמודל: '+e.message)}
  let result;
  if(plan.action==='historical'){bubble.textContent='GPT בחר תחנות ותאריכים. מוריד נתוני שמ״ט…';result=await historyTool(plan,stations);}
  else if(plan.action==='forecast'){bubble.textContent='GPT בחר ניתוח תחזית המודלים…';result=forecastTool();}
  else if(plan.action==='general'){result={kind:'general',note:'No real-time data queried',answer:String(plan.answer||'לא נבחרה שאילתת נתונים')};}
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
