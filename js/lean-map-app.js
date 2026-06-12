var LeanMapApp={
  selectedCircuit:'',
  selectedCircuits:[],
  dataCategory:'summary',
  conductorSubCategory:'top',
  conductorPanelMode:'circuit',
  conductorTypeFilter:'',
  conductorNameFilter:'',
  conductorNamePage:1,
  conductorTypeListLimit:50,
  conductorPage:1,
  conductorPageSize:5,
  expandedConductorRows:{},
  dataSectionOpen:{},
  toolsSectionOpen:{},
  fileListLimit:30,
  conductorAllLimit:50,
  weightTestLimit:8,
  conductorGroupCache:null,
  statsCache:null,
  renderToken:0,
  async boot(){
    try{
      this.bind();
      await this.clearOldShellCache();
      await this.registerPwaWorker();
      UI.progress(true,'Starting myMap…','Loading core map',8);
      if(window.FieldMapConductorDataLoader?.ready){
        UI.progress(true,'Loading conductor reference…','Reading saved conductor JSON if loaded',12);
        await window.FieldMapConductorDataLoader.ready;
      }
      MapEngine.init();
      try{HVCrossingsLayer?.init?.(); await HVCrossingsLayer?.loadStore?.();}catch(e){Diagnostics?.log?.('Crossing sidecar load failed',String(e?.message||e));}
      UI.progress(true,'Loading saved data…','Reading local files',25);
      await StorageEngine.loadAll();
      UI.progress(true,'Building search…',`${(App.assets||[]).length.toLocaleString()} assets loaded`,65);
      await (SearchEngine.rebuildAsync?SearchEngine.rebuildAsync('Startup data index rebuild'):SearchEngine.rebuild());
      App.dbNeedsRebuild=StorageEngine.needsRebuild?.()||false;
      MapEngine.clearDisplay(false);
      this.renderCircuitList();
      UI.refreshAll();
      this.updateReferenceToggleButtons();
      UI.progress(false);
      UI.toast('Core data loaded. Map stays empty until you load a circuit or search result.');
    }catch(err){
      UI.progress(false);
      if(err?.name==='AbortError')UI.toast('Startup index rebuild cancelled.');
      else Diagnostics.capture(err);
    }
  },
  async clearOldShellCache(){
    try{if(window.caches){const keys=await caches.keys(); await Promise.all(keys.filter(k=>/^field-map-|^fieldMap/i.test(k)).map(k=>caches.delete(k)));}}
    catch(e){}
  },
  async registerPwaWorker(){
    try{
      if(!('serviceWorker' in navigator))return;
      if(!(location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1'))return;
      const reg=await navigator.serviceWorker.register('./service-worker.js?v=mymap-v3-1-170_address_pin_remove',{scope:'./'}); try{await reg.update?.();}catch(e){}
    }catch(e){}
  },
  updateReferenceToggleButtons(){
    const mode=String(MapEngine?.currentDisplay||'').toLowerCase();
    const sync=(selector,activeText,inactiveText,active)=>{
      document.querySelectorAll(selector).forEach(btn=>{
        btn.textContent=active?activeText:inactiveText;
        btn.classList.toggle('active',!!active);
      });
    };
    sync('#showAllSubstationsBtn,[data-tools-reference-kind="substation"]','Hide All Substations','Show All Substations',mode==='all substations');
    sync('#showAllDepotsBtn,[data-tools-reference-kind="depot"]','Hide All Depots','Show All Depots',mode==='all depots');
  },
  async toggleReferencePoints(kind='substation'){
    const want=String(kind||'substation').toLowerCase()==='depot'?'depot':'substation';
    const activeDisplay=want==='depot'?'all depots':'all substations';
    this.closePlusMenu();
    if(String(MapEngine?.currentDisplay||'').toLowerCase()===activeDisplay){
      try{MapEngine.clearDisplay(false);}catch(e){}
      UI.toast(want==='depot'?'All depots hidden.':'All substations hidden.');
      UI.refreshCounts?.();
      this.updateReferenceToggleButtons();
      return;
    }
    UI.progress(true,want==='depot'?'Showing depots…':'Showing substations…',want==='depot'?'Depot points':'Substations and terminals',20);
    try{await MapEngine.showReferencePoints(want);}
    catch(err){Diagnostics.capture(err);UI.toast(want==='depot'?'Show depots failed.':'Show substations failed.');}
    finally{UI.progress(false);UI.refreshCounts();this.updateReferenceToggleButtons();}
  },
  bind(){
    document.getElementById('magnifyBtn')?.addEventListener('click',()=>this.toggleCircuitPicker());
    document.getElementById('plusBtn')?.addEventListener('click',()=>this.togglePlusMenu());
    document.getElementById('mapLayerBtn')?.addEventListener('click',()=>MapEngine.cycleBase());
    document.getElementById('nearbyBtn')?.addEventListener('click',()=>MapEngine.showNearbyAssets?.());
    document.getElementById('gpsFollow')?.addEventListener('click',()=>MapEngine.toggleGpsFollow());
    document.getElementById('gpsPanelCloseBtn')?.addEventListener('click',()=>MapEngine.hideGpsPanel());
    document.getElementById('gpsFollowModeBtn')?.addEventListener('click',()=>{MapEngine.gpsMode='follow';MapEngine.updateGpsButton();MapEngine.showGpsPanel();MapEngine.startGpsWatch(false);try{localStorage.setItem('fieldMapGpsMode','follow');}catch(e){};UI?.toast?.('GPS follow mode.');});
    document.getElementById('gpsStopFollowBtn')?.addEventListener('click',()=>MapEngine.stopGpsFollow(true));
    document.querySelectorAll('[data-gps-profile]').forEach(btn=>btn.addEventListener('click',()=>MapEngine.setGpsProfile(btn.dataset.gpsProfile||'walking')));
    document.getElementById('closeCircuitPicker')?.addEventListener('click',()=>this.closeCircuitPicker());
    document.getElementById('resetCircuitPickerBtn')?.addEventListener('click',()=>this.resetCircuitPicker());
    document.getElementById('loadCircuitBtn')?.addEventListener('click',()=>this.loadSelectedCircuit());
    document.getElementById('assetSearchFromCircuitBtn')?.addEventListener('click',()=>{this.closeCircuitPicker();this.openAssetSearch();});
    document.getElementById('fileInput')?.addEventListener('change',e=>UI.handleFiles(e.target.files));
    document.getElementById('conductorJsonInput')?.addEventListener('change',e=>this.importConductorJson(e.target.files?.[0]));
    document.getElementById('importBtn')?.addEventListener('click',()=>{this.closePlusMenu();document.getElementById('fileInput')?.click();});
    document.getElementById('installAppBtn')?.addEventListener('click',()=>{this.closePlusMenu();window.MyMapPwaInstall?.install?.();});
    document.getElementById('clearMapDisplayBtn')?.addEventListener('click',()=>{this.closePlusMenu();MapEngine.clearDisplay();UI.refreshCounts();this.updateReferenceToggleButtons();});
    document.getElementById('showAllSubstationsBtn')?.addEventListener('click',()=>this.toggleReferencePoints('substation'));
    document.getElementById('showAllDepotsBtn')?.addEventListener('click',()=>this.toggleReferencePoints('depot'));
    document.getElementById('conductorBtn')?.addEventListener('click',()=>{this.closePlusMenu();this.conductorMaterialFilter='';this.conductorTypeFilter='';this.conductorNameFilter='';this.expandedConductorRows={};this.conductorPage=1;this.conductorNamePage=1;this.openConductorsPanel('circuit');});
    document.getElementById('statusBtn')?.addEventListener('click',()=>{this.closePlusMenu();this.showDataPanel('summary');});
    document.getElementById('toolsBtn')?.addEventListener('click',()=>{this.closePlusMenu();this.openToolsPanel();});
    document.getElementById('resetBtn')?.addEventListener('click',()=>{this.closePlusMenu();this.openResetPanel();});
    const dataBody=document.querySelector('#statusPanel .data-manager-body');
    dataBody?.addEventListener('scroll',()=>this.updatePanelScrollTopButton());
    document.getElementById('panelScrollTopBtn')?.addEventListener('click',()=>this.scrollCurrentPanelTop());
    const conductorBody=document.querySelector('#conductorsPanel .conductors-body');
    conductorBody?.addEventListener('scroll',()=>this.updateConductorScrollTopButton());
    document.getElementById('conductorsScrollTopBtn')?.addEventListener('click',()=>this.scrollConductorsPanelTop());
    document.getElementById('closeConductorsPanel')?.addEventListener('click',()=>this.closeConductorsPanel());
    document.getElementById('importConductorHeaderBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();document.getElementById('conductorJsonInput')?.click();});
    document.getElementById('conductorWeightHeaderBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();this.conductorPage=1;this.conductorNamePage=1;this.openConductorsPanel('weight',true);});
    document.getElementById('conductorCategoryTabs')?.addEventListener('click',e=>{const btn=e.target.closest?.('button[data-cond-panel]'); if(btn){this.conductorPage=1;this.conductorNamePage=1;this.openConductorsPanel(btn.dataset.condPanel||'type',true);}});
    document.getElementById('conductorsBody')?.addEventListener('click',e=>this.handleConductorsClick(e));
    document.getElementById('closeToolsPanel')?.addEventListener('click',()=>this.closeToolsPanel());
    document.getElementById('toolsBody')?.addEventListener('click',e=>this.handleToolsClick(e));
    document.getElementById('closeResetPanel')?.addEventListener('click',()=>this.closeResetPanel());
    document.getElementById('resetBody')?.addEventListener('click',e=>this.handleResetClick(e));
    document.getElementById('closeSearchPanel')?.addEventListener('click',()=>this.closeAssetSearch());
    document.getElementById('runAssetSearchBtn')?.addEventListener('click',()=>this.runAssetSearch());
    document.getElementById('assetSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')this.runAssetSearch();});
    document.getElementById('closeStatusPanel')?.addEventListener('click',()=>{document.getElementById('statusPanel')?.classList.add('hidden');this.updatePanelScrollTopButton();});
    document.getElementById('dataCategoryTabs')?.addEventListener('click',e=>{const btn=e.target.closest?.('button[data-cat]'); if(btn)this.showDataPanel(btn.dataset.cat||'summary');});
    document.getElementById('statusBody')?.addEventListener('click',e=>this.handleDataViewClick(e));
    const cancelImportBtn=document.getElementById('cancelImportBtn');
    if(cancelImportBtn){
      const cancelNow=(e)=>{e?.preventDefault?.();e?.stopPropagation?.();ImportEngine.cancelImport?.();};
      cancelImportBtn.addEventListener('pointerdown',cancelNow,{passive:false});
      cancelImportBtn.addEventListener('touchstart',cancelNow,{passive:false});
      cancelImportBtn.addEventListener('click',cancelNow);
    }
    document.getElementById('dismissCrash')?.addEventListener('click',()=>document.getElementById('crashPanel')?.classList.add('hidden'));
    document.addEventListener('click',e=>{
      const connectedBtn=e.target.closest?.('.show-connected-circuits-btn');
      if(connectedBtn){
        // Popup button has its own inline handler. Do not fire it again here.
        e.preventDefault?.();
        e.stopPropagation?.();
        return;
      }
      const inRail=e.target.closest?.('.lean-left-rail,.plus-menu,.circuit-picker,.search-panel,.status-panel,.conductors-panel,.tools-panel,.reset-panel,.asset-layers-panel,.base-layers-panel,.leaflet-popup,.fmSWOverlay');
      if(!inRail)this.closePlusMenu();
    });
  },
  allCircuits(){
    const rows=[];
    const seen=new Set();
    const groups=Array.from(SearchEngine?.lineMap?.values?.()||[]);
    for(const g of groups){
      const line=SearchEngine.formatCircuitName?.(g.line)||g.line||'';
      if(!line)continue;
      if(SearchEngine.isDisplayableTransmissionCircuitLine&&!SearchEngine.isDisplayableTransmissionCircuitLine(line))continue;
      const key=SearchEngine.compact?.(line)||String(line).toUpperCase();
      if(seen.has(key))continue;
      seen.add(key);
      rows.push({line,validGps:Number(g.validGps||0),total:Array.isArray(g.assets)?g.assets.length:0,routeCount:Array.isArray(g.routeAssets)?g.routeAssets.length:0});
    }
    return rows.sort((a,b)=>a.line.localeCompare(b.line,undefined,{numeric:true,sensitivity:'base'}));
  },
  selectedCircuitList(){
    const rows=this.allCircuits();
    const valid=new Set(rows.map(r=>r.line));
    const cleaned=[];
    for(const line of this.selectedCircuits||[]){if(valid.has(line)&&!cleaned.includes(line))cleaned.push(line);}
    this.selectedCircuits=cleaned;
    if(cleaned.length)this.selectedCircuit=cleaned[0];
    return cleaned;
  },
  toggleCircuitSelection(line){
    if(!line)return;
    const arr=this.selectedCircuitList().slice();
    const i=arr.indexOf(line);
    if(i>=0)arr.splice(i,1); else arr.push(line);
    this.selectedCircuits=arr;
    this.selectedCircuit=arr[0]||line;
    this.renderCircuitList();
  },
  renderCircuitList(){
    const list=document.getElementById('circuitList'); if(!list)return;
    const rows=this.allCircuits();
    const label=document.getElementById('circuitCountLabel');
    if(!rows.length){if(label)label.textContent='0 circuits'; list.innerHTML='<div class="tiny-note">No transmission circuits loaded. Tap + then Import files.</div>'; this.selectedCircuit=''; this.selectedCircuits=[]; return;}
    if(this.selectedCircuit&&!rows.some(r=>r.line===this.selectedCircuit))this.selectedCircuit='';
    const selected=this.selectedCircuitList();
    if(label)label.textContent=`${rows.length.toLocaleString()} circuits · ${selected.length.toLocaleString()} selected`;
    list.innerHTML=rows.map(r=>{const checked=selected.includes(r.line); return `<button type="button" class="circuit-row multi ${checked?'selected':''}" data-line="${UI.esc(r.line)}"><span class="multi-check" aria-hidden="true">${checked?'☑':'☐'}</span><span class="circuit-row-main"><b>${UI.esc(r.line)}</b><span>${Number(r.validGps||0).toLocaleString()} mapped dots · ${Number(r.total||0).toLocaleString()} assets${r.routeCount?` · ${Number(r.routeCount).toLocaleString()} route sections`:''}</span></span></button>`;}).join('');
    list.querySelectorAll('.circuit-row').forEach(btn=>btn.addEventListener('click',()=>{this.toggleCircuitSelection(btn.dataset.line||''); setTimeout(()=>{try{btn.scrollIntoView({block:'nearest'});}catch(e){}},0);}));
  },
  openCircuitPicker(){this.renderCircuitList();document.getElementById('circuitPicker')?.classList.remove('hidden');document.getElementById('magnifyBtn')?.classList.add('active');this.closePlusMenu();this.closeAssetSearch();this.closeResetPanel();document.getElementById('statusPanel')?.classList.add('hidden');this.closeConductorsPanel();},
  closeCircuitPicker(){document.getElementById('circuitPicker')?.classList.add('hidden');document.getElementById('magnifyBtn')?.classList.remove('active');},
  resetCircuitPicker(){
    this.selectedCircuit='';
    this.selectedCircuits=[];
    try{MapEngine.clearDisplay?.(false);}catch(e){try{MapEngine.currentCircuit='';MapEngine.currentCircuits=[];}catch(_e){}}
    this.renderCircuitList();
    UI.refreshCounts?.();
    UI.toast('Circuit selection and map display reset.');
  },
  toggleCircuitPicker(){document.getElementById('circuitPicker')?.classList.contains('hidden')?this.openCircuitPicker():this.closeCircuitPicker();},
  async loadSelectedCircuit(){
    let lines=this.selectedCircuitList();
    if(!lines.length){UI.toast('No circuit selected. Tick a circuit first.');return;}
    this.closeCircuitPicker();
    const label=lines.length===1?lines[0]:`${lines.length} circuits`;
    UI.progress(true,'Loading circuit…',label,20);
    try{
      if(lines.length>1&&MapEngine.showCircuits)await MapEngine.showCircuits(lines);
      else await MapEngine.showCircuit(lines[0]);
    }
    catch(err){Diagnostics.capture(err); UI.toast('Circuit load failed.');}
    finally{UI.progress(false); UI.refreshCounts();}
  },
  togglePlusMenu(){const m=document.getElementById('plusMenu'); if(!m)return; m.classList.toggle('hidden'); document.getElementById('plusBtn')?.classList.toggle('active',!m.classList.contains('hidden')); if(!m.classList.contains('hidden')){this.updateReferenceToggleButtons();this.closeCircuitPicker();}},
  closePlusMenu(){document.getElementById('plusMenu')?.classList.add('hidden');document.getElementById('plusBtn')?.classList.remove('active');},
  openAssetSearch(){
    this.closePlusMenu();this.closeCircuitPicker();this.closeToolsPanel();this.closeResetPanel();this.closeConductorsPanel();document.getElementById('assetSearchPanel')?.classList.remove('hidden');document.getElementById('statusPanel')?.classList.add('hidden');setTimeout(()=>document.getElementById('assetSearchInput')?.focus(),30);},
  closeAssetSearch(){document.getElementById('assetSearchPanel')?.classList.add('hidden');},
  runAssetSearch(){
    const q=document.getElementById('assetSearchInput')?.value||'';
    const box=document.getElementById('assetSearchResults'); if(!box)return;
    const rows=SearchEngine.search(q,25,{scopeHint:{transmission:true,dxPoles:true,transformers:true,misc:true}});
    if(!q.trim()){box.innerHTML='<div class="tiny-note">Type a structure, circuit, substation, depot, transformer, or asset name.</div>';return;}
    if(!rows.length){box.innerHTML='<div class="tiny-note">No results.</div>';return;}
    box.innerHTML=rows.map((r,i)=>`<div class="result-card"><b>${UI.esc(r.title||r.line||'Result')}</b><span>${UI.esc(r.subtitle||r.kind||'')}</span><button type="button" data-i="${i}">Map</button></div>`).join('');
    box.querySelectorAll('button[data-i]').forEach(btn=>btn.addEventListener('click',async()=>{
      const r=rows[Number(btn.dataset.i)];
      this.closeAssetSearch();
      try{if(r.type==='circuit'||r.line)await MapEngine.showCircuit(r.line); else if(r.asset)MapEngine.showAsset(r.asset); UI.refreshCounts();}
      catch(err){Diagnostics.capture(err);UI.toast('Map result failed.');}
    }));
  },
  fmtBytes(v){
    const n=Number(v||0);
    if(!Number.isFinite(n)||n<=0)return '';
    if(n>=1024*1024*1024)return (n/(1024*1024*1024)).toFixed(2)+' GB';
    if(n>=1024*1024)return (n/(1024*1024)).toFixed(1)+' MB';
    if(n>=1024)return (n/1024).toFixed(1)+' KB';
    return Math.round(n)+' B';
  },
  fmtDate(v){
    if(!v)return '';
    const d=new Date(v);
    if(isNaN(d.getTime()))return String(v);
    return d.toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  },
  fileKindLabel(f={}){
    const name=String(f.name||'');
    const kind=(ImportEngine?.detectFieldMapBundleKind?ImportEngine.detectFieldMapBundleKind({name}):'other')||'other';
    const map={subreal:'depots / terminals',sub:'substations',pole:'poles',tower:'towers',nonwood:'non-wood poles',conductor:'conductors',other:'other'};
    if(f.dxPoleStorageKey||/dx|distribution|pole/i.test(name)&&!/transmission/i.test(name))return map[kind]||'distribution / other';
    return map[kind]||kind;
  },
  countsBy(arr,fn){
    const map=new Map();
    for(const item of arr||[]){const k=String(fn(item)||'Other'); map.set(k,(map.get(k)||0)+1);}
    return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  },
  fileCardsHtml(){
    const files=Array.isArray(App.files)?App.files:[];
    if(!files.length)return '<div class="empty-card"><b>No imported files saved</b><span>Tap + → Import files. This page will then show every imported file and what category it landed in.</span></div>';
    const limit=Math.max(10,Number(this.fileListLimit||30));
    const shown=files.slice(0,limit);
    const cards=shown.map((f,i)=>{
      const count=Number(f.count||f.totalImported||f.dxPoleCount||0);
      const size=this.fmtBytes(f.size||f.fileSize||0);
      const bits=[this.fileKindLabel(f), count?`${count.toLocaleString()} records`:'records saved', size, f.storageMode, f.indexStatus||f.status].filter(Boolean).join(' · ');
      const dropped=Number(f.rawFieldsDropped||0);
      const name=String(f.name||'Imported file');
      return `<div class="data-card file-card"><div class="card-top"><b>${i+1}. ${UI.esc(name)}</b><span>${UI.esc(this.fmtDate(f.importedAt||f.createdAt||f.savedAt))}</span></div><p>${UI.esc(bits)}</p>${dropped?`<small>${dropped.toLocaleString()} unused raw fields trimmed from storage. Search/display fields kept.</small>`:''}<div class="file-actions"><button type="button" data-delete-file="${UI.esc(name)}">Delete this imported file</button></div></div>`;
    }).join('');
    const more=files.length>shown.length?`<button type="button" class="data-safe-btn load-more-btn" data-file-more="1">Show 30 more files (${shown.length.toLocaleString()} / ${files.length.toLocaleString()})</button>`:'';
    return cards+more;
  },
  renderDataTabs(){
    if(this.dataCategory==='assets')this.dataCategory='summary';
    document.querySelectorAll('#dataCategoryTabs button[data-cat]').forEach(btn=>btn.classList.toggle('active',btn.dataset.cat===this.dataCategory));
  },
  showDataPanel(cat='summary'){
    this.dataCategory=(cat==='assets'?'summary':(cat||'summary'));
    this.closePlusMenu();
    this.closeCircuitPicker();
    this.closeAssetSearch();
    this.closeToolsPanel();
    this.closeConductorsPanel();
    document.getElementById('statusPanel')?.classList.remove('hidden');
    const body=document.getElementById('statusBody');
    if(body)body.innerHTML='<div class="empty-card"><b>Loading</b><span>Preparing this page only. Heavy lists stay unloaded until opened.</span></div>';
    this.renderDataTabs();
    const el=this.panelScrollElement(); if(el)el.scrollTop=0;
    this.updatePanelScrollTopButton();
    const token=++this.renderToken;
    setTimeout(()=>{if(token===this.renderToken)this.renderDataPanel();},0);
  },
  async handleDataViewClick(e){
    const section=e.target.closest?.('button[data-section-key]');
    if(section){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const key=section.dataset.sectionKey||'';this.dataSectionOpen[key]=!this.dataSectionOpen[key];this.renderDataPanel(true);return;}
    const clearMap=e.target.closest?.('button[data-clear-display-map]');
    if(clearMap){MapEngine.clearDisplay();UI.refreshCounts();this.renderDataPanel();UI.toast('Displayed map cleared. Imported data kept.');return;}
    const importFiles=e.target.closest?.('button[data-import-files]');
    if(importFiles){e.preventDefault();document.getElementById('fileInput')?.click();return;}
    const installApp=e.target.closest?.('button[data-install-app]');
    if(installApp){e.preventDefault();window.MyMapPwaInstall?.install?.();return;}
    const del=e.target.closest?.('button[data-delete-file]');
    if(del){await this.deleteImportedFileFromManager(del.dataset.deleteFile||'');return;}
    const sub=e.target.closest?.('button[data-conductor-subcat]');
    if(sub){e.preventDefault();this.conductorSubCategory=sub.dataset.conductorSubcat||'top';this.expandedConductorRows={};this.conductorAllLimit=50;this.renderDataPanel(true);return;}
    const fileMore=e.target.closest?.('button[data-file-more]');
    if(fileMore){e.preventDefault();this.fileListLimit+=30;this.renderDataPanel(true);return;}
    const localSaveAs=e.target.closest?.('button[data-local-save-as]');
    if(localSaveAs){e.preventDefault();await MapEngine?.saveSavedPinDropsAs?.();this.renderDataPanel(true);return;}
    const localExportPins=e.target.closest?.('button[data-local-export-pins]');
    if(localExportPins){e.preventDefault();MapEngine?.exportSavedPinDrops?.();this.renderDataPanel(true);return;}
    const localShowPins=e.target.closest?.('button[data-local-show-pins]');
    if(localShowPins){e.preventDefault();MapEngine?.showSavedPinDrops?.();this.renderDataPanel(true);return;}
    const localHidePins=e.target.closest?.('button[data-local-hide-pins]');
    if(localHidePins){e.preventDefault();MapEngine?.hideSavedPinDrops?.();this.renderDataPanel(true);return;}
    const localClearPins=e.target.closest?.('button[data-local-clear-pins]');
    if(localClearPins){e.preventDefault();MapEngine?.clearSavedPinDrops?.();this.renderDataPanel(true);return;}
    const conductorMore=e.target.closest?.('button[data-conductor-more]');
    if(conductorMore){e.preventDefault();this.conductorAllLimit+=50;this.renderDataPanel(true);return;}
    const weightMore=e.target.closest?.('button[data-weight-more]');
    if(weightMore){e.preventDefault();this.weightTestLimit+=8;this.renderDataPanel(true);return;}
    const row=e.target.closest?.('button[data-cond-key]');
    if(row){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const k=row.dataset.condKey||'';this.expandedConductorRows[k]=!this.expandedConductorRows[k];this.renderDataPanel(true);return;}
    const map=e.target.closest?.('button[data-map-line]');
    if(map){const line=map.dataset.mapLine||''; if(line){document.getElementById('statusPanel')?.classList.add('hidden'); UI.progress(true,'Loading circuit…',line,20); try{await MapEngine.showCircuit(line); UI.refreshCounts();}catch(err){Diagnostics.capture(err);UI.toast('Circuit load failed.');}finally{UI.progress(false);}} return;}
  },


  openConductorsPanel(mode='circuit',preserveScroll=false){
    const nextMode=mode||this.conductorPanelMode||'circuit';
    if(nextMode!==this.conductorPanelMode)this.conductorPage=1;
    if(!preserveScroll){this.conductorMaterialFilter='';this.conductorTypeFilter='';this.conductorNameFilter='';this.expandedConductorRows={};this.conductorPage=1;this.conductorNamePage=1;}
    this.conductorPanelMode=nextMode;
    this.closePlusMenu();
    this.closeCircuitPicker();
    this.closeAssetSearch();
    this.closeToolsPanel();
    this.closeResetPanel();
    document.getElementById('statusPanel')?.classList.add('hidden');
    document.getElementById('conductorsPanel')?.classList.remove('hidden');
    this.renderConductorsPanel(preserveScroll);
    setTimeout(()=>this.updateConductorScrollTopButton(),0);
  },
  closeConductorsPanel(){
    document.getElementById('conductorsPanel')?.classList.add('hidden');
    this.updateConductorScrollTopButton();
  },
  renderConductorsTabs(){
    document.querySelectorAll('#conductorCategoryTabs button[data-cond-panel]').forEach(btn=>btn.classList.toggle('active',btn.dataset.condPanel===this.conductorPanelMode));
    document.getElementById('conductorWeightHeaderBtn')?.classList.toggle('active',this.conductorPanelMode==='weight');
  },
  conductorDefinitions(){
    return {
      'AAC':'All Aluminium Conductor: all strands are aluminium; common overhead phase conductor.',
      'AAAC/1120':'All Aluminium Alloy Conductor: aluminium alloy strands; stronger than AAC for similar size.',
      'ACSR/GZ':'Aluminium Conductor Steel Reinforced with galvanised steel core: aluminium outer strands carry current, steel core adds strength.',
      'ACSR/AC':'Aluminium Conductor Steel Reinforced with aluminium-clad steel core: ACSR with aluminium-clad steel for corrosion performance.',
      'ACSR/AZ':'Aluminium Conductor Steel Reinforced with aluminium-zinc/alloy-coated steel core: ACSR variant with coated steel core.',
      'Copper':'Copper conductor. HDC/old copper labels are grouped and shown simply as Copper for easier viewing.',
      'SC/GZ':'Galvanised steel earth conductor: steel conductor used mainly as overhead earth conductor/shield wire.',
      'SC/AC':'Aluminium-clad steel earth conductor: steel earth conductor/shield wire with aluminium cladding.',
      'OPGW':'Optical Ground Wire: earth conductor/shield wire containing fibre optic cable; exact model needed for weight.',
      'Manual/unknown':'No trusted property row loaded. The app will not auto-calculate weight.'
    };
  },
  materialDefinitions(){
    return {
      'Copper':'Copper conductors. HDC/old copper labels are shown as Copper. A row only appears here when the conductor JSON explicitly says copper.',
      'Aluminium':'All-aluminium conductor such as AAC. Not copper and not alloy unless the source says so.',
      'Aluminium Alloy':'Aluminium-alloy conductor such as AAAC/1120 or HTLS alloy labels such as XTACIR.',
      'Aluminium family':'Aluminium family row where the JSON confirms aluminium but does not safely separate AAC from AAAC.',
      'ACSR/Reinforced':'Reinforced aluminium conductor such as ACSR, ACSR/GZ, ACSR/AC, ACSR/AZ, DR-HAL or similar reinforced labels.',
      'Earth / OPGW':'Earth conductor/shield wire and optical ground wire categories.',
      'Unknown':'Unknown from label alone. No copper/aluminium guess and no automatic weight unless a verified kg/m row is loaded.'
    };
  },
  conductorMaterialGroup(value='', type=''){
    const raw=String(value||'').replace(/\s+/g,' ').trim();
    const t=String((raw||type)||'').toUpperCase();
    if(raw&&['Copper','Aluminium','Aluminium Alloy','Aluminium family','ACSR/Reinforced','Earth / OPGW','Unknown'].includes(raw))return raw;
    if(/OPGW|EARTH|SC\/GZ|SC\/AC/.test(t))return 'Earth / OPGW';
    if(/HDC|COPPER/.test(t))return 'Copper';
    if(/DR\s*-?\s*HAL|ACSR|REINFORCED/.test(t))return 'ACSR/Reinforced';
    if(/XTACIR|TACIR|INVAR|HTLS|AAAC|1120/.test(t))return 'Aluminium Alloy';
    if(/\bAAC\b/.test(t))return 'Aluminium';
    return 'Unknown';
  },
  conductorMaterial(label='', fallbackType=''){
    const spec=this.conductorSpec(label);
    return this.conductorMaterialGroup(spec?.materialCategory||'', spec?.type||fallbackType||'');
  },
  conductorMaterialCounts(groups=[]){
    const map=new Map();
    for(const g of groups||[]){
      const mat=this.conductorMaterialGroup(g.materialCategory||'', g.type||'');
      if(!map.has(mat))map.set(mat,{type:mat,count:0,sections:0,groups:[]});
      const row=map.get(mat); row.count++; row.sections+=Number(g.count||0); row.groups.push(g);
    }
    return Array.from(map.values()).sort((a,b)=>{
      const order=['Copper','Aluminium','Aluminium Alloy','Aluminium family','ACSR/Reinforced','Earth / OPGW','Unknown'];
      return (order.indexOf(a.type)>=0?order.indexOf(a.type):99)-(order.indexOf(b.type)>=0?order.indexOf(b.type):99)||b.sections-a.sections||a.type.localeCompare(b.type);
    });
  },
  renderConductorInlineDetail(selected, defs={}, mode='type'){
    if(!selected)return '';
    const rows=(selected.groups||[]).slice().sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
    const list=this.renderConductorRows(rows,mode);
    return `<div class="type-inline-detail inline-only"><div class="inline-section">${list}</div></div>`;
  },
  renderConductorMaterialBrowser(groups=[]){
    const defs=this.materialDefinitions();
    const types=this.conductorMaterialCounts(groups);
    if(!types.length)return '<div class="empty-card"><b>No conductor reference loaded</b><span>Tap Import in the Conductors title and select the separate myMap conductor JSON file.</span></div>';
    if(this.conductorMaterialFilter&&!types.some(t=>t.type===this.conductorMaterialFilter))this.conductorMaterialFilter='';
    const cards=`<div class="conductor-type-grid">${types.map(t=>{const active=t.type===this.conductorMaterialFilter;return `<button type="button" class="type-chip ${active?'active':''}" data-cond-material="${UI.esc(t.type)}"><b>${UI.esc(t.type)}</b><span>${t.count.toLocaleString()} conductor${t.count===1?'':'s'} · ${t.sections.toLocaleString()} sections</span></button>${active?this.renderConductorInlineDetail(t,defs,'material'):''}`;}).join('')}</div>`;
    return cards;
  },
  conductorTypeGroup(type=''){
    const t=String(type||'').toUpperCase().replace(/\s+/g,' ').trim();
    if(!t)return 'Manual/unknown';
    if(t.includes('OPGW'))return 'OPGW';
    if(t.includes('SC/GZ'))return 'SC/GZ';
    if(t.includes('SC/AC'))return 'SC/AC';
    if(t.includes('HDC')||t.includes('COPPER')||t==='CU')return 'Copper';
    if(t.includes('ACSR/AZ'))return 'ACSR/AZ';
    if(t.includes('ACSR/AC'))return 'ACSR/AC';
    if(t.includes('ACSR/GZ'))return 'ACSR/GZ';
    if(t.includes('ACSR'))return 'ACSR/GZ';
    if(t.includes('AAAC')||t.includes('1120'))return 'AAAC/1120';
    if(/\bAAC\b/.test(t))return 'AAC';
    if(t.includes('EARTH'))return 'Manual/unknown';
    return type || 'Manual/unknown';
  },
  conductorTypeCounts(groups=[]){
    const map=new Map();
    for(const g of groups||[]){
      const type=this.conductorTypeGroup(g.type||'');
      if(!map.has(type))map.set(type,{type,count:0,sections:0,groups:[]});
      const row=map.get(type); row.count++; row.sections+=Number(g.count||0); row.groups.push(g);
    }
    return Array.from(map.values()).sort((a,b)=>{
      const order=['Copper','ACSR/GZ','AAC','AAAC/1120','ACSR/AC','ACSR/AZ','SC/GZ','SC/AC','OPGW','Manual/unknown'];
      const ia=order.indexOf(a.type), ib=order.indexOf(b.type);
      if(ia>=0||ib>=0)return (ia>=0?ia:99)-(ib>=0?ib:99);
      return b.sections-a.sections||a.type.localeCompare(b.type);
    });
  },
  renderConductorTypeBrowser(groups=[]){
    const defs=this.conductorDefinitions();
    const types=this.conductorTypeCounts(groups);
    if(!types.length)return '<div class="empty-card"><b>No conductor reference loaded</b><span>Tap Import in the Conductors title and select the separate myMap conductor JSON file.</span></div>';
    if(this.conductorTypeFilter&&!types.some(t=>t.type===this.conductorTypeFilter))this.conductorTypeFilter='';
    const cards=`<div class="conductor-type-grid">${types.map(t=>{const active=t.type===this.conductorTypeFilter;return `<button type="button" class="type-chip ${active?'active':''}" data-cond-type="${UI.esc(t.type)}"><b>${UI.esc(t.type)}</b><span>${t.count.toLocaleString()} conductor${t.count===1?'':'s'} · ${t.sections.toLocaleString()} sections</span></button>${active?this.renderConductorInlineDetail(t,defs,'type'):''}`;}).join('')}</div>`;
    return cards;
  },
  renderConductorNameInlineDetail(selected){
    if(!selected)return '';
    const rows=(selected.groups||[]).slice().sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
    return `<div class="type-inline-detail name-inline-detail"><div class="data-section inline-section"><b>${UI.esc(selected.name)}</b>${this.renderConductorRows(rows,'name')}</div></div>`;
  },
  renderConductorNameBrowser(groups=[]){
    const names=this.conductorNameGroups(groups);
    if(!names.length)return '<div class="empty-card"><b>No conductor reference loaded</b><span>Tap Import in the Conductors title and select the separate myMap conductor JSON file.</span></div>';
    if(this.conductorNameFilter&&!names.some(n=>n.key===this.conductorNameFilter))this.conductorNameFilter='';
    const cards=`<div class="conductor-type-grid conductor-name-grid conductor-name-scroll">${names.map(n=>{const active=n.key===this.conductorNameFilter;return `<button type="button" class="type-chip conductor-name-chip ${active?'active':''}" data-cond-name="${UI.esc(n.key)}"><b>${UI.esc(n.name)}</b><span>${n.count.toLocaleString()} entr${n.count===1?'y':'ies'} · ${n.sections.toLocaleString()} sections</span></button>${active?this.renderConductorNameInlineDetail(n):''}`;}).join('')}</div>`;
    return cards;
  },
  conductorCircuitGroups(){
    try{if(SearchEngine?.linkConductorSections)SearchEngine.linkConductorSections(App.assets||[]);}catch(e){}
    const sections=Array.isArray(SearchEngine.conductorSections)?SearchEngine.conductorSections:[];
    const lineMap=new Map();
    const add=(sec={})=>{
      const line=SearchEngine?.formatCircuitName?SearchEngine.formatCircuitName(sec.line||''):String(sec.line||'');
      if(!line)return;
      const lineKey=SearchEngine?.compact?SearchEngine.compact(line):line.toUpperCase();
      if(!lineMap.has(lineKey))lineMap.set(lineKey,{key:lineKey,line,count:0,conductors:new Map(),earth:new Map()});
      const row=lineMap.get(lineKey); row.count++;
      const label=this.conductorPrimaryLabel(sec);
      const ckey=SearchEngine?.compact?SearchEngine.compact(label):label.toUpperCase();
      if(!row.conductors.has(ckey))row.conductors.set(ckey,{key:ckey,label,displayLabel:this.conductorDisplayLabel(label),type:String(sec.conductorType||this.conductorType(label)||''),count:0,ranges:[],earth:new Map()});
      const cg=row.conductors.get(ckey); cg.count++;
      const from=sec.fromPole||sec.first||sec.from||'?';
      const to=sec.toPole||sec.last||sec.to||'?';
      const len=Number(sec.lenKm??sec.lengthKm??sec.len_km??0);
      const qty=sec.qtyPerPhase??sec.qty??sec.qty_per_phase??'';
      const range=`${from} → ${to}${Number.isFinite(len)&&len>0?` · ${len.toFixed(3)} km`:''}${qty?` · ${qty}/phase`:''}`;
      cg.ranges.push(range);
      const addEarth=(label,type)=>{
        label=this.cleanConductorLabel(label||'');
        if(!label||/^unknown/i.test(label))return;
        const ek=SearchEngine?.compact?SearchEngine.compact(label):label.toUpperCase();
        if(!cg.earth.has(ek))cg.earth.set(ek,{label,type:String(type||''),count:0,ranges:[]});
        const ce=cg.earth.get(ek); ce.count++; ce.ranges.push(range);
        if(!row.earth.has(ek))row.earth.set(ek,{label,type:String(type||''),count:0,ranges:[]});
        const re=row.earth.get(ek); re.count++; re.ranges.push(range);
      };
      addEarth(sec.earth1,sec.earth1Type); addEarth(sec.earth2,sec.earth2Type);
    };
    for(const sec of sections)add(sec);
    return Array.from(lineMap.values()).sort((a,b)=>a.line.localeCompare(b.line,undefined,{numeric:true,sensitivity:'base'}));
  },
  renderConductorCircuitBrowser(){
    const rows=this.conductorCircuitGroups();
    if(!rows.length)return '<div class="empty-card"><b>No circuit conductor data</b><span>Import conductor JSON from the Conductors title, then import circuit/asset files.</span></div>';
    return `<div class="conductor-circuit-browser">${rows.map(r=>{
      const key=`circuit_${r.key}`;
      const open=!!this.expandedConductorRows[key];
      const conductors=Array.from(r.conductors.values()).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
      const earthRows=Array.from((r.earth||new Map()).values()).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
      const summary=`${conductors.length.toLocaleString()} conductor${conductors.length===1?'':'s'} · ${r.count.toLocaleString()} span section${r.count===1?'':'s'}${earthRows.length?` · ${earthRows.length} earth conductor${earthRows.length===1?'':'s'}`:''}`;
      const earthField=earthRows.length?`<div class="circuit-earth-card"><b>Earth conductor</b>${earthRows.map(e=>{const seen=[]; for(const x of e.ranges||[]){if(!seen.includes(x))seen.push(x); if(seen.length>=80)break;} const more=(e.ranges||[]).length>seen.length?`<div class="tiny-note">+ ${(e.ranges||[]).length-seen.length} more spans on this earth conductor</div>`:''; return `<div class="earth-wire-row"><strong>${UI.esc(e.label)}</strong>${e.type?`<span>${UI.esc(e.type)}</span>`:''}<small>${Number(e.count||0).toLocaleString()} section${Number(e.count||0)===1?'':'s'}</small>${seen.length?`<div class="bay-scroll earth-bays">${seen.map(x=>`<div>${UI.esc(x)}</div>`).join('')}${more}</div>`:''}</div>`;}).join('')}</div>`:'';
      const phaseField=conductors.length?`<div class="circuit-phase-card"><b>Phase conductor</b><span>${conductors.length.toLocaleString()} conductor${conductors.length===1?'':'s'} on this circuit</span></div>`:'';
      const drop=open?`<div class="conductor-circuit-drop"><div class="action-row slim"><button class="conductor-map-btn" type="button" data-map-line="${UI.esc(r.line)}">Map circuit</button></div>${phaseField}${conductors.map(c=>{
        const spec=this.conductorSpec(c.label);
        const weight=spec?.kgPerM?`${Number(spec.kgPerM).toFixed(3)} kg/m`:'';
        const size=this.conductorFieldChartSize(spec); const die=this.conductorFieldChartDie(spec);
        const props=[this.conductorTypeGroup(c.type||spec?.type||''), this.conductorMaterial(c.label,c.type||''), size?`${size} mm`:'', die?`Die ${die}`:'', weight].filter(Boolean).join(' · ');
        const earth=Array.from(c.earth.values()).map(e=>`${e.label}${e.type?` (${e.type})`:''}`).join(', ');
        const shown=c.ranges.slice(0,80); const more=c.ranges.length>shown.length?`<div class="tiny-note">+ ${c.ranges.length-shown.length} more spans on this conductor</div>`:'';
        return `<div class="circuit-conductor-card"><b>${UI.esc(c.displayLabel||this.conductorDisplayLabel(c.label))}</b>${props?`<span>${UI.esc(props)}</span>`:''}<div class="bay-title">Bays / spans using this conductor</div><div class="bay-scroll">${shown.map(x=>`<div>${UI.esc(x)}</div>`).join('')}${more}</div>${earth?`<small>Earth conductor/shield on same sections: ${UI.esc(earth)}</small>`:''}</div>`;
      }).join('')}</div>`:'';
      return `<div class="conductor-circuit-row-wrap"><button type="button" class="conductor-circuit-main ${open?'active':''}" data-cond-circuit="${UI.esc(key)}"><b>${UI.esc(r.line)}</b><span><em class="pm-mini">${open?'−':'+'}</em> ${UI.esc(summary)}</span></button>${drop}</div>`;
    }).join('')}</div>`;
  },
  renderConductorsPanel(preserveScroll=false){
    const body=document.getElementById('conductorsBody'); if(!body)return;
    const wrap=document.querySelector('#conductorsPanel .conductors-body');
    const innerNameScroll=document.querySelector('#conductorsBody .conductor-name-scroll');
    const keep=preserveScroll&&wrap?wrap.scrollTop:0;
    const keepName=preserveScroll&&innerNameScroll?innerNameScroll.scrollTop:null;
    const anchor=this._conductorScrollAnchor||null;
    this._conductorScrollAnchor=null;
    const restore=()=>{
      if(preserveScroll&&wrap)wrap.scrollTop=keep;
      const nextNameScroll=document.querySelector('#conductorsBody .conductor-name-scroll');
      if(preserveScroll&&nextNameScroll&&keepName!==null)nextNameScroll.scrollTop=keepName;
      if(anchor){
        try{
          let el=null;
          if(anchor.name!==undefined){
            el=Array.from(document.querySelectorAll('button[data-cond-name]')).find(b=>b.dataset.condName===anchor.name)||null;
          }else if(anchor.selector){
            el=document.querySelector(anchor.selector);
          }
          const scroller=el?.closest?.('.conductor-name-scroll')||wrap;
          if(el&&scroller&&Number.isFinite(anchor.top)){
            const delta=el.getBoundingClientRect().top-anchor.top;
            scroller.scrollTop+=delta;
          }
        }catch(_e){}
      }
    };
    setTimeout(()=>{restore(); this.updateConductorScrollTopButton(); if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{restore(); this.updateConductorScrollTopButton();});},0);
    this.renderConductorsTabs();
    try{if(SearchEngine?.linkConductorSections)SearchEngine.linkConductorSections(App.assets||[]);}catch(e){}
    const conductorSections=Array.isArray(SearchEngine.conductorSections)?SearchEngine.conductorSections:[];
    const bundled=Array.isArray(window.FieldMapConductorSections)?window.FieldMapConductorSections.length:0;
    const specCount=window.FieldMapSpanWeightCalculator?.specs?Object.keys(window.FieldMapSpanWeightCalculator.specs).length:0;
    const stats=this.fastStats();
    const mode=this.conductorPanelMode||'circuit';
    const sub={circuit:'By circuit',name:'By name',material:'By material',type:'By type',weight:'Weight test'}[mode]||'Conductors';
    const subEl=document.getElementById('conductorsSubtitle'); if(subEl)subEl.textContent=sub;
    if(mode==='weight'){body.innerHTML=this.renderWeightTestPanel();return;}
    if(mode==='circuit'){body.innerHTML=this.renderConductorCircuitBrowser();return;}
    const groups=this.conductorGroups();
    if(mode==='material'){body.innerHTML=this.renderConductorMaterialBrowser(groups);return;}
    if(mode==='name'){body.innerHTML=this.renderConductorNameBrowser(groups);return;}
    body.innerHTML=this.renderConductorTypeBrowser(groups);
  },
  async handleConductorsClick(e){
    const importJson=e.target.closest?.('button[data-import-conductor-json]');
    if(importJson){e.preventDefault();document.getElementById('conductorJsonInput')?.click();return;}
    const section=e.target.closest?.('button[data-section-key]');
    if(section){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const key=section.dataset.sectionKey||'';this.dataSectionOpen[key]=!this.dataSectionOpen[key];this.renderConductorsPanel(true);return;}
    const material=e.target.closest?.('button[data-cond-material]');
    if(material){e.preventDefault();const val=material.dataset.condMaterial||'';this.conductorMaterialFilter=(this.conductorMaterialFilter===val)?'':val;this.expandedConductorRows={};this.conductorTypeListLimit=50;this.conductorPage=1;this.renderConductorsPanel(true);return;}
    const type=e.target.closest?.('button[data-cond-type]');
    if(type){e.preventDefault();const val=type.dataset.condType||'';this.conductorTypeFilter=(this.conductorTypeFilter===val)?'':val;this.expandedConductorRows={};this.conductorTypeListLimit=50;this.conductorPage=1;this.renderConductorsPanel(true);return;}
    const nameBtn=e.target.closest?.('button[data-cond-name]');
    if(nameBtn){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const val=nameBtn.dataset.condName||'';const top=nameBtn.getBoundingClientRect().top;this._conductorScrollAnchor={name:val,top};this.conductorNameFilter=(this.conductorNameFilter===val)?'':val;this.expandedConductorRows={};this.conductorPage=1;this.renderConductorsPanel(true);return;}
    const sub=e.target.closest?.('button[data-conductor-subcat]');
    if(sub){e.preventDefault();this.conductorPanelMode='circuit';this.expandedConductorRows={};this.conductorPage=1;this.renderConductorsPanel(true);return;}
    const circuitRow=e.target.closest?.('button[data-cond-circuit]');
    if(circuitRow){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const k=circuitRow.dataset.condCircuit||'';this.expandedConductorRows[k]=!this.expandedConductorRows[k];this.renderConductorsPanel(true);return;}
    const namePageBtn=e.target.closest?.('button[data-cond-name-page]');
    if(namePageBtn){e.preventDefault();const p=Number(namePageBtn.dataset.condNamePage||1);if(Number.isFinite(p)&&p>0){this.conductorNamePage=Math.floor(p);this.expandedConductorRows={};this.renderConductorsPanel(true);}return;}
    const pageBtn=e.target.closest?.('button[data-cond-page]');
    if(pageBtn){e.preventDefault();const p=Number(pageBtn.dataset.condPage||1);if(Number.isFinite(p)&&p>0){this.conductorPage=Math.floor(p);this.renderConductorsPanel(true);}return;}
    const localSaveAs=e.target.closest?.('button[data-local-save-as]');
    if(localSaveAs){e.preventDefault();await MapEngine?.saveSavedPinDropsAs?.();this.renderDataPanel(true);return;}
    const localExportPins=e.target.closest?.('button[data-local-export-pins]');
    if(localExportPins){e.preventDefault();MapEngine?.exportSavedPinDrops?.();this.renderDataPanel(true);return;}
    const localShowPins=e.target.closest?.('button[data-local-show-pins]');
    if(localShowPins){e.preventDefault();MapEngine?.showSavedPinDrops?.();this.renderDataPanel(true);return;}
    const localHidePins=e.target.closest?.('button[data-local-hide-pins]');
    if(localHidePins){e.preventDefault();MapEngine?.hideSavedPinDrops?.();this.renderDataPanel(true);return;}
    const localClearPins=e.target.closest?.('button[data-local-clear-pins]');
    if(localClearPins){e.preventDefault();MapEngine?.clearSavedPinDrops?.();this.renderDataPanel(true);return;}
    const conductorMore=e.target.closest?.('button[data-conductor-more]');
    if(conductorMore){e.preventDefault();this.conductorPage+=1;this.renderConductorsPanel(true);return;}
    const weightMore=e.target.closest?.('button[data-weight-more]');
    if(weightMore){e.preventDefault();this.weightTestLimit+=8;this.renderConductorsPanel(true);return;}
    const row=e.target.closest?.('button[data-cond-key]');
    if(row){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const k=row.dataset.condKey||'';this.expandedConductorRows[k]=!this.expandedConductorRows[k];this.renderConductorsPanel(true);return;}
    const map=e.target.closest?.('button[data-map-line]');
    if(map){const line=map.dataset.mapLine||''; if(line){this.closeConductorsPanel(); UI.progress(true,'Loading circuit…',line,20); try{await MapEngine.showCircuit(line); UI.refreshCounts();}catch(err){Diagnostics.capture(err);UI.toast('Circuit load failed.');}finally{UI.progress(false);}} return;}
  },


  async importConductorJson(file){
    if(!file)return;
    try{
      UI.progress(true,'Loading conductor JSON…',file.name||'conductor reference',10);
      const data=await window.FieldMapConductorDataLoader.importFile(file);
      try{if(SearchEngine.rebuildAsync)await SearchEngine.rebuildAsync('Conductor reference loaded'); else SearchEngine.rebuild();}catch(e){}
      this.conductorGroupCache=null;this.statsCache=null;this.expandedConductorRows={};this.conductorNameFilter='';this.conductorNamePage=1;
      UI.progress(false);
      UI.refreshAll();
      this.renderConductorsPanel(true);
      UI.toast(`Loaded conductor JSON: ${Object.keys(data?.specs||{}).length.toLocaleString()} spec rows.`);
    }catch(err){UI.progress(false);Diagnostics.capture(err);UI.toast(err?.message||'Conductor JSON import failed.');}
    finally{const input=document.getElementById('conductorJsonInput'); if(input)input.value='';}
  },

  openToolsPanel(){
    this.closePlusMenu();
    this.closeCircuitPicker();
    this.closeAssetSearch();
    document.getElementById('statusPanel')?.classList.add('hidden');
    this.closeConductorsPanel();
    this.closeResetPanel();
    this.toolsSectionOpen={};
    document.getElementById('toolsPanel')?.classList.remove('hidden');
    this.renderToolsPanel();
  },
  closeToolsPanel(){
    document.getElementById('toolsPanel')?.classList.add('hidden');
  },
  openResetPanel(){
    this.closePlusMenu();
    this.closeCircuitPicker();
    this.closeAssetSearch();
    this.closeToolsPanel();
    this.closeConductorsPanel();
    document.getElementById('statusPanel')?.classList.add('hidden');
    document.getElementById('resetPanel')?.classList.remove('hidden');
    this.renderResetPanel();
  },
  closeResetPanel(){
    document.getElementById('resetPanel')?.classList.add('hidden');
  },
  renderResetPanel(){
    const body=document.getElementById('resetBody'); if(!body)return;
    body.innerHTML=`<div class="data-card"><b>Cache / Reset</b><p>Clear app cache keeps imported data. Full reset deletes every imported file, saved pin, loaded conductor reference, local database record, cache and displayed map dot.</p></div><div class="data-action-grid"><button type="button" class="data-safe-btn" data-clear-cache="1">Clear app cache only</button><button type="button" class="data-danger-btn" data-reset-app="1">Full reset / delete everything</button></div>`;
  },
  async handleResetClick(e){
    const cache=e.target.closest?.('button[data-clear-cache]');
    if(cache){e.preventDefault();await this.clearAppCache();this.renderResetPanel();return;}
    const reset=e.target.closest?.('button[data-reset-app]');
    if(reset){e.preventDefault();await this.resetApp();return;}
  },
  renderToolsPanel(preserveScroll=false){
    const body=document.getElementById('toolsBody'); if(!body)return;
    const wrap=document.querySelector('#toolsPanel .tools-body');
    const keep=preserveScroll&&wrap?wrap.scrollTop:0;
    const xs=HVCrossingsLayer?.stats?.()||{total:0,hv:0,tx:0,active:0,line:''};
    const line=HVCrossingsLayer?.currentLineLabel?.()||MapEngine?.currentCircuit||'';
    const profile=MapEngine?.gpsProfile||'walking';
    const refsMode=String(MapEngine?.currentDisplay||'').toLowerCase();
    const referenceTools=`<div class="data-card"><b>Reference points</b><p>Show or hide depot and substation reference points without cluttering the main + menu.</p></div><div class="data-action-grid single"><button type="button" class="data-safe-btn ${refsMode==='all substations'?'active':''}" data-tools-reference-kind="substation">${refsMode==='all substations'?'Hide All Substations':'Show All Substations'}</button><button type="button" class="data-safe-btn ${refsMode==='all depots'?'active':''}" data-tools-reference-kind="depot">${refsMode==='all depots'?'Hide All Depots':'Show All Depots'}</button></div>`;
    const gpsTools=`<div class="data-card"><b>GPS / Patrol mode</b><p>Select how the live GPS panel behaves. Heli mode keeps the map calmer, shows speed in km/h and knots, and keeps nearest/next structure details visible.</p><small>Uses the phone GPS. No separate GPS hardware required.</small></div><div class="gps-tools-grid"><button type="button" class="data-safe-btn ${profile==='walking'?'active':''}" data-tools-gps-profile="walking">Walking</button><button type="button" class="data-safe-btn ${profile==='driving'?'active':''}" data-tools-gps-profile="driving">Driving</button><button type="button" class="data-safe-btn ${profile==='helicopter'?'active':''}" data-tools-gps-profile="helicopter">Helicopter</button></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-start-gps="1">Start / show GPS panel</button><button type="button" class="data-safe-btn" data-tools-stop-follow="1">Stop follow only</button></div>`;
    const measureTools=`<div class="data-card"><b>Measure Distance</b><p>Tap Measure Distance to open the overlay. Tap multiple points on the map. It snaps to nearby visible asset dots and keeps a running total.</p><small>Status: ${UI.esc(MapEngine?.measureStatusLabel?.()||'off')}</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn ${MapEngine?.measureMode?'active':''}" data-tools-measure-start="1">Measure Distance</button><button type="button" class="data-safe-btn" data-tools-measure-clear="1">Clear measure</button></div>`;
    const pinTools=`<div class="data-card"><b>Pin drops</b><p>Hold the map for 2 seconds to drop a pin. Save it with comments, nearest address, nearest circuits, date/time and map links.</p><small>Status: ${UI.esc(MapEngine?.pinDropStatusLabel?.()||'none saved')}</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-pins-show="1">Show saved pins</button><button type="button" class="data-safe-btn" data-tools-pins-hide="1">Hide saved pins</button><button type="button" class="data-safe-btn" data-tools-pins-export="1">Export saved pins</button><button type="button" class="data-danger-btn" data-tools-pins-clear="1">Clear saved pins</button></div>`;
    const crossingTools=`<div class="data-card"><b>HV / TX crossings</b><p>${Number(xs.total||0).toLocaleString()} imported · ${Number(xs.active||0).toLocaleString()} currently shown${line?` · current: ${UI.esc(line)}`:''}</p><small>Separate sidecar layer only. Does not enter pole/tower assets or search.</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-show-current-crossings="1">Show current circuit crossings</button><button type="button" class="data-safe-btn" data-tools-show-view-crossings="1">Show crossings in map view</button><button type="button" class="data-safe-btn" data-tools-hide-crossings="1">Hide crossings</button></div>`;
    body.innerHTML=`${this.toolsSectionHtml('toolsMeasure','Measure Distance',measureTools,MapEngine?.measureStatusLabel?.()||'off',false)}${this.toolsSectionHtml('toolsPins','Pin drops',pinTools,MapEngine?.pinDropStatusLabel?.()||'none saved',false)}${this.toolsSectionHtml('toolsReferences','Reference points',referenceTools,refsMode==='all substations'?'Substations shown':(refsMode==='all depots'?'Depots shown':'Closed'),false)}${this.toolsSectionHtml('toolsGps','GPS / Patrol mode',gpsTools,MapEngine?.gpsProfileLabel?.()||'Walking',false)}${this.toolsSectionHtml('toolsCrossings','HV / TX crossings',crossingTools,`${Number(xs.total||0).toLocaleString()} imported`,false)}`;
    if(preserveScroll&&wrap){requestAnimationFrame(()=>{wrap.scrollTop=keep;});}
  },
  toolsSectionHtml(key,title,body,sub='',defaultOpen=false){
    const has=Object.prototype.hasOwnProperty.call(this.toolsSectionOpen,key);
    const open=has?!!this.toolsSectionOpen[key]:!!defaultOpen;
    return `<div class="data-section collapsible-section"><button type="button" class="section-toggle" data-tools-section-key="${UI.esc(key)}"><span class="pm-box">${open?'−':'+'}</span><span><b>${UI.esc(title)}</b>${sub?`<small>${UI.esc(sub)}</small>`:''}</span></button>${open?`<div class="section-drop">${body}</div>`:''}</div>`;
  },
  async handleToolsClick(e){
    const section=e.target.closest?.('button[data-tools-section-key]');
    if(section){e.preventDefault();try{document.activeElement?.blur?.();}catch(_e){}const key=section.dataset.toolsSectionKey||'';this.toolsSectionOpen[key]=!this.toolsSectionOpen[key];this.renderToolsPanel(true);return;}
    const measureStart=e.target.closest?.('button[data-tools-measure-start]');
    if(measureStart){e.preventDefault();MapEngine?.startMeasureTool?.();this.closeToolsPanel();return;}
    const measureClear=e.target.closest?.('button[data-tools-measure-clear]');
    if(measureClear){e.preventDefault();MapEngine?.clearMeasure?.(true);this.renderToolsPanel(true);return;}
    const pinsShow=e.target.closest?.('button[data-tools-pins-show]');
    if(pinsShow){e.preventDefault();MapEngine?.showSavedPinDrops?.();this.renderToolsPanel(true);return;}
    const pinsHide=e.target.closest?.('button[data-tools-pins-hide]');
    if(pinsHide){e.preventDefault();MapEngine?.hideSavedPinDrops?.();this.renderToolsPanel(true);return;}
    const pinsExport=e.target.closest?.('button[data-tools-pins-export]');
    if(pinsExport){e.preventDefault();MapEngine?.exportSavedPinDrops?.();this.renderToolsPanel(true);return;}
    const pinsClear=e.target.closest?.('button[data-tools-pins-clear]');
    if(pinsClear){e.preventDefault();MapEngine?.clearSavedPinDrops?.();this.renderToolsPanel(true);return;}
    const ref=e.target.closest?.('button[data-tools-reference-kind]');
    if(ref){e.preventDefault();await this.toggleReferencePoints(ref.dataset.toolsReferenceKind||'substation');this.renderToolsPanel(true);return;}
    const prof=e.target.closest?.('button[data-tools-gps-profile]');
    if(prof){e.preventDefault();MapEngine?.setGpsProfile?.(prof.dataset.toolsGpsProfile||'walking');this.renderToolsPanel(true);return;}
    const startGps=e.target.closest?.('button[data-tools-start-gps]');
    if(startGps){e.preventDefault();MapEngine?.showGpsPanel?.();MapEngine?.startGpsWatch?.(false);return;}
    const stopFollow=e.target.closest?.('button[data-tools-stop-follow]');
    if(stopFollow){e.preventDefault();MapEngine?.stopGpsFollow?.(true);this.renderToolsPanel(true);return;}
    const showCur=e.target.closest?.('button[data-tools-show-current-crossings]');
    if(showCur){e.preventDefault();HVCrossingsLayer?.showForCircuit?.(MapEngine?.currentCircuit||'').then(()=>this.renderToolsPanel(true));return;}
    const showView=e.target.closest?.('button[data-tools-show-view-crossings]');
    if(showView){e.preventDefault();HVCrossingsLayer?.showInMapView?.().then(()=>this.renderToolsPanel(true));return;}
    const hideX=e.target.closest?.('button[data-tools-hide-crossings]');
    if(hideX){e.preventDefault();HVCrossingsLayer?.clearActive?.();this.renderToolsPanel(true);return;}
  },
  async deleteImportedFileFromManager(name=''){
    name=String(name||'').trim();
    if(!name)return;
    if(!confirm(`Delete imported file?\n\n${name}\n\nThis removes its saved records from myMap. Other files stay.`))return;
    try{
      UI.progress(true,'Deleting imported file…',name,10);
      const res=await ImportEngine.deleteImportedFile(name,{skipUi:true});
      UI.progress(false);
      this.conductorGroupCache=null;
      this.statsCache=null;
      UI.refreshAll();
      this.renderCircuitList();
      this.showDataPanel('files');
      UI.toast(res?.deleted?`Deleted ${name}`:'File was not found.');
    }catch(err){UI.progress(false);Diagnostics.capture(err);UI.toast('Delete failed.');}
  },
  async clearAppCache(){
    if(!confirm('Clear app cache?\n\nImported files/data will be kept. This only clears old browser/PWA cache and service worker leftovers.'))return;
    try{
      UI.progress(true,'Clearing app cache…','Imported data is being kept.',20);
      await this.clearOldShellCache();
      if(window.caches){const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k).catch(()=>{})));}
      if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister().catch(()=>{})));}
      UI.progress(false);
      UI.toast('Cache cleared. Imported data kept. Refresh the page if old files were stuck.');
      if(!document.getElementById('resetPanel')?.classList.contains('hidden'))this.renderResetPanel();
    }catch(err){UI.progress(false);Diagnostics.capture(err);UI.toast('Clear cache failed.');}
  },
  async resetApp(){
    if(!confirm('RESET myMap?\n\nThis deletes every imported file, saved asset, local database record, cache, and displayed map dot. This cannot be undone.'))return;
    const typed=prompt('Type RESET to delete everything imported and clear the app cache.');
    if(String(typed||'').trim().toUpperCase()!=='RESET'){UI.toast('Reset cancelled.');return;}
    try{
      UI.progress(true,'Resetting myMap…','Deleting imported data and app cache',10);
      try{MapEngine.clearDisplay(false);}catch(e){}
      try{await StorageEngine.clear();}catch(e){}
      try{if(StorageEngine.db){StorageEngine.db.close();StorageEngine.db=null;}}catch(e){}
      try{if('indexedDB' in window){await new Promise(resolve=>{const req=indexedDB.deleteDatabase('FieldMAP_CleanHybrid_DB'); req.onsuccess=()=>resolve(); req.onerror=()=>resolve(); req.onblocked=()=>resolve();});}}catch(e){}
      try{for(const k of Object.keys(localStorage||{})){if(/field\s*-?map|fieldmap|FieldMAP|fieldMapCleanHybrid|MapAPP\.conductorReference/i.test(k))localStorage.removeItem(k);}}catch(e){}
      try{window.FieldMapConductorDataLoader?.clear?.();}catch(e){}
      try{await HVCrossingsLayer?.clearStore?.();}catch(e){}
      try{if(window.caches){const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k).catch(()=>{})));}}catch(e){}
      try{if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister().catch(()=>{})));}}catch(e){}
      App.assets=[];App.files=[];App.utilityAssets=[];App.utilityLoaded=false;App.utilityLoadKey='';App.lastImport=null;App.drawnMarkers=0;App.selectedAsset=null;App.dbMeta=null;App.dbNeedsRebuild=false;App.indexHealth={mode:'file-level',queue:[],files:[],current:null,lastFullRebuild:null};
      try{if(SearchEngine.rebuildAsync)await SearchEngine.rebuildAsync('Reset app rebuild'); else SearchEngine.rebuild();}catch(e){}
      this.selectedCircuit='';this.expandedConductorRows={};this.conductorNameFilter='';this.conductorNamePage=1;this.conductorGroupCache=null;this.statsCache=null;this.fileListLimit=30;this.conductorAllLimit=50;this.renderCircuitList();UI.refreshAll();
      this.updateReferenceToggleButtons();
      UI.progress(false);
      this.closeResetPanel();
      this.showDataPanel('summary');
      UI.toast('Reset complete. Imported data and conductor reference removed.');
    }catch(err){UI.progress(false);Diagnostics.capture(err);UI.toast('Reset failed.');}
  },
  cleanConductorLabel(value=''){
    let s=String(value||'').split(' · ')[0].trim();
    s=s.replace(/\\+/g,'');
    s=s.replace(/\s*,+\s*$/g,'');
    s=s.replace(/\s+/g,' ');
    s=s.replace(/\s*-\s*/g,' - ');
    s=s.replace(/\s+\)/g,')').replace(/\(\s+/g,'(');
    return s.trim()||'Unknown conductor';
  },
  conductorSpec(label=''){
    const clean=this.cleanConductorLabel(label);
    try{
      const calc=window.FieldMapSpanWeightCalculator;
      if(calc?.getSpec){
        const direct=calc.getSpec(label)||calc.getSpec(clean);
        if(direct)return direct;
      }
      const specs=calc?.specs||{};
      const compact=SearchEngine?.compact||((v)=>String(v||'').toUpperCase().replace(/[^A-Z0-9]+/g,''));
      const ck=compact(clean);
      for(const [k,v] of Object.entries(specs)){if(compact(k)===ck)return v;}
    }catch(e){}
    return null;
  },
  conductorType(label=''){
    const spec=this.conductorSpec(label);
    const type=String(spec?.type||'').replace(/\s+/g,' ').trim();
    if(!type||/^unknown$/i.test(type))return '';
    return type;
  },
  conductorFieldChartSize(spec){
    const v=spec?.fieldChartSizeMm??spec?.sizeMm??spec?.odMm;
    if(v===undefined||v===null||v==='')return '';
    const n=Number(v);
    return Number.isFinite(n)?(Number.isInteger(n)?String(n):String(n).replace(/0+$/,'').replace(/\.$/,'')):String(v);
  },
  conductorFieldChartDie(spec){
    const raw=spec?.fieldChartDieSize??spec?.dieSize;
    if(raw===undefined||raw===null||raw==='')return '';
    const type=String(spec?.type||'').toUpperCase();
    const al=spec?.aluminiumOuterDieSize??spec?.aluminiumDieSize??spec?.outerAluminiumDieSize;
    const steel=spec?.steelCoreDieSize??spec?.steelDieSize??spec?.coreSteelDieSize;
    const fmt=(v)=>String(v).replace(/\s+/g,' ').trim();
    if(al!==undefined&&al!==null&&al!==''&&steel!==undefined&&steel!==null&&steel!=='')return `Al outer die ${fmt(al)} · Steel core die ${fmt(steel)}`;
    const v=fmt(raw);
    const m=v.match(/^([^+]+)\s*\+\s*([^+]+)$/);
    if(m&&/ACSR/.test(type))return `Al outer die ${fmt(m[1])} · Steel core die ${fmt(m[2])}`;
    return v;
  },
  conductorDisplayLabel(label=''){
    const clean=this.cleanConductorLabel(label);
    const displayClean=clean.replace(/\bHDC\s+COPPER\b/ig,'Copper').replace(/\bHDC\b/ig,'Copper');
    const spec=this.conductorSpec(clean);
    const type=String(spec?.type||'').replace(/\s+/g,' ').trim();
    const material=String(spec?.materialCategory||'').replace(/\s+/g,' ').trim();
    const colour=String(spec?.colour||spec?.color||'').replace(/\s+/g,' ').trim();
    const chartSize=this.conductorFieldChartSize(spec);
    const dieSize=this.conductorFieldChartDie(spec);
    const parts=[];
    const c=(SearchEngine?.compact?SearchEngine.compact(clean):clean.toUpperCase().replace(/[^A-Z0-9]+/g,''));
    const add=(v)=>{v=String(v||'').trim(); if(!v)return; const cv=(SearchEngine?.compact?SearchEngine.compact(v):v.toUpperCase().replace(/[^A-Z0-9]+/g,'')); if(cv&&!c.includes(cv)&&!parts.some(p=>(SearchEngine?.compact?SearchEngine.compact(p):p.toUpperCase().replace(/[^A-Z0-9]+/g,''))===cv))parts.push(v);};
    const equiv=String(spec?.equivalentName||spec?.equivalent||'').replace(/\s+/g,' ').trim();
    if(equiv)add(`Equivalent: ${equiv}`);
    if(type&&!/^unknown$/i.test(type))add(this.conductorTypeGroup(type)==='Copper'?'Copper':type);
    if(material&&material!=='Unknown'&&material!==type)add(`Material: ${material}`);
    if(chartSize)add(`Size: ${chartSize} mm`);
    if(dieSize)add(`Die: ${dieSize}`);
    if(colour)add(`Colour: ${colour}`);
    return parts.length?`${displayClean} · ${parts.join(' · ')}`:displayClean;
  },
  conductorNameOnly(label='', spec=null){
    const clean=this.cleanConductorLabel(label);
    const s=String(clean||'').trim();
    const bracketMatches=[...s.matchAll(/\(([^()]*)\)/g)].map(m=>String(m[1]||'').trim()).filter(Boolean);
    let name=bracketMatches.length?bracketMatches[bracketMatches.length-1]:'';
    if(!name && spec){
      name=String(spec.name||spec.conductorName||spec.commonName||spec.codeName||'').trim();
    }
    if(!name){
      const parts=s.split(/\s+-\s+/).map(x=>x.trim()).filter(Boolean);
      const last=parts.length>1?parts[parts.length-1]:'';
      if(last && !/^\d+(?:[./]\d+)?(?:\s*(?:SQ|MM|MM2|MM²|IN|INCH|AC|GZ|SC|CU|AL|AAC|AAAC|ACSR)\b|\s|\+|-|$)/i.test(last))name=last;
    }
    if(!name)name=s;
    name=String(name||'').replace(/\\+/g,'').replace(/\s+/g,' ').replace(/^[-–—]+|[-–—]+$/g,'').trim();
    return name||'Unknown';
  },
  conductorNameGroups(groups=[]){
    const map=new Map();
    for(const g of groups||[]){
      const spec=this.conductorSpec(g.label)||{};
      const name=this.conductorNameOnly(g.label,spec);
      const key=SearchEngine?.compact?SearchEngine.compact(name):name.toUpperCase().replace(/[^A-Z0-9]+/g,'');
      if(!map.has(key))map.set(key,{key,name,count:0,sections:0,groups:[]});
      const row=map.get(key);
      row.count++;
      row.sections+=Number(g.count||0);
      row.groups.push(g);
    }
    return Array.from(map.values()).sort((a,b)=>{
      const ar=/^[A-Za-z]/.test(String(a.name||''))?0:/^[0-9]/.test(String(a.name||''))?1:2;
      const br=/^[A-Za-z]/.test(String(b.name||''))?0:/^[0-9]/.test(String(b.name||''))?1:2;
      return ar-br || String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'});
    });
  },
  conductorPrimaryLabel(sec={}){
    const bits=Array.isArray(sec.bits)?sec.bits:[];
    const conductor=bits.find(b=>/^conductor$/i.test(String(b.label||'')))?.value;
    const val=this.cleanConductorLabel(conductor||sec.conductor||'Unknown conductor');
    return val||'Unknown conductor';
  },
  conductorGroups(){
    const sections=Array.isArray(SearchEngine.conductorSections)?SearchEngine.conductorSections:[];
    const sig=[sections.length,Array.isArray(App.assets)?App.assets.length:0,SearchEngine?.lineMap?.size||0].join('|');
    if(this.conductorGroupCache&&this.conductorGroupCache.sig===sig)return this.conductorGroupCache.rows;
    try{if(SearchEngine?.linkConductorSections)SearchEngine.linkConductorSections(App.assets||[]);}catch(e){}
    const linked=Array.isArray(SearchEngine.conductorSections)?SearchEngine.conductorSections:sections;
    const map=new Map();
    const ensureGroup=(label, type='')=>{
      label=this.cleanConductorLabel(label||'Unknown conductor');
      const key=SearchEngine?.compact?SearchEngine.compact(label):label.toUpperCase();
      const foundType=String(type||this.conductorType(label)||'').trim();
      const material=this.conductorMaterial(label,foundType);
      if(!map.has(key))map.set(key,{key,label,displayLabel:this.conductorDisplayLabel(label),type:foundType,typeGroup:this.conductorTypeGroup(foundType),materialCategory:material,count:0,circuits:new Map(),sourceCounts:{imported:0,bundled:0,reference:0},specOnly:false});
      const g=map.get(key);
      if(foundType&&!g.type){g.type=foundType;g.typeGroup=this.conductorTypeGroup(foundType);}
      if(material&&(!g.materialCategory||g.materialCategory==='Unknown'))g.materialCategory=material;
      g.displayLabel=this.conductorDisplayLabel(g.label);
      return g;
    };
    for(const sec of linked){
      const label=this.conductorPrimaryLabel(sec);
      const g=ensureGroup(label, String(sec.conductorType||this.conductorType(label)||'').trim());
      g.count++;
      const source=String(sec.source||'imported'); g.sourceCounts[source]=(g.sourceCounts[source]||0)+1;
      const line=SearchEngine?.formatCircuitName?SearchEngine.formatCircuitName(sec.line||''):String(sec.line||'');
      const lineKey=SearchEngine?.compact?SearchEngine.compact(line):line.toUpperCase();
      if(line){
        if(!g.circuits.has(lineKey))g.circuits.set(lineKey,{line,count:0,ranges:[]});
        const c=g.circuits.get(lineKey); c.count++;
        if(c.ranges.length<6)c.ranges.push(`${sec.fromPole||'?'} → ${sec.toPole||'?'}`);
      }
    }
    const specs=window.FieldMapSpanWeightCalculator?.specs||window.FieldMapConductorSpecs||{};
    for(const [label,spec] of Object.entries(specs||{})){
      const g=ensureGroup(label, String(spec?.type||'').trim());
      g.specOnly = g.count===0;
      g.sourceCounts.reference=(g.sourceCounts.reference||0)+1;
    }
    const rows=Array.from(map.values());
    this.conductorGroupCache={sig,rows};
    return rows;
  },
  conductorPagerHtml(page,totalPages,totalRows,startIndex,endIndex){
    totalPages=Math.max(1,Number(totalPages)||1);
    page=Math.min(Math.max(1,Number(page)||1),totalPages);
    const nums=[];
    const add=(n)=>{if(n>=1&&n<=totalPages&&!nums.includes(n))nums.push(n);};
    add(1);
    for(let n=page-2;n<=page+2;n++)add(n);
    add(totalPages);
    nums.sort((a,b)=>a-b);
    const bits=[];
    let last=0;
    for(const n of nums){
      if(last&&n-last>1)bits.push('<span class="pager-gap">…</span>');
      bits.push(`<button type="button" class="pager-num ${n===page?'active':''}" data-cond-page="${n}">${n}</button>`);
      last=n;
    }
    const prev=`<button type="button" class="pager-nav" data-cond-page="${Math.max(1,page-1)}" ${page<=1?'disabled':''}>‹</button>`;
    const next=`<button type="button" class="pager-nav" data-cond-page="${Math.min(totalPages,page+1)}" ${page>=totalPages?'disabled':''}>›</button>`;
    return `<div class="conductor-pager"><div class="pager-count">Showing ${startIndex.toLocaleString()}–${endIndex.toLocaleString()} of ${totalRows.toLocaleString()}</div><div class="pager-buttons">${prev}${bits.join('')}${next}</div></div>`;
  },
  renderConductorRows(groups=[],mode='top'){
    const all=Array.isArray(groups)?groups:[];
    let sorted;
    if(mode==='top')sorted=all.slice().sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
    else sorted=all.slice().sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'}));
    if(!sorted.length)return '<div class="tiny-note">No conductor sections available yet. Import the separate conductor JSON file.</div>';
    const pageSize=Math.max(5,Number(this.conductorPageSize||5));
    const totalPages=Math.max(1,Math.ceil(sorted.length/pageSize));
    let page=Math.min(Math.max(1,Number(this.conductorPage||1)),totalPages);
    this.conductorPage=page;
    const start=(page-1)*pageSize;
    const rows=sorted.slice(start,start+pageSize);
    const endIndex=start+rows.length;
    const pager=this.conductorPagerHtml(page,totalPages,sorted.length,start+1,endIndex);
    const html=`<div class="conductor-list">${rows.map((g,idx)=>{
      const key=`cond_${g.key}`;
      const open=!!this.expandedConductorRows[key];
      const circuitCount=g.circuits?.size||0;
      const spec=this.conductorSpec(g.label);
      const conf=String(spec?.confidence||'unverified_no_estimate');
      const status=(conf==='catalog_verified'||conf==='external_exact_match'||conf==='equivalent_verified_by_user_mapping')?'Verified':(conf==='identity_verified_no_weight'?'Identity only':'Manual needed');
      const typeLabel=g.typeGroup||this.conductorTypeGroup(g.type||'');
      const materialLabel=g.materialCategory||this.conductorMaterial(g.label,g.type||'');
      const rowCount=g.count>0?`${g.count.toLocaleString()} section${g.count===1?'':'s'}`:'reference row';
      const sub=`${rowCount} · ${circuitCount.toLocaleString()} circuit${circuitCount===1?'':'s'} · ${materialLabel} · ${typeLabel} · ${status}`;
      let drop='';
      if(open){
        const circuits=Array.from(g.circuits.values()).sort((a,b)=>a.line.localeCompare(b.line,undefined,{numeric:true,sensitivity:'base'}));
        const detail=[];
        if(spec?.equivalentName)detail.push(`<div class="mini-row"><b>Equivalent</b><span>${UI.esc(spec.equivalentName)}</span></div>`);
        const material=spec?.materialCategory||g.materialCategory||this.conductorMaterial(g.label,g.type||'');
        if(material)detail.push(`<div class="mini-row"><b>Material</b><span>${UI.esc(material)}</span></div>`);
        const displayType=spec?.type||g.typeGroup||g.type||'';
        if(displayType)detail.push(`<div class="mini-row"><b>Type</b><span>${UI.esc(this.conductorTypeGroup(displayType)==='Copper'?'Copper':displayType)}</span></div>`);
        const chartSize=this.conductorFieldChartSize(spec);
        const dieSize=this.conductorFieldChartDie(spec);
        if(chartSize)detail.push(`<div class="mini-row"><b>Size</b><span>${UI.esc(chartSize)} mm</span></div>`);
        if(dieSize)detail.push(`<div class="mini-row"><b>Die size</b><span>${UI.esc(dieSize)}</span></div>`);
        if(spec?.kgPerM)detail.push(`<div class="mini-row"><b>Weight</b><span>${Number(spec.kgPerM).toFixed(3)} kg/m</span></div>`);
        if(spec?.colour||spec?.color)detail.push(`<div class="mini-row"><b>Colour</b><span>${UI.esc(spec.colour||spec.color)}</span></div>`);
        if(spec?.sourcePriority==='FIELD_CHART_FIRST')detail.push(`<div class="mini-row"><b>Priority</b><span>Field chart first</span></div>`);
        else if(spec?.propertySource)detail.push(`<div class="mini-row"><b>Priority</b><span>Public source only</span></div>`);
        const detailHtml=detail.length?`<div class="conductor-spec-mini">${detail.join('')}</div>`:'';
        const circuitHtml=circuits.length?`<div class="conductor-circuit-list">${circuits.map(c=>`<div class="conductor-circuit-row"><div><b>${UI.esc(c.line)}</b><span>${c.count.toLocaleString()} span section${c.count===1?'':'s'}${c.ranges.length?' · '+UI.esc(c.ranges.join(', ')):''}</span></div><button class="conductor-map-btn" type="button" data-map-line="${UI.esc(c.line)}">Map</button></div>`).join('')}</div>`:'<div class="tiny-note">No circuit names found yet. This conductor is listed in the conductor reference JSON but has not been found on an imported transmission circuit.</div>';
        drop=`<div class="conductor-drop">${detailHtml}${circuitHtml}</div>`;
      }
      return `<div class="conductor-row"><button type="button" class="conductor-main" data-cond-key="${UI.esc(key)}"><b>${UI.esc(g.displayLabel||this.conductorDisplayLabel(g.label))}</b><span><em class="pm-mini">${open?'−':'+'}</em> ${UI.esc(sub)}</span></button>${drop}</div>`;
    }).join('')}</div>`;
    return pager+html+(totalPages>1?pager:'');
  },

  fmtKg(v){return Number.isFinite(Number(v))?`${Math.round(Number(v)).toLocaleString()} kg`:'Unknown';},
  fmtM(v){const n=Number(v); return Number.isFinite(n)?(n>=1000?`${(n/1000).toFixed(2)} km`:`${Math.round(n).toLocaleString()} m`):'Unknown';},
  weightTestCandidates(limit=8){
    const calc=window.FieldMapSpanWeightCalculator;
    const out=[]; const seen=new Set();
    const add=(a)=>{if(!a||typeof a!=='object')return; if(calc?.shouldOffer&&!calc.shouldOffer(a))return; const id=SearchEngine?.assetStableId?SearchEngine.assetStableId(a):String(a.id||a.label||a.line||Math.random()); if(seen.has(id))return; seen.add(id); out.push(a);};
    if(App.selectedAsset)add(App.selectedAsset);
    const groups=Array.from(SearchEngine?.lineMap?.values?.()||[]).filter(g=>Array.isArray(g.assets)&&g.assets.length>=2).sort((a,b)=>(b.validGps||0)-(a.validGps||0));
    for(const g of groups){
      if(out.length>=limit)break;
      const list=g.assets||[]; const picks=[1,Math.floor(list.length/2),Math.max(0,list.length-2),0].filter(i=>i>=0&&i<list.length);
      for(const i of picks){add(list[i]); if(out.length>=limit)break;}
    }
    if(out.length<limit){
      const assets=Array.isArray(App.assets)?App.assets:[]; const maxScan=Math.min(assets.length,3000+limit*250);
      for(let i=0;i<maxScan&&out.length<limit;i++)add(assets[i]);
    }
    return out.slice(0,limit);
  },
  spanAuditHtml(span){
    if(!span)return '<div class="weight-span-card"><b>Missing side</b><span>No adjacent asset found.</span></div>';
    if(!span.ok)return `<div class="weight-span-card"><b>${UI.esc(span.side||'Span')}</b><span>${UI.esc(span.reason||'No conductor section or length found.')}</span></div>`;
    const kgm=Number.isFinite(Number(span.kgPerM))?Number(span.kgPerM).toFixed(3)+' kg/m':'manual weight needed';
    const eq=span.equivalent?` · Eq: ${UI.esc(span.equivalent)}`:'';
    const size=span.sizeMm?` · Size: ${UI.esc(span.sizeMm)} mm`:'';
    const die=span.dieSize?` · Die: ${UI.esc(span.dieSize)}`:'';
    const blocked=span.blocked?'<em class="audit-badge bad">Blocked</em>':'<em class="audit-badge good">Calculates</em>';
    const count=Number.isFinite(Number(span.conductorCount))?Number(span.conductorCount):null;
    const formula=(count&&Number.isFinite(Number(span.kgPerM))&&Number.isFinite(Number(span.lengthM)))?`${this.fmtM(span.lengthM)} × ${Number(span.kgPerM).toFixed(3)} kg/m × ${count} phase conductors = ${this.fmtKg(span.phaseKg)}`:'';
    return `<div class="weight-span-card"><div class="weight-span-top"><b>${UI.esc(span.side)}</b>${blocked}</div><div class="mini-row"><b>Span</b><span>${UI.esc(span.from||'?')} ⇄ ${UI.esc(span.to||'?')}</span></div><div class="mini-row"><b>Length</b><span>${this.fmtM(span.lengthM)} · ${UI.esc(span.lengthSource||'')}</span></div><div class="mini-row"><b>Conductor</b><span>${UI.esc(span.conductor||'Unknown')}</span></div><div class="mini-row"><b>Property</b><span>${UI.esc(span.status||'Manual needed')} · ${UI.esc(span.type||'Unknown')}${eq}${size}${die} · ${kgm}</span></div>${formula?`<div class="mini-formula">${UI.esc(formula)}</div>`:''}<div class="mini-row"><b>Single conductor</b><span>${this.fmtKg(span.singleConductorKg)}</span></div><div class="mini-row"><b>Per phase bundle</b><span>${this.fmtKg(span.perPhaseBundleKg)}</span></div><div class="mini-row"><b>Per circuit</b><span>${this.fmtKg(span.perCircuitKg)}</span></div><div class="mini-row"><b>All phase conductors</b><span>${this.fmtKg(span.phaseKg)}</span></div><div class="mini-row"><b>Known total</b><span>${this.fmtKg(span.knownTotalKg)}</span></div>${span.unknown?.length?`<div class="data-warning">Manual/unknown: ${UI.esc(span.unknown.join(', '))}</div>`:''}</div>`;
  },
  weightAuditCard(asset,title='Asset test'){
    const calc=window.FieldMapSpanWeightCalculator;
    if(!calc?.auditAsset)return '<div class="empty-card"><b>Weight audit unavailable</b><span>Span weight audit helper is not loaded.</span></div>';
    try{
      const a=calc.auditAsset(asset);
      const blocked=a.blocked&&a.blocked.length;
      return `<div class="data-card weight-test-card"><div class="card-top"><b>${UI.esc(title)}</b><span>${blocked?'Manual checks':'OK'}</span></div><p>${UI.esc(a.title||'Asset')} · ${Number(a.lineAssetCount||0).toLocaleString()} structures on loaded/indexed circuit · ${Number(a.sectionCount||0).toLocaleString()} conductor sections available</p><div class="stat-grid compact"><div><b>${this.fmtKg(a.knownTotalKg)}</b><span>known full-span total</span></div><div><b>${this.fmtKg(a.supportShareKg)}</b><span>structure share estimate</span></div></div>${blocked?`<div class="data-warning">${UI.esc(a.blocked.slice(0,4).join(' · '))}${a.blocked.length>4?'…':''}</div>`:''}<div class="weight-span-grid">${this.spanAuditHtml(a.left)}${this.spanAuditHtml(a.right)}</div></div>`;
    }catch(err){return `<div class="data-card weight-test-card"><b>${UI.esc(title)}</b><p>Audit failed for this asset.</p><div class="data-warning">${UI.esc(err?.message||String(err))}</div></div>`;}
  },
  renderWeightTestPanel(){
    const calc=window.FieldMapSpanWeightCalculator;
    if(!calc)return '<div class="empty-card"><b>Span weight system not loaded</b><span>The calculator file is missing or blocked.</span></div>';
    const sections=calc.loadSections?calc.loadSections():[];
    const specs=calc.specs?Object.values(calc.specs):[];
    const verified=specs.filter(s=>['catalog_verified','external_exact_match','equivalent_verified_by_user_mapping'].includes(String(s.confidence))).length;
    const manual=specs.length-verified;
    const candidates=this.weightTestCandidates(Math.max(1,Number(this.weightTestLimit||8)));
    const selected=App.selectedAsset?this.weightAuditCard(App.selectedAsset,'Selected/open popup asset'):'';
    const rows=candidates.map((a,i)=>this.weightAuditCard(a,`Quick test ${i+1}`)).join('')||'<div class="tiny-note">No pole/tower candidates found. Import data and load or click a circuit first.</div>';
    const more=candidates.length>=this.weightTestLimit?`<button type="button" class="data-safe-btn load-more-btn" data-weight-more="1">Show 8 more test assets</button>`:'';
    return `<div class="stat-grid"><div><b>${Number(sections.length||0).toLocaleString()}</b><span>span sections</span></div><div><b>${Number(specs.length||0).toLocaleString()}</b><span>spec rows</span></div><div><b>${verified.toLocaleString()}</b><span>verified/equiv</span></div><div><b>${manual.toLocaleString()}</b><span>manual/identity</span></div></div><div class="data-card"><b>Final conductor weight test lock</b><p>This page checks the calculator against actual imported/indexed assets. It shows conductor matched, equivalent used, kg/m, source status, span length, calculated weight, and whether calculation was blocked because the conductor is manual/unknown.</p><small>No conductor properties are estimated from stranding. SPEC conductors use the equivalent standard properties you requested.</small></div>${selected}${this.sectionHtml('weightQuick','Quick asset tests',rows+more,'limited on mobile for speed',true)}`;
  },
  renderConductorPanel(conductorSections=[],conductorSpanAssets=0,bundled=0,specCount=0){
    const groups=this.conductorGroups();
    const mode=this.conductorSubCategory||'top';
    const topActive=mode==='top';
    const imported=groups.reduce((n,g)=>n+Number(g.sourceCounts.imported||0),0);
    const bundle=groups.reduce((n,g)=>n+Number(g.sourceCounts.bundled||0),0);
    const reference=groups.reduce((n,g)=>n+Number(g.sourceCounts.reference||0),0);
    return `<div class="stat-grid"><div><b>${conductorSections.length.toLocaleString()}</b><span>span sections</span></div><div><b>${groups.length.toLocaleString()}</b><span>conductor types</span></div><div><b>${conductorSpanAssets.toLocaleString()}</b><span>imported spans</span></div><div><b>${specCount.toLocaleString()}</b><span>verified/manual specs</span></div></div><div class="data-card"><b>Conductor weight system</b><p>Open a pole/tower dot → More info → Span weight calculator. The calculator uses loaded conductor JSON kg/m only. Identity-only and unverified conductors show manual weight needed; no estimating is used.</p><small>${imported.toLocaleString()} imported section records · ${reference.toLocaleString()} conductor reference rows loaded · ${bundle.toLocaleString()} circuit-span reference rows.</small></div><div class="conductor-subtabs"><button type="button" data-conductor-subcat="top" class="${topActive?'active':''}">Top conductors</button><button type="button" data-conductor-subcat="all" class="${!topActive?'active':''}">All conductors</button></div><div class="data-section"><b>${topActive?'Top conductor sections':'All conductor sections'}</b><div class="tiny-note">Shows 5 conductors per page for mobile speed. Tap + to open circuits below the selected conductor; circuit list can scroll long.</div>${this.renderConductorRows(groups,topActive?'top':'all')}</div>`;
  },

  panelScrollElement(){
    return document.querySelector('#statusPanel .data-manager-body');
  },
  updatePanelScrollTopButton(){
    const btn=document.getElementById('panelScrollTopBtn');
    const panel=document.getElementById('statusPanel');
    const el=this.panelScrollElement();
    if(!btn||!el||panel?.classList.contains('hidden'))return btn?.classList.add('hidden');
    const long=el.scrollHeight>el.clientHeight+80;
    btn.classList.toggle('hidden',!(long&&el.scrollTop>180));
  },
  scrollCurrentPanelTop(){
    const el=this.panelScrollElement();
    if(el)el.scrollTo({top:0,behavior:'smooth'});
    this.updatePanelScrollTopButton();
  },
  conductorScrollElement(){
    return document.querySelector('#conductorsPanel .conductors-body');
  },
  updateConductorScrollTopButton(){
    const btn=document.getElementById('conductorsScrollTopBtn');
    const panel=document.getElementById('conductorsPanel');
    const el=this.conductorScrollElement();
    if(!btn||!el||panel?.classList.contains('hidden'))return btn?.classList.add('hidden');
    const long=el.scrollHeight>el.clientHeight+90;
    btn.classList.toggle('hidden',!(long&&el.scrollTop>220));
  },
  scrollConductorsPanelTop(){
    const el=this.conductorScrollElement();
    if(el)el.scrollTo({top:0,behavior:'smooth'});
    this.updateConductorScrollTopButton();
  },
  sectionHtml(key,title,body,sub='',defaultOpen=false){
    const has=Object.prototype.hasOwnProperty.call(this.dataSectionOpen,key);
    const open=has?!!this.dataSectionOpen[key]:!!defaultOpen;
    return `<div class="data-section collapsible-section"><button type="button" class="section-toggle" data-section-key="${UI.esc(key)}"><span class="pm-box">${open?'−':'+'}</span><span><b>${UI.esc(title)}</b>${sub?`<small>${UI.esc(sub)}</small>`:''}</span></button>${open?`<div class="section-drop">${body}</div>`:''}</div>`;
  },
  fastStats(){
    const assets=Array.isArray(App.assets)?App.assets:[];
    const sig=[assets.length,App.drawnMarkers||0,SearchEngine?.lineMap?.size||0].join('|');
    if(this.statsCache&&this.statsCache.sig===sig)return this.statsCache;
    let withGps=0, conductorSpanAssets=0;
    for(const a of assets){
      if(Number.isFinite(Number(a?.lat))&&Number.isFinite(Number(a?.lon)))withGps++;
      if(SearchEngine?.isConductorSpanAsset?.(a))conductorSpanAssets++;
    }
    this.statsCache={sig,total:assets.length,withGps,unmapped:Math.max(0,assets.length-withGps),conductorSpanAssets,circuits:SearchEngine?.lineMap?.size||0,dots:Number(App.drawnMarkers||0)};
    return this.statsCache;
  },
  renderDataPanel(preserveScroll=false){
    const b=document.getElementById('statusBody'); if(!b)return;
    const scrollEl=this.panelScrollElement();
    const keepTop=preserveScroll&&scrollEl?scrollEl.scrollTop:0;
    const restore=()=>{if(preserveScroll&&scrollEl)scrollEl.scrollTop=keepTop; this.updatePanelScrollTopButton();};
    setTimeout(()=>{restore(); if(typeof requestAnimationFrame==='function')requestAnimationFrame(restore);},0);
    this.renderDataTabs();
    const cat=this.dataCategory;
    const files=Array.isArray(App.files)?App.files:[];
    const assets=Array.isArray(App.assets)?App.assets:[];
    const stats=this.fastStats();
    const subtitle={summary:'Speed status',import:'Import files',files:'Imported file list',app:'',assets:'Asset categories',storage:'Local storage','local-save':'Local saved data'}[cat]||'Core data';
    const subEl=document.getElementById('dataManagerSubtitle'); if(subEl)subEl.textContent=subtitle;

    if(cat==='import'){
      const importBody=`<div class="data-manager-action-card"><b>Import files</b><p>Select your myMap JSON / GeoJSON files. Imported data stays local on this phone/browser.</p><button type="button" class="data-primary-action-btn" data-import-files="1">Import files</button><small>Use this for pole/tower, substation, depot, conductor, crossing or other supported myMap data files.</small></div>`;
      b.innerHTML=this.sectionHtml('dataImportFiles','Import files',importBody,'local JSON / GeoJSON import',true);
      return;
    }

    if(cat==='local-save'){
      const pins=MapEngine?.readSavedPinDrops?.()||[];
      const pinStatus=MapEngine?.pinDropStatusLabel?.()||'none saved';
      const canPick=!!window.showSaveFilePicker;
      const canShare=!!navigator.share;
      const localRows=`<div class="mini-row"><b>Pin drops</b><span>${pins.length.toLocaleString()} saved</span></div><div class="mini-row"><b>App storage</b><span>This phone/browser</span></div><div class="mini-row"><b>File save</b><span>${canPick?'Pick location':(canShare?'Share / save location':'Downloads')}</span></div>`;
      const pinActions=`<div class="data-action-grid single"><button type="button" class="data-primary-action-btn" data-local-save-as="1">Choose save location</button><button type="button" class="data-safe-btn" data-local-export-pins="1">Download backup</button><button type="button" class="data-safe-btn" data-local-show-pins="1">Show pins</button><button type="button" class="data-safe-btn" data-local-hide-pins="1">Hide pins</button><button type="button" class="data-danger-btn" data-local-clear-pins="1">Clear pins</button></div>`;
      b.innerHTML=`<div class="data-manager-action-card compact-local-card"><b>Local</b><small>${UI.esc(pinStatus)}</small></div>${this.sectionHtml('localSaveWhere','Saved',localRows,'',true)}${this.sectionHtml('localSavePins','Pins',pinActions,'',true)}`;
      return;
    }

    if(cat==='app'){
      const installed=((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true);
      b.innerHTML=`<button type="button" class="data-download-action-btn data-download-only-btn" data-install-app="1">${installed?'App installed':'Download app'}</button>`;
      setTimeout(()=>{try{window.MyMapPwaInstall?.sync?.();}catch(_e){}},0);
      return;
    }

    if(cat==='files'){
      b.innerHTML=`<div class="data-headline"><b>${files.length.toLocaleString()} imported file${files.length===1?'':'s'}</b><span>List is limited on phones. Use Show more instead of rendering every file at once.</span></div><div class="data-list">${this.fileCardsHtml()}</div>`;
      return;
    }

    if(cat==='assets'){
      const kindRows=this.countsBy(assets,x=>x.kind||x.category||'Other').slice(0,18).map(([k,n])=>`<div class="mini-row"><b>${UI.esc(k)}</b><span>${n.toLocaleString()}</span></div>`).join('');
      const sourceRows=this.countsBy(assets,x=>x.sourceFile||'Unknown file').slice(0,12).map(([k,n])=>`<div class="mini-row"><b>${UI.esc(k)}</b><span>${n.toLocaleString()}</span></div>`).join('');
      b.innerHTML=`<div class="stat-grid"><div><b>${assets.length.toLocaleString()}</b><span>assets</span></div><div><b>${stats.withGps.toLocaleString()}</b><span>mapped</span></div><div><b>${stats.unmapped.toLocaleString()}</b><span>unmapped</span></div><div><b>${stats.circuits.toLocaleString()}</b><span>circuits</span></div></div>${this.sectionHtml('assetsByType','By asset type',kindRows||'<div class="tiny-note">No assets loaded.</div>','tap to open counts')}${this.sectionHtml('assetsBySource','By source file',sourceRows||'<div class="tiny-note">No source files loaded.</div>','top 12 only for speed')}`;
      return;
    }

    if(cat==='conductors'){
      try{if(SearchEngine?.linkConductorSections)SearchEngine.linkConductorSections(assets);}catch(e){}
      const conductorSections=Array.isArray(SearchEngine.conductorSections)?SearchEngine.conductorSections:[];
      const bundled=Array.isArray(window.FieldMapConductorSections)?window.FieldMapConductorSections.length:0;
      const specCount=window.FieldMapSpanWeightCalculator?.specs?Object.keys(window.FieldMapSpanWeightCalculator.specs).length:0;
      b.innerHTML=this.renderConductorPanel(conductorSections,stats.conductorSpanAssets,bundled,specCount);
      return;
    }


    if(cat==='weight'){
      b.innerHTML=this.renderWeightTestPanel();
      return;
    }


    if(cat==='storage'){
      const meta=App.dbMeta||{};
      const savedInfo=`<div class="mini-row"><b>Version</b><span>${UI.esc(App.versionShort||App.version)}</span></div><div class="mini-row"><b>Saved at</b><span>${UI.esc(this.fmtDate(meta.savedAt)||'not available')}</span></div><div class="mini-row"><b>Search rebuild needed</b><span>${App.dbNeedsRebuild?'yes':'no'}</span></div><div class="mini-row"><b>Current dots</b><span>${stats.dots.toLocaleString()}</span></div>`;
      b.innerHTML=`<div class="data-card"><b>Local saved database</b><p>${files.length.toLocaleString()} files · ${assets.length.toLocaleString()} assets · ${stats.dots.toLocaleString()} displayed dots</p><small>Clear Map Display is in the main menu. Import files and Download app are under Data manager. Delete files from Files. Cache and full reset are under Reset in the main menu.</small></div>${this.sectionHtml('storageSaved','Saved info',savedInfo,'local database details',true)}`;
      return;
    }

    const last=App.lastImport||{};
    const idx=SearchEngine.indexStats||{};
    const speedStatus=`<div class="mini-row"><b>Startup map drawing</b><span>empty</span></div><div class="mini-row"><b>Search mode</b><span>indexed</span></div><div class="mini-row"><b>Indexed assets</b><span>${Number(idx.assetsIndexed||assets.length||0).toLocaleString()}</span></div><div class="mini-row"><b>Search tokens</b><span>${Number(idx.tokenCount||0).toLocaleString()}</span></div><div class="mini-row"><b>Last rebuild</b><span>${Number(idx.ms||0).toLocaleString()} ms</span></div>`;
    const kindRows=this.countsBy(assets,x=>x.kind||x.category||'Other').slice(0,18).map(([k,n])=>`<div class="mini-row"><b>${UI.esc(k)}</b><span>${n.toLocaleString()}</span></div>`).join('');
    const importInfo=`<div class="mini-row"><b>Time</b><span>${UI.esc(this.fmtDate(last.time)||'none this session')}</span></div><div class="mini-row"><b>Imported</b><span>${Number(last.totalImported||0).toLocaleString()} records</span></div><div class="mini-row"><b>Merged total</b><span>${Number(last.totalMerged||assets.length||0).toLocaleString()} assets</span></div><div class="mini-row"><b>Conductor spans</b><span>${Number(last.conductorSpans||stats.conductorSpanAssets||0).toLocaleString()}</span></div>`;
    b.innerHTML=`<div class="stat-grid"><div><b>${files.length.toLocaleString()}</b><span>files</span></div><div><b>${assets.length.toLocaleString()}</b><span>assets</span></div><div><b>${stats.withGps.toLocaleString()}</b><span>mapped</span></div><div><b>${stats.circuits.toLocaleString()}</b><span>circuits</span></div></div>${this.sectionHtml('summarySpeed','Index / speed status',speedStatus,'mobile retrieval checks',true)}${this.sectionHtml('summaryAssetsByType','By asset type',kindRows||'<div class="tiny-note">No assets loaded.</div>','tap to open counts',true)}${this.sectionHtml('summaryImport','Last import',importInfo,'latest import counts')}`;
  }
};


