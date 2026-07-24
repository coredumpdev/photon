/**
 * Pure ML classification-evaluation metrics: confusion matrix, ROC + AUC,
 * precision–recall + average precision, calibration (reliability) + ECE, plus
 * TensorBoard-style EMA smoothing for training curves. All array→struct, zero
 * deps, unit-tested. Import from `@photonviz/core`; the `addX` builders in
 * `ml/charts.ts` render these onto a {@link Plot}.
 */

/** A confusion matrix: raw counts plus a row-normalized (recall) view. */
export interface ConfusionMatrix {
  /** Row-major counts, length `classes*classes`; row = true label, col = predicted. */
  counts: Float64Array;
  /** Row-normalized: every row sums to 1 (a row with no support stays all-zero). */
  normalized: Float64Array;
  /** Per-true-class support (row totals). */
  support: Float64Array;
  classes: number;
}

/**
 * Confusion matrix of integer class labels. `classes` defaults to
 * `max(label) + 1`; out-of-range labels are ignored.
 */
export function confusionMatrix(
  yTrue: ArrayLike<number>,
  yPred: ArrayLike<number>,
  classes?: number,
): ConfusionMatrix {
  const n = Math.min(yTrue.length, yPred.length);
  let c = classes ?? 0;
  if (!classes) {
    for (let i = 0; i < n; i++) c = Math.max(c, (yTrue[i]! | 0) + 1, (yPred[i]! | 0) + 1);
  }
  c = Math.max(1, c);
  const counts = new Float64Array(c * c);
  for (let i = 0; i < n; i++) {
    const t = yTrue[i]! | 0, p = yPred[i]! | 0;
    if (t < 0 || t >= c || p < 0 || p >= c) continue;
    counts[t * c + p]! += 1;
  }
  const support = new Float64Array(c);
  const normalized = new Float64Array(c * c);
  for (let t = 0; t < c; t++) {
    let s = 0;
    for (let p = 0; p < c; p++) s += counts[t * c + p]!;
    support[t] = s;
    if (s > 0) for (let p = 0; p < c; p++) normalized[t * c + p] = counts[t * c + p]! / s;
  }
  return { counts, normalized, support, classes: c };
}

/** A receiver-operating-characteristic curve and its area. */
export interface RocCurve {
  /** False-positive rate (x), starting at 0. */
  fpr: Float64Array;
  /** True-positive rate (y), starting at 0. */
  tpr: Float64Array;
  /** Score threshold at each vertex (`+Inf` for the origin). */
  thresholds: Float64Array;
  /** Area under the curve (`NaN` when a class is absent). */
  auc: number;
}

/** Indices of `scores` sorted descending (stable enough for tie-grouping). */
function argsortDesc(scores: ArrayLike<number>, n: number): number[] {
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => scores[b]! - scores[a]!);
  return idx;
}

/**
 * ROC curve for binary `labels` (0/1) ranked by `scores` (higher = more positive).
 * Ties at equal scores are collapsed to a single vertex; AUC by the trapezoid rule.
 */
export function rocCurve(scores: ArrayLike<number>, labels: ArrayLike<number>): RocCurve {
  const n = Math.min(scores.length, labels.length);
  let P = 0, N = 0;
  for (let i = 0; i < n; i++) (labels[i] ? P++ : N++);
  const idx = argsortDesc(scores, n);
  const fpr: number[] = [0], tpr: number[] = [0], thr: number[] = [Infinity];
  let tp = 0, fp = 0, prevF = 0, prevT = 0, auc = 0;
  for (let i = 0; i < n; ) {
    const t = scores[idx[i]!]!;
    while (i < n && scores[idx[i]!]! === t) { labels[idx[i]!] ? tp++ : fp++; i++; }
    const f = N ? fp / N : 0, tr = P ? tp / P : 0;
    auc += ((f - prevF) * (tr + prevT)) / 2;
    fpr.push(f); tpr.push(tr); thr.push(t);
    prevF = f; prevT = tr;
  }
  return {
    fpr: Float64Array.from(fpr),
    tpr: Float64Array.from(tpr),
    thresholds: Float64Array.from(thr),
    auc: P && N ? auc : NaN,
  };
}

