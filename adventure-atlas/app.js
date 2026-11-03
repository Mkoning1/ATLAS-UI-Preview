(() => {
  "use strict";

  // No account, tracker, telemetry or backend. Drafts stay in this browser.
  const KEY = "adventure-atlas-local-v1";
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const VALID_CATEGORIES = new Set(["adventure", "expedition", "bucketlist", "milestone"]);
  const VALID_STATUSES = new Set(["planned", "completed"]);
  const LABELS = {adventure:"Adventure", expedition:"Expedition", bucketlist:"Bucketlist", milestone:"Milestone"};
  const EMOJI = {adventure:"↗", expedition:"⌁", bucketlist:"✦", milestone:"★"};
  const COLORS = {completed:"#c9f276", wishlist:"#7ecad3", future:"#e9ac6e"};
  let seed = [], drafts = [], filtered = [], activeFilter = "all", selectedId = null, editingId = null;
  let map, pins, routes, animationLayer, picking = false, animationFrame = null;
  let previousLine = null, toastTimeout = null;
  const current = () => {
    const merged = new Map();
    seed.forEach((item) => merged.set(item.id, item));
    drafts.forEach((item) => merged.set(item.id, item));
    return [...merged.values()];
  };
  const statusType = (item) => item.status === "completed" ? "completed" : item.category === "bucketlist" ? "wishlist" : "future";
  const hasCoords = (item) => item.coords && Number.isFinite(item.coords.lat) && Number.isFinite(item.coords.lng);
  const hasRoute = (item) => Array.isArray(item.route) && item.route.length >= 2;
  const dateLabel = (value) => {
    if (!value) return "Datum nog niet vastgelegd";
    const date = new Date(value + "T12:00:00");
    return Number.isNaN(date.getTime()) ? "Datum onbekend" : new Intl.DateTimeFormat("nl-NL", {day:"numeric",month:"short",year:"numeric"}).format(date);
  };
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ""));
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  };
  const normalizeItem = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const title = String(raw.title || "").trim().slice(0,100);
    if (!title) return null;
    const id = String(raw.id || ("adventure-" + crypto.randomUUID())).replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,95);
    const category = VALID_CATEGORIES.has(raw.category) ? raw.category : "adventure";
    const status = VALID_STATUSES.has(raw.status) ? raw.status : "planned";
    const coord = raw.coords && typeof raw.coords === "object" ? {lat:Number(raw.coords.lat),lng:Number(raw.coords.lng)} : null;
    const coords = coord && Number.isFinite(coord.lat) && Math.abs(coord.lat) <= 90 && Number.isFinite(coord.lng) && Math.abs(coord.lng) <= 180 ? coord : null;
    const route = Array.isArray(raw.route) ? raw.route.slice(0,1500).map((p) => ({lat:Number(p.lat),lng:Number(p.lng)})).filter((p) => Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180) : [];
    return {
      id, title, category, status, coords, route,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || "")) ? raw.date : "",
      location: String(raw.location || "").slice(0,100),
      country: String(raw.country || "").slice(0,70),
      countries: Array.isArray(raw.countries) ? raw.countries.filter((v)=>typeof v === "string").map((v)=>v.slice(0,70)).slice(0,30) : [],
      description: String(raw.description || "").slice(0,1300),
      reflection: String(raw.reflection || "").slice(0,600),
      visibility: raw.visibility === "private" ? "private" : "public",
      image: safeUrl(raw.image),
      routeAccuracy: raw.routeAccuracy === "gpx" ? "gpx" : raw.routeAccuracy === "schematic" ? "schematic" : "",
      isChallenge: Boolean(raw.isChallenge)
    };
  };

  function toast(message) {
    clearTimeout(toastTimeout);
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    toastTimeout = setTimeout(() => $("toast").classList.remove("visible"), 4000);
  }

  function readDrafts() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "[]");
      drafts = Array.isArray(data) ? data.slice(0,1000).map(normalizeItem).filter(Boolean) : [];
    } catch { drafts = []; toast("Lokale data kon niet worden geladen."); }
  }
  function saveDrafts() {
    try { localStorage.setItem(KEY, JSON.stringify(drafts)); return true; }
    catch { toast("Opslagruimte vol of geblokkeerd. Exporteer eerst een back-up."); return false; }
  }

  function buildMap() {
    if (!window.L) throw new Error("Leaflet niet geladen. Controleer je internetverbinding.");
    map = L.map("map", {zoomControl:true, worldCopyJump:true, minZoom:2, maxZoom:17, preferCanvas:true}).setView([51.6,7.5],5);
    L.tileLayer("https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{
      subdomains:"abcd", maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
    }).addTo(map);
    pins = L.layerGroup().addTo(map);
    routes = L.layerGroup().addTo(map);
    animationLayer = L.layerGroup().addTo(map);
    map.on("click", ({latlng}) => {
      if (!picking) return;
      picking = false;
      $("mapHint").textContent = "Locatie gekozen. Vul je avontuur verder in.";
      $("adventureForm").elements.lat.value = latlng.lat.toFixed(6);
      $("adventureForm").elements.lng.value = latlng.lng.toFixed(6);
      $("addDialog").showModal();
      toast("Locatie geselecteerd op de kaart.");
    });
    map.on("popupopen", (ev) => {
      const button = ev.popup.getElement()?.querySelector("[data-open]");
      if (button) button.addEventListener("click", () => selectItem(button.dataset.open));
    });
  }

  function filteredItems() {
    const text = $("searchInput").value.trim().toLowerCase();
    const matches = current().filter((item) => {
      if (activeFilter === "completed" && item.status !== "completed") return false;
      if (["expedition","bucketlist","milestone"].includes(activeFilter) && item.category !== activeFilter) return false;
      return !text || [item.title,item.location,item.country,item.description].join(" ").toLowerCase().includes(text);
    });
    matches.sort((a,b) => {
      const priority = (item) => item.status === "completed" ? 0 : item.category === "expedition" ? 1 : 2;
      return priority(a)-priority(b) || (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title);
    });
    return matches;
  }

  function paint() {
    filtered = filteredItems();
    renderStats(); renderList(); renderMap();
    $("resultCount").textContent = String(filtered.length);
  }

  function renderStats() {
    const completed = current().filter((x) => x.status === "completed");
    const countries = new Set();
    completed.forEach((x) => {
      if (x.countries.length) x.countries.forEach((country) => countries.add(country.toLowerCase()));
      else if (x.country) countries.add(x.country.toLowerCase());
    });
    $("stat-adventures").textContent = String(completed.length);
    $("stat-countries").textContent = String(countries.size);
    $("stat-challenges").textContent = String(completed.filter((x) => x.isChallenge).length);
  }

  function renderList() {
    const list = $("adventureList");
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("p"); empty.className = "empty-state";
      empty.textContent = "Nog niets gevonden. Probeer een ander filter, of voeg jouw eerste avontuur toe.";
      list.append(empty); return;
    }
    for (const item of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "adventure-card" + (selectedId === item.id ? " selected" : "");
      btn.setAttribute("aria-label", item.title + " openen");
      const privateBadge = item.visibility === "private" ? " 🔒" : "";
      btn.innerHTML = '<span class="card-icon" aria-hidden="true">'+EMOJI[item.category]+'</span><span class="card-body"><span class="card-head"><strong>'+escapeHtml(item.title)+privateBadge+'</strong><span class="card-status">'+(item.status === "completed" ? "DONE" : "TO DO")+'</span></span><span class="card-meta">'+escapeHtml(item.location || "Locatie nog onbekend")+' · '+escapeHtml(dateLabel(item.date))+'</span><span class="card-desc">'+escapeHtml(item.description || LABELS[item.category])+'</span></span>';
      btn.addEventListener("click", () => selectItem(item.id));
      list.append(btn);
    }
  }

  function renderMap() {
    stopAnimation();
    pins.clearLayers(); routes.clearLayers(); animationLayer.clearLayers();
    for (const item of filtered) {
      const type = statusType(item);
      if (hasRoute(item)) {
        const line = L.polyline(item.route.map((p) => [p.lat,p.lng]), {color:COLORS[type],weight:item.id===selectedId?4:2.5,opacity:item.id===selectedId?.95:.65,dashArray:item.routeAccuracy==="schematic"?"7,10":null}).addTo(routes);
        line.on("click", () => selectItem(item.id));
      }
      const point = hasCoords(item) ? item.coords : hasRoute(item) ? item.route.at(-1) : null;
      if (!point) continue;
      const pin = L.marker([point.lat,point.lng], {
        icon:L.divIcon({className:"atlas-pin-wrap",html:'<div class="pin '+type+(selectedId===item.id?" selected":"")+'">'+EMOJI[item.category]+'</div>',iconSize:[25,25],iconAnchor:[12,12]}),
        title:item.title,
        alt:item.title,
        keyboard:true
      }).addTo(pins);
      pin.bindPopup('<div class="map-popup"><strong>'+escapeHtml(item.title)+'</strong><small>'+escapeHtml(item.location || LABELS[item.category])+' · '+escapeHtml(item.status === "completed"?"Voltooid":"Gepland")+'</small><br><button data-open="'+escapeHtml(item.id)+'">Bekijk het verhaal</button></div>');
      pin.on("click", () => selectItem(item.id,false));
    }
  }

  function focusItem(item) {
    if (hasRoute(item)) {
      map.fitBounds(L.latLngBounds(item.route.map((p)=>[p.lat,p.lng])),{padding:[90,90],maxZoom:9,animate:true});
    } else if (hasCoords(item)) {
      map.flyTo([item.coords.lat,item.coords.lng],Math.max(map.getZoom(),8),{duration:1});
    } else toast("Voor dit avontuur is nog geen kaartlocatie toegevoegd.");
  }

  function selectItem(id, fly=true) {
    const item = current().find((x)=>x.id===id);
    if (!item) return;
    selectedId = id;
    $("storyPanel").hidden = false;
    $("deleteStory").hidden = !drafts.some((x)=>x.id===id) || seed.some((x)=>x.id===id);
    $("storyType").textContent = LABELS[item.category] + " · " + (item.status === "completed" ? "completed" : "planned");
    $("storyTitle").textContent = item.title;
    $("storyPlace").textContent = [item.location,item.country,dateLabel(item.date)].filter(Boolean).join("  ·  ");
    $("storyDescription").textContent = item.description || "Het verhaal van dit avontuur wordt nog geschreven.";
    $("storyMeta").textContent = item.visibility === "private" ? "🔒 Alleen lokaal — wordt niet publiek geëxporteerd" : "◉ Publiek verhaal";
    $("storyNote").textContent = (item.reflection ? "Herinnering: " + item.reflection + "\n" : "") + (item.routeAccuracy==="schematic" ? "Route is schematisch: geen geregistreerde GPS-track." : "");
    $("storyNote").style.whiteSpace = "pre-line";
    $("showOnMap").disabled = !(hasCoords(item) || hasRoute(item));
    const oldImage = $("storyMedia"); if(oldImage) oldImage.remove();
    if (item.image) {
      const img = document.createElement("img");
      img.id="storyMedia"; img.src=item.image; img.alt="Foto bij " + item.title;
      img.loading="lazy"; img.style.cssText="display:block;width:100%;max-height:175px;object-fit:cover;border-radius:9px;margin-top:15px";
      $("storyDescription").before(img);
    }
    $("cinemaTitle").textContent = item.title;
    $("cinemaSubtitle").textContent = [item.location,item.country].filter(Boolean).join(" · ") || "Discover the unknown";
    $("cinemaEyebrow").textContent = LABELS[item.category].toUpperCase();
    $("routeNotice").textContent = item.routeAccuracy==="schematic" ? "Schematische route · niet de werkelijk gereden of gelopen GPS-track" : "";
    $("playRoute").disabled = !hasRoute(item);
    document.body.classList.remove("nav-open");
    renderList(); renderMap();
    if (fly) focusItem(item);
  }

  function selectFilter(next) {
    activeFilter = next;
    document.querySelectorAll("[data-filter]").forEach((btn) => {
      const on = btn.dataset.filter === next;
      btn.classList.toggle("active",on);
      btn.setAttribute("aria-pressed",String(on));
    });
    paint();
  }

  function fitAll() {
    const points = filtered.flatMap((item) => [
      ...(hasCoords(item) ? [[item.coords.lat,item.coords.lng]] : []),
      ...(hasRoute(item) ? item.route.map((p)=>[p.lat,p.lng]) : [])
    ]);
    if (points.length) map.fitBounds(L.latLngBounds(points),{padding:[85,85],maxZoom:7});
    else map.setView([50,8],4);
  }

  function openAdd(item=null) {
    const form = $("adventureForm");
    form.reset();
    editingId = item?.id || null;
    $("dialogTitle").textContent = item ? "Avontuur bewerken" : "Nieuw avontuur";
    if (item) {
      for (const key of ["title","date","category","status","location","country","description","reflection","visibility","image"]) {
        if(form.elements[key])form.elements[key].value=item[key] || (key==="visibility"?"public":"");
      }
      form.elements.lat.value = hasCoords(item) ? item.coords.lat : "";
      form.elements.lng.value = hasCoords(item) ? item.coords.lng : "";
    }
    $("addDialog").showModal();
  }

  function addAdventure(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData($("adventureForm")));
    const hasLat = String(values.lat || "").trim()!=="";
    const hasLng = String(values.lng || "").trim()!=="";
    if (hasLat !== hasLng) { toast("Vul beide coördinaten in, of laat ze allebei leeg."); return; }
    const existing = editingId ? current().find((item)=>item.id===editingId) : null;
    const created = normalizeItem({
      id:editingId || ("adventure-"+crypto.randomUUID()),title:values.title,date:values.date,
      category:values.category,status:values.status,location:values.location,
      country:values.country,description:values.description,reflection:values.reflection,
      visibility:values.visibility,image:values.image,
      coords:hasLat?{lat:values.lat,lng:values.lng}:null,
      route:existing?.route || [],routeAccuracy:existing?.routeAccuracy || "",
      countries:existing?.countries || [],isChallenge:existing?.isChallenge || values.category==="adventure"
    });
    if (!created) { toast("Controleer de titel en coördinaten."); return; }
    const old=[...drafts],index=drafts.findIndex((item)=>item.id===created.id);
    if(index>=0)drafts[index]=created;
    else drafts.push(created);
    if (!saveDrafts()) { drafts=old; return; }
    editingId=null;
    $("addDialog").close();
    $("searchInput").value="";
    selectFilter("all");
    selectItem(created.id);
    toast("Avontuur lokaal bewaard. Exporteer om een kopie te maken.");
  }

  function deleteAdventure() {
    const item=drafts.find((x)=>x.id===selectedId);
    if (!item || seed.some((x)=>x.id===item.id)) return;
    if(!window.confirm("Dit lokale avontuur echt verwijderen? Maak eerst een back-up als je het wilt bewaren."))return;
    const old=[...drafts];
    drafts=drafts.filter((x)=>x.id!==item.id);
    if(!saveDrafts()){drafts=old;return;}
    selectedId=null;$("storyPanel").hidden=true;
    paint();toast("Avontuur lokaal verwijderd.");
  }

  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function exportData(publicOnly) {
    const items = current().filter((x)=>!publicOnly || x.visibility==="public");
    download(publicOnly?"adventures-public.json":"adventure-atlas-PRIVATE-backup.json", {version:1,adventures:items});
    toast(publicOnly ? "Publieke export gedownload. Plaats deze in data/adventures.json in GitHub." : "Privéback-up gedownload. Deel dit bestand niet openbaar.");
  }

  async function importJSON(file) {
    if (!file) return;
    try {
      if (file.size > 3_000_000) throw new Error("Bestand is groter dan 3 MB.");
      const parsed = JSON.parse(await file.text());
      const entries = Array.isArray(parsed) ? parsed : parsed.adventures;
      if (!Array.isArray(entries) || entries.length>1000) throw new Error("Gebruik een JSON-lijst met maximaal 1000 avonturen.");
      const imported = entries.map(normalizeItem);
      if (imported.some((x)=>!x)) throw new Error("Één of meer avonturen missen een titel.");
      const byId = new Map(drafts.map((x)=>[x.id,x]));
      imported.forEach((x)=>byId.set(x.id,x));
      const old = drafts;
      drafts = [...byId.values()];
      if (!saveDrafts()) { drafts=old; return; }
      selectedId=null; $("storyPanel").hidden=true;selectFilter("all");fitAll();
      toast(imported.length + " avonturen geïmporteerd (alleen lokaal).");
    } catch (error) { toast("Import mislukt: "+error.message); }
    $("importData").value="";
  }

  async function importGPX(file) {
    if (!file) return;
    try {
      if (file.size > 6_000_000) throw new Error("GPX is groter dan 6 MB.");
      const doc = new DOMParser().parseFromString(await file.text(),"application/xml");
      if (doc.querySelector("parsererror")) throw new Error("Ongeldig GPX/XML-bestand.");
      let nodes = [...doc.getElementsByTagName("trkpt")];
      if (!nodes.length) nodes = [...doc.getElementsByTagName("rtept")];
      const pts = nodes.map((node)=>({lat:Number(node.getAttribute("lat")),lng:Number(node.getAttribute("lon"))}))
        .filter((p)=>Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180);
      if (pts.length<2) throw new Error("Geen route met minimaal twee punten gevonden.");
      const stride = Math.max(1,Math.ceil(pts.length/300));
      const route = pts.filter((_,i)=>i%stride===0);
      if (route.at(-1)!==pts.at(-1)) route.push(pts.at(-1));
      const name = file.name.replace(/\.gpx$/i,"").replace(/[_-]/g," ").slice(0,100);
      const item = normalizeItem({
        id:"expedition-"+crypto.randomUUID(),title:name,category:"expedition",status:"planned",
        visibility:"private",location:"GPX-import",route,coords:route.at(-1),routeAccuracy:"gpx",
        description:"Geïmporteerde GPS-route. Vul datum, beschrijving en status later aan voordat je publiceert."
      });
      drafts.push(item);
      if (!saveDrafts()){drafts.pop();return;}
      $("searchInput").value="";selectFilter("all");selectItem(item.id);
      toast("GPX-route geïmporteerd als privéconcept. Geen reisstatus aangenomen.");
    } catch(error){toast("GPX-import mislukt: "+error.message);}
    $("importGpx").value="";
  }

  function stopAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame=null;
    if(animationLayer) animationLayer.clearLayers();
    previousLine=null;
  }

  function playRoute() {
    const item=current().find((x)=>x.id===selectedId);
    if (!item || !hasRoute(item)) {toast("Selecteer eerst een expeditie met route.");return;}
    stopAnimation();
    const points=item.route.map((p)=>L.latLng(p.lat,p.lng));
    map.fitBounds(L.latLngBounds(points),{padding:[65,65],maxZoom:8,animate:true});
    const routeLine=L.polyline([points[0]],{color:"#c9f276",weight:5,opacity:1,lineCap:"round"}).addTo(animationLayer);
    const head=L.circleMarker(points[0],{color:"#fff",fillColor:"#c9f276",fillOpacity:1,radius:8,weight:3}).addTo(animationLayer);
    previousLine=routeLine;
    const cumulative=[0];
    for (let i=1;i<points.length;i++) cumulative.push(cumulative[i-1]+map.distance(points[i-1],points[i]));
    const total=cumulative.at(-1) || 1;
    const duration=Math.max(4500,Math.min(11500,points.length*22));
    let start=null;
    const frame=(time)=>{
      if(start===null)start=time;
      const traveled=Math.min(1,(time-start)/duration)*total;
      let i=1;
      while(i<cumulative.length-1 && cumulative[i]<traveled)i++;
      const before=cumulative[i-1],after=cumulative[i],fraction=(traveled-before)/Math.max(after-before,.00001);
      const tip=L.latLng(points[i-1].lat+(points[i].lat-points[i-1].lat)*fraction,points[i-1].lng+(points[i].lng-points[i-1].lng)*fraction);
      routeLine.setLatLngs([...points.slice(0,i),tip]);
      head.setLatLng(tip);
      if(traveled<total)animationFrame=requestAnimationFrame(frame);
      else animationFrame=null;
    };
    animationFrame=requestAnimationFrame(frame);
  }

  function enterCinema() {
    document.body.classList.add("cinema");
    $("cinemaOverlay").hidden=false;
    const item=current().find((x)=>x.id===selectedId);
    if (!item) {
      $("cinemaTitle").textContent="Explore the unknown";
      $("cinemaSubtitle").textContent="Your world. Your story.";
      $("cinemaEyebrow").textContent="THE JOURNEY";
      $("routeNotice").textContent="Selecteer een expeditie voor een route-animatie.";
      $("playRoute").disabled=true;
    }
    setTimeout(()=>map.invalidateSize(),150);
  }
  function exitCinema() {
    stopAnimation();document.body.classList.remove("cinema","vertical","clean-text");
    $("cinemaOverlay").hidden=true;$("formatBtn").textContent="▯ 9:16";$("hideOverlay").textContent="◉ Tekst verbergen";
    setTimeout(()=>map.invalidateSize(),150);
  }

  function bind() {
    document.querySelectorAll("[data-filter]").forEach((button)=>button.addEventListener("click",()=>selectFilter(button.dataset.filter)));
    $("searchInput").addEventListener("input",paint);
    $("fitAll").addEventListener("click",fitAll);
    $("newAdventure").addEventListener("click",()=>openAdd());
    $("adventureForm").addEventListener("submit",addAdventure);
    $("cancelDialog").addEventListener("click",()=>$("addDialog").close());
    $("cancelDialogTop").addEventListener("click",()=>$("addDialog").close());
    $("pickLocation").addEventListener("click",()=>{
      picking=true;$("addDialog").close();document.body.classList.remove("nav-open");
      $("mapHint").textContent="Klik op een plek op de wereldkaart om coördinaten te kiezen.";
      toast("Klik op de kaart om je locatie te kiezen.");
    });
    $("closeStory").addEventListener("click",()=>{selectedId=null;$("storyPanel").hidden=true;paint();});
    $("editStory").addEventListener("click",()=>{const item=current().find((x)=>x.id===selectedId);if(item)openAdd(item);});
    $("deleteStory").addEventListener("click",deleteAdventure);
    $("showOnMap").addEventListener("click",()=>{
      const item=current().find((x)=>x.id===selectedId);if(item)focusItem(item);
    });
    $("openNav").addEventListener("click",()=>document.body.classList.add("nav-open"));
    $("closeNav").addEventListener("click",()=>document.body.classList.remove("nav-open"));
    $("exportPublic").addEventListener("click",()=>exportData(true));
    $("backupAll").addEventListener("click",()=>exportData(false));
    $("importDataBtn").addEventListener("click",()=>$("importData").click());
    $("importGpxBtn").addEventListener("click",()=>$("importGpx").click());
    $("importData").addEventListener("change",(e)=>importJSON(e.target.files[0]));
    $("importGpx").addEventListener("change",(e)=>importGPX(e.target.files[0]));
    $("cinemaBtn").addEventListener("click",enterCinema);
    $("exitCinema").addEventListener("click",exitCinema);
    $("playRoute").addEventListener("click",playRoute);
    $("formatBtn").addEventListener("click",()=>{
      const vertical=document.body.classList.toggle("vertical");
      $("formatBtn").textContent=vertical?"▣ 16:9":"▯ 9:16";
      setTimeout(()=>map.invalidateSize(),120);
    });
    $("hideOverlay").addEventListener("click",()=>{
      const hidden=document.body.classList.toggle("clean-text");
      $("hideOverlay").textContent=hidden?"◉ Tekst tonen":"◉ Tekst verbergen";
    });
    document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&document.body.classList.contains("cinema"))exitCinema();});
  }

  async function init() {
    readDrafts();
    bind();
    try {buildMap();}
    catch(error) {$("mapHint").textContent=error.message;toast(error.message);return;}
    try {
      const response=await fetch("./data/adventures.json",{cache:"no-store"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const data=await response.json();
      if(!Array.isArray(data.adventures))throw new Error("Ongeldig dataformaat.");
      seed=data.adventures.map(normalizeItem).filter((x)=>x && x.visibility==="public");
    } catch(error) { toast("Voorbeelddata niet geladen. Open deze site via een webserver. "+error.message); }
    paint();fitAll();
  }
  document.addEventListener("DOMContentLoaded",init);
})();
