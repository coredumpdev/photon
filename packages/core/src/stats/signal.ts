/**
 * Signal processing — window functions, spectral estimation, smoothing and
 * correlation. Pure array→array, like the indicators: no plotting, no state.
 *
 * `fft` / `spectrogram` live in `stats/index.ts`; this module adds the pieces a
 * real analysis needs around them (a proper window, an averaged PSD, a filter).
 */
import { fft } from "./index.js";

/** Window (taper) applied to a frame before an FFT, to suppress spectral leakage. */
export type WindowName = "rectangular" | "hann" | "hamming" | "blackman" | "bartlett";

/**
 * Sample a window function over `n` points.
 *
 * `hann` is the sane default; `hamming` trades a touch of leakage for a lower
 * first sidelobe; `blackman` suppresses sidelobes hardest at the cost of
 * resolution; `bartlett` (triangular) is cheap; `rectangular` is no window at
 * all — use it only when the frame already contains whole periods.
 */
export function windowFunction(name: WindowName, n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 0) return w;
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  const d = n - 1;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / d;
    switch (name) {
      case "rectangular": w[i] = 1; break;
      case "hamming": w[i] = 0.54 - 0.46 * Math.cos(t); break;
      case "blackman": w[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t); break;
      case "bartlett": w[i] = 1 - Math.abs((i - d / 2) / (d / 2)); break;
      default: w[i] = 0.5 - 0.5 * Math.cos(t); break; // hann
    }
  }
  return w;
}

/** A one-sided power spectral density estimate. */
export interface Psd {
  /** Frequencies in Hz (or cycles/sample when `sampleRate` is 1). */
  frequencies: Float64Array;
  /** Power per bin, in units²/Hz. */
  power: Float64Array;
}

export interface WelchOptions {
  /** Samples per segment (rounded down to a power of two). Default 256. */
  segment?: number;
  /** Overlap between segments, 0..1. Default 0.5. */
  overlap?: number;
  window?: WindowName;
  sampleRate?: number;
}

/**
 * Welch's method: average the periodograms of overlapping windowed segments.
 * Trades frequency resolution for a far lower-variance estimate than a single
 * FFT of the whole signal — the standard way to read a noisy spectrum.
 */
