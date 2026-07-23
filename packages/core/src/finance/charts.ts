/**
 * Convenience builders for specialist finance charts. Each takes a {@link Plot}
 * and composes existing layers from a transform/indicator — mirroring the
 * `addMap(plot, …)` free-function style. Import from `@photonviz/core`.
 */
import type { AreaLayer } from "../layers/area.js";
import type { BarLayer } from "../layers/bar.js";
import { type Candle, type CandlestickLayer, type CandlestickOptions } from "../layers/candlestick.js";
import type { LineLayer } from "../layers/line.js";
import type { Plot } from "../plot.js";
import type { Color, RenderType } from "../types.js";
import { bollinger, firstFinite } from "./indicators.js";
import { depth, heikinAshi, renko, volumeProfile, type Brick } from "./transforms.js";

/** Raw OHLC input shared by the candle-style helpers. */
export interface OhlcInput {
  x: ArrayLike<number>;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
}

export interface HeikinAshiOptions extends Omit<CandlestickOptions, "open" | "high" | "low" | "close"> {
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
}

/** Heikin-Ashi candles: smooth the OHLC, then draw it as a candlestick layer. */
export function addHeikinAshi(plot: Plot, opts: HeikinAshiOptions): CandlestickLayer {
  const ha = heikinAshi(opts);
  return plot.addCandlestick({ ...opts, open: ha.open, high: ha.high, low: ha.low, close: ha.close });
}

export interface RenkoOptions {
  close: ArrayLike<number>;
  /** Fixed brick height in price units. */
  brickSize: number;
  upColor?: string | Color;
  downColor?: string | Color;
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

/**
 * Renko chart — bricks at successive integer indices (time discarded). Rendered
 * as wickless candles, so pair it with an `ordinal-time`/linear x axis.
 */
export function addRenko(plot: Plot, opts: RenkoOptions): CandlestickLayer {
  const bricks: Brick[] = renko(opts.close, opts.brickSize);
  const n = bricks.length;
  const x = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n);
  const low = new Float64Array(n), close = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bricks[i]!;
    x[i] = b.x; open[i] = b.open; close[i] = b.close;
    high[i] = Math.max(b.open, b.close); low[i] = Math.min(b.open, b.close);
  }
  return plot.addCandlestick({
    x, open, high, low, close, width: 1,
    upColor: opts.upColor, downColor: opts.downColor,
    wickWidth: 0.001, name: opts.name, yAxis: opts.yAxis, renderType: opts.renderType,
  });
}

export interface VolumeProfileOptions {
  /** Price per sample (typically close). */
  price: ArrayLike<number>;
  volume: ArrayLike<number>;
  /** Number of price bins. Default 24. */
  bins?: number;
  color?: string | Color;
  /** Highlight the Point-of-Control bin with this color. */
  pocColor?: string | Color;
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

/** Volume-by-price histogram as horizontal bars (price on the y axis). */
export function addVolumeProfile(plot: Plot, opts: VolumeProfileOptions): BarLayer {
  const vp = volumeProfile(opts.price, opts.volume, opts.bins ?? 24);
  const base = opts.color ?? "#60a5fa";
  const colors = opts.pocColor
    ? Array.from(vp.levels, (_, i) => (i === vp.pocIndex ? opts.pocColor! : base))
    : undefined;
  return plot.addBar({
    x: vp.levels, y: vp.volume, orientation: "h", base: 0,
    width: vp.binSize * 0.85, color: base, colors,
    name: opts.name, yAxis: opts.yAxis, renderType: opts.renderType,
  });
}

export interface BollingerOptions {
  x: ArrayLike<number>;
  close: ArrayLike<number>;
  period?: number;
  k?: number;
  /** Line color for the bands + middle. Default light blue. */
  color?: string | Color;
  /** Fill color between the bands (omit to skip the fill). */
  bandColor?: string | Color;
  width?: number;
  yAxis?: string;
  renderType?: RenderType;
}

/** Bollinger Bands: a shaded band between upper/lower plus the three lines. */
export interface BollingerHandle {
  band?: AreaLayer;
  upper: LineLayer;
  middle: LineLayer;
  lower: LineLayer;
}

export function addBollinger(plot: Plot, opts: BollingerOptions): BollingerHandle {
  const { middle, upper, lower } = bollinger(opts.close, opts.period ?? 20, opts.k ?? 2);
  const start = firstFinite(middle);
  const slice = (a: Float64Array) => (start < 0 ? a.subarray(0, 0) : a.subarray(start));
  const n = middle.length;
  const xs = new Float64Array(Math.max(0, n - Math.max(0, start)));
  for (let i = 0; i < xs.length; i++) xs[i] = opts.x[start + i]!;
  const color = opts.color ?? "#a78bfa";
  const width = opts.width ?? 1;
  const rt = opts.renderType;
  const band = opts.bandColor
    ? plot.addArea({ x: xs, y: slice(upper), base: slice(lower), color: opts.bandColor, yAxis: opts.yAxis, renderType: rt })
    : undefined;
  return {
    band,
    upper: plot.addLine({ x: xs, y: slice(upper), color, width, yAxis: opts.yAxis, renderType: rt }),
    middle: plot.addLine({ x: xs, y: slice(middle), color, width, name: "BB", yAxis: opts.yAxis, renderType: rt }),
    lower: plot.addLine({ x: xs, y: slice(lower), color, width, yAxis: opts.yAxis, renderType: rt }),
  };
}

export interface DepthOptions {
  /** `[price, size]` levels (any order). */
  bids: ArrayLike<readonly [number, number]>;
  asks: ArrayLike<readonly [number, number]>;
  bidColor?: string | Color;
  askColor?: string | Color;
  yAxis?: string;
  renderType?: RenderType;
}

/** Order-book depth: cumulative bid/ask volume as two filled areas. */
export interface DepthHandle {
  bid: AreaLayer;
  ask: AreaLayer;
}

export function addDepth(plot: Plot, opts: DepthOptions): DepthHandle {
  const d = depth(opts.bids, opts.asks);
  return {
    bid: plot.addArea({
      x: d.bidPrice, y: d.bidCum, base: 0,
      color: opts.bidColor ?? "rgba(38,166,154,0.4)", name: "bids", yAxis: opts.yAxis, renderType: opts.renderType,
    }),
    ask: plot.addArea({
      x: d.askPrice, y: d.askCum, base: 0,
      color: opts.askColor ?? "rgba(239,83,80,0.4)", name: "asks", yAxis: opts.yAxis, renderType: opts.renderType,
    }),
  };
}

export type { Candle };
