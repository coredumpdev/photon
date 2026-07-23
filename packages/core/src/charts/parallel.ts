/**
 * Parallel coordinates — a pure per-dimension normalization plus a {@link Plot}
 * builder that composes existing {@link LineLayer}s: one polyline per row crossing
 * N vertical axes, each axis drawn as a `span` guide with a name label on top.
 * Import from `@photonviz/core`.
 */
import { type LineLayer } from "../layers/line.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";

/** tab10-ish default palette, cycled by row index (or by `colorBy` band). */
export const PARALLEL_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

/** A laid-out axis: its dimension name, x position, and observed value range. */
export interface ParallelAxis {
  dim: string;
  x: number;
  min: number;
  max: number;
}

/** A laid-out row as a polyline of N points (one per dimension). */
export interface ParallelLine {
  row: number;
  x: number[];
  y: number[];
}

/** The result of {@link parallelLayout}: axis metadata plus per-row polylines. */
export interface ParallelLayoutResult {
  axes: ParallelAxis[];
  lines: ParallelLine[];
}

/**
 * Parallel-coordinates layout: axis `i` sits at `x = i`; each dimension's values
 * are normalized to `y ∈ [0,1]` by its own min/max (a flat dimension maps to 0.5).
 * Each row becomes an N-point polyline. Pure — no side effects. Non-finite values
 * fall back to the axis midpoint.
 */
export function parallelLayout(dimensions: string[], rows: number[][]): ParallelLayoutResult {
  const d = dimensions.length;
  const mins = new Array<number>(d).fill(Infinity);
  const maxs = new Array<number>(d).fill(-Infinity);
  for (const row of rows) {
    for (let i = 0; i < d; i++) {
      const v = row[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (v < mins[i]!) mins[i] = v;
      if (v > maxs[i]!) maxs[i] = v;
    }
  }
  // Empty dimensions collapse to a [0,1] range so normalization stays finite.
  for (let i = 0; i < d; i++) {
    if (!Number.isFinite(mins[i]!)) { mins[i] = 0; maxs[i] = 1; }
  }

  const axes: ParallelAxis[] = dimensions.map((dim, i) => ({ dim, x: i, min: mins[i]!, max: maxs[i]! }));

  const lines: ParallelLine[] = rows.map((row, r) => {
    const x: number[] = new Array(d);
    const y: number[] = new Array(d);
    for (let i = 0; i < d; i++) {
      const span = maxs[i]! - mins[i]!;
      const v = row[i];
      const norm = v == null || !Number.isFinite(v) || span === 0 ? 0.5 : (v - mins[i]!) / span;
      x[i] = i;
      y[i] = norm;
    }
    return { row: r, x, y };
  });

  return { axes, lines };
}

export interface ParallelOptions {
  /** One name per axis, left to right. */
  dimensions: string[];
  /** Data rows, each parallel to `dimensions`. */
  rows: number[][];
  /** Optional per-row value mapped through a palette ramp for coloring. */
  colorBy?: number[];
  /** Palette cycled by row index (or banded by `colorBy`). Defaults to {@link PARALLEL_PALETTE}. */
  colors?: string[];
  /** Polyline width in px. Default 1. */
  width?: number;
  /** Line opacity, 0..1. Default 0.7. */
  opacity?: number;
  name?: string;
  renderType?: RenderType;
}

/** The layers created by {@link addParallelCoordinates}: one {@link LineLayer} per row. */
export interface ParallelHandle {
  lines: LineLayer[];
}

/**
 * Add a parallel-coordinates plot: each row as a {@link Plot.addLine} polyline
 * (colored via `colorBy` ramp or a cycled palette), each axis as a vertical
 * `span` guide, plus a dimension-name label at the top of every axis.
 */
export function addParallelCoordinates(plot: Plot, opts: ParallelOptions): ParallelHandle {
  const palette = opts.colors && opts.colors.length ? opts.colors : PARALLEL_PALETTE;
  const width = opts.width ?? 1;
  const opacity = opts.opacity ?? 0.7;
  const { axes, lines } = parallelLayout(opts.dimensions, opts.rows);

  // Color ramp bounds for `colorBy`, if provided.
  let cbMin = Infinity, cbMax = -Infinity;
  if (opts.colorBy) {
    for (const v of opts.colorBy) {
      if (!Number.isFinite(v)) continue;
      if (v < cbMin) cbMin = v;
      if (v > cbMax) cbMax = v;
    }
  }
  const cbSpan = cbMax - cbMin;

  const rowColor = (r: number): string => {
    if (opts.colorBy && Number.isFinite(cbMin)) {
      const v = opts.colorBy[r];
      const t = v == null || !Number.isFinite(v) || cbSpan === 0 ? 0 : (v - cbMin) / cbSpan;
      const band = Math.min(palette.length - 1, Math.max(0, Math.floor(t * palette.length)));
      return palette[band]!;
    }
    return palette[r % palette.length]!;
  };

  const layers: LineLayer[] = lines.map((ln, r) =>
    plot.addLine({
      x: ln.x,
      y: ln.y,
      color: withAlpha(rowColor(r), opacity),
      width,
      name: r === 0 ? opts.name : undefined,
      renderType: opts.renderType,
    }),
  );

  // Vertical axis guides plus a dimension label at the top of each.
  for (const ax of axes) {
    plot.addAnnotation({ type: "span", dim: "x", value: ax.x });
    plot.addAnnotation({ type: "label", x: ax.x, y: 1, text: ax.dim, align: "center" });
  }

  return { lines: layers };
}

/** Apply `alpha` to a hex color, producing an `rgba(...)` string (else pass through). */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
  }
  return color;
}
