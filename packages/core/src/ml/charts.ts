/**
 * Convenience builders for ML / deep-learning charts. Each takes a {@link Plot}
 * and composes existing layers (`addHeatmap`/`addLine`/`addScatter`/`addBar`/
 * `addArea`) from the pure metrics in `ml/metrics.ts` and reducers in
 * `ml/reduce.ts` — the same free-function style as the finance builders. No new
 * WebGL layers. Import from `@photonviz/core`.
 */
import type { ColormapName } from "../color/colormap.js";
import type { AreaLayer } from "../layers/area.js";
import type { BarLayer } from "../layers/bar.js";
import type { HeatmapLayer } from "../layers/heatmap.js";
import type { LineLayer } from "../layers/line.js";
import type { ScatterLayer } from "../layers/scatter.js";
import type { Plot } from "../plot.js";
import { kde } from "../stats/index.js";
import type { Range, RenderType } from "../types.js";
import {
  calibrationCurve, confusionMatrix, emaSmooth, prCurve, rocCurve,
} from "./metrics.js";

/** tab10 categorical palette, cycled by class index. */
export const ML_PALETTE: readonly string[] = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

// ── Classification evaluation ────────────────────────────────────────────────

export interface ConfusionMatrixOptions {
  yTrue: ArrayLike<number>;
  yPred: ArrayLike<number>;
  /** Number of classes; inferred from the labels when omitted. */
  classes?: number;
  colormap?: ColormapName;
  /** Shade by row-normalized recall instead of raw counts. Default false. */
  normalize?: boolean;
  /** Draw the value inside each cell. Default true. */
  annotate?: boolean;
}
export interface ConfusionMatrixHandle { heatmap: HeatmapLayer; classes: number; }

/**
 * Confusion matrix as a heatmap with the true class 0 at the **top** (sklearn
 * orientation) and per-cell value labels. Give the {@link Plot} `[0,classes]`
 * axes; set categorical ticks for class names.
 */
export function addConfusionMatrix(plot: Plot, opts: ConfusionMatrixOptions): ConfusionMatrixHandle {
  const cm = confusionMatrix(opts.yTrue, opts.yPred, opts.classes);
  const C = cm.classes;
  const src = opts.normalize ? cm.normalized : cm.counts;
  // Heatmap row 0 renders at the bottom; flip rows so true class 0 sits on top.
  const values = new Float64Array(C * C);
  for (let hr = 0; hr < C; hr++) {
    const t = C - 1 - hr;
    for (let p = 0; p < C; p++) values[hr * C + p] = src[t * C + p]!;
  }
  const heatmap = plot.addHeatmap({
    values, cols: C, rows: C,
    extent: { x: [0, C], y: [0, C] },
    colormap: opts.colormap ?? "viridis",
  });
  if (opts.annotate ?? true) {
    let maxV = 0;
    for (let i = 0; i < src.length; i++) if (src[i]! > maxV) maxV = src[i]!;
    for (let hr = 0; hr < C; hr++) {
      const t = C - 1 - hr;
      for (let p = 0; p < C; p++) {
        const text = opts.normalize ? src[t * C + p]!.toFixed(2) : String(cm.counts[t * C + p]!);
        const hot = maxV ? src[t * C + p]! / maxV > 0.55 : false;
        plot.addAnnotation({ type: "label", x: p + 0.5, y: hr + 0.5, text, align: "center", color: hot ? "#0b1020" : "#e5e7eb" });
      }
    }
  }
  return { heatmap, classes: C };
}

export interface RocCurveOptions {
  scores: ArrayLike<number>;
  labels: ArrayLike<number>;
  color?: string;
  /** Shade the area under the curve. Default false. */
  fill?: boolean;
  /** Draw the y=x chance diagonal. Default true. */
  showChance?: boolean;
  name?: string;
}
export interface RocCurveHandle { line: LineLayer; area?: AreaLayer; auc: number; }

/** ROC curve (FPR→TPR) with the chance diagonal and AUC in the series name. */
export function addRocCurve(plot: Plot, opts: RocCurveOptions): RocCurveHandle {
  const roc = rocCurve(opts.scores, opts.labels);
  const color = opts.color ?? "#60a5fa";
  const area = opts.fill
    ? plot.addArea({ x: roc.fpr, y: roc.tpr, base: 0, color: withAlpha(color, 0.18) })
    : undefined;
  if (opts.showChance ?? true) {
    plot.addAnnotation({ type: "line", x0: 0, y0: 0, x1: 1, y1: 1, color: "#8b93a7", width: 1, dash: [6, 6] });
  }
  const line = plot.addLine({
    x: roc.fpr, y: roc.tpr, color, width: 2,
    name: opts.name ?? `ROC · AUC ${Number.isFinite(roc.auc) ? roc.auc.toFixed(3) : "—"}`,
  });
  return { line, area, auc: roc.auc };
}

