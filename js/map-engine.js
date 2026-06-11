const MapEngine={
  map:null, layers:{}, markerLayer:null, routeLayer:null, connectedLineLayer:null, utilityLayer:null, userMarker:null, gpsWatchId:null, gpsMode:'free', gpsProfile:'walking', gpsLast:null, gpsError:false, base:'street', satellite:false, drawing:false, drawToken:0, mapRenderer:null, currentDisplay:'none', currentCircuit:null, currentCircuits:[], currentCircuitRoutes:[], lastFullCircuitAssets:[], lastFullCircuitLabel:'', circuitDensityMode:'', gpsNearestCache:null, gpsPanelHidden:false, gpsPanelMinimized:false, gpsPendingLocateOnce:false, gpsInteractionTimer:null, gpsPingMarker:null, gpsPingTimer:null, measureLayer:null, measureMode:false, measurePoints:[], measureSnapEnabled:true, _lastMeasureInput:null, pinDropLayer:null, pinDropMarker:null, savedPinDropLayer:null, savedPinDropsVisible:true, pinDropHoldTimer:null, pinDropHoldMoved:false, breadcrumbLayer:null, breadcrumbEnabled:false, breadcrumbPoints:[], breadcrumbLastPoint:null, breadcrumbLastAt:0, gpsLastRaw:null, gpsRotateHeading:false, mapRotationDeg:0, _mapHeadingUsed:NaN, _mapRotationSmoothed:NaN, _gpsUserMoving:false, _gpsSuspendUntil:0, _gpsProgrammaticMoveUntil:0, _gpsTrackCenter:null, _gpsLastLookaheadHeading:NaN, _lastGpsViewAt:0,
  init(){
    if(!window.L){throw new Error('Leaflet failed to load. Check internet connection for map library.');}
    this.map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([-31.9523,115.8613],10);
    this.mapRenderer=L.canvas({padding:0.35});
    this.layers.street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'});
    this.layers.satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
    this.layers.topo=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenTopoMap'});
    this.layers.street.addTo(this.map);
    this.markerLayer=L.layerGroup().addTo(this.map);
    this.routeLayer=L.layerGroup().addTo(this.map);
    this.connectedLineLayer=L.layerGroup().addTo(this.map);
    this.utilityLayer=L.layerGroup().addTo(this.map);
    this.map.on('popupopen',ev=>{this.preparePopupScroll(ev);this.scheduleHeliPopupAutoClose(ev);});
    this.map.on('popupclose',()=>{try{this.map.dragging.enable();}catch(e){}});
    this.map.on('movestart zoomstart dragstart',()=>this.onGpsMapUserMovementStart());
    this.map.on('moveend dragend',()=>{this.onGpsMapUserMovementEnd();this.reapplyMapRotation();});
    this.map.on('zoomend resize',()=>{this.onZoomDensityChange();this.onGpsMapUserMovementEnd();this.reapplyMapRotation();});
    this.map.on('move zoom',()=>this.reapplyMapRotation());
    this.map.on('click',ev=>{
      if(Date.now()<(this._pinDropSuppressClickUntil||0)){try{ev?.originalEvent?.preventDefault?.();ev?.originalEvent?.stopPropagation?.();}catch(e){} return;}
      this.handleMeasureMapClick?.(ev);
    });
    this.bindMeasureDomEvents();
    this.bindPinDropHold();
    this.bindPinDropPopupActions();
    setTimeout(()=>this.renderSavedPinDrops?.(true),700);
    this.bindGpsUiControls();
    this.bindRotatedMapDragFix();
    this.loadGpsProfile();
    setTimeout(()=>{this.updateGpsButton();this.updateGpsProfileButtons();this.updateMapLayerButton?.();},50);
    setTimeout(()=>this.map.invalidateSize(),250);
    // Gutted UI: do not auto-start GPS on boot. User taps + > GPS mode when needed.
  },
  preparePopupScroll(ev){
    setTimeout(()=>{
      const root=ev?.popup?.getElement?.();
      if(!root||!window.L)return;
      const nodes=root.querySelectorAll('.leaflet-popup-content,.asset-popup,.popup-more,.popup-info-box');
      nodes.forEach(el=>{
        try{L.DomEvent.disableScrollPropagation(el);L.DomEvent.disableClickPropagation(el);}catch(e){}
      });
      root.querySelectorAll('.show-connected-circuits-btn').forEach(btn=>{
        // Single inline click handler only. Extra touch/pointer/capture handlers caused
        // double toggles on Samsung/Android preview (show -> hide -> show flicker).
        btn.dataset.connectedBound='1';
      });
      const release=()=>{try{this.map.dragging.enable();}catch(e){}};
      const hold=()=>{try{this.map.dragging.disable();}catch(e){}};
      root.querySelectorAll('.popup-more,.leaflet-popup-content').forEach(el=>{
        if(el.dataset.scrollReady==='1')return;
        el.dataset.scrollReady='1';
        el.addEventListener('touchstart',hold,{passive:true});
        el.addEventListener('touchend',release,{passive:true});
        el.addEventListener('touchcancel',release,{passive:true});
        el.addEventListener('mouseenter',hold,{passive:true});
        el.addEventListener('mouseleave',release,{passive:true});
      });
      this.refitOpenPopup();
    },0);
  },
  scheduleHeliPopupAutoClose(ev){
    // Dot popups stay open until the user closes them or opens another popup.
    // The previous heli/track 3-second timer made field dot popups disappear while checking details.
    const popup=ev?.popup;
    if(popup){try{clearTimeout(popup._mymapAutoCloseTimer);}catch(e){}}
    return;
  },
  popupOptions(){
    return {maxWidth:260,minWidth:150,autoPan:true,keepInView:false,closeOnClick:false,autoPanPaddingTopLeft:[18,88],autoPanPaddingBottomRight:[18,34]};
  },
  focusDot(a,marker,opts={}){
    if(!this.map)return;
    let ll=null;
    try{ll=marker?.getLatLng?.();}catch(e){}
    if(!ll){const p=this.markerLatLng(a); if(p)ll=L.latLng(p[0],p[1]);}
    if(!ll)return;
    const current=Number(this.map.getZoom?.()||0);
    const targetZoom=Number(opts.zoom)||Math.max(current,16);
    try{this.map.setView(ll,targetZoom,{animate:true,duration:0.18});}catch(e){try{this.map.panTo(ll,{animate:true,duration:0.18});}catch(_){}}
    // No delayed snap-back. Once the asset is loaded, user panning must stay free.
  },
  refitOpenPopup(){
    if(!this.map)return;
    const popup=this.map._popup;
    try{popup?.update?.();}catch(e){}
    try{popup?._adjustPan?.();}catch(e){}
    const root=popup?.getElement?.();
    const mapEl=this.map.getContainer?.()||document.getElementById('map');
    if(!root||!mapEl)return;
    try{
      const r=root.getBoundingClientRect();
      const m=mapEl.getBoundingClientRect();
      const topPad=72;
      const bottomPad=24;
      let dx=0,dy=0;
      if(r.left<m.left+8)dx=r.left-(m.left+8);
      else if(r.right>m.right-8)dx=r.right-(m.right-8);
      if(r.top<m.top+topPad)dy=r.top-(m.top+topPad);
      else if(r.bottom>m.bottom-bottomPad)dy=r.bottom-(m.bottom-bottomPad);
      if(dx||dy)this.map.panBy([dx,dy],{animate:true,duration:0.12});
    }catch(e){}
  },
  setBase(layer='street'){
    if(!this.map)return;
    const wanted=this.layers[layer]?layer:'street';
    for(const [name,tile] of Object.entries(this.layers)){
      if(tile&&this.map.hasLayer(tile)&&name!==wanted)this.map.removeLayer(tile);
    }
    if(this.layers[wanted]&&!this.map.hasLayer(this.layers[wanted]))this.layers[wanted].addTo(this.map);
    this.base=wanted;
    this.satellite=wanted==='satellite';
    document.querySelectorAll('[data-base-layer]').forEach(btn=>btn.classList.toggle('active',btn.dataset.baseLayer===wanted));
    this.updateMapLayerButton?.();
    const label={street:'Normal',satellite:'Satellite',topo:'Topo'}[wanted]||wanted;
    UI?.toast?.(`${label} layer on`);
  },
  updateMapLayerButton(){
    const btn=document.getElementById('layersBtn')||document.getElementById('mapLayerBtn');
    const lab=document.getElementById('mapLayerLabel');
    const base=this.base||'street';
    const short={street:'NORMAL',satellite:'SAT',topo:'TOPO'}[base]||'NORMAL';
    const long={street:'Normal',satellite:'Satellite',topo:'Topo'}[base]||'Normal';
    if(lab)lab.textContent=short;
    if(btn){
      btn.title=`Map layer: ${long}`;
      btn.setAttribute('aria-label',`Map layer: ${long}. Tap to change.`);
      btn.dataset.baseLayer=base;
      btn.classList.toggle('satellite-active',base==='satellite');
      btn.classList.toggle('topo-active',base==='topo');
    }
    document.querySelectorAll('[data-base-layer]').forEach(el=>el.classList.toggle('active',el.dataset.baseLayer===base));
  },
  cycleBase(){
    const order=['street','satellite','topo'];
    const i=Math.max(0,order.indexOf(this.base||'street'));
    this.setBase(order[(i+1)%order.length]);
  },
  toggleBase(){
    this.cycleBase();
  },
  async renderAssets(){
    // Deliberately disabled: this build must NOT auto-load every asset/dot.
    // Dots are drawn only after a search result/circuit is selected.
    this.clearDisplay(false);
    Diagnostics.log('Auto render blocked','Map stays empty until a search result is loaded.');
  },
  clearDisplay(showToast=true){
    this.drawToken=(this.drawToken||0)+1;
    this.drawing=false;
    this.markerLayer?.clearLayers();
    this.routeLayer?.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    UtilitiesEngine?.clear?.(false);
    HVCrossingsLayer?.clearActive?.({silent:true});
    this.lastDrawnAssets=[];
    App.drawnMarkers=0;
    this.currentDisplay='none';
    this.currentCircuit=null;
    this.currentCircuits=[];
    this.currentCircuitRoutes=[];
    this.lastFullCircuitAssets=[];
    this.lastFullCircuitLabel='';
    this.circuitDensityMode='';
    UI.refreshCounts?.();
    if(showToast)UI.toast('Map display cleared. Search to load dots.');
  },
  approvedDrawLabels(){
    return ['asset search result','circuit <name>','route <name>',"What's here",'current map view','patrol'];
  },
  drawAllowed(label){
    const text=String(label||'').trim();
    // Hard lock: typing/search/results/details must never draw. Only explicit map buttons pass these labels.
    return /^asset search result$/i.test(text)||/^circuit\s+.+/i.test(text)||/^multi-circuit$/i.test(text)||/^route\s+.+/i.test(text)||/^What's here$/i.test(text)||/^current map view$/i.test(text)||/^current view$/i.test(text)||/^patrol\b/i.test(text);
  },

  cancelDraw(){
    this.drawToken=(this.drawToken||0)+1;
    this.drawing=false;
  },
  assetLatLng(a){
    const lat=Number(a?.lat), lon=Number(a?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null;
  },
  assetOrderForDots(a){
    try{
      const raw=a?.raw||{};
      const vals=[a?.rawStructure,a?.structureId,raw.structure_id,raw.STRUCTURE_ID,raw.structureId,a?.id,a?.assetId,a?.globalId];
      for(const v of vals){
        const m=String(v||'').match(/(?:^|\b)T?0*(\d{1,8})(?:\b|$)/i);
        if(m){const n=Number(m[1]); if(Number.isFinite(n))return n;}
      }
    }catch(e){}
    const lat=Number(a?.lat), lon=Number(a?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)?((lat+90)*100000+(lon+180)):Infinity;
  },
  markerLatLng(a){
    const ll=this.assetLatLng(a);
    if(!ll)return null;
    const off=a&&a.__mapDotOffset;
    if(!off)return ll;
    const lat=Number(ll[0]), lon=Number(ll[1]);
    const north=Number(off.northM||0), east=Number(off.eastM||0);
    const dLat=north/111320;
    const dLon=east/(111320*Math.cos(lat*Math.PI/180)||111320);
    return [lat+dLat,lon+dLon];
  },
  mapDotIdentity(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const pole=String(a?.poleNumber||refs[0]?.pole||'').trim();
      const line=SearchEngine?.compact?.(refs[0]?.line||a?.line||'')||'';
      const parts=SearchEngine?.poleIdParts?.(pole);
      const stripped=SearchEngine?.stripZeros?.(pole)||'';
      const zeroPole=!!parts&&Number(parts.num)===0&&!parts.isBranch;
      // Public secure transmission pole files can store every PIC-PNJ/BSN/KEM point as pole "0".
      // Do not collapse those into one marker identity; fall back to the real structure id/GPS.
      if(line&&pole&&!zeroPole&&stripped&&stripped!=='0')return `${line}|P${stripped}`;
      const raw=a?.raw||{};
      const sid=String(a?.rawStructure||raw.structure_id||raw.STRUCTURE_ID||a?.structureId||a?.id||'').trim();
      const lat=Number(a?.lat), lon=Number(a?.lon);
      if(line&&sid)return `${line}|SID${SearchEngine?.compact?.(sid)||sid}|${Number.isFinite(lat)?lat.toFixed(7):''}|${Number.isFinite(lon)?lon.toFixed(7):''}`;
      if(line&&Number.isFinite(lat)&&Number.isFinite(lon))return `${line}|GPS${lat.toFixed(7)},${lon.toFixed(7)}`;
    }catch(e){}
    return String(a?.id||a?.label||a?.gisLabel||`${a?.lat||''},${a?.lon||''}`);
  },
  prepareMapDotOffsets(list=[]){
    const groups=new Map();
    for(const a of list||[]){
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))continue;
      if(a.__mapDotOffset)delete a.__mapDotOffset;
      const key=`${Number(a.lat).toFixed(7)},${Number(a.lon).toFixed(7)}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(a);
    }
    let adjusted=0;
    for(const group of groups.values()){
      if(group.length<2)continue;
      group.sort((a,b)=>(SearchEngine?.sortByStructure?.(a,b)||String(this.mapDotIdentity(a)).localeCompare(String(this.mapDotIdentity(b)))));
      const radius=4.5;
      const n=group.length;
      for(let i=0;i<n;i++){
        const angle=(2*Math.PI*i)/n - Math.PI/2;
        group[i].__mapDotOffset={eastM:Math.cos(angle)*radius,northM:Math.sin(angle)*radius,reason:'duplicate-gps-fan'};
        adjusted++;
      }
    }
    if(adjusted){
      try{Diagnostics?.log?.('Map dot fan offsets',`${adjusted} same-GPS structures offset slightly so suffix/double structures remain clickable`);}catch(e){}
    }
    return adjusted;
  },
  fitAssetList(assets=[],routes=[],maxZoom=16){
    if(!this.map)return false;
    const pts=[];
    for(const a of assets||[]){
      const ll=this.assetLatLng(a);
      if(ll)pts.push(ll);
    }
    for(const r of routes||[]){
      const coords=Array.isArray(r?.routeCoords)?r.routeCoords:[];
      if(coords.length){
        // Full route bounds are cheap enough, but sample very long routes to avoid mobile stalls.
        const step=Math.max(1,Math.floor(coords.length/120));
        for(let i=0;i<coords.length;i+=step){
          const c=coords[i];
          if(Array.isArray(c)&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1])))pts.push([Number(c[0]),Number(c[1])]);
        }
        const last=coords[coords.length-1];
        if(Array.isArray(last)&&Number.isFinite(Number(last[0]))&&Number.isFinite(Number(last[1])))pts.push([Number(last[0]),Number(last[1])]);
      }
    }
    if(!pts.length)return false;
    try{this.map.fitBounds(L.latLngBounds(pts),{padding:[28,28],maxZoom}); return true;}catch(e){return false;}
  },
  orderAssetsForViewport(list){
    if(!this.map||!Array.isArray(list)||list.length<80)return list;
    let b=null, c=null;
    try{b=this.map.getBounds(); c=this.map.getCenter();}catch(e){}
    if(!b||!c)return list;
    const dist=(a)=>{
      const lat=Number(a?.lat), lon=Number(a?.lon);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return Infinity;
      const dLat=lat-Number(c.lat), dLon=lon-Number(c.lng);
      return dLat*dLat+dLon*dLon;
    };
    return list.slice().sort((a,bx)=>{
      const ai=b.contains([Number(a.lat),Number(a.lon)])?0:1;
      const bi=b.contains([Number(bx.lat),Number(bx.lon)])?0:1;
      if(ai!==bi)return ai-bi;
      const ad=dist(a), bd=dist(bx);
      if(ad!==bd)return ad-bd;
      return SearchEngine?.sortByStructure?.(a,bx)||0;
    });
  },

  isCircuitLabel(label){
    const text=String(label||'');
    return /^circuit\s+/i.test(text)||/^multi-circuit$/i.test(text);
  },
  circuitDotModeForZoom(){
    const z=Number(this.map?.getZoom?.()||0);
    return z && z<15 ? 'sample20' : 'full';
  },
  lineKeyForAsset(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const ref=refs[0]||{};
      return SearchEngine?.compact?.(ref.line||a?.line||'')||String(a?.line||'').toUpperCase();
    }catch(e){return String(a?.line||'').toUpperCase();}
  },
  structureLabelForDot(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const pole=refs[0]?.pole||a?.poleNumber||a?.structureNumber||a?.nameplate||a?.label||'';
      const parts=SearchEngine?.poleIdParts?.(pole);
      if(parts?.norm){
        if(Number(parts.num)===0&&!parts.isBranch)return '';
        return parts.norm;
      }
      const m=String(pole||'').match(/(\d{1,6}[A-Z]{0,3}(?:\/[A-Z0-9]{1,8})?)\s*$/i)||String(pole||'').match(/(\d{1,6}[A-Z]{0,3}(?:\/[A-Z0-9]{1,8})?)/i);
      if(!m)return '';
      const label=m[1].replace(/^0+(?=\d)/,'');
      return /^0+$/.test(label)?'':label;
    }catch(e){
      const m=String(a?.poleNumber||a?.label||'').match(/(\d{1,6}[A-Z]{0,3}(?:\/[A-Z0-9]{1,8})?)/i);
      if(!m)return '';
      const label=m[1].replace(/^0+(?=\d)/,'');
      return /^0+$/.test(label)?'':label;
    }
  },
  structureNumberForDot(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const pole=refs[0]?.pole||a?.poleNumber||a?.structureNumber||a?.nameplate||a?.label||'';
      const p=SearchEngine?.poleIdParts?.(pole);
      if(p&&Number.isFinite(Number(p.num)))return Number(p.num)>0?Number(p.num):NaN;
      const m=String(pole||'').match(/(\d{1,6})/);
      const num=m?Number(m[1]):NaN;
      return Number.isFinite(num)&&num>0?num:NaN;
    }catch(e){
      const m=String(a?.poleNumber||a?.label||'').match(/(\d{1,6})/);
      const num=m?Number(m[1]):NaN;
      return Number.isFinite(num)&&num>0?num:NaN;
    }
  },
  sampleCircuitDots(list=[],every=20){
    if(!Array.isArray(list)||list.length<=30)return list||[];
    const groups=new Map();
    for(const a of list){
      const k=this.lineKeyForAsset(a)||'line';
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(a);
    }
    const out=[];
    const seen=new Set();
    const cloneWithLabel=(a,label)=>{
      if(!label)return a;
      try{return Object.assign({},a,{_sampleMarkerNum:String(label)});}catch(e){a._sampleMarkerNum=String(label);return a;}
    };
    const add=(a,label='')=>{
      const k=this.mapDotIdentity(a)||`${a?.lat},${a?.lon}`;
      if(seen.has(k))return false;
      seen.add(k);
      out.push(cloneWithLabel(a,label));
      return true;
    };
    const actualPolePart=(a)=>{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      return SearchEngine?.poleIdParts?.(refs[0]?.pole||a?.poleNumber||a?.label||a?.structure||'');
    };
    const distKm=(a,b)=>{
      const la=Number(a?.lat), lo=Number(a?.lon), lb=Number(b?.lat), lob=Number(b?.lon);
      if(!Number.isFinite(la)||!Number.isFinite(lo)||!Number.isFinite(lb)||!Number.isFinite(lob))return Infinity;
      const dy=(la-lb)*111; const dx=(lo-lob)*111*Math.cos(((la+lb)/2)*Math.PI/180);
      return Math.sqrt(dx*dx+dy*dy);
    };
    for(const group of groups.values()){
      let arr=group.slice().sort((a,b)=>SearchEngine?.sortByStructure?.(a,b)||this.assetOrderForDots(a)-this.assetOrderForDots(b));
      // Deduplicate public-secure pole files where each point can be repeated three times.
      const unique=[]; const uniqueSeen=new Set();
      for(const a of arr){const k=this.mapDotIdentity(a)||`${a?.lat},${a?.lon}`; if(uniqueSeen.has(k))continue; uniqueSeen.add(k); unique.push(a);}
      arr=unique;
      const n=arr.length;
      if(!n)continue;
      const realParts=arr.map(actualPolePart).filter(p=>p&&Number(p.num)>0);
      const hasRealNumbering=realParts.length>=Math.min(5,Math.ceil(n*0.1));
      add(arr[0],hasRealNumbering?'':(this.structureLabelForDot(arr[0])||'1'));
      let addedMiddle=0;
      if(hasRealNumbering){
        for(let i=1;i<n-1;i++){
          const a=arr[i];
          if(a?.kind==='substation'||a?.kind==='depot'){add(a);continue;}
          const num=this.structureNumberForDot(a);
          if(Number.isFinite(num)&&num>0&&every>0&&num%every===0){add(a,this.structureLabelForDot(a)||String(num));addedMiddle++;continue;}
        }
      }else{
        // No usable structure numbers, e.g. public secure PIC-PNJ/BSN/KEM records labelled 0.
        // Use sequence markers plus spatial backup markers so spur legs still get indicators.
        const interval=Math.max(8,Number(every)||20);
        for(let i=interval-1;i<n-1;i+=interval){
          if(add(arr[i],String(i+1)))addedMiddle++;
        }
        const chosen=[];
        for(const a of out){
          const ak=this.lineKeyForAsset(a)||'line';
          const gk=this.lineKeyForAsset(arr[0])||'line';
          if(ak===gk)chosen.push(a);
        }
        const tileSeen=new Set();
        for(const a of chosen){
          const lat=Number(a?.lat), lon=Number(a?.lon);
          if(Number.isFinite(lat)&&Number.isFinite(lon))tileSeen.add(`${Math.round(lat/0.055)}|${Math.round(lon/0.055)}`);
        }
        let backups=0;
        for(let i=0;i<n&&backups<70;i+=Math.max(3,Math.floor(interval/2))){
          const a=arr[i];
          const lat=Number(a?.lat), lon=Number(a?.lon);
          if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
          const tile=`${Math.round(lat/0.055)}|${Math.round(lon/0.055)}`;
          if(tileSeen.has(tile))continue;
          let near=false; for(const c of chosen){if(distKm(a,c)<3.5){near=true;break;}}
          if(near)continue;
          if(add(a,String(i+1))){tileSeen.add(tile);chosen.push(a);backups++;addedMiddle++;}
        }
      }
      if(!addedMiddle&&n>every){
        for(let i=every-1;i<n-1;i+=every){
          const a=arr[i];
          add(a,this.structureLabelForDot(a)||String(i+1));
        }
      }
      if(n>1)add(arr[n-1],hasRealNumbering?'':(this.structureLabelForDot(arr[n-1])||String(n)));
    }
    return out;
  },
  filteredAssetsForZoom(list=[],label=''){
    if(!this.isCircuitLabel(label)){this.circuitDensityMode='';return list||[];}
    this.lastFullCircuitAssets=(list||[]).slice();
    this.lastFullCircuitLabel=label;
    const mode=this.circuitDotModeForZoom();
    this.circuitDensityMode=mode;
    if(mode==='sample20')return this.sampleCircuitDots(list,20);
    return list||[];
  },
  async onZoomDensityChange(){
    if(!this.lastFullCircuitAssets?.length||!this.lastFullCircuitLabel)return;
    const next=this.circuitDotModeForZoom();
    if(next===this.circuitDensityMode)return;
    try{await this.drawAssets(this.lastFullCircuitAssets,this.lastFullCircuitLabel,false,{viewportFirst:true,densityRefresh:true});}
    catch(e){try{Diagnostics?.log?.('Circuit density refresh failed',String(e?.message||e));}catch(_){}}
    try{if(HVCrossingsLayer?.hasActiveSelections?.())HVCrossingsLayer.refreshActive({silent:true}); else HVCrossingsLayer?.renderControls?.();}catch(e){}
  },
  drawCircuitGuideLines(assets=[]){
    if(!this.routeLayer||!Array.isArray(assets)||!assets.length)return 0;
    const groups=new Map();
    for(const a of assets){
      const ll=this.assetLatLng(a); if(!ll)continue;
      const k=this.lineKeyForAsset(a)||String(a?.line||'line');
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(a);
    }
    let drawn=0;
    for(const group of groups.values()){
      const arr=group.slice().sort(SearchEngine?.sortByStructure||(()=>0));
      let chunk=[]; let prev=null;
      const flush=()=>{if(chunk.length>1){L.polyline(chunk,{weight:5,opacity:.34,color:'#d97a1d',interactive:false,lineCap:'round',lineJoin:'round'}).addTo(this.routeLayer);drawn++;} chunk=[];};
      for(const a of arr){
        const ll=this.assetLatLng(a); if(!ll)continue;
        if(prev){
          const d=SearchEngine?.distanceKm?.({lat:prev[0],lon:prev[1]},{lat:ll[0],lon:ll[1]})??0;
          if(Number.isFinite(d)&&d>8)flush();
        }
        chunk.push(ll); prev=ll;
      }
      flush();
    }
    return drawn;
  },
  markerModeFor(label,list){
    const text=String(label||'');
    // In heli/heading-up mode, DOM dots are more reliable to tap on mobile than canvas hit-testing
    // after map rotation/pan transforms. Keep them clickable, even if a circuit has many dots.
    if(this.gpsRotateHeading||this.gpsProfile==='helicopter'||this.gpsMode==='track')return 'dom-dot';
    if((/^circuit\s+/i.test(text)||/^multi-circuit$/i.test(text))&&Array.isArray(list)&&list.length>180)return 'canvas-dot';
    if(/^current map view|^What's here/i.test(text)&&Array.isArray(list)&&list.length>300)return 'canvas-dot';
    return 'dom-dot';
  },
  async drawAssets(assets,label='search results',fit=true,opts={}){
    if(!this.drawAllowed(label)){
      Diagnostics?.log?.('Blocked non-explicit map draw',label);
      UI?.toast?.('Map draw blocked. Use Load circuit, Map, or What\'s here.');
      return 0;
    }
    if(!this.markerLayer)return 0;
    if(App.safeMode && !/^asset search result$/i.test(String(label||''))){UI.toast('Safe Mode is on. Circuit/bulk map drawing is blocked.'); return 0;}
    const token=++this.drawToken;
    this.markerLayer.clearLayers();
    App.drawnMarkers=0;
    UI.refreshCounts?.();
    const baseList=(assets||[]).filter(a=>SearchEngine.passesFilters(a)&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a));
    const drawBase=this.filteredAssetsForZoom(baseList,label);
    this.prepareMapDotOffsets(drawBase);
    const list=opts.viewportFirst?this.orderAssetsForViewport(drawBase):drawBase;
    this.lastDrawnAssets=drawBase;
    const mode=this.markerModeFor(label,drawBase);
    const batch=mode==='canvas-dot'?(drawBase.length>1000?48:64):(drawBase.length>600?52:78);
    this.drawing=true;
    this.currentDisplay=label;
    let drawn=0;
    for(let i=0;i<list.length;i+=batch){
      if(token!==this.drawToken){Diagnostics?.log?.('Map draw cancelled',String(label||'')); return drawn;}
      const part=list.slice(i,i+batch);
      for(const a of part){this.addMarker(a,{mode}); drawn++;}
      App.drawnMarkers=drawn;
      if(i===0 || i%Math.max(batch*3,240)===0 || drawn>=list.length)UI.refreshCounts?.();
      await new Promise(r=>requestAnimationFrame(r));
    }
    if(token!==this.drawToken)return drawn;
    this.drawing=false;
    App.drawnMarkers=drawn;
    UI.refreshCounts?.();
    Diagnostics?.log?.('Rendered searched markers',`${drawn} markers drawn for ${label} · mode ${mode} · batch ${batch}`);
    if(fit&&drawBase.length)this.fitVisible();
    if(drawBase.length)UtilitiesEngine?.updatePanel?.('Click an asset dot to view details.');
    return drawn;
  },
  assetDotClass(a){
    const raw=String(a?.kind||'structure').toLowerCase().trim();
    const cat=String(a?.category||a?.assetType||a?.raw?.TYPE||'').toLowerCase();
    const text=[raw,cat,a?.label,a?.substation,a?.terminal,a?.raw?.SEARCH_FIELD,a?.raw?.SUBSTATION,a?.raw?.SUBSTATION_NAME,a?.raw?.TERMINAL,a?.raw?.TERMINAL_NAME,a?.raw?.TYPE].join(' ').toLowerCase();
    if(raw==='dx-pole'||raw==='distribution-pole'||/distribution\s+pole|dx\s*pole/.test(cat))return 'distribution-pole';
    if(raw==='transformer'||/transformer|tx\s*site|kiosk|padmount/.test(cat))return 'transformer';
    if(raw==='streetlight'||raw==='electrical-enclosure'||/street\s*light|streetlight|light/.test(cat))return 'streetlight';
    if(raw==='depot'||/\bdepot\b/.test(text))return 'depot';
    if(raw==='terminal'||/\bterminal\b/.test(text))return 'terminal';
    if(raw==='substation'||/\bsubstation\b|\bsub\b|switchyard|zone\s+sub/.test(text))return 'substation';
    return raw||'structure';
  },
  assetDotFill(a){
    const k=this.assetDotClass(a);
    if(k==='distribution-pole')return '#1f6f7a';
    if(k==='transformer')return '#d97706';
    if(k==='streetlight')return '#d8aa16';
    if(k==='substation')return '#f57c00';
    if(k==='terminal')return '#d32f2f';
    if(k==='depot')return '#8a5a2b';
    return '#1e6fb7';
  },
  forceDomDot(a){
    const k=this.assetDotClass(a);
    return k==='substation'||k==='terminal'||k==='depot';
  },
  addMarker(a,opts={}){
    // Main transmission/estimated dots use the blue field-dot style. Other asset types keep the same field-dot shape/size but use their own colours; substations/depots are square markers.
    const marked=!!(window.UtilitiesEngine?.hasPrecomputedMarkup?.(a));
    const visualKind=this.assetDotClass(a);
    const mode=(opts.mode||'dom-dot');
    let m;
    const ll=this.markerLatLng(a)||[Number(a.lat),Number(a.lon)];
    if(mode==='canvas-dot'&&!this.forceDomDot(a)&&window.L?.circleMarker){
      m=L.circleMarker(ll,{
        renderer:this.mapRenderer||undefined,
        radius:8.5,
        weight:3,
        opacity:0.98,
        fillOpacity:0.98,
        color:'#f7efd9',
        fillColor:this.assetDotFill(a),
        bubblingMouseEvents:false,
        interactive:true
      }).bindPopup(()=>PopupEngine.assetHtml(a),this.popupOptions());
      try{m.options.title=PopupEngine.displayTitle(a);}catch(e){}
    }else{
      const cls=['asset-dot',a.sourceType||'json',visualKind,a.kind||'structure',marked?'utility-marked':'',a.inferredMissingStructure?'inferred-missing-dot':''].filter(Boolean).join(' ');
      const sampleNum=String(a._sampleMarkerNum||'').trim();
      const html=sampleNum?`<div class="asset-dot-wrap sampled-20"><div class="${cls}"></div><div class="asset-dot-num">${sampleNum}</div></div>`:`<div class="${cls}"></div>`;
      const iconSize=sampleNum?[58,50]:[marked?30:24,marked?30:24];
      const iconAnchor=sampleNum?[29,13]:[marked?15:12,marked?12:12];
      const icon=L.divIcon({className:'',html,iconSize,iconAnchor,popupAnchor:[0,-12]});
      m=L.marker(ll,{icon,riseOnHover:true,title:PopupEngine.displayTitle(a)}).bindPopup(()=>PopupEngine.assetHtml(a),this.popupOptions());
    }
    m.on('click',()=>{App.selectedAsset=a; setTimeout(()=>this.refitOpenPopup(),80); setTimeout(()=>HVCrossingsLayer?.showBayForAsset?.(a,{silent:true}),120);});
    m.on('popupopen',()=>{App.selectedAsset=a; setTimeout(()=>UtilitiesEngine?.refreshAssetBadgePanel?.(a),40); setTimeout(()=>this.refitOpenPopup(),80);});
    this.markerLayer.addLayer(m);
    return m;
  },
  showAsset(a,zoom=17){
    if(!a)return;
    this.cancelDraw();
    this.routeLayer?.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.markerLayer?.clearLayers();
    UtilitiesEngine?.clear?.(false);
    App.drawnMarkers=0;
    if(Number.isFinite(a.lat)&&Number.isFinite(a.lon)){
      const marker=this.addMarker(a);
      App.drawnMarkers=1;
      this.lastDrawnAssets=[a];
      this.currentDisplay='asset search result';
      this.currentCircuit=null;
      this.currentCircuitRoutes=[];
      UI.refreshCounts();
      this.focusDot(a,marker,{zoom});
      marker.openPopup();
      UtilitiesEngine?.updatePanel?.('Click an asset dot to view details.');
      setTimeout(()=>UtilitiesEngine?.refreshAssetBadgePanel?.(a),80);
      setTimeout(()=>HVCrossingsLayer?.showBayForAsset?.(a,{silent:true}),140);
      UI.toast('Loaded searched asset only.');
    }else{
      UI.refreshCounts();
      UI.toast('Asset found but has no map point.');
    }
  },
  selectedLineRefForAsset(line,a){
    const wanted=SearchEngine?.compact?.(SearchEngine?.formatCircuitName?.(line)||line)||String(line||'').toUpperCase();
    const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
    let hit=refs.find(r=>(SearchEngine?.compact?.(r.line)||'')===wanted);
    if(hit)return hit;
    const direct=SearchEngine?.formatCircuitName?.(a?.line||'')||a?.line||'';
    if((SearchEngine?.compact?.(direct)||'')===wanted){
      return {line:direct,pole:a?.poleNumber||''};
    }
    return null;
  },
  inferMissingCircuitDots(line,assets=[]){
    // Pass 16: some imported WP structure sets have real gaps where every now and then
    // a tower is absent from the map.  This creates estimated placeholder dots using the same green field-dot style
    // between two confirmed GPS dots on the same circuit.  It does not create endless
    // routes and it never pretends the placeholder is source data.
    const out=[];
    const wantedLine=SearchEngine?.formatCircuitName?.(line)||line;
    const wantedKey=SearchEngine?.compact?.(wantedLine)||String(wantedLine||'').toUpperCase();
    const entries=[];
    const seen=new Set();
    for(const a of assets||[]){
      if(!a||a.inferredMissingStructure)continue;
      if(!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))continue;
      const ref=this.selectedLineRefForAsset(line,a);
      if(!ref)continue;
      const p=SearchEngine?.poleIdParts?.(ref.pole||a.poleNumber||'');
      if(!p||p.isBranch||p.suffix)continue; // do not invent A/B/G/branch legs
      const key=String(p.num);
      if(seen.has(key))continue;
      seen.add(key);
      entries.push({asset:a,ref,parts:p,num:Number(p.num),pole:String(ref.pole||a.poleNumber||'')});
    }
    entries.sort((a,b)=>a.num-b.num);
    if(entries.length<3)return out;
    const existing=new Set(entries.map(e=>e.num));
    const MAX_GAP_COUNT=8;        // max missing pole numbers created in one break
    const MAX_TOTAL_ESTIMATES=120; // hard cap for mobile safety
    const MAX_TOTAL_GAP_KM=4.0;   // prevents long missing corridors being filled
    const MAX_AVG_SPAN_KM=0.9;    // prevents false placeholders over long jumps
    const distKm=(a,b)=>SearchEngine?.distanceKm?.(a,b)??Infinity;
    for(let i=0;i<entries.length-1;i++){
      if(out.length>=MAX_TOTAL_ESTIMATES)break;
      const left=entries[i], right=entries[i+1];
      const gap=right.num-left.num-1;
      if(gap<1||gap>MAX_GAP_COUNT)continue;
      const d=distKm(left.asset,right.asset);
      if(!Number.isFinite(d)||d<=0||d>MAX_TOTAL_GAP_KM)continue;
      const avg=d/(gap+1);
      if(avg>MAX_AVG_SPAN_KM)continue;
      for(let n=left.num+1;n<right.num;n++){
        if(out.length>=MAX_TOTAL_ESTIMATES)break;
        if(existing.has(n))continue;
        const ratio=(n-left.num)/(right.num-left.num);
        const lat=Number(left.asset.lat)+(Number(right.asset.lat)-Number(left.asset.lat))*ratio;
        const lon=Number(left.asset.lon)+(Number(right.asset.lon)-Number(left.asset.lon))*ratio;
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const pole=SearchEngine?.formatPoleLike?.(left.pole||right.pole||'0000',n)||String(n).padStart(4,'0');
        const title=`${wantedLine}-${pole}`;
        const mapsUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat+','+lon)}`;
        const earthUrl=`https://earth.google.com/web/search/${encodeURIComponent(lat+','+lon)}`;
        out.push({
          id:`inferred-missing|${wantedKey}|${pole}|${left.pole}|${right.pole}`,
          sourceType:'inferred',
          sourceFile:'App inferred gap - not source data',
          sourcePath:'pass16.missing-structure-placeholder',
          kind:'structure',
          line:wantedLine,
          poleNumber:pole,
          label:`${title} · NO DATA FOUND`,
          structure:`${title} · NO DATA FOUND`,
          gisLabel:`${title} · NO DATA FOUND`,
          category:'NO DATA FOUND - estimated missing structure',
          lat,lon,
          inferredMissingStructure:true,
          inferredFrom:{before:left.pole,after:right.pole,beforeLat:left.asset.lat,beforeLon:left.asset.lon,afterLat:right.asset.lat,afterLon:right.asset.lon,method:'linear-between-confirmed-neighbour-dots'},
          raw:{
            DATA_STATUS:'NO DATA FOUND - estimated placeholder',
            LINE_NAME:wantedLine,
            NAMEPLATE_ID:pole,
            INFERRED_FROM:`${left.pole} to ${right.pole}`,
            GOOGLE_MAPS:mapsUrl,
            GOOGLE_EARTH:earthUrl,
            NOTE:'This dot was estimated by the app because the source structure record was missing or had no usable GPS. Treat location as approximate. Google Maps and Google Earth buttons use the estimated coordinate.'
          },
          searchText:`${wantedLine} ${pole} ${title} NO DATA FOUND MISSING ESTIMATED PLACEHOLDER`
        });
      }
    }
    if(out.length){
      try{Diagnostics?.log?.('Missing structure placeholders',`${wantedLine}: ${out.length} estimated blue dot(s) inserted between confirmed neighbouring structures.`);}catch(e){}
    }
    return out;
  },
  async showCircuit(line,opts={}){
    if(App.safeMode){UI.toast('Safe Mode is on. Circuit drawing blocked; search results still work.'); return;}
    const all=SearchEngine.lineAssets(line);
    const sortedConfirmed=all.filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a)).sort(SearchEngine.sortByStructure);
    const inferredMissing=this.inferMissingCircuitDots(line,sortedConfirmed);
    const sorted=[...sortedConfirmed,...inferredMissing].sort(SearchEngine.sortByStructure);
    const routes=SearchEngine.lineCircuitAssets?SearchEngine.lineCircuitAssets(line):[];
    this.currentCircuit=line;
    this.currentCircuits=[line];
    this.currentCircuitRoutes=routes||[];
    this.routeLayer.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    this.markerLayer.clearLayers();
    App.drawnMarkers=0;
    UI.refreshCounts();
    // v1.58: no crossing pre-scan before drawing asset dots. It was slow and
    // only existed to paint old warning dots. Advisory markers are drawn after.
    const preFit=this.fitAssetList(sorted,routes,16);
    this.drawCircuitGuideLines(sorted);
    await this.drawAssets(sorted,`circuit ${line}`,false,{viewportFirst:true});
    if(App.drawnMarkers>0){
      if(!preFit)this.fitVisible();
      const gapNote=inferredMissing?.length?` · ${inferredMissing.length} estimated missing green dot(s)`:'';
      UI.toast(`Loaded searched circuit: ${line} (${App.drawnMarkers} dots${gapNote}).`);
    }else if(routes.length){
      this.drawCircuits(routes);
      if(!preFit)this.fitVisible();
      UI.toast(`Loaded searched circuit line: ${line}. No pole dots found.`);
    }else{
      UI.toast(`Circuit found: ${line}, but no map points to draw.`);
    }
    try{
      await HVCrossingsLayer?.onCircuitLoaded?.(line,{silent:true});
    }catch(e){Diagnostics?.log?.('HV/TX crossing layer failed',String(e?.message||e));}
  },
  async showCircuits(lines=[],opts={}){
    if(App.safeMode){UI.toast('Safe Mode is on. Circuit drawing blocked; search results still work.'); return;}
    const rawLines=Array.isArray(lines)?lines:[lines];
    const cleaned=[]; const seen=new Set();
    for(const line of rawLines){
      const formatted=SearchEngine?.formatCircuitName?.(line)||String(line||'').trim();
      const key=SearchEngine?.compact?.(formatted)||String(formatted||'').toUpperCase();
      if(formatted&&key&&!seen.has(key)){seen.add(key);cleaned.push(formatted);}
    }
    if(!cleaned.length){UI.toast('No circuits selected.');return;}
    if(cleaned.length===1)return this.showCircuit(cleaned[0],opts);
    this.currentCircuit=cleaned[0];
    this.currentCircuits=cleaned.slice();
    this.routeLayer.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    this.markerLayer.clearLayers();
    App.drawnMarkers=0;
    UI.refreshCounts();
    const allAssets=[];
    const allRoutes=[];
    let inferredCount=0;
    for(const line of cleaned){
      const all=SearchEngine.lineAssets(line);
      const confirmed=all.filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a)).sort(SearchEngine.sortByStructure);
      const inferred=this.inferMissingCircuitDots(line,confirmed);
      inferredCount+=inferred.length;
      allAssets.push(...confirmed,...inferred);
      const routes=SearchEngine.lineCircuitAssets?SearchEngine.lineCircuitAssets(line):[];
      allRoutes.push(...(routes||[]));
    }
    const sorted=allAssets.sort((a,b)=>{
      const la=String(a?.line||''), lb=String(b?.line||'');
      const c=la.localeCompare(lb,undefined,{numeric:true,sensitivity:'base'});
      return c||SearchEngine.sortByStructure(a,b);
    });
    const preFit=this.fitAssetList(sorted,allRoutes,15);
    this.drawCircuitGuideLines(sorted);
    await this.drawAssets(sorted,`multi-circuit`,false,{viewportFirst:true});
    if(App.drawnMarkers>0){
      if(!preFit)this.fitVisible();
      this.currentDisplay='multi-circuit';
      const gapNote=inferredCount?` · ${inferredCount} estimated missing green dot(s)`:'';
      UI.toast(`Loaded ${cleaned.length} circuits (${App.drawnMarkers} dots${gapNote}).`);
    }else if(allRoutes.length){
      this.drawCircuits(allRoutes);
      this.currentCircuit=cleaned[0];
      this.currentCircuits=cleaned.slice();
      if(!preFit)this.fitVisible();
      UI.toast(`Loaded ${cleaned.length} circuit lines. No pole dots found.`);
    }else{
      UI.toast(`Selected circuits found, but no map points to draw.`);
    }
    try{await HVCrossingsLayer?.onCircuitsLoaded?.(cleaned,{silent:true});}
    catch(e){Diagnostics?.log?.('HV/TX crossing layer failed',String(e?.message||e));}
  },

  drawCircuits(routes){
    if(!this.routeLayer)return;
    let count=0;
    for(const r of routes||[]){
      if(!Array.isArray(r.routeCoords)||r.routeCoords.length<2)continue;
      if(App.safeMode)continue;
      const line=L.polyline(r.routeCoords,{weight:4,opacity:.78,color:'#e88921'});
      line.bindPopup(()=>PopupEngine.assetHtml(r),this.popupOptions());
      this.routeLayer.addLayer(line);
      count++;
    }
    App.drawnMarkers=0;
    this.currentDisplay='searched circuit route';
    UI.refreshCounts();
    Diagnostics.log('Rendered searched circuit',`${count} circuit sections drawn.`);
  },


  referenceTitle(a){
    try{return SearchEngine?.referenceName?.(a)||PopupEngine?.displayTitle?.(a)||String(a?.label||a?.substation||'Reference');}
    catch(e){return String(a?.label||a?.substation||'Reference');}
  },
  isConnectedReferenceCandidate(a){
    if(!a||typeof a!=='object')return false;
    const raw=a.raw||{};
    const kind=String(a.kind||'').toLowerCase();
    const text=[kind,a.category,a.type,a.label,a.substation,a.terminal,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.SEARCH_FIELD,raw.ABBREVIATION,raw.abbreviation,raw.CODE,raw.code,raw.SITE_CODE,raw.STATION_CODE,raw.SUBSTATION_CODE,raw.TERMINAL_CODE,Object.entries(raw).map(([k,v])=>`${k} ${v}`).join(' ')].join(' ').toUpperCase();
    if(kind==='depot'||/\bDEPOT\b/.test(text))return false;
    if(String(this.currentDisplay||'').toLowerCase()==='all substations')return true;
    const refKind=SearchEngine?.referenceKind?SearchEngine.referenceKind(a):kind;
    if(kind==='substation'||kind==='terminal'||refKind==='terminal')return true;
    if(/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|ZONE SUB|\bZONE\b|\bSUB\b|\bTER\b/.test(text))return true;
    if((raw.ABBREVIATION||raw.abbreviation||raw.ABBR||raw.abbr||raw.CODE||raw.code||raw.SUBSTATION_CODE||raw.TERMINAL_CODE||raw.STATION_CODE||raw.SITE_CODE)&&(raw.SUBSTATION||raw.SUBSTATION_NAME||raw.TERMINAL||raw.TERMINAL_NAME||raw.SEARCH_FIELD||raw.NAME||raw.TITLE))return true;
    return false;
  },
  registerPopupAsset(a){
    if(!a)return '';
    if(!this.popupAssetRegistry)this.popupAssetRegistry=new Map();
    let token=String(a.id||'').trim();
    if(!token){
      const ll=this.assetLatLng?.(a)||[];
      token=['popup',a.kind||'',a.label||a.substation||a.terminal||a.depot||'',ll[0]||'',ll[1]||''].join('|');
    }
    token=String(token||'').slice(0,220);
    this.popupAssetRegistry.set(token,a);
    return token;
  },
  zoomToPopupAsset(token='',ev=null){
    try{if(ev){ev.preventDefault?.();ev.stopPropagation?.();if(window.L?.DomEvent)try{L.DomEvent.stop(ev);}catch(_){}}}catch(_){}
    try{this.map?.dragging?.enable?.();}catch(_){}
    const raw=decodeURIComponent(String(token||''));
    let a=(this.popupAssetRegistry&&this.popupAssetRegistry.get(raw))||(this.connectedReferenceRegistry&&this.connectedReferenceRegistry.get(raw))||(SearchEngine?.assetMap&&SearchEngine.assetMap.get(raw))||(App.assets||[]).find(x=>String(x?.id||'')===raw);
    if(!a){UI?.toast?.('Asset target not found.');return false;}
    const ll=this.markerLatLng?.(a)||this.assetLatLng?.(a);
    if(!ll){UI?.toast?.('Asset has no map point.');return false;}
    const cur=Number(this.map?.getZoom?.()||0);
    const targetZoom=Math.max(cur,15);
    try{this.map.setView(ll,targetZoom,{animate:true,duration:0.2});}
    catch(e){try{this.map.panTo(ll,{animate:true,duration:0.2});}catch(_){}}
    return false;
  },
  registerConnectedReferenceAsset(a){
    if(!a)return '';
    if(!this.connectedReferenceRegistry)this.connectedReferenceRegistry=new Map();
    let token=String(a.id||'').trim();
    if(!token){
      const raw=a.raw||{};
      const title=(SearchEngine?.referenceName?.(a)||a.label||a.substation||a.terminal||raw.SEARCH_FIELD||raw.SUBSTATION||raw.TERMINAL||'ref');
      token='ref_'+(SearchEngine?.compact?SearchEngine.compact(title):String(title).toUpperCase().replace(/[^A-Z0-9]/g,''))+'_'+String(Number(a.lat)||0).replace(/[^0-9-]/g,'')+'_'+String(Number(a.lon)||0).replace(/[^0-9-]/g,'');
    }
    this.connectedReferenceRegistry.set(token,a);
    return encodeURIComponent(token);
  },

  connectedStatusHtml(title='Connected circuits',body='Checking…'){
    const esc=(v)=>UI?.esc?UI.esc(v):String(v??'');
    return `<div class="connected-action-panel"><div class="connected-action-head"><b>${esc(title)}</b><button type="button" onclick="window.MapEngine?.closeConnectedStatus?.()">×</button></div><div class="connected-action-body">${body}</div></div>`;
  },
  openConnectedStatus(aOrTitle,body='Checking connected circuits…'){
    try{
      const title=typeof aOrTitle==='string'?aOrTitle:(this.referenceTitle?.(aOrTitle)||'Connected circuits');
      const html=this.connectedStatusHtml(title,body);
      let host=document.getElementById('connectedActionHost');
      if(!host){
        host=document.createElement('div');
        host.id='connectedActionHost';
        host.className='connected-action-host';
        document.body.appendChild(host);
      }
      host.innerHTML=html;
      host.classList.remove('hidden');
    }catch(e){try{UI?.toast?.(String(body).replace(/<[^>]*>/g,' '));}catch(_){}}
  },
  updateConnectedStatus(aOrTitle,body=''){
    this.openConnectedStatus(aOrTitle,body);
  },
  closeConnectedStatus(){
    try{document.getElementById('connectedActionHost')?.classList.add('hidden');}catch(e){}
  },
  connectedLineButtonHtml(line){
    const esc=(v)=>UI?.esc?UI.esc(v):String(v??'');
    const label=this.connectedCanonicalCircuitName?.(line)||String(line||'');
    const arg=encodeURIComponent(label);
    return `<button type="button" class="connected-load-line-btn" onclick="window.MapEngine?.showCircuitFromConnectedLine?.('${arg}')">${esc(label)}</button>`;
  },
  handleMoreInfoButton(btn,ev){
    try{
      ev?.preventDefault?.(); ev?.stopPropagation?.(); ev?.stopImmediatePropagation?.();
    }catch(e){}
    const p=btn?.closest?.('.asset-popup');
    if(!p)return false;
    const more=p.querySelector?.('.popup-more');
    const open=!p.classList.contains('show-more');
    p.classList.toggle('show-more',open);
    if(more)more.style.display=open?'block':'none';
    if(btn)btn.textContent=open?'Less info':'More info';
    // No Leaflet popup update/refit here. That was the source of the reference-popup flicker.
    try{this.map?.dragging?.enable?.();}catch(e){}
    return false;
  },
  handleConnectedCircuitsButton(btn,ev){
    try{
      if(ev){
        if(ev.__fmConnectedHandled)return false;
        ev.__fmConnectedHandled=true;
        ev.preventDefault?.(); ev.stopPropagation?.(); ev.stopImmediatePropagation?.();
      }
    }catch(e){}
    const el=btn||ev?.target?.closest?.('.show-connected-circuits-btn')||ev?.target;
    const token=el?.getAttribute?.('data-connected-token')||'';
    const code=el?.getAttribute?.('data-connected-code')||'';
    const key=this.connectedReferenceKeyFromToken?.(token,code)||String(code||token||'').toUpperCase();
    const now=Date.now();
    if(this._lastConnectedTapKey===key && now-(this._lastConnectedTapAt||0)<450)return false;
    this._lastConnectedTapKey=key;
    this._lastConnectedTapAt=now;
    const wantsHide=!!(this.connectedLinesVisible&&(this.connectedLinesKey===key||/hide/i.test(String(el?.textContent||''))));
    try{ this.map?.dragging?.enable?.(); }catch(e){}
    try{ this.map?.closePopup?.(); }catch(e){}
    if(wantsHide){
      try{ this.map?.dragging?.enable?.(); }catch(e){}
      this.hideConnectedCircuitLines();
      if(el)el.textContent='Show connected circuits';
      UI?.toast?.('Connected circuit lines hidden.');
      return false;
    }
    if(el){
      if(el.dataset.connectedBusy==='1')return false;
      el.dataset.connectedBusy='1';
      el.disabled=true;
      el.dataset.oldText=el.dataset.oldText||'Show connected circuits';
      el.textContent='Showing…';
    }
    try{ this.map?.dragging?.enable?.(); }catch(e){}
    const job=token?this.showConnectedCircuitsForReferenceToken(token,code,{key,button:el}):this.showConnectedCircuitsForCodes([code],`abbreviation ${code}`,{key,button:el});
    Promise.resolve(job).catch(err=>{
      Diagnostics?.capture?.(err);
      UI?.toast?.('Connected circuits failed.');
    }).finally(()=>{
      if(el){
        el.disabled=false;
        el.dataset.connectedBusy='0';
        el.textContent=(this.connectedLinesVisible&&this.connectedLinesKey===key)?'Hide connected circuits':'Show connected circuits';
      }
    });
    return false;
  },
  connectedReferenceKeyFromToken(token='',fallbackCode=''){
    const raw=String(token||'');
    let key=raw;
    try{key=decodeURIComponent(raw);}catch(e){}
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const code=compact(fallbackCode);
    if(code)return `CODE:${code}`;
    if(key)return `REF:${compact(key)}`;
    return 'CONNECTED';
  },
  isConnectedReferenceActive(token='',fallbackCode=''){
    const key=this.connectedReferenceKeyFromToken?.(token,fallbackCode)||String(fallbackCode||token||'').toUpperCase();
    return !!(this.connectedLinesVisible&&this.connectedLinesKey&&this.connectedLinesKey===key);
  },
  hideConnectedCircuitLines(){
    try{this.connectedLineLayer?.clearLayers?.();}catch(e){}
    this.connectedLinesVisible=false;
    this.connectedLinesKey='';
    this.connectedLinesReference=null;
    this.connectedLinesList=[];
    try{document.querySelectorAll('.show-connected-circuits-btn').forEach(b=>{b.textContent='Show connected circuits';});}catch(e){}
  },
  async showConnectedCircuitsForReferenceToken(token='',fallbackCode='',opts={}){
    const raw=String(token||'');
    let key=raw;
    try{key=decodeURIComponent(raw);}catch(e){}
    let a=(this.connectedReferenceRegistry&&this.connectedReferenceRegistry.get(key))||(this.connectedReferenceRegistry&&this.connectedReferenceRegistry.get(raw))||(SearchEngine?.assetMap&&SearchEngine.assetMap.get(key))||(SearchEngine?.assetMap&&SearchEngine.assetMap.get(raw))||(App.assets||[]).find(x=>String(x?.id||'')===key||String(x?.id||'')===raw);
    if(!a&&this.connectedReferenceRegistry){
      const ck=SearchEngine?.compact?SearchEngine.compact(key):key.toUpperCase().replace(/[^A-Z0-9]/g,'');
      for(const [k,v] of this.connectedReferenceRegistry.entries()){
        const c=SearchEngine?.compact?SearchEngine.compact(k):String(k).toUpperCase().replace(/[^A-Z0-9]/g,'');
        if(c&&ck&&c===ck){a=v;break;}
      }
    }
    if(!a&&fallbackCode){
      const code=SearchEngine?.compact?SearchEngine.compact(fallbackCode):String(fallbackCode).toUpperCase().replace(/[^A-Z0-9]/g,'');
      const list=(SearchEngine?.referencePointsByCode&&SearchEngine.referencePointsByCode.get(code))||[];
      a=list[0]||null;
    }
    if(!a&&fallbackCode){
      return this.showConnectedCircuitsForCodes([fallbackCode],`code ${fallbackCode}`,opts);
    }
    if(!a){UI.toast('Substation/terminal reference not found.');return 0;}
    return this.showConnectedCircuitsForReference(a,fallbackCode?[fallbackCode]:[],opts);
  },
  async showReferencePoints(kind='substation'){
    if(!this.map){UI.toast('Map not ready.');return 0;}
    this.cancelDraw();
    this.markerLayer?.clearLayers();
    this.routeLayer?.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    UtilitiesEngine?.clear?.(false);
    HVCrossingsLayer?.clearActive?.({silent:true});
    const want=String(kind||'substation').toLowerCase();
    // V3.1.80: never trust an empty reference index over the actual loaded assets.
    // V3.1.79 could leave SearchEngine.referencePoints as an empty array after a smart-skip/import path,
    // which made Show All Substations say nothing was loaded even though App.assets still contained them.
    try{
      if(SearchEngine?.buildReferenceIndex && (!Array.isArray(SearchEngine.referencePoints)||!SearchEngine.referencePoints.length)){
        SearchEngine.buildReferenceIndex(App.assets||[]);
      }
    }catch(e){Diagnostics?.log?.('Reference index recovery skipped',String(e?.message||e));}
    const refSource=[];
    const seenRefs=new Set();
    const addRef=(a)=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return;
      const raw=a.raw||{};
      const text=[a.kind,a.category,a.type,raw.TYPE,raw.type,raw.ASSET_TYPE,raw.asset_type,raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.DEPOT_NAME,a.label].join(' ').toUpperCase();
      const isRef=SearchEngine?.isReferencePointAsset?SearchEngine.isReferencePointAsset(a):/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|DEPOT|\bZONE\b/.test(text);
      if(!isRef)return;
      const id=String(a.id||a.assetId||a.globalId||'')||`${Number(a.lat).toFixed(7)},${Number(a.lon).toFixed(7)},${this.referenceTitle(a)}`;
      if(seenRefs.has(id))return;
      seenRefs.add(id); refSource.push(a);
    };
    for(const a of (Array.isArray(SearchEngine?.referencePoints)?SearchEngine.referencePoints:[]))addRef(a);
    // Recovery union: smart-skip/index rebuilds can leave SearchEngine.referencePoints incomplete.
    // Always union against the loaded asset records so Show All Substations/Depots cannot drop
    // imported reference points just because the saved reference index is stale.
    for(const a of (App.assets||[]))addRef(a);
    const list=refSource.filter(a=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return false;
      const k=SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a.kind||'').toLowerCase();
      if(this.passesAssetLayers&&this.passesAssetLayers(a)===false)return false;
      if(want==='depot')return k==='depot';
      return k==='substation'||k==='terminal';
    }).sort((a,b)=>this.referenceTitle(a).localeCompare(this.referenceTitle(b),undefined,{numeric:true,sensitivity:'base'}));
    if(!list.length){
      try{SearchEngine?.buildReferenceIndex?.(App.assets||[]);}catch(e){}
      UI.toast(want==='depot'?'No depots with map points loaded. Re-import depot file if this continues.':'No substations/terminals with map points loaded. Re-import substation/terminal file if this continues.');
      return 0;
    }
    App.drawnMarkers=0;
    this.currentDisplay=want==='depot'?'all depots':'all substations';
    this.currentCircuit=null;
    this.currentCircuits=[];
    this.currentCircuitRoutes=[];
    this.lastFullCircuitAssets=[];
    this.lastFullCircuitLabel='';
    const batch=90;
    for(let i=0;i<list.length;i+=batch){
      for(const a of list.slice(i,i+batch)){this.addMarker(a,{mode:'dom-dot'});App.drawnMarkers++;}
      UI.refreshCounts?.();
      await new Promise(r=>requestAnimationFrame(r));
    }
    this.lastDrawnAssets=list.slice();
    this.fitVisible();
    UI.toast(`${want==='depot'?'Depots':'Substations'} shown: ${list.length.toLocaleString()}.`);
    return list.length;
  },

  connectedStrictCodesForReference(a,extraCodes=[]){
    // CONNECTED-LINES RULE: use only the selected reference abbreviation/code.
    // No proximity-derived, name-derived, or multi-code guessing here.
    // If the abbreviation is not explicitly on the reference record, do not invent one.
    const out=[]; const seen=new Set();
    const bad=/^(SUB|SUBS|SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|DEPOT|ZONE|ZONE50|ZONE51|SWITCHYARD|WESTERN|POWER|TRANSMISSION|DISTRIBUTION|PUBLIC|SECURE|POINT|POLE|TOWER|STRUCTURE|ASSET|OBJECT|OBJECTID|GLOBALID|FEATURE|FEATUREID|UNKNOWN|NULL|NONE|NIL|NA|GPS|LAT|LONG|EASTING|NORTHING|OWNER|AER|NSP)$/i;
    const clean=(v)=>SearchEngine?.compact?SearchEngine.compact(v):String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const add=(v)=>{
      let c=clean(v);
      if(!c||bad.test(c)||!/[A-Z]/.test(c)||c.length>6)return;
      if(!seen.has(c)){seen.add(c);out.push(c);}
    };
    const raw=a?.raw||{};
    const rawVal=(names)=>{
      for(const name of names||[]){
        if(raw[name]!==undefined&&raw[name]!==null&&String(raw[name]).trim())return String(raw[name]).trim();
        const hit=Object.keys(raw).find(k=>String(k).toUpperCase()===String(name).toUpperCase());
        if(hit&&raw[hit]!==undefined&&raw[hit]!==null&&String(raw[hit]).trim())return String(raw[hit]).trim();
      }
      return '';
    };
    const explicitFields=['ABBREVIATION','ABBREV','ABBR','ACRONYM','SHORT_NAME','SHORTCODE','STATION_CODE','STN_CODE','SUBSTATION_CODE','SUBSTN_CODE','SUB_CODE','TERMINAL_CODE','TER_CODE','TERMINAL_ABBR','SUBSTATION_ABBR','SITE_CODE'];
    for(const f of explicitFields)add(rawVal([f]));
    add(a?.abbreviation); add(a?.abbr); add(a?.stationCode); add(a?.substationCode); add(a?.terminalCode);
    // Only accept CODE/ALIAS if it looks like a real short station code, not object id / feature id.
    for(const f of ['CODE','ALIAS','SITE']){
      const v=rawVal([f]);
      if(v&&String(v).length<=8)add(v);
    }
    // Explicit bracketed/parenthesised codes inside reference title/search field, e.g. MERREDIN TERMINAL (MRT), Kalamunda (K).
    const textFields=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.NAME,raw.TITLE,raw.TERMINAL,raw.TERMINAL_NAME,a?.substation,a?.terminal,a?.label,SearchEngine?.referenceName?.(a)||''].filter(Boolean).map(String);
    for(const t of textFields){
      let m; const re=/[\(\[]\s*([A-Z0-9]{1,6})\s*[\)\]]/gi;
      while((m=re.exec(t)))add(m[1]);
    }
    // Free-text terminal/substation suffix forms only when they clearly carry a code at the end.
    // Examples: "Byford Substation BYF", "Terminal OP", "Baandee Terminal BD".
    for(const t0 of textFields){
      const t=String(t0||'').trim(); if(!t)return;
      let m;
      m=t.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\s*[-–—:\/]?\s*([A-Z0-9]{1,5})\s*$/i); if(m)add(m[1]);
      m=t.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b.*?\b([A-Z0-9]{1,5})\s*$/i); if(m)add(m[1]);
    }
    // Extra code from the popup is accepted last, but only when it passes the same strict cleaning.
    for(const c of extraCodes||[])add(c);
    // Keep the first explicit code only. This prevents nearby/alternate codes being unioned into unrelated line sets.
    return out.slice(0,1);
  },
  referenceCodesFor(a,extraCodes=[]){
    const vals=[]; const seen=new Set(); const strongSeen=new Set();
    const badCode=/^(SUB|SUBS|SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|DEPOT|ZONE|SWITCHYARD|WESTERN|POWER|TRANSMISSION|DISTRIBUTION|PUBLIC|SECURE|POINT|POLE|TOWER|STRUCTURE|ASSET|UNKNOWN|NULL|NONE|NIL|NA|GPS|LAT|LONG|INAL)$/i;
    const addCode=(c,strong=false)=>{
      c=SearchEngine?.compact?SearchEngine.compact(c):String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!c||badCode.test(c)||!/[A-Z]/.test(c)||c.length>8)return;
      // Plain free-text names like MERREDIN TERMINAL or BAANDEE TERMINAL are not abbreviations.
      // Keep long tokens only when they came from explicit code fields or endpoint/proximity derivation.
      if(!strong&&c.length>4)return;
      if(strong)strongSeen.add(c);
      if(!seen.has(c)){seen.add(c);vals.push(c);}
    };
    try{for(const c of SearchEngine?.referenceCodeCandidates?.(a)||[])addCode(c,false);}catch(e){}
    try{for(const c of extraCodes||[])addCode(c,true);}catch(e){}
    const raw=a?.raw||{};
    const addText=(v,explicit=false)=>{
      v=String(v??'').trim(); if(!v)return;
      const parts=v.split(/[;,|]+/);
      for(let part of parts){
        part=String(part||'').trim(); if(!part)continue;
        let m; const paren=/[\(\[]\s*([A-Z0-9]{1,8}(?:\s*[-\/]\s*[A-Z0-9]{1,4})?)\s*[\)\]]/gi;
        while((m=paren.exec(part)))addCode(m[1],true);
        m=/^\s*([A-Z0-9]{1,8})\s*[-–—:]\s+/i.exec(part); if(m)addCode(m[1],explicit);
        m=/\s+[-–—:]\s*([A-Z0-9]{1,8})\s*$/i.exec(part); if(m)addCode(m[1],explicit);
        m=/^\s*([A-Z0-9]{1,6})\s+(?:TERMINAL|TERM|SUBSTATION|SUBSTN|SWITCHYARD|ZONE\s+SUB)\b/i.exec(part); if(m)addCode(m[1],explicit);
        if(explicit){for(const t of part.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))addCode(t,true);}
      }
    };
    const explicitKeys=['ABBREVIATION','abbreviation','ABBREV','abbrev','ABBR','abbr','CODE','code','STATION_CODE','SUBSTATION_CODE','TERMINAL_CODE','SITE_CODE','STN_CODE','SUB_CODE','SUBSTN_CODE','TER_CODE','short_name','SHORT_NAME','alias','ALIAS'];
    for(const k of explicitKeys)addText(raw[k],true);
    for(const [k,v] of Object.entries(raw)){ if(/ABBR|ABBREV|ACRONYM|SHORT|\bCODE\b|SITE|STN|SUBSTN|SUBSTATION_CODE|TERMINAL_CODE|TER_CODE/i.test(k))addText(v,true); }
    addText(a?.abbreviation,true); addText(a?.abbr,true); addText(a?.code,true); addText(a?.stationCode,true); addText(a?.substationCode,true); addText(a?.terminalCode,true);
    const refCode=SearchEngine?.referenceCode?.(a)||''; addCode(refCode,false);
    try{for(const c of SearchEngine?.deriveReferenceCodesFromLineEndpoints?.(a,12)||[])addCode(c,true);}catch(e){}
    const refKind=(SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a?.kind||'').toLowerCase());
    const texts=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.NAME,raw.TITLE,raw.TERMINAL,raw.TERMINAL_NAME,a?.substation,a?.terminal,a?.label,SearchEngine?.referenceName?.(a)||''].filter(Boolean).map(String);
    for(const t of texts)addText(t,false);
    // More robust imported reference parsing. Common source files often store the code
    // inside free text only, e.g. "Byford Substation BYF", "Terminal OP", or
    // "Byford / BYF". Pull those tokens without hard-coding any station names.
    for(const t of texts){
      const tx=String(t||'').trim();
      let m;
      m=tx.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\s*[-–—:\/]?\s*([A-Z0-9]{1,5})\s*$/i); if(m)addCode(m[1],false);
      m=tx.match(/(?:^|[\s,;|])([A-Z0-9]{1,4})\s*[-–—:\/]?\s*(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b/i); if(m)addCode(m[1],false);
      m=tx.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b.*?\b([A-Z0-9]{1,5})\s*$/i); if(m)addCode(m[1],false);
      m=tx.match(/(?:^|[\s,;|])([A-Z0-9]{1,5})\s*$/); if(m&&/(SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)/i.test(tx))addCode(m[1]);
    }
    if(refKind==='terminal'){
      for(const t of texts){const m=String(t).trim().match(/^([A-Z0-9])(?:\s|$|[-–—:])/i); if(m)addCode(m[1],false);}
    }
    // When transmission lines are indexed, suppress weak free-text fragments that are not actual line endpoints.
    // Explicit/imported fields and proximity-derived endpoint codes always survive.
    try{
      const idx=this.buildConnectedEndpointIndex?.();
      if(idx?.byCode?.size){
        const filtered=vals.filter(c=>strongSeen.has(c)||idx.byCode.has(c)||c.length<=3);
        return filtered.length?filtered:vals.filter(c=>strongSeen.has(c)||idx.byCode.has(c));
      }
    }catch(e){}
    return vals;
  },
  endpointCoordsForLineGroup(g){
    const assets=(g?.assets||[]).filter(a=>Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))).slice();
    try{assets.sort(SearchEngine.sortByStructure);}catch(e){}
    const pts=[];
    const take=10;
    let startAssets=assets.slice(0,take), endAssets=assets.slice(Math.max(0,assets.length-take));
    if(assets.length&&assets.length<=take*2){
      const split=Math.max(1,Math.floor(assets.length/2));
      startAssets=assets.slice(0,split);
      endAssets=assets.slice(split);
    }
    for(const a of startAssets)pts.push([Number(a.lat),Number(a.lon)]);
    for(const a of endAssets)pts.push([Number(a.lat),Number(a.lon)]);
    for(const r of (g?.routeAssets||[])){
      const coords=Array.isArray(r?.routeCoords)?r.routeCoords:[];
      if(coords.length){
        const first=coords[0], last=coords[coords.length-1];
        if(Array.isArray(first)&&Number.isFinite(Number(first[0]))&&Number.isFinite(Number(first[1])))pts.push([Number(first[0]),Number(first[1])]);
        if(Array.isArray(last)&&Number.isFinite(Number(last[0]))&&Number.isFinite(Number(last[1])))pts.push([Number(last[0]),Number(last[1])]);
      }
    }
    return pts;
  },
  isReferenceNearLineEndpoint(a,g,maxKm=2.2){
    if(!Number.isFinite(Number(a?.lat))||!Number.isFinite(Number(a?.lon)))return false;
    const ref={lat:Number(a.lat),lon:Number(a.lon)};
    const pts=this.endpointCoordsForLineGroup(g);
    for(const p of pts){
      let km=Infinity;
      try{km=SearchEngine?.distanceKm?SearchEngine.distanceKm(ref,{lat:p[0],lon:p[1]}):Infinity;}catch(e){}
      if(!Number.isFinite(km)){
        const R=6371,dLat=(p[0]-ref.lat)*Math.PI/180,dLon=(p[1]-ref.lon)*Math.PI/180,la1=ref.lat*Math.PI/180,la2=p[0]*Math.PI/180;
        const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2; km=2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
      }
      if(km<=maxKm)return true;
    }
    return false;
  },
  connectedEndpointCodesForLine(line){
    const raw=String(line||'').toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    const out=[]; const add=c=>{c=String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,''); if(c&&/[A-Z]/.test(c)&&c.length<=8&&!out.includes(c))out.push(c);};
    try{for(const c of SearchEngine?.lineEndpointCodes?.(raw)||[])add(c);}catch(e){}
    // Strip the voltage/circuit suffix, then split endpoint section. Examples:
    // BYF-CC 81 -> BYF, CC · KW-KEM/OLY 91 -> KW, KEM, OLY · A-OP 81 -> A, OP
    let core=raw.replace(/\b(?:\d{1,3}|X\d|[A-Z]?\d{1,2})\s*$/,'').trim();
    core=core.replace(/\s+\d{1,4}[A-Z0-9]*$/,'').trim();
    const m=core.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)/);
    if(m){ add(m[1]); for(const part of m[2].split('/'))add(part); }
    else{
      for(const part of core.split(/[-\/]/))add(part);
    }
    return out;
  },
  lineLabelsForAssetConnected(a){
    const out=[]; const add=l=>{l=SearchEngine?.formatCircuitName?.(l)||String(l||'').trim(); const k=SearchEngine?.compact?.(l)||l.toUpperCase().replace(/[^A-Z0-9]/g,''); if(l&&/\d|X\d/i.test(l)&&!out.some(x=>(SearchEngine?.compact?.(x)||x)===k))out.push(l);};
    try{for(const r of SearchEngine?.lineRefsForAsset?.(a,true)||[])add(r.line);}catch(e){}
    add(a?.line); add(a?.raw?.LINE_NAME); add(a?.raw?.LINE_NAME_1);
    const text=[a?.gisLabel,a?.structure,a?.label,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1].filter(Boolean).join(' ');
    try{for(const r of SearchEngine?.extractLineRefsFromText?.(text)||[])add(r.line);}catch(e){}
    const re=/\b([A-Z0-9]{1,8}\s*[-–—]\s*[A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*\s*(?:X\d|\d{1,3}|[A-Z]?\d{1,2}))\b/gi;
    let m; while((m=re.exec(text)))add(m[1]);
    return out;
  },
  buildConnectedEndpointIndex(){
    // FAST connected-circuit index. Do not scan every imported asset here.
    // The old button path scanned App.assets and then scanned again while drawing lines,
    // which caused mobile freezes on large local imports.
    const lineMap=SearchEngine?.lineMap;
    const stamp=[lineMap?.size||0,App.lastImport?.time||'',App.assets?.length||0].join('|');
    if(this.connectedEndpointIndex&&this.connectedEndpointIndexStamp===stamp)return this.connectedEndpointIndex;
    const byCode=new Map(), lineSet=new Set();
    const addToCode=(code,line)=>{
      const ck=SearchEngine?.compact?.(code)||String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      line=SearchEngine?.formatCircuitName?.(line)||String(line||'').trim();
      const lk=SearchEngine?.compact?.(line)||line.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!ck||!/[A-Z]/.test(ck)||ck.length>8||!line||!lk||lineSet.has(lk+'|'+ck))return;
      lineSet.add(lk+'|'+ck);
      if(!byCode.has(ck))byCode.set(ck,new Set());
      byCode.get(ck).add(line);
    };
    try{
      for(const g of lineMap?.values?.()||[]){
        const line=SearchEngine?.formatCircuitName?.(g?.line||g?.rawLine||'')||String(g?.line||g?.rawLine||'').trim();
        if(!line)continue;
        let codes=[];
        try{codes=SearchEngine?.lineEndpointCodes?.(line)||this.connectedEndpointCodesForLine(line)||[];}catch(e){codes=this.connectedEndpointCodesForLine(line)||[];}
        for(const c of codes)addToCode(c,line);
      }
    }catch(e){Diagnostics?.log?.('Connected endpoint index failed',String(e?.message||e));}
    this.connectedEndpointIndex={byCode};
    this.connectedEndpointIndexStamp=stamp;
    return this.connectedEndpointIndex;
  },
  referenceNameKeysForConnected(a){
    const raw=a?.raw||{};
    const addRaw=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.NAME,raw.TITLE,a?.substation,a?.terminal,a?.label];
    const out=[]; const seen=new Set();
    const push=(v)=>{
      let t=String(v||'').toUpperCase();
      if(!t)return;
      t=t.replace(/[\(\[]\s*[A-Z0-9]{1,10}\s*[\)\]]\s*$/,'');
      t=t.replace(/\b(SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|SWITCHYARD|ZONE|SUB|DEPOT|WESTERN|POWER|TRANSMISSION|DISTRIBUTION)\b/g,' ');
      t=t.replace(/[^A-Z0-9]+/g,' ').trim();
      if(!t)return;
      const compact=SearchEngine?.compact?SearchEngine.compact(t):t.replace(/[^A-Z0-9]/g,'');
      if(compact.length>=4&&!seen.has(compact)){seen.add(compact);out.push(compact);}
      for(const part of t.split(/\s+/)){
        const c=SearchEngine?.compact?SearchEngine.compact(part):part.replace(/[^A-Z0-9]/g,'');
        if(c.length>=4&&!seen.has(c)){seen.add(c);out.push(c);}
      }
    };
    for(const v of addRaw)push(v);
    return out;
  },
  connectedLineTextKeys(line,g){
    const arr=[line,g?.line,g?.rawLine,g?.label,g?.gisLabel];
    try{for(const a of g?.assets||[]){arr.push(a?.line,a?.label,a?.gisLabel,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL);}}
    catch(e){}
    return arr.filter(Boolean).map(v=>SearchEngine?.compact?SearchEngine.compact(v):String(v).toUpperCase().replace(/[^A-Z0-9]/g,''));
  },
  assetHasExactConfirmedLine(a,line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    if(!a||!target)return false;
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,false)||[]; // confirmed refs only; no inferred/proximity aliases
      for(const r of refs){
        const lk=compact(this.connectedCircuitNameForMatch?.(r?.line)||r?.line);
        if(lk&&lk===target)return true;
      }
    }catch(e){}
    const direct=compact(this.connectedCircuitNameForMatch?.(a?.line||'')||a?.line||'');
    return !!(direct&&direct===target);
  },
  connectedGroupsForExactLine(line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    const groups=[]; const seen=new Set();
    const groupMatches=(g,mapKey='')=>{
      const labels=[g?.line,g?.rawLine,g?.label,g?.gisLabel,mapKey];
      for(const v of labels){if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;}
      const assets=[...(Array.isArray(g?.assets)?g.assets:[]),...(Array.isArray(g?.routeAssets)?g.routeAssets:[])];
      for(const a of assets.slice(0,80)){
        try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[]){if(compact(this.connectedCircuitNameForMatch?.(l)||l)===target)return true;}}catch(e){}
        for(const v of [a?.line,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.gisLabel,a?.label]){
          if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;
        }
      }
      return false;
    };
    try{
      for(const [k,g] of SearchEngine?.lineMap?.entries?.()||[]){
        const id=String(k||'')+'|'+String(g?.line||g?.rawLine||'');
        if(!seen.has(id)&&groupMatches(g,k)){seen.add(id);groups.push(g);}
      }
    }catch(e){Diagnostics?.log?.('Connected exact group lookup failed',String(e?.message||e));}
    return groups;
  },
  connectedAssetsForLineFallback(line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    const groups=this.connectedGroupsForExactLine?.(line)||[];
    const exact=[]; const loose=[]; const seenExact=new Set(); const seenLoose=new Set();
    const push=(arr,a,seen)=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return;
      const id=String(a.id||a.uid||'')||`${Number(a.lat).toFixed(6)},${Number(a.lon).toFixed(6)}`;
      if(seen.has(id))return; seen.add(id); arr.push(a);
    };
    const assetMatches=(a)=>{
      try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[]){if(compact(this.connectedCircuitNameForMatch?.(l)||l)===target)return true;}}catch(e){}
      for(const v of [a?.line,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.gisLabel,a?.label]){
        if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;
      }
      return false;
    };
    for(const g of groups){
      for(const a of (Array.isArray(g?.assets)?g.assets:[])){
        if(assetMatches(a))push(exact,a,seenExact);
        push(loose,a,seenLoose);
      }
    }
    const assets=exact.length>=2?exact:[];
    try{assets.sort(SearchEngine?.sortByStructure||(()=>0));}catch(e){}
    return assets;
  },
  connectedRouteAssetsForLineStrict(line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    const groups=this.connectedGroupsForExactLine?.(line)||[];
    const out=[]; const seen=new Set();
    const routeMatches=(a)=>{
      try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[]){if(compact(this.connectedCircuitNameForMatch?.(l)||l)===target)return true;}}catch(e){}
      for(const v of [a?.line,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.gisLabel,a?.label]){
        if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;
      }
      return false;
    };
    for(const g of groups){
      for(const r of (Array.isArray(g?.routeAssets)?g.routeAssets:[])){
        const id=String(r?.id||r?.uid||r?.raw?.OBJECTID||'')||JSON.stringify((r?.routeCoords||[]).slice(0,1));
        if(seen.has(id))continue;
        if(routeMatches(r)){seen.add(id);out.push(r);}
      }
    }
    return out;
  },

  connectedCircuitsByEndpointProximity(a,maxKm=8){
    const out=[]; const seen=new Set();
    const addLine=(line)=>{
      line=SearchEngine?.formatCircuitName?.(line)||String(line||'').trim();
      const key=SearchEngine?.compact?.(line)||String(line||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(line&&key&&!seen.has(key)){seen.add(key);out.push(line);}
    };
    if(!a||!Number.isFinite(Number(a?.lat))||!Number.isFinite(Number(a?.lon)))return out;
    const ref={lat:Number(a.lat),lon:Number(a.lon)};
    const dist=(pt)=>{
      try{return SearchEngine?.distanceKm?SearchEngine.distanceKm(ref,{lat:Number(pt[0]),lon:Number(pt[1])}):Infinity;}catch(e){return Infinity;}
    };
    try{
      for(const g of SearchEngine?.lineMap?.values?.()||[]){
        const line=SearchEngine?.formatCircuitName?.(g?.line||g?.rawLine||'')||String(g?.line||g?.rawLine||'').trim();
        if(!line)continue;
        let best=Infinity;
        const pts=this.endpointCoordsForLineGroup?.(g)||[];
        for(const p of pts){
          if(!Array.isArray(p))continue;
          const km=dist(p); if(km<best)best=km;
          if(best<=maxKm)break;
        }
        if(best<=maxKm)addLine(line);
      }
    }catch(e){Diagnostics?.log?.('Connected circuit endpoint proximity failed',String(e?.message||e));}
    return out;
  },
  connectedCanonicalCircuitName(line){
    let original=String(line||'').trim().replace(/[–—_]+/g,'-').replace(/\s+/g,' ');
    if(!original)return '';
    let s=original.toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    try{s=String(SearchEngine?.formatCircuitName?.(s)||s).toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();}catch(e){}
    // Collapse branch/geometry labels back to the real circuit label.
    // Examples: KAT-WAG 71-G0000 -> KAT-WAG 71, KW-KEM/OLY 91-G0000 -> KW-KEM/OLY 91.
    let m=s.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)\s+(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3}(?:\/[A-Z0-9]{1,4})?)(?:\s*[-]\s*[A-Z0-9/]+.*)?$/i);
    if(m)return `${m[1].toUpperCase()}-${String(m[2]||'').toUpperCase().replace(/\s*\/\s*/g,'/')} ${m[3].toUpperCase()}`;
    // Compact two-letter circuit fallback only, e.g. DK81 -> D-K 81.
    if(!/-/.test(s)){
      const compact=String(original||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      m=compact.match(/^([A-Z]{2})(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})(?:[A-Z]\d{3,})?$/);
      if(m)return `${m[1][0]}-${m[1][1]} ${m[2]}`;
    }
    // Last resort: remove trailing GIS/branch suffixes only after a valid circuit token.
    s=s.replace(/\s*[-]\s*[A-Z]?\d{3,}[A-Z0-9/]*\s*$/,'').trim();
    return s;
  },
  connectedCircuitNameForMatch(line){
    return this.connectedCanonicalCircuitName?.(line)||String(line||'').trim().toUpperCase();
  },
  connectedEndpointTokensFromCircuitName(line){
    const raw=String(line||'');
    const name=this.connectedCanonicalCircuitName?.(raw)||raw;
    const out=[]; const seen=new Set();
    const add=v=>{
      const c=SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(c&&/[A-Z]/.test(c)&&c.length<=8&&!seen.has(c)){seen.add(c);out.push(c);}
    };
    // Exact endpoint tokens only. Use the same parser as circuit search so every substation/terminal
    // button uses the loaded circuit names, not a broken local regex.
    try{
      const parsed=SearchEngine?.lineEndpointCodes?.(name)||[];
      for(const c of parsed)add(c);
      if(out.length>=2)return out;
    }catch(e){}
    const m=String(name||'').match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)\s+(?:X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})\b/i);
    if(m){
      add(m[1]);
      for(const part of String(m[2]||'').split('/'))add(part);
    }
    return out;
  },
  connectedLineHasExactReferenceCode(line,codes=[]){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const wanted=(codes||[]).map(compact).filter(c=>c&&/[A-Z]/.test(c)&&c.length<=8);
    if(!wanted.length)return false;
    const tokens=this.connectedEndpointTokensFromCircuitName?.(line)||[];
    return wanted.some(c=>tokens.includes(c));
  },
  connectedCircuitCandidateLines(){
    const out=[]; const seen=new Set();
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const add=(v)=>{
      const line=this.connectedCircuitNameForMatch?.(v)||String(v||'').trim();
      const key=compact(line);
      if(!line||!key||seen.has(key))return;
      const tokens=this.connectedEndpointTokensFromCircuitName?.(line)||[];
      if(tokens.length<2)return;
      if(!/^([A-Z0-9]{1,8})\s*-\s*[A-Z0-9]{1,8}/.test(line)||!/(?:\s|^)(?:X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})\b/.test(line))return;
      if(SearchEngine?.isDisplayableTransmissionCircuitLine&&!SearchEngine.isDisplayableTransmissionCircuitLine(line))return;
      seen.add(key); out.push(line);
    };
    try{
      try{
        const pathIdx=SearchEngine?.buildCircuitPathIndex?.(App.assets||[])||SearchEngine?.circuitPathIndex;
        for(const g of pathIdx?.values?.()||[])add(g?.line);
      }catch(e){}
      for(const [mapKey,g] of SearchEngine?.lineMap?.entries?.()||[]){
        add(g?.line); add(g?.rawLine); add(g?.label); add(g?.gisLabel); add(mapKey);
        const assets=[...(Array.isArray(g?.assets)?g.assets:[]),...(Array.isArray(g?.routeAssets)?g.routeAssets:[])];
        for(const a of assets.slice(0,80)){
          try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[])add(l);}catch(e){}
          add(a?.line); add(a?.raw?.LINE_NAME); add(a?.raw?.LINE_NAME_1); add(a?.raw?.TRMSN_LINE_GIS_LABEL); add(a?.gisLabel); add(a?.label);
        }
      }
    }catch(e){Diagnostics?.log?.('Connected candidate line build failed',String(e?.message||e));}
    return out.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  },
  connectedCircuitsForReference(a,extraCodes=[]){
    const out=[]; const seen=new Set();
    if(!a)return out;
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const codes=this.connectedStrictCodesForReference(a,extraCodes).map(compact).filter(c=>c&&/[A-Z]/.test(c)&&c.length<=6);
    if(!codes.length)return out;
    const addLine=(line)=>{
      line=this.connectedCircuitNameForMatch?.(line)||String(line||'').trim();
      const key=compact(line);
      if(!line||!key||seen.has(key))return;
      if(!this.connectedLineHasExactReferenceCode?.(line,codes))return;
      seen.add(key);
      out.push(line);
    };
    for(const line of this.connectedCircuitCandidateLines?.()||[])addLine(line);
    return out.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})).slice(0,36);
  },
  showConnectedCircuitsForCodes(codes=[],sourceLabel='code',opts={}){
    const clean=[]; const seen=new Set();
    const compact=(v)=>SearchEngine?.compact?SearchEngine.compact(v):String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    for(const c of codes||[]){const cc=compact(c); if(cc&&/[A-Z]/.test(cc)&&!seen.has(cc)){seen.add(cc);clean.push(cc);}}
    if(!clean.length){UI.toast('No substation/terminal abbreviation found.');return 0;}
    const fake={raw:{},label:String(sourceLabel||clean.join(', ')),kind:'terminal',abbreviation:clean[0],code:clean[0],substation:String(sourceLabel||clean[0])};
    clean.forEach((c,i)=>{fake.raw[i===0?'ABBREVIATION':`CODE_${i}`]=c;});
    return this.showConnectedCircuitsForReference(fake,[],opts);
  },
  sampleCoords(coords=[],max=220){
    const arr=(coords||[]).filter(c=>Array.isArray(c)&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1]))).map(c=>[Number(c[0]),Number(c[1])]);
    if(arr.length<=max)return arr;
    const out=[]; const step=Math.max(1,Math.ceil(arr.length/max));
    for(let i=0;i<arr.length;i+=step)out.push(arr[i]);
    const last=arr[arr.length-1];
    if(last&&out[out.length-1]!==last)out.push(last);
    return out;
  },
  splitCoordsByDistance(coords=[],maxJumpKm=2.2){
    const out=[]; let cur=[];
    const dist=(a,b)=>{
      try{
        if(SearchEngine?.distanceKm)return SearchEngine.distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});
      }catch(e){}
      const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
      const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
      const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    };
    for(const c of coords||[]){
      if(!Array.isArray(c)||!Number.isFinite(Number(c[0]))||!Number.isFinite(Number(c[1])))continue;
      const pt=[Number(c[0]),Number(c[1])];
      if(cur.length&&dist(cur[cur.length-1],pt)>maxJumpKm){
        if(cur.length>=2)out.push(cur);
        cur=[];
      }
      cur.push(pt);
    }
    if(cur.length>=2)out.push(cur);
    return out;
  },

  connectedAssetLabelsForLinePath(a){
    const raw=a?.raw||{};
    const vals=[
      raw.TRMSN_LINE_GIS_LABEL,raw.trmsn_line_gis_label,raw.LINE_NAME,raw.line_name,raw.LINE_NAME_1,raw.line_name_1,
      raw.CIRCUIT,raw.circuit,raw.FEEDER,raw.feeder,raw.NAME,raw.name,
      a?.gisLabel,a?.line,a?.rawLine,a?.label,a?.substation
    ];
    const out=[]; const seen=new Set();
    for(const v of vals){
      const s=String(v||'').trim();
      if(!s)continue;
      const k=s.toUpperCase().replace(/\s+/g,' ');
      if(seen.has(k))continue;
      seen.add(k); out.push(s);
    }
    try{
      for(const l of SearchEngine?.lineAliasesForAsset?.(a)||[]){
        const s=String(l||'').trim();
        const k=s.toUpperCase().replace(/\s+/g,' ');
        if(s&&!seen.has(k)){seen.add(k); out.push(s);}
      }
    }catch(e){}
    return out;
  },
  connectedAssetRefsForLinePath(a){
    try{return SearchEngine?.lineRefsForAsset?.(a,true)||[];}catch(e){return [];}
  },
  connectedAssetMatchesExactLine(a,line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    if(!target)return false;
    for(const v of this.connectedAssetLabelsForLinePath?.(a)||[]){
      const c=compact(this.connectedCircuitNameForMatch?.(v)||v);
      if(c===target)return true;
    }
    return false;
  },
  connectedStructureOrderFromLabel(label,asset=null){
    const s=String(label||'').toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    const tryToken=(tok='')=>{
      tok=String(tok||'').toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9/]/g,'');
      if(!tok)return null;
      const bp=SearchEngine?.poleIdParts?.(tok);
      if(bp?.isBranch){
        const b=Number(bp.sortBranch||bp.branchNum||1);
        return {order:bp.num+Math.min(0.79,0.20+(b/10000)),key:bp.norm,raw:tok};
      }
      tok=tok.replace(/[^A-Z0-9]/g,'');
      let m=tok.match(/^G(\d{1,6})$/i);
      if(m)return {order:1000000+Number(m[1]||0),key:'G'+String(Number(m[1]||0)),raw:tok};
      m=tok.match(/^(\d{1,6})G$/i);
      if(m){
        const num=Number(m[1]||0);
        return {order:num+0.08,key:String(num)+'G',raw:tok};
      }
      m=tok.match(/^[A-Z]?(\d{1,6})([A-Z]{0,3})$/i);
      if(m)return {order:Number(m[1]),key:String(Number(m[1]))+(m[2]||''),raw:tok};
      return null;
    };
    // Prefer the structure suffix that follows the circuit name, e.g. NT-HBK 81-0057 or KAT-WAG 71-G0000.
    let matches=[]; let re=/-\s*([A-Z]{0,3}\d{1,6}[A-Z]{0,3}(?:\/[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?)(?=\b|,|\s|$)/gi; let m;
    while((m=re.exec(s)))matches.push(m[1]);
    for(let i=matches.length-1;i>=0;i--){const r=tryToken(matches[i]); if(r)return r;}
    // Fallback to normal pole/structure fields when the imported label has already been normalised.
    const raw=asset?.raw||{};
    const candidates=[asset?.poleNumber,asset?.structure,asset?.structureNo,asset?.structure_id,raw.STRUCTURE_ID,raw.structure_id,raw.STRUCTURE,raw.POLE,raw.POLE_NUMBER,asset?.label,asset?.id];
    for(const v of candidates){
      const str=String(v||'').toUpperCase();
      let mm=str.match(/(\d{1,6}[A-Z]{0,3})\s*$/i);
      if(mm){const r=tryToken(mm[1]); if(r)return r;}
    }
    return null;
  },
  connectedStructurePathSegmentsForLine(line){
    // Build the connected line from the imported pole/tower points themselves.
    // This avoids drawing short bay stubs, duplicate route overlays, and fan/triangle joins.
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    if(!target)return [];
    const stamp=`${App?.assets?.length||0}|${SearchEngine?.lineMap?.size||0}|${target}`;
    if(!this._connectedStructurePathCache)this._connectedStructurePathCache=new Map();
    const cached=this._connectedStructurePathCache.get(stamp);
    if(cached)return cached;
    const seenAsset=new Set();
    const assets=[];
    const addAsset=(a)=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return;
      if(a.kind==='circuit'||UtilitiesEngine?.isUtility?.(a))return;
      const id=String(a.id||a.assetId||a.globalId||`${a.lat},${a.lon},${assets.length}`);
      if(seenAsset.has(id))return;
      if(!this.connectedAssetMatchesExactLine?.(a,line))return;
      seenAsset.add(id); assets.push(a);
    };
    try{for(const a of SearchEngine?.lineAssets?.(line)||[])addAsset(a);}catch(e){}
    // If the search index only returned a small partial subset, recover from loaded assets using exact circuit labels.
    if(assets.length<6){
      try{for(const a of App?.assets||[])addAsset(a);}catch(e){}
    }
    if(assets.length<2){this._connectedStructurePathCache.set(stamp,[]);return [];}
    const groups=new Map();
    const addPoint=(ord,a,label)=>{
      if(!ord)return;
      const key=`${ord.order}|${ord.key}`;
      if(!groups.has(key))groups.set(key,{order:ord.order,key:ord.key,label:String(label||''),pts:new Map()});
      const lat=Number(a.lat), lon=Number(a.lon);
      const pkey=lat.toFixed(7)+','+lon.toFixed(7);
      groups.get(key).pts.set(pkey,[lat,lon]);
    };
    for(const a of assets){
      let addedForAsset=false;
      // Prefer exact line/nameplate pairs. This prevents a shared pole carrying several
      // LINE_NAME_n fields from being ordered with the wrong NAMEPLATE_ID_n.
      for(const ref of this.connectedAssetRefsForLinePath?.(a)||[]){
        const lineName=this.connectedCircuitNameForMatch?.(ref?.line||'')||String(ref?.line||'');
        if(compact(lineName)!==target)continue;
        const ord=this.connectedStructureOrderFromLabel?.(ref?.pole||ref?.structure||'',a);
        if(ord){addPoint(ord,a,ref?.line||''); addedForAsset=true;}
      }
      if(addedForAsset)continue;
      let best=null, bestLabel='';
      const labels=this.connectedAssetLabelsForLinePath?.(a)||[];
      for(const lab of labels){
        if(compact(this.connectedCircuitNameForMatch?.(lab)||lab)!==target)continue;
        const ord=this.connectedStructureOrderFromLabel?.(lab,a);
        if(ord){best=ord;bestLabel=lab;break;}
      }
      if(!best)best=this.connectedStructureOrderFromLabel?.('',a);
      addPoint(best,a,bestLabel);
    }
    const rows=Array.from(groups.values()).filter(g=>g.pts.size).sort((a,b)=>a.order-b.order||String(a.key).localeCompare(String(b.key),undefined,{numeric:true}));
    if(rows.length<2){this._connectedStructurePathCache.set(stamp,[]);return [];}
    const coords=[];
    for(const g of rows){
      let lat=0,lon=0,n=0;
      for(const p of g.pts.values()){lat+=p[0]; lon+=p[1]; n++;}
      if(n)coords.push([lat/n,lon/n]);
    }
    const dist=(a,b)=>{
      try{if(SearchEngine?.distanceKm)return SearchEngine.distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});}catch(e){}
      const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
      const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
      const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    };
    const segs=[]; let cur=[];
    for(const pt of coords){
      if(cur.length&&dist(cur[cur.length-1],pt)>45){
        if(cur.length>=2)segs.push(cur);
        cur=[];
      }
      const last=cur[cur.length-1];
      if(!last||Math.abs(last[0]-pt[0])>1e-7||Math.abs(last[1]-pt[1])>1e-7)cur.push(pt);
    }
    if(cur.length>=2)segs.push(cur);
    const out=segs.filter(s=>s.length>=2);
    this._connectedStructurePathCache.set(stamp,out);
    return out;
  },
  connectedLineSegments(line){
    // V3.1.83: connected circuits must come from exact imported line/nameplate pole/tower
    // point path index only. Do not fall back to route stubs, nearby geometry, substation
    // endpoint chords, or any inferred straight-line geometry. The user supplied every GPS
    // point; if the point path is not present, draw nothing rather than drawing a wrong line.
    const canonical=this.connectedCanonicalCircuitName?.(line)||String(line||'').trim();
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const key=compact(canonical||line);
    if(!key)return [];

    const dist=(a,b)=>{
      try{if(SearchEngine?.distanceKm)return SearchEngine.distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});}catch(e){}
      const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
      const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
      const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    };
    const cleanSeg=(seg=[])=>{
      const out=[]; let last='';
      for(const c of seg||[]){
        if(!Array.isArray(c)||!Number.isFinite(Number(c[0]))||!Number.isFinite(Number(c[1])))continue;
        const pt=[Number(c[0]),Number(c[1])];
        const k=pt[0].toFixed(7)+','+pt[1].toFixed(7);
        if(k===last)continue;
        last=k; out.push(pt);
      }
      return out.length>=2?out:[];
    };
    const lengthKm=(seg=[])=>{let n=0; for(let i=1;i<seg.length;i++){const d=dist(seg[i-1],seg[i]); if(Number.isFinite(d))n+=d;} return n;};
    const normaliseSegs=(segs=[])=>{
      const out=[];
      for(const raw of segs||[]){
        const seg=cleanSeg(raw);
        if(seg.length<2)continue;
        const len=lengthKm(seg);
        // Ignore tiny terminal stubs and two-point long chords. Those are the exact false
        // red/blue lines that were being drawn from fallback route/endpoint data.
        if(seg.length<4&&len>1.2)continue;
        if(len<0.03)continue;
        out.push(seg);
      }
      return out;
    };

    let segs=[];
    try{
      if(!SearchEngine?.circuitPathIndex?.size)SearchEngine?.buildCircuitPathIndex?.(App.assets||[],{force:true});
      segs=SearchEngine?.circuitPathSegments?.(canonical)||SearchEngine?.circuitPathSegments?.(line)||[];
    }catch(e){
      Diagnostics?.log?.('Connected pole path lookup failed',String(e?.message||e));
      segs=[];
    }
    segs=normaliseSegs(segs);
    if(segs.length){
      try{Diagnostics?.log?.('Connected geometry source',JSON.stringify({line:canonical,source:'strict-imported-pole-path',segments:segs.length,points:segs.reduce((n,s)=>n+s.length,0)}));}catch(e){}
      return segs;
    }

    // Recovery is still point-only: rebuild directly from exact pole/tower point labels already
    // loaded in App.assets. This does not use LineString routes, substation coords, or hardcoded data.
    let recovered=[];
    try{recovered=this.connectedStructurePathSegmentsForLine?.(canonical)||[];}catch(e){recovered=[];}
    recovered=normaliseSegs(recovered);
    if(recovered.length&&recovered.reduce((n,s)=>n+s.length,0)>=6){
      try{Diagnostics?.log?.('Connected geometry source',JSON.stringify({line:canonical,source:'strict-loaded-pole-recovery',segments:recovered.length,points:recovered.reduce((n,s)=>n+s.length,0)}));}catch(e){}
      return recovered;
    }

    try{Diagnostics?.log?.('Connected geometry missing',JSON.stringify({line:canonical,reason:'no imported pole/tower point path available'}));}catch(e){}
    return [];
  },
  coordsForConnectedLine(line){
    const segs=this.connectedLineSegments(line);
    return segs[0]||[];
  },
  connectedCircuitsListHtml(lines=[],drawn=0,meta={}){
    const esc=(v)=>UI?.esc?UI.esc(v):String(v||'');
    const codes=(meta?.codes||[]).filter(Boolean);
    const rows=(lines||[]).slice(0,40).map(line=>this.connectedLineButtonHtml(line)).join('');
    const more=(lines||[]).length>40?`<div class="connected-list-more">+ ${(lines.length-40).toLocaleString()} more</div>`:'';
    const codeLine=codes.length?`<div class="connected-list-code">Code: ${esc(codes.join(', '))}</div>`:'';
    const drawnLine=drawn?`<div class="connected-list-status good">${drawn.toLocaleString()} connected circuit line(s) drawn.</div>`:'';
    const status=lines?.length?`${drawnLine}<div class="connected-list-status">Tap a circuit below to load its poles/dots.</div>`:`<div class="connected-list-status bad">No circuit names matched this terminal/substation. Codes checked: ${esc(codes.join(', ')||'none')}.</div><div class="connected-list-status">This means the loaded transmission line labels do not contain those endpoint codes, or the circuit endpoint geometry is not close enough to this terminal point.</div>`;
    return `<div class="connected-line-popup connected-line-list"><b>Connected circuits</b>${codeLine}${status}${rows}${more}</div>`;
  },
  openConnectedCircuitsList(a,lines=[],drawn=0,meta={}){
    try{
      const html=this.connectedCircuitsListHtml(lines||[],drawn,meta);
      this.updateConnectedStatus?.(a||'Connected circuits',html);
      if(!this.map||!window.L)return;
      const ll=this.assetLatLng?.(a)||this.map.getCenter();
      L.popup(this.popupOptions()).setLatLng(ll).setContent(html).openOn(this.map);
    }catch(e){Diagnostics?.log?.('Connected circuits list failed',String(e?.message||e));}
  },
  connectedLineColour(i=0){
    const colours=['#d32f2f','#1976d2','#388e3c','#f57c00','#7b1fa2','#0097a7','#c2185b','#5d4037','#455a64','#afb42b','#512da8','#0288d1'];
    return colours[Math.abs(Number(i)||0)%colours.length];
  },
  async drawConnectedCircuitLines(lines=[],limit=36){
    if(!this.connectedLineLayer||!window.L)return 0;
    // Connected-circuit mode is a line-only overlay. Clear the normal searched-circuit
    // route layer first so the same circuit is not shown twice as a faint route line plus
    // a coloured connected line. Markers remain so substations/terminals still work.
    try{this.routeLayer?.clearLayers?.();}catch(e){}
    this.connectedLineLayer.clearLayers();
    let drawn=0;
    const chosen=(lines||[]).slice(0,limit);
    for(let i=0;i<chosen.length;i++){
      const line=this.connectedCanonicalCircuitName?.(chosen[i])||chosen[i];
      const colour=this.connectedLineColour(i);
      const segs=this.connectedLineSegments?.(line)||[];
      let lineDrawn=false;
      for(const seg of segs){
        if(!Array.isArray(seg)||seg.length<2)continue;
        const pl=L.polyline(seg,{weight:4.5,opacity:.92,color:colour,interactive:true,lineCap:'round',lineJoin:'round'});
        pl.options.connectedCircuitLine=String(line||'');
        pl.bindPopup(()=>this.connectedLinePopupHtml(line),this.popupOptions());
        this.connectedLineLayer.addLayer(pl);
        lineDrawn=true;
      }
      if(lineDrawn)drawn++;
      await new Promise(r=>setTimeout(r,0));
    }
    return drawn;
  },
  connectedLinePopupHtml(line){
    const safe=String(line||'');
    return `<div class="connected-line-popup compact"><b>${UI?.esc?UI.esc(safe):safe}</b></div>`;
  },
  async showConnectedCircuitsForReferenceId(id=''){
    const key=String(id||'');
    const a=(SearchEngine?.assetMap&&SearchEngine.assetMap.get(key))||(App.assets||[]).find(x=>String(x?.id||'')===key);
    return this.showConnectedCircuitsForReference(a);
  },
  async showConnectedCircuitsForReference(a,extraCodes=[],opts={}){
    if(!a){UI.toast('Substation/terminal not found.');return 0;}
    this.closeConnectedStatus?.();
    await new Promise(r=>setTimeout(r,0));
    const codes=this.connectedStrictCodesForReference(a,extraCodes);
    const lines=this.connectedCircuitsForReference(a,extraCodes);
    if(!lines.length){
      this.hideConnectedCircuitLines();
      UI.toast(codes.length?`No connected circuit names matched ${codes.join(', ')}.`:'No abbreviation/code found on this substation/terminal.');
      return 0;
    }
    const drawn=await this.drawConnectedCircuitLines(lines,36);
    this.connectedLinesVisible=drawn>0;
    this.connectedLinesKey=opts?.key||this.connectedReferenceKeyFromToken?.('',codes[0]||'')||String(codes[0]||'CONNECTED');
    this.connectedLinesReference=a;
    this.connectedLinesList=lines.slice();
    try{this.map?.dragging?.enable?.();}catch(e){}
    if(opts?.button)opts.button.textContent='Hide connected circuits';
    UI.toast(drawn?`Connected circuit shown: ${drawn.toLocaleString()} circuit(s). Tap a line for its circuit name.`:`Connected circuits found but no line geometry loaded.`);
    return drawn;
  },
  async showCircuitFromConnectedLine(encoded=''){
    const line=decodeURIComponent(String(encoded||''));
    if(!line)return;
    UI.progress?.(true,'Loading circuit…',line,20);
    try{await this.showCircuit(line);}
    catch(err){Diagnostics?.capture?.(err);UI.toast('Circuit load failed.');}
    finally{UI.progress?.(false);UI.refreshCounts?.();}
  },
  currentViewStats(){
    if(!this.map)return {total:0,visible:0,hidden:0,withGps:0,withoutGps:0,byKind:{},bySource:{},drawn:App.drawnMarkers||0};
    const b=this.map.getBounds();
    const stats={total:0,visible:0,hidden:0,withGps:0,withoutGps:0,byKind:{},bySource:{},drawn:App.drawnMarkers||0,samples:[]};
    const assets=App.assets||[];
    stats.withGps=assets.filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)).length;
    stats.withoutGps=assets.length-stats.withGps;
    const inView=SearchEngine.assetsInBounds?SearchEngine.assetsInBounds(b):assets.filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)&&b.contains([a.lat,a.lon]));
    for(const a of inView){
      if(!a||a.kind==='circuit')continue;
      stats.total++;
      const visible=SearchEngine.passesFilters(a);
      if(visible)stats.visible++; else stats.hidden++;
      const kind=a.kind||'structure'; stats.byKind[kind]=(stats.byKind[kind]||0)+1;
      const src=a.sourceType||'unknown'; stats.bySource[src]=(stats.bySource[src]||0)+1;
      if(stats.samples.length<8)stats.samples.push({title:PopupEngine.displayTitle(a),kind,src,line:a.line||'',file:a.sourceFile||''});
    }
    return stats;
  },

  async whatsHere(){
    // Shows only assets in the current map window that pass active filters.
    // Utilities/context layers are handled by UtilitiesEngine so lines/polygons can render.
    let assetCount=0;
    try{assetCount=await this.revealCurrentView(false,{label:"What's here",toastPrefix:"What's here"});}
    catch(err){Diagnostics?.log?.("What's here asset reveal failed",String(err?.message||err));}
    try{
      if(window.UtilitiesEngine?.hasAnyImportedUtility?.()){
        if(window.UtilitiesEngine.hasAnyUtilityEnabled?.()){
          await window.UtilitiesEngine.updateOverlay(false,{forceMapView:true,source:'whats-here'});
        }else{
          window.UtilitiesEngine.updatePanel('Background context records are imported but not shown in this lean UI.');
        }
      }
    }catch(err){Diagnostics?.log?.("What's here utility preview failed",String(err?.message||err));}
    return assetCount;
  },
  async showNearbyAssets(){
    if(!this.map){UI.toast('Map not ready.');return 0;}
    const zoom=Number(this.map.getZoom?.()||0);
    const minZoom=14;
    if(!Number.isFinite(zoom)||zoom<minZoom){
      UI.toast(`Zoom in closer to use Nearby assets. Minimum zoom ${minZoom}.`);
      return 0;
    }
    const b=this.map.getBounds?.();
    if(!b){UI.toast('Map view not ready.');return 0;}
    const raw=(SearchEngine?.assetsInBounds?SearchEngine.assetsInBounds(b):(App.assets||[]).filter(a=>Number.isFinite(Number(a?.lat))&&Number.isFinite(Number(a?.lon))&&b.contains([a.lat,a.lon])));
    const visible=[]; const hidden=[]; const seen=new Set();
    for(const a of raw||[]){
      if(!a||a.kind==='circuit'||UtilitiesEngine?.isUtility?.(a))continue;
      if(!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))continue;
      const id=SearchEngine?.assetStableId?SearchEngine.assetStableId(a):String(a.id||a.assetId||`${a.lat},${a.lon},${a.label||''}`);
      if(seen.has(id))continue; seen.add(id);
      if(SearchEngine?.passesFilters?SearchEngine.passesFilters(a):true)visible.push(a); else hidden.push(a);
    }
    if(!visible.length){
      UI.toast(hidden.length?`No visible nearby assets. ${hidden.length.toLocaleString()} hidden by filters.`:'No nearby mapped assets in this view.');
      return 0;
    }
    const hardLimit=650;
    if(visible.length>hardLimit){
      UI.toast(`Too many nearby assets (${visible.length.toLocaleString()}). Zoom in closer.`);
      return 0;
    }
    const centre=this.map.getCenter?.();
    const list=centre?visible.slice().sort((a,b)=>this.distanceM({lat:centre.lat,lon:centre.lng},a)-this.distanceM({lat:centre.lat,lon:centre.lng},b)):visible;
    const count=await this.drawAssets(list,'current map view',false,{viewportFirst:true});
    this.currentDisplay='nearby assets';
    UI.refreshCounts?.();
    UI.toast(`Nearby assets: ${Number(count||0).toLocaleString()} shown${hidden.length?` · ${hidden.length.toLocaleString()} hidden by filters`:''}.`);
    return count;
  },
  async revealCurrentView(includeHidden=false,opts={}){
    if(!this.map){UI.toast('Map not ready.');return 0;}
    if(App.safeMode && includeHidden){UI.toast('Safe Mode is on. Hidden bulk reveal blocked.');return 0;}
    const b=this.map.getBounds();
    const list=[];
    const hidden=[];
    const inView=SearchEngine.assetsInBounds?SearchEngine.assetsInBounds(b):(App.assets||[]).filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)&&b.contains([a.lat,a.lon]));
    for(const a of inView){
      if(!a||a.kind==='circuit')continue;
      const visible=SearchEngine.passesFilters(a);
      if(visible || includeHidden)list.push(a);
      if(!visible)hidden.push(a);
    }
    if(!list.length){
      UI.toast(includeHidden?'No hidden mapped assets in this map view.':'No filtered mapped assets in this map view. Change Display filters if something is hidden.');
      Diagnostics.log('Area reveal found no assets',JSON.stringify(this.currentViewStats()));
      return 0;
    }
    const hardLimit=Number(App.settings?.areaRevealLimit||5000);
    const draw=list.slice(0,hardLimit);
    await this.drawAssets(draw,includeHidden?'current view including hidden':(opts.label||'current map view'),false);
    if(draw.length)this.fitVisible();
    const prefix=opts.toastPrefix||'Area reveal';
    const msg=`${prefix}: ${draw.length.toLocaleString()} shown${list.length>draw.length?` of ${list.length.toLocaleString()}`:''}. ${hidden.length.toLocaleString()} hidden by filters in view.`;
    UI.toast(msg);
    Diagnostics.log('Area reveal',msg+' '+JSON.stringify(this.currentViewStats()));
    return draw.length;
  },
  clearCircuit(){this.clearDisplay();},
  fitVisible(){
    const pts=[];
    this.markerLayer?.eachLayer(l=>{if(l.getLatLng)pts.push(l.getLatLng());});
    this.routeLayer?.eachLayer(l=>{if(l.getBounds){const b=l.getBounds(); if(b?.isValid?.()){pts.push(b.getNorthEast(),b.getSouthWest());}}});
    this.utilityLayer?.eachLayer(l=>{if(l.getBounds){const b=l.getBounds(); if(b?.isValid?.()){pts.push(b.getNorthEast(),b.getSouthWest());}}});
    if(pts.length)this.map.fitBounds(L.latLngBounds(pts),{padding:[28,28],maxZoom:16});
    else UI.toast('No searched map dots to fit.');
  },
  locate(){
    this.setGpsMode('free',{toast:false,showPanel:true});
    this.startGpsWatch(false);
    this.gpsPendingLocateOnce=true;
    if(this.gpsLast&&Number.isFinite(Number(this.gpsLast.lat))&&Number.isFinite(Number(this.gpsLast.lon))){
      this.jumpToGpsPosition([this.gpsLast.lat,this.gpsLast.lon]);
      this.gpsPendingLocateOnce=false;
    }else{
      UI?.toast?.('Finding GPS position...');
    }
  },
  toggleGpsFollow(){
    this.locate();
  },
  bindGpsUiControls(){
    const bind=(id,fn)=>{
      const el=document.getElementById(id);
      if(!el||el.dataset.gpsBound==='1')return;
      el.dataset.gpsBound='1';
      el.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation?.();fn.call(this,ev);},{capture:true,passive:false});
    };
    bind('gpsLocateModeBtn',()=>this.locate());
    bind('gpsFollowModeBtn',()=>this.setGpsMode('follow',{toast:true,showPanel:true}));
    bind('gpsTrackModeBtn',()=>this.setGpsMode('track',{toast:true,showPanel:true}));
    bind('gpsRotateModeBtn',()=>this.toggleGpsHeadingRotate());
    bind('gpsPanelMinBtn',()=>this.toggleGpsPanelMinimized());
    bind('gpsPanelCloseBtn',()=>this.hideGpsPanel());
    bind('gpsNearestPingBtn',()=>this.pingNearestGpsAsset(10000,{show:true}));
    bind('gpsBreadcrumbBtn',()=>this.toggleBreadcrumbTrail());
    document.querySelectorAll('[data-gps-profile],[data-tools-gps-profile]').forEach(btn=>{
      if(btn.dataset.gpsProfileBound==='1')return;
      btn.dataset.gpsProfileBound='1';
      btn.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation?.();this.setGpsProfile(btn.dataset.gpsProfile||btn.dataset.toolsGpsProfile||'walking');},{capture:true,passive:false});
    });
    const profileSelect=document.getElementById('gpsProfileSelect');
    if(profileSelect&&profileSelect.dataset.gpsProfileBound!=='1'){
      profileSelect.dataset.gpsProfileBound='1';
      profileSelect.addEventListener('change',ev=>{this.setGpsProfile(ev.target.value||'walking');},{passive:true});
    }
    const actionSelect=document.getElementById('gpsActionSelect');
    if(actionSelect&&actionSelect.dataset.gpsActionBound!=='1'){
      actionSelect.dataset.gpsActionBound='1';
      actionSelect.addEventListener('change',ev=>{
        const v=ev.target.value||'free';
        if(v==='free')this.locate();
        else this.setGpsMode(v,{toast:true,showPanel:true});
      },{passive:true});
    }
  },
  bindRotatedMapDragFix(){
    if(this._rotatedMapDragFixBound||!this.map)return;
    const container=this.map.getContainer?.();
    if(!container)return;
    this._rotatedMapDragFixBound=true;
    const pointFromEvent=ev=>{
      const src=ev?.touches?.[0]||ev?.changedTouches?.[0]||ev;
      const x=Number(src?.clientX), y=Number(src?.clientY);
      return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
    };
    const ignoreTarget=target=>{
      try{
        return !!(target&&target.closest&&target.closest('.leaflet-marker-icon,.leaflet-popup,.leaflet-control,.lean-left-rail,.gps-patrol-panel,.plus-menu,.circuit-picker,.search-panel,.status-panel,.conductors-panel,.tools-panel,.reset-panel,.data-manager-panel,.overlay,.import-overlay,.hvtx-toggle-panel'));
      }catch(e){return false;}
    };
    const active=()=>!!(this.gpsRotateHeading&&Math.abs(Number(this.mapRotationDeg)||0)>0.4&&this.map&&!this.measureMode);
    const begin=ev=>{
      if(!active())return;
      if(ev?.pointerType==='mouse'&&ev.button!==0)return;
      if(ev?.touches&&ev.touches.length!==1)return;
      if(ignoreTarget(ev.target))return;
      const p=pointFromEvent(ev); if(!p)return;
      this._rotatedDragState={id:ev.pointerId,x:p.x,y:p.y,lastX:p.x,lastY:p.y,moved:false,startedAt:Date.now()};
      try{this.map.dragging.disable();}catch(e){}
      try{container.setPointerCapture?.(ev.pointerId);}catch(e){}
      try{ev.preventDefault?.();ev.stopPropagation?.();ev.stopImmediatePropagation?.();}catch(e){}
    };
    const move=ev=>{
      const st=this._rotatedDragState; if(!st)return;
      if(st.id!=null&&ev.pointerId!=null&&st.id!==ev.pointerId)return;
      const p=pointFromEvent(ev); if(!p)return;
      const dx=p.x-st.lastX, dy=p.y-st.lastY;
      st.lastX=p.x; st.lastY=p.y;
      if(Math.abs(p.x-st.x)+Math.abs(p.y-st.y)>3)st.moved=true;
      if(dx||dy){
        const d=this.screenDeltaToRotatedMapDelta(dx,dy);
        try{this.map.panBy([-d.x,-d.y],{animate:false,noMoveStart:true});}catch(e){}
        try{this.onGpsMapUserMovementStart?.();}catch(e){}
      }
      try{ev.preventDefault?.();ev.stopPropagation?.();ev.stopImmediatePropagation?.();}catch(e){}
    };
    const end=ev=>{
      const st=this._rotatedDragState; if(!st)return;
      if(st.id!=null&&ev.pointerId!=null&&st.id!==ev.pointerId)return;
      this._rotatedDragState=null;
      try{container.releasePointerCapture?.(ev.pointerId);}catch(e){}
      this.updateHeadingDragFix();
      try{this.onGpsMapUserMovementEnd?.();this.reapplyMapRotation?.();}catch(e){}
      if(st.moved){
        this._suppressNextRotatedMapClickUntil=Date.now()+240;
        try{ev.preventDefault?.();ev.stopPropagation?.();ev.stopImmediatePropagation?.();}catch(e){}
      }
    };
    const killClick=ev=>{
      if(Date.now()<(this._suppressNextRotatedMapClickUntil||0)){
        try{ev.preventDefault?.();ev.stopPropagation?.();ev.stopImmediatePropagation?.();}catch(e){}
      }
    };
    if(window.PointerEvent){
      container.addEventListener('pointerdown',begin,{capture:true,passive:false});
      container.addEventListener('pointermove',move,{capture:true,passive:false});
      container.addEventListener('pointerup',end,{capture:true,passive:false});
      container.addEventListener('pointercancel',end,{capture:true,passive:false});
      container.addEventListener('click',killClick,{capture:true,passive:false});
    }else{
      container.addEventListener('touchstart',begin,{capture:true,passive:false});
      container.addEventListener('touchmove',move,{capture:true,passive:false});
      container.addEventListener('touchend',end,{capture:true,passive:false});
      container.addEventListener('touchcancel',end,{capture:true,passive:false});
      container.addEventListener('click',killClick,{capture:true,passive:false});
    }
  },
  screenDeltaToRotatedMapDelta(dx,dy){
    const rot=Number(this.mapRotationDeg)||0;
    if(Math.abs(rot)<0.4)return {x:Number(dx)||0,y:Number(dy)||0};
    const a=-rot*Math.PI/180;
    const c=Math.cos(a), sn=Math.sin(a);
    return {x:(Number(dx)||0)*c-(Number(dy)||0)*sn,y:(Number(dx)||0)*sn+(Number(dy)||0)*c};
  },
  updateHeadingDragFix(){
    if(!this.map)return;
    const on=!!(this.gpsRotateHeading&&Math.abs(Number(this.mapRotationDeg)||0)>0.4);
    const c=this.map.getContainer?.();
    if(c)c.classList.toggle('map-rotated-drag-fixed',on);
    try{
      if(on)this.map.dragging.disable();
      else if(!this._rotatedDragState)this.map.dragging.enable();
    }catch(e){}
  },
  setGpsMode(mode='free',opts={}){
    const wanted=['free','follow','track'].includes(mode)?mode:'free';
    this.gpsMode=wanted;
    this.gpsError=false;
    this._gpsUserMoving=false;
    this._gpsSuspendUntil=0;
    this._gpsTrackCenter=null;
    this._gpsLastLookaheadHeading=NaN;
    if(this.gpsInteractionTimer){clearTimeout(this.gpsInteractionTimer);this.gpsInteractionTimer=null;}
    try{localStorage.setItem('fieldMapGpsMode',this.gpsMode);}catch(e){}
    this.updateGpsButton();
    if(opts.showPanel!==false)this.showGpsPanel();
    this.startGpsWatch(false);
    this.updateGpsPanel();
    if(opts.toast){
      const label=this.gpsMode==='free'?'Free scroll — GPS updates only':this.gpsMode==='follow'?'Follow — snap-back after 5 seconds idle':'Tracking/Heli — heading based';
      UI?.toast?.(`GPS mode: ${label}`);
    }
    if(this.gpsLast&&(this.gpsMode==='follow'||this.gpsMode==='track'))this.applyGpsModeView([this.gpsLast.lat,this.gpsLast.lon],{force:true});
    this.updateMapRotationFromGps({force:true});
    if(this.gpsMode==='track'||this.gpsRotateHeading)setTimeout(()=>this.refreshInteractiveDotsForHeadingMode?.(),120);
  },
  cycleGpsMode(){
    const order=['free','follow','track'];
    const current=order.includes(this.gpsMode)?this.gpsMode:'free';
    this.setGpsMode(order[(order.indexOf(current)+1)%order.length],{toast:true,showPanel:true});
  },
  loadGpsProfile(){
    try{
      const saved=localStorage.getItem('fieldMapGpsProfile');
      if(['walking','driving','helicopter'].includes(saved))this.gpsProfile=saved;
      const mode=localStorage.getItem('fieldMapGpsMode');
      if(['free','follow','track'].includes(mode))this.gpsMode=mode;
      const rot=localStorage.getItem('fieldMapGpsRotateHeading');
      this.gpsRotateHeading=rot==='1';
    }catch(e){}
    return this.gpsProfile||'walking';
  },
  gpsProfileLabel(profile){
    const p=profile||this.gpsProfile||'walking';
    return p==='helicopter'?'Helicopter':p==='driving'?'Driving':'Walking';
  },
  setGpsProfile(profile='walking'){
    const p=['walking','driving','helicopter'].includes(profile)?profile:'walking';
    this.gpsProfile=p;
    try{localStorage.setItem('fieldMapGpsProfile',p);}catch(e){}
    if(p==='helicopter')this.gpsMode='track';
    this._gpsTrackCenter=null;
    this._gpsLastLookaheadHeading=NaN;
    try{localStorage.setItem('fieldMapGpsMode',this.gpsMode);}catch(e){}
    this.showGpsPanel();
    this.updateGpsButton();
    this.updateGpsProfileButtons();
    this.updateGpsPanel();
    this.startGpsWatch(false);
    if(this.gpsLast&&(this.gpsMode==='follow'||this.gpsMode==='track'))this.applyGpsModeView([this.gpsLast.lat,this.gpsLast.lon],{force:true});
    this.updateMapRotationFromGps({force:true});
    if(p==='helicopter'||this.gpsRotateHeading)setTimeout(()=>this.refreshInteractiveDotsForHeadingMode?.(),120);
    UI?.toast?.(`${this.gpsProfileLabel(p)} GPS${p==='helicopter'?' tracking on.':'.'}`);
  },
  toggleGpsHeadingRotate(){
    this.gpsRotateHeading=!this.gpsRotateHeading;
    try{localStorage.setItem('fieldMapGpsRotateHeading',this.gpsRotateHeading?'1':'0');}catch(e){}
    if(!this.gpsRotateHeading){
      this._mapHeadingUsed=NaN;
      this._mapRotationSmoothed=NaN;
      this.applyMapRotationDeg(0);
    }else{
      this.updateMapRotationFromGps({force:true});
      setTimeout(()=>this.refreshInteractiveDotsForHeadingMode?.(),120);
    }
    this.updateGpsProfileButtons();
    UI?.toast?.(this.gpsRotateHeading?'Map rotate ON':'Map rotate OFF');
  },
  async refreshInteractiveDotsForHeadingMode(){
    try{
      if(!(this.gpsRotateHeading||this.gpsProfile==='helicopter'||this.gpsMode==='track'))return;
      const list=(Array.isArray(this.lastDrawnAssets)&&this.lastDrawnAssets.length)?this.lastDrawnAssets:((Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length)?this.lastFullCircuitAssets:[]);
      if(!list.length||!this.markerLayer)return;
      let label=String(this.currentDisplay||this.lastFullCircuitLabel||'current map view');
      if(!this.drawAllowed(label))label=/^circuit\s+/i.test(String(this.lastFullCircuitLabel||''))?this.lastFullCircuitLabel:'current map view';
      if(!this.drawAllowed(label))return;
      await this.drawAssets(list,label,false,{viewportFirst:true});
    }catch(e){try{Diagnostics?.log?.('Heli dot redraw skipped',String(e?.message||e));}catch(_){} }
  },
  gpsModeLabel(){
    return this.gpsMode==='track'?'Tracking':this.gpsMode==='follow'?'Follow':'Free scroll';
  },
  showGpsPanel(){
    this.gpsPanelHidden=false;
    const panel=document.getElementById('gpsPatrolPanel');
    if(panel){
      panel.classList.remove('hidden');
      panel.classList.toggle('minimized',!!this.gpsPanelMinimized);
    }
    this.updateGpsProfileButtons();
    this.updateGpsPanel();
  },
  hideGpsPanel(){
    this.gpsPanelHidden=true;
    document.getElementById('gpsPatrolPanel')?.classList.add('hidden');
  },
  toggleGpsPanelMinimized(){
    this.gpsPanelMinimized=!this.gpsPanelMinimized;
    const panel=document.getElementById('gpsPatrolPanel');
    if(panel)panel.classList.toggle('minimized',this.gpsPanelMinimized);
    const btn=document.getElementById('gpsPanelMinBtn');
    if(btn){btn.textContent=this.gpsPanelMinimized?'＋':'−';btn.setAttribute('aria-label',this.gpsPanelMinimized?'Expand GPS panel':'Minimise GPS panel');}
    this.updateGpsPanelMinimizedSummary();
  },
  updateGpsPanelMinimizedSummary(sum=null){
    const panel=document.getElementById('gpsPatrolPanel');
    if(!panel||!panel.classList.contains('minimized'))return false;
    if(!sum)sum=this.gpsNearestSummary?.();
    const lab=document.getElementById('gpsProfileLabel');
    const status=document.getElementById('gpsStatus');
    if(lab)lab.textContent='Nearest';
    if(status){
      if(sum?.nearest)status.textContent=`${this.titleForGpsAsset(sum.nearest)} · ${this.fmtGpsDistance(sum.nearestM)}`;
      else status.textContent='No mapped asset nearby';
    }
    return true;
  },
  updateGpsProfileButtons(){
    const p=this.gpsProfile||'walking';
    document.querySelectorAll('[data-gps-profile],[data-tools-gps-profile]').forEach(btn=>{
      const v=btn.dataset.gpsProfile||btn.dataset.toolsGpsProfile||'';
      btn.classList.toggle('active',v===p);
    });
    const lab=document.getElementById('gpsProfileLabel');
    if(lab)lab.textContent='Patrol';
    const profileSelect=document.getElementById('gpsProfileSelect');
    if(profileSelect&&profileSelect.value!==p)profileSelect.value=p;
    const actionSelect=document.getElementById('gpsActionSelect');
    if(actionSelect&&actionSelect.value!==this.gpsMode)actionSelect.value=this.gpsMode||'free';
    const status=document.getElementById('gpsStatus');
    if(status)status.textContent=this.gpsModeLabel();
    const followBtn=document.getElementById('gpsFollowModeBtn');
    if(followBtn){followBtn.textContent='Follow';followBtn.classList.toggle('active',this.gpsMode==='follow');}
    const trackBtn=document.getElementById('gpsTrackModeBtn');
    if(trackBtn){trackBtn.textContent='Track';trackBtn.classList.toggle('active',this.gpsMode==='track');}
    const locateBtn=document.getElementById('gpsLocateModeBtn');
    if(locateBtn){locateBtn.textContent='Locate';locateBtn.classList.toggle('active',this.gpsMode==='free');}
    const rotateBtn=document.getElementById('gpsRotateModeBtn');
    if(rotateBtn){
      rotateBtn.textContent=this.gpsRotateHeading?'Rotate ON':'Rotate OFF';
      rotateBtn.classList.toggle('active',!!this.gpsRotateHeading);
      rotateBtn.setAttribute('aria-pressed',this.gpsRotateHeading?'true':'false');
      rotateBtn.title=this.gpsRotateHeading?'Heading-up map rotation is on':'Heading-up map rotation is off';
    }
    const crumbBtn=document.getElementById('gpsBreadcrumbBtn');
    if(crumbBtn){
      crumbBtn.textContent=this.breadcrumbEnabled?'Trail ON':'Trail OFF';
      crumbBtn.classList.toggle('active',!!this.breadcrumbEnabled);
      crumbBtn.setAttribute('aria-pressed',this.breadcrumbEnabled?'true':'false');
      crumbBtn.title=this.breadcrumbEnabled?'Breadcrumb trail is recording':'Start breadcrumb trail';
    }
    const minBtn=document.getElementById('gpsPanelMinBtn');
    if(minBtn){minBtn.textContent=this.gpsPanelMinimized?'＋':'−';minBtn.setAttribute('aria-label',this.gpsPanelMinimized?'Expand GPS panel':'Minimise GPS panel');}
    this.updateGpsPanelMinimizedSummary?.();
  },
  updateGpsButton(){
    const btn=document.getElementById('gpsFollow');
    if(!btn)return;
    btn.classList.remove('gps-free','gps-following','gps-tracking','gps-error','gps-helicopter','gps-driving','active');
    btn.classList.add(this.gpsError?'gps-error':(this.gpsMode==='track'?'gps-tracking':this.gpsMode==='follow'?'gps-following':'gps-free'));
    if(this.gpsProfile==='helicopter')btn.classList.add('gps-helicopter');
    if(this.gpsProfile==='driving')btn.classList.add('gps-driving');
    btn.classList.toggle('active',this.gpsMode!=='free');
    btn.title='GPS locate — jump to current position, free scroll stays on';
    btn.setAttribute('aria-label',btn.title);
  },
  gpsSignalClass(acc){
    const n=Number(acc);
    if(!Number.isFinite(n)||n<=0)return 'gps-none';
    if(n<=10)return 'gps-strong';
    if(n<=25)return 'gps-good';
    if(n<=60)return 'gps-weak';
    return 'gps-poor';
  },
  updateGpsMapStatus(){
    const el=document.getElementById('gpsMapStatus');
    if(!el)return;
    const val=document.getElementById('gpsMapAccuracy');
    const g=this.gpsLast;
    const acc=Number(g?.accuracy);
    const cls=this.gpsError?'gps-none':this.gpsSignalClass(acc);
    el.classList.remove('gps-none','gps-strong','gps-good','gps-weak','gps-poor','active');
    el.classList.add(cls);
    if(g&&!this.gpsError)el.classList.add('active');
    if(val)val.textContent=(g&&!this.gpsError&&Number.isFinite(acc))?`${Math.round(acc)} m`:'—';
    el.title=(g&&!this.gpsError&&Number.isFinite(acc))?`GPS accuracy ${Math.round(acc)} m`:'GPS signal / accuracy';
  },
  startGpsWatch(auto=false){
    this.loadGpsProfile();
    this.updateGpsButton();
    this.updateGpsProfileButtons();
    if(!this.gpsPanelHidden)this.showGpsPanel();
    if(this.gpsWatchId!==null)return;
    if(!navigator.geolocation){this.gpsError=true; this.updateGpsButton(); this.updateGpsMapStatus(); if(!auto)UI.toast('GPS not available in this browser.'); return;}
    const icon=L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[22,22],iconAnchor:[11,11]});
    const update=pos=>{
      const lat=Number(pos.coords.latitude), lon=Number(pos.coords.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      const raw={lat,lon,accuracy:pos.coords.accuracy,altitude:pos.coords.altitude,altitudeAccuracy:pos.coords.altitudeAccuracy,heading:pos.coords.heading,speed:pos.coords.speed,ts:Date.now()};
      const prev=this.gpsLast;
      const fixed=this.filterGpsFix(raw,prev);
      const ll=[fixed.lat,fixed.lon];
      const headingRaw=Number(pos.coords.heading);
      const derivedHeading=(Number.isFinite(headingRaw)&&headingRaw>=0)?headingRaw:this.deriveGpsHeading(prev,{lat:fixed.lat,lon:fixed.lon});
      const stableHeading=this.stabiliseGpsHeading(prev,derivedHeading,Number(raw.speed));
      this.gpsError=false;
      this.gpsLastRaw=raw;
      this.gpsLast={
        lat:fixed.lat,lon:fixed.lon,
        rawLat:lat,rawLon:lon,
        accuracy:pos.coords.accuracy,
        altitude:pos.coords.altitude,
        altitudeAccuracy:pos.coords.altitudeAccuracy,
        heading:stableHeading,
        speed:pos.coords.speed,
        signal:this.gpsSignalLabel(pos.coords.accuracy),
        unstable:!!fixed.unstable,
        ts:raw.ts
      };
      if(!this.userMarker)this.userMarker=L.marker(ll,{icon,zIndexOffset:900}).addTo(this.map); else this.userMarker.setLatLng(ll);
      this.recordBreadcrumbPoint(ll);
      if(this.gpsPendingLocateOnce){this.jumpToGpsPosition(ll);this.gpsPendingLocateOnce=false;}
      else this.applyGpsModeView(ll);
      const acc=Math.round(pos.coords.accuracy||0);
      const status=document.getElementById('gpsStatus');
      if(status)status.textContent=this.gpsModeLabel();
      this.updateGpsMapStatus();
      const arrow=document.querySelector('#gpsFollow .gps-arrow-icon');
      if(arrow&&Number.isFinite(stableHeading))arrow.style.transform=`rotate(${Number(stableHeading)}deg)`;
      this.updateMapRotationFromGps();
      this.updateGpsButton();
      this.updateGpsPanel(pos);
    };
    const fail=err=>{
      this.gpsError=true;
      this.updateGpsButton();
      if(!auto)UI.toast(`GPS failed: ${err.message}`);
      const status=document.getElementById('gpsStatus');
      if(status)status.textContent='GPS unavailable';
      this.updateGpsMapStatus();
    };
    this.gpsWatchId=navigator.geolocation.watchPosition(update,fail,{enableHighAccuracy:true,timeout:15000,maximumAge:this.gpsProfile==='helicopter'?750:1500});
  },
  gpsPanelOverlapPx(){
    const panel=document.getElementById('gpsPatrolPanel');
    if(!panel||panel.classList.contains('hidden'))return 0;
    const mapEl=this.map?.getContainer?.()||document.getElementById('map');
    if(!mapEl)return Math.max(0,Number(panel.getBoundingClientRect?.().height)||0);
    try{
      const p=panel.getBoundingClientRect();
      const m=mapEl.getBoundingClientRect();
      return Math.max(0,Math.min(p.bottom,m.bottom)-Math.max(p.top,m.top));
    }catch(e){return 0;}
  },
  rotationPaneList(){
    if(!this.map)return [];
    const names=['tilePane','overlayPane','shadowPane','markerPane','tooltipPane','popupPane'];
    return names.map(n=>this.map.getPane?.(n)).filter(Boolean);
  },
  normaliseDeg(deg){
    const n=Number(deg);
    if(!Number.isFinite(n))return NaN;
    return ((n%360)+360)%360;
  },
  applyMapRotationDeg(deg){
    if(!this.map)return;
    const n=Number(deg);
    const rot=Number.isFinite(n)?n:0;
    this.mapRotationDeg=rot;
    const container=this.map.getContainer?.();
    if(container){
      container.classList.toggle('map-heading-up',Math.abs(rot)>0.4);
      container.style.setProperty('--map-rotation-deg',`${rot.toFixed(2)}deg`);
      container.style.setProperty('--map-counter-rotation',`${(-rot).toFixed(2)}deg`);
    }
    let origin='50% 50%';
    try{
      const c=this.map.latLngToLayerPoint(this.map.getCenter());
      if(Number.isFinite(c.x)&&Number.isFinite(c.y))origin=`${c.x}px ${c.y}px`;
    }catch(e){}
    for(const pane of this.rotationPaneList()){
      pane.style.transformOrigin=origin;
      pane.style.transform=Math.abs(rot)>0.4?`rotate(${rot.toFixed(2)}deg)`:'';
      pane.style.willChange=Math.abs(rot)>0.4?'transform':'';
    }
    this.updateHeadingDragFix?.();
  },
  reapplyMapRotation(){
    if(!this.gpsRotateHeading){
      if(Math.abs(Number(this.mapRotationDeg)||0)>0.4)this.applyMapRotationDeg(0);
      return;
    }
    if(Math.abs(Number(this.mapRotationDeg)||0)>0.4)this.applyMapRotationDeg(this.mapRotationDeg);
  },
  updateMapRotationFromGps(opts={}){
    if(!this.gpsRotateHeading){
      if(Math.abs(Number(this.mapRotationDeg)||0)>0.4)this.applyMapRotationDeg(0);
      return;
    }
    const h=Number(this.gpsLast?.heading);
    if(!Number.isFinite(h))return;
    if(this.gpsLast?.unstable&&!opts.force)return;
    if(!opts.force&&this._gpsUserMoving)return;
    const sp=Number(this.gpsLast?.speed);
    const moving=Number.isFinite(sp)?sp>(this.gpsProfile==='helicopter'?1.7:.65):true;
    const oldHeading=Number(this._mapHeadingUsed);
    const diff=Number.isFinite(oldHeading)?this.angleDiffDeg(oldHeading,h):999;
    if(!opts.force){
      if(!moving&&diff<55)return;
      if(diff<(this.gpsProfile==='helicopter'?7:9))return;
    }
    this._mapHeadingUsed=this.normaliseDeg(h);
    let target=-this._mapHeadingUsed;
    if(target<-180)target+=360;
    if(target>180)target-=360;
    const oldRot=Number(this._mapRotationSmoothed);
    const nextRot=opts.force||!Number.isFinite(oldRot)?target:this.smoothSignedDeg(oldRot,target,this.gpsProfile==='helicopter'?0.28:0.22);
    this._mapRotationSmoothed=nextRot;
    this.applyMapRotationDeg(nextRot);
  },
  smoothSignedDeg(prev,next,alpha){
    const a=Number(prev), b=Number(next);
    if(!Number.isFinite(a))return Number.isFinite(b)?b:0;
    if(!Number.isFinite(b))return a;
    const diff=(b-a+540)%360-180;
    return a+diff*Math.max(0,Math.min(1,Number(alpha)||0));
  },
  gpsLookAheadLatLng(ll,z,opts={}){
    if(!this.map||!Array.isArray(ll)||!window.L)return Array.isArray(ll)?L.latLng(ll[0],ll[1]):ll;
    const base=L.latLng(Number(ll[0]),Number(ll[1]));
    let heading=Number(this.gpsLast?.heading);
    if(!Number.isFinite(heading))return base;
    const speed=Number(this.gpsLast?.speed);
    const acc=Number(this.gpsLast?.accuracy);
    // Heli look-ahead was too aggressive before: heading + GPS accuracy jitter made the
    // map hunt around. Only update look-ahead heading when it is meaningfully different.
    const oldHeading=Number(this._gpsLastLookaheadHeading);
    const minHeadingChange=this.gpsProfile==='helicopter'?16:12;
    if(Number.isFinite(oldHeading)&&!opts.force){
      const diff=this.angleDiffDeg(oldHeading,heading);
      const moving=Number.isFinite(speed)&&speed>(this.gpsProfile==='helicopter'?4:1.2);
      if(diff<minHeadingChange || !moving)heading=oldHeading;
      else this._gpsLastLookaheadHeading=heading;
    }else{
      this._gpsLastLookaheadHeading=heading;
    }
    const panelPx=this.gpsPanelOverlapPx();
    const panelBoost=panelPx>0?Math.min(95,Math.max(42,panelPx*0.18)):52;
    const accPenalty=Number.isFinite(acc)?Math.min(32,Math.max(0,(acc-15)*0.35)):0;
    const lookPx=Math.max(82,(this.gpsMode==='track'?118:92)+panelBoost-accPenalty);
    const rad=heading*Math.PI/180;
    const dx=Math.sin(rad)*lookPx;
    const dy=-Math.cos(rad)*lookPx;
    try{
      const pt=this.map.project(base,z).add([dx,dy]);
      return this.map.unproject(pt,z);
    }catch(e){return base;}
  },
  smoothLatLngTarget(target,opts={}){
    if(!target||!Number.isFinite(Number(target.lat))||!Number.isFinite(Number(target.lng)))return target;
    if(opts.force||this.gpsMode!=='track'){
      this._gpsTrackCenter={lat:Number(target.lat),lng:Number(target.lng)};
      return target;
    }
    const old=this._gpsTrackCenter;
    if(!old||!Number.isFinite(Number(old.lat))||!Number.isFinite(Number(old.lng))){
      this._gpsTrackCenter={lat:Number(target.lat),lng:Number(target.lng)};
      return target;
    }
    const d=this.distanceM({lat:old.lat,lon:old.lng},{lat:target.lat,lon:target.lng});
    const alpha=d>180?.48:(d>80?.36:.24);
    const lat=Number(old.lat)+(Number(target.lat)-Number(old.lat))*alpha;
    const lng=Number(old.lng)+(Number(target.lng)-Number(old.lng))*alpha;
    this._gpsTrackCenter={lat,lng};
    return L.latLng(lat,lng);
  },
  gpsSetAheadView(ll,z,opts={}){
    let center=(this.gpsMode==='track')?this.gpsLookAheadLatLng(ll,z,opts):L.latLng(ll[0],ll[1]);
    center=this.smoothLatLngTarget(center,opts);
    if(!opts.force){
      try{
        const cur=this.map.getCenter?.();
        const d=cur?this.distanceM({lat:cur.lat,lon:cur.lng},{lat:center.lat,lon:center.lng}):Infinity;
        const minMove=this.gpsMode==='track'?32:7;
        if(Number.isFinite(d)&&d<minMove)return;
      }catch(e){}
    }
    const viewOpts={...opts}; delete viewOpts.force;
    this.setProgrammaticGpsView(()=>this.map.panTo(center,{...viewOpts,animate:true,duration:this.gpsMode==='track'?0.55:0.32}));
  },
  setProgrammaticGpsView(fn){
    // Mobile Leaflet sometimes emits delayed moveend/zoomend after animated pan.
    // Hold this long enough so programmatic GPS pans do not get mistaken for user panning.
    this._gpsProgrammaticMoveUntil=Date.now()+1800;
    try{fn?.();}finally{setTimeout(()=>{if(Date.now()>(this._gpsProgrammaticMoveUntil||0))this._gpsProgrammaticMoveUntil=0;},1850);}
  },
  jumpToGpsPosition(ll){
    if(!this.map||!Array.isArray(ll))return;
    const z=this.map.getZoom?.()||15;
    this.setProgrammaticGpsView(()=>this.map.setView(ll,z,{animate:true,duration:0.25}));
    this.updateMapRotationFromGps({force:true});
    this.updateGpsButton();
    this.updateGpsPanel();
    UI?.toast?.('GPS located. Free scroll on.');
  },
  onGpsMapUserMovementStart(){
    if(this.gpsMode==='free')return;
    if(Date.now()<(this._gpsProgrammaticMoveUntil||0))return;
    this._gpsUserMoving=true;
    this._gpsSuspendUntil=Date.now()+5000;
    if(this.gpsInteractionTimer){clearTimeout(this.gpsInteractionTimer);this.gpsInteractionTimer=null;}
  },
  onGpsMapUserMovementEnd(){
    if(this.gpsMode==='free')return;
    if(Date.now()<(this._gpsProgrammaticMoveUntil||0))return;
    this._gpsUserMoving=false;
    this._gpsSuspendUntil=Date.now()+5000;
    if(this.gpsInteractionTimer)clearTimeout(this.gpsInteractionTimer);
    this.gpsInteractionTimer=setTimeout(()=>{
      this.gpsInteractionTimer=null;
      if(this.gpsMode==='free'||!this.gpsLast)return;
      if(Date.now()<(this._gpsSuspendUntil||0)-50)return;
      this.applyGpsModeView([this.gpsLast.lat,this.gpsLast.lon],{force:true});
    },5000);
  },
  applyGpsModeView(ll,opts={}){
    if(!this.map||!Array.isArray(ll))return;
    if(this.gpsMode==='free')return;
    if(!opts.force&&this.gpsLast?.unstable)return;
    const now=Date.now();
    if(!opts.force&&(this._gpsUserMoving||now<(this._gpsSuspendUntil||0)))return;
    const throttle=this.gpsMode==='track'?2100:1100;
    if(!opts.force&&now-(this._lastGpsViewAt||0)<throttle)return;
    this._lastGpsViewAt=now;
    const z=this.map.getZoom?.()||15;
    if(this.gpsMode==='track'||this.gpsMode==='follow'){
      try{
        const cur=this.map.getCenter?.();
        const d=cur?this.distanceM({lat:cur.lat,lon:cur.lng},{lat:Number(ll[0]),lon:Number(ll[1])}):Infinity;
        const minMove=this.gpsMode==='track'?7:5;
        if(!opts.force&&Number.isFinite(d)&&d<minMove)return;
      }catch(e){}
      if(this.gpsMode==='track')this.gpsSetAheadView(ll,z,{force:!!opts.force});
      else this.setProgrammaticGpsView(()=>this.map.setView(ll,z,{animate:true,duration:0.32}));
      this.updateMapRotationFromGps({force:!!opts.force});
    }
  },
  deriveGpsHeading(prev,next){
    if(!prev||!next)return NaN;
    const dist=this.distanceM(prev,next);
    if(!Number.isFinite(dist)||dist<4)return Number(prev.heading);
    return this.bearingDeg(prev,next);
  },
  distanceM(a,b){
    const lat1=Number(a?.lat), lon1=Number(a?.lon), lat2=Number(b?.lat), lon2=Number(b?.lon);
    if(!Number.isFinite(lat1)||!Number.isFinite(lon1)||!Number.isFinite(lat2)||!Number.isFinite(lon2))return Infinity;
    const R=6371000;
    const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
    const s1=Math.sin(dLat/2), s2=Math.sin(dLon/2);
    const h=s1*s1+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*s2*s2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  },
  bearingDeg(a,b){
    const lat1=Number(a?.lat)*Math.PI/180, lat2=Number(b?.lat)*Math.PI/180;
    const dLon=(Number(b?.lon)-Number(a?.lon))*Math.PI/180;
    if(!Number.isFinite(lat1)||!Number.isFinite(lat2)||!Number.isFinite(dLon))return NaN;
    const y=Math.sin(dLon)*Math.cos(lat2);
    const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  },
  angleDiffDeg(a,b){
    if(!Number.isFinite(Number(a))||!Number.isFinite(Number(b)))return 999;
    let d=Math.abs((Number(a)-Number(b)+540)%360-180);
    return d;
  },
  gpsCardinal(deg){
    const n=Number(deg);
    if(!Number.isFinite(n))return '';
    const dirs=['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round((((n%360)+360)%360)/45)%8]||'';
  },
  gpsSignalLabel(acc){
    const n=Number(acc);
    if(!Number.isFinite(n)||n<=0)return 'GPS';
    if(n<=6)return 'EXCELLENT';
    if(n<=12)return 'STRONG';
    if(n<=25)return 'GOOD';
    if(n<=50)return 'FAIR';
    if(n<=100)return 'WEAK';
    return 'POOR';
  },
  gpsAccuracyIsUsable(acc){
    const n=Number(acc);
    if(!Number.isFinite(n)||n<=0)return true;
    const limit=this.gpsProfile==='helicopter'?120:90;
    return n<=limit;
  },
  smoothAngleDeg(prev,next,alpha){
    const a=Number(prev), b=Number(next);
    if(!Number.isFinite(a))return Number.isFinite(b)?((b%360)+360)%360:NaN;
    if(!Number.isFinite(b))return ((a%360)+360)%360;
    const diff=(b-a+540)%360-180;
    return (a+diff*Math.max(0,Math.min(1,Number(alpha)||0))+360)%360;
  },
  stabiliseGpsHeading(prev,heading,speed){
    const h=Number(heading);
    const old=Number(prev?.heading);
    if(!Number.isFinite(h))return Number.isFinite(old)?old:NaN;
    if(!Number.isFinite(old))return h;
    const sp=Number(speed);
    const minSpeed=this.gpsProfile==='helicopter'?5.5:1.1;
    const diff=this.angleDiffDeg(old,h);
    if((!Number.isFinite(sp)||sp<minSpeed)&&diff<42)return old;
    if(diff<(this.gpsProfile==='helicopter'?16:10))return old;
    const alpha=this.gpsProfile==='helicopter'?0.24:(Number.isFinite(sp)&&sp>4?0.32:0.22);
    return this.smoothAngleDeg(old,h,alpha);
  },
  filterGpsFix(raw,prev){
    const now=Number(raw?.ts)||Date.now();
    const lat=Number(raw?.lat), lon=Number(raw?.lon);
    const out={lat,lon,unstable:false};
    if(!prev||!Number.isFinite(lat)||!Number.isFinite(lon))return out;
    const acc=Number(raw?.accuracy);
    const oldAcc=Number(prev?.accuracy);
    const sp=Number(raw?.speed);
    const dt=Math.max(.5,Math.min(12,(now-Number(prev.ts||now))/1000));
    const dist=this.distanceM(prev,{lat,lon});
    const accNow=Number.isFinite(acc)&&acc>0?acc:25;
    const accPrev=Number.isFinite(oldAcc)&&oldAcc>0?oldAcc:accNow;
    const jitterM=Math.max(this.gpsProfile==='helicopter'?10:5,Math.min(this.gpsProfile==='helicopter'?35:22,accNow*.55));
    const maxExpected=(Number.isFinite(sp)&&sp>=0?sp*dt:0)+Math.max(accNow,accPrev,18)*2.2+18;
    if(!this.gpsAccuracyIsUsable(acc)&&dist>Math.max(18,accPrev*.8)){
      out.lat=prev.lat; out.lon=prev.lon; out.unstable=true; return out;
    }
    if(Number.isFinite(dist)&&dist<jitterM&&(!Number.isFinite(sp)||sp<(this.gpsProfile==='helicopter'?3.5:1.3))){
      out.lat=prev.lat; out.lon=prev.lon; return out;
    }
    if(Number.isFinite(dist)&&dist>maxExpected&&accNow>accPrev*1.5){
      out.lat=prev.lat; out.lon=prev.lon; out.unstable=true; return out;
    }
    const highSpeed=Number.isFinite(sp)&&sp>10;
    const midSpeed=Number.isFinite(sp)&&sp>3;
    const alpha=highSpeed?0.72:(midSpeed?0.52:(accNow<=10?0.46:(accNow<=25?0.32:0.18)));
    out.lat=Number(prev.lat)+(lat-Number(prev.lat))*alpha;
    out.lon=Number(prev.lon)+(lon-Number(prev.lon))*alpha;
    return out;
  },
  fmtGpsDistance(m){
    const n=Number(m);
    if(!Number.isFinite(n))return '—';
    if(n<1000)return `${Math.round(n)} m`;
    return `${(n/1000).toFixed(n<10000?1:0)} km`;
  },
  clearGpsPing(){
    if(this.gpsPingTimer){clearTimeout(this.gpsPingTimer);this.gpsPingTimer=null;}
    if(this.gpsPingMarker){try{this.map?.removeLayer?.(this.gpsPingMarker);}catch(e){try{this.gpsPingMarker.remove();}catch(_){}} this.gpsPingMarker=null;}
  },
  findNearestGpsAssetForPing(){
    let sum=this.gpsNearestSummary?.();
    let a=sum?.nearest;
    if(a)return {asset:a,summary:sum};
    if(!this.gpsLast)return {asset:null,summary:null};
    const origin={lat:this.gpsLast.lat,lon:this.gpsLast.lon};
    const pools=[];
    if(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length)pools.push(this.lastFullCircuitAssets);
    if(Array.isArray(this.lastDrawnAssets)&&this.lastDrawnAssets.length)pools.push(this.lastDrawnAssets);
    const near=this.nearbyAssetsForGps?.(origin.lat,origin.lon);
    if(Array.isArray(near)&&near.length)pools.push(near);
    if(!pools.length&&Array.isArray(App.assets)&&App.assets.length<=90000)pools.push(App.assets);
    const seen=new Set(); let best=null,bestM=Infinity;
    for(const pool of pools){
      for(const x of pool||[]){
        if(!x||x.kind==='circuit'||UtilitiesEngine?.isUtility?.(x))continue;
        const lat=Number(x.lat), lon=Number(x.lon);
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const id=String(x.id||x.assetId||x.globalId||`${lat},${lon},${x.label||x.line||''}`);
        if(seen.has(id))continue; seen.add(id);
        const m=this.distanceM(origin,{lat,lon});
        if(Number.isFinite(m)&&m<bestM){best=x;bestM=m;}
      }
      if(best&&bestM<2500)break;
    }
    if(best){sum={nearest:best,nearestM:bestM,circuit:this.circuitForGpsAsset(best)||this.currentCircuit||''};this.gpsNearestCache={...sum,ts:Date.now()};}
    return {asset:best,summary:sum};
  },
  ensurePingVisibleOnMap(target){
    if(!this.map||!target)return;
    const lat=Number(target.lat), lon=Number(target.lon??target.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    try{
      const ll=L.latLng(lat,lon);
      const visible=this.map.getBounds?.()?.pad?.(-0.10)?.contains?.(ll);
      if(visible)return;
      const g=this.gpsLast;
      if(g&&(this.gpsMode==='follow'||this.gpsMode==='track')){
        let z=Number(this.map.getZoom?.()||15);
        const minZ=9;
        const size=this.map.getSize?.();
        const usableX=Math.max(120,Number(size?.x||360)*0.43);
        const usableY=Math.max(120,Number(size?.y||640)*0.34);
        for(;z>minZ;z--){
          const c=this.map.project(L.latLng(g.lat,g.lon),z);
          const p=this.map.project(ll,z);
          if(Math.abs(p.x-c.x)<usableX&&Math.abs(p.y-c.y)<usableY)break;
        }
        this.setProgrammaticGpsView(()=>this.map.setView([g.lat,g.lon],z,{animate:true,duration:.35}));
        this.updateMapRotationFromGps({force:true});
      }else{
        this.setProgrammaticGpsView(()=>this.map.panTo(ll,{animate:true,duration:.35}));
      }
    }catch(e){}
  },
  pingNearestGpsAsset(durationMs=10000,opts={}){
    const found=this.findNearestGpsAssetForPing();
    const a=found.asset;
    const sum=found.summary||{};
    const lat=Number(a?.lat), lon=Number(a?.lon);
    if(!this.map||!window.L){UI?.toast?.('Map not ready.');return;}
    if(!a||!Number.isFinite(lat)||!Number.isFinite(lon)){UI?.toast?.('No nearest asset to ping yet. Wait for GPS/nearest to update.');return;}
    this.clearGpsPing();
    const ll=L.latLng(lat,lon);
    const group=L.layerGroup().addTo(this.map);
    try{
      L.circleMarker(ll,{radius:26,color:'#fffaf0',weight:5,opacity:1,fill:false,interactive:false,pane:'overlayPane'}).addTo(group);
      L.circleMarker(ll,{radius:20,color:'#f07800',weight:5,opacity:1,fill:false,interactive:false,pane:'overlayPane',className:'gps-ping-ring'}).addTo(group);
      L.circleMarker(ll,{radius:8,color:'#fffaf0',weight:3,fillColor:'#f07800',fillOpacity:1,interactive:false,pane:'overlayPane'}).addTo(group);
    }catch(e){}
    try{
      const icon=L.divIcon({
        className:'gps-ping-leaflet-icon',
        html:'<div class="gps-ping-marker" aria-hidden="true"><span></span><i></i></div>',
        iconSize:[78,78],
        iconAnchor:[39,39]
      });
      L.marker(ll,{icon,interactive:false,zIndexOffset:5000,riseOnHover:false}).addTo(group);
    }catch(e){}
    this.gpsPingMarker=group;
    this.ensurePingVisibleOnMap({lat,lon});
    const btn=document.getElementById('gpsNearestPingBtn');
    if(btn){btn.classList.add('pinging');setTimeout(()=>btn.classList.remove('pinging'),950);}
    this.gpsPingTimer=setTimeout(()=>this.clearGpsPing(),Math.max(2500,Number(durationMs)||10000));
    UI?.toast?.(`Pinged nearest: ${this.titleForGpsAsset(a)}${Number.isFinite(Number(sum?.nearestM))?' · '+this.fmtGpsDistance(sum.nearestM):''}`);
  },
  titleForGpsAsset(a){
    if(!a)return '—';
    try{return PopupEngine?.displayTitle?.(a)||SearchEngine?.referenceName?.(a)||a.label||a.line||'Asset';}
    catch(e){return a?.label||a?.line||'Asset';}
  },
  circuitForGpsAsset(a){
    if(!a)return this.currentCircuit||'';
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const line=refs[0]?.line||a.line||this.currentCircuit||'';
      return SearchEngine?.formatCircuitName?.(line)||line||'';
    }catch(e){return a?.line||this.currentCircuit||'';}
  },
  structureNumberForGpsAsset(a){
    try{return Number(this.structureNumberForDot?.(a));}catch(e){return NaN;}
  },
  nearbyAssetsForGps(lat,lon){
    const active=(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length?this.lastFullCircuitAssets:(Array.isArray(this.lastDrawnAssets)?this.lastDrawnAssets:[]))
      .filter(a=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit');
    if(active.length)return active;
    const idx=SearchEngine?.spatialIndex;
    const size=Number(SearchEngine?.spatialGridSize||0.025);
    if(idx&&idx.size&&Number.isFinite(size)&&size>0){
      const cy=Math.floor(Number(lat)/size), cx=Math.floor(Number(lon)/size);
      const seen=new Set(); const out=[];
      for(const r of [1,2,4,8]){
        for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++){
          const cell=idx.get(`${y}|${x}`); if(!cell)continue;
          for(const a of cell){
            if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon))||a.kind==='circuit')continue;
            const id=String(a.id||a.assetId||`${a.lat},${a.lon},${a.label||''}`);
            if(seen.has(id))continue; seen.add(id); out.push(a);
          }
        }
        if(out.length>=30)return out;
      }
      if(out.length)return out;
    }
    const all=App.assets||[];
    if(all.length>60000)return [];
    return all.filter(a=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a));
  },
  gpsNearestSummary(){
    const g=this.gpsLast;
    if(!g)return null;
    const now=Date.now();
    if(this.gpsNearestCache&&now-(this.gpsNearestCache.ts||0)<(this.gpsProfile==='helicopter'?900:1600))return this.gpsNearestCache;
    const origin={lat:g.lat,lon:g.lon};
    const list=this.nearbyAssetsForGps(g.lat,g.lon);
    let nearest=null, nearestM=Infinity;
    for(const a of list){
      const m=this.distanceM(origin,a);
      if(m<nearestM){nearestM=m;nearest=a;}
    }
    let next=null,nextM=Infinity;
    const circuit=this.circuitForGpsAsset(nearest)||this.currentCircuit||'';
    const active=(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length?this.lastFullCircuitAssets:(Array.isArray(this.lastDrawnAssets)?this.lastDrawnAssets:[]));
    if(nearest&&active.length>1){
      const nLine=SearchEngine?.compact?.(this.circuitForGpsAsset(nearest)||'')||'';
      const sorted=active.filter(a=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&(nLine?SearchEngine?.compact?.(this.circuitForGpsAsset(a)||'')===nLine:true)).slice().sort(SearchEngine?.sortByStructure||(()=>0));
      const ni=sorted.indexOf(nearest);
      const candidates=[];
      if(ni>0)candidates.push(sorted[ni-1]);
      if(ni>=0&&ni<sorted.length-1)candidates.push(sorted[ni+1]);
      const heading=Number(g.heading);
      let bestScore=Infinity;
      for(const c of candidates){
        const m=this.distanceM(origin,c);
        const b=this.bearingDeg(origin,c);
        const diff=this.angleDiffDeg(heading,b);
        const score=(Number.isFinite(heading)?diff*7:0)+m;
        if(score<bestScore){bestScore=score;next=c;nextM=m;}
      }
    }
    if(!next&&nearest){
      const heading=Number(g.heading); let bestScore=Infinity;
      for(const a of list){
        if(a===nearest)continue;
        const m=this.distanceM(origin,a);
        if(!Number.isFinite(m)||m<2)continue;
        const b=this.bearingDeg(origin,a);
        const diff=this.angleDiffDeg(heading,b);
        const score=(Number.isFinite(heading)?diff*8:0)+m;
        if(score<bestScore){bestScore=score;next=a;nextM=m;}
      }
    }
    const summary={ts:now,nearest,nearestM,next,nextM,circuit};
    this.gpsNearestCache=summary;
    return summary;
  },
  updateGpsPanel(pos){
    const g=this.gpsLast;
    this.updateGpsProfileButtons();
    this.updateGpsMapStatus();
    if(!g)return;
    const speedMps=Number(g.speed);
    const kmh=Number.isFinite(speedMps)&&speedMps>=0?speedMps*3.6:NaN;
    const kt=Number.isFinite(speedMps)&&speedMps>=0?speedMps*1.943844:NaN;
    const speedText=Number.isFinite(kmh)?(this.gpsProfile==='helicopter'?`${Math.round(kmh)} km/h · ${Math.round(kt)} kt`:`${Math.round(kmh)} km/h`):'—';
    const altitude=Number(g.altitude);
    const heading=Number(g.heading);
    const acc=Number(g.accuracy);
    const set=(id,val)=>{const el=document.getElementById(id); if(el)el.textContent=val;};
    set('gpsSpeedValue',speedText);
    set('gpsAltitudeValue',Number.isFinite(altitude)?`${Math.round(altitude)} m · ${Math.round(altitude*3.28084)} ft`:'—');
    set('gpsHeadingValue',Number.isFinite(heading)?`${Math.round(heading)}° · ${this.gpsCardinal(heading)}`:'—');
    set('gpsAccuracyValue',Number.isFinite(acc)?`${Math.round(acc)} m`:'—');
    const status=document.getElementById('gpsStatus');
    if(status)status.textContent=this.gpsMode==='track'?'Tracking':this.gpsModeLabel();
    this.updateGpsMapStatus();
    const sum=this.gpsNearestSummary();
    const pingBtn=document.getElementById('gpsNearestPingBtn');
    if(sum?.nearest){
      set('gpsNearestValue',`${this.titleForGpsAsset(sum.nearest)} · ${this.fmtGpsDistance(sum.nearestM)}`);
      set('gpsCircuitValue',sum.circuit||this.circuitForGpsAsset(sum.nearest)||'—');
      if(pingBtn){pingBtn.disabled=false;pingBtn.title='Ping nearest asset on the map for 10 seconds';}
    }else{
      set('gpsNearestValue','No mapped asset nearby');
      set('gpsCircuitValue',this.currentCircuit||'—');
      if(pingBtn){pingBtn.disabled=true;pingBtn.title='No nearest asset to ping';}
    }
    this.updateGpsPanelMinimizedSummary(sum);
    if(sum?.next)set('gpsNextValue',`${this.titleForGpsAsset(sum.next)} · ${this.fmtGpsDistance(sum.nextM)}`);
    else set('gpsNextValue','—');
  },


  isMapInteractionUiTarget(target){
    try{
      return !!(target&&target.closest&&target.closest('.leaflet-popup,.leaflet-control,.lean-left-rail,.gps-patrol-panel,.plus-menu,.circuit-picker,.search-panel,.status-panel,.conductors-panel,.tools-panel,.reset-panel,.data-manager-panel,.overlay,.import-overlay'));
    }catch(e){return false;}
  },
  latLngFromDomEvent(e){
    if(!this.map||!window.L)return null;
    if(e?.latlng)return L.latLng(e.latlng.lat,e.latlng.lng);
    const src=e?.touches?.[0]||e?.changedTouches?.[0]||e?.originalEvent?.touches?.[0]||e?.originalEvent?.changedTouches?.[0]||e?.originalEvent||e;
    const x=Number(src?.clientX), y=Number(src?.clientY);
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    const rect=this.map.getContainer?.().getBoundingClientRect?.();
    if(!rect)return null;
    return this.map.containerPointToLatLng(L.point(x-rect.left,y-rect.top));
  },
  bindPinDropHold(){
    if(!this.map||this._pinDropHoldBound)return;
    this._pinDropHoldBound=true;
    const container=this.map.getContainer?.();
    const begin=e=>{
      if(this.measureMode)return;
      if(e?.pointerType==='mouse'&&e.button!==0)return;
      if(this.isMapInteractionUiTarget(e?.target))return;
      const ll=this.latLngFromDomEvent(e);
      if(!ll)return;
      this.cancelPinDropHold(false);
      this.pinDropHoldMoved=false;
      const src=e?.touches?.[0]||e?.changedTouches?.[0]||e;
      this._pinDropHoldState={x:Number(src.clientX),y:Number(src.clientY),ll:L.latLng(ll.lat,ll.lng),pointerId:e.pointerId,dropped:false,startedAt:Date.now()};
      this.pinDropHoldTimer=setTimeout(()=>{
        const st=this._pinDropHoldState;
        this.pinDropHoldTimer=null;
        if(st&&!this.pinDropHoldMoved){
          st.dropped=true;
          this._pinDropSuppressClickUntil=Date.now()+1200;
          this.dropHoldPin(st.ll,{temporary:true});
        }
      },2000);
    };
    const move=e=>{
      const st=this._pinDropHoldState;
      if(!st)return;
      if(st.pointerId!=null&&e.pointerId!=null&&st.pointerId!==e.pointerId)return;
      const src=e?.touches?.[0]||e?.changedTouches?.[0]||e;
      const dx=Number(src.clientX)-Number(st.x), dy=Number(src.clientY)-Number(st.y);
      if(Math.hypot(dx,dy)>18)this.cancelPinDropHold(true);
    };
    const finish=e=>{
      const dropped=this._pinDropHoldState?.dropped;
      if(dropped){
        try{e.preventDefault();e.stopPropagation();}catch(_e){}
        this._pinDropSuppressClickUntil=Date.now()+1200;
      }
      this.cancelPinDropHold(true);
    };
    if(container){
      container.addEventListener('pointerdown',begin,{passive:true});
      container.addEventListener('pointermove',move,{passive:true});
      container.addEventListener('pointerup',finish,{capture:true,passive:false});
      container.addEventListener('pointercancel',finish,{capture:true,passive:false});
      container.addEventListener('pointerleave',finish,{passive:true});
      container.addEventListener('touchstart',begin,{passive:true});
      container.addEventListener('touchmove',move,{passive:true});
      container.addEventListener('touchend',finish,{capture:true,passive:false});
      container.addEventListener('touchcancel',finish,{capture:true,passive:false});
    }
    this.map.on('contextmenu',ev=>{
      if(this.measureMode||this.isMapInteractionUiTarget(ev?.originalEvent?.target))return;
      try{ev?.originalEvent?.preventDefault?.();ev?.originalEvent?.stopPropagation?.();}catch(e){}
      const ll=ev?.latlng||this.latLngFromDomEvent(ev);
      if(ll)this.dropHoldPin(ll,{temporary:true});
    });
    // Do not cancel on normal Leaflet dragstart: Android sometimes fires it during a still long-press.
    this.map.on('zoomstart popupopen',()=>this.cancelPinDropHold(true));
  },
  bindPinDropPopupActions(){
    if(this._pinDropPopupActionsBound)return;
    this._pinDropPopupActionsBound=true;
    document.addEventListener('click',e=>{
      const btn=e.target?.closest?.('[data-pin-drop-action]');
      if(!btn)return;
      try{e.preventDefault();e.stopPropagation();}catch(_e){}
      const action=String(btn.dataset.pinDropAction||'').trim();
      const lat=Number(btn.dataset.lat), lon=Number(btn.dataset.lon);
      const id=String(btn.dataset.pinId||'');
      if(!action)return;
      if(action==='maps'){
        try{window.open(this.googleMapsUrlFor(lat,lon),'_blank','noopener');}catch(_e){location.href=this.googleMapsUrlFor(lat,lon);}
        return;
      }
      this.handlePinDropAction(action,lat,lon,id);
    },true);
  },
  startPinDropHold(ev){
    if(this.measureMode||!ev?.latlng)return;
    if(this.isMapInteractionUiTarget(ev?.originalEvent?.target))return;
    this.cancelPinDropHold(false);
    const ll=L.latLng(ev.latlng.lat,ev.latlng.lng);
    this.pinDropHoldMoved=false;
    this.pinDropHoldTimer=setTimeout(()=>{
      this.pinDropHoldTimer=null;
      if(!this.pinDropHoldMoved)this.dropHoldPin(ll,{temporary:true});
    },2000);
  },
  cancelPinDropHold(moved=true){
    this.pinDropHoldMoved=!!moved;
    if(this.pinDropHoldTimer){clearTimeout(this.pinDropHoldTimer);this.pinDropHoldTimer=null;}
    this._pinDropHoldState=null;
  },
  ensurePinDropLayer(){
    if(!this.map||!window.L)return null;
    if(!this.pinDropLayer)this.pinDropLayer=L.layerGroup().addTo(this.map);
    return this.pinDropLayer;
  },
  ensureSavedPinDropLayer(){
    if(!this.map||!window.L)return null;
    if(!this.savedPinDropLayer)this.savedPinDropLayer=L.layerGroup().addTo(this.map);
    return this.savedPinDropLayer;
  },
  pinStorageKey(){return 'myMapSavedPinDrops';},
  readSavedPinDrops(){
    try{
      const arr=JSON.parse(localStorage.getItem(this.pinStorageKey())||'[]');
      return Array.isArray(arr)?arr.filter(p=>Number.isFinite(Number(p?.pin?.lat))&&Number.isFinite(Number(p?.pin?.lon))):[];
    }catch(e){return [];}
  },
  writeSavedPinDrops(arr){
    try{localStorage.setItem(this.pinStorageKey(),JSON.stringify((Array.isArray(arr)?arr:[]).slice(0,300)));return true;}catch(e){return false;}
  },
  savedPinDropCount(){return this.readSavedPinDrops().length;},
  pinDropStatusLabel(){
    const n=this.savedPinDropCount();
    return n?`${n} saved${this.savedPinDropsVisible?' · shown':' · hidden'}`:'none saved';
  },
  makePinDropIcon(saved=false){
    return L.divIcon({
      className:`pin-drop-leaflet-icon ${saved?'saved-pin-icon':'temp-pin-icon'}`,
      html:`<div class="pin-drop-marker ${saved?'saved':'temp'}"><span></span></div>`,
      iconSize:[34,44],iconAnchor:[17,42],popupAnchor:[0,-38]
    });
  },
  openPinDropPopup(ll,opts={}){
    if(!this.map||!window.L||!ll)return;
    const latLng=L.latLng(Number(ll.lat),Number(ll.lng??ll.lon));
    if(!Number.isFinite(latLng.lat)||!Number.isFinite(latLng.lng))return;
    try{
      const popup=L.popup(Object.assign({},this.popupOptions(),{closeOnClick:false,autoClose:true,keepInView:true}))
        .setLatLng(latLng)
        .setContent(this.pinDropPopupHtml(latLng,opts));
      popup.openOn(this.map);
      setTimeout(()=>{try{this.refitOpenPopup?.();}catch(_e){}},80);
    }catch(e){
      try{this.pinDropMarker?.openPopup?.();this.refitOpenPopup?.();}catch(_e){}
    }
  },
  dropHoldPin(ll,opts={}){
    if(!this.map||!window.L||!ll)return;
    const layer=this.ensurePinDropLayer();
    if(!layer)return;
    try{this.pinDropMarker?.remove?.();}catch(e){try{layer.removeLayer(this.pinDropMarker);}catch(_){} }
    const latLng=L.latLng(Number(ll.lat),Number(ll.lng??ll.lon));
    if(!Number.isFinite(latLng.lat)||!Number.isFinite(latLng.lng))return;
    const marker=L.marker(latLng,{icon:this.makePinDropIcon(false),zIndexOffset:6100,riseOnHover:true,interactive:true,keyboard:true}).addTo(layer);
    marker.bindPopup(()=>this.pinDropPopupHtml(latLng,{saved:false}),Object.assign({},this.popupOptions(),{closeOnClick:false,keepInView:true}));
    marker.on('click',()=>this.openPinDropPopup(latLng,{saved:false}));
    this.pinDropMarker=marker;
    try{marker.setZIndexOffset?.(7000);marker.bringToFront?.();}catch(e){}
    const oldClose=this.map.options.closePopupOnClick;
    this.map.options.closePopupOnClick=false;
    setTimeout(()=>{try{this.map.options.closePopupOnClick=oldClose;}catch(e){}},1400);
    setTimeout(()=>this.openPinDropPopup(latLng,{saved:false}),140);
    UI?.toast?.('Pin dropped. Add comments then save, proximity check, Google Maps, or remove.');
  },
  removeCurrentPinDrop(showToast=true){
    try{this.pinDropMarker?.closePopup?.();}catch(e){}
    try{const p=this.map?._popup; if(p?.getElement?.()?.querySelector?.('.pin-drop-popup'))this.map.closePopup(p);}catch(e){}
    try{this.pinDropMarker?.remove?.();}catch(e){try{this.pinDropLayer?.removeLayer?.(this.pinDropMarker);}catch(_){} }
    this.pinDropMarker=null;
    if(showToast)UI?.toast?.('Pin removed.');
  },
  googleMapsUrlFor(lat,lon){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(Number(lat).toFixed(6)+','+Number(lon).toFixed(6))}`;},
  pinDropPopupHtml(ll,opts={}){
    const lat=Number(ll?.lat), lon=Number(ll?.lng??ll?.lon);
    const esc=UI?.esc||((v)=>String(v??''));
    const saved=!!opts.saved;
    const id=String(opts.id||opts.record?.id||'');
    const comments=String(opts.comments??opts.record?.comments??'');
    const maps=this.googleMapsUrlFor(lat,lon);
    const circuits=opts.record?.nearestCircuits250m||this.nearestCircuitsNear(lat,lon,250).slice(0,8);
    const title=saved?'Saved pin drop':'Pin drop';
    const meta=saved&&opts.record?.localDateTime?opts.record.localDateTime:new Date().toLocaleString();
    const idArg=esc(id).replace(/&#39;/g,'\\&#39;');
    const actionSave=saved?'Update comment':'Save pin';
    const removeLabel=saved?'Delete saved pin':'Remove pin';
    return `<div class="asset-popup pin-drop-popup"><b>${title}</b><div class="popup-info-box"><div><b>Pin GPS</b><span>${lat.toFixed(6)}, ${lon.toFixed(6)}</span></div><div><b>Date / time</b><span>${esc(meta)}</span></div><div><b>Nearest circuits</b><span>${circuits.length?esc(circuits.join(', ')):'None within 250 m'}</span></div></div><label class="pin-comment-label">Comments<textarea class="pin-drop-comment" rows="3" placeholder="Add notes for this pin...">${esc(comments)}</textarea></label><div class="popup-actions"><a class="popup-btn" target="_blank" rel="noopener" href="${maps}">Google Maps</a><button type="button" class="popup-btn" data-pin-drop-action="proximity" data-lat="${lat}" data-lon="${lon}" data-pin-id="${idArg}">Proximity 350m</button><button type="button" class="popup-btn primary" data-pin-drop-action="save" data-lat="${lat}" data-lon="${lon}" data-pin-id="${idArg}">${actionSave}</button><button type="button" class="popup-btn danger" data-pin-drop-action="${saved?'deleteSaved':'remove'}" data-lat="${lat}" data-lon="${lon}" data-pin-id="${idArg}">${removeLabel}</button></div><small>Saved pins keep comments, nearest circuits within 250 m, current date/time, GPS location and Google Maps link on this phone.</small></div>`;
  },
  pinDropCommentFromPopup(){
    try{return String(document.querySelector('.leaflet-popup-content textarea.pin-drop-comment')?.value||'').trim();}catch(e){return '';}
  },
  assetsNearPoint(lat,lon,radiusM=350,limit=80){
    const origin={lat:Number(lat),lon:Number(lon)};
    const pools=[];
    if(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length)pools.push(this.lastFullCircuitAssets);
    if(Array.isArray(this.lastDrawnAssets)&&this.lastDrawnAssets.length)pools.push(this.lastDrawnAssets);
    const near=this.nearbyAssetsForGps?.(origin.lat,origin.lon);
    if(Array.isArray(near)&&near.length)pools.push(near);
    if((!pools.length||radiusM>=350)&&Array.isArray(App.assets)&&App.assets.length<=120000)pools.push(App.assets);
    const seen=new Set(), out=[];
    for(const pool of pools){
      for(const a of pool||[]){
        if(!a||a.kind==='circuit'||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon))||UtilitiesEngine?.isUtility?.(a))continue;
        const id=String(a.id||a.assetId||a.globalId||`${a.lat},${a.lon},${a.label||''}`);
        if(seen.has(id))continue; seen.add(id);
        const m=this.distanceM(origin,{lat:Number(a.lat),lon:Number(a.lon)});
        if(Number.isFinite(m)&&m<=Number(radiusM)){out.push({asset:a,m});}
      }
    }
    out.sort((a,b)=>a.m-b.m);
    return out.slice(0,limit);
  },
  nearestCircuitsNear(lat,lon,radiusM=250){
    const set=new Set(), out=[];
    for(const r of this.assetsNearPoint(lat,lon,radiusM,180)){
      const c=this.circuitForGpsAsset(r.asset)||r.asset?.line||'';
      const k=SearchEngine?.compact?.(c)||String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(c&&k&&!set.has(k)){set.add(k);out.push(c);}
    }
    return out;
  },
  handlePinDropSaveFromPopup(lat,lon,id=''){
    return this.savePinDrop(lat,lon,this.pinDropCommentFromPopup(),id);
  },
  savePinDrop(lat,lon,comments='',existingId=''){
    lat=Number(lat);lon=Number(lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){UI?.toast?.('Could not save pin.');return null;}
    const arr=this.readSavedPinDrops();
    const now=new Date();
    const circuits=this.nearestCircuitsNear(lat,lon,250);
    const nearby=this.assetsNearPoint(lat,lon,250,20).map(r=>({title:this.titleForGpsAsset(r.asset),distanceM:Math.round(r.m),circuit:this.circuitForGpsAsset(r.asset)||''}));
    const g=this.gpsLast||{};
    const record={
      id:existingId||('pin-'+Date.now()),
      comments:String(comments||''),
      dateTime:now.toISOString(),
      localDateTime:now.toLocaleString(),
      pin:{lat,lon},
      gpsLocation:(Number.isFinite(Number(g.lat))&&Number.isFinite(Number(g.lon)))?{lat:Number(g.lat),lon:Number(g.lon),accuracy:g.accuracy??null,heading:g.heading??null}:null,
      googleMapsLocation:this.googleMapsUrlFor(lat,lon),
      nearestCircuits250m:circuits,
      nearestAssets250m:nearby
    };
    const i=arr.findIndex(p=>String(p.id)===String(record.id));
    if(i>=0)arr[i]=Object.assign({},arr[i],record); else arr.unshift(record);
    if(!this.writeSavedPinDrops(arr)){UI?.toast?.('Could not save pin on this device.');return null;}
    this.removeCurrentPinDrop(false);
    this.renderSavedPinDrops(true);
    try{
      const marker=this.findSavedPinMarker(record.id);
      if(marker){marker.openPopup();this.refitOpenPopup?.();}
    }catch(e){}
    UI?.toast?.(`${i>=0?'Pin updated':'Pin saved'}${circuits.length?' · '+circuits.length+' circuit(s) nearby':''}.`);
    try{window.LeanMapApp?.renderToolsPanel?.(true);}catch(e){}
    return record;
  },
  findSavedPinMarker(id){
    let found=null;
    try{this.savedPinDropLayer?.eachLayer?.(l=>{if(String(l?.options?.pinDropId||'')===String(id))found=l;});}catch(e){}
    return found;
  },
  renderSavedPinDrops(show=true){
    this.savedPinDropsVisible=!!show;
    const layer=this.ensureSavedPinDropLayer();
    if(!layer)return;
    try{layer.clearLayers();}catch(e){}
    if(!this.savedPinDropsVisible)return;
    const arr=this.readSavedPinDrops();
    for(const rec of arr){
      const lat=Number(rec?.pin?.lat), lon=Number(rec?.pin?.lon);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      try{
        const ll=L.latLng(lat,lon);
        const marker=L.marker(ll,{icon:this.makePinDropIcon(true),zIndexOffset:6050,riseOnHover:true,interactive:true,pinDropId:rec.id}).addTo(layer);
        marker.bindPopup(()=>this.pinDropPopupHtml(ll,{saved:true,id:rec.id,comments:rec.comments,record:rec}),this.popupOptions());
      }catch(e){}
    }
  },
  hideSavedPinDrops(){
    this.savedPinDropsVisible=false;
    try{this.savedPinDropLayer?.clearLayers?.();}catch(e){}
    UI?.toast?.('Saved pins hidden.');
    try{window.LeanMapApp?.renderToolsPanel?.(true);}catch(e){}
  },
  showSavedPinDrops(){
    this.renderSavedPinDrops(true);
    UI?.toast?.(`${this.savedPinDropCount()} saved pin(s) shown.`);
    try{window.LeanMapApp?.renderToolsPanel?.(true);}catch(e){}
  },
  deleteSavedPinDrop(id){
    const arr=this.readSavedPinDrops();
    const next=arr.filter(p=>String(p.id)!==String(id));
    if(next.length===arr.length){UI?.toast?.('Saved pin not found.');return;}
    if(!this.writeSavedPinDrops(next)){UI?.toast?.('Could not delete saved pin.');return;}
    try{this.map?.closePopup?.();}catch(e){}
    this.renderSavedPinDrops(this.savedPinDropsVisible);
    UI?.toast?.('Saved pin deleted.');
    try{window.LeanMapApp?.renderToolsPanel?.(true);}catch(e){}
  },
  clearSavedPinDrops(){
    const n=this.savedPinDropCount();
    if(!n){UI?.toast?.('No saved pins to clear.');return;}
    if(!confirm(`Delete ${n} saved pin drop(s) from this phone?`))return;
    if(!this.writeSavedPinDrops([])){UI?.toast?.('Could not clear saved pins.');return;}
    try{this.map?.closePopup?.();this.savedPinDropLayer?.clearLayers?.();}catch(e){}
    UI?.toast?.('Saved pins cleared.');
    try{window.LeanMapApp?.renderToolsPanel?.(true);}catch(e){}
  },
  exportSavedPinDrops(){
    const arr=this.readSavedPinDrops();
    if(!arr.length){UI?.toast?.('No saved pins to export.');return;}
    try{
      const blob=new Blob([JSON.stringify(arr,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;
      a.download=`myMap-pin-drops-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      UI?.toast?.('Saved pins export started.');
    }catch(e){UI?.toast?.('Export failed.');}
  },
  async saveSavedPinDropsAs(){
    const arr=this.readSavedPinDrops();
    if(!arr.length){UI?.toast?.('No saved pins to save.');return;}
    const filename=`myMap-pin-drops-${new Date().toISOString().slice(0,10)}.json`;
    const json=JSON.stringify(arr,null,2);
    try{
      if(window.showSaveFilePicker){
        const handle=await window.showSaveFilePicker({
          suggestedName:filename,
          types:[{description:'myMap pin drops JSON',accept:{'application/json':['.json']}}]
        });
        const writable=await handle.createWritable();
        await writable.write(new Blob([json],{type:'application/json'}));
        await writable.close();
        UI?.toast?.('Saved pins backup written.');
        return;
      }
    }catch(e){
      if(String(e?.name||'')==='AbortError'){UI?.toast?.('Save cancelled.');return;}
      try{console.warn('myMap save-as failed',e);}catch(_){}
    }
    this.exportSavedPinDrops();
  },
  handlePinDropAction(action,lat,lon,id=''){
    lat=Number(lat);lon=Number(lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    if(action==='proximity'){
      const rows=this.assetsNearPoint(lat,lon,350,14);
      const circuits=this.nearestCircuitsNear(lat,lon,350);
      const list=rows.length?rows.map(r=>`<div><b>${UI.esc(this.titleForGpsAsset(r.asset))}</b><span>${this.fmtGpsDistance(r.m)}${this.circuitForGpsAsset(r.asset)?' · '+UI.esc(this.circuitForGpsAsset(r.asset)):''}</span></div>`).join(''):'<p>No mapped assets found within 350 m.</p>';
      const backId=UI.esc(id).replace(/&#39;/g,'\&#39;');
      const html=`<div class="asset-popup pin-drop-popup"><b>Proximity check · 350 m</b><div class="popup-info-box">${list}</div><small>${circuits.length?`Nearest circuits: ${UI.esc(circuits.slice(0,8).join(', '))}`:'No nearby circuit names found.'}</small><div class="popup-actions"><button type="button" class="popup-btn" data-pin-drop-action="${id?'openSaved':'drop'}" data-lat="${lat}" data-lon="${lon}" data-pin-id="${backId}">Back to pin</button></div></div>`;
      try{L.popup(this.popupOptions()).setLatLng([lat,lon]).setContent(html).openOn(this.map);}catch(e){}
      return;
    }
    if(action==='save')return this.savePinDrop(lat,lon,this.pinDropCommentFromPopup(),id||'');
    if(action==='remove')return this.removeCurrentPinDrop(true);
    if(action==='deleteSaved')return this.deleteSavedPinDrop(id);
    if(action==='openSaved'){
      const rec=this.readSavedPinDrops().find(p=>String(p.id)===String(id));
      const ll=L.latLng(lat,lon);
      try{L.popup(this.popupOptions()).setLatLng(ll).setContent(this.pinDropPopupHtml(ll,{saved:true,id,comments:rec?.comments||'',record:rec||null})).openOn(this.map);}catch(e){}
      return;
    }
    if(action==='drop')return this.dropHoldPin(L.latLng(lat,lon),{temporary:true});
  },
  ensureBreadcrumbLayer(){
    if(!this.map||!window.L)return null;
    if(!this.breadcrumbLayer)this.breadcrumbLayer=L.layerGroup().addTo(this.map);
    return this.breadcrumbLayer;
  },
  toggleBreadcrumbTrail(){
    this.breadcrumbEnabled=!this.breadcrumbEnabled;
    if(this.breadcrumbEnabled){
      this.ensureBreadcrumbLayer();
      this.breadcrumbPoints=[];this.breadcrumbLastPoint=null;this.breadcrumbLastAt=0;
      UI?.toast?.('Breadcrumb trail ON.');
    }else{
      UI?.toast?.('Breadcrumb trail OFF. Trail kept on map.');
    }
    this.updateGpsProfileButtons();
  },
  clearBreadcrumbTrail(){
    this.breadcrumbPoints=[];this.breadcrumbLastPoint=null;this.breadcrumbLastAt=0;
    try{this.breadcrumbLayer?.clearLayers?.();}catch(e){}
  },
  recordBreadcrumbPoint(ll){
    if(!this.breadcrumbEnabled||!Array.isArray(ll)||!this.map||!window.L)return;
    const now=Date.now();
    const pt=L.latLng(Number(ll[0]),Number(ll[1]));
    if(!Number.isFinite(pt.lat)||!Number.isFinite(pt.lng))return;
    const last=this.breadcrumbLastPoint;
    const moved=last?this.distanceM({lat:last.lat,lon:last.lng},{lat:pt.lat,lon:pt.lng}):Infinity;
    if(Number.isFinite(moved)&&moved<8&&now-(this.breadcrumbLastAt||0)<8000)return;
    this.breadcrumbLastPoint=pt;this.breadcrumbLastAt=now;
    this.breadcrumbPoints.push(pt);
    if(this.breadcrumbPoints.length>1500)this.breadcrumbPoints.splice(0,this.breadcrumbPoints.length-1500);
    const layer=this.ensureBreadcrumbLayer(); if(!layer)return;
    try{layer.clearLayers();}catch(e){}
    try{
      if(this.breadcrumbPoints.length>1)L.polyline(this.breadcrumbPoints,{color:'#1f6f7a',weight:4,opacity:.82,dashArray:'4 8',interactive:false}).addTo(layer);
      for(let i=Math.max(0,this.breadcrumbPoints.length-60);i<this.breadcrumbPoints.length;i+=Math.max(1,Math.floor(this.breadcrumbPoints.length/120))){
        L.circleMarker(this.breadcrumbPoints[i],{radius:i===this.breadcrumbPoints.length-1?6:3,color:'#fffaf0',weight:2,fillColor:'#1f6f7a',fillOpacity:.9,interactive:false}).addTo(layer);
      }
    }catch(e){}
  },
  ensureMeasureLayer(){
    if(!this.map||!window.L)return null;
    if(!this.measureLayer)this.measureLayer=L.layerGroup().addTo(this.map);
    return this.measureLayer;
  },
  bindMeasureDomEvents(){
    if(!this.map||this._measureDomBound)return;
    this._measureDomBound=true;
    const container=this.map.getContainer?.();
    if(!container)return;
    const tap=e=>{
      if(!this.measureMode)return;
      if(this.isMapInteractionUiTarget(e?.target))return;
      // The Leaflet click handler handles mouse clicks. This catches Samsung/Android taps that do not emit a reliable map click.
      if(e.type==='pointerup'&&e.pointerType==='mouse')return;
      const ll=this.latLngFromDomEvent(e);
      if(!ll)return;
      try{e.preventDefault();e.stopPropagation();}catch(_e){}
      this.addMeasurePoint(ll,e);
    };
    container.addEventListener('pointerup',tap,{capture:true,passive:false});
    container.addEventListener('touchend',tap,{capture:true,passive:false});
  },
  formatMeasureDistance(m){
    const n=Number(m);
    if(!Number.isFinite(n))return '—';
    if(n<1000)return `${Math.round(n)} m`;
    return `${(n/1000).toFixed(n<10000?2:1)} km`;
  },
  measureStatusLabel(){
    if(this.measureMode)return this.measurePoints?.length?'first point set':'tap two points · snap on';
    return this.measureLayer?'result shown':'off';
  },
  startMeasureTool(){
    if(!this.map||!window.L){UI?.toast?.('Map not ready.');return;}
    this.clearMeasure(false);
    this.measureMode=true;
    this.measurePoints=[];
    this._lastMeasureInput=null;
    this.ensureMeasureLayer();
    try{this.map.getContainer?.().classList.add('measure-mode');}catch(e){}
    UI?.toast?.('Measure on. Tap two points. Snaps to nearby visible asset dots.');
  },
  stopMeasureTool(showToast=false){
    this.measureMode=false;
    try{this.map?.getContainer?.().classList.remove('measure-mode');}catch(e){}
    if(showToast)UI?.toast?.('Measure off.');
  },
  clearMeasure(showToast=true){
    this.measurePoints=[];
    this.measureMode=false;
    this._lastMeasureInput=null;
    try{this.map?.getContainer?.().classList.remove('measure-mode');}catch(e){}
    try{this.measureLayer?.clearLayers?.();}catch(e){}
    this.measureLayer=null;
    if(showToast)UI?.toast?.('Measure cleared.');
  },
  measureSnapCandidates(){
    const pools=[];
    if(Array.isArray(this.lastDrawnAssets)&&this.lastDrawnAssets.length)pools.push(this.lastDrawnAssets);
    if(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length)pools.push(this.lastFullCircuitAssets);
    const out=[], seen=new Set();
    for(const pool of pools){
      for(const a of pool||[]){
        if(!a||a.kind==='circuit'||UtilitiesEngine?.isUtility?.(a))continue;
        const lat=Number(a.lat), lon=Number(a.lon);
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const id=String(a.id||a.assetId||a.globalId||`${lat},${lon},${a.label||a.line||''}`);
        if(seen.has(id))continue; seen.add(id); out.push(a);
      }
    }
    if(!out.length&&Array.isArray(App.assets)&&App.assets.length<=70000){
      for(const a of App.assets){
        if(!a||a.kind==='circuit'||UtilitiesEngine?.isUtility?.(a))continue;
        if(Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)))out.push(a);
      }
    }
    return out;
  },
  snapLatLngToAsset(ll,opts={}){
    if(!this.map||!ll)return null;
    const z=Number(this.map.getZoom?.()||15);
    const maxPx=Number(opts.maxPx||30);
    const maxM=Number(opts.maxM||(z>=16?90:(z>=14?180:(z>=12?400:800))));
    let basePt;
    try{basePt=this.map.latLngToLayerPoint(ll);}catch(e){return null;}
    let best=null,bestPx=Infinity,bestM=Infinity;
    const origin={lat:Number(ll.lat),lon:Number(ll.lng)};
    for(const a of this.measureSnapCandidates()){
      let px=Infinity,m=Infinity;
      try{px=basePt.distanceTo(this.map.latLngToLayerPoint([Number(a.lat),Number(a.lon)]));}catch(e){}
      if(px>maxPx)continue;
      m=this.distanceM(origin,{lat:Number(a.lat),lon:Number(a.lon)});
      if(!Number.isFinite(m)||m>maxM)continue;
      if(px<bestPx){best=a;bestPx=px;bestM=m;}
    }
    if(!best)return null;
    return {asset:best,latlng:L.latLng(Number(best.lat),Number(best.lon)),px:bestPx,m:bestM,label:this.titleForGpsAsset(best)};
  },
  addMeasurePoint(rawLl,ev){
    if(!this.measureMode)return;
    const ll0=L.latLng(Number(rawLl.lat),Number(rawLl.lng??rawLl.lon));
    if(!Number.isFinite(ll0.lat)||!Number.isFinite(ll0.lng))return;
    const last=this._lastMeasureInput;
    const now=Date.now();
    if(last&&now-last.at<650&&this.distanceM({lat:last.lat,lon:last.lng},{lat:ll0.lat,lon:ll0.lng})<1.5)return;
    this._lastMeasureInput={at:now,lat:ll0.lat,lng:ll0.lng};
    const snap=this.measureSnapEnabled?this.snapLatLngToAsset(ll0):null;
    const ll=snap?.latlng||ll0;
    const layer=this.ensureMeasureLayer();
    if(!layer)return;
    try{ev?.originalEvent?.preventDefault?.();ev?.originalEvent?.stopPropagation?.();ev?.preventDefault?.();ev?.stopPropagation?.();}catch(e){}
    try{
      const icon=L.divIcon({className:'measure-dot-icon',html:`<div class="measure-dot ${snap?'snapped':''}"></div>`,iconSize:[24,24],iconAnchor:[12,12]});
      L.marker(ll,{icon,interactive:false,zIndexOffset:5200}).addTo(layer);
    }catch(e){
      try{L.circleMarker(ll,{radius:8,color:'#2f5a31',weight:4,fillColor:'#fffaf0',fillOpacity:1,interactive:false}).addTo(layer);}catch(_){ }
    }
    this.measurePoints.push(L.latLng(ll.lat,ll.lng));
    if(this.measurePoints.length===1){UI?.toast?.(snap?`First point snapped: ${snap.label}`:'First point set. Tap second point.');return;}
    const a=this.measurePoints[0], b=this.measurePoints[1];
    const m=this.distanceM({lat:a.lat,lon:a.lng},{lat:b.lat,lon:b.lng});
    try{
      L.polyline([a,b],{color:'#2f5a31',weight:5,opacity:.95,dashArray:'8 8',interactive:false}).addTo(layer);
      const mid=L.latLng((a.lat+b.lat)/2,(a.lng+b.lng)/2);
      L.tooltip({permanent:true,direction:'center',className:'measure-tooltip',interactive:false,offset:[0,0]}).setLatLng(mid).setContent(this.formatMeasureDistance(m)).addTo(layer);
    }catch(e){}
    this.stopMeasureTool(false);
    UI?.toast?.(`${snap?'Snapped · ':''}Measured ${this.formatMeasureDistance(m)}.`);
  },
  handleMeasureMapClick(ev){
    if(!this.measureMode)return;
    const ll=ev?.latlng||this.latLngFromDomEvent(ev);
    if(!ll)return;
    this.addMeasurePoint(ll,ev);
  },
  proximityOrigin(){return null;},
  proximityKind(){return 'other';},
  proximityLabelFor(){return 'Asset';},
  async collectDxProximityAssets(){return {items:[],skipped:false,total:0};},
  async showProximity(){UI?.toast?.('Proximity is disabled in this core-only build.');},
  formatProximityDistance(){return '—';},
  stopGpsFollow(toast=true){
    // Kept for older code paths. GPS now stays live so movement keeps updating.
    this.gpsMode='free';
    try{localStorage.setItem('fieldMapGpsMode','free');}catch(e){}
    this.updateGpsButton();
    this.updateGpsPanel();
    if(toast)UI.toast('GPS free scroll mode. Location still updates.');
  }
};

