/**
 * Chord diagram — a pure circular layout plus a {@link Plot} builder that composes
 * the existing {@link PatchesLayer}: thin annular sectors for the group arcs and
 * bezier-bounded ribbons for the flows between groups, with labels outside each
 * arc. Import from `@photonviz/core`. Use `equalAspect: true` so it stays circular.
 */
import { type Patch, type PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";

/** tab10-ish default palette, cycled by group index. */
export const CHORD_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

/** A laid-out group arc as a closed ring of `x`/`y` (thin annular sector). */
export interface ChordGroupArc {
  i: number;
  x: number[];
  y: number[];
}

/** A laid-out ribbon between groups `i` and `j` as a closed ring of `x`/`y`. */
export interface ChordRibbon {
  i: number;
  j: number;
  x: number[];
  y: number[];
}

/** The result of {@link chordLayout}: outer group arcs plus inter-group ribbons. */
export interface ChordLayoutResult {
  groupArcs: ChordGroupArc[];
  ribbons: ChordRibbon[];
}

/** Tunable geometry for {@link chordLayout}. */
export interface ChordLayoutOptions {
  /** Outer radius of the group arcs. Default 1. */
  radius?: number;
  /** Total angular gap (radians) split evenly between groups. Default 0.1·2π. */
  padAngle?: number;
  /** Thickness of the outer arc as a fraction of `radius`. Default 0.06. */
  arcWidth?: number;
  /** Points sampled along each connecting bezier edge of a ribbon. Default 24. */
  samples?: number;
}

/** Sample a point along the arc at radius `r`, angle `a` (radians, CCW from +x). */
function onCircle(r: number, a: number): [number, number] {
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** Sample a quadratic bezier from `p0` to `p2` through control `p1` at `t`. */
function bezier(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  const a = u * u, b = 2 * u * t, c = t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
}

/**
 * Chord layout: groups sit around a circle with angular span ∝ their row-sum
 * (standard chord convention), separated by `padAngle`. Each group's arc is
 * sub-divided per target `j`; a ribbon between `i` and `j` is bounded by the two
 * matching sub-arcs and closed by quadratic beziers curving through the center.
 * Pure — no side effects. Empty/zero-flow input yields empty arrays.
 */
export function chordLayout(matrix: number[][], opts: ChordLayoutOptions = {}): ChordLayoutResult {
  const n = matrix.length;
  const radius = opts.radius ?? 1;
  const padAngle = opts.padAngle ?? 0.1 * 2 * Math.PI;
  const arcWidth = (opts.arcWidth ?? 0.06) * radius;
  const samples = Math.max(2, opts.samples ?? 24);
  const inner = radius - arcWidth;

  // Row sums drive each group's angular weight; total flow drives the scale.
  const rowSums = matrix.map((row) => row.reduce((s, v) => s + Math.max(0, v || 0), 0));
  const total = rowSums.reduce((s, v) => s + v, 0);
  if (n === 0 || total <= 0) return { groupArcs: [], ribbons: [] };

  const gaps = Math.min(padAngle, 0.9 * 2 * Math.PI);
  const usable = 2 * Math.PI - gaps;
  const gap = n > 0 ? gaps / n : 0;

  // Angular start/end for each group, and the sub-arc [start,end] for each (i,j).
  const groupStart = new Array<number>(n);
  const groupEnd = new Array<number>(n);
  const subStart: number[][] = matrix.map(() => new Array<number>(n).fill(0));
  const subEnd: number[][] = matrix.map(() => new Array<number>(n).fill(0));

  let angle = 0;
  for (let i = 0; i < n; i++) {
    groupStart[i] = angle;
    let a = angle;
    for (let j = 0; j < n; j++) {
      const w = Math.max(0, matrix[i]![j] || 0);
      const span = total > 0 ? (w / total) * usable : 0;
      subStart[i]![j] = a;
      subEnd[i]![j] = a + span;
      a += span;
    }
    groupEnd[i] = a;
    angle = a + gap;
  }

  // Outer group arcs: a closed annular sector between `inner` and `radius`.
  const groupArcs: ChordGroupArc[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = groupStart[i]!, a1 = groupEnd[i]!;
    if (a1 <= a0) continue;
    const x: number[] = [], y: number[] = [];
    for (let s = 0; s <= samples; s++) {
      const [px, py] = onCircle(radius, a0 + ((a1 - a0) * s) / samples);
      x.push(px); y.push(py);
    }
    for (let s = samples; s >= 0; s--) {
      const [px, py] = onCircle(inner, a0 + ((a1 - a0) * s) / samples);
      x.push(px); y.push(py);
    }
    groupArcs.push({ i, x, y });
  }

  // Ribbons: one per ordered pair (i,j) with i ≤ j so each chord is drawn once.
  const center: [number, number] = [0, 0];
  const ribbons: ChordRibbon[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const wij = Math.max(0, matrix[i]![j] || 0);
      const wji = Math.max(0, matrix[j]![i] || 0);
      if (wij <= 0 && wji <= 0) continue;
      const iA0 = subStart[i]![j]!, iA1 = subEnd[i]![j]!;
      const jA0 = subStart[j]![i]!, jA1 = subEnd[j]![i]!;
      const x: number[] = [], y: number[] = [];
      // Arc along group i's sub-arc (inner radius), forward.
      for (let s = 0; s <= samples; s++) {
        const [px, py] = onCircle(inner, iA0 + ((iA1 - iA0) * s) / samples);
        x.push(px); y.push(py);
      }
      // Bezier from end of i's sub-arc to start of j's sub-arc, through center.
      const iEnd = onCircle(inner, iA1);
      const jStart = onCircle(inner, jA0);
      for (let s = 1; s <= samples; s++) {
        const [px, py] = bezier(iEnd, center, jStart, s / samples);
        x.push(px); y.push(py);
      }
      // Arc along group j's sub-arc (inner radius), forward.
      for (let s = 0; s <= samples; s++) {
        const [px, py] = onCircle(inner, jA0 + ((jA1 - jA0) * s) / samples);
        x.push(px); y.push(py);
      }
      // Bezier back from end of j's sub-arc to start of i's sub-arc.
      const jEnd = onCircle(inner, jA1);
      const iStart = onCircle(inner, iA0);
      for (let s = 1; s <= samples; s++) {
        const [px, py] = bezier(jEnd, center, iStart, s / samples);
        x.push(px); y.push(py);
      }
      ribbons.push({ i, j, x, y });
    }
  }

  return { groupArcs, ribbons };
}

export interface ChordOptions {
  /** Square flow matrix; `matrix[i][j]` is the flow from group `i` to group `j`. */
  matrix: number[][];
  /** Optional group labels, placed just outside each arc. */
  labels?: string[];
  /** Outer radius. Default 1. */
  radius?: number;
  /** Palette cycled by group index. Defaults to {@link CHORD_PALETTE}. */
  colors?: string[];
  /** Ribbon fill opacity, 0..1. Default 0.65. */
  opacity?: number;
  name?: string;
  renderType?: RenderType;
}

/**
 * Add a chord diagram: opaque per-group outer arcs plus semi-transparent ribbons
 * (colored by their source group) as {@link Patch}es, with labels outside each
 * arc. Composes {@link Plot.addPatches} — set `equalAspect: true` on the plot.
 */
export function addChord(plot: Plot, opts: ChordOptions): PatchesLayer {
  const radius = opts.radius ?? 1;
  const palette = opts.colors && opts.colors.length ? opts.colors : CHORD_PALETTE;
  const opacity = opts.opacity ?? 0.65;
  const { groupArcs, ribbons } = chordLayout(opts.matrix, { radius });

  const color = (i: number): string => palette[i % palette.length]!;

  // Ribbons first (below), then opaque arcs on top.
  const patches: Patch[] = [];
  for (const rb of ribbons) {
    patches.push({ x: rb.x, y: rb.y, color: withAlpha(color(rb.i), opacity) });
  }
  for (const arc of groupArcs) {
    patches.push({ x: arc.x, y: arc.y, color: color(arc.i) });
  }

  const layer = plot.addPatches({
    patches,
    name: opts.name,
    renderType: opts.renderType,
  });

  // Labels sit at each group arc's angular midpoint, just outside the radius.
  const labels = opts.labels;
  if (labels && labels.length) {
    const n = opts.matrix.length;
    const rowSums = opts.matrix.map((row) => row.reduce((s, v) => s + Math.max(0, v || 0), 0));
    const total = rowSums.reduce((s, v) => s + v, 0);
    if (total > 0 && n > 0) {
      const padAngle = 0.1 * 2 * Math.PI;
      const gaps = Math.min(padAngle, 0.9 * 2 * Math.PI);
      const usable = 2 * Math.PI - gaps;
      const gap = gaps / n;
      let angle = 0;
      const labelR = radius * 1.08;
      for (let i = 0; i < n; i++) {
        const span = (rowSums[i]! / total) * usable;
        const mid = angle + span / 2;
        const text = labels[i];
        if (text != null) {
          plot.addAnnotation({
            type: "label",
            x: labelR * Math.cos(mid),
            y: labelR * Math.sin(mid),
            text,
            align: "center",
          });
        }
        angle += span + gap;
      }
    }
  }

  return layer;
}

/** Apply `alpha` to a hex/rgb color, producing an `rgba(...)` string. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
  }
  return color;
}
