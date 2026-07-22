import { Plot } from "@photonviz/core";
import { addGeoJson, worldToLonLat, type MapStyle } from "@photonviz/map";
// The world basemap is embedded in the library (Natural Earth 10m) — no fetch.
import { worldCountries } from "@photonviz/map/world";

// A whole vector map from a single GeoJSON file — no tiles, no server, no key.
// Style admin polygons: land fill + a lighter outline so borders are visible.
const adminStyle: MapStyle = {
  background: [0.05, 0.09, 0.16, 1],
  paint(_layer, type) {
    if (type === "polygon") {
      return { kind: "fill", color: [0.16, 0.2, 0.26, 1], outline: [0.5, 0.58, 0.68, 1], outlineWidth: 1.2 };
    }
    return { kind: "line", color: [0.5, 0.58, 0.68, 1], width: 1.2 };
  },
};

const container = document.getElementById("map")!;
const plot = new Plot(container, {
  theme: "dark",
  showToolbar: true,
  equalAspect: true, // square world units — no distortion
  boundedPan: true,
  hoverReadout: (x, y) => {
    const [lon, lat] = worldToLonLat(x, y);
    return [
      { label: "lon", value: `${lon.toFixed(4)}°` },
      { label: "lat", value: `${lat.toFixed(4)}°` },
    ];
  },
});
const pickEl = document.getElementById("pick")!;
const status = document.getElementById("attribution")!;

// No fetch — the Natural Earth 10m world is bundled in `@photonviz/map/world`.
const layer = addGeoJson(plot, { geojson: worldCountries, layer: "admin", style: adminStyle });
status.textContent = "© Natural Earth (public domain) · embedded";

// Feature picking: click a country → its name from the feature properties.
container.addEventListener("click", (e) => {
  const d = plot.dataAt(e.clientX, e.clientY);
  if (!d) return;
  const hit = layer.pickFeature(d.x, d.y);
  pickEl.textContent = hit
    ? String(hit.properties.ADMIN ?? hit.properties.NAME ?? JSON.stringify(hit.properties))
    : "—";
});
