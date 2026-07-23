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

// Rolling highest/lowest over a trailing window (NaN warm-up).
function rollingHigh(v: ArrayLike<number>, period: number): Float64Array {
  const n = v.length, out = new Float64Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) { let m = -Infinity; for (let k = 0; k < period; k++) m = Math.max(m, v[i - k]!); out[i] = m; }
  return out;
}
function rollingLow(v: ArrayLike<number>, period: number): Float64Array {
  const n = v.length, out = new Float64Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) { let m = Infinity; for (let k = 0; k < period; k++) m = Math.min(m, v[i - k]!); out[i] = m; }
  return out;
}

export interface Stochastic { k: Float64Array; d: Float64Array; }

/** Stochastic oscillator: %K over `kPeriod`, %D = SMA(%K, dPeriod). Values 0..100. */
export function stochastic(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>, kPeriod = 14, dPeriod = 3,
): Stochastic {
  const n = Math.min(high.length, low.length, close.length);
  const hh = rollingHigh(high, kPeriod), ll = rollingLow(low, kPeriod);
  const k = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(hh[i]!)) { const rng = hh[i]! - ll[i]!; k[i] = rng === 0 ? 50 : (100 * (close[i]! - ll[i]!)) / rng; }
  }
  return { k, d: sma(k, dPeriod) };
}

export interface Channel { middle: Float64Array; upper: Float64Array; lower: Float64Array; }

/** Keltner Channels: EMA(period) ± mult·ATR(atrPeriod). */
export function keltner(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>, period = 20, mult = 2, atrPeriod = 10,
): Channel {
  const middle = ema(close, period);
  const a = atr(high, low, close, atrPeriod);
  const n = close.length, upper = new Float64Array(n).fill(NaN), lower = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (!Number.isNaN(middle[i]!) && !Number.isNaN(a[i]!)) { upper[i] = middle[i]! + mult * a[i]!; lower[i] = middle[i]! - mult * a[i]!; }
  return { middle, upper, lower };
}

/** On-Balance Volume — a running signed volume total (no warm-up). */
export function obv(close: ArrayLike<number>, volume: ArrayLike<number>): Float64Array {
  const n = Math.min(close.length, volume.length), out = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = close[i]! - close[i - 1]!;
    out[i] = out[i - 1]! + (d > 0 ? volume[i]! : d < 0 ? -volume[i]! : 0);
  }
  return out;
}

export interface Ichimoku {
  conversion: Float64Array; // Tenkan-sen
  base: Float64Array;       // Kijun-sen
  spanA: Float64Array;      // Senkou A (unshifted)
  spanB: Float64Array;      // Senkou B (unshifted)
}

/**
 * Ichimoku lines (conversion/base/spanA/spanB). Spans are returned **unshifted**
 * (traditional charts project the cloud forward by `basePeriod` bars).
 */
export function ichimoku(
  high: ArrayLike<number>, low: ArrayLike<number>, convPeriod = 9, basePeriod = 26, spanBPeriod = 52,
): Ichimoku {
  const n = Math.min(high.length, low.length);
  const mid = (p: number) => { const hi = rollingHigh(high, p), lo = rollingLow(low, p), o = new Float64Array(n).fill(NaN); for (let i = 0; i < n; i++) if (!Number.isNaN(hi[i]!)) o[i] = (hi[i]! + lo[i]!) / 2; return o; };
  const conversion = mid(convPeriod), base = mid(basePeriod), spanB = mid(spanBPeriod);
  const spanA = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (!Number.isNaN(conversion[i]!) && !Number.isNaN(base[i]!)) spanA[i] = (conversion[i]! + base[i]!) / 2;
  return { conversion, base, spanA, spanB };
}

export interface Adx { adx: Float64Array; plusDI: Float64Array; minusDI: Float64Array; }

