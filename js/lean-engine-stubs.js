// Lean core stubs.
// These keep old engine references safe after removing optional utility/crossing/span modules.
var UtilitiesEngine = window.UtilitiesEngine = {
  types:[], labels:{}, grid:null, gridStats:null, lastResults:[], lastScanMeta:null,
  init(){}, invalidateGrid(){}, clear(){}, updatePanel(){}, refreshAssetBadgePanel(){},
  hasAnyImportedUtility(){return false;}, hasAnyUtilityEnabled(){return false;}, isUtilityFileMeta(){return false;},
  hasPrecomputedMarkup(){return false;}, assetBadgeHtml(){return '';},
  isUtility(a){return !!a && String(a.kind||'').toLowerCase().startsWith('utility-');},
  typeOf(a){return String(a?.utilityType||a?.kind||'').replace(/^utility-/,'');},
  filterKey(type){const s=String(type||'utility'); return 'utility'+s.charAt(0).toUpperCase()+s.slice(1);},
  proximityScan(){return [];}, nearest(){return [];}
};

var HVCrossingsLayer = window.HVCrossingsLayer = {
  init(){}, loadStore(){return Promise.resolve();}, migrateStoredAssetCrossings(){return Promise.resolve();},
  clearActive(){}, showForAsset(){}, showForCircuit(){}, showForCircuitFull(){return Promise.resolve();},
  deleteBySourceFile(){return Promise.resolve();}, storeImported(){return Promise.resolve({stored:0});},
  isCrossingAsset(){return false;}, isLikelyCrossingFile(){return false;}, ingestRecords(){return Promise.resolve({imported:0});}
};
