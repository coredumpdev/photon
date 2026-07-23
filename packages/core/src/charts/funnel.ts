/**
 * Funnel chart — a pure layout plus a {@link Plot} builder that composes the
 * existing {@link PatchesLayer} (one centered trapezoid per stage) with a
 * centered label per stage. Import from `@photonviz/core`.
 */
import { type Patch, type PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";

/** One funnel stage: a labeled weighted value. */
export interface FunnelItem {
  label: string;
  value: number;
  /** Explicit fill; otherwise a palette color is cycled by index. */
  color?: string;
}

/** A laid-out stage: the input item plus its trapezoid polygon ring. */
export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
  /** Closed polygon ring (4 corners) in data space. */
  poly: { x: number[]; y: number[] };
}

export interface FunnelLayoutOptions {
  /** Full plot width the largest stage spans. Default 1 (extent `[-0.5, 0.5]`). */
  width?: number;
  /** Total stack height. Default 1 (extent `[0, 1]`, top stage first). */
  height?: number;
  /** Bottom width of the last stage as a fraction of its value width. Default 0.4. */
  neck?: number;
}

/** tab10-ish default palette, cycled by index for stages without a color. */
export const FUNNEL_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

/**
 * Funnel layout: centered trapezoids stacked top-to-bottom, each stage's top
 * width ∝ its value and bottom width ∝ the next value (the last stage tapers to
 * a `neck` fraction of its own width). Pure — no side effects.
 */
export function funnelLayout(
  items: readonly FunnelItem[],
  opts: FunnelLayoutOptions = {},
): FunnelStage[] {
  const n = items.length;
  if (n === 0) return [];
  const fullW = opts.width ?? 1;
  const fullH = opts.height ?? 1;
  const neck = opts.neck ?? 0.4;

  // Widths scale off the largest value so the top stage spans `fullW`.
  const maxV = items.reduce((m, it) => Math.max(m, it.value), 0) || 1;
  const halfW = (i: number): number => (Math.max(0, items[i]!.value) / maxV) * fullW * 0.5;

  const stageH = fullH / n;
  const stages: FunnelStage[] = [];
  for (let i = 0; i < n; i++) {
    const top = fullH - i * stageH;
    const bot = fullH - (i + 1) * stageH;
    const wTop = halfW(i);
    const wBot = i + 1 < n ? halfW(i + 1) : wTop * neck;
    stages.push({
      label: items[i]!.label,
      value: items[i]!.value,
      color: items[i]!.color,
      // CW ring: top-left, top-right, bottom-right, bottom-left.
      poly: {
        x: [-wTop, wTop, wBot, -wBot],
        y: [top, top, bot, bot],
      },
    });
  }
  return stages;
}

export interface FunnelOptions {
  items: FunnelItem[];
  width?: number;
  height?: number;
  neck?: number;
  /** Palette cycled by index for stages lacking a `color`. Defaults to {@link FUNNEL_PALETTE}. */
  colors?: string[];
  opacity?: number;
  name?: string;
  renderType?: RenderType;
  /** Draw a centered label per stage. Default true. */
  labels?: boolean;
}

/**
 * Add a funnel chart: one filled trapezoid {@link Patch} per stage plus centered
 * labels. Composes {@link Plot.addPatches} — low-risk, no new layer type.
 */
export function addFunnel(plot: Plot, opts: FunnelOptions): PatchesLayer {
  const palette = opts.colors && opts.colors.length ? opts.colors : FUNNEL_PALETTE;
  const stages = funnelLayout(opts.items, opts);

  const patches: Patch[] = stages.map((s, i) => ({
    x: s.poly.x,
    y: s.poly.y,
    color: s.color ?? palette[i % palette.length]!,
  }));

  const layer = plot.addPatches({
    patches,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
  });

  if (opts.labels !== false) {
    for (const s of stages) {
      const cy = (s.poly.y[0]! + s.poly.y[2]!) / 2;
      plot.addAnnotation({ type: "label", x: 0, y: cy, text: s.label, align: "center" });
    }
  }

  return layer;
}
