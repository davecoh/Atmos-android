/* Atmos analogue research: reanalysis comparisons of regional near-surface patterns.
 * Does NOT claim synoptic-chart matching or a statistically calibrated rain probability.
 */
(function(){
"use strict";
const W=['pressure_msl','temperature_2m','relative_humidity_2m','wind_speed_10m'];
const forecastCache=new Map();
const point=({lat,lon})=>({latitude:lat,longitude:lon});
const localDate=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
function coords(lat,lon){return [point({lat,lon}),point({lat:lat+0.65,lon}),point({lat,lon:lon-0.85})];}
function nearestIndex(times,date,hour=12){return times.findIndex(t=>t.startsWith(date+'T'+String(hour).padStart(2,'0')+':'));}
async function loadJSON(url){
 const c=new AbortController(),timeout=setTimeout(()=>c.abort(),18000);
 try{
  const r=await fetch(url,{cache:'no-store',signal:c.signal});
  if(!r.ok)throw Error('Archive service unavailable');
  return await r.json();
 }finally{clearTimeout(timeout);}
}
function params(points,extras){
 return new URLSearchParams({
  latitude:points.map(x=>x.latitude.toFixed(3)).join(','),
  longitude:points.map(x=>x.longitude.toFixed(3)).join(','),
  timezone:'Asia/Jerusalem',...extras
 });
}
function numberAt(a,i){const x=a?.[i];return typeof x==='number'&&Number.isFinite(x)?x:null;}
function fingerprint(series,date){
 const nodes=series.map(site=>{
  const h=site?.hourly||{},idx=nearestIndex(h.time||[],date);
  return idx<0?null:Object.fromEntries(W.map(k=>[k,numberAt(h[k],idx)]));
 });
 if(nodes.some(x=>!x||W.some(k=>x[k]===null)))return null;
 const [center,north,west]=nodes;
 return {date,
  pressure:center.pressure_msl,temperature:center.temperature_2m,
  humidity:center.relative_humidity_2m,wind:center.wind_speed_10m,
  northPressureDifference:north.pressure_msl-center.pressure_msl,
  westPressureDifference:west.pressure_msl-center.pressure_msl,
  northTemperatureDifference:north.temperature_2m-center.temperature_2m
 };
}
function similarity(a,b){
 // Dimensionless weighted Euclidean distance, for ranking only.
 // These scale choices are heuristics, NOT training-based calibration.
 const dimensions=[
 ['pressure',9,1.2],['temperature',5,.75],['humidity',23,.55],
 ['wind',12,.45],['northPressureDifference',4,1],
 ['westPressureDifference',4,1],['northTemperatureDifference',4,.4]
 ];
 return dimensions.reduce((sum,[key,scale,weight])=>sum+weight*((a[key]-b[key])/scale)**2,0);
}
function readRain(site,date){
 const i=(site?.daily?.time||[]).indexOf(date);
 return i<0?null:numberAt(site.daily.precipitation_sum,i);
}
async function searchAnalogs({latitude,longitude,date,years=3}){
 const lat=Number(latitude),lon=Number(longitude);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<29||lat>34||lon<34||lon>37)
   throw Error('OUT_OF_AREA');
 const today=localDate(new Date());
 const target=String(date||addDays(today,1));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(target)||target<today||target>addDays(today,6))
   throw Error('FORECAST_DATE_UNAVAILABLE');
 const pts=coords(lat,lon);
 const forecastParams=params(pts,{
  hourly:W.concat('precipitation_probability').join(','),
  daily:'precipitation_sum,precipitation_probability_max',
  forecast_days:'7'
 });
 const current=await loadJSON('https://api.open-meteo.com/v1/forecast?'+forecastParams);
 const currentSites=Array.isArray(current)?current:[current];
 if(currentSites.length!==3)throw Error('FORECAST_GRID_UNAVAILABLE');
 const targetVector=fingerprint(currentSites,target);
 if(!targetVector)throw Error('FORECAST_PATTERN_UNAVAILABLE');
 const maxProbIndex=(currentSites[0]?.daily?.time||[]).indexOf(target);
 const pmax=maxProbIndex<0?null:numberAt(currentSites[0]?.daily?.precipitation_probability_max,maxProbIndex);
 const forecastRain=readRain(currentSites[0],target);
 const available=[],errors=[];
 const n=Math.min(Math.max(Number(years)||3,1),4);
 const targetYear=Number(target.slice(0,4)),month=target.slice(5,7),day=target.slice(8,10);
 for(let y=targetYear-1;y>=targetYear-n;y--){
  let pivot=y+'-'+month+'-'+day;
  if(Number.isNaN(Date.parse(pivot))||pivot.slice(5)==='02-29'&&!Number.isFinite(Date.parse(pivot+'T12:00:00Z')))pivot=y+'-02-28';
  const from=addDays(pivot,-25),to=addDays(pivot,25);
  try{
   const query=params(pts,{start_date:from,end_date:to,models:'era5',
    hourly:W.join(','),daily:'precipitation_sum'});
   const historical=await loadJSON('https://archive-api.open-meteo.com/v1/archive?'+query);
   const sites=Array.isArray(historical)?historical:[historical];
   if(sites.length!==3){errors.push(y);continue;}
   const dates=sites[0]?.daily?.time||[];
   for(const d of dates){
    const f=fingerprint(sites,d);if(!f)continue;
    const rain=readRain(sites[0],d);if(rain===null)continue;
    available.push({date:d,score:similarity(targetVector,f),rain_mm:Math.round(rain*10)/10,
      pressure_hpa:Math.round(f.pressure),temperature_c:Math.round(f.temperature)});
   }
  }catch(e){errors.push(y);}
 }
 available.sort((a,b)=>a.score-b.score);
 const chosen=[];
 for(const item of available){
  if(chosen.every(x=>Math.abs((Date.parse(x.date)-Date.parse(item.date))/86400000)>=5))chosen.push(item);
  if(chosen.length===5)break;
 }
 const complete=chosen.length>=3;
 const wet=chosen.filter(x=>x.rain_mm>=0.2).length;
 return {
  kind:'regional_analogue_research',place:{latitude:lat,longitude:lon},
  target_date:target,forecast:{source:'Open-Meteo best match',updated_for:target,
    rain_mm:forecastRain,rain_probability_max_percent:pmax,
    description:'Daily model forecast; probability_max is the highest hourly rain probability, NOT a daily calibrated probability'},
  matching_method:'regional surface-pressure, temperature, humidity and wind pattern at 12:00 local; 3 grid points near location, reanalysis ERA5',
  years_searched:n,analogue_count:chosen.length,analogues:chosen,
  observed_analogue_rain_frequency:complete?{wet_days:wet,total:chosen.length,threshold_mm:0.2}:null,
  completeness:complete?'exploratory':'insufficient',
  inaccessible_years:errors,
  limitations:'This is a small heuristic regional near-surface analogue sample, not full synoptic chart or 500-hPa map similarity. ERA5 precipitation is reanalysis, not observed IMS gauges. Analogue wet-day frequency is NOT a calibrated rain probability. Do not invent missing results. To verify analogues use separate IMS station measurements for exact dates.'
 };
}
window.AtmosAnalogues={search:searchAnalogs};
})();