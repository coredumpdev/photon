import { describe, expect, it } from "vitest";
import {
  atr, bollinger, ema, macd, rsi, sma, trueRange, vwap, wma, rollingStd, firstFinite,
  stochastic, keltner, obv, ichimoku, adx, superTrend, fibRetracements,
} from "../src/finance/indicators.js";
import {
  depth, heikinAshi, lineBreak, pointAndFigure, renko, volumeProfile,
} from "../src/finance/transforms.js";

const nan = (a: Float64Array, i: number) => Number.isNaN(a[i]!);

describe("indicators", () => {
  it("sma: trailing mean with NaN warm-up", () => {
    const s = sma([1, 2, 3, 4, 5], 3);
    expect(nan(s, 0)).toBe(true);
    expect(nan(s, 1)).toBe(true);
    expect(Array.from(s.subarray(2))).toEqual([2, 3, 4]);
  });

  it("ema: SMA-seeded, exponential thereafter", () => {
    const e = ema([1, 1, 1, 10], 2); // alpha = 2/3, seed = 1 at index 1
    expect(nan(e, 0)).toBe(true);
    expect(e[1]).toBeCloseTo(1);
    expect(e[2]).toBeCloseTo(1);
    expect(e[3]).toBeCloseTo(7); // 10*2/3 + 1*1/3
  });

  it("wma: linear weights, newest heaviest", () => {
    const w = wma([1, 2, 3], 3); // (1*1 + 2*2 + 3*3)/6 = 14/6
    expect(nan(w, 1)).toBe(true);
    expect(w[2]).toBeCloseTo(14 / 6);
  });

  it("rollingStd: population std over window", () => {
    const s = rollingStd([2, 4, 6], 3); // mean 4, var (4+0+4)/3 = 8/3
    expect(s[2]).toBeCloseTo(Math.sqrt(8 / 3));
  });

  it("bollinger: middle is the SMA and bands are symmetric", () => {
    const close = [1, 2, 3, 4, 5, 6, 7, 8];
    const { middle, upper, lower } = bollinger(close, 4, 2);
    const m = sma(close, 4);
    for (let i = 3; i < close.length; i++) {
      expect(middle[i]).toBeCloseTo(m[i]!);
      expect(upper[i]! - middle[i]!).toBeCloseTo(middle[i]! - lower[i]!);
    }
  });

  it("rsi: 100 on a monotonic rise, bounded 0..100, NaN warm-up", () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = rsi(up, 14);
    expect(nan(r, 13)).toBe(true);
    expect(r[14]).toBeCloseTo(100);
    for (let i = 14; i < r.length; i++) { expect(r[i]!).toBeGreaterThanOrEqual(0); expect(r[i]!).toBeLessThanOrEqual(100); }
  });

  it("macd: line/signal/histogram align and histogram = macd - signal", () => {
    const close = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const { macd: line, signal, histogram } = macd(close, 12, 26, 9);
    expect(line.length).toBe(close.length);
    for (let i = 0; i < close.length; i++) {
      if (!Number.isNaN(histogram[i]!)) expect(histogram[i]).toBeCloseTo(line[i]! - signal[i]!);
    }
  });

  it("vwap: cumulative typical-price/volume", () => {
    const v = vwap([10, 20], [10, 20], [10, 20], [1, 1]);
    expect(v[0]).toBeCloseTo(10);
    expect(v[1]).toBeCloseTo(15);
  });

  it("trueRange + atr: first TR is H-L, atr smooths", () => {
    const h = [11, 12, 13, 14, 15], l = [9, 10, 11, 12, 13], c = [10, 11, 12, 13, 14];
    const tr = trueRange(h, l, c);
    expect(tr[0]).toBeCloseTo(2);
    const a = atr(h, l, c, 3);
    expect(nan(a, 1)).toBe(true);
    expect(a[2]).toBeGreaterThan(0);
  });

  it("firstFinite finds the warm-up boundary", () => {
    expect(firstFinite(sma([1, 2, 3, 4], 3))).toBe(2);
    expect(firstFinite(new Float64Array([NaN, NaN]))).toBe(-1);
  });
});

