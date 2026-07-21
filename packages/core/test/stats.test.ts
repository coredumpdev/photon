import { describe, expect, it } from "vitest";
import { boxStats, fft, histogram, kde, quantileSorted, spectrogram } from "../src/stats/index.js";

describe("histogram", () => {
  it("bins values into equal-width buckets and counts all points", () => {
    const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { bins: 5, range: [0, 10] });
    expect(h.counts).toHaveLength(5);
    expect(Array.from(h.counts).reduce((a, b) => a + b, 0)).toBe(10);
    expect(Array.from(h.counts)).toEqual([2, 2, 2, 2, 2]);
  });
  it("includes the right edge in the last bin", () => {
    const h = histogram([10], { bins: 2, range: [0, 10] });
    expect(h.counts[1]).toBe(1);
  });
});

describe("quantileSorted", () => {
  it("interpolates like NumPy type-7", () => {
    const s = [1, 2, 3, 4];
    expect(quantileSorted(s, 0)).toBe(1);
    expect(quantileSorted(s, 0.5)).toBeCloseTo(2.5);
    expect(quantileSorted(s, 1)).toBe(4);
  });
});

describe("boxStats", () => {
  it("computes quartiles, whiskers, and flags outliers", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const s = boxStats(values);
    expect(s.median).toBeCloseTo(5.5);
    expect(s.q1).toBeLessThan(s.median);
    expect(s.q3).toBeGreaterThan(s.median);
    expect(s.outliers).toContain(100);
    expect(s.whiskerHi).toBeLessThan(100);
  });
});

describe("fft", () => {
  it("puts a pure tone's energy in the matching bin", () => {
    const N = 64, k = 5;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * k * i) / N);
    fft(re, im);
    const mag = Array.from({ length: N / 2 }, (_, b) => Math.hypot(re[b]!, im[b]!));
    const peak = mag.indexOf(Math.max(...mag));
    expect(peak).toBe(k);
  });
});

describe("spectrogram", () => {
  it("produces a time×frequency grid with the right shape", () => {
    const N = 2048;
    const sig = Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * 40 * i) / 256));
    const s = spectrogram(sig, { fftSize: 256, hop: 128, sampleRate: 256 });
    expect(s.rows).toBe(128);
    expect(s.values).toHaveLength(s.cols * s.rows);
    expect(s.extent.y[1]).toBe(128);
  });
});

describe("kde", () => {
  it("produces a positive, roughly-normalized density", () => {
    const values = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 2 + 5);
    const d = kde(values, 0, 10, 50);
    expect(d.xs).toHaveLength(50);
    expect(d.ys.every((y) => y >= 0)).toBe(true);
    // Rough trapezoidal integral should be near 1.
    let area = 0;
    for (let i = 1; i < d.xs.length; i++) {
      area += ((d.ys[i]! + d.ys[i - 1]!) / 2) * (d.xs[i]! - d.xs[i - 1]!);
    }
    expect(area).toBeGreaterThan(0.7);
    expect(area).toBeLessThan(1.3);
  });
});