export function welch(signal: ArrayLike<number>, opts: WelchOptions = {}): Psd {
  const sr = opts.sampleRate ?? 1;
  const requested = opts.segment ?? 256;
  // The radix-2 FFT needs a power-of-two frame.
  let size = 1;
  while (size * 2 <= Math.min(requested, signal.length)) size *= 2;
  const bins = size >> 1;
  if (bins < 1) return { frequencies: new Float64Array(0), power: new Float64Array(0) };

  const overlap = Math.min(0.95, Math.max(0, opts.overlap ?? 0.5));
  const step = Math.max(1, Math.round(size * (1 - overlap)));
  const win = windowFunction(opts.window ?? "hann", size);
  // Normalization so the estimate is a density independent of the window shape.
  let winPower = 0;
  for (let i = 0; i < size; i++) winPower += win[i]! * win[i]!;
  const norm = 1 / (sr * winPower);

  const power = new Float64Array(bins);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let segments = 0;
  for (let start = 0; start + size <= signal.length; start += step) {
    for (let i = 0; i < size; i++) {
      re[i] = signal[start + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      // Double every bin except DC to fold the negative frequencies in.
      const scale = b === 0 ? 1 : 2;
      power[b]! += (re[b]! * re[b]! + im[b]! * im[b]!) * norm * scale;
    }
    segments++;
  }
  if (segments > 1) for (let b = 0; b < bins; b++) power[b]! /= segments;

  const frequencies = new Float64Array(bins);
  for (let b = 0; b < bins; b++) frequencies[b] = (b * sr) / size;
  return { frequencies, power };
}

/**
 * Savitzky–Golay smoothing: least-squares fit a polynomial over a sliding
 * window. Unlike a moving average it preserves peak height and width, which is
 * why spectroscopy and sensor pipelines reach for it.
 *
 * `window` must be odd (rounded up) and larger than `order`. Edges are handled
 * by clamping to the nearest sample.
 */
export function savitzkyGolay(values: ArrayLike<number>, window = 9, order = 2): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  let m = Math.max(3, Math.floor(window));
  if (m % 2 === 0) m += 1;
  const half = (m - 1) >> 1;
  const deg = Math.max(0, Math.min(order, m - 1));
  if (n === 0) return out;
  if (n < m) {
    for (let i = 0; i < n; i++) out[i] = values[i]!;
    return out;
  }

  // Normal equations for the polynomial fit at the window centre (t = 0), which
  // is the only coefficient we need: out[i] = Σ c[k]·x[i+k].
  const size = deg + 1;
  const ata: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let t = -half; t <= half; t++) {
    const powers = new Array<number>(size);
    powers[0] = 1;
    for (let p = 1; p < size; p++) powers[p] = powers[p - 1]! * t;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) ata[r]![c]! += powers[r]! * powers[c]!;
  }
  // Solve ATA·a = e0 by Gaussian elimination; the first row of ATA⁻¹ gives the weights.
  const aug: number[][] = ata.map((row, r) => [...row, r === 0 ? 1 : 0]);
  for (let c = 0; c < size; c++) {
    let pivot = c;
    for (let r = c + 1; r < size; r++) if (Math.abs(aug[r]![c]!) > Math.abs(aug[pivot]![c]!)) pivot = r;
    if (Math.abs(aug[pivot]![c]!) < 1e-12) continue;
    [aug[c], aug[pivot]] = [aug[pivot]!, aug[c]!];
    const p = aug[c]![c]!;
    for (let k = c; k <= size; k++) aug[c]![k]! /= p;
    for (let r = 0; r < size; r++) {
      if (r === c) continue;
      const f = aug[r]![c]!;
      if (f === 0) continue;
      for (let k = c; k <= size; k++) aug[r]![k]! -= f * aug[c]![k]!;
    }
  }
  const coef = aug.map((row) => row[size]!);

  const weights = new Float64Array(m);
  for (let t = -half, i = 0; t <= half; t++, i++) {
    let w = 0;
    let tp = 1;
    for (let p = 0; p < size; p++) {
      w += coef[p]! * tp;
      tp *= t;
    }
    weights[i] = w;
  }

  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < m; k++) {
      const idx = Math.min(n - 1, Math.max(0, i + k - half));
      acc += weights[k]! * values[idx]!;
    }
    out[i] = acc;
  }
  return out;
}

/** A correlation sequence indexed by lag. */
export interface Correlation {
  /** Lags, from `-maxLag` to `+maxLag`. */
  lags: Int32Array;
  /** Correlation at each lag. */
  values: Float64Array;
}

/**
 * Cross-correlation of two series over ±`maxLag`. `normalize` (default true)
 * divides by the zero-lag autocorrelations, so the result is a correlation
 * coefficient in −1..1 and the peak lag reads directly as "b lags a by k".
 * Pass the same array twice for an autocorrelation.
 */
export function crossCorrelate(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  maxLag = Math.min(a.length, b.length) - 1,
  normalize = true,
): Correlation {
  const n = Math.min(a.length, b.length);
  const lag = Math.max(0, Math.min(Math.floor(maxLag), n - 1));
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i]!;
    meanB += b[i]!;
  }
  meanA /= n || 1;
  meanB /= n || 1;

  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    varA += (a[i]! - meanA) ** 2;
    varB += (b[i]! - meanB) ** 2;
  }
  const denom = normalize ? Math.sqrt(varA * varB) || 1 : 1;

  const count = 2 * lag + 1;
  const lags = new Int32Array(count);
  const values = new Float64Array(count);
  for (let k = -lag, j = 0; k <= lag; k++, j++) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const bi = i + k;
      if (bi < 0 || bi >= n) continue;
      acc += (a[i]! - meanA) * (b[bi]! - meanB);
    }
    lags[j] = k;
    values[j] = acc / denom;
  }
  return { lags, values };
}