export interface PrCurveOptions {
  scores: ArrayLike<number>;
  labels: ArrayLike<number>;
  color?: string;
  fill?: boolean;
  /** Draw the no-skill baseline at the positive base rate. Default true. */
  showBaseline?: boolean;
  name?: string;
}
export interface PrCurveHandle { line: LineLayer; area?: AreaLayer; ap: number; }

/** Precision–recall curve with the no-skill baseline and AP in the series name. */
export function addPrCurve(plot: Plot, opts: PrCurveOptions): PrCurveHandle {
  const pr = prCurve(opts.scores, opts.labels);
  const color = opts.color ?? "#f472b6";
  const area = opts.fill
    ? plot.addArea({ x: pr.recall, y: pr.precision, base: 0, color: withAlpha(color, 0.18) })
    : undefined;
  if (opts.showBaseline ?? true) {
    plot.addAnnotation({ type: "line", x0: 0, y0: pr.baseline, x1: 1, y1: pr.baseline, color: "#8b93a7", width: 1, dash: [6, 6] });
  }
  const line = plot.addLine({
    x: pr.recall, y: pr.precision, color, width: 2,
    name: opts.name ?? `PR · AP ${Number.isFinite(pr.ap) ? pr.ap.toFixed(3) : "—"}`,
  });
  return { line, area, ap: pr.ap };
}

export interface CalibrationOptions {
  scores: ArrayLike<number>;
  labels: ArrayLike<number>;
  bins?: number;
  color?: string;
  name?: string;
}
export interface CalibrationHandle { line: LineLayer; points: ScatterLayer; ece: number; }

/** Reliability diagram: mean predicted probability vs. observed frequency + the perfect diagonal. */
export function addCalibration(plot: Plot, opts: CalibrationOptions): CalibrationHandle {
  const cal = calibrationCurve(opts.scores, opts.labels, opts.bins ?? 10);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < cal.meanPredicted.length; i++) {
    if (Number.isFinite(cal.meanPredicted[i]!)) { xs.push(cal.meanPredicted[i]!); ys.push(cal.fractionPositive[i]!); }
  }
  plot.addAnnotation({ type: "line", x0: 0, y0: 0, x1: 1, y1: 1, color: "#8b93a7", width: 1, dash: [6, 6] });
  const color = opts.color ?? "#34d399";
  const line = plot.addLine({ x: xs, y: ys, color, width: 2, name: opts.name ?? `reliability · ECE ${cal.ece.toFixed(3)}` });
  const points = plot.addScatter({ x: xs, y: ys, color, size: 7 });
  return { line, points, ece: cal.ece };
}

// ── Embeddings / decision boundary ───────────────────────────────────────────

export interface EmbeddingOptions {
  /** 2-D coordinates (t-SNE/UMAP/PCA output). */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Categorical class per point → one colored, legend-named series each. */
  labels?: ArrayLike<number> | string[];
  /** Names indexed by numeric label. */
  classNames?: string[];
  /** Continuous value per point → a single colormap series (ignored if `labels`). */
  colorBy?: ArrayLike<number>;
  colormap?: ColormapName;
  palette?: readonly string[];
  size?: number;
  /** Per-point hover text (metadata). */
  text?: ArrayLike<string>;
  name?: string;
  renderType?: RenderType;
}
export interface EmbeddingHandle { layers: ScatterLayer[]; }

/**
 * Embedding scatter — one colored series per class when `labels` are given (a
 * legend-ready projector), a single colormap series for a continuous `colorBy`,
 * or a plain scatter otherwise. Use `pick: "xy"` on the {@link Plot} for hover.
 */
