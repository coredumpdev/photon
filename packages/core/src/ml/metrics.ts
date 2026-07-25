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

// ── Regression metrics ───────────────────────────────────────────────────────

/** Mean squared error. */
export function mse(yTrue: ArrayLike<number>, yPred: ArrayLike<number>): number {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return NaN;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (yTrue[i]! - yPred[i]!) ** 2;
  return acc / n;
}

/** Root mean squared error — the error in the target's own units. */
export function rmse(yTrue: ArrayLike<number>, yPred: ArrayLike<number>): number {
  return Math.sqrt(mse(yTrue, yPred));
}

/** Mean absolute error — less swayed by outliers than {@link rmse}. */
export function mae(yTrue: ArrayLike<number>, yPred: ArrayLike<number>): number {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return NaN;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += Math.abs(yTrue[i]! - yPred[i]!);
  return acc / n;
}

/**
 * Coefficient of determination: the fraction of variance the model explains.
 * 1 is perfect, 0 matches predicting the mean, negative is worse than that.
 */
export function r2(yTrue: ArrayLike<number>, yPred: ArrayLike<number>): number {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return NaN;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += yTrue[i]!;
  mean /= n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (yTrue[i]! - yPred[i]!) ** 2;
    ssTot += (yTrue[i]! - mean) ** 2;
  }
  return ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;
}

// ── Probabilistic scores ─────────────────────────────────────────────────────

/**
 * Binary log loss (cross-entropy) of predicted probabilities. Probabilities are
 * clipped away from 0/1 so a single confident mistake cannot return Infinity.
 */
export function logLoss(probs: ArrayLike<number>, labels: ArrayLike<number>, eps = 1e-15): number {
  const n = Math.min(probs.length, labels.length);
  if (n === 0) return NaN;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - eps, Math.max(eps, probs[i]!));
    acc += labels[i]! > 0 ? -Math.log(p) : -Math.log(1 - p);
  }
  return acc / n;
}

/** Brier score: mean squared error of predicted probabilities. Lower is better. */
export function brierScore(probs: ArrayLike<number>, labels: ArrayLike<number>): number {
  const n = Math.min(probs.length, labels.length);
  if (n === 0) return NaN;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (probs[i]! - (labels[i]! > 0 ? 1 : 0)) ** 2;
  return acc / n;
}

// ── Per-class classification report ──────────────────────────────────────────

/** Precision / recall / F1 / support for one class. */
export interface ClassScore {
  label: number;
  precision: number;
  recall: number;
  f1: number;
  /** True instances of this class. */
  support: number;
}

/** A scikit-learn style classification report. */
export interface ClassificationReport {
  perClass: ClassScore[];
  accuracy: number;
  /** Unweighted mean over classes — every class counts the same. */
  macro: { precision: number; recall: number; f1: number };
  /** Support-weighted mean — dominated by the common classes. */
  weighted: { precision: number; recall: number; f1: number };
}

/**
 * Per-class precision, recall and F1 plus macro/weighted averages. A class the
 * model never predicts scores 0 precision rather than NaN, so the macro average
 * stays comparable across runs.
 */
export function classificationReport(
  yTrue: ArrayLike<number>,
  yPred: ArrayLike<number>,
  classes?: number,
): ClassificationReport {
  const n = Math.min(yTrue.length, yPred.length);
  let k = classes ?? 0;
  if (!classes) for (let i = 0; i < n; i++) k = Math.max(k, yTrue[i]! + 1, yPred[i]! + 1);
  k = Math.max(0, Math.floor(k));

  const tp = new Float64Array(k);
  const fp = new Float64Array(k);
  const fn = new Float64Array(k);
  const support = new Float64Array(k);
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const t = yTrue[i]!;
    const p = yPred[i]!;
    if (t >= 0 && t < k) support[t]! += 1;
    if (t === p) {
      correct++;
      if (t >= 0 && t < k) tp[t]! += 1;
    } else {
      if (p >= 0 && p < k) fp[p]! += 1;
      if (t >= 0 && t < k) fn[t]! += 1;
    }
  }

  const perClass: ClassScore[] = [];
  for (let c = 0; c < k; c++) {
    const precision = tp[c]! + fp[c]! === 0 ? 0 : tp[c]! / (tp[c]! + fp[c]!);
    const recall = tp[c]! + fn[c]! === 0 ? 0 : tp[c]! / (tp[c]! + fn[c]!);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass.push({ label: c, precision, recall, f1, support: support[c]! });
  }
  const avg = (pick: (s: ClassScore) => number, weights?: Float64Array): number => {
    if (k === 0) return 0;
    if (!weights) {
      let acc = 0;
      for (const s of perClass) acc += pick(s);
      return acc / k;
    }
    let acc = 0;
    let total = 0;
    for (let c = 0; c < k; c++) {
      acc += pick(perClass[c]!) * weights[c]!;
      total += weights[c]!;
    }
    return total === 0 ? 0 : acc / total;
  };
  return {
    perClass,
    accuracy: n === 0 ? 0 : correct / n,
    macro: { precision: avg((s) => s.precision), recall: avg((s) => s.recall), f1: avg((s) => s.f1) },
    weighted: {
      precision: avg((s) => s.precision, support),
      recall: avg((s) => s.recall, support),
      f1: avg((s) => s.f1, support),
    },
  };
}

