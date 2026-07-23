/**
 * Chart-type transforms: turn raw OHLC(V) into the geometry a specialist finance
 * chart needs. Each returns plain arrays you render with existing layers
 * (candlestick, bar, area, scatter) — see the `Plot.add*` helpers that wrap them.
 */

export interface Ohlc {
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
}

export interface OhlcArrays {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
}

/**
 * Heikin-Ashi candles — a smoothed OHLC that filters noise and makes trends
 * obvious. Output has the same length; feed it to a candlestick layer.
 *
 *   haClose = (o+h+l+c)/4
 *   haOpen  = (prevHaOpen + prevHaClose)/2   (seed: (o₀+c₀)/2)
 *   haHigh  = max(h, haOpen, haClose)
 *   haLow   = min(l, haOpen, haClose)
 */
export function heikinAshi(d: Ohlc): OhlcArrays {
  const n = Math.min(d.open.length, d.high.length, d.low.length, d.close.length);
  const open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = d.open[i]!, h = d.high[i]!, l = d.low[i]!, c = d.close[i]!;
    const haClose = (o + h + l + c) / 4;
    const haOpen = i === 0 ? (o + c) / 2 : (open[i - 1]! + close[i - 1]!) / 2;
    close[i] = haClose;
    open[i] = haOpen;
    high[i] = Math.max(h, haOpen, haClose);
    low[i] = Math.min(l, haOpen, haClose);
  }
  return { open, high, low, close };
}

/** One brick / box for Renko & Line-break (each renders as a wickless candle body). */
export interface Brick {
  /** Sequential column index (0..n-1); bricks are evenly spaced, time is discarded. */
  x: number;
  open: number;
  close: number;
  /** `true` when close > open (up brick). */
  up: boolean;
}

/**
 * Renko bricks from a close series. A new brick is emitted each time price moves
 * a full `brickSize` from the last brick's close (multiple bricks if it jumps
 * several sizes). Time is discarded — bricks are placed at successive indices.
 */
export function renko(close: ArrayLike<number>, brickSize: number): Brick[] {
  const bricks: Brick[] = [];
  const n = close.length;
  if (n === 0 || brickSize <= 0) return bricks;
  let base = close[0]!;
  let x = 0;
  for (let i = 1; i < n; i++) {
    let diff = close[i]! - base;
    while (Math.abs(diff) >= brickSize) {
      const up = diff > 0;
      const open = base;
      const next = base + (up ? brickSize : -brickSize);
      bricks.push({ x: x++, open, close: next, up });
      base = next;
      diff = close[i]! - base;
    }
  }
  return bricks;
}

/**
 * Three-line-break (generalised to `lines`): a new up brick when close exceeds
 * the highest close of the last `lines` bricks, a down brick when it breaks the
 * lowest; otherwise nothing. Bricks are placed at successive indices.
 */
export function lineBreak(close: ArrayLike<number>, lines = 3): Brick[] {
  const bricks: Brick[] = [];
  const n = close.length;
  if (n === 0) return bricks;
  const ends: number[] = [close[0]!]; // brick close prices in order
  let x = 0;
  for (let i = 1; i < n; i++) {
    const c = close[i]!;
    const recent = ends.slice(-lines);
    const hi = Math.max(...recent);
    const lo = Math.min(...recent);
    if (c > hi) {
      bricks.push({ x: x++, open: ends[ends.length - 1]!, close: c, up: true });
      ends.push(c);
    } else if (c < lo) {
      bricks.push({ x: x++, open: ends[ends.length - 1]!, close: c, up: false });
      ends.push(c);
    }
  }
  return bricks;
}

/** One P&F column: a run of X's (rising) or O's (falling) spanning `from`→`to`. */
export interface PfColumn {
  col: number;
  kind: "X" | "O";
  from: number;
  to: number;
  /** Box centers filled in this column (for plotting the X/O glyphs). */
  boxes: number[];
}

/**
 * Point & Figure columns. Price is quantised to `boxSize`; a column of X's grows
 * while price rises, O's while it falls, and the column flips only after a
 * `reversal`-box move against it. Time is discarded.
 */