export function addEmbedding(plot: Plot, opts: EmbeddingOptions): EmbeddingHandle {
  const size = opts.size ?? 4;
  if (opts.labels) {
    return { layers: scatterByClass(plot, opts.x, opts.y, opts.labels, opts.classNames, opts.palette, size, opts.text, opts.renderType) };
  }
  if (opts.colorBy) {
    return {
      layers: [plot.addScatter({
        x: opts.x, y: opts.y, size, name: opts.name, labels: opts.text, renderType: opts.renderType,
        colorBy: { values: opts.colorBy, colormap: opts.colormap ?? "viridis" },
      })],
    };
  }
  return { layers: [plot.addScatter({ x: opts.x, y: opts.y, size, color: (opts.palette ?? ML_PALETTE)[0], name: opts.name, labels: opts.text, renderType: opts.renderType })] };
}

export interface DecisionBoundaryOptions {
  /** Row-major grid of predicted class / probability, row 0 at the bottom. */
  values: ArrayLike<number>;
  cols: number;
  rows: number;
  extent: { x: Range; y: Range };
  colormap?: ColormapName;
  domain?: Range;
  /** Training points drawn over the field. */
  points?: {
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    labels?: ArrayLike<number> | string[];
    classNames?: string[];
    palette?: readonly string[];
    size?: number;
  };
}
export interface DecisionBoundaryHandle { heatmap: HeatmapLayer; points: ScatterLayer[]; }

/** A decision-boundary field (heatmap) with the training points scattered on top. */
export function addDecisionBoundary(plot: Plot, opts: DecisionBoundaryOptions): DecisionBoundaryHandle {
  const heatmap = plot.addHeatmap({
    values: opts.values, cols: opts.cols, rows: opts.rows, extent: opts.extent,
    colormap: opts.colormap ?? "viridis", domain: opts.domain,
  });
  const p = opts.points;
  const points = p
    ? scatterByClass(plot, p.x, p.y, p.labels, p.classNames, p.palette, p.size ?? 5, undefined, undefined)
    : [];
  return { heatmap, points };
}

// ── Explainability (XAI) ─────────────────────────────────────────────────────

export interface FeatureImportanceOptions {
  names: string[];
  values: ArrayLike<number>;
  color?: string;
  /** Sort by descending magnitude. Default true. */
  sort?: boolean;
  /** Keep only the top-N features. */
  top?: number;
  /** Label each bar with its feature name (inside the plot). Default true. */
  annotate?: boolean;
  name?: string;
  renderType?: RenderType;
}
export interface FeatureImportanceHandle { bars: BarLayer; order: number[]; }

/** Feature importance as sorted horizontal bars (most important on top). */
export function addFeatureImportance(plot: Plot, opts: FeatureImportanceOptions): FeatureImportanceHandle {
  const n = Math.min(opts.names.length, opts.values.length);
  let order = Array.from({ length: n }, (_, i) => i);
  if (opts.sort ?? true) order.sort((a, b) => Math.abs(opts.values[b]!) - Math.abs(opts.values[a]!));
  if (opts.top && opts.top < order.length) order = order.slice(0, opts.top);
  const m = order.length;
  // Plot largest at the top: bar j sits at y = m-1-j.
  const ypos = new Float64Array(m), vals = new Float64Array(m);
  for (let j = 0; j < m; j++) { ypos[j] = m - 1 - j; vals[j] = opts.values[order[j]!]!; }
  const bars = plot.addBar({
    x: ypos, y: vals, orientation: "h", base: 0, width: 0.72,
    color: opts.color ?? "#60a5fa", name: opts.name, renderType: opts.renderType,
  });
  if (opts.annotate ?? true) {
    for (let j = 0; j < m; j++) {
      plot.addAnnotation({ type: "label", x: 0, y: m - 1 - j, text: ` ${opts.names[order[j]!]}`, align: "left", color: "#e5e7eb" });
    }
  }
  return { bars, order };
}

export interface ShapBeeswarmOptions {
  /** SHAP values per feature: `values[f]` is the row across all samples. */
  values: number[][];
  names: string[];
  /** Feature values (same shape) → point color via a diverging colormap. */
  featureValues?: number[][];
  colormap?: ColormapName;
  size?: number;
  /** Vertical spread of each feature band, 0..1. Default 0.8. */
  spread?: number;
  name?: string;
}
export interface ShapBeeswarmHandle { scatter: ScatterLayer; order: number[]; }

/**
 * SHAP beeswarm — features stacked by mean |SHAP| (most important on top), each
 * a horizontal swarm of per-sample points jittered by density and colored by the
 * feature's value (low→high). A single scatter for one shared colorbar.
 */