/* myMap v3.1.106: minimised Tools sections + pin manager actions */
(function(){
  if(!window.LeanMapApp)return;
  const APP=window.LeanMapApp;
  const esc=function(v){try{return (window.UI&&UI.esc)?UI.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};
  const safe=function(fn,fb){try{const v=fn();return v==null?fb:v;}catch(e){try{console.warn('myMap tools render fallback',e);}catch(_){} return fb;}};
  const section=function(key,title,html,sub='',open=true){
    const state=APP.toolsSectionOpen||{};
    const has=Object.prototype.hasOwnProperty.call(state,key);
    const isOpen=has?!!state[key]:!!open;
    return `<div class="data-section collapsible-section tools-section"><button type="button" class="section-toggle" data-tools-section-key="${esc(key)}"><span class="pm-box">${isOpen?'−':'+'}</span><span><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</span></button>${isOpen?`<div class="section-drop">${html}</div>`:''}</div>`;
  };
  APP.openToolsPanel=function(){
    try{this.closePlusMenu?.();this.closeCircuitPicker?.();this.closeResetPanel?.();this.closeConductorsPanel?.();document.getElementById('assetSearchPanel')?.classList.add('hidden');}catch(e){}
    if(!this.toolsSectionOpen||typeof this.toolsSectionOpen!=='object')this.toolsSectionOpen={};
    if(!Object.keys(this.toolsSectionOpen).length){this.toolsSectionOpen={toolsMeasure:false,toolsPins:false,toolsGps:false,toolsReferences:false,toolsCrossings:false};}
    const panel=document.getElementById('toolsPanel');
    panel?.classList.remove('hidden');
    this.renderToolsPanel(false);
    setTimeout(()=>this.renderToolsPanel(true),60);
  };
  APP.renderToolsPanel=function(preserveScroll=false){
    const body=document.getElementById('toolsBody'); if(!body)return;
    const wrap=document.querySelector('#toolsPanel .tools-body');
    const keep=preserveScroll&&wrap?wrap.scrollTop:0;
    if(!this.toolsSectionOpen||typeof this.toolsSectionOpen!=='object')this.toolsSectionOpen={};
    const ME=window.MapEngine||{};
    const HV=window.HVCrossingsLayer||{};
    const xs=safe(()=>HV.stats?.(),{total:0,hv:0,tx:0,active:0,line:''})||{total:0,hv:0,tx:0,active:0,line:''};
    const line=safe(()=>HV.currentLineLabel?.()||ME.currentCircuit||'',ME.currentCircuit||'');
    const refsMode=String(safe(()=>ME.currentDisplay||'','')).toLowerCase();
    const profile=String(safe(()=>ME.gpsProfile||'walking','walking'));
    const measureStatus=safe(()=>ME.measureStatusLabel?.(),ME.measureMode?'active':'off')||'off';
    const pinStatus=safe(()=>ME.pinDropStatusLabel?.(),(ME.savedPinDropCount?ME.savedPinDropCount():0)+' saved')||'none saved';
    const gpsLabel=safe(()=>ME.gpsProfileLabel?.(),profile==='helicopter'?'Helicopter':profile==='driving'?'Driving':'Walking')||'Walking';
    const tempPin=!!ME.pinDropMarker;
    let savedList='';
    try{
      const arr=(ME.readSavedPinDrops?.()||[]).slice(0,8);
      savedList=arr.length?`<div class="pin-manager-list">${arr.map(p=>{const lat=Number(p?.pin?.lat),lon=Number(p?.pin?.lon);const id=String(p?.id||'');return `<div class="pin-manager-row"><div><b>${esc(p?.localDateTime||'Saved pin')}</b><span>${Number.isFinite(lat)?lat.toFixed(5):''}, ${Number.isFinite(lon)?lon.toFixed(5):''}${p?.comments?' · '+esc(String(p.comments).slice(0,42)):''}</span></div><button type="button" class="data-danger-btn" data-tools-pin-delete="${esc(id)}">Delete</button></div>`;}).join('')}</div>`:'';
    }catch(e){savedList='';}
    const measureTools=`<div class="data-card"><b>Measure Distance</b><p>Tap Measure Distance to open the overlay. Tap multiple points on the map. Snap-to finds the nearest visible asset dot.</p><small>Status: ${esc(measureStatus)}</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn ${ME.measureMode?'active':''}" data-tools-measure-start="1">Measure Distance</button><button type="button" class="data-safe-btn" data-tools-measure-clear="1">Clear measure</button></div>`;
    const pinTools=`<div class="data-card"><b>Pin drops</b><p>Hold the map for 2 seconds to drop a pin. New pins can be saved, removed, opened in Google Maps/Earth, or used for a 350 m proximity check.</p><small>Status: ${esc(pinStatus)}</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-pins-show="1">Show saved pins</button><button type="button" class="data-safe-btn" data-tools-pins-hide="1">Hide saved pins</button>${tempPin?'<button type="button" class="data-danger-btn" data-tools-temp-pin-remove="1">Remove new pin</button>':''}<button type="button" class="data-safe-btn" data-tools-pins-export="1">Export saved pins</button><button type="button" class="data-danger-btn" data-tools-pins-clear="1">Clear saved pins</button></div>${savedList}`;
    const gpsTools=`<div class="data-card"><b>GPS / Patrol mode</b><p>Walking, driving and heli modes are separate. Heli is calmer and heading based.</p><small>Current: ${esc(gpsLabel)}</small></div><div class="gps-tools-grid"><button type="button" class="data-safe-btn ${profile==='walking'?'active':''}" data-tools-gps-profile="walking">Walking</button><button type="button" class="data-safe-btn ${profile==='driving'?'active':''}" data-tools-gps-profile="driving">Driving</button><button type="button" class="data-safe-btn ${profile==='helicopter'?'active':''}" data-tools-gps-profile="helicopter">Helicopter</button></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-start-gps="1">Start / show GPS panel</button><button type="button" class="data-safe-btn" data-tools-stop-follow="1">Stop follow only</button></div>`;
    const referenceTools=`<div class="data-card"><b>Reference points</b><p>Show or hide depots and substations without cluttering the + menu.</p></div><div class="data-action-grid single"><button type="button" class="data-safe-btn ${refsMode==='all substations'?'active':''}" data-tools-reference-kind="substation">${refsMode==='all substations'?'Hide All Substations':'Show All Substations'}</button><button type="button" class="data-safe-btn ${refsMode==='all depots'?'active':''}" data-tools-reference-kind="depot">${refsMode==='all depots'?'Hide All Depots':'Show All Depots'}</button></div>`;
    const crossingTools=`<div class="data-card"><b>HV / TX crossings</b><p>${Number(xs.total||0).toLocaleString()} imported · ${Number(xs.active||0).toLocaleString()} currently shown${line?` · current: ${esc(line)}`:''}</p><small>Separate crossing layer only.</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-show-current-crossings="1">Show current circuit crossings</button><button type="button" class="data-safe-btn" data-tools-show-view-crossings="1">Show crossings in map view</button><button type="button" class="data-safe-btn" data-tools-hide-crossings="1">Hide crossings</button></div>`;
    body.innerHTML=section('toolsMeasure','Measure Distance',measureTools,measureStatus,false)+section('toolsPins','Pin drops',pinTools,pinStatus,false)+section('toolsGps','GPS / Patrol mode',gpsTools,gpsLabel,false)+section('toolsReferences','Reference points',referenceTools,refsMode==='all substations'?'Substations shown':(refsMode==='all depots'?'Depots shown':'Closed'),false)+section('toolsCrossings','HV / TX crossings',crossingTools,`${Number(xs.total||0).toLocaleString()} imported`,false);
    if(preserveScroll&&wrap){requestAnimationFrame(()=>{wrap.scrollTop=keep;});}
  };
  const oldHandle=APP.handleToolsClick;
  APP.handleToolsClick=async function(e){
    const del=e.target.closest?.('button[data-tools-pin-delete]');
    if(del){e.preventDefault();const id=String(del.dataset.toolsPinDelete||'');if(id)MapEngine?.deleteSavedPinDrop?.(id);this.renderToolsPanel(true);return;}
    const temp=e.target.closest?.('button[data-tools-temp-pin-remove]');
    if(temp){e.preventDefault();MapEngine?.removeCurrentPinDrop?.(true);this.renderToolsPanel(true);return;}
    try{return await oldHandle.call(this,e);}catch(err){try{console.warn('tools click fallback',err);}catch(_){} UI?.toast?.('Tool action failed. Try closing Tools and reopening.');}
  };
})();



/* myMap v3.1.135: Filter panel + base layer split */
(function(){
  const APP=window.LeanMapApp;
  const ME=window.MapEngine;
  if(!APP||!ME)return;
  const STORE_KEY='myMap.assetLayerState.v1';
  const esc=v=>{try{return UI?.esc?UI.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};
  const DEFAULT={
    txPoles:true,
    dxPoles:true,transformers:true,streetlights:true,pillars:true,
    crossTx:true,crossDx:true,
    depots:true,substations:true,terminals:true,
    water:true,hvCable:true,gas:true,environment:true,comms:true,
    other:true
  };
  const GROUPS=[
    {title:'Transmission',sub:'Overhead structure dots',keys:[['txPoles','Poles / structures']]},
    {title:'Distribution',sub:'Distribution asset dots',keys:[['dxPoles','Poles'],['transformers','Transformers'],['streetlights','Street lights'],['pillars','Pillars / enclosures']]},
    {title:'Crossings',sub:'Separate crossing indicators',keys:[['crossTx','Transmission crossings'],['crossDx','Distribution / HV crossings']]},
    {title:'Property',sub:'Reference points',keys:[['depots','Depots'],['substations','Substations'],['terminals','Terminals']]},
    {title:'Underground',sub:'Imported background utilities, where supported',keys:[['water','Water'],['hvCable','HV cable'],['gas','Gas'],['environment','Environment'],['comms','Comms / telco']]},
    {title:'Other',sub:'Anything not matched above',keys:[['other','Other mapped assets']]}
  ];
  const normState=function(raw){return Object.assign({},DEFAULT,raw&&typeof raw==='object'?raw:{});};
  ME.assetLayerDefaults=DEFAULT;
  ME.getAssetLayerState=function(){
    if(App.assetLayers&&typeof App.assetLayers==='object')return normState(App.assetLayers);
    let raw={};
    try{raw=JSON.parse(localStorage.getItem(STORE_KEY)||'{}')||{};}catch(e){raw={};}
    App.assetLayers=normState(raw);
    return App.assetLayers;
  };
  ME.saveAssetLayerState=function(state){
    App.assetLayers=normState(state);
    try{localStorage.setItem(STORE_KEY,JSON.stringify(App.assetLayers));}catch(e){}
    this.updateAssetLayerButton?.();
    return App.assetLayers;
  };
  ME.assetLayerEnabled=function(key){const st=this.getAssetLayerState(); return st[key]!==false;};
  ME.setAssetLayer=function(key,on){const st=this.getAssetLayerState(); if(Object.prototype.hasOwnProperty.call(DEFAULT,key)){st[key]=!!on; this.saveAssetLayerState(st);} return st;};
  ME.toggleAssetLayer=function(key){const st=this.getAssetLayerState(); if(Object.prototype.hasOwnProperty.call(DEFAULT,key)){st[key]=st[key]===false; this.saveAssetLayerState(st);} return st;};
  ME.utilityLayerKey=function(a){
    const raw=a?.raw||{};
    const t=[a?.utilityType,String(a?.kind||'').replace(/^utility-/i,''),a?.category,a?.label,a?.sourceFile,raw.utility_type,raw.UTILITY_TYPE,raw.layer,raw.LAYER,raw.asset_type,raw.ASSET_TYPE,raw.TYPE,raw.type,raw.NETWORK_TYPE,raw.network_type,raw.holder_1,raw.HOLDER_1].map(x=>String(x||'')).join(' ').toLowerCase();
    if(/water|sewer|drain|stormwater|pipe|mainname/.test(t))return 'water';
    if(/hvdistribution|high\s*voltage|hv\s*cable|underground\s*cable|ug\s*cable|power\s*cable|wp[_\s-]*052/.test(t))return 'hvCable';
    if(/\bgas\b|pressure\s*main|maop|mop|pipeline/.test(t))return 'gas';
    if(/environment|esa|bush|wetland|ramsar|flora|fauna|heritage|conservation|tec|whp|drf/.test(t))return 'environment';
    if(/comms?|telco|telecom|communications?|fibre|fiber|nbn|optic/.test(t))return 'comms';
    return 'other';
  };
  ME.assetLayerKey=function(a){
    if(!a||typeof a!=='object')return 'other';
    const raw=a.raw||{};
    const kind=String(a.kind||'').toLowerCase();
    const cat=[a.category,a.assetType,raw.TYPE,raw.type,raw.ASSET_TYPE,raw.asset_type,raw.LAYER,raw.layer,raw.FIELD_MAP_LAYER,raw.field_map_layer,a.label,a.sourceFile].map(x=>String(x||'')).join(' ').toLowerCase();
    if(kind==='hv-crossing'||/crossing/.test(cat)){
      const ct=[a.type,a.crossingType,raw.crossing_type,raw.original_crossing_type,raw.CROSSING_TYPE,raw.dx_type,raw.network_type,cat].map(x=>String(x||'')).join(' ').toUpperCase();
      return /\bTX\b|TRANSMISSION\s*(?:X|CROSS)/.test(ct)?'crossTx':'crossDx';
    }
    if(/^utility-/i.test(kind)||a.utilityType)return this.utilityLayerKey(a);
    if(kind==='depot'||/\bdepot\b/.test(cat))return 'depots';
    if(kind==='terminal'||/\bterminal\b/.test(cat))return 'terminals';
    if(kind==='substation'||/substation|substation|switchyard|zone\s*sub/.test(cat))return 'substations';
    if(kind==='dx-pole'||kind==='distribution-pole'||/distribution\s+pole|dx\s*pole|wp[_\s-]*031/.test(cat))return 'dxPoles';
    if(kind==='transformer'||/transformer|tx\s*site|kiosk|padmount|wp[_\s-]*039/.test(cat))return 'transformers';
    if(kind==='streetlight'||/street\s*light|streetlight|luminaire|lamp|wp[_\s-]*043/.test(cat))return 'streetlights';
    if(kind==='electrical-enclosure'||/pillar|enclosure|service\s*pit|wp[_\s-]*(040|041)/.test(cat))return 'pillars';
    if(kind==='structure'||kind==='tower'||kind==='pole'||kind==='transmission-structure'||/transmission\s+(structure|pole|tower)|trmsn|nameplate|line_name/.test(cat))return 'txPoles';
    return 'other';
  };
  ME.passesAssetLayers=function(a){return this.assetLayerEnabled(this.assetLayerKey(a));};
  ME.assetLayerCounts=function(){
    const counts={}; Object.keys(DEFAULT).forEach(k=>counts[k]=0);
    for(const a of (App.assets||[])){
      if(!a||a.kind==='circuit')continue;
      const k=this.assetLayerKey(a); counts[k]=(counts[k]||0)+1;
    }
    try{
      const st=HVCrossingsLayer?.stats?.();
      if(st){counts.crossDx=Math.max(counts.crossDx||0,Number(st.hv||st.dx||0));counts.crossTx=Math.max(counts.crossTx||0,Number(st.tx||0));}
    }catch(e){}
    return counts;
  };
  ME.updateAssetLayerButton=function(){
    const btn=document.getElementById('assetLayerBtn');
    const lab=document.getElementById('assetLayerLabel');
    const st=this.getAssetLayerState();
    const off=Object.keys(DEFAULT).filter(k=>st[k]===false).length;
    if(lab)lab.textContent=off?'LYR*':'LAY';
    if(btn){
      btn.classList.toggle('has-hidden-layers',off>0);
      btn.title=off?`Filter: ${off} hidden`:'Filter: all shown';
      btn.setAttribute('aria-label',btn.title);
    }
    const sub=document.getElementById('assetLayersSubtitle');
    if(sub)sub.textContent=off?`${off} hidden`:'All shown';
  };
  const oldDrawAssets=ME.drawAssets;
  ME.drawAssets=async function(assets,label='search results',fit=true,opts={}){
    if(!opts?.__assetLayerRedraw)this._lastAssetLayerDraw={assets:Array.isArray(assets)?assets.slice():assets,label,fit,opts:Object.assign({},opts)};
    const filtered=(assets||[]).filter(a=>this.passesAssetLayers(a));
    return oldDrawAssets.call(this,filtered,label,fit,opts);
  };
  const oldShowAsset=ME.showAsset;
  ME.showAsset=function(a,zoom=17){
    this._lastAssetLayerDraw={single:true,asset:a,zoom};
    if(a&&!this.passesAssetLayers(a)){
      this.clearDisplay(false);
      UI?.toast?.('That asset filter is hidden. Turn it back on in Filter.');
      return;
    }
    return oldShowAsset.call(this,a,zoom);
  };
  const oldShowReferencePoints=ME.showReferencePoints;
  ME.showReferencePoints=async function(kind='substation'){
    this._lastAssetLayerReference=String(kind||'substation').toLowerCase();
    return oldShowReferencePoints.call(this,kind);
  };
  const oldAddMarker=ME.addMarker;
  ME.addMarker=function(a,opts={}){
    if(a&&!this.passesAssetLayers(a))return null;
    return oldAddMarker.call(this,a,opts);
  };
  ME.redrawCurrentAssetLayers=async function(){
    this.updateAssetLayerButton?.();
    try{
      const cd=String(this.currentDisplay||'').toLowerCase();
      if(cd==='all depots')return await this.showReferencePoints('depot');
      if(cd==='all substations')return await this.showReferencePoints('substation');
      const req=this._lastAssetLayerDraw;
      if(req?.single)return this.showAsset(req.asset,req.zoom||17);
      if(req&&Array.isArray(req.assets))return await this.drawAssets(req.assets,req.label,req.fit,Object.assign({},req.opts,{__assetLayerRedraw:true}));
      UI?.refreshCounts?.();
      return 0;
    }catch(e){Diagnostics?.log?.('Asset layer redraw failed',String(e?.message||e));return 0;}
  };
  const patchCrossings=function(){
    const HV=window.HVCrossingsLayer;
    if(!HV||HV._assetLayerPatch132)return;
    HV._assetLayerPatch132=true;
    const oldFilter=HV.filterTypes;
    if(typeof oldFilter==='function'){
      HV.filterTypes=function(list,types){
        const base=oldFilter.call(this,list,types)||[];
        return base.filter(r=>ME.assetLayerEnabled(String(r?.type||'').toUpperCase()==='TX'?'crossTx':'crossDx'));
      };
    }
    const oldToggle=HV.toggleCircuitType;
    if(typeof oldToggle==='function'){
      HV.toggleCircuitType=async function(type,line){
        const key=String(type||'').toUpperCase()==='TX'?'crossTx':'crossDx';
        if(!ME.assetLayerEnabled(key)){UI?.toast?.(`${key==='crossTx'?'Transmission':'Distribution / HV'} crossings layer is hidden.`); return 0;}
        return oldToggle.call(this,type,line);
      };
    }
  };
  patchCrossings();
  setTimeout(patchCrossings,250);
  APP.openAssetLayersPanel=function(){
    try{this.closePlusMenu?.();this.closeCircuitPicker?.();this.closeToolsPanel?.();this.closeResetPanel?.();this.closeBaseLayersPanel?.();this.closeConductorsPanel?.();document.getElementById('statusPanel')?.classList.add('hidden');document.getElementById('assetSearchPanel')?.classList.add('hidden');}catch(e){}
    const p=document.getElementById('assetLayersPanel');
    p?.classList.remove('hidden');
    this.renderAssetLayersPanel();
  };
  APP.closeAssetLayersPanel=function(){document.getElementById('assetLayersPanel')?.classList.add('hidden');};
  APP.toggleAssetLayersPanel=function(){const p=document.getElementById('assetLayersPanel'); if(!p||p.classList.contains('hidden'))this.openAssetLayersPanel(); else this.closeAssetLayersPanel();};
  APP.renderAssetLayersPanel=function(){
    const body=document.getElementById('assetLayersBody'); if(!body)return;
    const state=ME.getAssetLayerState();
    const counts=ME.assetLayerCounts();
    const groupHtml=GROUPS.map(g=>{
      const hidden=g.keys.filter(([k])=>state[k]===false).length;
      const btns=g.keys.map(([k,label])=>{
        const on=state[k]!==false;
        const count=Number(counts[k]||0);
        return `<button type="button" class="asset-layer-toggle ${on?'active':'off'}" data-asset-layer-key="${esc(k)}"><span>${esc(label)}</span><em>${on?'ON':'OFF'} · ${count.toLocaleString()}</em></button>`;
      }).join('');
      return `<div class="asset-layer-group"><div><b>${esc(g.title)}</b><small>${hidden?hidden+' hidden':esc(g.sub)}</small></div>${btns}</div>`;
    }).join('');
    body.innerHTML=`<div class="data-card"><b>Asset filters</b><p>Turn asset categories on/off without deleting imported data. Changes apply to the current map display.</p><small>Layer selection is handled separately from asset filters.</small></div><div class="asset-layer-actions"><button type="button" class="primary" data-asset-layer-show-all>Show all</button><button type="button" data-asset-layer-hide-all>Hide all</button></div>${groupHtml}`;
    ME.updateAssetLayerButton?.();
  };
  APP.applyAssetLayerChange=async function(){
    ME.updateAssetLayerButton?.();
    this.renderAssetLayersPanel();
    await ME.redrawCurrentAssetLayers?.();
    try{
      const st=ME.getAssetLayerState();
      if(HVCrossingsLayer){
        if(st.crossTx===false&&st.crossDx===false)HVCrossingsLayer.clearActive?.({silent:true});
        else if(HVCrossingsLayer.hasActiveSelections?.())await HVCrossingsLayer.refreshActive?.({silent:true});
        HVCrossingsLayer.renderControls?.();
      }
    }catch(e){}
    UI?.refreshCounts?.();
  };
  APP.handleAssetLayersClick=async function(e){
    const keyBtn=e.target.closest?.('button[data-asset-layer-key]');
    if(keyBtn){e.preventDefault();ME.toggleAssetLayer(keyBtn.dataset.assetLayerKey||'');await this.applyAssetLayerChange();return;}
    const showAll=e.target.closest?.('button[data-asset-layer-show-all]');
    if(showAll){e.preventDefault();ME.saveAssetLayerState(DEFAULT);await this.applyAssetLayerChange();UI?.toast?.('All filters shown.');return;}
    const hideAll=e.target.closest?.('button[data-asset-layer-hide-all]');
    if(hideAll){e.preventDefault();const st={};Object.keys(DEFAULT).forEach(k=>st[k]=false);ME.saveAssetLayerState(st);await this.applyAssetLayerChange();UI?.toast?.('All filters hidden.');return;}
  };
  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    document.getElementById('assetLayerBtn')?.addEventListener('click',()=>this.toggleAssetLayersPanel());
    document.getElementById('closeAssetLayersPanel')?.addEventListener('click',()=>this.closeAssetLayersPanel());
    document.getElementById('assetLayersBody')?.addEventListener('click',e=>this.handleAssetLayersClick(e));
    ME.updateAssetLayerButton?.();
  };
  const oldClosePlus=APP.closePlusMenu;
  APP.closePlusMenu=function(){return oldClosePlus?oldClosePlus.call(this):document.getElementById('plusMenu')?.classList.add('hidden');};
  const oldClear=ME.clearDisplay;
  ME.clearDisplay=function(showToast=true){this._lastAssetLayerDraw=null;this._lastAssetLayerReference='';return oldClear.call(this,showToast);};
})();



/* myMap v3.1.135: Base map layers panel. Asset visibility is handled by Filter. */
(function(){
  const APP=window.LeanMapApp;
  const ME=window.MapEngine;
  if(!APP||!ME)return;
  APP.renderBaseLayersPanel=function(){
    try{ME.updateMapLayerButton?.();}catch(e){}
    const sub=document.getElementById('baseLayersSubtitle');
    if(sub){
      const label={street:'Normal',satellite:'Satellite',topo:'Topo'}[ME.base||'street']||'Normal';
      sub.textContent=label;
    }
  };
  APP.openBaseLayersPanel=function(){
    try{this.closePlusMenu?.();this.closeCircuitPicker?.();this.closeAssetLayersPanel?.();this.closeToolsPanel?.();this.closeResetPanel?.();this.closeConductorsPanel?.();document.getElementById('statusPanel')?.classList.add('hidden');document.getElementById('assetSearchPanel')?.classList.add('hidden');}catch(e){}
    document.getElementById('baseLayersPanel')?.classList.remove('hidden');
    this.renderBaseLayersPanel();
  };
  APP.closeBaseLayersPanel=function(){document.getElementById('baseLayersPanel')?.classList.add('hidden');};
  APP.toggleBaseLayersPanel=function(){const p=document.getElementById('baseLayersPanel'); if(!p||p.classList.contains('hidden'))this.openBaseLayersPanel(); else this.closeBaseLayersPanel();};
  APP.handleBaseLayersClick=function(e){
    const btn=e.target.closest?.('button[data-base-layer]');
    if(!btn)return;
    e.preventDefault();
    ME.setBase?.(btn.dataset.baseLayer||'street');
    this.renderBaseLayersPanel();
  };
  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    document.getElementById('layersBtn')?.addEventListener('click',()=>this.openBaseLayersPanel());
    document.getElementById('closeBaseLayersPanel')?.addEventListener('click',()=>this.closeBaseLayersPanel());
    document.getElementById('baseLayersBody')?.addEventListener('click',e=>this.handleBaseLayersClick(e));
    ME.updateMapLayerButton?.();
  };
})();



