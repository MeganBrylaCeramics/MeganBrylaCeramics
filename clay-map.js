(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  let SHOP = {}, SITES = [];
  try { SHOP = await get("store.json"); } catch (e) {}
  try { SITES = (await get("content/clay-sites.json")).sites || []; } catch (e) {}
  if (SHOP.name) document.title = "New York Clay Map | " + SHOP.name;
  $("#suggest").href = "mailto:" + (SHOP.contactEmail || "") + "?subject=" + encodeURIComponent("Clay map suggestion");

  // New York State bounds
  const NY = L.latLngBounds([40.45, -79.8], [45.05, -71.8]);
  const map = L.map("map", { maxBounds: NY.pad(0.4), minZoom: 6 }).fitBounds(NY);
  L.control.scale({ imperial: true }).addTo(map);

  // Live base maps
  const base = {
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
    topo: L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "USGS The National Map" }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "Esri, Maxar, Earthstar" }),
  };
  let current = base.osm.addTo(map);
  $("#basemap").addEventListener("change", (e) => {
    map.removeLayer(current); current = base[e.target.value].addTo(map); current.bringToBack();
  });

  // Clay places (my list)
  const sitesLayer = L.layerGroup().addTo(map);
  const markers = [];
  const accessLabel = { restricted: "Collecting restricted", unknown: "Permission needed", permitted: "Permission granted" };
  SITES.forEach((s, i) => {
    const cls = s.kind === "restricted" ? "restricted" : "region";
    const icon = L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    const m = L.marker([s.lat, s.lng], { icon, title: s.name }).addTo(sitesLayer);
    m.bindPopup(`<span class="tag ${cls}">${esc(accessLabel[s.access] || "Permission needed")}</span>
      <h3>${esc(s.name)}</h3><div>${esc(s.county)} County</div><p>${esc(s.notes)}</p>`);
    markers.push(m);
  });
  $("#count").textContent = "(" + SITES.length + ")";
  $("#list").innerHTML = SITES.map((s, i) =>
    `<li><button data-i="${i}"><strong>${esc(s.name)}</strong><span>${esc(s.county)} County</span></button></li>`).join("");
  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const m = markers[b.dataset.i]; map.setView(m.getLatLng(), 11); m.openPopup();
    $("#map").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#lyr-sites").addEventListener("change", (e) => e.target.checked ? sitesLayer.addTo(map) : map.removeLayer(sitesLayer));

  // Live layer: USGS clay mineral sites (MRDS), filtered to clay in the browser
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
          l.bindPopup(`<span class="tag">USGS record</span><h3>${esc(p.site_name || p.name || "Clay occurrence")}</h3>` +
            `<div>${esc(p.county || "")}</div><p>${esc(p.commod1 || p.commodity || "")}</p>`);
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

  // Live layer: USGS state geology (WMS)
  const geo = L.tileLayer.wms("https://mrdata.usgs.gov/services/ny", {
    layers: "ny", format: "image/png", transparent: true, opacity: 0.6, attribution: "USGS",
  });
  let geoErrors = 0;
  geo.on("tileerror", () => {
    if (++geoErrors === 3) { $("#geo-status").className = "status err"; $("#geo-status").textContent = "unavailable right now"; }
  });
  geo.on("load", () => { if (!geoErrors) $("#geo-status").textContent = "loaded"; });
  $("#lyr-geo").addEventListener("change", (e) => {
    if (e.target.checked) { geoErrors = 0; $("#geo-status").className = "status"; $("#geo-status").textContent = "loading…"; geo.addTo(map); }
    else map.removeLayer(geo);
  });
})();
