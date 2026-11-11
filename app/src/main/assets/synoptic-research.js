/* Atmos multi-day synoptic research v1.
   Derives time-series weather maps from model fields over Israel and eastern
   Mediterranean. Does not download or claim to decode third-party image maps.
 */
(function(){
"use strict";
const MODELS=[{name:'ECMWF',endpoint:'ecmwf'},{name:'ICON',endpoint:'dwd-icon'},{name:'GFS',endpoint:'gfs'}];
const GRID=[
 {name:'Eastern Mediterranean',lat:33.2,lon:33.3},
 {name:'Lebanon coast',lat:33.9,lon:35.35},
 {name:'Northern Israel',lat:33.05,lon:35.35},
 {name:'Southern Golan',lat:32.76,lon:35.66},
 {name:'Central Israel',lat:32.07,lon:34.9},
 {name:'Southern Israel',lat:31.1,lon:34.85},
 {name:'East of Israel',lat:32.8,lon:36.5}
];
const FIELDS=['pressure_msl','geopotential_height_500hPa','temperature_850hPa','relative_humidity_700hPa','wind_speed_850hPa','precipitation'];
const localDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const read=(values,i)=>typeof values?.[i]==='number'&&Number.isFinite(values[i])?values[i]:null;
const round=(v,d=1)=>v===null?null:Number(v.toFixed(d));
const indexHours=(times,date)=>times.map((time,i)=>({time,i})).filter(x=>x.time.startsWith(date+'T'));
function dateAdd(d,n){const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
function fetchTimed(url){
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),16000);
 return fetch(url,{signal:ctrl.signal,cache:'no-store'}).then(r=>{
  if(!r.ok)throw Error('Model source unavailable');
  return r.json();
 }).finally(()=>clearTimeout(timeout));
}
async function fetchModel(model){
 const args=new URLSearchParams({
  latitude:GRID.map(p=>p.lat.toFixed(3)).join(','),
  longitude:GRID.map(p=>p.lon.toFixed(3)).join(','),
  timezone:'Asia/Jerusalem',forecast_days:'8',hourly:FIELDS.join(',')
 });
 let response;
 try{response=await fetchTimed('https://api.open-meteo.com/v1/'+model.endpoint+'?'+args);}
 catch(error){
  // Some providers omit specific 700-hPa or high-altitude parameters.
  // Retain synoptic pressure and 850-hPa temperature rather than losing the model.
  args.set('hourly','pressure_msl,temperature_850hPa,precipitation');
  response=await fetchTimed('https://api.open-meteo.com/v1/'+model.endpoint+'?'+args);
 }
 const sites=Array.isArray(response)?response:[response];
 if(sites.length!==GRID.length)throw Error('Incomplete synoptic grid');
 return sites;
}
function hourlySummaries(sites){
 const times=sites[0]?.hourly?.time||[];
 const days=[...new Set(times.map(t=>t.slice(0,10)))].slice(0,7);
 return days.map(day=>{
  // four 6-hour synoptic time windows, summing hourly rain within each.
  const windows=[0,6,12,18].map(hour=>{
   const at=times.findIndex(t=>t===day+'T'+String(hour).padStart(2,'0')+':00');
   if(at<0)return null;
   const map=sites.map((s,j)=>{
    const h=s.hourly||{};
    const values={};
    for(const field of FIELDS.filter(f=>f!=='precipitation'))values[field]=read(h[field],at);
    let rain=0,available=0;
    for(let k=at;k<at+6&&k<times.length;k++){
     const v=read(h.precipitation,k);
     if(v!==null){rain+=v;available++;}
    }
    return {region:GRID[j].name,...values,
     precipitation_6h_mm:available===6?round(rain):null};
   });
   return {valid_time:times[at],points:map};
  }).filter(Boolean);
  const rows=windows.flatMap(x=>x.points);
  const get=(name,field)=>rows.filter(x=>x.region===name).map(x=>x[field]).filter(Number.isFinite);
  const total=(name,field)=>{const vals=get(name,field);return vals.length?round(vals.reduce((a,b)=>a+b,0)):null;};
  const basin=get('Eastern Mediterranean','pressure_msl');
  const land=get('Central Israel','pressure_msl');
  return {date:day,
   rain_southern_golan_mm:total('Southern Golan','precipitation_6h_mm'),
   rain_northern_israel_mm:total('Northern Israel','precipitation_6h_mm'),
   rain_central_israel_mm:total('Central Israel','precipitation_6h_mm'),
   rain_southern_israel_mm:total('Southern Israel','precipitation_6h_mm'),
   sea_level_pressure_med_hpa:basin.length?round(basin.reduce((a,b)=>a+b,0)/basin.length):null,
   sea_level_pressure_israel_hpa:land.length?round(land.reduce((a,b)=>a+b,0)/land.length):null,
   synoptic_snapshots:windows.map(w=>({
    valid_time:w.valid_time,
    regions:w.points.map(p=>({
     name:p.region,mslp_hpa:p.pressure_msl===null?null:round(p.pressure_msl),
     h500_m:p.geopotential_height_500hPa===null?null:round(p.geopotential_height_500hPa,0),
     temp850_c:p.temperature_850hPa===null?null:round(p.temperature_850hPa),
     rh700_percent:p.relative_humidity_700hPa===null?null:round(p.relative_humidity_700hPa,0),
     rain6h_mm:p.precipitation_6h_mm
    }))
   }))
  };
 });
}
async function previousRuns(){
 // Previous-runs fields give a consistency check across forecasts issued
 // 24 and 48 hours earlier, if the provider supports them.
 const args=new URLSearchParams({
  latitude:'32.763',longitude:'35.663',timezone:'Asia/Jerusalem',
  forecast_days:'7',daily:'precipitation_sum_previous_day0,precipitation_sum_previous_day1,precipitation_sum_previous_day2'
 });
 try{
  const data=await fetchTimed('https://previous-runs-api.open-meteo.com/v1/forecast?'+args);
  const d=data.daily||{};
  return (d.time||[]).slice(0,7).map((date,i)=>({
   date,
   latest_mm:read(d.precipitation_sum_previous_day0,i),
   one_day_earlier_mm:read(d.precipitation_sum_previous_day1,i),
   two_days_earlier_mm:read(d.precipitation_sum_previous_day2,i)
  }));
 }catch(e){return null;}
}
async function analyze(opts={}){
 const settled=await Promise.allSettled(MODELS.map(fetchModel));
 const models=settled.map((result,i)=>{
  if(result.status!=='fulfilled')return {name:MODELS[i].name,available:false};
  return {name:MODELS[i].name,available:true,days:hourlySummaries(result.value)};
 });
 if(!models.some(x=>x.available))throw Error('SYNOPTIC_DATA_UNAVAILABLE');
 const valid=models.filter(x=>x.available);
 const byDay={};
 for(const model of valid){
  for(const day of model.days){
   const item=byDay[day.date]??={date:day.date,models:[]};
   item.models.push({name:model.name,med_pressure_hpa:day.sea_level_pressure_med_hpa,
    israel_pressure_hpa:day.sea_level_pressure_israel_hpa,
    rain_north_mm:day.rain_northern_israel_mm,
    rain_center_mm:day.rain_central_israel_mm,
    rain_south_mm:day.rain_southern_israel_mm,
    rain_golan_mm:day.rain_southern_golan_mm,
    map_times_available:day.synoptic_snapshots.length});
  }
 }
 // Keep a detailed subset of representative 00/12 UTC-ish map grids.
 const details=valid.map(x=>({
  model:x.name,
  days:x.days.map(d=>({date:d.date,snapshots:d.synoptic_snapshots
   .filter(s=>/T12:00/.test(s.valid_time))
   .map(s=>({time:s.valid_time,regions:s.regions.filter(r=>
    ['Eastern Mediterranean','Southern Golan'].includes(r.name))}))}))
 }));
 return {
  kind:'synoptic_multi_day_forecast',
  scope:'Israel, southern Golan, eastern Mediterranean and neighboring region',
  research_window:{first_day:localDay(),days:7,timezone:'Asia/Jerusalem'},
  available_models:valid.map(m=>m.name),
  unavailable_models:models.filter(m=>!m.available).map(m=>m.name),
  sampled_regions:GRID.map(p=>p.name),
  daily_model_agreement:Object.values(byDay),
  representative_synoptic_maps:details,
  earlier_forecast_comparison:await previousRuns(),
  recent_weather_commentary:(window.latestAtmosNews?.posts||[]).filter(x=>
   !x.time||Date.now()-Date.parse(x.time)<72*3600000).slice(0,5)
   .map(x=>({source:x.source,time:x.time,text:x.text,url:x.url})),
  original_maps:[
   {name:'Wetterzentrale GFS',url:'https://www.wetterzentrale.de/en/topkarten.php?model=gfs'},
   {name:'Weather2day model maps',url:'https://www.weather2day.co.il/models'}
  ],
  provenance:'Snapshots represent numerical forecast fields sampled at seven regional grid points, four 6-hour windows each day. They are analytically equivalent to a sparse reconstruction of pressure/500hPa/850hPa/precipitation forecast maps; original third-party image files have NOT been downloaded or visually read.',
  warnings:'Model run initialization times are not returned by these endpoints. Do NOT state that individual synoptic maps are the latest run at a specific UTC cycle. A previous-day comparison is only available when earlier_forecast_comparison has values. Precipitation total is derived from hourly model fields at point locations; not nationwide totals or observations. Never call uncalibrated model agreement a rain probability. Summaries should avoid inventing synoptic systems based only on local gradients.',
  sources:['Open-Meteo ECMWF','Open-Meteo DWD ICON','Open-Meteo GFS',
   'Open-Meteo previous-runs API where available']
 };
}
window.AtmosSynoptic={analyze};
})();