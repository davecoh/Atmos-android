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
function render(result,anchor){
 if(!result||!anchor)return;
 const usable=(result.models||[]).filter(m=>m.available&&Array.isArray(m.grid));
 if(!usable.length)return;
 const panel=document.createElement('div');panel.className='precip-research';
 const title=document.createElement('div');title.className='precip-heading';
 title.textContent='🗺️ מפות גשם חזויות · '+result.place+' · '+result.forecast_period.from+
  (result.forecast_period.to===result.forecast_period.from?'':'–'+result.forecast_period.to);
 panel.append(title);
 const text=document.createElement('p');
 text.textContent='כל מפה מציגה גשם חזוי במ״מ בנקודה הנבחרת וב־8 נקודות סביבה. המרכז מסומן בלבן. אלו מפות שנוצרו מנתוני המודלים, לא תמונות מהאתרים.';
 panel.append(text);
 const canvas=document.createElement('canvas');
 const w=460,pad=30,cell=68,panelHeight=300;
 canvas.width=w;canvas.height=usable.length*panelHeight+75;
 const ctx=canvas.getContext('2d');
 if(!ctx)return;
 ctx.fillStyle='#11273b';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.textAlign='center';ctx.fillStyle='#e8f5ff';ctx.font='bold 19px sans-serif';
 ctx.fillText('Model precipitation forecast · mm',w/2,32);
 const max=Math.max(1,...usable.flatMap(x=>x.grid.map(v=>v.rain_mm||0)));
 function shade(v){const t=Math.max(0,Math.min(1,(v||0)/max));return 'rgb('+Math.round(28+18*t)+','+Math.round(70+120*t)+','+Math.round(111+119*t)+')';}
 usable.forEach((model,index)=>{
  const top=55+index*panelHeight;
  ctx.fillStyle='#e8f5ff';ctx.font='bold 21px sans-serif';
  ctx.fillText(model.name+' · center '+(model.center_mm??'—')+' mm',w/2,top+20);
  for(const cellData of model.grid){
   const x=124+cellData.col*cell,y=top+43+cellData.row*cell;
   ctx.fillStyle=shade(cellData.rain_mm);ctx.fillRect(x,y,cell-3,cell-3);
   ctx.fillStyle='#fff';ctx.font='bold 18px sans-serif';
   ctx.fillText(cellData.rain_mm===null?'—':String(cellData.rain_mm),x+(cell-3)/2,y+40);
   if(cellData.row===1&&cellData.col===1){
    ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.strokeRect(x,y,cell-3,cell-3);
   }
  }
  ctx.fillStyle='#bdd5e5';ctx.font='14px sans-serif';
  ctx.fillText('N ↑ · selected location at white square',w/2,top+269);
 });
 ctx.fillStyle='#c1d9e7';ctx.font='14px sans-serif';
 ctx.fillText('Open-Meteo model data · forecast, not observed rainfall',w/2,canvas.height-15);
 canvas.style.width='100%';canvas.style.maxWidth='460px';canvas.style.height='auto';
 panel.append(canvas);
 const links=document.createElement('div');links.className='precip-links';
 const original=[
  ['GFS · Wetterzentrale rain','https://wetterzentrale.de/en/topkarten.php?model=gfs&map=19&var=4'],
  ['GFS · accumulated','https://wetterzentrale.de/en/topkarten.php?model=gfs&map=19&var=18'],
  ['Weather2day models','https://www.weather2day.co.il/models']
 ];
 for(const [label,url] of original){
  const a=document.createElement('a');a.textContent=label;a.href=url;
  a.rel='noopener noreferrer';a.target='_blank';links.append(a);
 }
 const save=document.createElement('a');save.textContent='⬇ שמור את מפת ההשוואה (PNG)';
 save.href=canvas.toDataURL('image/png');save.download='atmos-precipitation-models.png';links.append(save);
 panel.append(links);
 anchor.insertAdjacentElement('afterend',panel);
}
window.AtmosPrecipMaps={analyze,models:MODELS,render};
})();