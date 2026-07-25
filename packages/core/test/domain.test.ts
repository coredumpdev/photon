import { describe, expect, it } from "vitest";
import {
  aroon, cci, donchian, mfi, parabolicSar, pivotPoints, williamsR,
} from "../src/finance/indicators.js";
import { drawdown, resampleOhlc } from "../src/finance/transforms.js";
import {
  brierScore, classificationReport, liftCurve, logLoss, mae, mse, r2, rmse, rocCurveOvR,
} from "../src/ml/metrics.js";

/** 12 bars trending up then down, so every indicator sees both directions. */
const high = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9];
const low = [8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7];
const close = [9, 10.5, 11.5, 12.5, 13.5, 14.5, 13, 12, 11, 10, 9, 8];

describe("finance indicators", () => {
  it("cci warms up then reports a finite index", () => {
    const out = cci(high, low, close, 5);
    expect(Number.isNaN(out[3]!)).toBe(true);
    expect(Number.isFinite(out[4]!)).toBe(true);
    // Rising into bar 5, falling by bar 11.
    expect(out[5]!).toBeGreaterThan(0);
    expect(out[11]!).toBeLessThan(0);
  });

  it("williamsR stays in −100..0 and pins the extremes", () => {
    const out = williamsR(high, low, close, 5);
    for (let i = 4; i < out.length; i++) {
      expect(out[i]!).toBeLessThanOrEqual(0);
      expect(out[i]!).toBeGreaterThanOrEqual(-100);
    }
    // Bar 5 closes at the top of its 5-bar range.
    expect(out[5]!).toBeGreaterThan(-20);
  });

  it("mfi is bounded 0..100 and warms up over the period", () => {
    const volume = close.map((_, i) => 100 + i * 10);
    const out = mfi(high, low, close, volume, 4);
    expect(Number.isNaN(out[3]!)).toBe(true);
    for (let i = 4; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(0);
      expect(out[i]!).toBeLessThanOrEqual(100);
    }
  });

  it("aroon reports 100 the bar an extreme is set", () => {
    const a = aroon(high, low, 4);
    // Bar 5 is the highest high of the last 5 bars.
    expect(a.up[5]).toBe(100);
    // Bar 11 is the lowest low.
    expect(a.down[11]).toBe(100);
    expect(a.oscillator[11]).toBe(a.up[11]! - a.down[11]!);
  });

  it("donchian brackets the price and midlines it", () => {
    const ch = donchian(high, low, 4);
    for (let i = 3; i < high.length; i++) {
      expect(ch.upper[i]!).toBeGreaterThanOrEqual(high[i]!);
      expect(ch.lower[i]!).toBeLessThanOrEqual(low[i]!);
      expect(ch.middle[i]!).toBeCloseTo((ch.upper[i]! + ch.lower[i]!) / 2, 10);
    }
  });

  it("parabolicSar trails below a rise and flips above a fall", () => {
    const sar = parabolicSar(high, low);
    // While the trend is up the stop sits under the bar…
    expect(sar[4]!).toBeLessThan(low[4]!);
    // …and after the reversal it sits above it.
    expect(sar[11]!).toBeGreaterThan(high[11]!);
  });

  it("pivotPoints orders supports below the pivot and resistances above", () => {
    const p = pivotPoints(15, 10, 12);
    expect(p.pivot).toBeCloseTo((15 + 10 + 12) / 3, 10);
    expect(p.s3).toBeLessThan(p.s2);
    expect(p.s2).toBeLessThan(p.s1);
    expect(p.s1).toBeLessThan(p.pivot);
    expect(p.pivot).toBeLessThan(p.r1);
    expect(p.r1).toBeLessThan(p.r2);
    expect(p.r2).toBeLessThan(p.r3);
  });
});

describe("resampleOhlc", () => {
  it("rolls bars into buckets, keeping first open / last close / extremes", () => {
    const H = 3_600_000;
    const time = [0, H / 4, H / 2, H, H + H / 4];
    const out = resampleOhlc(
      time,
      { open: [1, 2, 3, 10, 11], high: [5, 2, 4, 12, 11], low: [1, 1, 2, 9, 10], close: [2, 3, 4, 11, 10] },
      H,
      [10, 20, 30, 40, 50],
    );
    expect(Array.from(out.time)).toEqual([0, H]);
    expect(Array.from(out.open)).toEqual([1, 10]);
    expect(Array.from(out.high)).toEqual([5, 12]);
    expect(Array.from(out.low)).toEqual([1, 9]);
    expect(Array.from(out.close)).toEqual([4, 10]);
    expect(Array.from(out.volume!)).toEqual([60, 90]);
  });

  it("aligns buckets to the epoch and skips empty ones", () => {
    const H = 1000;
    const out = resampleOhlc([1500, 1700, 9200], { open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3] }, H);
    expect(Array.from(out.time)).toEqual([1000, 9000]); // no empty buckets in between
  });

  it("returns empty arrays for a zero bucket", () => {
    const out = resampleOhlc([0], { open: [1], high: [1], low: [1], close: [1] }, 0);
    expect(out.time.length).toBe(0);
  });
});

