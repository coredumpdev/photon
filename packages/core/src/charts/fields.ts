/**
 * Field charts — the gridded / vector-field half of matplotlib's plot-type
 * gallery: filled contours, a non-uniform colour mesh, streamlines and wind
 * barbs.
 *
 * All four are free functions that compose existing layers (patches + lines),
 * the same shape as the finance / ML / diagram packs — no new shaders.
 */
import { colormap, type ColormapSpec } from "../color/colormap.js";
import { toColorCss } from "../gl/context.js";
import type { ContourLayer } from "../layers/contour.js";
import type { LineLayer } from "../layers/line.js";
import type { Patch, PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { Range, RenderType } from "../types.js";
import { clipScalarInto, segmentQuad } from "./_geom.js";

/** A grid of scalar values sampled at the nodes of a regular lattice. */
export interface ScalarField {
  /** Row-major, length `cols * rows`; row 0 is at the bottom of `extent.y`. */
  values: ArrayLike<number>;
  cols: number;
  rows: number;
  extent: { x: Range; y: Range };
}

// --- Filled contours ---------------------------------------------------------

/** One filled band: the region of the field where `lo <= v <= hi`. */
export interface IsobandPolygon {
  lo: number;
  hi: number;
  x: Float64Array;
  y: Float64Array;
}

/** Evenly spaced level boundaries covering the field, when the caller gives a count. */
function autoLevels(values: ArrayLike<number>, count: number): number[] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  return Array.from({ length: count + 1 }, (_, i) => lo + ((hi - lo) * i) / count);
}

/**
 * Filled contour bands (matplotlib's `contourf`).
 *
 * Each grid cell is split into four triangles around its centre before clipping,
 * which is what removes the saddle ambiguity plain marching squares has — a
 * triangle's linear interpolant cannot produce two disjoint regions.
 *
 * A cell only needs that subdivision when it actually straddles a level, which
 * most cells do not — the interior of a band is the bulk of any field. Runs of
 * uniform cells along a row merge into one rectangle, so a smooth field emits a
 * few wide bars per band instead of a polygon per cell. That is where the
 * polygon count — and the triangulation and upload behind it — mostly goes.
 */
