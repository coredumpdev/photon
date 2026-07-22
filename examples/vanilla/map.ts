import { Plot } from "@photonviz/core";
import { addMap, xyzVectorSource, lonLatToWorld, worldToLonLat, type MapStyle } from "@photonviz/map";

// --- Tile source -------------------------------------------------------------
// MapLibre's demo tiles need no API key and are CORS-enabled — great for a
// zero-config demo (world country polygons, zoom 0–5). For real street maps,
// swap in an OpenMapTiles endpoint and add your key, e.g.:
//   url: "https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=YOUR_KEY", maxZoom: 14
//
// Or host your OWN data as a single .pmtiles file (offline, key-free) — build it
// from GADM/OSM admin boundaries with tippecanoe, then:
//   import { pmtilesSource } from "@photonviz/map";
//   const source = pmtilesSource({ url: "/admin.pmtiles", attribution: "© GADM" });
const source = xyzVectorSource({
  url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf",
  attribution: "© MapLibre demo tiles",
  maxZoom: 5,
});

// A tiny custom style: ocean background, land fills, faint graticule lines.
const oceanStyle: MapStyle = {
  background: [0.05, 0.09, 0.16, 1],
  paint(layer, type) {
    if (layer === "countries") return type === "polygon"
      ? { kind: "fill", color: [0.16, 0.2, 0.26, 1] }
      : { kind: "line", color: [0.3, 0.36, 0.44, 1], width: 1 };
    if (layer === "geolines") return { kind: "line", color: [0.2, 0.25, 0.32, 1], width: 1 };
    return null;
  },
};

// --- Plot --------------------------------------------------------------------
const container = document.getElementById("map")!;
const plot = new Plot(container, {
  theme: "dark",
  showToolbar: true,
  equalAspect: true, // no horizontal stretch — square world units
  crosshair: true, // full X+Y guide lines on hover + press (now the default)
  pick: "xy", // highlight the point nearest in 2D (checks both lon and lat)
  boundedPan: true, // can't pan/zoom outside the map bounds
  // Show geographic coordinates (lon/lat) instead of raw world coords.
  hoverReadout: (x, y) => {
    const [lon, lat] = worldToLonLat(x, y);
    return [
      { label: "lon", value: `${lon.toFixed(4)}°` },
      { label: "lat", value: `${lat.toFixed(4)}°` },
    ];
  },
});

const map = addMap(plot, { source, style: oceanStyle, bbox: [-175, -58, 190, 78] });

// Overlay data by projecting lon/lat into the same world coordinates.
const cities: Array<[string, number, number]> = [
  ["Istanbul", 28.98, 41.01],
  ["Tokyo", 139.69, 35.69],
  ["New York", -74.0, 40.71],
  ["São Paulo", -46.63, -23.55],
  ["Sydney", 151.21, -33.87],
  ["Cairo", 31.24, 30.04],
];
const wx: number[] = [];
const wy: number[] = [];
for (const [, lon, lat] of cities) {
  const [x, y] = lonLatToWorld(lon, lat);
  wx.push(x);
  wy.push(y);
}
plot.addScatter({
  x: wx,
  y: wy,
  size: 8,
  color: "#f472b6",
  labels: cities.map(([name]) => name), // click a dot to see the city name
});

// Attribution (legally required to be visible).
document.getElementById("attribution")!.textContent = map.attribution;

// Feature picking: click anywhere on a filled region to read its properties.
const pickEl = document.getElementById("pick")!;
container.addEventListener("click", (e) => {
  const d = plot.dataAt(e.clientX, e.clientY);
  if (!d) return;
  const hit = map.pickFeature(d.x, d.y);
  pickEl.textContent = hit ? `${hit.layer}: ${JSON.stringify(hit.properties)}` : "no feature here";
});
