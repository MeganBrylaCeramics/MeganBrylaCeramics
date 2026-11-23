// New York wetland map.
//
// Data sources (tested against the live services):
//   U.S. Fish & Wildlife Service, National Wetlands Inventory ... every mapped wetland, by type
//   NYS DEC, Freshwater Wetlands ................................ state-regulated wetlands (ID, class, acres)
//   NYS DEC, Informational Freshwater Wetland Mapping ........... wetlands flagged under the 2022 law
//   USDA NRCS Soil Data Access .................................. hydric soils
//   USGS ........................................................ streams and rivers
(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u; } };
  const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
  async function get(u, opts) {
    let r;
    try { r = await fetch(u, opts); } catch (e) { if (e.name === "AbortError") throw e; throw new Error("Couldn't reach " + hostOf(u)); }
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${hostOf(u)}`);
    const j = await r.json();
    if (j && j.error) throw new Error((j.error.message || "Service error") + " from " + hostOf(u));
    return j;
  }
  const fmt = (n) => Math.round(n).toLocaleString();
  const acres = (n) => (n >= 10 ? fmt(n) : n >= 1 ? n.toFixed(1) : n.toFixed(2)) + (n >= 0.995 && n < 1.05 ? " acre" : " acres");

  const NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer";
  const DEC = "https://gisservices.dec.ny.gov/arcgis/rest/services/Wetlands/MapServer";
  const INFO = "https://gisservices.dec.ny.gov/arcgis/rest/services/erm/informational_freshwater_wetlands/MapServer";
  const SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
  const sda = (query, signal) => get(SDA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "JSON", query }), signal });

  const [SHOP, COUNTIES] = await Promise.all([get("store.json").catch(() => ({})), get("content/ny-counties.json").catch(() => null)]);
  if (SHOP.name) document.title = "New York Wetland Map | " + SHOP.name;
  if (SHOP.shopOpen) document.querySelectorAll("[data-shop-nav]").forEach((a) => (a.hidden = false));

  // ---------- Map ----------
  const NY = L.latLngBounds([40.45, -79.8], [45.05, -71.8]);
  const hp = new URLSearchParams(location.hash.replace(/^#/, ""));
  const map = L.map("map", { maxBounds: NY.pad(0.4), minZoom: 6 });
  const hl = parseFloat(hp.get("lat")), hg = parseFloat(hp.get("lng")), hz = parseInt(hp.get("z"), 10);
  if (isFinite(hl) && isFinite(hg)) map.setView([hl, hg], isFinite(hz) ? hz : 13); else map.fitBounds(NY);
  L.control.scale({ imperial: true }).addTo(map);
  [["hydric", 300], ["nwi", 320], ["info", 330], ["dec", 340], ["streams", 350], ["lines", 360], ["hi", 420]].forEach(([n, z]) => { map.createPane(n); map.getPane(n).style.zIndex = z; });
  map.getPane("lines").style.pointerEvents = "none";

  // Full-screen layout and collapsible panel (same pattern as the clay map)
  const app = $("#app"), narrow = () => innerWidth <= 760;
  const fitApp = () => { document.documentElement.style.setProperty("--hdr", ($(".site-header")?.offsetHeight || 65) + "px"); map.invalidateSize(); };
  const padPopups = () => {
    L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(16, 70);
    L.Popup.prototype.options.autoPanPaddingBottomRight = L.point(!narrow() && !app.classList.contains("panel-closed") ? 392 : 16, narrow() ? 150 : 150);
    L.Popup.prototype.options.maxHeight = Math.max(200, Math.min(460, (app.clientHeight || innerHeight) - (narrow() ? 250 : 220)));
  };
  function setPanel(open) { app.classList.toggle("panel-closed", !open); $("#panel-toggle").setAttribute("aria-expanded", String(open)); padPopups(); setTimeout(() => map.invalidateSize(), 280); }
  $("#panel-toggle").addEventListener("click", () => setPanel(true));
  $("#panel-close").addEventListener("click", () => setPanel(false));
  const closeOnPhone = () => { if (narrow()) setPanel(false); };
  if (narrow()) setPanel(false);
  addEventListener("resize", () => { fitApp(); padPopups(); });
  fitApp(); padPopups();

  // Base maps
  const base = {
    topo: L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "USGS The National Map" }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Esri, Maxar, Earthstar" }),
    terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, subdomains: "abc", attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)" }),
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
  };
  let current = base.topo.addTo(map), baseErrors = 0;
  function useBase(k) { baseErrors = 0; map.removeLayer(current); current = base[k].addTo(map); current.bringToBack(); $("#basemap").value = k; }
  $("#basemap").addEventListener("change", (e) => { $("#basemap-note").textContent = ""; useBase(e.target.value); });
  Object.entries(base).forEach(([k, layer]) => layer.on("tileerror", () => {
    if (current === layer && k !== "osm" && ++baseErrors === 6) { useBase("osm"); $("#basemap-note").textContent = "That base map didn't load, so I switched to the street map."; }
  }));

  // ArcGIS map services drawn as map tiles (the services render the wetlands themselves).
  const R = 20037508.342789244;
  const ExportTiles = L.TileLayer.extend({
    getTileUrl(c) {
      const size = (2 * R) / Math.pow(2, c.z), xmin = -R + c.x * size, ymax = R - c.y * size;
      return `${this._url}/export?bbox=${xmin},${ymax - size},${xmin + size},${ymax}&bboxSR=3857&imageSR=3857&size=512,512&dpi=192&format=png32&transparent=true&f=image`;
    },
  });
  const tileErrors = (layer, statusSel) => {
    let n = 0;
    layer.on("loading", () => { n = 0; });
    layer.on("tileerror", () => { if (++n === 4) { $(statusSel).className = "status err"; $(statusSel).textContent = "didn't load"; } });
    layer.on("load", () => { if (!n && $(statusSel).classList.contains("err")) { $(statusSel).className = "status"; $(statusSel).textContent = ""; } });
  };
  const opacity = () => Number($("#opacity").value) / 100;
  const nwiTiles = new ExportTiles(NWI, { pane: "nwi", minZoom: 11, maxZoom: 19, opacity: opacity(), attribution: "U.S. Fish & Wildlife Service NWI" });
  const decTiles = new ExportTiles(DEC, { pane: "dec", maxZoom: 19, opacity: opacity(), attribution: "NYS DEC" });
  const infoTiles = new ExportTiles(INFO, { pane: "info", minZoom: 12, maxZoom: 19, opacity: opacity(), attribution: "NYS DEC" });
  const streamTiles = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}", { pane: "streams", maxZoom: 16, attribution: "USGS" });
  tileErrors(nwiTiles, "#nwi-status"); tileErrors(decTiles, "#dec-status"); tileErrors(infoTiles, "#info-status"); tileErrors(streamTiles, "#streams-status");
  nwiTiles.addTo(map); decTiles.addTo(map);
  const toggle = (id, layer, after) => $(id).addEventListener("change", (e) => { e.target.checked ? layer.addTo(map) : map.removeLayer(layer); updateHint(); after && after(); });
  toggle("#lyr-nwi", nwiTiles, () => refreshView());
  toggle("#lyr-dec", decTiles, () => refreshView());
  toggle("#lyr-info", infoTiles);
  toggle("#lyr-streams", streamTiles);
  $("#opacity").addEventListener("input", () => [nwiTiles, decTiles, infoTiles].forEach((l) => l.setOpacity(opacity())));

  const countyLines = COUNTIES ? L.geoJSON(COUNTIES, { pane: "lines", interactive: false, style: { color: "#33424b", weight: 1, opacity: 0.45, fill: false, dashArray: "4 4" } }).addTo(map) : null;
  if (countyLines) toggle("#lyr-counties", countyLines);

  // ---------- Legend (exact symbols from the services) ----------
  const NWI_COLORS = {
    "Freshwater Emergent Wetland": "#7fc319", "Freshwater Forested/Shrub Wetland": "#008737", "Freshwater Pond": "#678bc0", "Lake": "#12007c",
    "Riverine": "#008fbf", "Estuarine and Marine Wetland": "#66c2a5", "Estuarine and Marine Deepwater": "#007c87", "Other": "#b38753",
  };
  const NWI_SHORT = {
    "Freshwater Emergent Wetland": "Emergent marsh", "Freshwater Forested/Shrub Wetland": "Forested / shrub swamp", "Freshwater Pond": "Pond", "Lake": "Lake",
    "Riverine": "River / stream", "Estuarine and Marine Wetland": "Tidal wetland", "Estuarine and Marine Deepwater": "Tidal deepwater", "Other": "Other",
  };
  get(`${NWI}/legend?f=json`).then((d) => {
    $("#nwi-legend").innerHTML = d.layers[0].legend.map((x) => `<li><img alt="" src="data:${x.contentType};base64,${x.imageData}">${esc(x.label)}</li>`).join("");
  }).catch(() => {
    $("#nwi-legend").innerHTML = Object.entries(NWI_COLORS).map(([k, c]) => `<li><i style="background:${c}"></i>${esc(k)}</li>`).join("");
  });

  // ---------- Hydric soils (USDA) ----------
  const HYDRIC = [[100, "#7a3e0b", "All hydric"], [66, "#b8621b", "Mostly hydric"], [33, "#e39a4f", "Partly hydric"], [1, "#f6d3a8", "Minor hydric inclusions"]];
  const hydricClass = (p) => (p == null || p <= 0 ? null : HYDRIC.find(([min]) => p >= min));
  const canvasHydric = L.canvas({ pane: "hydric", padding: 0.2 });
  const hydricLayer = L.layerGroup();
  let hydricBounds = null, hydricAbort = null;
  function parseWKT(w) {
    const i = w.indexOf("("); if (i < 0) return [];
    const type = w.slice(0, i).trim().toUpperCase(), body = w.slice(i).trim();
    const ringsOf = (s) => s.split(/\)\s*,\s*\(/).map((r) => r.replace(/[()]/g, "").split(",").map((p) => { const [x, y] = p.trim().split(/\s+/).map(Number); return [y, x]; }));
    if (type === "POLYGON") return [ringsOf(body.slice(1, -1))];
    if (type === "MULTIPOLYGON") return body.slice(2, -2).split(/\)\)\s*,\s*\(\(/).map(ringsOf);
    return [];
  }
  async function loadHydric() {
    const st = $("#hydric-status");
    if (!$("#lyr-hydric").checked) { if (hydricAbort) hydricAbort.abort(); hydricLayer.clearLayers(); map.removeLayer(hydricLayer); hydricBounds = null; st.textContent = ""; return; }
    hydricLayer.addTo(map);
    if (map.getZoom() < 13) { st.className = "status"; st.textContent = "zoom in to see them"; return; }
    if (hydricBounds && hydricBounds.contains(map.getBounds())) return;
    const b = map.getBounds().pad(0.25);
    if (hydricAbort) hydricAbort.abort();
    const ctrl = hydricAbort = new AbortController();
    const tol = map.getZoom() >= 15 ? 0.00003 : map.getZoom() >= 14 ? 0.00005 : 0.00008;
    const W = b.getWest().toFixed(5), E = b.getEast().toFixed(5), S = b.getSouth().toFixed(5), N = b.getNorth().toFixed(5);
    st.className = "status"; st.textContent = "loading…";
    try {
      const d = await sda(`SELECT TOP 4000 M.muname, A.hydclprs, A.drclassdcd, P.mupolygongeo.Reduce(${tol}).STAsText() AS wkt
        FROM mupolygon P INNER JOIN mapunit M ON M.mukey = P.mukey INNER JOIN muaggatt A ON A.mukey = P.mukey
        WHERE A.hydclprs > 0 AND P.mupolygonkey IN (SELECT * FROM SDA_Get_Mupolygonkey_from_intersection_with_WktWgs84('POLYGON((${W} ${S}, ${E} ${S}, ${E} ${N}, ${W} ${N}, ${W} ${S}))'))`, ctrl.signal);
      if (ctrl !== hydricAbort) return;
      hydricLayer.clearLayers();
      let n = 0;
      (d.Table || []).forEach(([name, pct, drain, wkt]) => {
        const polys = parseWKT(wkt || ""), hc = hydricClass(Number(pct)); if (!polys.length || !hc) return;
        L.polygon(polys, { renderer: canvasHydric, pane: "hydric", color: hc[1], weight: 0.5, opacity: 0.8, fillColor: hc[1], fillOpacity: 0.5, interactive: false }).addTo(hydricLayer);
        n++;
      });
      hydricBounds = b; st.className = "status ok"; st.textContent = `${n} hydric soil areas`;
    } catch (err) {
      if (err.name === "AbortError") return;
      st.className = "status err"; st.textContent = "soil survey didn't answer; move the map to retry"; hydricBounds = null;
    }
  }
  $("#lyr-hydric").addEventListener("change", () => { hydricBounds = null; loadHydric(); updateHint(); });

  // ---------- "In this view" summary and DEC list ----------
  const arcQuery = (svc, params, signal) => get(`${svc}/0/query?` + new URLSearchParams({ f: "json", ...params }), { signal });
  const envelope = (b) => ({ geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => x.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects" });
  let viewAbort = null;
  async function refreshView() {
    const card = $("#view-card"), z = map.getZoom();
    if (viewAbort) viewAbort.abort();
    const ctrl = viewAbort = new AbortController();
    if (z < 11 || !$("#lyr-nwi").checked) {
      $("#vc-note").textContent = "";
      $("#type-bar").innerHTML = "";
      $("#vc-stats").innerHTML = z < 11
        ? `<p class="tiny">Zoom in to a town or valley to see every wetland and count them. Statewide, the pink areas are wetlands on NYS DEC's state maps.</p>`
        : `<p class="tiny">Turn on "All wetlands" to count them.</p>`;
      loadDecList(ctrl); return;
    }
    $("#vc-note").textContent = "counting…";
    try {
      const env = envelope(map.getBounds());
      const [stats, decCount] = await Promise.all([
        arcQuery(NWI, { where: "1=1", ...env, outStatistics: JSON.stringify([{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }]), groupByFieldsForStatistics: "WETLAND_TYPE" }, ctrl.signal),
        $("#lyr-dec").checked ? arcQuery(DEC, { where: "1=1", ...env, returnCountOnly: true }, ctrl.signal).catch(() => null) : null,
      ]);
      if (ctrl !== viewAbort) return;
      const rows = (stats.features || []).map((f) => ({ type: f.attributes.WETLAND_TYPE, n: f.attributes.n })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
      const total = rows.reduce((t, r) => t + r.n, 0);
      $("#vc-note").textContent = total ? `${fmt(total)} mapped wetlands and waters` : "";
      $("#type-bar").innerHTML = rows.map((r) => `<span title="${esc(r.type)}: ${fmt(r.n)}" style="width:${(r.n / total) * 100}%;background:${NWI_COLORS[r.type] || "#999"}"></span>`).join("");
      $("#vc-stats").innerHTML = (total ? `<ul>${rows.slice(0, 5).map((r) => `<li><i style="background:${NWI_COLORS[r.type] || "#999"}"></i>${esc(NWI_SHORT[r.type] || r.type)} <b>${fmt(r.n)}</b></li>`).join("")}</ul>` : `<p class="tiny">No inventory wetlands mapped in this view.</p>`) +
        (decCount && decCount.count != null ? `<p class="tiny dec-line"><i class="sw-dec"></i>${fmt(decCount.count)} NYS DEC mapped wetland${decCount.count === 1 ? "" : "s"} in view</p>` : "");
    } catch (err) {
      if (err.name === "AbortError") return;
      $("#vc-note").textContent = ""; $("#type-bar").innerHTML = "";
      $("#vc-stats").innerHTML = `<p class="tiny">The wetland inventory didn't answer. Move the map to try again.</p>`;
    }
    loadDecList(ctrl);
  }
  let decFeatures = [], decHighlight = null;
  async function loadDecList(ctrl) {
    const list = $("#dec-list");
    if (!$("#lyr-dec").checked) { $("#dec-count").textContent = ""; list.innerHTML = `<li class="tiny muted">Turn on "NYS DEC previously mapped wetlands" to list them.</li>`; return; }
    if (map.getZoom() < 11) { $("#dec-count").textContent = ""; list.innerHTML = `<li class="tiny muted">Zoom in to list the DEC-mapped wetlands in view.</li>`; return; }
    try {
      const d = await get(`${DEC}/0/query?` + new URLSearchParams({ where: "1=1", ...envelope(map.getBounds()), outFields: "WETID,CLASS,WETL_ACRES,COUNTY", orderByFields: "WETL_ACRES DESC", resultRecordCount: 40, returnGeometry: true, maxAllowableOffset: 0.0005, outSR: 4326, f: "geojson" }), { signal: ctrl.signal });
      if (ctrl !== viewAbort) return;
      decFeatures = d.features || [];
      $("#dec-count").textContent = decFeatures.length ? `(${decFeatures.length}${decFeatures.length === 40 ? "+" : ""})` : "";
      list.innerHTML = decFeatures.length ? decFeatures.map((f, i) => {
        const p = f.properties;
        return `<li><button data-d="${i}"><span class="row"><span class="dot dec-dot"></span><strong>${esc(p.WETID)}</strong></span><span class="state">Class ${esc(p.CLASS)} · ${fmt(p.WETL_ACRES)} acres · ${esc(titleCase(p.COUNTY))} County</span></button></li>`;
      }).join("") : `<li class="tiny muted">No DEC-mapped wetlands in this view.</li>`;
    } catch (err) {
      if (err.name === "AbortError") return;
      list.innerHTML = `<li class="tiny muted">NYS DEC didn't answer. Move the map to try again.</li>`;
    }
  }
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  $("#dec-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    const f = decFeatures[b.dataset.d]; if (!f) return;
    if (decHighlight) map.removeLayer(decHighlight);
    decHighlight = L.geoJSON(f, { pane: "hi", interactive: false, style: { color: "#ff6a00", weight: 3, fill: false } }).addTo(map);
    closeOnPhone();
    map.fitBounds(decHighlight.getBounds(), { maxZoom: 16, padding: [30, 30] });
    const c = decHighlight.getBounds().getCenter(); identify(c.lat, c.lng);
  });

  // ---------- Tap anywhere: what's here? ----------
  const SYS = { M: "Marine", E: "Estuarine", R: "Riverine", L: "Lacustrine (lake)", P: "Palustrine (marsh, swamp, bog or pond)" };
  const SUB = {
    M: { 1: "subtidal", 2: "intertidal" }, E: { 1: "subtidal", 2: "intertidal" },
    R: { 1: "tidal", 2: "lower perennial (slow, year-round)", 3: "upper perennial (fast, year-round)", 4: "intermittent", 5: "unknown perennial" },
    L: { 1: "limnetic (open deep water)", 2: "littoral (shallow edge)" },
  };
  const CLS = { RB: "rock bottom", UB: "open water, soft bottom", AB: "aquatic plant bed", RS: "rocky shore", US: "unvegetated shore (mud, sand)", SB: "streambed", EM: "emergent marsh (cattails, sedges, grasses)", SS: "scrub-shrub (alder, willow, dogwood)", FO: "forested swamp", ML: "moss or lichen", RF: "reef" };
  const SUBCLS = { EM: { 1: "persistent", 2: "nonpersistent", 5: "phragmites" }, SS: { 1: "broad-leaved deciduous", 2: "needle-leaved deciduous", 3: "broad-leaved evergreen", 4: "needle-leaved evergreen", 5: "dead", 6: "deciduous", 7: "evergreen" } };
  SUBCLS.FO = SUBCLS.SS;
  const REGIME = {
    A: "temporarily flooded", B: "saturated (seldom flooded)", C: "seasonally flooded", D: "continuously saturated", E: "seasonally flooded or saturated", F: "semi-permanently flooded",
    G: "intermittently exposed", H: "permanently flooded", J: "intermittently flooded", K: "artificially flooded",
    L: "subtidal", M: "irregularly exposed (tidal)", N: "regularly flooded (tidal)", P: "irregularly flooded (tidal)", R: "seasonally flooded, tidal fresh", S: "temporarily flooded, tidal fresh", T: "semi-permanently flooded, tidal fresh", V: "permanently flooded, tidal fresh",
  };
  const MODS = { b: "beaver-made", d: "partly drained or ditched", f: "farmed", h: "diked or impounded", r: "artificial substrate", s: "spoil", x: "excavated" };
  function decode(code) {
    const s = String(code || "").trim(); if (!s) return null;
    let i = 0; const out = [];
    const sys = s[i++]; if (!SYS[sys]) return null;
    let line = SYS[sys];
    if (/\d/.test(s[i] || "")) { const sub = SUB[sys] && SUB[sys][s[i]]; if (sub) line += ", " + sub; i++; }
    out.push(["System", line]);
    const classes = [];
    while (i < s.length && /[A-Z]{2}/.test(s.slice(i, i + 2)) && CLS[s.slice(i, i + 2)]) {
      const c = s.slice(i, i + 2); i += 2;
      let txt = CLS[c];
      if (/\d/.test(s[i] || "")) { const sc = SUBCLS[c] && SUBCLS[c][s[i]]; if (sc) txt += ` (${sc})`; i++; }
      classes.push(txt);
      if (s[i] === "/") i++;
    }
    if (classes.length) out.push(["Type", classes.join(", mixed with ")]);
    if (REGIME[s[i]]) { out.push(["Water", REGIME[s[i]]]); i++; }
    const mods = s.slice(i).split("").map((m) => MODS[m]).filter(Boolean);
    if (mods.length) out.push(["Modified", mods.join(", ")]);
    return out;
  }
  const countyAt = (lat, lng) => {
    if (!COUNTIES) return null;
    const inRing = (x, y, r) => { let o = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xi, yi] = r[a], [xj, yj] = r[b]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o; } return o; };
    const f = COUNTIES.features.find((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).some((p) => inRing(lng, lat, p[0])));
    return f ? f.properties.name : null;
  };
  let pin = null, idToken = 0;
  async function identify(lat, lng) {
    const token = ++idToken;
    if (pin) map.removeLayer(pin);
    pin = L.circleMarker([lat, lng], { pane: "hi", radius: 7, color: "#fff", weight: 3, fillColor: "#ff6a00", fillOpacity: 1 }).addTo(map);
    const county = countyAt(lat, lng);
    const head = `<span class="tag">What's here</span><h3>${county ? esc(county) + " County" : "This spot"}</h3><div class="small">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
    const popup = L.popup({ maxWidth: 340 }).setLatLng([lat, lng]).setContent(head + `<p class="small">Checking the wetland inventory, NYS DEC maps and soil survey…</p>`).openOn(map);
    const pt = { geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: 4326, spatialRel: "esriSpatialRelIntersects", returnGeometry: false };
    const [nwi, dec, info, soil] = await Promise.all([
      arcQuery(NWI, { ...pt, outFields: "ATTRIBUTE,WETLAND_TYPE,ACRES" }).catch(() => "err"),
      arcQuery(DEC, { ...pt, outFields: "WETID,CLASS,WETL_ACRES,COUNTY" }).catch(() => "err"),
      arcQuery(INFO, { ...pt, returnCountOnly: true }).catch(() => "err"),
      sda(`SELECT TOP 1 mu.muname, A.hydclprs, A.drclassdcd FROM mapunit mu INNER JOIN muaggatt A ON A.mukey = mu.mukey
           WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng.toFixed(6)} ${lat.toFixed(6)})'))`).catch(() => "err"),
    ]);
    if (token !== idToken) return;
    let html = head;
    // National Wetlands Inventory
    html += `<p class="sub">Wetland inventory (U.S. Fish &amp; Wildlife)</p>`;
    if (nwi === "err") html += `<p class="small">The inventory didn't answer. Tap again in a moment.</p>`;
    else if (!nwi.features || !nwi.features.length) html += `<p class="small">No mapped wetland at this exact spot. Small or recently changed wetlands are often missing from the inventory.</p>`;
    else nwi.features.slice(0, 2).forEach((f) => {
      const a = f.attributes, lines = decode(a.ATTRIBUTE) || [];
      html += `<div class="cond"><span class="dot" style="background:${NWI_COLORS[a.WETLAND_TYPE] || "#999"}"></span>${esc(a.WETLAND_TYPE)}</div>
        <dl class="facts"><dt>Code</dt><dd><code>${esc(a.ATTRIBUTE)}</code></dd>${lines.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}<dt>Size</dt><dd>${acres(a.ACRES)}</dd></dl>`;
    });
    // NYS DEC
    html += `<p class="sub">New York State (NYS DEC)</p>`;
    if (dec === "err") html += `<p class="small">NYS DEC didn't answer. Tap again in a moment.</p>`;
    else if (dec.features && dec.features.length) {
      const a = dec.features[0].attributes;
      html += `<div class="cond"><span class="dot dec-dot"></span>DEC-mapped wetland ${esc(a.WETID)}</div><dl class="facts"><dt>Class</dt><dd>${esc(a.CLASS)} (1 is most significant)</dd><dt>Size</dt><dd>${acres(a.WETL_ACRES)}</dd></dl>
        <p class="small">Work in a protected wetland or its adjacent area (usually 100 feet) generally needs a DEC permit.</p>`;
    } else html += `<p class="small">Not inside a wetland on DEC's previous maps. Since 2025, wetlands over 12.4 acres are protected even if unmapped.</p>`;
    if (info !== "err" && info && info.count > 0) html += `<div class="cond"><span class="dot info-dot"></span>On DEC's informational wetland map</div><p class="small">DEC's informational mapping of wetlands that may be protected under the current law. Ask DEC for a jurisdictional determination before any work.</p>`;
    // Soil
    html += `<p class="sub">Soil (USDA)</p>`;
    if (soil === "err") html += `<p class="small">The soil survey didn't answer.</p>`;
    else if (!soil.Table || !soil.Table.length) html += `<p class="small">No soil survey data here.</p>`;
    else {
      const [name, pct, drain] = soil.Table[0], p = Number(pct), hc = hydricClass(p);
      const inWet = nwi !== "err" && nwi.features && nwi.features.length;
      html += `<dl class="facts"><dt>Soil</dt><dd>${esc(name)}</dd>${drain ? `<dt>Drainage</dt><dd>${esc(drain)}</dd>` : ""}<dt>Hydric</dt><dd>${isFinite(p) ? p + "% of the soil" : "unknown"}${hc ? " · " + hc[2].toLowerCase() : ""}</dd></dl>`;
      if (hc && p >= 66 && !inWet) html += `<p class="small"><b>Possible former wetland.</b> This soil formed under wetland conditions, but no wetland is mapped here. Land like this, often drained for farming, is where wetland restoration usually happens.</p>`;
      else if (hc && p >= 66) html += `<p class="small">Hydric soil, consistent with the mapped wetland.</p>`;
    }
    html += `<div class="popup-actions"><a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Directions</a><button type="button" data-act="share" data-lat="${lat}" data-lng="${lng}">Copy link</button></div>
      <p class="small">Maps are a guide, not a legal boundary. Contact NYS DEC before any work in or near a wetland.</p>`;
    if (popup.isOpen()) popup.setContent(html);
  }
  map.on("click", (ev) => identify(ev.latlng.lat, ev.latlng.lng));
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".leaflet-popup [data-act=share]"); if (!b) return;
    const url = `${location.origin}${location.pathname}#lat=${(+b.dataset.lat).toFixed(5)}&lng=${(+b.dataset.lng).toFixed(5)}&z=${map.getZoom()}&pin=1`;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => (b.textContent = "Link copied"), () => prompt("Copy this link:", url)); else prompt("Copy this link:", url);
  });

  // ---------- Search and location ----------
  $("#search-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = $("#search").value.trim(), box = $("#results"); if (!q) return;
    box.hidden = false; box.innerHTML = `<li class="tiny muted pad">Searching…</li>`;
    try {
      const data = await get("https://geocoding-api.open-meteo.com/v1/search?count=20&language=en&countryCode=US&name=" + encodeURIComponent(q));
      const hits = (data.results || []).filter((r) => r.admin1 === "New York").slice(0, 6);
      if (!hits.length) { box.innerHTML = `<li class="tiny muted pad">No New York place found for “${esc(q)}”.</li>`; return; }
      box.innerHTML = hits.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}${r.admin2 ? ", " + esc(r.admin2.replace(/ County$/, "")) + " County" : ""}</button></li>`).join("");
      box.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const r = hits[b.dataset.i]; box.hidden = true; map.setView([r.latitude, r.longitude], 14); };
    } catch (err) { box.innerHTML = `<li class="tiny muted pad">Search didn't answer. Try again in a moment.</li>`; }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".finder")) $("#results").hidden = true; });
  $("#locate").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => { map.setView([p.coords.latitude, p.coords.longitude], 15); identify(p.coords.latitude, p.coords.longitude); });
  });

  // ---------- Hints, hash, events ----------
  function updateHint() {
    const z = map.getZoom(), parts = [];
    if ($("#lyr-nwi").checked && z < 11) parts.push("every wetland");
    if ($("#lyr-hydric").checked && z < 13) parts.push("hydric soils");
    if ($("#lyr-info").checked && z < 12) parts.push("informational wetlands");
    const h = $("#zoom-hint"); h.textContent = parts.length ? `Zoom in to see ${parts.join(", ")}` : ""; h.classList.toggle("show", !!parts.length);
  }
  let moveTimer;
  map.on("moveend", () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      updateHint(); refreshView(); loadHydric();
      const c = map.getCenter(); safe(() => history.replaceState(null, "", `#lat=${c.lat.toFixed(5)}&lng=${c.lng.toFixed(5)}&z=${map.getZoom()}`));
    }, 350);
  });
  updateHint(); refreshView();
  if (hp.get("pin") && isFinite(hl) && isFinite(hg)) identify(hl, hg);
})();
