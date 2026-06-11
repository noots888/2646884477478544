/* myMap large file import worker. Keeps the main UI alive during large imports. */
self.window=self;
self.Diagnostics={log(){},capture(){}};
self.UI={progress(){}};
self.App={};
self.SearchEngine={
  compact(s){return String(s||'').toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,'');},
  formatCircuitName(value){
    const original=String(value||'').trim().replace(/\s+/g,' ');
    if(!original)return '';
    const full=original.match(/^(.+?\b[A-Z0-9]{1,4})\s*[-_]\s*(\d{3,6})$/i);
    if(full&&/[A-Z]{1,4}\s*[-–—]\s*[A-Z]{1,4}/i.test(full[1]))return this.formatCircuitName(full[1]);
    const slash=original.match(/^([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4})\s*\/\s*([A-Z]{1,4})\s*(?:NO\.?\s*)?([A-Z0-9]{1,4})$/i);
    if(slash)return `${slash[1].toUpperCase()}-${slash[2].toUpperCase()}/${slash[3].toUpperCase()} ${slash[4].toUpperCase()}`;
    const direct=original.match(/^([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4})\s*(?:NO\.?\s*)?([A-Z0-9]{1,4})$/i);
    if(direct)return `${direct[1].toUpperCase()}-${direct[2].toUpperCase()} ${direct[3].toUpperCase()}`;
    return original.toUpperCase();
  }
};
try{importScripts('../js/import-engine.js');}catch(e){self.postMessage({type:'error',message:'Worker could not load import engine: '+(e.message||e)});}

function fmt(n){n=Number(n)||0; if(n<1024)return n+' B'; if(n<1024*1024)return (n/1024).toFixed(1)+' KB'; return (n/1024/1024).toFixed(1)+' MB';}
function sleep0(){return new Promise(r=>setTimeout(r,0));}