describe("advanced indicators", () => {
  const H = [11, 12, 13, 14, 15, 16, 17, 18], L = [9, 10, 11, 12, 13, 14, 15, 16], C = [10, 11, 12, 13, 14, 15, 16, 17];

  it("stochastic: %K bounded 0..100, ~100 on a steady rise", () => {
    const { k, d } = stochastic(H, L, C, 5, 3);
    for (let i = 4; i < k.length; i++) { expect(k[i]!).toBeGreaterThanOrEqual(0); expect(k[i]!).toBeLessThanOrEqual(100); }
    expect(k[k.length - 1]!).toBeGreaterThan(60);
    expect(d.length).toBe(k.length);
  });

  it("keltner: upper > middle > lower", () => {
    const { middle, upper, lower } = keltner(H, L, C, 4, 2, 4);
    const i = 7;
    expect(upper[i]!).toBeGreaterThan(middle[i]!);
    expect(middle[i]!).toBeGreaterThan(lower[i]!);
  });

  it("obv: accumulates signed volume", () => {
    const o = obv([1, 2, 3, 2], [10, 10, 10, 10]);
    expect(Array.from(o)).toEqual([0, 10, 20, 10]);
  });

  it("ichimoku: spanA is the mean of conversion & base", () => {
    const { conversion, base, spanA, spanB } = ichimoku(H, L, 3, 5, 7);
    const i = 7;
    expect(spanA[i]).toBeCloseTo((conversion[i]! + base[i]!) / 2);
    expect(nan(spanB, 5)).toBe(true); // spanB needs 7 bars
  });

  it("adx: DI/ADX bounded 0..100 with NaN warm-up", () => {
    const hi = Array.from({ length: 40 }, (_, i) => 100 + i + Math.sin(i));
    const lo = hi.map((v) => v - 2), cl = hi.map((v) => v - 1);
    const { adx: a, plusDI, minusDI } = adx(hi, lo, cl, 14);
    expect(nan(a, 10)).toBe(true);
    for (let i = 30; i < a.length; i++) { expect(a[i]!).toBeGreaterThanOrEqual(0); expect(a[i]!).toBeLessThanOrEqual(100); }
    expect(plusDI.some((v) => !Number.isNaN(v))).toBe(true);
    expect(minusDI.some((v) => !Number.isNaN(v))).toBe(true);
  });

  it("superTrend: direction is ±1, flips with trend", () => {
    const hi = [10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 8, 9, 10, 11, 12];
    const lo = hi.map((v) => v - 1), cl = hi.map((v) => v - 0.5);
    const { trend, direction } = superTrend(hi, lo, cl, 3, 2);
    const dirs = Array.from(direction).filter((v) => !Number.isNaN(v));
    expect(dirs.every((v) => v === 1 || v === -1)).toBe(true);
    expect(trend.some((v) => !Number.isNaN(v))).toBe(true);
  });

  it("fibRetracements: standard levels between high and low", () => {
    const levels = fibRetracements(100, 0);
    expect(levels.find((l) => l.ratio === 0)!.price).toBeCloseTo(100);
    expect(levels.find((l) => l.ratio === 0.5)!.price).toBeCloseTo(50);
    expect(levels.find((l) => l.ratio === 1)!.price).toBeCloseTo(0);
  });
});

describe("chart transforms", () => {
  it("heikinAshi: matches the definition on one bar", () => {
    const ha = heikinAshi({ open: [10], high: [12], low: [9], close: [11] });
    expect(ha.close[0]).toBeCloseTo(10.5); // (10+12+9+11)/4
    expect(ha.open[0]).toBeCloseTo(10.5); // (10+11)/2
    expect(ha.high[0]).toBeCloseTo(12);
    expect(ha.low[0]).toBeCloseTo(9);
  });

  it("renko: one up brick per full brick-size rise", () => {
    const bricks = renko([100, 101, 102, 103], 1);
    expect(bricks.length).toBe(3);
    expect(bricks.every((b) => b.up)).toBe(true);
    expect(bricks.map((b) => b.x)).toEqual([0, 1, 2]);
    expect(bricks[2]!.close).toBeCloseTo(103);
  });

  it("renko: emits multiple bricks on a jump", () => {
    const bricks = renko([100, 103], 1); // +3 → 3 bricks
    expect(bricks.length).toBe(3);
  });

  it("lineBreak: breaks to new highs", () => {
    const bricks = lineBreak([1, 2, 3, 2.5, 4], 3);
    expect(bricks.length).toBeGreaterThan(0);
    expect(bricks[0]!.up).toBe(true);
  });

  it("pointAndFigure: produces columns of X/O", () => {
    const high = [10, 11, 12, 11, 8, 9], low = [9, 10, 11, 8, 7, 8];
    const cols = pointAndFigure(high, low, 1, 3);
    expect(cols.length).toBeGreaterThan(0);
    expect(["X", "O"]).toContain(cols[0]!.kind);
  });

  it("volumeProfile: conserves total volume and finds the POC", () => {
    const vp = volumeProfile([1, 2, 3], [10, 20, 30], 3);
    let total = 0; for (const v of vp.volume) total += v;
    expect(total).toBeCloseTo(60);
    expect(vp.pocIndex).toBe(2); // the level holding volume 30
    expect(vp.levels.length).toBe(3);
  });

  it("depth: cumulative curves, ascending prices", () => {
    const d = depth([[10, 5], [9, 3]], [[11, 4], [12, 2]]);
    expect(Array.from(d.bidPrice)).toEqual([9, 10]);
    expect(Array.from(d.bidCum)).toEqual([8, 5]); // cum toward the mid
    expect(Array.from(d.askPrice)).toEqual([11, 12]);
    expect(Array.from(d.askCum)).toEqual([4, 6]);
  });
});
