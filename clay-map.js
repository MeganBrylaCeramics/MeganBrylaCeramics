// New York clay soil map.
// Pick a date and see how workable the clay is across the state (by county), at my clay places,
// at any spot you tap, and at spots you save. Live data: Open-Meteo (soil temperature, soil moisture,
// snow, rain) and USDA NRCS Soil Data Access (soil survey).
(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u; } };
  const get = (u) => fetch(u).catch(() => { throw new Error("Couldn't reach " + hostOf(u)); })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status + " from " + hostOf(u)); return r.json(); });
  const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "#");
  const safe = (fn) => { try { return fn(); } catch (e) { return null; } };

  let SHOP = {}, SITES = [], COUNTIES = null, COMMUNITY = { groups: [], guides: [], rules: [] };
  try { SHOP = await get("store.json"); } catch (e) {}
  try { SITES = (await get("content/clay-sites.json")).sites || []; } catch (e) {}
  try { COUNTIES = await get("content/ny-counties.json"); } catch (e) {}
  try { COMMUNITY = await get("content/clay-community.json"); } catch (e) {}
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
    terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, subdomains: "abc", attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)" }),
    topo: L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "USGS The National Map" }),
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Esri, Maxar, Earthstar" }),
  };
  let current = base.terrain.addTo(map), baseErrors = 0;
  function useBase(k) { baseErrors = 0; map.removeLayer(current); current = base[k].addTo(map); current.bringToBack(); $("#basemap").value = k; }
  $("#basemap").addEventListener("change", (e) => useBase(e.target.value));
  // If a base map's server can't be reached, switch to the street map so the page never shows a blank map.
  Object.entries(base).forEach(([k, layer]) => layer.on("tileerror", () => {
    if (current === layer && k !== "osm" && ++baseErrors === 6) { useBase("osm"); $("#basemap-note").textContent = "That base map didn't load, so I switched to the street map."; }
  }));
  const streams = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, opacity: 0.9, attribution: "USGS National Hydrography" });
  let streamErrors = 0;
  streams.on("tileerror", () => { if (++streamErrors === 6) { $("#streams-status").className = "status err"; $("#streams-status").textContent = "unavailable right now"; } });
  $("#lyr-streams").addEventListener("change", (e) => {
    if (e.target.checked) { streamErrors = 0; $("#streams-status").textContent = ""; streams.addTo(map); } else map.removeLayer(streams);
  });
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

  // ---------- My own model: typical conditions for a place and date ----------
  // Used whenever live weather isn't available. Climate comes from latitude, region and day of year:
  // air temperature follows a yearly curve, soil temperature lags it, and wetness peaks in the March-April
  // thaw and bottoms out in late summer.
  const inBox = (lat, lng, a, b, c, d) => lat >= a && lat <= b && lng >= c && lng <= d;
  function climate(lat, lng) {
    let Tm = 55.5 - 3.0 * (lat - 40.7), A = 24;               // yearly mean and swing, °F
    const coastal = lat < 41.3 && lng > -74.3;
    if (coastal) { A = 21; Tm += 0.5; }
    const mountains = inBox(lat, lng, 43.3, 44.9, -75.5, -73.4) || inBox(lat, lng, 41.9, 42.4, -75.0, -74.0);
    if (mountains) Tm -= 3;
    const snowBelt = mountains || inBox(lat, lng, 43.3, 44.1, -76.2, -75.0) || inBox(lat, lng, 42.2, 42.9, -79.3, -78.5);
    return { Tm, A, snowBelt };
  }
  const doyOf = (day) => { const d = parse(day); return Math.round((d - new Date(d.getFullYear(), 0, 0)) / 864e5); };
  function modelConditions(lat, lng, day) {
    const doy = doyOf(day), { Tm, A, snowBelt } = climate(lat, lng), r = 2 * Math.PI / 365;
    const air = Tm - A * Math.cos(r * (doy - 20));
    const soil = Tm - 0.9 * A * Math.cos(r * (doy - 27));
    const wet = 0.52 + 0.26 * Math.cos(r * (doy - 75)) + (snowBelt ? 0.04 : 0);
    const snowy = air < (snowBelt ? 32 : 28);
    let key = "good";
    if (soil <= 34 || snowy) key = "frozen"; else if (wet > 0.68) key = "wet"; else if (wet < 0.28) key = "dry";
    const C = (f) => (f - 32) * 5 / 9;
    return { key, source: "model", metrics: { soilT: C(soil), wetIdx: wet, tmax: C(air + 8), tmin: C(air - 8), snow: snowy ? 0.05 : 0 } };
  }
  // Live data when we have it for that day, otherwise the model.
  function condFor(e, day) {
    const live = conditions(e.w, day);
    return live.key !== "nodata" ? { ...live, source: "live" } : modelConditions(e.lat, e.lng, day);
  }

  // Rough clay potential by county (0 to 3), from general glacial geology. My own estimate, not survey data.
  const GEO = {
    hudson:   { pot: 3, note: "Glacial Lake Albany and Hudson River clay beds, the old brickmaking belt." },
    hudson2:  { pot: 2, note: "Some glacial lake clay along the Hudson and its valleys." },
    champ:    { pot: 3, note: "Champlain Sea and glacial lake clays in the valley lowlands." },
    champ2:   { pot: 2, note: "Clay in the valley lowlands; mountains are mostly thin till and rock." },
    ontario:  { pot: 3, note: "Glacial lake plain clays near the Great Lakes." },
    plain:    { pot: 2, note: "Lake-bed and plain clays in the valleys and lowlands." },
    till:     { pot: 1, note: "Mostly glacial till and hills. Clay is mainly in valley bottoms and stream banks." },
    rock:     { pot: 0, note: "Mostly bedrock and thin soil. Little clay." },
    li:       { pot: 2, note: "Cretaceous clay beds under glacial deposits, often deep or built over." },
    urban:    { pot: 1, note: "Mostly built over. Clay is hard to reach." },
  };
  const COUNTY_GEO = {
    Albany: "hudson", Rensselaer: "hudson", Columbia: "hudson", Greene: "hudson", Ulster: "hudson", Dutchess: "hudson", Rockland: "hudson", Washington: "hudson",
    Orange: "hudson2", Westchester: "hudson2", Saratoga: "hudson2", Schenectady: "hudson2", Putnam: "till",
    Clinton: "champ", "St. Lawrence": "champ", Essex: "champ2", Franklin: "champ2", Jefferson: "plain", Lewis: "till", Warren: "till", Fulton: "till", Hamilton: "rock",
    Niagara: "ontario", Monroe: "ontario", Wayne: "ontario",
    Orleans: "plain", Oswego: "plain", Cayuga: "plain", Genesee: "plain", Erie: "plain", Chautauqua: "plain", Livingston: "plain", Ontario: "plain", Seneca: "plain", Yates: "plain",
    Onondaga: "plain", Oneida: "plain", Montgomery: "plain", Tompkins: "plain",
    Madison: "till", Herkimer: "till", Wyoming: "till", Allegany: "till", Cattaraugus: "till", Steuben: "till", Chemung: "till", Schuyler: "till", Tioga: "till", Broome: "till",
    Chenango: "till", Cortland: "till", Otsego: "till", Delaware: "till", Sullivan: "till", Schoharie: "till",
    Suffolk: "li", Nassau: "li", Richmond: "li", Queens: "urban", Kings: "urban", Bronx: "urban", "New York": "urban",
  };
  const POT_LABEL = ["Very low", "Low", "Moderate", "High"];
  const geoOf = (county) => (county && GEO[COUNTY_GEO[county]]) || null;

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
  let picked = null, sel = null, weatherError = "";
  const everything = () => [...ents, ...saved];

  const pinIcon = (e, key) => L.divIcon({
    className: "", iconSize: [20, 20], iconAnchor: [10, 10],
    html: `<div class="pin ${e.kind === "restricted" ? "restricted" : ""} ${e.type === "saved" ? "saved" : ""} ${e.type === "pick" ? "pick" : ""}" style="background:${STATES[key].color}"></div>`,
  });
  const accessLabel = { restricted: "Collecting restricted", unknown: "Permission needed", permitted: "Permission granted" };
  const kindText = (e) => e.type === "pick" ? "Selected spot" : e.type === "saved" ? "Saved spot" : "";

  function popupHtml(e) {
    const c = condFor(e, date), st = STATES[c.key], m = c.metrics, est = c.source === "model";
    const wetWord = (w) => (w > 0.68 ? "High" : w > 0.45 ? "Moderate" : "Low");
    const metrics = est ? `<dl class="facts">
      <dt>Soil temp (est.)</dt><dd>${F(m.soilT).toFixed(0)}°F</dd>
      <dt>Soil wetness (est.)</dt><dd>${wetWord(m.wetIdx)}</dd>
      <dt>Air high / low (typical)</dt><dd>${F(m.tmax).toFixed(0)}° / ${F(m.tmin).toFixed(0)}°F</dd></dl>` : `<dl class="facts">
      ${m.soilT != null ? `<dt>Soil temp</dt><dd>${F(m.soilT).toFixed(0)}°F</dd>` : ""}
      ${m.soilM != null ? `<dt>Soil moisture</dt><dd>${Math.round(m.soilM * 100)}%</dd>` : ""}
      ${m.snow ? `<dt>Snow depth</dt><dd>${(m.snow * 39.37).toFixed(1)} in</dd>` : ""}
      ${m.rain3 != null ? `<dt>Rain, last 3 days</dt><dd>${inch(m.rain3).toFixed(2)} in</dd>` : ""}
      ${m.tmax != null ? `<dt>Air high / low</dt><dd>${F(m.tmax).toFixed(0)}° / ${F(m.tmin).toFixed(0)}°F</dd>` : ""}</dl>`;
    const geo = geoOf(e.county || countyAt(e.lat, e.lng));
    const head = e.type === "place"
      ? `<span class="tag ${e.kind === "restricted" ? "restricted" : ""}">${esc(accessLabel[e.access] || "Permission needed")}</span><h3>${esc(e.name)}</h3><div>${esc(e.county)} County</div><p>${esc(e.notes)}</p>${e.source ? `<p class="src">${/^https?:\/\//.test(e.source) ? `<a href="${esc(e.source)}" target="_blank" rel="noopener">Source</a>` : "Source: " + esc(e.source)}</p>` : ""}`
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
      <p class="small">${est ? "Estimate: typical conditions for this date at this location. It can't know this year's actual weather." : "Live weather data."}</p>
      ${geo ? `<p class="sub">Regional clay potential</p><div class="cond">${POT_LABEL[geo.pot]} <span class="muted">(my estimate)</span></div><div class="small">${esc(geo.note)}</div>` : ""}
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
    render(); s.marker.setIcon(pinIcon(s, condFor(s, date).key)); s.marker.openPopup();
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
    picked.marker = L.marker([lat, lng], { icon: pinIcon(picked, condFor(picked, date).key) }).addTo(map);
    picked.marker.bindPopup(() => popupHtml(picked));
    picked.marker.on("popupopen", () => { select(picked); fillSoil(picked); });
    if (open) picked.marker.openPopup();
    const mine = picked;
    try { [mine.w] = await loadWeather([mine], { past: PAST, future: FUTURE }); } catch (err) { mine.w = null; weatherError = err.message; }
    if (picked !== mine) return;
    mine.marker.setIcon(pinIcon(mine, condFor(mine, date).key));
    refreshPopup(mine); drawSelection(); updateStatus();
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
      const k = condFor(e, d).key;
      return `<rect data-d="${d}" x="${i * 4}" y="0" width="4" height="40" fill="${STATES[k].color}"><title>${esc(weekday(d))}: ${esc(STATES[k].label)}</title></rect>`;
    }).join("");
    const xi = ALL_DAYS.indexOf(date), xt = ALL_DAYS.indexOf(TODAY);
    $("#timeline").innerHTML = bars +
      `<rect x="${xt * 4 + 1.5}" y="0" width="1" height="44" fill="#1d2b33" opacity=".35" pointer-events="none"/>` +
      `<rect x="${xi * 4 - 1}" y="0" width="6" height="44" fill="none" stroke="#1d2b33" stroke-width="1.5" pointer-events="none"/>`;
    const next = nextGood(e, date), good14 = ALL_DAYS.filter((d) => d >= date && d <= iso(addDays(parse(date), 13)) && condFor(e, d).key === "good").length;
    $("#sel-next").innerHTML = next ? `Next good digging day: <strong>${esc(weekday(next))}</strong>${next === date ? " (that's the selected date)" : ""}. ${good14} good day${good14 === 1 ? "" : "s"} in the following two weeks.`
      : "No good digging day from this date through the forecast.";
  }
  function nextGood(e, from) { return ALL_DAYS.find((d) => d >= from && condFor(e, d).key === "good") || null; }
  $("#timeline").addEventListener("click", (ev) => { const r = ev.target.closest("rect[data-d]"); if (r) setDate(r.dataset.d); });
  $("#nextgood").addEventListener("click", () => {
    const e = sel || ents[0]; if (!e) return;
    const from = iso(addDays(parse(date), 1)), n = nextGood(e, from);
    if (n) setDate(n); else $("#date-note").textContent = "No good day ahead for " + (e.name || "this spot");
  });

  // ---------- County map: conditions across the whole state ----------
  let countyLayer = null, countyW = {}, countyToken = 0;
  const countyFeats = COUNTIES ? COUNTIES.features.map((f) => ({ f, ...centroid(f) })) : [];
  let mode = "cond"; // cond = digging conditions, clay = clay potential, best = best bets
  const POT_COLORS = ["#efe6d8", "#dcc79c", "#c19a5b", "#8f5a2b"];
  const WORK = { good: 1, dry: 0.45, wet: 0.35, frozen: 0, nodata: 0 };
  const BEST_BINS = [[0, "#cfd6da", "Not now"], [0.7, "#bfe0c8", "Fair"], [1.4, "#86c49b", "Good"], [2.2, "#4fa876", "Very good"], [99, "#2c7f52", "Best"]];
  const countyCond = (c) => condFor({ lat: c.lat, lng: c.lng, w: countyW[date] && countyW[date][c.f.id] }, date);
  const countyPot = (c) => (geoOf(c.f.properties.name) || { pot: 0 }).pot;
  const bestScore = (c) => countyPot(c) * WORK[countyCond(c).key];
  const binOf = (sc) => (sc <= 0 ? 0 : sc <= 0.7 ? 1 : sc <= 1.4 ? 2 : sc <= 2.2 ? 3 : 4);
  function paintCounties() {
    if (!countyLayer) return;
    countyLayer.eachLayer((l) => {
      const c = l.feature._c, name = c.f.properties.name, cc = countyCond(c), pot = countyPot(c);
      let fill, tip;
      if (mode === "clay") { fill = POT_COLORS[pot]; tip = `${POT_LABEL[pot]} clay potential (my estimate)`; }
      else if (mode === "best") { const b = binOf(bestScore(c)); fill = BEST_BINS[b][1]; tip = `${BEST_BINS[b][2]}: ${STATES[cc.key].label.toLowerCase()}, ${POT_LABEL[pot].toLowerCase()} clay potential`; }
      else { fill = STATES[cc.key].color; tip = STATES[cc.key].label + (cc.source === "model" ? " (typical)" : ""); }
      l.setStyle({ fillColor: fill, fillOpacity: 0.5, color: "#ffffff", weight: 1, opacity: 0.8 });
      l.setTooltipContent(`<span class="county-tip"><strong>${esc(name)} County</strong><br>${esc(tip)}</span>`);
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
    if (countyW[d]) { paintCounties(); renderSummary(); return; }
    const token = ++countyToken; st.className = "status"; st.textContent = "loading…";
    try {
      const res = await loadWeather(countyFeats, { start: iso(addDays(parse(d), -2)), end: d });
      const map_ = {}; countyFeats.forEach((c, i) => (map_[c.f.id] = res[i]));
      countyW[d] = map_;
      if (token === countyToken) { st.textContent = ""; paintCounties(); renderSummary(); updateStatus(); }
    } catch (err) {
      weatherError = err.message;
      if (token === countyToken) { st.className = "status"; st.textContent = "using estimates"; }
      updateStatus();
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
    const hasCounties = countyLayer && $("#lyr-counties").checked;
    const lines = (items) => items.map(([color, label, n]) => `<li><span class="dot" style="background:${color}"></span>${esc(label)}${n ? ` (${n})` : ""}</li>`).join("");
    if (hasCounties && mode === "clay") {
      const n = [0, 0, 0, 0]; countyFeats.forEach((c) => n[countyPot(c)]++);
      $("#summary").textContent = "Clay potential by county is my own rough estimate from general glacial geology. It does not change with the date.";
      $("#legend").innerHTML = lines([3, 2, 1, 0].map((p) => [POT_COLORS[p], POT_LABEL[p] + " potential", n[p]]));
    } else if (hasCounties && mode === "best") {
      const n = [0, 0, 0, 0, 0]; countyFeats.forEach((c) => n[binOf(bestScore(c))]++);
      $("#summary").textContent = "Best bets combine clay potential with how workable the ground is on this date.";
      $("#legend").innerHTML = lines([4, 3, 2, 1, 0].map((b) => [BEST_BINS[b][1], BEST_BINS[b][2], n[b]]));
    } else if (hasCounties) {
      const counts = {}; countyFeats.forEach((c) => { const k = countyCond(c).key; counts[k] = (counts[k] || 0) + 1; });
      const mine = everything(), mg = mine.filter((e) => e.cond === "good").length;
      $("#summary").textContent = `${counts.good || 0} of ${countyFeats.length} counties look good for digging${mine.length ? `; ${mg} of ${mine.length} of your places do` : ""}.`;
      $("#legend").innerHTML = lines(Object.entries(STATES).filter(([k]) => k !== "nodata").map(([k, st]) => [st.color, st.label, counts[k]]));
    } else {
      const list = everything(), counts = {}; list.forEach((e) => { counts[e.cond] = (counts[e.cond] || 0) + 1; });
      $("#summary").textContent = list.length ? `${counts.good || 0} of ${list.length} places look good for digging.` : "";
      $("#legend").innerHTML = lines(Object.entries(STATES).filter(([k]) => k !== "nodata").map(([k, st]) => [st.color, st.label, counts[k]]));
    }
    // Best bets list
    const ranked = countyFeats.map((c) => ({ c, sc: bestScore(c) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || countyPot(b.c) - countyPot(a.c)).slice(0, 6);
    $("#best-list").innerHTML = ranked.length
      ? ranked.map((x, i) => `<li><button data-b="${i}"><span class="row"><span class="dot" style="background:${BEST_BINS[binOf(x.sc)][1]}"></span><strong>${esc(x.c.f.properties.name)} County</strong></span><span class="state">${esc(POT_LABEL[countyPot(x.c)])} clay potential · ${esc(STATES[countyCond(x.c).key].label)}</span></button></li>`).join("")
      : `<li class="tiny muted">Nothing is workable on this date. The ground is frozen or too wet.</li>`;
    $("#best-list").bestRanked = ranked;
  }
  function updateStatus() {
    const live = everything().some((e) => e.w) || (picked && picked.w) || !!countyW[date];
    $("#data-status").className = "data-status " + (live ? "live" : "est");
    $("#data-status").innerHTML = live
      ? "<strong>Live weather connected.</strong> Colors use real soil and rain data where available."
      : "<strong>Showing estimates.</strong> Live weather isn't reachable, so colors show typical conditions for this date from my own climate model." +
        (weatherError ? `<span class="detail">Technical detail: ${esc(weatherError)}</span>` : "") + `<button type="button" id="retry-live">Retry</button>`;
    const rb = $("#retry-live"); if (rb) rb.onclick = retryLive;
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
      e.cond = condFor(e, date).key;
      if (e.marker) { e.marker.setIcon(pinIcon(e, e.cond)); refreshPopup(e); }
    });
    if (picked) { picked.marker.setIcon(pinIcon(picked, condFor(picked, date).key)); refreshPopup(picked); }
    paintCounties(); renderSummary(); updateStatus();
    $("#list").innerHTML = listHtml(ents, "i");
    $("#saved-list").innerHTML = listHtml(saved, "s");
    $("#saved-count").textContent = saved.length ? "(" + saved.length + ")" : "";
    $("#saved-empty").hidden = saved.length > 0;
    drawSelection();
    safe(() => history.replaceState(null, "", "#d=" + date + (sel ? `&lat=${sel.lat.toFixed(4)}&lng=${sel.lng.toFixed(4)}` : "")));
  }
  const goTo = (e) => { map.setView([e.lat, e.lng], Math.max(map.getZoom(), 10)); e.marker.openPopup(); $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("#best-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"), r = $("#best-list").bestRanked; if (!b || !r) return;
    const c = r[b.dataset.b].c; map.setView([c.lat, c.lng], 9); pick(c.lat, c.lng);
    $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#mode").addEventListener("change", (e) => { mode = e.target.value; paintCounties(); renderSummary(); });
  $("#list").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) goTo(ents[b.dataset.i]); });
  $("#saved-list").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) goTo(saved[b.dataset.s]); });

  function setDate(d) { if (d < MIN) d = MIN; if (d > MAX) d = MAX; date = d; render(); queueCounties(); }
  dateInput.addEventListener("change", () => dateInput.value && setDate(dateInput.value));
  slider.addEventListener("input", () => setDate(iso(addDays(parse(TODAY), Number(slider.value)))));
  $("#today").addEventListener("click", () => setDate(TODAY));
  $("#back7").addEventListener("click", () => setDate(iso(addDays(parse(date), -7))));
  $("#fwd7").addEventListener("click", () => setDate(iso(addDays(parse(date), 7))));

  async function loadMine() {
    const mine = everything(); if (!mine.length) return;
    try { const ws = await loadWeather(mine, { past: PAST, future: FUTURE }); mine.forEach((e, i) => (e.w = ws[i])); weatherError = ""; }
    catch (err) { weatherError = err.message; }
    render();
  }
  function retryLive() { weatherError = ""; countyW = {}; $("#data-status").textContent = "Retrying…"; loadCounties(); loadMine(); }

  render();
  queueCounties();
  loadMine();
  // Open a shared spot
  const sl = parseFloat(hashParams.get("lat")), sg = parseFloat(hashParams.get("lng"));
  if (isFinite(sl) && isFinite(sg)) { map.setView([sl, sg], 11); pick(sl, sg); }

  // ---------- Potters and wild clay groups ----------
  const communityLayer = L.layerGroup().addTo(map);
  (COMMUNITY.groups || []).filter((g) => g.lat != null && g.lng != null).forEach((g) => {
    L.marker([g.lat, g.lng], { title: g.name, icon: L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="pin community"></div>' }) })
      .addTo(communityLayer)
      .bindPopup(`<span class="tag">Potters &amp; wild clay</span><h3>${esc(g.name)}</h3><div>${esc(g.place)}</div><p>${esc(g.what)}</p><p class="src"><a href="${esc(safeUrl(g.url))}" target="_blank" rel="noopener">Visit their page</a></p><p class="small">The pin marks the town, not the studio's address.</p>`);
  });
  $("#lyr-community").addEventListener("change", (e) => (e.target.checked ? communityLayer.addTo(map) : map.removeLayer(communityLayer)));
  const refList = (arr, sel, withPlace) => { $(sel).innerHTML = (arr || []).map((x) =>
    `<li><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.name || x.title)}</a><span>${withPlace && x.place ? esc(x.place) + ". " : ""}${esc(x.what || x.note)}</span></li>`).join(""); };
  refList(COMMUNITY.groups, "#refs-groups", true); refList(COMMUNITY.guides, "#refs-guides"); refList(COMMUNITY.rules, "#refs-rules");

  // ---------- Stream and lake soil explorer ----------
  // Zoom in and every mapped stream, river, canal, lake and pond in view is loaded from OpenStreetMap.
  // Click one and the USDA soil survey is sampled at points along it.
  const waterLayer = L.layerGroup(), sampleLayer = L.layerGroup().addTo(map);
  let waterFeats = [], waterKey = "", waterTimer = null, waterOn = false, waterPopup = null;
  const CLAY_CLASSES = [
    { min: 40, color: "#7a4a2a", name: "Heavy clay" }, { min: 27, color: "#c08a4e", name: "Clay / clay loam" },
    { min: 15, color: "#e2c58f", name: "Loam" }, { min: 0, color: "#efe9dc", name: "Low clay" },
  ];
  const clayClass = (c) => (c == null ? null : CLAY_CLASSES.find((x) => c >= x.min));
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");
  const waterMinZoom = 11;

  async function loadWater() {
    if (!waterOn) return;
    const st = $("#water-status");
    if (map.getZoom() < waterMinZoom) { st.className = "status"; st.textContent = "zoom in to load"; waterLayer.clearLayers(); waterFeats = []; waterKey = ""; renderWaterList(); return; }
    const b = map.getBounds(), key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => x.toFixed(2)).join(",");
    if (key === waterKey) return;
    waterKey = key; st.className = "status"; st.textContent = "loading…";
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(",");
    const q = `[out:json][timeout:25];(way["waterway"~"^(river|stream|canal)$"](${bbox});way["natural"="water"](${bbox}););out geom tags 700;`;
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      drawWater((await res.json()).elements || []); st.textContent = "";
    } catch (err) { waterKey = ""; st.className = "status err"; st.textContent = "unavailable right now"; }
  }
  function drawWater(els) {
    waterLayer.clearLayers(); waterFeats = [];
    els.forEach((el) => {
      if (!el.geometry || el.geometry.length < 2) return;
      const t = el.tags || {}, coords = el.geometry.map((p) => [p.lat, p.lon]);
      const isLake = t.natural === "water" && coords.length > 3;
      const kind = isLake ? cap(t.water || "lake") : cap(t.waterway || "stream");
      const f = { name: t.name || "", kind, isLake, coords };
      f.layer = isLake
        ? L.polygon(coords, { color: "#2b7cb3", weight: 1.5, fillColor: "#7fb8de", fillOpacity: 0.45 })
        : L.polyline(coords, { color: "#1f6fa5", weight: 3, opacity: 0.9 });
      f.layer.bindTooltip(`<span class="water-tip"><strong>${esc(f.name || kind + " (unnamed)")}</strong><br>Click to check the soil</span>`, { sticky: true });
      f.layer.on("click", (ev) => { L.DomEvent.stop(ev); sampleWater(f, ev.latlng); });
      f.layer.addTo(waterLayer); waterFeats.push(f);
    });
    renderWaterList();
  }
  function renderWaterList() {
    const named = waterFeats.filter((f) => f.name);
    const seen = new Set(), list = named.filter((f) => !seen.has(f.name + f.kind) && seen.add(f.name + f.kind)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
    $("#water-count").textContent = waterFeats.length ? `(${waterFeats.length} mapped, ${list.length} named shown)` : "";
    $("#water-list").innerHTML = list.length ? list.map((f, i) => `<li><button data-w="${i}"><strong>${esc(f.name)}</strong><span class="state">${esc(f.kind)}</span></button></li>`).join("")
      : `<li class="tiny muted">${map.getZoom() < waterMinZoom ? "Zoom in to see streams and lakes." : "No named streams or lakes in this view."}</li>`;
    $("#water-list").shown = list;
  }
  $("#water-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"), f = b && $("#water-list").shown[b.dataset.w]; if (!f) return;
    map.fitBounds(f.layer.getBounds(), { maxZoom: 15 }); sampleWater(f, f.layer.getBounds().getCenter());
  });

  async function sampleWater(f, at) {
    sampleLayer.clearLayers();
    const n = Math.min(8, f.coords.length), pts = Array.from({ length: n }, (_, i) => f.coords[Math.round((i * (f.coords.length - 1)) / Math.max(1, n - 1))]);
    const title = esc(f.name || f.kind + " (unnamed)"), county = countyAt(pts[0][0], pts[0][1]), geo = geoOf(county);
    const head = `<span class="tag">${f.isLake ? "Lake / pond" : esc(f.kind)}</span><h3>${title}</h3>${county ? `<div>${esc(county)} County</div>` : ""}`;
    const foot = `${geo ? `<p class="sub">Regional clay potential</p><div class="cond">${POT_LABEL[geo.pot]} <span class="muted">(my estimate)</span></div><div class="small">${esc(geo.note)}</div>` : ""}
      <div class="popup-actions"><a href="https://www.google.com/maps?q=${pts[Math.floor(n / 2)][0]},${pts[Math.floor(n / 2)][1]}" target="_blank" rel="noopener">Directions</a></div>
      <p class="small">Check who owns the bank and ask first. Parks and state land usually forbid digging.</p>`;
    waterPopup = L.popup({ maxWidth: 320 }).setLatLng(at).setContent(`${head}<p class="small">Sampling the soil survey at ${n} points…</p>${foot}`).openOn(map);
    const results = await Promise.all(pts.map((p) => loadSoil(p[0], p[1]).catch(() => "err")));
    results.forEach((r, i) => {
      const c = r && r !== "err" ? clayClass(r.clay) : null;
      L.circleMarker(pts[i], { radius: 7, color: "#fff", weight: 2, fillColor: c ? c.color : "#9aa5ab", fillOpacity: 1 })
        .bindTooltip(r && r !== "err" ? `${r.clay != null ? r.clay + "% clay" : "no clay value"} · ${r.muname || ""}` : "no soil data here").addTo(sampleLayer);
    });
    const ok = results.filter((r) => r && r !== "err" && r.clay != null);
    let body;
    if (!ok.length) {
      body = `<p class="small">${results.every((r) => r === "err") ? "The USDA soil survey is unavailable right now." : "No soil survey values for these points (water, rock or built-up land)."}${geo ? " The regional estimate below still applies." : ""}</p>`;
    } else {
      const counts = CLAY_CLASSES.map((cc) => ok.filter((r) => clayClass(r.clay) === cc).length);
      const avg = Math.round(ok.reduce((s2, r) => s2 + r.clay, 0) / ok.length);
      const names = {}; ok.forEach((r) => { if (r.muname) names[r.muname] = (names[r.muname] || 0) + 1; });
      const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => esc(k));
      const bar = CLAY_CLASSES.map((cc, i) => (counts[i] ? `<span style="width:${(counts[i] / ok.length) * 100}%;background:${cc.color}"></span>` : "")).join("");
      const key = CLAY_CLASSES.map((cc, i) => (counts[i] ? `<span><i style="background:${cc.color}"></i>${cc.name} (${counts[i]})</span>` : "")).join("");
      const clayish = counts[0] + counts[1];
      body = `<p class="sub">Soil survey along it (${ok.length} of ${n} points)</p>
        <div class="cond">Average ${avg}% clay · ${clayish} of ${ok.length} points are clay or clay loam</div>
        <div class="soil-bar">${bar}</div><div class="soil-key">${key}</div>
        <dl class="facts"><dt>Soils</dt><dd>${top.join("; ")}</dd></dl>
        <p class="small">${clayish ? "Clay is most likely where the water undercuts a bank and exposes the soil below the topsoil." : "Mostly loamy or sandy soils here, so clay is less likely."} Fire a test tile before you rely on any clay you dig.</p>`;
    }
    if (waterPopup && waterPopup.isOpen()) waterPopup.setContent(head + body + foot);
  }
  $("#lyr-water").addEventListener("change", (e) => {
    waterOn = e.target.checked;
    $("#water-panel").hidden = !waterOn;
    if (waterOn) { waterLayer.addTo(map); waterKey = ""; if (map.getZoom() < waterMinZoom) { map.setZoom(waterMinZoom); } loadWater(); }
    else { map.removeLayer(waterLayer); sampleLayer.clearLayers(); $("#water-status").textContent = ""; }
  });
  map.on("moveend", () => { if (waterOn) { clearTimeout(waterTimer); waterTimer = setTimeout(loadWater, 500); } });

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
