const PopupEngine={
  esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));},
  clean(s){return String(s??'').replace(/^\uFEFF/,'').trim();},
  compact(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');},
  firstRaw(a,patterns=[]){
    const raw=a?.raw||{};
    for(const [k,v] of Object.entries(raw)){
      if(v===undefined||v===null||String(v).trim()==='')continue;
      if(patterns.some(p=>p.test(k)))return this.clean(v);
    }
    return '';
  },
  gisLabel(a){
    const direct=this.clean(a?.gisLabel);
    if(direct)return direct;
    const raw=this.firstRaw(a,[/trmsn.*line.*gis.*label/i,/line.*gis.*label/i,/gis.*label/i,/circuit.*structure.*label/i]);
    if(raw)return raw;
    const fields=[a?.label,a?.structure,a?.rawStructure,a?.line].map(x=>this.clean(x)).filter(Boolean);
    return fields.find(v=>/[A-Z]{1,4}\s*[-_ ]\s*[A-Z]{1,4}\s*\d{1,4}\s*[-_ ]\s*\d{1,5}/i.test(v))||'';
  },
  cleanGisDisplay(label){
    const text=this.clean(label);
    if(!text)return '';
    const refs=window.SearchEngine?.extractLineRefsFromText?.(text)||[];
    if(refs.length){
      const pieces=refs.map(r=>`${r.line}${r.pole?'-'+r.pole:''}`);
      return pieces.join(', ');
    }
    return text.replace(/,\s*[A-Z]{1,4}(?:[-–—][A-Z]{1,4})?\s*$/,'').trim();
  },
  partsFromGis(label){
    const text=this.clean(label);
    if(!text)return {line:'',pole:''};
    const refs=window.SearchEngine?.extractLineRefsFromText?.(text)||[];
    if(refs.length)return {line:refs[0].line,pole:refs[0].pole||''};
    const m=text.match(/^(.+?\b[A-Z0-9]*\d[A-Z0-9]{0,4})[\s_-]+(\d{1,5})$/i);
    if(!m)return {line:text,pole:''};
    return {line:m[1].trim(),pole:m[2]};
  },
  displayLine(a){
    const aliases=window.SearchEngine?.lineAliasesForAsset?.(a)||[];
    if(aliases.length>1)return aliases.join(', ');
    if(aliases.length===1)return aliases[0];
    const parts=this.partsFromGis(this.gisLabel(a));
    const raw=parts.line||this.clean(a?.line)||this.clean(this.firstRaw(a,[/^LINE_NAME$/i,/circuit/i,/feeder/i,/route/i]));
    return window.SearchEngine?.formatCircuitName?SearchEngine.formatCircuitName(raw):raw;
  },
  poleNo(a){
    const refs=window.SearchEngine?.lineRefsForAsset?.(a)||[];
    const poles=[...new Set(refs.map(r=>String(r.pole||'').trim()).filter(Boolean))];
    if(poles.length>1)return poles.join(', ');
    if(poles.length===1)return poles[0];
    const parts=this.partsFromGis(this.gisLabel(a));
    if(parts.pole)return parts.pole;
    if(a?.poleNumber)return this.clean(a.poleNumber);
    const rawPole=this.firstRaw(a,[/pole.*(no|num|number)/i,/structure.*(no|num|number)/i,/point.*(no|id)/i,/s_?no/i,/snum/i]);
    if(rawPole){
      const text=this.clean(rawPole);
      const m=text.match(/(?:POLE|TOWER|STRUCTURE|POINT|S)?\s*#?\s*0*(\d{1,5})\b/i);
      if(m)return m[1];
      return text;
    }
    const label=this.clean(a?.label||a?.structure||a?.rawStructure);
    let m=label.match(/[\s_-]0*(\d{1,5})$/);
    if(m)return m[1];
    m=label.match(/(?:POLE|TOWER|STRUCTURE|S)\s*#?\s*0*(\d{1,5})\b/i);
    if(m)return m[1];
    return '';
  },
  inferredTitle(a){
    const refs=window.SearchEngine?.lineRefsForAsset?.(a)||[];
    const cleanRefs=[];
    for(const r of refs){
      const line=window.SearchEngine?.formatCircuitName?SearchEngine.formatCircuitName(r.line):this.clean(r.line);
      const pole=this.clean(r.pole);
      if(!line||!pole)continue;
      const key=this.compact(line)+'|'+this.compact(pole);
      if(!cleanRefs.some(x=>x.key===key))cleanRefs.push({line,pole,key});
    }
    if(cleanRefs.length>1)return cleanRefs.map(r=>`${r.line}-${r.pole}`).join(', ');
    return '';
  },
  displayTitle(a){
    const isPole=this.isPoleTower(a);
    const inferred=this.inferredTitle(a);
    if(isPole&&inferred)return inferred;
    const gis=this.gisLabel(a);
    const cleaned=this.cleanGisDisplay(gis);
    if(isPole&&cleaned)return cleaned;
    if(cleaned)return cleaned;
    return this.clean(a?.label||a?.structure||a?.equip||a?.substation||a?.line||'Asset');
  },
  isPoleTower(a){
    const raw=a?.raw||{};
    const kind=String(a?.kind||'').toLowerCase();
    const refKind=window.SearchEngine?.isReferencePointAsset?.(a)?(window.SearchEngine?.referenceKind?SearchEngine.referenceKind(a):kind):'';
    const referenceText=[kind,a?.category,a?.type,a?.label,a?.substation,a?.terminal,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.DEPOT_NAME,raw.SEARCH_FIELD,raw.SUBSTATION_TYPE].join(' ').toUpperCase();
    // Do not classify substations, terminals or depots as poles just because fields such as AER_NSP contain "Transmission".
    if(/^(substation|terminal|depot)$/.test(refKind)||/\b(SUBSTATION|SUBSTN|TERMINAL|DEPOT|SWITCHYARD|ZONE SUB)\b/.test(referenceText))return false;
    if(kind==='electrical-enclosure'||kind==='transformer'||kind==='streetlight'||kind==='distribution-pole')return false;
    if(kind==='structure'||kind==='tower'||kind==='pole'||kind==='transmission-structure')return true;
    const structuralText=[kind,a?.category,a?.gisLabel,a?.label,a?.line,a?.structure,a?.rawStructure,raw.STRUCTURE_LABEL,raw.STRUCTURE_ID,raw.STRUCTURE_NO,raw.STRUCT_NO,raw.POLE_NUMBER,raw.POLE_NO,raw.TOWER_NO,raw.STRUC_TYP_DESC,raw.STRUCTURE_TYPE,raw.POLE_TYPE,raw.MATRL_TYP_DESC].join(' ').toUpperCase();
    return /\b(POLE|TOWER|STRUCTURE|STRUC)\b/.test(structuralText);
  },
  assetHtml(a){
    const gps=Number.isFinite(a?.lat)&&Number.isFinite(a?.lon);
    const isPole=this.isPoleTower(a);
    const gis=this.gisLabel(a);
    const line=this.displayLine(a);
    const pole=this.poleNo(a);
    const title=this.displayTitle(a);
    const summaryRows=[];
    const crossingWarn=null;
    const infoRows=this.infoRows(a,{gis,line,pole,title});
    const shownValues=[title,gis,line,pole,...summaryRows.map(r=>r[1]),...infoRows.map(r=>r[1])].map(v=>String(v||'').trim()).filter(Boolean);
    const rawRows=this.extraRows(a,shownValues);
    const calculatorMenuHtml=(window.FieldMapSpanWeightCalculator&&typeof window.FieldMapSpanWeightCalculator.calculatorMenuHtmlForAsset==='function')?window.FieldMapSpanWeightCalculator.calculatorMenuHtmlForAsset(a):'';
    const calculatorActions=calculatorMenuHtml?`<div class="popup-calculator-actions single">${calculatorMenuHtml}</div>`:'';
    const maps=gps?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.lat+','+a.lon)}`:'';
    const earth=gps?`https://earth.google.com/web/search/${encodeURIComponent(a.lat+','+a.lon)}`:'';
    const mapLinkTitle=a?.inferredMissingStructure?'Estimated placeholder coordinate - open in Google Maps':'Open in Google Maps';
    const earthLinkTitle=a?.inferredMissingStructure?'Estimated placeholder coordinate - open in Google Earth':'Open in Google Earth';
    const isReferencePoint=!!(window.SearchEngine?.isReferencePointAsset?.(a)||window.MapEngine?.isConnectedReferenceCandidate?.(a));
    const refKind=isReferencePoint&&window.SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a?.kind||'').toLowerCase();
    const refId=this.esc(String(a?.id||''));
    const isAllSubstationsView=String(window.MapEngine?.currentDisplay||'').toLowerCase()==='all substations';
    const rawText=Object.entries(a?.raw||{}).map(([k,v])=>`${k} ${v}`).join(' ');
    const refText=[refKind,a?.kind,a?.category,a?.type,a?.label,a?.substation,a?.terminal,rawText].join(' ').toUpperCase();
    const looksDepot=refKind==='depot'||String(a?.kind||'').toLowerCase()==='depot'||/\bDEPOT\b/.test(refText);
    const looksSubOrTerminal=!looksDepot&&(refKind==='substation'||refKind==='terminal'||String(a?.kind||'').toLowerCase()==='substation'||String(a?.kind||'').toLowerCase()==='terminal'||isAllSubstationsView||(!isPole&&/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|ZONE SUB|\bTER\b|\bSUB\b/.test(refText)));
    const strictCodes=looksSubOrTerminal?(window.MapEngine?.connectedStrictCodesForReference?.(a)||[]):[];
    const codeFromList=(strictCodes&&strictCodes.length)?String(strictCodes[0]||''):'';
    // Connected lines use ONLY this explicit abbreviation. No derived/proximity/name fallback.
    const connectedCode=String(codeFromList||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const safeConnectedCode=/^[A-Z0-9]{1,6}$/.test(connectedCode)&&/[A-Z]/.test(connectedCode)?connectedCode:'';
    const canShowConnected=!!(looksSubOrTerminal&&safeConnectedCode);
    const refToken=canShowConnected?(window.MapEngine?.registerConnectedReferenceAsset?.(a)||String(a?.id||'')):'';
    const connectedActive=canShowConnected&&window.MapEngine?.isConnectedReferenceActive?.(refToken,safeConnectedCode);
    const connectedCircuitsAction=canShowConnected?`<button class="show-connected-circuits-btn always-visible" type="button" data-connected-token="${this.esc(refToken)}" data-connected-code="${this.esc(safeConnectedCode)}" onclick="return window.fmConnectedBtn?.(this,event);">${connectedActive?'Hide':'Show'} connected circuits</button>`:'';
    const rawSubtitle=!isPole&&!looksDepot?this.clean(SearchEngine.subtitle(a)):'';
    const subtitle=(safeConnectedCode&&this.compact(rawSubtitle)===this.compact(safeConnectedCode))?'':rawSubtitle;
    const codeLine=canShowConnected&&safeConnectedCode?`<div class="popup-sub ref-abbrev">${this.esc(safeConnectedCode)}</div>`:'';
    const titleToken=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const titleArg=this.esc(encodeURIComponent(String(titleToken||'')));
    return `<div class="asset-popup">
      <button class="popup-title popup-title-zoom" type="button" title="Zoom to asset" onclick="return window.MapEngine?.zoomToPopupAsset?.('${titleArg}',event);">${this.esc(title)}</button>
      ${codeLine}
      ${a?.inferredMissingStructure?`<div class="popup-missing-warning">NO DATA FOUND · estimated from neighbouring confirmed structures</div>`:''}
      ${subtitle?`<div class="popup-sub">${this.esc(subtitle)}</div>`:''}
      ${summaryRows.length?`<div class="popup-grid popup-summary">${this.rows(summaryRows)}</div>`:''}
      ${window.UtilitiesEngine?.assetBadgeHtml?UtilitiesEngine.assetBadgeHtml(a):''}
      <div class="popup-actions ${gps?'three':''}">
        ${gps?`<a href="${maps}" target="_blank" rel="noopener" title="${mapLinkTitle}" aria-label="${mapLinkTitle}">Google Maps</a><a href="${earth}" target="_blank" rel="noopener" title="${earthLinkTitle}" aria-label="${earthLinkTitle}">Google Earth</a>`:`<button class="secondary" type="button">No map point</button>`}
      </div>
      <details class="popup-more-details"><summary class="more-info-btn">More info</summary><div class="popup-more"><div class="popup-section-title">More info</div>${calculatorActions}<div class="popup-info-box">${crossingWarn?`<div class="popup-crossing-warning">${this.esc(crossingWarn.text)}</div>`:''}${this.rows(infoRows)}${this.utilityDetailsHtml(a)}${rawRows}</div></div></details>
      ${connectedCircuitsAction?`<div class="popup-reference-actions">${connectedCircuitsAction}</div>`:''}
    </div>`;
  },
  utilityDetailsHtml(){return '';},
  detailSourceAsset(a,line='',pole=''){
    try{
      const rawKeys=Object.keys(a?.raw||{}).length;
      const hasCore=rawKeys>6&&(a?.poleHeight||a?.poleLength||a?.material||a?.category||this.firstRaw(a,[/STRUC.*TYP/i,/POLE.*HEIGHT/i,/POLE.*LEN/i,/MATRL/i,/MATERIAL/i]));
      if(!a?.inferredMissingStructure&&hasCore)return a;
      const hit=window.SearchEngine?.findDetailAsset?.(line,pole,a);
      return hit||a;
    }catch(e){return a;}
  },
  infoRows(a,{gis,line,pole,title}){
    const src=this.detailSourceAsset(a,line,pole)||a;
    const raw=src?.raw||{};
    const get=(patterns)=>this.firstRaw(src,patterns);
    const rows=[];
    const add=(k,v)=>{v=this.clean(v); if(v)rows.push([k,v]);};
    if(src!==a)add('Data source','matched imported pole/tower record');
    if(src?.publicRecovery||src?.sourceQuality==='public-recovery-real-gps'||src?.raw?.PUBLIC_RECOVERY){
      add('Data status','RECOVERED PUBLIC GPS point');
      add('Recovery source','Cleaned public transmission pole dataset');
      if(src?.raw?.PUBLIC_DUPLICATE_COUNT)add('Raw duplicates collapsed',src.raw.PUBLIC_DUPLICATE_COUNT);
      if(src?.raw?.PUBLIC_COORD_VARIANTS&&Number(src.raw.PUBLIC_COORD_VARIANTS)>1)add('Coordinate variants',src.raw.PUBLIC_COORD_VARIANTS);
    }
    if(a?.inferredMissingStructure){
      add('Data status',src!==a?'Estimated map point; details recovered from imported pole/tower record':'NO DATA FOUND - estimated placeholder');
      if(a?.inferredFrom?.before||a?.inferredFrom?.after)add('Estimated between',`${a.inferredFrom.before||'?'} → ${a.inferredFrom.after||'?'}`);
      if(Number.isFinite(Number(a?.lat))&&Number.isFinite(Number(a?.lon)))add('Map links','Google Maps / Google Earth use this estimated placeholder coordinate');
    }
    add('GIS label',gis||this.gisLabel(src));
    add('Line',line);
    add('Pole',pole);
    if(Array.isArray(src?.inferredLineRefs)&&src.inferredLineRefs.length){
      add('Inferred circuit',src.inferredLineRefs.map(r=>`${r.line}${r.pole?'-'+r.pole:''}`).join(', '));
    }
    add('Type',src?.category||get([/STRUC_TYP_DESC/i,/STRUCTURE_TYPE/i,/ASSET_TYPE/i,/TYPE$/i]));
    add('Pole type',get([/^pole_type$/i,/POLE.*TYPE/i]));
    add('Structure type',get([/STRUC.*TYP.*DESC/i,/SUB_STRUC_DESC/i,/STRUC_CAT_DESC/i]));
    add('Material',src?.material||get([/MATERIAL/i,/MATRL/i]));
    add('Conductor',src?.conductor||get([/CONDUCTOR/i,/WIRE_TYPE/i,/OPGW/i]));
    const conductorLinks=Array.isArray(src?.conductorLinks)&&src.conductorLinks.length?src.conductorLinks:(window.SearchEngine?.conductorLinksForAsset?.(src)||window.SearchEngine?.conductorLinksForAsset?.(a)||[]);
    if(conductorLinks.length){
      add('Conductor span',conductorLinks.slice(0,4).map(l=>`${l.line} ${l.fromPole}-${l.toPole}: ${l.conductor}`).join('; '));
    }
    add('Voltage',src?.voltage||get([/VOLTAGE/i,/\bKV\b/i]));
    add('Pole length',src?.poleLength||get([/POLE.*LEN/i,/LENGTH/i]));
    add('Pole height',src?.poleHeight||get([/POLE.*HEIGHT/i,/HEIGHT/i]));
    add('Drawing',get([/NP_DWG_NO/i,/DRAWING/i,/DWG/i]));
    const seen=new Set();
    return rows.filter(([k,v])=>{
      const key=`${k}|${v}`.toUpperCase();
      if(seen.has(key))return false;
      seen.add(key);
      return v && String(v)!==String(title);
    });
  },
  rows(rows){
    return rows.filter(([,v])=>v!==undefined&&v!==null&&String(v).trim()!=='').map(([k,v])=>`<div class="popup-row"><b>${this.esc(k)}</b><span>${this.esc(v)}</span></div>`).join('');
  },
  prettyKey(k){
    const map={trmsn_line_gis_label:'GIS label',pole_type:'Pole type',NP_DWG_NO:'Drawing',STRUC_TYP_DESC:'Structure type',SUB_STRUC_DESC:'Sub structure',STRUC_CAT_DESC:'Category',OBJECTID:'Object ID',UTILITY_DETAIL_SUMMARY:'Service detail summary'};
    if(map[k])return map[k];
    return String(k).replace(/^original\./i,'').replace(/^DETAIL /i,'Detail ').replace(/_/g,' ').replace(/\b(kpa|kv|dn|id|gps|hv|ug)\b/ig,m=>m.toUpperCase()).replace(/\b\w/g,c=>c.toUpperCase());
  },
  safeFileName(name){return String(name||'').replace(/_?WP_\d{3}/ig,'').replace(/_?WA_GDA2020/ig,'').replace(/_?Public_Secure/ig,'').replace(/NCMT_/ig,'').replace(/_/g,' ').replace(/\s+/g,' ').trim();},
  safeSource(label){return String(label||'').replace(/geojson/ig,'map file').replace(/json/ig,'JSON').replace(/csv/ig,'CSV');},
  coord(v){
    const n=Number(v);
    return Number.isFinite(n)?String(Math.round(n*1000000)/1000000):String(v);
  },
  extraRows(a,shownValues=[]){
    const raw=a?.raw||{};
    const shown=new Set(shownValues.map(v=>String(v||'').trim()).filter(Boolean));
    const skip=/^(ROUTE_COORDS|coordinates|geometry|SHAPE|the_geom|x|y|lat|lon|latitude|longitude|gps_?lat|gps_?lon|gps_?long|gps|geometry\.x|geometry\.y|source_coords\..*|source_coords|GEOMETRY_TYPE|source|source_type|sourceType|source_file|sourceFile|sourceFiles|sources|file|filename|file_name|parser|parserVersion|importedAt|storageKey)$/i;
    const isDepot=(window.SearchEngine?.referenceKind?.(a)==='depot')||String(a?.kind||'').toLowerCase()==='depot'||/\bDEPOT\b/i.test([a?.label,a?.substation,a?.terminal,raw.DEPOT_NAME,raw.SEARCH_FIELD].join(' '));
    const depotAbbrevSkip=/^(ABBREVIATION|ABBREV|ABBR|ACRONYM|SHORT_NAME|SHORTCODE|CODE|ALIAS|SITE_CODE|STATION_CODE|STN_CODE|SUBSTATION_CODE|SUBSTN_CODE|SUB_CODE|TERMINAL_CODE|TER_CODE|TERMINAL_ABBR|SUBSTATION_ABBR)$/i;
    const preferred=/trmsn.*line.*gis.*label|pole_type|struc.*typ|sub_struc|struc_cat|np_dwg|line|circuit|feeder|route|name|label|structure|pole|tower|asset|type|class|voltage|conductor|height|length|material|substation|street|transformer|kva|objectid|utility|nearby|nearest|pressure|kpa|kv|voltage|diam|size/i;
    const entries=Object.entries(raw)
      .filter(([k,v])=>v!==undefined&&v!==null&&String(v).trim()!==''&&!skip.test(k)&&!(isDepot&&depotAbbrevSkip.test(k))&&String(v).length<120)
      .sort((a,b)=>(preferred.test(b[0])?1:0)-(preferred.test(a[0])?1:0))
      .filter(([k,v])=>!shown.has(String(v).trim()))
      .slice(0,12);
    if(!entries.length)return '';
    return entries.map(([k,v])=>`<div class="popup-row"><b>${this.esc(this.prettyKey(k))}</b><span>${this.esc(v)}</span></div>`).join('');
  }
};
