/* Field MAP HV/TX crossing sidecar layer.
   Built on V3.1.57 baseline. Crossings never enter App.assets.
   V3.1.123: strict HV matching for simple circuits; prevents nearby dual/shared circuits being counted as HV. */
(function(){
  const KEY='FieldMAP.hvTxCrossings.sidecar.v1';
  const MAX_VIEW_DRAW=1200;
  const MAX_DYNAMIC_TX=0; // disabled: dynamic TX from shared/dual circuit geometry was creating false crossing counts.
  const MAX_TX_SEGMENT_KM=2.5; // direct TX crossing segments only; skips bad long jumps between unrelated structure legs.
  const MIN_CROSSING_ZOOM=7; // Selected-circuit HV/TX markers stay visible at wide patrol/preview zooms; counts stay available.
  const WA={minLat:-36.5,maxLat:-12.0,minLon:112.0,maxLon:130.5};
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
  function valid(lat,lon){lat=n(lat);lon=n(lon);return lat!==null&&lon!==null&&lat>=WA.minLat&&lat<=WA.maxLat&&lon>=WA.minLon&&lon<=WA.maxLon;}
  function currentZoom(){try{const z=MapEngine?.map?.getZoom?.();return Number.isFinite(Number(z))?Number(z):null;}catch(e){return null;}}
  function zoomOkForCrossings(){const z=currentZoom();return z===null||z>=MIN_CROSSING_ZOOM;}
  function compact(s){try{return SearchEngine?.compact?.(s)||String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}catch(e){return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}}
  function fmtLine(v){
    let s=String(v||'').trim().replace(/[–—]/g,'-').replace(/\s+/g,' ').toUpperCase();
    if(!s)return '';
    // Strip a structure/span suffix if a crossing title carries one.
    const m=s.match(/^([A-Z]{1,5}\s*-\s*[A-Z]{1,5}(?:\s*\/\s*[A-Z]{1,5})*\s+(?:71|72|81|82|91|92|X1|X2))\b/i);
    if(m)s=m[1];
    try{s=SearchEngine?.formatCircuitName?.(s)||s;}catch(e){}
    return s.replace(/\s+/g,' ').trim().toUpperCase();
  }
  function lineMatches(wanted, got){
    const a=fmtLine(wanted), b=fmtLine(got);
    if(!a||!b)return false;
    if(a===b)return true;
    const ca=compact(a), cb=compact(b);
    return !!(ca&&cb&&(ca===cb||cb.startsWith(ca)||ca.startsWith(cb)));
  }
  function rawOf(r){return r?.raw&&typeof r.raw==='object'?r.raw:r||{};}
  function looksCrossing(r){
    const raw=rawOf(r);
    const text=[r?.kind,r?.category,r?.label,r?.sourceFile,raw.asset_type,raw.asset_class,raw.category,raw.layer,raw.field_map_layer,raw.crossing_type,raw.source_layer,raw.render_hint,raw.transmission_line,raw.tx_line,raw.tx_line_1,raw.tx_line_2,raw.line_1,raw.line_2,raw.hv_network,raw.name,raw.title,raw.label]
      .map(x=>String(x||'')).join(' ').toUpperCase();
    return /DX\s*CROSSING|DX_CROSSINGS|TX[_\s-]*DX|HV\s*CROSSING|HV_CROSSINGS|CROSSING_POINTS|TRANSMISSION_X_(?:HV|HV_DISTRIBUTION|DISTRIBUTION|TRANSMISSION)|FIELD_MAP_(?:DX|HV|TX|TRANSMISSION)_CROSSINGS|TX\s*CROSSING|TRANSMISSION\s*CROSSING/.test(text);
  }
  function recType(raw){
    const t=[raw.crossing_type,raw.original_crossing_type,raw.crossing_kind,raw.crossing_group,raw.asset_type,raw.asset_class,raw.category,raw.field_map_layer,raw.layer,raw.source_layer,raw.name,raw.title,raw.label].map(v=>String(v||'')).join(' ').toUpperCase();
    if(/TRANSMISSION_X_TRANSMISSION|TRANSMISSION\s*[_X-]+\s*TRANSMISSION|TX[_\s-]*TX|TX\s*CROSSING|TRANSMISSION\s*CROSSING/.test(t))return 'TX';
    return 'HV'; // internal HV = HV distribution crossing, shown as HV in the UI.
  }
  function hvText(raw,r){
    raw=raw||{}; r=r||{};
    return [
      raw.hv_type,raw.HV_TYPE,raw.dx_type,raw.DX_TYPE,raw.type,raw.TYPE,raw.network_type,raw.NETWORK_TYPE,
      raw.asset_type,raw.category,raw.layer,raw.field_map_layer,raw.source_layer,raw.hv_network,raw.name,raw.title,raw.label,
      r.hvType,r.hv,r.type,r.title,r.label,r.sourceFile
    ].map(v=>String(v||'')).join(' ').toUpperCase();
  }
  function isUndergroundHV(raw,r){
    const txt=hvText(raw,r);
    // Only block true underground HV. Do not treat HVOH as UG just because it contains HV.
    return /\bHVUG\b|UNDER\s*GROUND|UNDERGROUND|UNDERGROUND\s*CABLE|\bUG\s*(?:1PH|3PH|CABLE|HV|DIST|DISTRIBUTION)?\b/.test(txt);
  }
  function isOverheadHV(raw,r){
    const txt=hvText(raw,r);
    return /\bHVOH\b|OVER\s*HEAD|OVERHEAD|\bOH\s*(?:1PH|3PH|HV|DIST|DISTRIBUTION)?\b/.test(txt);
  }
  function hvRecordIsOverhead(r){
    const raw=rawOf(r);
    if(isUndergroundHV(raw,r))return false;
    const typeText=[raw.hv_type,raw.HV_TYPE,raw.dx_type,raw.DX_TYPE,raw.network_type,raw.NETWORK_TYPE,raw.type,raw.TYPE,r?.hvType].map(v=>String(v||'')).join(' ').trim();
    // OH only. If a crossing file supplies a type, require OH/HVOH. Older records with no type are kept.
    return typeText?isOverheadHV(raw,r):true;
  }
  function txLooksSharedEndpoint(r){
    if(!r||r.type!=='TX')return false;
    const raw=rawOf(r);
    const lines=uniqueLines([r.line,...(Array.isArray(r.otherLines)?r.otherLines:[]),raw.transmission_line,raw.transmission_line_2,raw.tx_line,raw.tx_line_2,raw.line_a,raw.line_b]);
    if(lines.length<2)return false;
    const base=fmtLine(lines[0]);
    for(let i=1;i<lines.length;i++){
      const other=fmtLine(lines[i]);
      // Same-voltage lines sharing a terminal are usually a common endpoint/dual-circuit/shared bay, not a span crossing.
      if(base&&other&&sameCircuitToken(base,other)&&sharesEndpointCode(base,other))return true;
    }
    return false;
  }
  function isVisibleRecord(r){
    if(!r||!valid(r.lat,r.lon)||!r.line)return false;
    if(r.type==='HV')return hvRecordIsOverhead(r);
    if(r.type==='TX')return !txLooksSharedEndpoint(r);
    return false;
  }
  function uniqueLines(vals){
    const out=[]; const seen=new Set();
    for(const v of vals||[]){const line=fmtLine(v); const key=compact(line); if(line&&key&&!seen.has(key)){seen.add(key); out.push(line);}}
    return out;
  }
  function lineFromTxSegment(v){
    const m=String(v||'').trim().match(/^TXPOINT:([^:]+):/i);
    return m?m[1]:'';
  }
  function lineCandidates(raw,r){
    return uniqueLines([
      r?.line, raw.transmission_line, raw.TRANSMISSION_LINE, raw.tx_line, raw.TX_LINE, raw.circuit, raw.CIRCUIT,
      raw.LINE_NAME, raw.line_name, raw.LineName, raw.line, raw.LINE,
      raw.line_1, raw.LINE_1, raw.line_2, raw.LINE_2, raw.tx_line_1, raw.TX_LINE_1, raw.tx_line_2, raw.TX_LINE_2,
      raw.transmission_line_1, raw.TRANSMISSION_LINE_1, raw.transmission_line_2, raw.TRANSMISSION_LINE_2,
      raw.transmission_circuit, raw.TRANSMISSION_CIRCUIT, raw.circuit_name, raw.CIRCUIT_NAME,
      raw.from_line, raw.FROM_LINE, raw.to_line, raw.TO_LINE,
      raw.from_label, raw.FROM_LABEL, raw.to_label, raw.TO_LABEL,
      lineFromTxSegment(raw.tx_source_segment||raw.TX_SOURCE_SEGMENT)
    ]);
  }
  function pointOf(raw,r){
    let lat=n(r?.lat), lon=n(r?.lon);
    if(lat===null)lat=n(raw.latitude??raw.LATITUDE??raw.lat??raw.Latitude??raw.y);
    if(lon===null)lon=n(raw.longitude??raw.LONGITUDE??raw.lon??raw.long??raw.Longitude??raw.x);
    const coords=raw.coordinates||raw.COORDINATES;
    if((lat===null||lon===null)&&Array.isArray(coords)&&coords.length>=2){lon=n(coords[0]);lat=n(coords[1]);}
    return valid(lat,lon)?{lat,lon}:null;
  }
  function makeRecords(r, sourceFile=''){
    const raw=rawOf(r);
    const p=pointOf(raw,r); if(!p)return [];
    const type=recType(raw);
    const lines=lineCandidates(raw,r); if(!lines.length)return [];
    const from=String(raw.from_label||raw.FROM_LABEL||raw.from_pole_no||raw.FROM_POLE_NO||raw.from||'').trim();
    const to=String(raw.to_label||raw.TO_LABEL||raw.to_pole_no||raw.TO_POLE_NO||raw.to||'').trim();
    const hv=String(raw.hv_network||raw.HV_NETWORK||raw.dx_network||raw.DX_NETWORK||raw.distribution_network||raw.DISTRIBUTION_NETWORK||raw.network||raw.NETWORK||raw.hv_name||'').trim();
    const hvType=String(raw.hv_type||raw.HV_TYPE||raw.dx_type||raw.DX_TYPE||raw.type||raw.TYPE||'').trim();
    const method=String(raw.method||raw.METHOD||'').trim();
    const titleBase=String(raw.name||raw.title||raw.label||`${type} crossing`).trim();
    const out=[];
    for(const line of lines){
      const otherLines=lines.filter(x=>compact(x)!==compact(line));
      const title=titleBase||`${line} ${type} crossing`;
      const idBase=[line,type,otherLines.join('/'),from,to,hv,hvType,p.lat.toFixed(7),p.lon.toFixed(7)].join('|');
      let h=2166136261; for(let i=0;i<idBase.length;i++){h^=idBase.charCodeAt(i);h=Math.imul(h,16777619);} 
      out.push({id:'x'+(h>>>0).toString(16),sourceFile:String(sourceFile||r?.sourceFile||raw.sourceFile||''),line,lineKey:compact(line),otherLines,type,lat:p.lat,lon:p.lon,from,to,hv,hvType,method,title,raw:{crossing_type:raw.crossing_type||raw.original_crossing_type||'',transmission_line:line,hv_network:hv,hv_type:hvType,dx_type:raw.dx_type||raw.DX_TYPE||'',network_type:raw.network_type||raw.NETWORK_TYPE||'',from_label:raw.from_label||'',to_label:raw.to_label||'',from_pole_no:raw.from_pole_no||'',to_pole_no:raw.to_pole_no||'',tx_source_segment:raw.tx_source_segment||raw.TX_SOURCE_SEGMENT||'',method}});
    }
    return out;
  }
  function makeRecord(r,sourceFile=''){return makeRecords(r,sourceFile)[0]||null;}
  function distKm(a,b){try{return SearchEngine?.distanceKm?.({lat:a.lat,lon:a.lon},{lat:b.lat,lon:b.lon})||0;}catch(e){const dy=(a.lat-b.lat)*111; const dx=(a.lon-b.lon)*111*Math.cos(((a.lat+b.lat)/2)*Math.PI/180); return Math.sqrt(dx*dx+dy*dy);}}
  function circuitToken(line){const m=fmtLine(line).match(/\b(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})$/i); return m?String(m[1]||'').toUpperCase():'';}
  function sameCircuitToken(a,b){const ta=circuitToken(a), tb=circuitToken(b); return !ta||!tb||ta===tb;}
  function endpointCodes(line){
    try{const codes=SearchEngine?.lineEndpointCodes?.(line)||[]; if(Array.isArray(codes)&&codes.length)return codes.map(compact).filter(Boolean);}
    catch(e){}
    const s=fmtLine(line).replace(/\b(?:NO\.?\s*)?(?:71|72|81|82|91|92|X1|X2)\b.*$/i,'').replace(/[–—]/g,'-');
    const m=s.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)/i);
    const out=[]; const add=x=>{x=compact(x); if(x&&/[A-Z]/.test(x)&&x.length<=8&&!out.includes(x))out.push(x);};
    if(m){add(m[1]); String(m[2]||'').split('/').forEach(add);} else String(s||'').split(/[-\/]+/).forEach(add);
    return out;
  }
  function sharesEndpointCode(a,b){
    const ac=new Set(endpointCodes(a));
    if(!ac.size)return false;
    return endpointCodes(b).some(c=>ac.has(c));
  }
  function multiTerminalLine(line){
    const f=fmtLine(line);
    return /\//.test(f)||(endpointCodes(f).length>2);
  }
  function plausibleHvLineForSelected(wanted,candidate){
    wanted=fmtLine(wanted); candidate=fmtLine(candidate);
    if(!wanted||!candidate)return false;
    if(lineMatches(wanted,candidate))return true;
    // Do not borrow HV crossings from neighbouring/shared circuits for a normal two-ended line.
    // Example: HBK-MUC 81 must not pull NT-HBK/NT-LDE/NT-NOR HV points just because the route shares structures nearby.
    if(!multiTerminalLine(wanted))return false;
    if(!sameCircuitToken(wanted,candidate))return false;
    const wc=new Set(endpointCodes(wanted));
    const cc=endpointCodes(candidate);
    let overlap=0;
    for(const c of cc){if(wc.has(c))overlap++;}
    // Branch/slashed circuits can match stored section names only when at least two terminals overlap.
    return overlap>=2;
  }
  function rawStructureSortValue(a){
    const raw=rawOf(a);
    const vals=[a?.rawStructure,a?.structureId,raw.structure_id,raw.STRUCTURE_ID,raw.structureId,a?.id,a?.assetId,a?.globalId];
    for(const v of vals){
      const m=String(v||'').match(/(?:^|\b)T?0*(\d{1,8})(?:\b|$)/i);
      if(m){const n=Number(m[1]); if(Number.isFinite(n))return n;}
    }
    return Infinity;
  }
  function tokenOf(line){return circuitToken(line)||((fmtLine(line).match(/\b(71|72|81|82|91|92|X1|X2)\b/i)||[])[1]||'').toUpperCase();}
  function activeCircuitKeyMatches(line){
    const wanted=compact(fmtLine(line));
    try{const keys=(Array.isArray(MapEngine?.currentCircuits)?MapEngine.currentCircuits:[MapEngine?.currentCircuit||'']).map(x=>compact(fmtLine(x))).filter(Boolean); return !keys.length||keys.includes(wanted);}
    catch(e){return true;}
  }
  function activeMapAssets(){
    const pools=[];
    try{if(Array.isArray(MapEngine?.lastFullCircuitAssets)&&MapEngine.lastFullCircuitAssets.length)pools.push(MapEngine.lastFullCircuitAssets);}catch(e){}
    try{if(Array.isArray(MapEngine?.lastDrawnAssets)&&MapEngine.lastDrawnAssets.length)pools.push(MapEngine.lastDrawnAssets);}catch(e){}
    const out=[]; const seen=new Set();
    for(const pool of pools){for(const a of pool||[]){const p=assetPoint(a); if(!p)continue; const k=(a?.id||'')+'|'+p.lat.toFixed(7)+'|'+p.lon.toFixed(7); if(seen.has(k))continue; seen.add(k); out.push(a);}}
    return out;
  }
  function bboxOfSeg(s){return {minLat:Math.min(s.a.lat,s.b.lat),maxLat:Math.max(s.a.lat,s.b.lat),minLon:Math.min(s.a.lon,s.b.lon),maxLon:Math.max(s.a.lon,s.b.lon)};}
  function pointBBoxNearSeg(p,s,padKm=0.16){
    const lat=(Number(p.lat)+Number(s.a.lat)+Number(s.b.lat))/3;
    const padLat=padKm/110.574;
    const padLon=padKm/(111.320*Math.max(0.18,Math.cos(lat*Math.PI/180)));
    return !(p.lat<s.bbox.minLat-padLat||p.lat>s.bbox.maxLat+padLat||p.lon<s.bbox.minLon-padLon||p.lon>s.bbox.maxLon+padLon);
  }
  function pointToSegmentKm(p,s){
    const lat0=((Number(p.lat)||0)+(Number(s.a.lat)||0)+(Number(s.b.lat)||0))/3*Math.PI/180;
    const kx=111.320*Math.max(0.18,Math.cos(lat0)), ky=110.574;
    const ax=Number(s.a.lon)*kx, ay=Number(s.a.lat)*ky;
    const bx=Number(s.b.lon)*kx, by=Number(s.b.lat)*ky;
    const px=Number(p.lon)*kx, py=Number(p.lat)*ky;
    const vx=bx-ax, vy=by-ay;
    const len2=vx*vx+vy*vy;
    if(!Number.isFinite(len2)||len2<=1e-12)return Math.hypot(px-ax,py-ay);
    let t=((px-ax)*vx+(py-ay)*vy)/len2;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-(ax+t*vx),py-(ay+t*vy));
  }
  function bboxOverlap(a,b,pad=0){return !(a.maxLat+pad<b.minLat||a.minLat-pad>b.maxLat||a.maxLon+pad<b.minLon||a.minLon-pad>b.maxLon);}
  function expandBBox(box,p){return {minLat:box.minLat-p,maxLat:box.maxLat+p,minLon:box.minLon-p,maxLon:box.maxLon+p};}
  function angleDiff(s1,s2){
    const a=Math.atan2(s1.b.lat-s1.a.lat,s1.b.lon-s1.a.lon)*180/Math.PI;
    const b=Math.atan2(s2.b.lat-s2.a.lat,s2.b.lon-s2.a.lon)*180/Math.PI;
    let d=Math.abs(a-b)%180; if(d>90)d=180-d; return d;
  }
  function segmentIntersection(s1,s2){
    const x1=s1.a.lon,y1=s1.a.lat,x2=s1.b.lon,y2=s1.b.lat,x3=s2.a.lon,y3=s2.a.lat,x4=s2.b.lon,y4=s2.b.lat;
    const den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4); if(Math.abs(den)<1e-12)return null;
    const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den;
    const u=((x1-x3)*(y1-y2)-(y1-y3)*(x1-x2))/den;
    if(t<=0.02||t>=0.98||u<=0.02||u>=0.98)return null; // avoid shared tower/end point hits.
    const lon=x1+t*(x2-x1), lat=y1+t*(y2-y1);
    return valid(lat,lon)?{lat,lon,t,u}:null;
  }

  function poleOrderFromText(v){
    const text=String(v||'').toUpperCase().trim();
    if(!text)return {sort:Infinity,label:''};
    // Prefer circuit-label suffix, e.g. CPN-RAN 81-0057 or KW-KEM/OLY 91-0146/002.
    let m=text.match(/(?:^|\s)(?:71|72|81|82|91|92|X1|X2)[-\s]*([A-Z]*\d{1,6}[A-Z]*(?:\/\d{1,6}[A-Z]*)?)\b/);
    if(!m)m=text.match(/[-\s]([A-Z]*\d{1,6}[A-Z]*(?:\/\d{1,6}[A-Z]*)?)$/);
    if(!m)m=text.match(/\b0*(\d{1,6}[A-Z]*(?:\/\d{1,6}[A-Z]*)?)\b/);
    const label=m?String(m[1]||''):text;
    const parts=String(label).split('/');
    const nums=parts.map(part=>{const mm=String(part).match(/(\d+)/); return mm?Number(mm[1]):0;});
    let sort=nums.length?nums[0]:Infinity;
    if(nums.length>1)sort+=nums[1]/10000;
    const suffix=(String(label).match(/[A-Z]+$/)||[''])[0];
    if(suffix)sort+=suffix.split('').reduce((a,c,i)=>a+(c.charCodeAt(0)-64)/Math.pow(100,i+1),0)/100;
    return {sort:Number.isFinite(sort)?sort:Infinity,label};
  }
  function segmentDirectCrossing(s1,s2){
    const hit=segmentIntersection(s1,s2);
    return hit?{...hit,km:0,kind:'intersect'}:null;
  }
  function assetPoint(a){const lat=n(a?.lat), lon=n(a?.lon); return valid(lat,lon)?{lat,lon,asset:a}:null;}

  function crossKey(r){
    if(!r)return '';
    const lat=n(r.lat), lon=n(r.lon);
    if(lat===null||lon===null)return '';
    return [compact(r.line),r.type||'',(r.otherLines||[]).map(compact).sort().join('/'),String(r.from||''),String(r.to||''),String(r.hv||''),String(r.hvType||''),lat.toFixed(6),lon.toFixed(6)].join('|');
  }
  function normTypes(types){
    if(!types)return ['HV','TX'];
    if(typeof types==='string')types=[types];
    const out=[];
    for(const t of types||[]){const x=String(t||'').toUpperCase(); if(x==='DX'||x==='HV')out.push('HV'); else if(x==='TX')out.push('TX');}
    return Array.from(new Set(out));
  }
  const Layer={
    records:[], layer:null, activeCount:0, activeDxCount:0, activeTxCount:0, activeMode:'', activeLine:'', loaded:false, txCache:null, spatialMatchCache:null,
    activeTypes:{HV:false,TX:false}, activeCircuitTypes:{}, lastScope:{mode:'none',line:''},
    circuitCountLine:'', circuitDxCount:0, circuitTxCount:0, circuitCountPending:false, circuitCountToken:0,
    init(){
      if(!this.layer&&window.L&&MapEngine?.map){this.layer=L.layerGroup().addTo(MapEngine.map); this.ensureStyle();}
      if(!this._zoomHooked&&MapEngine?.map?.on){
        this._zoomHooked=true;
        MapEngine.map.on('zoomend moveend',()=>{
          const lines=this.currentCircuitsForCounts();
          const line=lines.join(' + ');
          if(!lines.length){
            this.circuitCountLine=''; this.circuitDxCount=0; this.circuitTxCount=0; this.circuitCountPending=false;
            if(this.hasActiveSelections()){this.layer?.clearLayers?.(); this.activeCircuitTypes={}; this.activeTypes={HV:false,TX:false}; this.activeCount=0; this.activeDxCount=0; this.activeTxCount=0;}
            this.renderControls();
            return;
          }
          this.scheduleCircuitCountUpdate(lines);
          if(!zoomOkForCrossings()){
            // Far zoom hides the overlay so the map stays clean, but keeps selected-circuit HV/TX counts.
            this.layer?.clearLayers?.(); this.activeCount=0; this.activeDxCount=0; this.activeTxCount=0; this.renderControls();
            return;
          }
          if(this.hasActiveSelections())this.refreshActive({silent:true,lines});
        });
      }
      this.renderControls();
    },
    ensureStyle(){
      if(document.getElementById('hvCrossingStyle'))return;
      const st=document.createElement('style'); st.id='hvCrossingStyle';
      st.textContent=`
        .hvtx-crossing-icon{min-width:42px;height:42px;padding:0 6px;border-radius:999px;display:flex;align-items:center;justify-content:center;font:900 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;border:3px solid #fff;box-shadow:0 5px 16px rgba(0,0,0,.55);letter-spacing:.2px;white-space:nowrap;box-sizing:border-box;} .leaflet-container.map-heading-up .hvtx-crossing-icon{transform:rotate(var(--map-counter-rotation,0deg))!important;transform-origin:center center!important;backface-visibility:hidden;}
        .hvtx-crossing-icon.stacked{min-width:54px;font-size:11px;}
        .hvtx-crossing-icon.hv{background:#b31313;}
        .hvtx-crossing-icon.tx{background:#b31313;}
        .hvtx-toggle-panel{position:absolute;left:8px;bottom:52px;top:auto;z-index:630;display:flex;flex-direction:column-reverse;gap:3px;pointer-events:auto;width:min(148px,calc(100vw - 20px));max-height:30vh;overflow-y:auto;overscroll-behavior:contain;padding:0;}
        .hvtx-toggle-panel.hidden{display:none;}
        .hvtx-circuit-row{display:flex;flex-direction:column;gap:3px;align-items:stretch;padding:0;border-radius:10px;background:rgba(58,24,24,.04);backdrop-filter:blur(1px);}
        .hvtx-circuit-label{display:none;}
        .hvtx-toggle-btn{width:100%;min-height:29px;border-radius:9px;border:1.25px solid rgba(255,255,255,.72);background:#7a0f0f;color:#fff;box-shadow:0 2px 7px rgba(0,0,0,.20);font:900 11px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.05px;display:grid;grid-template-columns:23px minmax(0,1fr) 25px;align-items:center;gap:4px;padding:4px 6px;opacity:.36;filter:grayscale(.25);text-align:left;}
        .hvtx-toggle-btn .hvtx-type{font:950 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.1px;}
        .hvtx-toggle-btn .hvtx-line{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:900 10.2px/1 system-ui,-apple-system,Segoe UI,sans-serif;text-transform:uppercase;}
        .hvtx-toggle-btn .hvtx-count{min-width:22px;text-align:right;font:950 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;}
        .hvtx-toggle-btn.active{opacity:1;background:#c31717;filter:none;box-shadow:0 3px 9px rgba(179,19,19,.30);}
        .hvtx-toggle-btn.empty{opacity:.22;}
        .hvtx-toggle-btn:active{transform:translateY(1px);}
        @media (max-height:720px){.hvtx-toggle-panel{bottom:48px;max-height:26vh;width:min(144px,calc(100vw - 20px))}.hvtx-toggle-btn{min-height:28px;border-radius:9px;padding:4px 6px}.hvtx-toggle-btn .hvtx-line{font-size:9.8px}.hvtx-toggle-btn .hvtx-type{font-size:11.5px}.hvtx-toggle-btn .hvtx-count{font-size:11.5px}}
        .hvtx-popup{min-width:210px;max-width:280px;font:600 13px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;color:#17351f;}
        .hvtx-popup b{display:block;font-size:15px;margin-bottom:6px;}
        .hvtx-popup .row{display:flex;gap:8px;justify-content:space-between;border-top:1px solid #e6ddca;padding:6px 0;}
        .hvtx-popup .row span:first-child{color:#5f6d5d;min-width:72px;}
        .hvtx-popup a{display:block;margin-top:8px;padding:9px 10px;border-radius:12px;background:#1f5f2b;color:#fff;text-align:center;text-decoration:none;font-weight:900;}
      `;
      document.head.appendChild(st);
    },
    async loadStore(){
      if(this.loaded)return this.records;
      this.loaded=true;
      let changed=false;
      try{
        const obj=JSON.parse(localStorage.getItem(KEY)||'{}');
        const byKey=new Map();
        for(const r of Array.isArray(obj.records)?obj.records:[]){
          if(!isVisibleRecord(r)){changed=true; continue;}
          const k=crossKey(r)||r.id;
          if(byKey.has(k)){changed=true; continue;}
          byKey.set(k,r);
        }
        this.records=Array.from(byKey.values());
      }catch(e){this.records=[];}
      if(changed)this.saveStore();
      this.renderControls();
      return this.records;
    },
    saveStore(){
      const clean=[]; const seen=new Set();
      for(const r of this.records||[]){if(!isVisibleRecord(r))continue; const k=crossKey(r)||r.id; if(seen.has(k))continue; seen.add(k); clean.push(r);}
      this.records=clean;
      try{localStorage.setItem(KEY,JSON.stringify({version:3,ohOnly:true,ui:'hv-tx-buttons',savedAt:new Date().toISOString(),records:clean}));}catch(e){Diagnostics?.capture?.(new Error('HV/TX crossing save failed: '+(e.message||e)));}
      this.renderControls();
    },
    isCrossingAsset(r){return looksCrossing(r);},
    isLikelyCrossingFile(name=''){return /FIELD[_\s-]*MAP[_\s-]*(DX|HV|TX|TRANSMISSION)[_\s-]*CROSSINGS|DX[_\s-]*CROSSINGS|HV[_\s-]*CROSSINGS|TX[_\s-]*CROSSINGS|CROSSING_POINTS/i.test(String(name||''));},
    async storeImported(records=[],sourceFile='',meta={}){
      await this.loadStore();
      const src=String(sourceFile||'');
      const made=[];
      for(const r of records||[]){for(const x of makeRecords(r,src)){if(isVisibleRecord(x))made.push(x);}}
      if(!made.length)return {stored:0,total:this.records.length};
      const byKey=new Map();
      for(const r of this.records||[]){
        if(src&&String(r.sourceFile||'')===src)continue;
        if(isVisibleRecord(r))byKey.set(crossKey(r)||r.id,r);
      }
      for(const r of made)byKey.set(crossKey(r)||r.id,r);
      this.records=Array.from(byKey.values()).sort((a,b)=>a.line.localeCompare(b.line,undefined,{numeric:true})||a.type.localeCompare(b.type)||a.lat-b.lat||a.lon-b.lon);
      this.saveStore();
      return {stored:made.length,total:this.records.length};
    },
    async ingestRecords(records=[],sourceFile=''){return this.storeImported(records,sourceFile);},
    async deleteBySourceFile(sourceFile='',opts={}){await this.loadStore(); const src=String(sourceFile||''); const before=this.records.length; this.records=this.records.filter(r=>String(r.sourceFile||'')!==src); if(before!==this.records.length)this.saveStore(); return {deleted:before-this.records.length};},
    async clearStore(){this.records=[];this.clearActive({silent:true});try{localStorage.removeItem(KEY);}catch(e){}this.renderControls();},
    async migrateStoredAssetCrossings(){return {moved:0};},
    stats(){const total=(this.records||[]).length; const hv=this.records.filter(r=>r.type==='HV').length; const tx=this.records.filter(r=>r.type==='TX').length; const txSource=!!(tx||this.hasTxGeometry()); return {total,hv,dx:hv,tx,txSource,active:this.activeCount||0,activeDx:!!this.activeTypes.HV,activeTx:!!this.activeTypes.TX,mode:this.activeMode||'',line:this.activeLine||''};},
    iconFor(r){const cls=r.type==='TX'?'tx':'hv'; const base=r.type==='TX'?'TX':'HV'; const count=Number(r._groupCount||1); const label=count>1?`${base} ${count}`:base; const size=count>1?[54,42]:[42,42]; return L.divIcon({className:'',html:`<div class="hvtx-crossing-icon ${cls} ${count>1?'stacked':''}">${label}</div>`,iconSize:size,iconAnchor:[size[0]/2,21],popupAnchor:[0,-21]});},
    popupHtml(r){
      const gm=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(Number(r.lat).toFixed(7)+','+Number(r.lon).toFixed(7))}`;
      const recs=Array.isArray(r._groupRecords)&&r._groupRecords.length?r._groupRecords:[r];
      if(recs.length>1){
        const rows=recs.slice(0,12).map((x,i)=>`<div class="row"><span>${i+1}</span><strong>${esc([x.hv||x.otherLines?.join(', ')||x.line,x.hvType].filter(Boolean).join(' · '))}</strong></div>`).join('');
        const more=recs.length>12?`<div class="row"><span>More</span><strong>${recs.length-12} more at this spot</strong></div>`:'';
        return `<div class="hvtx-popup"><b>${r.type==='TX'?'TX crossings':'HV crossings'} × ${recs.length}</b><div class="row"><span>Line</span><strong>${esc(r.line)}</strong></div>${(r.from||r.to)?`<div class="row"><span>Between</span><strong>${esc([r.from,r.to].filter(Boolean).join(' → '))}</strong></div>`:''}${rows}${more}<a href="${gm}" target="_blank" rel="noopener">Google Maps</a></div>`;
      }
      return `<div class="hvtx-popup"><b>${r.type==='TX'?'TX crossing':'HV crossing'}</b><div class="row"><span>Line</span><strong>${esc(r.line)}</strong></div>${r.otherLine?`<div class="row"><span>Other</span><strong>${esc(r.otherLine)}</strong></div>`:''}${Array.isArray(r.otherLines)&&r.otherLines.length?`<div class="row"><span>Other</span><strong>${esc(r.otherLines.join(', '))}</strong></div>`:''}${r.hv?`<div class="row"><span>Network</span><strong>${esc(r.hv)}</strong></div>`:''}${r.hvType?`<div class="row"><span>Type</span><strong>${esc(r.hvType)}</strong></div>`:''}${(r.from||r.to)?`<div class="row"><span>Between</span><strong>${esc([r.from,r.to].filter(Boolean).join(' → '))}</strong></div>`:''}${r.method?`<div class="row"><span>Method</span><strong>${esc(r.method)}</strong></div>`:''}<a href="${gm}" target="_blank" rel="noopener">Google Maps</a></div>`;
    },
    activeTypeList(){const out=[]; if(this.activeTypes.HV)out.push('HV'); if(this.activeTypes.TX)out.push('TX'); return out;},
    filterTypes(list=[],types){const set=new Set(normTypes(types||this.activeTypeList())); return (list||[]).filter(r=>isVisibleRecord(r)&&set.has(r.type));},
    selKey(type,line){return `${String(type||'').toUpperCase()==='TX'?'TX':'HV'}|${compact(fmtLine(line))}`;},
    hasActiveSelections(){return Object.values(this.activeCircuitTypes||{}).some(Boolean);},
    syncGlobalActiveFlags(){
      let hv=false,tx=false;
      for(const [k,v] of Object.entries(this.activeCircuitTypes||{})){if(!v)continue; if(k.startsWith('HV|'))hv=true; if(k.startsWith('TX|'))tx=true;}
      this.activeTypes={HV:hv,TX:tx};
      return hv||tx;
    },
    cleanSelectionsForLines(lines=[]){
      const allowed=new Set((lines||[]).map(x=>compact(fmtLine(x))).filter(Boolean));
      if(!allowed.size){this.activeCircuitTypes={};this.syncGlobalActiveFlags();return;}
      for(const k of Object.keys(this.activeCircuitTypes||{})){
        const lineKey=String(k).split('|')[1]||'';
        if(!allowed.has(lineKey))delete this.activeCircuitTypes[k];
      }
      this.syncGlobalActiveFlags();
    },
    activePairs(lines=[]){
      const out=[]; const wanted=(lines||[]).map(fmtLine).filter(Boolean);
      for(const line of wanted){for(const t of ['HV','TX']){if(this.activeCircuitTypes[this.selKey(t,line)])out.push({type:t,line});}}
      return out;
    },
    draw(list=[],mode='',line=''){
      this.init();
      this.layer?.clearLayers?.();
      const clean=this.dedupeList((list||[]).filter(isVisibleRecord));
      const groups=this.groupForDrawing(clean);
      for(const r of groups){
        const m=L.marker([Number(r.lat),Number(r.lon)],{icon:this.iconFor(r),zIndexOffset:7000,riseOnHover:true,title:`${r.type==='TX'?'TX':'HV'} crossing ${r.line}`}).bindPopup(()=>this.popupHtml(r),{maxWidth:320,autoPan:true,keepInView:true,closeOnClick:false});
        m.on('popupopen',()=>{try{clearTimeout(m._hvtxCloseTimer);}catch(e){}});
        this.layer.addLayer(m);
      }
      this.activeCount=clean.length; this.activeDxCount=clean.filter(r=>r.type==='HV').length; this.activeTxCount=clean.filter(r=>r.type==='TX').length; this.activeMode=mode; this.activeLine=line||''; this.renderControls();
      return clean.length;
    },
    clearActive(opts={}){try{this.layer?.clearLayers?.();}catch(e){} this.activeCircuitTypes={}; this.activeTypes={HV:false,TX:false}; this.activeCount=0; this.activeDxCount=0; this.activeTxCount=0; this.activeMode=''; this.activeLine=''; this.renderControls(); if(!opts.silent)UI?.toast?.('Crossings hidden.');},
    spatialSegmentsForLine(line){
      const wanted=fmtLine(line); if(!wanted)return [];
      const segs=[]; const addSeg=(a,b,source='spatial-route')=>{
        if(!valid(a?.lat,a?.lon)||!valid(b?.lat,b?.lon))return;
        const d=distKm(a,b); if(!Number.isFinite(d)||d<=0||d>7)return;
        const sg={line:wanted,a:{lat:Number(a.lat),lon:Number(a.lon)},b:{lat:Number(b.lat),lon:Number(b.lon)},source};
        sg.bbox=bboxOfSeg(sg); segs.push(sg);
      };
      try{
        const pathSegs=SearchEngine?.circuitPathSegments?.(wanted)||SearchEngine?.circuitPathSegments?.(line)||[];
        for(const path of pathSegs||[]){
          const pts=(path||[]).map(p=>Array.isArray(p)?{lat:Number(p[0]),lon:Number(p[1])}:p).filter(p=>valid(p?.lat,p?.lon));
          for(let i=0;i<pts.length-1;i++)addSeg(pts[i],pts[i+1],'circuit-path-index');
        }
      }catch(e){}
      if(!segs.length){
        try{for(const sg of this.segsFromPoints(wanted,this.pointsForGroup(this.lineGroupFor(wanted))||[])||[])segs.push(sg);}catch(e){}
      }
      // If the selected/search circuit is a combined display name, the exact line group may be empty.
      // Use the currently drawn circuit dots as the physical route for HV spatial matching.
      if(activeCircuitKeyMatches(wanted)){
        try{
          const pts=[]; const seenPts=new Set();
          for(const a of activeMapAssets()){
            const p=this.linePointFromAsset(a); if(!p)continue;
            const key=`${p.lat.toFixed(7)},${p.lon.toFixed(7)}`; if(seenPts.has(key))continue; seenPts.add(key); pts.push(p);
          }
          for(const sg of this.segsFromPoints(wanted,pts)||[])segs.push(sg);
        }catch(e){}
      }
      try{
        for(const r of MapEngine?.currentCircuitRoutes||[]){
          const rawLine=r?.line||r?.label||r?.circuit||r?.name||'';
          if(rawLine&&!lineMatches(wanted,rawLine)&&!sameCircuitToken(wanted,rawLine))continue;
            const coords=Array.isArray(r?.routeCoords)?r.routeCoords:[];
            const pts=coords.map(c=>Array.isArray(c)?{lat:Number(c[0]),lon:Number(c[1])}:c).filter(p=>valid(p?.lat,p?.lon));
            for(let i=0;i<pts.length-1;i++)addSeg(pts[i],pts[i+1],'current-route');
        }
      }catch(e){}
      const out=[]; const seen=new Set();
      for(const sg of segs){const k=[sg.a.lat.toFixed(6),sg.a.lon.toFixed(6),sg.b.lat.toFixed(6),sg.b.lon.toFixed(6)].join('|'); if(!seen.has(k)){seen.add(k);out.push(sg);}}
      return out;
    },
    spatialDxMatchesForLine(line){
      const wanted=fmtLine(line); if(!wanted)return [];
      const stamp=[wanted,(this.records||[]).length,SearchEngine?.lineMap?.size||0,App?.assets?.length||0,MapEngine?.currentCircuitRoutes?.length||0,MapEngine?.lastFullCircuitAssets?.length||0,MapEngine?.lastDrawnAssets?.length||0].join('|');
      if(this.spatialMatchCache?.stamp===stamp)return this.spatialMatchCache.list||[];
      const segs=this.spatialSegmentsForLine(wanted);
      const out=[]; const seen=new Set();
      if(segs.length){
        const routeKm=0.14;       // true route proximity only; avoids unrelated HV crossings near the same area.
        const broadBboxKm=0.20;
        for(const r of this.records||[]){
          if(!isVisibleRecord(r)||r.type!=='HV')continue;
          if(!plausibleHvLineForSelected(wanted,r.line))continue;
          const p={lat:Number(r.lat),lon:Number(r.lon)};
          let best=Infinity;
          for(const sg of segs){
            if(!pointBBoxNearSeg(p,sg,broadBboxKm))continue;
            const d=pointToSegmentKm(p,sg);
            if(d<best)best=d;
            if(d<=routeKm){
              const k=crossKey(r)||r.id;
              if(!seen.has(k)){
                seen.add(k);
                // Keep the original crossing line in the popup, but mark why it was included for diagnostics.
                out.push(Object.assign({},r,{matchLine:wanted,matchKm:d,matchMethod:'loaded route proximity'}));
              }
              break;
            }
          }
        }
      }
      this.spatialMatchCache={stamp,list:out};
      if(out.length){try{Diagnostics?.log?.('HV spatial fallback',`${wanted}: ${out.length} crossing point(s) matched by route proximity`);}catch(e){}}
      return out;
    },
    lineAliasesForMatching(line){
      const wanted=fmtLine(line); const out=[]; const seen=new Set();
      const add=v=>{const f=fmtLine(v); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);out.push(f);}};
      add(wanted);
      const token=tokenOf(wanted);
      const codes=endpointCodes(wanted);
      // If the selected circuit is PIC-PNJ/BSN/KEM 81, candidate aliases include PIC-PNJ 81, PIC-BSN 81, PIC-KEM 81, etc.
      if(codes.length>=2&&token){
        for(let i=0;i<codes.length;i++){
          for(let j=i+1;j<codes.length;j++){
            add(`${codes[i]}-${codes[j]} ${token}`);
          }
        }
        for(let i=0;i<codes.length-1;i++)add(`${codes[i]}-${codes[i+1]} ${token}`);
      }
      // Add exact line references from currently drawn circuit dots. This catches combined search names whose actual
      // imported pole/route sections are stored under separate section names.
      try{
        if(activeCircuitKeyMatches(wanted)){
          for(const a of activeMapAssets()){
            const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
            for(const r of refs){
              const f=fmtLine(r?.line||'');
              if(f&&sameCircuitToken(wanted,f))add(f);
            }
          }
        }
      }catch(e){}
      // Add same-voltage spur/leg lines that share one of the selected endpoint codes. This catches labels like
      // PIC-PNJ/BSN/KEM 81 where a physical BSN leg/spur is stored as its own circuit section.
      try{
        const codeSet=new Set(codes);
        if(false&&codeSet.size&&SearchEngine?.lineMap?.size){
          for(const g of SearchEngine.lineMap.values()){
            const f=fmtLine(g?.line||g?.rawLine||''); if(!f||!sameCircuitToken(wanted,f))continue;
            const gc=endpointCodes(f); if(!gc.some(c=>codeSet.has(c)))continue;
            add(f);
          }
        }
      }catch(e){}
      // Add nearby line groups from the search index only when they share the same voltage/circuit class,
      // have a terminal in common, and physically sit beside the selected/drawn route.
      try{
        const codeSet=new Set(codes);
        const routeSegs=this.spatialSegmentsForLine(wanted);
        if(false&&codeSet.size&&routeSegs.length&&SearchEngine?.lineMap?.size){
          for(const g of SearchEngine.lineMap.values()){
            const f=fmtLine(g?.line||g?.rawLine||''); if(!f||!sameCircuitToken(wanted,f))continue;
            const gc=endpointCodes(f); if(!gc.some(c=>codeSet.has(c)))continue;
            const pts=this.pointsForGroup(g)||[]; let near=false;
            for(const pt of pts){
              const p={lat:Number(pt.lat),lon:Number(pt.lon)};
              if(!valid(p.lat,p.lon))continue;
              for(const sg of routeSegs){
                if(pointBBoxNearSeg(p,sg,0.45)&&pointToSegmentKm(p,sg)<=0.45){near=true;break;}
              }
              if(near)break;
            }
            if(near)add(f);
          }
        }
      }catch(e){}
      // Only keep aliases that actually have stored crossing points, plus the original wanted line.
      const recKeys=new Set((this.records||[]).filter(isVisibleRecord).map(r=>compact(fmtLine(r.line))));
      return out.filter((x,i)=>i===0||recKeys.has(compact(x)));
    },
    matchesForLine(line){
      const wanted=fmtLine(line); if(!wanted)return [];
      const out=[];
      for(const alias of this.lineAliasesForMatching(wanted)){
        out.push(...(this.records||[]).filter(r=>isVisibleRecord(r)&&lineMatches(alias,r.line)));
      }
      // Spatial HV fallback is only safe for public slashed/multi-terminal circuits.
      // Normal circuits must use exact/alias crossing records only, otherwise nearby dual/shared circuits get counted.
      if(multiTerminalLine(wanted))out.push(...this.spatialDxMatchesForLine(wanted));
      return this.dedupeList(out);
    },
    dedupeList(list=[]){
      const out=[]; const seen=new Set();
      for(const r of list||[]){if(!isVisibleRecord(r))continue; const k=crossKey(r)||r.id; if(seen.has(k))continue; seen.add(k); out.push(r);} 
      return out;
    },
    groupForDrawing(list=[]){
      // Multiple HV crossings can sit on the same transmission span or within a few metres.
      // Group them into one visible marker with a count so they do not hide under each other.
      const buckets=new Map();
      for(const r of list||[]){
        const lat=Number(r.lat), lon=Number(r.lon);
        const spanParts=[String(r.from||'').trim(),String(r.to||'').trim()].filter(Boolean).sort();
        const span=spanParts.length?spanParts.join('>'):'';
        const k=[r.type,compact(r.line),span||`${lat.toFixed(4)},${lon.toFixed(4)}`].join('|');
        if(!buckets.has(k))buckets.set(k,[]);
        buckets.get(k).push(r);
      }
      const out=[];
      for(const arr of buckets.values()){
        if(arr.length===1){out.push(arr[0]);continue;}
        const lat=arr.reduce((a,r)=>a+Number(r.lat||0),0)/arr.length;
        const lon=arr.reduce((a,r)=>a+Number(r.lon||0),0)/arr.length;
        const base=Object.assign({},arr[0],{lat,lon,_groupCount:arr.length,_groupRecords:arr});
        out.push(base);
      }
      return out;
    },
    poleNeedlesFromAsset(asset){
      const raw=rawOf(asset);
      const refs=SearchEngine?.lineRefsForAsset?.(asset,true)||[];
      const values=[asset?.poleNumber,asset?.structure,asset?.label,asset?.gisLabel,raw.NAMEPLATE_ID_1,raw.NAMEPLATE_ID,raw.structure_id,raw.STRUCTURE_ID,raw.trmsn_line_gis_label,raw.TRMSN_LINE_GIS_LABEL,raw.name,raw.Name,raw.title,raw.label];
      for(const r of refs){values.push(r?.pole,r?.label,r?.structure);}
      const out=new Set();
      for(const v of values){
        const ord=poleOrderFromText(v);
        const labs=[ord.label,String(v||'')].map(x=>String(x||'').toUpperCase().trim()).filter(Boolean);
        for(const lab of labs){
          const m=lab.match(/([A-Z]*0*\d{1,6}[A-Z]*(?:\/0*\d{1,6}[A-Z]*)?)$/)||lab.match(/\b([A-Z]*0*\d{1,6}[A-Z]*(?:\/0*\d{1,6}[A-Z]*)?)\b/);
          const token=m?m[1]:lab;
          const norm=token.replace(/(^|\/)0+(?=\d)/g,'$1');
          if(norm&&norm.length>=1)out.add(norm);
          if(token&&token.length>=1)out.add(token);
        }
      }
      return Array.from(out).filter(x=>/\d/.test(x));
    },
    lineRefsForBayAsset(asset){
      const raw=rawOf(asset);
      const refs=SearchEngine?.lineRefsForAsset?.(asset,true)||[];
      const out=[]; const seen=new Set();
      for(const r of refs||[]){const line=fmtLine(r?.line||''); if(line&&!seen.has(compact(line))){seen.add(compact(line));out.push({line,pole:r?.pole||r?.label||''});}}
      const fallback=fmtLine(asset?.line||raw.line_name||raw.LINE_NAME||raw.trmsn_line_gis_label||raw.TRMSN_LINE_GIS_LABEL||'');
      if(fallback&&!seen.has(compact(fallback))){seen.add(compact(fallback));out.push({line:fallback,pole:asset?.poleNumber||asset?.structure||''});}
      return out;
    },
    crossingTouchesAssetBay(r,asset){
      const needles=this.poleNeedlesFromAsset(asset);
      if(!needles.length)return false;
      const raw=rawOf(r);
      const fields=[r?.from,r?.to,r?.title,r?.label,raw.from_label,raw.to_label,raw.from_pole_no,raw.to_pole_no,raw.from,raw.to,raw.title,raw.name,raw.label];
      const textFields=fields.map(x=>String(x||'').toUpperCase());
      for(const nd of needles){
        const n1=String(nd||'').toUpperCase();
        const n2=n1.replace(/(^|\/)0+(?=\d)/g,'$1');
        for(const txt of textFields){
          const clean=txt.replace(/(^|[-\s\/])0+(?=\d)/g,'$1');
          if((n1&&txt.includes(n1))||(n2&&clean.includes(n2)))return true;
        }
      }
      return false;
    },
    currentCircuitsForCounts(){
      const raw=Array.isArray(MapEngine?.currentCircuits)&&MapEngine.currentCircuits.length?MapEngine.currentCircuits:[MapEngine?.currentCircuit||''];
      const out=[]; const seen=new Set();
      for(const line of raw||[]){const f=fmtLine(line); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);out.push(f);}}
      return out;
    },
    currentCircuitForCounts(){const lines=this.currentCircuitsForCounts(); return lines[0]||'';},
    currentCircuitCountKey(){return this.currentCircuitsForCounts().map(compact).join('|');},
    async computeCircuitCounts(line){
      await this.loadStore();
      const rawLines=Array.isArray(line)?line:(line?[line]:this.currentCircuitsForCounts());
      const lines=[]; const seenLines=new Set();
      for(const x of rawLines||[]){const f=fmtLine(x); const k=compact(f); if(f&&k&&!seenLines.has(k)){seenLines.add(k);lines.push(f);}}
      if(!lines.length)return {line:'',lines:[],dx:0,tx:0,details:[]};
      let dx=0, tx=0; const details=[]; const globalTxSeen=new Set();
      for(const wanted of lines){
        const base=this.matchesForLine(wanted);
        const dxLine=base.filter(r=>r.type==='HV').length;
        let txList=base.filter(r=>r.type==='TX');
        try{
          if(this.hasTxGeometry()){
            const dyn=await this.buildDynamicTxForLine(wanted);
            if(dyn?.length)txList=txList.concat(dyn);
          }
        }catch(e){Diagnostics?.capture?.(new Error('TX count failed: '+(e.message||e)));}
        const txLine=this.dedupeList(txList).filter(r=>r.type==='TX').length;
        dx+=dxLine;
        for(const r of this.dedupeList(txList).filter(r=>r.type==='TX')){const k=crossKey(r)||r.id; if(!globalTxSeen.has(k)){globalTxSeen.add(k);}}
        details.push({line:wanted,dx:dxLine,tx:txLine});
      }
      tx=globalTxSeen.size;
      return {line:lines.join(' + '),lines,dx,tx,details};
    },
    scheduleCircuitCountUpdate(line){
      const rawLines=Array.isArray(line)?line:(line?[line]:this.currentCircuitsForCounts());
      const lines=[]; const seen=new Set();
      for(const x of rawLines||[]){const f=fmtLine(x); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);lines.push(f);}}
      const key=lines.map(compact).join('|');
      if(!key){this.circuitCountLine=''; this.circuitCountLines=[]; this.circuitCountDetails=[]; this.circuitDxCount=0; this.circuitTxCount=0; this.circuitCountPending=false; this.renderControls(); return;}
      if(this.circuitCountLine===key&&!this.circuitCountPending)return;
      const token=++this.circuitCountToken;
      this.circuitCountLine=key; this.circuitCountLines=lines; this.circuitCountDetails=[]; this.circuitDxCount=0; this.circuitTxCount=0; this.circuitCountPending=true; this.renderControls();
      setTimeout(async()=>{
        const res=await this.computeCircuitCounts(lines);
        if(token!==this.circuitCountToken)return;
        this.circuitCountLine=res.lines.map(compact).join('|'); this.circuitCountLines=res.lines; this.circuitCountDetails=res.details||[]; this.circuitDxCount=res.dx; this.circuitTxCount=res.tx; this.circuitCountPending=false; this.renderControls();
      },50);
    },
    cacheStamp(){return `${App?.assets?.length||0}|${SearchEngine?.lineMap?.size||0}`;},
    segmentsFromCoords(line,coords=[],source='route'){
      const out=[]; const pts=(coords||[]).map(c=>Array.isArray(c)?{lat:n(c[0]),lon:n(c[1])}:assetPoint(c)).filter(p=>p&&valid(p.lat,p.lon));
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i], b=pts[i+1]; if(!valid(a.lat,a.lon)||!valid(b.lat,b.lon))continue;
        if(source!=='route'&&distKm(a,b)>7)continue;
        const seg={line:fmtLine(line),a,b,source}; seg.bbox=bboxOfSeg(seg); out.push(seg);
      }
      return out;
    },
    async idle(){return new Promise(r=>setTimeout(r,0));},
    lineGroupFor(line){
      const wanted=fmtLine(line); if(!wanted)return null;
      const lm=SearchEngine?.lineMap; if(!lm?.size)return null;
      return lm.get(compact(wanted))||lm.get(compact(line))||null;
    },
    linePointFromAsset(a){
      const p=assetPoint(a); if(!p)return null;
      const raw=rawOf(a);
      const gis=String(raw.trmsn_line_gis_label||raw.TRMSN_LINE_GIS_LABEL||a?.gisLabel||a?.label||'');
      const line=fmtLine(a?.line||raw.line_name||raw.LINE_NAME||gis||'');
      if(!line)return null;
      const pole=String(a?.poleNumber||a?.structure||raw.NAMEPLATE_ID_1||raw.NAMEPLATE_ID||raw.structure_id||raw.STRUCTURE_ID||gis||'');
      const ord=poleOrderFromText(gis||pole);
      let sort=ord.sort;
      if(!Number.isFinite(sort)||sort===Infinity||sort===0){
        const ro=rawStructureSortValue(a);
        if(Number.isFinite(ro))sort=ro;
      }
      return {lat:p.lat,lon:p.lon,asset:a,line,pole:ord.label||pole,sort};
    },
    pointsForGroup(g){
      const pts=[]; const seen=new Set();
      let idx=0;
      for(const a of (g?.assets||[])){
        const p=this.linePointFromAsset(a); if(!p)continue;
        const k=`${p.lat.toFixed(7)},${p.lon.toFixed(7)}`; if(seen.has(k))continue; seen.add(k); p._idx=idx++; pts.push(p);
      }
      // Transmission pole GeoJSON files are commonly unsorted. Build route segments by structure number, not import order.
      pts.sort((a,b)=>{
        const as=Number.isFinite(a.sort)?a.sort:Infinity, bs=Number.isFinite(b.sort)?b.sort:Infinity;
        if(as!==bs)return as-bs;
        const ao=rawStructureSortValue(a.asset), bo=rawStructureSortValue(b.asset);
        if(ao!==bo)return ao-bo;
        return (a._idx||0)-(b._idx||0);
      });
      return pts;
    },
    segsFromPoints(line,pts=[]){
      const out=[];
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i], b=pts[i+1];
        if(!valid(a.lat,a.lon)||!valid(b.lat,b.lon))continue;
        const d=distKm(a,b);
        // Skip long jumps caused by split routes/legs or bad sort; they create false TX crossings.
        if(d>MAX_TX_SEGMENT_KM)continue;
        const seg={line:fmtLine(line),a,b,source:'line-points',from:a.pole||'',to:b.pole||''};
        seg.bbox=bboxOfSeg(seg); out.push(seg);
      }
      return out;
    },
    bboxFromSegs(segs=[]){
      if(!segs.length)return null;
      const b={minLat:90,maxLat:-90,minLon:180,maxLon:-180};
      for(const s of segs){b.minLat=Math.min(b.minLat,s.bbox.minLat);b.maxLat=Math.max(b.maxLat,s.bbox.maxLat);b.minLon=Math.min(b.minLon,s.bbox.minLon);b.maxLon=Math.max(b.maxLon,s.bbox.maxLon);} return b;
    },
    hasTxGeometry(){
      try{
        const lm=SearchEngine?.lineMap; if(!lm?.size)return false;
        let c=0;
        for(const g of lm.values()){if((g?.validGps||0)>1 || (g?.assets||[]).some(a=>valid(a?.lat,a?.lon))){c++; if(c>=2)return true;}}
      }catch(e){}
      return false;
    },
    async buildTxLineCache(){
      const stamp=this.cacheStamp();
      if(this.txCache?.stamp===stamp)return this.txCache;
      const lines=[]; const lm=SearchEngine?.lineMap;
      if(lm?.size){
        let i=0;
        for(const g of lm.values()){
          const line=fmtLine(g?.line||g?.rawLine||''); if(!line)continue;
          const pts=this.pointsForGroup(g); if(pts.length<2)continue;
          const segs=this.segsFromPoints(line,pts); if(!segs.length)continue;
          const bbox=this.bboxFromSegs(segs); if(!bbox)continue;
          lines.push({line,lineKey:compact(line),pts,segs,bbox});
          if(++i%35===0)await this.idle();
        }
      }
      this.txCache={stamp,lines,builtAt:Date.now()};
      return this.txCache;
    },
    async buildDynamicTxForLine(line){
      // Disabled in v3.1.124. Public/shared transmission structure geometry can make dual-circuit or
      // same-corridor sections look like line crossings. Use the curated bundled TX crossing points instead.
      return [];
      const wanted=fmtLine(line); if(!wanted)return [];
      const cache=await this.buildTxLineCache();
      const current=cache.lines.find(x=>x.lineKey===compact(wanted));
      if(!current||!current.segs.length)return [];
      const currentBox=expandBBox(current.bbox,0.015);
      const out=[]; const seen=new Set(); let checked=0;
      for(const other of cache.lines){
        if(other.lineKey===current.lineKey)continue;
        if(!bboxOverlap(currentBox,other.bbox,0.004))continue;
        // Quick filter: only compare candidate lines that have assets near the loaded circuit bounds.
        checked++;
        for(const s2 of other.segs){
          if(!bboxOverlap(currentBox,s2.bbox,0.004))continue;
          for(const s1 of current.segs){
            if(!bboxOverlap(s1.bbox,s2.bbox,0.003))continue;
            const ad=angleDiff(s1,s2); if(ad<10)continue; // parallel/shared corridor, not a crossing indicator.
            const hit=segmentDirectCrossing(s1,s2); if(!hit)continue;
            const k=`${other.lineKey}|${Math.round(hit.lat*10000)}|${Math.round(hit.lon*10000)}`;
            if(seen.has(k))continue; seen.add(k);
            let h=2166136261; const idBase=`${wanted}|${other.line}|${hit.lat.toFixed(7)}|${hit.lon.toFixed(7)}|${hit.kind||''}`; for(let i=0;i<idBase.length;i++){h^=idBase.charCodeAt(i);h=Math.imul(h,16777619);} 
            const method='Direct line crossing from loaded transmission pole/structure line data';
            out.push({id:'txdyn'+(h>>>0).toString(16),sourceFile:'dynamic-transmission-line-data',line:wanted,lineKey:compact(wanted),otherLines:[other.line],type:'TX',lat:hit.lat,lon:hit.lon,from:[s1.from,s1.to].filter(Boolean).join(' ⇄ '),to:[s2.from,s2.to].filter(Boolean).join(' ⇄ '),hv:'',hvType:'',method,title:`TX crossing · ${wanted} × ${other.line}`,raw:{crossing_type:'dynamic_tx_from_line_data',transmission_line:wanted,other_line:other.line,match:hit.kind||'',nearest_km:hit.km||0}});
            if(out.length>=MAX_DYNAMIC_TX)return out;
            break;
          }
        }
        if(checked%10===0)await this.idle();
      }
      return out;
    },
    async buildDynamicTxInView(){
      // View mode is deliberately conservative: do not brute-force all WA lines.
      // If circuits are loaded, use the selected circuit engine; otherwise imported TX crossing points only.
      const lines=this.currentCircuitsForCounts();
      if(!lines.length){const wanted=this.lineFromSelectedAsset(); return wanted?this.buildDynamicTxForLine(wanted):[];}
      const out=[];
      for(const line of lines){const dyn=await this.buildDynamicTxForLine(line); if(dyn?.length)out.push(...dyn);}
      return this.dedupeList(out);
    },
    currentBaseList(line=''){
      const rawLines=Array.isArray(line)?line:(line?[line]:this.currentCircuitsForCounts());
      const lines=[]; const seen=new Set();
      for(const x of rawLines||[]){const f=fmtLine(x); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);lines.push(f);}}
      if(!lines.length||!zoomOkForCrossings()){this.lastScope={mode:'none',line:lines.join(' + ')}; return [];}
      this.lastScope={mode:'circuit',line:lines.join(' + ')};
      const out=[]; for(const l of lines)out.push(...this.matchesForLine(l));
      return this.dedupeList(out);
    },
    async refreshActive(opts={}){
      await this.loadStore(); this.init();
      const rawLines=Array.isArray(opts.lines)?opts.lines:(opts.line?[opts.line]:this.currentCircuitsForCounts());
      const lines=[]; const seen=new Set();
      for(const x of rawLines||[]){const f=fmtLine(x); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);lines.push(f);}}
      this.cleanSelectionsForLines(lines);
      const pairs=this.activePairs(lines);
      if(!pairs.length){this.draw([],'','');return 0;}
      if(!lines.length||!zoomOkForCrossings()){this.draw([],'none',lines.join(' + ')); if(!opts.silent)UI?.toast?.(!lines.length?'Load a circuit first.':'Zoom in closer to show HV/TX crossing indicators.'); return 0;}
      const out=[];
      for(const pair of pairs){
        let base=this.matchesForLine(pair.line);
        if(pair.type==='TX'){
          const dyn=await this.buildDynamicTxForLine(pair.line);
          if(dyn?.length)base=base.concat(dyn);
        }
        out.push(...this.filterTypes(base,[pair.type]));
      }
      const list=this.dedupeList(out);
      const count=this.draw(list,'circuit',lines.join(' + '));
      if(!opts.silent){
        const dx=list.filter(r=>r.type==='HV').length, tx=list.filter(r=>r.type==='TX').length;
        const scope=lines.length===1?` for ${lines[0]}`:` for ${lines.length} selected circuits`;
        if(count)UI?.toast?.(`${count.toLocaleString()} crossing(s) shown${scope}: ${dx} HV, ${tx} TX.`);
        else UI?.toast?.(`No selected HV/TX crossing points matched${scope}.`);
      }
      return count;
    },
    async toggleCircuitType(type,line){
      await this.loadStore();
      const t=String(type||'').toUpperCase()==='TX'?'TX':'HV';
      const l=fmtLine(line); if(!l){UI?.toast?.('Load a circuit first.');return 0;}
      if(!zoomOkForCrossings()){UI?.toast?.('Zoom in closer to show HV/TX crossing indicators.'); return 0;}
      const st=this.stats();
      if(t==='TX'&&!st.txSource){UI?.toast?.('No TX line/crossing data found. Import a transmission pole/structure file or TX crossing point file.'); this.renderControls(); return 0;}
      if(t==='HV'&&!st.hv){UI?.toast?.('No HV crossing points imported.'); this.renderControls(); return 0;}
      const k=this.selKey(t,l);
      if(this.activeCircuitTypes[k])delete this.activeCircuitTypes[k]; else this.activeCircuitTypes[k]=true;
      this.syncGlobalActiveFlags();
      if(!this.hasActiveSelections()){this.layer?.clearLayers?.();this.activeCount=0;this.activeDxCount=0;this.activeTxCount=0;this.renderControls();UI?.toast?.(`${t==='TX'?'TX':'HV'} crossings hidden for ${l}.`);return 0;}
      return this.refreshActive({silent:false,lines:this.currentCircuitsForCounts()});
    },
    async toggleType(type){
      const lines=this.currentCircuitsForCounts();
      if(!lines.length){UI?.toast?.('Load one or more circuits first.');return 0;}
      return this.toggleCircuitType(type,lines[0]);
    },
    async showForCircuit(line,opts={}){
      await this.loadStore();
      const rawLines=Array.isArray(line)?line:(line?[line]:this.currentCircuitsForCounts());
      const lines=[]; const seen=new Set();
      for(const x of rawLines||[]){const f=fmtLine(x); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);lines.push(f);}}
      if(!lines.length){if(!opts.silent)UI?.toast?.('Load one or more circuits first.'); return 0;}
      if(!zoomOkForCrossings()){if(!opts.silent)UI?.toast?.('Zoom in closer to show HV/TX crossing indicators.'); this.draw([],'none',lines.join(' + ')); return 0;}
      const types=normTypes(opts.types||['HV','TX']);
      this.activeTypes.HV=types.includes('HV'); this.activeTypes.TX=types.includes('TX');
      let base=this.currentBaseList(lines);
      if(types.includes('TX')){
        const dyn=[]; for(const l of lines){const d=await this.buildDynamicTxForLine(l); if(d?.length)dyn.push(...d);}
        if(dyn.length)base=base.concat(dyn);
      }
      const list=this.filterTypes(base,types);
      const count=this.draw(list,'circuit',lines.join(' + '));
      if(!opts.silent){const dx=list.filter(r=>r.type==='HV').length, tx=list.filter(r=>r.type==='TX').length; const scope=lines.length===1?lines[0]:`${lines.length} selected circuits`; UI?.toast?.(count?`${count.toLocaleString()} crossing(s) shown for ${scope}: ${dx} HV, ${tx} TX.`:`No HV/TX crossings matched ${scope}.`);}
      return count;
    },
    async showForCircuitFull(line,opts={}){return this.showForCircuit(line,opts);},
    async showBayForAsset(asset,opts={}){
      await this.loadStore(); this.init();
      if(!asset){this.draw([],'asset-bay','');return 0;}
      const refs=this.lineRefsForBayAsset(asset);
      const lines=[]; const seen=new Set();
      for(const r of refs){const f=fmtLine(r.line); const k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);lines.push(f);}}
      if(!lines.length){this.draw([],'asset-bay','');return 0;}
      const out=[];
      for(const line of lines){
        const base=this.matchesForLine(line).filter(r=>this.crossingTouchesAssetBay(r,asset));
        out.push(...base);
        try{
          if(this.hasTxGeometry()){
            const dyn=await this.buildDynamicTxForLine(line);
            out.push(...(dyn||[]).filter(r=>this.crossingTouchesAssetBay(r,asset)));
          }
        }catch(e){Diagnostics?.capture?.(new Error('Asset bay TX crossing check failed: '+(e.message||e)));}
      }
      const list=this.dedupeList(out);
      const count=this.draw(list,'asset-bay',lines.join(' + '));
      if(count&&!opts.silent){const dx=list.filter(r=>r.type==='HV').length, tx=list.filter(r=>r.type==='TX').length; UI?.toast?.(`${count} crossing(s) in this bay: ${dx} HV, ${tx} TX.`);}
      return count;
    },
    showForAsset(asset){return this.showBayForAsset(asset);},
    lineFromSelectedAsset(){try{const a=App?.selectedAsset; const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[]; return refs[0]?.line||a?.line||'';}catch(e){return '';}}
    ,async showInMapView(opts={}){
      await this.loadStore(); this.init();
      const types=normTypes(opts.types||['HV','TX']);
      this.activeTypes.HV=types.includes('HV'); this.activeTypes.TX=types.includes('TX');
      if(!zoomOkForCrossings()){if(!opts.silent)UI?.toast?.('Zoom in closer to show HV/TX crossing indicators.'); this.draw([],'none',''); return 0;}
      let b=null; try{b=MapEngine?.map?.getBounds?.();}catch(e){} if(!b){if(!opts.silent)UI?.toast?.('Map not ready.'); return 0;}
      const base=[]; for(const r of this.records||[]){if(isVisibleRecord(r)&&b.contains([Number(r.lat),Number(r.lon)])){base.push(r); if(base.length>=MAX_VIEW_DRAW)break;}}
      if(types.includes('TX')){
        const dyn=await this.buildDynamicTxInView();
        for(const r of dyn||[]){if(b.contains([Number(r.lat),Number(r.lon)]))base.push(r);}
      }
      const list=this.filterTypes(base,types);
      this.lastScope={mode:MapEngine?.currentCircuit?'circuit':'view',line:fmtLine(MapEngine?.currentCircuit||'')};
      const count=this.draw(list,this.lastScope.mode,this.lastScope.line);
      if(!opts.silent){const dx=list.filter(r=>r.type==='HV').length, tx=list.filter(r=>r.type==='TX').length; UI?.toast?.(count?`${count.toLocaleString()} crossing(s) shown in current map view: ${dx} HV, ${tx} TX.`:'No HV/TX crossings inside the current map view.');}
      return count;
    },
    async onCircuitLoaded(line,opts={}){
      // Do not auto-show crossings on circuit load. Keep buttons dim/off, but update the HV/TX numbers for the selected circuit.
      this.scheduleCircuitCountUpdate(line);
      if(!zoomOkForCrossings()){this.layer?.clearLayers?.(); this.activeCount=0; this.activeDxCount=0; this.activeTxCount=0; this.renderControls(); return 0;}
      this.cleanSelectionsForLines([line]);
      if(!this.hasActiveSelections())return 0;
      return this.refreshActive({silent:true,line});
    },
    async onCircuitsLoaded(lines=[],opts={}){
      this.scheduleCircuitCountUpdate(lines);
      if(!zoomOkForCrossings()){this.layer?.clearLayers?.(); this.activeCount=0; this.activeDxCount=0; this.activeTxCount=0; this.renderControls(); return 0;}
      this.cleanSelectionsForLines(lines);
      if(!this.hasActiveSelections())return 0;
      return this.refreshActive({silent:true,lines});
    },
    renderControls(){
      let el=document.getElementById('hvTxTogglePanel');
      if(!el){
        el=document.createElement('div');
        el.id='hvTxTogglePanel';
        el.className='hvtx-toggle-panel hidden';
        document.body.appendChild(el);
      }
      let alert=document.getElementById('hvTxAlertBtn');
      if(!alert){
        alert=document.createElement('button');
        alert.id='hvTxAlertBtn';
        alert.className='hvtx-alert-btn hidden';
        alert.type='button';
        alert.textContent='!';
        alert.title='HV / TX crossings';
        alert.setAttribute('aria-label','HV / TX crossings');
        alert.addEventListener('click',(ev)=>{
          try{ev.preventDefault();ev.stopPropagation();}catch(_e){}
          const has=alert && !alert.classList.contains('hidden');
          if(!has)return;
          this.controlsOpen=!this.controlsOpen;
          try{
            window.LeanMapApp?.closePlusMenu?.();
            window.LeanMapApp?.closeSearchQuickPanel?.();
            window.LeanMapApp?.closeToggleQuickPanel?.();
            window.LeanMapApp?.closeCircuitPicker?.();
            window.LeanMapApp?.closeAssetSearch?.();
            window.LeanMapApp?.closeBaseLayersPanel?.();
            window.LeanMapApp?.closeAssetLayersPanel?.();
            window.LeanMapApp?.closeToolsPanel?.();
            window.LeanMapApp?.closeResetPanel?.();
            window.LeanMapApp?.closeConductorsPanel?.();
            document.getElementById('statusPanel')?.classList.add('hidden');
          }catch(_e){}
          this.renderControls();
        });
        document.body.appendChild(alert);
      }

      const st=this.stats();
      const selectedLines=this.currentCircuitsForCounts();
      const selectedKey=selectedLines.map(compact).join('|');
      const hideAll=()=>{
        this.controlsOpen=false;
        el.classList.add('hidden');
        alert.classList.add('hidden');
        alert.classList.remove('active');
      };
      if(!selectedKey){hideAll();return;}
      if(selectedKey&&selectedKey!==this.circuitCountLine&&!this.circuitCountPending){this.scheduleCircuitCountUpdate(selectedLines);}
      if(!st.total&&!st.txSource){hideAll();return;}
      const controlsReady=!!selectedKey;
      const pending=controlsReady&&this.circuitCountPending&&this.circuitCountLine===selectedKey;
      const detailMap=new Map((this.circuitCountDetails||[]).map(d=>[compact(d.line),d]));
      const lines=controlsReady?selectedLines:[];
      let totalDetected=0;
      for(const line of lines){
        const d=detailMap.get(compact(line))||{line,dx:0,tx:0};
        totalDetected += Number(d.dx||0)+Number(d.tx||0);
      }
      if(!totalDetected&&!pending){
        totalDetected=Number(this.circuitDxCount||0)+Number(this.circuitTxCount||0);
      }
      if(!totalDetected&&!pending){hideAll();return;}

      alert.classList.remove('hidden');
      alert.classList.toggle('active',!!this.controlsOpen);
      alert.title=pending?'Checking crossings…':`${Number(totalDetected||0).toLocaleString()} HV / TX crossing(s)`;
      alert.setAttribute('aria-label',alert.title);

      const rowHtml=(line)=>{
        const d=detailMap.get(compact(line))||{line,dx:0,tx:0};
        const dxCount=pending?'…':Number(d.dx||0).toLocaleString();
        const txCount=pending?'…':Number(d.tx||0).toLocaleString();
        const dxActive=!!this.activeCircuitTypes[this.selKey('HV',line)]&&zoomOkForCrossings();
        const txActive=!!this.activeCircuitTypes[this.selKey('TX',line)]&&zoomOkForCrossings();
        const short=esc(String(line||'').replace(/\s+/g,' '));
        return `<div class="hvtx-circuit-row" data-line="${esc(line)}"><button class="hvtx-toggle-btn ${dxActive?'active':''} ${!st.hv?'empty':''}" data-cross-type="HV" data-cross-line="${esc(line)}" type="button" title="HV crossings on ${short}"><span class="hvtx-type">HV</span><span class="hvtx-line">${short}</span><span class="hvtx-count">${dxCount}</span></button><button class="hvtx-toggle-btn ${txActive?'active':''} ${!st.txSource?'empty':''}" data-cross-type="TX" data-cross-line="${esc(line)}" type="button" title="Direct TX crossings on ${short}"><span class="hvtx-type">TX</span><span class="hvtx-line">${short}</span><span class="hvtx-count">${txCount}</span></button></div>`;
      };
      el.innerHTML=lines.length?lines.map(rowHtml).join(''):`<div class="hvtx-circuit-row"><button class="hvtx-toggle-btn empty" type="button"><span class="hvtx-type">HV</span><span class="hvtx-line">LOAD CIRCUIT</span><span class="hvtx-count">0</span></button><button class="hvtx-toggle-btn empty" type="button"><span class="hvtx-type">TX</span><span class="hvtx-line">LOAD CIRCUIT</span><span class="hvtx-count">0</span></button></div>`;
      el.classList.toggle('hidden',!this.controlsOpen);
      el.querySelectorAll('[data-cross-type][data-cross-line]').forEach(btn=>{btn.addEventListener('click',()=>this.toggleCircuitType(btn.dataset.crossType,btn.dataset.crossLine));});
    },
    renderBadge(){this.renderControls();},
    currentLineLabel(){const lines=this.currentCircuitsForCounts(); return lines.length?lines.join(' + '):fmtLine(this.lineFromSelectedAsset()||'');}
  };
  window.HVCrossingsLayer=Layer;
})();

/* myMap v3.1.117: HV route fallback now requires plausible same-line/endpoint match and real route proximity. */

/* myMap v3.1.117: broad endpoint aliases removed to stop unrelated HV crossings on combined circuits. */

/* myMap v3.1.117: stop guessing HV by broad nearby routes; use tight exact/alias + tight same-voltage physical match only. */
(function(){
  const LAYER=window.HVCrossingsLayer;
  if(!LAYER)return;
  const WA={minLat:-36.5,maxLat:-12.0,minLon:112.0,maxLon:130.5};
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
  const valid=(lat,lon)=>{lat=n(lat);lon=n(lon);return lat!==null&&lon!==null&&lat>=WA.minLat&&lat<=WA.maxLat&&lon>=WA.minLon&&lon<=WA.maxLon;};
  const compact=s=>{try{return SearchEngine?.compact?.(s)||String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}catch(e){return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}};
  const fmtLine=v=>{
    let s=String(v||'').trim().replace(/[–—]/g,'-').replace(/\s+/g,' ').toUpperCase();
    if(!s)return '';
    const m=s.match(/^([A-Z]{1,5}\s*-\s*[A-Z]{1,5}(?:\s*\/\s*[A-Z]{1,5})*\s+(?:71|72|81|82|91|92|X1|X2))\b/i);
    if(m)s=m[1];
    try{s=SearchEngine?.formatCircuitName?.(s)||s;}catch(e){}
    return s.replace(/\s+/g,' ').trim().toUpperCase();
  };
  const tokenOf=line=>{const m=fmtLine(line).match(/\b(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})$/i); return m?String(m[1]||'').toUpperCase():'';};
  const sameToken=(a,b)=>{const ta=tokenOf(a), tb=tokenOf(b); return !!ta&&!!tb&&ta===tb;};
  const endpointCodes=line=>{
    try{const codes=SearchEngine?.lineEndpointCodes?.(line)||[]; if(Array.isArray(codes)&&codes.length)return codes.map(compact).filter(Boolean);}catch(e){}
    const src=fmtLine(line).replace(/\b(?:NO\.?\s*)?(?:71|72|81|82|91|92|X1|X2)\b.*$/i,'').replace(/[–—]/g,'-');
    const out=[]; const add=x=>{x=compact(x); if(x&&/[A-Z]/.test(x)&&x.length<=8&&!out.includes(x))out.push(x);};
    const m=src.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)/i);
    if(m){add(m[1]); String(m[2]||'').split('/').forEach(add);} else String(src||'').split(/[-\/]+/).forEach(add);
    return out;
  };
  const sharesEndpoint=(a,b)=>{const ac=new Set(endpointCodes(a)); if(!ac.size)return false; return endpointCodes(b).some(c=>ac.has(c));};
  const lineMatches=(a,b)=>{a=fmtLine(a); b=fmtLine(b); if(!a||!b)return false; const ca=compact(a), cb=compact(b); return a===b||ca===cb||ca.startsWith(cb)||cb.startsWith(ca);};
  const rawOf=r=>r?.raw&&typeof r.raw==='object'?r.raw:r||{};
  const hvText=(r)=>{const raw=rawOf(r); return [raw.hv_type,raw.HV_TYPE,raw.dx_type,raw.DX_TYPE,raw.type,raw.TYPE,raw.network_type,raw.NETWORK_TYPE,raw.asset_type,raw.category,raw.layer,raw.field_map_layer,raw.source_layer,raw.hv_network,raw.name,raw.title,raw.label,r?.hvType,r?.hv,r?.type,r?.title,r?.label,r?.sourceFile].map(v=>String(v||'')).join(' ').toUpperCase();};
  const isOH=(r)=>{if(!r||r.type!=='HV'||!valid(r.lat,r.lon)||!r.line)return false; const t=hvText(r); if(/\bHVUG\b|UNDER\s*GROUND|UNDERGROUND|UNDERGROUND\s*CABLE|\bUG\s*(?:1PH|3PH|CABLE|HV|DIST|DISTRIBUTION)?\b/.test(t))return false; const raw=rawOf(r); const typeText=[raw.hv_type,raw.HV_TYPE,raw.dx_type,raw.DX_TYPE,raw.network_type,raw.NETWORK_TYPE,raw.type,raw.TYPE,r?.hvType].map(v=>String(v||'')).join(' ').trim(); return typeText?/\bHVOH\b|OVER\s*HEAD|OVERHEAD|\bOH\s*(?:1PH|3PH|HV|DIST|DISTRIBUTION)?\b/.test(t):true;};
  const crossKey=r=>{if(!r)return ''; const lat=n(r.lat),lon=n(r.lon); return [compact(fmtLine(r.line)),r.type||'',(r.otherLines||[]).map(x=>compact(fmtLine(x))).sort().join('/'),String(r.from||''),String(r.to||''),String(r.hv||''),String(r.hvType||''),Number.isFinite(lat)?lat.toFixed(6):'',Number.isFinite(lon)?lon.toFixed(6):''].join('|');};
  const distKm=(a,b)=>{try{return SearchEngine?._distKm?.(a,b)||SearchEngine?.distanceKm?.(a,b)||0;}catch(e){const dy=(Number(a.lat)-Number(b.lat))*111; const dx=(Number(a.lon)-Number(b.lon))*111*Math.cos(((Number(a.lat)+Number(b.lat))/2)*Math.PI/180); return Math.sqrt(dx*dx+dy*dy);}};
  const pointToSegmentKm=(p,s)=>{
    const lat0=((Number(p.lat)||0)+(Number(s.a.lat)||0)+(Number(s.b.lat)||0))/3*Math.PI/180;
    const kx=111.320*Math.max(0.18,Math.cos(lat0)), ky=110.574;
    const ax=Number(s.a.lon)*kx, ay=Number(s.a.lat)*ky, bx=Number(s.b.lon)*kx, by=Number(s.b.lat)*ky, px=Number(p.lon)*kx, py=Number(p.lat)*ky;
    const vx=bx-ax, vy=by-ay, len2=vx*vx+vy*vy;
    if(!Number.isFinite(len2)||len2<=1e-12)return Math.hypot(px-ax,py-ay);
    let t=((px-ax)*vx+(py-ay)*vy)/len2; t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-(ax+t*vx),py-(ay+t*vy));
  };
  const segBox=s=>({minLat:Math.min(s.a.lat,s.b.lat),maxLat:Math.max(s.a.lat,s.b.lat),minLon:Math.min(s.a.lon,s.b.lon),maxLon:Math.max(s.a.lon,s.b.lon)});
  const pointNearBox=(p,s,padKm=0.12)=>{const lat=(Number(p.lat)+Number(s.a.lat)+Number(s.b.lat))/3; const padLat=padKm/110.574; const padLon=padKm/(111.320*Math.max(0.18,Math.cos(lat*Math.PI/180))); const b=s.bbox||segBox(s); return !(p.lat<b.minLat-padLat||p.lat>b.maxLat+padLat||p.lon<b.minLon-padLon||p.lon>b.maxLon+padLon);};
  const activeMapAssets=()=>{
    const pools=[]; try{if(Array.isArray(MapEngine?.lastFullCircuitAssets)&&MapEngine.lastFullCircuitAssets.length)pools.push(MapEngine.lastFullCircuitAssets);}catch(e){}
    try{if(Array.isArray(MapEngine?.lastDrawnAssets)&&MapEngine.lastDrawnAssets.length)pools.push(MapEngine.lastDrawnAssets);}catch(e){}
    const out=[]; const seen=new Set();
    for(const pool of pools){for(const a of pool||[]){const lat=n(a?.lat),lon=n(a?.lon); if(!valid(lat,lon))continue; const k=(a?.id||a?.assetId||'')+'|'+lat.toFixed(7)+'|'+lon.toFixed(7); if(seen.has(k))continue; seen.add(k); out.push(a);}}
    return out;
  };
  const activeCircuitKeyMatches=line=>{const wanted=compact(fmtLine(line)); try{const keys=(Array.isArray(MapEngine?.currentCircuits)?MapEngine.currentCircuits:[MapEngine?.currentCircuit||'']).map(x=>compact(fmtLine(x))).filter(Boolean); return !keys.length||keys.includes(wanted);}catch(e){return true;}};
  const linePointFromAsset=a=>{
    const lat=n(a?.lat),lon=n(a?.lon); if(!valid(lat,lon))return null;
    const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
    const line=fmtLine(refs[0]?.line||a?.line||'');
    return line?{lat,lon,line,asset:a}:null;
  };
  function lineAliases(line){
    const wanted=fmtLine(line); const out=[]; const seen=new Set(); const add=v=>{const f=fmtLine(v), k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k);out.push(f);}};
    add(wanted);
    const codes=endpointCodes(wanted), tok=tokenOf(wanted);
    if(codes.length>=2&&tok){
      // Combined labels can represent their real named sections. Keep these exact-name aliases only;
      // do not use them as broad geographic guesses.
      for(let i=0;i<codes.length;i++)for(let j=i+1;j<codes.length;j++)add(`${codes[i]}-${codes[j]} ${tok}`);
      for(let i=0;i<codes.length-1;i++)add(`${codes[i]}-${codes[i+1]} ${tok}`);
    }
    try{
      if(activeCircuitKeyMatches(wanted)){
        for(const a of activeMapAssets()){
          for(const r of SearchEngine?.lineRefsForAsset?.(a,true)||[]){const f=fmtLine(r?.line||''); if(f&&sameToken(wanted,f))add(f);}
        }
      }
    }catch(e){}
    const recKeys=new Set((LAYER.records||[]).filter(r=>r&&(r.type==='TX'||isOH(r))).map(r=>compact(fmtLine(r.line))));
    return out.filter((x,i)=>i===0||recKeys.has(compact(x)));
  }
  function routeSegmentsFor(line){
    const wanted=fmtLine(line); const out=[]; const add=(a,b,source='route')=>{if(!valid(a?.lat,a?.lon)||!valid(b?.lat,b?.lon))return; const d=distKm(a,b); if(!Number.isFinite(d)||d<=0||d>2.8)return; const s={a:{lat:Number(a.lat),lon:Number(a.lon)},b:{lat:Number(b.lat),lon:Number(b.lon)},source}; s.bbox=segBox(s); out.push(s);};
    try{
      const pathSegs=SearchEngine?.circuitPathSegments?.(wanted)||[];
      for(const seg of pathSegs||[]){const pts=(seg||[]).map(p=>Array.isArray(p)?{lat:Number(p[0]),lon:Number(p[1])}:p).filter(p=>valid(p?.lat,p?.lon)); for(let i=0;i<pts.length-1;i++)add(pts[i],pts[i+1],'path-index');}
    }catch(e){}
    try{
      if(activeCircuitKeyMatches(wanted)){
        const pts=[]; const seen=new Set();
        for(const a of activeMapAssets()){
          const p=linePointFromAsset(a); if(!p)continue;
          const k=`${p.lat.toFixed(7)},${p.lon.toFixed(7)}`; if(seen.has(k))continue; seen.add(k); pts.push(p);
        }
        // Use nearest-neighbour chain instead of structure-id order when all poles are labelled 0.
        if(pts.length>1){
          const unused=pts.slice(); let cur=unused.shift(); const chain=[cur];
          while(unused.length&&chain.length<1600){
            let bi=0,bd=Infinity;
            for(let i=0;i<unused.length;i++){const d=distKm(cur,unused[i]); if(d<bd){bd=d;bi=i;}}
            cur=unused.splice(bi,1)[0]; chain.push(cur);
          }
          for(let i=0;i<chain.length-1;i++)add(chain[i],chain[i+1],'drawn-dot-chain');
        }
      }
    }catch(e){}
    const seen=new Set(), clean=[];
    for(const s of out){const k=[s.a.lat.toFixed(6),s.a.lon.toFixed(6),s.b.lat.toFixed(6),s.b.lon.toFixed(6)].join('|'); if(!seen.has(k)){seen.add(k);clean.push(s);}}
    return clean;
  }
  LAYER.lineAliasesForMatching=function(line){return lineAliases(line);};
  LAYER.spatialDxMatchesForLine=function(line){
    const wanted=fmtLine(line); if(!wanted)return [];
    const stamp=[wanted,(this.records||[]).length,SearchEngine?.lineMap?.size||0,App?.assets?.length||0,MapEngine?.lastFullCircuitAssets?.length||0,MapEngine?.lastDrawnAssets?.length||0,'v117'].join('|');
    if(this.spatialMatchCache?.stamp===stamp)return this.spatialMatchCache.list||[];
    const segs=routeSegmentsFor(wanted);
    const out=[]; const seen=new Set();
    if(segs.length){
      const maxKm=0.09; // tight: only crossings essentially on the loaded route, not merely nearby.
      for(const r of this.records||[]){
        if(!isOH(r))continue;
        const recLine=fmtLine(r.line);
        if(lineMatches(wanted,recLine))continue; // exact matches are handled separately.
        if(!sameToken(wanted,recLine)||!sharesEndpoint(wanted,recLine))continue;
        const p={lat:Number(r.lat),lon:Number(r.lon)};
        for(const sg of segs){
          if(!pointNearBox(p,sg,0.12))continue;
          const d=pointToSegmentKm(p,sg);
          if(d<=maxKm){const k=crossKey(r)||r.id; if(!seen.has(k)){seen.add(k); out.push(Object.assign({},r,{matchLine:wanted,matchKm:d,matchMethod:'tight loaded-route match'}));} break;}
        }
      }
    }
    this.spatialMatchCache={stamp,list:out};
    try{Diagnostics?.log?.('HV tight spatial match',`${wanted}: ${out.length} point(s)`);}catch(e){}
    return out;
  };
  LAYER.matchesForLine=function(line){
    const wanted=fmtLine(line); if(!wanted)return [];
    const out=[];
    for(const alias of lineAliases(wanted)){
      for(const r of this.records||[]){
        if(!r||!valid(r.lat,r.lon))continue;
        if(r.type==='TX'){ if(lineMatches(alias,r.line))out.push(r); }
        else if(isOH(r)&&lineMatches(alias,r.line))out.push(r);
      }
    }
    out.push(...this.spatialDxMatchesForLine(wanted));
    return this.dedupeList?this.dedupeList(out):out;
  };
})();


/* myMap v3.1.125: STRICT circuit crossing matching.
   Normal two-ended circuits only use their exact imported crossing records.
   This stops shared/dual routes from borrowing nearby NT-HBK / MUC-KMM / MOR-MUC points when HBK-MUC is loaded.
   Slashed/multi-terminal public names still get alias + tight spatial help. */
(function(){
  const LAYER=window.HVCrossingsLayer;
  if(!LAYER)return;
  const WA={minLat:-36.5,maxLat:-12.0,minLon:112.0,maxLon:130.5};
  const prevSpatial=typeof LAYER.spatialDxMatchesForLine==='function'?LAYER.spatialDxMatchesForLine.bind(LAYER):function(){return[];};
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
  const valid=(lat,lon)=>{lat=n(lat);lon=n(lon);return lat!==null&&lon!==null&&lat>=WA.minLat&&lat<=WA.maxLat&&lon>=WA.minLon&&lon<=WA.maxLon;};
  const compact=s=>{try{return SearchEngine?.compact?.(s)||String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}catch(e){return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');}};
  const fmtLine=v=>{
    let s=String(v||'').trim().replace(/[–—]/g,'-').replace(/\s+/g,' ').toUpperCase();
    if(!s)return '';
    const m=s.match(/^([A-Z]{1,5}\s*-\s*[A-Z]{1,5}(?:\s*\/\s*[A-Z]{1,5})*\s+(?:71|72|81|82|91|92|X1|X2))\b/i);
    if(m)s=m[1];
    try{s=SearchEngine?.formatCircuitName?.(s)||s;}catch(e){}
    return s.replace(/\s+/g,' ').trim().toUpperCase();
  };
  const tokenOf=line=>{const m=fmtLine(line).match(/\b(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})$/i); return m?String(m[1]||'').toUpperCase():'';};
  const endpointCodes=line=>{
    try{const codes=SearchEngine?.lineEndpointCodes?.(line)||[]; if(Array.isArray(codes)&&codes.length)return codes.map(compact).filter(Boolean);}catch(e){}
    const src=fmtLine(line).replace(/\b(?:NO\.?\s*)?(?:71|72|81|82|91|92|X1|X2)\b.*$/i,'').replace(/[–—]/g,'-');
    const out=[]; const add=x=>{x=compact(x); if(x&&/[A-Z]/.test(x)&&x.length<=8&&!out.includes(x))out.push(x);};
    const m=src.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)/i);
    if(m){add(m[1]); String(m[2]||'').split('/').forEach(add);} else String(src||'').split(/[-\/]+/).forEach(add);
    return out;
  };
  const isCombined=line=>/\//.test(fmtLine(line))||endpointCodes(line).length>2;
  const lineMatchesExact=(a,b)=>{a=fmtLine(a); b=fmtLine(b); return !!a&&!!b&&compact(a)===compact(b);};
  const rawOf=r=>r?.raw&&typeof r.raw==='object'?r.raw:r||{};
  const hvText=r=>{const raw=rawOf(r); return [raw.hv_type,raw.HV_TYPE,raw.dx_type,raw.DX_TYPE,raw.type,raw.TYPE,raw.network_type,raw.NETWORK_TYPE,raw.asset_type,raw.category,raw.layer,raw.field_map_layer,raw.source_layer,raw.hv_network,raw.name,raw.title,raw.label,r?.hvType,r?.hv,r?.type,r?.title,r?.label,r?.sourceFile].map(v=>String(v||'')).join(' ').toUpperCase();};
  const isOH=r=>{if(!r||r.type!=='HV'||!valid(r.lat,r.lon)||!r.line)return false; const t=hvText(r); if(/\bHVUG\b|UNDER\s*GROUND|UNDERGROUND|UNDERGROUND\s*CABLE|\bUG\s*(?:1PH|3PH|CABLE|HV|DIST|DISTRIBUTION)?\b/.test(t))return false; const raw=rawOf(r); const typeText=[raw.hv_type,raw.HV_TYPE,raw.dx_type,raw.DX_TYPE,raw.network_type,raw.NETWORK_TYPE,raw.type,raw.TYPE,r?.hvType].map(v=>String(v||'')).join(' ').trim(); return typeText?/\bHVOH\b|OVER\s*HEAD|OVERHEAD|\bOH\s*(?:1PH|3PH|HV|DIST|DISTRIBUTION)?\b/.test(t):true;};
  const addUnique=(arr,seen,v)=>{const f=fmtLine(v), k=compact(f); if(f&&k&&!seen.has(k)){seen.add(k); arr.push(f);}};
  const recordLineKeys=()=>new Set((LAYER.records||[]).filter(r=>r&&(r.type==='TX'||isOH(r))).map(r=>compact(fmtLine(r.line))).filter(Boolean));
  function strictAliases(line){
    const wanted=fmtLine(line), out=[], seen=new Set();
    addUnique(out,seen,wanted);
    // Only public multi-terminal/slashed circuits get alias expansion.
    // Simple circuits like HBK-MUC 81 must not borrow NT-HBK 81, MUC-KMM 81 or MOR-MUC 81.
    if(isCombined(wanted)){
      const codes=endpointCodes(wanted), tok=tokenOf(wanted), recKeys=recordLineKeys();
      if(codes.length>=2&&tok){
        for(let i=0;i<codes.length;i++)for(let j=i+1;j<codes.length;j++)addUnique(out,seen,`${codes[i]}-${codes[j]} ${tok}`);
        for(let i=0;i<codes.length-1;i++)addUnique(out,seen,`${codes[i]}-${codes[i+1]} ${tok}`);
      }
      return out.filter((x,i)=>i===0||recKeys.has(compact(x)));
    }
    return out;
  }
  LAYER.lineAliasesForMatching=function(line){return strictAliases(line);};
  LAYER.spatialDxMatchesForLine=function(line){return isCombined(line)?(prevSpatial(line)||[]):[];};
  LAYER.matchesForLine=function(line){
    const wanted=fmtLine(line); if(!wanted)return [];
    const out=[];
    for(const alias of strictAliases(wanted)){
      for(const r of this.records||[]){
        if(!r||!valid(r.lat,r.lon))continue;
        if(r.type==='TX'){ if(lineMatchesExact(alias,r.line))out.push(r); }
        else if(isOH(r)&&lineMatchesExact(alias,r.line))out.push(r);
      }
    }
    if(isCombined(wanted))out.push(...(this.spatialDxMatchesForLine(wanted)||[]));
    return this.dedupeList?this.dedupeList(out):out;
  };
  try{Diagnostics?.log?.('HV/TX strict circuit matching','v3.1.126 exact-only for normal circuits; rotate-safe marker icons');}catch(e){}
})();