function utilityTypeFromText(text=''){
  const f=String(text||'').toUpperCase();
  if(/WATER[_\s.-]*PIPE|WCORP[_\s.-]*(002|WATER)|DRINKING[_\s.-]*WATER|WATER_TYPE|\bWATER\b/.test(f))return 'water';
  if(/SEWER|PRESSURE[_\s.-]*MAIN|WCORP[_\s.-]*069|RAW[_\s.-]*SEWAGE|MAINNAME|PRESSURE_MAIN_USE/.test(f))return 'sewer';
  if(/PETROLEUM|PIPELINE|DMIRS|\bGAS\b|GAS[_\s.-]*AND[_\s.-]*CONDENSATE|PIPELINE[_\s.-]*LICENCE|HIGH[_\s.-]*PRESSURE[_\s.-]*GAS/.test(f))return 'gas';
  if(/\bRAIL\b|PTA|RAILWAY|TRAIN|XING_NO|XING_TYPE/.test(f))return 'rail';
  if(/DISTRIBUTION[_\s.-]*OVERHEAD[_\s.-]*POWERLINES?|OVERHEAD[_\s.-]*POWERLINES?|WP[_\s.-]*031/.test(f))return 'hvDistribution';
  if(/HIGH[_\s.-]*VOLTAGE[_\s.-]*DISTRIBUTION|HV[_\s.-]*DISTRIBUTION|WP[_\s.-]*052|NCMT|HVOH|HVUG/.test(f))return 'hvDistribution';
  if(/DISTRIBUTION[_\s.-]*UNDERGROUND[_\s.-]*CABLE|UNDERGROUND[_\s.-]*CABLE|UG[_\s.-]*CABLE|WP[_\s.-]*034|\bCABLE\b/.test(f))return 'undergroundCable';
  if(/ELECTRICAL[_\s.-]*PILLARS?|\bPILLARS?\b|WP[_\s.-]*041/.test(f))return 'pillar';
  if(/ELECTRICAL[_\s.-]*ENCLOSURES?|ENCLOSURES?|WP[_\s.-]*040/.test(f))return 'enclosure';
  if(/ENVIRONMENTALLY[_\s.-]*SENSITIVE|CLEARING[_\s.-]*REGULATIONS|DWER|\bESA\b|WP[_\s.-]*046/.test(f))return 'esa';
  return '';
}
function utilityTypeFromFileName(fileName=''){
  return utilityTypeFromText(fileName);
}
function truthyWorker(v){return v===true||v===1||/^(true|yes|y|1)$/i.test(String(v||'').trim());}
function precomputedUtilityTypesFromProps(props={}){
  const out=new Set();
  const alias={
    W:'water',WATER:'water',S:'sewer',SEWER:'sewer',G:'gas',GAS:'gas',R:'rail',RAIL:'rail',
    HV:'hvDistribution',HVDIST:'hvDistribution',HV_DIST:'hvDistribution',HVDISTRIBUTION:'hvDistribution',HV_DISTRIBUTION:'hvDistribution',
    UG:'undergroundCable',UGCABLE:'undergroundCable',UG_CABLE:'undergroundCable',CABLE:'undergroundCable',UNDERGROUNDCABLE:'undergroundCable',UNDERGROUND_CABLE:'undergroundCable',
    P:'pillar',PILLAR:'pillar',ENC:'enclosure',ENCLOSURE:'enclosure',ENCLOSURES:'enclosure',E:'esa',ESA:'esa'
  };
  const add=(v)=>{const k=String(v||'').toUpperCase().replace(/[^A-Z0-9]+/g,''); const t=alias[k]; if(t)out.add(t);};
  const typeText=String(props.UTILITY_TYPES??props.utility_types??props.Utility_Types??'');
  if(typeText){
    typeText.split(/\s*[|,;/]+\s*|\s+AND\s+/i).filter(Boolean).forEach(add);
  }
  const badgeText=String(props.UTILITY_BADGES??props.utility_badges??props.Utility_Badges??'');
  if(badgeText){
    badgeText.split(/\s*[|,;/]+\s*/).filter(Boolean).forEach(part=>{
      const m=String(part).trim().match(/^([A-Z_ ]{1,20})\s*[0-9.]*\s*m?/i);
      if(m)add(m[1]);
    });
  }
  const suffixes={
    WATER:'water',SEWER:'sewer',GAS:'gas',RAIL:'rail',HV_DIST:'hvDistribution',UG_CABLE:'undergroundCable',PILLAR:'pillar',ENCLOSURE:'enclosure',ESA:'esa'
  };
  for(const [suffix,type] of Object.entries(suffixes)){
    const near=props[`NEARBY_${suffix}`]??props[`nearby_${suffix.toLowerCase()}`];
    const dist=props[`NEAREST_${suffix}_M`]??props[`nearest_${suffix.toLowerCase()}_m`];
    const count=props[`COUNT_${suffix}`]??props[`count_${suffix.toLowerCase()}`];
    if(truthyWorker(near)||Number.isFinite(Number(dist))||Number(count)>0)out.add(type);
  }
  return [...out];
}
function utilityFieldValue(props,type,kind){
  const suffix={water:'WATER',sewer:'SEWER',gas:'GAS',rail:'RAIL',hvDistribution:'HV_DIST',undergroundCable:'UG_CABLE',pillar:'PILLAR',enclosure:'ENCLOSURE',esa:'ESA'}[type]||'';
  if(!suffix)return '';
  if(kind==='distance')return props[`NEAREST_${suffix}_M`]??props[`nearest_${suffix.toLowerCase()}_m`]??'';
  if(kind==='count')return props[`COUNT_${suffix}`]??props[`count_${suffix.toLowerCase()}`]??'';
  if(kind==='source')return props[`SOURCE_${suffix}`]??props[`source_${suffix.toLowerCase()}`]??'';
  if(kind==='ref')return props[`REF_${suffix}`]??props[`ref_${suffix.toLowerCase()}`]??'';
  return '';
}
function utilityTypeFromFeature(feature,fileName=''){
  const props={...(feature?.properties||{}),...(feature?.attributes||{})};
  const pre=precomputedUtilityTypesFromProps(props);
  if(pre.length===1)return pre[0];
  if(pre.length>1)return ''; // multi-type pre-marked files are expanded by fallbackFeatureToUtilityAssets
  const geom=feature?.geometry||{};
  const propText=Object.entries(props||{}).map(([k,v])=>`${k} ${v}`).join(' ');
  const fileText=String(fileName||'').toUpperCase();
  if(/DISTRIBUTION[_\s.-]*OVERHEAD[_\s.-]*POWERLINES?|OVERHEAD[_\s.-]*POWERLINES?|WP[_\s.-]*031/.test(fileText)){
    const rawKv=props.kv??props.KV??props.voltage??props.VOLTAGE;
    const kv=Number(rawKv);
    // WP031 includes LV and HV overhead conductors. Keep only >=1kV as HV distribution crossings.
    if(Number.isFinite(kv) && kv>=1)return 'hvDistribution';
    return '';
  }
  return utilityTypeFromText(`${propText} ${geom?.type||''} ${geom?.geometryType||''}`) || utilityTypeFromFileName(fileName);
}
function utilityThresholdWorker(type){return {water:30,sewer:30,gas:150,rail:150,hvDistribution:90,undergroundCable:35,pillar:35,enclosure:35,esa:120}[type]||120;}
function utilityLabelWorker(type){return {water:'Water pipe',sewer:'Sewer pressure main',gas:'High pressure gas',rail:'Rail',hvDistribution:'HV / distribution overhead line',undergroundCable:'Underground cable',pillar:'Electrical pillar',enclosure:'Electrical enclosure',esa:'Environmentally sensitive area'}[type]||'Utility';}
function hashWorker(s){let h=2166136261; const text=String(s||''); for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);} return 'a'+(h>>>0).toString(16);}
function cleanWorker(v){return v===undefined||v===null?'':String(v).trim();}
function compactPropsWorker(obj){
  const raw={};
  const keep=/^(objectid|id|gid|globalid|asset_id|assetid|structure_id|trmsn_line_gis_label|name|title|type|purpose|holder|holder_1|owner|operator|network|infrastructure|water_type|nominal_size|material|mainname|pressure_type|pressure_main_use|nominal_diameter|pipe_material|road_name|common_usage_name|xing_no|xing_type|network_type|esa_type|hectares|kv|voltage|pressure|kpa|maop|mop|asset_class|asset_type|category|cable_type|geometry_type|pick_id|equip_name|st_area_shape_|st_perimeter_shape_|shape_leng|st_length_shape_|len_km|diameter|diam|size|licence|license|ref|source|line_name|structure_label|utility_.*|nearby_.*|nearest_.*|count_.*|source_.*|ref_.*)$/i;
  for(const [k,v] of Object.entries(obj||{})){
    if(v===undefined||v===null)continue;
    if(!keep.test(k))continue;
    const text=String(v);
    if(text.length>600)continue;
    raw[k]=v;
  }
  return raw;
}
function webMercatorToLatLon(x,y){
  const R=6378137;
  const lon=(Number(x)/R)*180/Math.PI;
  const lat=(2*Math.atan(Math.exp(Number(y)/R))-Math.PI/2)*180/Math.PI;
  if(lat>=-90&&lat<=90&&lon>=-180&&lon<=180)return [lat,lon];
  return null;
}
function utmToLatLon(easting,northing,zone){
  // Good enough for WA proximity work; supports MGA/UTM southern hemisphere metres.
  const a=6378137.0, f=1/298.257223563, k0=0.9996;
  const e=Math.sqrt(f*(2-f));
  const e1sq=e*e/(1-e*e);
  let x=Number(easting)-500000.0;
  let y=Number(northing);
  if(y>10000000||y<0)return null;
  y-=10000000.0; // southern hemisphere
  const m=y/k0;
  const mu=m/(a*(1-e*e/4-3*e**4/64-5*e**6/256));
  const e1=(1-Math.sqrt(1-e*e))/(1+Math.sqrt(1-e*e));
  const j1=3*e1/2-27*e1**3/32;
  const j2=21*e1**2/16-55*e1**4/32;
  const j3=151*e1**3/96;
  const j4=1097*e1**4/512;
  const fp=mu+j1*Math.sin(2*mu)+j2*Math.sin(4*mu)+j3*Math.sin(6*mu)+j4*Math.sin(8*mu);
  const sinfp=Math.sin(fp), cosfp=Math.cos(fp), tanfp=Math.tan(fp);
  const c1=e1sq*cosfp*cosfp;
  const t1=tanfp*tanfp;
  const n1=a/Math.sqrt(1-e*e*sinfp*sinfp);
  const r1=a*(1-e*e)/Math.pow(1-e*e*sinfp*sinfp,1.5);
  const d=x/(n1*k0);
  let lat=fp-(n1*tanfp/r1)*(d*d/2-(5+3*t1+10*c1-4*c1*c1-9*e1sq)*d**4/24+(61+90*t1+298*c1+45*t1*t1-252*e1sq-3*c1*c1)*d**6/720);
  let lon=(d-(1+2*t1+c1)*d**3/6+(5-2*c1+28*t1-3*c1*c1+8*e1sq+24*t1*t1)*d**5/120)/cosfp;
  lon=(zone-1)*6-180+3 + lon*180/Math.PI;
  lat=lat*180/Math.PI;
  if(lat>=-45&&lat<=-5&&lon>=105&&lon<=135)return [lat,lon];
  return null;
}
function projectedToLatLon(x,y){
  x=Number(x); y=Number(y);
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  // Web Mercator around WA: x ~= 12,000,000, y ~= -4,000,000.
  if(Math.abs(x)>1000000&&Math.abs(y)>1000000&&Math.abs(x)<=20037508&&Math.abs(y)<=20037508){
    const wm=webMercatorToLatLon(x,y);
    if(wm&&wm[0]>=-45&&wm[0]<=-5&&wm[1]>=105&&wm[1]<=135)return wm;
  }
  // MGA/UTM WA zones: easting hundreds of thousands, northing millions.
  const tryUtm=(ex,ny)=>{
    if(!(ex>=100000&&ex<=900000&&ny>=5500000&&ny<=9000000))return null;
    for(const z of [49,50,51,52]){const p=utmToLatLon(ex,ny,z); if(p)return p;}
    return null;
  };
  return tryUtm(x,y)||tryUtm(y,x)||null;
}
function coordWorker(c){
  let lon,lat;
  if(Array.isArray(c)){lon=Number(c[0]);lat=Number(c[1]);}
  else if(c&&typeof c==='object'){
    lon=Number(c.x??c.lon??c.lng??c.longitude??c.LONGITUDE??c.X??c.easting??c.EASTING);
    lat=Number(c.y??c.lat??c.latitude??c.LATITUDE??c.Y??c.northing??c.NORTHING);
  }
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
  if(Math.abs(lat)<=90&&Math.abs(lon)<=180)return [lat,lon];
  // If it looks already [lat,lon], repair.
  if(Math.abs(lon)<=90&&Math.abs(lat)<=180){const t=lon; lon=lat; lat=t; if(Math.abs(lat)<=90&&Math.abs(lon)<=180)return [lat,lon];}
  return projectedToLatLon(lon,lat);
}
function extractCoordSequences(value,limitSeq=60){
  const out=[];
  const isNum=n=>Number.isFinite(Number(n));
  const walk=(v)=>{
    if(out.length>=limitSeq||v==null)return;
    if(Array.isArray(v)){
      if(v.length>=2&&isNum(v[0])&&isNum(v[1])){const p=coordWorker(v); if(p)out.push([p]); return;}
      if(v.length&&v.every(item=>Array.isArray(item)&&item.length>=2&&isNum(item[0])&&isNum(item[1]))){
        const seq=v.map(coordWorker).filter(Boolean); if(seq.length)out.push(seq); return;
      }
      for(const item of v)walk(item);
    }else if(typeof v==='object'){
      if(('x'in v||'lon'in v||'lng'in v||'longitude'in v||'X'in v||'easting'in v)&&('y'in v||'lat'in v||'latitude'in v||'Y'in v||'northing'in v)){
        const p=coordWorker(v); if(p){out.push([p]); return;}
      }
      for(const k of ['coordinates','paths','rings','points','geometry','geometries'])if(v[k]!==undefined)walk(v[k]);
    }
  };
  walk(value);
  return out;
}
function simplifyWorker(coords,maxPoints=450){
  const arr=(Array.isArray(coords)?coords:[]).filter(Boolean);
  if(arr.length<=maxPoints)return arr;
  const out=[]; const step=(arr.length-1)/(maxPoints-1);
  for(let i=0;i<maxPoints;i++)out.push(arr[Math.round(i*step)]);
  return out;
}
function centroidWorker(points){
  const pts=(Array.isArray(points)?points:[]).filter(Boolean);
  if(!pts.length)return null;
  let lat=0,lon=0;
  for(const p of pts){lat+=p[0];lon+=p[1];}
  return {lat:lat/pts.length,lon:lon/pts.length};
}
function nameFromPropsWorker(props,type){
  const pick=(names)=>{for(const n of names){if(props[n]!==undefined&&props[n]!==null&&String(props[n]).trim())return String(props[n]).trim();}return '';};
  if(type==='water')return pick(['infrastructure','INFRASTRUCTURE','network','NETWORK','water_type','WATER_TYPE','id','ID'])||'Water pipe';
  if(type==='sewer')return pick(['mainname','MAINNAME','pressure_main_use','PRESSURE_MAIN_USE','pressure_type','PRESSURE_TYPE','id','ID'])||'Sewer pressure main';
  if(type==='gas')return pick(['name','NAME','title','TITLE','purpose','PURPOSE','holder_1','HOLDER_1','license','LICENCE'])||'High pressure gas';
  if(type==='rail')return pick(['common_usage_name','COMMON_USAGE_NAME','road_name','ROAD_NAME','name','NAME','xing_no','XING_NO'])||'Rail';
  if(type==='hvDistribution')return pick(['netwk_name','NETWK_NAME','kv','KV','voltage','VOLTAGE'])||'Overhead HV distribution';
  if(type==='undergroundCable')return pick(['pick_id','PICK_ID','id','ID','kv','KV'])||'Underground cable';
  if(type==='pillar')return pick(['pick_id','PICK_ID','id','ID'])||'Electrical pillar';
  if(type==='enclosure')return pick(['equip_name','EQUIP_NAME','pick_id','PICK_ID','id','ID'])||'Electrical enclosure';
  if(type==='esa')return pick(['esa_type','ESA_TYPE','name','NAME'])||'Environmentally sensitive area';
  return utilityLabelWorker(type);
}
function fallbackFeatureToUtilityAssets(feature,fileName,index){
  const props={...(feature?.properties||{}),...(feature?.attributes||{})};
  const preTypes=precomputedUtilityTypesFromProps(props);
  const singleType=preTypes.length?'':utilityTypeFromFeature(feature,fileName);
  const types=preTypes.length?preTypes:(singleType?[singleType]:[]);
  if(!types.length)return [];
  let geom=feature?.geometry||{};
  if(typeof geom==='string'){
    try{geom=JSON.parse(geom);}catch(e){geom={};}
  }
  const baseRaw=compactPropsWorker({...props,GEOMETRY_TYPE:geom.type||geom.geometryType||''});
  const isPrecomputed=preTypes.length>0 || props.UTILITY_BADGES!==undefined || props.UTILITY_TYPES!==undefined;
  const pointFromFeature=()=>{
    const p=coordWorker(geom?.coordinates)||coordWorker(geom)||coordWorker(props);
    if(p)return p;
    const seqs=extractCoordSequences(geom,4);
    if(seqs.length&&seqs[0].length)return seqs[0][0];
    return null;
  };
  const makeBase=(type,suffix='')=>{
    const raw={...baseRaw};
    if(isPrecomputed){
      raw.UTILITY_MARKUP=true;
      raw.UTILITY_TYPE_EXPANDED=type;
      const d=utilityFieldValue(props,type,'distance');
      const c=utilityFieldValue(props,type,'count');
      const src=utilityFieldValue(props,type,'source');
      const ref=utilityFieldValue(props,type,'ref');
      if(d!==''&&d!==undefined)raw.NEAREST_M=d;
      if(c!==''&&c!==undefined)raw.COUNT=c;
      if(src)raw.SOURCE=src;
      if(ref)raw.REF=ref;
    }
    return {
      id:hashWorker([fileName,index,suffix,type,props.OBJECTID||props.objectid||props.id||props.ID||props.structure_id||props.trmsn_line_gis_label||''].join('|')),
      sourceType:'geojson',sourceFile:fileName,sourcePath:`feature.${index}${suffix?'.'+suffix:''}`,
      kind:`utility-${type}`,utilityType:type,utilityThresholdM:utilityThresholdWorker(type),
      label:isPrecomputed?`${utilityLabelWorker(type)} proximity`:nameFromPropsWorker(props,type),
      utilityName:isPrecomputed?`${utilityLabelWorker(type)} proximity`:nameFromPropsWorker(props,type),
      category:utilityLabelWorker(type),raw,
      searchText:''
    };
  };
  const out=[];
  const addRoute=(type,coords,suffix)=>{
    const pts=simplifyWorker((coords||[]).map(coordWorker).filter(Boolean),type==='hvDistribution'?2500:450);
    if(pts.length<2)return;
    const mid=centroidWorker(pts)||{};
    out.push({...makeBase(type,suffix),lat:mid.lat,lon:mid.lon,routeCoords:pts});
  };
  const addRing=(type,ring,suffix)=>{
    const pts=simplifyWorker((ring||[]).map(coordWorker).filter(Boolean),type==='rail'?900:500);
    if(pts.length<3)return;
    const mid=centroidWorker(pts)||{};
    out.push({...makeBase(type,suffix),lat:mid.lat,lon:mid.lon,polygonRings:[pts]});
  };
  const addPoint=(type,p,suffix)=>{const pt=coordWorker(p); if(pt)out.push({...makeBase(type,suffix),lat:pt[0],lon:pt[1]});};

  if(isPrecomputed){
    const p=pointFromFeature();
    if(!p)return [];
    for(const type of types)out.push({...makeBase(type,`marked-${type}`),lat:p[0],lon:p[1]});
    return out.filter(a=>Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)));
  }

  const gtype=String(geom.type||geom.geometryType||'').toLowerCase();
  for(const type of types){
    if(gtype==='linestring')addRoute(type,geom.coordinates,'line');
    else if(gtype==='multilinestring')for(const [i,line] of (geom.coordinates||[]).entries())addRoute(type,line,`line${i}`);
    else if(gtype==='polygon')addRing(type,(geom.coordinates||[])[0]||[], 'poly');
    else if(gtype==='multipolygon')for(const [i,poly] of (geom.coordinates||[]).entries())addRing(type,(poly||[])[0]||[],`poly${i}`);
    else if(gtype==='point')addPoint(type,geom.coordinates,'point');
    else if(Array.isArray(geom.paths))for(const [i,path] of geom.paths.entries())addRoute(type,path,`path${i}`);
    else if(Array.isArray(geom.rings))for(const [i,ring] of geom.rings.entries())addRing(type,ring,`ring${i}`);
    else{
      const p=coordWorker(geom) || coordWorker(props);
      if(p)out.push({...makeBase(type,'xy'),lat:p[0],lon:p[1]});
      if(!out.length){
        const seqs=extractCoordSequences(geom,80);
        let n=0;
        for(const seq of seqs){
          if(seq.length>1){
            const pts=simplifyWorker(seq,type==='hvDistribution'?2500:450);
            const mid=centroidWorker(pts)||{};
            out.push({...makeBase(type,`seq${n++}`),lat:mid.lat,lon:mid.lon,routeCoords:pts});
          }else if(seq.length===1){
            out.push({...makeBase(type,`pt${n++}`),lat:seq[0][0],lon:seq[0][1]});
          }
          if(n>=12)break;
        }
      }
    }
  }
  return out.filter(a=>Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&(Array.isArray(a.routeCoords)||Array.isArray(a.polygonRings)||true));
}