/** A precision–recall curve and its average precision. */
export interface PrCurve {
  /** Recall (x), starting at 0. */
  recall: Float64Array;
  /** Precision (y), starting at 1. */
  precision: Float64Array;
  /** Score threshold at each vertex (`+Inf` for the leading point). */
  thresholds: Float64Array;
  /** Average precision — Σ (Rₙ − Rₙ₋₁)·Pₙ (`NaN` with no positives). */
  ap: number;
  /** Positive base rate (a no-skill classifier's precision). */
  baseline: number;
}

/** Precision–recall curve for binary `labels` (0/1) ranked by `scores`. */
export function prCurve(scores: ArrayLike<number>, labels: ArrayLike<number>): PrCurve {
  const n = Math.min(scores.length, labels.length);
  let P = 0;
  for (let i = 0; i < n; i++) if (labels[i]) P++;
  const idx = argsortDesc(scores, n);
  const recall: number[] = [0], precision: number[] = [1], thr: number[] = [Infinity];
  let tp = 0, fp = 0, prevR = 0, ap = 0;
  for (let i = 0; i < n; ) {
    const t = scores[idx[i]!]!;
    while (i < n && scores[idx[i]!]! === t) { labels[idx[i]!] ? tp++ : fp++; i++; }
    const r = P ? tp / P : 0, p = tp + fp ? tp / (tp + fp) : 1;
    ap += (r - prevR) * p;
    recall.push(r); precision.push(p); thr.push(t);
    prevR = r;
  }
  return {
    recall: Float64Array.from(recall),
    precision: Float64Array.from(precision),
    thresholds: Float64Array.from(thr),
    ap: P ? ap : NaN,
    baseline: n ? P / n : 0,
  };
}

/** A reliability diagram: predicted confidence vs. observed frequency, per bin. */
export interface CalibrationCurve {
  /** Mean predicted probability in each bin (`NaN` if empty). */
  meanPredicted: Float64Array;
  /** Observed positive fraction in each bin (`NaN` if empty). */
  fractionPositive: Float64Array;
  /** Sample count per bin. */
  binCount: Float64Array;
  /** Expected Calibration Error — Σ (nᵦ/N)·|accᵦ − confᵦ|. */
  ece: number;
}

/**
 * Reliability diagram of predicted probabilities `scores` (in [0,1]) against
 * binary `labels`, using `bins` equal-width confidence buckets. Empty bins are
 * `NaN` (skip them when plotting).
 */
export function calibrationCurve(
  scores: ArrayLike<number>,
  labels: ArrayLike<number>,
  bins = 10,
): CalibrationCurve {
  const b = Math.max(1, bins | 0);
  const n = Math.min(scores.length, labels.length);
  const sumScore = new Float64Array(b), sumLabel = new Float64Array(b), count = new Float64Array(b);
  for (let i = 0; i < n; i++) {
    const s = scores[i]!;
    if (!Number.isFinite(s)) continue;
    let k = Math.floor(s * b);
    if (k >= b) k = b - 1; if (k < 0) k = 0;
    sumScore[k]! += s; sumLabel[k]! += labels[i] ? 1 : 0; count[k]! += 1;
  }
  const meanPredicted = new Float64Array(b), fractionPositive = new Float64Array(b);
  let ece = 0;
  for (let k = 0; k < b; k++) {
    if (count[k]! > 0) {
      const conf = sumScore[k]! / count[k]!, acc = sumLabel[k]! / count[k]!;
      meanPredicted[k] = conf; fractionPositive[k] = acc;
      ece += (count[k]! / Math.max(1, n)) * Math.abs(acc - conf);
    } else {
      meanPredicted[k] = NaN; fractionPositive[k] = NaN;
    }
  }
  return { meanPredicted, fractionPositive, binCount: count, ece };
}

/**
 * TensorBoard-style debiased EMA smoothing of a noisy training curve. `weight`
 * in [0,1) is the momentum (0 = raw, →1 = very smooth). Non-finite inputs pass
 * through untouched and don't advance the average.
 */
export function emaSmooth(values: ArrayLike<number>, weight = 0.6): Float64Array {
  const w = Math.min(0.999999, Math.max(0, weight));
  const n = values.length;
  const out = new Float64Array(n);
  let last = 0, num = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) { out[i] = v; continue; }
    last = last * w + (1 - w) * v;
    num++;
    out[i] = last / (1 - Math.pow(w, num));
  }
  return out;
}
