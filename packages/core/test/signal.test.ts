import { describe, expect, it } from "vitest";
import { crossCorrelate, savitzkyGolay, welch, windowFunction } from "../src/stats/signal.js";
import {
  corrMatrix, correlation, ecdf, linearRegression, linearTrend, loess, zscore,
} from "../src/stats/regression.js";

describe("window functions", () => {
  it("taper to zero at the edges (except rectangular)", () => {
    for (const name of ["hann", "blackman", "bartlett"] as const) {
      const w = windowFunction(name, 32);
      expect(w[0]).toBeCloseTo(0, 6);
      expect(w[31]).toBeCloseTo(0, 6);
      expect(w[16]).toBeGreaterThan(0.9);
    }
    expect(Array.from(windowFunction("rectangular", 4))).toEqual([1, 1, 1, 1]);
    // Hamming is the exception — it stops short of zero.
    expect(windowFunction("hamming", 32)[0]).toBeCloseTo(0.08, 6);
  });

  it("handles the degenerate lengths", () => {
    expect(windowFunction("hann", 0).length).toBe(0);
    expect(Array.from(windowFunction("hann", 1))).toEqual([1]);
  });
});

describe("welch", () => {
  it("puts the peak at the tone's frequency", () => {
    const sr = 256;
    const n = 2048;
    const freq = 32;
    const signal = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / sr));
    const psd = welch(signal, { sampleRate: sr, segment: 256 });
    let peak = 0;
    for (let i = 1; i < psd.power.length; i++) if (psd.power[i]! > psd.power[peak]!) peak = i;
    expect(psd.frequencies[peak]).toBeCloseTo(freq, 0);
    expect(psd.frequencies[0]).toBe(0);
    // One-sided: bins span DC..Nyquist.
    expect(psd.frequencies[psd.frequencies.length - 1]).toBeLessThan(sr / 2);
  });

  it("returns an empty estimate when the signal is shorter than a segment", () => {
    const psd = welch(new Float64Array(1), { segment: 256 });
    expect(psd.power.length).toBe(0);
  });
});

describe("savitzkyGolay", () => {
  it("reproduces a polynomial of the fitted order exactly", () => {
    // A quadratic filter must leave a quadratic untouched.
    const x = Float64Array.from({ length: 40 }, (_, i) => i * i * 0.5 - 3 * i + 7);
    const out = savitzkyGolay(x, 9, 2);
    for (let i = 4; i < 36; i++) expect(out[i]).toBeCloseTo(x[i]!, 6);
  });

  it("keeps a peak taller than a moving average would", () => {
    const n = 61;
    const clean = Float64Array.from({ length: n }, (_, i) => Math.exp(-((i - 30) ** 2) / 20));
    const sg = savitzkyGolay(clean, 11, 2);
    let movingAvg = 0;
    for (let k = 25; k <= 35; k++) movingAvg += clean[k]!;
    movingAvg /= 11;
    // A quadratic fit over a Gaussian still clips the very tip a little, but far
    // less than a boxcar of the same width does.
    expect(sg[30]).toBeGreaterThan(movingAvg);
    expect(sg[30]).toBeGreaterThan(0.93 * clean[30]!);
    expect(movingAvg).toBeLessThan(0.85 * clean[30]!);
  });

  it("passes short inputs through unchanged", () => {
    expect(Array.from(savitzkyGolay([1, 2], 9, 2))).toEqual([1, 2]);
    expect(savitzkyGolay([], 9, 2).length).toBe(0);
  });
});

describe("crossCorrelate", () => {
  it("finds the lag between a signal and its shifted copy", () => {
    const n = 128;
    const a = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 5));
    const shift = 7;
    const b = Float64Array.from({ length: n }, (_, i) => Math.sin((i - shift) / 5));
    const { lags, values } = crossCorrelate(a, b, 20);
    let best = 0;
    for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
    // b is a delayed by `shift`, and the peak lag reads as "b lags a by k".
    expect(lags[best]).toBe(shift);
    expect(values[best]).toBeGreaterThan(0.9);
  });

  it("autocorrelation peaks at lag 0 with value 1", () => {
    const a = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i / 3) + i * 0.01);
    const { lags, values } = crossCorrelate(a, a, 10);
    const zero = lags.indexOf(0);
    expect(values[zero]).toBeCloseTo(1, 6);
    for (let i = 0; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[zero]! + 1e-9);
  });
});