export function addShapBeeswarm(plot: Plot, opts: ShapBeeswarmOptions): ShapBeeswarmHandle {
  const f = Math.min(opts.values.length, opts.names.length);
  const meanAbs = (row: number[]): number => {
    let s = 0; for (const v of row) s += Math.abs(v); return row.length ? s / row.length : 0;
  };
  const order = Array.from({ length: f }, (_, i) => i).sort((a, b) => meanAbs(opts.values[b]!) - meanAbs(opts.values[a]!));
  const spread = opts.spread ?? 0.8;
  const xs: number[] = [], ys: number[] = [], cs: number[] = [];
  let minX = Infinity;
  for (let band = 0; band < f; band++) {
    const feat = order[f - 1 - band]!; // draw the most important on top (highest band)
    const row = opts.values[feat]!;
    const offsets = beeswarmLayout(row, { spread });
    const fv = opts.featureValues?.[feat];
    for (let i = 0; i < row.length; i++) {
      xs.push(row[i]!); ys.push(band + offsets[i]!);
      cs.push(fv ? fv[i]! : 0);
      if (row[i]! < minX) minX = row[i]!;
    }
  }
  const scatter = plot.addScatter({
    x: xs, y: ys, size: opts.size ?? 4, name: opts.name,
    colorBy: { values: cs, colormap: opts.colormap ?? "coolwarm" },
  });
  if (Number.isFinite(minX)) {
    for (let band = 0; band < f; band++) {
      plot.addAnnotation({ type: "label", x: minX, y: band, text: `${opts.names[order[f - 1 - band]!]} `, align: "right", color: "#e5e7eb" });
    }
  }
  return { scatter, order };
}

export interface PartialDependenceOptions {
  x: ArrayLike<number>;
  /** Mean prediction over the grid. */
  pd: ArrayLike<number>;
  /** Optional per-instance ICE curves, each parallel to `x`. */
  ice?: number[][];
  color?: string;
  iceColor?: string;
  width?: number;
  name?: string;
  renderType?: RenderType;
}
export interface PartialDependenceHandle { pd: LineLayer; ice: LineLayer[]; }

/** Partial-dependence line with faint ICE curves behind it. */
export function addPartialDependence(plot: Plot, opts: PartialDependenceOptions): PartialDependenceHandle {
  const ice = (opts.ice ?? []).map((row) =>
    plot.addLine({ x: opts.x, y: row, color: opts.iceColor ?? "rgba(148,163,184,0.25)", width: 1, renderType: opts.renderType }));
  const pd = plot.addLine({ x: opts.x, y: opts.pd, color: opts.color ?? "#f59e0b", width: 2.5, name: opts.name ?? "PDP", renderType: opts.renderType });
  return { pd, ice };
}

export interface AttentionMapOptions {
  /** Attention weights, query×key: a flat row-major array or a 2-D array. */
  weights: ArrayLike<number> | number[][];
  /** Required with a flat `weights`. */
  queries?: number;
  keys?: number;
  colormap?: ColormapName;
  /** Draw each weight in its cell (small maps only). Default false. */
  annotate?: boolean;
}
export interface AttentionMapHandle { heatmap: HeatmapLayer; queries: number; keys: number; }

/** Transformer attention as a heatmap with query 0 at the top, key 0 at the left. */
export function addAttentionMap(plot: Plot, opts: AttentionMapOptions): AttentionMapHandle {
  let flat: Float64Array, Q: number, K: number;
  if (Array.isArray(opts.weights) && Array.isArray(opts.weights[0])) {
    const w = opts.weights as number[][];
    Q = w.length; K = w[0]!.length;
    flat = new Float64Array(Q * K);
    for (let q = 0; q < Q; q++) for (let k = 0; k < K; k++) flat[q * K + k] = w[q]![k]!;
  } else {
    Q = opts.queries ?? 0; K = opts.keys ?? 0;
    flat = Float64Array.from(opts.weights as ArrayLike<number>);
  }
  // Flip rows so query 0 is on top.
  const values = new Float64Array(Q * K);
  for (let hr = 0; hr < Q; hr++) for (let k = 0; k < K; k++) values[hr * K + k] = flat[(Q - 1 - hr) * K + k]!;
  const heatmap = plot.addHeatmap({
    values, cols: K, rows: Q, extent: { x: [0, K], y: [0, Q] },
    colormap: opts.colormap ?? "viridis",
  });
  if (opts.annotate) {
    for (let hr = 0; hr < Q; hr++) for (let k = 0; k < K; k++) {
      plot.addAnnotation({ type: "label", x: k + 0.5, y: hr + 0.5, text: flat[(Q - 1 - hr) * K + k]!.toFixed(2), align: "center", color: "#e5e7eb" });
    }
  }
  return { heatmap, queries: Q, keys: K };
}

