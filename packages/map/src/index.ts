/**
 * `@photonviz/map` — a Web Mercator vector-tile basemap for Photon.
 *
 * Zero third-party map libraries: MVT decoding, ear-clipping triangulation,
 * tile math and WebGL2 rendering are all here, built on `@photonviz/core`'s GL
 * toolkit. Tiles come from any XYZ `.pbf` endpoint or a self-hosted `.pmtiles`
 * archive. Plots in world coordinates (`[0,1]` per axis, north-up); project
 * data onto the map with {@link lonLatToWorld}.
 */
import type { Plot } from "@photonviz/core";
import { MapLayer, type MapOptions } from "./map-layer.js";
import { GeoJsonLayer, type GeoJsonOptions } from "./geojson-layer.js";

export { MapLayer, GeoJsonLayer };
export type { MapOptions, FeatureHit } from "./map-layer.js";
export type { GeoJsonOptions } from "./geojson-layer.js";

/**
 * Add a vector-tile basemap to a Photon `Plot`. Constructs a {@link MapLayer}
 * against the plot's WebGL2 context and wires tile loads to a redraw.
 *
 * ```ts
 * const plot = new Plot(el, { equalAspect: true, boundedPan: true });
 * addMap(plot, { source: pmtilesSource({ url: "/admin.pmtiles", attribution: "© GADM" }) });
 * ```
 */
export function addMap(plot: Plot, opts: MapOptions): MapLayer {
  const userUpdate = opts.onUpdate;
  const layer = new MapLayer(plot.context, {
    ...opts,
    onUpdate: () => {
      plot.requestRender();
      userUpdate?.();
    },
  });
  return plot.add(layer);
}

/**
 * Add a static GeoJSON vector layer to a Photon `Plot` — a whole map from one
 * file (admin boundaries, etc.), no tiles or server.
 *
 * ```ts
 * const plot = new Plot(el, { equalAspect: true });
 * addGeoJson(plot, { geojson: countries, layer: "admin", style: adminStyle });
 * ```
 */
export function addGeoJson(plot: Plot, opts: GeoJsonOptions): GeoJsonLayer {
  return plot.add(new GeoJsonLayer(plot.context, opts));
}

// Projection + tile math
export {
  lonLatToWorld,
  worldToLonLat,
  visibleTiles,
  pickZoom,
  tileWorldBounds,
  tileKey,
  MAX_LAT,
} from "./mercator.js";
export type { TileId } from "./mercator.js";

// Tile sources
export { xyzVectorSource } from "./source.js";
export type { TileSource, XYZVectorOptions } from "./source.js";
export { pmtilesSource, zxyToTileId, parseHeader, deserializeDirectory, findTile } from "./pmtiles.js";
export type { PmtilesOptions, PmtilesHeader, Entry } from "./pmtiles.js";

// Styling
export { defaultStyle, protomapsStyle, defaultGeoJsonStyle } from "./style.js";
export type { MapStyle, Paint, FillPaint, LinePaint, RGBA } from "./style.js";

// Vector-tile decoding (advanced / custom pipelines)
export { decodeMvt, classifyRings, signedArea } from "./mvt.js";
export type { MvtFeature, GeomType, PropValue } from "./mvt.js";
// Re-exported from core (single source of truth) for backward compatibility.
export { earcut } from "@photonviz/core";
export { buildTileMesh } from "./mesh.js";
export type { TileMesh, PickFeature } from "./mesh.js";
export { buildGeoJsonMesh } from "./geojson.js";
export type {
  GeoJsonMesh,
  GeoJsonFeatureCollection,
  GeoJsonFeature,
  GeoJsonGeometry,
  Position,
} from "./geojson.js";
export { pointInPolygon, pointInRing } from "./geom.js";
export { strokePolyline } from "./stroke.js";
