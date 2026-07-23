/**
 * Sunburst (radial icicle) builder. Renders a hierarchy as concentric annular
 * sectors — one ring per depth, angular span ∝ summed leaf value — by
 * tessellating each sector into a polygon {@link Patch} ring. Pure
 * {@link sunburstLayout} does the math; {@link addSunburst} composes the
 * existing {@link PatchesLayer}. Import from `@photonviz/core`.
 */
import { type Patch, type PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";

/** Default fill palette, cycled by node index when no explicit color is given. */
const DEFAULT_COLORS = [
  "#3b82f6", "#f472b6", "#22d3ee", "#a3e635", "#fbbf24",
  "#a78bfa", "#34d399", "#fb7185", "#60a5fa", "#f59e0b",
];

/** A node in the input hierarchy; `value` counts only for leaves. */
export interface SunburstNode {
  name: string;
  value?: number;
  color?: string;
  children?: SunburstNode[];
}

/** Tunables for {@link sunburstLayout}. */
export interface SunburstLayoutOptions {
  /** Radial thickness of each depth ring, in data units. Default 1. */
  ringWidth?: number;
  /** Inner radius of the depth-0 ring (hole at the center). Default 0. */
  center?: number;
  /** Angle of the first sector edge, radians. Default `Math.PI / 2` (12 o'clock). */
  startAngle?: number;
}

/** One laid-out sector: angular range `[a0,a1]` (radians) and radial ring `[r0,r1]`. */
export interface SunburstArc {
  name: string;
  depth: number;
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  color?: string;
}

/** Summed leaf value of a node (its own `value` if a leaf, else the sum of children). */
function nodeValue(node: SunburstNode): number {
  if (node.children && node.children.length > 0) {
    let sum = 0;
    for (const c of node.children) sum += nodeValue(c);
    return sum;
  }
  return Math.max(0, node.value ?? 0);
}

/**
 * Lay a hierarchy out into flat annular sectors. Angular span is proportional to
 * summed leaf value; each depth occupies its own radius ring. Side-effect-free.
 */
export function sunburstLayout(root: SunburstNode, opts: SunburstLayoutOptions = {}): SunburstArc[] {
  const ringWidth = opts.ringWidth ?? 1;
  const center = opts.center ?? 0;
  const start = opts.startAngle ?? Math.PI / 2;
  const out: SunburstArc[] = [];

  const recurse = (node: SunburstNode, depth: number, a0: number, a1: number): void => {
    const r0 = center + depth * ringWidth;
    out.push({ name: node.name, depth, a0, a1, r0, r1: r0 + ringWidth, color: node.color });
    if (!node.children || node.children.length === 0) return;
    const total = nodeValue(node) || 1;
    let a = a0;
    for (const child of node.children) {
      const span = ((a1 - a0) * nodeValue(child)) / total;
      recurse(child, depth + 1, a, a + span);
      a += span;
    }
  };

  recurse(root, 0, start, start + Math.PI * 2);
  return out;
}

/** Options for {@link addSunburst}. */
export interface SunburstOptions {
  root: SunburstNode;
  /** Radial thickness of each depth ring, in data units. Default 1. */
  ringWidth?: number;
  /** Explicit palette, cycled by node index. Falls back to a built-in palette. */
  colors?: string[];
  /** Fill opacity, 0..1. Default 1. */
  opacity?: number;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming. Default `"static"`. */
  renderType?: RenderType;
}

/** Sample an annular sector into a closed polygon ring (outer arc forward, inner arc back). */
function arcRing(a0: number, a1: number, r0: number, r1: number, color: string): Patch {
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
  return { x, y, color };
}

/**
 * Build a sunburst from a hierarchy and add it as a {@link PatchesLayer} centered
 * at (0,0). Set the plot's `equalAspect: true` so the rings stay circular.
 */
export function addSunburst(plot: Plot, opts: SunburstOptions): PatchesLayer {
  const palette = opts.colors && opts.colors.length > 0 ? opts.colors : DEFAULT_COLORS;
  const arcs = sunburstLayout(opts.root, { ringWidth: opts.ringWidth });
  const patches: Patch[] = arcs.map((arc, i) => {
    if (arc.a1 - arc.a0 <= 0) return { x: [], y: [] };
    const color = arc.color ?? palette[i % palette.length]!;
    return arcRing(arc.a0, arc.a1, arc.r0, arc.r1, color);
  });
  return plot.addPatches({
    patches,
    opacity: opts.opacity,
    name: opts.name,
    renderType: opts.renderType,
  });
}
