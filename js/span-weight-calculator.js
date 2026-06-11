/* myMap Span Weight + Pull / Unload Calculator · V3.1.57
   Adds load selector: phase conductor / twin phase conductor / earth wire / all conductors.
   Adds task selector: start moving conductor vs unload/lift insulator string.
   Final conductor/calculator pass: keeps calculators separated, adds cached conductor/line lookups,
   keeps angle-pull rigging only in Angle pull-back, and retains line-angle options such as 90, 130 and 180 degrees.
*/
(function(){
  "use strict";
  let SPEC_LOOKUP = window.FieldMapConductorSpecs || {};
  function refreshSpecLookup(){
    SPEC_LOOKUP = (window.FieldMapConductorSpecs && typeof window.FieldMapConductorSpecs === "object") ? window.FieldMapConductorSpecs : (SPEC_LOOKUP || {});
    return SPEC_LOOKUP;
  }
  function setSpecs(specs){
    SPEC_LOOKUP = (specs && typeof specs === "object") ? specs : {};
    window.FieldMapConductorSpecs = SPEC_LOOKUP;
    invalidateCalculatorCaches();
    try{ if(window.FieldMapSpanWeightCalculator) window.FieldMapSpanWeightCalculator.specs = SPEC_LOOKUP; }catch(e){}
    return SPEC_LOOKUP;
  }
  const STORAGE_KEY = "fieldMap.conductorSections.v1";
  const ASSET_CACHE = new Map();
  const ASSET_TTL_MS = 20 * 60 * 1000;
  let SECTION_CACHE_KEY = "";
  let SECTION_CACHE = [];
  const LINE_ASSET_CACHE = new Map();
  const LINE_ASSET_TTL_MS = 5 * 60 * 1000;
  function invalidateCalculatorCaches(){
    SECTION_CACHE_KEY = "";
    SECTION_CACHE = [];
    LINE_ASSET_CACHE.clear();
  }
  let CURRENT_WEIGHT_ASSET = null;
  let CURRENT_WEIGHT_LINE = "";
  let CURRENT_PULL_ASSET = null;
  let CURRENT_PULL_LINE = "";
  let CURRENT_ANGLE_PULL_ASSET = null;
  let CURRENT_ANGLE_PULL_LINE = "";
  let CURRENT_STRUCTURE_ROLE_OVERRIDE = "auto";
  let CURRENT_STRUCTURE_ROLE_CONTEXT = "";

  function esc(s){return String(s ?? "").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
  function clean(s){return String(s ?? "").replace(/^\uFEFF/,"").replace(/\\+/g,"").replace(/\s*,+\s*$/g,"").replace(/\s+/g," ").replace(/\s*-\s*/g," - ").trim();}
  function compact(s){return clean(s).toUpperCase().replace(/&/g," AND ").replace(/[^A-Z0-9]+/g,"");}
  function n(v, fallback=NaN){const x=Number(String(v ?? "").replace(/[^0-9.\-]/g,"")); return Number.isFinite(x)?x:fallback;}
  function fmtKg(v){const x=Number(v); return Number.isFinite(x)?`${Math.round(x).toLocaleString()} kg`:"Unknown";}
  function fmtM(v){const x=Number(v); return Number.isFinite(x)?(x>=1000?`${(x/1000).toFixed(2)} km`:`${Math.round(x).toLocaleString()} m`):"Unknown";}
  function fmtT(v){const x=Number(v); return Number.isFinite(x)?(x>=1000?`${(x/1000).toFixed(2)} t`:`${Math.round(x).toLocaleString()} kg`):"Unknown";}
  function pick(obj, keys){
    obj=obj||{}; const all=Object.keys(obj); const nk=k=>String(k||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    for(const key of keys||[]){const wanted=nk(key); const found=all.find(k=>nk(k)===wanted); if(found&&obj[found]!=null&&clean(obj[found])!=="")return obj[found];}
    for(const key of keys||[]){const wanted=nk(key); const found=all.find(k=>nk(k).includes(wanted)); if(found&&obj[found]!=null&&clean(obj[found])!=="")return obj[found];}
    return "";
  }
  function formatLine(line){try{return window.SearchEngine?.formatCircuitName?.(line)||clean(line);}catch(e){return clean(line);}}
  function lineKey(line){try{return window.SearchEngine?.compact?.(formatLine(line))||compact(formatLine(line));}catch(e){return compact(formatLine(line));}}
  function stripZeros(s){try{return window.SearchEngine?.stripZeros?.(s)||compact(s);}catch(e){return compact(String(s||"").replace(/^0+/,""));}}
  function lineMatches(a,b){const A=lineKey(a),B=lineKey(b); if(!A||!B)return false; return A===B || (A.length>5&&B.includes(A)) || (B.length>5&&A.includes(B));}

  function parseLabel(label){
    const s=clean(label);
    let m=s.match(/^(.+?\b[A-Z0-9]*\d[A-Z0-9]{0,4})[\s_\-]+(\d{1,5}[A-Z]?(?:\/\d{1,5}[A-Z]?)?)$/i);
    if(m)return {line:formatLine(m[1]),plate:m[2]};
    m=s.match(/^(.+)-(\d{1,5}[A-Z]?(?:\/\d{1,5}[A-Z]?)?)$/i);
    if(m)return {line:formatLine(m[1]),plate:m[2]};
    return {line:"",plate:""};
  }
  function refsForAsset(asset){
    try{
      const refs=window.SearchEngine?.lineRefsForAsset?.(asset,true)||[];
      if(Array.isArray(refs)&&refs.length)return refs.map(r=>({line:formatLine(r.line),pole:clean(r.pole)})).filter(r=>r.line);
    }catch(e){}
    const raw=asset?.raw||asset?.properties||asset||{};
    const label=pick(raw,["TRMSN_LINE_GIS_LABEL","STRUCTURE_LABEL","LINE_STRUCTURE","GIS_LABEL"])||asset?.gisLabel||asset?.label||asset?.structure||"";
    const parsed=parseLabel(label);
    const line=formatLine(asset?.line||pick(raw,["LINE_NAME","CIRCUIT","LINE","ROUTE_NAME"])||parsed.line);
    const pole=clean(asset?.poleNumber||asset?.pole||pick(raw,["NAMEPLATE_ID","POLE_NUMBER","POLE_NO","STRUCTURE_NO","FIRST_NAME_PLATE_ID","LAST_NAME_PLATE_ID"])||parsed.plate);
    return line?[{line,pole}]:[];
  }
  function conductorFromAsset(asset){
    const raw=asset?.raw||asset?.properties||asset||{};
    let val=asset?.conductor||pick(raw,["CONDUCTOR_ID_DESC","CONDUCTOR","CONDUCTOR_TYPE","CONDUCTOR_SIZE","PHASE_CONDUCTOR","COND_TYPE","COND_SIZE"]);
    if(val)return clean(val);
    try{
      const links=window.SearchEngine?.conductorLinksForAsset?.(asset)||[];
      for(const l of links){
        const bit=(l.bits||[]).find(b=>/^conductor$/i.test(String(b.label||"")));
        if(bit?.value)return clean(bit.value);
        if(l.conductor)return clean(String(l.conductor).split(/·|;/)[0]);
      }
    }catch(e){}
    return "";
  }
  function assetInfo(asset, preferredLine=""){
    const raw=asset?.raw||asset?.properties||asset||{};
    const refs=refsForAsset(asset);
    let ref=(preferredLine&&refs.find(r=>lineMatches(r.line,preferredLine)))||refs.find(r=>r.pole)||refs[0]||{line:"",pole:""};
    const label=pick(raw,["TRMSN_LINE_GIS_LABEL","STRUCTURE_LABEL","LINE_STRUCTURE","GIS_LABEL"])||asset?.gisLabel||asset?.label||asset?.structure||"";
    const parsed=parseLabel(label);
    const lat=n(asset?.lat ?? asset?.latitude ?? raw.LATITUDE ?? raw.latitude, NaN);
    const lng=n(asset?.lng ?? asset?.lon ?? asset?.longitude ?? raw.LONGITUDE ?? raw.longitude, NaN);
    const line=formatLine(ref.line||asset?.line||pick(raw,["LINE_NAME","CIRCUIT","LINE","ROUTE_NAME"])||parsed.line);
    const plate=clean(ref.pole||asset?.poleNumber||asset?.pole||pick(raw,["NAMEPLATE_ID","POLE_NUMBER","POLE_NO","STRUCTURE_NO","FIRST_NAME_PLATE_ID","LAST_NAME_PLATE_ID"])||parsed.plate);
    return {asset,raw,line,plate,lat,lng,conductor:conductorFromAsset(asset)};
  }
  const STRUCTURE_ROLES={
    auto:{id:'auto',label:'Auto-detect from import data',note:'Uses the imported structure description if one is available.'},
    intermediate:{id:'intermediate',label:'Intermediate / suspension',note:'Best match for the simple span-weight method: roughly half the previous span plus half the next span.'},
    angle:{id:'angle',label:'Angle / deviation',note:'Dead-load support guide only. Angles can add side load and binding depending on line angle, hardware and rigging direction.'},
    termination:{id:'termination',label:'Termination / strain / dead-end',note:'Minimum dead-load style guide only. Termination/strain structures can involve conductor tension, side load and hardware effects this quick calculator cannot prove.'},
    unknown:{id:'unknown',label:'Unknown / check structure',note:'Imported data is not reliable enough. Check the actual structure before using the number.'}
  };
  function structureRoleOptions(selected){
    const ids=['auto','intermediate','angle','termination','unknown'];
    return ids.map(id=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(STRUCTURE_ROLES[id].label)}</option>`).join('');
  }
  function manualStructureRole(id){
    const r=STRUCTURE_ROLES[id]||null;
    if(!r||id==='auto')return null;
    return {id:r.id,label:r.label,note:r.note,manual:true};
  }
  function detectStructureRole(asset){
    const raw=asset?.raw||asset?.properties||asset||{};
    const bits=[asset?.category,asset?.kind,asset?.label,asset?.gisLabel,asset?.structure,raw.STRUC_TYP_DESC,raw.SUB_STRUC_DESC,raw.STRUC_CAT_DESC,raw.STRUCTURE_TYPE,raw.POLE_TYPE,raw.ASSET_TYPE,Object.values(raw).slice(0,45).join(' ')];
    const text=bits.map(v=>String(v||'')).join(' ').toUpperCase();
    if(/TERMINAT|DEAD\s*END|DEADEND|STRAIN|ANCHOR|TENSION/.test(text)){
      return {id:'termination',label:'Termination / strain / dead-end',note:'Treat the result as a minimum dead-load support guide only. Termination/strain structures can add conductor tension, side load, binding and hardware effects that this quick calculator cannot prove.'};
    }
    if(/ANGLE|DEVIAT|CORNER|DEFLECT/.test(text)){
      return {id:'angle',label:'Angle / deviation',note:'Treat the result as a dead-load support guide only. Angle structures can add side load and binding depending on line angle, hardware and rigging direction.'};
    }
    if(/SUSPENSION|INTERMEDIATE|TANGENT|STRAIGHT|TIE\s*IN/.test(text)){
      return {id:'intermediate',label:'Intermediate / suspension',note:'This is where the span-weight estimate is most useful: half the span each side, plus selected hardware allowance for unload work.'};
    }
    return {id:'unknown',label:'Structure type not confirmed',note:'No reliable termination/intermediate clue found in the imported fields. Check the actual structure before using the number.'};
  }
  function structureRole(asset,overrideId='auto'){
    const manual=manualStructureRole(overrideId);
    return manual||detectStructureRole(asset);
  }
  function structureRoleHtml(asset,compact=false,overrideId='auto'){
    const r=structureRole(asset,overrideId);
    const cls=r.id==='intermediate'?'fmSWNote':'fmSWWarn';
    const prefix=r.manual?'Manual structure type':'Structure type';
    const suffix=r.manual?' Manual override only changes the warning/assumption wording, not the calculated weight.':'';
    if(compact)return `<div class="${cls}"><b>${esc(prefix)}:</b> ${esc(r.label)}. ${esc(r.note)}${esc(suffix)}</div>`;
    return `<div class="fmSWKV"><b>${esc(prefix)}</b><span>${esc(r.label)} · ${esc(r.note)}${esc(suffix)}</span></div>`;
  }
  function structureRoleControlHtml(asset,overrideId='auto'){
    const r=structureRole(asset,overrideId);
    return `<div class="fmLoadMode"><label for="fieldMapStructureRole">Structure type</label><select id="fieldMapStructureRole" onchange="FieldMapSpanWeightCalculator.updateStructureRoleOverride(this.value)">${structureRoleOptions(overrideId||'auto')}</select><small>${overrideId==='auto'?'Auto-detected: ':''}${esc(r.label)} · ${esc(r.note)} ${overrideId==='auto'?'':'Manual override does not change the calculated load.'}</small></div>`;
  }
  function contextKeyFromResult(result){return `${result?.asset?.line||''}|${result?.asset?.plate||''}`;}
  function keepOrResetStructureOverride(result){
    const key=contextKeyFromResult(result);
    if(key&&CURRENT_STRUCTURE_ROLE_CONTEXT!==key){CURRENT_STRUCTURE_ROLE_CONTEXT=key; CURRENT_STRUCTURE_ROLE_OVERRIDE='auto';}
    return CURRENT_STRUCTURE_ROLE_OVERRIDE||'auto';
  }
  function updateStructureRoleOverride(roleId){
    CURRENT_STRUCTURE_ROLE_OVERRIDE=roleId||'auto';
    if(document.getElementById('fieldMapSpanWeightOverlay')&&CURRENT_WEIGHT_ASSET){open(CURRENT_WEIGHT_ASSET,CURRENT_WEIGHT_LINE||''); return;}
    if(document.getElementById('fieldMapPullLoadOverlay')&&CURRENT_PULL_ASSET){openPull(CURRENT_PULL_ASSET,CURRENT_PULL_LINE||''); return;}
    if(document.getElementById('fieldMapAnglePullOverlay')&&CURRENT_ANGLE_PULL_ASSET){openAnglePull(CURRENT_ANGLE_PULL_ASSET,CURRENT_ANGLE_PULL_LINE||'');}
  }

  function plateParts(v){
    let s=clean(v).toUpperCase();
    if(!s)return [NaN,0,0,""];
    s=s.replace(/^T/,"").replace(/^[A-Z]+[-_ ]*/,"");
    const parts=s.split("/"); const main=parts[0]||s; const sub=parts[1]||"";
    const m=main.match(/(\d+)([A-Z]*)/); const sm=sub.match(/(\d+)([A-Z]*)/);
    const mainNum=m?Number(m[1]):NaN; const mainLetter=m&&m[2]?(m[2].charCodeAt(0)-64)/100:0; const subNum=sm?Number(sm[1]):0;
    return [mainNum,mainLetter,subNum,s];
  }
  function cmpPlate(a,b){
    const A=plateParts(a),B=plateParts(b);
    for(let i=0;i<3;i++){if(!Number.isFinite(A[i])||!Number.isFinite(B[i]))continue; if(A[i]!==B[i])return A[i]-B[i];}
    return String(A[3]).localeCompare(String(B[3]),undefined,{numeric:true});
  }
  function betweenPlate(x,a,b){if(!x||!a||!b)return false; const c1=cmpPlate(x,a),c2=cmpPlate(x,b); return (c1>=0&&c2<=0)||(c1<=0&&c2>=0);}
  function haversineM(a,b){
    if(!Number.isFinite(a?.lat)||!Number.isFinite(a?.lng)||!Number.isFinite(b?.lat)||!Number.isFinite(b?.lng))return NaN;
    const R=6371000,toRad=x=>x*Math.PI/180; const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng); const la1=toRad(a.lat),la2=toRad(b.lat);
    const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h));
  }

  function bit(sec,label){return (sec?.bits||[]).find(b=>String(b.label||"").toLowerCase().includes(label));}
  function fromSearchSection(sec){
    if(!sec)return null;
    const raw=sec.asset?.raw||sec.raw||{};
    const conductor=(bit(sec,"conductor")?.value)||sec.conductor?.split?.(/·|;/)?.[0]||raw.CONDUCTOR_ID_DESC||raw.CONDUCTOR||"";
    const qty=bit(sec,"qty")?.value||raw.COND_NO_PHS_QTY||raw.CONDUCTOR_QTY||1;
    const earthBits=(sec.bits||[]).filter(b=>/earth/i.test(String(b.label||""))).map(b=>clean(b.value)).filter(Boolean);
    const section={
      line:formatLine(sec.line||raw.LINE_NAME||""), first:clean(sec.fromPole||raw.FIRST_NAME_PLATE_ID||""), last:clean(sec.toPole||raw.LAST_NAME_PLATE_ID||""),
      lenKm:n(raw.LEN_KM ?? raw.LENGTH_KM ?? raw["LENGTH (KM)"], NaN), conductor:clean(conductor), qtyPerPhase:Math.max(1,Math.round(n(qty,1))),
      sectionType:clean(raw.STRUNG_SECTION_TYP_ID_DESC||raw.SECTION_TYPE||""), earth1:clean(earthBits[0]||raw.EARTH_WIRE_1_ID_DESC||""), earth2:clean(earthBits[1]||raw.EARTH_WIRE_2_ID_DESC||"")
    };
    if(!section.line||!section.first||!section.last||(!section.conductor&&!section.earth1&&!section.earth2))return null;
    return section;
  }
  function standardiseSection(r){
    if(!r)return null;
    if(r.line&&r.first&&r.last)return {...r,line:formatLine(r.line),first:clean(r.first),last:clean(r.last),lenKm:n(r.lenKm,NaN),conductor:clean(r.conductor),conductorType:clean(r.conductorType||r.type||""),earth1Type:clean(r.earth1Type||""),earth2Type:clean(r.earth2Type||""),qtyPerPhase:Math.max(1,Math.round(n(r.qtyPerPhase,1))),sectionType:clean(r.sectionType),earth1:clean(r.earth1),earth2:clean(r.earth2)};
    return fromSearchSection(r);
  }
  function localSectionRaw(){try{return localStorage.getItem(STORAGE_KEY)||"[]";}catch(e){return "[]";}}
  function loadLocalSections(raw){try{const data=JSON.parse(raw==null?localSectionRaw():raw); return Array.isArray(data)?data.map(standardiseSection).filter(Boolean):[];}catch(e){return [];}}
  function loadSections(){
    const globalSections=Array.isArray(window.FieldMapConductorSections)?window.FieldMapConductorSections:[];
    const searchSections=Array.isArray(window.SearchEngine?.conductorSections)?window.SearchEngine.conductorSections:[];
    const localRaw=localSectionRaw();
    const sourceToken=[window.FieldMapConductorData?.loadedAt||"", window.FieldMapConductorDataSource||"", globalSections.length, searchSections.length, localRaw.length, localRaw.slice(0,64), localRaw.slice(-64)].join('|');
    if(sourceToken===SECTION_CACHE_KEY&&Array.isArray(SECTION_CACHE))return SECTION_CACHE;
    const out=[]; const seen=new Set(); const add=s=>{s=standardiseSection(s); if(!s)return; const key=[lineKey(s.line),stripZeros(s.first),stripZeros(s.last),compact(s.conductor),compact(s.earth1),compact(s.earth2)].join('|'); if(seen.has(key))return; seen.add(key); out.push(s);};
    globalSections.forEach(add);
    searchSections.forEach(add);
    loadLocalSections(localRaw).forEach(add);
    SECTION_CACHE_KEY=sourceToken;
    SECTION_CACHE=out;
    return SECTION_CACHE;
  }
  function saveSections(sections){try{localStorage.setItem(STORAGE_KEY,JSON.stringify((sections||[]).map(standardiseSection).filter(Boolean))); invalidateCalculatorCaches();}catch(e){}}
  async function importConductorFile(file){
    const text=await file.text(); const data=JSON.parse(text); let records=[];
    if(data?.tool==="TXT_JSON_CONVERTER_OUTPUT"&&Array.isArray(data.data)){let cur=null; for(const r of data.data){const s=String(r?.field_1??"").trim(); if(s==="attributes: {"){cur={}; continue;} if(cur){if(s==="}"){records.push(cur); cur=null; continue;} const idx=s.indexOf(":"); if(idx>0){const k=s.slice(0,idx).trim(); let v=s.slice(idx+1).trim(); if(v==="null")v=""; cur[k]=v;}}}}
    else if(Array.isArray(data))records=data; else if(Array.isArray(data.records))records=data.records; else if(Array.isArray(data.features))records=data.features.map(f=>f.attributes||f.properties||f);
    const sections=records.map(r=>standardiseSection({line:r.LINE_NAME||r.line,first:r.FIRST_NAME_PLATE_ID||r.first,last:r.LAST_NAME_PLATE_ID||r.last,lenKm:r.LEN_KM||r.lenKm,conductor:r.CONDUCTOR_ID_DESC||r.conductor,qtyPerPhase:r.COND_NO_PHS_QTY||r.qtyPerPhase,sectionType:r.STRUNG_SECTION_TYP_ID_DESC||r.sectionType,earth1:r.EARTH_WIRE_1_ID_DESC||r.earth1,earth2:r.EARTH_WIRE_2_ID_DESC||r.earth2})).filter(Boolean);
    saveSections(sections); return sections;
  }

  function getSpec(desc){
    refreshSpecLookup();
    const queue=String(desc||"").split(/·|;/).map(clean).filter(Boolean); if(!queue.length)return null;
    for(const d of queue){
      if(SPEC_LOOKUP[d])return SPEC_LOOKUP[d];
      const code=(d.match(/\(([^()]+)\)\s*,?\s*$/)||[])[1];
      if(code){const c=compact(code); const byCode=Object.values(SPEC_LOOKUP).find(s=>compact(s.codeName)===c&&s.kgPerM&&s.confidence!=="unverified_no_estimate"); if(byCode)return byCode;}
      const byNorm=Object.entries(SPEC_LOOKUP).find(([k])=>compact(k)===compact(d)); if(byNorm)return byNorm[1];
    }
    return null;
  }
  function circuitCount(section){const s=String(section?.sectionType||"").toUpperCase(); if(s.includes("DOUBLE"))return 2; if(s.includes("SINGLE"))return 1; return String(section?.line||"").includes("/")?2:1;}
  function sectionForSpan(sections,line,aPlate,bPlate,fallbackConductor){
    const same=sections.filter(s=>lineMatches(s.line,line));
    const hit=same.find(s=>betweenPlate(aPlate,s.first,s.last)&&betweenPlate(bPlate,s.first,s.last))||same.find(s=>betweenPlate(aPlate,s.first,s.last))||same.find(s=>betweenPlate(bPlate,s.first,s.last));
    if(hit)return hit;
    if(fallbackConductor)return {line,first:aPlate,last:bPlate,lenKm:NaN,conductor:fallbackConductor,qtyPerPhase:1,sectionType:"",earth1:"",earth2:"",fallback:true};
    return null;
  }
  function estimateLengthFromSection(section,aPlate,bPlate){
    if(!section||!Number.isFinite(section.lenKm))return NaN;
    const first=plateParts(section.first)[0],last=plateParts(section.last)[0],a=plateParts(aPlate)[0],b=plateParts(bPlate)[0];
    const range=Math.abs(last-first); if(!range||!Number.isFinite(range))return section.lenKm*1000;
    return section.lenKm*1000*(Math.max(1,Math.abs(b-a)||1)/range);
  }
  function groupAssetsForLine(line){
    const se=window.SearchEngine; if(!se)return [];
    const key=lineKey(line);
    const now=Date.now();
    const groupHint=se.lineMap?.get?.(key);
    const cacheKey=[key, groupHint?.assets?.length||0, window.App?.assets?.length||0].join('|');
    const cached=LINE_ASSET_CACHE.get(cacheKey);
    if(cached&&now-cached.t<LINE_ASSET_TTL_MS)return cached.list;
    let group=groupHint;
    if(!group&&se.lineMap){for(const [k,g] of se.lineMap.entries()){if(k===key||lineMatches(g.line,line)){group=g;break;}}}
    let arr=(group?.assets||[]).filter(a=>a&&typeof a==='object'&&!se?.isConductorSpanAsset?.(a)&&!se?.isUtilityAsset?.(a)&&!se?.isHVCrossingAsset?.(a));
    const confirmed=arr.filter(a=>!a.inferredMissingStructure);
    if(confirmed.length<2&&typeof se.scanLineAssets==='function'){
      const fallback=se.scanLineAssets(line).filter(a=>a&&typeof a==='object'&&!se?.isConductorSpanAsset?.(a)&&!se?.isUtilityAsset?.(a)&&!se?.isHVCrossingAsset?.(a));
      if(fallback.length>arr.length)arr=fallback;
    }
    const list=arr.map(a=>assetInfo(a,line)).filter(x=>x.plate&&lineMatches(x.line,line)).sort((a,b)=>cmpPlate(a.plate,b.plate));
    LINE_ASSET_CACHE.set(cacheKey,{t:now,list});
    if(LINE_ASSET_CACHE.size>80){const first=LINE_ASSET_CACHE.keys().next().value; if(first)LINE_ASSET_CACHE.delete(first);}
    return list;
  }
  function adjacent(asset, preferredLine=""){
    const info=assetInfo(asset,preferredLine); const list=groupAssetsForLine(info.line);
    let idx=list.findIndex(x=>x.asset===asset);
    if(idx<0)idx=list.findIndex(x=>stripZeros(x.plate)===stripZeros(info.plate));
    if(idx<0&&Number.isFinite(info.lat)&&Number.isFinite(info.lng))idx=list.findIndex(x=>Math.abs(x.lat-info.lat)<1e-8&&Math.abs(x.lng-info.lng)<1e-8);
    return {info,prev:idx>0?list[idx-1]:null,next:idx>=0&&idx<list.length-1?list[idx+1]:null,lineAssetCount:list.length};
  }
  function fallbackConductorFor(asset,line){
    const direct=conductorFromAsset(asset); if(direct)return direct;
    try{const links=window.SearchEngine?.conductorLinksForAsset?.(asset)||[]; const link=links.find(l=>lineMatches(l.line,line))||links[0]; if(link){const bit=(link.bits||[]).find(b=>/^conductor$/i.test(String(b.label||""))); return clean(bit?.value||String(link.conductor||"").split(/·|;/)[0]);}}catch(e){}
    return "";
  }
  function calcSpan(side, assetInf, otherInf, sections){
    if(!otherInf)return null; const line=assetInf.line||otherInf.line;
    const section=sectionForSpan(sections,line,assetInf.plate,otherInf.plate,fallbackConductorFor(assetInf.asset,line));
    const gpsM=haversineM(assetInf,otherInf); const estimatedM=estimateLengthFromSection(section,assetInf.plate,otherInf.plate);
    const lengthM=Number.isFinite(gpsM)&&gpsM>0?gpsM:estimatedM; const lengthSource=Number.isFinite(gpsM)&&gpsM>0?"GPS dot distance":"section LEN_KM estimate";
    if(!section||!Number.isFinite(lengthM))return {side,line,ok:false,reason:"No adjacent span length or conductor section found."};
    const phaseSpec=getSpec(section.conductor); const phaseKgPerM=n(phaseSpec?.kgPerM,NaN); const circuits=circuitCount(section); const qty=Math.max(1,n(section.qtyPerPhase,1));
    const conductorCount=qty*3*circuits;
    const singleConductorKg=Number.isFinite(phaseKgPerM)?phaseKgPerM*lengthM:NaN;
    const singleConductorSupportShareKg=Number.isFinite(singleConductorKg)?singleConductorKg/2:NaN;
    const perPhaseBundleKg=Number.isFinite(singleConductorKg)?singleConductorKg*qty:NaN;
    const perCircuitKg=Number.isFinite(perPhaseBundleKg)?perPhaseBundleKg*3:NaN;
    const phaseKg=Number.isFinite(perCircuitKg)?perCircuitKg*circuits:NaN;
    const earthRows=[section.earth1,section.earth2].filter(x=>x&&!/^null$/i.test(x)).map(e=>{const spec=getSpec(e); const kg=spec?.kgPerM?spec.kgPerM*lengthM:NaN; return {desc:e,spec,kg};});
    const knownEarthKg=earthRows.reduce((sum,x)=>sum+(Number.isFinite(x.kg)?x.kg:0),0);
    const unknown=[]; if(!Number.isFinite(phaseKg))unknown.push("phase conductor"); earthRows.forEach(e=>{if(!Number.isFinite(e.kg))unknown.push(e.desc);});
    const knownTotalKg=(Number.isFinite(phaseKg)?phaseKg:0)+knownEarthKg;
    return {side,ok:true,line,from:otherInf.plate,to:assetInf.plate,lengthM,lengthSource,section,phaseSpec,phaseKg,phaseKgPerM,circuits,qty,conductorCount,singleConductorKg,singleConductorSupportShareKg,perPhaseBundleKg,perCircuitKg,earthRows,knownEarthKg,knownTotalKg,unknown,supportShareKg:knownTotalKg/2};
  }
  function calculate(asset,line=""){
    const sections=loadSections();
    const adj=adjacent(asset,line);
    const left=calcSpan("LEFT / previous",adj.info,adj.prev,sections);
    const right=calcSpan("RIGHT / next",adj.info,adj.next,sections);
    const knownTotal=(left?.knownTotalKg||0)+(right?.knownTotalKg||0);
    const supportShare=(left?.supportShareKg||0)+(right?.supportShareKg||0);
    const singleConductorFullKg=(Number.isFinite(left?.singleConductorKg)?left.singleConductorKg:0)+(Number.isFinite(right?.singleConductorKg)?right.singleConductorKg:0);
    const singleConductorSupportShareKg=(Number.isFinite(left?.singleConductorSupportShareKg)?left.singleConductorSupportShareKg:0)+(Number.isFinite(right?.singleConductorSupportShareKg)?right.singleConductorSupportShareKg:0);
    const unknown=[...(left?.unknown||[]),...(right?.unknown||[])];
    const singleUnknown=[];
    if((left&&!Number.isFinite(left?.singleConductorKg))||(right&&!Number.isFinite(right?.singleConductorKg)))singleUnknown.push('phase conductor');
    return {asset:adj.info,prevInfo:adj.prev,nextInfo:adj.next,sectionCount:sections.length,lineAssetCount:adj.lineAssetCount,left,right,knownTotalKg:knownTotal,supportShareKg:supportShare,singleConductorFullKg,singleConductorSupportShareKg,singleUnknown,unknown};
  }

  function specTrustStatus(spec){
    const conf=String(spec?.confidence||'unverified_no_estimate');
    if(conf==='catalog_verified'||conf==='external_exact_match'||conf==='equivalent_verified_by_user_mapping')return 'Verified';
    if(conf==='identity_verified_no_weight')return 'Identity only';
    return 'Manual needed';
  }
  function chartSize(spec){const v=spec?.fieldChartSizeMm??spec?.sizeMm??spec?.odMm; if(v===undefined||v===null||v==='')return ''; const n=Number(v); return Number.isFinite(n)?(Number.isInteger(n)?String(n):String(n).replace(/0+$/,'').replace(/\.$/,'')):String(v);}
  function chartDie(spec){
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
  }
  function specAudit(spec){
    refreshSpecLookup();
    if(!spec)return {status:'Manual needed',type:'Unknown',equivalent:'',kgPerM:null,colour:'',sizeMm:'',dieSize:'',confidence:'missing',source:'No matching conductor property row loaded.'};
    return {status:specTrustStatus(spec),type:String(spec.type||'Unknown'),equivalent:String(spec.equivalentName||spec.equivalent||''),kgPerM:Number.isFinite(Number(spec.kgPerM))?Number(spec.kgPerM):null,colour:String(spec.colour||spec.color||''),sizeMm:chartSize(spec),dieSize:chartDie(spec),confidence:String(spec.confidence||''),source:String(spec.source||''),description:String(spec.description||spec.codeName||'')};
  }
  function auditSpan(span){
    if(!span)return {ok:false,side:'Missing side',reason:'No adjacent structure found on this loaded circuit.'};
    if(!span.ok)return {ok:false,side:span.side,reason:span.reason||'No conductor section or length found.'};
    const spec=specAudit(span.phaseSpec);
    return {
      ok:true,
      side:span.side,
      from:span.from,
      to:span.to,
      lengthM:Number.isFinite(Number(span.lengthM))?Number(span.lengthM):null,
      lengthSource:span.lengthSource,
      conductor:String(span.section?.conductor||'Unknown'),
      type:spec.type,
      equivalent:spec.equivalent,
      status:spec.status,
      confidence:spec.confidence,
      kgPerM:spec.kgPerM,
      colour:spec.colour,
      sizeMm:chartSize(spec),
      dieSize:chartDie(spec),
      qty:span.qty,
      circuits:span.circuits,
      conductorCount:Number.isFinite(Number(span.conductorCount))?Number(span.conductorCount):null,
      singleConductorKg:Number.isFinite(Number(span.singleConductorKg))?Number(span.singleConductorKg):null,
      singleConductorSupportShareKg:Number.isFinite(Number(span.singleConductorSupportShareKg))?Number(span.singleConductorSupportShareKg):null,
      perPhaseBundleKg:Number.isFinite(Number(span.perPhaseBundleKg))?Number(span.perPhaseBundleKg):null,
      perCircuitKg:Number.isFinite(Number(span.perCircuitKg))?Number(span.perCircuitKg):null,
      phaseKg:Number.isFinite(Number(span.phaseKg))?Number(span.phaseKg):null,
      knownTotalKg:Number.isFinite(Number(span.knownTotalKg))?Number(span.knownTotalKg):0,
      supportShareKg:Number.isFinite(Number(span.supportShareKg))?Number(span.supportShareKg):0,
      earthRows:(span.earthRows||[]).map(e=>({desc:String(e.desc||''),status:specAudit(e.spec).status,kg:Number.isFinite(Number(e.kg))?Number(e.kg):null})),
      blocked:!(Number.isFinite(Number(span.phaseKg))),
      unknown:Array.isArray(span.unknown)?span.unknown.slice():[]
    };
  }
  function auditAsset(asset,line=''){
    const result=calculate(asset,line);
    const left=auditSpan(result.left);
    const right=auditSpan(result.right);
    const blocked=[];
    for(const side of [left,right]){
      if(!side.ok)blocked.push(`${side.side}: ${side.reason}`);
      else if(side.blocked)blocked.push(`${side.side}: manual weight needed for ${side.conductor}`);
      if(Array.isArray(side.unknown)&&side.unknown.length)blocked.push(`${side.side}: unknown ${side.unknown.join(', ')}`);
    }
    return {
      line:result.asset.line||'',
      structure:result.asset.plate||'',
      title:[result.asset.line||'',result.asset.plate||''].filter(Boolean).join(' · ')||'Selected asset',
      sectionCount:result.sectionCount||0,
      lineAssetCount:result.lineAssetCount||0,
      left,
      right,
      knownTotalKg:Number.isFinite(Number(result.knownTotalKg))?Number(result.knownTotalKg):0,
      supportShareKg:Number.isFinite(Number(result.supportShareKg))?Number(result.supportShareKg):0,
      singleConductorFullKg:Number.isFinite(Number(result.singleConductorFullKg))?Number(result.singleConductorFullKg):0,
      singleConductorSupportShareKg:Number.isFinite(Number(result.singleConductorSupportShareKg))?Number(result.singleConductorSupportShareKg):0,
      blocked:[...new Set(blocked.filter(Boolean))]
    };
  }

  // format helpers declared at top-level so all calculator panels can use them safely.
  function totalLabel(v,unknown){const base=fmtKg(v); return unknown&&unknown.length?`${base} + unknown items`:base;}
  const LOAD_MODE_KEY="fieldMap.loadMode.v1";
  const LOAD_MODES=[
    {id:"phase",label:"Phase conductor",short:"Phase",desc:"one phase conductor / sub-conductor only"},
    {id:"twin",label:"Twin phase conductor",short:"Twin",desc:"two phase conductors / twin bundle"},
    {id:"earth",label:"Earth wire / OPGW",short:"Earth",desc:"one earth wire / OPGW only"},
    {id:"all",label:"All conductors",short:"All",desc:"all phase conductors plus listed earth wires"}
  ];
  function selectedLoadMode(id){return LOAD_MODES.find(x=>x.id===id)||LOAD_MODES[0];}
  function storedLoadMode(){try{return localStorage.getItem(LOAD_MODE_KEY)||"phase";}catch(e){return "phase";}}
  function loadModeOptions(selected){return LOAD_MODES.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?"selected":""}>${esc(x.label)}</option>`).join("");}
  function firstEarth(span){
    const rows=(span?.earthRows||[]).filter(e=>e&&e.desc);
    return rows.find(e=>Number.isFinite(Number(e.kg)))||rows[0]||null;
  }
  function spanModeValues(span,modeId){
    const mode=selectedLoadMode(modeId).id;
    if(!span)return {ok:false,fullKg:NaN,supportKg:NaN,unknown:["missing adjacent span"],item:"Missing",supportLabel:"Selected lift/support from this side",fullLabel:"Selected full span",hint:"No adjacent structure found on this loaded circuit."};
    if(!span.ok)return {ok:false,fullKg:NaN,supportKg:NaN,unknown:[span.reason||"span data"],item:"Missing",supportLabel:"Selected lift/support from this side",fullLabel:"Selected full span",hint:span.reason||"No conductor section or length found."};
    if(mode==="all")return {ok:true,fullKg:span.knownTotalKg,supportKg:span.supportShareKg,unknown:(span.unknown||[]).slice(),item:"All conductors",supportLabel:"All conductors support from this side",fullLabel:"All conductors full span",hint:"half of this span for all phase conductors plus listed earth wires"};
    if(mode==="earth"){
      const e=firstEarth(span);
      const full=Number(e?.kg);
      const ok=Number.isFinite(full);
      return {ok,fullKg:ok?full:NaN,supportKg:ok?full/2:NaN,unknown:ok?[]:[e?.desc||"earth wire / OPGW"],item:e?.desc||"Earth wire / OPGW",supportLabel:"Earth/OPGW support from this side",fullLabel:"Earth/OPGW full span",hint:e?.desc?`half of this span for ${e.desc}`:"no earth wire weight listed for this span"};
    }
    if(mode==="twin"){
      const single=Number(span.singleConductorKg);
      const ok=Number.isFinite(single);
      const full=ok?single*2:NaN;
      const listedQty=Number(span.qty||1);
      const twinHint=listedQty>=2?"half of this span for two phase sub-conductors in one twin bundle":"manual twin selection; this section lists one conductor per phase";
      return {ok,fullKg:full,supportKg:ok?full/2:NaN,unknown:ok?[]:[span.section?.conductor||"phase conductor"],item:span.section?.conductor||"Twin phase conductor",supportLabel:"Twin conductor support from this side",fullLabel:"Twin conductor full span",hint:twinHint};
    }
    const full=Number(span.singleConductorKg);
    const ok=Number.isFinite(full);
    return {ok,fullKg:ok?full:NaN,supportKg:ok?full/2:NaN,unknown:ok?[]:[span.section?.conductor||"phase conductor"],item:span.section?.conductor||"Phase conductor",supportLabel:"Phase conductor support from this side",fullLabel:"Phase conductor full span",hint:"half of this span for one phase conductor/sub-conductor"};
  }
  function sumModeValues(result,modeId){
    const left=spanModeValues(result.left,modeId);
    const right=spanModeValues(result.right,modeId);
    const fullParts=[left.fullKg,right.fullKg].filter(v=>Number.isFinite(Number(v))).map(Number);
    const supportParts=[left.supportKg,right.supportKg].filter(v=>Number.isFinite(Number(v))).map(Number);
    const unknown=[...(left.unknown||[]),...(right.unknown||[])].filter(Boolean);
    return {mode:selectedLoadMode(modeId),left,right,fullKg:fullParts.length?fullParts.reduce((a,b)=>a+b,0):NaN,supportKg:supportParts.length?supportParts.reduce((a,b)=>a+b,0):NaN,unknown:[...new Set(unknown)],hasAny:supportParts.length>0};
  }
  function modeWarningText(values){return values.unknown.length?`Selected mode has manual/missing weight items: ${esc(values.unknown.slice(0,5).join(", "))}${values.unknown.length>5?"…":""}`:"";}
  function updateWeightLoadMode(modeId){
    try{localStorage.setItem(LOAD_MODE_KEY,modeId);}catch(e){}
    if(CURRENT_WEIGHT_ASSET)open(CURRENT_WEIGHT_ASSET,CURRENT_WEIGHT_LINE||"");
  }
  function updatePullLoadMode(modeId){
    try{localStorage.setItem(LOAD_MODE_KEY,modeId);}catch(e){}
    if(CURRENT_PULL_ASSET)openPull(CURRENT_PULL_ASSET,CURRENT_PULL_LINE||"");
  }
  function spanCard(span,modeId){
    if(!span)return `<div class="fmSWCard fmSWBad"><b>Missing side</b><p>No adjacent structure found on this loaded circuit.</p></div>`;
    if(!span.ok)return `<div class="fmSWCard fmSWBad"><b>${esc(span.side)}</b><p>${esc(span.reason)}</p></div>`;
    const sec=span.section,spec=span.phaseSpec;
    const mv=spanModeValues(span,modeId);
    const sideName=String(span.side||'').toUpperCase().includes('LEFT')?'Previous span':'Next span';
    const specBits=[spec?.type||"Unknown", chartSize(spec)?"Size "+chartSize(spec)+" mm":"", chartDie(spec)?"Die "+chartDie(spec):"", spec?.colour?"Colour "+spec.colour:"", spec?.kgPerM?spec.kgPerM.toFixed(3)+" kg/m":"manual weight needed"].filter(Boolean);
    const earthText=span.earthRows.length?esc(span.earthRows.map(e=>`${e.desc}: ${fmtKg(e.kg)}`).join(" · ")):"None listed";
    return `<div class="fmSWCard"><div class="fmSWSpanHead"><h4>${esc(sideName)}</h4><span>${esc(span.from)} ⇄ ${esc(span.to)}</span></div>
      <div class="fmSWBigMetric"><small>${esc(mv.supportLabel)}</small><b>${totalLabel(mv.supportKg,mv.unknown)}</b><em>${esc(mv.hint)}</em></div>
      <div class="fmSWTwo"><div><small>${esc(mv.fullLabel)}</small><b>${totalLabel(mv.fullKg,mv.unknown)}</b></div><div><small>Span length</small><b>${fmtM(span.lengthM)}</b></div></div>
      <details class="fmSWMore"><summary>More info</summary>
        <div class="fmSWKV"><b>Selected</b><span>${esc(selectedLoadMode(modeId).label)} · ${esc(mv.item)}</span></div>
        <div class="fmSWKV"><b>Length source</b><span>${esc(span.lengthSource)}</span></div>
        <div class="fmSWKV"><b>Phase conductor</b><span>${esc(sec.conductor||"Unknown")}</span></div>
        <div class="fmSWKV"><b>Spec</b><span>${esc(specBits.join(" · "))}</span></div>
        <div class="fmSWFormula">One phase conductor: ${fmtM(span.lengthM)} × ${Number.isFinite(span.phaseKgPerM)?span.phaseKgPerM.toFixed(3):"?"} kg/m = ${fmtKg(span.singleConductorKg)}</div>
        <div class="fmSWKV"><b>Phase bundle</b><span>${fmtKg(span.perPhaseBundleKg)} (${span.qty} conductor${span.qty===1?"":"s"} per phase)</span></div>
        <div class="fmSWKV"><b>All phase count</b><span>3 phases × ${span.qty} per phase × ${span.circuits} circuit${span.circuits===1?"":"s"} = ${span.conductorCount} phase conductors</span></div>
        <div class="fmSWKV"><b>All phases</b><span>${fmtKg(span.phaseKg)} full span</span></div>
        <div class="fmSWKV"><b>All + earth</b><span>${totalLabel(span.knownTotalKg,span.unknown)} full span · ${totalLabel(span.supportShareKg,span.unknown)} half-span support at this side</span></div>
        <div class="fmSWKV"><b>Earth / OPGW</b><span>${earthText}</span></div>
      </details>
    </div>`;
  }
  function injectStyles(){
    if(document.getElementById("fieldMapSpanWeightStyles"))return; const s=document.createElement("style"); s.id="fieldMapSpanWeightStyles";
    s.textContent=`
      .popup-actions .fmSWBtn{background:#2f5a31!important;color:#fffaf0!important;border:0!important}
      .fmSWOverlay{position:fixed;inset:0;z-index:999999;background:rgba(19,33,22,.62);display:flex;align-items:flex-end;justify-content:center}
      .fmSWPanel{width:min(580px,100vw);max-height:88vh;overflow:auto;background:#fffaf0;color:#132116;border:1px solid rgba(31,59,37,.25);border-radius:18px 18px 0 0;padding:12px;box-shadow:0 -12px 40px rgba(0,0,0,.35);font-family:system-ui,-apple-system,Segoe UI,sans-serif}
      .fmSWTop{display:flex;align-items:start;justify-content:space-between;gap:10px;margin-bottom:8px}.fmSWTop h3{margin:0;font-size:16px;color:#1f3b25}.fmSWTop p{margin:3px 0 0;font-size:12px;color:#53634e}.fmSWClose{border:0;background:#1f3b25;color:#fffaf0;border-radius:12px;font-weight:900;padding:8px 10px}
      .fmSWGrid{display:grid;gap:8px}.fmSWCard{background:#fff7e7;border:1px solid rgba(31,59,37,.18);border-radius:14px;padding:9px}.fmSWCard h4{margin:0;font-size:13px;color:#1f3b25}.fmSWCard p{margin:4px 0;color:#53634e;font-size:12px}.fmSWBad{padding:11px}
      .fmSWAnswer{background:#1f3b25;color:#fffaf0;border-radius:15px;padding:11px;margin:8px 0;display:grid;gap:6px}.fmSWAnswer small,.fmSWBigMetric small,.fmSWTwo small,.fmPullAnswer small{font-size:10px;letter-spacing:.04em;text-transform:uppercase;font-weight:1000;opacity:.78}.fmSWAnswer b{font-size:26px;line-height:1}.fmSWAnswer span{font-size:12px;line-height:1.25;opacity:.9}
      .fmSWSecondary{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0}.fmSWSecondary div,.fmSWTwo div{background:#eef4e6;border:1px solid rgba(31,59,37,.16);border-radius:12px;padding:8px;display:grid;gap:2px}.fmSWSecondary b,.fmSWTwo b{font-size:15px;color:#132116}.fmSWSecondary small,.fmSWTwo small{color:#53634e}
      .fmSWSpanHead{display:flex;align-items:start;justify-content:space-between;gap:8px;margin-bottom:7px}.fmSWSpanHead span{font-size:11px;font-weight:900;color:#53634e;text-align:right}.fmSWBigMetric{border:1px solid rgba(31,59,37,.16);background:#dfead2;border-radius:13px;padding:9px;display:grid;gap:2px}.fmSWBigMetric b{font-size:20px;color:#132116}.fmSWBigMetric em{font-style:normal;font-size:10.5px;color:#53634e;font-weight:850}.fmSWTwo{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
      .fmSWMore{margin-top:7px;border-top:1px solid rgba(31,59,37,.12);padding-top:6px}.fmSWMore summary{cursor:pointer;font-size:11px;font-weight:1000;color:#1f3b25;background:#fffaf0;border:1px solid rgba(31,59,37,.16);border-radius:10px;padding:7px}.fmSWMore[open] summary{margin-bottom:5px;background:#eef4e6}
      .fmSWKV{display:grid;grid-template-columns:108px 1fr;gap:6px;border-top:1px solid rgba(31,59,37,.12);padding:5px 0;font-size:12px}.fmSWKV b{font-size:10px;text-transform:uppercase;color:#355d36}.fmSWKV span{word-break:break-word;overflow-wrap:anywhere}
      .fmSWFormula{margin:7px 0;padding:8px;border-radius:10px;background:#eef4e6;border:1px solid rgba(31,59,37,.16);font-weight:900;color:#132116;font-size:12px;line-height:1.35}
      .fmSWWarn{background:#fff0d8;border:1px solid #b7791f;border-radius:12px;padding:8px;color:#5b3d00;font-weight:800;font-size:12px;margin:8px 0}
      .fmSWNote{font-size:11px;color:#53634e;line-height:1.35;margin-top:8px}
      .fmLoadMode{background:#fff7e7;border:1px solid rgba(31,59,37,.18);border-radius:14px;padding:9px;margin:8px 0;display:grid;gap:6px}.fmLoadMode label{font-size:10px;letter-spacing:.04em;text-transform:uppercase;font-weight:1000;color:#355d36}.fmLoadMode select,.fmLoadMode input{width:100%;border:1px solid rgba(31,59,37,.24);background:#fffaf0;color:#132116;border-radius:12px;padding:9px 10px;font-weight:1000;font-size:14px;box-sizing:border-box}.fmLoadMode small{font-size:10.5px;color:#53634e;font-weight:850}.fmAngleInputs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fmAngleInputs .fmLoadMode{margin:0}.fmAngleWarning{background:#ffe8cc;border:1px solid #b7791f;border-radius:12px;padding:8px;color:#5b3d00;font-weight:900;font-size:12px;margin:8px 0}.fmAngleFormula{font-size:11px;line-height:1.35;color:#53634e;background:#eef4e6;border:1px solid rgba(31,59,37,.16);border-radius:10px;padding:8px;margin-top:7px}
      .fmPullPanel{max-width:560px}.fmPullAnswer{background:#1f3b25;color:#fffaf0;border-radius:15px;padding:11px;margin:8px 0;display:grid;gap:6px}.fmPullAnswer.fmPullMoveOnly{background:#5b3d00}.fmPullAnswer b{font-size:26px;line-height:1}.fmPullAnswer span{font-size:12px;line-height:1.25;opacity:.9}
      .fmPullSetup{background:#fff7e7;border:1px solid rgba(31,59,37,.18);border-radius:14px;padding:9px;margin:8px 0;display:grid;gap:8px}.fmPullSetup label{font-size:10px;letter-spacing:.04em;text-transform:uppercase;font-weight:1000;color:#355d36}.fmPullSetup select{width:100%;border:1px solid rgba(31,59,37,.24);background:#fffaf0;color:#132116;border-radius:12px;padding:9px 10px;font-weight:1000;font-size:14px}.fmPullSetupOut{background:#dfead2;border:1px solid rgba(31,59,37,.16);border-radius:13px;padding:9px;display:grid;gap:4px}.fmPullSetupOut small{font-size:10px;letter-spacing:.04em;text-transform:uppercase;font-weight:1000;color:#53634e}.fmPullSetupOut b{font-size:23px;line-height:1;color:#132116}.fmPullSetupOut span{font-size:11px;line-height:1.25;color:#53634e;font-weight:850}.fmPullMini{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:4px}.fmPullMini div{background:#eef4e6;border:1px solid rgba(31,59,37,.14);border-radius:10px;padding:7px;display:grid;gap:2px}.fmPullMini em{font-style:normal;font-size:10px;text-transform:uppercase;font-weight:1000;color:#53634e}.fmPullMini strong{font-size:13px;color:#132116}
      .fmPullGrid{display:grid;gap:8px;margin-top:8px}.fmPullRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;align-items:center;background:#fff7e7;border:1px solid rgba(31,59,37,.16);border-radius:12px;padding:9px}.fmPullRow b{font-size:12px;color:#1f3b25}.fmPullRow span{font-weight:1000;color:#132116;white-space:nowrap}.fmPullRow small{grid-column:1/-1;font-size:10.5px;color:#53634e;font-weight:800}
      @media(max-width:390px){.fmSWSecondary,.fmSWTwo,.fmPullMini,.fmAngleInputs{grid-template-columns:1fr}.fmSWAnswer b,.fmPullAnswer b{font-size:23px}.fmPullRow{grid-template-columns:1fr}.fmPullRow span{white-space:normal}}
    `; document.head.appendChild(s);
  }
  function open(asset,line=""){
    injectStyles(); CURRENT_WEIGHT_ASSET=asset; CURRENT_WEIGHT_LINE=line||""; const result=calculate(asset,line); const roleOverride=keepOrResetStructureOverride(result); const old=document.getElementById("fieldMapSpanWeightOverlay"); if(old)old.remove();
    const modeId=selectedLoadMode(storedLoadMode()).id;
    const modeVals=sumModeValues(result,modeId);
    const allUnknown=[...new Set(result.unknown||[])];
    const warn=modeWarningText(modeVals);
    const div=document.createElement("div"); div.id="fieldMapSpanWeightOverlay"; div.className="fmSWOverlay";
    div.innerHTML=`<div class="fmSWPanel"><div class="fmSWTop"><div><h3>Lift / Span Weight</h3><p>${esc(result.asset.line||"Unknown line")} · Structure ${esc(result.asset.plate||"Unknown")}</p></div><button class="fmSWClose" type="button" onclick="FieldMapSpanWeightCalculator.close()">×</button></div>
      ${!result.sectionCount?`<div class="fmSWWarn">No conductor section table found. Import the separate conductor JSON file from Conductors.</div>`:""}
      ${structureRoleControlHtml(result.asset.asset||asset,roleOverride)}
      <div class="fmLoadMode"><label for="fieldMapWeightLoadMode">What is unclipped?</label><select id="fieldMapWeightLoadMode" onchange="FieldMapSpanWeightCalculator.updateWeightLoadMode(this.value)">${loadModeOptions(modeId)}</select><small>${esc(modeVals.mode.desc)}</small></div>
      <div class="fmSWAnswer"><small>${esc(modeVals.mode.label)} lift if unclipped here</small><b>${totalLabel(modeVals.supportKg,modeVals.unknown)}</b><span>Half of the previous span + half of the next span for ${esc(modeVals.mode.desc)}.</span></div>
      <div class="fmSWSecondary"><div><small>${esc(modeVals.mode.short)} · both full spans</small><b>${totalLabel(modeVals.fullKg,modeVals.unknown)}</b></div><div><small>All conductors if all unclipped</small><b>${totalLabel(result.supportShareKg,allUnknown)}</b></div></div>
      ${warn?`<div class="fmSWWarn">${warn}</div>`:""}
      <div class="fmSWGrid">${spanCard(result.left,modeId)}${spanCard(result.right,modeId)}</div>
      <details class="fmSWMore"><summary>More info / assumptions</summary><div class="fmSWNote">Use the selector to choose exactly what is unclipped: one phase conductor, twin phase conductors, one earth/OPGW, or all conductors. Twin phase conductor means two phase sub-conductors from the same phase bundle. Structure type is auto-detected from imported wording but can be manually overridden; it changes warnings/assumptions only, not the calculated dead weight. This is a quick field weight estimate only. It uses GPS distance to adjacent loaded structures where available; otherwise it uses conductor section length. It does not include live-line engineering, actual tension, sag, wind, shock loading, hardware condition, pulley friction, rope angle, plant WLL/SWL, or an approved lift plan. Unknown/unverified conductor weights are excluded and flagged.</div>${structureRoleHtml(result.asset.asset||asset,false,roleOverride)}<div class="fmSWKV"><b>Loaded structures</b><span>${result.lineAssetCount.toLocaleString()}</span></div><div class="fmSWKV"><b>All spans full</b><span>${totalLabel(result.knownTotalKg,allUnknown)} full conductor mass over previous + next spans</span></div></details></div>`;
    div.addEventListener("click",e=>{if(e.target===div)close();}); document.body.appendChild(div);
  }
  function close(){const el=document.getElementById("fieldMapSpanWeightOverlay"); if(el)el.remove();}
  function registerAsset(asset){const now=Date.now(); for(const [k,v] of ASSET_CACHE){if(now-v.t>ASSET_TTL_MS)ASSET_CACHE.delete(k);} const id="sw"+now.toString(36)+Math.random().toString(36).slice(2,8); ASSET_CACHE.set(id,{t:now,asset}); return id;}
  function openForAssetId(id){const rec=ASSET_CACHE.get(id); if(!rec?.asset){alert("Asset expired. Close and reopen the dot popup."); return;} open(rec.asset);}
  function shouldOffer(asset){
    try{if(window.SearchEngine?.isConductorSpanAsset?.(asset)||window.SearchEngine?.isUtilityAsset?.(asset)||window.SearchEngine?.isHVCrossingAsset?.(asset))return false;}catch(e){}
    if(window.PopupEngine?.isPoleTower){try{if(window.PopupEngine.isPoleTower(asset))return true;}catch(e){}}
    const refs=refsForAsset(asset);
    if(refs.some(r=>r.line||r.pole))return true;
    const raw=asset?.raw||asset?.properties||{};
    const text=[asset?.kind,asset?.category,asset?.label,asset?.gisLabel,asset?.structure,asset?.line,raw.LINE_NAME,raw.TRMSN_LINE_GIS_LABEL,raw.NAMEPLATE_ID,raw.POLE_NUMBER,raw.STRUC_TYP_DESC,raw.SUB_STRUC_DESC,Object.values(raw).slice(0,30).join(' ')].join(' ').toUpperCase();
    return /POLE|TOWER|TRMSN|TRANSMISSION|STRUCTURE|NAMEPLATE|LATTICE|SUSPENSION/.test(text);
  }
  function buttonHtmlForAsset(asset){
    try{
      if(!shouldOffer(asset))return '';
      const id=registerAsset(asset);
      return `<button class="fmSWInlineBtn fmCalcBtn fmConductorWeightBtn" type="button" onclick="event.stopPropagation();FieldMapSpanWeightCalculator.openForAssetId('${id}')">Lift / span weight</button>`;
    }catch(e){return '';}
  }
  function roughPullButtonHtmlForAsset(asset){
    try{
      if(!shouldOffer(asset))return '';
      const id=registerAsset(asset);
      return `<button class="fmSWInlineBtn fmCalcBtn fmPullLoadBtn" type="button" onclick="event.stopPropagation();FieldMapSpanWeightCalculator.openPullForAssetId('${id}')">Pull / unload</button>`;
    }catch(e){return '';}
  }
  function anglePullButtonHtmlForAsset(asset){
    try{
      if(!shouldOffer(asset))return '';
      const id=registerAsset(asset);
      return `<button class="fmSWInlineBtn fmCalcBtn fmAnglePullBtn" type="button" onclick="event.stopPropagation();FieldMapSpanWeightCalculator.openAnglePullForAssetId('${id}')">Angle pull-back</button>`;
    }catch(e){return '';}
  }
  function calculatorMenuHtmlForAsset(asset){
    try{
      if(!shouldOffer(asset))return '';
      const id=registerAsset(asset);
      return `<details class="fmCalcMenu" onclick="event.stopPropagation();" ontoggle="setTimeout(()=>window.MapEngine?.refitOpenPopup?.(),60);setTimeout(()=>window.MapEngine?.refitOpenPopup?.(),220);"><summary>Conductor calculators</summary><div class="fmCalcMenuBody"><button class="fmSWInlineBtn fmCalcBtn fmConductorWeightBtn" type="button" onclick="event.stopPropagation();FieldMapSpanWeightCalculator.openForAssetId('${id}')">Lift / span weight</button><button class="fmSWInlineBtn fmCalcBtn fmPullLoadBtn" type="button" onclick="event.stopPropagation();FieldMapSpanWeightCalculator.openPullForAssetId('${id}')">Pull / unload</button><button class="fmSWInlineBtn fmCalcBtn fmAnglePullBtn" type="button" onclick="event.stopPropagation();FieldMapSpanWeightCalculator.openAnglePullForAssetId('${id}')">Angle pull-back</button></div></details>`;
    }catch(e){return '';}
  }
  const PULL_SETUP_KEY="fieldMap.pullSetup.v1";
  const ANGLE_SETUP_KEY="fieldMap.anglePull.setup.v1";
  const PULL_SETUPS=[
    {id:"cranker",label:"Cranker 1:1",ma:1,eff:1,note:"direct cranker/come-along pull; treat as 1:1 with no mechanical advantage"},
    {id:"two",label:"2:1 tower termination setup",ma:2,eff:0.82,note:"moving roller/block on conductor with return to pole anchor; about half effort plus extra roller/rope losses"}
  ];
  const ANGLE_PULL_SETUPS=[
    {id:"crane",label:"Crane direct pull-back",ma:1,eff:1,note:"direct plant/crane pull; treat as 1:1 with no mechanical advantage"},
    {id:"cranker",label:"Cranker 1:1 direct",ma:1,eff:1,note:"direct cranker/come-along pull; treat as 1:1 with no mechanical advantage"},
    {id:"fixed2",label:"Two fixed rollers 1:1 (base + pole top)",ma:1,eff:0.80,note:"base roller plus pole-top roller changes direction only; no mechanical advantage; allows about 20% sheave loss"},
    {id:"two",label:"2:1 tower termination setup",ma:2,eff:0.82,note:"moving roller/block on conductor with return to pole anchor; about half effort plus extra roller/rope losses"}
  ];
  function normalisePullSetupId(id){
    if(id==="direct"||id==="one"||id==="crane"||id==="plant"||id==="fixed"||id==="fixed2"||id==="redirect")return "cranker";
    if(id==="twoToOne"||id==="2to1")return "two";
    return id||"cranker";
  }
  function normaliseAngleSetupId(id){
    if(id==="direct"||id==="one")return "cranker";
    if(id==="fixed"||id==="redirect")return "fixed2";
    if(id==="twoToOne"||id==="2to1")return "two";
    if(id==="plant")return "crane";
    return id||"cranker";
  }
  function selectedPullSetup(id){const norm=normalisePullSetupId(id); return PULL_SETUPS.find(x=>x.id===norm)||PULL_SETUPS[0];}
  function selectedAngleSetup(id){const norm=normaliseAngleSetupId(id); return ANGLE_PULL_SETUPS.find(x=>x.id===norm)||ANGLE_PULL_SETUPS[1];}
  function storedPullSetup(){try{return normalisePullSetupId(localStorage.getItem(PULL_SETUP_KEY)||"cranker");}catch(e){return "cranker";}}
  function storedAngleSetup(){try{return normaliseAngleSetupId(localStorage.getItem(ANGLE_SETUP_KEY)||localStorage.getItem(PULL_SETUP_KEY)||"cranker");}catch(e){return "cranker";}}
  function pullSetupOptions(selected){return PULL_SETUPS.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?"selected":""}>${esc(x.label)}</option>`).join("");}
  function angleSetupOptions(selected){const sel=selectedAngleSetup(selected).id; return ANGLE_PULL_SETUPS.map(x=>`<option value="${esc(x.id)}" ${x.id===sel?"selected":""}>${esc(x.label)}</option>`).join("");}
  const PULL_TASK_KEY="fieldMap.pullTask.v1";
  const PULL_TASKS=[
    {id:"move",label:"Start moving only — not for unhooking",short:"Move",factor:0.15,low:0.10,high:0.25,topLabel:"Pull needed to start moving only",note:"rough rolling/sliding start force only; not for unhooking a disc string or lifting off hardware"},
    {id:"unload",label:"Unload disc string / lift off hardware",short:"Unload",factor:1.00,low:0.90,high:1.30,topLabel:"Lift/pull needed to unload string",note:"uses the selected support weight, not the small rolling-start force"}
  ];
  function selectedPullTask(id){return PULL_TASKS.find(x=>x.id===id)||PULL_TASKS.find(x=>x.id==='unload')||PULL_TASKS[0];}
  function storedPullTask(){try{const v=localStorage.getItem(PULL_TASK_KEY); return (v==="move"||v==="unload")?v:"unload";}catch(e){return "unload";}}
  function pullTaskOptions(selected){return PULL_TASKS.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?"selected":""}>${esc(x.label)}</option>`).join("");}
  function updatePullTask(taskId){
    try{localStorage.setItem(PULL_TASK_KEY,taskId);}catch(e){}
    if(CURRENT_PULL_ASSET)openPull(CURRENT_PULL_ASSET,CURRENT_PULL_LINE||"");
  }
  const INSULATOR_ALLOWANCE_KEY="fieldMap.insulatorAllowance.v1";
  const INSULATOR_ALLOWANCES=[
    {id:"auto",label:"Auto by circuit class",kg:null,note:"matches 71/72, 81/82, X1/X2 or 91/92 from the circuit name. 81/82 defaults to disc string; choose 132kV poly long rod if fitted."},
    {id:"none",label:"No insulator allowance",kg:0,note:"conductor/support load only"},
    {id:"kv66",label:"66kV / 71-72 · disc/string + hardware allowance",kg:75,note:"rough one-string allowance for 66kV / 71-72 disc/string insulator plus fittings/hardware"},
    {id:"disc132",label:"132kV / 81-82 · disc string + hardware allowance",kg:125,note:"rough one-string allowance for 132kV / 81-82 porcelain/glass disc string plus fittings/hardware"},
    {id:"poly132",label:"132kV / 81-82 · poly long rod + hardware allowance",kg:50,note:"rough one-string allowance for 132kV / 81-82 polymer long rod plus fittings/hardware; lighter than a disc string"},
    {id:"kv220",label:"220kV / X1-X2 · disc/string + hardware allowance",kg:150,note:"rough one-string allowance for 220kV / X1-X2 insulator string or long rod plus fittings/hardware"},
    {id:"disc330",label:"330kV / 91-92 · 20-disc string + hardware allowance",kg:250,note:"rough one-string allowance for 330kV / 91-92 20-disc porcelain/glass string plus fittings/hardware"}
  ];
  function allowanceById(id){return INSULATOR_ALLOWANCES.find(x=>x.id===id)||INSULATOR_ALLOWANCES[0];}
  function circuitClassAllowance(line){
    const text=String(line||"").toUpperCase().replace(/\s+/g," ");
    let picked=null;
    if(/(^|[^A-Z0-9])(91|92)([^A-Z0-9]|$)/.test(text))picked=allowanceById("disc330");
    else if(/(^|[^A-Z0-9])X\s*[12]([^A-Z0-9]|$)/.test(text))picked=allowanceById("kv220");
    else if(/(^|[^A-Z0-9])(81|82)([^A-Z0-9]|$)/.test(text))picked=allowanceById("disc132");
    else if(/(^|[^A-Z0-9])(71|72)([^A-Z0-9]|$)/.test(text))picked=allowanceById("kv66");
    if(!picked)return {id:"none",label:"Auto: no class found",kg:0,note:"auto could not match 71/72, 81/82, X1/X2 or 91/92 from this circuit name"};
    return {id:picked.id,label:`Auto: ${picked.label}`,kg:picked.kg,note:`Auto matched ${picked.label}. ${picked.note}`};
  }
  function selectedInsulatorAllowance(id,line){
    const norm=id||"auto";
    if(norm==="auto")return circuitClassAllowance(line);
    return allowanceById(norm);
  }
  function storedInsulatorAllowance(){try{return localStorage.getItem(INSULATOR_ALLOWANCE_KEY)||"auto";}catch(e){return "auto";}}
  function insulatorAllowanceOptions(selected){const sel=selected||"auto";return INSULATOR_ALLOWANCES.map(x=>`<option value="${esc(x.id)}" ${x.id===sel?"selected":""}>${esc(x.label)}</option>`).join("");}
  function updateInsulatorAllowance(id){
    try{localStorage.setItem(INSULATOR_ALLOWANCE_KEY,id||"auto");}catch(e){}
    if(document.getElementById('fieldMapAnglePullOverlay')&&CURRENT_ANGLE_PULL_ASSET){openAnglePull(CURRENT_ANGLE_PULL_ASSET,CURRENT_ANGLE_PULL_LINE||""); return;}
    if(document.getElementById('fieldMapPullLoadOverlay')&&CURRENT_PULL_ASSET){openPull(CURRENT_PULL_ASSET,CURRENT_PULL_LINE||""); return;}
    if(CURRENT_PULL_ASSET)openPull(CURRENT_PULL_ASSET,CURRENT_PULL_LINE||"");
  }
  function pullSetupHtml(required,low,high,setupId,taskId,allowanceKg=0,allowanceLabel=""){
    const task=selectedPullTask(taskId);
    const setup=selectedPullSetup(setupId);
    const divisor=Math.max(0.01,setup.ma*setup.eff);
    const effort=required/divisor;
    const lowEff=low/divisor;
    const highEff=high/divisor;
    const allowanceNote=allowanceKg>0?` Includes ${fmtKg(allowanceKg)} ${allowanceLabel}.`:"";
    return `<small>Cranker effort with selected setup</small><b>${fmtKg(effort)}</b><span>${esc(task.short)} load at the conductor/hardware is about ${fmtKg(required)}.${esc(allowanceNote)} ${setup.label} uses ${setup.ma}:1 mechanical advantage at ${Math.round(setup.eff*100)}% field efficiency (${setup.note}).</span><div class="fmPullMini"><div><em>Guide range</em><strong>${fmtKg(lowEff)} – ${fmtKg(highEff)}</strong></div><div><em>Multiplier</em><strong>÷ ${divisor.toFixed(2)}</strong></div></div>`;
  }
  function updatePullSetup(setupId){
    try{localStorage.setItem(PULL_SETUP_KEY,setupId);}catch(e){}
    const panel=document.querySelector('#fieldMapPullLoadOverlay .fmPullPanel');
    const out=document.getElementById('fieldMapPullSetupOut');
    if(!panel||!out)return;
    const required=Number(panel.dataset.requiredPull||0);
    const low=Number(panel.dataset.lowPull||0);
    const high=Number(panel.dataset.highPull||0);
    const taskId=panel.dataset.taskId||storedPullTask();
    const allowanceKg=Number(panel.dataset.insulatorAllowanceKg||0);
    const allowanceLabel=panel.dataset.insulatorAllowanceLabel||"";
    out.innerHTML=pullSetupHtml(required,low,high,setupId,taskId,allowanceKg,allowanceLabel);
  }
  function updateAngleSetup(setupId){
    try{localStorage.setItem(ANGLE_SETUP_KEY,normaliseAngleSetupId(setupId));}catch(e){}
    if(CURRENT_ANGLE_PULL_ASSET)openAnglePull(CURRENT_ANGLE_PULL_ASSET,CURRENT_ANGLE_PULL_LINE||'');
  }
  function openPullForAssetId(id){const rec=ASSET_CACHE.get(id); if(!rec?.asset){alert("Asset expired. Close and reopen the dot popup."); return;} openPull(rec.asset);}
  function openPull(asset,line=""){
    injectStyles(); CURRENT_PULL_ASSET=asset; CURRENT_PULL_LINE=line||"";
    const result=calculate(asset,line);
    const roleOverride=keepOrResetStructureOverride(result);
    const old=document.getElementById("fieldMapPullLoadOverlay"); if(old)old.remove();
    const modeId=selectedLoadMode(storedLoadMode()).id;
    const modeVals=sumModeValues(result,modeId);
    const share=Number(modeVals.supportKg);
    const full=Number(modeVals.fullKg);
    const allShare=Number(result.supportShareKg||0);
    const taskId=selectedPullTask(storedPullTask()).id;
    const task=selectedPullTask(taskId);
    const insulatorId=storedInsulatorAllowance();
    const insulator=selectedInsulatorAllowance(insulatorId,result.asset.line||"");
    const appliesInsulatorAllowance=taskId==="unload";
    const insulatorKg=appliesInsulatorAllowance?Number(insulator.kg||0):0;
    const allowanceText=insulatorKg>0?`${insulator.label}`:"";
    const normalStart=Number.isFinite(share)?share*task.factor+insulatorKg:NaN;
    const rangeLow=Number.isFinite(share)?share*task.low+insulatorKg:NaN;
    const rangeHigh=Number.isFinite(share)?share*task.high+insulatorKg:NaN;
    const rows=[
      {name:"Start moving / rolling",factor:0.15,note:"small movement force only; not enough to unload disc string"},
      {name:"Sticky hardware warning",factor:0.25,note:"poor angle, binding, dirt, rough roller or clamp drag"},
      {name:"Unload disc string / lift off hardware",factor:1.00,note:"take the selected support load before unhooking"},
      {name:"Allowance for angles / friction",factor:1.30,note:"use as a higher field warning, not a certified rigging value"}
    ];
    const rowHtml=rows.map(r=>`<div class="fmPullRow"><b>${esc(r.name)}</b><span>${fmtKg(Number.isFinite(share)?share*r.factor:NaN)}</span><small>${Math.round(r.factor*100)}% of ${fmtKg(share)} selected lift/support load · ${esc(r.note)}</small></div>`).join("");
    const warn=modeWarningText(modeVals);
    const roleHtml=structureRoleControlHtml(result.asset.asset||asset,roleOverride);
    const setupId=selectedPullSetup(storedPullSetup()).id;
    const div=document.createElement("div"); div.id="fieldMapPullLoadOverlay"; div.className="fmSWOverlay";
    div.innerHTML=`<div class="fmSWPanel fmPullPanel" data-required-pull="${normalStart}" data-low-pull="${rangeLow}" data-high-pull="${rangeHigh}" data-task-id="${esc(taskId)}" data-insulator-allowance-kg="${insulatorKg}" data-insulator-allowance-label="${esc(allowanceText)}"><div class="fmSWTop"><div><h3>Pull / Unload Load</h3><p>${esc(result.asset.line||"Unknown line")} · Structure ${esc(result.asset.plate||"Unknown")}</p></div><button class="fmSWClose" type="button" onclick="FieldMapSpanWeightCalculator.closePull()">×</button></div>
      ${roleHtml}
      <div class="fmLoadMode"><label for="fieldMapPullLoadMode">What is unclipped?</label><select id="fieldMapPullLoadMode" onchange="FieldMapSpanWeightCalculator.updatePullLoadMode(this.value)">${loadModeOptions(modeId)}</select><small>${esc(modeVals.mode.desc)}</small></div>
      <div class="fmLoadMode"><label for="fieldMapPullTask">What are you trying to do?</label><select id="fieldMapPullTask" onchange="FieldMapSpanWeightCalculator.updatePullTask(this.value)">${pullTaskOptions(taskId)}</select><small>${esc(task.note)}</small></div>
      <div class="fmLoadMode"><label for="fieldMapInsulatorAllowance">Circuit / insulator allowance</label><select id="fieldMapInsulatorAllowance" onchange="FieldMapSpanWeightCalculator.updateInsulatorAllowance(this.value)">${insulatorAllowanceOptions(insulatorId)}</select><small>${appliesInsulatorAllowance?esc(insulator.note):"Only added when Unload disc string / lift off hardware is selected."}</small></div>
      <div class="fmPullAnswer ${taskId==='move'?'fmPullMoveOnly':''}"><small>${esc(task.topLabel)} · ${esc(modeVals.mode.label)}</small><b>${fmtKg(normalStart)}</b><span>${taskId==='move'?'Start-moving force only — not enough to unhook/lift a disc string. ':''}Guide range at the conductor/hardware: ${fmtKg(rangeLow)} – ${fmtKg(rangeHigh)} based on selected task${insulatorKg>0?` · includes ${fmtKg(insulatorKg)} ${esc(insulator.label)}`:""}.</span></div>
      <div class="fmPullSetup"><label for="fieldMapPullSetupSelect">Cranker setup</label><select id="fieldMapPullSetupSelect" onchange="FieldMapSpanWeightCalculator.updatePullSetup(this.value)">${pullSetupOptions(setupId)}</select><div id="fieldMapPullSetupOut" class="fmPullSetupOut">${pullSetupHtml(normalStart,rangeLow,rangeHigh,setupId,taskId,insulatorKg,allowanceText)}</div></div>
      <div class="fmSWSecondary"><div><small>${esc(modeVals.mode.short)} lift here</small><b>${totalLabel(share,modeVals.unknown)}</b></div><div><small>${esc(modeVals.mode.short)} both full spans</small><b>${totalLabel(full,modeVals.unknown)}</b></div></div>
      <div class="fmSWSecondary"><div><small>All conductors if all unclipped</small><b>${totalLabel(allShare,result.unknown)}</b></div><div><small>Mode</small><b>${esc(modeVals.mode.label)}</b></div></div>
      ${warn?`<div class="fmSWWarn">${warn}</div>`:""}
      <details class="fmSWMore"><summary>More conductor-pull guide</summary><div class="fmPullGrid">${rowHtml}</div></details>
      <details class="fmSWMore"><summary>More info / assumptions</summary><div class="fmSWNote">Use Start conductor moving only for a small rolling/sliding movement once the conductor is already supported. To unhook a disc insulator string or lift conductor off hardware, use Unload disc string / lift off hardware because that uses the actual selected support load at the structure. The unclipped selector can now use one phase conductor, twin phase conductors, one earth/OPGW, or all conductors. Twin phase conductor means two phase sub-conductors from the same phase bundle. The insulator/hardware allowance is a rough extra dead-load allowance only: 66kV / 71-72 defaults to 75 kg, 132kV / 81-82 defaults to 125 kg for a disc string, 132kV / 81-82 poly long rod is a separate lighter 50 kg option, 220kV / X1-X2 defaults to 150 kg, and 330kV / 91-92 20-disc string defaults to 250 kg. Structure type can be auto-detected or manually overridden; this changes warnings/assumptions only, not the calculated dead weight. A 2:1 setup reduces cranker effort, but it does not reduce the load on the conductor, hardware, anchor slings, blocks or tower/pole attachment points. This is not conductor tension and not a certified lift or rigging calculation. Actual load changes with structure type, rope angle, sheave friction, binding, wind, sag and site setup. Termination/strain/angle structures can involve conductor tension and side load that this simple dead-load calculator does not model. Use equipment WLL/SWL and approved work method.</div></details></div>`;
    div.addEventListener("click",e=>{if(e.target===div)closePull();}); document.body.appendChild(div);
  }
  const ANGLE_OFFSET_KEY="fieldMap.anglePull.offsetM.v1";
  const ANGLE_TENSION_KEY="fieldMap.anglePull.tensionKg.v1"; // retained for manual override only
  const ANGLE_TENSION_MODE_KEY="fieldMap.anglePull.tensionMode.v2";
  const ANGLE_LIFT_KEY="fieldMap.anglePull.includeLift.v1";
  const ANGLE_CONDITION_KEY="fieldMap.anglePull.condition.v1";
  const ANGLE_TENSION_CONDITION_KEY="fieldMap.anglePull.tensionCondition.v1";
  const ANGLE_SIDELOAD_KEY="fieldMap.anglePull.sideLoadMode.v1";
  const ANGLE_SIDELOAD_MODES=[
    {id:"auto",label:"Auto from map line angle",includedDeg:null,note:"uses previous and next structure GPS direction. 180° is straight/tangent; lower angles create higher side-load"},
    {id:"offset",label:"Offset distance only",includedDeg:0,note:"uses only the distance-out geometry; lowest result and usually not enough for a real angle pole"},
    {id:"straight180",label:"180° straight / tangent",includedDeg:180,note:"manual line angle floor for a straight/tangent structure; adds no angle side-load unless offset pull is higher"},
    {id:"angle160",label:"160° slight angle",includedDeg:160,note:"manual line angle floor for a slight angle structure"},
    {id:"angle130",label:"130° angle pole",includedDeg:130,note:"manual line angle floor for a normal/heavy angle pole"},
    {id:"angle90",label:"90° hard angle",includedDeg:90,note:"manual line angle floor for a hard corner; high side-load warning"},
    {id:"deadend",label:"Dead-end / one-side strain",includedDeg:"deadend",note:"manual floor for termination/dead-end style pull where the setup may be fighting near full selected conductor tension"}
  ];
  const ANGLE_TENSION_CONDITIONS=[
    {id:"loose",label:"Loose / visible sag",factor:0.65,note:"for a conductor that is clearly slack, sagging, and already free to move"},
    {id:"normal",label:"Normal field tension",factor:1.00,note:"default when it looks like a normal in-service span and no stringing tension is known"},
    {id:"tight",label:"Tight / little sag",factor:1.80,note:"for a firm conductor with little sag; even 1 m of movement can take a lot more force"},
    {id:"restrained",label:"Very tight / still restrained",factor:3.00,note:"risk flag for conductor that is still tied, dead-ended, bound, or not wanting to move"}
  ];
  const ANGLE_CONDITIONS=[
    {id:"roller",label:"Free / roller supported",factor:1.3,note:"for a clean setup with conductor supported and running freely through rollers; still allows some friction"},
    {id:"normal",label:"Normal field allowance",factor:2.5,note:"default field guide for light binding, imperfect angles, hardware friction and cranker setup losses"},
    {id:"binding",label:"Binding / poor angle",factor:4.0,note:"for conductor not running freely, awkward pull angle, traveller friction or hardware binding"},
    {id:"severe",label:"Severe bind / not free",factor:6.0,note:"risk flag only; stop and reassess before forcing the conductor"}
  ];
  const ANGLE_SAG_LOW=0.05;     // larger sag = lower estimated tension
  const ANGLE_SAG_NORMAL=0.035; // rough field default when no stringing chart is available
  const ANGLE_SAG_HIGH=0.025;   // smaller sag = higher estimated tension
  function storedAngleOffset(){try{const v=n(localStorage.getItem(ANGLE_OFFSET_KEY),NaN); return Number.isFinite(v)&&v>0?v:1.2;}catch(e){return 1.2;}}
  function defaultManualAngleTension(modeId){
    if(modeId==='twin')return 4000;
    if(modeId==='earth')return 1000;
    if(modeId==='all')return 6000;
    return 2000;
  }
  function storedAngleTensionMode(){try{const v=localStorage.getItem(ANGLE_TENSION_MODE_KEY); return v==='manual'?'manual':'auto';}catch(e){return 'auto';}}
  function storedManualAngleTension(modeId){try{const v=n(localStorage.getItem(ANGLE_TENSION_KEY),NaN); if(Number.isFinite(v)&&v>0)return v;}catch(e){} return defaultManualAngleTension(modeId);}
  function storedAngleLiftMode(){try{const v=localStorage.getItem(ANGLE_LIFT_KEY); return (v==='side'||v==='sideLift')?v:'sideLift';}catch(e){return 'sideLift';}}
  function selectedAngleSideLoadMode(id){return ANGLE_SIDELOAD_MODES.find(x=>x.id===id)||ANGLE_SIDELOAD_MODES[0];}
  function storedAngleSideLoadMode(){try{return selectedAngleSideLoadMode(localStorage.getItem(ANGLE_SIDELOAD_KEY)||'auto').id;}catch(e){return 'auto';}}
  function angleSideLoadOptions(selected){return ANGLE_SIDELOAD_MODES.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.label)}</option>`).join('');}
  function selectedAngleTensionCondition(id){return ANGLE_TENSION_CONDITIONS.find(x=>x.id===id)||ANGLE_TENSION_CONDITIONS.find(x=>x.id==='normal')||ANGLE_TENSION_CONDITIONS[0];}
  function storedAngleTensionCondition(){try{return selectedAngleTensionCondition(localStorage.getItem(ANGLE_TENSION_CONDITION_KEY)||'normal').id;}catch(e){return 'normal';}}
  function angleTensionConditionOptions(selected){return ANGLE_TENSION_CONDITIONS.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.label)} · ×${x.factor}</option>`).join('');}
  function selectedAngleCondition(id){return ANGLE_CONDITIONS.find(x=>x.id===id)||ANGLE_CONDITIONS.find(x=>x.id==='normal')||ANGLE_CONDITIONS[0];}
  function storedAngleCondition(){try{return selectedAngleCondition(localStorage.getItem(ANGLE_CONDITION_KEY)||'normal').id;}catch(e){return 'normal';}}
  function angleConditionOptions(selected){return ANGLE_CONDITIONS.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.label)} · ×${x.factor}</option>`).join('');}
  function updateAngleInput(key,value){
    try{
      if(key==='offset')localStorage.setItem(ANGLE_OFFSET_KEY,String(Math.max(0,n(value,storedAngleOffset()))));
      if(key==='tension')localStorage.setItem(ANGLE_TENSION_KEY,String(Math.max(0,n(value,storedManualAngleTension(storedLoadMode())))));
      if(key==='tensionMode')localStorage.setItem(ANGLE_TENSION_MODE_KEY,value==='manual'?'manual':'auto');
      if(key==='lift')localStorage.setItem(ANGLE_LIFT_KEY,value==='side'?'side':'sideLift');
      if(key==='condition')localStorage.setItem(ANGLE_CONDITION_KEY,selectedAngleCondition(value).id);
      if(key==='tensionCondition')localStorage.setItem(ANGLE_TENSION_CONDITION_KEY,selectedAngleTensionCondition(value).id);
      if(key==='sideLoad')localStorage.setItem(ANGLE_SIDELOAD_KEY,selectedAngleSideLoadMode(value).id);
    }catch(e){}
    if(CURRENT_ANGLE_PULL_ASSET)openAnglePull(CURRENT_ANGLE_PULL_ASSET,CURRENT_ANGLE_PULL_LINE||'');
  }
  function updateAngleLoadMode(modeId){try{localStorage.setItem(LOAD_MODE_KEY,modeId);}catch(e){} if(CURRENT_ANGLE_PULL_ASSET)openAnglePull(CURRENT_ANGLE_PULL_ASSET,CURRENT_ANGLE_PULL_LINE||'');}
  function spanSideComponent(tensionKg,offsetM,spanM){
    const t=Number(tensionKg),d=Number(offsetM),l=Number(spanM);
    if(!Number.isFinite(t)||!Number.isFinite(d)||!Number.isFinite(l)||t<=0||d<=0||l<=0)return NaN;
    const angle=Math.atan(d/l);
    return t*Math.sin(angle);
  }
  function sumKnown(values){const parts=values.filter(v=>Number.isFinite(Number(v))).map(Number); return parts.length?parts.reduce((a,b)=>a+b,0):NaN;}
  function autoTensionForSpan(span,spanVals){
    const len=Number(span?.lengthM);
    const full=Number(spanVals?.fullKg);
    if(!Number.isFinite(len)||len<=0||!Number.isFinite(full)||full<=0)return {low:NaN,normal:NaN,high:NaN,kgPerM:NaN};
    const kgPerM=full/len;
    const calc=(sagRatio)=>kgPerM*len/(8*sagRatio);
    return {low:calc(ANGLE_SAG_LOW),normal:calc(ANGLE_SAG_NORMAL),high:calc(ANGLE_SAG_HIGH),kgPerM};
  }
  function tensionSetForSide(span,spanVals,tensionMode,manualTensionKg,tensionCondition){
    if(tensionMode==='manual'){const t=Number(manualTensionKg); return {low:t*0.85,normal:t,high:t*1.35,kgPerM:NaN,manual:true,factor:1};}
    const base=autoTensionForSpan(span,spanVals);
    const factor=Number(tensionCondition?.factor||1);
    const scale=(v)=>Number.isFinite(Number(v))?Number(v)*factor:NaN;
    return {low:scale(base.low),normal:scale(base.normal),high:scale(base.high),kgPerM:base.kgPerM,factor};
  }
  function sidePullSet(tensionSet,offsetM,spanM){
    return {
      low:spanSideComponent(tensionSet.low,offsetM,spanM),
      normal:spanSideComponent(tensionSet.normal,offsetM,spanM),
      high:spanSideComponent(tensionSet.high,offsetM,spanM)
    };
  }
  function xyFromAsset(origin,other){
    if(!Number.isFinite(origin?.lat)||!Number.isFinite(origin?.lng)||!Number.isFinite(other?.lat)||!Number.isFinite(other?.lng))return null;
    const latRad=origin.lat*Math.PI/180;
    const x=(other.lng-origin.lng)*111320*Math.cos(latRad);
    const y=(other.lat-origin.lat)*110540;
    const len=Math.hypot(x,y);
    if(!Number.isFinite(len)||len<=0.01)return null;
    return {x:x/len,y:y/len,len};
  }
  function angleBetweenUnit(a,b){
    if(!a||!b)return NaN;
    const dot=Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y));
    return Math.acos(dot)*180/Math.PI;
  }
  function resultantForTwoTensions(t1,t2,u1,u2){
    const a=Number(t1),b=Number(t2);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0||!u1||!u2)return NaN;
    return Math.hypot(a*u1.x+b*u2.x,a*u1.y+b*u2.y);
  }
  function resultantForIncludedAngle(t1,t2,includedDeg){
    const a=Number(t1),b=Number(t2),d=Number(includedDeg);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0||!Number.isFinite(d)||d<0||d>180)return NaN;
    // Included line angle: 180° = straight/tangent with near-zero side-load; 90° = hard angle with high resultant side-load.
    const theta=d*Math.PI/180;
    return Math.sqrt(Math.max(0,a*a+b*b+2*a*b*Math.cos(theta)));
  }
  function deadEndFloor(t1,t2){
    const vals=[t1,t2].filter(v=>Number.isFinite(Number(v))&&Number(v)>0).map(Number);
    return vals.length?Math.max(...vals):NaN;
  }
  function angleSideLoadSet(result,leftTension,rightTension,sideMode){
    const mode=selectedAngleSideLoadMode(sideMode);
    const origin=result?.asset||{};
    const uPrev=xyFromAsset(origin,result?.prevInfo);
    const uNext=xyFromAsset(origin,result?.nextInfo);
    const included=angleBetweenUnit(uPrev,uNext);
    const deviation=Number.isFinite(included)?Math.max(0,180-included):NaN;
    const calcAuto=(kind)=>resultantForTwoTensions(leftTension?.[kind],rightTension?.[kind],uPrev,uNext);
    const calcIncluded=(kind,includedDeg)=>resultantForIncludedAngle(leftTension?.[kind],rightTension?.[kind],includedDeg);
    const calcDead=(kind)=>deadEndFloor(leftTension?.[kind],rightTension?.[kind]);
    let low=NaN,normal=NaN,high=NaN,usedDeg=NaN,source=mode.label,usable=false;
    if(mode.id==='auto'){
      low=calcAuto('low'); normal=calcAuto('normal'); high=calcAuto('high'); usedDeg=included; usable=Number.isFinite(normal)&&normal>0;
      if(!usable){source='Auto from map line angle unavailable';}
    }else if(mode.id==='offset'){
      source='Offset distance only';
    }else if(mode.id==='deadend'){
      low=calcDead('low'); normal=calcDead('normal'); high=calcDead('high'); usedDeg=NaN; usable=Number.isFinite(normal)&&normal>0;
    }else{
      const deg=Number(mode.includedDeg);
      low=calcIncluded('low',deg); normal=calcIncluded('normal',deg); high=calcIncluded('high',deg); usedDeg=deg; usable=Number.isFinite(normal)&&normal>0;
    }
    return {low,normal,high,mode,source,usable,usedDeg,includedDeg:included,deviationDeg:deviation};
  }
  function anglePullMath(result,modeVals,offsetM,tensionMode,manualTensionKg,liftMode,insulatorKg,tensionCondition,condition,sideLoadMode){
    const leftM=(result.left&&result.left.ok&&Number.isFinite(Number(result.left.lengthM)))?Number(result.left.lengthM):NaN;
    const rightM=(result.right&&result.right.ok&&Number.isFinite(Number(result.right.lengthM)))?Number(result.right.lengthM):NaN;
    const leftTension=tensionSetForSide(result.left,modeVals.left,tensionMode,manualTensionKg,tensionCondition);
    const rightTension=tensionSetForSide(result.right,modeVals.right,tensionMode,manualTensionKg,tensionCondition);
    const leftSideSet=sidePullSet(leftTension,offsetM,leftM);
    const rightSideSet=sidePullSet(rightTension,offsetM,rightM);
    const offsetSideLow=sumKnown([leftSideSet.low,rightSideSet.low]);
    const offsetSidePull=sumKnown([leftSideSet.normal,rightSideSet.normal]);
    const offsetSideHigh=sumKnown([leftSideSet.high,rightSideSet.high]);
    const angleSet=angleSideLoadSet(result,leftTension,rightTension,sideLoadMode);
    const maxKnown=(a,b)=>{const av=Number(a),bv=Number(b); const vals=[av,bv].filter(v=>Number.isFinite(v)); return vals.length?Math.max(...vals):NaN;};
    const sidePullLow=maxKnown(offsetSideLow,angleSet.low);
    const sidePull=maxKnown(offsetSidePull,angleSet.normal);
    const sidePullHigh=maxKnown(offsetSideHigh,angleSet.high);
    const support=Number(modeVals.supportKg);
    const liftAdd=(liftMode==='sideLift'&&Number.isFinite(support))?support+Number(insulatorKg||0):0;
    const cleanAdd=(v)=>Number.isFinite(Number(v))?Number(v)+liftAdd:NaN;
    const cleanRequired=cleanAdd(sidePull);
    const cleanLow=cleanAdd(sidePullLow);
    const cleanHigh=cleanAdd(sidePullHigh);
    const factor=Number(condition?.factor||1);
    const applyFactor=(v)=>Number.isFinite(Number(v))?Number(v)*factor:NaN;
    return {leftM,rightM,leftTension,rightTension,leftSide:leftSideSet.normal,rightSide:rightSideSet.normal,offsetSidePull,offsetSideLow,offsetSideHigh,angleSidePull:angleSet.normal,angleSideLow:angleSet.low,angleSideHigh:angleSet.high,angleSet,sidePull,liftAdd,cleanRequired,cleanLow,cleanHigh,required:applyFactor(cleanRequired),low:applyFactor(cleanLow),high:applyFactor(cleanHigh),sidePullLow,sidePullHigh,tensionMode,manualTensionKg,tensionCondition,condition,sideLoadMode};
  }
  function openAnglePullForAssetId(id){const rec=ASSET_CACHE.get(id); if(!rec?.asset){alert("Asset expired. Close and reopen the dot popup."); return;} openAnglePull(rec.asset);}
  function openAnglePull(asset,line=""){
    injectStyles(); CURRENT_ANGLE_PULL_ASSET=asset; CURRENT_ANGLE_PULL_LINE=line||"";
    const result=calculate(asset,line);
    const roleOverride=keepOrResetStructureOverride(result);
    const old=document.getElementById("fieldMapAnglePullOverlay"); if(old)old.remove();
    const modeId=selectedLoadMode(storedLoadMode()).id;
    const modeVals=sumModeValues(result,modeId);
    const setupId=selectedAngleSetup(storedAngleSetup()).id;
    const setup=selectedAngleSetup(setupId);
    const offsetM=storedAngleOffset();
    const tensionMode=storedAngleTensionMode();
    const manualTensionKg=storedManualAngleTension(modeId);
    const liftMode=storedAngleLiftMode();
    const insulatorId=storedInsulatorAllowance();
    const insulator=selectedInsulatorAllowance(insulatorId,result.asset.line||"");
    const insulatorKg=liftMode==='sideLift'?Number(insulator.kg||0):0;
    const tensionCondition=selectedAngleTensionCondition(storedAngleTensionCondition());
    const condition=selectedAngleCondition(storedAngleCondition());
    const sideLoadMode=selectedAngleSideLoadMode(storedAngleSideLoadMode());
    const m=anglePullMath(result,modeVals,offsetM,tensionMode,manualTensionKg,liftMode,insulatorKg,tensionCondition,condition,sideLoadMode.id);
    const divisor=setup.ma*setup.eff;
    const effort=Number.isFinite(m.required)&&divisor>0?m.required/divisor:NaN;
    const effortLow=Number.isFinite(m.low)&&divisor>0?m.low/divisor:NaN;
    const effortHigh=Number.isFinite(m.high)&&divisor>0?m.high/divisor:NaN;
    const warn=modeWarningText(modeVals);
    const sideOnly=liftMode==='side';
    const spanText=[Number.isFinite(m.leftM)?`previous ${fmtM(m.leftM)}`:'previous unknown',Number.isFinite(m.rightM)?`next ${fmtM(m.rightM)}`:'next unknown'].join(' · ');
    const tensionSourceText=tensionMode==='manual'?'Manual line tension override':'Auto rough tension from map span/weight';
    const tensionSummary=tensionMode==='manual'?`Manual tension ${fmtKg(manualTensionKg)} for each known side`:`Auto tension used: previous ${fmtKg(m.leftTension.normal)} · next ${fmtKg(m.rightTension.normal)}`;
    const manualTensionHtml=tensionMode==='manual'?`<div class="fmLoadMode"><label for="fieldMapAngleTensionKg">Manual line tension</label><input id="fieldMapAngleTensionKg" inputmode="numeric" type="number" step="100" min="0" value="${esc(manualTensionKg)}" onchange="FieldMapSpanWeightCalculator.updateAngleInput('tension',this.value)"><small>kg tension for the selected conductor/bundle. Only use if you have a better field estimate.</small></div>`:'';
    const autoTensionNote=tensionMode==='auto'?'Uses conductor weight and adjacent span lengths from the app with rough sag assumptions. It does not use a stringing chart, temperature or ruling span.':'';
    const div=document.createElement("div"); div.id="fieldMapAnglePullOverlay"; div.className="fmSWOverlay";
    div.innerHTML=`<div class="fmSWPanel fmPullPanel"><div class="fmSWTop"><div><h3>Angle Pole Pull-Back</h3><p>${esc(result.asset.line||"Unknown line")} · Structure ${esc(result.asset.plate||"Unknown")}</p></div><button class="fmSWClose" type="button" onclick="FieldMapSpanWeightCalculator.closeAnglePull()">×</button></div>
      ${structureRoleControlHtml(result.asset.asset||asset,roleOverride)}
      <div class="fmLoadMode"><label for="fieldMapAngleLoadMode">What are you pulling?</label><select id="fieldMapAngleLoadMode" onchange="FieldMapSpanWeightCalculator.updateAngleLoadMode(this.value)">${loadModeOptions(modeId)}</select><small>${esc(modeVals.mode.desc)}</small></div>
      <div class="fmAngleInputs"><div class="fmLoadMode"><label for="fieldMapAngleOffsetM">Distance conductor is out</label><input id="fieldMapAngleOffsetM" inputmode="decimal" type="number" step="0.1" min="0" value="${esc(offsetM)}" onchange="FieldMapSpanWeightCalculator.updateAngleInput('offset',this.value)"><small>metres sideways/back to hardware or pole.</small></div><div class="fmLoadMode"><label for="fieldMapAngleTensionMode">Line tension source</label><select id="fieldMapAngleTensionMode" onchange="FieldMapSpanWeightCalculator.updateAngleInput('tensionMode',this.value)"><option value="auto" ${tensionMode==='auto'?'selected':''}>Auto from map span/weight</option><option value="manual" ${tensionMode==='manual'?'selected':''}>Manual override</option></select><small>${esc(autoTensionNote||'Manual mode uses your entered tension value.')}</small></div></div>
      ${manualTensionHtml}
      <div class="fmLoadMode"><label for="fieldMapAngleTensionCondition">Conductor condition / tension</label><select id="fieldMapAngleTensionCondition" onchange="FieldMapSpanWeightCalculator.updateAngleInput('tensionCondition',this.value)">${angleTensionConditionOptions(tensionCondition.id)}</select><small>${tensionMode==='manual'?'Manual tension override is being used, so this selector is not added on top of your entered tension.':esc(tensionCondition.note)+'. This adjusts the auto tension estimate by ×'+tensionCondition.factor+'.'}</small></div>
      <div class="fmLoadMode"><label for="fieldMapAngleSideLoadMode">Line angle at pole</label><select id="fieldMapAngleSideLoadMode" onchange="FieldMapSpanWeightCalculator.updateAngleInput('sideLoad',this.value)">${angleSideLoadOptions(sideLoadMode.id)}</select><small>${esc(sideLoadMode.note)}${m.angleSet&&Number.isFinite(m.angleSet.usedDeg)?' · line angle used ≈ '+Math.round(m.angleSet.usedDeg)+'°':''}.</small></div>
      <div class="fmLoadMode"><label for="fieldMapAngleCondition">Pull condition / friction allowance</label><select id="fieldMapAngleCondition" onchange="FieldMapSpanWeightCalculator.updateAngleInput('condition',this.value)">${angleConditionOptions(condition.id)}</select><small>${esc(condition.note)}. This multiplies the clean map-geometry minimum by ×${condition.factor}.</small></div>
      <div class="fmLoadMode"><label for="fieldMapAngleLiftMode">Include support/unload load?</label><select id="fieldMapAngleLiftMode" onchange="FieldMapSpanWeightCalculator.updateAngleInput('lift',this.value)"><option value="sideLift" ${liftMode==='sideLift'?'selected':''}>Side pull + unload/lift hardware</option><option value="side" ${liftMode==='side'?'selected':''}>Side pull only</option></select><small>${sideOnly?'Only estimates the sideways pull from tension geometry.':'Adds selected support load plus insulator/hardware allowance.'}</small></div>
      <div class="fmLoadMode"><label for="fieldMapAngleInsulatorAllowance">Circuit / insulator allowance</label><select id="fieldMapAngleInsulatorAllowance" onchange="FieldMapSpanWeightCalculator.updateInsulatorAllowance(this.value)">${insulatorAllowanceOptions(insulatorId)}</select><small>${sideOnly?'Not added when Side pull only is selected.':esc(insulator.note)}</small></div>
      <div class="fmPullAnswer"><small>Crane / cranker effort to pull back to angle pole</small><b>${fmtKg(effort)}</b><span>Field guide range: ${fmtKg(effortLow)} – ${fmtKg(effortHigh)} with ${esc(setup.label)}. Clean minimum includes the higher of offset pull ${fmtKg(m.offsetSidePull)} and angle side-load ${fmtKg(m.angleSidePull)} before ×${condition.factor} ${esc(condition.label)} allowance.</span></div>
      <div class="fmPullSetup"><label for="fieldMapAngleSetupSelect">Angle pull-back rigging setup</label><select id="fieldMapAngleSetupSelect" onchange="FieldMapSpanWeightCalculator.updateAngleSetup(this.value)">${angleSetupOptions(setupId)}</select><div class="fmPullSetupOut"><small>Field guide before setup advantage</small><b>${fmtKg(m.required)}</b><span>Clean minimum ${fmtKg(m.cleanRequired)} × ${condition.factor} ${esc(condition.label)}. Side-pull used ${fmtKg(m.sidePull)} = higher of offset ${fmtKg(m.offsetSidePull)} or angle-load ${fmtKg(m.angleSidePull)}${sideOnly?'':` + lift/unload component ${fmtKg(m.liftAdd)}`}. ${setup.label} uses ${setup.ma}:1 at ${Math.round(setup.eff*100)}% field efficiency.</span><div class="fmPullMini"><div><em>Previous side</em><strong>${fmtKg(m.leftSide)}</strong></div><div><em>Next side</em><strong>${fmtKg(m.rightSide)}</strong></div></div></div></div>
      <div class="fmSWSecondary"><div><small>Selected lift here</small><b>${totalLabel(modeVals.supportKg,modeVals.unknown)}</b></div><div><small>Span lengths used</small><b>${esc(spanText)}</b></div></div>
      <div class="fmSWSecondary"><div><small>Tension source</small><b>${esc(tensionSourceText)}</b></div><div><small>Conductor tension condition</small><b>${esc(tensionCondition.label)}${tensionMode==='manual'?'':` ×${tensionCondition.factor}`}</b></div></div>
      <div class="fmSWSecondary"><div><small>Friction / bind allowance</small><b>${esc(condition.label)} ×${condition.factor}</b></div><div><small>Clean minimum before factor</small><b>${fmtKg(m.cleanRequired)}</b></div></div>
      <div class="fmSWSecondary"><div><small>Offset side pull</small><b>${fmtKg(m.offsetSidePull)}</b></div><div><small>Angle side-load floor</small><b>${fmtKg(m.angleSidePull)}</b></div></div>
      <div class="fmSWSecondary"><div><small>Estimated tension</small><b>${esc(tensionSummary)}</b></div><div><small>Offset distance</small><b>${fmtM(offsetM)}</b></div></div>
      ${warn?`<div class="fmSWWarn">${warn}</div>`:""}
      <div class="fmAngleWarning">Angle-pole pull-back is dominated by actual conductor tension, rope angle, binding, rollers and hardware geometry. Distance out alone is not enough: a tight conductor moved 1 m can require more effort than a loose conductor moved 15 m. This is still not a certified rigging or plant load calculation.</div>
      <details class="fmSWMore"><summary>More info / assumptions</summary><div class="fmSWNote">Auto mode estimates line tension from the selected conductor weight and adjacent span lengths using rough sag bands: low ≈ 5% sag, normal ≈ 3.5% sag, high ≈ 2.5% sag. The conductor condition/tension selector then adjusts that auto estimate for loose, normal, tight, or very tight/restrained conductor. Formula used for each side: estimated tension ≈ selected span weight ÷ (8 × sag ratio), adjusted by conductor condition, then offset pull ≈ tension × sin(atan(offset / span length)). The app also calculates an angle-pole side-load floor from adjacent GPS line direction where possible, or from the selected manual included line angle: 180° straight/tangent, 130° angle pole, 90° hard angle. For equal tension on both sides, 180° adds almost no angle side-load, while 90° is a high resultant side-load. The clean side-pull uses whichever is higher: offset pull or angle side-load. If Side pull + unload/lift is selected, the app adds the selected conductor support load plus the chosen insulator/hardware allowance. The selected friction/bind condition then multiplies that clean minimum to allow for rollers, binding and poor field geometry. Crane and direct cranker are 1:1; two fixed rollers are still 1:1 and only redirect the pull; the 2:1 tower termination setup assumes a moving roller/block on the conductor and rope returned/terminated back to the pole. This gives a field guide from map data only; it does not know actual sag, stringing tension, temperature, ruling span, wind, binding or roller friction. Check slings, blocks, pole/tower attachment points and approved work method.</div><div class="fmAngleFormula">Formula: ${esc(tensionSummary)} · offset pull = ${fmtKg(m.offsetSidePull)} · angle side-load = ${fmtKg(m.angleSidePull)} · clean side pull used = ${fmtKg(m.sidePull)}. Clean total before cranker advantage = ${fmtKg(m.cleanRequired)}. Field guide before cranker advantage = ${fmtKg(m.required)} after ×${condition.factor} ${esc(condition.label)} allowance.</div></details></div>`;
    div.addEventListener("click",e=>{if(e.target===div)closeAnglePull();}); document.body.appendChild(div);
  }
  function openAnglePullForCurrent(){if(CURRENT_ANGLE_PULL_ASSET)openAnglePull(CURRENT_ANGLE_PULL_ASSET,CURRENT_ANGLE_PULL_LINE||'');}
  function closeAnglePull(){const el=document.getElementById("fieldMapAnglePullOverlay"); if(el)el.remove();}
  function closePull(){const el=document.getElementById("fieldMapPullLoadOverlay"); if(el)el.remove();}
  function patchPopupEngine(){return true;}
  async function chooseConductorFile(){
    let input=document.getElementById("fieldMapSpanWeightFileInput"); if(!input){input=document.createElement("input"); input.type="file"; input.accept=".json,.txt"; input.id="fieldMapSpanWeightFileInput"; input.style.display="none"; input.addEventListener("change",async()=>{const file=input.files&&input.files[0]; if(!file)return; try{const s=await importConductorFile(file); alert(`Loaded ${s.length} conductor sections locally.`); close();}catch(err){alert("Conductor import failed: "+(err?.message||err));}}); document.body.appendChild(input);} input.value=""; input.click();
  }
  function clearConductorSections(){localStorage.removeItem(STORAGE_KEY); invalidateCalculatorCaches(); alert("Cleared locally imported conductor span sections. Bundled sections remain available.");}
  window.FieldMapSpanWeightCalculator={open,close,openPull,closePull,openAnglePull,closeAnglePull,updatePullSetup,updateAngleSetup,updatePullTask,updateInsulatorAllowance,updateWeightLoadMode,updatePullLoadMode,updateAngleLoadMode,updateAngleInput,updateStructureRoleOverride,calculate,auditAsset,specAudit,loadSections,getSpec,importConductorFile,chooseConductorFile,clearConductorSections,openForAssetId,openPullForAssetId,openAnglePullForAssetId,openAnglePullForCurrent,invalidateCalculatorCaches,buttonHtmlForAsset,roughPullButtonHtmlForAsset,anglePullButtonHtmlForAsset,calculatorMenuHtmlForAsset,registerAsset,shouldOffer,setSpecs,fmtM,fmtKg,get specs(){return refreshSpecLookup();}};
  let timer=setInterval(()=>{if(patchPopupEngine())clearInterval(timer);},250); document.addEventListener("DOMContentLoaded",patchPopupEngine);
})();
