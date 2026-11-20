// New York clay soil map.
// Pick a date and see how workable the clay is across the state (by county), at my clay places,
// at any spot you tap, and at spots you save. Live data: Open-Meteo (soil temperature, soil moisture,
// snow, rain) and USDA NRCS Soil Data Access (soil survey).
(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const safe = (fn) => { try { return fn(); } catch (e) { return null; } };

  let SHOP = {}, SITES = [], COUNTIES = null;
  try { SHOP = await get("store.json"); } catch (e) {}
  try { SITES = (await get("content/clay-sites.json")).sites || []; } catch (e) {}
  try { COUNTIES = await get("content/ny-counties.json"); } catch (e) {}
  if (SHOP.name) document.title = "New York Clay Soil Map | " + SHOP.name;
  $("#suggest").href = "mailto:" + (SHOP.contactEmail || "") + "?subject=" + encodeURIComponent("Clay map suggestion");
  if (SHOP.shopOpen) document.querySelectorAll("[data-shop-nav]").forEach((a) => (a.hidden = false));

  // ---------- Dates ----------
  const PAST = 92, FUTURE = 15; // the weather service covers about 3 months back and 2 weeks ahead
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const pretty = (s) => parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const weekday = (s) => parse(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const now = new Date();
  const TODAY = iso(now), MIN = iso(addDays(now, -PAST)), MAX = iso(addDays(now, FUTURE));
  const ALL_DAYS = Array.from({ length: PAST + FUTURE + 1 }, (_, i) => iso(addDays(now, i - PAST)));
  let date = TODAY;

  // Shared link: #d=2026-11-20&lat=42.65&lng=-73.75
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (/^\d{4}-\d{2}-\d{2}$/.test(hashParams.get("d") || "") && hashParams.get("d") >= MIN && hashParams.get("d") <= MAX) date = hashParams.get("d");

  const dateInput = $("#date"), slider = $("#slider");
  dateInput.min = MIN; dateInput.max = MAX;
  slider.min = -PAST; slider.max = FUTURE;
  $("#min-label").textContent = pretty(MIN); $("#max-label").textContent = pretty(MAX);
  $("#tl-min").textContent = pretty(MIN); $("#tl-max").textContent = pretty(MAX);

  // ---------- Map ----------
  const NY = L.latLngBounds([40.45, -79.8], [45.05, -71.8]);
  const map = L.map("map", { maxBounds: NY.pad(0.4), minZoom: 6 }).fitBounds(NY);
  L.control.scale({ imperial: true }).addTo(map);
  const base = {
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
    topo: L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "USGS The National Map" }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Esri, Maxar, Earthstar" }),
  };
  let current = base.osm.addTo(map);
  $("#basemap").addEventListener("change", (e) => { map.removeLayer(current); current = base[e.target.value].addTo(map); current.bringToBack(); });
  map.createPane("counties"); map.getPane("counties").style.zIndex = 250;

  // ---------- Conditions: how workable is the clay on a given day? ----------
  const STATES = {
    good:   { label: "Good for digging", color: "#3a8f60", help: "Soil is thawed and damp but not soggy. Clay is workable." },
    wet:    { label: "Too wet", color: "#2b7cb3", help: "Saturated or recently rained on. Clay is sticky, heavy and banks can slump." },
    dry:    { label: "Dry and hard", color: "#c9a24a", help: "Dry soil. Clay is hard to dig and breaks into lumps (soak it later to slake)." },
    frozen: { label: "Frozen or snow-covered", color: "#8aa0ad", help: "Ground frozen or under snow. Not diggable." },
    nodata: { label: "No data", color: "#b9b2a8", help: "No weather data for this date." },
  };
  const F = (c) => c * 9 / 5 + 32;
  const inch = (mm) => mm / 25.4;

  function conditions(w, day) {
    if (!w) return { key: "nodata", metrics: {} };
    const di = w.dayIdx[day], hi = w.hourIdx[day + "T12:00"];
    if (di === undefined || hi === undefined) return { key: "nodata", metrics: {} };
    const soilT = w.soilT[hi], soilM = w.soilM[hi], snow = w.snow[hi];
    const rain3 = [0, 1, 2].reduce((s, k) => s + (w.precip[di - k] || 0), 0);
    const m = { soilT, soilM, snow, rain3, rain: w.precip[di], tmax: w.tmax[di], tmin: w.tmin[di] };
    let key = "good";
    if ((soilT != null && soilT <= 1) || (snow != null && snow > 0.02)) key = "frozen";
    else if ((soilM != null && soilM >= 0.40) || rain3 >= 20) key = "wet";
    else if (soilM != null && soilM < 0.15 && rain3 < 2) key = "dry";
    if (soilT == null && soilM == null) key = "nodata";
    return { key, metrics: m };
  }

  // range: { past, future } for the whole window, or { start, end } for one date (plus two days of rain history).
  async function loadWeather(points, range) {
    const chunks = [];
    for (let i = 0; i < points.length; i += 30) chunks.push(points.slice(i, i + 30));
    const parts = await Promise.all(chunks.map(async (pts) => {
      const q = new URLSearchParams({
        latitude: pts.map((p) => p.lat).join(","), longitude: pts.map((p) => p.lng).join(","),
        hourly: "soil_temperature_0_to_7cm,soil_moisture_0_to_7cm,snow_depth",
        daily: "precipitation_sum,temperature_2m_max,temperature_2m_min",
        timezone: "America/New_York",
      });
      if (range.start) { q.set("start_date", range.start); q.set("end_date", range.end); }
      else { q.set("past_days", range.past); q.set("forecast_days", range.future + 1); }
      const data = await get("https://api.open-meteo.com/v1/forecast?" + q);
      return Array.isArray(data) ? data : [data];
    }));
    const idx = (a) => Object.fromEntries(a.map((t, i) => [t, i]));
    return parts.flat().map((r) => ({
      dayIdx: idx(r.daily.time), hourIdx: idx(r.hourly.time),
      soilT: r.hourly.soil_temperature_0_to_7cm, soilM: r.hourly.soil_moisture_0_to_7cm, snow: r.hourly.snow_depth,
      precip: r.daily.precipitation_sum, tmax: r.daily.temperature_2m_max, tmin: r.daily.temperature_2m_min,
    }));
  }

  // ---------- Soil survey (USDA NRCS Soil Data Access) ----------
  const soilCache = {};
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  async function loadSoil(lat, lng) {
    const key = lat.toFixed(4) + "," + lng.toFixed(4);
    if (soilCache[key]) return soilCache[key];
    const sql = `SELECT TOP 1 mu.muname, c.compname, c.drainagecl, ch.hzname, ch.claytotal_r, ch.silttotal_r, ch.sandtotal_r, ch.pi_r
      FROM mapunit mu
      INNER JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes'
      INNER JOIN chorizon ch ON ch.cokey = c.cokey
      WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng} ${lat})'))
      ORDER BY c.comppct_r DESC, ch.hzdept_r`;
    const p = (async () => {
      const res = await fetch("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "JSON", query: sql }),
      });
      if (!res.ok) throw new Error(res.status);
      const t = (await res.json()).Table;
      if (!t || !t.length) return null;
      const [muname, compname, drainage, horizon, clay, silt, sand, pi] = t[0];
      return { muname, compname, drainage, horizon, clay: num(clay), silt: num(silt), sand: num(sand), pi: num(pi) };
    })();
    soilCache[key] = p;
    p.catch(() => delete soilCache[key]);
    return p;
  }
  function clayBand(c) {
    if (c == null) return null;
    if (c >= 40) return { name: "Heavy clay", note: "Plastic with high shrinkage. Blend in sand or grog and dry slowly." };
    if (c >= 27) return { name: "Clay / clay loam", note: "Workable for pottery after testing and screening." };
    if (c >= 15) return { name: "Loam", note: "Some clay, but likely too lean on its own." };
    return { name: "Low clay", note: "Not a useful clay source." };
  }
  function soilHtml(s) {
    if (s === "loading") return `<p class="small">Looking up the soil survey…</p>`;
    if (!s) return `<p class="small">No soil survey data for this exact point (water, rock or urban land).</p>`;
    if (s === "error") return `<p class="small">Soil survey is unavailable right now. Try again in a moment.</p>`;
    const band = clayBand(s.clay);
    const row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${esc(v)}</dd>`);
    return `<dl class="facts">${row("Soil", s.muname)}${row("Drainage", s.drainage)}${row("Clay content", s.clay != null ? s.clay + "%" + (band ? " · " + band.name : "") : null)}${row("Silt", s.silt != null ? s.silt + "%" : null)}${row("Sand", s.sand != null ? s.sand + "%" : null)}${row("Plasticity index", s.pi)}</dl>` +
      `<p class="small">${band ? esc(band.note) + " " : ""}Values are for the top soil layer. Test any clay by firing a small tile before you rely on it.</p>`;
  }

  // ---------- Geometry helpers (county lookup, centroids) ----------
  const rings = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inFeature = (pt, f) => rings(f).some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)));
  const countyAt = (lat, lng) => (COUNTIES ? (COUNTIES.features.find((f) => inFeature([lng, lat], f)) || {}).properties?.name || null : null);
  function centroid(f) {
    let best = null, bestArea = -1;
    for (const poly of rings(f)) {
      const r = poly[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const k = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += k; cx += (r[j][0] + r[i][0]) * k; cy += (r[j][1] + r[i][1]) * k;
      }
      a /= 2; if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cx / (6 * a), cy / (6 * a)]; }
    }
    return { lat: +best[1].toFixed(3), lng: +best[0].toFixed(3) };
  }
  const inNY = (lat, lng) => !COUNTIES || !!countyAt(lat, lng);

  // ---------- Entities: my places, saved spots, and the spot you tapped ----------
  const ents = SITES.map((s) => ({ ...s, w: null, soil: null, kind: s.kind || "region", type: "place" }));
  const loadSaved = () => safe(() => JSON.parse(localStorage.getItem("claySpots"))) || [];
  const storeSaved = () => safe(() => localStorage.setItem("claySpots", JSON.stringify(saved.map(({ name, lat, lng, county }) => ({ name, lat, lng, county })))));
  const saved = loadSaved().map((s) => ({ ...s, w: null, soil: null, kind: "region", type: "saved" }));
  let picked = null, sel = null;
  const everything = () => [...ents, ...saved];

  const pinIcon = (e, key) => L.divIcon({
    className: "", iconSize: [20, 20], iconAnchor: [10, 10],
    html: `<div class="pin ${e.kind === "restricted" ? "restricted" : ""} ${e.type === "saved" ? "saved" : ""} ${e.type === "pick" ? "pick" : ""}" style="background:${STATES[key].color}"></div>`,
  });
  const accessLabel = { restricted: "Collecting restricted", unknown: "Permission needed", permitted: "Permission granted" };
  const kindText = (e) => e.type === "pick" ? "Selected spot" : e.type === "saved" ? "Saved spot" : "";

  function popupHtml(e) {
    const c = conditions(e.w, date), st = STATES[c.key], m = c.metrics;
    const metrics = c.key === "nodata" ? "" : `<dl class="facts">
      ${m.soilT != null ? `<dt>Soil temp</dt><dd>${F(m.soilT).toFixed(0)}°F</dd>` : ""}
      ${m.soilM != null ? `<dt>Soil moisture</dt><dd>${Math.round(m.soilM * 100)}%</dd>` : ""}
      ${m.snow ? `<dt>Snow depth</dt><dd>${(m.snow * 39.37).toFixed(1)} in</dd>` : ""}
      ${m.rain3 != null ? `<dt>Rain, last 3 days</dt><dd>${inch(m.rain3).toFixed(2)} in</dd>` : ""}
      ${m.tmax != null ? `<dt>Air high / low</dt><dd>${F(m.tmax).toFixed(0)}° / ${F(m.tmin).toFixed(0)}°F</dd>` : ""}</dl>`;
    const head = e.type === "place"
      ? `<span class="tag ${e.kind === "restricted" ? "restricted" : ""}">${esc(accessLabel[e.access] || "Permission needed")}</span><h3>${esc(e.name)}</h3><div>${esc(e.county)} County</div><p>${esc(e.notes)}</p>`
      : `<span class="tag">${kindText(e)}</span><h3>${esc(e.name || (e.county ? e.county + " County spot" : "Selected spot"))}</h3><div>${e.county ? esc(e.county) + " County · " : ""}${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}</div>`;
    const actions = `<div class="popup-actions">
      ${e.type === "pick" ? `<button type="button" data-act="save">Save this spot</button>` : ""}
      ${e.type === "saved" ? `<button type="button" data-act="remove">Remove</button>` : ""}
      <button type="button" data-act="share">Copy link</button>
      <a href="https://www.google.com/maps?q=${e.lat},${e.lng}" target="_blank" rel="noopener">Directions</a></div>`;
    return `${head}
      <p class="sub">Conditions on ${esc(pretty(date))}</p>
      <div class="cond"><span class="dot" style="background:${st.color}"></span>${esc(st.label)}</div>
      <div class="small">${esc(st.help)}</div>${metrics}
      <p class="sub">Soil survey (USDA)</p>${soilHtml(e.soil)}${actions}`;
  }
  async function fillSoil(e) {
    if (e.soil && e.soil !== "loading" && e.soil !== "error") return;
    e.soil = "loading"; refreshPopup(e);
    try { e.soil = await loadSoil(e.lat, e.lng); } catch (err) { e.soil = "error"; }
    refreshPopup(e);
  }
  function refreshPopup(e) { if (e.marker && e.marker.isPopupOpen()) e.marker.getPopup().setContent(popupHtml(e)); }

  const sitesLayer = L.layerGroup().addTo(map);
  const savedLayer = L.layerGroup().addTo(map);
  function addMarker(e, layer) {
    e.marker = L.marker([e.lat, e.lng], { icon: pinIcon(e, "nodata"), title: e.name || "Selected spot" }).addTo(layer);
    e.marker.bindPopup(() => popupHtml(e));
    e.marker.on("popupopen", () => { select(e); fillSoil(e); });
  }
  ents.forEach((e) => addMarker(e, sitesLayer));
  saved.forEach((e) => addMarker(e, savedLayer));
  $("#count").textContent = "(" + ents.length + ")";
  $("#lyr-sites").addEventListener("change", (e) => (e.target.checked ? sitesLayer.addTo(map) : map.removeLayer(sitesLayer)));

  // Popup buttons (delegated, because popup contents are rebuilt when the date changes)
  $("#map").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]"); if (!b || !sel) return;
    if (b.dataset.act === "save") saveSpot(sel);
    if (b.dataset.act === "remove") removeSpot(sel);
    if (b.dataset.act === "share") shareLink(sel, b);
  });
  function shareLink(e, btn) {
    const url = `${location.origin}${location.pathname}#d=${date}&lat=${e.lat.toFixed(4)}&lng=${e.lng.toFixed(4)}`;
    const done = () => (btn.textContent = "Copied");
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("Copy this link:", url)); else prompt("Copy this link:", url);
  }
  function saveSpot(e) {
    const name = prompt("Name this spot:", e.county ? e.county + " County spot" : "My spot");
    if (!name) return;
    const s = { name: name.trim().slice(0, 60), lat: e.lat, lng: e.lng, county: e.county, w: e.w, soil: e.soil, kind: "region", type: "saved" };
    saved.push(s); addMarker(s, savedLayer); storeSaved();
    if (picked) { map.removeLayer(picked.marker); picked = null; }
    render(); s.marker.setIcon(pinIcon(s, conditions(s.w, date).key)); s.marker.openPopup();
  }
  function removeSpot(e) {
    const i = saved.indexOf(e); if (i < 0) return;
    map.removeLayer(e.marker); saved.splice(i, 1); storeSaved();
    if (sel === e) select(null);
    render();
  }

  // ---------- Tap anywhere ----------
  async function pick(lat, lng, open = true) {
    if (!inNY(lat, lng)) { $("#summary").textContent = "That spot is outside New York State."; return; }
    if (picked) map.removeLayer(picked.marker);
    picked = { lat, lng, type: "pick", kind: "region", name: "", county: countyAt(lat, lng), w: null, soil: null };
    picked.marker = L.marker([lat, lng], { icon: pinIcon(picked, "nodata") }).addTo(map);
    picked.marker.bindPopup(() => popupHtml(picked));
    picked.marker.on("popupopen", () => { select(picked); fillSoil(picked); });
    if (open) picked.marker.openPopup();
    const mine = picked;
    try { [mine.w] = await loadWeather([mine], { past: PAST, future: FUTURE }); } catch (err) { mine.w = null; }
    if (picked !== mine) return;
    mine.marker.setIcon(pinIcon(mine, conditions(mine.w, date).key));
    refreshPopup(mine); drawSelection();
  }
  map.on("click", (ev) => pick(ev.latlng.lat, ev.latlng.lng));

  // ---------- Selected-spot panel: 3-month timeline + next good day ----------
  function select(e) { sel = e; drawSelection(); }
  function drawSelection() {
    const e = sel;
    $("#sel-hint").hidden = !!e; $("#sel-body").hidden = !e;
    if (!e) { $("#sel-title").textContent = "Selected spot"; return; }
    $("#sel-title").textContent = e.name || (e.county ? e.county + " County spot" : "Selected spot");
    const bars = ALL_DAYS.map((d, i) => {
      const k = conditions(e.w, d).key;
      return `<rect data-d="${d}" x="${i * 4}" y="0" width="4" height="40" fill="${STATES[k].color}"><title>${esc(weekday(d))}: ${esc(STATES[k].label)}</title></rect>`;
    }).join("");
    const xi = ALL_DAYS.indexOf(date), xt = ALL_DAYS.indexOf(TODAY);
    $("#timeline").innerHTML = bars +
      `<rect x="${xt * 4 + 1.5}" y="0" width="1" height="44" fill="#1d2b33" opacity=".35" pointer-events="none"/>` +
      `<rect x="${xi * 4 - 1}" y="0" width="6" height="44" fill="none" stroke="#1d2b33" stroke-width="1.5" pointer-events="none"/>`;
    const next = nextGood(e, date), good14 = ALL_DAYS.filter((d) => d >= date && d <= iso(addDays(parse(date), 13)) && conditions(e.w, d).key === "good").length;
    $("#sel-next").innerHTML = !e.w ? "Loading conditions…"
      : next ? `Next good digging day: <strong>${esc(weekday(next))}</strong>${next === date ? " (that's the selected date)" : ""}. ${good14} good day${good14 === 1 ? "" : "s"} in the following two weeks.`
      : "No good digging day from this date through the forecast.";
  }
  function nextGood(e, from) { return ALL_DAYS.find((d) => d >= from && conditions(e.w, d).key === "good") || null; }
  $("#timeline").addEventListener("click", (ev) => { const r = ev.target.closest("rect[data-d]"); if (r) setDate(r.dataset.d); });
  $("#nextgood").addEventListener("click", () => {
    const e = sel || ents[0]; if (!e) return;
    const from = iso(addDays(parse(date), 1)), n = nextGood(e, from);
    if (n) setDate(n); else $("#date-note").textContent = "No good day ahead for " + (e.name || "this spot");
  });

  // ---------- County map: conditions across the whole state ----------
  let countyLayer = null, countyW = {}, countyToken = 0;
  const countyFeats = COUNTIES ? COUNTIES.features.map((f) => ({ f, ...centroid(f) })) : [];
  function paintCounties() {
    if (!countyLayer) return;
    countyLayer.eachLayer((l) => {
      const c = l.feature._c, w = countyW[date] && countyW[date][c.f.id];
      const k = conditions(w, date).key; l.feature._k = k;
      l.setStyle({ fillColor: STATES[k].color, fillOpacity: k === "nodata" ? 0.08 : 0.42, color: "#ffffff", weight: 1, opacity: 0.7 });
      l.setTooltipContent(`<span class="county-tip"><strong>${esc(c.f.properties.name)} County</strong><br>${esc(STATES[k].label)}</span>`);
    });
  }
  if (COUNTIES) {
    countyLayer = L.geoJSON(COUNTIES, {
      pane: "counties",
      style: { fillColor: STATES.nodata.color, fillOpacity: 0.08, color: "#fff", weight: 1 },
      onEachFeature: (f, l) => { f._c = countyFeats.find((c) => c.f.id === f.id); l.bindTooltip("", { sticky: true }); },
    }).addTo(map);
  }
  async function loadCounties() {
    if (!countyLayer || !$("#lyr-counties").checked) return;
    const st = $("#county-status"), d = date;
    if (countyW[d]) { paintCounties(); return; }
    const token = ++countyToken; st.className = "status"; st.textContent = "loading…";
    try {
      const res = await loadWeather(countyFeats, { start: iso(addDays(parse(d), -2)), end: d });
      const map_ = {}; countyFeats.forEach((c, i) => (map_[c.f.id] = res[i]));
      countyW[d] = map_;
      if (token === countyToken) { st.textContent = ""; paintCounties(); renderSummary(); }
    } catch (err) {
      if (token === countyToken) { st.className = "status err"; st.textContent = "unavailable right now"; }
    }
  }
  let countyTimer;
  const queueCounties = () => { clearTimeout(countyTimer); countyTimer = setTimeout(loadCounties, 300); };
  $("#lyr-counties").addEventListener("change", (e) => {
    if (e.target.checked) { countyLayer.addTo(map); loadCounties(); } else { map.removeLayer(countyLayer); $("#county-status").textContent = ""; }
  });

  // ---------- Search and "use my location" ----------
  $("#search-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = $("#search").value.trim(), box = $("#results");
    if (!q) return;
    box.hidden = false; box.innerHTML = `<li class="tiny muted" style="padding:8px 12px">Searching…</li>`;
    try {
      const data = await get("https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&country_code=US&name=" + encodeURIComponent(q));
      const hits = (data.results || []).filter((r) => r.admin1 === "New York").slice(0, 5);
      if (!hits.length) { box.innerHTML = `<li class="tiny muted" style="padding:8px 12px">No New York place found for “${esc(q)}”.</li>`; return; }
      box.innerHTML = hits.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}${r.admin2 ? ", " + esc(r.admin2) + " County" : ""}</button></li>`).join("");
      box.onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        const r = hits[b.dataset.i]; box.hidden = true; map.setView([r.latitude, r.longitude], 11); pick(r.latitude, r.longitude);
      };
    } catch (err) { box.innerHTML = `<li class="tiny muted" style="padding:8px 12px">Search is unavailable right now.</li>`; }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".finder")) $("#results").hidden = true; });
  $("#locate").addEventListener("click", () => {
    if (!navigator.geolocation) { $("#summary").textContent = "Your browser can't share a location."; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { map.setView([p.coords.latitude, p.coords.longitude], 11); pick(p.coords.latitude, p.coords.longitude); },
      () => { $("#summary").textContent = "Couldn't get your location. Check your browser's location permission."; });
  });

  // ---------- Rendering for the chosen date ----------
  const SEASON = [
    "Deep winter: the ground is usually frozen solid and snow-covered. Plan your digging and sketch sites.",
    "Late winter: still frozen in the mornings. Spring thaw is close.",
    "Mud season: thaw plus snowmelt leaves clay saturated and sticky. Wait for it to firm up.",
    "Spring: banks thaw and drain. Good digging windows open up between rains.",
    "Late spring: a good time for digging when it hasn't rained for a few days.",
    "Early summer: clay is usually workable and stream banks are low and firm.",
    "Midsummer: dry spells harden clay. Dig after a light rain.",
    "Late summer: low water exposes stream banks. Clay can be rock-hard if it's been dry.",
    "Early fall: one of the best seasons, with firm ground and low water.",
    "Fall: leaves drop and rains return. Dig on dry days before the first freeze.",
    "Late fall: the first freezes arrive. Finish up before the ground locks.",
    "Early winter: freezing nights and snow end the digging season.",
  ];
  function renderSummary() {
    const counts = {}; let total = 0;
    const cw = countyW[date];
    if (cw && $("#lyr-counties").checked) {
      countyFeats.forEach((c) => { const k = conditions(cw[c.f.id], date).key; counts[k] = (counts[k] || 0) + 1; total++; });
      const g = counts.good || 0;
      $("#summary").textContent = `${g} of ${total} counties look good for digging${everything().length ? `; ${everything().filter((e) => e.cond === "good").length} of ${everything().length} of your places do` : ""}.`;
    } else {
      const list = everything(); list.forEach((e) => { counts[e.cond] = (counts[e.cond] || 0) + 1; }); total = list.length;
      $("#summary").textContent = !total ? "" : counts.nodata === total ? "Conditions aren't available right now." : `${counts.good || 0} of ${total} places look good for digging.`;
    }
    $("#legend").innerHTML = Object.entries(STATES).filter(([k]) => k !== "nodata" || counts.nodata)
      .map(([k, s]) => `<li><span class="dot" style="background:${s.color}"></span>${esc(s.label)}${counts[k] ? ` (${counts[k]})` : ""}</li>`).join("");
  }
  const listHtml = (arr, attr) => arr.map((e, i) =>
    `<li><button data-${attr}="${i}"><span class="row"><span class="dot" style="background:${STATES[e.cond].color}"></span><strong>${esc(e.name)}</strong></span><span class="state">${esc(e.county || "")}${e.county ? " County · " : ""}${esc(STATES[e.cond].label)}</span></button></li>`).join("");

  function render() {
    $("#date-label").textContent = pretty(date);
    $("#date-note").textContent = date === TODAY ? "Today" : date > TODAY ? "Forecast" : "Past conditions";
    $("#season").textContent = SEASON[parse(date).getMonth()];
    dateInput.value = date;
    slider.value = Math.round((parse(date) - parse(TODAY)) / 864e5);
    everything().forEach((e) => {
      e.cond = conditions(e.w, date).key;
      if (e.marker) { e.marker.setIcon(pinIcon(e, e.cond)); refreshPopup(e); }
    });
    if (picked) { picked.marker.setIcon(pinIcon(picked, conditions(picked.w, date).key)); refreshPopup(picked); }
    paintCounties(); renderSummary();
    $("#list").innerHTML = listHtml(ents, "i");
    $("#saved-list").innerHTML = listHtml(saved, "s");
    $("#saved-count").textContent = saved.length ? "(" + saved.length + ")" : "";
    $("#saved-empty").hidden = saved.length > 0;
    drawSelection();
    safe(() => history.replaceState(null, "", "#d=" + date + (sel ? `&lat=${sel.lat.toFixed(4)}&lng=${sel.lng.toFixed(4)}` : "")));
  }
  const goTo = (e) => { map.setView([e.lat, e.lng], Math.max(map.getZoom(), 10)); e.marker.openPopup(); $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("#list").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) goTo(ents[b.dataset.i]); });
  $("#saved-list").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) goTo(saved[b.dataset.s]); });

  function setDate(d) { if (d < MIN) d = MIN; if (d > MAX) d = MAX; date = d; render(); queueCounties(); }
  dateInput.addEventListener("change", () => dateInput.value && setDate(dateInput.value));
  slider.addEventListener("input", () => setDate(iso(addDays(parse(TODAY), Number(slider.value)))));
  $("#today").addEventListener("click", () => setDate(TODAY));
  $("#back7").addEventListener("click", () => setDate(iso(addDays(parse(date), -7))));
  $("#fwd7").addEventListener("click", () => setDate(iso(addDays(parse(date), 7))));

  render();
  queueCounties();
  const mine = everything();
  if (mine.length) {
    try { const ws = await loadWeather(mine, { past: PAST, future: FUTURE }); mine.forEach((e, i) => (e.w = ws[i])); }
    catch (err) { $("#summary").textContent = "Live weather data is unavailable right now."; }
    render();
  }
  // Open a shared spot
  const sl = parseFloat(hashParams.get("lat")), sg = parseFloat(hashParams.get("lng"));
  if (isFinite(sl) && isFinite(sg)) { map.setView([sl, sg], 11); pick(sl, sg); }

  // ---------- Optional overlays ----------
  const soilWms = L.tileLayer.wms("https://sdmdataaccess.sc.egov.usda.gov/Spatial/SDM.wms", {
    layers: "mapunitpoly", format: "image/png", transparent: true, opacity: 0.55, minZoom: 10, attribution: "USDA NRCS",
  });
  watchWms(soilWms, "#soil-status", "#lyr-soil", "zoom in to see soil areas");
  const geo = L.tileLayer.wms("https://mrdata.usgs.gov/services/ny", {
    layers: "ny", format: "image/png", transparent: true, opacity: 0.6, attribution: "USGS",
  });
  watchWms(geo, "#geo-status", "#lyr-geo", "");
  function watchWms(layer, statusSel, boxSel, hint) {
    let errors = 0;
    layer.on("tileerror", () => { if (++errors === 3) { $(statusSel).className = "status err"; $(statusSel).textContent = "unavailable right now"; } });
    layer.on("load", () => { if (!errors) $(statusSel).textContent = hint; });
    $(boxSel).addEventListener("change", (e) => {
      if (e.target.checked) { errors = 0; $(statusSel).className = "status"; $(statusSel).textContent = hint || "loading…"; layer.addTo(map); }
      else { map.removeLayer(layer); $(statusSel).textContent = ""; }
    });
  }
  const mrds = L.layerGroup();
  let mrdsLoaded = false;
  async function loadMrds() {
    const st = $("#mrds-status"); st.className = "status"; st.textContent = "loading…";
    const url = "https://mrdata.usgs.gov/services/mrds?service=WFS&version=1.1.0&request=GetFeature&typename=mrds" +
      "&outputformat=geojson&srsname=EPSG:4326&bbox=" + [NY.getWest(), NY.getSouth(), NY.getEast(), NY.getNorth()].join(",") + ",EPSG:4326";
    try {
      const data = await get(url);
      const clay = (data.features || []).filter((f) => /clay|kaolin|shale/i.test(JSON.stringify(f.properties || {})));
      L.geoJSON({ type: "FeatureCollection", features: clay }, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: "#fff", weight: 2, fillColor: "#3d5a8c", fillOpacity: 1 }),
        onEachFeature: (f, l) => {
          const p = f.properties || {};
          l.bindPopup(`<span class="tag">USGS record</span><h3>${esc(p.site_name || p.name || "Clay occurrence")}</h3><div>${esc(p.county || "")}</div><p>${esc(p.commod1 || p.commodity || "")}</p>`);
        },
      }).addTo(mrds);
      mrdsLoaded = true; st.textContent = clay.length + " found";
    } catch (e) {
      st.className = "status err"; st.textContent = "unavailable right now";
      $("#lyr-mrds").checked = false;
    }
  }
  $("#lyr-mrds").addEventListener("change", async (e) => {
    if (e.target.checked) { if (!mrdsLoaded) await loadMrds(); if (e.target.checked) mrds.addTo(map); }
    else map.removeLayer(mrds);
  });
})();
