/**
 * Build a drawable mesh directly from GeoJSON — no tiles, no server, no key.
 * Drop in an admin-boundary FeatureCollection (country / province / district in
 * lon/lat) and it renders as a self-contained vector map: polygon fills via
 * earcut, boundaries as width-expanded line quads, features kept for picking.
 *
 * Coordinates are projected with Web Mercator ({@link lonLatToWorld}) and
 * emitted relative to the dataset's world-space bounding-box min, keeping
 * float32 precise even for a small region. Pure and unit-tested.
 */
import type { Range } from "@photonviz/core";
import { earcut } from "@photonviz/core";
import { lonLatToWorld } from "./mercator.js";
import type { PickFeature, TileMesh } from "./mesh.js";
import type { PropValue } from "./mvt.js";
import { strokePolyline } from "./stroke.js";
import type { MapStyle } from "./style.js";

// ---- Minimal GeoJSON shapes (only what we render) ---------------------------
export type Position = number[]; // [lon, lat, ...]
export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}
export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: Record<string, PropValue> | null;
}
export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface GeoJsonMesh extends TileMesh {
  /** World-space extent of the data, for autoscaling. */
  boundsX: Range;
  boundsY: Range;
}

const FLOATS = 8;

interface WorldPolygon {
  color: [number, number, number, number];
  rings: number[][]; // [exterior, ...holes], flat world [x,y,…]
}
interface WorldLine {
  color: [number, number, number, number];
  hw: number;
  path: number[]; // flat world [x,y,…]
}

/**
 * Tessellate a GeoJSON FeatureCollection. `layer` is the name passed to
 * `style.paint(layer, type, properties)` so a style can switch on it (e.g.
 * `"admin"`) plus per-feature properties like `admin_level`.
 */
export function buildGeoJsonMesh(
  fc: GeoJsonFeatureCollection,
  style: MapStyle,
  layer = "geojson",
): GeoJsonMesh {
  const polys: WorldPolygon[] = [];
  const lines: WorldLine[] = [];
  const picks: PickFeature[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const project = (pos: Position): [number, number] => {
    const [x, y] = lonLatToWorld(pos[0]!, pos[1]!);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    return [x, y];
  };
  const ringToWorld = (ring: Position[]): number[] => {
    const flat: number[] = [];
    for (const p of ring) {
      const [x, y] = project(p);
      flat.push(x, y);
    }
    return flat;
  };

  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const props = f.properties ?? {};

    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      const paint = style.paint(layer, "polygon", props);
      const polyList = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Position[][][];
      const featurePolys: number[][][] = [];
      for (const poly of polyList) {
        const rings = poly.map(ringToWorld);
        featurePolys.push(rings);
        if (paint?.kind === "fill") {
          polys.push({ color: paint.color, rings });
          if (paint.outline) {
            const hw = (paint.outlineWidth ?? 1) / 2;
            for (const ring of rings) lines.push({ color: paint.outline, hw, path: ring });
          }
        }
      }
      if (paint) picks.push({ properties: props, layer, polygons: featurePolys });
    } else if (g.type === "LineString" || g.type === "MultiLineString") {
      const paint = style.paint(layer, "line", props);
      if (paint?.kind !== "line") continue;
      const pathList = (g.type === "LineString" ? [g.coordinates] : g.coordinates) as Position[][];
      for (const path of pathList) lines.push({ color: paint.color, hw: paint.width / 2, path: ringToWorld(path) });
    }
    // Point / MultiPoint are left to a scatter overlay.
  }

  const originX = minX === Infinity ? 0 : minX;
  const originY = minY === Infinity ? 0 : minY;
  const fill: number[] = [];
  const line: number[] = [];

  for (const p of polys) {
    const flat: number[] = [];
    const holes: number[] = [];
    p.rings.forEach((ring, ri) => {
      if (ri > 0) holes.push(flat.length / 2);
      for (let i = 0; i < ring.length; i += 2) flat.push(ring[i]! - originX, ring[i + 1]! - originY);
    });
    const [r, g, b, a] = p.color;
    for (const idx of earcut(flat, holes.length ? holes : undefined)) {
      fill.push(flat[idx * 2]!, flat[idx * 2 + 1]!, 0, 0, r, g, b, a);
    }
  }

  for (const l of lines) {
    const rel: number[] = [];
    for (let i = 0; i < l.path.length; i += 2) rel.push(l.path[i]! - originX, l.path[i + 1]! - originY);
    strokePolyline(rel, l.hw, l.color, line);
  }

  const verts = new Float32Array(fill.length + line.length);
  verts.set(fill, 0);
  verts.set(line, fill.length);
  return {
    verts,
    fillCount: fill.length / FLOATS,
    lineCount: line.length / FLOATS,
    originX,
    originY,
    features: picks,
    boundsX: [originX, maxX === -Infinity ? 1 : maxX],
    boundsY: [originY, maxY === -Infinity ? 1 : maxY],
  };
}