/* myMap v3.1.138: search quick menu, toggle menu, tools cleanup */
(function(){
  const APP=window.LeanMapApp;
  const ME=window.MapEngine;
  if(!APP||!ME)return;
  const esc=v=>{try{return UI?.esc?UI.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};
  APP.closeSearchQuickPanel=function(){document.getElementById('searchQuickPanel')?.classList.add('hidden');document.getElementById('magnifyBtn')?.classList.remove('active');};
  APP.openSearchQuickPanel=function(){
    try{this.closePlusMenu?.();this.closeToggleQuickPanel?.();this.closeCircuitPicker?.();this.closeAssetSearch?.();this.closeToolsPanel?.();this.closeResetPanel?.();this.closeConductorsPanel?.();document.getElementById('statusPanel')?.classList.add('hidden');}catch(e){}
    document.getElementById('searchQuickPanel')?.classList.remove('hidden');
    document.getElementById('magnifyBtn')?.classList.add('active');
  };
  APP.toggleSearchQuickPanel=function(){const p=document.getElementById('searchQuickPanel'); if(!p||p.classList.contains('hidden'))this.openSearchQuickPanel(); else this.closeSearchQuickPanel();};

  APP.closeToggleQuickPanel=function(){document.getElementById('toggleQuickPanel')?.classList.add('hidden');document.getElementById('nearbyBtn')?.classList.remove('active');};
  APP.openToggleQuickPanel=function(){
    try{this.closePlusMenu?.();this.closeSearchQuickPanel?.();this.closeCircuitPicker?.();this.closeAssetSearch?.();this.closeToolsPanel?.();this.closeResetPanel?.();this.closeConductorsPanel?.();document.getElementById('statusPanel')?.classList.add('hidden');}catch(e){}
    document.getElementById('toggleQuickPanel')?.classList.remove('hidden');
    document.getElementById('nearbyBtn')?.classList.add('active');
  };
  APP.toggleToggleQuickPanel=function(){const p=document.getElementById('toggleQuickPanel'); if(!p||p.classList.contains('hidden'))this.openToggleQuickPanel(); else this.closeToggleQuickPanel();};

  const oldClosePlus=APP.closePlusMenu;
  APP.closePlusMenu=function(){ this.closeSearchQuickPanel?.(); this.closeToggleQuickPanel?.(); return oldClosePlus?oldClosePlus.call(this):undefined; };

  const oldOpenCircuitPicker=APP.openCircuitPicker;
  APP.openCircuitPicker=function(){ this.closeSearchQuickPanel?.(); this.closeToggleQuickPanel?.(); return oldOpenCircuitPicker.apply(this,arguments); };
  const oldOpenAssetSearch=APP.openAssetSearch;
  APP.openAssetSearch=function(){ this.closeSearchQuickPanel?.(); this.closeToggleQuickPanel?.(); return oldOpenAssetSearch.apply(this,arguments); };
  const oldOpenBaseLayersPanel=APP.openBaseLayersPanel;
  APP.openBaseLayersPanel=function(){ this.closeSearchQuickPanel?.(); this.closeToggleQuickPanel?.(); return oldOpenBaseLayersPanel.apply(this,arguments); };
  const oldOpenAssetLayersPanel=APP.openAssetLayersPanel;
  APP.openAssetLayersPanel=function(){ this.closeSearchQuickPanel?.(); this.closeToggleQuickPanel?.(); return oldOpenAssetLayersPanel.apply(this,arguments); };
  const oldOpenToolsPanel=APP.openToolsPanel;
  APP.openToolsPanel=function(){ this.closeSearchQuickPanel?.(); this.closeToggleQuickPanel?.(); return oldOpenToolsPanel.apply(this,arguments); };

  APP.openToolsPanel=function(){
    try{this.closePlusMenu?.();this.closeCircuitPicker?.();this.closeResetPanel?.();this.closeConductorsPanel?.();document.getElementById('assetSearchPanel')?.classList.add('hidden');}catch(e){}
    if(!this.toolsSectionOpen||typeof this.toolsSectionOpen!=='object')this.toolsSectionOpen={};
    if(!Object.keys(this.toolsSectionOpen).length){this.toolsSectionOpen={toolsMeasure:false,toolsPins:false,toolsShowAll:false};}
    document.getElementById('toolsPanel')?.classList.remove('hidden');
    this.renderToolsPanel(false);
    setTimeout(()=>this.renderToolsPanel(true),60);
  };

  APP.renderToolsPanel=function(preserveScroll=false){
    const body=document.getElementById('toolsBody'); if(!body)return;
    const wrap=document.querySelector('#toolsPanel .tools-body');
    const keep=preserveScroll&&wrap?wrap.scrollTop:0;
    if(!this.toolsSectionOpen||typeof this.toolsSectionOpen!=='object')this.toolsSectionOpen={};
    const measureStatus=ME.measureStatusLabel?.()||'off';
    const pinStatus=ME.pinDropStatusLabel?.()||'none saved';
    const refsMode=String(ME.currentDisplay||'').toLowerCase();
    const section=(key,title,html,sub='',open=false)=>{
      const state=this.toolsSectionOpen||{};
      const has=Object.prototype.hasOwnProperty.call(state,key);
      const isOpen=has?!!state[key]:!!open;
      return `<div class="data-section collapsible-section tools-section"><button type="button" class="section-toggle" data-tools-section-key="${esc(key)}"><span class="pm-box">${isOpen?'−':'+'}</span><span><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</span></button>${isOpen?`<div class="section-drop">${html}</div>`:''}</div>`;
    };
    let savedList='';
    try{
      const arr=(ME.readSavedPinDrops?.()||[]).slice(0,8);
      savedList=arr.length?`<div class="pin-manager-list">${arr.map(p=>{const lat=Number(p?.pin?.lat),lon=Number(p?.pin?.lon);const id=String(p?.id||'');return `<div class="pin-manager-row"><div><b>${esc(p?.localDateTime||'Saved pin')}</b><span>${Number.isFinite(lat)?lat.toFixed(5):''}, ${Number.isFinite(lon)?lon.toFixed(5):''}${p?.comments?' · '+esc(String(p.comments).slice(0,42)):''}</span></div><button type="button" class="data-danger-btn" data-tools-pin-delete="${esc(id)}">Delete</button></div>`;}).join('')}</div>`:'';
    }catch(e){savedList='';}
    const tempPin=!!ME.pinDropMarker;
    const measureTools=`<div class="data-card"><b>Measure Distance</b><p>Tap Measure Distance to open the overlay. Tap multiple points on the map. Snap-to finds the nearest visible asset dot.</p><small>Status: ${esc(measureStatus)}</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn ${ME.measureMode?'active':''}" data-tools-measure-start="1">Measure Distance</button><button type="button" class="data-safe-btn" data-tools-measure-clear="1">Clear measure</button></div>`;
    const pinTools=`<div class="data-card"><b>Pin drops</b><p>Hold the map for 2 seconds to drop a pin. New pins can be saved, removed, opened in Google Maps/Earth, or used for a 350 m proximity check.</p><small>Status: ${esc(pinStatus)}</small></div><div class="data-action-grid single"><button type="button" class="data-safe-btn" data-tools-pins-show="1">Show saved pins</button><button type="button" class="data-safe-btn" data-tools-pins-hide="1">Hide saved pins</button>${tempPin?'<button type="button" class="data-danger-btn" data-tools-temp-pin-remove="1">Remove new pin</button>':''}<button type="button" class="data-safe-btn" data-tools-pins-export="1">Export saved pins</button><button type="button" class="data-danger-btn" data-tools-pins-clear="1">Clear saved pins</button></div>${savedList}`;
    const showAllTools=`<div class="data-card"><b>Show all</b><p>Quickly show depots or substations without cluttering the main map.</p></div><div class="data-action-grid single"><button type="button" class="data-safe-btn ${refsMode==='all substations'?'active':''}" data-tools-reference-kind="substation">${refsMode==='all substations'?'Hide All Substations':'Show All Substations'}</button><button type="button" class="data-safe-btn ${refsMode==='all depots'?'active':''}" data-tools-reference-kind="depot">${refsMode==='all depots'?'Hide All Depots':'Show All Depots'}</button></div>`;
    body.innerHTML=section('toolsMeasure','Measure Distance',measureTools,measureStatus,false)+section('toolsPins','Pin drops',pinTools,pinStatus,false)+section('toolsShowAll','Show all',showAllTools,refsMode==='all substations'?'Substations shown':(refsMode==='all depots'?'Depots shown':'Closed'),false);
    if(preserveScroll&&wrap){requestAnimationFrame(()=>{wrap.scrollTop=keep;});}
  };

  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    const rebind=(id,handler)=>{
      const old=document.getElementById(id);
      if(!old)return null;
      const fresh=old.cloneNode(true);
      old.replaceWith(fresh);
      fresh.addEventListener('click',handler);
      return fresh;
    };
    rebind('magnifyBtn',()=>this.toggleSearchQuickPanel());
    rebind('nearbyBtn',()=>this.toggleToggleQuickPanel());
    document.getElementById('searchQuickAssetsBtn')?.addEventListener('click',()=>{this.closeSearchQuickPanel();this.openAssetSearch();});
    document.getElementById('searchQuickCircuitsBtn')?.addEventListener('click',()=>{this.closeSearchQuickPanel();this.openCircuitPicker();});
    document.getElementById('toggleNearbyAssetsBtn')?.addEventListener('click',async()=>{this.closeToggleQuickPanel();await ME.showNearbyAssets?.();});
    document.getElementById('toggleMapLayersBtn')?.addEventListener('click',()=>{this.closeToggleQuickPanel();this.openBaseLayersPanel();});
    document.getElementById('toggleMapFiltersBtn')?.addEventListener('click',()=>{this.closeToggleQuickPanel();this.openAssetLayersPanel();});
  };
})();



