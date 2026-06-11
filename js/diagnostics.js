const Diagnostics={
  errors:[],
  logs:[],
  init(){
    window.addEventListener('error',e=>this.capture(e.error||e.message||'Unknown error'));
    window.addEventListener('unhandledrejection',e=>this.capture(e.reason||'Unhandled promise rejection'));
  },
  capture(err){
    const msg=err?.stack||String(err);
    const name=String(err&&err.name||'');
    if(name==='AbortError'||/^AbortError\b/i.test(msg)||/signal is aborted/i.test(msg)){
      this.log('Ignored normal browser abort',msg);
      return;
    }
    if((name==='TypeError'||/^TypeError\b/i.test(msg)||/Failed to fetch/i.test(msg)) && (/lookupNearestAddressForPin|pinFetchJsonWithTimeout|lookupOverpassClosestStreetAddress|fetchJsonWithTimeout|nominatim|overpass|photon|bigdatacloud/i.test(msg))){
      this.log('Ignored nearest-address fetch failure',msg);
      return;
    }
    this.errors.push({time:new Date().toISOString(),message:msg});
    if(this.errors.length>80)this.errors.shift();
    console.error(err);
    const panel=document.getElementById('crashPanel');
    const text=document.getElementById('crashText');
    if(panel&&text){text.textContent=msg;panel.classList.remove('hidden');}
  },
  log(message,detail=''){
    this.logs.push({time:new Date().toISOString(),message:String(message||''),detail:String(detail||'')});
    if(this.logs.length>160)this.logs.shift();
  },
  snapshot(){
    const app=window.App||{};
    const assets=Array.isArray(app.assets)?app.assets:[];
    const mapped=assets.filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)).length;
    return {
      version:app.version,
      versionShort:app.versionShort||'',
      files:Array.isArray(app.files)?app.files.length:0,
      totalAssets:assets.length,
      mappedAssets:mapped,
      unmappedAssets:assets.length-mapped,
      circuits:window.SearchEngine?.lineMap?.size||0,
      currentDots:app.drawnMarkers||0,
      currentDisplay:window.MapEngine?.currentDisplay||'none',
      currentCircuit:window.MapEngine?.currentCircuit||'',
      searchReady:!!window.SearchEngine,
      mapReady:!!window.MapEngine?.map,
      storageReady:!!window.StorageEngine,
      lastImport:app.lastImport||null,
      errors:this.errors.slice(-20),
      logs:this.logs.slice(-40)
    };
  },
  selfCheck(){
    const app=window.App||{};
    const checks=[];
    const add=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail:String(detail||'')});
    add('Core version', !!app.version, app.versionShort||app.version||'missing');
    add('Local database', !!window.StorageEngine, window.indexedDB?'available':'unavailable');
    add('Map', !!window.MapEngine?.map, window.MapEngine?.map?'ready':'not ready');
    add('Search', !!window.SearchEngine && typeof window.SearchEngine.search==='function', 'ready');
    add('Popups', !!window.PopupEngine, window.PopupEngine?'ready':'missing');
    const failed=checks.filter(c=>!c.ok);
    return {time:new Date().toISOString(),ok:failed.length===0,failed:failed.length,total:checks.length,checks};
  },
  exportReport(){
    try{
      const report={selfCheck:this.selfCheck(),snapshot:this.snapshot(),userAgent:navigator.userAgent,href:location.href,exportedAt:new Date().toISOString()};
      const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='field_map_core_report.json';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),500);
    }catch(err){this.capture(err);}
  }
};
Diagnostics.init();
