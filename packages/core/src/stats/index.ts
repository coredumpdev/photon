/** Pure statistics helpers backing the histogram, box, and violin layers. */

export interface Histogram {
  edges: Float64Array;
  counts: Float64Array;
  centers: Float64Array;
  binWidth: number;
}

/** Bin `values` into `bins` equal-width buckets (or use explicit `edges`). */
export function histogram(
  values: ArrayLike<number>,
  opts: { bins?: number; edges?: ArrayLike<number>; range?: [number, number] } = {},
): Histogram {
  const n = values.length;
  let edges: Float64Array;
  if (opts.edges) {
    edges = Float64Array.from(opts.edges as ArrayLike<number>);
  } else {
    let lo = opts.range?.[0] ?? Infinity;
    let hi = opts.range?.[1] ?? -Infinity;
    if (!opts.range) {
      for (let i = 0; i < n; i++) {
        const v = values[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo) || !isFinite(hi) || lo === hi) {
      lo = (lo || 0) - 0.5;
      hi = (hi || 0) + 0.5;
    }
    // Sturges' rule as a sane default bin count.
    const bins = opts.bins ?? Math.max(1, Math.ceil(Math.log2(n || 1) + 1));
    edges = new Float64Array(bins + 1);
    for (let i = 0; i <= bins; i++) edges[i] = lo + ((hi - lo) * i) / bins;
  }

  const bins = edges.length - 1;
  const counts = new Float64Array(bins);
  const lo = edges[0]!, hi = edges[bins]!;
  const width = (hi - lo) / bins;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (v < lo || v > hi) continue;
    let b = Math.floor((v - lo) / width);
    if (b >= bins) b = bins - 1; // include the right edge
    counts[b]! += 1;
  }
  const centers = new Float64Array(bins);
  for (let i = 0; i < bins; i++) centers[i] = (edges[i]! + edges[i + 1]!) / 2;
  return { edges, counts, centers, binWidth: width };
}

/** Quantile of a *sorted* array via linear interpolation (type-7, like NumPy). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const a = sorted[lo]!;
  const b = sorted[Math.min(n - 1, lo + 1)]!;
  return a + (b - a) * frac;
}

export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Whisker ends: furthest points within 1.5·IQR of the quartiles. */
  whiskerLo: number;
  whiskerHi: number;
  outliers: number[];
}

/** Tukey box-plot statistics for a set of values. */
export function boxStats(values: ArrayLike<number>): BoxStats {
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const n = sorted.length;
  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const fenceLo = q1 - 1.5 * iqr;
  const fenceHi = q3 + 1.5 * iqr;
  let whiskerLo = q1, whiskerHi = q3;
  const outliers: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = sorted[i]!;
    if (v < fenceLo || v > fenceHi) outliers.push(v);
    else {
      if (v < whiskerLo) whiskerLo = v;
      if (v > whiskerHi) whiskerHi = v;
    }
  }
  return {
    min: n ? sorted[0]! : NaN,
    q1, median, q3,
    max: n ? sorted[n - 1]! : NaN,
    whiskerLo, whiskerHi, outliers,
  };
}

function stddev(values: ArrayLike<number>, mean: number): number {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i]! - mean;
    s += d * d;
  }
  return Math.sqrt(s / Math.max(1, n - 1));
}

/** In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tRe = re[b]! * curRe - im[b]! * curIm;
        const tIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - tRe; im[b] = im[a]! - tIm;
        re[a] = re[a]! + tRe; im[a] = im[a]! + tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

export interface Spectrogram {
  /** Row-major magnitudes (dB), rows = freq bins (low at row 0), cols = frames. */
  values: Float64Array;
  cols: number;
  rows: number;
  extent: { x: [number, number]; y: [number, number] };
}

/** Short-time Fourier transform of a real signal → a time×frequency dB grid. */
export function spectrogram(
  signal: ArrayLike<number>,
  opts: { fftSize?: number; hop?: number; sampleRate?: number } = {},
): Spectrogram {
  const fftSize = opts.fftSize ?? 256;
  const hop = opts.hop ?? fftSize >> 1;
  const sr = opts.sampleRate ?? 1;
  const N = signal.length;
  const frames = Math.max(1, Math.floor((N - fftSize) / hop) + 1);
  const bins = fftSize >> 1;
  const values = new Float64Array(bins * frames);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)); // Hann
      re[i] = (signal[start + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const mag = Math.hypot(re[b]!, im[b]!) / fftSize;
      values[b * frames + f] = 20 * Math.log10(mag + 1e-9); // dB
    }
  }
  return {
    values,
    cols: frames,
    rows: bins,
    extent: { x: [0, N / sr], y: [0, sr / 2] },
  };
}

export interface Density {
  xs: Float64Array;
  ys: Float64Array;
}

/**
 * Gaussian kernel density estimate over `points` grid samples in [lo, hi].
 * Bandwidth defaults to Silverman's rule of thumb.
 */
export function kde(
  values: ArrayLike<number>,
  lo: number,
  hi: number,
  points = 64,
  bandwidth?: number,
): Density {
  const n = values.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i]!;
  mean /= Math.max(1, n);
  const sd = stddev(values, mean) || 1;
  const h = bandwidth ?? 1.06 * sd * Math.pow(Math.max(1, n), -0.2);
  const xs = new Float64Array(points);
  const ys = new Float64Array(points);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  for (let p = 0; p < points; p++) {
    const x = lo + ((hi - lo) * p) / (points - 1);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = (x - values[i]!) / h;
      sum += Math.exp(-0.5 * u * u);
    }
    xs[p] = x;
    ys[p] = sum * norm;
  }
  return { xs, ys };
}