// ── Ranking curves ───────────────────────────────────────────────────────────

/** Cumulative gain / lift as a function of the fraction of the population targeted. */
export interface LiftCurve {
  /** Fraction of the population contacted, 0..1. */
  fraction: Float64Array;
  /** Fraction of all positives captured by then, 0..1 (the gain curve). */
  gain: Float64Array;
  /** gain ÷ fraction — how many times better than random. */
  lift: Float64Array;
  /** Positives in the data. */
  positives: number;
}

/**
 * Sort by descending score and walk down the list: the standard "if I contact
 * the top X%, what share of the buyers do I get?" curve that marketing and
 * churn models are judged on.
 */
export function liftCurve(scores: ArrayLike<number>, labels: ArrayLike<number>): LiftCurve {
  const n = Math.min(scores.length, labels.length);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  let positives = 0;
  for (let i = 0; i < n; i++) if (labels[i]! > 0) positives++;

  const fraction = new Float64Array(n + 1);
  const gain = new Float64Array(n + 1);
  const lift = new Float64Array(n + 1);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (labels[order[i]!]! > 0) hits++;
    const f = (i + 1) / n;
    fraction[i + 1] = f;
    gain[i + 1] = positives === 0 ? 0 : hits / positives;
    lift[i + 1] = f === 0 ? 0 : gain[i + 1]! / f;
  }
  lift[0] = n === 0 ? 0 : lift[1]!;
  return { fraction, gain, lift, positives };
}

/** One class's ROC curve in a one-vs-rest decomposition. */
export interface MulticlassRoc {
  perClass: Array<{ label: number; fpr: Float64Array; tpr: Float64Array; auc: number }>;
  /** Unweighted mean of the per-class AUCs. */
  macroAuc: number;
  /** AUC of the pooled binarized problem — dominated by the common classes. */
  microAuc: number;
}

/**
 * One-vs-rest ROC for a multiclass problem. `scores` is row-major `n × classes`
 * (a probability per class per sample), `labels` the true class index.
 */
export function rocCurveOvR(
  scores: ArrayLike<number>,
  labels: ArrayLike<number>,
  classes: number,
): MulticlassRoc {
  const n = labels.length;
  const perClass: MulticlassRoc["perClass"] = [];
  let macro = 0;
  // The micro curve pools every (score, is-this-class) pair into one problem.
  const pooledScores = new Float64Array(n * classes);
  const pooledLabels = new Float64Array(n * classes);
  for (let c = 0; c < classes; c++) {
    const s = new Float64Array(n);
    const l = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      s[i] = scores[i * classes + c]!;
      l[i] = labels[i]! === c ? 1 : 0;
      pooledScores[c * n + i] = s[i]!;
      pooledLabels[c * n + i] = l[i]!;
    }
    const roc = rocCurve(s, l);
    perClass.push({ label: c, fpr: roc.fpr, tpr: roc.tpr, auc: roc.auc });
    macro += roc.auc;
  }
  const micro = rocCurve(pooledScores, pooledLabels);
  return {
    perClass,
    macroAuc: classes === 0 ? 0 : macro / classes,
    microAuc: micro.auc,
  };
}
