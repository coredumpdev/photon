/**
 * Fits and summaries that turn a scatter into a claim: a trend line with a
 * confidence band, a local-regression smoother, an ECDF, a correlation matrix.
 * Pure — every function takes arrays and returns arrays.
 */

/** An ordinary-least-squares fit of `y = slope·x + intercept`. */
export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination, 0..1. */
  r2: number;
  /** Standard error of the residuals. */
  stderr: number;
  /** Points used (non-finite pairs are skipped). */
  n: number;
  /** Evaluate the fit at an x. */
  predict(x: number): number;
}

/** Least-squares straight line through (x, y), skipping non-finite pairs. */
export function linearRegression(x: ArrayLike<number>, y: ArrayLike<number>): LinearFit {
  const len = Math.min(x.length, y.length);
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < len; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    sx += xi;
    sy += yi;
    n++;
  }
  if (n < 2) {
    const intercept = n === 1 ? sy : 0;
    return { slope: 0, intercept, r2: 0, stderr: 0, n, predict: () => intercept };
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < len; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    const dx = xi - mx;
    const dy = yi - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssRes = Math.max(0, syy - slope * sxy);
  const r2 = syy === 0 ? 1 : 1 - ssRes / syy;
  const stderr = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { slope, intercept, r2, stderr, n, predict: (v: number) => slope * v + intercept };
}

/** A smoothed curve sampled on a grid, optionally with a band around it. */
export interface Trend {
  x: Float64Array;
  y: Float64Array;
  /** Lower/upper band, when the caller asked for one. */
  lower?: Float64Array;
  upper?: Float64Array;
}

/**
 * Sample a linear fit across the data range, with an optional ±`k`·stderr band.
 * `points` controls the resolution (2 is enough for the line itself).
 */
export function linearTrend(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { points?: number; band?: number } = {},
): Trend {
  const fit = linearRegression(x, y);
  const points = Math.max(2, opts.points ?? 2);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const gx = new Float64Array(points);
  const gy = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    gx[i] = lo + ((hi - lo) * i) / (points - 1);
    gy[i] = fit.predict(gx[i]!);
  }
  if (!opts.band) return { x: gx, y: gy };
  const k = opts.band;
  const lower = new Float64Array(points);
  const upper = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    lower[i] = gy[i]! - k * fit.stderr;
    upper[i] = gy[i]! + k * fit.stderr;
  }
  return { x: gx, y: gy, lower, upper };
}

/**
 * LOESS: locally-weighted linear regression with a tricube kernel. `bandwidth`
 * is the fraction of points in each local neighbourhood (0..1, default 0.3) —
 * larger is smoother. Returns the fit sampled on a sorted grid, so it can be
 * drawn straight as a line.
 */
export function loess(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { bandwidth?: number; points?: number } = {},
): Trend {
  const len = Math.min(x.length, y.length);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < len; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (Number.isFinite(xi) && Number.isFinite(yi)) pairs.push([xi, yi]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const n = pairs.length;
  const grid = Math.max(2, Math.min(opts.points ?? 100, Math.max(2, n)));
  const gx = new Float64Array(grid);
  const gy = new Float64Array(grid);
  if (n === 0) return { x: gx, y: gy };

  const bandwidth = Math.min(1, Math.max(2 / n, opts.bandwidth ?? 0.3));
  const span = Math.max(2, Math.round(bandwidth * n));
  const lo = pairs[0]![0];
  const hi = pairs[n - 1]![0];

  for (let g = 0; g < grid; g++) {
    const x0 = grid === 1 ? lo : lo + ((hi - lo) * g) / (grid - 1);
    gx[g] = x0;
    // The `span` nearest neighbours set the local scale.
    const dists = pairs.map(([px], i) => [Math.abs(px - x0), i] as const);
    dists.sort((a, b) => a[0] - b[0]);
    const maxDist = dists[Math.min(span, n) - 1]![0] || 1e-12;
    let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
    for (let k = 0; k < Math.min(span, n); k++) {
      const [d, idx] = dists[k]!;
      const u = d / maxDist;
      const w = u >= 1 ? 0 : (1 - u * u * u) ** 3; // tricube
      if (w === 0) continue;
      const [px, py] = pairs[idx]!;
      sw += w;
      swx += w * px;
      swy += w * py;
      swxx += w * px * px;
      swxy += w * px * py;
    }
    if (sw === 0) { gy[g] = pairs[Math.min(n - 1, g)]![1]; continue; }
    const denom = sw * swxx - swx * swx;
    if (Math.abs(denom) < 1e-12) { gy[g] = swy / sw; continue; }
    const slope = (sw * swxy - swx * swy) / denom;
    const intercept = (swy - slope * swx) / sw;
    gy[g] = slope * x0 + intercept;
  }
  return { x: gx, y: gy };
}

/** The empirical CDF as a step function: sorted values against their cumulative proportion. */
export function ecdf(values: ArrayLike<number>): { x: Float64Array; y: Float64Array } {
  const xs: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) xs.push(values[i]!);
  xs.sort((a, b) => a - b);
  const n = xs.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = xs[i]!;
    y[i] = (i + 1) / n;
  }
  return { x, y };
}

/** Standardize to zero mean and unit variance (population sd). Non-finite entries pass through. */
export function zscore(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  let count = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(values[i]!)) { mean += values[i]!; count++; }
  if (count === 0) return out;
  mean /= count;
  let varSum = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(values[i]!)) varSum += (values[i]! - mean) ** 2;
  const sd = Math.sqrt(varSum / count) || 1;
  for (let i = 0; i < n; i++) out[i] = Number.isFinite(values[i]!) ? (values[i]! - mean) / sd : values[i]!;
  return out;
}

/** Pearson correlation of two equal-length series (0 when either is constant). */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]!) || !Number.isFinite(b[i]!)) continue;
    ma += a[i]!; mb += b[i]!; count++;
  }
  if (count < 2) return 0;
  ma /= count; mb /= count;
  let saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]!) || !Number.isFinite(b[i]!)) continue;
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    saa += da * da; sbb += db * db; sab += da * db;
  }
  const denom = Math.sqrt(saa * sbb);
  return denom === 0 ? 0 : sab / denom;
}

/**
 * Pearson correlation matrix of `columns`, row-major and `k×k`. Feed it straight
 * to `addHeatmap` with a diverging colormap and `symmetricDomain`.
 */
export function corrMatrix(columns: ReadonlyArray<ArrayLike<number>>): {
  values: Float64Array;
  size: number;
} {
  const k = columns.length;
  const values = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    values[i * k + i] = 1;
    for (let j = i + 1; j < k; j++) {
      const r = correlation(columns[i]!, columns[j]!);
      values[i * k + j] = r;
      values[j * k + i] = r;
    }
  }
  return { values, size: k };
}
