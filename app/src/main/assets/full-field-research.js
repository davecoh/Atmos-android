/* Atmos official-model 2D grid analysis.
 * Reads scheduled ECMWF IFS + NOAA GFS GRIB2-derived grids from this repository.
 * Never treats sparse sample points as a complete synoptic map.
 */
(function(){
"use strict";
const BUNDLE_URL='https://raw.githubusercontent.com/davecoh/Atmos-android/main/app/src/main/assets/synoptic-fields.json';
let cached=null,cachedAt=0;
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function dateParts(iso){return iso?.slice(0,8)+' '+iso?.slice(9,13);}
function maskMean(matrix,latitudes,longitudes,bounds){
 if(!Array.isArray(matrix))return null;
 let sum=0,count=0,min=null,max=null,lowest=null;
 for(let r=0;r<latitudes.length;r++)for(let c=0;c<longitudes.length;c++){
  const lat=latitudes[r],lon=longitudes[c];
  if(lat<bounds.s||lat>bounds.n||lon<bounds.w||lon>bounds.e)continue;
  const x=num(matrix[r]?.[c]);
  if(x===null)continue;
  sum+=x;count++;
  if(min===null||x<min){min=x;lowest={lat,lon,value:x};}
  if(max===null||x>max)max=x;
 }
 return count?{mean:+(sum/count).toFixed(1),min:+min.toFixed(1),
  max:+max.toFixed(1),minimum_at:lowest,count}:null;
}
const REGIONS={
 eastern_med:{s:29,n:38,w:26,e:34.6},
 israel:{s:29,n:34,w:34.5,e:36.5},
 north:{s:32.2,n:34,w:34.5,e:37},
 center:{s:31.4,n:32.5,w:34.3,e:36},
 south:{s:29,n:31.4,w:33.9,e:36},
 south_golan:{s:32.55,n:32.94,w:35.5,e:35.9}
};
function summary(frame,area){
 const result={valid_utc:frame.valid_utc};
 for(const [name,bounds] of Object.entries(REGIONS)){
  const values={};
  for(const [short,long] of [['mslp_hpa','pressure_hpa'],['z500_m','height_500hpa_m'],
    ['t850_c','temp_850hpa_c'],['precip_mm','model_precipitation_field_raw']]){
   const x=maskMean(frame.fields?.[short],area.latitudes,area.longitudes,bounds);
   if(x)values[long]={mean:x.mean,min:x.min,max:x.max,
     lowest_point:x.minimum_at,sampled_grid_cells:x.count};
  }
  result[name]=values;
 }
 return result;
}
function getRun(frames){return frames?.[0]?.run_utc||null;}
async function getBundle(){
 if(cached&&Date.now()-cachedAt<900000)return cached;
 const ctl=new AbortController(),id=setTimeout(()=>ctl.abort(),15000);
 try{
  const response=await fetch(BUNDLE_URL,{cache:'no-store',signal:ctl.signal});
  if(!response.ok)throw Error('Full-field data not yet published');
  const data=await response.json();
  if(data.version!==1||!data.models||!data.area||!Array.isArray(data.area.latitudes))
   throw Error('Invalid full-field data');
  const age=Date.now()-Date.parse(data.generated_utc);
  if(!Number.isFinite(age)||age>36*3600000||age< -3600000)
   throw Error('Full-field data stale');
  cached=data;cachedAt=Date.now();return data;
 }finally{clearTimeout(id);}
}
function analyzeOld(old,area){
 const frames=old.frames||[];
 return {model:old.model,run_utc:old.source_run,
  points:frames.map(x=>summary(x,area)).map(x=>({
   valid_utc:x.valid_utc,
   israel_pressure_hpa:x.israel.pressure_hpa?.mean??null,
   east_med_pressure_hpa:x.eastern_med.pressure_hpa?.mean??null,
   israel_500hpa_m:x.israel.height_500hpa_m?.mean??null
  }))};
}
async function analyze(){
 const bundle=await getBundle();
 const runs=Object.entries(bundle.models).map(([name,content])=>({
  model:name,source:content.source,run_utc:getRun(content.frames),
  spatial_fields_by_valid_time:content.frames.slice(0,12)
   .map(frame=>summary(frame,bundle.area))
 }));
 const old=(bundle.previous_runs||[]).slice(0,4).map(x=>analyzeOld(x,bundle.area));
 return {kind:'full_field_synoptic_analysis',source_url:BUNDLE_URL,
  generated_utc:bundle.generated_utc,
  area:bundle.area.bounds,resolution_degrees:bundle.area.resolution_degrees,
  grid_size:[bundle.area.latitudes.length,bundle.area.longitudes.length],
  newest_runs:runs,
  previous_model_cycles:old,
  distinct_models:runs.map(x=>x.model),
  forecast_note:'Full two-dimensional gridded fields from official ECMWF Open Data and/or NOAA NOMADS GRIB2, regionally downsampled to 0.5 degrees for phone use. Forecast steps may extend 10 days.',
  critical_caveats:'Pressure levels and 500hPa heights are robust spatial fields; precipitation fields can be accumulated between different lead times and must NOT be added or interpreted as daily rainfall unless converted to common intervals. Model runs and forecasts are not observations. Regional averages can hide strong small-scale phenomena. A system cannot be identified from a single point. Never invent ensemble probabilities.',
  forecast_crosscheck:'Combine these full synoptic fields with current Open-Meteo model precipitation forecasts for specific local rainfall amounts. Original Wetterzentrale and Weather2day map image pixels were not decoded.'
 };
}
function renderMap(data,anchor){
 // Display a real 2D model pressure-field grid, not a fictional screenshot.
 if(!cached||!anchor)return;
 const model=Object.keys(cached.models||{})[0];
 const frame=cached.models[model]?.frames?.find(f=>f.fields?.mslp_hpa);
 if(!frame)return;
 const grid=frame.fields.mslp_hpa;
 const canvas=document.createElement('canvas'),w=cached.area.longitudes.length,
  h=cached.area.latitudes.length;
 canvas.width=w*5;canvas.height=h*5;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 const valid=grid.flat().filter(x=>typeof x==='number'&&Number.isFinite(x));
 if(!valid.length)return;
 const low=Math.min(...valid),high=Math.max(...valid);
 for(let r=0;r<h;r++)for(let c=0;c<w;c++){
  const v=grid[r]?.[c];
  const t=typeof v==='number'?(v-low)/(high-low||1):0;
  ctx.fillStyle=typeof v==='number'?
   'rgb('+Math.round(17+173*t)+','+Math.round(73+94*t)+','+Math.round(181-90*t)+')':'#203245';
  ctx.fillRect(c*5,r*5,5,5);
 }
 const container=document.createElement('div');container.className='fullfield-preview';
 const title=document.createElement('div');title.style.fontWeight='bold';
 title.textContent='מפת לחץ שדה מלא · '+model+' · '+frame.valid_utc+' UTC';
 container.append(title,canvas);
 canvas.style.cssText='width:100%;max-width:430px;display:block;margin-top:8px;image-rendering:auto;border-radius:9px';
 const label=document.createElement('p');label.className='weather-note';
 label.textContent='לחץ פני הים במודל, '+Math.round(low)+'–'+Math.round(high)+' hPa. מערב משמאל, צפון למעלה. מקור: נתוני GRIB2 רשמיים; רשת 0.5°.';
 container.append(label);
 anchor.insertAdjacentElement('afterend',container);
}
window.AtmosFullFields={analyze,renderMap};
})();