try{window.MapEngine=MapEngine; window.fmConnectedBtn=(btn,ev)=>MapEngine.handleConnectedCircuitsButton(btn,ev); window.fmMoreInfoBtn=(btn,ev)=>MapEngine.handleMoreInfoButton(btn,ev); window.fmPinDropAction=(action,lat,lon,id)=>MapEngine.handlePinDropAction(action,lat,lon,id); window.fmPinDropSaveFromPopup=(lat,lon,id)=>MapEngine.handlePinDropSaveFromPopup(lat,lon,id);}catch(e){}

/* myMap v3.1.105: safer pin drop popup actions for Android/Leaflet popups */
(function(){
  if(!window.MapEngine)return;
  const ME=window.MapEngine;
  const esc=function(v){try{return (window.UI&&UI.esc)?UI.esc(v):String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};
  const q=function(v){return String(v??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");};
  ME.pinDropPopupHtml=function(ll,opts={}){
    const lat=Number(ll?.lat), lon=Number(ll?.lng??ll?.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return '<div class="asset-popup pin-drop-popup"><b>Pin drop</b><p>Invalid pin location.</p></div>';
    const saved=!!opts.saved;
    const id=String(opts.id||opts.record?.id||'');
    const comments=String(opts.comments??opts.record?.comments??'');
    const maps=this.googleMapsUrlFor(lat,lon);
    let circuits=[];
    try{circuits=opts.record?.nearestCircuits250m||this.nearestCircuitsNear(lat,lon,250).slice(0,8);}catch(e){circuits=[];}
    const title=saved?'Saved pin drop':'New pin drop';
    const meta=saved&&opts.record?.localDateTime?opts.record.localDateTime:new Date().toLocaleString();
    const actionSave=saved?'Update saved pin':'Save pin';
    const removeLabel=saved?'Delete saved pin':'Remove pin';
    const removeAction=saved?'deleteSaved':'remove';
    const latS=String(lat), lonS=String(lon), idS=q(id);
    return `<div class="asset-popup pin-drop-popup" data-pin-popup="1"><b>${title}</b><div class="popup-info-box"><div><b>Pin GPS</b><span>${lat.toFixed(6)}, ${lon.toFixed(6)}</span></div><div><b>Date / time</b><span>${esc(meta)}</span></div><div><b>Nearest circuits</b><span>${circuits.length?esc(circuits.join(', ')):'None within 250 m'}</span></div></div><label class="pin-comment-label">Comments<textarea class="pin-drop-comment" rows="3" placeholder="Add notes for this pin...">${esc(comments)}</textarea></label><div class="popup-actions"><a class="popup-btn" target="_blank" rel="noopener" href="${maps}">Open Google Maps</a><button type="button" class="popup-btn" data-pin-drop-action="proximity" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropAction&&window.fmPinDropAction('proximity',${latS},${lonS},'${idS}');return false;">Proximity 350m</button><button type="button" class="popup-btn primary" data-pin-drop-action="save" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropSaveFromPopup&&window.fmPinDropSaveFromPopup(${latS},${lonS},'${idS}');return false;">${actionSave}</button><button type="button" class="popup-btn danger" data-pin-drop-action="${removeAction}" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropAction&&window.fmPinDropAction('${removeAction}',${latS},${lonS},'${idS}');return false;">${removeLabel}</button></div><small>Saved pins keep comments, nearest circuits within 250 m, current date/time, GPS location and Google Maps link on this phone.</small></div>`;
  };
  const oldBind=ME.bindPinDropPopupActions;
  ME.bindPinDropPopupActions=function(){
    if(this._pinDropPopupActionsBoundV105)return;
    this._pinDropPopupActionsBoundV105=true;
    const handler=(e)=>{
      const btn=e.target?.closest?.('[data-pin-drop-action]');
      if(!btn)return;
      try{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();}catch(_e){}
      const action=String(btn.dataset.pinDropAction||'').trim();
      const lat=Number(btn.dataset.lat), lon=Number(btn.dataset.lon);
      const id=String(btn.dataset.pinId||'');
      if(!action)return;
      if(action==='save')return this.handlePinDropSaveFromPopup(lat,lon,id);
      return this.handlePinDropAction(action,lat,lon,id);
    };
    document.addEventListener('click',handler,true);
    document.addEventListener('touchend',handler,true);
    document.addEventListener('pointerup',handler,true);
    try{oldBind&&oldBind.call(this);}catch(e){}
  };
  const oldDrop=ME.dropHoldPin;
  ME.dropHoldPin=function(ll,opts={}){
    try{this.closeToolsSafe?.();}catch(e){}
    const res=oldDrop?oldDrop.call(this,ll,opts):null;
    setTimeout(()=>{try{this.pinDropMarker?.openPopup?.();this.refitOpenPopup?.();}catch(e){try{this.openPinDropPopup(ll,{saved:false});}catch(_){}}},260);
    return res;
  };
  ME.removeTemporaryPinDrop=function(){return this.removeCurrentPinDrop(true);};
  try{window.fmPinDropAction=(action,lat,lon,id)=>ME.handlePinDropAction(action,lat,lon,id);window.fmPinDropSaveFromPopup=(lat,lon,id)=>ME.handlePinDropSaveFromPopup(lat,lon,id);}catch(e){}
})();

/* myMap v3.1.107: polished pin drop popup + app-icon marker */
(function(){
  if(!window.MapEngine||!window.L)return;
  const ME=window.MapEngine;
  const esc=function(v){try{return (window.UI&&UI.esc)?UI.esc(v):String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};
  const q=function(v){return String(v??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");};
  const icon={
    pin:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>',
    cal:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>',
    net:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 8.5l3 7M16 8.5l-3 7M8 7h8"/></svg>',
    ext:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4L10 14"/><path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    target:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.7 2.7M16.3 16.3L19 19M19 5l-2.7 2.7M7.7 16.3L5 19"/></svg>',
    save:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>',
    trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>'
  };
  ME.makePinDropIcon=function(saved=false){
    return L.divIcon({
      className:`pin-drop-leaflet-icon ${saved?'saved-pin-icon':'temp-pin-icon'}`,
      html:`<div class="pin-drop-marker ${saved?'saved':'temp'}" aria-hidden="true"><span></span></div>`,
      iconSize:[42,54], iconAnchor:[21,52], popupAnchor:[0,-48]
    });
  };
  ME.pinDropPopupHtml=function(ll,opts={}){
    const lat=Number(ll?.lat), lon=Number(ll?.lng??ll?.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return '<div class="asset-popup pin-drop-popup"><div class="pin-drop-title-row"><h3>Pin drop</h3></div><p>Invalid pin location.</p></div>';
    const saved=!!opts.saved;
    const id=String(opts.id||opts.record?.id||'');
    const comments=String(opts.comments??opts.record?.comments??'');
    const maps=this.googleMapsUrlFor(lat,lon);
    let circuits=[];
    try{circuits=opts.record?.nearestCircuits250m||this.nearestCircuitsNear(lat,lon,250).slice(0,8);}catch(e){circuits=[];}
    const title=saved?'Saved pin drop':'New pin drop';
    const meta=saved&&opts.record?.localDateTime?opts.record.localDateTime:new Date().toLocaleString();
    const actionSave=saved?'Update saved pin':'Save pin';
    const removeLabel=saved?'Delete saved pin':'Remove pin';
    const removeAction=saved?'deleteSaved':'remove';
    const latS=String(lat), lonS=String(lon), idS=q(id);
    const circuitText=circuits.length?esc(circuits.join(', ')):'None within 250 m';
    return `<div class="asset-popup pin-drop-popup" data-pin-popup="1"><div class="pin-drop-title-row"><h3>${title}</h3></div><div class="pin-detail-list"><div class="pin-detail-row"><span class="pin-detail-ico">${icon.pin}</span><div><b>Pin GPS</b><span>${lat.toFixed(6)}, ${lon.toFixed(6)}</span></div></div><div class="pin-detail-row"><span class="pin-detail-ico">${icon.cal}</span><div><b>Date / time</b><span>${esc(meta)}</span></div></div><div class="pin-detail-row"><span class="pin-detail-ico">${icon.net}</span><div><b>Nearest circuits</b><span>${circuitText}</span></div></div></div><div class="pin-separator"></div><label class="pin-comment-label">Comments<textarea class="pin-drop-comment" rows="3" placeholder="Add notes for this pin...">${esc(comments)}</textarea></label><div class="popup-actions"><a class="popup-btn" target="_blank" rel="noopener" href="${maps}">${icon.ext}<span>Open Google Maps</span></a><button type="button" class="popup-btn" data-pin-drop-action="proximity" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropAction&&window.fmPinDropAction('proximity',${latS},${lonS},'${idS}');return false;">${icon.target}<span>Proximity 350m</span></button><button type="button" class="popup-btn primary" data-pin-drop-action="save" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropSaveFromPopup&&window.fmPinDropSaveFromPopup(${latS},${lonS},'${idS}');return false;">${icon.save}<span>${actionSave}</span></button><button type="button" class="popup-btn danger" data-pin-drop-action="${removeAction}" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropAction&&window.fmPinDropAction('${removeAction}',${latS},${lonS},'${idS}');return false;">${icon.trash}<span>${removeLabel}</span></button></div><div class="pin-helper-note"><span class="pin-helper-ico">i</span><small>Saved pins keep comments, nearest circuits within 250 m, current date/time, GPS location and Google Maps link on this phone.</small></div></div>`;
  };
})();


/* myMap v3.1.108: pin popup sizing/interaction stability */
(function(){
  if(!window.MapEngine)return;
  const ME=window.MapEngine;
  const oldPopupOptions=ME.popupOptions;
  ME.popupOptions=function(){
    const o=oldPopupOptions?oldPopupOptions.call(this):{};
    return Object.assign({},o,{maxWidth:286,minWidth:240,autoPan:true,keepInView:true,autoPanPaddingTopLeft:[18,92],autoPanPaddingBottomRight:[18,64]});
  };
  const oldOpen=ME.openPinDropPopup;
  ME.openPinDropPopup=function(ll,opts={}){
    let r;
    try{r=oldOpen?oldOpen.call(this,ll,opts):undefined;}catch(e){r=undefined;}
    setTimeout(()=>{try{this.refitOpenPopup?.();}catch(_e){}},80);
    return r;
  };
})();

/* myMap v3.1.117: public-secure pole "0" labels no longer collapse map pole indicators; order-based 20 markers restored. */

/* myMap v3.1.117: BSN/public-secure spur markers - show sequence indicators on every branch/grid when pole numbers are hidden as 0. */
(function(){
  const ME=window.MapEngine, SE=window.SearchEngine;
  if(!ME||!SE)return;
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
  const distKm=(a,b)=>{const la=n(a?.lat),lo=n(a?.lon),lb=n(b?.lat),lob=n(b?.lon); if(la===null||lo===null||lb===null||lob===null)return Infinity; const dy=(la-lb)*111; const dx=(lo-lob)*111*Math.cos(((la+lb)/2)*Math.PI/180); return Math.sqrt(dx*dx+dy*dy);};
  const oldStructureLabel=ME.structureLabelForDot;
  const oldStructureNumber=ME.structureNumberForDot;
  ME.sampleCircuitDots=function(list=[],every=20){
    if(!Array.isArray(list)||list.length<=30)return list||[];
    const groups=new Map();
    for(const a of list){const k=this.lineKeyForAsset?.(a)||'line'; if(!groups.has(k))groups.set(k,[]); groups.get(k).push(a);}
    const out=[]; const seen=new Set();
    const clone=(a,label)=>label?Object.assign({},a,{_sampleMarkerNum:String(label)}):a;
    const ident=a=>this.mapDotIdentity?.(a)||`${a?.lat},${a?.lon}`;
    const add=(a,label='')=>{if(!a)return false; const k=ident(a); if(seen.has(k))return false; seen.add(k); out.push(clone(a,label)); return true;};
    const actualPolePart=a=>{try{const refs=SE.lineRefsForAsset?.(a,true)||[]; return SE.poleIdParts?.(refs[0]?.pole||a?.poleNumber||a?.label||a?.structure||'');}catch(e){return null;}};
    const labelFor=a=>{try{return oldStructureLabel?.call(this,a)||'';}catch(e){return '';}};
    const numFor=a=>{try{return oldStructureNumber?.call(this,a);}catch(e){return NaN;}};
    const rawOrder=a=>{
      const raw=a?.raw||{}; const vals=[a?.rawStructure,a?.structureId,raw.structure_id,raw.STRUCTURE_ID,raw.structureId,a?.id,a?.assetId,a?.globalId];
      for(const v of vals){const m=String(v||'').match(/(?:^|\b)T?0*(\d{1,8})(?:\b|$)/i); if(m){const x=Number(m[1]); if(Number.isFinite(x))return x;}}
      const lat=n(a?.lat),lon=n(a?.lon); return lat!==null&&lon!==null?((lat+90)*100000+(lon+180)):Infinity;
    };
    const greedyChains=arr=>{
      const unused=arr.slice(); const chains=[];
      while(unused.length){
        let cur=unused.shift(); const chain=[cur];
        while(unused.length){
          let bi=-1,bd=Infinity;
          for(let i=0;i<unused.length;i++){const d=distKm(cur,unused[i]); if(d<bd){bd=d;bi=i;}}
          if(bi<0||bd>4.2)break;
          cur=unused.splice(bi,1)[0]; chain.push(cur);
          if(chain.length>900)break;
        }
        chains.push(chain);
      }
      return chains.sort((a,b)=>b.length-a.length);
    };
    for(const group of groups.values()){
      let arr=group.slice().sort((a,b)=>(SE.sortByStructure?.(a,b)||rawOrder(a)-rawOrder(b)));
      const unique=[]; const uSeen=new Set();
      for(const a of arr){const k=ident(a); if(uSeen.has(k))continue; uSeen.add(k); unique.push(a);} arr=unique;
      const total=arr.length; if(!total)continue;
      const realParts=arr.map(actualPolePart).filter(p=>p&&Number(p.num)>0);
      const hasRealNumbering=realParts.length>=Math.min(5,Math.ceil(total*0.1));
      if(hasRealNumbering){
        add(arr[0],labelFor(arr[0]));
        for(let i=1;i<total-1;i++){const a=arr[i]; if(a?.kind==='substation'||a?.kind==='depot'){add(a);continue;} const num=numFor(a); if(Number.isFinite(num)&&num>0&&every>0&&num%every===0)add(a,labelFor(a)||String(num));}
        if(total>1)add(arr[total-1],labelFor(arr[total-1]));
        continue;
      }
      // Redacted/public-secure line: all labels are 0. Use position/sequence labels so every spur/leg gets indicators.
      const interval=Math.max(10,Number(every)||20);
      const chains=greedyChains(arr).slice(0,10);
      for(const chain of chains){
        if(!chain.length)continue;
        const cTotal=chain.length;
        add(chain[0],String(Math.max(1,arr.indexOf(chain[0])+1)));
        for(let i=interval-1;i<cTotal-1;i+=interval)add(chain[i],String(Math.max(1,arr.indexOf(chain[i])+1)));
        if(cTotal>1)add(chain[cTotal-1],String(Math.max(1,arr.indexOf(chain[cTotal-1])+1)));
      }
      // Grid safety: one labelled dot per approx 2 km cell, so short spur legs do not vanish between sequence samples.
      const tileSeen=new Set();
      for(const a of out){const lat=n(a?.lat),lon=n(a?.lon); if(lat!==null&&lon!==null)tileSeen.add(`${Math.round(lat/0.020)}|${Math.round(lon/0.020)}`);}
      let gridAdded=0, maxGrid=Math.max(50,Math.min(180,Math.ceil(total/18)));
      for(let i=0;i<total&&gridAdded<maxGrid;i+=Math.max(2,Math.floor(interval/3))){
        const a=arr[i]; const lat=n(a?.lat),lon=n(a?.lon); if(lat===null||lon===null)continue;
        const tile=`${Math.round(lat/0.020)}|${Math.round(lon/0.020)}`;
        if(tileSeen.has(tile))continue;
        if(add(a,String(i+1))){tileSeen.add(tile); gridAdded++;}
      }
    }
    return out;
  };
})();

/* myMap v3.1.118: shared-structure dots + close-zoom pole indicators restored. */
(function(){
  const ME=window.MapEngine, SE=window.SearchEngine;
  if(!ME||!SE)return;
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
  const compact=v=>SE.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');
  const currentKeys=function(){
    const raw=[];
    if(this.currentCircuit)raw.push(this.currentCircuit);
    if(Array.isArray(this.currentCircuits))raw.push(...this.currentCircuits);
    const keys=[];
    for(const v of raw){const f=SE.formatCircuitName?.(v)||v; const k=compact(f); if(k&&!keys.includes(k))keys.push(k);}
    return keys;
  };
  ME.selectedRefForMapDot=function(a){
    const refs=SE.lineRefsForAsset?.(a,true)||[];
    if(!refs.length)return null;
    const keys=currentKeys.call(this);
    if(keys.length){
      const hit=refs.find(r=>keys.includes(compact(SE.formatCircuitName?.(r.line)||r.line)));
      if(hit)return hit;
    }
    return refs[0];
  };
  ME.lineKeyForAsset=function(a){
    try{const ref=this.selectedRefForMapDot?.(a)||{}; return compact(ref.line||a?.line||'')||String(a?.line||'').toUpperCase();}
    catch(e){return String(a?.line||'').toUpperCase();}
  };
  ME.structureLabelForDot=function(a){
    try{
      const ref=this.selectedRefForMapDot?.(a)||{};
      const pole=String(ref.pole||a?.poleNumber||a?.structureNumber||a?.nameplate||a?.label||'').trim();
      const parts=SE.poleIdParts?.(pole);
      if(parts){
        if(Number(parts.num)===0){
          const raw=String(parts.raw||pole||'').toUpperCase();
          if(/G/.test(raw))return raw.startsWith('G')?'G0000':'0000G';
          return '';
        }
        return parts.norm||String(parts.num);
      }
      const m=pole.match(/(G0{3,6}|0{3,6}G|\d{1,6}[A-Z]{0,3}(?:\/[A-Z0-9]{1,8})?)\s*$/i)||pole.match(/(G0{3,6}|0{3,6}G|\d{1,6}[A-Z]{0,3}(?:\/[A-Z0-9]{1,8})?)/i);
      if(!m)return '';
      const raw=String(m[1]).toUpperCase();
      if(/^G0+$/.test(raw))return 'G0000';
      if(/^0+G$/.test(raw))return '0000G';
      const label=raw.replace(/^0+(?=\d)/,'');
      return /^0+$/.test(label)?'':label;
    }catch(e){return '';}
  };
  ME.structureNumberForDot=function(a){
    try{
      const ref=this.selectedRefForMapDot?.(a)||{};
      const pole=ref.pole||a?.poleNumber||a?.structureNumber||a?.nameplate||a?.label||'';
      const p=SE.poleIdParts?.(pole);
      if(p&&Number.isFinite(Number(p.num)))return Number(p.num)>0?Number(p.num):NaN;
      const m=String(pole||'').match(/(\d{1,6})/); const num=m?Number(m[1]):NaN;
      return Number.isFinite(num)&&num>0?num:NaN;
    }catch(e){return NaN;}
  };
  ME.mapDotIdentity=function(a){
    try{
      const ref=this.selectedRefForMapDot?.(a)||{};
      const line=compact(ref.line||a?.line||'');
      const pole=String(ref.pole||a?.poleNumber||'').trim();
      const parts=SE.poleIdParts?.(pole);
      const stripped=SE.stripZeros?.(pole)||'';
      const raw=a?.raw||{};
      const sid=String(a?.rawStructure||raw.structure_id||raw.STRUCTURE_ID||a?.structureId||a?.id||'').trim();
      const lat=n(a?.lat), lon=n(a?.lon);
      const zeroPole=!!parts&&Number(parts.num)===0&&!parts.isBranch;
      // Shared structures need line+pole identity for the selected circuit, but public-secure 0000/G0000
      // records must keep their structure/GPS identity so separate terminal/shared points do not collapse.
      if(line&&pole&&!zeroPole&&stripped&&stripped!=='0')return `${line}|P${SE.poleKey?.(pole)||stripped}`;
      if(line&&sid)return `${line}|SID${compact(sid)}|${lat!==null?lat.toFixed(7):''}|${lon!==null?lon.toFixed(7):''}`;
      if(line&&lat!==null&&lon!==null)return `${line}|GPS${lat.toFixed(7)},${lon.toFixed(7)}`;
    }catch(e){}
    return String(a?.id||a?.label||a?.gisLabel||`${a?.lat||''},${a?.lon||''}`);
  };
  ME.circuitDotModeForZoom=function(){
    const z=Number(this.map?.getZoom?.()||0);
    // Only reduce dots when genuinely zoomed out. At local patrol/search zooms, show the actual dots.
    return z && z<12 ? 'sample20' : 'full';
  };
  const oldFiltered=ME.filteredAssetsForZoom;
  ME.filteredAssetsForZoom=function(list=[],label=''){
    if(!this.isCircuitLabel?.(label)){this.circuitDensityMode='';return list||[];}
    this.lastFullCircuitAssets=(list||[]).slice();
    this.lastFullCircuitLabel=label;
    const mode=this.circuitDotModeForZoom();
    this.circuitDensityMode=mode;
    if(mode==='sample20')return this.sampleCircuitDots(list,20);
    // Full close-zoom mode: keep every dot, but tag every 20th structure so pole indicators remain visible.
    const groups=new Map();
    for(const a of list||[]){const k=this.lineKeyForAsset?.(a)||'line'; if(!groups.has(k))groups.set(k,[]); groups.get(k).push(a);}
    const labelSet=new Set();
    for(const group of groups.values()){
      let arr=group.slice().sort((a,b)=>(SE.sortByStructure?.(a,b)||0));
      const unique=[]; const seen=new Set();
      for(const a of arr){const id=this.mapDotIdentity?.(a)||`${a?.lat},${a?.lon}`; if(seen.has(id))continue; seen.add(id); unique.push(a);} arr=unique;
      if(!arr.length)continue;
      const nums=arr.map(a=>this.structureNumberForDot?.(a)).filter(x=>Number.isFinite(x)&&x>0);
      const hasReal=nums.length>=Math.min(5,Math.ceil(arr.length*0.08));
      const mark=a=>{const id=this.mapDotIdentity?.(a)||`${a?.lat},${a?.lon}`; if(id)labelSet.add(id);};
      mark(arr[0]);
      if(hasReal){
        for(const a of arr){const num=this.structureNumberForDot?.(a); if(Number.isFinite(num)&&num>0&&num%20===0)mark(a);}
      }else{
        for(let i=19;i<arr.length-1;i+=20)mark(arr[i]);
      }
      if(arr.length>1)mark(arr[arr.length-1]);
    }
    return (list||[]).map(a=>{
      const id=this.mapDotIdentity?.(a)||`${a?.lat},${a?.lon}`;
      if(!labelSet.has(id))return a;
      const lab=this.structureLabelForDot?.(a)||'';
      const fallback='';
      return Object.assign({},a,{_sampleMarkerNum:lab||fallback});
    });
  };
  const oldMarkerMode=ME.markerModeFor;
  ME.markerModeFor=function(label,list){
    const text=String(label||'');
    // DOM mode is needed for the numbered indicator bubbles. Keep it for normal-length circuits.
    if((/^circuit\s+/i.test(text)||/^multi-circuit$/i.test(text))&&Array.isArray(list)&&list.some(a=>a&&a._sampleMarkerNum)&&list.length<=1200)return 'dom-dot';
    return oldMarkerMode?oldMarkerMode.call(this,label,list):'dom-dot';
  };
})();


/* myMap v3.1.131: debounce Android long-press/contextmenu and multi-touch save events so one hold/save creates one pin only. */
(function(){
  const ME=window.MapEngine;
  if(!ME||ME._pinDropSingleGuardV131)return;
  ME._pinDropSingleGuardV131=true;
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const meters=(a,b)=>{
    const la=num(a?.lat), lo=num(a?.lng??a?.lon), lb=num(b?.lat), lob=num(b?.lng??b?.lon);
    if(la===null||lo===null||lb===null||lob===null)return Infinity;
    const dy=(la-lb)*111000;
    const dx=(lo-lob)*111000*Math.cos(((la+lb)/2)*Math.PI/180);
    return Math.sqrt(dx*dx+dy*dy);
  };
  const oldDrop=ME.dropHoldPin;
  ME.dropHoldPin=function(ll,opts={}){
    const now=Date.now();
    const next={lat:num(ll?.lat),lng:num(ll?.lng??ll?.lon)};
    if(next.lat===null||next.lng===null)return oldDrop?oldDrop.call(this,ll,opts):undefined;
    if(this._lastPinDropAt&&now-this._lastPinDropAt<1800&&meters(this._lastPinDropLL,next)<30){
      this._pinDropSuppressClickUntil=Date.now()+1200;
      return null;
    }
    this._lastPinDropAt=now;
    this._lastPinDropLL=next;
    this._pinDropSuppressClickUntil=Date.now()+1200;
    return oldDrop?oldDrop.call(this,ll,opts):undefined;
  };
  const oldSave=ME.savePinDrop;
  ME.savePinDrop=function(lat,lon,comments='',existingId=''){
    const now=Date.now();
    const la=num(lat), lo=num(lon);
    if(!existingId&&la!==null&&lo!==null){
      const key=la.toFixed(6)+','+lo.toFixed(6)+'|'+String(comments||'').slice(0,80);
      if(this._lastPinSaveKey===key&&now-(this._lastPinSaveAt||0)<2200)return null;
      this._lastPinSaveKey=key;
      this._lastPinSaveAt=now;
    }
    return oldSave?oldSave.call(this,lat,lon,comments,existingId):null;
  };
})();

/* myMap v3.1.140: compact pin drop popup, no visible GPS row, nearest address, Google Earth button. */
(function(){
  const ME=window.MapEngine;
  if(!ME||ME._pinPopupAddressEarthV139)return;
  ME._pinPopupAddressEarthV139=true;
  const esc=function(v){
    try{return (window.UI&&UI.esc)?UI.esc(v):String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
    catch(e){return String(v??'');}
  };
  const q=function(v){return String(v??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");};
  const num=function(v){const n=Number(v);return Number.isFinite(n)?n:null;};
  const addrKey=function(lat,lon){return 'myMapNearestStreetAddress:v144:'+Number(lat).toFixed(5)+','+Number(lon).toFixed(5);};
  const icon={
    addr:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M9 20v-6h6v6"/></svg>',
    cal:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>',
    net:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 8.5l3 7M16 8.5l-3 7M8 7h8"/></svg>',
    ext:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4L10 14"/><path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
    earth:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>',
    target:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.7 2.7M16.3 16.3L19 19M19 5l-2.7 2.7M7.7 16.3L5 19"/></svg>',
    save:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>',
    trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>'
  };
  ME.googleEarthUrlFor=function(lat,lon){return `https://earth.google.com/web/search/${encodeURIComponent(Number(lat).toFixed(6)+','+Number(lon).toFixed(6))}`;};
  ME.cachedNearestAddressForPin=function(lat,lon){
    try{const v=localStorage.getItem(addrKey(lat,lon));return v?String(v):'';}catch(e){return '';}
  };
  ME._pinAddressPick=function(a,keys){
    try{
      for(const k of keys){
        const v=a&&a[k];
        if(v!==undefined&&v!==null&&String(v).trim())return String(v).trim();
      }
    }catch(e){}
    return '';
  };
  ME._pinAddressUnique=function(parts){
    const out=[], seen=new Set();
    for(const raw of parts||[]){
      const v=String(raw||'').replace(/\s+/g,' ').trim();
      if(!v)continue;
      const key=v.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key); out.push(v);
    }
    return out;
  };
  ME.formatReverseGeocodeAddress=function(data){
    const a=data&&data.address?data.address:{};
    const pick=(...keys)=>this._pinAddressPick(a,keys);
    const display=String(data?.display_name||'').replace(/\s+/g,' ').trim();
    const name=String(data?.name||'').replace(/\s+/g,' ').trim();
    const lotFromDisplay=(display.match(/\bLot\s*[0-9A-Za-z/-]+\b/i)||[])[0]||'';
    const rawLot=pick('lot','lot_number','parcel','parcel_number','allotment','plot')||lotFromDisplay;
    const lot=rawLot?(/^lot\b/i.test(rawLot)?rawLot:`Lot ${rawLot}`):'';
    const unit=pick('unit','flat','apartment','suite');
    const unitText=unit?(/^unit\b/i.test(unit)?unit:`Unit ${unit}`):'';
    const house=pick('house_number','addr:housenumber');
    const road=pick('road','pedestrian','footway','cycleway','path','track','service','residential','unclassified','tertiary','secondary','primary','trunk','motorway')||((String(data?.class||'')==='highway'||String(data?.category||'')==='highway')?name:'');
    const site=pick('house_name','farm','isolated_dwelling','place','building','amenity','tourism','shop','office','industrial','man_made','substation')||((!road&&name)?name:'');
    const locality=pick('suburb','neighbourhood','quarter','hamlet','village','town','city','municipality','county','state_district');
    const state=pick('state');
    const postcode=pick('postcode');
    const lead=this._pinAddressUnique([unitText,lot,house]).join(' / ');
    let first='';
    if(lead&&road)first=`${lead} ${road}`;
    else if(lead)first=lead;
    else if(site&&road)first=`${site}, ${road}`;
    else if(road)first=road;
    else if(site)first=site;
    const parts=this._pinAddressUnique([first,locality,state,postcode]);
    const text=parts.join(', ').replace(/\s+/g,' ').trim();
    if(text)return text;
    return display?display.split(',').slice(0,5).map(v=>v.trim()).filter(Boolean).join(', '):'';
  };
  ME.reverseAddressQualityScore=function(data,text){
    const a=data&&data.address?data.address:{};
    const pick=(...keys)=>this._pinAddressPick(a,keys);
    let score=0;
    const display=String(data?.display_name||'');
    const hasLot=!!(pick('lot','lot_number','parcel','parcel_number','allotment','plot')||display.match(/\bLot\s*[0-9A-Za-z/-]+\b/i));
    const hasHouse=!!pick('house_number','addr:housenumber','unit','flat','apartment','suite');
    const hasRoad=!!(pick('road','pedestrian','footway','cycleway','path','track','service','residential','unclassified','tertiary','secondary','primary','trunk','motorway')||String(data?.class||'')==='highway');
    const hasSite=!!pick('house_name','farm','isolated_dwelling','place','building','amenity','tourism','shop','office','industrial','man_made','substation');
    const hasLocality=!!pick('suburb','neighbourhood','quarter','hamlet','village','town','city','municipality','county','state_district');
    if(hasLot)score+=45;
    if(hasHouse)score+=45;
    if(hasRoad)score+=35;
    if(hasSite)score+=20;
    if(hasLocality)score+=10;
    if(pick('postcode'))score+=5;
    if(text)score+=3;
    return score;
  };
  ME.pinFetchJsonWithTimeout=function(url,ms=4200,opts={}){
    return new Promise(resolve=>{
      let done=false;
      const finish=(v)=>{if(done)return;done=true;try{clearTimeout(timer);}catch(_e){}resolve(v||null);};
      const timer=setTimeout(()=>finish(null),Math.max(1200,Number(ms)||4200));
      try{
        fetch(url,Object.assign({cache:'no-store'},opts||{})).then(async res=>{
          if(!res||!res.ok)return null;
          try{return await res.json();}catch(_e){return null;}
        }).then(finish).catch(err=>{
          try{window.Diagnostics&&window.Diagnostics.log&&window.Diagnostics.log('Address lookup fetch failed',String(err&&err.message||err||''));}catch(_e){}
          finish(null);
        });
      }catch(err){
        try{window.Diagnostics&&window.Diagnostics.log&&window.Diagnostics.log('Address lookup fetch blocked',String(err&&err.message||err||''));}catch(_e){}
        finish(null);
      }
    });
  };
  ME.localityTextFromReverse=function(data){
    const a=data&&data.address?data.address:{};
    const pick=(...keys)=>this._pinAddressPick(a,keys);
    const locality=pick('suburb','neighbourhood','quarter','hamlet','village','town','city','municipality','county','state_district');
    const state=pick('state');
    const postcode=pick('postcode');
    return this._pinAddressUnique([locality,state,postcode]).join(', ');
  };
  ME.formatPhotonAddress=function(data){
    try{
      const feats=Array.isArray(data?.features)?data.features:[];
      let best='', bestScore=-1;
      for(const f of feats){
        const p=f?.properties||{};
        const house=String(p.housenumber||p.house_number||'').trim();
        const road=String(p.street||p.road||((p.osm_key==='highway'||p.osm_value==='residential')?p.name:'')||'').trim();
        const name=String(p.name||'').trim();
        const locality=String(p.city||p.town||p.village||p.locality||p.district||p.county||'').trim();
        const state=String(p.state||'').trim();
        const postcode=String(p.postcode||'').trim();
        let first='';
        if(house&&road)first=`${house} ${road}`;
        else if(road)first=road;
        else if(name&&/road|street|track|drive|lane|avenue|way|highway|terrace|parade|place|court|close|crescent|loop/i.test(name))first=name;
        if(!first)continue;
        const text=this._pinAddressUnique([first,locality,state,postcode]).join(', ');
        const score=(house?90:55)+(road?25:0)+(locality?8:0)+(postcode?4:0);
        if(text&&score>bestScore){best=text;bestScore=score;}
      }
      return best;
    }catch(e){return '';}
  };
  ME.formatBigDataCloudLocality=function(data){
    try{
      let admin='';
      const arr=Array.isArray(data?.localityInfo?.administrative)?data.localityInfo.administrative:[];
      for(const x of arr){if(x&&Number(x.adminLevel)>=8&&x.name){admin=String(x.name).trim();break;}}
      const loc=String(data?.locality||data?.city||admin||'').trim();
      const state=String(data?.principalSubdivisionCode||data?.principalSubdivision||'').trim();
      const postcode=String(data?.postcode||data?.postalCode||'').trim();
      return this._pinAddressUnique([loc,state,postcode]).join(', ');
    }catch(e){return '';}
  };
  ME.formatOverpassStreetAddress=function(el,origin,localityHint=''){
    try{
      const tags=el?.tags||{};
      const lat0=Number(el?.lat ?? el?.center?.lat), lon0=Number(el?.lon ?? el?.center?.lon);
      const m=this.distanceM?this.distanceM(origin,{lat:lat0,lon:lon0}):Infinity;
      const full=String(tags['addr:full']||'').replace(/\s+/g,' ').trim();
      const unit=String(tags['addr:unit']||tags['addr:flats']||'').trim();
      const house=String(tags['addr:housenumber']||'').trim();
      const street=String(tags['addr:street']||tags['addr:road']||'').trim();
      const suburb=String(tags['addr:suburb']||tags['addr:city']||tags['addr:town']||tags['addr:locality']||'').trim();
      const state=String(tags['addr:state']||'').trim();
      const postcode=String(tags['addr:postcode']||'').trim();
      const roadName=String(tags.name||'').replace(/\s+/g,' ').trim();
      const isAddress=!!(full||(house&&street));
      let text='';
      if(full)text=full;
      else if(house&&street)text=this._pinAddressUnique([unit?`Unit ${unit}`:'',`${house} ${street}`,suburb||localityHint,state,postcode]).join(', ');
      else if(street)text=this._pinAddressUnique([street,suburb||localityHint,state,postcode]).join(', ');
      else if(roadName&&tags.highway)text=this._pinAddressUnique([roadName,localityHint]).join(', ');
      if(!text)return null;
      return {text,m:Number.isFinite(m)?m:999999,isAddress,isRoad:!!(roadName&&tags.highway),score:(isAddress?100000:50000)-(Number.isFinite(m)?m:999999)};
    }catch(e){return null;}
  };
  ME.lookupOverpassClosestStreetAddress=async function(lat,lon,localityHint=''){
    const origin={lat,lon};
    const radii=[150,350,750,1500,3000,6000];
    const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
    let bestRoad=null;
    for(const radius of radii){
      const query=`[out:json][timeout:7];(node(around:${radius},${lat},${lon})["addr:housenumber"];way(around:${radius},${lat},${lon})["addr:housenumber"];relation(around:${radius},${lat},${lon})["addr:housenumber"];node(around:${radius},${lat},${lon})["addr:street"];way(around:${radius},${lat},${lon})["addr:street"];node(around:${radius},${lat},${lon})["highway"]["name"];way(around:${radius},${lat},${lon})["highway"]["name"];);out center tags qt 90;`;
      for(const ep of endpoints){
        const data=await this.pinFetchJsonWithTimeout(`${ep}?data=${encodeURIComponent(query)}`,radius>1500?6500:5200);
        const els=Array.isArray(data?.elements)?data.elements:[];
        if(!els.length)continue;
        const cands=els.map(e=>this.formatOverpassStreetAddress(e,origin,localityHint)).filter(Boolean).sort((a,b)=>b.score-a.score);
        const address=cands.find(c=>c.isAddress);
        if(address&&address.text)return address.text;
        const road=cands.find(c=>c.isRoad||c.text);
        if(road&&road.text&&(!bestRoad||road.m<bestRoad.m))bestRoad=road;
      }
    }
    return bestRoad&&bestRoad.text?bestRoad.text:'';
  };
  ME.lookupNearestAddressForPin=async function(lat,lon){
    lat=num(lat); lon=num(lon);
    if(lat===null||lon===null)return '';
    const cached=this.cachedNearestAddressForPin(lat,lon);
    if(cached)return cached;
    let bestText='', bestScore=-1, localityHint='';
    const zooms=[18,17,16,15,14,13];
    try{
      for(const zoom of zooms){
        const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat.toFixed(6))}&lon=${encodeURIComponent(lon.toFixed(6))}&zoom=${zoom}&addressdetails=1&namedetails=1`;
        const data=await this.pinFetchJsonWithTimeout(url,zoom>=17?3800:3200);
        if(!data)continue;
        const loc=this.localityTextFromReverse(data);
        if(loc&&!localityHint)localityHint=loc;
        const text=this.formatReverseGeocodeAddress(data);
        const score=this.reverseAddressQualityScore(data,text);
        if(text&&score>bestScore){bestText=text;bestScore=score;}
        if(score>=83)break;
      }
    }catch(e){}
    if(bestText&&bestScore>=83){try{localStorage.setItem(addrKey(lat,lon),bestText);}catch(e){} return bestText;}
    try{
      const ph=await this.pinFetchJsonWithTimeout(`https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat.toFixed(6))}&lon=${encodeURIComponent(lon.toFixed(6))}&limit=6`,4200);
      const text=this.formatPhotonAddress(ph);
      if(text&&(/\d/.test(text)||!bestText)){try{localStorage.setItem(addrKey(lat,lon),text);}catch(e){} return text;}
      if(text&&!bestText)bestText=text;
    }catch(e){}
    try{
      const bdc=await this.pinFetchJsonWithTimeout(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat.toFixed(6))}&longitude=${encodeURIComponent(lon.toFixed(6))}&localityLanguage=en`,3500);
      const loc=this.formatBigDataCloudLocality(bdc);
      if(loc&&!localityHint)localityHint=loc;
    }catch(e){}
    try{
      const text=await this.lookupOverpassClosestStreetAddress(lat,lon,localityHint);
      if(text){try{localStorage.setItem(addrKey(lat,lon),text);}catch(e){} return text;}
    }catch(e){}
    if(bestText){try{localStorage.setItem(addrKey(lat,lon),bestText);}catch(e){} return bestText;}
    return '';
  };
  ME.updatePinAddressInPopup=function(lat,lon,id){
    lat=num(lat); lon=num(lon);
    if(lat===null||lon===null)return;
    const selector=`.pin-drop-address[data-pin-lat="${lat.toFixed(6)}"][data-pin-lon="${lon.toFixed(6)}"]`;
    const apply=function(text){
      try{document.querySelectorAll(selector).forEach(el=>{el.textContent=text||'No street address found — use Maps/Earth';el.classList.toggle('resolved',!!text);});}catch(e){}
    };
    const cached=this.cachedNearestAddressForPin(lat,lon);
    if(cached){apply(cached);return;}
    apply('Finding closest street address…');
    this.lookupNearestAddressForPin(lat,lon).then(text=>{
      apply(text);
      if(text&&id){
        try{
          const arr=this.readSavedPinDrops();
          const idx=arr.findIndex(p=>String(p.id)===String(id));
          if(idx>=0){arr[idx].nearestAddress=text;arr[idx].googleEarthLocation=this.googleEarthUrlFor(lat,lon);delete arr[idx].gpsLocation;this.writeSavedPinDrops(arr);}
        }catch(e){}
      }
    }).catch(err=>{
      try{
        const msg=String(err&&err.message||err||'');
        const name=String(err&&err.name||'');
        if(!(name==='AbortError'||/Failed to fetch/i.test(msg)||/aborted/i.test(msg))){window.Diagnostics&&window.Diagnostics.log&&window.Diagnostics.log('Nearest address apply failure',msg);}
      }catch(_e){}
      apply('');
    });
  };
  const oldRead=ME.readSavedPinDrops;
  ME.readSavedPinDrops=function(){
    const arr=oldRead?oldRead.call(this):[];
    return (Array.isArray(arr)?arr:[]).map(p=>{
      if(!p||typeof p!=='object')return p;
      if(p.gpsLocation||!p.googleEarthLocation){
        const c=Object.assign({},p);
        delete c.gpsLocation;
        const lat=num(c?.pin?.lat), lon=num(c?.pin?.lon);
        if(lat!==null&&lon!==null&&!c.googleEarthLocation)c.googleEarthLocation=this.googleEarthUrlFor(lat,lon);
        return c;
      }
      return p;
    });
  };
  const oldSave=ME.savePinDrop;
  ME.savePinDrop=function(lat,lon,comments='',existingId=''){
    const rec=oldSave?oldSave.call(this,lat,lon,comments,existingId):null;
    const la=num(lat), lo=num(lon);
    if(rec&&la!==null&&lo!==null){
      try{
        const arr=this.readSavedPinDrops();
        const idx=arr.findIndex(p=>String(p.id)===String(rec.id));
        if(idx>=0){
          delete arr[idx].gpsLocation;
          arr[idx].googleEarthLocation=this.googleEarthUrlFor(la,lo);
          const cached=this.cachedNearestAddressForPin(la,lo);
          if(cached)arr[idx].nearestAddress=cached;
          this.writeSavedPinDrops(arr);
        }
      }catch(e){}
      try{setTimeout(()=>this.updatePinAddressInPopup(la,lo,rec.id),120);}catch(e){}
    }
    return rec;
  };
  ME.pinDropPopupHtml=function(ll,opts={}){
    const lat=num(ll?.lat), lon=num(ll?.lng??ll?.lon);
    if(lat===null||lon===null)return '<div class="asset-popup pin-drop-popup"><div class="pin-drop-title-row"><h3>Pin drop</h3></div><p>Invalid pin location.</p></div>';
    const saved=!!opts.saved;
    const id=String(opts.id||opts.record?.id||'');
    const comments=String(opts.comments??opts.record?.comments??'');
    const maps=this.googleMapsUrlFor(lat,lon);
    const earth=this.googleEarthUrlFor(lat,lon);
    let circuits=[];
    try{circuits=opts.record?.nearestCircuits250m||this.nearestCircuitsNear(lat,lon,250).slice(0,8);}catch(e){circuits=[];}
    const title=saved?'Saved pin':'New pin';
    const meta=saved&&opts.record?.localDateTime?opts.record.localDateTime:new Date().toLocaleString();
    const actionSave=saved?'Update pin':'Save pin';
    const removeLabel=saved?'Delete pin':'Remove pin';
    const removeAction=saved?'deleteSaved':'remove';
    const latS=String(lat), lonS=String(lon), idS=q(id);
    const address=opts.record?.nearestAddress||this.cachedNearestAddressForPin(lat,lon)||'Finding nearest address…';
    const circuitText=circuits.length?esc(circuits.join(', ')):'None within 250 m';
    try{setTimeout(()=>this.updatePinAddressInPopup(lat,lon,id),160);}catch(e){}
    return `<div class="asset-popup pin-drop-popup pin-drop-popup-v139" data-pin-popup="1"><div class="pin-drop-title-row"><h3>${title}</h3></div><div class="pin-detail-list"><div class="pin-detail-row"><span class="pin-detail-ico">${icon.addr}</span><div><b>Nearest address</b><span class="pin-drop-address" data-pin-lat="${lat.toFixed(6)}" data-pin-lon="${lon.toFixed(6)}">${esc(address)}</span></div></div><div class="pin-detail-row"><span class="pin-detail-ico">${icon.cal}</span><div><b>Date / time</b><span>${esc(meta)}</span></div></div><div class="pin-detail-row"><span class="pin-detail-ico">${icon.net}</span><div><b>Nearest circuits</b><span>${circuitText}</span></div></div></div><div class="pin-separator"></div><label class="pin-comment-label">Comments<textarea class="pin-drop-comment" rows="2" placeholder="Add notes for this pin...">${esc(comments)}</textarea></label><div class="popup-actions pin-drop-action-grid"><a class="popup-btn map-link" target="_blank" rel="noopener" href="${maps}">${icon.ext}<span>Google Maps</span></a><a class="popup-btn earth-link" target="_blank" rel="noopener" href="${earth}">${icon.earth}<span>Google Earth</span></a><button type="button" class="popup-btn proximity-link" data-pin-drop-action="proximity" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropAction&&window.fmPinDropAction('proximity',${latS},${lonS},'${idS}');return false;">${icon.target}<span>Proximity 350 m</span></button><button type="button" class="popup-btn primary" data-pin-drop-action="save" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropSaveFromPopup&&window.fmPinDropSaveFromPopup(${latS},${lonS},'${idS}');return false;">${icon.save}<span>${actionSave}</span></button><button type="button" class="popup-btn danger" data-pin-drop-action="${removeAction}" data-lat="${latS}" data-lon="${lonS}" data-pin-id="${esc(id)}" onclick="window.fmPinDropAction&&window.fmPinDropAction('${removeAction}',${latS},${lonS},'${idS}');return false;">${icon.trash}<span>${removeLabel}</span></button></div><div class="pin-helper-note"><span class="pin-helper-ico">i</span><small>Saved pins keep comments, nearest address, nearest circuits and map links on this phone.</small></div></div>`;
  };
})();


/* myMap v3.1.142: multi-point measuring overlay + smaller padded pin marker */
(function(){
  if(!window.MapEngine||!window.L)return;
  const ME=window.MapEngine;
  const esc=v=>{try{return (window.UI&&UI.esc)?UI.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(e){return String(v??'');}};
  const oldUiTarget=ME.isMapInteractionUiTarget;
  ME.isMapInteractionUiTarget=function(target){
    try{if(target&&target.closest&&target.closest('.measure-overlay'))return true;}catch(e){}
    return oldUiTarget?oldUiTarget.call(this,target):false;
  };
  ME.makePinDropIcon=function(saved=false){
    return L.divIcon({className:`pin-drop-leaflet-icon ${saved?'saved-pin-icon':'temp-pin-icon'}`,html:`<div class="pin-drop-marker ${saved?'saved':'temp'}" aria-hidden="true"><span></span></div>`,iconSize:[30,40],iconAnchor:[15,38],popupAnchor:[0,-36]});
  };
  ME.measureStatusLabel=function(){
    const pts=(this._measureRecords||[]).length;
    const total=this._measureTotalM||0;
    if(this.measureMode)return pts?`${pts} pts · ${this.formatMeasureDistance(total)}`:'tap map · snap on';
    return pts?`${pts} pts · ${this.formatMeasureDistance(total)}`:'off';
  };
  ME.showMeasureOverlay=function(){
    let el=document.getElementById('measureOverlay');
    if(!el){
      el=document.createElement('section');
      el.id='measureOverlay';
      el.className='measure-overlay hidden';
      el.setAttribute('aria-live','polite');
      document.body.appendChild(el);
      el.addEventListener('click',e=>{
        const b=e.target.closest?.('button[data-measure-action]');
        if(!b)return;
        try{e.preventDefault();e.stopPropagation();}catch(_e){}
        const a=String(b.dataset.measureAction||'');
        if(a==='snap'){this.measureSnapEnabled=!this.measureSnapEnabled;this.renderMeasureOverlay();UI?.toast?.(this.measureSnapEnabled?'Snap on.':'Snap off.');return;}
        if(a==='undo'){this.undoLastMeasurePoint();return;}
        if(a==='clear'){this.clearMeasure(true);return;}
        if(a==='done'){this.stopMeasureTool(true);this.hideMeasureOverlay(false);return;}
      },true);
    }
    el.classList.remove('hidden');
    this.renderMeasureOverlay();
  };
  ME.hideMeasureOverlay=function(force=true){
    const el=document.getElementById('measureOverlay');
    if(!el)return;
    if(force||!this.measureMode)el.classList.add('hidden');
  };
  ME.renderMeasureOverlay=function(){
    const el=document.getElementById('measureOverlay');
    if(!el)return;
    const pts=(this._measureRecords||[]).length;
    const total=this._measureTotalM||0;
    const last=this._measureLastSegmentM||0;
    const snapOn=!!this.measureSnapEnabled;
    el.innerHTML=`<div class="measure-head"><div><b>Measure</b><span>${this.measureMode?'Tap points on map':'Result shown'}</span></div><button type="button" data-measure-action="done">Done</button></div><div class="measure-total"><div><small>Total</small><strong>${esc(this.formatMeasureDistance(total))}</strong></div><div><small>Last leg</small><strong>${pts>1?esc(this.formatMeasureDistance(last)):'—'}</strong></div></div><div class="measure-actions"><button type="button" class="${snapOn?'active':''}" data-measure-action="snap">Snap ${snapOn?'ON':'OFF'}</button><button type="button" data-measure-action="undo" ${pts?'':'disabled'}>Undo</button><button type="button" class="danger" data-measure-action="clear">Clear</button></div><div class="measure-tip">${pts?`${pts} point${pts===1?'':'s'} set. Tap more points for multi-measure.`:'Tap the map to set the first point. Snap finds nearby visible asset dots.'}</div>`;
  };
  ME.startMeasureTool=function(){
    if(!this.map||!window.L){UI?.toast?.('Map not ready.');return;}
    try{this.map.closePopup?.();}catch(e){}
    this.clearMeasure(false);
    this.measureMode=true;
    this.measurePoints=[];
    this._measureRecords=[];
    this._measureTotalM=0;
    this._measureLastSegmentM=0;
    this._lastMeasureInput=null;
    this.ensureMeasureLayer();
    try{this.map.getContainer?.().classList.add('measure-mode');}catch(e){}
    this.showMeasureOverlay();
    UI?.toast?.('Measure on. Tap multiple points. Snap can be toggled.');
  };
  ME.stopMeasureTool=function(showToast=false){
    this.measureMode=false;
    try{this.map?.getContainer?.().classList.remove('measure-mode');}catch(e){}
    this.renderMeasureOverlay();
    if(showToast)UI?.toast?.('Measure done.');
  };
  ME.clearMeasure=function(showToast=true){
    this.measurePoints=[];
    this._measureRecords=[];
    this._measureTotalM=0;
    this._measureLastSegmentM=0;
    this.measureMode=false;
    this._lastMeasureInput=null;
    try{this.map?.getContainer?.().classList.remove('measure-mode');}catch(e){}
    try{this.measureLayer?.clearLayers?.();}catch(e){}
    this.measureLayer=null;
    this.hideMeasureOverlay(true);
    if(showToast)UI?.toast?.('Measure cleared.');
  };
  ME.rebuildMeasureLayer=function(){
    const records=(this._measureRecords||[]).slice();
    const layer=this.ensureMeasureLayer();
    if(!layer)return;
    try{layer.clearLayers();}catch(e){}
    this.measurePoints=records.map(r=>L.latLng(r.lat,r.lng));
    this._measureTotalM=0; this._measureLastSegmentM=0;
    for(let i=0;i<records.length;i++){
      const r=records[i]; const ll=L.latLng(r.lat,r.lng);
      try{
        const icon=L.divIcon({className:'measure-dot-icon',html:`<div class="measure-dot-label ${r.snapped?'snapped':''}">${i+1}</div>`,iconSize:[24,24],iconAnchor:[12,12]});
        L.marker(ll,{icon,interactive:false,zIndexOffset:5200}).addTo(layer);
      }catch(e){try{L.circleMarker(ll,{radius:8,color:'#2f5a31',weight:4,fillColor:'#fffaf0',fillOpacity:1,interactive:false}).addTo(layer);}catch(_){}}
      if(i>0){
        const p=records[i-1]; const a=L.latLng(p.lat,p.lng), b=ll;
        const m=this.distanceM({lat:a.lat,lon:a.lng},{lat:b.lat,lon:b.lng});
        if(Number.isFinite(m)){this._measureTotalM+=m; this._measureLastSegmentM=m;}
        try{
          L.polyline([a,b],{color:'#2f5a31',weight:5,opacity:.95,dashArray:'8 8',interactive:false}).addTo(layer);
          const mid=L.latLng((a.lat+b.lat)/2,(a.lng+b.lng)/2);
          L.tooltip({permanent:true,direction:'center',className:'measure-tooltip',interactive:false,offset:[0,0]}).setLatLng(mid).setContent(this.formatMeasureDistance(m)).addTo(layer);
        }catch(e){}
      }
    }
    if(records.length>1){
      const last=records[records.length-1];
      try{L.tooltip({permanent:true,direction:'top',className:'measure-tooltip measure-total-tooltip',interactive:false,offset:[0,-16]}).setLatLng([last.lat,last.lng]).setContent('Total '+this.formatMeasureDistance(this._measureTotalM)).addTo(layer);}catch(e){}
    }
    this.renderMeasureOverlay();
  };
  ME.undoLastMeasurePoint=function(){
    const arr=this._measureRecords||[];
    if(!arr.length){UI?.toast?.('No measure point to undo.');return;}
    arr.pop();
    this._measureRecords=arr;
    this.rebuildMeasureLayer();
    UI?.toast?.(arr.length?'Last measure point removed.':'Measure points cleared.');
  };
  ME.addMeasurePoint=function(rawLl,ev){
    if(!this.measureMode)return;
    const ll0=L.latLng(Number(rawLl.lat),Number(rawLl.lng??rawLl.lon));
    if(!Number.isFinite(ll0.lat)||!Number.isFinite(ll0.lng))return;
    const last=this._lastMeasureInput; const now=Date.now();
    if(last&&now-last.at<650&&this.distanceM({lat:last.lat,lon:last.lng},{lat:ll0.lat,lon:ll0.lng})<1.5)return;
    this._lastMeasureInput={at:now,lat:ll0.lat,lng:ll0.lng};
    const snap=this.measureSnapEnabled?this.snapLatLngToAsset(ll0):null;
    const ll=snap?.latlng||ll0;
    try{ev?.originalEvent?.preventDefault?.();ev?.originalEvent?.stopPropagation?.();ev?.preventDefault?.();ev?.stopPropagation?.();}catch(e){}
    if(!Array.isArray(this._measureRecords))this._measureRecords=[];
    this._measureRecords.push({lat:ll.lat,lng:ll.lng,snapped:!!snap,label:snap?.label||''});
    this.rebuildMeasureLayer();
    const count=this._measureRecords.length;
    if(count===1)UI?.toast?.(snap?`Point 1 snapped: ${snap.label}`:'Point 1 set. Tap next point.');
    else UI?.toast?.(`${snap?'Snapped · ':''}Total ${this.formatMeasureDistance(this._measureTotalM)}.`);
  };
  ME.handleMeasureMapClick=function(ev){
    if(!this.measureMode)return;
    const ll=ev?.latlng||this.latLngFromDomEvent(ev);
    if(!ll)return;
    this.addMeasurePoint(ll,ev);
  };
})();


/* myMap v3.1.155: small freeze reduction without changing UI behaviour */
(function(){
  const ME=window.MapEngine;
  if(!ME||ME.__smoothFreezePatch155)return;
  ME.__smoothFreezePatch155=true;

  const raf=(fn)=>{try{return (window.requestAnimationFrame||window.setTimeout)(fn,16);}catch(e){return setTimeout(fn,16);}};
  const now=()=>Date.now();
  const validLatLon=(a)=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon));
  const assetId=(a)=>String(a?.id||a?.assetId||a?.globalId||`${a?.lat},${a?.lon},${a?.label||a?.line||''}`);
  const escText=(v)=>String(v??'');

  ME._fastSetText=function(id,val){
    const el=document.getElementById(id);
    if(!el)return;
    const s=escText(val);
    if(el.textContent!==s)el.textContent=s;
  };

  const oldUpdateMapStatus=ME.updateGpsMapStatus;
  ME.updateGpsMapStatus=function(){
    const el=document.getElementById('gpsMapStatus');
    if(!el){try{return oldUpdateMapStatus?.call(this);}catch(e){return;}}
    const val=document.getElementById('gpsMapAccuracy');
    const g=this.gpsLast;
    const acc=Number(g?.accuracy);
    const cls=this.gpsError?'gps-none':this.gpsSignalClass(acc);
    const txt=(g&&!this.gpsError&&Number.isFinite(acc))?`${Math.round(acc)} m`:'—';
    const stamp=[cls,txt,this.gpsError?'1':'0'].join('|');
    if(this._gpsMapStatusStamp===stamp)return;
    this._gpsMapStatusStamp=stamp;
    el.classList.remove('gps-none','gps-strong','gps-good','gps-weak','gps-poor','active');
    el.classList.add(cls);
    if(g&&!this.gpsError)el.classList.add('active');
    if(val&&val.textContent!==txt)val.textContent=txt;
    el.title=(g&&!this.gpsError&&Number.isFinite(acc))?`GPS accuracy ${Math.round(acc)} m`:'GPS signal / accuracy';
  };

  ME._gpsActivePool=function(){
    const full=Array.isArray(this.lastFullCircuitAssets)?this.lastFullCircuitAssets:[];
    const drawn=Array.isArray(this.lastDrawnAssets)?this.lastDrawnAssets:[];
    if(full.length)return full;
    if(drawn.length)return drawn;
    return [];
  };

  ME._gpsPoolSig=function(pool){
    if(!Array.isArray(pool)||!pool.length)return 'empty';
    const first=pool[0]||{}, last=pool[pool.length-1]||{};
    return [pool.length,this.lastFullCircuitLabel||'',this.currentDisplay||'',assetId(first),assetId(last)].join('|');
  };

  ME._gpsBuildNearbyCache=function(pool){
    const size=0.012;
    const sig=this._gpsPoolSig(pool);
    const old=this._gpsNearbyCache;
    if(old&&old.sig===sig&&old.size===size)return old;
    const grid=new Map();
    for(const a of pool||[]){
      if(!validLatLon(a)||a.kind==='circuit')continue;
      try{if(window.UtilitiesEngine?.isUtility?.(a))continue;}catch(e){}
      const y=Math.floor(Number(a.lat)/size), x=Math.floor(Number(a.lon)/size);
      const k=y+'|'+x;
      let arr=grid.get(k);
      if(!arr){arr=[];grid.set(k,arr);}
      arr.push(a);
    }
    this._gpsNearbyCache={sig,size,grid,at:now()};
    return this._gpsNearbyCache;
  };

  ME._gpsNearbyFromPool=function(pool,lat,lon,limit=240){
    if(!Array.isArray(pool)||!pool.length)return [];
    if(pool.length<=1800)return pool;
    const cache=this._gpsBuildNearbyCache(pool);
    const size=cache.size;
    const cy=Math.floor(Number(lat)/size), cx=Math.floor(Number(lon)/size);
    const seen=new Set();
    const out=[];
    const rings=[0,1,2,4,8,16];
    for(const r of rings){
      for(let y=cy-r;y<=cy+r;y++){
        for(let x=cx-r;x<=cx+r;x++){
          if(r>0&&Math.abs(y-cy)<r&&Math.abs(x-cx)<r)continue;
          const cell=cache.grid.get(y+'|'+x);
          if(!cell)continue;
          for(const a of cell){
            const id=assetId(a);
            if(seen.has(id))continue;
            seen.add(id);
            out.push(a);
            if(out.length>=limit)return out;
          }
        }
      }
      if(out.length>=28)return out;
    }
    return out;
  };

  const oldNearby=ME.nearbyAssetsForGps;
  ME.nearbyAssetsForGps=function(lat,lon){
    const active=this._gpsActivePool?.()||[];
    if(active.length){
      const quick=this._gpsNearbyFromPool(active,lat,lon,260);
      if(quick.length)return quick;
      return active.length<=1800?active:[];
    }
    try{return oldNearby?oldNearby.call(this,lat,lon):[];}catch(e){return [];}
  };

  const oldMeasureCandidates=ME.measureSnapCandidates;
  ME.measureSnapCandidates=function(){
    const ll=this._lastMeasureInput;
    const active=this._gpsActivePool?.()||[];
    if(active.length&&ll&&Number.isFinite(Number(ll.lat))&&Number.isFinite(Number(ll.lng))){
      const quick=this._gpsNearbyFromPool(active,ll.lat,ll.lng,220);
      if(quick.length)return quick;
    }
    try{return oldMeasureCandidates?oldMeasureCandidates.call(this):[];}catch(e){return [];}
  };

  const oldGpsPanel=ME.updateGpsPanel;
  ME.updateGpsPanel=function(pos){
    const g=this.gpsLast;
    if(!g){
      try{this.updateGpsMapStatus();}catch(e){}
      return;
    }
    this._gpsPanelLatest=g;
    const stamp=[this.gpsProfile||'',this.gpsMode||'',this.gpsRotateHeading?'1':'0',this.breadcrumbEnabled?'1':'0',this.gpsPanelMinimized?'1':'0'].join('|');
    if(this._gpsProfileUiStamp!==stamp){
      this._gpsProfileUiStamp=stamp;
      try{this.updateGpsProfileButtons();}catch(e){}
    }
    if(!this._gpsPanelRaf){
      this._gpsPanelRaf=raf(()=>{
        this._gpsPanelRaf=0;
        const fix=this._gpsPanelLatest||this.gpsLast;
        if(!fix)return;
        const speedMps=Number(fix.speed);
        const kmh=Number.isFinite(speedMps)&&speedMps>=0?speedMps*3.6:NaN;
        const kt=Number.isFinite(speedMps)&&speedMps>=0?speedMps*1.943844:NaN;
        const speedText=Number.isFinite(kmh)?(this.gpsProfile==='helicopter'?`${Math.round(kmh)} km/h · ${Math.round(kt)} kt`:`${Math.round(kmh)} km/h`):'—';
        const altitude=Number(fix.altitude);
        const heading=Number(fix.heading);
        this._fastSetText('gpsSpeedValue',speedText);
        this._fastSetText('gpsAltitudeValue',Number.isFinite(altitude)?`${Math.round(altitude)} m · ${Math.round(altitude*3.28084)} ft`:'—');
        this._fastSetText('gpsHeadingValue',Number.isFinite(heading)?`${Math.round(heading)}° · ${this.gpsCardinal(heading)}`:'—');
        const status=document.getElementById('gpsStatus');
        const statusText=this.gpsMode==='track'?'Tracking':this.gpsModeLabel();
        if(status&&status.textContent!==statusText)status.textContent=statusText;
        try{this.updateGpsMapStatus();}catch(e){}
        let sum=null;
        try{sum=this.gpsNearestSummary();}catch(e){sum=null;}
        const pingBtn=document.getElementById('gpsNearestPingBtn');
        if(sum?.nearest){
          this._fastSetText('gpsNearestValue',`${this.titleForGpsAsset(sum.nearest)} · ${this.fmtGpsDistance(sum.nearestM)}`);
          this._fastSetText('gpsCircuitValue',sum.circuit||this.circuitForGpsAsset(sum.nearest)||'—');
          if(pingBtn&&pingBtn.disabled)pingBtn.disabled=false;
          if(pingBtn)pingBtn.title='Ping nearest asset on the map for 10 seconds';
        }else{
          this._fastSetText('gpsNearestValue','No mapped asset nearby');
          this._fastSetText('gpsCircuitValue',this.currentCircuit||'—');
          if(pingBtn&&!pingBtn.disabled)pingBtn.disabled=true;
          if(pingBtn)pingBtn.title='No nearest asset to ping';
        }
        if(sum?.next)this._fastSetText('gpsNextValue',`${this.titleForGpsAsset(sum.next)} · ${this.fmtGpsDistance(sum.nextM)}`);
        else this._fastSetText('gpsNextValue','—');
        try{this.updateGpsPanelMinimizedSummary(sum);}catch(e){}
      });
    }
  };

  const oldShowGps=ME.showGpsPanel;
  ME.showGpsPanel=function(){
    const panel=document.getElementById('gpsPatrolPanel');
    if(panel){
      this.gpsPanelHidden=false;
      panel.classList.remove('hidden');
      panel.classList.toggle('minimized',!!this.gpsPanelMinimized);
      try{this.updateGpsProfileButtons();}catch(e){}
      try{this.updateGpsPanel();}catch(e){}
      return;
    }
    try{return oldShowGps?oldShowGps.call(this):undefined;}catch(e){}
  };
})();
