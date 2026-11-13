/* Atmos interactive weather map.
 * OSM base map; radar = RainViewer observed reflectivity; temperature and wind =
 * Open-Meteo model current estimates at sampled points, not weather stations.
 */
(function(){
"use strict";
const $=id=>document.getElementById(id);
let map=null,base=null,layer=null,selected='radar',requestNumber=0,radarData=null,radarFetched=0,lastCoords=null;
let active=false,updateTimer=null;
function status(msg){$('areaMapStatus').textContent=msg;}
function localTime(s){return new Date(s).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'});}
function ready(){
 return typeof window.L!=='undefined';
}
function library(){
 return new Promise((resolve,reject)=>{
  if(ready()){resolve();return;}
  const old=document.querySelector('script[data-atmos-leaflet]');
  if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;}
  const link=document.createElement('link');link.rel='stylesheet';
  link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
  const script=document.createElement('script');script.dataset.atmosLeaflet='true';
  script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  script.onload=resolve;script.onerror=()=>reject(Error('Map library unavailable'));
  document.head.appendChild(script);
 });
}
function chosenPlace(){
 const raw=$('place').value.split(',').map(Number);
 return raw.length===2&&raw.every(Number.isFinite)?raw:[32.763,35.663];
}
function ensureMap(){
 if(map)return;
 const pos=chosenPlace();
 map=L.map('areaMap',{zoomControl:true,maxZoom:16,preferCanvas:true})
   .setView(pos,10);
 base=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  minZoom:2,maxZoom:17,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
 }).addTo(map);
 layer=L.layerGroup().addTo(map);
 L.circleMarker(pos,{radius:6,color:'#fff',weight:2,fillColor:'#20b8a5',fillOpacity:1})
  .addTo(map).bindPopup('המיקום הנבחר');
 map.on('moveend',()=>{if(selected!=='radar'&&active)void refresh(false);});
}
function clearOverlay(){
 if(layer)layer.clearLayers();
 if(radarData&&map){map.removeLayer(radarData);radarData=null;}
}
async function radar(){
 let manifest;
 if(Date.now()-radarFetched<120000&&window.__atmosRadarManifest)manifest=window.__atmosRadarManifest;
 else{
  const response=await fetch('https://api.rainviewer.com/public/weather-maps.json',{cache:'default'});
  if(!response.ok)throw Error('Radar source unavailable');
  manifest=await response.json();
  window.__atmosRadarManifest=manifest;radarFetched=Date.now();
 }
 const frames=manifest.radar?.past||[];
 const frame=frames[frames.length-1];
 if(!frame||!manifest.host)throw Error('No radar frames available');
 if(!/^https:\/\/[a-z0-9.-]+$/i.test(manifest.host)||!/^\/v2\/radar\/\d+$/.test(frame.path))
  throw Error('Unexpected radar metadata');
 const url=manifest.host+frame.path+'/256/{z}/{x}/{y}/2/1_1.png';
 // RainViewer free tier supports a maximum native zoom of 7.
 radarData=L.tileLayer(url,{
  opacity:.72,minZoom:2,maxNativeZoom:7,maxZoom:17,
  attribution:'Radar: <a href="https://www.rainviewer.com/">RainViewer</a>'
 }).addTo(map);
 status('מכ״ם גשם נצפה · '+localTime(frame.time*1000)+
  ' · עשוי להיות חוסר כיסוי מקומי; לא תחזית');
}
async function meteorologicalOverlay(kind,token){
 const bounds=map.getBounds(),center=map.getCenter();
 // Sample the visible region only, not the entire country or offscreen tiles.
 const latDelta=Math.min(.55,Math.max(.08,(bounds.getNorth()-bounds.getSouth())/3));
 const lonDelta=Math.min(.55,Math.max(.09,(bounds.getEast()-bounds.getWest())/3));
 const pts=[];for(let r=-1;r<=1;r++)for(let c=-1;c<=1;c++){
  const lat=center.lat+r*latDelta,lon=center.lng+c*lonDelta;
  if(Math.abs(lat)>89||Math.abs(lon)>179)continue;
  pts.push({lat,lon});
 }
 const params=new URLSearchParams({
  latitude:pts.map(p=>p.lat.toFixed(4)).join(','),
  longitude:pts.map(p=>p.lon.toFixed(4)).join(','),
  current:'temperature_2m,wind_speed_10m,wind_direction_10m',
  timezone:'Asia/Jerusalem'
 });
 const res=await fetch('https://api.open-meteo.com/v1/forecast?'+params,{cache:'no-store'});
 if(!res.ok)throw Error('Live model layer unavailable');
 const data=await res.json(),sites=Array.isArray(data)?data:[data];
 if(token!==requestNumber)return;
 let shown=0;
 for(let i=0;i<Math.min(pts.length,sites.length);i++){
  const x=sites[i]?.current||{};
  const temp=x.temperature_2m,wind=x.wind_speed_10m,direction=x.wind_direction_10m;
  const val=kind==='temperature'?temp:wind;
  if(typeof val!=='number'||!Number.isFinite(val))continue;
  const color=kind==='temperature'?(val<12?'#2987e3':val<22?'#17bbaa':'#f39b4b'):'#e2d57e';
  const icon=L.divIcon({className:'atmos-layer-icon',
   html:'<span style="background:'+color+'">'+
    (kind==='temperature'?Math.round(temp)+'°':
     Math.round(wind)+' <span style="display:inline-block;transform:rotate('+((Number(direction)||0)+180)+'deg)">↑</span>')+
   '</span>',iconSize:[58,30],iconAnchor:[29,15]});
  const description=kind==='temperature'?'טמפרטורת מודל':'רוח לפי מודל';
  L.marker([pts[i].lat,pts[i].lon],{icon}).addTo(layer)
   .bindPopup(description+': '+Math.round(val)+(kind==='temperature'?'°C':' קמ״ש'));
  shown++;
 }
 status((kind==='temperature'?'טמפרטורה':'רוח')+
  ' · '+shown+' נקודות מודל בשטח המוצג · '+(sites[0]?.current?.time||'')+
  ' · לא מדידות תחנה');
}
async function refresh(reset){
 if(!map)return;
 const token=++requestNumber;
 clearOverlay();
 if(reset)status('טוען שכבת מזג אוויר…');
 try{
  if(selected==='radar')await radar();
  else await meteorologicalOverlay(selected,token);
 }catch(err){
  if(token===requestNumber)status('השכבה לא זמינה כרגע. נסה לרענן. המפה הבסיסית עדיין זמינה.');
 }
}
function change(kind){
 selected=kind;
 document.querySelectorAll('[data-area-layer]').forEach(button=>{
  button.classList.toggle('active',button.dataset.areaLayer===kind);
 });
 void refresh(true);
}
window.atmosLocationResult=(lat,lon,error)=>{
 const btn=$('areaLocate');btn.disabled=false;
 if(Number.isFinite(lat)&&Number.isFinite(lon)&&map){
  map.setView([lat,lon],11);
  const marker=L.circleMarker([lat,lon],{radius:7,weight:3,color:'#fff',fillColor:'#1aafa6',fillOpacity:1}).addTo(layer);
  marker.bindPopup('המיקום שלי').openPopup();
  lastCoords=[lat,lon];
  status('המפה הועברה למיקום שלך. עדכן את השכבה כדי לרענן.');
  void refresh(false);
 }else status('המיקום אינו זמין. אפשר לנווט במפה ידנית או לבחור יישוב.');
};
async function init(){
 if(active){if(map){setTimeout(()=>map.invalidateSize(),100);}return;}
 active=true;
 status('טוען מפה אינטראקטיבית…');
 try{
  await library();ensureMap();
  document.querySelectorAll('[data-area-layer]').forEach(b=>b.onclick=()=>change(b.dataset.areaLayer));
  $('areaReload').onclick=()=>void refresh(true);
  $('areaLocate').onclick=()=>{
   if(!window.AtmosLocation){status('המיקום זמין רק באפליקציית Android.');return;}
   $('areaLocate').disabled=true;status('מבקש מיקום מהמכשיר…');
   window.AtmosLocation.locate();
  };
  // Refresh never clears user pan/zoom.
  map.invalidateSize();void refresh(true);
 }catch(e){status('מפת הבסיס אינה זמינה. בדוק חיבור לאינטרנט ונסה לפתוח מחדש.');active=false;}
}
function moveToPlace(){
 if(!map)return;
 map.setView(chosenPlace(),10);
 void refresh(true);
}
window.AtmosAreaMap={init,moveToPlace,refresh:()=>void refresh(true)};
})();