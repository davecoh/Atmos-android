/* Nationwide model precipitation comparison for location-free questions.
 * Forecast maps and IMS stations serve different purposes: this uses modeled
 * hourly precipitation at representative locations, NOT past station totals.
 */
(function(){
"use strict";
const POINTS=[
 ['קריית שמונה',33.207,35.570],['צפת',32.965,35.498],['נהריה',33.010,35.095],
 ['חיפה',32.815,34.990],['קצרין',32.991,35.688],['מרום גולן',33.133,35.777],
 ['דרום הגולן',32.763,35.663],['טבריה',32.795,35.533],
 ['נצרת',32.703,35.298],['עפולה',32.609,35.292],['חדרה',32.435,34.919],
 ['נתניה',32.333,34.859],['תל אביב',32.085,34.782],['פתח תקווה',32.087,34.887],
 ['אשדוד',31.801,34.643],['אשקלון',31.668,34.574],['בית שמש',31.745,34.989],
 ['ירושלים',31.768,35.215],['אריאל',32.106,35.185],['בית שאן',32.497,35.499],
 ['באר שבע',31.251,34.791],['שדרות',31.525,34.598],['ערד',31.259,35.212],
 ['ים המלח',31.550,35.470],['מצפה רמון',30.610,34.802],['אילת',29.557,34.952]
];
const MODELS=[['ECMWF','ecmwf'],['ICON','dwd-icon'],['GFS','gfs']];
function parts(ms){
 const d=new Date(ms),fmt=new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'
 }).formatToParts(d);
 const map=Object.fromEntries(fmt.map(p=>[p.type,p.value]));
 return {date:map.year+'-'+map.month+'-'+map.day,hour:Number(map.hour)};
}
function nextDate(s){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function targetHours(period,chosen){
 const now=parts(Date.now()),date=/^\d{4}-\d{2}-\d{2}$/.test(chosen||'')?chosen:now.date;
 const tomorrow=nextDate(date);
 if(period==='tonight')return {from:date+'T18:00',to:tomorrow+'T06:00',title:'הלילה'};
 if(period==='tomorrow')return {from:tomorrow+'T00:00',to:nextDate(tomorrow)+'T00:00',title:'מחר'};
 if(period==='weekend'){
  let d=new Date(date+'T12:00:00Z'),day=d.getUTCDay();
  d.setUTCDate(d.getUTCDate()+(5-day+7)%7);
  const friday=d.toISOString().slice(0,10);
  return {from:friday+'T00:00',to:nextDate(nextDate(friday))+'T00:00',title:'סוף השבוע'};
 }
 return {from:date+'T00:00',to:nextDate(date)+'T00:00',title:'ביום המבוקש'};
}
async function load(model){
 const query=new URLSearchParams({
  latitude:POINTS.map(p=>p[1]).join(','),
  longitude:POINTS.map(p=>p[2]).join(','),
  hourly:'precipitation',
  timezone:'Asia/Jerusalem',forecast_days:'9'
 });
 const ctrl=new AbortController(),id=setTimeout(()=>ctrl.abort(),20000);
 try{
  const res=await fetch('https://api.open-meteo.com/v1/'+model+'?'+query,{cache:'no-store',signal:ctrl.signal});
  if(!res.ok)throw Error('Model unavailable');
  const result=await res.json();
  const sites=Array.isArray(result)?result:[result];
  if(sites.length!==POINTS.length)throw Error('Incomplete regional coverage');
  return sites;
 }finally{clearTimeout(id);}
}
function sum(site,window){
 const h=site?.hourly||{},list=h.time||[],values=h.precipitation||[];
 let total=0,n=0,missing=0;
 for(let i=0;i<list.length;i++){
  if(list[i]>=window.from&&list[i]<window.to){
   if(typeof values[i]==='number'&&Number.isFinite(values[i])){total+=values[i];n++}
   else missing++;
  }
 }
 if(!n||missing)return null;
 return Math.round(total*10)/10;
}
async function compare({period,date}={}){
 const window=targetHours(period,date);
 const fetched=await Promise.allSettled(MODELS.map(m=>load(m[1])));
 const models=fetched.map((r,i)=>({
  name:MODELS[i][0],sites:r.status==='fulfilled'?r.value:null
 }));
 const usable=models.filter(x=>x.sites);
 if(!usable.length)throw Error('NATIONAL_FORECAST_UNAVAILABLE');
 const locations=POINTS.map((p,i)=>{
  const amounts=usable.map(x=>({model:x.name,mm:sum(x.sites[i],window)}));
  const valid=amounts.filter(x=>x.mm!==null);
  const mean=valid.length?valid.reduce((t,x)=>t+x.mm,0)/valid.length:null;
  return {name:p[0],latitude:p[1],longitude:p[2],
   mean_mm:mean===null?null:Math.round(mean*10)/10,
   min_mm:valid.length?Math.min(...valid.map(x=>x.mm)):null,
   max_mm:valid.length?Math.max(...valid.map(x=>x.mm)):null,
   model_forecasts:amounts,models_reporting:valid.length};
 });
 const ranked=locations.filter(x=>x.mean_mm!==null).sort((a,b)=>b.mean_mm-a.mean_mm);
 return {kind:'israel_national_precipitation_comparison',
  time_window_israel:window,source:'Open-Meteo per-model hourly precipitation forecasts',
  models_available:usable.map(x=>x.name),
  models_unavailable:models.filter(x=>!x.sites).map(x=>x.name),
  points_sampled:POINTS.length,top_areas:ranked.slice(0,8),
  low_rain_areas:ranked.slice(-4),all_areas:locations,
  limitations:'Sampled representative towns/regions, not every location or actual IMS station; highest among sampled areas is NOT guaranteed nationwide maximum. Mean mm is a simple model consensus, not a calibrated rain probability. Rainfall is a forecast, not IMS observation. Model grids differ in resolution. A single night may span two dates; time window in Israel local time is explicit. Do not infer confidence from number of models alone.'};
}
window.AtmosNationwide={compare};
})();