export function isobands(field: ScalarField, levels: number[] | number = 8): IsobandPolygon[] {
  const { values, cols, rows } = field;
  const [x0, x1] = field.extent.x;
  const [y0, y1] = field.extent.y;
  const bounds = Array.isArray(levels) ? [...levels].sort((a, b) => a - b) : autoLevels(values, levels);
  const nb = bounds.length - 1;
  if (nb < 1 || cols < 2 || rows < 2) return [];

  const gx = (c: number): number => x0 + (c / (cols - 1)) * (x1 - x0);
  const gy = (r: number): number => y0 + (r / (rows - 1)) * (y1 - y0);
  const at = (c: number, r: number): number => values[r * cols + c]!;

  /** Band a value falls in, clamped to the ends; -1 when the value is not finite. */
  const bandOf = (v: number): number => {
    if (!isFinite(v)) return -1;
    let lo = 0, hi = nb - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (v > bounds[mid + 1]!) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const out: IsobandPolygon[] = [];
  // Scratch for the clipper: a triangle cut by two half-planes yields at most
  // five vertices, so eight is ample and the hot loop allocates nothing but the
  // polygons it actually keeps.
  const tx = new Float64Array(8), ty = new Float64Array(8), tv = new Float64Array(8);
  const ax = new Float64Array(8), ay = new Float64Array(8), av = new Float64Array(8);
  const bx = new Float64Array(8), by = new Float64Array(8), bv = new Float64Array(8);

  const emit = (lo: number, hi: number): void => {
    const na = clipScalarInto(tx, ty, tv, 3, lo, true, ax, ay, av);
    if (na < 3) return;
    const nbv = clipScalarInto(ax, ay, av, na, hi, false, bx, by, bv);
    if (nbv < 3) return;
    out.push({ lo, hi, x: bx.slice(0, nbv), y: by.slice(0, nbv) });
  };

  // Row of band indices, reused down the grid: each row's lower edge is the next
  // row's upper edge, so every value is classified once rather than four times.
  const bandRow = new Int32Array(cols);
  const nextRow = new Int32Array(cols);
  for (let c = 0; c < cols; c++) bandRow[c] = bandOf(at(c, 0));

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) nextRow[c] = bandOf(at(c, r + 1));
    const ya = gy(r), yb = gy(r + 1);

    // Open run of uniform cells in this row: band, and the column it started at.
    let runBand = -1;
    let runStart = 0;
    const flushRun = (endCol: number): void => {
      if (runBand < 0) return;
      out.push({
        lo: bounds[runBand]!, hi: bounds[runBand + 1]!,
        x: Float64Array.from([gx(runStart), gx(endCol), gx(endCol), gx(runStart)]),
        y: Float64Array.from([ya, ya, yb, yb]),
      });
      runBand = -1;
    };

    for (let c = 0; c < cols - 1; c++) {
      const b0 = bandRow[c]!, b1 = bandRow[c + 1]!, b2 = nextRow[c + 1]!, b3 = nextRow[c]!;
      if (b0 < 0 || b1 < 0 || b2 < 0 || b3 < 0) { flushRun(c); continue; }
      const xa = gx(c), xb = gx(c + 1);

      // Whole cell inside one band: extend the current run rather than emitting.
      if (b0 === b1 && b1 === b2 && b2 === b3) {
        if (runBand === b0) continue;
        flushRun(c);
        runBand = b0;
        runStart = c;
        continue;
      }
      flushRun(c);

      const v0 = at(c, r), v1 = at(c + 1, r), v2 = at(c + 1, r + 1), v3 = at(c, r + 1);
      const xc = (xa + xb) / 2, yc = (ya + yb) / 2, vc = (v0 + v1 + v2 + v3) / 4;
      const cx = [xa, xb, xb, xa], cy = [ya, ya, yb, yb], cv = [v0, v1, v2, v3];
      const lowest = Math.min(b0, b1, b2, b3);
      const highest = Math.max(b0, b1, b2, b3);

      for (let k = 0; k < 4; k++) {
        const j = (k + 1) & 3;
        tx[0] = cx[k]!; tx[1] = cx[j]!; tx[2] = xc;
        ty[0] = cy[k]!; ty[1] = cy[j]!; ty[2] = yc;
        tv[0] = cv[k]!; tv[1] = cv[j]!; tv[2] = vc;
        const tmin = Math.min(tv[0], tv[1], tv[2]);
        const tmax = Math.max(tv[0], tv[1], tv[2]);
        for (let b = lowest; b <= highest; b++) {
          const lo = bounds[b]!, hi = bounds[b + 1]!;
          if (tmax < lo || tmin > hi) continue;
          // Wholly inside the band — the clip would return it unchanged.
          if (tmin >= lo && tmax <= hi) {
            out.push({ lo, hi, x: tx.slice(0, 3), y: ty.slice(0, 3) });
            continue;
          }
          emit(lo, hi);
        }
      }
    }
    flushRun(cols - 1);
    bandRow.set(nextRow);
  }
  return out;
}