let __cancelled=false;
function assertNotCancelled(){ if(__cancelled){const e=new Error('Import cancelled. Current file was not loaded.'); e.name='AbortError'; throw e;} }
self.onmessage=async(ev)=>{
  const msg=ev.data||{};
  if(msg.type==='cancel'){__cancelled=true; self.postMessage({type:'error',message:'Import cancelled. Current file was not loaded.'}); return;}
  if(msg.type!=='start')return;
  __cancelled=false;
  const file=msg.file;
  const fileName=msg.fileName || file?.name || 'large.geojson';
  if(!file||!file.stream){self.postMessage({type:'error',message:'No streamable file received by worker.'});return;}
  try{ await parseLargeGeoJSON(file,fileName); }
  catch(err){ self.postMessage({type:'error',message:err?.message||String(err)}); }
};

async function parseLargeGeoJSON(file,fileName){
  assertNotCancelled();
  // Robust parser: find the actual "features": [ array, then parse every top-level
  // object inside it. This does NOT require "type":"Feature" to be the first field,
  // so it avoids missing items when source property order changes.
  const reader=file.stream().getReader();
  const decoder=new TextDecoder('utf-8');
  let buffer='';
  let bytesRead=0;
  let featureIndex=0, skipped=0, assetsIndexed=0;
  let batch=[];
  let lastProgress=0;
  let inFeatures=false;
  let finishedFeatures=false;
  const batchLimit=250;

  const postProgress=(force=false,note='')=>{
    if(__cancelled)return;
    const now=Date.now();
    if(!force && now-lastProgress<180)return;
    lastProgress=now;
    self.postMessage({type:'progress',stats:{
      featuresRead:featureIndex,assetsIndexed,skipped,fileName,bytesRead,fileSize:file.size,
      display:`${fmt(bytesRead)} / ${fmt(file.size)}`,
      note:note||'Scanning features array live'
    }});
  };
  const flushBatch=()=>{
    if(__cancelled)return;
    if(!batch.length)return;
    self.postMessage({type:'batch',assets:batch,stats:{featuresRead:featureIndex,assetsIndexed,skipped,fileName,bytesRead,fileSize:file.size,note:'Batch saved'}});
    batch=[];
  };
  const findFeaturesArray=()=>{
    if(inFeatures)return true;
    const re=/"features"\s*:\s*\[/i;
    const m=re.exec(buffer);
    if(!m){
      // Keep a tail long enough to catch the word if split across chunks.
      if(buffer.length>65536)buffer=buffer.slice(-65536);
      return false;
    }
    buffer=buffer.slice(m.index+m[0].length);
    inFeatures=true;
    return true;
  };
  const trimLeadingSeparators=()=>{
    let i=0;
    while(i<buffer.length && /\s|,/.test(buffer[i]))i++;
    if(i>0)buffer=buffer.slice(i);
  };
  const findCompleteObjectEnd=()=>{
    if(!buffer.length || buffer[0]!=='{')return -2; // not object start
    let depth=0,inString=false,escape=false;
    for(let i=0;i<buffer.length;i++){
      const ch=buffer[i];
      if(inString){
        if(escape){escape=false;continue;}
        if(ch==='\\'){escape=true;continue;}
        if(ch==='"')inString=false;
        continue;
      }
      if(ch==='"'){inString=true;continue;}
      if(ch==='{')depth++;
      else if(ch==='}'){
        depth--;
        if(depth===0)return i;
      }
    }
    return -1; // incomplete object, wait for more chunks
  };
  const processBuffer=async(final=false)=>{
    if(finishedFeatures)return;
    if(!findFeaturesArray())return;
    let guard=0;
    while(buffer.length){
      assertNotCancelled();
      trimLeadingSeparators();
      if(!buffer.length)return;
      if(buffer[0]===']'){
        finishedFeatures=true;
        buffer=buffer.slice(1);
        return;
      }
      if(buffer[0]!=='{'){
        // Unexpected noise in array. Drop one char and log as skipped only if not whitespace/separator.
        buffer=buffer.slice(1);
        continue;
      }
      const end=findCompleteObjectEnd();
      if(end===-1){
        if(final){skipped++; buffer='';}
        return;
      }
      if(end===-2){buffer=buffer.slice(1);continue;}
      const featureText=buffer.slice(0,end+1);
      try{
        const feature=JSON.parse(featureText);
        let assets=[];
        const utilType=utilityTypeFromFeature(feature,fileName);
        if(utilType){
          assets=fallbackFeatureToUtilityAssets(feature,fileName,featureIndex);
        }
        if(!assets.length){
          try{
            assets=(self.ImportEngine&&self.ImportEngine.featureToAssets?self.ImportEngine.featureToAssets(feature,fileName,featureIndex,{largeMode:true}):[])||[];
          }catch(parseErr){
            assets=[];
          }
        }
        if(!assets.length)assets=fallbackFeatureToUtilityAssets(feature,fileName,featureIndex);
        for(const a of assets){
          const safe=(self.ImportEngine&&self.ImportEngine.compactLargeAsset)?self.ImportEngine.compactLargeAsset(a):a;
          if(safe){batch.push(safe); assetsIndexed++;}
        }
      }catch(err){
        const fallback=fallbackFeatureToUtilityAssets({properties:{},geometry:null},fileName,featureIndex);
        if(fallback.length){for(const a of fallback){batch.push(a); assetsIndexed++;}}
        else skipped++;
      }
      featureIndex++;
      buffer=buffer.slice(end+1);
      if(batch.length>=batchLimit)flushBatch();
      guard++;
      if(guard%40===0){postProgress(false,'Parsing feature objects'); await sleep0();}
    }
  };

  postProgress(true,'Worker started');
  while(true){
    assertNotCancelled();
    const {value,done}=await reader.read();
    if(done)break;
    bytesRead+=value.byteLength;
    buffer+=decoder.decode(value,{stream:true});
    postProgress(true,inFeatures?'Reading feature stream':'Looking for features array');
    await processBuffer(false);
    await sleep0();
  }
  buffer+=decoder.decode();
  await processBuffer(true);
  assertNotCancelled();
  flushBatch();
  if(featureIndex===0){
    throw new Error('No GeoJSON features were parsed. The file may not be a normal FeatureCollection, or the features array was not found.');
  }
  self.postMessage({type:'done',stats:{featuresRead:featureIndex,assetsIndexed,skipped,fileName,bytesRead:file.size,fileSize:file.size,note:'Completed features-array scan'}});
}
