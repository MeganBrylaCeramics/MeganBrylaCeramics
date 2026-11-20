// New York clay soil map: places marked by how workable the clay is on the chosen date.
// Live data: Open-Meteo (soil temperature, soil moisture, snow, rain) and USDA NRCS Soil Data Access (soil survey).
(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  let SHOP = {}, SITES = [];
  try { SHOP = await get("store.json"); } catch (e) {}
  try { SITES = (await get("content/clay-sites.json")).sites || []; } catch (e) {}
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
  const now = new Date();
  const TODAY = iso(now), MIN = iso(addDays(now, -PAST)), MAX = iso(addDays(now, FUTURE));
  let date = TODAY;

  const dateInput = $("#date"), slider = $("#slider");
  dateInput.min = MIN; dateInput.max = MAX;
  slider.min = -PAST; slider.max = FUTURE; slider.value = 0;
  $("#min-label").textContent = pretty(MIN); $("#max-label").textContent = pretty(MAX);

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
    return { key, metrics: m };
  }

  // Open-Meteo returns the whole window at once, so changing the date needs no new request.
  async function loadWeather(points) {
    const q = new URLSearchParams({
      latitude: points.map((p) => p.lat).join(","), longitude: points.map((p) => p.lng).join(","),
      hourly: "soil_temperature_0_to_7cm,soil_moisture_0_to_7cm,snow_depth",
      daily: "precipitation_sum,temperature_2m_max,temperature_2m_min",
      past_days: PAST, forecast_days: FUTURE + 1, timezone: "America/New_York",
    });
    const data = await get("https://api.open-meteo.com/v1/forecast?" + q);
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((r) => {
      const idx = (a) => Object.fromEntries(a.map((t, i) => [t, i]));
      return {
        dayIdx: idx(r.daily.time), hourIdx: idx(r.hourly.time),
        soilT: r.hourly.soil_temperature_0_to_7cm, soilM: r.hourly.soil_moisture_0_to_7cm, snow: r.hourly.snow_depth,
        precip: r.daily.precipitation_sum, tmax: r.daily.temperature_2m_max, tmin: r.daily.temperature_2m_min,
      };
    });
  }

  // ---------- Soil survey (USDA NRCS Soil Data Access) ----------
  const soilCache = {};
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
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  function clayNote(c) {
    if (c == null) return "";
    if (c >= 40) return "Heavy clay: plastic and high shrinkage. Needs sand or grog blended in and slow drying.";
    if (c >= 27) return "Clay or clay loam: workable for pottery after testing and screening.";
    if (c >= 15) return "Loam with some clay. Likely too lean on its own.";
    return "Low clay. Not a useful clay source.";
  }
  function soilHtml(s) {
    if (s === "loading") return `<p class="small">Looking up the soil survey…</p>`;
    if (!s) return `<p class="small">No soil survey data for this exact point.</p>`;
    if (s === "error") return `<p class="small">Soil survey is unavailable right now. Try again, or look up the spot in the USDA Web Soil Survey.</p>`;
    const row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${esc(v)}</dd>`);
    return `<dl class="facts">${row("Soil", s.muname)}${row("Drainage", s.drainage)}${row("Clay", s.clay != null ? s.clay + "%" : null)}${row("Silt", s.silt != null ? s.silt + "%" : null)}${row("Sand", s.sand != null ? s.sand + "%" : null)}${row("Plasticity index", s.pi)}</dl>` +
      `<p class="small">${esc(clayNote(s.clay))} Values are for the top soil layer. Test any clay by making a fired tile before you rely on it.</p>`;
  }

  // ---------- Entities: my places plus any spot you tap ----------
  const ents = SITES.map((s) => ({ ...s, w: null, soil: null, kind: s.kind || "region" }));
  let picked = null; // tapped spot

  const pinIcon = (e, key) => L.divIcon({
    className: "", iconSize: [20, 20], iconAnchor: [10, 10],
    html: `<div class="pin ${e.kind === "restricted" ? "restricted" : ""}" style="background:${STATES[key].color}"></div>`,
  });
  const accessLabel = { restricted: "Collecting restricted", unknown: "Permission needed", permitted: "Permission granted" };

  function popupHtml(e) {
    const c = conditions(e.w, date), st = STATES[c.key], m = c.metrics;
    const metrics = c.key === "nodata" ? "" : `<dl class="facts">
      ${m.soilT != null ? `<dt>Soil temp</dt><dd>${F(m.soilT).toFixed(0)}°F</dd>` : ""}
      ${m.soilM != null ? `<dt>Soil moisture</dt><dd>${Math.round(m.soilM * 100)}%</dd>` : ""}
      ${m.snow ? `<dt>Snow depth</dt><dd>${(m.snow * 39.37).toFixed(1)} in</dd>` : ""}
      ${m.rain3 != null ? `<dt>Rain, last 3 days</dt><dd>${inch(m.rain3).toFixed(2)} in</dd>` : ""}
      ${m.tmax != null ? `<dt>Air high / low</dt><dd>${F(m.tmax).toFixed(0)}° / ${F(m.tmin).toFixed(0)}°F</dd>` : ""}</dl>`;
    const head = e.isPick
      ? `<h3>Selected spot</h3><div>${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}</div>`
      : `<span class="tag ${e.kind === "restricted" ? "restricted" : ""}">${esc(accessLabel[e.access] || "Permission needed")}</span><h3>${esc(e.name)}</h3><div>${esc(e.county)} County</div><p>${esc(e.notes)}</p>`;
    return `${head}
      <p class="sub">Conditions on ${esc(pretty(date))}</p>
      <div class="cond"><span class="dot" style="background:${st.color}"></span>${esc(st.label)}</div>
      <div class="small">${esc(st.help)}</div>${metrics}
      <p class="sub">Soil survey (USDA)</p>${soilHtml(e.soil)}`;
  }

  async function fillSoil(e) {
    if (e.soil && e.soil !== "loading" && e.soil !== "error") return;
    e.soil = "loading"; refreshPopup(e);
    try { e.soil = await loadSoil(e.lat, e.lng); } catch (err) { e.soil = "error"; }
    refreshPopup(e);
  }
  function refreshPopup(e) {
    if (e.marker && e.marker.isPopupOpen()) e.marker.getPopup().setContent(popupHtml(e));
  }

  const sitesLayer = L.layerGroup().addTo(map);
  ents.forEach((e) => {
    e.marker = L.marker([e.lat, e.lng], { icon: pinIcon(e, "nodata"), title: e.name }).addTo(sitesLayer);
    e.marker.bindPopup(() => popupHtml(e));
    e.marker.on("popupopen", () => fillSoil(e));
  });
  $("#count").textContent = "(" + ents.length + ")";
  $("#lyr-sites").addEventListener("change", (e) => (e.target.checked ? sitesLayer.addTo(map) : map.removeLayer(sitesLayer)));

  // Tap anywhere to see conditions and soil for that spot.
  map.on("click", async (ev) => {
    const { lat, lng } = ev.latlng;
    if (picked) map.removeLayer(picked.marker);
    picked = { lat, lng, isPick: true, kind: "region", w: null, soil: null };
    picked.marker = L.marker([lat, lng], { icon: pinIcon(picked, "nodata") }).addTo(map);
    picked.marker.bindPopup(() => popupHtml(picked), { autoPan: true }).openPopup();
    picked.marker.on("popupopen", () => fillSoil(picked));
    try { [picked.w] = await loadWeather([picked]); } catch (err) { picked.w = null; }
    picked.marker.setIcon(pinIcon(picked, conditions(picked.w, date).key));
    refreshPopup(picked);
    fillSoil(picked);
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

  function render() {
    $("#date-label").textContent = pretty(date);
    $("#date-note").textContent = date === TODAY ? "Today" : date > TODAY ? "Forecast" : "Past conditions";
    $("#season").textContent = SEASON[parse(date).getMonth()];
    dateInput.value = date;
    slider.value = Math.round((parse(date) - parse(TODAY)) / 864e5);
    const counts = {};
    ents.forEach((e) => {
      const c = conditions(e.w, date).key; e.cond = c;
      counts[c] = (counts[c] || 0) + 1;
      e.marker.setIcon(pinIcon(e, c));
      refreshPopup(e);
    });
    if (picked) { picked.marker.setIcon(pinIcon(picked, conditions(picked.w, date).key)); refreshPopup(picked); }
    const good = counts.good || 0;
    $("#summary").textContent = ents.length
      ? (counts.nodata === ents.length ? "Conditions aren't available right now." : `${good} of ${ents.length} places look good for digging.`)
      : "";
    $("#legend").innerHTML = Object.entries(STATES).filter(([k]) => k !== "nodata" || counts.nodata)
      .map(([k, s]) => `<li><span class="dot" style="background:${s.color}"></span>${esc(s.label)}${counts[k] ? ` (${counts[k]})` : ""}</li>`).join("");
    $("#list").innerHTML = ents.map((e, i) =>
      `<li><button data-i="${i}"><span class="row"><span class="dot" style="background:${STATES[e.cond].color}"></span><strong>${esc(e.name)}</strong></span><span class="state">${esc(e.county)} County · ${esc(STATES[e.cond].label)}</span></button></li>`).join("");
  }
  $("#list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    const e = ents[b.dataset.i]; map.setView([e.lat, e.lng], 11); e.marker.openPopup();
    $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  function setDate(d) { if (d < MIN) d = MIN; if (d > MAX) d = MAX; date = d; render(); }
  dateInput.addEventListener("change", () => dateInput.value && setDate(dateInput.value));
  slider.addEventListener("input", () => setDate(iso(addDays(parse(TODAY), Number(slider.value)))));
  $("#today").addEventListener("click", () => setDate(TODAY));

  render();
  if (ents.length) {
    try { const ws = await loadWeather(ents); ents.forEach((e, i) => (e.w = ws[i])); }
    catch (err) { $("#summary").textContent = "Live weather data is unavailable right now."; }
    render();
  }

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