export function pointAndFigure(
  high: ArrayLike<number>, low: ArrayLike<number>, boxSize: number, reversal = 3,
): PfColumn[] {
  const n = Math.min(high.length, low.length);
  const cols: PfColumn[] = [];
  if (n === 0 || boxSize <= 0) return cols;
  const q = (p: number) => Math.floor(p / boxSize) * boxSize;
  let dir: "X" | "O" | null = null;
  let top = q(high[0]!), bottom = q(low[0]!);
  let col = 0;
  const pushCol = (kind: "X" | "O", from: number, to: number) => {
    const boxes: number[] = [];
    for (let b = Math.min(from, to); b <= Math.max(from, to) + 1e-9; b += boxSize) boxes.push(b + boxSize / 2);
    cols.push({ col, kind, from, to, boxes });
  };
  for (let i = 1; i < n; i++) {
    const h = q(high[i]!), l = q(low[i]!);
    if (dir === null) { dir = h - bottom >= l - bottom ? "X" : "O"; }
    if (dir === "X") {
      if (h > top) top = h;
      else if (bottom - l >= reversal * boxSize || top - (l) >= reversal * boxSize) {
        pushCol("X", bottom, top); col++; dir = "O"; bottom = l; // start new O column below
      }
    } else {
      if (l < bottom) bottom = l;
      else if (h - top >= reversal * boxSize || (h) - bottom >= reversal * boxSize) {
        pushCol("O", top, bottom); col++; dir = "X"; top = h; // start new X column above
      }
    }
  }
  if (dir === "X") pushCol("X", bottom, top);
  else if (dir === "O") pushCol("O", top, bottom);
  return cols;
}

export interface VolumeProfile {
  /** Bin center price for each level (length = bins). */
  levels: Float64Array;
  /** Total volume traded in each price bin. */
  volume: Float64Array;
  binSize: number;
  priceMin: number;
  priceMax: number;
  /** Bin index of the highest-volume level (the Point of Control). */
  pocIndex: number;
}

/**
 * Volume profile — a histogram of traded volume by price level. Plot it as
 * horizontal bars (`orientation:"h"`) with `levels` on the y axis.
 */
export function volumeProfile(
  price: ArrayLike<number>, volume: ArrayLike<number>, bins = 24,
): VolumeProfile {
  const n = Math.min(price.length, volume.length);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const p = price[i]!; if (p < lo) lo = p; if (p > hi) hi = p; }
  if (!isFinite(lo) || !isFinite(hi) || bins <= 0) {
    return { levels: new Float64Array(0), volume: new Float64Array(0), binSize: 0, priceMin: 0, priceMax: 0, pocIndex: -1 };
  }
  if (hi === lo) hi = lo + 1;
  const binSize = (hi - lo) / bins;
  const levels = new Float64Array(bins);
  const vol = new Float64Array(bins);
  for (let b = 0; b < bins; b++) levels[b] = lo + (b + 0.5) * binSize;
  for (let i = 0; i < n; i++) {
    let b = Math.floor((price[i]! - lo) / binSize);
    if (b < 0) b = 0; else if (b >= bins) b = bins - 1;
    vol[b] += volume[i]!;
  }
  let pocIndex = 0;
  for (let b = 1; b < bins; b++) if (vol[b]! > vol[pocIndex]!) pocIndex = b;
  return { levels, volume: vol, binSize, priceMin: lo, priceMax: hi, pocIndex };
}

export interface DepthCurves {
  /** Bid side: prices ascending toward mid, cumulative volume (best bid = largest cum). */
  bidPrice: Float64Array;
  bidCum: Float64Array;
  /** Ask side: prices ascending away from mid, cumulative volume. */
  askPrice: Float64Array;
  askCum: Float64Array;
}

/**
 * Order-book depth curves. `bids`/`asks` are `[price, size]` pairs (any order);
 * returns cumulative-volume step curves ready for two step-area layers.
 */
export function depth(
  bids: ArrayLike<readonly [number, number]>, asks: ArrayLike<readonly [number, number]>,
): DepthCurves {
  const b = Array.from({ length: bids.length }, (_, i) => bids[i]!).sort((p, q) => q[0] - p[0]); // high→low
  const a = Array.from({ length: asks.length }, (_, i) => asks[i]!).sort((p, q) => p[0] - q[0]); // low→high
  const bidPrice = new Float64Array(b.length), bidCum = new Float64Array(b.length);
  let cum = 0;
  for (let i = 0; i < b.length; i++) { cum += b[i]![1]; bidPrice[i] = b[i]![0]; bidCum[i] = cum; }
  // Reverse the bid side so prices run ascending (left→right) toward the mid.
  bidPrice.reverse(); bidCum.reverse();
  const askPrice = new Float64Array(a.length), askCum = new Float64Array(a.length);
  cum = 0;
  for (let i = 0; i < a.length; i++) { cum += a[i]![1]; askPrice[i] = a[i]![0]; askCum[i] = cum; }
  return { bidPrice, bidCum, askPrice, askCum };
}
