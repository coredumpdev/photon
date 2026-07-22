/**
 * A ready-to-use world basemap **embedded in the library** — Natural Earth 10m
 * admin-0 countries (public domain), inlined at build time. Import it from the
 * `@photonviz/map/world` subpath so the ~13 MB payload only loads when you ask
 * for it (the main `@photonviz/map` entry stays tiny).
 *
 * ```ts
 * import { Plot } from "@photonviz/core";
 * import { addGeoJson } from "@photonviz/map";
 * import { worldCountries } from "@photonviz/map/world";
 *
 * const plot = new Plot(el, { equalAspect: true, boundedPan: true });
 * addGeoJson(plot, { geojson: worldCountries, layer: "admin" });
 * ```
 */
import data from "./data/world-countries-10m.json";
import type { GeoJsonFeatureCollection } from "./geojson.js";

/** Natural Earth 1:10m admin-0 country boundaries (public domain). */
export const worldCountries = data as unknown as GeoJsonFeatureCollection;