/* myMap v3.1.138: remove circuit asset-search shortcut, move conductors to search, settings closes other menus */
(function(){
  const APP=window.LeanMapApp;
  if(!APP)return;
  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    const rebind=(id,handler)=>{
      const old=document.getElementById(id);
      if(!old)return null;
      const fresh=old.cloneNode(true);
      old.replaceWith(fresh);
      fresh.addEventListener('click',handler);
      return fresh;
    };
    rebind('plusBtn',()=>{
      this.closeSearchQuickPanel?.();
      this.closeToggleQuickPanel?.();
      this.closeCircuitPicker?.();
      this.closeAssetSearch?.();
      this.closeBaseLayersPanel?.();
      this.closeAssetLayersPanel?.();
      const menu=document.getElementById('plusMenu');
      if(menu?.classList.contains('hidden')) this.togglePlusMenu?.();
      else this.closePlusMenu?.();
    });
    document.getElementById('searchQuickConductorsBtn')?.addEventListener('click',()=>{this.closeSearchQuickPanel?.();this.openConductorsPanel?.();});
    document.getElementById('assetSearchFromCircuitBtn')?.remove();
    document.getElementById('layersBtn')?.closest('button')?.remove?.();
    document.getElementById('conductorBtn')?.closest('button')?.remove?.();
  };
})();
window.addEventListener('DOMContentLoaded',()=>LeanMapApp.boot());


