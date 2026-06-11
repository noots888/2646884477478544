var App={
  version:'mymap-v3-1-155_smooth_freeze_fixes',
  versionShort:'myMap v3.1.155' ,
  baseLock:{name:'myMap',intent:'Builds connected circuit paths from exact imported line/nameplate references, not guessed route stubs or hardcoded data.'},
  schema:{parser:'map-app-v3-1-4-parser-v13-material-category-v1',database:'file-chunk-v2',searchIndex:'pass10-reference-recovery-v2-polepath-only',spatialIndex:'grid-v1'},
  assets:[],files:[],utilityAssets:[],utilityLoaded:false,utilityLoadKey:'',lastImport:null,drawnMarkers:0,selectedAsset:null,safeMode:false,buildInfo:null,dbMeta:null,dbNeedsRebuild:false,indexHealth:{mode:'file-level',queue:[],files:[],current:null,lastFullRebuild:null},
  settings:{areaRevealLimit:5000},
  searchScopes:{transmission:true,dxPoles:true,transformers:true,misc:true},
  searchResultLimit:25,
  mapFilters:{assetBar:false,compass:false},
  filters:{json:true,geojson:true,csv:true,structures:true,circuits:true,substations:true,transformers:true,streetlights:true,dxPoles:true}
};
var Settings={show:function(){},safeFileName:function(name){return String(name||'').replace(/_/g,' ').replace(/\s+/g,' ').trim();}};
var MobileUX={init:function(){},apply:function(){}};
var UI={
  progressState:{show:false,pct:0},
  toastTimer:null,
  init:function(){},
  esc:function(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  safeFileName:function(name){return Settings.safeFileName(name);},
  toast:function(msg){const el=document.getElementById('toast'); if(!el)return; el.textContent=String(msg||''); el.classList.add('show'); clearTimeout(this.toastTimer); this.toastTimer=setTimeout(()=>el.classList.remove('show'),2600);},
  progress:function(show,title='',detail='',pct=0){this.progressState={show:!!show,pct:Number(pct)||0}; const box=document.getElementById('importOverlay'); if(!box)return; box.classList.toggle('hidden',!show); const t=document.getElementById('overlayProgressTitle'); const d=document.getElementById('overlayProgressDetail'); const f=document.getElementById('overlayProgressFill'); const p=document.getElementById('overlayProgressPct'); if(t)t.textContent=title||'Working…'; if(d)d.textContent=detail||''; const n=Math.max(0,Math.min(100,Number(pct)||0)); if(f)f.style.width=n+'%'; if(p)p.textContent=Math.round(n)+'%';},
  renderImportQueue:function(list=[],status='Queued'){const el=document.getElementById('queueStatus'); if(!el)return; const total=(list||[]).reduce((n,f)=>n+Number(f.size||0),0); el.textContent=`${status} · ${list.length} file(s)${total?` · ${ImportEngine?.formatBytes?ImportEngine.formatBytes(total):total}`:''}`;},
  refreshCounts:function(){const assets=Array.isArray(App.assets)?App.assets.length:0; const gps=(App.assets||[]).filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)).length; const circuits=window.SearchEngine?.lineMap?.size||0; const dots=App.drawnMarkers||0; const el=document.getElementById('statusPill'); if(el)el.innerHTML=`<b>${dots.toLocaleString()} dots</b><span>${assets.toLocaleString()} assets</span><span>${gps.toLocaleString()} mapped</span><span>${circuits.toLocaleString()} circuits</span>`;},
  refreshFiles:function(){this.refreshCounts();},
  refreshAll:function(){this.refreshCounts(); window.LeanMapApp?.renderCircuitList?.();},
  applyMapFilters:function(){},
  async handleFiles(files){const list=Array.from(files||[]).filter(Boolean); if(!list.length)return; try{this.progress(true,'Importing files…',`${list.length} file(s) selected`,2); const res=await ImportEngine.importFiles(list); if(res?.needsFullRebuild){await (SearchEngine.rebuildAsync?SearchEngine.rebuildAsync('Rebuilding data index'):SearchEngine.rebuild());} this.refreshAll(); window.LeanMapApp?.renderCircuitList?.(); window.LeanMapApp?.closeCircuitPicker?.(); const skipped=Number(res?.skippedUnchanged||0); const imported=Number(res?.imported||0); if(skipped&&skipped>=list.length&&!imported)this.toast('No changed files found. Existing indexed data kept.'); else this.toast(`Imported ${imported.toLocaleString()} assets from ${(res.files||[]).length||list.length} file(s)${skipped?` · ${skipped} unchanged skipped`:''}.`);}
    catch(err){Diagnostics.capture(err); this.toast(err?.name==='AbortError'?'Import cancelled.':'Import failed.');}
    finally{this.progress(false); const input=document.getElementById('fileInput'); if(input)input.value='';}}
};
