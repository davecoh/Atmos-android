/* Regional precipitation-map research sourced from numeric model grids.
 * Models: ECMWF, DWD ICON, GFS. Do not claim to have downloaded third-party map images.
 */
(function(){
"use strict";
const MODELS=[
 {name:'ECMWF',api:'ecmwf',map:'https://www.weather2day.co.il/models/ecmwf/precipitation'},
 {name:'ICON',api:'dwd-icon',map:'https://www.weather2day.co.il/models/icon/precipitation'},
 {name:'GFS',api:'gfs',map:'https://www.weather2day.co.il/models/gfs/precipitation'}
];
const dateIsrael=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const getNum=(arr,i)=>typeof arr?.[i]==='number'&&Number.isFinite(arr[i])?arr[i]:null;
const toGrid=(lat,lon)=>{
 const pts=[];for(let r=0;r<3;r++)for(let c=0;c<3;c++)pts.push({
  lat:lat+(1-r)*.13,lon:lon+(c-1)*.14,row:r,col:c
 });return pts;
};
async function fetchGrid(model,grid,days){
 const p=new URLSearchParams({
  latitude:grid.map(x=>x.lat.toFixed(3)).join(','),
  longitude:grid.map(x=>x.lon.toFixed(3)).join(','),
  timezone:'Asia/Jerusalem',forecast_days:String(days),
  daily:'precipitation_sum',
  hourly:'precipitation,pressure_msl,temperature_850hPa,geopotential_height_500hPa'
 });
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),18000);
 try{
  const res=await fetch('https://api.open-meteo.com/v1/'+model.api+'?'+p,{cache:'no-store',signal:ctrl.signal});
  if(!res.ok)throw Error('Source unavailable');
  const data=await res.json();return Array.isArray(data)?data:[data];
 }finally{clearTimeout(timeout);}
}
function select(sites,grid,start,end){
 const days=sites[4]?.daily?.time||[];
 const dates=days.map((x,i)=>({date:x,i})).filter(x=>x.date>=start&&x.date<=end);
 if(!dates.length)return null;
 const cells=sites.map((site,j)=>{
  const total=dates.reduce((a,x)=>{const v=getNum(site.daily?.precipitation_sum,x.i);return a+(v??0)},0);
  const complete=dates.every(x=>getNum(site.daily?.precipitation_sum,x.i)!==null);
  return {...grid[j],rain_mm:complete?Math.round(total*10)/10:null};
 });
 const center=cells[4];
 const vals=cells.map(c=>c.rain_mm).filter(Number.isFinite);
 if(!vals.length)return null;
 const dayParts=dates.map(d=>({date:d.date,rain_mm:getNum(sites[4].daily?.precipitation_sum,d.i)}));
 const times=sites[4]?.hourly?.time||[];
 const synIdx=times.findIndex(t=>t.startsWith(start+'T12:'));
 const synoptic=synIdx<0?null:{
  valid_time:times[synIdx],
  pressure_msl_hpa:getNum(sites[4].hourly?.pressure_msl,synIdx),
  temperature_850hPa_c:getNum(sites[4].hourly?.temperature_850hPa,synIdx),
  geopotential_height_500hPa_m:getNum(sites[4].hourly?.geopotential_height_500hPa,synIdx)
 };
 return {center_mm:center.rain_mm,min_mm:Math.min(...vals),max_mm:Math.max(...vals),
  days:dayParts,grid:cells.map(({lat,lon,row,col,rain_mm})=>({lat,lon,row,col,rain_mm})),synoptic};
}
function boundedDate(s,fallback){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')?s:fallback;}
async function analyze({latitude,longitude,place,start_date,end_date}){
 const lat=Number(latitude),lon=Number(longitude);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<29||lat>34||lon<34||lon>37)
  throw Error('LOCATION_UNAVAILABLE');
 const today=dateIsrael(),from=boundedDate(start_date,today);
 let to=boundedDate(end_date,from);
 const startMs=Date.parse(from+'T12:00:00Z'),endMs=Date.parse(to+'T12:00:00Z');
 if(!Number.isFinite(startMs)||from<today||!Number.isFinite(endMs)||endMs<startMs||endMs-startMs>6*86400000)
  throw Error('FORECAST_RANGE_UNAVAILABLE');
 const grid=toGrid(lat,lon),days=Math.min(8,Math.ceil((endMs-Date.parse(today+'T12:00:00Z'))/86400000)+2);
 const data=await Promise.allSettled(MODELS.map(x=>fetchGrid(x,grid,days)));
 const models=data.map((r,i)=>{
  if(r.status!=='fulfilled'||r.value.length!==9)return {name:MODELS[i].name,available:false,map_page:MODELS[i].map};
  const values=select(r.value,grid,from,to);
  return values?{name:MODELS[i].name,available:true,map_page:MODELS[i].map,...values}:
   {name:MODELS[i].name,available:false,map_page:MODELS[i].map};
 });
 const matched=models.filter(x=>x.available&&Number.isFinite(x.center_mm));
 const centerAmounts=matched.map(x=>x.center_mm);
 const total=matched.length;
 return {kind:'precipitation_map_aggregation',place:place||'selected location',
  center:{latitude:lat,longitude:lon},forecast_period:{from,to},
  models,agreement:total?{
   models_with_data:total,models_forecasting_0_2mm_or_more:centerAmounts.filter(x=>x>=.2).length,
   min_forecast_mm:Math.min(...centerAmounts),max_forecast_mm:Math.max(...centerAmounts),
   mean_forecast_mm:Math.round(centerAmounts.reduce((a,b)=>a+b,0)/total*10)/10
  }:null,
  method:'Numeric precipitation maps derived from 3x3 geographic sample points (~12-15 km between points) per model, using Open-Meteo model output. Full regional center + 8 surrounding grid points, with synoptic indicators at 12:00 when available.',
  source_policy:'Weather2day model pages are links for independent visual inspection; original images were not extracted. Downloadable own-map rendering can use the returned forecast grids.',
  limitations:'Do NOT call model agreement a calibrated rain probability. Rain totals are model predictions, not measurements. The grid resolution and elevation can cause significant local errors in the Golan; do NOT infer a rain gauge total or falsely claim to have seen original Weather2day map pixels.'
 };
}
window.AtmosPrecipMaps={analyze,models:MODELS};
})();