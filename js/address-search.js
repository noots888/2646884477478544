/* myMap v3.1.168: WA-only address search module */
(function(){
  const WA={west:112.5,east:129.1,north:-13.0,south:-35.4};
  let markerLayer=null;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=msg=>{try{UI?.toast?.(msg);}catch(e){}};
  function ensureStyle(){
    if(document.getElementById('addressSearchStyle'))return;
    const st=document.createElement('style');
    st.id='addressSearchStyle';
    st.textContent=`
      .address-search-panel .result-card small{display:block;margin-top:3px;color:#5f6d5d;font-weight:750;font-size:11px;line-height:1.2;}
      .address-search-pin{width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#d71920;border:3px solid #fff;box-shadow:0 5px 14px rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;}
      .address-search-pin span{transform:rotate(45deg);color:#fff;font:1000 17px/1 system-ui,-apple-system,Segoe UI,sans-serif;}
      .address-popup{min-width:190px;max-width:260px;font:650 13px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;color:#17351f;}
      .address-popup b{display:block;font-size:15px;margin-bottom:5px;}
      .address-popup a{display:block;margin-top:8px;padding:9px 10px;border-radius:12px;background:#1f5f2b;color:#fff;text-align:center;text-decoration:none;font-weight:950;}
      .address-popup .address-remove-btn{display:block;width:100%;margin-top:7px;padding:9px 10px;border-radius:12px;border:1px solid rgba(120,30,30,.25);background:#f3ddd4;color:#7a1717;text-align:center;font-weight:1000;font:950 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;}
    `;
    document.head.appendChild(st);
  }
  function inWA(lat,lon){
    lat=Number(lat); lon=Number(lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lon>=WA.west&&lon<=WA.east&&lat<=WA.north&&lat>=WA.south;
  }
  function isWAResult(r){
    if(!r)return false;
    if(!inWA(r.lat,r.lon))return false;
    const a=r.address||{};
    const txt=[r.display_name,a.state,a.state_district,a.county,a.country,a.country_code].map(v=>String(v||'')).join(' ').toUpperCase();
    return /WESTERN AUSTRALIA|\bWA\b/.test(txt) || String(a.country_code||'').toLowerCase()==='au';
  }
  function niceName(r){
    const a=r.address||{};
    return a.house_number&&a.road ? `${a.house_number} ${a.road}` : (r.name||r.display_name||'Address');
  }
  function suburbLine(r){
    const a=r.address||{};
    return [a.suburb||a.neighbourhood||a.hamlet||a.village||a.town||a.city].filter(Boolean).join(', ');
  }
  function googleUrl(lat,lon){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(Number(lat).toFixed(7)+','+Number(lon).toFixed(7))}`;}
  const AddressSearch={
    open(){
      ensureStyle();
      try{
        const APP=window.LeanMapApp;
        APP?.closePlusMenu?.();
        APP?.closeSearchQuickPanel?.();
        APP?.closeToggleQuickPanel?.();
        APP?.closeCircuitPicker?.();
        APP?.closeAssetSearch?.();
        APP?.closeToolsPanel?.();
        APP?.closeResetPanel?.();
        APP?.closeConductorsPanel?.();
        APP?.closeBaseLayersPanel?.();
        APP?.closeAssetLayersPanel?.();
        document.getElementById('statusPanel')?.classList.add('hidden');
        document.getElementById('hvTxTogglePanel')?.classList.add('hidden');
        document.getElementById('hvTxAlertBtn')?.classList.remove('active');
        if(window.HVCrossingsLayer)window.HVCrossingsLayer.controlsOpen=false;
      }catch(e){}
      $('addressSearchPanel')?.classList.remove('hidden');
      setTimeout(()=>$('addressSearchInput')?.focus(),30);
    },
    close(){
      $('addressSearchPanel')?.classList.add('hidden');
    },
    async run(){
      ensureStyle();
      const q=String($('addressSearchInput')?.value||'').trim();
      const box=$('addressSearchResults');
      if(!box)return;
      if(q.length<3){
        box.innerHTML='<div class="tiny-note">Type at least 3 characters.</div>';
        return;
      }
      box.innerHTML='<div class="tiny-note">Searching WA addresses…</div>';
      const query=/\b(WA|WESTERN\s+AUSTRALIA|AUSTRALIA)\b/i.test(q)?q:`${q}, Western Australia, Australia`;
      const params=new URLSearchParams({
        format:'jsonv2',
        q:query,
        limit:'10',
        addressdetails:'1',
        countrycodes:'au',
        viewbox:`${WA.west},${WA.north},${WA.east},${WA.south}`,
        bounded:'1'
      });
      let data=[];
      try{
        const res=await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`,{
          method:'GET',
          headers:{'Accept':'application/json'}
        });
        if(!res.ok)throw new Error('Address search failed');
        data=await res.json();
      }catch(e){
        console.warn(e);
        box.innerHTML='<div class="tiny-note">Address search needs internet. Try again when online.</div>';
        return;
      }
      const rows=(Array.isArray(data)?data:[]).filter(isWAResult).slice(0,8);
      if(!rows.length){
        box.innerHTML='<div class="tiny-note">No WA address results found.</div>';
        return;
      }
      box.innerHTML=rows.map((r,i)=>{
        const lat=Number(r.lat), lon=Number(r.lon);
        return `<div class="result-card"><b>${esc(niceName(r))}</b>${suburbLine(r)?`<span>${esc(suburbLine(r))}</span>`:''}<button type="button" data-address-i="${i}">Map</button></div>`;
      }).join('');
      box.querySelectorAll('button[data-address-i]').forEach(btn=>btn.addEventListener('click',()=>{
        const r=rows[Number(btn.dataset.addressI)];
        this.show(r);
      }));
    },
    clear(){
      try{markerLayer?.clearLayers?.();}catch(e){}
    },
    show(r){
      const lat=Number(r?.lat), lon=Number(r?.lon);
      if(!inWA(lat,lon)){toast('Address is outside WA.');return;}
      const map=window.MapEngine?.map;
      if(!map||!window.L){toast('Map is not ready.');return;}
      try{
        if(!markerLayer)markerLayer=L.layerGroup().addTo(map);
        markerLayer.clearLayers();
        const label=niceName(r);
        const sub=suburbLine(r);
        const icon=L.divIcon({className:'',html:'<div class="address-search-pin"><span>⌖</span></div>',iconSize:[34,34],iconAnchor:[17,34],popupAnchor:[0,-32]});
        const marker=L.marker([lat,lon],{icon}).addTo(markerLayer);
        marker.bindPopup(`<div class="address-popup"><b>${esc(label)}</b>${sub?`<div>${esc(sub)}</div>`:''}<a href="${googleUrl(lat,lon)}" target="_blank" rel="noopener">Google Maps</a><button class="address-remove-btn" type="button" data-address-remove="1">Remove</button></div>`).openPopup();
        marker.on('popupopen',()=>{
          setTimeout(()=>{
            document.querySelectorAll('[data-address-remove]').forEach(btn=>{
              if(btn.__addressRemoveBound)return;
              btn.__addressRemoveBound=true;
              btn.addEventListener('click',ev=>{try{ev.preventDefault();ev.stopPropagation();}catch(_e){} this.clear();});
            });
          },0);
        });
        map.setView([lat,lon],18,{animate:true});
        this.close();
      }catch(e){
        console.warn(e);
        toast('Could not move map to address.');
      }
    },
    bind(){
      ensureStyle();
      $('closeAddressSearchPanel')?.addEventListener('click',()=>this.close());
      $('runAddressSearchBtn')?.addEventListener('click',()=>this.run());
      $('addressSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')this.run();});
    }
  };
  window.AddressSearch=AddressSearch;
  document.addEventListener('DOMContentLoaded',()=>AddressSearch.bind());
})();
