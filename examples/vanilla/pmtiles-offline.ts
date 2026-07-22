import { Plot } from "@photonviz/core";
import { addMap, pmtilesSource, protomapsStyle, worldToLonLat, type MapLayer } from "@photonviz/map";

// A fully offline vector map: the tiles come from a local .pmtiles file the user
// picks — read via Blob.slice(), no network at all. Swap protomapsStyle for your
// own MapStyle to match a different tile schema.
const container = document.getElementById("map")!;
const plot = new Plot(container, {
  theme: "dark",
  showToolbar: true,
  equalAspect: true,
  boundedPan: true,
  crosshair: true,
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
let map: MapLayer | null = null;

document.getElementById("file")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (map) {
    map.dispose();
    map = null;
  }
  // The whole map is served from this local file — zero network.
  const source = pmtilesSource({ blob: file, attribution: `local: ${file.name}` });
  map = addMap(plot, { source, style: protomapsStyle("dark") });
  status.textContent = `local: ${file.name}`;
  pickEl.textContent = "zoom in, then click a feature";
});

// Feature picking: click a filled feature (building, water, region) → properties.
container.addEventListener("click", (e) => {
  if (!map) return;
  const d = plot.dataAt(e.clientX, e.clientY);
  if (!d) return;
  const hit = map.pickFeature(d.x, d.y);
  pickEl.textContent = hit ? `${hit.layer}: ${JSON.stringify(hit.properties)}` : "—";
});