/* myMap v3.1.170: keep right-side menu popups above the Patrol overlay */
(function(){
  if(window.__myMapPopupLimitV157)return;
  window.__myMapPopupLimitV157=true;
  let raf=0;
  function applyPopupBottomLimit(){
    raf=0;
    try{
      const root=document.documentElement;
      const panel=document.getElementById('gpsPatrolPanel');
      let value='calc(10px + var(--safe-bottom))';
      if(panel && !panel.classList.contains('hidden')){
        const r=panel.getBoundingClientRect();
        const h=window.innerHeight||document.documentElement.clientHeight||0;
        if(r && r.height>30 && r.top>0 && r.top<h-40){
          value=Math.max(12,Math.ceil(h-r.top+8))+'px';
        }
      }
      root.style.setProperty('--mymap-popup-bottom-stop',value);
    }catch(e){}
  }
  function schedulePopupBottomLimit(){
    if(raf)return;
    raf=requestAnimationFrame(applyPopupBottomLimit);
  }
  window.myMapUpdatePopupLimits=schedulePopupBottomLimit;
  window.addEventListener('resize',schedulePopupBottomLimit,{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(schedulePopupBottomLimit,180),{passive:true});
  document.addEventListener('click',()=>setTimeout(schedulePopupBottomLimit,80),true);
  document.addEventListener('transitionend',schedulePopupBottomLimit,true);
  setTimeout(schedulePopupBottomLimit,0);
  setTimeout(schedulePopupBottomLimit,350);
  try{
    const hook=()=>{
      const panel=document.getElementById('gpsPatrolPanel');
      if(panel)new MutationObserver(schedulePopupBottomLimit).observe(panel,{attributes:true,attributeFilter:['class','style']});
      schedulePopupBottomLimit();
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hook,{once:true}); else hook();
  }catch(e){}
})();


/* myMap v3.1.170: map buttons close the current popup menu, GPS excluded */
(function(){
  const APP=window.LeanMapApp;
  if(!APP||APP.__mapButtonCloseMenusV158)return;
  APP.__mapButtonCloseMenusV158=true;

  APP.closeMapMenuPopups=function(){
    try{this.closePlusMenu?.();}catch(e){}
    try{this.closeSearchQuickPanel?.();}catch(e){}
    try{this.closeToggleQuickPanel?.();}catch(e){}
    try{this.closeCircuitPicker?.();}catch(e){}
    try{this.closeAssetSearch?.();}catch(e){}
    try{this.closeBaseLayersPanel?.();}catch(e){}
    try{this.closeAssetLayersPanel?.();}catch(e){}
    try{this.closeToolsPanel?.();}catch(e){}
    try{this.closeResetPanel?.();}catch(e){}
    try{this.closeConductorsPanel?.();}catch(e){}
    try{document.getElementById('statusPanel')?.classList.add('hidden');}catch(e){}
    try{
      document.getElementById('magnifyBtn')?.classList.remove('active');
      document.getElementById('nearbyBtn')?.classList.remove('active');
      document.getElementById('plusBtn')?.classList.remove('active');
    }catch(e){}
    try{window.myMapUpdatePopupLimits?.();}catch(e){}
  };

  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    const rebind=(id,handler)=>{
      const old=document.getElementById(id);
      if(!old)return null;
      const fresh=old.cloneNode(true);
      old.replaceWith(fresh);
      fresh.addEventListener('click',handler);
      return fresh;
    };
    rebind('magnifyBtn',()=>{
      const p=document.getElementById('searchQuickPanel');
      const wasOpen=!!(p&&!p.classList.contains('hidden'));
      this.closeMapMenuPopups?.();
      if(!wasOpen)this.openSearchQuickPanel?.();
    });
    rebind('nearbyBtn',()=>{
      const p=document.getElementById('toggleQuickPanel');
      const wasOpen=!!(p&&!p.classList.contains('hidden'));
      this.closeMapMenuPopups?.();
      if(!wasOpen)this.openToggleQuickPanel?.();
    });
    rebind('plusBtn',()=>{
      const p=document.getElementById('plusMenu');
      const wasOpen=!!(p&&!p.classList.contains('hidden'));
      this.closeMapMenuPopups?.();
      if(!wasOpen)this.togglePlusMenu?.();
    });
    // GPS button is deliberately not rebound here. It keeps its own behaviour and does not close menus.
  };
})();