// ── Training monitoring ──────────────────────────────────────────────────────

export interface TrainingSeries { name?: string; x?: ArrayLike<number>; y: ArrayLike<number>; color?: string; }
export interface TrainingCurvesOptions {
  series: TrainingSeries[];
  /** EMA smoothing weight 0..1 (0 = raw). Default 0.6. */
  smoothing?: number;
  /** Draw the faint raw curve behind the smoothed one. Default true. */
  showRaw?: boolean;
  /** Mark the best epoch of each series. */
  best?: "min" | "max";
  width?: number;
  palette?: readonly string[];
  renderType?: RenderType;
}
export interface TrainingCurvesHandle { raw: LineLayer[]; smoothed: LineLayer[]; }

/**
 * Training curves with TensorBoard-style EMA smoothing — a faint raw line under
 * a bold smoothed one per series, each streamable via `setData`. Optionally
 * marks the best epoch. Pair with `renderType: "dynamic"` for live updates.
 */
export function addTrainingCurves(plot: Plot, opts: TrainingCurvesOptions): TrainingCurvesHandle {
  const palette = opts.palette ?? ML_PALETTE;
  const smoothing = opts.smoothing ?? 0.6;
  const width = opts.width ?? 2;
  const raw: LineLayer[] = [], smoothed: LineLayer[] = [];
  opts.series.forEach((s, i) => {
    const n = s.y.length;
    const x = s.x ?? Float64Array.from({ length: n }, (_, j) => j);
    const color = s.color ?? palette[i % palette.length]!;
    if (smoothing > 0) {
      if (opts.showRaw ?? true) raw.push(plot.addLine({ x, y: s.y, color: withAlpha(color, 0.25), width: 1, renderType: opts.renderType }));
      smoothed.push(plot.addLine({ x, y: emaSmooth(s.y, smoothing), color, width, name: s.name, renderType: opts.renderType }));
    } else {
      smoothed.push(plot.addLine({ x, y: s.y, color, width, name: s.name, renderType: opts.renderType }));
    }
    if (opts.best) {
      let bi = -1, bv = opts.best === "min" ? Infinity : -Infinity;
      for (let j = 0; j < n; j++) {
        const v = s.y[j]!;
        if (!Number.isFinite(v)) continue;
        if (opts.best === "min" ? v < bv : v > bv) { bv = v; bi = j; }
      }
      if (bi >= 0) plot.addAnnotation({ type: "label", x: x[bi]!, y: bv, text: `${s.name ? s.name + " " : ""}${bv.toFixed(3)}`, align: "center", color });
    }
  });
  return { raw, smoothed };
}

export interface RidgeGroup { label?: string; values: ArrayLike<number>; }
export interface RidgelineOptions {
  /** One distribution per group (e.g. a layer's weights per epoch). */
  groups: RidgeGroup[];
  /** KDE sample count. Default 96. */
  points?: number;
  /** Ridge overlap, 0 = touching, 1 = one full row of overlap. Default 1. */
  overlap?: number;
  palette?: readonly string[];
  /** Fill each ridge. Default true. */
  fill?: boolean;
  /** Shared x-range; inferred from the data when omitted. */
  range?: Range;
}
export interface RidgelineHandle { areas: AreaLayer[]; lines: LineLayer[]; }

/**
 * Ridgeline / joyplot — one KDE per group, vertically offset (TensorBoard's
 * "distributions over time"). Ridge `i` is baselined at `y=i`; `overlap` lets
 * neighbours interleave. Feed per-epoch weight/activation samples.
 */
