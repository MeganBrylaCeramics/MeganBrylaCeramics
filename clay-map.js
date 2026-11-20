// New York clay soil map.
//
// Data sources (all tested against the live services):
//   USDA NRCS Soil Data Access .... soil polygons with clay %, and point lookups
//   USGS National Hydrography ..... streams, rivers, lakes and ponds
//   USGS MRDS (bundled file) ...... 124 documented New York clay pits and records
//   Open-Meteo .................... soil temperature, moisture, snow and rain (one request per visit, cached)
//   My own climate model .......... typical conditions for any date when live weather isn't available
(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u; } };
  const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "#");
  const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
  async function get(u, opts) {
    let r;
    try { r = await fetch(u, opts); } catch (e) { if (e.name === "AbortError") throw e; throw new Error("Couldn't reach " + hostOf(u)); }
    if (!r.ok) {
      let reason = ""; try { reason = (await r.json()).reason || ""; } catch (e) {}
      throw new Error(`HTTP ${r.status} from ${hostOf(u)}${reason ? ": " + reason : ""}`);
    }
    return r.json();
  }
  const SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
  const sda = (query, signal) => get(SDA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "JSON", query }), signal });

  // ---------- Content ----------
  const load = (u, fallback) => get(u).catch(() => fallback);
  const [SHOP, sitesFile, COUNTIES, COMMUNITY, usgsFile] = await Promise.all([
    load("store.json", {}), load("content/clay-sites.json", { sites: [] }), load("content/ny-counties.json", null),
    load("content/clay-community.json", { groups: [], guides: [], rules: [] }), load("content/usgs-clay-sites.json", { sites: [] }),
  ]);
  const SITES = sitesFile.sites || [], USGS = usgsFile.sites || [];
  if (SHOP.name) document.title = "New York Clay Soil Map | " + SHOP.name;
  $("#suggest").href = "mailto:" + (SHOP.contactEmail || "") + "?subject=" + encodeURIComponent("Clay map suggestion");
  if (SHOP.shopOpen) document.querySelectorAll("[data-shop-nav]").forEach((a) => (a.hidden = false));

  // ---------- Dates ----------
  // Live weather covers a month back and two weeks ahead; the slider covers half a year either way using the model.
  const LIVE_PAST = 31, LIVE_FUTURE = 15, RANGE = 182;
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const shift = (s, n) => iso(addDays(parse(s), n));
  const pretty = (s) => parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const weekday = (s) => parse(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const TODAY = iso(new Date()), MIN = shift(TODAY, -RANGE), MAX = shift(TODAY, RANGE);
  const LIVE_MIN = shift(TODAY, -LIVE_PAST), LIVE_MAX = shift(TODAY, LIVE_FUTURE);
  const ALL_DAYS = Array.from({ length: RANGE * 2 + 1 }, (_, i) => shift(TODAY, i - RANGE));
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  let date = /^\d{4}-\d{2}-\d{2}$/.test(hashParams.get("d") || "") && hashParams.get("d") >= MIN && hashParams.get("d") <= MAX ? hashParams.get("d") : TODAY;

  const dateInput = $("#date"), slider = $("#slider");
  dateInput.min = MIN; dateInput.max = MAX; slider.min = -RANGE; slider.max = RANGE;
  $("#min-label").textContent = pretty(MIN); $("#max-label").textContent = pretty(MAX);
  $("#live-label").textContent = `Live weather: ${pretty(LIVE_MIN)} to ${pretty(LIVE_MAX)}`;
  $("#tl-min").textContent = pretty(MIN); $("#tl-max").textContent = pretty(MAX);

  // ---------- Map, panes and base maps ----------
  const NY = L.latLngBounds([40.45, -79.8], [45.05, -71.8]);
  const map = L.map("map", { maxBounds: NY.pad(0.4), minZoom: 6 }).fitBounds(NY);
  L.control.scale({ imperial: true }).addTo(map);
  [["counties", 250], ["soil", 300], ["hydro", 330], ["water", 420]].forEach(([n, z]) => { map.createPane(n); map.getPane(n).style.zIndex = z; });
  const canvasSoil = L.canvas({ pane: "soil", padding: 0.2 });
  const base = {
    terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, subdomains: "abc", attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)" }),
    topo: L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "USGS The National Map" }),
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Esri, Maxar, Earthstar" }),
  };
  let current = base.terrain.addTo(map), baseErrors = 0;
  function useBase(k) { baseErrors = 0; map.removeLayer(current); current = base[k].addTo(map); current.bringToBack(); $("#basemap").value = k; }
  $("#basemap").addEventListener("change", (e) => { $("#basemap-note").textContent = ""; useBase(e.target.value); });
  Object.entries(base).forEach(([k, layer]) => layer.on("tileerror", () => {
    if (current === layer && k !== "osm" && ++baseErrors === 6) { useBase("osm"); $("#basemap-note").textContent = "That base map didn't load, so I switched to the street map."; }
  }));
  const streamTiles = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}", { pane: "hydro", maxZoom: 16, attribution: "USGS National Hydrography" });
  $("#lyr-streams").addEventListener("change", (e) => (e.target.checked ? streamTiles.addTo(map) : map.removeLayer(streamTiles)));

  // ---------- Conditions ----------
  const STATES = {
    good:   { label: "Good for digging", color: "#3a8f60", help: "Soil is thawed and damp but not soggy. Clay is workable." },
    wet:    { label: "Too wet", color: "#2b7cb3", help: "Saturated or recently rained on. Clay is sticky and heavy, and banks can slump." },
    dry:    { label: "Dry and hard", color: "#c9a24a", help: "Dry soil. Clay is hard to dig and breaks into lumps (soak it later to slake)." },
    frozen: { label: "Frozen or snow-covered", color: "#8aa0ad", help: "Ground frozen or under snow. Not diggable." },
  };
  const F = (c) => c * 9 / 5 + 32, C = (f) => (f - 32) * 5 / 9, inch = (mm) => mm / 25.4;
  function classify({ soilT, soilM, snow, rain3, wetIdx }) {
    if ((soilT != null && soilT <= 1) || (snow != null && snow > 0.02)) return "frozen";
    if ((soilM != null && soilM >= 0.40) || (wetIdx != null && wetIdx > 0.68) || rain3 >= 20) return "wet";
    if ((soilM != null && soilM < 0.15 && rain3 < 2) || (wetIdx != null && wetIdx < 0.28)) return "dry";
    return "good";
  }
  // My climate model: typical conditions from latitude, region and day of year.
  const inBox = (lat, lng, a, b, c, d) => lat >= a && lat <= b && lng >= c && lng <= d;
  function modelConditions(lat, lng, day) {
    let Tm = 55.5 - 3.0 * (lat - 40.7), A = 24;
    if (lat < 41.3 && lng > -74.3) { A = 21; Tm += 0.5; }
    const mountains = inBox(lat, lng, 43.3, 44.9, -75.5, -73.4) || inBox(lat, lng, 41.9, 42.4, -75.0, -74.0);
    if (mountains) Tm -= 3;
    const snowBelt = mountains || inBox(lat, lng, 43.3, 44.1, -76.2, -75.0) || inBox(lat, lng, 42.2, 42.9, -79.3, -78.5);
    const d = parse(day), doy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 864e5), r = 2 * Math.PI / 365;
    const air = Tm - A * Math.cos(r * (doy - 20)), soil = Tm - 0.9 * A * Math.cos(r * (doy - 27));
    const wetIdx = 0.52 + 0.26 * Math.cos(r * (doy - 75)) + (snowBelt ? 0.04 : 0);
    const snowy = air < (snowBelt ? 32 : 28);
    const metrics = { soilT: C(soil), wetIdx, tmax: C(air + 8), tmin: C(air - 8), snow: snowy ? 0.05 : 0 };
    const key = soil <= 34 || snowy ? "frozen" : classify({ wetIdx, rain3: 0 });
    return { key, source: "model", metrics };
  }
  // Live data, stored compactly: one entry per day at noon.
  function compact(r) {
    const noon = {}; r.hourly.time.forEach((t, i) => { if (t.endsWith("T12:00")) noon[t.slice(0, 10)] = i; });
    const h = r.hourly, dly = r.daily, days = {};
    dly.time.forEach((d, i) => {
      const k = noon[d];
      days[d] = { t: k != null ? h.soil_temperature_0_to_7cm[k] : null, m: k != null ? h.soil_moisture_0_to_7cm[k] : null, s: k != null ? h.snow_depth[k] : null,
        p: dly.precipitation_sum[i], hi: dly.temperature_2m_max[i], lo: dly.temperature_2m_min[i] };
    });
    return days;
  }
  function liveConditions(days, day) {
    const x = days && days[day];
    if (!x || (x.t == null && x.m == null)) return null;
    const p = (n) => ((days[shift(day, -n)] || {}).p || 0);
    const metrics = { soilT: x.t, soilM: x.m, snow: x.s, rain3: (x.p || 0) + p(1) + p(2), tmax: x.hi, tmin: x.lo };
    return { key: classify(metrics), source: "live", metrics };
  }
  const condFor = (e, day) => liveConditions(wOf(e), day) || modelConditions(e.lat, e.lng, day);

  // ---------- Geometry ----------
  const rings = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  function inRing(x, y, ring) { // ring of [x, y]
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inFeature = (lng, lat, f) => rings(f).some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h)));
  function centroid(f) {
    let best = null, bestArea = -1;
    for (const poly of rings(f)) {
      const r = poly[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const k = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += k; cx += (r[j][0] + r[i][0]) * k; cy += (r[j][1] + r[i][1]) * k; }
      a /= 2; if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cx / (6 * a), cy / (6 * a)]; }
    }
    return { lat: +best[1].toFixed(3), lng: +best[0].toFixed(3) };
  }
  const counties = COUNTIES ? COUNTIES.features.map((f) => ({ f, id: f.id, name: f.properties.name, ...centroid(f) })) : [];
  const countyAt = (lat, lng) => counties.find((c) => inFeature(lng, lat, c.f)) || null;
  const nearestCounty = (lat, lng) => counties.reduce((b, c) => { const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2; return !b || d < b.d ? { c, d } : b; }, null)?.c || null;
  const inNY = (lat, lng) => !counties.length || !!countyAt(lat, lng);

  // ---------- Clay potential: geology estimate, raised where USGS documents clay pits ----------
  const GEO = {
    hudson: [3, "Glacial Lake Albany and Hudson River clay beds, the old brickmaking belt."], hudson2: [2, "Some glacial lake clay along the Hudson and its valleys."],
    champ: [3, "Champlain Sea and glacial lake clays in the valley lowlands."], champ2: [2, "Clay in the valley lowlands; the mountains are mostly thin till and rock."],
    ontario: [3, "Glacial lake plain clays near the Great Lakes."], plain: [2, "Lake-bed and plain clays in the valleys and lowlands."],
    till: [1, "Mostly glacial till and hills. Clay is mainly in valley bottoms and stream banks."], rock: [0, "Mostly bedrock and thin soil. Little clay."],
    li: [2, "Cretaceous clay beds under glacial deposits, often deep or built over."], urban: [1, "Mostly built over. Clay is hard to reach."],
  };
  const COUNTY_GEO = {
    Albany: "hudson", Rensselaer: "hudson", Columbia: "hudson", Greene: "hudson", Ulster: "hudson", Dutchess: "hudson", Rockland: "hudson", Washington: "hudson",
    Orange: "hudson2", Westchester: "hudson2", Saratoga: "hudson2", Schenectady: "hudson2", Putnam: "till",
    Clinton: "champ", "St. Lawrence": "champ", Essex: "champ2", Franklin: "champ2", Jefferson: "plain", Lewis: "till", Warren: "till", Fulton: "till", Hamilton: "rock",
    Niagara: "ontario", Monroe: "ontario", Wayne: "ontario", Orleans: "plain", Oswego: "plain", Cayuga: "plain", Genesee: "plain", Erie: "plain", Chautauqua: "plain",
    Livingston: "plain", Ontario: "plain", Seneca: "plain", Yates: "plain", Onondaga: "plain", Oneida: "plain", Montgomery: "plain", Tompkins: "plain",
    Madison: "till", Herkimer: "till", Wyoming: "till", Allegany: "till", Cattaraugus: "till", Steuben: "till", Chemung: "till", Schuyler: "till", Tioga: "till",
    Broome: "till", Chenango: "till", Cortland: "till", Otsego: "till", Delaware: "till", Sullivan: "till", Schoharie: "till",
    Suffolk: "li", Nassau: "li", Richmond: "li", Queens: "urban", Kings: "urban", Bronx: "urban", "New York": "urban",
  };
  const USGS_BY_COUNTY = {}; USGS.forEach((s) => (USGS_BY_COUNTY[s.county] = (USGS_BY_COUNTY[s.county] || 0) + 1));
  const POT_LABEL = ["Very low", "Low", "Moderate", "High"];
  function potential(countyName) {
    const g = GEO[COUNTY_GEO[countyName]]; if (!g) return null;
    const n = USGS_BY_COUNTY[countyName] || 0;
    return { pot: Math.max(g[0], n >= 5 ? 3 : n >= 1 ? 2 : 0), note: g[1], usgs: n };
  }
  const potHtml = (countyName) => {
    const p = potential(countyName); if (!p) return "";
    return `<p class="sub">${esc(countyName)} County clay potential</p><div class="cond">${POT_LABEL[p.pot]}</div>
      <div class="small">${esc(p.note)}${p.usgs ? ` USGS documents ${p.usgs} clay pit${p.usgs === 1 ? "" : "s"} or record${p.usgs === 1 ? "" : "s"} in this county.` : ""}</div>`;
  };

  // ---------- Soil: classes, point lookups, polygons ----------
  const CLAY = [
    { min: 40, color: "#6e3b1f", name: "Heavy clay", note: "Plastic with high shrinkage. Blend in sand or grog and dry slowly." },
    { min: 27, color: "#b07339", name: "Clay / clay loam", note: "Workable for pottery after testing and screening." },
    { min: 15, color: "#ddb878", name: "Loam", note: "Some clay, but likely too lean on its own." },
    { min: 0, color: "#f1e7d0", name: "Low clay (sandy)", note: "Not a useful clay source." },
  ];
  const clayClass = (c) => (c == null ? null : CLAY.find((x) => c >= x.min));
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const soilCache = {};
  function soilPoint(lat, lng) {
    const key = lat.toFixed(4) + "," + lng.toFixed(4);
    if (!soilCache[key]) {
      soilCache[key] = sda(`SELECT TOP 1 mu.muname, c.drainagecl, ch.claytotal_r, ch.silttotal_r, ch.sandtotal_r, ch.pi_r
        FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' INNER JOIN chorizon ch ON ch.cokey = c.cokey
        WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng.toFixed(6)} ${lat.toFixed(6)})'))
        ORDER BY c.comppct_r DESC, ch.hzdept_r`).then((d) => {
        const t = d.Table; if (!t || !t.length) return null;
        const [muname, drainage, clay, silt, sand, pi] = t[0];
        return { muname, drainage, clay: num(clay), silt: num(silt), sand: num(sand), pi: num(pi) };
      });
      soilCache[key].catch(() => delete soilCache[key]);
    }
    return soilCache[key];
  }
  function soilHtml(s) {
    if (s === "loading") return `<p class="small">Looking up the soil survey…</p>`;
    if (s === "error") return `<p class="small">The soil survey didn't answer. Try again in a moment.</p>`;
    if (!s) return `<p class="small">No soil survey data at this exact point (water, rock or built-up land).</p>`;
    const band = clayClass(s.clay), row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${esc(v)}</dd>`);
    return `<dl class="facts">${row("Soil", s.muname)}${row("Drainage", s.drainage)}${row("Clay", s.clay != null ? s.clay + "%" + (band ? " · " + band.name : "") : null)}${row("Silt", s.silt != null ? s.silt + "%" : null)}${row("Sand", s.sand != null ? s.sand + "%" : null)}${row("Plasticity index", s.pi)}</dl>
      <p class="small">${band ? esc(band.note) + " " : ""}Values are for the top soil layer. Fire a test tile before you rely on any clay you dig.</p>`;
  }
  function parseWKT(w) { // -> array of polygons, each an array of rings of [lat, lng]
    const i = w.indexOf("("); if (i < 0) return [];
    const type = w.slice(0, i).trim().toUpperCase(), body = w.slice(i).trim();
    const ringsOf = (s) => s.split(/\)\s*,\s*\(/).map((r) => r.replace(/[()]/g, "").split(",").map((p) => { const [x, y] = p.trim().split(/\s+/).map(Number); return [y, x]; }));
    if (type === "POLYGON") return [ringsOf(body.slice(1, -1))];
    if (type === "MULTIPOLYGON") return body.slice(2, -2).split(/\)\)\s*,\s*\(\(/).map(ringsOf);
    return [];
  }

  // Soil clay map: real soil survey polygons for the area in view, colored by clay %.
  const SOIL_MIN_ZOOM = 13;
  const soilLayer = L.layerGroup().addTo(map);
  let soilPolys = [], soilBounds = null, soilAbort = null;
  async function loadSoilMap() {
    const on = $("#lyr-soil").checked, st = $("#soil-status");
    if (!on) { if (soilAbort) soilAbort.abort(); soilLayer.clearLayers(); soilPolys = []; soilBounds = null; st.textContent = ""; recolorWater(); updateHint(); return; }
    if (map.getZoom() < SOIL_MIN_ZOOM) { st.className = "status"; st.textContent = "zoom in to see it"; updateHint(); return; }
    const view = map.getBounds();
    if (soilBounds && soilBounds.contains(view)) return;
    const b = view.pad(0.25);
    if (soilAbort) soilAbort.abort();
    const ctrl = soilAbort = new AbortController();
    const tol = map.getZoom() >= 15 ? 0.00003 : map.getZoom() >= 14 ? 0.00005 : 0.00008;
    const W = b.getWest().toFixed(5), E = b.getEast().toFixed(5), S = b.getSouth().toFixed(5), N = b.getNorth().toFixed(5);
    st.className = "status"; st.textContent = "loading…";
    try {
      const d = await sda(`SELECT TOP 4000 P.mukey, M.muname,
        (SELECT TOP 1 ch.claytotal_r FROM component c INNER JOIN chorizon ch ON ch.cokey = c.cokey WHERE c.mukey = P.mukey AND c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC, ch.hzdept_r) AS clay,
        (SELECT TOP 1 c.drainagecl FROM component c WHERE c.mukey = P.mukey AND c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC) AS drain,
        P.mupolygongeo.Reduce(${tol}).STAsText() AS wkt
        FROM mupolygon P INNER JOIN mapunit M ON M.mukey = P.mukey
        WHERE P.mupolygonkey IN (SELECT * FROM SDA_Get_Mupolygonkey_from_intersection_with_WktWgs84('POLYGON((${W} ${S}, ${E} ${S}, ${E} ${N}, ${W} ${N}, ${W} ${S}))'))`, ctrl.signal);
      if (ctrl !== soilAbort) return;
      soilLayer.clearLayers(); soilPolys = [];
      (d.Table || []).forEach(([mukey, name, clay, drain, wkt]) => {
        const polys = parseWKT(wkt || ""); if (!polys.length) return;
        const cl = num(clay), cc = clayClass(cl);
        const layer = L.polygon(polys, { renderer: canvasSoil, pane: "soil", color: "#ffffff", weight: 0.6, opacity: 0.7, fillColor: cc ? cc.color : "#cfcfcf", fillOpacity: cc ? 0.55 : 0.2 });
        layer.bindTooltip(`<span class="water-tip"><strong>${esc(name)}</strong><br>${cl != null ? cl + "% clay · " + esc(cc.name) : "no clay value"}${drain ? " · " + esc(drain) : ""}</span>`, { sticky: true });
        layer.addTo(soilLayer);
        // Rings kept as [lng, lat] for fast point-in-polygon checks.
        soilPolys.push({ xy: polys.map((p) => p.map((r) => r.map(([la, ln]) => [ln, la]))), bb: layer.getBounds(), clay: cl, name, drain });
      });
      soilBounds = b;
      st.className = "status ok"; st.textContent = `${soilPolys.length} soil areas`;
      recolorWater();
    } catch (err) {
      if (err.name === "AbortError") return;
      st.className = "status err"; st.textContent = "soil survey didn't answer; move the map to retry";
      soilBounds = null;
    }
    updateHint(); paintCounties();
  }
  function soilAt(lat, lng) {
    for (const p of soilPolys) {
      if (!p.bb.contains([lat, lng])) continue;
      if (p.xy.some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h)))) return p;
    }
    return null;
  }
  $("#lyr-soil").addEventListener("change", () => { soilBounds = null; loadSoilMap(); paintCounties(); });
  $("#soil-legend").innerHTML = `<p class="tiny muted">Soil clay map, streams and lake shores</p>` +
    CLAY.map((c) => `<span><i style="background:${c.color}"></i>${c.name} (${c.min}%+ clay)</span>`).join("") +
    `<span><i style="background:#d9480f"></i>Stream or shore through clay soil (27%+ clay)</span><span><i style="background:#2f80c1"></i>Other streams and lakes</span>`;

  // ---------- Streams and lakes (USGS National Hydrography Dataset) ----------
  const NHD = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer";
  const WATER_MIN_ZOOM = 12;
  const waterLayer = L.layerGroup().addTo(map), sampleLayer = L.layerGroup().addTo(map);
  let waterFeats = [], waterBounds = null, waterAbort = null;
  const FTYPE = { 460: "Stream / river", 336: "Canal / ditch", 558: "River channel", 390: "Lake / pond", 436: "Reservoir", 493: "Estuary" };
  async function loadWater() {
    const on = $("#lyr-water").checked, st = $("#water-status");
    $("#water-panel").hidden = !on;
    if (!on) { if (waterAbort) waterAbort.abort(); waterLayer.clearLayers(); sampleLayer.clearLayers(); waterFeats = []; waterBounds = null; st.textContent = ""; updateHint(); return; }
    if (map.getZoom() < WATER_MIN_ZOOM) { waterLayer.clearLayers(); waterFeats = []; waterBounds = null; st.className = "status"; st.textContent = "zoom in to see them"; renderWaterList(); updateHint(); return; }
    const view = map.getBounds();
    if (waterBounds && waterBounds.contains(view)) return;
    const b = view.pad(0.2);
    if (waterAbort) waterAbort.abort();
    const ctrl = waterAbort = new AbortController();
    const off = map.getZoom() >= 14 ? 0.00002 : map.getZoom() >= 13 ? 0.00005 : 0.0001;
    const q = (layer, where, fields) => get(`${NHD}/${layer}/query?` + new URLSearchParams({
      where, outFields: fields, geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => x.toFixed(5)).join(","),
      geometryType: "esriGeometryEnvelope", inSR: 4326, outSR: 4326, spatialRel: "esriSpatialRelIntersects",
      maxAllowableOffset: off, geometryPrecision: 5, resultRecordCount: 2000, f: "geojson",
    }), { signal: ctrl.signal });
    st.className = "status"; st.textContent = "loading…";
    try {
      const [lines, bodies] = await Promise.all([
        q(6, "ftype IN (460,336) OR (ftype = 558 AND gnis_name IS NOT NULL)", "gnis_name,ftype"),
        q(12, "FTYPE IN (390,436,493) AND AREASQKM >= 0.002", "GNIS_NAME,FTYPE,AREASQKM"),
      ]);
      if (ctrl !== waterAbort) return;
      drawWater(lines.features || [], bodies.features || []);
      waterBounds = b; st.className = "status ok"; st.textContent = `${waterFeats.length} loaded`;
    } catch (err) {
      if (err.name === "AbortError") return;
      st.className = "status err"; st.textContent = "USGS didn't answer; move the map to retry"; waterBounds = null;
    }
    updateHint();
  }
  const lineCoords = (g) => (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []).map((l) => l.map(([x, y]) => [y, x]));
  const polyCoords = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []).map((p) => p.map((r) => r.map(([x, y]) => [y, x])));
  function drawWater(lines, bodies) {
    waterLayer.clearLayers(); sampleLayer.clearLayers(); waterFeats = [];
    const add = (f) => {
      f.layer.bindTooltip(() => `<span class="water-tip"><strong>${esc(f.name || f.kind + " (unnamed)")}</strong><br>${f.soilText || "Click to check the soil along it"}</span>`, { sticky: true });
      f.layer.on("click", (ev) => { L.DomEvent.stop(ev); sampleWater(f, ev.latlng); });
      f.layer.addTo(waterLayer); waterFeats.push(f);
    };
    bodies.forEach((ft) => {
      const p = ft.properties || {}, coords = polyCoords(ft.geometry || {}); if (!coords.length) return;
      const f = { name: p.GNIS_NAME || p.gnis_name || "", kind: FTYPE[p.FTYPE || p.ftype] || "Lake / pond", isLake: true, coords: coords[0][0] };
      f.layer = L.polygon(coords, { pane: "water", color: "#2f80c1", weight: 2.5, fillColor: "#8cc4ea", fillOpacity: 0.6 });
      add(f);
    });
    lines.forEach((ft) => {
      const p = ft.properties || {}, segs = lineCoords(ft.geometry || {}); if (!segs.length) return;
      const name = p.gnis_name || p.GNIS_NAME || "";
      const f = { name, kind: FTYPE[p.ftype || p.FTYPE] || "Stream / river", isLake: false, coords: segs.flat() };
      f.layer = L.polyline(segs, { pane: "water", color: "#2f80c1", weight: name ? 4 : 2.5, opacity: 0.95, lineCap: "round" });
      add(f);
    });
    recolorWater();
  }
  // Color each stream and lake shore by the soil it passes through (uses the soil clay map once it's loaded).
  const CLAY_WATER = "#d9480f"; // streams and shores running through clay soils
  function samplePoints(coords, n) {
    if (coords.length <= n) return coords.slice();
    return Array.from({ length: n }, (_, i) => coords[Math.round((i * (coords.length - 1)) / (n - 1))]);
  }
  function soilsAlong(f) {
    if (!soilPolys.length) return { pts: [], found: [], ok: [] };
    const pts = samplePoints(f.coords, 14), found = pts.map(([la, ln]) => soilAt(la, ln));
    return { pts, found, ok: found.filter((x) => x && x.clay != null) };
  }
  function recolorWater() {
    waterFeats.forEach((f) => {
      const s = soilsAlong(f);
      if (!s.ok.length) { f.soilText = ""; f.dominant = null; f.avgClay = null; f.clayRich = false; f.layer.setStyle({ color: "#2f80c1", weight: f.isLake ? 2.5 : (f.name ? 4 : 2.5) }); return; }
      const top = CLAY.map((c) => ({ c, n: s.ok.filter((x) => clayClass(x.clay) === c).length })).sort((a, b) => b.n - a.n)[0].c;
      f.dominant = top; f.avgClay = Math.round(s.ok.reduce((t, x) => t + x.clay, 0) / s.ok.length);
      f.soilText = `Runs through mostly ${top.name.toLowerCase()} soil (avg ${f.avgClay}% clay)`;
      const clayRich = f.avgClay >= 27 || top.min >= 27;
      f.clayRich = clayRich;
      f.layer.setStyle(clayRich ? { color: CLAY_WATER, weight: f.isLake ? 3.5 : (f.name ? 5 : 4) } : { color: "#2f80c1", weight: f.isLake ? 2.5 : (f.name ? 4 : 2.5) });
      if (clayRich) f.layer.bringToFront();
    });
    renderWaterList();
  }
  function renderWaterList() {
    if ($("#water-panel").hidden) return;
    const seen = new Set();
    const list = waterFeats.filter((f) => f.name && !seen.has(f.name + f.kind) && seen.add(f.name + f.kind))
      .sort((a, b) => (b.avgClay ?? -1) - (a.avgClay ?? -1) || a.name.localeCompare(b.name)).slice(0, 50);
    $("#water-count").textContent = waterFeats.length ? `(${waterFeats.length})` : "";
    $("#water-list").innerHTML = list.length
      ? list.map((f, i) => `<li><button data-w="${i}"><span class="row"><span class="dot" style="background:${f.clayRich ? CLAY_WATER : "#2f80c1"}"></span><strong>${esc(f.name)}</strong></span><span class="state">${esc(f.kind)}${f.avgClay != null ? " · avg " + f.avgClay + "% clay along it" : ""}</span></button></li>`).join("")
      : `<li class="tiny muted">${map.getZoom() < WATER_MIN_ZOOM ? "Zoom in to see streams and lakes." : waterFeats.length ? "Only unnamed streams here. Click one on the map." : "Nothing loaded here yet."}</li>`;
    $("#water-list").shown = list;
  }
  $("#water-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"), f = b && $("#water-list").shown[b.dataset.w]; if (!f) return;
    map.fitBounds(f.layer.getBounds(), { maxZoom: 15 }); sampleWater(f, f.layer.getBounds().getCenter());
  });
  async function sampleWater(f, at) {
    sampleLayer.clearLayers();
    const local = soilsAlong(f), title = esc(f.name || f.kind + " (unnamed)");
    const pts = local.ok.length ? local.pts : samplePoints(f.coords, 8);
    const mid = pts[Math.floor(pts.length / 2)], county = countyAt(mid[0], mid[1]);
    const head = `<span class="tag">${esc(f.kind)}</span><h3>${title}</h3>${county ? `<div>${esc(county.name)} County</div>` : ""}`;
    const foot = `${county ? potHtml(county.name) : ""}
      <div class="popup-actions"><button type="button" data-act="pickhere" data-lat="${mid[0]}" data-lng="${mid[1]}">Conditions here</button><a href="https://www.google.com/maps?q=${mid[0]},${mid[1]}" target="_blank" rel="noopener">Directions</a></div>
      <p class="small">Check who owns the bank and ask first. Parks and state land forbid digging without a permit.</p>`;
    const popup = L.popup({ maxWidth: 330 }).setLatLng(at).setContent(`${head}<p class="small">Checking the soil survey along it…</p>${foot}`).openOn(map);
    const results = local.ok.length
      ? local.found.map((p) => (p ? { clay: p.clay, muname: p.name } : null))
      : await Promise.all(pts.map((p) => soilPoint(p[0], p[1]).catch(() => "err")));
    results.forEach((r, i) => {
      const c = r && r !== "err" ? clayClass(r.clay) : null;
      L.circleMarker(pts[i], { pane: "water", radius: 6, color: "#fff", weight: 2, fillColor: c ? c.color : "#9aa5ab", fillOpacity: 1 })
        .bindTooltip(r && r !== "err" ? `${r.clay != null ? r.clay + "% clay" : "no clay value"} · ${esc(r.muname || "")}` : "no soil data here").addTo(sampleLayer);
    });
    const ok = results.filter((r) => r && r !== "err" && r.clay != null);
    let body;
    if (!ok.length) {
      body = `<p class="small">${results.every((r) => r === "err") ? "The USDA soil survey didn't answer. Try again in a moment." : "No soil survey values along it (water, rock or built-up land)."}</p>`;
    } else {
      const counts = CLAY.map((cc) => ok.filter((r) => clayClass(r.clay) === cc).length);
      const avg = Math.round(ok.reduce((t, r) => t + r.clay, 0) / ok.length);
      const names = {}; ok.forEach((r) => { if (r.muname) names[r.muname] = (names[r.muname] || 0) + 1; });
      const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => esc(k));
      const clayish = counts[0] + counts[1];
      body = `<p class="sub">Soil along it (${ok.length} of ${pts.length} points)</p>
        <div class="cond">Average ${avg}% clay · ${clayish} of ${ok.length} points are clay or clay loam</div>
        <div class="soil-bar">${CLAY.map((cc, i) => (counts[i] ? `<span style="width:${(counts[i] / ok.length) * 100}%;background:${cc.color}"></span>` : "")).join("")}</div>
        <div class="soil-key">${CLAY.map((cc, i) => (counts[i] ? `<span><i style="background:${cc.color}"></i>${cc.name} (${counts[i]})</span>` : "")).join("")}</div>
        <dl class="facts"><dt>Soils</dt><dd>${top.join("; ")}</dd></dl>
        <p class="small">${clayish ? (f.isLake ? "Look at eroded shoreline and inlet banks, where waves cut below the topsoil." : "Look where the water undercuts a bank and exposes the layers below the topsoil.") : "Mostly loamy or sandy soil here, so clay is less likely."} Fire a test tile before you rely on any clay you dig.</p>`;
    }
    if (popup.isOpen()) popup.setContent(head + body + foot);
  }
  $("#lyr-water").addEventListener("change", () => { waterBounds = null; loadWater(); });

  // ---------- Live weather for all 62 counties: one request per visit, cached for 3 hours ----------
  let countyW = {}, weatherState = "loading", weatherError = "";
  const WX_KEY = "clayWx3";
  async function loadCountyWeather(force) {
    if (!counties.length) return;
    const cached = !force && safe(() => JSON.parse(localStorage.getItem(WX_KEY)));
    if (cached && cached.today === TODAY && Date.now() - cached.t < 3 * 3600e3) { countyW = cached.data; weatherState = "live"; render(); return; }
    weatherState = "loading"; updateStatus();
    try {
      const q = new URLSearchParams({
        latitude: counties.map((c) => c.lat).join(","), longitude: counties.map((c) => c.lng).join(","),
        hourly: "soil_temperature_0_to_7cm,soil_moisture_0_to_7cm,snow_depth",
        daily: "precipitation_sum,temperature_2m_max,temperature_2m_min",
        past_days: LIVE_PAST, forecast_days: LIVE_FUTURE + 1, timezone: "America/New_York",
      });
      const data = await get("https://api.open-meteo.com/v1/forecast?" + q);
      const arr = Array.isArray(data) ? data : [data];
      countyW = {}; counties.forEach((c, i) => { if (arr[i]) countyW[c.id] = compact(arr[i]); });
      safe(() => localStorage.setItem(WX_KEY, JSON.stringify({ t: Date.now(), today: TODAY, data: countyW })));
      weatherState = "live"; weatherError = "";
    } catch (err) { weatherState = "error"; weatherError = err.message; }
    render();
  }
  const wOf = (e) => (e.countyId != null ? countyW[e.countyId] : null);

  // ---------- Entities: clay places, saved spots, the tapped spot ----------
  const TYPE_TAG = { region: "Clay region", historic: "Historic brick town", geology: "Geology / map area", reported: "Reported in a plan", restricted: "Collecting restricted" };
  const ACCESS = { restricted: "Collecting restricted", unknown: "Permission needed", permitted: "Permission granted" };
  const withCounty = (e) => { const c = countyAt(e.lat, e.lng) || nearestCounty(e.lat, e.lng); e.countyId = c ? c.id : null; e.countyName = e.county || (c ? c.name : ""); return e; };
  const ents = SITES.filter((s) => isFinite(s.lat) && isFinite(s.lng)).map((s) => withCounty({ ...s, kind: s.kind || "region", type: "place", soil: null }));
  const loadSaved = () => safe(() => JSON.parse(localStorage.getItem("claySpots"))) || [];
  const storeSaved = () => safe(() => localStorage.setItem("claySpots", JSON.stringify(saved.map(({ name, lat, lng }) => ({ name, lat, lng })))));
  const saved = loadSaved().filter((s) => isFinite(s.lat) && isFinite(s.lng)).map((s) => withCounty({ name: s.name, lat: s.lat, lng: s.lng, kind: "region", type: "saved", soil: null }));
  let picked = null, sel = null;
  const everything = () => [...ents, ...saved];

  const pinIcon = (e, key) => L.divIcon({
    className: "", iconSize: [20, 20], iconAnchor: [10, 10],
    html: `<div class="pin ${e.kind === "restricted" ? "restricted" : ""} ${e.type === "place" && ["historic", "geology", "reported"].includes(e.kind) ? e.kind : ""} ${e.type === "saved" ? "saved" : ""} ${e.type === "pick" ? "pick" : ""}" style="background:${STATES[key].color}"></div>`,
  });
  function popupHtml(e) {
    const c = condFor(e, date), st = STATES[c.key], m = c.metrics, est = c.source === "model";
    const wetWord = (w) => (w > 0.68 ? "High" : w > 0.45 ? "Moderate" : "Low");
    const facts = est
      ? `<dt>Soil temp (typical)</dt><dd>${F(m.soilT).toFixed(0)}°F</dd><dt>Soil wetness (typical)</dt><dd>${wetWord(m.wetIdx)}</dd><dt>Air high / low (typical)</dt><dd>${F(m.tmax).toFixed(0)}° / ${F(m.tmin).toFixed(0)}°F</dd>`
      : `${m.soilT != null ? `<dt>Soil temp</dt><dd>${F(m.soilT).toFixed(0)}°F</dd>` : ""}${m.soilM != null ? `<dt>Soil moisture</dt><dd>${Math.round(m.soilM * 100)}%</dd>` : ""}${m.snow ? `<dt>Snow depth</dt><dd>${(m.snow * 39.37).toFixed(1)} in</dd>` : ""}<dt>Rain, last 3 days</dt><dd>${inch(m.rain3).toFixed(2)} in</dd>${m.tmax != null ? `<dt>Air high / low</dt><dd>${F(m.tmax).toFixed(0)}° / ${F(m.tmin).toFixed(0)}°F</dd>` : ""}`;
    const head = e.type === "place"
      ? `<span class="tag ${e.kind === "restricted" ? "restricted" : ""}">${esc(TYPE_TAG[e.kind] || "Clay region")}</span> <span class="tag ${e.kind === "restricted" ? "restricted" : ""}">${esc(ACCESS[e.access] || "Permission needed")}</span>
         <h3>${esc(e.name)}</h3><div>${esc(e.countyName)} County</div><p>${esc(e.notes)}</p>${e.source ? `<p class="src">${/^https?:\/\//.test(e.source) ? `<a href="${esc(e.source)}" target="_blank" rel="noopener">Source</a>` : "Source: " + esc(e.source)}</p>` : ""}`
      : `<span class="tag">${e.type === "saved" ? "Saved spot" : "Selected spot"}</span><h3>${esc(e.name || (e.countyName ? e.countyName + " County spot" : "Selected spot"))}</h3><div>${e.countyName ? esc(e.countyName) + " County · " : ""}${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}</div>`;
    const actions = `<div class="popup-actions">
      ${e.type === "pick" ? `<button type="button" data-act="save">Save this spot</button>` : ""}
      ${e.type === "saved" ? `<button type="button" data-act="remove">Remove</button>` : ""}
      <button type="button" data-act="share">Copy link</button>
      <a href="https://www.google.com/maps?q=${e.lat},${e.lng}" target="_blank" rel="noopener">Directions</a></div>`;
    return `${head}
      <p class="sub">Conditions on ${esc(pretty(date))}</p>
      <div class="cond"><span class="dot" style="background:${st.color}"></span>${esc(st.label)}</div>
      <div class="small">${esc(st.help)}</div><dl class="facts">${facts}</dl>
      <p class="small">${est ? "Typical conditions for this date from my climate model, not this year's actual weather." : `Live weather for ${esc(e.countyName)} County.`}</p>
      <p class="sub">Soil survey (USDA)</p>${soilHtml(e.soil)}
      ${e.countyName ? potHtml(e.countyName) : ""}${actions}`;
  }
  async function fillSoil(e) {
    if (e.soil && e.soil !== "loading" && e.soil !== "error") return;
    e.soil = "loading"; refreshPopup(e);
    try { e.soil = await soilPoint(e.lat, e.lng); } catch (err) { e.soil = "error"; }
    refreshPopup(e);
  }
  const refreshPopup = (e) => { if (e.marker && e.marker.isPopupOpen()) e.marker.getPopup().setContent(popupHtml(e)); };

  const sitesLayer = L.markerClusterGroup({ maxClusterRadius: 38, disableClusteringAtZoom: 10, showCoverageOnHover: false }).addTo(map);
  const savedLayer = L.layerGroup().addTo(map);
  function addMarker(e, layer) {
    e.marker = L.marker([e.lat, e.lng], { icon: pinIcon(e, condFor(e, date).key), title: e.name || "Selected spot", riseOnHover: true });
    e.marker.bindPopup(() => popupHtml(e), { maxWidth: 330 });
    e.marker.on("popupopen", () => { select(e); fillSoil(e); });
    layer.addLayer(e.marker);
  }
  ents.forEach((e) => addMarker(e, sitesLayer));
  saved.forEach((e) => addMarker(e, savedLayer));
  $("#lyr-sites").addEventListener("change", (e) => (e.target.checked ? sitesLayer.addTo(map) : map.removeLayer(sitesLayer)));

  // Place type filter
  const shownKinds = new Set(Object.keys(TYPE_TAG));
  const KIND_COUNT = {}; ents.forEach((e) => (KIND_COUNT[e.kind] = (KIND_COUNT[e.kind] || 0) + 1));
  $("#kind-filter").innerHTML = Object.entries(TYPE_TAG).filter(([k]) => KIND_COUNT[k])
    .map(([k, label]) => `<label><input type="checkbox" data-kind="${k}" checked> ${esc(label)} (${KIND_COUNT[k]})</label>`).join("");
  $("#kind-filter").addEventListener("change", (ev) => {
    const k = ev.target.dataset.kind; if (!k) return;
    ev.target.checked ? shownKinds.add(k) : shownKinds.delete(k);
    ents.forEach((e) => (shownKinds.has(e.kind) ? sitesLayer.addLayer(e.marker) : sitesLayer.removeLayer(e.marker)));
    render();
  });
  const visibleEnts = () => ents.filter((e) => shownKinds.has(e.kind));

  // ---------- USGS clay pits and records (bundled from USGS MRDS) ----------
  const STATUS_INFO = {
    "Producer": ["Active clay pit", "#5a2d12", "An active commercial operation. Private property: ask the operator, and never trespass."],
    "Past Producer": ["Former clay pit", "#a0612e", "A former pit. The land is still privately owned, so ask the owner. Old pits can be flooded or unstable."],
    "Occurrence": ["Clay occurrence", "#c99a5b", "A documented clay deposit that was never mined."],
    "Plant": ["Clay plant", "#7b6a5a", "A processing plant site."],
  };
  const usgsLayer = L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 11, showCoverageOnHover: false,
    iconCreateFunction: (cl) => L.divIcon({ className: "usgs-cluster", html: `<div>${cl.getChildCount()}</div>`, iconSize: [30, 30] }) }).addTo(map);
  USGS.forEach((s) => {
    const [label, color, note] = STATUS_INFO[s.status] || ["USGS record", "#8a6a4a", ""];
    L.circleMarker([s.lat, s.lng], { radius: 6, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
      .bindTooltip(`${esc(s.name)} · ${esc(label)}`)
      .bindPopup(`<span class="tag">USGS · ${esc(label)}</span><h3>${esc(s.name)}</h3><div>${esc(s.county)} County</div><p class="small">${esc(note)}</p>
        <p class="src"><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">USGS record</a></p>
        <div class="popup-actions"><button type="button" data-act="pickhere" data-lat="${s.lat}" data-lng="${s.lng}">Conditions &amp; soil here</button><a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener">Directions</a></div>
        <p class="small">Location is as recorded by USGS and can be approximate.</p>`, { maxWidth: 320 })
      .addTo(usgsLayer);
  });
  $("#usgs-status").textContent = `(${USGS.length})`;
  $("#lyr-usgs").addEventListener("change", (e) => (e.target.checked ? usgsLayer.addTo(map) : map.removeLayer(usgsLayer)));

  // ---------- Potters and wild clay groups ----------
  const communityLayer = L.layerGroup().addTo(map);
  (COMMUNITY.groups || []).filter((g) => g.lat != null && g.lng != null).forEach((g) => {
    L.marker([g.lat, g.lng], { title: g.name, icon: L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="pin community"></div>' }) })
      .addTo(communityLayer)
      .bindPopup(`<span class="tag">Potters &amp; wild clay</span><h3>${esc(g.name)}</h3><div>${esc(g.place)}</div><p>${esc(g.what)}</p><p class="src"><a href="${esc(safeUrl(g.url))}" target="_blank" rel="noopener">Visit their page</a></p><p class="small">The pin marks the town, not the exact address.</p>`);
  });
  $("#lyr-community").addEventListener("change", (e) => (e.target.checked ? communityLayer.addTo(map) : map.removeLayer(communityLayer)));
  const refList = (arr, target, withPlace) => { $(target).innerHTML = (arr || []).map((x) =>
    `<li><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.name || x.title)}</a><span>${withPlace && x.place ? esc(x.place) + ". " : ""}${esc(x.what || x.note)}</span></li>`).join(""); };
  refList(COMMUNITY.groups, "#refs-groups", true); refList(COMMUNITY.guides, "#refs-guides"); refList(COMMUNITY.rules, "#refs-rules");

  // ---------- Popup buttons (delegated: popups are rebuilt when the date changes) ----------
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".leaflet-popup [data-act]"); if (!b) return;
    const act = b.dataset.act;
    if (act === "pickhere") { map.closePopup(); pick(+b.dataset.lat, +b.dataset.lng); return; }
    if (!sel) return;
    if (act === "save") saveSpot(sel);
    if (act === "remove") removeSpot(sel);
    if (act === "share") shareLink(sel, b);
  });
  function shareLink(e, btn) {
    const url = `${location.origin}${location.pathname}#d=${date}&lat=${e.lat.toFixed(4)}&lng=${e.lng.toFixed(4)}`;
    const done = () => (btn.textContent = "Link copied");
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("Copy this link:", url)); else prompt("Copy this link:", url);
  }
  function saveSpot(e) {
    const name = prompt("Name this spot:", e.countyName ? e.countyName + " County spot" : "My spot");
    if (!name) return;
    const s = withCounty({ name: name.trim().slice(0, 60), lat: e.lat, lng: e.lng, kind: "region", type: "saved", soil: e.soil });
    saved.push(s); addMarker(s, savedLayer); storeSaved();
    if (picked) { map.removeLayer(picked.marker); picked = null; }
    render(); s.marker.openPopup();
  }
  function removeSpot(e) {
    const i = saved.indexOf(e); if (i < 0) return;
    savedLayer.removeLayer(e.marker); saved.splice(i, 1); storeSaved();
    if (sel === e) select(null);
    render();
  }

  // ---------- Tap anywhere ----------
  function pick(lat, lng) {
    if (!inNY(lat, lng)) { flash("That spot is outside New York State."); return; }
    if (picked) map.removeLayer(picked.marker);
    const mine = picked = withCounty({ lat, lng, type: "pick", kind: "region", name: "", soil: null });
    mine.marker = L.marker([lat, lng], { icon: pinIcon(mine, condFor(mine, date).key), zIndexOffset: 1000 }).addTo(map);
    mine.marker.bindPopup(() => popupHtml(mine), { maxWidth: 330 });
    mine.marker.on("popupopen", () => { select(mine); fillSoil(mine); });
    if (!map.getBounds().contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 12));
    mine.marker.openPopup();
  }
  map.on("click", (ev) => pick(ev.latlng.lat, ev.latlng.lng));
  let flashTimer;
  function flash(msg) { const h = $("#zoom-hint"); h.textContent = msg; h.classList.add("show"); clearTimeout(flashTimer); flashTimer = setTimeout(updateHint, 3500); }

  // ---------- Selected spot: 1-year timeline and next good day ----------
  function select(e) { sel = e; drawSelection(); writeHash(); }
  function drawSelection() {
    const e = sel;
    $("#sel-hint").hidden = !!e; $("#sel-body").hidden = !e;
    if (!e) { $("#sel-title").textContent = "Selected spot"; return; }
    $("#sel-title").textContent = e.name || (e.countyName ? e.countyName + " County spot" : "Selected spot");
    const bars = ALL_DAYS.map((d, i) => {
      const c = condFor(e, d);
      return `<rect data-d="${d}" x="${i * 2}" y="2" width="2" height="38" fill="${STATES[c.key].color}" opacity="${c.source === "live" ? 1 : 0.5}"><title>${esc(weekday(d))}: ${esc(STATES[c.key].label)}${c.source === "live" ? "" : " (typical)"}</title></rect>`;
    }).join("");
    const xi = ALL_DAYS.indexOf(date), xt = ALL_DAYS.indexOf(TODAY);
    $("#timeline").innerHTML = bars + `<rect x="${xt * 2}" y="0" width="1.2" height="44" fill="#1d2b33" opacity=".5" pointer-events="none"/><rect x="${xi * 2 - 2}" y="0.5" width="6" height="43" fill="none" stroke="#1d2b33" stroke-width="1.5" pointer-events="none"/>`;
    const next = nextGood(e, date), end = shift(date, 13);
    const good14 = ALL_DAYS.filter((d) => d >= date && d <= end && condFor(e, d).key === "good").length;
    $("#sel-next").innerHTML = next
      ? `Next good digging day: <strong>${esc(weekday(next))}</strong>${next === date ? " (the selected date)" : ""}. ${good14} good day${good14 === 1 ? "" : "s"} in the two weeks from the selected date.`
      : "No good digging day from this date through the end of the range.";
  }
  const nextGood = (e, from) => ALL_DAYS.find((d) => d >= from && condFor(e, d).key === "good") || null;
  $("#timeline").addEventListener("click", (ev) => { const r = ev.target.closest("rect[data-d]"); if (r) setDate(r.dataset.d); });
  $("#nextgood").addEventListener("click", () => {
    const e = sel || ents[0]; if (!e) return;
    const n = nextGood(e, shift(date, 1));
    if (n) setDate(n); else flash("No good digging day ahead in the range for " + (e.name || "this spot") + ".");
  });

  // ---------- County colors ----------
  let mode = "cond";
  const POT_COLORS = ["#efe6d8", "#dcc79c", "#c19a5b", "#8f5a2b"];
  const WORK = { good: 1, dry: 0.45, wet: 0.35, frozen: 0 };
  const BEST = [[0, "#cfd6da", "Not now"], [0.7, "#bfe0c8", "Fair"], [1.4, "#86c49b", "Good"], [2.2, "#4fa876", "Very good"], [99, "#2c7f52", "Best"]];
  const countyCond = (c) => condFor({ lat: c.lat, lng: c.lng, countyId: c.id }, date);
  const countyPot = (c) => (potential(c.name) || { pot: 0 }).pot;
  const bestScore = (c) => countyPot(c) * WORK[countyCond(c).key];
  const binOf = (sc) => (sc <= 0 ? 0 : sc <= 0.7 ? 1 : sc <= 1.4 ? 2 : sc <= 2.2 ? 3 : 4);
  const countyLayer = COUNTIES ? L.geoJSON(COUNTIES, {
    pane: "counties", style: { fillOpacity: 0.45, color: "#fff", weight: 1 },
    onEachFeature: (f, l) => { l.feature._c = counties.find((c) => c.id === f.id); l.bindTooltip("", { sticky: true }); },
  }).addTo(map) : null;
  function paintCounties() {
    if (!countyLayer) return;
    // Zoomed in with the soil map on: fade the county fill so the soil shows through.
    const faded = map.getZoom() >= SOIL_MIN_ZOOM && $("#lyr-soil").checked;
    countyLayer.eachLayer((l) => {
      const c = l.feature._c, cc = countyCond(c), pot = countyPot(c);
      let fill, tip;
      if (mode === "clay") { fill = POT_COLORS[pot]; const p = potential(c.name); tip = `${POT_LABEL[pot]} clay potential${p && p.usgs ? ` · ${p.usgs} USGS clay record${p.usgs === 1 ? "" : "s"}` : ""}`; }
      else if (mode === "best") { const b = binOf(bestScore(c)); fill = BEST[b][1]; tip = `${BEST[b][2]}: ${STATES[cc.key].label.toLowerCase()}, ${POT_LABEL[pot].toLowerCase()} clay potential`; }
      else { fill = STATES[cc.key].color; tip = STATES[cc.key].label + (cc.source === "model" ? " (typical)" : ""); }
      l.setStyle({ fillColor: fill, fillOpacity: faded ? 0.05 : 0.45, color: "#ffffff", weight: faded ? 2 : 1, opacity: 0.85 });
      l.setTooltipContent(`<span class="county-tip"><strong>${esc(c.name)} County</strong><br>${esc(tip)}</span>`);
    });
  }
  $("#lyr-counties").addEventListener("change", (e) => { if (!countyLayer) return; e.target.checked ? countyLayer.addTo(map) : map.removeLayer(countyLayer); });
  $("#mode").addEventListener("change", (e) => { mode = e.target.value; render(); });

  // ---------- Search and "use my location" ----------
  $("#search-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = $("#search").value.trim(), box = $("#results"); if (!q) return;
    box.hidden = false; box.innerHTML = `<li class="tiny muted pad">Searching…</li>`;
    try {
      const data = await get("https://geocoding-api.open-meteo.com/v1/search?count=20&language=en&countryCode=US&name=" + encodeURIComponent(q));
      const hits = (data.results || []).filter((r) => r.admin1 === "New York").slice(0, 6);
      if (!hits.length) { box.innerHTML = `<li class="tiny muted pad">No New York place found for “${esc(q)}”.</li>`; return; }
      box.innerHTML = hits.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}${r.admin2 ? ", " + esc(r.admin2.replace(/ County$/, "")) + " County" : ""}</button></li>`).join("");
      box.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const r = hits[b.dataset.i]; box.hidden = true; map.setView([r.latitude, r.longitude], 13); pick(r.latitude, r.longitude); };
    } catch (err) { box.innerHTML = `<li class="tiny muted pad">Search didn't answer. Try again in a moment.</li>`; }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".finder")) $("#results").hidden = true; });
  $("#locate").addEventListener("click", () => {
    if (!navigator.geolocation) { flash("Your browser can't share a location."); return; }
    navigator.geolocation.getCurrentPosition((p) => { map.setView([p.coords.latitude, p.coords.longitude], 14); pick(p.coords.latitude, p.coords.longitude); },
      () => flash("Couldn't get your location. Check your browser's location permission."));
  });

  // ---------- Rendering ----------
  const SEASON = [
    "Deep winter: the ground is usually frozen solid and snow-covered. Plan and scout instead.",
    "Late winter: still frozen in the mornings. Spring thaw is close.",
    "Mud season: thaw plus snowmelt leaves clay saturated and sticky. Wait for it to firm up.",
    "Spring: banks thaw and drain. Good windows open up between rains.",
    "Late spring: a good time to dig when it hasn't rained for a few days.",
    "Early summer: clay is usually workable and stream banks are low and firm.",
    "Midsummer: dry spells harden clay. Dig after a light rain.",
    "Late summer: low water exposes stream banks. Clay can be rock-hard if it's been dry.",
    "Early fall: one of the best seasons, with firm ground and low water.",
    "Fall: rains return. Dig on dry days before the first freeze.",
    "Late fall: the first freezes arrive. Finish up before the ground locks.",
    "Early winter: freezing nights and snow end the digging season.",
  ];
  const listHtml = (arr, attr) => arr.map((e, i) =>
    `<li><button data-${attr}="${i}"><span class="row"><span class="dot" style="background:${STATES[e.cond].color}"></span><strong>${esc(e.name)}</strong></span><span class="state">${e.type === "place" ? esc(TYPE_TAG[e.kind] || "") + " · " : ""}${esc(e.countyName || "")}${e.countyName ? " County · " : ""}${esc(STATES[e.cond].label)}</span></button></li>`).join("");
  function renderSummary() {
    const lines = (items) => items.map(([color, label, n]) => `<li><span class="dot" style="background:${color}"></span>${esc(label)}${n ? ` (${n})` : ""}</li>`).join("");
    if (mode === "clay") {
      const n = [0, 0, 0, 0]; counties.forEach((c) => n[countyPot(c)]++);
      $("#summary").textContent = "Clay potential: my estimate from glacial geology, raised where USGS documents clay pits. It doesn't change with the date.";
      $("#legend").innerHTML = lines([3, 2, 1, 0].map((p) => [POT_COLORS[p], POT_LABEL[p] + " potential", n[p]]));
    } else if (mode === "best") {
      const n = [0, 0, 0, 0, 0]; counties.forEach((c) => n[binOf(bestScore(c))]++);
      $("#summary").textContent = "Best bets combine clay potential with how workable the ground is on this date.";
      $("#legend").innerHTML = lines([4, 3, 2, 1, 0].map((b) => [BEST[b][1], BEST[b][2], n[b]]));
    } else {
      const counts = {}; counties.forEach((c) => { const k = countyCond(c).key; counts[k] = (counts[k] || 0) + 1; });
      const mine = everything(), mg = mine.filter((e) => e.cond === "good").length;
      $("#summary").textContent = `${counts.good || 0} of ${counties.length} counties look good for digging${mine.length ? `; ${mg} of ${mine.length} places do` : ""}.`;
      $("#legend").innerHTML = lines(Object.entries(STATES).map(([k, st]) => [st.color, st.label, counts[k]]));
    }
    const ranked = counties.map((c) => ({ c, sc: bestScore(c) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || countyPot(b.c) - countyPot(a.c)).slice(0, 8);
    $("#best-list").innerHTML = ranked.length
      ? ranked.map((x, i) => `<li><button data-b="${i}"><span class="row"><span class="dot" style="background:${BEST[binOf(x.sc)][1]}"></span><strong>${esc(x.c.name)} County</strong></span><span class="state">${esc(POT_LABEL[countyPot(x.c)])} clay potential · ${esc(STATES[countyCond(x.c).key].label)}</span></button></li>`).join("")
      : `<li class="tiny muted">Nothing is workable on this date. The ground is frozen or too wet.</li>`;
    $("#best-list").ranked = ranked;
  }
  function updateStatus() {
    const inLive = date >= LIVE_MIN && date <= LIVE_MAX, el = $("#data-status");
    let cls = "est", html;
    if (weatherState === "loading") html = "Loading live weather…";
    else if (weatherState === "live" && inLive) { cls = "live"; html = "<strong>Live weather.</strong> Colors use real soil temperature, moisture, snow and rain."; }
    else if (weatherState === "live") html = `<strong>Typical conditions.</strong> Live weather covers ${esc(pretty(LIVE_MIN))} to ${esc(pretty(LIVE_MAX))}. Other dates use my climate model.`;
    else {
      const limit = /limit/i.test(weatherError);
      html = `<strong>Typical conditions.</strong> ${limit ? "The free weather service's daily limit was reached for your network." : "Live weather isn't reachable right now."} Colors use my climate model instead.` +
        (weatherError ? `<span class="detail">Detail: ${esc(weatherError)}</span>` : "") + `<button type="button" id="retry-live">Retry</button>`;
    }
    el.className = "data-status " + cls; el.innerHTML = html;
    const rb = $("#retry-live"); if (rb) rb.onclick = () => loadCountyWeather(true);
  }
  function updateHint() {
    const z = map.getZoom(), h = $("#zoom-hint"), parts = [];
    if ($("#lyr-water").checked && z < WATER_MIN_ZOOM) parts.push("streams & lakes");
    if ($("#lyr-soil").checked && z < SOIL_MIN_ZOOM) parts.push("the soil clay map");
    h.textContent = parts.length ? `Zoom in to see ${parts.join(" and ")}` : "";
    h.classList.toggle("show", !!parts.length);
  }
  function writeHash() { safe(() => history.replaceState(null, "", "#d=" + date + (sel ? `&lat=${sel.lat.toFixed(4)}&lng=${sel.lng.toFixed(4)}` : ""))); }
  function render() {
    $("#date-label").textContent = pretty(date);
    const inLive = date >= LIVE_MIN && date <= LIVE_MAX;
    $("#date-note").textContent = (date === TODAY ? "Today" : date > TODAY ? "Future" : "Past") + (inLive && weatherState === "live" ? " · live weather" : " · typical conditions");
    $("#season").textContent = SEASON[parse(date).getMonth()];
    dateInput.value = date;
    slider.value = Math.round((parse(date) - parse(TODAY)) / 864e5);
    everything().forEach((e) => { e.cond = condFor(e, date).key; e.marker.setIcon(pinIcon(e, e.cond)); refreshPopup(e); });
    if (picked) { picked.marker.setIcon(pinIcon(picked, condFor(picked, date).key)); refreshPopup(picked); }
    paintCounties(); renderSummary(); updateStatus();
    const ve = visibleEnts();
    $("#count").textContent = "(" + ve.length + (ve.length < ents.length ? " of " + ents.length : "") + ")";
    $("#list").innerHTML = listHtml(ve, "i");
    $("#saved-list").innerHTML = listHtml(saved, "s");
    $("#saved-count").textContent = saved.length ? "(" + saved.length + ")" : "";
    $("#saved-empty").hidden = saved.length > 0;
    drawSelection(); writeHash();
  }
  const goTo = (e) => {
    const open = () => e.marker.openPopup();
    if (e.type === "place") sitesLayer.zoomToShowLayer(e.marker, open); else { map.setView([e.lat, e.lng], Math.max(map.getZoom(), 12)); open(); }
    $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
  };
  $("#list").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) goTo(visibleEnts()[b.dataset.i]); });
  $("#saved-list").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) goTo(saved[b.dataset.s]); });
  $("#best-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"), r = $("#best-list").ranked; if (!b || !r) return;
    const c = r[b.dataset.b].c; map.setView([c.lat, c.lng], 10); pick(c.lat, c.lng);
    $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  function setDate(d) { date = d < MIN ? MIN : d > MAX ? MAX : d; render(); }
  dateInput.addEventListener("change", () => dateInput.value && setDate(dateInput.value));
  let slideRaf = 0;
  slider.addEventListener("input", () => { cancelAnimationFrame(slideRaf); slideRaf = requestAnimationFrame(() => setDate(shift(TODAY, Number(slider.value)))); });
  $("#today").addEventListener("click", () => setDate(TODAY));
  $("#back7").addEventListener("click", () => setDate(shift(date, -7)));
  $("#fwd7").addEventListener("click", () => setDate(shift(date, 7)));

  // Load soil and water for whatever is in view after the map settles.
  let moveTimer;
  map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { loadSoilMap(); loadWater(); paintCounties(); updateHint(); }, 350); });

  render();
  updateHint();
  loadWater();
  loadCountyWeather();
  const sl = parseFloat(hashParams.get("lat")), sg = parseFloat(hashParams.get("lng"));
  if (isFinite(sl) && isFinite(sg)) { map.setView([sl, sg], 13); pick(sl, sg); }
})();
