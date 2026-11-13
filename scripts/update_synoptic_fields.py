#!/usr/bin/env python3
"""Atmos full-field forecast ETL. Official ECMWF Open Data + NOAA GFS GRIB2.

Publishes downsampled 0.5-degree *two-dimensional fields*, NOT screenshots or
sparse station samples. Keeps model cycles, validity timestamps and provenance.
Run as a GitHub Actions scheduled pipeline, never from the Android WebView.
"""
import argparse
import datetime as dt
import json
import math
import os
import pathlib
import tempfile
import time
from urllib.parse import urlencode

import numpy as np
import requests
from eccodes import codes_get, codes_get_array, codes_grib_new_from_file, codes_release

LAT_MIN,LAT_MAX,LON_MIN,LON_MAX=25.,43.,25.,45.
RES=.5
LATS=np.arange(LAT_MAX,LAT_MIN-.0001,-RES)
LONS=np.arange(LON_MIN,LON_MAX+.0001,RES)
STEPS=[0,24,48,72,96,120,144,168,192,216,240]
FIELDS={'msl':'mslp_hpa','gh':'z500_m','z':'z500_m',
        't':'t850_c','tp':'precip_mm','apcp':'precip_mm','prmsl':'mslp_hpa'}
USER_AGENT='AtmosWeatherResearch/1.0 (+https://github.com/davecoh/Atmos-android)'
SESSION=requests.Session()
SESSION.headers.update({'User-Agent':USER_AGENT})
def parse_grib(path,model):
    out=[]
    with open(path,'rb') as stream:
        while True:
            gid=codes_grib_new_from_file(stream)
            if gid is None:break
            try:
                short=str(codes_get(gid,'shortName')).lower()
                level=str(codes_get(gid,'level'))
                name=FIELDS.get(short)
                if name is None:continue
                if name=='z500_m' and level!='500':continue
                if name=='t850_c' and level!='850':continue
                # Select a 2D 0.5-degree grid over Mediterranean region.
                lat=codes_get_array(gid,'latitudes')
                lon=np.mod(codes_get_array(gid,'longitudes'),360)
                vals=codes_get_array(gid,'values')
                mask=(lat>=LAT_MIN-.26)&(lat<=LAT_MAX+.26)&(lon>=LON_MIN-.26)&(lon<=LON_MAX+.26)
                if not mask.any():continue
                latitude=np.asarray(lat[mask]);longitude=np.asarray(lon[mask]);value=np.asarray(vals[mask])
                rows=np.rint((LAT_MAX-latitude)/RES).astype(int)
                cols=np.rint((longitude-LON_MIN)/RES).astype(int)
                field=np.full((len(LATS),len(LONS)),np.nan,dtype=float)
                valid=(rows>=0)&(rows<len(LATS))&(cols>=0)&(cols<len(LONS))
                # Dataset is more accurate than this serialized 0.5-degree grid;
                # nearest-grid quantization intentionally reduces download size.
                field[rows[valid],cols[valid]]=value[valid]
                if name=='mslp_hpa':field/=100.
                elif name=='z500_m':
                    if short=='z':field/=9.80665
                elif name=='t850_c':field-=273.15
                elif name=='precip_mm':
                    if model=='ECMWF':field*=1000. # ECMWF TP in metres
                field[~np.isfinite(field)]=np.nan
                yy=int(codes_get(gid,'validityDate'))
                hh=int(codes_get(gid,'validityTime'))
                valid_time=f'{yy:08d}T{hh:04d}Z'
                initdate=int(codes_get(gid,'dataDate'))
                initclock=int(codes_get(gid,'dataTime'))
                init=f'{initdate:08d}T{initclock:04d}Z'
                item={
                    'field':name,'valid_utc':valid_time,'run_utc':init,
                    'values':[[None if not np.isfinite(x) else round(float(x),2)
                               for x in row] for row in field]
                }
                out.append(item)
            except Exception as error:
                print('Cannot parse GRIB message:',str(error)[:200])
            finally:codes_release(gid)
    return out

def ecmwf_fields(folder):
    from ecmwf.opendata import Client
    client=Client(source='ecmwf',model='ifs',resol='0p25')
    data=[]
    requests_=[
      {'param':['msl','tp'],'levtype':'sfc'},
      {'param':'z','levtype':'pl','levelist':500},
      {'param':'t','levtype':'pl','levelist':850}
    ]
    for index,request in enumerate(requests_):
        path=folder/f'ecmwf-{index}.grib2'
        try:
            client.retrieve(type='fc',step=STEPS,**request,target=str(path))
            data.extend(parse_grib(path,'ECMWF'))
        except Exception as error:
            print('ECMWF section not available:',request,str(error)[:250])
    return data