/* myMap v3.1.170: map menu close also closes HV/TX crossing menu */
(function(){
  const APP=window.LeanMapApp;
  if(!APP||APP.__crossingMenuCloseV166)return;
  APP.__crossingMenuCloseV166=true;
  const closeCrossings=()=>{
    try{
      const HV=window.HVCrossingsLayer;
      if(HV)HV.controlsOpen=false;
      document.getElementById('hvTxTogglePanel')?.classList.add('hidden');
      document.getElementById('hvTxAlertBtn')?.classList.remove('active');
    }catch(e){}
  };
  const old=APP.closeMapMenuPopups;
  APP.closeMapMenuPopups=function(){
    const r=old?old.apply(this,arguments):undefined;
    closeCrossings();
    return r;
  };
  document.addEventListener('click',e=>{
    try{
      const t=e.target;
      if(t?.closest?.('#hvTxAlertBtn,#hvTxTogglePanel,.lean-left-rail,.gps-patrol-panel,.leaflet-popup'))return;
      closeCrossings();
    }catch(_e){}
  },true);
})();


/* myMap v3.1.170: Search Distribution under magnifying glass */
(function(){
  const APP=window.LeanMapApp;
  if(!APP||APP.__searchDistributionV167)return;
  APP.__searchDistributionV167=true;

  const esc=v=>{try{return UI?.esc?UI.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};

  APP.isDistributionSearchAsset=function(a){
    if(!a||typeof a!=='object')return false;
    const kind=String(a.kind||'').toLowerCase();
    if(kind==='substation'||kind==='terminal'||kind==='depot')return true;
    if(kind==='dx-pole'||kind==='distribution-pole'||kind==='transformer'||kind==='streetlight'||kind==='pillar'||kind==='enclosure')return true;
    if(/^utility-/i.test(kind))return false;
    const raw=a.raw||{};
    const text=[
      kind,a.category,a.type,a.label,a.assetType,a.materialCategory,a.sourceFile,a.sourcePath,a.layer,a.line,
      raw.kind,raw.KIND,raw.category,raw.CATEGORY,raw.type,raw.TYPE,raw.ASSET_TYPE,raw.asset_type,
      raw.FEATURE_TYPE,raw.feature_type,raw.layer,raw.LAYER,raw.source_layer,raw.SOURCE_LAYER,
      raw.EQUIPMENT_TYPE,raw.equipment_type,raw.EQUIP_TYPE,raw.equip_type,raw.CLASS,raw.class,
      raw.NETWORK,raw.network,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.DEPOT_NAME,
      raw.SEARCH_FIELD,raw.NAME,raw.name,raw.DESCRIPTION,raw.description
    ].map(v=>String(v||'')).join(' ').toUpperCase();
    if(/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|DEPOT|\bZONE\s*SUB\b/.test(text))return true;
    if(/DISTRIBUTION|DIST\b|DX\b|DISTRIBUTION[_\s-]*POLE|DX[_\s-]*POLE|TRANSFORMER|TX\b|PILLAR|ENCLOSURE|STREET\s*LIGHT|STREETLIGHT|SERVICE\s*PILLAR|MINI\s*PILLAR|LV\s*PILLAR|HV\s*CABLE|UNDERGROUND\s*HV|UG\s*HV|CABLE\s*PIT|DISTRIBUTION\s*ASSET/.test(text))return true;
    // Keep miscellaneous transmission structures out of Distribution search.
    if(kind==='structure'||kind==='circuit'||(SearchEngine?.lineRefsForAsset?.(a,true)||[]).length)return false;
    return false;
  };

  APP.setAssetSearchMode=function(mode='assets'){
    this.assetSearchMode=(mode==='distribution')?'distribution':'assets';
    const panel=document.getElementById('assetSearchPanel');
    const title=panel?.querySelector?.('.panel-head b');
    const sub=panel?.querySelector?.('.panel-head span');
    const input=document.getElementById('assetSearchInput');
    const box=document.getElementById('assetSearchResults');
    if(this.assetSearchMode==='distribution'){
      if(title)title.textContent='Search Distribution';
      if(sub)sub.textContent='Dx assets · depots · substations';
      if(input)input.placeholder='Pole / transformer / pillar';
      if(box)box.innerHTML='<div class="tiny-note">Distribution only: poles, transformers, pillars/enclosures, streetlights, depots, substations and terminals.</div>';
    }else{
      if(title)title.textContent='Asset search';
      if(sub)sub.textContent='Search saved assets';
      if(input)input.placeholder='Line / structure / asset';
      if(box)box.innerHTML='<div class="tiny-note">Type a structure, circuit, substation, depot, transformer, or asset name.</div>';
    }
  };

  APP.openAssetSearch=function(mode='assets'){
    this.assetSearchMode=(mode==='distribution')?'distribution':'assets';
    try{
      this.closePlusMenu?.();
      this.closeSearchQuickPanel?.();
      this.closeToggleQuickPanel?.();
      this.closeCircuitPicker?.();
      this.closeToolsPanel?.();
      this.closeResetPanel?.();
      this.closeConductorsPanel?.();
      this.closeBaseLayersPanel?.();
      this.closeAssetLayersPanel?.();
      document.getElementById('statusPanel')?.classList.add('hidden');
    }catch(e){}
    document.getElementById('assetSearchPanel')?.classList.remove('hidden');
    this.setAssetSearchMode(this.assetSearchMode);
    setTimeout(()=>document.getElementById('assetSearchInput')?.focus(),30);
  };

  APP.runAssetSearch=function(){
    const q=document.getElementById('assetSearchInput')?.value||'';
    const box=document.getElementById('assetSearchResults'); if(!box)return;
    const distribution=this.assetSearchMode==='distribution';
    if(!q.trim()){
      box.innerHTML=distribution
        ? '<div class="tiny-note">Search distribution poles, transformers, pillars/enclosures, streetlights, depots, substations and terminals.</div>'
        : '<div class="tiny-note">Type a structure, circuit, substation, depot, transformer, or asset name.</div>';
      return;
    }
    const opts=distribution
      ? {scopeHint:{transmission:false,dxPoles:true,transformers:true,misc:true},resultFilter:(r)=>r?.type==='asset'&&this.isDistributionSearchAsset(r.asset)}
      : {scopeHint:{transmission:true,dxPoles:true,transformers:true,misc:true}};
    const rows=SearchEngine.search(q,distribution?35:25,opts);
    if(!rows.length){
      box.innerHTML=distribution?'<div class="tiny-note">No distribution results.</div>':'<div class="tiny-note">No results.</div>';
      return;
    }
    box.innerHTML=rows.map((r,i)=>{
      const kind=r.kind||r.asset?.kind||'asset';
      const label=distribution?`${r.subtitle||kind}`:(r.subtitle||kind);
      return `<div class="result-card"><b>${esc(r.title||r.line||'Result')}</b><span>${esc(label)}</span><button type="button" data-i="${i}">Map</button></div>`;
    }).join('');
    box.querySelectorAll('button[data-i]').forEach(btn=>btn.addEventListener('click',async()=>{
      const r=rows[Number(btn.dataset.i)];
      this.closeAssetSearch();
      try{
        if(r.type==='circuit'||r.line)await MapEngine.showCircuit(r.line);
        else if(r.asset)MapEngine.showAsset(r.asset);
        UI.refreshCounts();
      }catch(err){Diagnostics.capture(err);UI.toast('Map result failed.');}
    }));
  };

  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    const btn=document.getElementById('searchQuickDistributionBtn');
    if(btn&&!btn.__distBound){
      btn.__distBound=true;
      btn.addEventListener('click',()=>{this.closeSearchQuickPanel?.();this.openAssetSearch?.('distribution');});
    }
    const assetBtn=document.getElementById('searchQuickAssetsBtn');
    if(assetBtn&&!assetBtn.__assetModeBound){
      assetBtn.__assetModeBound=true;
      assetBtn.addEventListener('click',()=>{this.closeSearchQuickPanel?.();this.openAssetSearch?.('assets');});
    }
  };
})();