/** Wilder's ADX (+DI / −DI / ADX) over `period` (default 14). */
export function adx(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>, period = 14,
): Adx {
  const n = Math.min(high.length, low.length, close.length);
  const plusDI = new Float64Array(n).fill(NaN), minusDI = new Float64Array(n).fill(NaN), out = new Float64Array(n).fill(NaN);
  if (n <= period) return { adx: out, plusDI, minusDI };
  const tr = new Float64Array(n), pdm = new Float64Array(n), mdm = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = high[i]! - high[i - 1]!, down = low[i - 1]! - low[i]!;
    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;
    const pc = close[i - 1]!;
    tr[i] = Math.max(high[i]! - low[i]!, Math.abs(high[i]! - pc), Math.abs(low[i]! - pc));
  }
  // Wilder-smoothed sums seeded at index `period`.
  let sTR = 0, sP = 0, sM = 0;
  for (let i = 1; i <= period; i++) { sTR += tr[i]!; sP += pdm[i]!; sM += mdm[i]!; }
  const dx = new Float64Array(n).fill(NaN);
  const diAt = (i: number) => {
    const p = sTR === 0 ? 0 : (100 * sP) / sTR, m = sTR === 0 ? 0 : (100 * sM) / sTR;
    plusDI[i] = p; minusDI[i] = m;
    const sum = p + m;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum;
  };
  diAt(period);
  for (let i = period + 1; i < n; i++) {
    sTR = sTR - sTR / period + tr[i]!;
    sP = sP - sP / period + pdm[i]!;
    sM = sM - sM / period + mdm[i]!;
    diAt(i);
  }
  // ADX = Wilder-smoothed DX starting `period` bars after the first DX.
  const start = period, adxStart = start + period;
  if (adxStart < n) {
    let acc = 0; for (let i = start + 1; i <= adxStart; i++) acc += dx[i]!;
    let prev = acc / period;
    out[adxStart] = prev;
    for (let i = adxStart + 1; i < n; i++) { prev = (prev * (period - 1) + dx[i]!) / period; out[i] = prev; }
  }
  return { adx: out, plusDI, minusDI };
}

export interface SuperTrend { trend: Float64Array; direction: Float64Array; }

/**
 * SuperTrend (ATR bands with trend-following flip). `trend` is the line; `direction`
 * is +1 (up / support below price) or −1 (down / resistance above price).
 */
export function superTrend(
  high: ArrayLike<number>, low: ArrayLike<number>, close: ArrayLike<number>, period = 10, mult = 3,
): SuperTrend {
  const n = Math.min(high.length, low.length, close.length);
  const a = atr(high, low, close, period);
  const trend = new Float64Array(n).fill(NaN), direction = new Float64Array(n).fill(NaN);
  const finalUpper = new Float64Array(n), finalLower = new Float64Array(n);
  let dir = 1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i]!)) continue;
    const hl2 = (high[i]! + low[i]!) / 2;
    const bU = hl2 + mult * a[i]!, bL = hl2 - mult * a[i]!;
    const prevValid = i > 0 && !Number.isNaN(a[i - 1]!);
    finalUpper[i] = prevValid && (bU < finalUpper[i - 1]! || close[i - 1]! > finalUpper[i - 1]!) ? bU : (prevValid ? finalUpper[i - 1]! : bU);
    finalLower[i] = prevValid && (bL > finalLower[i - 1]! || close[i - 1]! < finalLower[i - 1]!) ? bL : (prevValid ? finalLower[i - 1]! : bL);
    if (!prevValid) dir = close[i]! >= hl2 ? 1 : -1;
    else if (dir === 1 && close[i]! < finalLower[i]!) dir = -1;
    else if (dir === -1 && close[i]! > finalUpper[i]!) dir = 1;
    direction[i] = dir;
    trend[i] = dir === 1 ? finalLower[i]! : finalUpper[i]!;
  }
  return { trend, direction };
}

export interface FibLevel { ratio: number; price: number; }

/** Fibonacci retracement price levels between a `high` and `low` (standard ratios). */
export function fibRetracements(high: number, low: number, ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]): FibLevel[] {
  const span = high - low;
  return ratios.map((r) => ({ ratio: r, price: high - span * r }));
}

export { toF64 as toFloat64 };
