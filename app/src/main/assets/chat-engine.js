/* Atmos local query planner v1: no external LLM, no secret leaves device. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const norm=x=>String(x||"").toLowerCase().replace(/[\u0591-\u05c7]/g,"").replace(/[\u200e\u200f]/g,"").replace(/[–—־-]/g," ").replace(/\s+/g," ").trim();
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const days=(a,b)=>Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/86400000);
const monthNames={"ינואר":1,"פברואר":2,"מרץ":3,"אפריל":4,"מאי":5,"יוני":6,"יולי":7,"אוגוסט":8,"ספטמבר":9,"אוקטובר":10,"נובמבר":11,"דצמבר":12};
const stationAliases={"אבני איתן":["אבני איתן","אבני"],"מרום גולן":["מרום גולן","פיכמן"],"צפת – הר כנען":["הר כנען","צפת"],"חיפה – הטכניון":["טכניון"],"ירושלים – גבעת רם":["גבעת רם"],"טבריה":["טבריה"]};
let stationCache=null,metaCache=new Map(),dataCache=new Map(),working=false;
const say=(who,t)=>{let box=document.createElement("div");box.className="chat-bubble "+who;box.textContent=t;$("chatMessages").appendChild(box);$("chatMessages").scrollTop=$("chatMessages").scrollHeight;return box};
const setBusy=x=>{$("chatSend").disabled=x;$("chatInput").disabled=x;working=x};
function months(s,now){let results=[];for(let [name,index] of Object.entries(monthNames))if(s.includes(name)){let y=(s.match(/20\d{2}/)||[])[0];let year=y?+y:now.getFullYear();if(!y&&index>now.getMonth()+1)year--;results.push({month:index,year})}return results}
function monthRange(year,month){return {from:iso(new Date(year,month-1,1)),to:iso(new Date(year,month,0))}}
function range(text){
let s=norm(text),now=new Date(),date=iso(now),monthHits=months(s,now),compare=/בהשוואה|לעומת|השווה|השוואה|מול|שנה שעברה|אשתקד|שנה קודמת/.test(s);
const explicit= s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2}).*?(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
if(explicit){const from=[explicit[1],explicit[2].padStart(2,"0"),explicit[3].padStart(2,"0")].join("-"),to=[explicit[4],explicit[5].padStart(2,"0"),explicit[6].padStart(2,"0")].join("-");return [{from,to,label:from+" עד "+to}]}
if(monthHits.length){let m=monthHits[0],a=monthRange(m.year,m.month);if(a.to>date)a.to=date;let out=[{...a,label:Object.keys(monthNames).find(k=>monthNames[k]===m.month)+" "+m.year}];if(compare){const prev=monthRange(m.year-1,m.month);out.push({...prev,label:Object.keys(monthNames).find(k=>monthNames[k]===m.month)+" "+(m.year-1)})}return out}
if(/שנה שעברה|אשתקד/.test(s)){let y=now.getFullYear()-1;return [{from:y+"-01-01",to:y+"-12-31",label:"שנת "+y}]}
if(/השנה|שנתי/.test(s)){let y=now.getFullYear();return [{from:y+"-01-01",to:date,label:"מתחילת "+y}]}
if(/חודש שעבר|החודש הקודם/.test(s)){let d=new Date(now.getFullYear(),now.getMonth()-1,1),a=monthRange(d.getFullYear(),d.getMonth()+1);return [{...a,label:"החודש שעבר"}]}
if(/החודש/.test(s)){let d=new Date(now.getFullYear(),now.getMonth(),1);return [{from:iso(d),to:date,label:"החודש"}]}
let n= /שבועיים/.test(s)?14:/שבוע/.test(s)?7:/\b30\b|שלושים/.test(s)?30:/\b14\b/.test(s)?14:7;
let from=new Date(now);from.setDate(now.getDate()-n+1);return [{from:iso(from),to:date,label:n+" הימים האחרונים"}];
}
function parseMetric(s){
if(/גשם|משקע|ממטר|רטוב/.test(s))return "rain";
if(/רוח|רוחות|משב/.test(s))return /משב|מקסימ|הכי חזקה/.test(s)?"gust":"wind";
if(/לחות/.test(s))return "humid";
if(/טמפרטור|מעלות|חום|קור|חם|קר/.test(s))return /מקסימ|גבוה|חם ביותר/.test(s)?"max":/מינימ|נמוך|קר ביותר/.test(s)?"min":"temp";
return null;
}
async function stations(){
if(stationCache)return stationCache;
const raw=await window.imsRequest("");
const arr=window.imsList(raw).map(x=>({id:Number(x.stationId??x.id),name:window.hebrewStationName(x.name??x.stationName??""),original:String(x.name??x.stationName??"")})).filter(x=>Number.isInteger(x.id)&&x.name);
if(!arr.length)throw Error("לא התקבלה רשימת תחנות מהשמ״ט.");
stationCache=arr;return arr;
}
function pickStations(question,all){
const s=norm(question),hits=[];
for(let st of all){
let aliases=[st.name,st.original,...(stationAliases[st.name]||[])].map(norm).filter(x=>x.length>=3);
let match=aliases.reduce((n,a)=>s.includes(a)?Math.max(n,a.length):n,0);
if(match>0)hits.push({...st,score:match});
}
hits.sort((a,b)=>b.score-a.score);
const unique=[];for(let x of hits){if(!unique.some(u=>u.id===x.id)&&!unique.some(u=>norm(u.name)===norm(x.name)))unique.push(x);}
return unique.slice(0,/לעומת|מול|השווה|השוואה|השוואת/.test(s)?2:1);
}
function chunks(from,to){if(from>to||days(from,to)>370)throw Error("בחר תקופה של עד שנה. לתקופות ארוכות נדרש עיבוד נפרד.");let out=[],d=new Date(from+"T12:00:00Z"),last=new Date(to+"T12:00:00Z");while(d<=last){const a=new Date(d),b=new Date(d);b.setUTCDate(b.getUTCDate()+26);if(b>last)b.setTime(last.getTime());out.push({from:iso(a),to:iso(b)});d.setUTCDate(b.getUTCDate()+1);if(out.length>14)throw Error("טווח ארוך מדי");}return out}
async function fetchPeriod(st,range){
let meta=metaCache.get(st.id);if(!meta){meta=await window.imsRequest("/"+st.id);metaCache.set(st.id,meta)}
let all=[];for(let part of chunks(range.from,range.to)){let path="/"+st.id+"/data?from="+part.from.replaceAll("-","/")+"&to="+part.to.replaceAll("-","/");let raw=dataCache.get(path);if(!raw){raw=await window.imsRequest(path);if(dataCache.size>24)dataCache.clear();dataCache.set(path,raw)}all.push(...window.imsList(raw))}
return {stat:window.imsStatistics(all,meta),count:all.length};
}
const units={rain:"מ״מ",temp:"°C",max:"°C",min:"°C",wind:"מ׳/ש",gust:"מ׳/ש",humid:"%"};
const titles={rain:"סכום משקעים",temp:"טמפרטורה ממוצעת",max:"טמפרטורה מרבית",min:"טמפרטורה מזערית",wind:"מהירות רוח ממוצעת",gust:"משב מרבי",humid:"לחות ממוצעת"};
const fields={rain:"Rain",temp:"TD",max:"TDmax",min:"TDmin",wind:"WS",gust:"WSmax",humid:"RH"};
async function process(q){
const metric=parseMetric(q);if(!metric)return "כרגע אני יודע לענות על גשם, טמפרטורה, רוח ולחות לפי מדידות השמ״ט. לדוגמה: כמה גשם ירד באבני איתן באוקטובר 2025?";
if(!window.AtmosIMS?.isConfigured())return "כדי לשלוף מדידות, עבור ללשונית היסטוריה והזן שם את טוקן השמ״ט פעם אחת. הוא נשמר מוצפן בטלפון.";
const all=await stations(),selection=pickStations(q,all);
if(!selection.length)return "לא זיהיתי תחנה ברשימת תחנות השמ״ט. כתוב את שם התחנה, למשל ״אבני איתן״, ״מרום גולן״ או ״חיפה – הטכניון״.";
let ranges=range(q);let jobs=selection.flatMap(s=>ranges.map(r=>({station:s,range:r})));
if(jobs.length>4)return "יש יותר מדי השוואות בבקשה אחת. נסה לצמצם לשתי תחנות ושתי תקופות.";
let lines=[],values=[];
for(let job of jobs){let {stat,count}=await fetchPeriod(job.station,job.range),v=stat[metric],samples=stat.counts[fields[metric]]||0;values.push(v);
lines.push(job.station.name+" · "+job.range.label+": "+(v==null?"אין נתונים זמינים":v+" "+units[metric])+" ("+samples+" מדידות רלוונטיות; "+count+" רשומות זמן)");}
let header=titles[metric]+" — השירות המטאורולוגי הישראלי";
if(jobs.length===2&&values.every(v=>Number.isFinite(v))){
const delta=Math.round((values[0]-values[1])*100)/100;
lines.push("הפרש בין הראשון לשני: "+(delta>0?"+":"")+delta+" "+units[metric]);}
lines.push("מקור: מדידות IMS אוטומטיות. ממוצעים מחושבים מדגימות זמינות, לא מנורמות אקלימיות מבוקרות. נתונים חסרים עשויים להשפיע על התוצאה.");
return header+"\n\n"+lines.join("\n\n");
}
window.AtmosChat={send:async function(raw){if(working)return;let q=String(raw||"").trim();if(!q)return;say("user",q);$("chatInput").value="";setBusy(true);let reply=say("assistant","רגע, אוסף טיפות מידע ☔");try{reply.textContent=await process(q)}catch(e){reply.textContent="לא הצלחתי להשלים את השאילתה: "+e.message+"\nנסה תקופה קצרה יותר או בדוק את החיבור לשמ״ט."}finally{setBusy(false)}},init:function(){
$("chatSend").onclick=() => window.AtmosChat.send($("chatInput").value);
$("chatInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();window.AtmosChat.send($("chatInput").value)}};
document.querySelectorAll("[data-chat-example]").forEach(b=>b.onclick=()=>window.AtmosChat.send(b.dataset.chatExample));
say("assistant","היי! ☁️ מה מסקרן אותך במזג האוויר?");
}};
})();
