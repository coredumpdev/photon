/**
 * Triangulation charts — matplotlib's `triplot`, `tripcolor`, `tricontour` and
 * `tricontourf`, for samples that are scattered rather than gridded.
 *
 * Each takes raw `x`/`y`/`z` and triangulates on the fly (see {@link delaunay}),
 * or accepts an explicit `triangles` array when the mesh already exists — a
 * finite-element result, say, where the connectivity is part of the data.
 */
import { colormap, type ColormapSpec } from "../color/colormap.js";
import { delaunay, triangleEdges } from "../geo/delaunay.js";
import { toColorCss } from "../gl/context.js";
import type { Patch, PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { Range, RenderType } from "../types.js";
import { clipScalar, segmentQuad } from "./_geom.js";

/** Scattered sample points, with an optional ready-made mesh. */
export interface TriangulationInput {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Vertex indices, three per triangle. Computed by Delaunay when omitted. */
  triangles?: ArrayLike<number>;
}

/** Resolve the mesh: the caller's, or a fresh Delaunay triangulation. */
function meshOf(opts: TriangulationInput): ArrayLike<number> {
  if (opts.triangles && opts.triangles.length >= 3) return opts.triangles;
  return delaunay(opts.x, opts.y).triangles;
}

/** A sensible stroke width when the caller gives none: 1/500 of the x span. */
function autoWidth(x: ArrayLike<number>): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < x.length; i++) { const v = x[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  return isFinite(hi - lo) && hi > lo ? (hi - lo) / 500 : 0.01;
}

/** Evenly spaced level boundaries spanning the data, when given only a count. */
function autoLevels(z: ArrayLike<number>, count: number): number[] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < z.length; i++) {
    const v = z[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  return Array.from({ length: count + 1 }, (_, i) => lo + ((hi - lo) * i) / count);
}

// --- triplot -----------------------------------------------------------------

export interface TriplotOptions extends TriangulationInput {
  color?: string;
  /** Edge width in data units. Defaults to 1/500 of the x span. */
  width?: number;
  /** Also mark the sample points. Default false. */
  showPoints?: boolean;
  pointSize?: number;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

export interface TriplotHandle {
  edges: PatchesLayer;
  points?: ReturnType<Plot["addScatter"]>;
  triangles: ArrayLike<number>;
}

/**
 * The triangulation itself (`triplot`) — every mesh edge, drawn once. Useful for
 * checking that a mesh covers what you think it covers before colouring it.
 */
export function addTriplot(plot: Plot, opts: TriplotOptions): TriplotHandle {
  const triangles = meshOf(opts);
  const w = opts.width ?? autoWidth(opts.x);
  const color = opts.color ?? "#60a5fa";
  const pairs = triangleEdges(triangles);

  const patches: Patch[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const a = pairs[i]!, b = pairs[i + 1]!;
    patches.push(segmentQuad(opts.x[a]!, opts.y[a]!, opts.x[b]!, opts.y[b]!, w));
  }
  const edges = plot.addPatches({
    patches, color, name: opts.name, renderType: opts.renderType, yAxis: opts.yAxis,
  });
  const points = opts.showPoints
    ? plot.addScatter({
        x: opts.x, y: opts.y, size: opts.pointSize ?? 4, color,
        renderType: opts.renderType, yAxis: opts.yAxis,
      })
    : undefined;
  return { edges, ...(points ? { points } : {}), triangles };
}

// --- tripcolor ---------------------------------------------------------------

export interface TripcolorOptions extends TriangulationInput {
  /** One value per *point*; each triangle takes the mean of its three. */
  z: ArrayLike<number>;
  colormap?: ColormapSpec;
  domain?: Range;
  opacity?: number;
  /** Stroke the mesh over the fill. Default false. */
  edges?: boolean;
  edgeColor?: string;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

export interface TripcolorHandle {
  faces: PatchesLayer;
  edges?: PatchesLayer;
  triangles: ArrayLike<number>;
}

/**
 * Flat-shaded triangles (`tripcolor`): each face takes the mean of its three
 * vertex values. This is matplotlib's default `shading="flat"`; smooth Gouraud
 * shading would need per-vertex colours, which the patches layer does not carry.
 */
export function addTripcolor(plot: Plot, opts: TripcolorOptions): TripcolorHandle {
  const triangles = meshOf(opts);
  const patches: Patch[] = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t]!, b = triangles[t + 1]!, c = triangles[t + 2]!;
    patches.push({
      x: Float64Array.from([opts.x[a]!, opts.x[b]!, opts.x[c]!]),
      y: Float64Array.from([opts.y[a]!, opts.y[b]!, opts.y[c]!]),
      value: (opts.z[a]! + opts.z[b]! + opts.z[c]!) / 3,
    });
  }
  const faces = plot.addPatches({
    patches,
    colormap: opts.colormap ?? "viridis",
    domain: opts.domain,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
    yAxis: opts.yAxis,
  });
  const edges = opts.edges
    ? addTriplot(plot, {
        x: opts.x, y: opts.y, triangles,
        color: opts.edgeColor ?? "rgba(148,163,184,0.7)",
        renderType: opts.renderType, yAxis: opts.yAxis,
      }).edges
    : undefined;
  return { faces, ...(edges ? { edges } : {}), triangles };
}

// --- tricontour / tricontourf ------------------------------------------------

export interface TricontourOptions extends TriangulationInput {
  /** One value per point. */
  z: ArrayLike<number>;
  /** Explicit levels, or a count of evenly spaced ones. Default 8. */
  levels?: number[] | number;
  /** Single line colour; if omitted, levels are coloured by the colormap. */
  color?: string;
  colormap?: ColormapSpec;
  /** Line width in data units. Defaults to 1/400 of the x span. */
  width?: number;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

/**
 * Iso-lines over a triangulation (`tricontour`).
 *
 * A triangle's interpolant is linear, so a level crosses it in exactly one
 * straight segment — no marching-squares case table and no saddle ambiguity.
 */
export function addTricontour(plot: Plot, opts: TricontourOptions): PatchesLayer {
  const triangles = meshOf(opts);
  const levels = Array.isArray(opts.levels)
    ? [...opts.levels].sort((a, b) => a - b)
    : autoLevels(opts.z, typeof opts.levels === "number" ? opts.levels : 8).slice(1, -1);
  const w = opts.width ?? autoWidth(opts.x) * 1.25;
  const cmap = opts.color ? null : colormap(opts.colormap ?? "viridis");
  const lo = levels.length ? levels[0]! : 0;
  const span = levels.length > 1 ? levels[levels.length - 1]! - lo : 1;

  const patches: Patch[] = [];
  for (let li = 0; li < levels.length; li++) {
    const L = levels[li]!;
    const color = cmap ? toColorCss([...cmap((L - lo) / (span || 1)), 1]) : opts.color!;
    for (let t = 0; t + 2 < triangles.length; t += 3) {
      const ids = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
      const zs = ids.map((i) => opts.z[i]!);
      if (!zs.every(isFinite)) continue;
      // Collect the (at most two) edge crossings for this level.
      const hits: Array<[number, number]> = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const z0 = zs[i]!, z1 = zs[j]!;
        if ((z0 < L && z1 < L) || (z0 > L && z1 > L) || z0 === z1) continue;
        const f = (L - z0) / (z1 - z0);
        if (f < 0 || f > 1) continue;
        const a = ids[i]!, b = ids[j]!;
        hits.push([
          opts.x[a]! + (opts.x[b]! - opts.x[a]!) * f,
          opts.y[a]! + (opts.y[b]! - opts.y[a]!) * f,
        ]);
      }
      if (hits.length < 2) continue;
      patches.push(segmentQuad(hits[0]![0], hits[0]![1], hits[1]![0], hits[1]![1], w, color));
    }
  }
  return plot.addPatches({
    patches,
    ...(opts.color ? { color: opts.color } : {}),
    name: opts.name,
    renderType: opts.renderType,
    yAxis: opts.yAxis,
  });
}

export interface TricontourfOptions extends TriangulationInput {
  z: ArrayLike<number>;
  levels?: number[] | number;
  colormap?: ColormapSpec;
  domain?: Range;
  opacity?: number;
  /** Also stroke the band boundaries. Default false. */
  lines?: boolean;
  lineColor?: string;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

export interface TricontourfHandle {
  bands: PatchesLayer;
  lines?: PatchesLayer;
  triangles: ArrayLike<number>;
}

/**
 * Filled contour bands over a triangulation (`tricontourf`).
 *
 * Simpler than the gridded {@link addContourFilled}: a triangle is already the
 * unit the clipper wants, so there is no cell to subdivide and no saddle to
 * disambiguate. Each face is clipped against the level pair it straddles.
 */
export function addTricontourf(plot: Plot, opts: TricontourfOptions): TricontourfHandle {
  const triangles = meshOf(opts);
  const bounds = Array.isArray(opts.levels)
    ? [...opts.levels].sort((a, b) => a - b)
    : autoLevels(opts.z, typeof opts.levels === "number" ? opts.levels : 8);
  const domain: Range = opts.domain ?? [bounds[0]!, bounds[bounds.length - 1]!];

  const patches: Patch[] = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const ids = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
    const tx = ids.map((i) => opts.x[i]!);
    const ty = ids.map((i) => opts.y[i]!);
    const tv = ids.map((i) => opts.z[i]!);
    if (!tv.every(isFinite)) continue;
    const tmin = Math.min(...tv), tmax = Math.max(...tv);
    for (let b = 0; b < bounds.length - 1; b++) {
      const lo = bounds[b]!, hi = bounds[b + 1]!;
      if (tmax < lo || tmin > hi) continue;
      const a = clipScalar(tx, ty, tv, lo, true);
      if (a.x.length < 3) continue;
      const c = clipScalar(a.x, a.y, a.v, hi, false);
      if (c.x.length < 3) continue;
      patches.push({ x: Float64Array.from(c.x), y: Float64Array.from(c.y), value: (lo + hi) / 2 });
    }
  }

  const bands = plot.addPatches({
    patches,
    colormap: opts.colormap ?? "viridis",
    domain,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
    yAxis: opts.yAxis,
  });
  const lines = opts.lines
    ? addTricontour(plot, {
        x: opts.x, y: opts.y, z: opts.z, triangles,
        levels: bounds.slice(1, -1),
        color: opts.lineColor ?? "rgba(148,163,184,0.85)",
        renderType: opts.renderType, yAxis: opts.yAxis,
      })
    : undefined;
  return { bands, ...(lines ? { lines } : {}), triangles };
}