/* myMap v3.1.170: final search menu order + transmission/distribution/address modes */
(function(){
  const APP=window.LeanMapApp;
  if(!APP||APP.__searchMenuFinalV168)return;
  APP.__searchMenuFinalV168=true;

  const esc=v=>{try{return UI?.esc?UI.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};

  APP.isTransmissionSearchAsset=function(a){
    if(!a||typeof a!=='object')return false;
    const kind=String(a.kind||'').toLowerCase();
    if(kind==='substation'||kind==='terminal'||kind==='depot')return true;
    if(kind==='dx-pole'||kind==='distribution-pole'||kind==='transformer'||kind==='streetlight'||kind==='pillar'||kind==='enclosure'||/^utility-/i.test(kind))return false;
    if(kind==='structure'||kind==='tower'||kind==='pole'||kind==='transmission-pole'||kind==='transmission-tower')return true;
    if((SearchEngine?.lineRefsForAsset?.(a,true)||[]).length)return true;
    const raw=a.raw||{};
    const text=[kind,a.category,a.type,a.label,a.sourceFile,a.sourcePath,a.line,raw.TYPE,raw.type,raw.ASSET_TYPE,raw.asset_type,raw.FEATURE_TYPE,raw.feature_type,raw.LAYER,raw.layer,raw.NETWORK,raw.network].map(v=>String(v||'')).join(' ').toUpperCase();
    if(/DISTRIBUTION|DIST\b|DX\b|TRANSFORMER|PILLAR|ENCLOSURE|STREET\s*LIGHT|STREETLIGHT|SERVICE\s*PILLAR|LV\s*PILLAR/.test(text))return false;
    return /TRANSMISSION|TOWER|STRUCTURE|POLE|CIRCUIT|LINE/.test(text);
  };

  const oldSetMode=APP.setAssetSearchMode;
  APP.setAssetSearchMode=function(mode='transmission'){
    this.assetSearchMode=(mode==='distribution')?'distribution':(mode==='assets'?'transmission':(mode==='transmission'?'transmission':'transmission'));
    const panel=document.getElementById('assetSearchPanel');
    const title=panel?.querySelector?.('.panel-head b');
    const sub=panel?.querySelector?.('.panel-head span');
    const input=document.getElementById('assetSearchInput');
    const box=document.getElementById('assetSearchResults');
    if(this.assetSearchMode==='distribution'){
      if(title)title.textContent='Search Distribution';
      if(sub)sub.textContent='Dx assets · depots · substations';
      if(input)input.placeholder='Pole / transformer / pillar';
      if(box)box.innerHTML='<div class="tiny-note">Distribution only: poles, transformers, pillars/enclosures, streetlights, depots, substations and terminals.</div>';
      return;
    }
    if(title)title.textContent='Search Transmission';
    if(sub)sub.textContent='Transmission assets only';
    if(input)input.placeholder='Line / structure / tower';
    if(box)box.innerHTML='<div class="tiny-note">Search transmission poles/towers plus depots, substations and terminals. Distribution assets are excluded.</div>';
  };

  APP.openAssetSearch=function(mode='transmission'){
    this.assetSearchMode=(mode==='distribution')?'distribution':'transmission';
    try{
      this.closePlusMenu?.();
      this.closeSearchQuickPanel?.();
      this.closeToggleQuickPanel?.();
      this.closeCircuitPicker?.();
      this.closeToolsPanel?.();
      this.closeResetPanel?.();
      this.closeConductorsPanel?.();
      this.closeBaseLayersPanel?.();
      this.closeAssetLayersPanel?.();
      window.AddressSearch?.close?.();
      document.getElementById('statusPanel')?.classList.add('hidden');
      document.getElementById('hvTxTogglePanel')?.classList.add('hidden');
      document.getElementById('hvTxAlertBtn')?.classList.remove('active');
      if(window.HVCrossingsLayer)window.HVCrossingsLayer.controlsOpen=false;
    }catch(e){}
    document.getElementById('assetSearchPanel')?.classList.remove('hidden');
    this.setAssetSearchMode(this.assetSearchMode);
    setTimeout(()=>document.getElementById('assetSearchInput')?.focus(),30);
  };

  APP.runAssetSearch=function(){
    const q=document.getElementById('assetSearchInput')?.value||'';
    const box=document.getElementById('assetSearchResults'); if(!box)return;
    const distribution=this.assetSearchMode==='distribution';
    const transmission=!distribution;
    if(!q.trim()){
      box.innerHTML=distribution
        ? '<div class="tiny-note">Search distribution poles, transformers, pillars/enclosures, streetlights, depots, substations and terminals.</div>'
        : '<div class="tiny-note">Search transmission poles/towers plus depots, substations and terminals. Distribution assets are excluded.</div>';
      return;
    }
    const opts=distribution
      ? {scopeHint:{transmission:false,dxPoles:true,transformers:true,misc:true},resultFilter:(r)=>r?.type==='asset'&&this.isDistributionSearchAsset?.(r.asset)}
      : {scopeHint:{transmission:true,dxPoles:false,transformers:false,misc:false},resultFilter:(r)=>r?.type==='asset'&&this.isTransmissionSearchAsset?.(r.asset)};
    const rows=SearchEngine.search(q,35,opts);
    if(!rows.length){
      box.innerHTML=distribution?'<div class="tiny-note">No distribution results.</div>':'<div class="tiny-note">No transmission results.</div>';
      return;
    }
    box.innerHTML=rows.map((r,i)=>`<div class="result-card"><b>${esc(r.title||r.line||'Result')}</b><span>${esc(r.subtitle||r.kind||'')}</span><button type="button" data-i="${i}">Map</button></div>`).join('');
    box.querySelectorAll('button[data-i]').forEach(btn=>btn.addEventListener('click',async()=>{
      const r=rows[Number(btn.dataset.i)];
      this.closeAssetSearch();
      try{
        if(r.type==='circuit'||r.line)await MapEngine.showCircuit(r.line);
        else if(r.asset)MapEngine.showAsset(r.asset);
        UI.refreshCounts();
      }catch(err){Diagnostics.capture(err);UI.toast('Map result failed.');}
    }));
  };

  const oldCloseMapMenu=APP.closeMapMenuPopups;
  APP.closeMapMenuPopups=function(){
    const out=oldCloseMapMenu?oldCloseMapMenu.apply(this,arguments):undefined;
    try{window.AddressSearch?.close?.();}catch(e){}
    return out;
  };

  const oldBind=APP.bind;
  APP.bind=function(){
    oldBind.call(this);
    const setText=(id,text)=>{const b=document.getElementById(id);if(b)b.textContent=text;};
    setText('searchQuickAssetsBtn','Search Transmission');
    setText('searchQuickCircuitsBtn','Show Circuits');
    setText('searchQuickConductorsBtn','Search Conductors');
    setText('searchQuickDistributionBtn','Search Distribution');
    setText('searchQuickAddressBtn','Search Address');

    const rebind=(id,handler)=>{
      const old=document.getElementById(id);
      if(!old)return null;
      const fresh=old.cloneNode(true);
      old.replaceWith(fresh);
      fresh.addEventListener('click',handler);
      return fresh;
    };
    rebind('searchQuickAssetsBtn',()=>{this.closeSearchQuickPanel?.();this.openAssetSearch?.('transmission');});
    rebind('searchQuickCircuitsBtn',()=>{this.closeSearchQuickPanel?.();this.openCircuitPicker?.();});
    rebind('searchQuickConductorsBtn',()=>{this.closeSearchQuickPanel?.();this.openConductorsPanel?.();});
    rebind('searchQuickDistributionBtn',()=>{this.closeSearchQuickPanel?.();this.openAssetSearch?.('distribution');});
    rebind('searchQuickAddressBtn',()=>{this.closeSearchQuickPanel?.();window.AddressSearch?.open?.();});
  };
})();


/* myMap v3.1.170: Clear Map Display also removes address search pin */
(function(){
  const APP=window.LeanMapApp;
  if(!APP||APP.__addressClearMapV170)return;
  APP.__addressClearMapV170=true;
  const clearAddressPin=()=>{try{window.AddressSearch?.clear?.();}catch(e){}};
  document.addEventListener('click',e=>{
    try{
      if(e.target?.closest?.('#clearMapDisplayBtn,button[data-clear-display-map]')){
        setTimeout(clearAddressPin,0);
      }
    }catch(_e){}
  },true);
})();