describe("drawdown", () => {
  it("measures the worst peak-to-trough fall and where it happened", () => {
    const dd = drawdown([100, 120, 90, 60, 80, 130]);
    expect(dd.maxDrawdown).toBeCloseTo(-0.5, 10); // 120 → 60
    expect(dd.peakIndex).toBe(1);
    expect(dd.troughIndex).toBe(3);
    expect(Array.from(dd.peak)).toEqual([100, 120, 120, 120, 120, 130]);
    // A new high means zero drawdown.
    expect(dd.values[5]).toBeCloseTo(0, 10);
    expect(dd.values[0]).toBeCloseTo(0, 10);
  });

  it("is flat for a monotonically rising curve", () => {
    const dd = drawdown([1, 2, 3]);
    expect(dd.maxDrawdown).toBe(0);
    expect(dd.troughIndex).toBe(-1);
  });
});

describe("regression metrics", () => {
  const yTrue = [1, 2, 3, 4];
  const yPred = [1.5, 2.5, 2.5, 3.5];

  it("mse / rmse / mae agree on a known error set", () => {
    expect(mse(yTrue, yPred)).toBeCloseTo(0.25, 10);
    expect(rmse(yTrue, yPred)).toBeCloseTo(0.5, 10);
    expect(mae(yTrue, yPred)).toBeCloseTo(0.5, 10);
  });

  it("r2 is 1 for a perfect fit, 0 for predicting the mean, negative for worse", () => {
    expect(r2(yTrue, yTrue)).toBeCloseTo(1, 10);
    expect(r2(yTrue, [2.5, 2.5, 2.5, 2.5])).toBeCloseTo(0, 10);
    expect(r2(yTrue, [4, 3, 2, 1])).toBeLessThan(0);
  });

  it("returns NaN rather than 0 for empty input", () => {
    expect(Number.isNaN(mse([], []))).toBe(true);
    expect(Number.isNaN(r2([], []))).toBe(true);
  });
});

describe("probabilistic scores", () => {
  it("logLoss rewards confident correctness and stays finite when wrong", () => {
    expect(logLoss([0.9, 0.1], [1, 0])).toBeLessThan(logLoss([0.6, 0.4], [1, 0]));
    expect(Number.isFinite(logLoss([1, 0], [0, 1]))).toBe(true);
    expect(logLoss([1, 0], [1, 0])).toBeCloseTo(0, 10);
  });

  it("brierScore is the mean squared probability error", () => {
    expect(brierScore([1, 0], [1, 0])).toBeCloseTo(0, 10);
    expect(brierScore([0.5, 0.5], [1, 0])).toBeCloseTo(0.25, 10);
  });
});

describe("classificationReport", () => {
  it("computes per-class precision/recall/f1 and both averages", () => {
    // Class 0: 2 true, both found. Class 1: 2 true, 1 found, 1 called 0.
    const rep = classificationReport([0, 0, 1, 1], [0, 0, 1, 0]);
    expect(rep.accuracy).toBeCloseTo(0.75, 10);
    const c0 = rep.perClass[0]!;
    const c1 = rep.perClass[1]!;
    expect(c0.recall).toBeCloseTo(1, 10);
    expect(c0.precision).toBeCloseTo(2 / 3, 10);
    expect(c1.recall).toBeCloseTo(0.5, 10);
    expect(c1.precision).toBeCloseTo(1, 10);
    expect(c1.f1).toBeCloseTo((2 * 1 * 0.5) / 1.5, 10);
    expect(rep.macro.recall).toBeCloseTo(0.75, 10);
    expect(rep.weighted.recall).toBeCloseTo(0.75, 10);
    expect(rep.perClass.map((c) => c.support)).toEqual([2, 2]);
  });

  it("scores a never-predicted class as 0 rather than NaN", () => {
    const rep = classificationReport([0, 1, 2], [0, 1, 1], 3);
    expect(rep.perClass[2]!.precision).toBe(0);
    expect(rep.perClass[2]!.recall).toBe(0);
    expect(rep.perClass[2]!.f1).toBe(0);
    expect(Number.isFinite(rep.macro.f1)).toBe(true);
  });
});

describe("ranking curves", () => {
  it("liftCurve rises to full gain and beats random early", () => {
    // The two positives hold the top scores, so half the list captures them all.
    const c = liftCurve([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]);
    expect(c.positives).toBe(2);
    expect(c.gain[c.gain.length - 1]).toBeCloseTo(1, 10);
    expect(c.gain[2]).toBeCloseTo(1, 10);      // top 50% → 100% of positives
    expect(c.lift[2]).toBeCloseTo(2, 10);      // twice as good as random
    expect(c.fraction[0]).toBe(0);
  });

  it("rocCurveOvR gives a perfect macro AUC on separable classes", () => {
    // Three samples, three classes, each scored highest for its own class.
    const scores = [
      0.8, 0.1, 0.1,
      0.1, 0.8, 0.1,
      0.1, 0.1, 0.8,
    ];
    const roc = rocCurveOvR(scores, [0, 1, 2], 3);
    expect(roc.perClass).toHaveLength(3);
    expect(roc.macroAuc).toBeCloseTo(1, 10);
    expect(roc.microAuc).toBeCloseTo(1, 10);
  });
});
