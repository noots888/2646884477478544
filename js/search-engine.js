const SearchEngine={
  lineMap:new Map(),
  assetMap:new Map(),
  conductorSections:[],
  pass2IndexVersion:'base-r1-pass2-indexed-search-v34-oh-hv-spur-branch',
  docCache:null,
  kindIndex:null,
  indexRunning:false,
  indexCancelRequested:false,
  indexCancelReason:'',
  makeAbortError(message='Index rebuild cancelled'){
    const err=new Error(message);
    err.name='AbortError';
    return err;
  },
  assertIndexNotCancelled(){
    if(this.indexCancelRequested)throw this.makeAbortError(this.indexCancelReason||'Index rebuild cancelled');
  },
  cancelRebuild(){
    if(!this.indexRunning)return false;
    this.indexCancelRequested=true;
    this.indexCancelReason='Index rebuild cancelled by user';
    UI?.progress?.(true,'Cancelling data index rebuild…','Stopping startup/index rebuild. Saved data is not deleted.',Math.max(1,UI?.progressState?.pct||1));
    UI?.toast?.('Cancelling data index rebuild…');
    return true;
  },
  compact(s){return String(s||'').toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,'');},
  cleanText(s){return String(s ?? '').replace(/\s+/g,' ').trim();},
  words(s){return String(s||'').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);},
  stripZeros(s){
    const text=String(s||'').trim();
    try{
      const p=this.poleIdParts?.(text);
      if(p?.norm)return this.compact(p.norm);
    }catch(e){}
    const m=text.match(/^(.*?)(\d+)([A-Z]{0,4})$/i);
    if(!m)return this.compact(text);
    const n=String(Number(m[2]));
    const suffix=String(m[3]||'').toUpperCase();
    return this.compact((m[1]||'')+n+suffix);
  },
  validCircuitToken(token){return /\d/.test(String(token||''));},
  isDisplayableTransmissionCircuitLine(line){
    const text=String(line||'').trim().toUpperCase();
    if(!text)return false;
    // Loadable transmission circuit cards must be endpoint-to-endpoint names
    // Endpoint-to-endpoint circuit cards only. This blocks single-site labels from
    // leaking into circuit search as fake circuits.
    if(!/[A-Z0-9]\s*[-–—]\s*[A-Z0-9]/.test(text))return false;
    return /^\s*[A-Z]{1,4}\s*[-–—]\s*[A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})*\s+[A-Z0-9]*\d[A-Z0-9]{0,3}\s*$/.test(text);
  },
  formatCircuitName(value){
    const original=String(value||'').trim().replace(/\s+/g,' ');
    if(!original)return '';
    // If a structure label was passed in, strip the pole part first.
    const full=original.match(/^(.+?\b[A-Z0-9]*\d[A-Z0-9]{0,4})\s*[-_]\s*([A-Z]{0,3}\d{1,6}[A-Z]{0,3}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?|\d{1,6}[A-Z]{0,4}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?)$/i);
    if(full&&/[A-Z]{1,4}\s*[-–—]\s*[A-Z]{1,4}/i.test(full[1]))return this.formatCircuitName(full[1]);
    const multiSlash=original.match(/^([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})+)\s*(?:NO\.?\s*)?([A-Z0-9]{1,4})$/i);
    if(multiSlash&&this.validCircuitToken(multiSlash[3]))return `${multiSlash[1].toUpperCase()}-${multiSlash[2].toUpperCase().replace(/\s*\/\s*/g,'/')} ${multiSlash[3].toUpperCase()}`;
    const slash=original.match(/^([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4})\s*\/\s*([A-Z]{1,4})\s*(?:NO\.?\s*)?([A-Z0-9]{1,4})$/i);
    if(slash&&this.validCircuitToken(slash[4]))return `${slash[1].toUpperCase()}-${slash[2].toUpperCase()}/${slash[3].toUpperCase()} ${slash[4].toUpperCase()}`;
    const direct=original.match(/^([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4})\s*(?:NO\.?\s*)?([A-Z0-9]{1,4})$/i);
    if(direct&&this.validCircuitToken(direct[3]))return `${direct[1].toUpperCase()}-${direct[2].toUpperCase()} ${direct[3].toUpperCase()}`;
    const spacedSlash=original.match(/^([A-Z]{1,4})\s+([A-Z]{1,4})\s*\/\s*([A-Z]{1,4})\s+(?:NO\.?\s*)?([A-Z0-9]{1,4})$/i);
    if(spacedSlash&&this.validCircuitToken(spacedSlash[4]))return `${spacedSlash[1].toUpperCase()}-${spacedSlash[2].toUpperCase()}/${spacedSlash[3].toUpperCase()} ${spacedSlash[4].toUpperCase()}`;
    const compact=this.compact(original);
    const m=compact.match(/^([A-Z]{2,12})([A-Z]?\d{1,4})$/);
    if(!m)return original.toUpperCase();
    const letters=m[1], num=m[2];
    if(/^(OBJECTID|GLOBALID|ASSETID|FEATUREID|DISTASSET|PUBLICSECURE|GDA)\d*$/i.test(letters))return original;
    let first='',second='';
    if(letters.length===4){first=letters.slice(0,1);second=letters.slice(1);}       // compact circuit support
    else if(letters.length>=5&&letters.length<=8){first=letters.slice(0,3);second=letters.slice(3);} // compact circuit support
    if(first&&second)return `${first}-${second} ${num}`;
    return `${letters} ${num}`;
  },
  lineEndpointCodes(line){
    const src=String(line||'').toUpperCase().replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
    const out=[]; const seen=new Set();
    const add=c=>{
      c=this.compact(c);
      if(!c||!/[A-Z]/.test(c)||c.length>8)return;
      if(/^(NO|KV|HV|TX|DX|LINE|CIRCUIT|POLE|TOWER|STRUCTURE|NULL|NONE|UNKNOWN)$/.test(c))return;
      if(!seen.has(c)){seen.add(c);out.push(c);}
    };
    // Strip the voltage/circuit class token from the end, e.g. KW-KEM/OLY 91 -> KW-KEM/OLY.
    let stem=src.replace(/\b(?:NO\.?\s*)?[A-Z]?\d{1,3}[A-Z0-9]{0,3}\s*$/i,'').trim();
    // If a structure label was supplied, first reduce it to a line label.
    stem=stem.replace(/\s*[-_]\s*\d{1,6}[A-Z0-9/]*\s*$/,'').trim();
    const m=stem.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)$/i);
    if(m){
      add(m[1]);
      for(const part of String(m[2]||'').split('/'))add(part);
      return out;
    }
    // Fallback for compact/dirty but valid names.
    const formatted=this.formatCircuitName(src);
    if(formatted&&formatted!==src)return this.lineEndpointCodes(formatted);
    const parts=stem.split(/[-\/]+/).map(x=>x.trim()).filter(Boolean);
    for(const part of parts)add(part);
    return out;
  },
  lineEndpointCodeForSide(line,side='start'){
    const codes=this.lineEndpointCodes(line);
    if(!codes.length)return '';
    return side==='end'?codes[codes.length-1]:codes[0];
  },
  _distKm(a,b){
    const alat=Number(a?.lat), alon=Number(a?.lon), blat=Number(b?.lat), blon=Number(b?.lon);
    if(!Number.isFinite(alat)||!Number.isFinite(alon)||!Number.isFinite(blat)||!Number.isFinite(blon))return Infinity;
    const R=6371, dLat=(blat-alat)*Math.PI/180, dLon=(blon-alon)*Math.PI/180, la1=alat*Math.PI/180, la2=blat*Math.PI/180;
    const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  },
  endpointAssetsForGroup(g){
    const arr=(g?.assets||[]).filter(a=>Number.isFinite(Number(a?.lat))&&Number.isFinite(Number(a?.lon))).slice();
    try{arr.sort(this.sortByStructure);}catch(e){}
    const routePts=[];
    for(const r of (g?.routeAssets||[])){
      const coords=Array.isArray(r?.routeCoords)?r.routeCoords:[];
      if(coords.length){
        const first=coords[0], last=coords[coords.length-1];
        if(Array.isArray(first)&&Number.isFinite(Number(first[0]))&&Number.isFinite(Number(first[1])))routePts.push({lat:Number(first[0]),lon:Number(first[1]),routeEndpoint:true});
        if(Array.isArray(last)&&Number.isFinite(Number(last[0]))&&Number.isFinite(Number(last[1])))routePts.push({lat:Number(last[0]),lon:Number(last[1]),routeEndpoint:true});
      }
    }
    if(!arr.length&&routePts.length)return {start:routePts.slice(0,Math.ceil(routePts.length/2)),end:routePts.slice(Math.floor(routePts.length/2))};
    if(!arr.length)return {start:[],end:[]};
    const take=Math.min(12,Math.max(2,Math.ceil(arr.length*0.10)));
    let start=arr.slice(0,take);
    let end=arr.slice(Math.max(0,arr.length-take));
    if(arr.length&&arr.length<=take*2){
      const split=Math.max(1,Math.floor(arr.length/2));
      start=arr.slice(0,split);
      end=arr.slice(split);
    }
    // Keep route geometry endpoints as a supplement because some imports have line shapes
    // but sparse/dirty structure ordering at terminal ends.
    if(routePts.length){start.push(...routePts.slice(0,Math.ceil(routePts.length/2))); end.push(...routePts.slice(Math.floor(routePts.length/2)));}
    return {start,end};
  },
  deriveReferenceCodesFromLineEndpoints(a,maxKm=12){
    const out=[]; const seen=new Set();
    const add=c=>{c=this.compact(c); if(c&&/[A-Z]/.test(c)&&c.length<=8&&!seen.has(c)){seen.add(c);out.push(c);}};
    if(!a||!this.lineMap||!Number.isFinite(Number(a?.lat))||!Number.isFinite(Number(a?.lon)))return out;
    const ref={lat:Number(a.lat),lon:Number(a.lon)};
    const hits=[];
    for(const g of this.lineMap.values()){
      const line=this.formatCircuitName(g?.line||g?.rawLine||'');
      const codes=this.lineEndpointCodes(line);
      if(!line||codes.length<2)continue;
      const ep=this.endpointAssetsForGroup(g);
      const check=(side,code)=>{
        const pts=ep[side]||[];
        let best=Infinity;
        for(const pt of pts){
          const km=this._distKm(ref,pt);
          if(km<best)best=km;
        }
        if(Number.isFinite(best)&&best<=maxKm)hits.push({code,line,km:best,side});
      };
      check('start',codes[0]);
      check('end',codes[codes.length-1]);
      // Multi-terminal lines like KW-KEM/OLY 91: also allow intermediate endpoint codes, but only near either end.
      if(codes.length>2){
        for(const c of codes.slice(1,-1)){
          const best=Math.min(...[...(ep.start||[]),...(ep.end||[])].map(pt=>this._distKm(ref,pt)).filter(Number.isFinite));
          if(Number.isFinite(best)&&best<=maxKm)hits.push({code:c,line,km:best,side:'multi'});
        }
      }
    }
    hits.sort((a,b)=>a.km-b.km||a.code.localeCompare(b.code));
    for(const h of hits.slice(0,8))add(h.code);
    return out;
  },
  enrichReferenceIndexFromLineEndpoints(records=[]){
    const refs=(records||[]).filter(a=>this.isReferencePointAsset(a));
    if(!refs.length||!this.lineMap||!this.lineMap.size)return {updated:0,codes:0};
    let updated=0, codesAdded=0;
    if(!this.referencePointsByCode)this.referencePointsByCode=new Map();
    const add=(code,a)=>{code=this.compact(code); if(!code)return false; if(!this.referencePointsByCode.has(code))this.referencePointsByCode.set(code,[]); const list=this.referencePointsByCode.get(code); if(!list.includes(a)){list.push(a); return true;} return false;};
    for(const a of refs){
      const before=(this.referenceCodeCandidates(a)||[]).length;
      const derived=this.deriveReferenceCodesFromLineEndpoints(a,12);
      if(!derived.length)continue;
      if(!a.derivedAbbreviations)a.derivedAbbreviations=[];
      for(const c of derived){
        if(!a.derivedAbbreviations.some(x=>this.compact(x)===this.compact(c)))a.derivedAbbreviations.push(c);
        if(!a.abbreviation)a.abbreviation=c;
        if(add(c,a))codesAdded++;
      }
      if((this.referenceCodeCandidates(a)||[]).length>before)updated++;
    }
    return {updated,codes:codesAdded};
  },
  rawValue(raw,names){
    raw=raw||{};
    for(const name of names||[]){
      if(raw[name]!==undefined&&raw[name]!==null&&String(raw[name]).trim()!=='')return String(raw[name]).trim();
      const hit=Object.keys(raw).find(k=>String(k).toUpperCase()===String(name).toUpperCase());
      if(hit&&raw[hit]!==undefined&&raw[hit]!==null&&String(raw[hit]).trim()!=='')return String(raw[hit]).trim();
    }
    return '';
  },
  extractLineRefsFromText(text){
    const out=[];
    const src=String(text||'').toUpperCase();
    if(!src)return out;
    // Only accept proper circuit designators containing a number (81, 91, X1, etc).
    // This prevents truncated source text like "KW-KE" + "STEEL" becoming fake lines like "KW-KE STEE".
    const re=/\b([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})*)\s*([A-Z0-9]*\d[A-Z0-9]{0,3})\s*(?:[-–—]\s*([A-Z]{0,3}\d{1,6}[A-Z]{0,3}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?|\d{1,6}[A-Z]{0,4}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?))?/g;
    let m;
    while((m=re.exec(src))){
      const lineRaw=`${m[1]}-${String(m[2]||'').replace(/\s*\/\s*/g,'/')} ${m[3]}`;
      const line=this.formatCircuitName(lineRaw);
      const pole=String(m[4]||'').replace(/\s+/g,'').replace(/\/$/,'');
      if(line&&!out.some(r=>this.compact(r.line)===this.compact(line)&&this.stripZeros(r.pole||'')===this.stripZeros(pole||'')))out.push({line,pole});
    }
    return out;
  },
  lineRefsForAsset(a,includeInferred=true){
    try{this.repairStructureIdentity(a);}catch(e){}
    const raw=a?.raw||{};
    const refs=[];
    const add=(line,pole='')=>{
      line=String(line||'').trim();
      pole=String(pole||'').trim();
      if(!line)return;
      // If a dirty combined field has been stored as the line, parse only valid circuit refs from it.
      const parsed=this.extractLineRefsFromText(line);
      if(parsed.length&&(line.includes(',')||line.length>28||parsed.length>1)){
        for(const r of parsed)add(r.line,r.pole||pole);
        return;
      }
      const formatted=this.formatCircuitName(line);
      // Do not accept fake partial lines that have no numeric circuit designator.
      if(!/\d/.test(this.compact(formatted)))return;
      const key=this.compact(formatted)+'|'+this.stripZeros(pole||'');
      if(!refs.some(r=>this.compact(r.line)+'|'+this.stripZeros(r.pole||'')===key))refs.push({line:formatted,pole});
    };
    add(a?.line||a?.substation||'',a?.poleNumber||'');
    add(this.rawValue(raw,['LINE_NAME','line_name','CIRCUIT','CIRCUIT_NAME','ROUTE_NAME','netwk_name']),this.rawValue(raw,['NAMEPLATE_ID','POLE_NUMBER','POLE_NO']));
    for(let i=1;i<=6;i++)add(this.rawValue(raw,[`LINE_NAME_${i}`,`line_name_${i}`]),this.rawValue(raw,[`NAMEPLATE_ID_${i}`,`nameplate_id_${i}`]));
    const labels=[a?.gisLabel,a?.label,a?.structure,a?.rawStructure,this.rawValue(raw,['STRUCTURE_LABEL','structure_label','trmsn_line_gis_label','TRMSN_LINE_GIS_LABEL'])];
    for(const label of labels){
      const found=this.extractLineRefsFromText(label);
      for(const r of found)add(r.line,r.pole);
    }
    if(includeInferred&&Array.isArray(a?.inferredLineRefs)){
      for(const inf of a.inferredLineRefs||[])add(inf.line,inf.pole||a?.poleNumber||'');
    }
    // Deliberately do NOT scan general searchText here. It contains words like STEEL/POINT/POLE
    // and was creating bogus aliases such as "KW-KE STEE" from truncated source labels.
    return refs.filter(r=>r.line);
  },
  lineRefSourcesForAsset(a){
    const raw=a?.raw||{};
    const out=[];
    const seen=new Set();
    const add=(ref,source,confidence='confirmed')=>{
      const line=this.formatCircuitName(ref?.line||'');
      const pole=String(ref?.pole||'').trim();
      if(!line)return;
      const key=this.compact(line)+'|'+this.stripZeros(pole)+'|'+String(source||'');
      if(seen.has(key))return;
      seen.add(key);
      out.push({line,pole,source,confidence});
    };
    for(let i=1;i<=6;i++){
      const line=this.rawValue(raw,[`LINE_NAME_${i}`,`line_name_${i}`]);
      const pole=this.rawValue(raw,[`NAMEPLATE_ID_${i}`,`nameplate_id_${i}`]);
      if(line)add({line,pole},`confirmed JSON LINE_NAME_${i}`,'confirmed');
    }
    const directLine=this.rawValue(raw,['LINE_NAME','line_name','CIRCUIT','CIRCUIT_NAME','ROUTE_NAME','netwk_name']);
    const directPole=this.rawValue(raw,['NAMEPLATE_ID','POLE_NUMBER','POLE_NO']);
    if(directLine)add({line:directLine,pole:directPole},'confirmed source line field','confirmed');
    for(const field of ['STRUCTURE_LABEL','structure_label','trmsn_line_gis_label','TRMSN_LINE_GIS_LABEL']){
      const val=this.rawValue(raw,[field]);
      for(const r of this.extractLineRefsFromText(val))add(r,field.toUpperCase().includes('GIS')?'confirmed GeoJSON GIS label':'confirmed JSON structure label','confirmed');
    }
    if(Array.isArray(a?.inferredLineRefs)){
      for(const r of a.inferredLineRefs)add(r,r.reason||r.confidence||'inferred by dual-circuit resolver','inferred');
    }
    if(!out.length){
      for(const r of this.lineRefsForAsset(a,true))add(r,'display/parser reference','unknown');
    }
    return out;
  },
  poleNumberValue(pole){
    const parts=this.poleIdParts(pole);
    return parts?parts.num:null;
  },
  poleIdParts(pole){
    const text=String(pole||'').trim().toUpperCase().replace(/\s+/g,'');
    if(!text)return null;
    // Supports branch IDs such as 0065/XY where the spur leg is letters only.
    let letterBranch=text.match(/^0*(\d{1,6})([A-Z]{0,3})\/([A-Z]{1,4})$/i);
    if(letterBranch){
      const num=Number(letterBranch[1]||0);
      const suffix=String(letterBranch[2]||'').toUpperCase();
      const branchPrefix=String(letterBranch[3]||'').toUpperCase();
      if(!Number.isFinite(num))return null;
      let branchSort=0; for(let i=0;i<branchPrefix.length;i++)branchSort+=((branchPrefix.charCodeAt(i)-64)||0)*Math.pow(27,branchPrefix.length-i-1);
      return {num,suffix,branchNum:0,branchPrefix,branchSuffix:'',isBranch:true,rootNum:num,sortNum:num,sortBranch:branchSort||1,norm:String(num)+(suffix||'')+'/'+branchPrefix,raw:text};
    }
    // Supports normal structures (0113A), gantries (G0000 / 0000G), and split-leg
    // structures such as 0280/001 or 0280/G0000.  Split-leg IDs are common on
    // tee/branch legs; they must not collapse into plain 001 or disappear from map dots.
    let m=text.match(/^0*(\d{1,6})([A-Z]{0,3})\/([A-Z]{0,3})0*(\d{1,6})([A-Z]{0,3})$/i);
    if(m){
      const num=Number(m[1]);
      const suffix=String(m[2]||'').toUpperCase();
      const branchPrefix=String(m[3]||'').toUpperCase();
      const branchNum=Number(m[4]);
      const branchSuffix=String(m[5]||'').toUpperCase();
      if(!Number.isFinite(num)||!Number.isFinite(branchNum))return null;
      const branchKey=(branchPrefix||'')+String(branchNum)+(branchSuffix||'');
      return {num,suffix,branchNum,branchPrefix,branchSuffix,isBranch:true,rootNum:num,sortNum:num,sortBranch:branchPrefix==='G'?9999:branchNum,norm:String(num)+(suffix||'')+'/'+branchKey,raw:text};
    }
    m=text.match(/^([A-Z]{1,3})0*(\d{1,6})([A-Z]{0,3})$/i);
    if(m){
      const prefix=String(m[1]||'').toUpperCase();
      const num=Number(m[2]);
      const suffix=(prefix+String(m[3]||'')).toUpperCase();
      if(!Number.isFinite(num))return null;
      return {num,suffix,branchNum:null,branchPrefix:'',branchSuffix:'',isBranch:false,rootNum:num,sortNum:num,sortBranch:0,norm:String(num)+suffix,raw:text};
    }
    m=text.match(/^0*(\d{1,6})([A-Z]{0,3})$/i);
    if(!m)return null;
    const num=Number(m[1]);
    if(!Number.isFinite(num))return null;
    const suffix=String(m[2]||'').toUpperCase();
    return {num,suffix,branchNum:null,branchPrefix:'',branchSuffix:'',isBranch:false,rootNum:num,sortNum:num,sortBranch:0,norm:String(num)+suffix,raw:text};
  },
  poleKey(pole){
    const p=this.poleIdParts(pole);
    if(!p)return this.stripZeros(pole);
    return p.norm;
  },
  parsePoleToken(token){
    const raw=String(token||'').trim().toUpperCase().replace(/\s+/g,'');
    if(!raw)return null;
    const direct=this.poleIdParts(raw);
    if(direct)return direct;
    const text=this.compact(raw);
    if(!text)return null;
    return this.poleIdParts(text);
  },
  poleIdMatches(actual,target){
    const a=this.poleIdParts(actual);
    const t=target&&typeof target==='object'?target:this.parsePoleToken(target);
    if(!a||!t)return false;
    if(Number(a.num)!==Number(t.num))return false;
    if(!!t.isBranch){
      return !!a.isBranch && Number(a.branchNum)===Number(t.branchNum) && String(a.branchPrefix||'')===String(t.branchPrefix||'') && String(a.branchSuffix||'')===String(t.branchSuffix||'') && String(a.suffix||'')===String(t.suffix||'');
    }
    // Plain 113 should include 113, 113A and 113B.  113A must only match 113A.
    if(t.suffix)return !a.isBranch && a.suffix===t.suffix;
    return true;
  },
  poleIdSortValue(pole){
    const p=this.poleIdParts(pole);
    if(!p)return {num:Infinity,suffix:'',norm:'',isBranch:false,sortBranch:0};
    return p;
  },
  extractStructureRefFromLabel(text){
    const src=String(text||'').trim().toUpperCase();
    if(!src)return null;
    const re=/\b([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})*)\s*([A-Z0-9]*\d[A-Z0-9]{0,3})\s*[-–—_ ]\s*([A-Z]{0,3}\d{1,6}[A-Z]{0,3}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?|\d{1,6}[A-Z]{0,4}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?|[A-Z]{1,3}\d{1,6})\b/i;
    const m=src.match(re);
    if(!m)return null;
    const line=this.formatCircuitName(`${m[1]}-${String(m[2]||'').replace(/\s*\/\s*/g,'/')} ${m[3]}`);
    const pole=String(m[4]||'').replace(/\s+/g,'').toUpperCase();
    if(!line||!pole)return null;
    return {line,pole};
  },
  repairStructureIdentity(a){
    if(!a||typeof a!=='object')return false;
    if(this.isConductorSpanAsset(a)||this.isHVCrossingAsset(a)||this.isUtilityAsset(a))return false;
    const kind=String(a.kind||'').toLowerCase();
    const raw=a.raw||{};
    const labels=[a.gisLabel,a.label,a.structure,a.rawStructure,raw.STRUCTURE_LABEL,raw.structure_label,raw.TRMSN_LINE_GIS_LABEL,raw.trmsn_line_gis_label,raw.GIS_LABEL,raw.NAME,raw.name].filter(Boolean);
    let changed=false;
    for(const label of labels){
      const ref=this.extractStructureRefFromLabel(label);
      if(!ref)continue;
      const existingLine=this.formatCircuitName(a.line||'');
      if(ref.line&&(!existingLine||this.compact(existingLine)!==this.compact(ref.line))){a.line=ref.line; changed=true;}
      const current=this.poleIdParts(a.poleNumber||'');
      const wanted=this.poleIdParts(ref.pole||'');
      if(wanted&&(!current || current.num!==wanted.num || current.suffix!==wanted.suffix)){a.poleNumber=ref.pole; changed=true;}
      if(!a.gisLabel){a.gisLabel=String(label||''); changed=true;}
      if(!a.structure){a.structure=String(label||''); changed=true;}
      if(!a.label){a.label=String(label||''); changed=true;}
      if(!kind||kind==='asset'||kind==='json'){a.kind='structure'; changed=true;}
      break;
    }
    if(changed){
      const refs=this.lineRefsForAsset(a,false).map(r=>`${r.line} ${r.pole||''}`).join(' ');
      a.lineAliases=this.lineAliasesForAsset(a);
      a.searchText=[a.searchText,a.line,a.poleNumber,a.gisLabel,a.structure,a.label,refs].filter(Boolean).join(' ').toUpperCase();
    }
    return changed;
  },
  structureMapDotAudit(records=[]){
    const assets=Array.isArray(records)?records:[];
    const audit={checkedAt:new Date().toISOString(),structures:0,withGps:0,withoutGps:0,suffixStructures:0,suffixWithGps:0,suffixWithoutGps:0,suffixParseRisks:0,splitLegStructures:0,splitLegWithGps:0,duplicateGpsGroups:0,duplicateGpsStructures:0,mapReadySuffixDots:0,sequenceGapLines:0,sequenceMissingNumbers:0,samples:{suffixNoGps:[],parseRisk:[],duplicateGps:[],sequenceGaps:[]}};
    const coordGroups=new Map();
    const lineNums=new Map();
    const sample=(arr,val)=>{if(arr.length<8)arr.push(val);};
    for(const a of assets){
      if(!a||typeof a!=='object'||this.isConductorSpanAsset(a)||this.isHVCrossingAsset(a)||this.isUtilityAsset(a))continue;
      const refFromLabel=this.extractStructureRefFromLabel(a.gisLabel||a.label||a.structure||a.rawStructure||'');
      const refs=this.lineRefsForAsset(a,true);
      const pole=String(a.poleNumber||refs[0]?.pole||refFromLabel?.pole||'');
      const parts=this.poleIdParts(pole);
      const isStruct=String(a.kind||'').toLowerCase()==='structure'||refs.length||refFromLabel;
      if(!isStruct)continue;
      if(parts&&(refs[0]?.line||refFromLabel?.line)){
        const lineName=refs[0]?.line||refFromLabel.line;
        const lk=this.compact(lineName);
        if(!lineNums.has(lk))lineNums.set(lk,{line:lineName,nums:new Set()});
        lineNums.get(lk).nums.add(Number(parts.num));
      }
      audit.structures++;
      const hasGps=this.assetHasGps(a);
      if(hasGps)audit.withGps++; else audit.withoutGps++;
      const hasSuffix=!!(parts?.suffix || (refFromLabel&&this.poleIdParts(refFromLabel.pole)?.suffix));
      if(hasSuffix){
        audit.suffixStructures++;
        if(hasGps){audit.suffixWithGps++; audit.mapReadySuffixDots++;} else {audit.suffixWithoutGps++; sample(audit.samples.suffixNoGps,this.displayTitleForAudit?.(a)||a.label||a.gisLabel||`${refs[0]?.line||''} ${pole}`);}
      }
      if(parts?.isBranch){
        audit.splitLegStructures++;
        if(hasGps)audit.splitLegWithGps++;
      }
      if(refFromLabel&&(!parts || parts.num!==this.poleIdParts(refFromLabel.pole)?.num || parts.suffix!==this.poleIdParts(refFromLabel.pole)?.suffix)){
        audit.suffixParseRisks++; sample(audit.samples.parseRisk,`${a.label||a.gisLabel||a.structure||''} stored pole=${a.poleNumber||'blank'}`);
      }
      if(hasGps&&refs.length){
        const lineKey=this.compact(refs[0].line||a.line||'');
        const coord=`${Number(a.lat).toFixed(7)},${Number(a.lon).toFixed(7)}`;
        const key=`${lineKey}|${coord}`;
        if(!coordGroups.has(key))coordGroups.set(key,[]);
        coordGroups.get(key).push(a);
      }
    }
    for(const list of coordGroups.values()){
      if(list.length>1){
        audit.duplicateGpsGroups++;
        audit.duplicateGpsStructures+=list.length;
        sample(audit.samples.duplicateGps,list.map(a=>a.poleNumber||a.label||a.gisLabel).join(', '));
      }
    }
    for(const info of lineNums.values()){
      const nums=Array.from(info.nums).filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
      if(nums.length<2)continue;
      const min=nums[0], max=nums[nums.length-1];
      if(max-min>500)continue; // avoid false audit spam on long/gapped corridors
      const missing=[];
      const has=new Set(nums);
      for(let n=min;n<=max;n++){if(!has.has(n))missing.push(n);}
      if(missing.length){
        audit.sequenceGapLines++;
        audit.sequenceMissingNumbers+=missing.length;
        sample(audit.samples.sequenceGaps,`${info.line}: missing ${missing.slice(0,12).join(', ')}${missing.length>12?'…':''}`);
      }
    }
    this.lastStructureMapAudit=audit;
    return audit;
  },
  formatPoleLike(template,num){
    const text=String(template||'').trim();
    const m=text.match(/(\d{1,6})(?!.*\d)/);
    if(!m)return String(num);
    const width=m[1].length;
    return String(Math.max(0,Math.round(num))).padStart(width,'0');
  },
  assetHasGps(a){return Number.isFinite(Number(a?.lat))&&Number.isFinite(Number(a?.lon));},
  distanceKm(a,b){
    if(!this.assetHasGps(a)||!this.assetHasGps(b))return Infinity;
    const lat1=Number(a.lat), lon1=Number(a.lon), lat2=Number(b.lat), lon2=Number(b.lon);
    const R=6371;
    const dLat=(lat2-lat1)*Math.PI/180;
    const dLon=(lon2-lon1)*Math.PI/180;
    const s1=Math.sin(dLat/2), s2=Math.sin(dLon/2);
    const h=s1*s1+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*s2*s2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  },
  distanceToEvidenceSpanKm(target,before,after){
    if(!this.assetHasGps(target)||!before?.asset||!after?.asset||!this.assetHasGps(before.asset)||!this.assetHasGps(after.asset))return Infinity;
    const lat0=Number(target.lat)*Math.PI/180;
    const kmPerDegLat=111.32;
    const kmPerDegLon=111.32*Math.cos(lat0);
    const x=Number(target.lon)*kmPerDegLon, y=Number(target.lat)*kmPerDegLat;
    const x1=Number(before.asset.lon)*kmPerDegLon, y1=Number(before.asset.lat)*kmPerDegLat;
    const x2=Number(after.asset.lon)*kmPerDegLon, y2=Number(after.asset.lat)*kmPerDegLat;
    const dx=x2-x1, dy=y2-y1;
    const len2=dx*dx+dy*dy;
    if(!len2)return Math.hypot(x-x1,y-y1);
    const t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/len2));
    return Math.hypot(x-(x1+t*dx),y-(y1+t*dy));
  },
  dualEvidencePairs(records){
    const evidence=new Map();
    const addEvidence=(fromLine,fromPole,toLine,toPole,asset)=>{
      fromLine=this.formatCircuitName(fromLine); toLine=this.formatCircuitName(toLine);
      if(!fromLine||!toLine||this.compact(fromLine)===this.compact(toLine))return;
      const fromNum=this.poleNumberValue(fromPole), toNum=this.poleNumberValue(toPole);
      if(fromNum===null||toNum===null)return;
      const fromKey=this.compact(fromLine), toKey=this.compact(toLine);
      if(!evidence.has(fromKey))evidence.set(fromKey,new Map());
      if(!evidence.get(fromKey).has(toKey))evidence.get(fromKey).set(toKey,{line:toLine,pairs:[]});
      evidence.get(fromKey).get(toKey).pairs.push({fromPole:String(fromPole||''),toPole:String(toPole||''),fromNum,toNum,asset});
    };
    for(const asset of records||[]){
      if(!asset||asset.kind==='circuit'||this.isHVCrossingAsset(asset))continue;
      const refs=this.lineRefsForAsset(asset,false).filter(r=>r.line&&r.pole&&this.poleNumberValue(r.pole)!==null);
      const unique=[];
      for(const r of refs){
        const key=this.compact(this.formatCircuitName(r.line))+'|'+this.stripZeros(r.pole);
        if(!unique.some(x=>x.key===key))unique.push({...r,key,line:this.formatCircuitName(r.line)});
      }
      if(unique.length<2)continue;
      for(let i=0;i<unique.length;i++)for(let j=0;j<unique.length;j++)if(i!==j)addEvidence(unique[i].line,unique[i].pole,unique[j].line,unique[j].pole,asset);
    }
    return evidence;
  },
  inferCompanionFromEvidence(line,pole,evidence,targetAsset){
    const lineKey=this.compact(this.formatCircuitName(line));
    const pNum=this.poleNumberValue(pole);
    if(!lineKey||pNum===null||!evidence.has(lineKey)||!this.assetHasGps(targetAsset))return [];
    const out=[];
    const exists=(line,pole,arr)=>arr.some(r=>this.compact(r.line)===this.compact(line)&&this.stripZeros(r.pole||'')===this.stripZeros(pole||''));
    const MAX_EXACT_KM=0.20;       // same structure / same spot only
    const MAX_NEAR_KM=0.45;        // adjacent pole inference must be very close
    const MAX_BRACKET_SPAN_KM=0.75;// bracketed inference must sit on the local span
    const MAX_BRACKET_END_KM=1.25; // and near both confirmed neighbour structures
    for(const candidate of evidence.get(lineKey).values()){
      const pairs=(candidate.pairs||[]).slice().sort((a,b)=>a.fromNum-b.fromNum);
      if(!pairs.length)continue;
      let chosen=null;
      const exacts=pairs.filter(x=>x.fromNum===pNum).sort((a,b)=>this.distanceKm(targetAsset,a.asset)-this.distanceKm(targetAsset,b.asset));
      const exact=exacts[0];
      if(exact&&this.distanceKm(targetAsset,exact.asset)<=MAX_EXACT_KM){
        chosen={line:candidate.line,pole:exact.toPole,confidence:'confirmed-same-position',reason:'Matched a confirmed shared-circuit structure at the same GPS position'};
      }else{
        const before=pairs.filter(x=>x.fromNum<pNum&&Math.abs(x.fromNum-pNum)<=2).sort((a,b)=>b.fromNum-a.fromNum)[0];
        const after=pairs.filter(x=>x.fromNum>pNum&&Math.abs(x.fromNum-pNum)<=2).sort((a,b)=>a.fromNum-b.fromNum)[0];
        if(before&&after){
          const off1=before.toNum-before.fromNum, off2=after.toNum-after.fromNum;
          const spanKm=this.distanceToEvidenceSpanKm(targetAsset,before,after);
          const endKm=Math.max(this.distanceKm(targetAsset,before.asset),this.distanceKm(targetAsset,after.asset));
          if(off1===off2&&spanKm<=MAX_BRACKET_SPAN_KM&&endKm<=MAX_BRACKET_END_KM){
            chosen={line:candidate.line,pole:this.formatPoleLike(before.toPole,pNum+off1),confidence:'inferred-local-bracket',reason:'Inferred from local neighbouring shared-circuit structures within the same map corridor'};
          }
        }
        if(!chosen){
          const near=pairs.filter(x=>Math.abs(x.fromNum-pNum)===1).sort((a,b)=>this.distanceKm(targetAsset,a.asset)-this.distanceKm(targetAsset,b.asset))[0];
          if(near&&this.distanceKm(targetAsset,near.asset)<=MAX_NEAR_KM){
            const off=near.toNum-near.fromNum;
            chosen={line:candidate.line,pole:this.formatPoleLike(near.toPole,pNum+off),confidence:'inferred-local-adjacent',reason:'Inferred from an adjacent confirmed shared-circuit structure within 450 m'};
          }
        }
      }
      if(chosen&&chosen.pole&&this.poleNumberValue(chosen.pole)!==null&&!exists(chosen.line,chosen.pole,out))out.push(chosen);
    }
    return out;
  },
  resolveDualCircuits(records){
    const assets=Array.isArray(records)?records:[];
    for(const a of assets){if(a&&typeof a==='object'&&Array.isArray(a.inferredLineRefs))delete a.inferredLineRefs;}
    // Full neighbour-by-neighbour dual-circuit inference is useful on small test sets,
    // but on full WA structure imports it can dominate startup/index time on a phone.
    // The real bundled structure files already carry LINE_NAME_1..6 confirmed circuit
    // references, so large imports use those confirmed aliases and skip slow inference.
    if(assets.length>25000){
      this.lastDualInferenceCount=0;
      try{Diagnostics?.log?.('Circuit resolver','Large import detected; using confirmed circuit aliases only');}catch(e){}
      return records;
    }
    const evidence=this.dualEvidencePairs(assets);
    let inferredCount=0;
    for(const a of assets){
      if(!a||a.kind==='circuit'||this.isHVCrossingAsset(a))continue;
      const refs=this.lineRefsForAsset(a,false).filter(r=>r.line&&r.pole);
      if(!refs.length)continue;
      const inferred=[];
      for(const r of refs){
        const adds=this.inferCompanionFromEvidence(r.line,r.pole,evidence,a);
        for(const inf of adds){
          const already=refs.some(x=>this.compact(x.line)===this.compact(inf.line)&&this.stripZeros(x.pole||'')===this.stripZeros(inf.pole||''))||inferred.some(x=>this.compact(x.line)===this.compact(inf.line)&&this.stripZeros(x.pole||'')===this.stripZeros(inf.pole||''));
          if(!already)inferred.push(inf);
        }
      }
      if(inferred.length){
        a.inferredLineRefs=inferred;
        const infText=inferred.map(x=>`${x.line} ${x.pole} ${x.confidence||''} ${x.reason||''}`).join(' ');
        a.searchText=[a.searchText,infText].join(' ').toUpperCase();
        a.lineAliases=this.lineAliasesForAsset(a);
        inferredCount+=inferred.length;
      }
    }
    this.lastDualInferenceCount=inferredCount;
    try{Diagnostics?.log?.('Circuit resolver',`Conservative local inference added ${inferredCount} circuit aliases`);}catch(e){}
    return records;
  },
  lineAliasesForAsset(a){
    const refs=this.lineRefsForAsset(a);
    const lines=[];
    for(const r of refs){
      const line=this.formatCircuitName(r.line);
      if(line&&!lines.some(x=>this.compact(x)===this.compact(line)))lines.push(line);
    }
    return lines;
  },
  isConductorSpanAsset(a){
    if(!a)return false;
    if(String(a.kind||'').toLowerCase()==='conductor-span')return true;
    const raw=a.raw||{};
    return !!(raw.CONDUCTOR_ID_DESC&&raw.LINE_NAME&&(raw.FIRST_NAME_PLATE_ID||raw.LAST_NAME_PLATE_ID));
  },
  conductorTextForSection(a){
    const raw=a?.raw||{};
    const bits=[];
    const add=(label,val)=>{val=String(val||'').trim(); if(val&&val!=='null'&&!bits.some(x=>x.value===val))bits.push({label,value:val});};
    add('Conductor',a?.conductor||raw.CONDUCTOR_ID_DESC||raw.CONDUCTOR);
    add('Qty / phase',raw.COND_NO_PHS_QTY||raw.CONDUCTOR_QTY);
    add('Earth conductor 1',raw.EARTH_WIRE_1_ID_DESC);
    add('Earth conductor 2',raw.EARTH_WIRE_2_ID_DESC);
    return bits;
  },
  buildConductorSections(records=[]){
    const sections=[];
    const seen=new Set();
    const specForConductor=(label='')=>{
      try{
        const calc=window.FieldMapSpanWeightCalculator;
        if(calc?.getSpec){const s=calc.getSpec(label); if(s)return s;}
        const specs=window.FieldMapConductorSpecs||{};
        const clean=String(label||'').replace(/\\+/g,'').replace(/\s*,+\s*$/g,'').replace(/\s+/g,' ').replace(/\s*-\s*/g,' - ').trim();
        if(specs[clean])return specs[clean];
        const ck=this.compact(clean);
        for(const [k,v] of Object.entries(specs)){if(this.compact(k)===ck)return v;}
      }catch(e){}
      return null;
    };
    const typeForConductor=(label='')=>{
      const t=String(specForConductor(label)?.type||'').replace(/\s+/g,' ').trim();
      return /^unknown$/i.test(t)?'':t;
    };
    const addSection=(line,fromPole,toPole,bits,asset=null,objectId='',source='imported')=>{
      line=this.formatCircuitName(line||'');
      fromPole=String(fromPole||'').trim();
      toPole=String(toPole||fromPole||'').trim();
      if(!line||!fromPole&&!toPole)return;
      const fromNum=this.poleNumberValue(fromPole), toNum=this.poleNumberValue(toPole);
      if(fromNum===null&&toNum===null)return;
      const cleanBits=[];
      const addBit=(label,val)=>{val=String(val||'').trim(); if(val&&val!=='null'&&!cleanBits.some(x=>this.compact(x.label+'|'+x.value)===this.compact(label+'|'+val)))cleanBits.push({label,value:val});};
      for(const b of bits||[])addBit(b.label,b.value);
      if(!cleanBits.length)return;
      const lo=Math.min(fromNum??toNum,toNum??fromNum), hi=Math.max(fromNum??toNum,toNum??fromNum);
      const primaryConductor=(cleanBits.find(b=>/^conductor$/i.test(String(b.label||'')))?.value)||cleanBits[0]?.value||'';
      const conductorType=typeForConductor(primaryConductor);
      const earth1=(cleanBits.find(b=>/earth (?:wire|conductor) 1/i.test(String(b.label||'')))?.value)||'';
      const earth2=(cleanBits.find(b=>/earth (?:wire|conductor) 2/i.test(String(b.label||'')))?.value)||'';
      const earth1Type=typeForConductor(earth1);
      const earth2Type=typeForConductor(earth2);
      const conductor=cleanBits.map(b=>b.value).join(' · ');
      const key=[this.compact(line),this.poleKey(fromPole),this.poleKey(toPole),this.compact(conductor)].join('|');
      if(seen.has(key))return;
      seen.add(key);
      sections.push({line,lineKey:this.compact(line),fromPole,toPole,fromNum:lo,toNum:hi,conductor,conductorType,earth1,earth2,earth1Type,earth2Type,bits:cleanBits,asset,objectId,source});
    };
    for(const a of records||[]){
      if(!this.isConductorSpanAsset(a))continue;
      const raw=a.raw||{};
      const bits=this.conductorTextForSection(a);
      addSection(a.line||raw.LINE_NAME||raw.LINE_NAME_1||'',a.firstNamePlate||raw.FIRST_NAME_PLATE_ID||raw.FIRST_STRUCTURE||raw.FROM_STRUCTURE||raw.FIRST_POLE||'',a.lastNamePlate||raw.LAST_NAME_PLATE_ID||raw.LAST_STRUCTURE||raw.TO_STRUCTURE||raw.LAST_POLE||'',bits,a,raw.OBJECTID||'', 'imported');
    }
    // Pass54: restore the loaded conductor reference sections as a fallback. The lean pass removed
    // the old span-weight module, but the conductor table is not UI fat — it is data
    // the popup uses when a separate conductor JSON has been loaded.
    const bundled=Array.isArray(window.FieldMapConductorSections)?window.FieldMapConductorSections:[];
    for(let i=0;i<bundled.length;i++){
      const r=bundled[i]||{};
      const bits=[];
      const add=(label,val)=>{val=String(val??'').trim(); if(val)bits.push({label,value:val});};
      add('Conductor',r.conductor);
      add('Qty / phase',r.qtyPerPhase);
      add('Section type',r.sectionType);
      add('Earth conductor 1',r.earth1);
      add('Earth conductor 2',r.earth2);
      addSection(r.line,r.first,r.last,bits,null,`bundled-${i}`,'bundled');
    }
    sections.sort((a,b)=>a.line.localeCompare(b.line)||a.fromNum-b.fromNum||a.toNum-b.toNum);
    return sections;
  },
  linkConductorSections(records=[]){
    const assets=records||[];
    const sections=this.buildConductorSections(assets);
    this.conductorSections=sections;
    this.conductorSectionsByLine=new Map();
    for(const sec of sections){
      if(!this.conductorSectionsByLine.has(sec.lineKey))this.conductorSectionsByLine.set(sec.lineKey,[]);
      this.conductorSectionsByLine.get(sec.lineKey).push(sec);
    }
    // Do not stamp conductor arrays onto every structure during indexing. On the full
    // WA bundle that adds tens of thousands of duplicated objects and makes Android
    // garbage-collect heavily. Popups/details resolve span matches on demand below.
    return {sections:sections.length,linked:0};
  },
  conductorLinksForAsset(a){
    if(!a||typeof a!=='object'||this.isConductorSpanAsset(a)||this.isHVCrossingAsset(a)||this.isUtilityAsset(a))return [];
    if((!this.conductorSectionsByLine||!this.conductorSectionsByLine.size)&&(Array.isArray(App.assets)||Array.isArray(window.FieldMapConductorSections))){
      try{this.linkConductorSections(App.assets||[]);}catch(e){}
    }
    const byLine=this.conductorSectionsByLine||new Map();
    const refs=this.lineRefsForAsset(a,true);
    const found=[];
    for(const r of refs){
      const lineKey=this.compact(this.formatCircuitName(r.line));
      const poleNum=this.poleNumberValue(r.pole||a.poleNumber||a.structure||a.label);
      if(!lineKey||poleNum===null)continue;
      const list=byLine.get(lineKey)||[];
      for(const sec of list){
        const fromG=/G/i.test(String(sec.fromPole||''));
        const toG=/G/i.test(String(sec.toPole||''));
        const gantryEndpointSpan=(fromG!==toG)&&Math.abs(Number(sec.toNum)-Number(sec.fromNum))>5;
        const inSpan=gantryEndpointSpan
          ? (poleNum===sec.fromNum||poleNum===sec.toNum)
          : (poleNum>=sec.fromNum&&poleNum<=sec.toNum);
        if(inSpan){
          const key=`${sec.lineKey}|${sec.fromNum}|${sec.toNum}|${sec.conductor}`;
          if(!found.some(x=>x.key===key))found.push({key,line:sec.line,fromPole:sec.fromPole,toPole:sec.toPole,conductor:sec.conductor,bits:sec.bits||[],objectId:sec.objectId});
        }
      }
    }
    return found;
  },
  conductorsForLine(line,assets=[]){
    const lineKey=this.compact(this.formatCircuitName(line)||line);
    const vals=[];
    const add=v=>{v=String(v||'').trim(); if(v&&!vals.some(x=>this.compact(x)===this.compact(v)))vals.push(v);};
    if((!this.conductorSectionsByLine||!this.conductorSectionsByLine.size)&&(Array.isArray(App.assets)||Array.isArray(window.FieldMapConductorSections))){
      try{this.linkConductorSections(App.assets||[]);}catch(e){}
    }
    const list=(this.conductorSectionsByLine&&this.conductorSectionsByLine.get(lineKey))||this.conductorSections||[];
    for(const sec of list||[]){
      if(sec.lineKey!==lineKey)continue;
      for(const b of sec.bits||[]){
        if(/^qty/i.test(String(b.label||'')))continue;
        add(b.value);
      }
    }
    return vals;
  },
  isReferencePointAsset(a){
    if(!a||typeof a!=='object')return false;
    const kind=String(a.kind||'').toLowerCase();
    const raw=a.raw||{};
    if(kind==='substation'||kind==='depot'||kind==='terminal')return true;
    const text=[kind,a.category,a.type,raw.TYPE,raw.type,raw.ASSET_TYPE,raw.asset_type,raw.FEATURE_TYPE,raw.feature_type,a.label,a.substation,a.terminal,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.DEPOT_NAME,raw.SEARCH_FIELD,raw.ABBREVIATION,raw.abbreviation,raw.ABBR,raw.CODE,raw.SITE_CODE,raw.STATION_CODE,raw.SUBSTATION_CODE,raw.TERMINAL_CODE].join(' ').toUpperCase();
    return /SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|ZONE SUB|\bZONE\b|DEPOT|\bTER\b|\bSUB\b/.test(text);
  },
  referenceKind(a){
    const raw=a?.raw||{};
    const text=[a?.kind,a?.category,a?.type,raw.TYPE,raw.type,raw.ASSET_TYPE,raw.asset_type,raw.DEPOT,raw.DEPOT_NAME,raw.SUBSTATION_TYPE,raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,a?.label].join(' ').toUpperCase();
    if(/DEPOT/.test(text))return 'depot';
    if(/TERMINAL|\bTER\b/.test(text))return 'terminal';
    return 'substation';
  },
  referenceName(a){
    const raw=a?.raw||{};
    const v=this.cleanText(raw.SUBSTATION||raw.SUBSTATION_NAME||raw.SUBSTN_NAME||raw.STATION_NAME||raw.TERMINAL||raw.TERMINAL_NAME||raw.DEPOT_NAME||raw.SEARCH_FIELD||a?.substation||a?.terminal||a?.label||'');
    return String(v||'').replace(/\s*[\(\[]\s*[A-Z0-9]{1,10}\s*[\)\]]\s*$/,'').trim();
  },
  referenceCodeCandidates(a){
    const raw=a?.raw||{};
    const vals=[];
    const seen=new Set();
    const bad=/^(SUB|SUBS|SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|DEPOT|ZONE|SWITCHYARD|WESTERN|POWER|TRANSMISSION|DISTRIBUTION|PUBLIC|SECURE|POINT|POLE|TOWER|STRUCTURE|ASSET|UNKNOWN|NULL|NONE|NIL|NA|GPS|LAT|LONG|INAL)$/i;
    const kind=this.referenceKind(a);
    const push=(cand,explicit=false)=>{
      cand=String(cand??'').trim().toUpperCase();
      if(!cand)return;
      cand=this.compact(cand);
      if(!cand||bad.test(cand)||!/^[A-Z0-9]+$/.test(cand)||!/[A-Z]/.test(cand))return;
      if(cand.length>8)return;
      if(cand.length<2&&!explicit)return;
      // Most transmission endpoint abbreviations are 1-4 letters. Allow longer only from explicit source fields.
      if(cand.length>4&&!explicit)return;
      if(!seen.has(cand)){seen.add(cand);vals.push(cand);}
    };
    const add=(value,explicit=false)=>{
      const text=String(value??'').trim();
      if(!text)return;
      for(const part0 of text.split(/[;,|]+/)){
        const part=String(part0||'').trim();
        if(!part)continue;
        let m;
        const paren=/[\(\[]\s*([A-Z0-9]{1,8}(?:\s*[-\/]\s*[A-Z0-9]{1,4})?)\s*[\)\]]/gi;
        while((m=paren.exec(part)))push(m[1],true);
        m=part.match(/^\s*([A-Z0-9]{1,8})\s*[-–—:]\s+/i); if(m)push(m[1],true);
        m=part.match(/\s+[-–—:]\s*([A-Z0-9]{1,8})\s*$/i); if(m)push(m[1],true);
        // Names such as "A Terminal" or "OP Terminal" need the leading code.
        m=part.match(/^\s*([A-Z0-9]{1,4})\s+(?:TERMINAL|TERM|SUBSTATION|SUBSTN|SWITCHYARD|ZONE\s+SUB)\b/i); if(m)push(m[1],true);
        // Explicit fields can contain plain code tokens.
        if(explicit){
          for(const t of part.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))push(t,true);
        }else{
          for(const t of part.toUpperCase().match(/\b[A-Z0-9]{2,6}\b/g)||[])push(t,false);
        }
      }
    };
    const explicitKeys=['ABBREVIATION','abbreviation','ABBREV','abbrev','ABBR','abbr','ACRONYM','acronym','SHORT_NAME','short_name','SHORTCODE','shortcode','CODE','code','SITE_CODE','site_code','STATION_CODE','station_code','STN_CODE','stn_code','SUBSTATION_CODE','substation_code','SUBSTN_CODE','substn_code','SUB_CODE','sub_code','TERMINAL_CODE','terminal_code','TER_CODE','ter_code','TERMINAL_ABBR','terminal_abbr','SUBSTATION_ABBR','substation_abbr'];
    for(const k of explicitKeys)add(raw[k],true);
    for(const [k,v] of Object.entries(raw)){
      if(/ABBR|ABBREV|ACRONYM|SHORT|\bCODE\b|SITE|STN|SUBSTN|SUBSTATION_CODE|TERMINAL_CODE|TER_CODE/i.test(k))add(v,true);
    }
    add(a?.abbreviation,true); add(a?.abbr,true); add(a?.code,true); add(a?.stationCode,true); add(a?.substationCode,true); add(a?.terminalCode,true);
    if(Array.isArray(a?.derivedAbbreviations)){for(const c of a.derivedAbbreviations)add(c,true);}
    const textFields=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.NAME,raw.TITLE,raw.TERMINAL,raw.TERMINAL_NAME,a?.substation,a?.terminal,a?.label].filter(Boolean);
    for(const t of textFields)add(t,false);
    // If the official name has a single-letter code in brackets, keep it. This covers sites like "Kalamunda (K)".
    for(const t of textFields){
      const m=String(t).match(/[\(\[]\s*([A-Z0-9])\s*[\)\]]/i);
      if(m)push(m[1],true);
    }
    // Imported reference files often hide abbreviations in free text only, such as
    // "Byford Substation BYF", "Terminal OP", or "Byford / BYF". Extract
    // those patterns generically without hard-coding any substations/terminals.
    for(const t0 of textFields){
      const t=String(t0||'').trim();
      let m;
      m=t.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\s*[-–—:\/]?\s*([A-Z0-9]{1,5})\s*$/i); if(m)push(m[1],true);
      m=t.match(/(?:^|[\s,;|])([A-Z0-9]{1,4})\s*[-–—:\/]?\s*(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b/i); if(m)push(m[1],true);
      m=t.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b.*?\b([A-Z0-9]{1,5})\s*$/i); if(m)push(m[1],true);
      m=t.match(/(?:^|[\s,;|])([A-Z0-9]{1,5})\s*$/); if(m&&/(SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)/i.test(t))push(m[1],true);
    }
    // For terminals, leading single-letter names are valid circuit endpoints.
    if(kind==='terminal'){
      for(const t of textFields){
        const m=String(t).trim().match(/^([A-Z0-9])(?:\s|$|[-–—:])/i);
        if(m)push(m[1],true);
      }
    }
    return vals;
  },
  referenceCode(a){
    const codes=this.referenceCodeCandidates(a);
    return codes[0]||'';
  },
  buildReferenceIndex(records=[]){
    const byCode=new Map(), points=[];
    const add=(code,a)=>{code=this.compact(code); if(!code)return; if(!byCode.has(code))byCode.set(code,[]); if(!byCode.get(code).includes(a))byCode.get(code).push(a);};
    for(const a of records||[]){
      if(!this.isReferencePointAsset(a))continue;
      points.push(a);
      let codes=this.referenceCodeCandidates(a);
      if((!codes||!codes.length)&&this.lineMap&&this.lineMap.size&&this.referenceKind(a)!=='depot'){
        const derived=this.deriveReferenceCodesFromLineEndpoints(a,12);
        if(derived.length){a.derivedAbbreviations=Array.from(new Set([...(a.derivedAbbreviations||[]),...derived])); codes=this.referenceCodeCandidates(a);}
      }
      if(codes.length){
        a.abbreviation=a.abbreviation||codes[0];
        for(const c of codes)add(c,a);
      }else if(this.referenceKind(a)==='depot'){
        add(this.referenceName(a),a);
      }
    }
    this.referencePointsByCode=byCode;
    this.referencePoints=points;
    return {points:points.length,codes:byCode.size};
  },
  linkedReferencePointsForLine(line){
    const codes=this.lineEndpointCodes(line);
    const out=[], seen=new Set();
    for(const code of codes){
      const list=(this.referencePointsByCode&&this.referencePointsByCode.get(code))||[];
      for(const a of list){
        const key=(a.id||'')+'|'+code; if(seen.has(key))continue; seen.add(key);
        out.push({code,name:this.referenceName(a),kind:this.referenceKind(a),asset:a,lat:a.lat,lon:a.lon});
      }
    }
    return out;
  },
  referenceTextForLine(line){
    const refs=this.linkedReferencePointsForLine(line);
    if(!refs.length)return 'No substation/terminal abbreviation match loaded';
    return refs.map(r=>`${r.code} ${r.name}${r.kind&&r.kind!=='substation'?` (${r.kind})`:''}`).join(' · ');
  },
  nearestDepotsForLine(line,limit=2){
    const assets=(this.lineAssets?.(line)||[]).filter(a=>Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)));
    const depots=(this.referencePoints||[]).filter(a=>this.referenceKind(a)==='depot'&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)));
    if(!assets.length||!depots.length)return [];
    const scored=[];
    for(const d of depots){
      let best=Infinity;
      for(const a of assets){
        const km=this.distanceKm(a,d); if(km<best)best=km;
      }
      if(Number.isFinite(best))scored.push({asset:d,name:this.referenceName(d),km:best});
    }
    return scored.sort((a,b)=>a.km-b.km).slice(0,limit);
  },
  bestLineFromAsset(a){
    const lines=this.lineAliasesForAsset(a);
    if(lines.length)return lines[0];
    const raw=a?.raw||{};
    const gis=String(a?.gisLabel||window.ImportEngine?.deriveGisLabel?.(raw)||'').trim();
    if(gis&&window.ImportEngine?.splitGisLabel){
      const parts=ImportEngine.splitGisLabel(gis);
      if(parts.line)return this.formatCircuitName(parts.line);
    }
    return this.formatCircuitName(a?.line||a?.substation||'');
  },
  lightRepairAssets(records){
    return (records||[]).map(a=>{
      if(!a||typeof a!=='object')return a;
      try{
        const gis=String(a.gisLabel||'').trim();
        if(!gis||!window.ImportEngine?.splitGisLabel)return a;
        const parts=ImportEngine.splitGisLabel(gis);
        const fixed={...a,gisLabel:gis};
        if(parts.line)fixed.line=this.formatCircuitName(parts.line);
        if(parts.poleNumber)fixed.poleNumber=parts.poleNumber;
        if(a.sourceType==='geojson'||a.kind==='structure'||a.kind==='dx-pole'){
          fixed.structure=gis;
          fixed.label=gis;
        }
        return fixed;
      }catch(e){return a;}
    });
  },
  displayIdForKey(a){
    const gis=String(a?.gisLabel||a?.label||'').trim();
    const pole=String(a?.poleNumber||'').trim();
    const line=String(a?.line||a?.substation||'').trim();
    if(line&&pole)return `P${this.poleKey(pole)}`;
    const gm=gis.match(/^(.+?)[\s_-]+(\d{1,6}[A-Z]{0,3}(?:\/[A-Z]{0,3}\d{0,6}[A-Z]{0,3})?|[A-Z]{1,3}\d{1,6})$/);
    if(line&&gm)return `P${this.poleKey(gm[2])}`;
    if(gis){const c=this.compact(gis); if(c)return `GIS${this.stripZeros(c)}`;}
    const rawStructure=String(a?.rawStructure||'').trim();
    const structure=String(a?.structure||'').trim();
    const label=String(a?.label||'').trim();
    const equip=String(a?.equip||'').trim();
    const strongId=rawStructure||structure||equip||label;
    if(strongId)return this.compact(strongId);
    // Last fallback is the generated per-record ID. Do NOT let GPS alone collapse thousands of assets.
    if(a?.id)return `GEN${this.compact(a.id)}`;
    return '';
  },
  keyFor(a){
    const line=this.compact(this.formatCircuitName(a?.line||a?.substation||''));
    const id=this.displayIdForKey(a);
    if(line&&id)return `${line}|${id}`;
    if(id)return `ID|${id}`;
    // GPS is deliberately NOT the primary key. It is too weak for large GeoJSON datasets.
    // Multiple poles/assets can share rounded coordinates, and the old GPS key could collapse
    // a 400MB file down to a few hundred records.
    return `SRC|${a?.id||Math.random()}`;
  },
  hasJson(a){return a?.sourceType==='json'||Array.isArray(a?.sources)&&a.sources.includes('json');},
  sourceList(a){return Array.from(new Set([...(a?.sources||[]),a?.sourceType].filter(Boolean).filter(x=>x!=='merged')));},
  fileList(a){return Array.from(new Set([...(a?.sourceFiles||[]),a?.sourceFile].filter(Boolean)));},
  coordKeyFor(a,precision=5){return Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)?`GPS${precision}|${Number(a.lat).toFixed(precision)},${Number(a.lon).toFixed(precision)}`:'';},
  keyAliases(a){
    const keys=[]; const add=k=>{if(k&&!keys.includes(k))keys.push(k);};
    const refs=this.lineRefsForAsset(a);
    const line=this.compact(this.formatCircuitName(a?.line||a?.substation||''));
    const pole=String(a?.poleNumber||'').trim();
    const gis=String(a?.gisLabel||a?.label||'').trim();
    // Conductor spans are not structures. Keep their merge namespace isolated so
    // a span ending at pole 0022 cannot swallow the actual pole/tower 0022 record.
    if(this.isConductorSpanAsset(a)){
      const raw=a?.raw||{};
      const from=this.stripZeros(a?.firstNamePlate||raw.FIRST_NAME_PLATE_ID||'');
      const to=this.stripZeros(a?.lastNamePlate||raw.LAST_NAME_PLATE_ID||'');
      const obj=this.compact(raw.OBJECTID||a?.id||'');
      if(line&&from&&to)add(`COND|${line}|${from}|${to}|${obj}`);
      else add(`COND|${a?.id||Math.random()}`);
      return keys;
    }
    add(this.keyFor(a));
    if(line&&pole)add(`${line}|P${this.poleKey(pole)}`);
    for(const r of refs){
      const l=this.compact(r.line);
      if(l&&r.pole)add(`${l}|P${this.poleKey(r.pole)}`);
    }
    const gm=gis.match(/^(.+?)[\s_-]+(\d{1,6}[A-Z]{0,3}(?:\/[A-Z]{0,3}\d{0,6}[A-Z]{0,3})?|[A-Z]{1,3}\d{1,6})$/);
    if(line&&gm)add(`${line}|P${this.poleKey(gm[2])}`);
    if(gis){
      const c=this.compact(gis);
      if(c)add(`GIS|${this.stripZeros(c)}`);
    }
    // Intentionally no GPS-only aliases here. GPS-only dedupe was causing large map file
    // imports to lose records. Primary/map records still merge properly when they share labels,
    // line + pole numbers, structure labels or asset IDs.
    return keys;
  },
  mergePair(existing,rec){
    const existingJson=this.hasJson(existing), recJson=this.hasJson(rec);
    const existingRecovery=!!(existing?.publicRecovery||existing?.sourceQuality==='public-recovery-real-gps'||existing?.raw?.PUBLIC_RECOVERY);
    const recRecovery=!!(rec?.publicRecovery||rec?.sourceQuality==='public-recovery-real-gps'||rec?.raw?.PUBLIC_RECOVERY);
    const jsonWins=recJson&&!existingJson;
    // Public recovery imports are for filling missing GPS/dots. Do not let the lean
    // public row overwrite richer user/imported structure details unless the existing
    // row is also recovery-only.
    const recoveryShouldNotWin=recRecovery&&!existingRecovery;
    const base=recoveryShouldNotWin?existing:(jsonWins?rec:existing);
    const other=recoveryShouldNotWin?rec:(jsonWins?existing:rec);
    const sources=Array.from(new Set([...this.sourceList(existing),...this.sourceList(rec)].filter(Boolean)));
    const sourceFiles=Array.from(new Set([...this.fileList(existing),...this.fileList(rec)].filter(Boolean)));
    const merged={...other,...base,raw:{...(other.raw||{}),...(base.raw||{})},sources,sourceFiles};
    if(!Number.isFinite(merged.lat)&&Number.isFinite(other.lat))merged.lat=other.lat;
    if(!Number.isFinite(merged.lon)&&Number.isFinite(other.lon))merged.lon=other.lon;
    if((recRecovery||existingRecovery)&&Number.isFinite(other.lat)&&Number.isFinite(other.lon)){
      if(!Number.isFinite(base.lat)||!Number.isFinite(base.lon)){merged.lat=other.lat; merged.lon=other.lon;}
      merged.publicRecovery=!!(existingRecovery||recRecovery);
      merged.sourceQuality=merged.sourceQuality||'public-recovery-real-gps';
    }
    merged.routeCoords=base.routeCoords||other.routeCoords;
    merged.gisLabel=base.gisLabel||other.gisLabel;
    merged.poleNumber=base.poleNumber||other.poleNumber;
    merged.rawStructure=base.rawStructure||other.rawStructure;
    if(merged.gisLabel&&window.ImportEngine?.splitGisLabel){
      const p=ImportEngine.splitGisLabel(merged.gisLabel);
      if(p.line)merged.line=this.formatCircuitName(p.line);
      if(p.poleNumber)merged.poleNumber=p.poleNumber;
      if(base.sourceType==='geojson'||merged.kind==='structure'||merged.kind==='dx-pole'){merged.label=merged.gisLabel; merged.structure=merged.gisLabel;}
    }
    merged.sourceType=sources.includes('json')&&sources.includes('geojson')?'merged':(sources[0]||base.sourceType);
    const allRefs=this.lineRefsForAsset(merged).map(r=>`${r.line} ${r.pole||''}`).join(' ');
    merged.lineAliases=this.lineAliasesForAsset(merged);
    merged.searchText=[existing.searchText,rec.searchText,Object.values(merged.raw||{}).join(' '),merged.gisLabel,merged.poleNumber,merged.line,merged.structure,merged.label,allRefs].join(' ').toUpperCase();
    return merged;
  },
  mergeAssets(records){
    const out=[]; const aliasToIndex=new Map();
    const addAliases=(asset,idx)=>{for(const k of this.keyAliases(asset))aliasToIndex.set(k,idx);};
    for(const rec0 of records||[]){
      if(!rec0||typeof rec0!=='object')continue;
      const rec={...rec0,sources:this.sourceList(rec0),sourceFiles:this.fileList(rec0)};
      const aliases=this.keyAliases(rec);
      const hit=aliases.find(k=>aliasToIndex.has(k));
      if(hit===undefined){const idx=out.length; out.push(rec); addAliases(rec,idx); continue;}
      const idx=aliasToIndex.get(hit);
      const merged=this.mergePair(out[idx],rec);
      out[idx]=merged;
      addAliases(merged,idx);
      for(const k of aliases)aliasToIndex.set(k,idx);
    }
    return out;
  },
  mergeInto(baseRecords,incomingRecords){
    const out=Array.isArray(baseRecords)?baseRecords.slice():[];
    const aliasToIndex=new Map();
    const addAliases=(asset,idx)=>{for(const k of this.keyAliases(asset))aliasToIndex.set(k,idx);};
    for(let i=0;i<out.length;i++){
      const a=out[i];
      if(!a||typeof a!=='object')continue;
      out[i]={...a,sources:this.sourceList(a),sourceFiles:this.fileList(a)};
      addAliases(out[i],i);
    }
    for(const rec0 of incomingRecords||[]){
      if(!rec0||typeof rec0!=='object')continue;
      const rec={...rec0,sources:this.sourceList(rec0),sourceFiles:this.fileList(rec0)};
      const aliases=this.keyAliases(rec);
      const hit=aliases.find(k=>aliasToIndex.has(k));
      if(hit===undefined){const idx=out.length; out.push(rec); addAliases(rec,idx); continue;}
      const idx=aliasToIndex.get(hit);
      const merged=this.mergePair(out[idx],rec);
      out[idx]=merged;
      addAliases(merged,idx);
      for(const k of aliases)aliasToIndex.set(k,idx);
    }
    return out;
  },
  assetIdentityKey(a){
    if(!a||typeof a!=='object')return '';
    const raw=a.raw||{};
    const kind=String(a.kind||'asset').toLowerCase();
    const refs=this.lineRefsForAsset?.(a,true)||[];
    for(const r of refs){
      const line=this.compact(this.formatCircuitName(r.line||''));
      const pole=this.poleKey(r.pole||a.poleNumber||'');
      if(line&&pole)return `${kind}|${line}|P${pole}`;
    }
    const line=this.compact(this.formatCircuitName(a.line||a.substation||''));
    const pole=this.poleKey(a.poleNumber||'');
    if(line&&pole)return `${kind}|${line}|P${pole}`;
    const gis=this.compact(a.gisLabel||a.label||a.structure||'');
    if(gis&&gis.length>=4&&kind!=='transformer')return `${kind}|GIS|${this.stripZeros(gis)}`;
    if(kind==='transformer'){
      const name=this.compact(a.label||a.equip||a.address||this.rawValue(raw,['NAME','Name','EQUIP_NAME','equip_name','TRANSFORMER','TX','ADDRESS','ROAD_NAME','STREET_NAME'])||'');
      const cat=this.compact(a.category||this.rawValue(raw,['TYPE','Feature Type','ASSET_TYPE','asset_type','KVA','RATING_KVA'])||'');
      if(Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)))return `${kind}|GPS|${Number(a.lat).toFixed(6)},${Number(a.lon).toFixed(6)}|${cat||name}`;
      if(gis&&gis.length>=4)return `${kind}|GIS|${this.stripZeros(gis)}`;
      const equip=this.rawValue(raw,['EQUIP_NO','Equipment No','EQUIPMENT_NO','ELLIPSE_PLNT_NO','Ellipse Plant No','ASSET_ID','asset_id','PICK_ID','pick_id','GLOBALID','GLOBAL_ID','OBJECTID','OBJECT_ID','ID','id'])||a.equip||'';
      const ce=this.compact(equip);
      if(ce&&ce.length>=3)return `${kind}|EQUIP|${ce}`;
      if(name&&cat)return `${kind}|${name}|${cat}`;
    }
    const equip=this.rawValue(raw,['EQUIP_NO','Equipment No','EQUIPMENT_NO','ELLIPSE_PLNT_NO','Ellipse Plant No','ASSET_ID','asset_id','PICK_ID','pick_id','GLOBALID','GLOBAL_ID','OBJECTID','OBJECT_ID','ID','id'])||a.equip||'';
    const ce=this.compact(equip);
    if(ce&&ce.length>=3)return `${kind}|EQUIP|${ce}`;
    if((kind==='streetlight'||kind==='dx-pole')&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))){
      return `${kind}|GPS|${Number(a.lat).toFixed(6)},${Number(a.lon).toFixed(6)}`;
    }
    return '';
  },
  assetStableId(a,idx=0){
    return String(this.assetIdentityKey(a)||a?.id||a?.asset_id||a?.label||a?.gisLabel||a?.structure||a?.equip||a?.line||('asset_'+idx));
  },
  resultDedupKey(r){
    if(!r)return '';
    if(r.type==='circuit')return `c:${this.compact(r.line||'')}`;
    const a=r.asset||{};
    const kind=String(a.kind||'').toLowerCase();
    if(kind==='transformer'){
      const raw=a.raw||{};
      const name=this.compact(a.label||a.structure||a.equip||a.address||this.rawValue(raw,['NAME','Name','EQUIP_NAME','equip_name','TRANSFORMER','TX','ADDRESS','ROAD_NAME','STREET_NAME'])||'');
      const kva=this.compact(this.rawValue(raw,['KVA','RATING_KVA','RATING','CAPACITY','CAPACITY_KVA'])||a.category||'');
      if(Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))){
        const gps=`${Number(a.lat).toFixed(5)},${Number(a.lon).toFixed(5)}`;
        return `a:transformer|gps|${gps}|${name||kva}`;
      }
      const equip=this.rawValue(raw,['EQUIP_NO','Equipment No','EQUIPMENT_NO','ELLIPSE_PLNT_NO','Ellipse Plant No','ASSET_ID','asset_id','PICK_ID','pick_id','GLOBALID','GLOBAL_ID','OBJECTID','OBJECT_ID','ID','id'])||a.equip||'';
      const ce=this.compact(equip);
      if(ce&&ce.length>=3)return `a:transformer|equip|${ce}`;
      if(name&&kva)return `a:transformer|name|${name}|${kva}`;
    }
    return `a:${this.assetIdentityKey(a)||a.id||this.assetStableId(a)}`;
  },
  addIndexToken(token,asset){
    token=this.compact(token);
    if(!token||token.length<2)return;
    if(!this.tokenIndex.has(token))this.tokenIndex.set(token,new Set());
    this.tokenIndex.get(token).add(asset);
  },
  importantRawText(raw={}){
    const keep=/^(LINE_NAME(?:_\d+)?|NAMEPLATE_ID(?:_\d+)?|TRMSN_LINE_GIS_LABEL|STRUCTURE_LABEL|STRUCTURE_ID|POLE_NUMBER|POLE_NO|POLE_LEN_M|POLE_HEIGHT_M|EQUIP_NAME|EQUIP_NO|PICK_ID|SUBSTATION|DEPOT_NAME|ABBREVIATION|SEARCH_FIELD|AER_NSP|SUBSTATION_TYPE|STRUC_TYP_DESC|EQUIP_GRP_ID_DESC|MATRL_TYP_DESC|CONDUCTOR_ID_DESC|COND_NO_PHS_QTY|EARTH_WIRE_1_ID_DESC|EARTH_WIRE_2_ID_DESC|FIRST_NAME_PLATE_ID|LAST_NAME_PLATE_ID|KV|VOLTAGE|NETWK_NAME|COMMON_USAGE_NAME|ROAD_NAME|ROAD|STREET|STREET_NAME|STREET_TYPE|ADDRESS|ADDRESS_FULL|SITE_ADDRESS|LOCATION|SUBURB|LOCALITY|TOWN|PLACE_NAME)$/i;
    const vals=[];
    for(const [k,v] of Object.entries(raw||{})){
      if(!keep.test(String(k||'')))continue;
      const text=String(v??'').trim();
      if(!text||text.length>180)continue;
      // Avoid creating thousands of useless one-off numeric/GPS/ObjectID tokens.
      if(/^(OBJECTID|ID)$/i.test(String(k||'')))continue;
      vals.push(text);
    }
    return vals.join(' ');
  },
  buildSearchDoc(a){
    if(!a||typeof a!=='object')return {asset:a,compactFields:[],searchCompact:'',tokens:[]};
    if(!this.docCache||typeof this.docCache.get!=='function')this.docCache=new WeakMap();
    const cached=this.docCache.get(a);
    if(cached)return cached;
    const refs=this.lineRefsForAsset(a,true);
    const aliasText=[...(a.lineAliases||[]),...refs.map(r=>`${r.line} ${r.pole||''}`)].join(' ');
    const rawValues=this.importantRawText(a?.raw||{});
    const conductorText=[a?.conductor,a?.linkedConductor,...((a?.conductorLinks||[]).map(l=>`${l.line} ${l.fromPole}-${l.toPole} ${l.conductor}`)),a?.firstNamePlate,a?.lastNamePlate].join(' ');
    const visibleFields=[a?.label,a?.gisLabel,a?.poleNumber,a?.line,a?.structure,a?.rawStructure,a?.equip,a?.substation,a?.address,a?.category,a?.kind,aliasText,conductorText,rawValues].filter(Boolean);
    const compactFields=visibleFields.map(x=>this.compact(x)).filter(Boolean);
    const searchCompact=this.compact([rawValues,aliasText,...visibleFields].join(' '));
    const tokenSeed=[...visibleFields,...refs.flatMap(r=>[r.line,r.pole,`${r.line}-${r.pole||''}`,`${r.line} ${r.pole||''}`])].join(' ');
    const tokens=new Set();
    const addToken=(v)=>{
      const c=this.compact(v);
      if(!c||c.length<2||c.length>80)return;
      tokens.add(c);
      const z=this.stripZeros(c); if(z&&z.length>=2&&z.length<=80)tokens.add(z);
    };
    const addWords=(v)=>{for(const w of this.words(v)){if(w.length>=2&&w.length<=32)addToken(w);}};
    for(const r of refs){
      const fl=this.formatCircuitName(r.line||'');
      addToken(fl); addWords(fl);
      if(r.pole){
        addToken(r.pole); addToken(`${fl} ${r.pole}`); addToken(`${fl}-${r.pole}`);
        const pp=this.poleIdParts(r.pole);
        if(pp){
          addToken(pp.norm);
          addToken(`${fl}${pp.norm}`);
          addToken(`${this.compact(fl)}${pp.norm}`);
        }
      }
    }
    for(const v of [a?.line,a?.gisLabel,a?.structure,a?.label,a?.substation,a?.equip]){
      const c=this.compact(v); if(c&&c.length<=60)addToken(c);
    }
    addToken(a?.poleNumber||'');
    const refInitials=String(a?.raw?.DEPOT_NAME||a?.raw?.SUBSTATION||a?.substation||a?.label||'').split(/\s+/).filter(Boolean).map(x=>x[0]).join('');
    addToken(refInitials);
    addWords([a?.substation,a?.address,a?.raw?.DEPOT_NAME,a?.raw?.ABBREVIATION,a?.raw?.SEARCH_FIELD,a?.raw?.ROAD_NAME,a?.raw?.STREET_NAME,a?.raw?.ADDRESS,a?.raw?.ADDRESS_FULL,a?.raw?.EQUIP_NAME,a?.raw?.equip_name,a?.category,a?.material].join(' '));
    // Pass 25: add searchable equipment/pick-id aliases, including the numeric
    // part without the source prefix (S1895233 -> 1895233). This helps searches
    // by field asset number without needing to type the public-data prefix.
    const idSeeds=[a?.equip,a?.id,a?.raw?.PICK_ID,a?.raw?.pick_id,a?.raw?.EQUIP_NO,a?.raw?.equip_no,a?.raw?.EQUIP_NAME,a?.raw?.equip_name,a?.raw?.ASSET_ID,a?.raw?.asset_id,a?.raw?.OBJECTID,a?.raw?.objectid].filter(Boolean);
    for(const seed of idSeeds){
      addToken(seed);
      const text=String(seed||'').toUpperCase();
      const m=text.match(/^[A-Z]+0*(\d{3,})([A-Z]{0,2})$/);
      if(m){addToken(m[1]+(m[2]||''));}
    }
    addWords(conductorText);
    // Hard cap keeps Android/SPCK memory stable on 40k+ structure imports. Scoring still
    // uses searchCompact/compactFields after candidate selection.
    const doc={asset:a,compactFields,searchCompact,tokens:Array.from(tokens).slice(0,28)};
    try{this.docCache.set(a,doc);}catch(e){}
    return doc;
  },
  buildSpatialCellKey(lat,lon){
    const size=this.spatialGridSize||0.025;
    return `${Math.floor(Number(lat)/size)}|${Math.floor(Number(lon)/size)}`;
  },
  addSpatialAsset(a){
    if(!Number.isFinite(Number(a?.lat))||!Number.isFinite(Number(a?.lon))||a.kind==='circuit')return;
    const key=this.buildSpatialCellKey(Number(a.lat),Number(a.lon));
    if(!this.spatialIndex.has(key))this.spatialIndex.set(key,[]);
    this.spatialIndex.get(key).push(a);
  },
  assetsInBounds(bounds){
    if(!bounds||!this.spatialIndex||!this.spatialIndex.size)return (App.assets||[]).filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)&&bounds?.contains?.([a.lat,a.lon]));
    const size=this.spatialGridSize||0.025;
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    const minLat=Math.floor(sw.lat/size), maxLat=Math.floor(ne.lat/size);
    const minLon=Math.floor(sw.lng/size), maxLon=Math.floor(ne.lng/size);
    const out=[]; const seen=new Set();
    for(let y=minLat;y<=maxLat;y++){
      for(let x=minLon;x<=maxLon;x++){
        const cell=this.spatialIndex.get(`${y}|${x}`);
        if(!cell)continue;
        for(const a of cell){
          const id=this.assetStableId(a);
          if(seen.has(id))continue;
          if(bounds.contains([a.lat,a.lon])){seen.add(id);out.push(a);}
        }
      }
    }
    return out;
  },
  candidateAssets(cq,ws,opts={}){
    const scopedFallback=()=>this.filterCandidatesByScope((App.assets||[]),opts.scopeHint);
    if(!this.searchDocs||!this.searchDocs.length||!this.tokenIndex||!this.tokenIndex.size)return scopedFallback();
    if(!cq)return scopedFallback();
    if(cq.length<2){
      return (this.kindIndex?.reference?.length?this.kindIndex.reference:(App.assets||[]).filter(a=>this.isReferencePointAsset(a)));
    }
    const found=new Set();
    let probes=[cq,...(ws||[]).map(w=>this.compact(w)).filter(Boolean)]
      .filter(p=>p&&p.length>=2&&!/^\d{1,2}$/.test(p)&&!/^0+$/.test(p));
    probes=Array.from(new Set(probes));
    // Pass 25: avoid letting generic type words like TRANSFORMER pull the first
    // few thousand transformer assets and bury the actual named hit.  Queries such
    // as "Transformer Abercrombie 1 895233" must search ABERCROMBIE / 895233
    // first, then only fall back to the generic type token if nothing specific hits.
    const genericProbe=/^(TRANSFORMER|TRANSFORMERS|TX|STRUCTURE|STRUCTURES|POLE|POLES|TOWER|TOWERS|CIRCUIT|CIRCUITS|LINE|LINES|ASSET|ASSETS|ELECTRICAL|DISTRIBUTION|TRANSMISSION|HV|DX|UTILITY|UTILITIES|PILLAR|PILLARS|ENCLOSURE|ENCLOSURES|OVERHEAD|POWERLINE|POWERLINES|GEOJSON|JSON|MAP|DOT|DOTS)$/i;
    const specificProbes=probes.filter(p=>!genericProbe.test(p));
    const activeProbes=specificProbes.length?specificProbes:probes;
    const addSet=(set)=>{
      if(!set)return;
      for(const a of set){
        if(opts.scopeHint&&!this.scopeAllowsAsset(a,{transmission:true,dxPoles:false,transformers:false,misc:false,...opts.scopeHint}))continue;
        found.add(a);
        if(found.size>3500)break;
      }
    };
    for(const probe of activeProbes){
      addSet(this.tokenIndex.get(probe));
      if(found.size>3500)break;
      const stripped=this.stripZeros(probe);
      if(stripped&&stripped!==probe)addSet(this.tokenIndex.get(stripped));
      if(found.size>3500)break;
    }
    // Only use broad generic tokens when the specific part of the query found nothing.
    if(!found.size&&specificProbes.length){
      for(const probe of probes.filter(p=>genericProbe.test(p))){
        addSet(this.tokenIndex.get(probe));
        if(found.size>3500)break;
      }
    }
    // Pass 2: use token prefix buckets, but cap the scan earlier.  This keeps
    // relaxed matching without walking every asset/search doc on common words.
    if(found.size<80){
      for(const [tok,set] of this.tokenIndex){
        if(tok.length<2)continue;
        if(activeProbes.some(p=>p&&tok.includes(p))){addSet(set);}
        if(found.size>3000)break;
      }
    }
    return found.size?Array.from(found):scopedFallback();
  },


  resetFastIndexes(){
    this.docCache=new WeakMap();
    this.kindIndex={reference:[],structure:[],transformer:[],misc:[],all:[]};
    this.searchCache=new Map();
    this.recoveryLineCache=new Map();
    this.poleDetailMap=new Map();
    this.poleDetailMapBuilt=false;
    this.circuitPathIndex=new Map();
    this.circuitEndpointPathIndex=new Map();
    this.circuitPathIndexStamp='';
    this.circuitPathStats=null;
  },
  ensureIndexContainers(){
    if(!this.lineMap)this.lineMap=new Map();
    if(!this.assetMap)this.assetMap=new Map();
    if(!this.searchDocs)this.searchDocs=[];
    if(!this.tokenIndex)this.tokenIndex=new Map();
    if(!this.spatialIndex)this.spatialIndex=new Map();
    if(!this.indexedAssetIds)this.indexedAssetIds=new Set();
    if(!this.spatialGridSize)this.spatialGridSize=0.025;
    if(!this.docCache||typeof this.docCache.get!=='function')this.docCache=new WeakMap();
    if(!this.kindIndex)this.kindIndex={reference:[],structure:[],transformer:[],misc:[],all:[]};
    if(!this.searchCache)this.searchCache=new Map();
    if(!this.recoveryLineCache)this.recoveryLineCache=new Map();
    if(!this.poleDetailMap)this.poleDetailMap=new Map();
    if(!this.circuitPathIndex)this.circuitPathIndex=new Map();
    if(!this.circuitEndpointPathIndex)this.circuitEndpointPathIndex=new Map();
  },
  fastKindForAsset(a){
    const kind=String(a?.kind||'').toLowerCase();
    if(kind==='substation'||kind==='terminal'||kind==='depot')return 'reference';
    if(kind==='transformer')return 'transformer';
    if(kind==='structure'||kind==='circuit'||this.lineRefsForAsset(a,true).length)return 'structure';
    return 'misc';
  },
  addKindIndex(a){
    if(!a||typeof a!=='object')return;
    this.ensureIndexContainers();
    const bucket=this.fastKindForAsset(a);
    if(!this.kindIndex[bucket])this.kindIndex[bucket]=[];
    this.kindIndex[bucket].push(a);
    this.kindIndex.all.push(a);
  },
  scopeAllowsAsset(a,scope){
    if(!a)return false;
    const kind=String(a.kind||'').toLowerCase();
    if(kind==='substation'||kind==='terminal'||kind==='depot')return true;
    if(kind==='transformer')return !!scope.transformers;
    if(kind==='dx-pole'||kind==='distribution-pole')return !!scope.dxPoles;
    if(kind==='structure'||kind==='circuit'||this.lineRefsForAsset(a,true).length)return scope.transmission!==false;
    if(/^utility-/i.test(kind))return false;
    return !!scope.misc;
  },
  filterCandidatesByScope(list,scope){
    if(!scope||typeof scope!=='object')return list;
    const s={transmission:true,dxPoles:false,transformers:false,misc:false,...scope};
    return (list||[]).filter(a=>this.scopeAllowsAsset(a,s));
  },
  isHVCrossingAsset(a){
    if(!a)return false;
    if(String(a.kind||'').toLowerCase()==='hv-crossing')return true;
    const raw=a.raw||{};
    const text=[a.kind,a.category,a.label,a.sourceFile,a.sourcePath,a.line,raw.asset_type,raw.asset_class,raw.category,raw.layer,raw.field_map_layer,raw.crossing_type,raw.render_hint,raw.source_layer,raw.name,raw.label]
      .map(v=>String(v||'')).join(' ').toUpperCase();
    return /DX\s*CROSSING|DX_CROSSINGS|TX[_\s-]*DX|HV\s*CROSSING|HV_CROSSINGS|HVCROSSING|CROSSING_POINTS|TRANSMISSION_X_(?:HV|HV_DISTRIBUTION|DISTRIBUTION)|FIELD_MAP_(?:DX|HV)_CROSSINGS/.test(text);
  },
  isUtilityAsset(a){
    return !!a&&/^utility-/i.test(String(a.kind||''));
  },
  canContributeTransmissionCircuit(a){
    if(!a||typeof a!=='object')return false;
    const kind=String(a.kind||'').toLowerCase();
    if(kind==='substation'||kind==='terminal'||kind==='depot'||kind==='transformer'||kind==='dx-pole'||kind==='distribution-pole'||kind==='streetlight'||kind==='electrical-enclosure'||kind==='conductor-span'||kind==='note'||kind==='misc-route')return false;
    if(this.isHVCrossingAsset(a)||this.isUtilityAsset(a)||this.isConductorSpanAsset(a))return false;
    const raw=a.raw||{};
    const text=[a.sourceFile,a.sourcePath,a.sourceName,a.category,a.kind,a.label,a.line,a.structure,a.equip,raw.EQUIP_GRP_ID_DESC,raw.ASSET_TYPE,raw.asset_type,raw.LAYER,raw.LAYER_NAME,raw.layer,raw.layerName,raw.FEATURE_TYPE,raw.TYPE,raw.CLASS,raw.DESCRIPTION,raw.description,raw.NETWORK_TYPE,raw.NETWORK_ID]
      .map(v=>String(v||'')).join(' ').toUpperCase();
    // Do not allow transformer/distribution/misc network names to become fake transmission circuit cards.
    if(/TRANSFORMER|DISTRIBUTION\s+TRANSFORMER|\bTX\b|KVA|WP[_\s-]*039|STREET\s*LIGHT|STREETLIGHT|LUMINAIRE|LAMP|PILLAR|SERVICE\s*PIT|LOW\s*VOLTAGE|\bLV\b|DISTRIBUTION[_\s-]*UNDERGROUND[_\s-]*CABLE|UNDERGROUND[_\s-]*CABLE|SERVICE\s*CABLE/.test(text))return false;
    if(/DISTRIBUTION[_\s-]*POLE|DX[_\s-]*POLE|DIST\s+POLE|ELECTRICAL\s+POLE/.test(text))return false;
    // Real transmission structure/bundle sources are allowed to build circuit cards.
    if(/FIELD[_\s-]*MAP[_\s-]*READY|READY(POL|TOW|NOM)|POLES[_\s-]*FIELD|TOWERS[_\s-]*FIELD|NONWOOD[_\s-]*FIELD|TRANSMISSION|TRMSN|TRANS\s+STRUCTURE|TRANS\s+STRUNG|OVERHEAD\s+TRANSMISSION|LATTICE\s+TOWER/.test(text))return true;
    if(kind==='structure')return true;
    if(kind==='circuit')return /TRANSMISSION|TRMSN|TRANS\s+|OVERHEAD\s+TRANSMISSION/.test(text);
    return false;
  },
  lineMapLinesForAsset(a,rawLine=''){
    const isUtility=/^utility-/i.test(String(a?.kind||''));
    const isConductorSpan=this.isConductorSpanAsset(a);
    if(isUtility||isConductorSpan||!this.canContributeTransmissionCircuit(a))return [];
    const lines=this.lineAliasesForAsset(a)||[];
    if(!lines.length&&rawLine&&String(a?.kind||'')!=='substation'&&/\d/.test(this.compact(this.formatCircuitName(rawLine))))lines.push(this.formatCircuitName(rawLine));
    return lines.filter(line=>this.isDisplayableTransmissionCircuitLine(line));
  },
  indexOneAsset(a,idx=0){
    this.ensureIndexContainers();
    if(!a||typeof a!=='object')return false;
    try{this.repairStructureIdentity(a);}catch(e){}
    if(this.isHVCrossingAsset(a))return false;
    // Utilities stay available to UtilitiesEngine for proximity/grid drawing, but they
    // do not need normal text-search tokens, line groups, or search spatial cells.
    // Skipping them here prevents 6+ gas/water/rail/UG files from duplicating huge
    // geometry records inside the in-memory search index on Android/SPCK.
    if(this.isUtilityAsset(a))return false;
    const stable=this.assetStableId(a,idx);
    if(!a.id)a.id=stable;
    if(this.indexedAssetIds.has(stable))return false;
    this.indexedAssetIds.add(stable);
    this.assetMap.set(stable,a);
    const rawLine=a.line||a.substation||'';
    const isUtility=/^utility-/i.test(String(a.kind||''));
    const isConductorSpan=this.isConductorSpanAsset(a);
    const lines=this.lineMapLinesForAsset(a,rawLine);
    for(const line of lines){
      if(!line)continue;
      const key=this.compact(line);
      if(!this.lineMap.has(key))this.lineMap.set(key,{line,rawLine:rawLine||line,assets:[],validGps:0,routeAssets:[],assetIds:new Set(),routeIds:new Set()});
      const group=this.lineMap.get(key);
      if(line&&line.length>=String(group.line||'').length)group.line=line;
      if(!group.assetIds.has(stable)){
        group.assetIds.add(stable);
        group.assets.push(a);
        if(Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit')group.validGps++;
      }
      if(a.routeCoords?.length&&!group.routeIds.has(stable)){group.routeIds.add(stable);group.routeAssets.push(a);}
    }
    try{this.addPoleDetailIndex(a,stable);}catch(e){}
    const doc=this.buildSearchDoc(a);
    this.searchDocs.push(stable||a.id||indexed);
    this.addKindIndex(a);
    let tokenLinks=0;
    for(const t of doc.tokens){this.addIndexToken(t,a);tokenLinks++;}
    if(!isConductorSpan&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit')this.addSpatialAsset(a);
    return {tokenLinks};
  },

  canonicalCircuitForPathLabel(value){
    let s=String(value||'').toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    if(!s)return '';
    // Raw public pole labels can contain a truncated second label after a comma:
    // "NT-HBK 81-0093, HBK-". Only the first complete circuit label is used.
    s=s.replace(/,\s*[A-Z0-9\-\/ ]*$/,'').trim();
    const m=s.match(/\b([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)\s+(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})\b/i);
    if(!m)return '';
    const line=`${m[1].toUpperCase()}-${String(m[2]||'').toUpperCase().replace(/\s*\/\s*/g,'/')} ${m[3].toUpperCase()}`;
    const formatted=this.formatCircuitName(line)||line;
    return this.isDisplayableTransmissionCircuitLine(formatted)?formatted:'';
  },
  circuitPathLabelCandidates(a){
    const raw=a?.raw||{};
    const vals=[
      raw.trmsn_line_gis_label,raw.TRMSN_LINE_GIS_LABEL,raw.Trmsn_Line_Gis_Label,raw.CIRCUIT_STRUCTURE_LABEL,
      raw.STRUCTURE_LABEL,raw.structure_label,a?.gisLabel,a?.structure,a?.label,
      raw.LINE_NAME_1,raw.LINE_NAME,raw.line_name_1,raw.line_name,a?.line
    ];
    const out=[]; const seen=new Set();
    for(const v of vals){
      const t=String(v||'').trim();
      if(!t)continue;
      const k=t.toUpperCase().replace(/\s+/g,' ');
      if(seen.has(k))continue;
      seen.add(k); out.push(t);
    }
    return out;
  },
  circuitPathOrderFromLabel(label='',asset=null){
    const raw=asset?.raw||{};
    const vals=[label,asset?.poleNumber,raw.NAMEPLATE_ID_1,raw.nameplate_id_1,raw.POLE_NUMBER,raw.pole_number,raw.STRUCTURE_NO,raw.structure_no,raw.STRUCTURE_ID,raw.structure_id,asset?.rawStructure,asset?.structure,asset?.label];
    const parse=(v)=>{
      let s=String(v||'').toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
      if(!s)return null;
      s=s.replace(/,\s*[A-Z0-9\-\/ ]*$/,'').trim();
      let token='';
      // Prefer the pole suffix after a full circuit label: LINE 81-0098A, LINE 71-0002/, LINE 71-0000G.
      let m=s.match(/\b[A-Z0-9]{1,8}\s*[-–—]\s*[A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*\s+(?:X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})\s*[-–—]\s*([A-Z]{0,3}\d{1,6}[A-Z]{0,3}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?|\d{1,6}[A-Z]{0,4}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?)/i);
      if(m)token=m[1];
      if(!token){
        m=s.match(/(?:^|\b)([A-Z]{0,3}\d{1,6}[A-Z]{0,3}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?|\d{1,6}[A-Z]{0,4}(?:\s*\/\s*[A-Z]{0,4}\d{0,6}[A-Z]{0,4})?)\s*$/i);
        if(m)token=m[1];
      }
      if(!token)return null;
      token=String(token||'').toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9/]/g,'');
      const branchParts=this.poleIdParts?.(token);
      if(branchParts?.isBranch){
        const b=Number(branchParts.sortBranch||branchParts.branchNum||1);
        const frac=Math.min(0.79,0.20+(b/10000));
        return {order:branchParts.num+frac,num:branchParts.num,key:branchParts.norm,token};
      }
      token=token.replace(/[^A-Z0-9]/g,'');
      // Public transmission pole labels use G0000 as the terminal/end structure on many circuits.
      // Treat it as an end marker, not as pole 0. Putting G0000 at the start creates the false
      // diagonal connected lines seen when drawing from the optimiser.
      m=token.match(/^G0*(\d{1,6})$/i);
      if(m){
        const num=Number(m[1]||0);
        // G0000 is the far-end gantry/end marker on the public pole data. Keep it
        // after numbered structures so it does not get treated as pole 0.
        return {order:1000000+num,num,key:'G'+String(num).padStart(6,'0'),token};
      }
      m=token.match(/^0*(\d{1,6})G$/i);
      if(m){
        const num=Number(m[1]||0);
        // 0000G / 0030G are gantry/branch suffixes tied to that structure number,
        // not the far end of the line. Keeping them beside 0/30 prevents false
        // diagonals and short broken connected-line stubs.
        return {order:num+0.08,num,key:String(num).padStart(6,'0')+'G',token};
      }
      m=token.match(/^([A-Z]{0,3})0*(\d{1,6})([A-Z]{0,3})$/i);
      if(!m)return null;
      const prefix=m[1]||'', num=Number(m[2]||0), suffix=m[3]||'';
      const letters=(prefix+suffix).toUpperCase();
      let frac=0;
      for(let i=0;i<letters.length;i++)frac+=((letters.charCodeAt(i)-64)||0)/Math.pow(100,i+1);
      const branchPenalty=prefix?0.5:0;
      return {order:num+branchPenalty+frac/10, num, key:String(num).padStart(6,'0')+letters, token};
    };
    for(const v of vals){const r=parse(v); if(r)return r;}
    return null;
  },
  circuitPathAddPoint(groups,line,ord,asset){
    if(!line||!ord||!asset)return;
    const lat=Number(asset.lat), lon=Number(asset.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    const key=this.compact(line);
    if(!key)return;
    if(!groups.has(key))groups.set(key,{line,rows:new Map(),rawCount:0});
    const g=groups.get(key); g.rawCount++;
    const rowKey=ord.key||String(ord.order);
    if(!g.rows.has(rowKey))g.rows.set(rowKey,{order:ord.order,key:rowKey,token:ord.token,pts:new Map()});
    const row=g.rows.get(rowKey);
    const pkey=lat.toFixed(7)+','+lon.toFixed(7);
    row.pts.set(pkey,[lat,lon]);
  },
  buildCircuitPathIndex(records=null,opts={}){
    this.ensureIndexContainers();
    const list=Array.isArray(records)?records:(App.assets||[]);
    const stamp=`${list.length}|${App?.lastImport?.time||''}|${this.lineMap?.size||0}|v35`;
    if(!opts.force&&this.circuitPathIndexStamp===stamp&&this.circuitPathIndex?.size)return this.circuitPathIndex;
    const started=Date.now();
    const groups=new Map();
    let scanned=0, matched=0, skipped=0;
    for(const a of list){
      scanned++;
      if(!a||typeof a!=='object'){skipped++;continue;}
      const kind=String(a.kind||'').toLowerCase();
      if(kind==='substation'||kind==='terminal'||kind==='depot'||kind==='transformer'||kind==='circuit'||kind==='conductor-span'||kind==='hv-crossing'||this.isUtilityAsset(a)){skipped++;continue;}
      if(!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon))){skipped++;continue;}
      let added=false;
      // Primary path source: the same confirmed line/nameplate references used by the
      // main search engine. This is the important bit: full pole/tower JSON sources
      // often store LINE_NAME_1..6 and NAMEPLATE_ID_1..6 separately, not as one
      // TRMSN_LINE_GIS_LABEL string. Using the pair keeps each circuit attached to
      // its own structure number without hardcoding circuit names or coordinates.
      try{
        for(const ref of this.lineRefsForAsset(a,true)||[]){
          const line=this.formatCircuitName(ref?.line||'');
          if(!line||!this.isDisplayableTransmissionCircuitLine(line))continue;
          const ord=this.circuitPathOrderFromLabel(ref?.pole||ref?.structure||'',a);
          if(!ord)continue;
          this.circuitPathAddPoint(groups,line,ord,a);
          added=true;
        }
      }catch(e){}
      // Fallback for raw public GeoJSON labels where the line and structure are in
      // one text field, e.g. CTB-RGN 81-0030K. This is still imported data only.
      if(!added){
        for(const lab of this.circuitPathLabelCandidates(a)){
          const line=this.canonicalCircuitForPathLabel(lab)||this.canonicalCircuitForPathLabel(a.line||'');
          if(!line)continue;
          const ord=this.circuitPathOrderFromLabel(lab,a);
          if(!ord)continue;
          this.circuitPathAddPoint(groups,line,ord,a);
          added=true;
        }
      }
      if(added)matched++; else skipped++;
    }
    const pathIndex=new Map(), endpointIndex=new Map();
    const dist=(p,q)=>{
      try{return this._distKm({lat:p[0],lon:p[1]},{lat:q[0],lon:q[1]});}catch(e){return Infinity;}
    };
    const pushEndpoint=(code,line)=>{
      const c=this.compact(code); if(!c)return;
      if(!endpointIndex.has(c))endpointIndex.set(c,new Set());
      endpointIndex.get(c).add(line);
    };
    let pointCount=0, segmentCount=0;
    for(const g of groups.values()){
      const rows=Array.from(g.rows.values()).filter(r=>r.pts&&r.pts.size).sort((a,b)=>a.order-b.order||String(a.key).localeCompare(String(b.key),undefined,{numeric:true,sensitivity:'base'}));
      if(rows.length<2)continue;
      const coords=[];
      for(const r of rows){
        let lat=0,lon=0,n=0;
        for(const p of r.pts.values()){lat+=p[0];lon+=p[1];n++;}
        if(n){
          const pt=[lat/n,lon/n];
          const last=coords[coords.length-1];
          if(!last||Math.abs(last[0]-pt[0])>1e-7||Math.abs(last[1]-pt[1])>1e-7)coords.push(pt);
        }
      }
      if(coords.length<2)continue;
      const gapDistances=[];
      for(let i=1;i<coords.length;i++){
        const d=dist(coords[i-1],coords[i]);
        if(Number.isFinite(d))gapDistances.push(d);
      }
      const sortedGaps=gapDistances.slice().sort((a,b)=>a-b);
      const pct=(q)=>sortedGaps.length?sortedGaps[Math.min(sortedGaps.length-1,Math.max(0,Math.floor((sortedGaps.length-1)*q)))]||0:0;
      const medianGap=pct(0.50);
      const p90Gap=pct(0.90);
      const p98Gap=pct(0.98);
      // Data-driven gap guard: do not draw fake straight lines across missing structure ranges.
      // Normal pole spans are kept; abnormal jumps are split. No circuit names or coords are hardcoded.
      const jumpLimitKm=Math.max(1.2,Math.min(12,Math.max(medianGap*10,p90Gap*3.5,2.5)));
      const segs=[]; let cur=[]; let maxGap=0, splitCount=0;
      for(const pt of coords){
        if(cur.length){
          const d=dist(cur[cur.length-1],pt);
          if(Number.isFinite(d))maxGap=Math.max(maxGap,d);
          if(Number.isFinite(d)&&d>jumpLimitKm){
            if(cur.length>=2)segs.push(cur);
            cur=[]; splitCount++;
          }
        }
        cur.push(pt);
      }
      if(cur.length>=2)segs.push(cur);
      if(!segs.length)continue;
      const line=g.line;
      const key=this.compact(line);
      pathIndex.set(key,{line,key,segments:segs,points:coords.length,rawPoints:g.rawCount,source:'optimised-pole-point-sequence',jumpLimitKm,maxGapKm:maxGap,splitCount,medianGapKm:medianGap,p90GapKm:p90Gap,p98GapKm:p98Gap});
      pointCount+=coords.length; segmentCount+=segs.length;
      for(const c of this.lineEndpointCodes(line)||[])pushEndpoint(c,line);
    }
    this.circuitPathIndex=pathIndex;
    this.circuitEndpointPathIndex=endpointIndex;
    this.circuitPathIndexStamp=stamp;
    this.circuitPathStats={builtAt:new Date().toISOString(),ms:Date.now()-started,scanned,matched,skipped,circuits:pathIndex.size,points:pointCount,segments:segmentCount};
    try{Diagnostics?.log?.('Circuit path optimiser',JSON.stringify(this.circuitPathStats));}catch(e){}
    return pathIndex;
  },
  async buildCircuitPathIndexAsync(records=null,reason='Optimising transmission circuit paths'){
    // Build from already-imported pole/tower records. No hardcoded circuit data is stored.
    UI?.progress?.(true,reason,'Building fast connected-circuit paths from imported pole/tower points',95);
    await new Promise(r=>setTimeout(r,0));
    const idx=this.buildCircuitPathIndex(records,{force:true});
    const st=this.circuitPathStats||{};
    UI?.progress?.(true,reason,`Optimised ${Number(st.circuits||idx.size||0).toLocaleString()} circuit path(s) · ${Number(st.points||0).toLocaleString()} centreline point(s)`,96);
    await new Promise(r=>setTimeout(r,0));
    return idx;
  },
  circuitPathSegments(line){
    this.ensureIndexContainers();
    if(!this.circuitPathIndex?.size)this.buildCircuitPathIndex(App.assets||[]);
    const canonical=this.formatCircuitName(line)||String(line||'');
    const key=this.compact(canonical);
    const g=this.circuitPathIndex.get(key)||this.circuitPathIndex.get(this.compact(line));
    if(!g||!Array.isArray(g.segments))return [];
    return g.segments.map(seg=>seg.map(p=>[Number(p[0]),Number(p[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]))).filter(seg=>seg.length>=2);
  },
  circuitPathLinesForEndpointCode(code){
    this.ensureIndexContainers();
    if(!this.circuitEndpointPathIndex?.size)this.buildCircuitPathIndex(App.assets||[]);
    const c=this.compact(code);
    return Array.from(this.circuitEndpointPathIndex.get(c)||[]).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  },

  async indexFileRecords(records=[],meta={},reason='File-level index',opts={}){
    this.ensureIndexContainers();
    this.recoveryLineCache=new Map();
    this.poleDetailMapBuilt=false;
    this.poleDetailMap=new Map();
    // Do not filter/clone the full file array here. Large SPCK imports were
    // crashing near the end because indexing created another full temporary copy.
    const list=Array.isArray(records)?records:[];
    const total=list.length||1;
    let indexed=0, tokenLinks=0, gpsIndexed=0, utilitySkipped=0;
    const start=Date.now();
    App.indexHealth=App.indexHealth||{mode:'file-level',queue:[],files:[]};
    App.indexHealth.current={name:meta.name||meta.fileName||'current file',status:'indexing',startedAt:new Date().toISOString(),total:list.length};
    for(let i=0;i<list.length;i++){
      const asset=list[i];
      if(!asset)continue;
      try{
        if(this.isUtilityAsset(asset)){utilitySkipped++; continue;}
        const res=this.indexOneAsset(asset,(this.assetMap?.size||0)+i);
        if(res){indexed++; tokenLinks+=res.tokenLinks||0; if(Number.isFinite(Number(asset.lat))&&Number.isFinite(Number(asset.lon))&&asset.kind!=='circuit')gpsIndexed++;}
      }catch(err){Diagnostics?.log?.('Skipped asset during file index',String(err?.message||err));}
      if(i%500===0){
        UI?.progress?.(true,reason,`${meta.name||meta.fileName||'file'}: indexed ${i.toLocaleString()} / ${total.toLocaleString()} · file-level queue`,92+Math.min(4,Math.round((i/total)*4)));
        await new Promise(r=>setTimeout(r,8));
      }
    }
    const touched=new Set();
    for(const a of list){
      if(!a)continue;
      for(const line of this.lineAliasesForAsset(a)||[]){const g=this.lineMap.get(this.compact(line)); if(g&&!touched.has(g)){g.assets.sort(this.sortByStructure); touched.add(g);}}
    }
    if(!opts?.deferCircuitPath){try{this.buildCircuitPathIndex(App.assets||[],{force:true});}catch(err){Diagnostics?.log?.('Circuit path optimiser skipped',String(err?.message||err));}}
    this.indexStats={
      ...(this.indexStats||{}),
      rebuiltAt:this.indexStats?.rebuiltAt||new Date().toISOString(),
      lastFileIndexedAt:new Date().toISOString(),
      lastFile:meta.name||meta.fileName||'',
      lastFileMs:Date.now()-start,
      assetsIndexed:this.assetMap?.size||0,
      gpsIndexed:(this.indexStats?.gpsIndexed||0)+gpsIndexed,
      lineGroups:this.lineMap?.size||0,
      circuitPathGroups:this.circuitPathIndex?.size||0,
      tokenCount:this.tokenIndex?.size||0,
      tokenLinks:(this.indexStats?.tokenLinks||0)+tokenLinks,
      utilitySkipped:(this.indexStats?.utilitySkipped||0)+utilitySkipped,
      spatialCells:this.spatialIndex?.size||0,
      schema:App.schema||{},
      mode:'file-level incremental',
      pass2Index:this.pass2IndexVersion,
      kindIndexCounts:Object.fromEntries(Object.entries(this.kindIndex||{}).map(([k,v])=>[k,Array.isArray(v)?v.length:0])),
      structureMapAudit:this.structureMapDotAudit(App.assets||[])
    };
    App.indexHealth.current=null;
    return {indexed,tokenLinks,gpsIndexed,ms:Date.now()-start};
  },

  rebuild(){
    this.lineMap=new Map(); this.assetMap=new Map();
    this.searchDocs=[]; this.tokenIndex=new Map(); this.spatialIndex=new Map(); this.indexedAssetIds=new Set();
    this.spatialGridSize=0.025; this.resetFastIndexes();
    const start=Date.now();
    try{this.resolveDualCircuits(App.assets||[]);}catch(err){Diagnostics?.log?.('Circuit resolver skipped',String(err?.message||err));}
    try{this.linkConductorSections(App.assets||[]); this.buildReferenceIndex(App.assets||[]);}catch(err){Diagnostics?.log?.('Conductor/reference linker skipped',String(err?.message||err));}
    let indexed=0, gpsIndexed=0, tokenLinks=0;
    for(const a of App.assets||[]){
      try{
        if(!a||typeof a!=='object')continue;
        try{this.repairStructureIdentity(a);}catch(e){}
        if(this.isHVCrossingAsset(a)||this.isUtilityAsset(a))continue;
        const stable=this.assetStableId(a,indexed);
        if(!a.id)a.id=stable;
        this.assetMap.set(stable,a);
        this.indexedAssetIds.add(stable);
        const rawLine=a.line||a.substation||'';
        const isUtility=/^utility-/i.test(String(a.kind||''));
        const isConductorSpan=this.isConductorSpanAsset(a);
        const lines=this.lineMapLinesForAsset(a,rawLine);
        for(const line of lines){
          if(!line)continue;
          const key=this.compact(line);
          if(!this.lineMap.has(key))this.lineMap.set(key,{line,rawLine:rawLine||line,assets:[],validGps:0,routeAssets:[],assetIds:new Set(),routeIds:new Set()});
          const group=this.lineMap.get(key);
          if(line&&line.length>=String(group.line||'').length)group.line=line;
          const aid=stable;
          if(!group.assetIds.has(aid)){
            group.assetIds.add(aid);
            group.assets.push(a);
            if(Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit')group.validGps++;
          }
          if(a.routeCoords?.length&&!group.routeIds.has(aid)){group.routeIds.add(aid);group.routeAssets.push(a);}
        }
        try{this.addPoleDetailIndex(a,stable);}catch(e){}
        const doc=this.buildSearchDoc(a);
        this.searchDocs.push(stable||a.id||indexed);
        this.addKindIndex(a);
        for(const t of doc.tokens){this.addIndexToken(t,a);tokenLinks++;}
        if(!isConductorSpan&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit'){this.addSpatialAsset(a);gpsIndexed++;}
        indexed++;
      }catch(err){Diagnostics?.log?.('Skipped bad asset during rebuild',String(err?.message||err));}
    }
    for(const group of this.lineMap.values())group.assets.sort(this.sortByStructure);
    try{this.buildCircuitPathIndex(App.assets||[],{force:true});}catch(err){Diagnostics?.log?.('Circuit path optimiser skipped',String(err?.message||err));}
    try{this.buildReferenceIndex(App.assets||[]); this.enrichReferenceIndexFromLineEndpoints(App.assets||[]);}catch(err){Diagnostics?.log?.('Reference abbreviation endpoint enrichment skipped',String(err?.message||err));}
    this.indexStats={
      rebuiltAt:new Date().toISOString(),
      ms:Date.now()-start,
      assetsIndexed:indexed,
      gpsIndexed,
      lineGroups:this.lineMap.size,
      circuitPathGroups:this.circuitPathIndex?.size||0,
      tokenCount:this.tokenIndex.size,
      tokenLinks,
      spatialCells:this.spatialIndex.size,
      schema:App.schema||{},
      pass2Index:this.pass2IndexVersion,
      kindIndexCounts:Object.fromEntries(Object.entries(this.kindIndex||{}).map(([k,v])=>[k,Array.isArray(v)?v.length:0])),
      structureMapAudit:this.structureMapDotAudit(App.assets||[])
    };
    try{Diagnostics?.log?.('Indexes rebuilt',JSON.stringify(this.indexStats));}catch(e){}
  },
  async rebuildAsync(reason='Index rebuild'){
    if(this.indexRunning)throw new Error('Index rebuild already running');
    this.indexRunning=true;
    this.indexCancelRequested=false;
    this.indexCancelReason='';
    try{
    this.lineMap=new Map(); this.assetMap=new Map();
    this.searchDocs=[]; this.tokenIndex=new Map(); this.spatialIndex=new Map(); this.indexedAssetIds=new Set();
    this.spatialGridSize=0.025; this.resetFastIndexes();
    const start=Date.now();
    const assets=App.assets||[];
    const total=assets.length||1;
    UI?.progress?.(true,reason,`Preparing ${total.toLocaleString()} loaded records for search · utilities use proximity grid only`,72);
    await new Promise(r=>setTimeout(r,0));
    this.assertIndexNotCancelled();
    try{
      UI?.progress?.(true,reason,'Resolving dual-circuit references in chunks',74);
      await new Promise(r=>setTimeout(r,0));
      this.assertIndexNotCancelled();
      this.resolveDualCircuits(assets);
      this.linkConductorSections(assets);
      this.buildReferenceIndex(assets);
    }catch(err){Diagnostics?.log?.('Circuit/conductor resolver skipped',String(err?.message||err));}
    let indexed=0, gpsIndexed=0, tokenLinks=0;
    for(let i=0;i<assets.length;i++){
      const a=assets[i];
      try{
        if(!a||typeof a!=='object')continue;
        try{this.repairStructureIdentity(a);}catch(e){}
        if(this.isHVCrossingAsset(a)||this.isUtilityAsset(a))continue;
        const stable=this.assetStableId(a,indexed);
        if(!a.id)a.id=stable;
        this.assetMap.set(stable,a);
        this.indexedAssetIds.add(stable);
        const rawLine=a.line||a.substation||'';
        const isUtility=/^utility-/i.test(String(a.kind||''));
        const isConductorSpan=this.isConductorSpanAsset(a);
        const lines=this.lineMapLinesForAsset(a,rawLine);
        for(const line of lines){
          if(!line)continue;
          const key=this.compact(line);
          if(!this.lineMap.has(key))this.lineMap.set(key,{line,rawLine:rawLine||line,assets:[],validGps:0,routeAssets:[],assetIds:new Set(),routeIds:new Set()});
          const group=this.lineMap.get(key);
          if(line&&line.length>=String(group.line||'').length)group.line=line;
          const aid=stable;
          if(!group.assetIds.has(aid)){
            group.assetIds.add(aid);
            group.assets.push(a);
            if(Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit')group.validGps++;
          }
          if(a.routeCoords?.length&&!group.routeIds.has(aid)){group.routeIds.add(aid);group.routeAssets.push(a);}
        }
        try{this.addPoleDetailIndex(a,stable);}catch(e){}
        const doc=this.buildSearchDoc(a);
        this.searchDocs.push(stable||a.id||indexed);
        this.addKindIndex(a);
        for(const t of doc.tokens){this.addIndexToken(t,a);tokenLinks++;}
        if(!isConductorSpan&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit'){this.addSpatialAsset(a);gpsIndexed++;}
        indexed++;
      }catch(err){Diagnostics?.log?.('Skipped bad asset during rebuild',String(err?.message||err));}
      if(i%500===0){
        this.assertIndexNotCancelled();
        const pct=74+Math.round((i/total)*20);
        UI?.progress?.(true,reason,`Indexed ${i.toLocaleString()} / ${total.toLocaleString()} records · utilities skipped from text search · ${this.lineMap.size.toLocaleString()} circuits`,Math.min(94,pct));
        await new Promise(resolve=>setTimeout(resolve,0));
        this.assertIndexNotCancelled();
      }
    }
    let sorted=0, groups=Array.from(this.lineMap.values());
    for(const group of groups){
      group.assets.sort(this.sortByStructure);
      sorted++;
      if(sorted%75===0){
        this.assertIndexNotCancelled();
        UI?.progress?.(true,reason,`Finalising ${sorted.toLocaleString()} / ${groups.length.toLocaleString()} circuit groups`,95);
        await new Promise(resolve=>setTimeout(resolve,0));
        this.assertIndexNotCancelled();
      }
    }
    this.assertIndexNotCancelled();
    try{await this.buildCircuitPathIndexAsync(assets,reason);}catch(err){Diagnostics?.log?.('Circuit path optimiser skipped',String(err?.message||err));}
    try{
      UI?.progress?.(true,reason,'Recovering substation/terminal abbreviations from circuit endpoints',95);
      await new Promise(resolve=>setTimeout(resolve,0));
      this.assertIndexNotCancelled();
      this.buildReferenceIndex(assets);
      this.enrichReferenceIndexFromLineEndpoints(assets);
    }catch(err){Diagnostics?.log?.('Reference abbreviation endpoint enrichment skipped',String(err?.message||err));}
    this.indexStats={
      rebuiltAt:new Date().toISOString(),
      ms:Date.now()-start,
      assetsIndexed:indexed,
      gpsIndexed,
      lineGroups:this.lineMap.size,
      circuitPathGroups:this.circuitPathIndex?.size||0,
      tokenCount:this.tokenIndex.size,
      tokenLinks,
      spatialCells:this.spatialIndex.size,
      schema:App.schema||{},
      async:true,
      pass2Index:this.pass2IndexVersion,
      kindIndexCounts:Object.fromEntries(Object.entries(this.kindIndex||{}).map(([k,v])=>[k,Array.isArray(v)?v.length:0])),
      structureMapAudit:this.structureMapDotAudit(App.assets||[])
    };
    try{Diagnostics?.log?.('Indexes rebuilt async',JSON.stringify(this.indexStats));}catch(e){}
    UI?.progress?.(true,reason,`Indexes ready · ${indexed.toLocaleString()} assets · ${this.lineMap.size.toLocaleString()} circuits · ${this.indexStats.ms.toLocaleString()}ms`,96);
    await new Promise(resolve=>setTimeout(resolve,0));
    this.assertIndexNotCancelled();
    }finally{
      this.indexRunning=false;
    }
  },
  sortByStructure(a,b){
    const ap=String(a?.poleNumber||'')||String(a?.structure||a?.label||'');
    const bp=String(b?.poleNumber||'')||String(b?.structure||b?.label||'');
    const av=SearchEngine.poleIdSortValue(ap);
    const bv=SearchEngine.poleIdSortValue(bp);
    const rawOrder=(x)=>{
      const raw=x?.raw||{};
      const vals=[x?.rawStructure,x?.structureId,raw.structure_id,raw.STRUCTURE_ID,raw.structureId,x?.id,x?.assetId,x?.globalId];
      for(const v of vals){
        const m=String(v||'').match(/(?:^|\b)T?0*(\d{1,8})(?:\b|$)/i);
        if(m){const n=Number(m[1]); if(Number.isFinite(n))return n;}
      }
      const lat=Number(x?.lat), lon=Number(x?.lon);
      if(Number.isFinite(lat)&&Number.isFinite(lon))return (lat+90)*100000+(lon+180);
      return Infinity;
    };
    const aBad=!Number.isFinite(Number(av.num))||Number(av.num)===0||av.num===Infinity;
    const bBad=!Number.isFinite(Number(bv.num))||Number(bv.num)===0||bv.num===Infinity;
    if(aBad&&bBad){
      const ao=rawOrder(a), bo=rawOrder(b);
      if(ao!==bo)return ao-bo;
    }
    if(av.num!==bv.num)return av.num-bv.num;
    const abr=av.isBranch?1:0, bbr=bv.isBranch?1:0;
    if(abr!==bbr)return abr-bbr;
    if((av.sortBranch||0)!==(bv.sortBranch||0))return (av.sortBranch||0)-(bv.sortBranch||0);
    if(av.suffix!==bv.suffix)return String(av.suffix||'').localeCompare(String(bv.suffix||''));
    if((av.branchPrefix||'')!==(bv.branchPrefix||''))return String(av.branchPrefix||'').localeCompare(String(bv.branchPrefix||''));
    if((av.branchSuffix||'')!==(bv.branchSuffix||''))return String(av.branchSuffix||'').localeCompare(String(bv.branchSuffix||''));
    const ao=rawOrder(a), bo=rawOrder(b);
    if(ao!==bo)return ao-bo;
    return String(a?.label||'').localeCompare(String(b?.label||''));
  },
  highestPoleForLine(line,assets){
    const val=this.highestPoleForLineValue(line,assets);
    return val===null?'':String(val);
  },
  highestPoleForLineValue(line,assets){
    const lineKey=this.compact(this.formatCircuitName(line)||line);
    let best=null;
    const consider=(pole)=>{
      const n=this.poleNumberValue(pole);
      if(n===null)return;
      if(best===null||n>best)best=n;
    };
    for(const a of assets||[]){
      const refs=this.lineRefsForAsset(a);
      let matched=false;
      for(const r of refs){
        if(this.compact(r.line)===lineKey){consider(r.pole); matched=true;}
      }
      if(!matched&&this.compact(a?.line||'')===lineKey)consider(a?.poleNumber||a?.label||a?.structure);
    }
    return best;
  },
  referenceQueryMatchLevel(a,cq,ws){
    if(!a||!/^(substation|depot|terminal)$/i.test(String(a.kind||''))||!cq)return 0;
    const raw=a.raw||{};
    const abbr=this.compact(raw.ABBREVIATION||raw.abbreviation||'');
    const name=this.compact(a.substation||a.label||raw.SUBSTATION||raw.DEPOT_NAME||raw.SEARCH_FIELD||'');
    const searchField=this.compact(raw.SEARCH_FIELD||'');
    const depotInitials=this.compact(String(raw.DEPOT_NAME||a.label||'').split(/\s+/).filter(Boolean).map(x=>x[0]).join(''));
    const subInitials=this.compact(String(raw.SUBSTATION||a.substation||'').split(/\s+/).filter(Boolean).map(x=>x[0]).join(''));
    if(abbr&&abbr===cq)return 5;
    if(depotInitials&&depotInitials===cq)return 4;
    if(subInitials&&subInitials===cq)return 4;
    if(searchField&&searchField.startsWith(cq))return 3;
    if(name&&name.startsWith(cq))return 2;
    if(searchField&&searchField.includes(cq))return 1;
    return 0;
  },
  isHighPriorityReferenceSearchResult(r,cq,ws){
    const a=r?.asset;
    return r?.type==='asset'&&this.referenceQueryMatchLevel(a,cq,ws)>=3;
  },

  compactLineStemPoleQuery(query){
    const cq=this.compact(query);
    if(!cq||!this.lineMap||!this.lineMap.size)return null;
    const seen=new Set();
    const exactPrefix=[];
    // Match a compact circuit prefix first, then treat only the remainder as the structure/nameplate id.
    for(const group of this.lineMap.values()){
      if(!group||!this.isDisplayableTransmissionCircuitLine(group.line))continue;
      const cl=this.compact(group.line);
      if(!cl||!cq.startsWith(cl)||cq.length<=cl.length)continue;
      const pole=this.parsePoleToken(cq.slice(cl.length));
      if(!pole)continue;
      const key=this.compact(group.line)+'|'+pole.norm;
      if(seen.has(key))continue;
      seen.add(key);
      exactPrefix.push({group,pole});
    }
    if(exactPrefix.length){
      return {cq,stem:'',pole:exactPrefix[0].pole,poleNum:exactPrefix[0].pole.num,groups:exactPrefix.map(x=>x.group),groupPoleMap:new Map(exactPrefix.map(x=>[this.compact(x.group.line),x.pole])),exactGroups:[]};
    }
    const m=cq.match(/^([A-Z]{2,12})(\d{1,6}[A-Z]{0,3})$/i);
    if(!m)return null;
    const stem=m[1];
    let pole=this.parsePoleToken(m[2]);
    if(!pole)return null;
    // If a user types a compact line plus pole and the digit run is long, also
    // try likely tail structure ids from the end of the typed value.
    const tailText=this.compact(m[2]);
    const tailMatch=tailText.match(/^(\d+)([A-Z]{0,3})$/i);
    const tailCandidates=[];
    if(tailMatch){
      const digits=tailMatch[1], suffix=tailMatch[2]||'';
      for(const len of [5,4,3,2,1]){
        if(digits.length>len){
          const p=this.parsePoleToken(digits.slice(-len)+suffix);
          if(p&&!tailCandidates.some(x=>x.norm===p.norm))tailCandidates.push(p);
        }
      }
    }
    const groups=[];
    const exactGroups=[];
    for(const group of this.lineMap.values()){
      if(!group||!this.isDisplayableTransmissionCircuitLine(group.line))continue;
      const cl=this.compact(group.line);
      if(!cl)continue;
      if(cl===cq)exactGroups.push(group);
      if(cl.startsWith(stem))groups.push(group);
    }
    if(!groups.length&&!exactGroups.length)return null;
    // Prefer a tail candidate that actually exists on the matched circuit groups.
    for(const cand of [pole,...tailCandidates]){
      if(groups.some(g=>(g.assets||[]).some(a=>this.assetMatchesLinePole(a,g.line,cand)))){pole=cand; break;}
    }
    const all=[]; const lineSeen=new Set();
    for(const g of [...exactGroups,...groups]){
      const k=this.compact(g.line);
      if(!k||lineSeen.has(k))continue;
      lineSeen.add(k); all.push(g);
    }
    return {cq,stem,pole,poleNum:pole.num,groups:all,exactGroups};
  },
  assetMatchesLinePole(a,line,pole){
    const targetPole=typeof pole==='object'?pole:this.parsePoleToken(pole);
    if(!a||!line||!targetPole)return false;
    const target=this.compact(this.formatCircuitName(line)||line);
    const refs=this.lineRefsForAsset(a,true)||[];
    for(const r of refs){
      if(this.compact(this.formatCircuitName(r.line)||r.line)!==target)continue;
      if(this.poleIdMatches(r.pole||a.poleNumber||a.label||a.structure,targetPole))return true;
    }
    if(this.compact(this.formatCircuitName(a.line||''))===target){
      if(this.poleIdMatches(a.poleNumber||a.label||a.structure,targetPole))return true;
    }
    return false;
  },
  compactLinePoleResults(stemPole,resultFilter){
    if(!stemPole||!Array.isArray(stemPole.groups)||!stemPole.groups.length)return [];
    const rows=[]; const seen=new Set();
    for(const group of stemPole.groups){
      const line=group.line;
      const pole=(stemPole.groupPoleMap&&stemPole.groupPoleMap.get(this.compact(line)))||stemPole.pole;
      for(const a of group.assets||[]){
        if(!this.assetMatchesLinePole(a,line,pole))continue;
        if(!this.passesFilters(a))continue;
        const r={type:'asset',score:5000,asset:a,title:a.label||a.structure||a.equip||a.line||'Asset',subtitle:this.subtitle(a),kind:a.kind||'asset'};
        if(resultFilter&&!resultFilter(r))continue;
        const k=this.resultDedupKey(r);
        if(k&&seen.has(k))continue;
        if(k)seen.add(k);
        rows.push(r);
      }
    }
    rows.sort((a,b)=>{
      const ap=this.poleIdSortValue(a.asset?.poleNumber||a.asset?.label||a.asset?.structure);
      const bp=this.poleIdSortValue(b.asset?.poleNumber||b.asset?.label||b.asset?.structure);
      if(ap.num!==bp.num)return ap.num-bp.num;
      if(ap.suffix!==bp.suffix)return String(ap.suffix||'').localeCompare(String(bp.suffix||''));
      return String(a.title||'').localeCompare(String(b.title||''));
    });
    // If the typed compact text is an actual circuit too, keep the circuit underneath the exact structure hit.
    // If it is just a stem+structure query, do not show unrelated circuit cards.
    for(const group of stemPole.exactGroups||[]){
      const highest=this.highestPoleForLineValue(group.line,group.assets);
      const highestLabel=highest!==null?highest.toLocaleString():'unknown';
      const r={type:'circuit',score:1200,line:group.line,group,title:group.line,subtitle:`Highest structure: ${highestLabel} · ${group.validGps.toLocaleString()} mapped`,kind:'circuit'};
      if(resultFilter&&!resultFilter(r))continue;
      const k=this.resultDedupKey(r);
      if(k&&!seen.has(k)){seen.add(k); rows.push(r);}
    }
    return rows;
  },
  search(q,limit=5,opts={}){
    const query=String(q||'').trim(); if(!query)return [];
    opts=opts||{};
    const resultFilter=typeof opts.resultFilter==='function'?opts.resultFilter:null;
    const scopeHint=opts.scopeHint?{transmission:true,dxPoles:false,transformers:false,misc:false,...opts.scopeHint}:null;
    const cq=this.compact(query), ws=this.words(query);
    const stemPole=this.compactLineStemPoleQuery(query);
    if(stemPole){
      const exact=this.compactLinePoleResults(stemPole,resultFilter);
      if(exact.length)return exact.slice(0,limit);
    }
    let results=[];
    if(!scopeHint||scopeHint.transmission!==false){
      for(const group of this.lineMap.values()){
        if(!this.isDisplayableTransmissionCircuitLine(group.line))continue;
        const score=this.scoreLine(cq,ws,group);
        if(score>=80){
          const highest=this.highestPoleForLineValue(group.line,group.assets);
          const highestLabel=highest!==null?highest.toLocaleString():'unknown';
          results.push({type:'circuit',score:score+20,line:group.line,group,title:group.line,subtitle:`Highest structure: ${highestLabel} · ${group.validGps.toLocaleString()} mapped`,kind:'circuit'});
        }
      }
    }
    const candidates=this.candidateAssets(cq,ws,{scopeHint});
    for(const a of candidates){
      if(!this.passesFilters(a))continue;
      const score=this.scoreAsset(cq,ws,a);
      if(score>0)results.push({type:'asset',score,asset:a,title:a.label||a.structure||a.equip||a.line||'Asset',subtitle:this.subtitle(a),kind:a.kind||'asset'});
    }
    const poleSpecific=this.queryHasPoleSpecificNumber(cq,ws);
    results.sort((a,b)=>{
      const aKind=String(a.kind||a.asset?.kind||'');
      const bKind=String(b.kind||b.asset?.kind||'');
      const aRefLevel=this.referenceQueryMatchLevel(a.asset,cq,ws);
      const bRefLevel=this.referenceQueryMatchLevel(b.asset,cq,ws);
      const aPrioritySub=a.type==='asset'&&/^(substation|depot|terminal)$/.test(aKind)&&aRefLevel>=3;
      const bPrioritySub=b.type==='asset'&&/^(substation|depot|terminal)$/.test(bKind)&&bRefLevel>=3;
      if(aPrioritySub!==bPrioritySub)return aPrioritySub?-1:1;
      if(aPrioritySub&&bPrioritySub&&aRefLevel!==bRefLevel)return bRefLevel-aRefLevel;
      if(!poleSpecific&&a.type!==b.type){
        if(a.type==='circuit')return -1;
        if(b.type==='circuit')return 1;
      }
      return b.score-a.score||String(a.title).localeCompare(String(b.title));
    });
    const bareCircuitStem=this.isBareCircuitStemQuery(cq,ws);
    const hasPriorityReference=results.some(r=>this.isHighPriorityReferenceSearchResult(r,cq,ws));
    const hasStemCircuit=bareCircuitStem&&results.some(r=>r.type==='circuit'&&this.scoreLine(cq,ws,r.group||{line:r.line,rawLine:r.line})>=80);
    if(hasStemCircuit&&!hasPriorityReference){
      results=results.filter(r=>r.type==='circuit');
    }
    const seen=new Set(), out=[];
    for(const r of results){
      if(resultFilter&&!resultFilter(r))continue;
      const k=this.resultDedupKey(r);
      if(k&&seen.has(k))continue;
      if(k)seen.add(k);
      out.push(r);
      if(out.length>=limit)break;
    }
    return out;
  },
  queryPoleIdCandidates(query,ws){
    const text=String(query||'');
    const parts=Array.isArray(ws)?ws:this.words(text);
    const out=[];
    const add=(p)=>{
      p=typeof p==='object'?p:this.parsePoleToken(p);
      if(!p)return;
      if(!out.some(x=>x.norm===p.norm))out.push(p);
    };
    for(const w of parts){
      const cw=this.compact(w);
      if(/^0*\d{1,6}[A-Z]{0,3}$/i.test(cw))add(cw);
      const trailing=cw.match(/(\d{1,6}[A-Z]{0,3})$/i);
      if(trailing&&/[A-Z]/.test(cw.slice(0,trailing.index)))add(trailing[1]);
    }
    const compact=this.compact(text);
    const tail=compact.match(/(\d{1,6}[A-Z]{0,3})$/i);
    if(tail)add(tail[1]);
    // For compact circuit+pole input, add likely tail ids too:
    // Compact line+structure text should include the trailing structure as a candidate.
    const m=compact.match(/^([A-Z]{2,12})(\d{3,8})([A-Z]{0,3})$/i);
    if(m){
      const digits=m[2], suffix=m[3]||'';
      for(const len of [5,4,3,2,1]){
        if(digits.length>len)add(digits.slice(-len)+suffix);
      }
    }
    const m2=text.match(/[-_\s](0*\d{1,6}[A-Z]{0,3})\s*$/i);
    if(m2)add(m2[1]);
    return out;
  },
  queryNumberParts(query,ws){
    return this.queryPoleIdCandidates(query,ws).map(p=>p.norm);
  },
  queryPoleNumberCandidates(query,ws){
    return this.queryPoleIdCandidates(query,ws).map(p=>String(p.num)).filter((n,i,arr)=>n&&arr.indexOf(n)===i);
  },
  queryHasPoleSpecificNumber(query,ws){
    const text=String(query||'');
    const parts=Array.isArray(ws)?ws:this.words(text);
    const hasAlpha=parts.some(w=>/[A-Z]/i.test(String(w||'')));
    const ids=this.queryPoleIdCandidates(text,parts);
    return ids.length>0&&(hasAlpha||/[-_\s]0*\d{1,6}[A-Z]{0,3}$/i.test(text));
  },
  scoreLine(cq,ws,g){
    const cl=this.compact(g.line), raw=this.compact(g.rawLine||''); let s=0;
    const q=String(cq||'');
    if(!q)return 0;
    const poleSpecific=this.queryHasPoleSpecificNumber(q,ws);
    // Circuit/route hits must rank above individual structures when the user types a circuit stem
    // typed route stem. Pole-specific searches still favour the exact asset.
    const strongBase=poleSpecific?80:900;
    if(cl===q||raw===q)s+=strongBase+120;
    if(cl.startsWith(q)||raw.startsWith(q))s+=strongBase+95;
    if(cl.includes(q)||raw.includes(q))s+=strongBase+75;
    for(const w of ws){
      const cw=this.compact(w);
      if(!cw||cw.length<2||/^\d{1,2}$/.test(cw))continue;
      if((cl===cw||raw===cw)&&!poleSpecific)s+=180;
      else if(cl.startsWith(cw)||raw.startsWith(cw))s+=poleSpecific?14:55;
      else if(cl.includes(cw)||raw.includes(cw))s+=poleSpecific?10:35;
    }
    return s;
  },
  scoreAsset(cq,ws,a){
    const doc=this.buildSearchDoc(a);
    const compactFields=doc.compactFields||[];
    const searchCompact=doc.searchCompact||'';
    let s=0;
    if(compactFields.some(f=>f===cq))s+=120;
    if(compactFields.some(f=>f.startsWith(cq)))s+=92;
    if(compactFields.some(f=>f.includes(cq)))s+=75;
    if(searchCompact.includes(cq))s+=35;
    for(const w of ws){
      const cw=this.compact(w); if(!cw)continue;
      if(compactFields.some(f=>f===cw))s+=16;
      else if(compactFields.some(f=>f.includes(cw)))s+=12;
      else if(searchCompact.includes(cw))s+=5;
    }
    // Direct structure searches must put the exact structure above
    // the first structure on the same circuit.  Match the typed number against
    // line/nameplate references after stripping leading zeroes.
    const qPoles=this.queryPoleIdCandidates(cq,ws);
    if(qPoles.length){
      const actualPoles=[];
      const addPole=(v)=>{
        const p=this.poleIdParts(v);
        if(p&&!actualPoles.some(x=>x.norm===p.norm))actualPoles.push(p);
      };
      addPole(a?.poleNumber);
      addPole(a?.label);
      addPole(a?.structure);
      for(const r of this.lineRefsForAsset(a,true))addPole(r.pole);
      const exactPole=qPoles.some(qp=>actualPoles.some(ap=>this.poleIdMatches(ap.norm,qp)));
      const exactSuffixPole=qPoles.some(qp=>qp.suffix&&actualPoles.some(ap=>ap.num===qp.num&&ap.suffix===qp.suffix));
      if(exactPole){
        s+=1250+(exactSuffixPole?650:0);
        const alphaTerms=(Array.isArray(ws)?ws:[]).map(w=>this.compact(w)).filter(w=>/[A-Z]/.test(w));
        const lineText=this.compact([a?.line,a?.gisLabel,a?.label,a?.structure,...(this.lineAliasesForAsset(a)||[])].join(' '));
        if(alphaTerms.length&&alphaTerms.some(t=>t&&lineText.includes(t)))s+=550;
        // Extra boost when compact search glues line + structure together so
        // the exact structure is favoured over neighbouring structures.
        const qCompact=this.compact(cq);
        if(qCompact&&lineText.includes(qCompact))s+=900;
        for(const qp of qPoles){
          for(const alias of [a?.label,a?.structure,a?.gisLabel,...(this.lineAliasesForAsset(a)||[])]){
            const ac=this.stripZeros(alias||'');
            if(ac&&ac.includes(qp.norm))s+=120;
          }
        }
      }
    }
    const raw=a?.raw||{};
    const abbr=this.compact(raw.ABBREVIATION||raw.abbreviation||'');
    const searchField=this.compact(raw.SEARCH_FIELD||'');
    const refLevel=this.referenceQueryMatchLevel(a,cq,ws);
    if(abbr&&abbr===cq)s+=820;
    if(refLevel>=4)s+=680;
    else if(refLevel>=3)s+=520;
    else if(refLevel>=2)s+=180;
    else if(refLevel>=1)s+=75;
    if(searchField&&searchField.includes(cq)&&/^(substation|depot|terminal)$/.test(String(a.kind||'')))s+=80;
    if(this.isConductorSpanAsset(a)&&!/(CONDUCTOR|HURDLES|TRITON|SATURN|SELENIUM|OPGW|EARTH|WIRE|STRUNG|^[0-9]+\/)/i.test(String(cq||'')+' '+(Array.isArray(ws)?ws.join(' '):''))){s=Math.min(s,65);}
    if(s<=0)return 0;
    if(Number.isFinite(a.lat)&&Number.isFinite(a.lon))s+=4;
    if(a.sourceType==='json'||a.sourceType==='merged')s+=3;
    return s;
  },
  passesFilters(a){
    const f=App.filters||{};
    if(a.sourceType==='json'&&!f.json)return false;
    if(a.sourceType==='geojson'&&!f.geojson)return false;
    if(a.sourceType==='csv'&&!f.csv)return false;
    if(a.sourceType==='merged'&&!(f.json||f.geojson))return false;
    const kind=a.kind||'structure';
    if(kind==='structure'&&!f.structures)return false;
    if(kind==='circuit'&&!f.circuits)return false;
    if((kind==='substation'||kind==='depot'||kind==='terminal')&&!f.substations)return false;
    if(kind==='transformer'&&!f.transformers)return false;
    if(kind==='streetlight'&&!f.streetlights)return false;
    if(kind==='electrical-enclosure'&&f.streetlights===false)return false;
    if(kind==='dx-pole'&&!f.dxPoles)return false;
    if(kind==='note'&&!f.notes)return false;
    if(kind==='hv-crossing')return false;
    if(/^utility-/i.test(kind)){
      if(!f.utilities)return false;
      const type=kind.replace(/^utility-/i,'');
      const key=window.UtilitiesEngine?.filterKey?window.UtilitiesEngine.filterKey(type):('utility'+type.charAt(0).toUpperCase()+type.slice(1));
      if(!f[key])return false;
    }
    return true;
  },
  displayClean(v){
    let text=String(v ?? '').trim();
    // Converter-wrapped TXT rows can leave quoted/comma suffixes in raw values.
    text=text.replace(/^[\s"']+|[\s"',]+$/g,'');
    text=text.replace(/^null$/i,'');
    return this.cleanText(text);
  },
  rawClean(raw,names){
    return this.displayClean(this.rawValue(raw||{},names||[]));
  },
  tidyStructureType(a){
    const raw=a?.raw||{};
    let t=this.displayClean(a?.structureType)||this.rawClean(raw,['STRUC_TYP_DESC','STRUCTURE_TYPE','Structure Type Description','pole_type','POLE_TYPE']);
    if(!t)t=this.rawClean(raw,['STRUC_CAT_DESC','SUB_STRUC_DESC']);
    if(!t)t=this.displayClean(a?.category);
    t=t.replace(/\bO\.?H\.?E\.?\b/ig,'').replace(/\s+/g,' ').trim();
    // Drop generic wrapping labels; keep useful field structure names such as Fir Tree, Delta, Vertical, Crossarm/Buckarm.
    t=t.replace(/^Trans(?:mission)?\s+Structure\s*[-–—:]?\s*/i,'').trim();
    t=t.replace(/^Structure\s*[-–—:]?\s*/i,'').trim();
    t=t.replace(/\s*-\s*\(([^)]+)\)\s*$/,'');
    if(/^(transmission|trans|structure|pole|point|geometry|multi point|suspension structure|termination structure|strain structure)$/i.test(t))return '';
    return t;
  },
  tidyPoleType(a){
    const raw=a?.raw||{};
    const vals=[
      this.rawClean(raw,['EQUIP_GRP_ID_DESC','EQUIP_GRP_DESC']),
      this.displayClean(a?.material),
      this.rawClean(raw,['MATRL_TYP_DESC','MATERIAL','Material']),
      this.rawClean(raw,['SUB_STRUC_DESC'])
    ].filter(Boolean);
    const joined=vals.join(' ').toUpperCase();
    if(/WOOD/.test(joined))return 'Wood';
    if(/STEEL/.test(joined))return /GANTRY/.test(joined)?'Steel Gantry':'Steel';
    if(/CONCRETE/.test(joined))return 'Concrete';
    if(/COMPOSITE|FIBRE|FIBER/.test(joined))return 'Composite';
    if(/LATTICE|TOWER/.test(joined))return 'Tower';
    let t=vals[0]||vals[1]||'';
    t=t.replace(/^Trans(?:mission)?\s+Structure\s*[-–—:]?\s*/i,'').replace(/\s+Pole$/i,'').trim();
    return t;
  },
  tidyPoleLength(a){
    const raw=a?.raw||{};
    const v=this.displayClean(a?.poleLength)||this.rawClean(raw,['POLE_LEN_M','POLE_LENGTH','Pole Length','Pole Length (m)','LEN_M']);
    const n=Number(String(v).replace(/[^0-9.\-]/g,''));
    if(!Number.isFinite(n)||n<=0||n>120)return '';
    return (Math.abs(n-Math.round(n))<0.05?String(Math.round(n)):String(Number(n.toFixed(1))))+'m';
  },
  tidyConductorName(v){
    let text=this.displayClean(v);
    if(!text||/^null$/i.test(text))return '';
    // Prefer the field name in brackets: 54/7/3.5 - (HURDLES) -> HURDLES.
    const m=text.match(/\(([^()]{2,40})\)\s*$/);
    if(m)text=m[1];
    text=text.replace(/^REFER\s+COMMENTS\s*-\s*/i,'').trim();
    text=text.replace(/^CONDUCTOR\s*[:=-]\s*/i,'').trim();
    if(/^(NULL|NIL|NONE)$/i.test(text))return '';
    return text;
  },
  conductorSubtitleForAsset(a){
    if(!a||this.isConductorSpanAsset(a))return '';
    const links=this.conductorLinksForAsset?.(a)||[];
    const vals=[];
    const add=(v)=>{
      v=this.tidyConductorName(v);
      if(!v)return;
      const c=this.compact(v);
      if(c&&!vals.some(x=>this.compact(x)===c))vals.push(v);
    };
    for(const link of links){
      const primary=(link.bits||[]).find(b=>/^Conductor$/i.test(String(b.label||'')));
      add(primary?.value||String(link.conductor||'').split('·')[0]);
      if(vals.length>=2)break;
    }
    if(!vals.length){
      const raw=a.raw||{};
      add(a.conductor||raw.CONDUCTOR_ID_DESC||raw.CONDUCTOR);
    }
    return vals.slice(0,2).join(' / ');
  },
  structureSubtitle(a){
    const vals=[];
    const add=(v)=>{
      v=this.displayClean(v);
      if(!v||/POINT|GEOMETRY|MULTI/i.test(v))return;
      const cv=this.compact(v);
      if(!cv||vals.some(x=>{const cx=this.compact(x); return cx===cv||cx.includes(cv)||cv.includes(cx);} ))return;
      vals.push(v);
    };
    add(this.tidyStructureType(a));
    add(this.tidyPoleType(a));
    add(this.tidyPoleLength(a));
    add(this.conductorSubtitleForAsset(a));
    return vals.slice(0,4).join(' · ');
  },
  isBareCircuitStemQuery(cq,ws){
    const parts=Array.isArray(ws)?ws:[];
    const joined=this.compact(parts.join(''));
    const q=this.compact(cq||joined);
    if(!q||/\d/.test(q)||q.length<3||q.length>12)return false;
    if(!/[A-Z]/.test(q))return false;
    // Alphabetic route stems are circuit stems, not pole numbers.
    return true;
  },
  referenceSubtitle(a){
    if(!a)return '';
    const kind=this.referenceKind?this.referenceKind(a):String(a.kind||'').toLowerCase();
    if(!/^(substation|depot|terminal)$/i.test(String(a.kind||kind||''))&&!this.isReferencePointAsset?.(a))return '';
    // Depots are not electrical connection points and do not have circuit abbreviations.
    if(kind==='depot')return '';
    const codes=this.referenceCodeCandidates?this.referenceCodeCandidates(a):[];
    if(codes&&codes.length)return codes[0];
    const raw=a.raw||{};
    const name=this.cleanText(raw.SUBSTATION||raw.SUBSTATION_NAME||raw.TERMINAL||raw.TERMINAL_NAME||a.substation||a.terminal||a.label||'');
    const initials=name.split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase();
    return initials.length>1?initials:(initials||'');
  },
  subtitle(a){
    const refSub=this.referenceSubtitle(a);
    if(refSub)return refSub;
    if(String(a?.kind||'').toLowerCase()==='transformer'){
      const raw=a.raw||{};
      const vals=[];
      const add=(v)=>{v=this.cleanText(v); if(v&&!vals.some(x=>this.compact(x)===this.compact(v)))vals.push(v);};
      add(a.address);
      add(raw.ROAD_NAME||raw.STREET_NAME||raw.ADDRESS||raw.ADDRESS_FULL||raw.LOCATION);
      add(a.equip&&this.compact(a.equip)!==this.compact(a.label)?a.equip:'');
      add(a.category&&!/POINT|GEOMETRY|MULTI/i.test(String(a.category))?a.category:'');
      return vals.slice(0,2).join(' · ');
    }
    const kind=String(a?.kind||'').toLowerCase();
    if(kind==='electrical-enclosure')return [a.equip,a.category].filter(Boolean).join(' · ');
    if(kind==='structure'||a?.poleNumber||this.lineRefsForAsset(a,true).length){
      return this.structureSubtitle(a);
    }
    const parts=[];
    if(a.equip&&!a.gisLabel)parts.push(a.equip);
    if(a.category&&!/POINT/i.test(String(a.category)))parts.push(a.category);
    if(!Number.isFinite(a.lat)||!Number.isFinite(a.lon)){ if(a.kind!=='circuit')parts.push('No map point'); }
    return parts.filter(Boolean).join(' · ');
  },

  audit(){
    const assets=App.assets||[];
    const filters=App.filters||{};
    const countBy=(fn)=>assets.reduce((m,a)=>{const k=fn(a)||'blank';m[k]=(m[k]||0)+1;return m;},{});
    const hidden=[];
    const hiddenByKind={};
    const hiddenBySource={};
    for(const a of assets){
      const visible=this.passesFilters(a);
      if(!visible){
        hidden.push(a);
        const k=a.kind||'structure'; hiddenByKind[k]=(hiddenByKind[k]||0)+1;
        const s=a.sourceType||'unknown'; hiddenBySource[s]=(hiddenBySource[s]||0)+1;
      }
    }
    const noGps=assets.filter(a=>!Number.isFinite(a.lat)||!Number.isFinite(a.lon));
    const withGps=assets.length-noGps.length;
    const byFile=countBy(a=>a.sourceFile||'unknown');
    const fileRows=Object.entries(byFile).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([file,count])=>({file,count}));
    const byLine=countBy(a=>a.line||a.substation||'');
    const lineRows=Object.entries(byLine).filter(([k])=>k&&k!=='blank').sort((a,b)=>b[1]-a[1]).slice(0,25).map(([line,count])=>({line,count}));
    const kindCounts=countBy(a=>a.kind||'structure');
    const sourceCounts=countBy(a=>a.sourceType||'unknown');
    const mergedCount=assets.filter(a=>a.sourceType==='merged'||(Array.isArray(a.sources)&&a.sources.length>1)).length;
    const indexStats=this.indexStats||{};
    const dbMeta=App.dbMeta||{};
    const dbNeedsRebuild=!!App.dbNeedsRebuild;
    const lastFiles=(App.files||[]).slice().reverse().map(f=>({
      name:f.name,type:f.type,size:f.size,featuresRead:f.featuresRead||0,assetsIndexed:f.count||f.assetsIndexed||0,skipped:f.skipped||0,mode:f.mode||''
    }));
    const currentViewStats=window.MapEngine?.currentViewStats?.()||null;
    return {
      totalAssets:assets.length,withGps,noGps:noGps.length,hiddenByCurrentFilters:hidden.length,hiddenByKind,hiddenBySource,currentViewStats,
      kindCounts,sourceCounts,mergedCount,indexStats,dbMeta,dbNeedsRebuild,filters,loadedFiles:lastFiles,topFiles:fileRows,topLines:lineRows,
      noGpsSamples:noGps.slice(0,12).map(a=>({title:a.label||a.structure||a.equip||a.line,kind:a.kind,source:a.sourceType,line:a.line,file:a.sourceFile})),
      hiddenSamples:hidden.slice(0,12).map(a=>({title:a.label||a.structure||a.equip||a.line,kind:a.kind,source:a.sourceType,line:a.line,file:a.sourceFile}))
    };
  },
  auditText(){
    const a=this.audit();
    const lines=[];
    lines.push(`Total assets: ${a.totalAssets.toLocaleString()}`);
    lines.push(`Mapped: ${a.withGps.toLocaleString()} | No map point: ${a.noGps.toLocaleString()}`);
    lines.push(`Hidden by current filters: ${a.hiddenByCurrentFilters.toLocaleString()}`);
    lines.push(`Merged JSON+GeoJSON records: ${a.mergedCount.toLocaleString()}`);
    lines.push(`Search index: ${Number(a.indexStats.assetsIndexed||0).toLocaleString()} assets · ${Number(a.indexStats.tokenCount||0).toLocaleString()} tokens · ${Number(a.indexStats.spatialCells||0).toLocaleString()} map cells · ${Number(a.indexStats.ms||0).toLocaleString()}ms`);
    lines.push(`Database parser: ${(a.dbMeta&&a.dbMeta.schema&&a.dbMeta.schema.parser)||'unknown'}${a.dbNeedsRebuild?' · REBUILD RECOMMENDED':''}`);
    if(a.currentViewStats){
      lines.push(`Current map view assets: ${Number(a.currentViewStats.total||0).toLocaleString()} total | ${Number(a.currentViewStats.visible||0).toLocaleString()} visible | ${Number(a.currentViewStats.hidden||0).toLocaleString()} hidden by filters`);
    }
    lines.push('');
    lines.push('Source counts: '+JSON.stringify(a.sourceCounts));
    lines.push('Kind counts: '+JSON.stringify(a.kindCounts));
    lines.push('Hidden by source: '+JSON.stringify(a.hiddenBySource));
    lines.push('Hidden by kind: '+JSON.stringify(a.hiddenByKind));
    lines.push('');
    lines.push('Loaded files:');
    for(const f of a.loadedFiles)lines.push(`- ${f.name}: features ${Number(f.featuresRead||0).toLocaleString()}, indexed ${Number(f.assetsIndexed||0).toLocaleString()}, skipped ${Number(f.skipped||0).toLocaleString()}, mode ${f.mode||''}`);
    lines.push('');
    lines.push('Top files:');
    for(const f of a.topFiles)lines.push(`- ${f.file}: ${Number(f.count).toLocaleString()}`);
    lines.push('');
    lines.push('Top routes:');
    for(const l of a.topLines)lines.push(`- ${l.line}: ${Number(l.count).toLocaleString()}`);
    return lines.join('\n');
  },
  recoveryAssetAllowed(a){
    if(!a||typeof a!=='object'||a.inferredMissingStructure)return false;
    if(this.isUtilityAsset?.(a)||this.isHVCrossingAsset?.(a)||this.isConductorSpanAsset?.(a))return false;
    const kind=String(a.kind||'').toLowerCase();
    if(kind==='substation'||kind==='terminal'||kind==='depot'||kind==='transformer'||kind==='dx-pole'||kind==='distribution-pole'||kind==='streetlight'||kind==='electrical-enclosure')return false;
    return true;
  },
  detailScore(a){
    if(!a||typeof a!=='object')return -1;
    const rawCount=Object.keys(a.raw||{}).length;
    let score=rawCount;
    if(a.poleHeight)score+=20;
    if(a.poleLength)score+=20;
    if(a.material)score+=15;
    if(a.category)score+=10;
    const raw=a.raw||{};
    const keys=Object.keys(raw).join(' ');
    if(/STRUC.*TYP|POLE.*HEIGHT|POLE.*LEN|MATRL|MATERIAL|NP_DWG|DRAWING|DWG/i.test(keys))score+=30;
    if(Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)))score+=5;
    if(a.publicRecovery||a.sourceQuality==='public-recovery-real-gps')score-=10;
    return score;
  },
  poleLookupKey(line,pole){
    const lk=this.compact(this.formatCircuitName(line)||line);
    const pk=this.stripZeros(pole||'');
    return lk&&pk?`${lk}|${pk}`:'';
  },
  addPoleDetailIndex(a,stable=''){
    if(!this.poleDetailMap)this.poleDetailMap=new Map();
    if(!this.recoveryAssetAllowed(a))return;
    const refs=this.lineRefsForAsset?.(a,true)||[];
    for(const r of refs){
      const key=this.poleLookupKey(r.line,r.pole||a.poleNumber||'');
      if(!key)continue;
      const prev=this.poleDetailMap.get(key);
      const score=this.detailScore(a);
      if(!prev||score>prev.score)this.poleDetailMap.set(key,{asset:a,score,id:stable||a.id||''});
    }
  },
  ensurePoleDetailIndex(){
    this.ensureIndexContainers();
    if(this.poleDetailMapBuilt)return;
    this.poleDetailMap=new Map();
    const assets=Array.isArray(App?.assets)?App.assets:[];
    for(let i=0;i<assets.length;i++){
      const a=assets[i];
      try{this.addPoleDetailIndex(a,this.assetStableId?this.assetStableId(a,i):(a?.id||String(i)));}catch(e){}
    }
    this.poleDetailMapBuilt=true;
  },
  findDetailAsset(line,pole,current=null){
    try{
      const currentRaw=Object.keys(current?.raw||{}).length;
      const currentHasCore=current&&!current.inferredMissingStructure&&currentRaw>6&&(current.poleHeight||current.poleLength||current.material||current.category);
      if(currentHasCore)return current;
      this.ensurePoleDetailIndex();
      const key=this.poleLookupKey(line,pole);
      const hit=key?this.poleDetailMap.get(key):null;
      return hit?.asset||current||null;
    }catch(e){return current||null;}
  },

  scanLineAssets(line){
    const target=this.compact(this.formatCircuitName(line)||line);
    if(!target)return [];
    this.ensureIndexContainers();
    const assets=Array.isArray(App?.assets)?App.assets:[];
    const stamp=`${assets.length}|${this.indexedAssetIds?.size||0}`;
    const cached=this.recoveryLineCache.get(target);
    if(cached&&cached.stamp===stamp)return cached.assets;
    const out=[];
    const seen=new Set();
    for(let i=0;i<assets.length;i++){
      const a=assets[i];
      if(!a||typeof a!=='object')continue;
      try{
        if(!this.recoveryAssetAllowed(a))continue;
        let matched=false;
        const refs=this.lineRefsForAsset?.(a,true)||[];
        for(const r of refs){if(this.compact(r.line)===target){matched=true;break;}}
        if(!matched&&this.compact(this.formatCircuitName(a.line||'')||a.line||'')===target)matched=true;
        if(!matched)continue;
        const id=this.assetStableId?this.assetStableId(a,i):(a.id||[a.sourceFile,a.sourcePath,a.line,a.structure,a.poleNumber,a.lat,a.lon,i].join('|'));
        if(seen.has(id))continue;
        seen.add(id);
        out.push(a);
      }catch(e){}
    }
    const sorted=out.sort(this.sortByStructure);
    this.recoveryLineCache.set(target,{stamp,assets:sorted});
    return sorted;
  },
  lineAssets(line){
    const key=this.compact(this.formatCircuitName(line)||line);
    const g=this.lineMap.get(key)||this.lineMap.get(this.compact(line));
    const normal=g&&Array.isArray(g.assets)?g.assets:[];
    const confirmed=normal.filter(a=>a&&!a.inferredMissingStructure);
    if(confirmed.length>=2)return normal;
    const fallback=this.scanLineAssets(line);
    if(fallback.length>normal.length){
      try{Diagnostics?.log?.('Line asset fallback',`${line}: recovered ${fallback.length} imported pole/tower record(s) by scanning loaded assets.`);}catch(e){}
      return fallback;
    }
    return normal;
  },
  lineCircuitAssets(line){
    const key=this.compact(this.formatCircuitName(line)||line);
    const g=this.lineMap.get(key)||this.lineMap.get(this.compact(line));
    return g?g.routeAssets:[];
  }
};
if(typeof window!=='undefined')window.SearchEngine=SearchEngine;