describe("linearRegression", () => {
  it("recovers slope and intercept exactly on a clean line", () => {
    const x = Float64Array.from({ length: 20 }, (_, i) => i);
    const y = Float64Array.from(x, (v) => 3 * v - 4);
    const fit = linearRegression(x, y);
    expect(fit.slope).toBeCloseTo(3, 10);
    expect(fit.intercept).toBeCloseTo(-4, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.stderr).toBeCloseTo(0, 10);
    expect(fit.predict(100)).toBeCloseTo(296, 8);
  });

  it("skips non-finite pairs and survives degenerate input", () => {
    const fit = linearRegression([0, 1, NaN, 2], [0, 2, 5, 4]);
    expect(fit.n).toBe(3);
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(linearRegression([], []).n).toBe(0);
    // A vertical cloud has no slope to find.
    expect(linearRegression([1, 1, 1], [0, 5, 9]).slope).toBe(0);
  });

  it("linearTrend samples the fit and can add a band", () => {
    const x = Float64Array.from({ length: 30 }, (_, i) => i);
    const y = Float64Array.from(x, (v) => 2 * v + (v % 2 ? 1 : -1));
    const trend = linearTrend(x, y, { band: 2 });
    expect(trend.x[0]).toBe(0);
    expect(trend.x[trend.x.length - 1]).toBe(29);
    expect(trend.lower![0]).toBeLessThan(trend.y[0]!);
    expect(trend.upper![0]).toBeGreaterThan(trend.y[0]!);
    // Without a band the arrays are absent, not zero-filled.
    expect(linearTrend(x, y).lower).toBeUndefined();
  });
});

describe("loess", () => {
  it("tracks a curve a straight line would miss", () => {
    const n = 120;
    const x = Float64Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2 - 1);
    const y = Float64Array.from(x, (v) => v * v);
    const fitted = loess(x, y, { bandwidth: 0.3, points: 21 });
    for (let i = 0; i < fitted.x.length; i++) {
      expect(fitted.y[i]).toBeCloseTo(fitted.x[i]! * fitted.x[i]!, 1);
    }
    // The OLS line through a symmetric parabola is flat, so it cannot.
    expect(Math.abs(linearRegression(x, y).slope)).toBeLessThan(1e-9);
  });

  it("returns an empty grid for empty input", () => {
    const out = loess([], []);
    expect(out.y.every((v) => v === 0)).toBe(true);
  });
});

describe("summaries", () => {
  it("ecdf steps from 1/n to 1 over the sorted values", () => {
    const { x, y } = ecdf([3, 1, 2, 1]);
    expect(Array.from(x)).toEqual([1, 1, 2, 3]);
    expect(Array.from(y)).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("zscore centres and scales, passing NaN through", () => {
    const z = zscore([1, 2, 3, 4, 5]);
    let mean = 0;
    for (const v of z) mean += v;
    expect(mean / z.length).toBeCloseTo(0, 10);
    expect(z[4]! - z[0]!).toBeCloseTo(2.828427, 5); // ±√2 sd apart
    expect(Number.isNaN(zscore([1, NaN, 3])[1]!)).toBe(true);
  });

  it("correlation is ±1 for exact relationships and 0 for a constant", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(correlation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBe(0);
  });

  it("corrMatrix is symmetric with a unit diagonal", () => {
    const a = [1, 2, 3, 4];
    const b = [2, 4, 6, 8];
    const c = [4, 3, 2, 1];
    const { values, size } = corrMatrix([a, b, c]);
    expect(size).toBe(3);
    for (let i = 0; i < 3; i++) expect(values[i * 3 + i]).toBeCloseTo(1, 10);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(values[i * 3 + j]).toBeCloseTo(values[j * 3 + i]!, 12);
    }
    expect(values[1]).toBeCloseTo(1, 10);   // a vs b
    expect(values[2]).toBeCloseTo(-1, 10);  // a vs c
  });
});
