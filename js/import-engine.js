const ImportEngine={
  aliases:{
    line:['line_name','LINE_NAME','LINE_NAME_1','LINE_NAME_2','LINE_NAME_3','Line Name','Line','LINE','CIRCUIT','CIRCUIT_NAME','CIRCUIT_NO','CIRCUIT_ID','CIRCUITID','CCT','CCT_ID','FEEDER','FEEDER_NAME','FEEDERID','TX_LINE','LINENAME','TRANSMISSION_CIRCUIT','ROUTE','ROUTE_NAME','ROUTENAME','NETWORK_NAME','NETWORK_ID','netwk_name','NETWK_NAME','NAME','Name','name','TITLE','Title','title','LABEL','Label','label','ASSET_NAME','FEATURE_NAME','OBJECT_NAME','DISPLAY_NAME'],
    structure:['STRUCTURE_LABEL','structure_label','Structure Label','STRUCTURE','structure_id','STRUCTURE_ID','POLE','POLE_ID','POLE_NUMBER','POLE_NO','pole_number','TOWER','TOWER_NO','TOWER_NUMBER','STRUCTURE_NO','STRUCT_NO','STRUCTURENUMBER','STRUCTURE_NUM','S_NO','SNUM','S_NUM','S#','NO','NUMBER','STRUCTURE ID','STRUCTUREID','NAMEPLATE_ID','NAMEPLATE_ID_1','SITE_NO','LABEL','Label','label','POINT_NO','POINT_ID'],
    equip:['equip_name','EQUIP_NAME','EQUIP_NO','Equipment No','EQUIPMENT_NO','ELLIPSE_PLNT_NO','Ellipse Plant No','PLANT_NO','ASSET_ID','asset_id','pick_id','PICK_ID','OBJECTID','OBJECT_ID','GLOBALID','GLOBAL_ID','ID','id'],
    lat:['LATITUDE','Latitude','latitude','lat','LAT','Y','y','GPS_LAT','Y_COORD','CENTROID_Y','geometry.y','source_coords.latitude'],
    lon:['LONGITUDE','Longitude','longitude','lng','lon','LON','LONG','X','x','GPS_LONG','GPS_LON','X_COORD','CENTROID_X','geometry.x','source_coords.longitude'],
    easting:['EASTING','EASTING_COORD','MGA_EASTING','X_COORD','Easting','x_coord','source_coords.easting'],
    northing:['NORTHING','NORTHING_COORD','MGA_NORTHING','Y_COORD','Northing','y_coord','source_coords.northing'],
    material:['MATRL_TYP_DESC','Material Description','MATERIAL','Material','MATRL','STRUC_MAT'],
    category:['asset_type','ASSET_TYPE','EQUIP_GRP_ID_DESC','EQUIP_GRP_DESC','STRUC_CAT_DESC','STRUCTURE_TYPE','STRUC_TYP_DESC','Structure Type Description','TYPE','Feature Type','FEATURE_TYPE','LAYER','LAYER_NAME','layer','layerName','CLASS','CLASSIFICATION','ASSET_CLASS','GEOMETRY_TYPE','pole_type','POLE_TYPE'],
    subStructure:['SUB_STRUC_DESC','Sub Structure Description','SUB_STRUCTURE','SUBTYPE'],
    poleLength:['POLE_LEN_M','Pole Length','Pole Length (m)','POLE_LENGTH','LENGTH','LEN_M'],
    poleHeight:['POLE_HEIGHT_M','Pole Height','Pole Height (m)','POLE_HEIGHT','HEIGHT','HEIGHT_M'],
    conductor:['CONDUCTOR_ID_DESC','Conductor','CONDUCTOR','CABLE_TYPE','CONDUCTOR_TYPE','WIRE_TYPE','PHASE_CONDUCTOR','EARTHWIRE','OPGW','EARTH_WIRE_1_ID_DESC','EARTH_WIRE_2_ID_DESC'],
    voltage:['VOLTAGE','Voltage','KV','kv','NOMINAL_VOLTAGE','OPERATING_VOLTAGE'],
    substation:['SUBSTATION','SUBSTATION_NAME','STATION_NAME','STN_NAME','STATION','SUBSTN','SUB_NAME','SITE_NAME','SEARCH_FIELD','ABBREVIATION','DEPOT_NAME'],
    address:['ADDRESS','LOCATION','SITE_ADDRESS','ADDRESS_FULL','STREET_ADDRESS','ROAD_NAME','STREET_NAME','STREET','ROAD','COMMON_USAGE_NAME','DEPOT_NAME','SUBURB','LOCALITY','TOWN'],
    description:['DESCRIPTION','DESC','Description','description','COMMENTS','NOTES'],
    transformer:['TRANSFORMER','TX','DISTRIBUTION_TRANSFORMER','KVA','RATING_KVA','equip_name','EQUIP_NAME'],
    streetlight:['STREETLIGHT','STREET_LIGHT','LIGHT','LAMP','LUMINAIRE'],
    gisLabel:['trmsn_line_gis_label','TRMSN_LINE_GIS_LABEL','Trmsn Line Gis Label','TRMSN_LINE_LABEL','LINE_GIS_LABEL','GIS_LABEL','Gis Label','gis_label','line_gis_label','LINE_LABEL','CIRCUIT_STRUCTURE_LABEL','STRUCTURE_LABEL','structure_label'],
    poleNumber:['NAMEPLATE_ID_1','NAMEPLATE_ID','POLE_NUMBER','POLE_NO','POLE_NUM','STRUCTURE_NO','STRUCT_NO','S_NO','SNUM','POINT_NO','POINT_ID']
  },
  largeFileThreshold: 18 * 1024 * 1024,
  lastParseStats:null,
  parserVersion:'parser41-dx-hv-crossing-sidecar',
  currentReader:null,
  currentStreamReader:null,
  formatBytes(n){
    n=Number(n)||0;
    if(n<1024)return n+' B';
    if(n<1024*1024)return (n/1024).toFixed(1)+' KB';
    return (n/1024/1024).toFixed(1)+' MB';
  },
  makeAbortError(message='Import cancelled'){
    const err=new Error(message);
    err.name='AbortError';
    return err;
  },
  assertNotCancelled(){
    if(this.cancelRequested)throw this.makeAbortError(this.cancelReason||'Import cancelled');
  },
  fileSignature(file){
    return {name:String(file?.name||''),size:Number(file?.size)||0,lastModified:Number(file?.lastModified)||0};
  },
  isSameImportedFile(meta={},file){
    const sig=this.fileSignature(file);
    if(!sig.name||!sig.size)return false;
    if(String(meta.name||'')!==sig.name)return false;
    if(Number(meta.size||0)!==sig.size)return false;
    // Only skip when a prior import saved the browser lastModified value too.
    // Older imports without this value are reloaded once, then future identical uploads are skipped.
    if(!Number(meta.lastModified)||!sig.lastModified)return false;
    if(Number(meta.lastModified)!==sig.lastModified)return false;
    if(String(meta.parserVersion||'')!==String(this.parserVersion||''))return false;
    const savedSearch=meta.schema?.searchIndex||'';
    const curSearch=App.schema?.searchIndex||'';
    if(savedSearch&&curSearch&&savedSearch!==curSearch)return false;
    return true;
  },
  hasLoadedAssetsForFile(meta={},file=null){
    // V3.1.80 guard: do not skip an unchanged file if its saved records are not actually loaded.
    // This keeps smart-skip from hiding substations/terminals/depots after a partial save or old cache state.
    const name=String(file?.name||meta?.name||'');
    if(!name)return false;
    const expected=Number(meta.count||meta.assetsIndexed||meta.featuresRead||0);
    if(!expected)return true; // sidecar/skipped files are allowed to skip
    const assets=Array.isArray(App.assets)?App.assets:[];
    for(const a of assets){
      if(String(a?.sourceFile||'')===name)return true;
      if(Array.isArray(a?.sourceFiles)&&a.sourceFiles.some(x=>String(x||'')===name))return true;
      if(Array.isArray(a?.sources)&&a.sources.some(x=>String(x?.file||x||'')===name))return true;
    }
    return false;
  },
  cancelImport(){
    if(!this.importRunning){
      if(typeof SearchEngine!=='undefined'&&SearchEngine.cancelRebuild?.())return;
      UI.toast?.('No active import or index rebuild to cancel.');
      return;
    }
    this.cancelRequested=true;
    this.cancelReason='Import cancelled by user';
    App.importBatch=App.importBatch||{};
    App.importBatch.status='cancelling';
    UI.progress(true,'Cancelling import…','Stopping the current file. Partial data from this file will be discarded.',Math.max(1,UI.progressState?.pct||1));
    try{
      if(this.currentWorker){
        try{this.currentWorker.postMessage({type:'cancel'});}catch(e){}
        try{this.currentWorker.terminate();}catch(e){}
      }
      if(this.currentReader){try{this.currentReader.abort();}catch(e){}}
      if(this.currentStreamReader){try{this.currentStreamReader.cancel(this.makeAbortError('Import cancelled. Current file was not loaded.'));}catch(e){}}
      if(this.currentReject)this.currentReject(this.makeAbortError('Import cancelled. Current file was not loaded.'));
    }catch(e){}
    UI.toast?.('Cancelling current import…');
  },
  async importFiles(files,opts={}){
    if(this.importRunning){
      UI.toast?.('Import already running. Wait for it to finish.');
      throw new Error('Import already running');
    }
    this.importRunning=true;
    this.cancelRequested=false;
    this.cancelReason='';
    this.currentWorker=null;
    this.currentReader=null;
    this.currentStreamReader=null;
    this.currentReject=null;
    const list=Array.from(files||[]);
    opts=opts||{};
    const deferFileIndex=!!opts.deferFileIndex;
    const bundleImport=!!opts.bundleImport;
    const meta=[];
    let importedTotal=0;
    let skippedUnchanged=0;
    let changedCoreFiles=0;
    let crossingImportedTotal=0;
    let merged=Array.isArray(App.assets)?App.assets:[];
    const totalBytes=list.reduce((n,f)=>n+(Number(f.size)||0),0);
    const largeCount=list.filter(f=>(Number(f.size)||0)>=this.largeFileThreshold).length;
    App.importBatch={startedAt:new Date().toISOString(),fileCount:list.length,totalBytes,largeCount,status:'running',bundleImport};
    App.indexHealth=App.indexHealth||{mode:'file-level',queue:[],files:[]};
    App.indexHealth.queue=list.map((f,idx)=>({name:f.name,size:f.size,status:'queued',position:idx+1,parserVersion:this.parserVersion,queuedAt:new Date().toISOString()}));
    UI.renderImportQueue?.(list,'Queued for sequential import');
    UI.progress(true,bundleImport?'myMap bundle import…':'Import queue…',`${list.length} file(s) queued · ${this.formatBytes(totalBytes)} total · ${bundleImport?'substations/depots → structures → conductors':'sequential safe mode'}`,2);
    if(list.length>=6){
      UI.toast?.('Mobile safe mode: 6+ files queued. Large background files are kept out of the main asset search.');
    }
    try{
    for(let i=0;i<list.length;i++){
      this.assertNotCancelled();
      const file=list[i];
      const existingFile=(App.files||[]).find(f=>String(f?.name||'')===String(file.name||''));
      if(existingFile&&this.isSameImportedFile(existingFile,file)&&this.hasLoadedAssetsForFile(existingFile,file)){
        skippedUnchanged++;
        const skippedMeta={...existingFile,indexStatus:existingFile.indexStatus||'active',skippedUnchanged:true,checkedAt:new Date().toISOString()};
        meta.push(skippedMeta);
        this.setIndexHealthFile(file.name,{status:'unchanged - skipped',position:i+1,size:file.size,indexFinishedAt:new Date().toISOString(),indexResult:{skippedUnchanged:true}});
        UI.progress(true,'Skipping unchanged file…',`${file.name}: already imported and loaded`,Math.round(((i+0.8)/Math.max(1,list.length))*92));
        await this.idle();
        continue;
      }
      // Importing a changed file with the same name should replace that file, not stack duplicates.
      // This also keeps mobile memory lower because old records for that source are removed before parsing the new file.
      if(existingFile){
        await this.deleteImportedFile(file.name,{silent:true,skipSave:true,skipRunningCheck:true,skipUi:true,reason:'replace-before-import'});
        merged=Array.isArray(App.assets)?App.assets:[];
      }
      this.setIndexHealthFile(file.name,{status:'importing',position:i+1,startedAt:new Date().toISOString(),size:file.size,lastModified:Number(file.lastModified)||0});
      const ext=(file.name.split('.').pop()||'').toLowerCase();

      if(this.shouldDirectDxPoleStore(file,ext)){
        try{
          const dxMeta=await this.importLargeDxPoleStoreOnly(file,ext,i,list.length);
          meta.push(dxMeta);
          App.files=[...(App.files||[]),dxMeta];
          this.setIndexHealthFile(file.name,{status:'dx-pole-indexed',featuresRead:Number(dxMeta.featuresRead||0),assetsIndexed:0,dxPoleCount:Number(dxMeta.dxPoleCount||0),skipped:Number(dxMeta.skipped||0),finishedAt:new Date().toISOString()});
          await StorageEngine?.saveManifestOnly?.().catch(()=>{});
          UI.refreshCounts?.();
          UI.refreshFiles?.();
          await this.idle();
        }catch(dxErr){
          if(dxErr?.name==='AbortError'){this.setIndexHealthFile(file.name,{status:'cancelled',error:'Cancelled during Dx pole store',finishedAt:new Date().toISOString()}); throw dxErr;}
          Diagnostics.capture(new Error(`Direct Dx pole-store import failed for ${file.name}: ${dxErr.message||dxErr}`));
          this.setIndexHealthFile(file.name,{status:'failed',error:String(dxErr.message||dxErr),finishedAt:new Date().toISOString()});
        }
        continue;
      }

      if(this.isLikelyUtilitySourceFile(file.name)){
        const skipMeta={
          name:file.name,size:file.size,lastModified:Number(file.lastModified)||0,type:ext||file.type,count:0,featuresRead:0,assetsIndexed:0,skipped:0,
          importedAt:new Date().toISOString(),mode:'skipped-optional-background',parserVersion:this.parserVersion,
          schema:App.schema||{},indexStatus:'skipped-optional-background',storageMode:'none',storageKey:''
        };
        meta.push(skipMeta);
        App.files=[...(App.files||[]),skipMeta];
        this.setIndexHealthFile(file.name,{status:'skipped-optional-background',featuresRead:0,assetsIndexed:0,skipped:0,finishedAt:new Date().toISOString()});
        await StorageEngine?.saveManifestOnly?.().catch(()=>{});
        UI.progress(true,`Skipping optional background file ${i+1}/${list.length}`,`${file.name}: core-only build keeps background/proximity layers disabled`,Math.round(((i+0.85)/list.length)*92));
        UI.refreshCounts?.();
        await this.idle();
        continue;
      }
      App.importBatch.current=i+1;
      App.importBatch.currentFile=file.name;
      UI.renderImportQueue?.(list.map((f,idx)=>idx<i?{...f,name:f.name,size:f.size,assetsIndexed:meta[idx]?.assetsIndexed||meta[idx]?.count||0}:f),`Importing ${i+1}/${list.length}`);
      let records=[];
      try{
        UI.progress(true,`Importing ${i+1}/${list.length}`,`${file.name} — checking format · ${this.formatBytes(file.size)} · batch ${this.formatBytes(totalBytes)}`,Math.max(3,Math.round((i/list.length)*82)));
        records=await this.parseFileToRecords(file,ext,i,list.length);
        this.assertNotCancelled();
      }catch(err){
        if(err?.name==='AbortError'){
          this.setIndexHealthFile(file.name,{status:'cancelled',error:'Cancelled before loading data',finishedAt:new Date().toISOString()});
          throw err;
        }
        Diagnostics.capture(new Error(`Import failed for ${file.name}: ${err.message||err}`));
        this.setIndexHealthFile(file.name,{status:'failed',error:String(err.message||err),finishedAt:new Date().toISOString()});
        records=[];
      }
      const allParsedRecords=Array.isArray(records)?records:[];
      let crossingRecords=allParsedRecords.filter(r=>r&&typeof r==='object'&&(String(r.kind||'').toLowerCase()==='hv-crossing'||HVCrossingsLayer?.isCrossingAsset?.(r)||this.isHVCrossingRecord(r.raw||r,file.name)));
      let crossingStoreResult={stored:0,total:0};
      if(crossingRecords.length){
        UI.progress(true,`Importing crossings ${i+1}/${list.length}`,`${file.name}: saving ${crossingRecords.length.toLocaleString()} HV/TX crossing point(s) to sidecar layer`,Math.round(((i+0.72)/list.length)*92));
        try{crossingStoreResult=await HVCrossingsLayer.storeImported(crossingRecords,file.name,{size:file.size}); crossingImportedTotal+=Number(crossingStoreResult.stored||0);}catch(crossErr){Diagnostics?.capture?.(new Error('HV/TX crossing sidecar import failed: '+(crossErr?.message||crossErr))); crossingRecords=[];}
      }
      let utilityRecords=[];
      records=allParsedRecords.filter(r=>r&&typeof r==='object'&&!/^utility-/i.test(String(r.kind||''))&&String(r.kind||'').toLowerCase()!=='hv-crossing'&&!HVCrossingsLayer?.isCrossingAsset?.(r)&&!this.isHVCrossingRecord(r.raw||r,file.name));
      const normalCompactStats=this.compactImportRecords(records,'normal');
      records=normalCompactStats.records;
      const utilityCompactStats={records:[],rawFieldsBefore:0,rawFieldsAfter:0,rawFieldsDropped:0,compacted:0};
      const utilityTypes=[];
      importedTotal+=records.length;
      if(records.length)changedCoreFiles++;
      const stats=this.lastParseStats||{};
      meta.push({
        name:file.name,
        size:file.size,
        lastModified:Number(file.lastModified)||0,
        type:ext||file.type,
        count:records.length,
        utilityCount:utilityRecords.length||0,
        utilityTypes,
        crossingCount:crossingRecords.length||0,
        crossingStored:Number(crossingStoreResult.stored||0),
        featuresRead:Number(stats.featuresRead||0),
        assetsIndexed:records.length,
        skipped:Number(stats.skipped||0),
        rawFieldsBefore:Number(normalCompactStats.rawFieldsBefore||0)+Number(utilityCompactStats.rawFieldsBefore||0),
        rawFieldsAfter:Number(normalCompactStats.rawFieldsAfter||0)+Number(utilityCompactStats.rawFieldsAfter||0),
        rawFieldsDropped:Number(normalCompactStats.rawFieldsDropped||0)+Number(utilityCompactStats.rawFieldsDropped||0),
        compactedRecords:Number(normalCompactStats.compacted||0)+Number(utilityCompactStats.compacted||0),
        importedAt:new Date().toISOString(),
        mode:file.size>=this.largeFileThreshold?'large-safe':'normal',
        parserVersion:this.parserVersion,
        schema:App.schema||{},
        indexStatus:records.length?'pending index':(crossingRecords.length?'crossing-sidecar':'skipped'),
        storageMode:records.length?'per-file-chunks':(crossingRecords.length?'hv-tx-crossing-sidecar':'none'),
        storageKey:records.length?this.makeFileStorageKey(file.name):''
      });
      this.setIndexHealthFile(file.name,{status:records.length?'parsed':'skipped',featuresRead:Number(stats.featuresRead||0),assetsIndexed:records.length,skipped:Number(stats.skipped||0),rawFieldsDropped:Number(normalCompactStats.rawFieldsDropped||0),compactedRecords:Number(normalCompactStats.compacted||0)});
      const featureNote=stats.featuresRead?`${Number(stats.featuresRead).toLocaleString()} features read · `:'';
      const skipNote=stats.skipped?` · ${Number(stats.skipped).toLocaleString()} skipped`:'';
      UI.progress(true,`Merging ${i+1}/${list.length}`,`${file.name}: ${featureNote}${records.length.toLocaleString()} assets indexed${skipNote}`,Math.round(((i+0.85)/list.length)*92));
      if(records.length){
        try{
          this.assertNotCancelled();
          if(this.shouldAppendOnlyImport(merged,records,file)){
            merged=await this.appendRecordsSafely(merged,records,file.name,i,list.length);
          }else{
            merged=await this.mergeRecordsSafely(merged,records,file.name,i,list.length);
          }
          this.assertNotCancelled();
        }catch(mergeErr){
          if(mergeErr?.name==='AbortError'){
            this.setIndexHealthFile(file.name,{status:'cancelled',error:'Cancelled during merge before loading data',finishedAt:new Date().toISOString()});
            throw mergeErr;
          }
          Diagnostics.capture(new Error('Merge failed, using safe append instead: '+(mergeErr.message||mergeErr)));
          if(!Array.isArray(merged))merged=[];
          for(const r of records){if(r)merged.push(r);}
        }
      }else{
        UI.progress(true,`Skipping normal asset merge ${i+1}/${list.length}`,`${file.name}: no core assets to merge`,Math.round(((i+0.91)/list.length)*92));
        await this.paint();
      }
      this.assertNotCancelled();
      // SPCK/mobile memory hardening: do not clone the whole imported file just for indexing.
      // Large GeoJSON imports can contain tens of thousands of objects; records.slice() caused
      // a second full copy right at the end of loading, which is where SPCK most often crashed.
      const recordsForIndex=records;
      App.assets=merged;
      App.files=[...(App.files||[]),meta[meta.length-1]];
      const fileMeta=meta[meta.length-1];
      if(false&&utilityRecords.length&&StorageEngine?.saveUtilityFileAssets){
        fileMeta.utilitySavePctStart=Math.round(((i+0.905)/list.length)*96);
        fileMeta.utilitySavePctEnd=Math.round(((i+0.935)/list.length)*96);
        UI.progress(true,'Saving background data…',`${file.name}: saving ${utilityRecords.length.toLocaleString()} background records outside the main asset search`,fileMeta.utilitySavePctStart);
        try{await StorageEngine.saveUtilityFileAssets(fileMeta,utilityRecords);}
        catch(utilSaveErr){Diagnostics.capture(new Error(`Utility store save failed for ${file.name}: ${utilSaveErr.message||utilSaveErr}`));}
        delete fileMeta.utilitySavePctStart; delete fileMeta.utilitySavePctEnd;
      }
      if(records.length&&StorageEngine?.saveFileAssets){
        fileMeta.savePctStart=Math.round(((i+0.935)/list.length)*96);
        fileMeta.savePctEnd=Math.round(((i+0.955)/list.length)*96);
        UI.progress(true,'Saving imported file…',`${file.name}: saving assets to local database`,fileMeta.savePctStart);
        try{await StorageEngine.saveFileAssets(fileMeta,records);}
        catch(fileSaveErr){Diagnostics.capture(new Error(`Per-file save failed for ${file.name}: ${fileSaveErr.message||fileSaveErr}`));}
        delete fileMeta.savePctStart; delete fileMeta.savePctEnd;
      }
      if(deferFileIndex){
        meta[meta.length-1].indexStatus=recordsForIndex.length?'pending bundle rebuild':'active';
        this.setIndexHealthFile(file.name,{status:recordsForIndex.length?'pending bundle rebuild':'active',indexFinishedAt:new Date().toISOString(),indexResult:{indexed:0,deferred:true}});
      }else{
        this.setIndexHealthFile(file.name,{status:'indexing',indexStartedAt:new Date().toISOString()});
        UI.progress(true,'File-level indexing…',`${file.name}: updating search data`,Math.round(((i+0.95)/list.length)*96));
        try{
          const indexRes=recordsForIndex.length&&SearchEngine.indexFileRecords?await SearchEngine.indexFileRecords(recordsForIndex,meta[meta.length-1],`Indexing ${i+1}/${list.length}`,{deferCircuitPath:true}):{indexed:0};
          meta[meta.length-1].indexStatus='active';
          meta[meta.length-1].indexResult=indexRes;
          this.setIndexHealthFile(file.name,{status:'active',indexFinishedAt:new Date().toISOString(),indexResult:indexRes});
        }catch(indexErr){
          meta[meta.length-1].indexStatus='failed';
          this.setIndexHealthFile(file.name,{status:'failed',error:String(indexErr.message||indexErr),indexFinishedAt:new Date().toISOString()});
          Diagnostics.capture(new Error(`File-level indexing failed for ${file.name}: ${indexErr.message||indexErr}`));
        }
      }
      // Release the imported-file array after it has been merged and indexed/saved.
      // The merged database remains in App.assets; this only drops the temporary file list.
      try{records.length=0;}catch(e){}
      UI.refreshCounts?.();
      await this.idle();
    }
    App.assets=merged;
    const conductorSpanCount=(merged||[]).filter(a=>SearchEngine?.isConductorSpanAsset?.(a)).length;
    if(changedCoreFiles&&(deferFileIndex||conductorSpanCount)){
      UI.progress(true,bundleImport?'Final bundle rebuild…':'Linking conductor data…',conductorSpanCount?`${conductorSpanCount.toLocaleString()} conductor span records found · linking to poles/towers by circuit and nameplate range`:'Building one final search index after bundle import',94);
      try{
        if(SearchEngine?.rebuildAsync)await SearchEngine.rebuildAsync(bundleImport?'myMap bundle rebuild':'Conductor link rebuild');
        else SearchEngine?.rebuild?.();
        for(const m of meta){ if(m&&!m.skippedUnchanged){ m.indexStatus='active'; m.indexResult={bundleRebuild:true}; this.setIndexHealthFile(m.name,{status:'active',indexFinishedAt:new Date().toISOString(),indexResult:{bundleRebuild:true}}); } }
      }
      catch(linkErr){Diagnostics.capture(new Error('Final conductor/bundle rebuild failed: '+(linkErr.message||linkErr)));}
    }else if(changedCoreFiles&&SearchEngine?.buildCircuitPathIndexAsync){
      UI.progress(true,'Optimising circuit paths…','Building connected-line paths once for changed imports',94);
      try{await SearchEngine.buildCircuitPathIndexAsync(merged,'Circuit path optimiser');}
      catch(pathErr){Diagnostics?.log?.('Circuit path optimiser skipped',String(pathErr?.message||pathErr));}
    }else if(skippedUnchanged&&SearchEngine?.buildReferenceIndex){
      // Refresh the lightweight reference/path indexes after a smart-skip batch.
      // This does not re-import data, and avoids the V3.1.79 state where files were loaded but reference points were not visible.
      UI.progress(true,'Refreshing saved indexes…','Checking substations, terminals, depots and connected-line paths',94);
      try{SearchEngine.buildReferenceIndex(merged||[]); if(SearchEngine.buildCircuitPathIndex)SearchEngine.buildCircuitPathIndex(merged||[],{force:true});}
      catch(refreshErr){Diagnostics?.log?.('Smart-skip index refresh skipped',String(refreshErr?.message||refreshErr));}
    }
    const importHealth=this.buildImportHealth(meta,merged,{conductorSpanCount,crossingImportedTotal});
    App.lastImport={time:new Date().toISOString(),files:meta,totalImported:importedTotal,totalMerged:merged.length,skippedUnchanged,parserVersion:this.parserVersion,schema:App.schema||{},conductorSpans:conductorSpanCount,crossingImported:crossingImportedTotal,importHealth};
    UI.progress(true,'Finalising import queue…',conductorSpanCount?'Conductor spans linked. Import complete.':'Import complete.',96);
    await this.paint();
    UtilitiesEngine?.invalidateGrid?.();
    App.dbNeedsRebuild=false;
    App.indexHealth=App.indexHealth||{mode:'file-level',queue:[],files:[]};
    App.indexHealth.lastQueueComplete=new Date().toISOString();
    UI.progress(true,'Saving local database…','Updating saved file list.',97);
    try{
      if(StorageEngine.saveManifestOnly)await StorageEngine.saveManifestOnly();
      else await StorageEngine.saveAll();
    }
    catch(saveErr){Diagnostics.capture(new Error('Save failed after import. The data may remain until refresh only. '+(saveErr.message||saveErr)));}
    UI.progress(false);
    App.importBatch.status='complete';
    this.importRunning=false;
    return {imported:importedTotal,merged:merged.length,files:meta,skippedUnchanged,needsFullRebuild:false,crossingImported:crossingImportedTotal};
    }catch(err){
      App.importBatch=App.importBatch||{};
      App.importBatch.status=err?.name==='AbortError'?'cancelled':'failed';
      this.importRunning=false;
      this.currentWorker=null;
      this.currentReader=null;
      this.currentStreamReader=null;
      this.currentReject=null;
      UI.progress(false);
      throw err;
    }
  },
  detectFieldMapBundleKind(file){
    const name=String(file?.name||'').toUpperCase();
    if(/FIELD[_\s-]*MAP[_\s-]*READYCOND|READYCOND|CONDUCTOR|\bCOND\b/.test(name))return 'conductor';
    if(/FIELD[_\s-]*MAP[_\s-]*READYSUBREAL|READYSUBREAL|DEPOT|DEPOTS|TERMINAL|TERMINALS/.test(name))return 'subreal';
    if(/FIELD[_\s-]*MAP[_\s-]*READYSUB|READYSUB|SUBSTATION|SUBSTATIONS|(?:^|[_\s-])SUBS(?:[_\s-]|$)|SUB[_\s-]*BUNDLE/.test(name))return 'sub';
    if(/FIELD[_\s-]*MAP[_\s-]*READYPOL|READYPOL|POLE|POLES/.test(name))return 'pole';
    if(/FIELD[_\s-]*MAP[_\s-]*READYTOW|READYTOW|TOWER|TOWERS/.test(name))return 'tower';
    if(/FIELD[_\s-]*MAP[_\s-]*READYNOM|READYNOM|NON[_\s-]*WOOD|NONWOOD|MONOPOLE|NOM/.test(name))return 'nonwood';
    return 'other';
  },
  sortFieldMapBundleFiles(files){
    const order={subreal:10,sub:20,pole:30,tower:40,nonwood:50,other:60,conductor:90};
    return Array.from(files||[]).map((file,idx)=>({file,idx,kind:this.detectFieldMapBundleKind(file)}))
      .sort((a,b)=>(order[a.kind]||60)-(order[b.kind]||60)||a.idx-b.idx)
      .map(x=>x.file);
  },
  bundleOrderSummary(files){
    const counts={};
    for(const f of Array.from(files||[])){const k=this.detectFieldMapBundleKind(f); counts[k]=(counts[k]||0)+1;}
    const label={subreal:'depots/terminals',sub:'substations',pole:'poles',tower:'towers',nonwood:'non-wood poles',conductor:'conductors',other:'other'};
    return ['subreal','sub','pole','tower','nonwood','conductor','other'].filter(k=>counts[k]).map(k=>`${counts[k]} ${label[k]||k}`).join(' · ');
  },
  isZipFile(file){
    const name=String(file?.name||'').toLowerCase();
    return name.endsWith('.zip')||/zip/i.test(String(file?.type||''));
  },
  async expandBundleSelection(files){
    const out=[];
    for(const file of Array.from(files||[])){
      if(this.isZipFile(file)){
        UI.progress?.(true,'Reading bundle ZIP…',`${file.name}: extracting local JSON/TXT/CSV files`,2);
        const extracted=await this.unzipBundleFile(file);
        out.push(...extracted);
      }else out.push(file);
    }
    return out;
  },
  u16(view,off){return view.getUint16(off,true);},
  u32(view,off){return view.getUint32(off,true);},
  async inflateZipDeflate(bytes,name='zip entry'){
    if(typeof DecompressionStream==='undefined')throw new Error(`Cannot unzip ${name}: this browser has no built-in ZIP deflate support. Select the JSON bundle files directly instead.`);
    const tryFormats=['deflate-raw','deflate'];
    let lastErr=null;
    for(const fmt of tryFormats){
      try{
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }catch(err){lastErr=err;}
    }
    throw new Error(`Cannot unzip ${name}: compressed ZIP entry failed to inflate. Select the JSON bundle files directly instead. ${lastErr?.message||''}`);
  },
  makePseudoFile(bytes,name,type='application/json'){
    try{return new File([bytes],name,{type});}
    catch(e){const blob=new Blob([bytes],{type}); blob.name=name; return blob;}
  },
  async unzipBundleFile(file){
    const buffer=await file.arrayBuffer();
    const view=new DataView(buffer);
    const bytes=new Uint8Array(buffer);
    const decoder=new TextDecoder();
    const min=Math.max(0,bytes.length-66000);
    let eocd=-1;
    for(let i=bytes.length-22;i>=min;i--){if(this.u32(view,i)===0x06054b50){eocd=i;break;}}
    if(eocd<0)throw new Error(`${file.name}: ZIP end marker not found. Select the six JSON files directly.`);
    const entries=this.u16(view,eocd+10);
    const cdSize=this.u32(view,eocd+12);
    const cdOffset=this.u32(view,eocd+16);
    if(!entries||!cdSize||cdOffset>=bytes.length)throw new Error(`${file.name}: ZIP central directory is invalid.`);
    let off=cdOffset;
    const out=[];
    for(let n=0;n<entries&&off<bytes.length;n++){
      if(this.u32(view,off)!==0x02014b50)break;
      const method=this.u16(view,off+10);
      const compSize=this.u32(view,off+20);
      const uncompSize=this.u32(view,off+24);
      const nameLen=this.u16(view,off+28);
      const extraLen=this.u16(view,off+30);
      const commentLen=this.u16(view,off+32);
      const localOffset=this.u32(view,off+42);
      const name=decoder.decode(bytes.slice(off+46,off+46+nameLen));
      off+=46+nameLen+extraLen+commentLen;
      if(!name||name.endsWith('/'))continue;
      if(!/\.(json|geojson|txt|csv)$/i.test(name))continue;
      if(this.u32(view,localOffset)!==0x04034b50)continue;
      const localNameLen=this.u16(view,localOffset+26);
      const localExtraLen=this.u16(view,localOffset+28);
      const dataStart=localOffset+30+localNameLen+localExtraLen;
      const dataEnd=dataStart+compSize;
      if(dataEnd>bytes.length)throw new Error(`${file.name}: ${name} is truncated inside ZIP.`);
      const comp=bytes.slice(dataStart,dataEnd);
      let data;
      if(method===0)data=comp;
      else if(method===8)data=await this.inflateZipDeflate(comp,name);
      else throw new Error(`${file.name}: ${name} uses unsupported ZIP compression method ${method}. Select the JSON files directly.`);
      if(uncompSize&&Math.abs(data.length-uncompSize)>2)Diagnostics?.log?.('ZIP size warning',`${name}: expected ${uncompSize}, got ${data.length}`);
      const cleanName=name.split('/').pop()||name;
      out.push(this.makePseudoFile(data,cleanName,cleanName.endsWith('.csv')?'text/csv':(cleanName.endsWith('.txt')?'text/plain':'application/json')));
      await this.idle?.();
    }
    if(!out.length)throw new Error(`${file.name}: no JSON/TXT/CSV bundle files found inside ZIP.`);
    return out;
  },
  async importFieldMapBundleSet(files){
    const expanded=await this.expandBundleSelection(files);
    const sorted=this.sortFieldMapBundleFiles(expanded);
    if(!sorted.length)throw new Error('No myMap bundle files selected.');
    UI.renderImportQueue?.(sorted,'myMap bundle order');
    UI.toast?.(`Bundle order: ${this.bundleOrderSummary(sorted)}`);
    return this.importFiles(sorted,{bundleImport:true,deferFileIndex:true});
  },
  async readFileTextCancellable(file){
    this.assertNotCancelled();
    if(typeof FileReader==='undefined'){
      const text=await file.text();
      this.assertNotCancelled();
      return text;
    }
    return await new Promise((resolve,reject)=>{
      let done=false;
      const reader=new FileReader();
      this.currentReader=reader;
      this.currentReject=(err)=>{
        if(done)return;
        done=true;
        try{reader.abort();}catch(e){}
        if(this.currentReader===reader)this.currentReader=null;
        reject(err||this.makeAbortError('Import cancelled. Current file was not loaded.'));
      };
      reader.onload=()=>{
        if(done)return;
        done=true;
        if(this.currentReader===reader)this.currentReader=null;
        if(this.currentReject)this.currentReject=null;
        try{this.assertNotCancelled();}catch(e){reject(e);return;}
        resolve(String(reader.result||''));
      };
      reader.onerror=()=>{
        if(done)return;
        done=true;
        if(this.currentReader===reader)this.currentReader=null;
        if(this.currentReject)this.currentReject=null;
        reject(reader.error||new Error('File read failed'));
      };
      reader.onabort=()=>{
        if(done)return;
        done=true;
        if(this.currentReader===reader)this.currentReader=null;
        if(this.currentReject)this.currentReject=null;
        reject(this.makeAbortError('Import cancelled. Current file was not loaded.'));
      };
      try{reader.readAsText(file);}catch(err){
        if(this.currentReader===reader)this.currentReader=null;
        if(this.currentReject)this.currentReject=null;
        reject(err);
      }
    });
  },
  async parseFileToRecords(file,ext,fileIndex=0,totalFiles=1){
    const isBig=file.size>=this.largeFileThreshold;
    const likelyGeo=(ext==='geojson'||ext==='json')&&await this.isLikelyGeoJSONFile(file,ext);
    if(isBig&&likelyGeo&&file.stream){
      return this.parseLargeGeoJSONFileInWorker(file,fileIndex,totalFiles);
    }
    if(isBig&&likelyGeo&&!file.stream){
      throw new Error('This browser does not support streaming large map files. Split the file or use a newer browser.');
    }
    if(isBig&&!likelyGeo){
      UI.progress(true,'Large file warning',`${file.name} is ${this.formatBytes(file.size)}. Working — do not close.`,Math.max(3,Math.round((fileIndex/totalFiles)*82)));
      await this.idle();
    }
    this.assertNotCancelled();
    const text=await this.readFileTextCancellable(file);
    this.assertNotCancelled();
    if(ext==='csv'||ext==='txt'){const r=this.parseCSV(text,file.name); this.assertNotCancelled(); return r;}
    const r=this.parseJSONLike(text,file.name,ext);
    this.assertNotCancelled();
    return r;
  },
  async isLikelyGeoJSONFile(file,ext=''){
    if(ext==='geojson')return true;
    try{
      const head=await file.slice(0,Math.min(file.size,262144)).text();
      return /"type"\s*:\s*"FeatureCollection"/i.test(head)&&/"features"\s*:/i.test(head);
    }catch(e){return false;}
  },
  async parseLargeGeoJSONFileInWorker(file,fileIndex=0,totalFiles=1){
    const canWorker=typeof Worker!=='undefined'&&/^https?:|^file:|^app:|^capacitor:/i.test(location.protocol||'https:');
    if(!canWorker){
      UI.progress(true,'Large file import',`${file.name}: using fallback import path`,Math.max(4,Math.round((fileIndex/Math.max(totalFiles,1))*88)));
      await this.paint();
      return this.parseLargeGeoJSONFile(file,fileIndex,totalFiles);
    }
    return new Promise((resolve,reject)=>{
      let worker;
      const out=[];
      let done=false;
      let lastStats={featuresRead:0,assetsIndexed:0,skipped:0,fileName:file.name,bytesRead:0,fileSize:file.size};
      const finish=(err)=>{
        if(done)return;
        done=true;
        try{worker&&worker.terminate();}catch(e){}
        if(this.currentWorker===worker){this.currentWorker=null;this.currentReject=null;}
        if(err)reject(err); else {
          try{this.assertNotCancelled();}catch(cancelErr){reject(cancelErr);return;}
          resolve(out);
        }
      };
      try{
        worker=new Worker(`workers/geojson-import-worker.js?v=${encodeURIComponent(App.version||Date.now())}`);
        this.currentWorker=worker;
        this.currentReject=(err)=>finish(err||this.makeAbortError('Import cancelled. Current file was not loaded.'));
      }catch(err){
        UI.progress(true,'Large file import',`${file.name}: large-file helper failed — using fallback`,Math.max(4,Math.round((fileIndex/Math.max(totalFiles,1))*88)));
        this.paint().then(()=>this.parseLargeGeoJSONFile(file,fileIndex,totalFiles)).then(resolve,reject);
        return;
      }
      const timeout=setTimeout(()=>{
        UI.progress(true,'Large file import',`${file.name}: starting… still loading`,Math.max(3,Math.round((fileIndex/Math.max(totalFiles,1))*88)));
      },700);
      worker.onmessage=(ev)=>{
        if(this.cancelRequested){finish(this.makeAbortError('Import cancelled. Current file was not loaded.'));return;}
        const msg=ev.data||{};
        if(msg.type==='batch'){
          if(Array.isArray(msg.assets)&&msg.assets.length){
            out.push(...msg.assets);
            if(msg.stats){
              lastStats={...lastStats,...msg.stats};
              this.lastParseStats=lastStats;
              const bytes=Number(lastStats.bytesRead||0), total=Number(lastStats.fileSize||file.size||1);
              const pct=Math.round(((fileIndex+(bytes/Math.max(total,1)))/Math.max(totalFiles,1))*88);
              const note=lastStats.note?` · ${lastStats.note}`:'';
              UI.progress(true,'Large file import',`${file.name}: ${this.formatBytes(bytes)} / ${this.formatBytes(total)} · ${Number(lastStats.featuresRead||0).toLocaleString()} features found · ${Number(lastStats.assetsIndexed||out.length||0).toLocaleString()} assets indexed · working${note}`,Math.max(4,pct));
            }
          }
          return;
        }
        if(msg.type==='progress'){
          lastStats={...lastStats,...(msg.stats||{})};
          this.lastParseStats=lastStats;
          const bytes=Number(lastStats.bytesRead||0), total=Number(lastStats.fileSize||file.size||1);
          const pct=Math.round(((fileIndex+(bytes/Math.max(total,1)))/Math.max(totalFiles,1))*88);
          const f=Number(lastStats.featuresRead||0).toLocaleString();
          const a=Number(lastStats.assetsIndexed||out.length||0).toLocaleString();
          const sk=Number(lastStats.skipped||0);
          const note=lastStats.note?` · ${lastStats.note}`:'';
          UI.progress(true,'Large file import',`${file.name}: ${this.formatBytes(bytes)} / ${this.formatBytes(total)} · ${f} features found · ${a} assets indexed${sk?` · ${sk.toLocaleString()} skipped`:''} · working${note}`,Math.max(4,pct));
          return;
        }
        if(msg.type==='done'){
          clearTimeout(timeout);
          lastStats={...lastStats,...(msg.stats||{})};
          this.lastParseStats=lastStats;
          const f=Number(lastStats.featuresRead||0).toLocaleString();
          const a=Number(lastStats.assetsIndexed||out.length||0).toLocaleString();
          const sk=Number(lastStats.skipped||0);
          UI.progress(true,'Large file import',`${file.name}: ${f} features found · ${a} assets indexed${sk?` · ${sk.toLocaleString()} skipped`:''} · finalising`,Math.round(((fileIndex+0.75)/Math.max(totalFiles,1))*88));
          finish();
          return;
        }
        if(msg.type==='error'){
          clearTimeout(timeout);
          finish(new Error(msg.message||'Large file import failed'));
        }
      };
      worker.onerror=(err)=>{
        clearTimeout(timeout);
        finish(new Error(err.message||'Large file import error'));
      };
      this.assertNotCancelled();
      UI.progress(true,'Large file import',`${file.name}: started · app should stay responsive`,Math.max(3,Math.round((fileIndex/Math.max(totalFiles,1))*88)));
      worker.postMessage({type:'start',file,fileName:file.name,fileIndex,totalFiles});
    });
  },

  isLikelyDxPoleSourceFile(fileName=''){
    const f=String(fileName||'').toUpperCase();
    if(/TRANSMISSION|TRMSN|TOWER|SUBSTATION|TRANSFORMER|STREETLIGHT|STREET[_\s-]*LIGHT|PILLAR|UNDERGROUND|CABLE|WATER|SEWER|GAS|RAIL|ESA|ENVIRONMENT/.test(f)){
      return /DISTRIBUTION[_\s.-]*POLES?|DX[_\s.-]*POLES?|DIST[_\s.-]*POLES?|ELECTRICAL[_\s.-]*POLES?/.test(f)&&!/TRANSMISSION|TRMSN|TOWER|TRANSFORMER/.test(f);
    }
    return /DISTRIBUTION[_\s.-]*POLES?|DX[_\s.-]*POLES?|DIST[_\s.-]*POLES?|ELECTRICAL[_\s.-]*POLES?|POLE[_\s.-]*WP[_\s.-]*(04|05|06|07|08|09)/.test(f);
  },
  shouldDirectDxPoleStore(file,ext=''){
    if(!(ext==='geojson'||ext==='json'))return false;
    if(!file||!file.stream)return false;
    if(!this.isLikelyDxPoleSourceFile(file.name))return false;
    return true;
  },
  ensureDxPoleRecordForFile(record,fileName=''){
    if(!record||typeof record!=='object')return null;
    if(UtilitiesEngine?.isUtility?.(record))return null;
    const text=[fileName,record.kind,record.category,record.label,record.searchText,Object.values(record.raw||{}).join(' ')].join(' ').toUpperCase();
    if(!this.isLikelyDxPoleSourceFile(fileName)&&!/DX[_\s-]*POLE|DISTRIBUTION[_\s-]*POLE|DIST\s+POLE|ELECTRICAL\s+POLE/.test(text))return null;
    if(/TRANSFORMER|STREET\s*LIGHT|STREETLIGHT|SUBSTATION|TRANSMISSION|TRMSN|TOWER/.test(text)&&!/DISTRIBUTION[_\s-]*POLE|DX[_\s-]*POLE|DIST\s+POLE|ELECTRICAL\s+POLE/.test(text))return null;
    record.kind='dx-pole';
    record.category=record.category||'Distribution Pole';
    record.label=record.label||record.structure||record.equip||record.poleNumber||'Distribution pole';
    return record;
  },
  async importLargeDxPoleStoreOnly(file,ext,fileIndex=0,totalFiles=1){
    const meta={
      name:file.name,size:file.size,type:ext||file.type,count:0,dxPoleCount:0,featuresRead:0,assetsIndexed:0,skipped:0,importedAt:new Date().toISOString(),mode:'dx-pole-direct-store',parserVersion:this.parserVersion,schema:App.schema||{},indexStatus:'dx-pole-indexed',storageMode:'dx-pole-chunks',storageKey:'',dxPoleStorageKey:this.makeFileStorageKey(file.name+'|dx-pole-direct'),dxPoleChunkCount:0,dxPoleAssetChunkSize:0
    };
    let dxCount=0;
    let lastStats={featuresRead:0,assetsIndexed:0,skipped:0,fileName:file.name,bytesRead:0,fileSize:file.size};
    UI.progress(true,`Distribution pole ${fileIndex+1}/${totalFiles}`,`${file.name}: saving distribution poles in local chunks`,Math.max(3,Math.round((fileIndex/Math.max(totalFiles,1))*88)));
    await StorageEngine.beginDxPoleFileAssets(meta);
    const canWorker=typeof Worker!=='undefined'&&/^https?:|^file:|^app:|^capacitor:/i.test(location.protocol||'https:');
    if(!canWorker){
      const parsed=await this.parseLargeGeoJSONFile(file,fileIndex,totalFiles);
      const dx=[];
      for(const r of parsed){const d=this.ensureDxPoleRecordForFile(r,file.name); if(d)dx.push(d);}
      await StorageEngine.appendDxPoleFileAssets(meta,dx);
      await StorageEngine.finishDxPoleFileAssets(meta);
      dxCount=Number(meta.dxPoleStored||dx.length||0); dx.length=0; parsed.length=0;
      meta.dxPoleCount=dxCount; meta.dxPoleDuplicateSkipped=Number(meta.dxPoleDuplicateSkipped||0); meta.featuresRead=this.lastParseStats?.featuresRead||dxCount; meta.skipped=this.lastParseStats?.skipped||0; meta.dxPoleAssetChunkSize=StorageEngine.dxPoleAssetChunkSize||600;
      return meta;
    }
    await new Promise((resolve,reject)=>{
      let worker,done=false;
      let writeChain=Promise.resolve();
      const finish=(err)=>{
        if(done)return;
        done=true;
        try{worker&&worker.terminate();}catch(e){}
        if(this.currentWorker===worker){this.currentWorker=null;this.currentReject=null;}
        if(err){reject(err);return;}
        writeChain.then(async()=>{await StorageEngine.finishDxPoleFileAssets(meta); resolve();}).catch(reject);
      };
      try{
        worker=new Worker(`workers/geojson-import-worker.js?v=${encodeURIComponent(App.version||Date.now())}`);
        this.currentWorker=worker;
        this.currentReject=(err)=>finish(err||this.makeAbortError('Import cancelled. Current distribution pole file was not loaded.'));
      }catch(err){reject(err);return;}
      worker.onmessage=(ev)=>{
        if(this.cancelRequested){finish(this.makeAbortError('Import cancelled. Current distribution pole file was not loaded.'));return;}
        const msg=ev.data||{};
        if(msg.type==='batch'){
          const batch=Array.isArray(msg.assets)?msg.assets:[];
          lastStats={...lastStats,...(msg.stats||{})};
          this.lastParseStats=lastStats;
          writeChain=writeChain.then(async()=>{
            this.assertNotCancelled();
            const dx=[];
            for(const rec of batch){const d=this.ensureDxPoleRecordForFile(rec,file.name); if(d)dx.push(d);}
            if(dx.length){await StorageEngine.appendDxPoleFileAssets(meta,dx); dxCount+=dx.length;}
            this.assertNotCancelled();
            const bytes=Number(lastStats.bytesRead||0), total=Number(lastStats.fileSize||file.size||1);
            const pct=Math.round(((fileIndex+(bytes/Math.max(total,1)))/Math.max(totalFiles,1))*88);
            UI.progress(true,'Distribution pole import',`${file.name}: ${this.formatBytes(bytes)} / ${this.formatBytes(total)} · ${Number(lastStats.featuresRead||0).toLocaleString()} features read · ${dxCount.toLocaleString()} distribution poles saved · ${Number(meta.dxPoleChunkCount||0).toLocaleString()} chunks`,Math.max(4,pct));
          }).catch(finish);
          return;
        }
        if(msg.type==='progress'){
          lastStats={...lastStats,...(msg.stats||{})};
          this.lastParseStats=lastStats;
          const bytes=Number(lastStats.bytesRead||0), total=Number(lastStats.fileSize||file.size||1);
          const pct=Math.round(((fileIndex+(bytes/Math.max(total,1)))/Math.max(totalFiles,1))*88);
          UI.progress(true,'Distribution pole import',`${file.name}: ${this.formatBytes(bytes)} / ${this.formatBytes(total)} · ${Number(lastStats.featuresRead||0).toLocaleString()} features scanned · ${dxCount.toLocaleString()} distribution pole records saved`,Math.max(4,pct));
          return;
        }
        if(msg.type==='done'){
          lastStats={...lastStats,...(msg.stats||{})};
          this.lastParseStats=lastStats;
          finish();
          return;
        }
        if(msg.type==='error')finish(new Error(msg.message||'Distribution pole import failed'));
      };
      worker.onerror=(err)=>finish(new Error(err.message||'Distribution pole import error'));
      this.assertNotCancelled();
      worker.postMessage({type:'start',file,fileName:file.name,fileIndex,totalFiles});
    });
    dxCount=Number(meta.dxPoleStored||dxCount||0);
    meta.dxPoleCount=dxCount;
    meta.dxPoleDuplicateSkipped=Number(meta.dxPoleDuplicateSkipped||0);
    meta.featuresRead=Number(lastStats.featuresRead||0);
    meta.assetsIndexed=0;
    meta.skipped=Number(lastStats.skipped||0);
    if(!dxCount)throw new Error(`${file.name}: distribution pole import read ${Number(meta.featuresRead||0).toLocaleString()} features but stored 0 distribution pole records. Send a 1-2 feature sample if this repeats.`);
    meta.dxPoleAssetChunkSize=StorageEngine.dxPoleAssetChunkSize||600;
    meta.indexResult={indexed:0,dxPoleStored:dxCount,mode:'direct-store'};
    meta.indexStatus='dx-pole-indexed';
    meta.storageMode='dx-pole-chunks';
    UI.progress(true,'Distribution pole import complete',`${file.name}: ${dxCount.toLocaleString()} unique distribution poles saved · ${Number(meta.dxPoleDuplicateSkipped||0).toLocaleString()} duplicate rows skipped · ${Number(meta.dxPoleChunkCount||0).toLocaleString()} chunks`,Math.round(((fileIndex+0.95)/Math.max(totalFiles,1))*96));
    return meta;
  },

  isLikelyUtilitySourceFile(fileName=''){
    if(this.isAssetOnlyFile?.(fileName))return false;
    const f=String(fileName||'').toUpperCase();
    return /WATER[_\s.-]*PIPE|WCORP[_\s.-]*(002|069|WATER)|\bWATER\b|SEWER|PRESSURE[_\s-]*MAIN|PETROLEUM|PIPELINE|DMIRS|\bGAS\b|RAIL|PTA|HIGH[_\s-]*VOLTAGE[_\s-]*DISTRIBUTION|WP[_\s-]*052|DISTRIBUTION[_\s.-]*UNDERGROUND[_\s.-]*CABLE|UNDERGROUND[_\s.-]*CABLE|\bCABLE\b|WP[_\s-]*034|ELECTRICAL[_\s-]*PILLAR|PILLARS?|WP[_\s-]*041|ELECTRICAL[_\s-]*ENCLOSURES?|ENCLOSURES?|WP[_\s-]*040|ENVIRONMENTALLY[_\s-]*SENSITIVE|CLEARING[_\s-]*REGULATIONS|DWER|ESA|WP[_\s-]*046/.test(f);
  },
  shouldDirectUtilityStore(){return false;},
  ensureUtilityRecordForFile(){return null;},
  async importLargeUtilityStoreOnly(){throw new Error('Optional background/proximity imports are disabled in the core-only build.');},
  makeFileStorageKey(fileName='file'){
    const stamp=Date.now().toString(36);
    const rand=Math.random().toString(36).slice(2,7);
    return 'f_'+this.hash(String(fileName||'file')+'|'+stamp+'|'+rand).replace(/^a/,'')+'_'+stamp;
  },
  sourceFileMatches(asset,fileName){
    const name=String(fileName||'');
    if(!asset||!name)return false;
    if(String(asset.sourceFile||'')===name)return true;
    if(Array.isArray(asset.sourceFiles)&&asset.sourceFiles.some(f=>String(f||'')===name))return true;
    const raw=asset.raw||{};
    if(String(raw.sourceFile||raw.SOURCE_FILE||'')===name)return true;
    return false;
  },
  shouldAppendOnlyImport(baseRecords=[],incomingRecords=[],file={}){
    const baseCount=Array.isArray(baseRecords)?baseRecords.length:0;
    const incCount=Array.isArray(incomingRecords)?incomingRecords.length:0;
    const size=Number(file?.size||0);
    return size>=this.largeFileThreshold || incCount>8000 || baseCount>35000;
  },
  async appendRecordsSafely(baseRecords=[],incomingRecords=[],fileName='',fileIndex=0,totalFiles=1){
    const out=Array.isArray(baseRecords)?baseRecords:[];
    const incoming=Array.isArray(incomingRecords)?incomingRecords:[];
    const seen=new Set();
    let added=0;
    UI.progress(true,'Appending large import…',`${fileName}: safe append path`,Math.round(((fileIndex+0.88)/Math.max(totalFiles,1))*92));
    for(let i=0;i<incoming.length;i++){
      const r=incoming[i];
      if(!r)continue;
      const key=r?.id||`${r?.sourceFile||fileName}|${r?.sourcePath||i}|${r?.lat||''}|${r?.lon||''}`;
      if(seen.has(key))continue;
      seen.add(key);
      out.push(r);
      added++;
      if(i%2000===0){
        UI.progress(true,'Appending large import…',`${fileName}: added ${added.toLocaleString()} / ${incoming.length.toLocaleString()} records`,Math.round(((fileIndex+0.9)/Math.max(totalFiles,1))*92));
        await this.idle();
      }
    }
    return out;
  },
  async deleteImportedFile(fileName='',opts={}){
    const name=String(fileName||'').trim();
    if(!name)return {deleted:false,removedAssets:0};
    if(this.importRunning&&!opts.skipRunningCheck)throw new Error('Cannot delete an import while another import is running. Cancel or wait for import to finish.');
    const files=Array.isArray(App.files)?App.files:[];
    const matched=files.filter(f=>String(f?.name||'')===name);
    if(!matched.length&&!opts.force){
      if(!opts.silent)UI.toast?.('Import not found.');
      return {deleted:false,removedAssets:0};
    }
    const before=(App.assets||[]).length;
    UI.progress?.(true,'Deleting import…',`${name}: removing matching core assets`,12);
    App.assets=(App.assets||[]).filter(a=>!this.sourceFileMatches(a,name));
    const removedAssets=before-App.assets.length;
    const beforeUtilities=(App.utilityAssets||[]).length;
    App.utilityAssets=(App.utilityAssets||[]).filter(a=>!this.sourceFileMatches(a,name));
    App.utilityLoaded=false;
    App.utilityLoadKey='';
    const removedUtilities=beforeUtilities-(App.utilityAssets||[]).length;
    App.files=files.filter(f=>String(f?.name||'')!==name);
    App.indexHealth=App.indexHealth||{mode:'file-level',queue:[],files:[]};
    App.indexHealth.files=(App.indexHealth.files||[]).filter(f=>String(f?.name||'')!==name);
    App.indexHealth.queue=(App.indexHealth.queue||[]).filter(f=>String(f?.name||'')!==name);
    for(const f of matched){await StorageEngine?.deleteFileAssets?.(f).catch(()=>{});}
    await HVCrossingsLayer?.deleteBySourceFile?.(name,{silent:true}).catch(()=>{});
    UtilitiesEngine?.invalidateGrid?.();
    HVCrossingsLayer?.clearActive?.({silent:true});
    MapEngine?.clearDisplay?.(false);
    if(!opts.skipRebuild){
      UI.progress?.(true,'Rebuilding after delete…',`${name}: rebuilding search for remaining assets`,55);
      if(SearchEngine.rebuildAsync)await SearchEngine.rebuildAsync('Rebuild after deleting import'); else SearchEngine.rebuild();
    }
    if(!opts.skipSave){
      UI.progress?.(true,'Saving delete…',`${name}: updating local database`,90);
      const needsFullLegacySave=matched.some(f=>!f.storageKey);
      if(needsFullLegacySave&&StorageEngine?.saveAll)await StorageEngine.saveAll();
      else if(StorageEngine?.saveManifestOnly)await StorageEngine.saveManifestOnly();
      else if(StorageEngine?.saveAll)await StorageEngine.saveAll();
    }
    if(!opts.skipUi){
      UI.progress?.(false);
      UI.refreshAll?.();
      Settings?.show?.('import');
      if(!opts.silent)UI.toast?.(`Deleted ${UI.safeFileName?.(name)||name}: ${removedAssets.toLocaleString()} assets + ${removedUtilities.toLocaleString()} background records removed.`);
    }
    return {deleted:true,removedAssets};
  },
  async mergeRecordsSafely(baseRecords,incomingRecords,fileName='',fileIndex=0,totalFiles=1){
    // SPCK/mobile memory hardening: mutate the existing database array instead of
    // baseRecords.slice(). The old slice duplicated the full saved asset database
    // right before the final save stage and could crash SPCK near 95-99%.
    const out=Array.isArray(baseRecords)?baseRecords:[];
    const incoming=Array.isArray(incomingRecords)?incomingRecords:[];
    const aliasToIndex=new Map();
    const addAliases=(asset,idx)=>{for(const k of SearchEngine.keyAliases(asset))aliasToIndex.set(k,idx);};
    UI.progress(true,'Preparing merge…',`${fileName}: checking existing data · ${out.length.toLocaleString()} existing assets`,Math.round(((fileIndex+0.82)/Math.max(totalFiles,1))*92));
    await this.paint();
    for(let i=0;i<out.length;i++){
      this.assertNotCancelled();
      const a=out[i];
      if(!a||typeof a!=='object')continue;
      // Do not clone every existing asset. Only fill missing arrays in place.
      if(!Array.isArray(a.sources))a.sources=SearchEngine.sourceList(a);
      if(!Array.isArray(a.sourceFiles))a.sourceFiles=SearchEngine.fileList(a);
      addAliases(a,i);
      if(i%1500===0){
        UI.progress(true,'Preparing merge…',`${fileName}: indexed ${i.toLocaleString()} / ${out.length.toLocaleString()} existing assets`,Math.round(((fileIndex+0.83)/Math.max(totalFiles,1))*92));
        await this.paint();
      }
    }
    const total=incoming.length||1;
    for(let i=0;i<incoming.length;i++){
      this.assertNotCancelled();
      const rec0=incoming[i];
      if(!rec0||typeof rec0!=='object')continue;
      // Use the incoming object directly. Cloning every imported feature here doubled
      // memory during large SPCK imports and caused end-of-load crashes.
      const rec=rec0;
      if(!Array.isArray(rec.sources))rec.sources=SearchEngine.sourceList(rec);
      if(!Array.isArray(rec.sourceFiles))rec.sourceFiles=SearchEngine.fileList(rec);
      const aliases=SearchEngine.keyAliases(rec);
      const hit=aliases.find(k=>aliasToIndex.has(k));
      if(hit===undefined){const idx=out.length; out.push(rec); addAliases(rec,idx);}
      else{
        const idx=aliasToIndex.get(hit);
        const merged=SearchEngine.mergePair(out[idx],rec);
        out[idx]=merged;
        addAliases(merged,idx);
        for(const k of aliases)aliasToIndex.set(k,idx);
      }
      if(i%600===0){
        const pct=Math.round(((fileIndex+0.84+0.08*(i/total))/Math.max(totalFiles,1))*92);
        UI.progress(true,'Merging assets…',`${fileName}: merged ${i.toLocaleString()} / ${incoming.length.toLocaleString()} records · total ${out.length.toLocaleString()}`,Math.max(4,pct));
        await this.paint();
      }
    }
    UI.progress(true,'Merging assets…',`${fileName}: merge complete · ${out.length.toLocaleString()} stored assets`,Math.round(((fileIndex+0.92)/Math.max(totalFiles,1))*92));
    await this.paint();
    return out;
  },


  compactImportRecords(records=[],mode='normal'){
    const list=Array.isArray(records)?records:[];
    const out=[];
    let rawFieldsBefore=0,rawFieldsAfter=0,compacted=0;
    for(const r of list){
      if(!r||typeof r!=='object')continue;
      rawFieldsBefore+=r.raw&&typeof r.raw==='object'?Object.keys(r.raw).length:0;
      const c=mode==='utility'?(StorageEngine?.compactUtilityRecord?StorageEngine.compactUtilityRecord(r):r):(StorageEngine?.compactAssetRecord?StorageEngine.compactAssetRecord(r):r);
      if(!c)continue;
      rawFieldsAfter+=c.raw&&typeof c.raw==='object'?Object.keys(c.raw).length:0;
      if(c!==r)compacted++;
      out.push(c);
    }
    return {records:out,rawFieldsBefore,rawFieldsAfter,rawFieldsDropped:Math.max(0,rawFieldsBefore-rawFieldsAfter),compacted};
  },
  buildImportHealth(meta=[],assets=[],extra={}){
    const files=Array.isArray(meta)?meta:[];
    const list=Array.isArray(assets)?assets:[];
    const kinds={};
    for(const a of list){const k=String(a?.kind||'unknown'); kinds[k]=(kinds[k]||0)+1;}
    const totals={
      files:files.length,
      normalAssets:files.reduce((n,f)=>n+Number(f.count||f.assetsIndexed||0),0),
            dxPoles:files.reduce((n,f)=>n+Number(f.dxPoleCount||0),0),
      rawFieldsDropped:files.reduce((n,f)=>n+Number(f.rawFieldsDropped||0),0),
      compactedRecords:files.reduce((n,f)=>n+Number(f.compactedRecords||0),0),
      conductorSpans:Number(extra.conductorSpanCount||0),
      mergedAssets:list.length
    };
    return {createdAt:new Date().toISOString(),totals,kinds,files:files.map(f=>({name:f.name,count:f.count||0,dxPoleCount:f.dxPoleCount||0,storageMode:f.storageMode||'',rawFieldsDropped:f.rawFieldsDropped||0,compactedRecords:f.compactedRecords||0,indexStatus:f.indexStatus||f.status||''}))};
  },

  setIndexHealthFile(name,patch={}){
    App.indexHealth=App.indexHealth||{mode:'file-level',queue:[],files:[]};
    const clean=String(name||'unknown');
    let row=(App.indexHealth.files||[]).find(f=>f.name===clean);
    if(!row){row={name:clean,status:'queued'}; App.indexHealth.files=[...(App.indexHealth.files||[]),row];}
    Object.assign(row,patch,{updatedAt:new Date().toISOString()});
    const q=(App.indexHealth.queue||[]).find(f=>f.name===clean);
    if(q)Object.assign(q,patch,{updatedAt:new Date().toISOString()});
    App.indexHealth.current=row.status==='indexing'||row.status==='importing'?row:App.indexHealth.current;
    return row;
  },
  indexHealthSummary(){
    const files=(App.indexHealth?.files&&App.indexHealth.files.length?App.indexHealth.files:(App.files||[]));
    const counts={active:0,queued:0,indexing:0,failed:0,skipped:0,cancelled:0,outdated:0};
    for(const f of files){const st=f.status||'queued'; counts[st]=(counts[st]||0)+1; if(f.parserVersion&&f.parserVersion!==this.parserVersion)counts.outdated++;}
    return {counts,files,mode:'file-level indexing + background queue + manual full rebuild'};
  },

  paint(){
    return new Promise(resolve=>{
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>setTimeout(resolve,0));
      else setTimeout(resolve,16);
    });
  },
  async parseLargeGeoJSONFile(file,fileIndex=0,totalFiles=1){
    this.assertNotCancelled();
    const reader=file.stream().getReader();
    this.currentStreamReader=reader;
    const decoder=new TextDecoder('utf-8');
    let buffer='';
    let bytesRead=0;
    let foundFeatures=false;
    let featureStart=-1, depth=0, inString=false, escape=false;
    let featureIndex=0;
    let skipped=0;
    const out=[];
    const scanBuffer=async(final=false)=>{
      let i=0;
      while(i<buffer.length){
        this.assertNotCancelled();
        if(!foundFeatures){
          const idx=buffer.search(/"features"\s*:/i);
          if(idx<0){
            if(buffer.length>2048)buffer=buffer.slice(-2048);
            return;
          }
          const arr=buffer.indexOf('[',idx);
          if(arr<0){
            buffer=buffer.slice(idx);
            return;
          }
          buffer=buffer.slice(arr+1);
          foundFeatures=true;
          i=0;
          continue;
        }
        const ch=buffer[i];
        if(inString){
          if(escape){escape=false; i++; continue;}
          if(ch==='\\'){escape=true; i++; continue;}
          if(ch==='"')inString=false;
          i++;
          continue;
        }
        if(ch==='"'){inString=true; i++; continue;}
        if(featureStart<0){
          if(ch==='{'){featureStart=i; depth=1;}
          else if(ch===']'){buffer=''; return;}
          i++;
          continue;
        }
        if(ch==='{')depth++;
        else if(ch==='}'){
          depth--;
          if(depth===0){
            const featureText=buffer.slice(featureStart,i+1);
            try{
              const feature=JSON.parse(featureText);
              const assets=this.featureToAssets(feature,file.name,featureIndex,{largeMode:true});
              for(const a of assets){
                const safe=this.compactLargeAsset(a);
                if(safe)out.push(safe);
              }
            }catch(err){
              skipped++;
              Diagnostics.log('Skipped bad map feature',`${file.name} feature ${featureIndex}: ${err.message||err}`);
            }
            featureIndex++;
            if(featureIndex%50===0){
              const pct=Math.round(((fileIndex+(bytesRead/Math.max(file.size,1)))/Math.max(totalFiles,1))*88);
              this.lastParseStats={featuresRead:featureIndex,assetsIndexed:out.length,skipped,fileName:file.name,bytesRead,fileSize:file.size};
              UI.progress(true,'Large file import',`${file.name}: ${this.formatBytes(bytesRead)} of ${this.formatBytes(file.size)} read · ${featureIndex.toLocaleString()} features read · ${out.length.toLocaleString()} assets indexed${skipped?` · ${skipped.toLocaleString()} skipped`:''} · still loading`,Math.max(4,pct));
              await this.idle();
            }
            buffer=buffer.slice(i+1);
            i=0; featureStart=-1; depth=0; inString=false; escape=false;
            continue;
          }
        }
        i++;
      }
      if(final&&featureStart>=0){
        Diagnostics.log('Incomplete map feature ignored',file.name);
      }
      if(buffer.length>4*1024*1024&&featureStart<0)buffer=buffer.slice(-2048);
    };
    UI.progress(true,'Large file import',`${file.name}: ${this.formatBytes(file.size)} · reading features safely · still loading`,Math.max(3,Math.round((fileIndex/Math.max(totalFiles,1))*88)));
    while(true){
      this.assertNotCancelled();
      const {value,done}=await reader.read();
      if(done)break;
      bytesRead+=value.byteLength;
      const readPct=Math.round(((fileIndex+(bytesRead/Math.max(file.size,1)))/Math.max(totalFiles,1))*88);
      UI.progress(true,'Large file import',`${file.name}: ${this.formatBytes(bytesRead)} of ${this.formatBytes(file.size)} read · ${featureIndex.toLocaleString()} features read · ${out.length.toLocaleString()} assets indexed${skipped?` · ${skipped.toLocaleString()} skipped`:''} · still loading`,Math.max(4,readPct));
      buffer+=decoder.decode(value,{stream:true});
      await scanBuffer(false);
    }
    buffer+=decoder.decode();
    await scanBuffer(true);
    if(!foundFeatures)throw new Error('Map feature array was not found.');
    this.lastParseStats={featuresRead:featureIndex,assetsIndexed:out.length,skipped,fileName:file.name,bytesRead:file.size,fileSize:file.size};
    UI.progress(true,'Large file import',`${file.name}: ${featureIndex.toLocaleString()} features read · ${out.length.toLocaleString()} assets indexed${skipped?` · ${skipped.toLocaleString()} skipped`:''} · finalising`,Math.round(((fileIndex+0.75)/Math.max(totalFiles,1))*88));
    await this.idle();
    if(this.currentStreamReader===reader)this.currentStreamReader=null;
    return out.filter(Boolean);
  },
  parseJSONLike(text,fileName,ext){
    const clean=text.replace(/^\uFEFF/,'').trim();
    let parsed;
    try{parsed=JSON.parse(clean);}catch(e){
      const lines=clean.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      parsed=lines.map(l=>JSON.parse(l));
    }
    const bundle=this.unwrapBundlePayload(parsed,fileName);
    const payload=bundle.payload;
    const sourceType=(ext==='geojson'||this.isGeoJson(payload))?'geojson':'json';
    if(this.isGeoJson(payload)){
      const features=payload.type==='Feature'?[payload]:(Array.isArray(payload.features)?payload.features:[]);
      const out=[];
      let skipped=0;
      for(let i=0;i<features.length;i++){
        try{out.push(...this.featureToAssets(features[i],fileName,i));}
        catch(err){skipped++; Diagnostics.log('Skipped bad map feature',`${fileName} feature ${i}: ${err.message||err}`);}
      }
      this.lastParseStats={featuresRead:features.length,assetsIndexed:out.filter(Boolean).length,skipped,fileName,bundleMode:bundle.mode||''};
      return out.filter(Boolean);
    }
    if(this.isArcGisJson(payload))return this.parseArcGisJson(payload,fileName,sourceType);
    if(Array.isArray(payload)&&this.isLineDumpRows(payload)){
      const rows=this.reconstructLineDumpRecords(payload,fileName);
      const out=rows.map((r,i)=>this.normaliseRecord(r,fileName,sourceType,`line-dump.${i}`)).filter(Boolean);
      this.lastParseStats={featuresRead:rows.length,assetsIndexed:out.length,skipped:rows.length-out.length,fileName,bundleMode:bundle.mode||'line-dump'};
      return out;
    }
    if(Array.isArray(payload)&&this.isConverterKeyValueRows(payload)){
      const out=this.parseConverterKeyValueRows(payload,fileName,sourceType);
      this.lastParseStats={featuresRead:payload.length,assetsIndexed:out.length,skipped:payload.length-out.length,fileName,bundleMode:bundle.mode||'keyvalue-bundle'};
      return out;
    }
    if(Array.isArray(payload)){
      const usable=payload.map((r,i)=>({value:this.normaliseRawRow(r),path:`row.${i}`})).filter(r=>this.isUsableRawRow(r.value,fileName));
      if(usable.some(r=>this.isPreIndexed(r.value))){
        const out=usable.map((r,i)=>this.normalisePreIndexedRecord(r.value,fileName,sourceType,r.path)).filter(Boolean);
        this.lastParseStats={featuresRead:usable.length,assetsIndexed:out.length,skipped:usable.length-out.length,fileName,bundleMode:bundle.mode||'array'};
        return out;
      }
      const out=usable.map(r=>this.normaliseRecord(r.value,fileName,sourceType,r.path)).filter(Boolean);
      this.lastParseStats={featuresRead:usable.length,assetsIndexed:out.length,skipped:usable.length-out.length,fileName,bundleMode:bundle.mode||'array'};
      return out;
    }
    const rows=[];
    this.deepScan(payload,rows,'root');
    const usable=rows.map(r=>({value:this.normaliseRawRow(r.value),path:r.path})).filter(r=>this.isUsableRawRow(r.value,fileName));
    const out=usable.map(r=>this.normaliseRecord(r.value,fileName,sourceType,r.path)).filter(Boolean);
    this.lastParseStats={featuresRead:usable.length,assetsIndexed:out.length,skipped:usable.length-out.length,fileName,bundleMode:bundle.mode||'deep-scan'};
    return out;
  },
  unwrapBundlePayload(parsed,fileName=''){
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
      const full=parsed.full&&typeof parsed.full==='object'?parsed.full:null;
      const sample=parsed.sample&&typeof parsed.sample==='object'?parsed.sample:null;
      const chosen=full||sample;
      if(chosen&&chosen.data!==undefined)return {payload:chosen.data,mode:full?'bundle-full':'bundle-sample'};

      // TXT/JSON Converter outputs wrap the real payload under top-level `data`.
      // v18 only unwrapped `data` when a schema.record_path existed, so these files
      // were deep-scanned as the wrapper object and produced 0 indexed assets:
      //   - SUBS_FIELD_MAP_READY_FULL_JSON...
      //   - DEPOTS_FIELD_MAP_READY_FULL_JSON...
      //   - CONDUCTOR_FIELD_MAP_READY_FULL_JSON...
      if(parsed.data!==undefined){
        const isConverter=/TXT_JSON_CONVERTER_OUTPUT/i.test(String(parsed.tool||''));
        const data=parsed.data;
        const dataLooksArcGis=data&&typeof data==='object'&&!Array.isArray(data)&&Array.isArray(data.features)&&((data.displayFieldName!==undefined)||data.fieldAliases||data.fields||data.geometryType);
        const dataLooksRows=Array.isArray(data);
        if(isConverter||parsed.parser_mode||parsed.record_count!==undefined||dataLooksArcGis||dataLooksRows){
          return {payload:data,mode:isConverter?`converter-${parsed.parser_mode||'data'}`:'bundle-data'};
        }
        if(parsed.schema&&parsed.schema.record_path)return {payload:data,mode:'bundle-data'};
      }
    }
    return {payload:parsed,mode:''};
  },
  isGeoJson(obj){return obj&&typeof obj==='object'&&(obj.type==='FeatureCollection'||obj.type==='Feature'||obj.type==='Point'||obj.type==='LineString'||obj.type==='MultiPoint'||obj.type==='MultiLineString'||obj.type==='Polygon'||obj.type==='MultiPolygon');},
  isArcGisJson(obj){return obj&&typeof obj==='object'&&Array.isArray(obj.features)&&(obj.geometryType||obj.displayFieldName||obj.fieldAliases||obj.fields);},
  parseArcGisJson(obj,fileName,sourceType='json'){
    const features=Array.isArray(obj.features)?obj.features:[];
    const out=[]; let skipped=0;
    for(let i=0;i<features.length;i++){
      try{
        const f=features[i]||{};
        const attrs=this.normaliseRawRow(f.attributes||f.properties||f);
        const geom=f.geometry||{};
        if(geom.x!==undefined&&geom.y!==undefined){attrs.LONGITUDE=attrs.LONGITUDE||geom.x; attrs.LATITUDE=attrs.LATITUDE||geom.y; attrs['geometry.x']=geom.x; attrs['geometry.y']=geom.y;}
        const rec=this.normaliseRecord(attrs,fileName,sourceType,`arcgis.feature.${i}`);
        if(rec)out.push(rec); else skipped++;
      }catch(err){skipped++; Diagnostics?.log?.('Skipped bad ArcGIS feature',`${fileName} feature ${i}: ${err.message||err}`);}
    }
    this.lastParseStats={featuresRead:features.length,assetsIndexed:out.length,skipped,fileName,bundleMode:'arcgis'};
    return out;
  },
  isConverterKeyValueRows(rows){
    if(!Array.isArray(rows)||!rows.length)return false;
    const sample=rows.slice(0,300);
    const rawText=sample.filter(r=>r&&typeof r==='object'&&r.__raw_text!==undefined).length;
    const attrRows=sample.filter(r=>r&&typeof r==='object'&&(r.ATTRIBUTES!==undefined||r.attributes!==undefined)).length;
    const structRows=sample.filter(r=>r&&typeof r==='object'&&(r.STRUCTURE_LABEL!==undefined||r.LINE_NAME_1!==undefined||r.NAMEPLATE_ID_1!==undefined)).length;
    return !!(rawText>=3&&(attrRows>=1||structRows>=3));
  },
  parseConverterKeyValueRows(rows,fileName='',sourceType='json'){
    const out=[]; let skipped=0;
    const drop=/^(LINE_\d+|FIELDS?|FIELDALIASES|SPATIALREFERENCE|DISPLAYFIELDNAME|GEOMETRYTYPE|ATTRIBUTES|GEOMETRY|__RAW_TEXT|__SOURCE_LINE_START|__DETECTED_ASSET_TYPE)$/i;
    for(let i=0;i<(rows||[]).length;i++){
      const row=rows[i]||{};
      if(!row||typeof row!=='object'){skipped++;continue;}
      const hasAssetCue=row.ATTRIBUTES!==undefined||row.STRUCTURE_LABEL!==undefined||row.LINE_NAME_1!==undefined||row.NAMEPLATE_ID_1!==undefined||row.SUBSTATION!==undefined||row.DEPOT_NAME!==undefined;
      if(!hasAssetCue){skipped++;continue;}
      const raw={};
      for(const [k,v] of Object.entries(row)){
        if(v===undefined||v===null)continue;
        const key=String(k||'').trim();
        if(!key||drop.test(key))continue;
        if(/^NAME$|^TYPE$|^ALIAS$|^LENGTH$|^WKID$|^LATESTWKID$/i.test(key))continue;
        raw[key.toUpperCase()]=this.clean(v);
      }
      // Converter rows keep ArcGIS geometry as X/Y fields. Mirror them to the normal GPS keys.
      if(raw.X&&!raw.LONGITUDE)raw.LONGITUDE=raw.X;
      if(raw.Y&&!raw.LATITUDE)raw.LATITUDE=raw.Y;
      if(!raw.STRUCTURE_LABEL&&raw.CIRCUIT_STRUCTURE_LABEL)raw.STRUCTURE_LABEL=raw.CIRCUIT_STRUCTURE_LABEL;
      if(!this.isUsableRawRow(raw,fileName)){skipped++;continue;}
      const rec=this.normaliseRecord(raw,fileName,sourceType,`keyvalue.${i}`);
      if(rec)out.push(rec); else skipped++;
    }
    return out;
  },
  isLineDumpRows(rows){
    if(!Array.isArray(rows)||!rows.length)return false;
    const first=rows.slice(0,80);
    const fieldLines=first.filter(r=>r&&typeof r==='object'&&r.field_1!==undefined).length;
    const keyed=first.filter(r=>r&&typeof r==='object'&&(r.OBJECTID!==undefined||r.ATTRIBUTES!==undefined||r.LATITUDE!==undefined||r.LINE_NAME_1!==undefined)).length;
    return fieldLines>=Math.max(5,Math.floor(first.length*0.6))&&keyed===0;
  },
  reconstructLineDumpRecords(rows,fileName=''){
    const out=[]; let current=null; let inFeatures=false;
    const finish=()=>{if(current&&Object.keys(current).length>1)out.push(current); current=null;};
    for(const row of rows||[]){
      const line=String(row?.field_1??'').trim();
      if(!line)continue;
      if(/^features\s*:/i.test(line)){inFeatures=true; continue;}
      if(!inFeatures)continue;
      const m=line.match(/^([A-Z0-9_.$ -]+?)\s*:\s*(.*)$/i);
      if(!m)continue;
      const key=String(m[1]||'').trim().replace(/[^A-Z0-9_.$-]+/gi,'_').toUpperCase();
      const value=this.clean(m[2]);
      if(!key||/^(ATTRIBUTES|GEOMETRY)$/.test(key))continue;
      if(key==='OBJECTID'){finish(); current={OBJECTID:value,__source_line:row.__source_line||''}; continue;}
      if(!current)continue;
      current[key]=value;
    }
    finish();
    if(this.isConductorFile(fileName))return out.filter(r=>this.isConductorSpanRecord(r,fileName));
    return out.filter(r=>this.isUsableRawRow(r,fileName));
  },
  normaliseRawRow(row){
    if(!row||typeof row!=='object')return row;
    const flat=this.flatten(row);
    const out={};
    for(const [k,v] of Object.entries(flat)){
      if(v===undefined)continue;
      out[k]=this.clean(v);
    }
    return out;
  },
  isUsableRawRow(raw={},fileName=''){
    if(!raw||typeof raw!=='object')return false;
    if(this.isConductorSpanRecord(raw,fileName))return true;
    const line=this.clean(raw.LINE_NAME_1||raw.LINE_NAME||raw.line_name||raw.CIRCUIT||raw.netwk_name);
    const lat=this.num(raw.LATITUDE||raw.latitude||raw['geometry.y']||raw.y);
    const lon=this.num(raw.LONGITUDE||raw.longitude||raw['geometry.x']||raw.x);
    const east=this.num(raw.EASTING||raw.EASTING_COORD||raw.MGA_EASTING);
    const north=this.num(raw.NORTHING||raw.NORTHING_COORD||raw.MGA_NORTHING);
    const objectId=this.clean(raw.OBJECTID||raw.objectid||raw.ID);
    const name=this.clean(raw.SUBSTATION||raw.DEPOT_NAME||raw.SEARCH_FIELD||raw.STRUCTURE_LABEL||raw.EQUIP_NAME||raw.equip_name);
    const hasRealLatLon=this.validLatLon(lat,lon);
    const hasProjected=Number.isFinite(east)&&Number.isFinite(north)&&east>10000&&north>10000;
    const hasRealLine=/\d/.test(String(line||''))&&!/^LINE\s*NAME/i.test(line);
    const hasRealObject=/^\d+$/.test(String(objectId).replace(/\D/g,''));
    if(hasRealLatLon||hasProjected)return !!(name||hasRealLine||objectId);
    if(hasRealLine&&hasRealObject)return true;
    if(name&&hasRealObject&&!/ALIAS|FIELD|TYPE|LENGTH|DISPLAYFIELDNAME/i.test(Object.keys(raw).join(' ')))return true;
    return false;
  },
  isPreIndexed(r){return r&&typeof r==='object'&&('asset_id' in r||'asset_type' in r||'line_name' in r||'source_coords' in r||'original' in r);},
  featureToAssets(feature,fileName,index=0,opts={}){
    const props={...(feature?.properties||{})};
    const geom=feature?.geometry||feature;
    const out=[];
    if(!geom||!geom.type)return [this.normaliseRecord(props,fileName,'geojson',`feature.${index}`)].filter(Boolean);
    const baseProps={...props,GEOMETRY_TYPE:geom.type};
    if(geom.type==='Point'){
      const [lon,lat]=geom.coordinates||[];
      out.push(this.normaliseRecord({...baseProps,LATITUDE:lat,LONGITUDE:lon},fileName,'geojson',`feature.${index}.point`));
    }else if(geom.type==='MultiPoint'){
      (geom.coordinates||[]).forEach((c,idx)=>out.push(this.normaliseRecord({...baseProps,LATITUDE:c?.[1],LONGITUDE:c?.[0],POINT_INDEX:idx},fileName,'geojson',`feature.${index}.multipoint.${idx}`)));
    }else if(geom.type==='LineString'||geom.type==='MultiLineString'){
      const lines=geom.type==='LineString'?[geom.coordinates||[]]:(geom.coordinates||[]);
      lines.forEach((coords,idx)=>{
        const lineAsset=this.normaliseRecord({...baseProps,ROUTE_POINT_COUNT:(coords||[]).length,LINE_PART:idx},fileName,'geojson',`feature.${index}.${idx}.line`);
        if(lineAsset){
          const utilityType=this.detectUtilityType(fileName,lineAsset.raw||baseProps,geom.type);
          const preserveRoute=this.preserveFullRouteForCrossing(fileName,lineAsset.raw||baseProps,utilityType);
          const safeCoords=(opts.largeMode&&!preserveRoute)?this.simplifyRawCoords(coords,900):coords;
          if(utilityType){
            lineAsset.kind=`utility-${utilityType}`;
            lineAsset.utilityType=utilityType;
            lineAsset.utilityThresholdM=this.utilityThreshold(utilityType);
          }else{
            const routeText=[fileName,lineAsset.category,lineAsset.kind,lineAsset.label,lineAsset.line,lineAsset.structure,lineAsset.equip,lineAsset.raw?.EQUIP_GRP_ID_DESC,lineAsset.raw?.ASSET_TYPE,lineAsset.raw?.LAYER,lineAsset.raw?.LAYER_NAME,lineAsset.raw?.TYPE,lineAsset.raw?.FEATURE_TYPE,lineAsset.raw?.DESCRIPTION]
              .map(v=>String(v||'')).join(' ').toUpperCase();
            if(/TRANSFORMER|DISTRIBUTION\s+TRANSFORMER|\bTX\b|KVA|WP[_\s-]*039/.test(routeText)){
              lineAsset.kind='transformer';
            }else if(/DISTRIBUTION[_\s-]*POLE|DX[_\s-]*POLE|DIST\s+POLE|ELECTRICAL\s+POLE/.test(routeText)){
              lineAsset.kind='dx-pole';
            }else if(/FIELD[_\s-]*MAP[_\s-]*READY|READY(POL|TOW|NOM)|POLES[_\s-]*FIELD|TOWERS[_\s-]*FIELD|NONWOOD[_\s-]*FIELD|TRANSMISSION|TRMSN|TRANS\s+STRUCTURE|TRANS\s+STRUNG|OVERHEAD\s+TRANSMISSION|LATTICE\s+TOWER/.test(routeText)){
              lineAsset.kind='circuit';
            }else{
              lineAsset.kind='misc-route';
            }
          }
          lineAsset.preserveFullRoute=!!preserveRoute;
          lineAsset.routeCoords=(safeCoords||[]).map(c=>[Number(c?.[1]),Number(c?.[0])]).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1]));
          // Mobile-safe geometry caps. Full raw utility geometry is what kills
          // Android/SPCK when several files are loaded. Keep enough points for map
          // context/proximity, but do not keep massive pipe/cable polylines in RAM.
          let maxRoutePoints=preserveRoute?8000:900;
          if(utilityType&&utilityType!=='hvDistribution')maxRoutePoints=450;
          if(utilityType==='hvDistribution')maxRoutePoints=2500;
          if(lineAsset.routeCoords.length>maxRoutePoints)lineAsset.routeCoords=this.simplifyLatLon(lineAsset.routeCoords,maxRoutePoints);
          lineAsset.label=utilityType?(lineAsset.utilityName||lineAsset.category||lineAsset.label||this.utilityLabel(utilityType)):(lineAsset.line||lineAsset.label||'Circuit');
          out.push(lineAsset);
        }
      });
    }else if(geom.type==='Polygon'||geom.type==='MultiPolygon'){
      const c=this.centroidFromGeometry(geom);
      const polyAsset=this.normaliseRecord({...baseProps,LATITUDE:c?.lat,LONGITUDE:c?.lon},fileName,'geojson',`feature.${index}.${String(geom.type).toLowerCase()}`);
      if(polyAsset){
        const utilityType=this.detectUtilityType(fileName,polyAsset.raw||baseProps,geom.type);
        if(utilityType){
          polyAsset.kind=`utility-${utilityType}`;
          polyAsset.utilityType=utilityType;
          polyAsset.utilityThresholdM=this.utilityThreshold(utilityType);
          polyAsset.polygonRings=this.polygonRingsFromGeometry(geom,utilityType==='rail'?900:1200);
          polyAsset.label=polyAsset.utilityName||polyAsset.category||polyAsset.label||this.utilityLabel(utilityType);
        }
        out.push(polyAsset);
      }
    }else{
      out.push(this.normaliseRecord(baseProps,fileName,'geojson',`feature.${index}.geometry`));
    }
    return out.filter(Boolean);
  },
  normalisePreIndexedRecord(row,fileName,sourceType,path){
    const originalFlat=this.flatten(row.original||{});
    const raw=this.flatten({...originalFlat,...row,original:undefined});
    Object.keys(raw).forEach(k=>raw[k]===undefined&&delete raw[k]);
    const assetId=this.clean(row.asset_id)||this.clean(raw.asset_id)||this.clean(originalFlat.STRUCTURE_LABEL)||this.clean(originalFlat.OBJECTID);
    const line=this.clean(row.line_name)||this.clean(originalFlat.LINE_NAME_1)||this.clean(originalFlat.LINE_NAME)||this.clean(originalFlat.LINE_NAME_2)||this.deriveCircuit(originalFlat,fileName);
    const gisLabel=this.labelLooksStructure(assetId)?assetId:(this.clean(originalFlat.STRUCTURE_LABEL)||'');
    const gisParts=this.splitGisLabel(gisLabel||assetId);
    let lat=this.num(row.lat); let lon=this.num(row.lon);
    if(!this.validLatLon(lat,lon)){lat=this.num(originalFlat.LATITUDE||originalFlat['geometry.y']||originalFlat.y); lon=this.num(originalFlat.LONGITUDE||originalFlat['geometry.x']||originalFlat.x);}
    if(!this.validLatLon(lat,lon)){lat=null;lon=null;}
    const poleNumber=gisParts.poleNumber||this.clean(originalFlat.NAMEPLATE_ID_1)||this.clean(originalFlat.NAMEPLATE_ID)||this.derivePoleNumber(originalFlat);
    const structure=gisLabel||this.clean(originalFlat.STRUCTURE_LABEL)||assetId;
    const category=this.clean(originalFlat.STRUC_TYP_DESC)||this.clean(originalFlat.EQUIP_GRP_ID_DESC)||this.clean(row.asset_type)||this.clean(originalFlat.SUBSTATION_TYPE);
    const fields={
      line:gisParts.line||line,
      structure,
      rawStructure:this.clean(originalFlat.structure_id)||this.clean(originalFlat.STRUCTURE_ID)||this.clean(originalFlat.OBJECTID),
      gisLabel:gisLabel||'',
      poleNumber,
      equip:this.clean(originalFlat.equip_name)||this.clean(originalFlat.EQUIP_NAME)||this.clean(originalFlat.pick_id)||this.clean(originalFlat.PICK_ID)||assetId,
      substation:this.clean(originalFlat.SUBSTATION)||this.clean(originalFlat.SEARCH_FIELD),
      category,
      material:this.clean(originalFlat.MATRL_TYP_DESC),
      conductor:this.clean(originalFlat.CONDUCTOR_ID_DESC),
      voltage:this.clean(originalFlat.KV||originalFlat.kv||originalFlat.VOLTAGE),
      poleLength:this.clean(originalFlat.POLE_LEN_M),
      poleHeight:this.clean(originalFlat.POLE_HEIGHT_M),
      address:this.clean(originalFlat.DEPOT_NAME)||this.clean(originalFlat.ADDRESS),
      kind:this.kindFrom({asset_type:row.asset_type,line,structure,category,raw:originalFlat,gisLabel,poleNumber,fileName})
    };
    const label=fields.gisLabel||fields.structure||fields.substation||fields.equip||fields.line||assetId||'Asset';
    const sourceId=[sourceType,fileName,path,assetId,fields.line,fields.structure,fields.equip,lat,lon].filter(v=>v!==null&&v!==undefined&&v!=='').join('|');
    return {id:this.hash(sourceId),sourceType,sourceFile:fileName,sourcePath:path,label,lat,lon,raw,...fields,searchText:this.makeSearchText(raw,{...fields,label,sourceFile:fileName,assetId})};
  },

  isReferencePointFile(fileName=''){
    const f=String(fileName||'').toUpperCase();
    return /(?:^|[_\s-])(SUBS?|SUBSTATIONS?|DEPOTS?|SUBREAL|TERMINALS?)(?:[_\s-]|$)|SUBS_FIELD_MAP|DEPOTS_FIELD_MAP|READY\s*SUB|READYSUB|READY\s*SUBREAL|READYSUBREAL/.test(f);
  },
  isConductorFile(fileName=''){
    const f=String(fileName||'').toUpperCase();
    return /CONDUCTOR|READYCOND|READY[_\s-]*COND|COND_BUNDLE|FIELD_MAP_READYCOND/.test(f);
  },
  isConductorSpanRecord(raw={},fileName=''){
    const f=String(fileName||'').toUpperCase();
    const hasLine=!!this.clean(raw.LINE_NAME||raw.line_name||raw.LINE_NAME_1);
    const conductor=!!this.clean(raw.CONDUCTOR_ID_DESC||raw.CONDUCTOR||raw.CABLE_ID||raw.EARTH_WIRE_1_ID_DESC||raw.EARTH_WIRE_2_ID_DESC);
    const span=!!(this.clean(raw.FIRST_NAME_PLATE_ID||raw.FIRST_STRUCTURE||raw.FROM_STRUCTURE||raw.FIRST_POLE)||this.clean(raw.LAST_NAME_PLATE_ID||raw.LAST_STRUCTURE||raw.TO_STRUCTURE||raw.LAST_POLE));
    // Conductor converter files sometimes include dead/unknown strung-section rows with
    // line + objectid but no conductor/cable. Those must not become fake structures or utilities.
    return !!(hasLine&&conductor&&(span||this.isConductorFile(fileName)||/COND|CONDUCTOR|STRUNG/.test(f)||/STRUNG SECTION/i.test(String(raw.EQUIP_GRP_ID_DESC||''))));
  },

  isHVCrossingRecord(raw={},fileName=''){
    const text=[fileName,raw.asset_type,raw.category,raw.layer,raw.field_map_layer,raw.crossing_type,raw.render_hint,raw.name,raw.NAME,raw.transmission_line,raw.hv_network]
      .map(v=>String(v||'')).join(' ').toUpperCase();
    return /DX\s*CROSSING|DX_CROSSINGS|TX[_\s-]*DX|HV\s*CROSSING|HV_CROSSINGS|HVCROSSING|CROSSING_POINTS|TRANSMISSION_X_(?:HV|HV_DISTRIBUTION|DISTRIBUTION|TRANSMISSION)|FIELD_MAP_(?:DX|HV|TX|TRANSMISSION)_CROSSINGS|TRANSMISSION\s+CROSSING|TX\s+CROSSING|TX[_\s-]*CROSSING/.test(text);
  },
  normaliseRecord(rawIn,fileName,sourceType,path){
    const raw=this.normaliseRawRow(rawIn||{});
    const publicRecovery=!!(raw.PUBLIC_RECOVERY||raw.FIELD_MAP_RECOVERY_KIND||/PUBLIC[_\s-]*STRUCTURE[_\s-]*RECOVERY|TX_PUBLIC_STRUCTURE_RECOVERY|TRANSMISSION_POLE_WP_030/i.test(String(fileName||'')));
    const conductorSpan=this.isConductorSpanRecord(raw,fileName);
    const hvCrossing=this.isHVCrossingRecord(raw,fileName);
    const gisLabel=this.clean(this.pick(raw,'gisLabel'))||this.clean(this.deriveGisLabel(raw));
    const gisParts=this.splitGisLabel(gisLabel);
    const pickedLine=this.clean(this.pick(raw,'line'));
    const derivedLine=this.clean(this.deriveCircuit(raw,fileName));
    let line=gisParts.line||pickedLine||derivedLine;
    line=window.SearchEngine?.formatCircuitName?window.SearchEngine.formatCircuitName(line):line;
    let structure=this.clean(this.pick(raw,'structure'))||this.clean(this.deriveStructure(raw));
    const rawStructure=structure;
    const poleNumber=gisParts.poleNumber||this.clean(this.pick(raw,'poleNumber'))||this.clean(this.derivePoleNumber(raw));
    const equip=this.clean(this.pick(raw,'equip'));
    const substation=this.clean(this.pick(raw,'substation'));
    let category=this.clean(this.pick(raw,'category'));
    if(!category&&sourceType==='geojson')category=this.categoryFromFile(fileName,raw.GEOMETRY_TYPE);
    let utilityType=(this.isReferencePointFile(fileName)||this.isConductorFile(fileName))?'':this.detectUtilityType(fileName,raw,raw.GEOMETRY_TYPE);
    if(conductorSpan)utilityType='';
    const utilityName=utilityType?this.utilityNameFrom(raw,fileName,utilityType):'';
    if(utilityType)category=this.utilityLabel(utilityType);
    if(gisLabel){
      if(gisParts.line)line=window.SearchEngine?.formatCircuitName?window.SearchEngine.formatCircuitName(gisParts.line):gisParts.line;
      structure=gisLabel;
    }
    if(conductorSpan){
      category='Conductor span';
      structure=structure||[line,this.clean(raw.FIRST_NAME_PLATE_ID),this.clean(raw.LAST_NAME_PLATE_ID)].filter(Boolean).join(' ');
    }
    if(publicRecovery&&!conductorSpan&&!utilityType&&!hvCrossing){
      category=category||'Structure';
      if(line&&poleNumber){
        const recoveryLabel=`${line}-${poleNumber}`;
        structure=structure||recoveryLabel;
      }
    }
    if(!line&&!structure&&!equip&&!substation&&!category&&!gisLabel)return null;
    let lat=this.num(this.pick(raw,'lat'));
    let lon=this.num(this.pick(raw,'lon'));
    if(!this.validLatLon(lat,lon)){
      const east=this.num(this.pick(raw,'easting'));
      const north=this.num(this.pick(raw,'northing'));
      const zoneText=this.clean(raw.ZONE_||raw.ZONE||raw.UTM_ZONE||raw.zone);
      const zoneMatch=String(zoneText||'').match(/(\d{1,2})/);
      const zone=zoneMatch?Number(zoneMatch[1]):50;
      let ll=this.utmToLatLon(east,north,zone,true);
      // Some Western Power reference-point exports mark Goldfields records as ZONE 51
      // while the easting/northing values are still in the Zone 50 grid.  Example:
      // WKT / West Kalgoorlie Terminal comes out near 127E if Z51 is trusted, but
      // aligns with the WKT circuits and Kalgoorlie depot near 121.42E when treated
      // as Z50.  Only correct the obvious high-easting Z51 case so normal projected
      // data is left alone.
      if(zone===51&&Number.isFinite(east)&&east>700000&&ll&&Number(ll.lon)>124.5){
        const alt=this.utmToLatLon(east,north,50,true);
        if(alt&&Number(alt.lon)>110&&Number(alt.lon)<124.8)ll=alt;
      }
      if(ll){lat=ll.lat; lon=ll.lon;}
    }
    if(!this.validLatLon(lat,lon)){lat=null;lon=null;}
    const material=this.clean(this.pick(raw,'material'));
    const conductor=this.clean(this.pick(raw,'conductor'));
    const voltage=this.clean(this.pick(raw,'voltage'));
    const poleLength=this.clean(this.pick(raw,'poleLength'));
    const poleHeight=this.clean(this.pick(raw,'poleHeight'));
    const address=this.clean(this.pick(raw,'address'))||this.clean(this.pick(raw,'description'));
    let kind=this.kindFrom({line,structure,equip,substation,category,material,conductor,address,raw,gisLabel,poleNumber,fileName});
    if(conductorSpan)kind='conductor-span';
    if(publicRecovery&&!conductorSpan&&!utilityType&&!hvCrossing)kind='structure';
    if(utilityType)kind=`utility-${utilityType}`;
    if(hvCrossing){kind='hv-crossing'; category='HV Crossing'; line=line||this.clean(raw.transmission_line||raw.tx_line||raw.circuit);}
    const firstNamePlate=this.clean(raw.FIRST_NAME_PLATE_ID||raw.FIRST_STRUCTURE||raw.FROM_STRUCTURE||raw.FIRST_POLE);
    const lastNamePlate=this.clean(raw.LAST_NAME_PLATE_ID||raw.LAST_STRUCTURE||raw.TO_STRUCTURE||raw.LAST_POLE);
    const label=hvCrossing?'HV Crossing':(conductorSpan?`${line||'Conductor'} ${firstNamePlate&&lastNamePlate?`${firstNamePlate}-${lastNamePlate}`:''}`.trim():(utilityName||gisLabel||structure||substation||equip||line||category||'Asset'));
    const sourceId=[sourceType,fileName,path,line,structure,equip,substation,gisLabel,poleNumber,firstNamePlate,lastNamePlate,lat,lon,utilityType].filter(v=>v!==null&&v!==undefined&&v!=='').join('|');
    const sourceQuality=publicRecovery?'public-recovery-real-gps':'';
    const abbrMatch=String(raw.SEARCH_FIELD||raw.search_field||raw.SUBSTATION||raw.TERMINAL||'').match(/[\(\[]\s*([A-Z0-9]{1,8})\s*[\)\]]\s*$/i);
    const abbreviation=this.clean(raw.ABBREVIATION||raw.abbreviation||raw.ABBR||raw.abbr||raw.CODE||raw.code||raw.SITE_CODE||raw.STATION_CODE||raw.SUBSTATION_CODE||raw.TERMINAL_CODE||(abbrMatch?abbrMatch[1]:''));
    const terminal=/terminal/i.test(String(kind+' '+category+' '+substation+' '+raw.SUBSTATION_TYPE));
    return {id:this.hash(sourceId),sourceType,sourceFile:fileName,sourcePath:path,kind,label,line,structure,equip,substation,terminal:terminal?substation:'',abbreviation,code:abbreviation,category,material,conductor,voltage,poleLength,poleHeight,address,lat,lon,gisLabel,poleNumber,rawStructure,firstNamePlate,lastNamePlate,utilityType,utilityName,utilityThresholdM:this.utilityThreshold(utilityType),sourceQuality,publicRecovery,searchText:this.makeSearchText(raw,{line,derivedLine,gisLabel,poleNumber,rawStructure,structure,equip,substation,abbreviation,category,material,conductor,firstNamePlate,lastNamePlate,voltage,address,kind,utilityType,utilityName,sourceFile:fileName,label,sourceQuality}),raw};
  },
  deepScan(value,rows,path){
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach((v,i)=>this.deepScan(v,rows,`${path}[${i}]`));return;}
    const flat=this.flatten(value);
    if(this.looksAssetLike(flat)){rows.push({value:flat,path});return;}
    for(const [k,v] of Object.entries(value)){if(v&&typeof v==='object')this.deepScan(v,rows,`${path}.${k}`);}
  },
  looksAssetLike(r){
    r=r||{};
    // ArcGIS schema field definitions look like {name,type,alias,length}; they are not assets.
    if(r.name!==undefined&&r.type!==undefined&&r.alias!==undefined&&!r.OBJECTID&&!r.SUBSTATION&&!r.DEPOT_NAME&&!r.STRUCTURE_LABEL&&!r.TRMSN_LINE_GIS_LABEL)return false;
    const hasId=this.pick(r,'line')||this.deriveCircuit(r,'')||this.pick(r,'structure')||this.pick(r,'equip')||this.pick(r,'substation')||this.pick(r,'gisLabel');
    const hasProjected=this.pick(r,'easting')&&this.pick(r,'northing');
    const hasUseful=this.pick(r,'lat')||this.pick(r,'lon')||hasProjected||this.pick(r,'category')||this.pick(r,'conductor')||this.pick(r,'material')||this.pick(r,'transformer')||this.pick(r,'streetlight')||this.pick(r,'description')||r.SEARCH_FIELD||r.ABBREVIATION||r.abbreviation||r.SUBSTATION_TYPE;
    return !!(hasId&&hasUseful);
  },
  flatten(obj,prefix='',out={}){
    if(!obj||typeof obj!=='object')return out;
    for(const [k,v] of Object.entries(obj||{})){
      if(v===undefined)continue;
      const key=prefix?`${prefix}.${k}`:k;
      if(v&&typeof v==='object'&&!Array.isArray(v))this.flatten(v,key,out);
      else{
        const val=Array.isArray(v)?JSON.stringify(v):v;
        out[key]=val;
        if(out[k]===undefined)out[k]=val;
      }
    }
    return out;
  },
  parseCSV(text,fileName){
    const rows=[]; let row=[],cell='',q=false;
    const pushCell=()=>{row.push(cell);cell='';}; const pushRow=()=>{if(row.length&&row.some(c=>String(c).trim()!==''))rows.push(row);row=[];};
    for(let i=0;i<text.length;i++){
      const ch=text[i], next=text[i+1];
      if(q&&ch==='"'&&next==='"'){cell+='"';i++;continue;}
      if(ch==='"'){q=!q;continue;}
      if(!q&&ch===','){pushCell();continue;}
      if(!q&&(ch==='\n'||ch==='\r')){if(ch==='\r'&&next==='\n')i++;pushCell();pushRow();continue;}
      cell+=ch;
    }
    if(cell||row.length){pushCell();pushRow();}
    const header=(rows.shift()||[]).map(h=>String(h).trim());
    const out=rows.map((r,i)=>{const obj={}; header.forEach((h,j)=>obj[h]=r[j]??''); return this.normaliseRecord(obj,fileName,'csv',`csv.${i}`);}).filter(Boolean);
    this.lastParseStats={featuresRead:rows.length,assetsIndexed:out.length,skipped:rows.length-out.length,fileName};
    return out;
  },
  deriveGisLabel(raw){
    for(const [k,v] of Object.entries(raw||{})){
      if(v===undefined||v===null||String(v).trim()==='')continue;
      if(/trmsn.*line.*gis.*label|line.*gis.*label|gis.*label|circuit.*structure.*label/i.test(k))return v;
    }
    const struct=this.clean(raw.STRUCTURE_LABEL||raw.structure_label);
    return this.labelLooksStructure(struct)?struct:'';
  },
  splitGisLabel(label){
    const text=String(label||'').trim();
    if(!text)return {line:'',poleNumber:''};
    // Source files can contain truncated dual-route labels.
    // Use the complete line+pole parts only. The truncated tail is kept in raw fields, not as a line.
    const refRe=/\b([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})*)\s*([A-Z0-9]*\d[A-Z0-9]{0,3})\s*[-–—]\s*(\d{1,6}[A-Z]{0,3}(?:\s*\/\s*\d{0,6}[A-Z]{0,3})?)/i;
    const m0=text.match(refRe);
    if(m0){
      const line=`${m0[1].toUpperCase()}-${String(m0[2]||'').toUpperCase().replace(/\s*\/\s*/g,'/')} ${m0[3].toUpperCase()}`;
      return {line,poleNumber:String(m0[4]||'').replace(/\s+/g,'').replace(/\/$/,'')};
    }
    let m=text.match(/^(.+?\b[A-Z0-9]*\d[A-Z0-9]{0,4})\s*[-_]\s*(\d{1,6}[A-Z]{0,3}(?:\s*\/\s*\d{1,6}[A-Z]{0,3})?)$/i);
    if(m)return {line:this.extractCircuitFromText(m[1])||m[1].trim(),poleNumber:String(m[2]||'').replace(/\s+/g,'')};
    m=text.match(/^(.+?\b[A-Z0-9]*\d[A-Z0-9]{0,4})\s+(\d{3,6}[A-Z]{0,3})$/i);
    if(m)return {line:this.extractCircuitFromText(m[1])||m[1].trim(),poleNumber:m[2]};
    return {line:this.extractCircuitFromText(text)||'',poleNumber:''};
  },
  labelLooksStructure(v){return /^[A-Z]{1,4}[- ][A-Z]{1,4}(?:\/[A-Z]{1,4})*\s*[A-Z0-9]{1,4}[- ](?:\d{1,6}[A-Z]{0,3}(?:\/[A-Z]{0,3}\d{0,6}[A-Z]{0,3})?|[A-Z]{1,3}\d{1,6})$/i.test(String(v||''));},
  derivePoleNumber(raw){
    const values=[];
    for(const [k,v] of Object.entries(raw||{})){if(v!==undefined&&v!==null&&/nameplate|pole.*(no|num|number)|structure.*(no|num|number)|point.*(no|id)|s_?no|snum/i.test(k))values.push(v);}
    for(const v of values){
      const text=String(v||'').trim().toUpperCase();
      let m=text.match(/(?:POLE|TOWER|STRUCTURE|POINT|S)\s*#?\s*(\d{1,5}[A-Z]{0,3})\b/); if(m)return m[1];
      m=text.match(/^0*(\d{1,5}[A-Z]{0,3})$/); if(m)return m[1].padStart(String(v).length>=4?4:0,'0');
    }
    return '';
  },
  pick(r,type){
    const aliases=this.aliases[type]||[];
    for(const a of aliases){if(r&&r[a]!==undefined&&r[a]!==null&&String(r[a]).trim()!=='')return r[a];}
    const lowerMap=Object.fromEntries(Object.entries(r||{}).map(([k,v])=>[k.toLowerCase().replace(/[^a-z0-9]/g,''),v]));
    for(const a of aliases){const k=a.toLowerCase().replace(/[^a-z0-9]/g,''); if(lowerMap[k]!==undefined&&String(lowerMap[k]).trim()!=='')return lowerMap[k];}
    return '';
  },
  deriveCircuit(raw,fileName){
    const priority=['trmsn_line_gis_label','TRMSN_LINE_GIS_LABEL','STRUCTURE_LABEL','LINE_NAME','line_name','LINE_NAME_1','Line','LINE','CIRCUIT','CIRCUIT_NAME','FEEDER','FEEDER_NAME','ROUTE','ROUTE_NAME','netwk_name','NETWK_NAME','NAME','Name','name','TITLE','LABEL','ASSET_NAME','FEATURE_NAME','DESCRIPTION','DESC'];
    const values=[];
    for(const k of priority){if(raw&&raw[k]!==undefined)values.push(raw[k]);}
    for(const [k,v] of Object.entries(raw||{})){
      if(v===undefined||v===null)continue;
      if(String(v).length>100)continue;
      if(/trmsn|line|circuit|feeder|route|netwk|name|label|desc/i.test(k))values.push(v);
    }
    for(const v of values){const found=this.extractCircuitFromText(v); if(found)return found;}
    return '';
  },
  extractCircuitFromText(value){
    let text=String(value||'').replace(/\.[A-Z0-9]{2,6}$/i,' ').replace(/[_]+/g,' ').trim();
    if(!text)return '';
    const label=this.splitGisLabelNoRecurse(text);
    if(label?.line)return label.line;
    const multiSlash=text.match(/\b([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})+)\s*(?:NO\.?\s*)?([A-Z0-9]*\d[A-Z0-9]{0,3})\b/i);
    if(multiSlash)return `${multiSlash[1].toUpperCase()}-${String(multiSlash[2]||'').toUpperCase().replace(/\s*\/\s*/g,'/')} ${multiSlash[3].toUpperCase()}`;
    const slash=text.match(/\b([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4})\s*\/\s*([A-Z]{1,4})\s*(?:NO\.?\s*)?([A-Z0-9]*\d[A-Z0-9]{0,3})\b/i);
    if(slash)return `${slash[1].toUpperCase()}-${slash[2].toUpperCase()}/${slash[3].toUpperCase()} ${slash[4].toUpperCase()}`;
    const direct=text.match(/\b([A-Z]{1,4})\s*[-–—]\s*([A-Z]{1,4})\s*(?:NO\.?\s*)?([A-Z0-9]*\d[A-Z0-9]{0,3})\b/i);
    if(direct)return `${direct[1].toUpperCase()}-${direct[2].toUpperCase()} ${direct[3].toUpperCase()}`;
    const spacedSlash=text.match(/\b([A-Z]{1,4})\s+([A-Z]{1,4})\s*\/\s*([A-Z]{1,4})\s+(?:NO\.?\s*)?([A-Z0-9]*\d[A-Z0-9]{0,3})\b/i);
    if(spacedSlash)return `${spacedSlash[1].toUpperCase()}-${spacedSlash[2].toUpperCase()}/${spacedSlash[3].toUpperCase()} ${spacedSlash[4].toUpperCase()}`;
    const compact=text.toUpperCase().replace(/[^A-Z0-9]+/g,'');
    const candidates=compact.match(/[A-Z]{2,12}[A-Z]?\d{1,4}/g)||[];
    for(const c of candidates){if(/^(OBJECTID|GLOBALID|ASSETID|FEATUREID|DISTASSET|PUBLICSECURE|GDA2020)\d*$/i.test(c))continue; if(/[A-Z]/.test(c)&&/\d/.test(c))return c;}
    return '';
  },
  splitGisLabelNoRecurse(text){
    const s=String(text||'').trim();
    const m=s.match(/^(.+?\b[A-Z0-9]{1,4})\s*[-_]\s*(\d{1,6}[A-Z]{0,3}(?:\/[A-Z]{0,3}\d{0,6}[A-Z]{0,3})?|[A-Z]{1,3}\d{1,6})$/i);
    if(!m)return null;
    const line=m[1].trim();
    if(/^[A-Z]{1,4}\s*[-–—]\s*[A-Z]{1,4}(?:\s*\/\s*[A-Z]{1,4})*\s+[A-Z0-9]{1,4}$/i.test(line))return {line:line.replace(/\s*[-–—]\s*/,'-').replace(/\s*\/\s*/,'/').replace(/\s+/g,' ').toUpperCase(),poleNumber:m[2].replace(/\s+/g,'')};
    return null;
  },
  deriveStructure(raw){
    const values=[];
    for(const [k,v] of Object.entries(raw||{})){if(v!==undefined&&v!==null&&/struct|pole|tower|site|label|point|number|no$/i.test(k))values.push(v);}
    for(const v of values){
      const text=String(v||'').trim().toUpperCase();
      if(this.labelLooksStructure(text))return text;
      let m=text.match(/\bS\s*#?\s*0*(\d{1,5})\b/); if(m)return `S${m[1]}`;
      m=text.match(/\b(?:POLE|TOWER|STRUCTURE)\s*0*(\d{1,5})\b/); if(m)return m[1];
    }
    return '';
  },
  centroidFromGeometry(geom){
    const pts=[]; const walk=c=>{if(!Array.isArray(c))return; if(typeof c[0]==='number'&&typeof c[1]==='number')pts.push(c); else c.forEach(walk);};
    walk(geom.coordinates); if(!pts.length)return null;
    const sum=pts.reduce((a,p)=>[a[0]+Number(p[0]),a[1]+Number(p[1])],[0,0]);
    return {lon:sum[0]/pts.length,lat:sum[1]/pts.length};
  },
  preserveFullRouteForCrossing(){return false;},
  simplifyRawCoords(coords,maxPoints=900){
    const arr=Array.isArray(coords)?coords:[];
    if(arr.length<=maxPoints)return arr;
    const out=[];
    const step=(arr.length-1)/(maxPoints-1);
    for(let i=0;i<maxPoints;i++)out.push(arr[Math.round(i*step)]);
    return out;
  },
  simplifyLatLon(coords,maxPoints=1200){
    const arr=Array.isArray(coords)?coords:[];
    if(arr.length<=maxPoints)return arr;
    const out=[];
    const step=(arr.length-1)/(maxPoints-1);
    for(let i=0;i<maxPoints;i++)out.push(arr[Math.round(i*step)]);
    return out;
  },
  compactLargeAsset(asset){
    if(!asset||typeof asset!=='object')return asset;
    const keep={};
    const raw=asset.raw||{};
    const keepKey=/^(objectid|id|gid|structure_id|trmsn_line_gis_label|structure_label|line_name|line_name_1|nameplate_id_1|pole_type|matrl_typ_desc|struc_typ_desc|sub_struc_desc|struc_cat_desc|pole_len_m|pole_height_m|np_dwg_no|latitude|longitude|lat|lon|lng|line|circuit|circuit_name|tx_line|transmission_line|transmission_circuit|crossing_type|original_crossing_type|crossing_kind|crossing_group|hv_network|hv_type|dx_network|dx_type|distribution_network|from_label|to_label|from_pole_no|to_pole_no|method|tx_source_segment|hv_source_segment|field_map_layer|source_layer|render_hint|import_layer|show_on_map|visible|pick_id|equip_name|kv|typ_cde|netwk_name|len_km|st_length_shape_|route_point_count|line_part|geometry_type|substation|abbreviation|owner|search_field|aer_nsp|substation_type|infrastructure|network|water_type|nominal_size|material|mainname|pressure_type|pressure_main_use|nominal_diameter|pipe_material|name|title|label|title_id|type|purpose|holder_1|road_name|common_usage_name|xing_no|xing_type|network_type|esa_type|hectares|bushforev|wst_epp|aw_wetl50|anca_50m|ramsar_50m|regnatest|scp_wetl50|tec|whp|drf|pressure|voltage|asset_class|asset_type|category|cable_type|utility_marked|utility_badges|utility_types|utility_radius_m|utility_markup_source|utility_detail_summary|utility_details|detail_.*|(gas|water|sewer|hv_dist|ug_cable|rail|pillar|esa|telco|other)_(pressure|kpa|maop|mop|voltage|kv|diameter|diam|size|material|network|purpose|holder|operator|owner|title|licence|license|cable|water|main|type|asset_id|name).*|nearby_.*|nearest_.*_m|count_.*|source_.*|ref_.*)$/i;
    for(const [k,v] of Object.entries(raw)){
      if(v===undefined||v===null)continue;
      if(!keepKey.test(k))continue;
      const text=String(v);
      if(text.length>600)continue;
      keep[k]=v;
    }
    asset.raw=keep;
    if(Array.isArray(asset.routeCoords)&&asset.routeCoords.length>450){
      const keepRoute=!!asset.preserveFullRoute||asset.utilityType==='hvDistribution'||/HV Distribution|High Voltage Distribution|Transmission/i.test([asset.sourceFile,asset.category,asset.kind,asset.label].join(' '));
      let maxRoutePoints=keepRoute?8000:900;
      if(asset.utilityType&&asset.utilityType!=='hvDistribution')maxRoutePoints=450;
      if(asset.utilityType==='hvDistribution')maxRoutePoints=2500;
      if(asset.routeCoords.length>maxRoutePoints)asset.routeCoords=this.simplifyLatLon(asset.routeCoords,maxRoutePoints);
    }
    if(Array.isArray(asset.polygonRings)&&asset.polygonRings.length){asset.polygonRings=asset.polygonRings.slice(0,12).map(r=>this.simplifyLatLon(r,500));}
    asset.searchText=this.makeSearchText(keep,{line:asset.line,gisLabel:asset.gisLabel,poleNumber:asset.poleNumber,structure:asset.structure,equip:asset.equip,substation:asset.substation,category:asset.category,material:asset.material,conductor:asset.conductor,voltage:asset.voltage,address:asset.address,kind:asset.kind,sourceFile:asset.sourceFile,label:asset.label});
    return asset;
  },
  isAssetOnlyFile(fileName=''){
    const f=String(fileName||'').toUpperCase();
    // These are real myMap asset layers. They must never be diverted into the
    // lazy utility store just because an attribute contains words such as cable,
    // kV, network, or electrical. Keeping them as normal searchable assets also
    // stops the popup from trying to load a phantom utility store for transformer files.
    const assetOnly=/FIELD[_\s-]*MAP[_\s-]*READY(POL|TOW|NOM|SUB|SUBREAL|COND)|READY(POL|TOW|NOM|SUB|SUBREAL|COND)[_\s-]*BUNDLE|TRANSFORMER|ELECTRICAL[_\s-]*TRANSFORMERS?|WP[_\s-]*039|STREET[_\s-]*LIGHT|STREETLIGHT|LUMINAIRE|DISTRIBUTION[_\s-]*POLE|DX[_\s-]*POLE|DIST[_\s-]*POLE|ELECTRICAL[_\s-]*POLE|TRANSMISSION[_\s-]*POLE|STRUCTURE|TOWER|SUBSTATION|SWITCHYARD/.test(f);
    if(!assetOnly)return false;
    const explicitUtility=/WATER[_\s-]*PIPE|WCORP|SEWER|PRESSURE[_\s-]*MAIN|PETROLEUM|PIPELINE|DMIRS|GAS|RAIL|PTA|DISTRIBUTION[_\s.-]*UNDERGROUND[_\s.-]*CABLE|UNDERGROUND[_\s.-]*CABLE|\bCABLE\b|WP[_\s-]*034|ELECTRICAL[_\s-]*PILLAR|PILLARS?|WP[_\s-]*041|HIGH[_\s-]*VOLTAGE[_\s-]*DISTRIBUTION|WP[_\s-]*052|DISTRIBUTION[_\s.-]*OVERHEAD[_\s.-]*POWERLINES?|WP[_\s-]*031|ENVIRONMENTALLY[_\s-]*SENSITIVE|CLEARING[_\s-]*REGULATIONS|DWER|ESA|WP[_\s-]*046/.test(f);
    return !explicitUtility;
  },
  categoryFromFile(fileName,geomType=''){
    const f=String(fileName||'').toUpperCase();
    if(/WATER[_\s.-]*PIPE|WCORP[_\s.-]*(002|WATER)|\bWATER\b/.test(f))return 'Water Pipe';
    if(/SEWER|PRESSURE[_\s-]*MAIN|WCORP[_\s-]*069/.test(f))return 'Sewer Pressure Main';
    if(/PETROLEUM|PIPELINE|DMIRS/.test(f))return 'High Pressure Gas';
    if(/RAIL|PTA/.test(f))return 'Rail';
    if(/DISTRIBUTION[_\s.-]*OVERHEAD[_\s.-]*POWERLINES?|OVERHEAD[_\s.-]*POWERLINES?|WP[_\s-]*031/.test(f))return 'Distribution Overhead Powerline';
    if(/NCMT.*HIGH[_\s-]*VOLTAGE.*DISTRIBUTION|HIGH[_\s-]*VOLTAGE[_\s-]*DISTRIBUTION|WP[_\s-]*052/.test(f))return 'HV Distribution Line';
    if(/DISTRIBUTION[_\s.-]*UNDERGROUND[_\s.-]*CABLE|UNDERGROUND[_\s.-]*CABLE|\bCABLE\b|WP[_\s-]*034/.test(f))return 'Underground Cable';
    if(/ELECTRICAL[_\s-]*PILLAR|PILLARS|WP[_\s-]*041/.test(f))return 'Electrical Pillar';
    if(/ELECTRICAL[_\s-]*ENCLOSURES?|ENCLOSURES?|WP[_\s-]*040/.test(f))return 'Electrical Enclosure';
    if(/ENVIRONMENTALLY[_\s-]*SENSITIVE|CLEARING[_\s-]*REGULATIONS|DWER|ESA|WP[_\s-]*046/.test(f))return 'Environmentally Sensitive Area';
    if(/ELECTRICAL[_\s-]*TRANSFORMERS?|TRANSFORMER|WP[_\s-]*039/.test(f))return 'Transformer';
    if(/SERVICE.*PIT/.test(f))return 'Service Pit';
    if(/PILLAR/.test(f))return 'Pillar';
    if(/ELECTRICAL[_\s-]*ENCLOSURES?|ENCLOSURES?|WP[_\s-]*040/.test(f))return 'Electrical Enclosure';
    if(/ENCLOSURE/.test(f))return 'Enclosure';
    if(/DISTRIBUTION.*POLE|DX.*POLE/.test(f))return 'Distribution Pole';
    if(/TRANSMISSION.*POLE|TOWER/.test(f))return 'Structure';
    if(/OVERHEAD|UNDERGROUND|LINE|CABLE/.test(f))return 'Circuit';
    return geomType||'GeoJSON asset';
  },
  kindFrom(v){
    const text=Object.values(v).filter(x=>typeof x==='string').join(' ').toUpperCase();
    const rawText=Object.entries(v.raw||{}).map(([k,val])=>`${k} ${val}`).join(' ').toUpperCase();
    const file=String(v.fileName||'').toUpperCase();
    const all=`${text} ${rawText} ${file}`;
    if(/TRANS\s+STRUCTURE|TRANSMISSION\s+STRUCTURE|LATTICE\s+TOWER|WOOD\s+POLE|STEEL\s+POLE/.test(all))return 'structure';
    if(/TRANSFORMER|\bTX\b|KVA/.test(all))return 'transformer';
    if(/ELECTRICAL[_\s-]*ENCLOSURES?|ELECTRICAL[_\s-]*ENCLOSURE|ENCLOSURE|WP[_\s-]*040/.test(all))return 'electrical-enclosure';
    if(/STREET\s*LIGHT|STREETLIGHT|LUMINAIRE|LAMP|METAL_LIGHTING/.test(all))return 'streetlight';
    if(/DEPOT/.test(all))return 'depot';
    if(/TERMINAL/.test(all))return 'terminal';
    if(/SUBSTATION|SWITCHYARD|ZONE SUB/.test(all))return 'substation';
    if(/DX POLE|DISTRIBUTION[_\s-]*POLE|DIST\s+POLE|ELECTRICAL\s+POLE/.test(all))return 'dx-pole';
    if(/LINESTRING|MULTILINESTRING|CIRCUIT|FEEDER|ROUTE|OVERHEAD POWERLINE|UNDERGROUND CABLE/.test(all)&&!v.structure&&!v.gisLabel&&!v.poleNumber)return 'circuit';
    return 'structure';
  },

  utilityThreshold(type){return 0;},
  utilityLabel(type){return 'Background layer';},
  detectUtilityType(fileName='',raw={},geomType=''){ return ''; },
  utilityNameFrom(){return '';},
  polygonRingsFromGeometry(geom,maxPoints=900){
    const rings=[];
    const addRing=(ring)=>{
      if(!Array.isArray(ring)||ring.length<3)return;
      const latlon=ring.map(c=>[Number(c?.[1]),Number(c?.[0])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
      if(latlon.length>=3)rings.push(this.simplifyLatLon(latlon,maxPoints));
    };
    if(geom?.type==='Polygon'){
      (geom.coordinates||[]).slice(0,3).forEach(addRing);
    }else if(geom?.type==='MultiPolygon'){
      for(const poly of (geom.coordinates||[]).slice(0,8)){
        if(Array.isArray(poly?.[0]))addRing(poly[0]);
      }
    }
    return rings;
  },
  makeSearchText(raw,fields){return [Object.values(fields).join(' '),Object.entries(raw||{}).map(([k,v])=>`${k} ${v}`).join(' ')].join(' ').toUpperCase();},
  clean(v){
    if(v===undefined||v===null)return '';
    let s=String(v).trim();
    s=s.replace(/,+$/,'').trim();
    if(/^null$/i.test(s)||/^undefined$/i.test(s))return '';
    if((s.startsWith('\"')&&s.endsWith('\"'))||(s.startsWith('"')&&s.endsWith('"'))||(s.startsWith("'")&&s.endsWith("'")))s=s.slice(1,-1);
    s=s.replace(/\\"/g,'"').replace(/^"|"$/g,'').trim();
    return s;
  },
  num(v){if(v===undefined||v===null||v==='')return null; const n=Number(this.clean(v).replace(/,/g,'')); return Number.isFinite(n)?n:null;},
  utmToLatLon(easting,northing,zone=50,southern=true){
    easting=Number(easting); northing=Number(northing); zone=Number(zone)||50;
    if(!Number.isFinite(easting)||!Number.isFinite(northing)||easting<10000||northing<10000)return null;
    const a=6378137.0, f=1/298.257223563, k0=0.9996;
    const e=Math.sqrt(f*(2-f));
    const e1=(1-Math.sqrt(1-e*e))/(1+Math.sqrt(1-e*e));
    const x=easting-500000.0;
    let y=northing; if(southern)y-=10000000.0;
    const lon0=(zone-1)*6-180+3;
    const M=y/k0;
    const mu=M/(a*(1-e*e/4-3*e**4/64-5*e**6/256));
    const J1=3*e1/2-27*e1**3/32;
    const J2=21*e1**2/16-55*e1**4/32;
    const J3=151*e1**3/96;
    const J4=1097*e1**4/512;
    const fp=mu+J1*Math.sin(2*mu)+J2*Math.sin(4*mu)+J3*Math.sin(6*mu)+J4*Math.sin(8*mu);
    const ep2=e*e/(1-e*e);
    const C1=ep2*Math.cos(fp)**2;
    const T1=Math.tan(fp)**2;
    const N1=a/Math.sqrt(1-e*e*Math.sin(fp)**2);
    const R1=a*(1-e*e)/Math.pow(1-e*e*Math.sin(fp)**2,1.5);
    const D=x/(N1*k0);
    const Q1=N1*Math.tan(fp)/R1;
    const Q2=D*D/2;
    const Q3=(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24;
    const Q4=(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720;
    const lat=fp-Q1*(Q2-Q3+Q4);
    const Q5=D;
    const Q6=(1+2*T1+C1)*D**3/6;
    const Q7=(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120;
    const lon=(lon0*Math.PI/180)+(Q5-Q6+Q7)/Math.cos(fp);
    const out={lat:lat*180/Math.PI,lon:lon*180/Math.PI};
    return this.validLatLon(out.lat,out.lon)?out:null;
  },
  validLatLon(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);},
  hash(s){let h=2166136261; const text=String(s||''); for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);} return 'a'+(h>>>0).toString(16);},
  idle(){return this.paint?this.paint():new Promise(r=>setTimeout(r,16));}
};
if(typeof window!=='undefined')window.ImportEngine=ImportEngine;
if(typeof self!=='undefined')self.ImportEngine=ImportEngine;