export interface ContourFilledOptions extends ScalarField {
  /** Explicit band boundaries, or a count of evenly spaced bands. Default 8. */
  levels?: number[] | number;
  colormap?: ColormapSpec;
  /** Value range mapped to the colormap. Defaults to the level span. */
  domain?: Range;
  /** Fill opacity, 0..1. Default 1. */
  opacity?: number;
  /** Also stroke the band boundaries. Default false. */
  lines?: boolean;
  lineColor?: string;
  /** Series name — used as the colorbar caption. */
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

export interface ContourFilledHandle {
  bands: PatchesLayer;
  /** The stroked boundaries, present only when `lines` is set. */
  lines?: ContourLayer;
}

/**
 * Filled contours (`contourf`). Bands are coloured by their midpoint through the
 * colormap, so the layer's colorbar reads as a proper value scale.
 */
export function addContourFilled(plot: Plot, opts: ContourFilledOptions): ContourFilledHandle {
  const bands = isobands(opts, opts.levels ?? 8);
  const boundaries = Array.isArray(opts.levels)
    ? [...opts.levels].sort((a, b) => a - b)
    : autoLevels(opts.values, opts.levels ?? 8);
  const domain: Range = opts.domain ?? [boundaries[0]!, boundaries[boundaries.length - 1]!];

  const patches: Patch[] = bands.map((b) => ({ x: b.x, y: b.y, value: (b.lo + b.hi) / 2 }));
  const layer = plot.addPatches({
    patches,
    colormap: opts.colormap ?? "viridis",
    domain,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
    yAxis: opts.yAxis,
  });
  const strokes = opts.lines
    ? plot.addContour({
        values: opts.values, cols: opts.cols, rows: opts.rows, extent: opts.extent,
        levels: boundaries.slice(1, -1),
        // Mid-slate reads on both themes; a dark default vanishes on a dark one.
        color: opts.lineColor ?? "rgba(148,163,184,0.85)",
        renderType: opts.renderType,
        yAxis: opts.yAxis,
      })
    : undefined;
  return { bands: layer, ...(strokes ? { lines: strokes } : {}) };
}

// --- Non-uniform colour mesh -------------------------------------------------

export interface PcolormeshOptions {
  /** Cell values, row-major, length `(xEdges.length - 1) * (yEdges.length - 1)`. */
  values: ArrayLike<number>;
  /**
   * Cell boundaries. 1-D arrays give a rectilinear mesh; 2-D arrays (row-major,
   * `(rows + 1) * (cols + 1)` long) give a curvilinear one, where every corner
   * is placed independently.
   */
  xEdges: ArrayLike<number>;
  yEdges: ArrayLike<number>;
  /** Set when `xEdges`/`yEdges` are the flattened 2-D corner grids. */
  curvilinear?: boolean;
  colormap?: ColormapSpec;
  domain?: Range;
  opacity?: number;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

/**
 * A colour mesh over unevenly spaced cells (matplotlib's `pcolormesh`).
 *
 * A {@link Plot.addHeatmap} is the faster choice when the grid is uniform — it
 * is one textured quad. This exists for the case a heatmap cannot express:
 * bins of different widths (log-spaced frequency, ragged time buckets) or a
 * warped curvilinear grid.
 */
export function addPcolormesh(plot: Plot, opts: PcolormeshOptions): PatchesLayer {
  const { xEdges, yEdges, values } = opts;
  const patches: Patch[] = [];

  if (opts.curvilinear) {
    // Corner grids carry no shape of their own, so solve for it:
    // (rows+1)*(cols+1) == corners and rows*cols == cells.
    const corners = Math.min(xEdges.length, yEdges.length);
    const cells = values.length;
    let nc = 0, nr = 0;
    for (let c = 1; c <= cells; c++) {
      if (cells % c !== 0) continue;
      const r = cells / c;
      if ((r + 1) * (c + 1) === corners) { nc = c; nr = r; break; }
    }
    if (!nc) throw new Error("addPcolormesh: curvilinear edges must be (rows+1)x(cols+1) for rows*cols values");
    const cx = (c: number, r: number): number => xEdges[r * (nc + 1) + c]!;
    const cy = (c: number, r: number): number => yEdges[r * (nc + 1) + c]!;
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        patches.push({
          x: Float64Array.from([cx(c, r), cx(c + 1, r), cx(c + 1, r + 1), cx(c, r + 1)]),
          y: Float64Array.from([cy(c, r), cy(c + 1, r), cy(c + 1, r + 1), cy(c, r + 1)]),
          value: values[r * nc + c]!,
        });
      }
    }
  } else {
    const nc = xEdges.length - 1;
    const nr = yEdges.length - 1;
    if (nc < 1 || nr < 1 || values.length < nc * nr) {
      throw new Error(`addPcolormesh: need ${nc}x${nr} values for the given edges, got ${values.length}`);
    }
    for (let r = 0; r < nr; r++) {
      const y0 = yEdges[r]!, y1 = yEdges[r + 1]!;
      for (let c = 0; c < nc; c++) {
        const x0 = xEdges[c]!, x1 = xEdges[c + 1]!;
        patches.push({
          x: Float64Array.from([x0, x1, x1, x0]),
          y: Float64Array.from([y0, y0, y1, y1]),
          value: values[r * nc + c]!,
        });
      }
    }
  }

  return plot.addPatches({
    patches,
    colormap: opts.colormap ?? "viridis",
    domain: opts.domain,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
    yAxis: opts.yAxis,
  });
}

// --- Streamlines -------------------------------------------------------------

/** A vector field sampled on a regular lattice. */
export interface VectorField {
  /** Row-major u / v components, length `cols * rows`; row 0 at the bottom. */
  u: ArrayLike<number>;
  v: ArrayLike<number>;
  cols: number;
  rows: number;
  extent: { x: Range; y: Range };
}

