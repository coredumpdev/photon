<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/map

**A Web Mercator vector basemap for [Photon](https://github.com/coredumpdev/photon), rendered from scratch on WebGL2.**

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/map.png" alt="Photon vector world map, rendered from scratch on WebGL2" width="100%" />
</p>

MVT decoding, ear-clipping triangulation, thick miter-join lines, tile math and
rendering are all in this package — **no Mapbox / MapLibre / Leaflet**. Plots in
world coordinates on a normal Photon `Plot`, so your data overlays it directly.

```bash
npm i @photonviz/core @photonviz/map
```

## Quick start

```ts
import { Plot } from "@photonviz/core";
import { addMap, xyzVectorSource, lonLatToWorld } from "@photonviz/map";

const plot = new Plot(el, { equalAspect: true, boundedPan: true }); // world coords

addMap(plot, {
  source: xyzVectorSource({
    url: "https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=YOUR_KEY",
    attribution: "© OpenStreetMap contributors © MapTiler",
    maxZoom: 14,
  }),
});

// overlay data by projecting lon/lat → world
const [x, y] = lonLatToWorld(28.98, 41.01);
plot.addScatter({ x: [x], y: [y], size: 8, color: "#f472b6" });
```

## Tile sources

```ts
xyzVectorSource({ url, attribution })          // any XYZ .pbf endpoint
pmtilesSource({ url })                          // a single PMTiles archive (HTTP range)
pmtilesSource({ blob: file })                   // a local .pmtiles File — fully offline
pmtilesSource({ data: arrayBuffer })            // in-memory / bundled asset
```

## GeoJSON — a whole map from one file

```ts
import { addGeoJson } from "@photonviz/map";
addGeoJson(plot, { geojson, layer: "admin" });  // no tiles, no server, no key
```

Or use the **embedded** Natural Earth 10m world (opt-in subpath, keeps the main entry small):

```ts
import { worldCountries } from "@photonviz/map/world";
addGeoJson(plot, { geojson: worldCountries, layer: "admin" });
```

## More

- **Feature picking** — `map.pickFeature(worldX, worldY)` → `{ layer, properties }`.
- **Styling** — `defaultStyle` / `protomapsStyle` / `defaultGeoJsonStyle`, or your own `MapStyle` (per tile-layer + properties).
- **Offline** — the `blob` source reads byte ranges via `Blob.slice()`; bundle a region `.pmtiles` for a fully offline desktop/mobile map.
- **Framework wrappers** — `<Map>` / `<GeoJson>` in [React](https://www.npmjs.com/package/@photonviz/react) & [Vue](https://www.npmjs.com/package/@photonviz/vue), `{ type: "map" }` series in [Svelte](https://www.npmjs.com/package/@photonviz/svelte).

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE). Map data is provided by you (or the embedded Natural Earth set, public domain) — display the source's attribution.
