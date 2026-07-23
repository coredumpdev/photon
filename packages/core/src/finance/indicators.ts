/**
 * Technical-analysis indicators — pure array→array transforms you overlay on a
 * price chart (as lines/bands) or drop into a linked sub-pane (RSI, MACD).
 *
 * Every function returns a `Float64Array` the same length as its input, with a
 * leading run of `NaN` for the warm-up period (before enough data exists). Feed
 * the result straight to a line/area layer — plot helpers skip the NaN prefix.
 */

function toF64(values: ArrayLike<number>): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i]!;
  return out;
}

/** Simple moving average over `period` samples. */
export function sma(values: ArrayLike<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Weighted moving average (linear weights 1..period, newest heaviest). */
export function wma(values: ArrayLike<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < period; k++) acc += values[i - period + 1 + k]! * (k + 1);
    out[i] = acc / denom;
  }
  return out;
}

/**
 * Exponential moving average, α = 2/(period+1). Seeded with the SMA of the first
 * `period` samples at index `period-1` (the standard convention).
 */
export function ema(values: ArrayLike<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = values[i]! * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

/** Rolling population standard deviation over `period` samples. */
export function rollingStd(values: ArrayLike<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (period <= 0 || n < period) return out;
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    sum += v; sumSq += v * v;
    if (i >= period) { const old = values[i - period]!; sum -= old; sumSq -= old * old; }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = Math.max(0, sumSq / period - mean * mean);
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

export interface BollingerBands {
  middle: Float64Array;
  upper: Float64Array;
  lower: Float64Array;
}

/** Bollinger Bands: SMA(period) ± `k`·rollingStd(period). Defaults 20, 2. */
export function bollinger(close: ArrayLike<number>, period = 20, k = 2): BollingerBands {
  const middle = sma(close, period);
  const sd = rollingStd(close, period);
  const n = close.length;
  const upper = new Float64Array(n).fill(NaN);
  const lower = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(middle[i]!)) {
      upper[i] = middle[i]! + k * sd[i]!;
      lower[i] = middle[i]! - k * sd[i]!;
    }
  }
  return { middle, upper, lower };
}

/** Wilder's RSI over `period` (default 14). Values in 0..100; warm-up is NaN. */
export function rsi(close: ArrayLike<number>, period = 14): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (period <= 0 || n <= period) return out;
  let gain = 0, loss = 0;
  // Seed with the average gain/loss over the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const ch = close[i]! - close[i - 1]!;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const ch = close[i]! - close[i - 1]!;
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface Macd {
  macd: Float64Array;
  signal: Float64Array;
  histogram: Float64Array;
}

/** MACD: EMA(fast) − EMA(slow), its EMA(signal) line, and the histogram. Defaults 12/26/9. */
export function macd(close: ArrayLike<number>, fast = 12, slow = 26, signalPeriod = 9): Macd {
  const n = close.length;
  const emaFast = ema(close, fast);
  const emaSlow = ema(close, slow);
  const line = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(emaFast[i]!) && !Number.isNaN(emaSlow[i]!)) line[i] = emaFast[i]! - emaSlow[i]!;
  }
  // Signal = EMA of the MACD line over its valid (non-NaN) region.
  const firstValid = line.findIndex((v) => !Number.isNaN(v));
  const signal = new Float64Array(n).fill(NaN);
  if (firstValid >= 0) {
    const seg = line.subarray(firstValid);
    const sig = ema(seg, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i]!;
  }
  const histogram = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(line[i]!) && !Number.isNaN(signal[i]!)) histogram[i] = line[i]! - signal[i]!;
  }
  return { macd: line, signal, histogram };
}

/**
 * Volume-weighted average price, cumulative from the first sample: running
 * Σ(typical·volume) / Σ(volume), where typical = (high+low+close)/3.
 */
export function vwap(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>, volume: ArrayLike<number>,
): Float64Array {
  const n = Math.min(high.length, low.length, close.length, volume.length);
  const out = new Float64Array(n).fill(NaN);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < n; i++) {
    const typical = (high[i]! + low[i]! + close[i]!) / 3;
    cumPV += typical * volume[i]!;
    cumV += volume[i]!;
    out[i] = cumV === 0 ? NaN : cumPV / cumV;
  }
  return out;
}

/** True range per bar: max(H−L, |H−prevC|, |L−prevC|). First bar is H−L. */
export function trueRange(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>,
): Float64Array {
  const n = Math.min(high.length, low.length, close.length);
  const out = new Float64Array(n);
  if (n > 0) out[0] = high[0]! - low[0]!;
  for (let i = 1; i < n; i++) {
    const pc = close[i - 1]!;
    out[i] = Math.max(high[i]! - low[i]!, Math.abs(high[i]! - pc), Math.abs(low[i]! - pc));
  }
  return out;
}

/** Wilder's Average True Range over `period` (default 14). */
export function atr(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>, period = 14,
): Float64Array {
  const tr = trueRange(high, low, close);
  const n = tr.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Index of the first non-NaN value (−1 if all NaN). Handy for trimming warm-up. */
export function firstFinite(values: ArrayLike<number>): number {
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i]!)) return i;
  return -1;
}

export { toF64 as toFloat64 };
