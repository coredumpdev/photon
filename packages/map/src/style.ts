/**
 * A minimal basemap style: it maps an OpenMapTiles layer + geometry type to a
 * paint (fill colour, or line colour + width) — or `null` to skip the feature.
 * Deliberately small; the aim is a clean, unobtrusive backdrop for data, not a
 * pixel-perfect cartographic map. Swap in your own `MapStyle` for full control.
 */
import type { GeomType, PropValue } from "./mvt.js";

export type RGBA = [number, number, number, number];

export interface FillPaint {
  kind: "fill";
  color: RGBA;
  /** Optional outline stroked around every ring (color + width in px). */
  outline?: RGBA;
  outlineWidth?: number;
}
export interface LinePaint {
  kind: "line";
  color: RGBA;
  /** Width in CSS pixels (MVP renders 1px; width reserved for the thick-line upgrade). */
  width: number;
}
export type Paint = FillPaint | LinePaint;

export interface MapStyle {
  /** Canvas clear colour behind the tiles. */
  background: RGBA;
  attribution?: string;
  /** Resolve one feature to a paint, or `null` to skip it. */
  paint(layer: string, type: GeomType, properties: Record<string, PropValue>): Paint | null;
}

const fill = (color: RGBA): FillPaint => ({ kind: "fill", color });
const line = (color: RGBA, width = 1): LinePaint => ({ kind: "line", color, width });

interface Palette {
  background: RGBA;
  water: RGBA;
  waterway: RGBA;
  land: RGBA;
  park: RGBA;
  building: RGBA;
  roadMajor: RGBA;
  roadMinor: RGBA;
  boundary: RGBA;
}

const LIGHT: Palette = {
  background: [0.96, 0.96, 0.94, 1],
  water: [0.68, 0.82, 0.92, 1],
  waterway: [0.6, 0.76, 0.88, 1],
  land: [0.9, 0.92, 0.86, 1],
  park: [0.82, 0.9, 0.78, 1],
  building: [0.86, 0.84, 0.8, 1],
  roadMajor: [0.98, 0.86, 0.6, 1],
  roadMinor: [0.85, 0.85, 0.82, 1],
  boundary: [0.7, 0.65, 0.72, 1],
};

const DARK: Palette = {
  background: [0.11, 0.12, 0.14, 1],
  water: [0.13, 0.19, 0.28, 1],
  waterway: [0.16, 0.24, 0.34, 1],
  land: [0.15, 0.16, 0.18, 1],
  park: [0.14, 0.19, 0.16, 1],
  building: [0.19, 0.2, 0.23, 1],
  roadMajor: [0.4, 0.38, 0.32, 1],
  roadMinor: [0.24, 0.25, 0.28, 1],
  boundary: [0.35, 0.33, 0.4, 1],
};

const MAJOR_ROADS = new Set(["motorway", "trunk", "primary", "secondary"]);

/** A clean light/dark basemap style over the OpenMapTiles schema. */
export function defaultStyle(theme: "light" | "dark" = "light"): MapStyle {
  const p = theme === "dark" ? DARK : LIGHT;
  return {
    background: p.background,
    paint(layer, type, props) {
      switch (layer) {
        case "water":
          return type === "polygon" ? fill(p.water) : line(p.waterway);
        case "waterway":
          return line(p.waterway);
        case "landcover":
        case "landuse":
          return fill(p.land);
        case "park":
          return fill(p.park);
        case "building":
          return fill(p.building);
        case "transportation": {
          const cls = String(props.class ?? "");
          return line(MAJOR_ROADS.has(cls) ? p.roadMajor : p.roadMinor);
        }
        case "boundary":
          return line(p.boundary);
        // MapLibre demo-tile schema (keyless world map), so the default style
        // renders something out of the box.
        case "countries":
          return type === "polygon" ? fill(p.land) : line(p.boundary);
        case "geolines":
          return line(p.boundary);
        default:
          return null;
      }
    },
  };
}

/**
 * Default style for GeoJSON layers: paint **every** polygon as a filled region
 * with an outline and **every** line as a stroke, regardless of layer name — so
 * `addGeoJson({ geojson })` renders out of the box without a custom style.
 * (The tile `defaultStyle` deliberately skips unknown layers, which is why a
 * bare GeoJSON layer would otherwise be invisible.)
 */
export function defaultGeoJsonStyle(theme: "light" | "dark" = "light"): MapStyle {
  const p = theme === "dark" ? DARK : LIGHT;
  return {
    background: p.background,
    paint(_layer, type) {
      if (type === "polygon") {
        return { kind: "fill", color: p.land, outline: p.boundary, outlineWidth: 1 };
      }
      if (type === "line") return { kind: "line", color: p.boundary, width: 1.2 };
      return null; // points → overlay a scatter instead
    },
  };
}

/** Road half-ish widths (px) by the Protomaps `kind` property. */
const ROAD_WIDTH: Record<string, number> = {
  highway: 2.4,
  major_road: 1.8,
  medium_road: 1.3,
  minor_road: 0.9,
  other: 0.8,
  path: 0.6,
  rail: 0.7,
  ferry: 0.6,
};

/**
 * A basemap style over the **Protomaps** tile schema (`earth`, `water`,
 * `roads`, `buildings`, …) — for a self-hosted planet/region `.pmtiles`.
 * Roads are widened by their `kind`.
 */
export function protomapsStyle(theme: "light" | "dark" = "light"): MapStyle {
  const p = theme === "dark" ? DARK : LIGHT;
  return {
    background: p.water, // oceans show through where there is no `earth`
    paint(layer, type, props) {
      switch (layer) {
        case "earth":
          return fill(p.land);
        case "landcover":
        case "landuse":
          return fill(p.park);
        case "water":
          return type === "polygon" ? fill(p.water) : line(p.waterway);
        case "buildings":
          return fill(p.building);
        case "roads": {
          const kind = String(props.kind ?? "");
          const major = kind === "highway" || kind === "major_road";
          return line(major ? p.roadMajor : p.roadMinor, ROAD_WIDTH[kind] ?? 0.9);
        }
        case "transit":
          return line(p.roadMinor, 0.6);
        case "boundaries":
          return line(p.boundary, 0.8);
        default:
          return null;
      }
    },
  };
}
