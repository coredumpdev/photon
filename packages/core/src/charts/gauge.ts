/**
 * Radial gauge builder. Draws a background track arc, a colored value arc over
 * `[min,max]` mapped to an angular sweep (default 220°, 200°→-20°), and a needle.
 * Pure {@link gaugeLayout} produces tessellated polygons; {@link addGauge}
 * composes the existing {@link PatchesLayer}. Import from `@photonviz/core`.
 */
import { type Patch, type PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";

/** An annular-sector polygon, tessellated into a single ring. */
export interface Ring {
  x: number[];
  y: number[];
}

/** A `{value, color}` band; the arc takes the color of the highest one `value` reaches. */
export interface GaugeThreshold {
  value: number;
  color: string;
}

/** Tunables for {@link gaugeLayout}. */
export interface GaugeLayoutOptions {
  value: number;
  /** Value at the start of the sweep. Default 0. */
  min?: number;
  /** Value at the end of the sweep. Default 100. */
  max?: number;
  /** Angle of the sweep start, degrees. Default 200. */
  startAngle?: number;
  /** Angle of the sweep end, degrees. Default -20. */
  endAngle?: number;
  /** Outer radius, data units. Default 1. */
  radius?: number;
  /** Inner (track) radius, data units. Default 0.7. */
  innerRadius?: number;
}

const DEG = Math.PI / 180;

/** Sample an annular sector [a0,a1] radians into a closed ring (outer forward, inner back). */
function arcRing(a0: number, a1: number, r0: number, r1: number): Ring {
  const step = Math.PI / 90; // ~2°
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  const x: number[] = [];
  const y: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = a0 + ((a1 - a0) * s) / segs;
    x.push(r1 * Math.cos(t));
    y.push(r1 * Math.sin(t));
  }
  for (let s = segs; s >= 0; s--) {
    const t = a0 + ((a1 - a0) * s) / segs;
    x.push(r0 * Math.cos(t));
    y.push(r0 * Math.sin(t));
  }
  return { x, y };
}

/**
 * Compute the gauge geometry: a full background sector, a value sector clamped to
 * `[min,max]`, and a thin needle triangle from the center to the value angle.
 * Angles sweep from `startAngle` to `endAngle` (degrees). Side-effect-free.
 */
export function gaugeLayout(opts: GaugeLayoutOptions): { bg: Ring; value: Ring; needle: { x: number[]; y: number[] } } {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const a0 = (opts.startAngle ?? 200) * DEG;
  const a1 = (opts.endAngle ?? -20) * DEG;
  const rOut = opts.radius ?? 1;
  const rIn = opts.innerRadius ?? 0.7;
  const span = max - min || 1;
  const t = Math.min(1, Math.max(0, (opts.value - min) / span));
  const aVal = a0 + (a1 - a0) * t;

  // Needle: thin triangle from center to the value angle.
  const len = rOut * 0.95;
  const hw = (rOut - rIn) * 0.12; // half-width at the base
  const px = Math.cos(aVal + Math.PI / 2), py = Math.sin(aVal + Math.PI / 2);
  const needle = {
    x: [len * Math.cos(aVal), hw * px, -hw * px],
    y: [len * Math.sin(aVal), hw * py, -hw * py],
  };

  return {
    bg: arcRing(a0, a1, rIn, rOut),
    value: arcRing(a0, aVal, rIn, rOut),
    needle,
  };
}

/** Options for {@link addGauge}. */
export interface GaugeOptions {
  value: number;
  /** Value at the start of the sweep. Default 0. */
  min?: number;
  /** Value at the end of the sweep. Default 100. */
  max?: number;
  /** `{value,color}` bands; the value arc takes the color of the highest one reached. */
  thresholds?: GaugeThreshold[];
  /** Value-arc color when no thresholds apply. Default blue. */
  color?: string;
  /** Background-track color. Default a muted gray. */
  trackColor?: string;
  /** Angle of the sweep start, degrees. Default 200. */
  startAngle?: number;
  /** Angle of the sweep end, degrees. Default -20. */
  endAngle?: number;
  /** Needle color. Default a dark slate. */
  needleColor?: string;
  /** Center label text; defaults to the numeric value. Pass `false` to omit. */
  label?: string | false;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming. Default `"static"`. */
  renderType?: RenderType;
}

/** Pick the value-arc color for `value` from thresholds (highest reached), else the default. */
function thresholdColor(value: number, thresholds: GaugeThreshold[] | undefined, fallback: string): string {
  if (!thresholds || thresholds.length === 0) return fallback;
  let color = fallback;
  let best = -Infinity;
  for (const th of thresholds) {
    if (value >= th.value && th.value >= best) {
      best = th.value;
      color = th.color;
    }
  }
  return color;
}

/**
 * Build a radial gauge (track + value arc + needle) and add it as a
 * {@link PatchesLayer} centered at (0,0), with an optional center label.
 * Set the plot's `equalAspect: true` so it stays circular.
 */
export function addGauge(plot: Plot, opts: GaugeOptions): PatchesLayer {
  const track = opts.trackColor ?? "#e5e7eb";
  const valColor = thresholdColor(opts.value, opts.thresholds, opts.color ?? "#3b82f6");
  const needleColor = opts.needleColor ?? "#334155";
  const geo = gaugeLayout({
    value: opts.value,
    min: opts.min,
    max: opts.max,
    startAngle: opts.startAngle,
    endAngle: opts.endAngle,
  });

  const patches: Patch[] = [
    { x: geo.bg.x, y: geo.bg.y, color: track },
    { x: geo.value.x, y: geo.value.y, color: valColor },
    { x: geo.needle.x, y: geo.needle.y, color: needleColor },
  ];

  if (opts.label !== false) {
    plot.addAnnotation({
      type: "label",
      x: 0,
      y: -0.15,
      text: opts.label ?? String(opts.value),
      align: "center",
    });
  }

  return plot.addPatches({ patches, name: opts.name, renderType: opts.renderType });
}