def latest_gfs_cycle():
    now=dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=6)
    cycle=(now.hour//6)*6
    return now.strftime('%Y%m%d'),f'{cycle:02d}'

def gfs_fields(folder):
    date,cycle=latest_gfs_cycle()
    data=[]
    for step in STEPS:
        filename=f'gfs.t{cycle}z.pgrb2.0p25.f{step:03d}'
        args={
            'file':filename,
            'lev_mean_sea_level':'on','var_PRMSL':'on',
            'lev_500_mb':'on','var_HGT':'on',
            'lev_850_mb':'on','var_TMP':'on',
            'lev_surface':'on','var_APCP':'on',
            'subregion':'','leftlon':'25','rightlon':'45',
            'toplat':'43','bottomlat':'25',
            'dir':f'/gfs.{date}/{cycle}/atmos'
        }
        url='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?'+urlencode(args)
        path=folder/f'gfs-{step:03d}.grib2'
        for attempt in range(2):
            try:
                response=SESSION.get(url,timeout=55)
                if response.status_code!=200 or len(response.content)<200:
                    raise RuntimeError(f'HTTP {response.status_code}')
                path.write_bytes(response.content)
                data.extend(parse_grib(path,'GFS'))
                break
            except Exception as error:
                print('GFS',step,'not available:',str(error)[:120])
                if attempt==0:time.sleep(2)
        time.sleep(.5)
    return data

def standardize(entries):
    # Retain every unique valid time and physical field. Do not insert zeros for missing grids.
    frames={}
    for entry in entries:
        key=entry['valid_utc']
        frame=frames.setdefault(key,{'valid_utc':key,'run_utc':entry['run_utc'],'fields':{}})
        old=frame['fields'].get(entry['field'])
        if old is None:frame['fields'][entry['field']]=entry['values']
    return [frames[x] for x in sorted(frames)]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',default='app/src/main/assets/synoptic-fields.json')
    args=parser.parse_args()
    bundle={
        'version':1,'generated_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
        'area':{'latitudes':LATS.tolist(),'longitudes':LONS.tolist(),
                'bounds':[LAT_MIN,LON_MIN,LAT_MAX,LON_MAX],
                'resolution_degrees':RES},
        'models':{},'notes':'Official open GRIB2 model data. Spatial matrices are 0.5-degree downsampled fields; precipitation may be accumulated per model step rather than hourly. Model runs are not observations. ECMWF and GFS fields are not interchangeable statistical probabilities.'
    }
    with tempfile.TemporaryDirectory() as directory:
        folder=pathlib.Path(directory)
        for name,loader in [('ECMWF',ecmwf_fields),('GFS',gfs_fields)]:
            try:
                entries=loader(folder)
                frames=standardize(entries)
                # A valid model must have geographically relevant pressure or height maps.
                useful=sum('mslp_hpa' in f['fields'] or 'z500_m' in f['fields'] for f in frames)
                if useful>=3:
                    bundle['models'][name]={
                        'source':'ECMWF Open Data' if name=='ECMWF' else 'NOAA NOMADS GFS 0.25°',
                        'frames':frames,'field_count':len(entries)}
                print(name, 'frames',len(frames),'useful',useful)
            except Exception as error:print(name,'ERROR',repr(error))
    if not bundle['models']:raise SystemExit('No usable full-field model runs; preserving previous data')
    destination=pathlib.Path(args.out);destination.parent.mkdir(parents=True,exist_ok=True)
    # Save brief previous cycles for run-to-run comparison, not an endless archive.
    history=[]
    if destination.exists():
        try:
            old=json.loads(destination.read_text(encoding='utf8'))
            for name,m in old.get('models',{}).items():
                frames=m.get('frames',[])
                if frames:
                    history.append({'model':name,'source_run':frames[0].get('run_utc'),
                        'frames':[{'valid_utc':x.get('valid_utc'),'fields':{
                          k:v for k,v in x.get('fields',{}).items() if k in ('mslp_hpa','z500_m')
                        }} for x in frames[:7]]})
            history+=old.get('previous_runs',[])
        except (ValueError,OSError,TypeError):pass
    existing={(x.get('model'),x.get('source_run')) for x in [
       {'model':name,'source_run':m['frames'][0]['run_utc']}
       for name,m in bundle['models'].items() if m['frames']]}
    bundle['previous_runs']=[x for x in history if (x.get('model'),x.get('source_run')) not in existing][:4]
    staging=destination.with_suffix('.tmp')
    staging.write_text(json.dumps(bundle,separators=(',',':'),allow_nan=False),encoding='utf8')
    staging.replace(destination)
    print('Wrote',destination,destination.stat().st_size,'bytes',list(bundle['models']))

if __name__=='__main__':main()
