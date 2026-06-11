const StorageEngine={
  db:null,
  key:'fieldMapCleanHybrid',
  assetChunkSize:900,
  fileAssetChunkSize:700,
  dxPoleAssetChunkSize:600,
  open(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){resolve(null);return;}
      const req=indexedDB.open('FieldMAP_CleanHybrid_DB',2);
      req.onupgradeneeded=()=>{const db=req.result; if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv');};
      req.onsuccess=()=>{this.db=req.result;resolve(this.db);};
      req.onerror=()=>reject(req.error);
    });
  },
  async get(k){
    await this.ensure();
    if(!this.db){const v=localStorage.getItem(this.key+':'+k); return v?JSON.parse(v):null;}
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('kv','readonly');
      const req=tx.objectStore('kv').get(k);
      req.onsuccess=()=>resolve(req.result??null);
      req.onerror=()=>reject(req.error);
    });
  },
  async set(k,v){
    await this.ensure();
    if(!this.db){localStorage.setItem(this.key+':'+k,JSON.stringify(v));return;}
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('kv','readwrite');
      tx.objectStore('kv').put(v,k);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  },
  async del(k){
    await this.ensure();
    if(!this.db){localStorage.removeItem(this.key+':'+k);return;}
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('kv','readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);});
  },
  async clear(){
    await this.ensure();
    if(!this.db){Object.keys(localStorage).filter(k=>k.startsWith(this.key+':')).forEach(k=>localStorage.removeItem(k));return;}
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('kv','readwrite'); tx.objectStore('kv').clear(); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);});
  },
  async ensure(){if(this.db===undefined)return this.open(); if(!this.db) await this.open().catch(()=>{this.db=null;});},
  hash(s){let h=2166136261; const text=String(s||''); for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(36);},
  fileKey(meta={}){
    if(meta.storageKey)return String(meta.storageKey);
    const base=[meta.name||'file',meta.importedAt||Date.now(),meta.size||0].join('|');
    meta.storageKey='f_'+this.hash(base);
    return meta.storageKey;
  },
  saveProgressPct(meta={},kind='normal',i=0,count=1){
    const start=Number(meta.savePctStart);
    const end=Number(meta.savePctEnd);
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start){
      return Math.max(1,Math.min(99,Math.round(start+((i+1)/Math.max(1,count))*(end-start))));
    }
    return Math.max(1,Math.min(99,Math.round(90+((i+1)/Math.max(1,count))*7)));
  },

  compactPrimitiveValue(v){
    if(v===undefined||v===null)return undefined;
    if(typeof v==='number'||typeof v==='boolean')return v;
    let t=String(v).replace(/^\uFEFF/,'').trim();
    if(!t)return undefined;
    if(t.length>900)t=t.slice(0,900);
    return t;
  },
  compactRawRecord(raw={},mode='asset'){
    if(!raw||typeof raw!=='object')return {};
    const entries=Object.entries(raw);
    const keep={};
    const smallEnough=entries.length<=72;
    const always=/^(OBJECTID|OBJECT_ID|ID|GLOBALID|GLOBAL_ID|asset_id|assetid|PICK_ID|pick_id|EQUIP_NAME|equip_name|EQUIP_NO|Equipment No|EQUIPMENT_NO|ELLIPSE_PLNT_NO|Ellipse Plant No|LINE_NAME|LINE_NAME_\d+|line_name|line_name_\d+|CIRCUIT|CIRCUIT_NAME|ROUTE_NAME|netwk_name|NETWORK_ID|NETWORK_NAME|NAME|Name|name|TITLE|Label|LABEL|label|STRUCTURE_LABEL|structure_label|TRMSN_LINE_GIS_LABEL|trmsn_line_gis_label|GIS_LABEL|gis_label|LINE_GIS_LABEL|NAMEPLATE_ID|NAMEPLATE_ID_\d+|POLE_NUMBER|POLE_NO|POLE_NUM|STRUCTURE_NO|STRUCT_NO|S_NO|SNUM|POINT_NO|POINT_ID|FIRST_NAME_PLATE_ID|LAST_NAME_PLATE_ID|FIRST_STRUCTURE|LAST_STRUCTURE|FROM_STRUCTURE|TO_STRUCTURE|FIRST_POLE|LAST_POLE|LATITUDE|LONGITUDE|latitude|longitude|lat|lon|lng|x|y|X|Y|EASTING|NORTHING|ZONE_|ZONE|UTM_ZONE|STRUC_TYP_DESC|STRUCTURE_TYPE|STRUC_CAT_DESC|SUB_STRUC_DESC|pole_type|POLE_TYPE|MATRL_TYP_DESC|MATERIAL|Material|POLE_LEN_M|POLE_HEIGHT_M|POLE_LENGTH|POLE_HEIGHT|LEN_M|HEIGHT_M|CONDUCTOR_ID_DESC|CONDUCTOR|CONDUCTOR_TYPE|WIRE_TYPE|EARTH_WIRE_1_ID_DESC|EARTH_WIRE_2_ID_DESC|COND_NO_PHS_QTY|CONDUCTOR_QTY|CABLE_ID|STRUNG_SECTION_TYP_ID_DESC|VOLTAGE|Voltage|KV|kv|SUBSTATION|SUBSTATION_NAME|SEARCH_FIELD|ABBREVIATION|DEPOT_NAME|DEPOT|SUBSTATION_TYPE|OWNER|AER_NSP|ADDRESS|ADDRESS_FULL|LOCATION|ROAD_NAME|STREET_NAME|STREET|ROAD|SUBURB|LOCALITY|TOWN|KVA|RATING_KVA|RATING|CAPACITY|CAPACITY_KVA|ASSET_TYPE|asset_type|ASSET_CLASS|asset_class|TYPE|Feature Type|FEATURE_TYPE|LAYER|LAYER_NAME|layer|layerName|CLASS|CLASSIFICATION|DESCRIPTION|DESC|COMMENTS|NOTES|NP_DWG_NO|DRAWING|DWG|GEOMETRY_TYPE)$/i;
    const usefulLoose=/(line|circuit|feeder|route|structure|pole|tower|nameplate|name|label|asset|equip|type|class|voltage|conductor|earth|wire|height|length|material|substation|depot|terminal|address|road|street|suburb|locality|transformer|kva|kv|owner|operator|network|drawing|dwg|objectid)/i;
    for(const [k,v] of entries){
      if(v===undefined||v===null)continue;
      if(typeof v==='object')continue;
      const val=this.compactPrimitiveValue(v);
      if(val===undefined)continue;
      const key=String(k||'').trim();
      if(!key)continue;
      const keepKey=always.test(key)||(smallEnough&&usefulLoose.test(key));
      if(!keepKey)continue;
      // Avoid keeping monster WKT/geometry blobs in IndexedDB. Route/polygon coords already live in compact routeCoords/polygonRings.
      if(/^(coordinates|geometry|SHAPE|shape|the_geom|wkt|WKT|geom)$/i.test(key))continue;
      keep[key]=val;
    }
    return keep;
  },
  compactAssetRecord(asset={}){
    if(!asset||typeof asset!=='object')return null;
    const out={
      id:asset.id,sourceType:asset.sourceType,sourceFile:asset.sourceFile,sourcePath:asset.sourcePath,kind:asset.kind,label:asset.label,
      line:asset.line,structure:asset.structure,equip:asset.equip,substation:asset.substation,category:asset.category,material:asset.material,conductor:asset.conductor,voltage:asset.voltage,
      poleLength:asset.poleLength,poleHeight:asset.poleHeight,address:asset.address,lat:Number.isFinite(Number(asset.lat))?Number(asset.lat):null,lon:Number.isFinite(Number(asset.lon))?Number(asset.lon):null,
      gisLabel:asset.gisLabel,poleNumber:asset.poleNumber,rawStructure:asset.rawStructure,firstNamePlate:asset.firstNamePlate,lastNamePlate:asset.lastNamePlate,
      terminal:asset.terminal,abbreviation:asset.abbreviation,abbr:asset.abbr,code:asset.code,stationCode:asset.stationCode,substationCode:asset.substationCode,terminalCode:asset.terminalCode,substationType:asset.substationType,owner:asset.owner
    };
    if(Array.isArray(asset.routeCoords)&&asset.routeCoords.length)out.routeCoords=asset.routeCoords;
    if(Array.isArray(asset.polygonRings)&&asset.polygonRings.length)out.polygonRings=asset.polygonRings;
    if(Array.isArray(asset.inferredLineRefs)&&asset.inferredLineRefs.length)out.inferredLineRefs=asset.inferredLineRefs.slice(0,8);
    if(Array.isArray(asset.conductorLinks)&&asset.conductorLinks.length)out.conductorLinks=asset.conductorLinks.slice(0,8);
    if(Array.isArray(asset.sourceFiles)&&asset.sourceFiles.length)out.sourceFiles=asset.sourceFiles.slice(0,6);
    if(Array.isArray(asset.sources)&&asset.sources.length)out.sources=asset.sources.slice(0,6);
    const raw=this.compactRawRecord(asset.raw||{},'asset');
    out.raw=raw;
    const st=String(asset.searchText||'').trim();
    if(st)out.searchText=st.length>14000?st.slice(0,14000):st;
    for(const k of Object.keys(out)){
      const v=out[k];
      if(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length))delete out[k];
    }
    return out;
  },
  compactUtilityRecord(asset={}){
    const out=this.compactAssetRecord(asset);
    if(!out)return null;
    if(asset.utilityType)out.utilityType=asset.utilityType;
    if(asset.utilityName)out.utilityName=asset.utilityName;
    if(asset.utilityThresholdM!==undefined)out.utilityThresholdM=asset.utilityThresholdM;
    if(!out.kind&&asset.kind)out.kind=asset.kind;
    return out;
  },

  async saveFileAssets(meta={},assets=[]){
    const list=Array.isArray(assets)?assets:[];
    const key=this.fileKey(meta);
    const oldCount=Number(meta.chunkCount||await this.get(`fileAssets:${key}:count`)||0);
    for(let i=0;i<oldCount;i++)await this.del(`fileAssets:${key}:${i}`).catch(()=>{});
    const count=Math.ceil(list.length/this.fileAssetChunkSize);
    meta.chunkCount=count;
    meta.assetChunkSize=this.fileAssetChunkSize;
    meta.storageMode='per-file-chunks';
    await this.set(`fileAssets:${key}:count`,count);
    let saved=0;
    for(let i=0;i<count;i++){
      const pct=this.saveProgressPct(meta,'normal',i,count);
      UI?.progress?.(true,'Saving imported file…',`${meta.name||'file'}: normal asset chunk ${i+1} / ${count} · ${saved.toLocaleString()} / ${list.length.toLocaleString()} assets saved`,pct);
      // Build the chunk by loop instead of filter()/slice(). On Android WebView those
      // array copies were enough to crash once several large GeoJSON files were loaded.
      const chunk=[];
      const start=i*this.fileAssetChunkSize;
      const end=Math.min(start+this.fileAssetChunkSize,list.length);
      for(let j=start;j<end;j++){const a=list[j]; if(a&&typeof a==='object'){const c=this.compactAssetRecord(a); if(c)chunk.push(c);}}
      await this.set(`fileAssets:${key}:${i}`,chunk);
      saved+=chunk.length;
      chunk.length=0;
      await new Promise(r=>setTimeout(r,12));
    }
    UI?.progress?.(true,'Saving imported file…',`${meta.name||'file'}: ${saved.toLocaleString()} normal assets saved in ${count.toLocaleString()} chunk(s)`,this.saveProgressPct(meta,'normal',count-1,count));
    return meta;
  },
  async saveUtilityFileAssets(meta={},assets=[]){ return meta||{}; },
  async beginUtilityFileAssets(meta={}){ return meta||{}; },
  async appendUtilityFileAssets(meta={},assets=[]){ return meta||{}; },
  async finishUtilityFileAssets(meta={}){ return meta||{}; },

  async beginDxPoleFileAssets(meta={}){
    if(!meta.dxPoleStorageKey)meta.dxPoleStorageKey='dx_'+this.hash([meta.name||'dx-poles',meta.importedAt||Date.now(),meta.size||0,'dx-pole-stream'].join('|'));
    const key=String(meta.dxPoleStorageKey);
    const oldCount=Number(meta.dxPoleChunkCount||await this.get(`dxPoleAssets:${key}:count`)||0);
    for(let i=0;i<oldCount;i++)await this.del(`dxPoleAssets:${key}:${i}`).catch(()=>{});
    await this.del(`dxPoleAssets:${key}:count`).catch(()=>{});
    meta.dxPoleChunkCount=0;
    meta.dxPoleAssetChunkSize=this.dxPoleAssetChunkSize||600;
    meta.storageMode='dx-pole-chunks';
    meta._dxPoleWriteBuffer=[];
    meta._dxPoleSeenKeys=new Set();
    meta.dxPoleDuplicateSkipped=0;
    return meta;
  },
  dxPoleDedupeKey(asset={}){
    const raw=asset.raw||{};
    const id=String(raw.pick_id||raw.PICK_ID||asset.equip||asset.id||asset.label||'').trim().toUpperCase();
    if(id)return 'ID:'+id;
    const lat=Number(asset.lat), lon=Number(asset.lon);
    if(Number.isFinite(lat)&&Number.isFinite(lon))return 'LL:'+lat.toFixed(6)+','+lon.toFixed(6);
    return '';
  },
  compactDxPoleRecord(asset={}){
    if(!asset||typeof asset!=='object')return null;
    const raw=asset.raw||{};
    const keep={};
    const keepRe=/^(objectid|id|gid|globalid|asset_id|assetid|pick_id|equip_name|structure_id|structure_label|pole_no|pole_number|nameplate_id|line_name|feeder|feeder_name|circuit|circuit_name|route|route_name|network|netwk_name|kv|voltage|material|matrl_typ_desc|pole_type|struc_typ_desc|sub_struc_desc|pole_len_m|pole_height_m|latitude|longitude|x|y|easting|northing|address|suburb|locality|owner|asset_class|asset_type|category|type|description)$/i;
    for(const [k,v] of Object.entries(raw||{})){
      if(v===undefined||v===null)continue;
      if(!keepRe.test(k))continue;
      const t=String(v);
      if(t.length>420)continue;
      keep[k]=v;
    }
    const out={
      id:asset.id, sourceType:asset.sourceType||'geojson', sourceFile:asset.sourceFile, sourcePath:asset.sourcePath,
      kind:'dx-pole', label:asset.label||asset.structure||asset.equip||asset.poleNumber||'Distribution pole',
      line:asset.line||'', structure:asset.structure||'', equip:asset.equip||'', substation:asset.substation||'', category:asset.category||'Distribution Pole',
      material:asset.material||'', conductor:asset.conductor||'', voltage:asset.voltage||'', poleLength:asset.poleLength||'', poleHeight:asset.poleHeight||'', address:asset.address||'',
      lat:Number.isFinite(Number(asset.lat))?Number(asset.lat):null, lon:Number.isFinite(Number(asset.lon))?Number(asset.lon):null,
      gisLabel:asset.gisLabel||'', poleNumber:asset.poleNumber||'', rawStructure:asset.rawStructure||'', raw:keep
    };
    out.searchText=(asset.searchText||[out.label,out.line,out.structure,out.equip,out.poleNumber,out.gisLabel,out.category,Object.values(keep).join(' ')].join(' ')).toUpperCase();
    return out;
  },
  async appendDxPoleFileAssets(meta={},assets=[]){
    const list=Array.isArray(assets)?assets.filter(Boolean):[];
    if(!list.length)return meta;
    if(!meta.dxPoleStorageKey)await this.beginDxPoleFileAssets(meta);
    const chunkSize=Number(meta.dxPoleAssetChunkSize||this.dxPoleAssetChunkSize||600);
    const buf=meta._dxPoleWriteBuffer||(meta._dxPoleWriteBuffer=[]);
    const seen=meta._dxPoleSeenKeys||(meta._dxPoleSeenKeys=new Set());
    for(const a of list){
      const c=this.compactDxPoleRecord(a);
      if(!c)continue;
      const key=this.dxPoleDedupeKey(c);
      if(key&&seen.has(key)){ meta.dxPoleDuplicateSkipped=Number(meta.dxPoleDuplicateSkipped||0)+1; continue; }
      if(key)seen.add(key);
      buf.push(c);
      meta.dxPoleStored=Number(meta.dxPoleStored||0)+1;
    }
    while(buf.length>=chunkSize){
      const chunk=[];
      for(let i=0;i<chunkSize;i++)chunk.push(buf.shift());
      const idx=Number(meta.dxPoleChunkCount||0);
      await this.set(`dxPoleAssets:${meta.dxPoleStorageKey}:${idx}`,chunk);
      meta.dxPoleChunkCount=idx+1;
      chunk.length=0;
      await new Promise(r=>setTimeout(r,4));
    }
    return meta;
  },
  async finishDxPoleFileAssets(meta={}){
    if(!meta.dxPoleStorageKey)await this.beginDxPoleFileAssets(meta);
    const buf=meta._dxPoleWriteBuffer||[];
    if(buf.length){
      const idx=Number(meta.dxPoleChunkCount||0);
      const chunk=[];
      while(buf.length)chunk.push(buf.shift());
      await this.set(`dxPoleAssets:${meta.dxPoleStorageKey}:${idx}`,chunk);
      meta.dxPoleChunkCount=idx+1;
      chunk.length=0;
    }
    await this.set(`dxPoleAssets:${meta.dxPoleStorageKey}:count`,Number(meta.dxPoleChunkCount||0));
    delete meta._dxPoleWriteBuffer;
    delete meta._dxPoleSeenKeys;
    meta.storageMode='dx-pole-chunks';
    return meta;
  },
  dxPoleFileMetas(){return (App.files||[]).filter(f=>f&&f.dxPoleStorageKey);},
  async searchDxPoles(query='',limit=80){
    const q=String(query||'').trim();
    if(!q||App.filters?.dxPoles===false)return [];
    const files=this.dxPoleFileMetas();
    if(!files.length)return [];
    const cq=SearchEngine?.compact?.(q)||q.toUpperCase().replace(/[^A-Z0-9]+/g,'');
    const ws=SearchEngine?.words?.(q)||q.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const scored=[];
    const seen=new Set();
    const scoreOne=(a)=>{
      try{return SearchEngine?.scoreAsset?SearchEngine.scoreAsset(cq,ws,a):0;}catch(e){return 0;}
    };
    for(let fi=0;fi<files.length;fi++){
      const f=files[fi];
      const key=String(f.dxPoleStorageKey||'');
      if(!key)continue;
      const count=Number(f.dxPoleChunkCount||await this.get(`dxPoleAssets:${key}:count`)||0);
      for(let i=0;i<count;i++){
        const chunk=await this.get(`dxPoleAssets:${key}:${i}`).catch(()=>null);
        if(Array.isArray(chunk)){
          for(const a of chunk){
            if(!a||typeof a!=='object')continue;
            a.kind='dx-pole';
            const score=scoreOne(a);
            if(score<=0)continue;
            const rk=SearchEngine?.resultDedupKey?SearchEngine.resultDedupKey({type:'asset',asset:a}):(a.id||`${a.sourceFile}|${a.sourcePath}|${a.lat}|${a.lon}`);
            if(seen.has(rk))continue;
            seen.add(rk);
            scored.push({type:'asset',score:score-4,asset:a,title:a.label||a.structure||a.equip||'Distribution pole',subtitle:SearchEngine?.subtitle?SearchEngine.subtitle(a):'Distribution pole',kind:'dx-pole',lazyStore:'dx-pole'});
          }
        }
        if(i%8===0)await new Promise(r=>setTimeout(r,0));
      }
    }
    scored.sort((a,b)=>b.score-a.score||String(a.title).localeCompare(String(b.title)));
    return scored.slice(0,limit);
  },
  async loadUtilityAssets(force=false,opts={}){
    App.utilityAssets=[]; App.utilityLoaded=true; App.utilityLoadKey='core-only'; return [];
  },
  async unloadUtilityAssets(){
    App.utilityAssets=[]; App.utilityLoaded=false; App.utilityLoadKey='';
  },

  async deleteFileAssets(meta={}){
    if(!meta)return;
    if(meta.storageKey){
      const key=String(meta.storageKey);
      const count=Number(meta.chunkCount||await this.get(`fileAssets:${key}:count`)||0);
      for(let i=0;i<count;i++)await this.del(`fileAssets:${key}:${i}`).catch(()=>{});
      await this.del(`fileAssets:${key}:count`).catch(()=>{});
    }
    if(meta.utilityStorageKey){
      const ukey=String(meta.utilityStorageKey);
      const ucount=Number(meta.utilityChunkCount||await this.get(`utilityAssets:${ukey}:count`)||0);
      for(let i=0;i<ucount;i++)await this.del(`utilityAssets:${ukey}:${i}`).catch(()=>{});
      await this.del(`utilityAssets:${ukey}:count`).catch(()=>{});
    }
    if(meta.dxPoleStorageKey){
      const dkey=String(meta.dxPoleStorageKey);
      const dcount=Number(meta.dxPoleChunkCount||await this.get(`dxPoleAssets:${dkey}:count`)||0);
      for(let i=0;i<dcount;i++)await this.del(`dxPoleAssets:${dkey}:${i}`).catch(()=>{});
      await this.del(`dxPoleAssets:${dkey}:count`).catch(()=>{});
    }
  },
  async saveManifestOnly(){
    await this.set('files',App.files||[]);
    await this.set('indexHealth',App.indexHealth||{});
    await this.set('filters',App.filters||{});
    App.dbMeta=this.currentMeta();
    await this.set('dbMeta',App.dbMeta);
    await this.set('safeMode',!!App.safeMode);
  },
  currentMeta(){return {savedAt:new Date().toISOString(),appVersion:App.version,schema:App.schema||{},assetCount:(App.assets||[]).length,fileCount:(App.files||[]).length,dxPoleStoreCount:(App.files||[]).filter(f=>f.dxPoleStorageKey).reduce((n,f)=>n+Number(f.dxPoleCount||0),0)};},
  sanitiseFileMetas(files=[]){
    let changed=false;
    const cleaned=(Array.isArray(files)?files:[]).map(f=>{
      const copy={...(f||{})};
      if(copy.utilityStorageKey||copy.utilityChunkCount||copy.utilityCount||String(copy.storageMode||'').includes('utility-chunks')){
        delete copy.utilityStorageKey;
        delete copy.utilityChunkCount;
        delete copy.utilityAssetChunkSize;
        delete copy.utilityTypes;
        copy.utilityCount=0;
        copy.storageMode=String(copy.storageMode||'').replace(/\+?utility-chunks/g,'').replace(/^$/,'per-file-chunks');
        changed=true;
      }
      return copy;
    });
    if(changed){App.files=cleaned; this.set('files',cleaned).catch(()=>{});}
    return cleaned;
  },
  needsRebuild(){
    const m=App.dbMeta||{}; const saved=m.schema||{}; const cur=App.schema||{};
    return !saved.parser||saved.parser!==cur.parser||saved.database!==cur.database||saved.searchIndex!==cur.searchIndex||saved.spatialIndex!==cur.spatialIndex;
  },
  async loadAll(){
    try{
      const files=await this.get('files');
      const filters=await this.get('filters');
      const safeMode=await this.get('safeMode');
      const chunkCount=await this.get('assetChunkCount');
      const dbMeta=await this.get('dbMeta');
      const indexHealth=await this.get('indexHealth');
      if(dbMeta)App.dbMeta=dbMeta;
      if(indexHealth)App.indexHealth={...(App.indexHealth||{}),...indexHealth};
      if(Array.isArray(files))App.files=this.sanitiseFileMetas(files);
      if((!App.indexHealth?.files||!App.indexHealth.files.length)&&Array.isArray(App.files)&&App.files.length){App.indexHealth=App.indexHealth||{mode:'file-level',queue:[],files:[]}; App.indexHealth.files=App.files.map(f=>({...f,status:f.indexStatus||'active'}));}
      if(filters)App.filters={...App.filters,...filters};
      App.safeMode=!!safeMode;
      App.utilityAssets=[];
      App.utilityLoaded=false;
      App.utilityLoadKey='';
      const activeFiles=Array.isArray(App.files)?App.files:[];
      const hasPerFile=activeFiles.some(f=>f&&f.storageKey);
      const assets=[];
      if(hasPerFile){
        const needsLegacy=Number.isFinite(Number(chunkCount))&&Number(chunkCount)>0&&activeFiles.some(f=>!f.storageKey);
        if(needsLegacy){
          for(let i=0;i<Number(chunkCount);i++){
            UI?.progress?.(true,'Loading saved data…',`Loading legacy chunk ${i+1} / ${Number(chunkCount)} · ${assets.length.toLocaleString()} assets restored`,15+Math.round((i/Math.max(1,Number(chunkCount)))*25));
            const chunk=await this.get(`assets:${i}`);
            if(Array.isArray(chunk))assets.push(...chunk.filter(a=>a&&typeof a==='object'));
            await new Promise(r=>setTimeout(r,0));
          }
        }
        const pf=activeFiles.filter(f=>f&&f.storageKey); // utility-only files stay lazy-loaded in the utility store
        for(let fi=0;fi<pf.length;fi++){
          const f=pf[fi];
          const key=String(f.storageKey);
          const count=Number(f.chunkCount||await this.get(`fileAssets:${key}:count`)||0);
          for(let i=0;i<count;i++){
            UI?.progress?.(true,'Loading saved data…',`Loading ${f.name||'file'} ${i+1} / ${count} · ${assets.length.toLocaleString()} assets restored`,40+Math.round(((fi+(i/Math.max(1,count)))/Math.max(1,pf.length))*30));
            const chunk=await this.get(`fileAssets:${key}:${i}`);
            if(Array.isArray(chunk))assets.push(...chunk.filter(a=>a&&typeof a==='object'));
            await new Promise(r=>setTimeout(r,0));
          }
        }
        App.assets=assets;
        return;
      }
      if(Number.isFinite(Number(chunkCount))&&Number(chunkCount)>0){
        for(let i=0;i<Number(chunkCount);i++){
          UI?.progress?.(true,'Loading saved data…',`Loading saved chunk ${i+1} / ${Number(chunkCount)} · ${assets.length.toLocaleString()} assets restored`,20+Math.round((i/Math.max(1,Number(chunkCount)))*45));
          const chunk=await this.get(`assets:${i}`);
          if(Array.isArray(chunk))assets.push(...chunk.filter(a=>a&&typeof a==='object'));
          await new Promise(r=>setTimeout(r,0));
        }
        App.assets=assets;
        return;
      }
      const legacy=await this.get('assets');
      if(Array.isArray(legacy))App.assets=legacy.filter(a=>a&&typeof a==='object');
    }catch(err){
      Diagnostics.capture(new Error('Stored database could not be loaded. Use Clear imported data if this repeats. '+(err.message||err)));
      App.assets=[]; App.files=[];
    }
  },
  async saveAll(){
    const assets=Array.isArray(App.assets)?App.assets:[];
    const oldCount=Number(await this.get('assetChunkCount')||0);
    for(let i=0;i<oldCount;i++)await this.del(`assets:${i}`).catch(()=>{});
    await this.del('assets').catch(()=>{});
    const count=Math.ceil(assets.length/this.assetChunkSize);
    await this.set('assetChunkCount',count);
    let saved=0;
    for(let i=0;i<count;i++){
      UI?.progress?.(true,'Saving local database…',`Saving chunk ${i+1} / ${count} · ${saved.toLocaleString()} / ${assets.length.toLocaleString()} assets`,97);
      // Smaller chunks reduce IndexedDB structured-clone memory spikes in SPCK/Android WebView.
      const chunk=[];
      const start=i*this.assetChunkSize;
      const end=Math.min(start+this.assetChunkSize,assets.length);
      for(let j=start;j<end;j++){if(assets[j]){const c=this.compactAssetRecord(assets[j]); if(c)chunk.push(c);}}
      await this.set(`assets:${i}`,chunk);
      saved+=chunk.length;
      chunk.length=0;
      await new Promise(r=>setTimeout(r,12));
    }
    // A full save consolidates core assets only.
    const cleanedFiles=[];
    for(const f of (App.files||[])){
      if(f&&f.storageKey){
        const normalOnly={storageKey:f.storageKey,chunkCount:f.chunkCount};
        await this.deleteFileAssets(normalOnly).catch(()=>{});
      }
      const copy={...(f||{})};
      delete copy.storageKey; delete copy.chunkCount; delete copy.assetChunkSize;
      delete copy.utilityStorageKey; delete copy.utilityChunkCount; delete copy.utilityAssetChunkSize; delete copy.utilityTypes; copy.utilityCount=0;
      copy.storageMode=copy.dxPoleStorageKey?'dx-pole-chunks':'legacy-full-save';
      cleanedFiles.push(copy);
    }
    App.files=cleanedFiles;
    await this.set('files',App.files||[]);
    await this.set('indexHealth',App.indexHealth||{});
    await this.set('filters',App.filters||{});
    App.dbMeta=this.currentMeta();
    await this.set('dbMeta',App.dbMeta);
    await this.set('safeMode',!!App.safeMode);
  }
};
