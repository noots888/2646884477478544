/* myMap-V3.1.57 conductor data loader
   Conductor reference data is loaded from a user-selected JSON file and saved locally.
   It is not embedded in JavaScript and is not auto-restored after Reset app. */
(function(){
  "use strict";
  const VERSION = "map-app-v3-1-57-final-conductor-calculator-pass-v1";
  const STORAGE_KEY = "MapAPP.conductorReference.v1";
  const SOURCE_KEY = "MapAPP.conductorReferenceSource.v1";

  window.FieldMapConductorSections = Array.isArray(window.FieldMapConductorSections) ? window.FieldMapConductorSections : [];
  window.FieldMapConductorSpecs = window.FieldMapConductorSpecs || {};
  window.FieldMapConductorData = window.FieldMapConductorData || null;

  function applyData(data, sourceName){
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const specs = data?.specs && typeof data.specs === "object" ? data.specs : {};
    window.FieldMapConductorData = data || null;
    window.FieldMapConductorSections = sections;
    window.FieldMapConductorSpecs = specs;
    window.FieldMapConductorDataSource = sourceName || data?.sourceName || "loaded conductor JSON";
    try{ if(window.FieldMapSpanWeightCalculator?.setSpecs) window.FieldMapSpanWeightCalculator.setSpecs(specs); }catch(e){}
    try{ if(window.FieldMapSpanWeightCalculator?.invalidateCalculatorCaches) window.FieldMapSpanWeightCalculator.invalidateCalculatorCaches(); }catch(e){}
    return data;
  }

  function clear(){
    try{ localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SOURCE_KEY); }catch(e){}
    applyData({sections:[], specs:{}}, "none");
    return true;
  }

  function save(data, sourceName){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data || {}));
      localStorage.setItem(SOURCE_KEY, sourceName || "conductor JSON");
    }catch(e){
      console.warn("Could not save conductor reference JSON locally", e);
      throw new Error("Conductor JSON is too large for this browser storage. Use a smaller conductor reference JSON.");
    }
  }

  function normaliseData(data){
    if(!data || typeof data !== "object") throw new Error("Invalid conductor JSON.");
    if(!data.specs || typeof data.specs !== "object") throw new Error("Conductor JSON must contain a specs object.");
    if(!Array.isArray(data.sections)) data.sections = [];
    return data;
  }

  async function importFile(file){
    if(!file) throw new Error("No conductor JSON selected.");
    const text = await file.text();
    const data = normaliseData(JSON.parse(text));
    data.loadedAt = new Date().toISOString();
    data.loadedFileName = file.name || "conductor JSON";
    save(data, data.loadedFileName);
    return applyData(data, data.loadedFileName);
  }

  async function loadSaved(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw){ clear(); return null; }
      const data = normaliseData(JSON.parse(raw));
      const source = localStorage.getItem(SOURCE_KEY) || data.loadedFileName || "saved conductor JSON";
      return applyData(data, source);
    }catch(e){
      console.warn("Saved conductor reference could not be loaded", e);
      clear();
      return null;
    }
  }

  async function load(url){
    const res = await fetch(url, {cache:"no-store"});
    if(!res.ok) throw new Error("Conductor JSON load failed: HTTP " + res.status);
    const data = normaliseData(await res.json());
    return applyData(data, url);
  }

  const ready = loadSaved();
  window.FieldMapConductorDataLoader = {ready, load, importFile, setData:applyData, clear, storageKey:STORAGE_KEY, sourceKey:SOURCE_KEY, version:VERSION};
})();