export interface StreamlineOptions {
  /** Seeds per axis, as a multiple of the base 25x25 lattice. Default 1. */
  density?: number;
  /** Integration step as a fraction of a cell. Default 0.35. */
  step?: number;
  /** Give up on a line after this many steps in each direction. Default 400. */
  maxSteps?: number;
}

/** One traced streamline, in data space. */
export interface Streamline {
  x: Float64Array;
  y: Float64Array;
  /** Mean |velocity| along the line — useful for colouring. */
  speed: number;
}

/**
 * Trace streamlines through a vector field with RK4 integration.
 *
 * Seeds walk a lattice and each line stops when it re-enters a cell another line
 * already occupies, which is matplotlib's trick for spacing them evenly instead
 * of letting them bunch up along attractors.
 */
export function streamlines(field: VectorField, opts: StreamlineOptions = {}): Streamline[] {
  const { u, v, cols, rows } = field;
  const [x0, x1] = field.extent.x;
  const [y0, y1] = field.extent.y;
  const density = Math.max(0.1, opts.density ?? 1);
  const maxSteps = Math.max(10, Math.floor(opts.maxSteps ?? 400));
  const dx = (x1 - x0) / Math.max(1, cols - 1);
  const dy = (y1 - y0) / Math.max(1, rows - 1);
  const h = (opts.step ?? 0.35) * Math.min(Math.abs(dx), Math.abs(dy));

  // Bilinear sample of (u, v) at a data-space point; null outside the field.
  const sample = (px: number, py: number): [number, number] | null => {
    const fc = ((px - x0) / (x1 - x0)) * (cols - 1);
    const fr = ((py - y0) / (y1 - y0)) * (rows - 1);
    if (!(fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1)) return null;
    const c = Math.min(cols - 2, Math.floor(fc)), r = Math.min(rows - 2, Math.floor(fr));
    const tc = fc - c, tr = fr - r;
    const mix = (a: ArrayLike<number>): number => {
      const a00 = a[r * cols + c]!, a10 = a[r * cols + c + 1]!;
      const a01 = a[(r + 1) * cols + c]!, a11 = a[(r + 1) * cols + c + 1]!;
      return (a00 * (1 - tc) + a10 * tc) * (1 - tr) + (a01 * (1 - tc) + a11 * tc) * tr;
    };
    return [mix(u), mix(v)];
  };

  // Occupancy lattice — one line per cell keeps the spacing even.
  const gc = Math.max(2, Math.round(25 * density));
  const gr = Math.max(2, Math.round(25 * density));
  const taken = new Uint8Array(gc * gr);
  const cellOf = (px: number, py: number): number => {
    const c = Math.min(gc - 1, Math.max(0, Math.floor(((px - x0) / (x1 - x0)) * gc)));
    const r = Math.min(gr - 1, Math.max(0, Math.floor(((py - y0) / (y1 - y0)) * gr)));
    return r * gc + c;
  };

  /** Integrate from a seed in one direction; returns the path (seed first). */
  const trace = (sx: number, sy: number, sign: number, claim: number[]): { x: number[]; y: number[]; s: number[] } => {
    const px: number[] = [sx], py: number[] = [sy], ps: number[] = [];
    let cx = sx, cy = sy;
    for (let i = 0; i < maxSteps; i++) {
      const k1 = sample(cx, cy);
      if (!k1) break;
      const speed = Math.hypot(k1[0], k1[1]);
      if (!(speed > 1e-12)) break;
      ps.push(speed);
      const k2 = sample(cx + (sign * h * k1[0]) / (2 * speed), cy + (sign * h * k1[1]) / (2 * speed));
      const k3 = k2 ? sample(cx + (sign * h * k2[0]) / (2 * Math.hypot(k2[0], k2[1] || 1e-12)),
                             cy + (sign * h * k2[1]) / (2 * Math.hypot(k2[0], k2[1] || 1e-12))) : null;
      const k4 = k3 ? sample(cx + (sign * h * k3[0]) / Math.hypot(k3[0], k3[1] || 1e-12),
                             cy + (sign * h * k3[1]) / Math.hypot(k3[0], k3[1] || 1e-12)) : null;
      const acc: [number, number] = k2 && k3 && k4
        ? [(k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6, (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6]
        : [k1[0], k1[1]];
      const m = Math.hypot(acc[0], acc[1]) || 1e-12;
      cx += (sign * h * acc[0]) / m;
      cy += (sign * h * acc[1]) / m;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) break;
      const cell = cellOf(cx, cy);
      if (taken[cell] && !claim.includes(cell)) break;
      claim.push(cell);
      px.push(cx); py.push(cy);
    }
    return { x: px, y: py, s: ps };
  };

  const out: Streamline[] = [];
  for (let r = 0; r < gr; r++) {
    for (let c = 0; c < gc; c++) {
      if (taken[r * gc + c]) continue;
      const sx = x0 + ((c + 0.5) / gc) * (x1 - x0);
      const sy = y0 + ((r + 0.5) / gr) * (y1 - y0);
      if (!sample(sx, sy)) continue;
      const claim: number[] = [r * gc + c];
      const fwd = trace(sx, sy, 1, claim);
      const back = trace(sx, sy, -1, claim);
      const nx = [...back.x.slice(1).reverse(), ...fwd.x];
      const ny = [...back.y.slice(1).reverse(), ...fwd.y];
      if (nx.length < 3) continue;
      for (const cell of claim) taken[cell] = 1;
      const speeds = [...back.s, ...fwd.s];
      const speed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
      out.push({ x: Float64Array.from(nx), y: Float64Array.from(ny), speed });
    }
  }
  return out;
}

export interface StreamplotOptions extends VectorField, StreamlineOptions {
  color?: string;
  width?: number;
  /** Colour each line by its mean speed through this colormap instead of `color`. */
  colormap?: ColormapSpec;
  /** Draw an arrowhead at the midpoint of each line. Default true. */
  arrows?: boolean;
  /** Arrow size in data units. Defaults to a third of a cell. */
  arrowSize?: number;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

export interface StreamplotHandle {
  lines: LineLayer[];
  arrows?: PatchesLayer;
  traced: Streamline[];
}

/**
 * Streamlines of a 2-D vector field (matplotlib's `streamplot`).
 *
 * Each traced line becomes its own line layer — evenly spaced seeding keeps that
 * to a few dozen even on a dense field, and it is what lets a line be coloured
 * by its own mean speed.
 */
export function addStreamplot(plot: Plot, opts: StreamplotOptions): StreamplotHandle {
  const traced = streamlines(opts, opts);
  const speeds = traced.map((s) => s.speed);
  const lo = speeds.length ? Math.min(...speeds) : 0;
  const hi = speeds.length ? Math.max(...speeds) : 1;
  const span = hi - lo || 1;
  // A line is one colour, so speed colouring is per-line rather than per-vertex.
  const cmap = opts.colormap ? colormap(opts.colormap) : null;

  const lines = traced.map((s) => plot.addLine({
    x: s.x,
    y: s.y,
    color: cmap ? toColorCss([...cmap((s.speed - lo) / span), 1]) : (opts.color ?? "#60a5fa"),
    width: opts.width ?? 1.4,
    renderType: opts.renderType,
    yAxis: opts.yAxis,
  }));

  let arrows: PatchesLayer | undefined;
  if (opts.arrows !== false) {
    const [x0, x1] = opts.extent.x;
    const size = opts.arrowSize ?? Math.abs(x1 - x0) / Math.max(1, opts.cols - 1) * 0.9;
    const patches: Patch[] = [];
    for (const s of traced) {
      const mid = Math.floor(s.x.length / 2);
      if (mid < 1 || mid >= s.x.length) continue;
      const ax = s.x[mid]!, ay = s.y[mid]!;
      const ux = ax - s.x[mid - 1]!, uy = ay - s.y[mid - 1]!;
      const m = Math.hypot(ux, uy) || 1e-12;
      const dx2 = (ux / m) * size, dy2 = (uy / m) * size;
      // Tip ahead of the midpoint, base corners across the perpendicular. The
      // head takes its line's colour, or a speed-coloured plot looks mismatched.
      patches.push({
        x: Float64Array.from([ax + dx2, ax - dy2 * 0.45, ax + dy2 * 0.45]),
        y: Float64Array.from([ay + dy2, ay + dx2 * 0.45, ay - dx2 * 0.45]),
        color: cmap ? toColorCss([...cmap((s.speed - lo) / span), 1]) : (opts.color ?? "#60a5fa"),
      });
    }
    if (patches.length) arrows = plot.addPatches({ patches, renderType: opts.renderType, yAxis: opts.yAxis });
  }

  return { lines, arrows, traced };
}

// --- Wind barbs --------------------------------------------------------------

export interface BarbsOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  u: ArrayLike<number>;
  v: ArrayLike<number>;
  /**
   * Speed one half-barb represents. A full barb is 2x this and a pennant 10x —
   * the meteorological default of 5 knots per half-barb. Default 5.
   */
  increment?: number;
  /** Staff length in data units. Defaults to a fifth of the x span. */
  length?: number;
  color?: string;
  width?: number;
  name?: string;
  renderType?: RenderType;
  yAxis?: string;
}

export interface BarbsHandle {
  /** Staffs and barb ticks (thin quads). */
  staff: PatchesLayer;
  /** Filled pennants, present only when some sample is fast enough for one. */
  pennants?: PatchesLayer;
}

/**
 * Wind barbs (matplotlib's `barbs`) — the meteorological glyph where speed is
 * read off the ticks rather than the arrow length: a half tick per `increment`,
 * a full tick per two, and a filled pennant per ten.
 */
export function addBarbs(plot: Plot, opts: BarbsOptions): BarbsHandle {
  const n = Math.min(opts.x.length, opts.y.length, opts.u.length, opts.v.length);
  const inc = opts.increment ?? 5;
  const color = opts.color ?? "#e2e8f0";

  let xlo = Infinity, xhi = -Infinity;
  for (let i = 0; i < n; i++) { const v = opts.x[i]!; if (v < xlo) xlo = v; if (v > xhi) xhi = v; }
  const len = opts.length ?? (isFinite(xhi - xlo) && xhi > xlo ? (xhi - xlo) / 12 : 1);
  const stroke = opts.width ?? len * 0.06;
  const tick = len * 0.42;

  const strokes: Patch[] = [];
  const pennants: Patch[] = [];

  for (let i = 0; i < n; i++) {
    const px = opts.x[i]!, py = opts.y[i]!, u = opts.u[i]!, v = opts.v[i]!;
    const speed = Math.hypot(u, v);
    if (!isFinite(speed)) continue;
    if (speed < inc / 2) {
      // Calm: matplotlib draws a small open circle; a short cross reads the same
      // at this size and needs no curve.
      strokes.push(segmentQuad(px - tick * 0.2, py, px + tick * 0.2, py, stroke, color));
      strokes.push(segmentQuad(px, py - tick * 0.2, px, py + tick * 0.2, stroke, color));
      continue;
    }
    // The staff points *into* the wind, as the convention requires.
    const dx = -u / speed, dy = -v / speed;
    const tipX = px + dx * len, tipY = py + dy * len;
    strokes.push(segmentQuad(px, py, tipX, tipY, stroke, color));

    // Barb ticks hang off the tip end, at 60 degrees back along the staff.
    const bx = -dx * Math.cos(Math.PI / 3) - dy * Math.sin(Math.PI / 3);
    const by = -dy * Math.cos(Math.PI / 3) + dx * Math.sin(Math.PI / 3);

    let left = Math.round(speed / inc);
    let slot = 0;
    const spacing = len * 0.16;
    const anchor = (k: number): [number, number] => [tipX - dx * spacing * k, tipY - dy * spacing * k];

    while (left >= 10) {
      const [ax, ay] = anchor(slot);
      const [cx2, cy2] = anchor(slot + 1);
      pennants.push({
        x: Float64Array.from([ax, ax + bx * tick, cx2]),
        y: Float64Array.from([ay, ay + by * tick, cy2]),
        color,
      });
      left -= 10;
      slot += 1.4;
    }
    while (left >= 2) {
      const [ax, ay] = anchor(slot);
      strokes.push(segmentQuad(ax, ay, ax + bx * tick, ay + by * tick, stroke, color));
      left -= 2;
      slot += 1;
    }
    if (left >= 1) {
      // A lone half-barb sits one slot in, so it is never mistaken for a full one.
      const [ax, ay] = anchor(slot === 0 ? 1 : slot);
      strokes.push(segmentQuad(ax, ay, ax + bx * tick * 0.5, ay + by * tick * 0.5, stroke, color));
    }
  }

  const staff = plot.addPatches({
    patches: strokes, color, name: opts.name, renderType: opts.renderType, yAxis: opts.yAxis,
  });
  const pennantLayer = pennants.length
    ? plot.addPatches({ patches: pennants, color, renderType: opts.renderType, yAxis: opts.yAxis })
    : undefined;
  return { staff, pennants: pennantLayer };
}