export function addRidgeline(plot: Plot, opts: RidgelineOptions): RidgelineHandle {
  const g = opts.groups;
  let lo = opts.range?.[0] ?? Infinity, hi = opts.range?.[1] ?? -Infinity;
  if (!opts.range) {
    for (const grp of g) for (let i = 0; i < grp.values.length; i++) {
      const v = grp.values[i]!;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) { lo = (lo || 0) - 1; hi = (hi || 0) + 1; }
  const points = opts.points ?? 96;
  const palette = opts.palette ?? ML_PALETTE;
  const height = 1 + Math.max(0, opts.overlap ?? 1);
  const areas: AreaLayer[] = [], lines: LineLayer[] = [];
  g.forEach((grp, i) => {
    const dens = kde(grp.values, lo, hi, points);
    let peak = 0;
    for (let j = 0; j < dens.ys.length; j++) if (dens.ys[j]! > peak) peak = dens.ys[j]!;
    const scale = peak > 0 ? height / peak : 0;
    const y = new Float64Array(dens.ys.length);
    for (let j = 0; j < y.length; j++) y[j] = i + dens.ys[j]! * scale;
    const color = palette[i % palette.length]!;
    if (opts.fill ?? true) areas.push(plot.addArea({ x: dens.xs, y, base: i, color: withAlpha(color, 0.55) }));
    lines.push(plot.addLine({ x: dens.xs, y, color, width: 1.5 }));
    if (grp.label) plot.addAnnotation({ type: "label", x: lo, y: i + 0.05, text: `${grp.label} `, align: "right", color: "#e5e7eb" });
  });
  return { areas, lines };
}

// ── Pure layout + helpers ────────────────────────────────────────────────────

export interface BeeswarmOptions { bins?: number; spread?: number; }

/**
 * Deterministic 1-D beeswarm: given point x-positions, return a symmetric
 * vertical offset per point (in ±spread/2) so overlapping points fan out by
 * local density. Pure — no RNG. Backs {@link addShapBeeswarm}.
 */
export function beeswarmLayout(x: ArrayLike<number>, opts: BeeswarmOptions = {}): number[] {
  const n = x.length;
  const spread = opts.spread ?? 0.8;
  const y = new Array<number>(n).fill(0);
  if (!n) return y;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = x[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  const width = hi - lo || 1;
  const bins = Math.max(1, opts.bins ?? Math.min(64, Math.round(Math.sqrt(n))));
  const buckets: number[][] = Array.from({ length: bins }, () => []);
  for (let i = 0; i < n; i++) {
    let b = Math.floor(((x[i]! - lo) / width) * bins);
    if (b >= bins) b = bins - 1; if (b < 0) b = 0;
    buckets[b]!.push(i);
  }
  let maxCount = 1;
  for (const arr of buckets) if (arr.length > maxCount) maxCount = arr.length;
  const denom = Math.max(1, maxCount);
  for (const arr of buckets) {
    const m = arr.length;
    for (let j = 0; j < m; j++) {
      const off = j - (m - 1) / 2; // centered stack
      y[arr[j]!] = (off / denom) * spread;
    }
  }
  return y;
}

/** Scatter points split into one series per class (legend-ready). */
function scatterByClass(
  plot: Plot,
  x: ArrayLike<number>, y: ArrayLike<number>,
  labels?: ArrayLike<number> | string[], classNames?: string[],
  palette: readonly string[] = ML_PALETTE, size = 4,
  text?: ArrayLike<string>, renderType?: RenderType,
): ScatterLayer[] {
  const n = Math.min(x.length, y.length);
  if (!labels) return [plot.addScatter({ x, y, size, color: palette[0], labels: text, renderType })];
  // Unique labels in ascending (numeric) / first-seen (string) order.
  const keys: (number | string)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const k = (labels as ArrayLike<number> | string[])[i] as number | string;
    const sk = String(k);
    if (!seen.has(sk)) { seen.add(sk); keys.push(k); }
  }
  if (keys.every((k) => typeof k === "number")) (keys as number[]).sort((a, b) => a - b);
  const layers: ScatterLayer[] = [];
  keys.forEach((key, ci) => {
    const sx: number[] = [], sy: number[] = [], st: string[] = [];
    for (let i = 0; i < n; i++) {
      if (String((labels as ArrayLike<number> | string[])[i]) !== String(key)) continue;
      sx.push(x[i]!); sy.push(y[i]!);
      if (text) st.push(String(text[i]!));
    }
    const name = classNames && typeof key === "number" ? classNames[key] ?? String(key) : String(key);
    layers.push(plot.addScatter({ x: sx, y: sy, size, color: palette[ci % palette.length], name, labels: text ? st : undefined, renderType }));
  });
  return layers;
}

/** Apply `alpha` to a `#rrggbb` color → `rgba(...)` (else pass through). */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
  }
  return color;
}
