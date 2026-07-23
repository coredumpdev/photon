/**
 * Squarified treemap — a pure layout plus a {@link Plot} builder that composes
 * the existing {@link PatchesLayer} (one rect patch per item) and a centered
 * label annotation per cell. Import from `@photonviz/core`.
 */
import { type Patch, type PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";

/** A weighted item to lay into the treemap. */
export interface TreemapItem {
  label: string;
  value: number;
  /** Explicit fill; otherwise a palette color is cycled by index. */
  color?: string;
}

/** A laid-out cell: the input item plus its axis-aligned rect `[x0,y0]`–`[x1,y1]`. */
export interface TreemapCell {
  label: string;
  value: number;
  color?: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle the layout fills. */
export interface TreemapExtent {
  x: [number, number];
  y: [number, number];
}

const DEFAULT_EXTENT: TreemapExtent = { x: [0, 1], y: [0, 1] };

/** tab10-ish default palette, cycled by index for items without a color. */
export const TREEMAP_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

/** Worst aspect ratio of a row of areas laid across a strip of thickness `w`. */
function worst(row: number[], w: number, sum: number): number {
  if (row.length === 0 || w === 0) return Infinity;
  let max = -Infinity, min = Infinity;
  for (const a of row) {
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = sum * sum, w2 = w * w;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

/**
 * Squarified treemap layout: sizes rects ∝ `value`, packing them into `extent`
 * with aspect ratios kept near 1. Pure — no side effects. Zero/negative values
 * and empty input yield no cells.
 */
export function treemapLayout(
  items: readonly TreemapItem[],
  extent: TreemapExtent = DEFAULT_EXTENT,
): TreemapCell[] {
  const clean = items.filter((it) => it.value > 0);
  if (clean.length === 0) return [];

  // Sort descending by value (squarify assumes this ordering).
  const order = clean
    .map((_, i) => i)
    .sort((a, b) => clean[b]!.value - clean[a]!.value);

  const total = clean.reduce((s, it) => s + it.value, 0);
  let [x0, x1] = extent.x;
  let [y0, y1] = extent.y;
  const totalArea = Math.abs(x1 - x0) * Math.abs(y1 - y0);
  // Normalize each value into an area proportion of the working rect.
  const areas = order.map((i) => (clean[i]!.value / total) * totalArea);

  const cells: TreemapCell[] = [];
  let pos = 0; // index into `order`/`areas`

  /** Place a finished row of areas along the shorter side, advancing the rect. */
  const layoutRow = (row: number[], startPos: number): void => {
    const rowSum = row.reduce((s, a) => s + a, 0);
    const w = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
    if (rowSum === 0 || w === 0) return;
    const horizontal = Math.abs(y1 - y0) < Math.abs(x1 - x0);
    if (horizontal) {
      // Row runs down the left edge, thickness along x.
      const rowW = rowSum / Math.abs(y1 - y0);
      let cy = y0;
      for (let k = 0; k < row.length; k++) {
        const idx = order[startPos + k]!;
        const h = (row[k]! / rowSum) * Math.abs(y1 - y0);
        cells.push({
          label: clean[idx]!.label, value: clean[idx]!.value, color: clean[idx]!.color,
          x0, y0: cy, x1: x0 + rowW, y1: cy + h,
        });
        cy += h;
      }
      x0 += rowW;
    } else {
      // Row runs across the bottom edge, thickness along y.
      const rowH = rowSum / Math.abs(x1 - x0);
      let cx = x0;
      for (let k = 0; k < row.length; k++) {
        const idx = order[startPos + k]!;
        const wdt = (row[k]! / rowSum) * Math.abs(x1 - x0);
        cells.push({
          label: clean[idx]!.label, value: clean[idx]!.value, color: clean[idx]!.color,
          x0: cx, y0, x1: cx + wdt, y1: y0 + rowH,
        });
        cx += wdt;
      }
      y0 += rowH;
    }
  };

  while (pos < areas.length) {
    const w = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const row: number[] = [];
    let rowSum = 0;
    let start = pos;
    // Grow the current row while it improves (lowers) the worst aspect ratio.
    while (pos < areas.length) {
      const a = areas[pos]!;
      const withNew = worst([...row, a], w, rowSum + a);
      const current = worst(row, w, rowSum);
      if (row.length > 0 && withNew > current) break;
      row.push(a);
      rowSum += a;
      pos++;
    }
    layoutRow(row, start);
  }

  return cells;
}

export interface TreemapOptions {
  items: TreemapItem[];
  extent?: TreemapExtent;
  /** Palette cycled by index for items lacking a `color`. Defaults to {@link TREEMAP_PALETTE}. */
  colors?: string[];
  opacity?: number;
  name?: string;
  renderType?: RenderType;
  /** Draw a centered label per cell (tiny cells are skipped). Default true. */
  labels?: boolean;
}

/** Fraction of the smaller extent side below which a cell's label is suppressed. */
const LABEL_MIN_FRAC = 0.04;

/**
 * Add a squarified treemap: one filled rect {@link Patch} per item plus centered
 * labels. Composes {@link Plot.addPatches} — low-risk, no new layer type.
 */
export function addTreemap(plot: Plot, opts: TreemapOptions): PatchesLayer {
  const extent = opts.extent ?? DEFAULT_EXTENT;
  const palette = opts.colors && opts.colors.length ? opts.colors : TREEMAP_PALETTE;
  const cells = treemapLayout(opts.items, extent);

  const patches: Patch[] = cells.map((c, i) => ({
    x: [c.x0, c.x1, c.x1, c.x0],
    y: [c.y0, c.y0, c.y1, c.y1],
    color: c.color ?? palette[i % palette.length]!,
  }));

  const layer = plot.addPatches({
    patches,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
  });

  if (opts.labels !== false) {
    const minW = Math.abs(extent.x[1] - extent.x[0]) * LABEL_MIN_FRAC;
    const minH = Math.abs(extent.y[1] - extent.y[0]) * LABEL_MIN_FRAC;
    for (const c of cells) {
      if (Math.abs(c.x1 - c.x0) < minW || Math.abs(c.y1 - c.y0) < minH) continue;
      plot.addAnnotation({
        type: "label",
        x: (c.x0 + c.x1) / 2,
        y: (c.y0 + c.y1) / 2,
        text: c.label,
        align: "center",
      });
    }
  }

  return layer;
}
