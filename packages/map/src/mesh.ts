/**
 * Tessellate one tile's features into a GPU-ready vertex buffer.
 *
 * Coordinates are emitted **relative to the tile's own origin** (its south-west
 * corner in world space), so every value is small (0…tileSpan) — this sidesteps
 * float32 precision loss at high zoom, the same trick Photon's other layers use.
 *
 * One interleaved buffer per tile, vertex layout `[x, y, nx, ny, r, g, b, a]`:
 *  - **fills** (earcut'd polygons) have `nx=ny=0` and draw as `TRIANGLES`
 *  - **lines** expand into quads: `(nx,ny)` is the segment normal scaled by the
 *    half-width **in pixels**; the vertex shader offsets by `(nx,ny)·worldPerPixel`,
 *    giving constant screen-space thickness (assumes an equal-aspect view — maps).
 *
 * Polygon features are also kept (with properties, in absolute world coords) so
 * the map layer can hit-test them for feature picking. Pure and unit-tested.
 */
import { earcut } from "@photonviz/core";
import { tileWorldBounds, type TileId } from "./mercator.js";
import { classifyRings, type MvtFeature, type PropValue } from "./mvt.js";
import { strokePolyline } from "./stroke.js";
import type { MapStyle } from "./style.js";

/** A polygon feature retained for hit-testing (rings in absolute world coords). */
export interface PickFeature {
  properties: Record<string, PropValue>;
  layer: string;
  /** Classified polygons: each is `[exterior, ...holes]`, flat `[x,y,…]`. */
  polygons: number[][][];
}

export interface TileMesh {
  /** Interleaved `[x,y,nx,ny,r,g,b,a]`; fill vertices first, then line vertices. */
  verts: Float32Array;
  fillCount: number;
  lineCount: number;
  originX: number;
  originY: number;
  features: PickFeature[];
}

const FLOATS = 8;

export function buildTileMesh(features: MvtFeature[], tile: TileId, style: MapStyle): TileMesh {
  const b = tileWorldBounds(tile);
  const spanX = b.wx1 - b.wx0;
  const spanY = b.wy1 - b.wy0;
  // (u,v): u east in [0,1], v south in [0,1] (v=0 north edge). Relative to origin.
  const relX = (u: number) => u * spanX;
  const relY = (v: number) => (1 - v) * spanY;

  const fill: number[] = [];
  const line: number[] = [];
  const picks: PickFeature[] = [];

  for (const f of features) {
    const paint = style.paint(f.layer, f.type, f.properties);
    if (!paint) continue;

    if (paint.kind === "fill" && f.type === "polygon") {
      const [r, g, bl, a] = paint.color;
      const absPolygons: number[][][] = [];
      for (const poly of classifyRings(f.rings)) {
        const flat: number[] = [];
        const holes: number[] = [];
        const absPoly: number[][] = [];
        poly.forEach((ring, ri) => {
          if (ri > 0) holes.push(flat.length / 2);
          const abs: number[] = [];
          for (let i = 0; i < ring.length; i += 2) {
            const rx = relX(ring[i]!);
            const ry = relY(ring[i + 1]!);
            flat.push(rx, ry);
            abs.push(b.wx0 + rx, b.wy0 + ry); // absolute world, for picking
          }
          absPoly.push(abs);
        });
        absPolygons.push(absPoly);
        const tris = earcut(flat, holes.length ? holes : undefined);
        for (const idx of tris) fill.push(flat[idx * 2]!, flat[idx * 2 + 1]!, 0, 0, r, g, bl, a);
      }
      picks.push({ properties: f.properties, layer: f.layer, polygons: absPolygons });
    } else if (paint.kind === "line") {
      const hw = paint.width / 2;
      for (const path of f.rings) {
        const rel: number[] = [];
        for (let i = 0; i < path.length; i += 2) rel.push(relX(path[i]!), relY(path[i + 1]!));
        strokePolyline(rel, hw, paint.color, line);
      }
    }
  }

  const verts = new Float32Array(fill.length + line.length);
  verts.set(fill, 0);
  verts.set(line, fill.length);
  return {
    verts,
    fillCount: fill.length / FLOATS,
    lineCount: line.length / FLOATS,
    originX: b.wx0,
    originY: b.wy0,
    features: picks,
  };
}
