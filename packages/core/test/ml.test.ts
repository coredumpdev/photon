import { describe, expect, it } from "vitest";
import {
  calibrationCurve, confusionMatrix, emaSmooth, prCurve, rocCurve,
} from "../src/ml/metrics.js";
import { pca, standardize } from "../src/ml/reduce.js";
import { beeswarmLayout } from "../src/ml/charts.js";

describe("classification metrics", () => {
  it("confusionMatrix: counts, support, and row-normalization", () => {
    const cm = confusionMatrix([0, 0, 1, 1, 2], [0, 1, 1, 1, 2], 3);
    expect(cm.classes).toBe(3);
    expect(Array.from(cm.counts)).toEqual([1, 1, 0, 0, 2, 0, 0, 0, 1]);
    expect(Array.from(cm.support)).toEqual([2, 2, 1]);
    expect(Array.from(cm.normalized)).toEqual([0.5, 0.5, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("confusionMatrix: infers class count from labels", () => {
    expect(confusionMatrix([0, 3], [0, 3]).classes).toBe(4);
  });

  it("rocCurve: perfect separation → AUC 1, curve anchored at (0,0) and (1,1)", () => {
    const roc = rocCurve([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]);
    expect(roc.auc).toBeCloseTo(1, 10);
    expect(roc.fpr[0]).toBe(0);
    expect(roc.tpr[0]).toBe(0);
    expect(roc.fpr[roc.fpr.length - 1]).toBeCloseTo(1, 10);
    expect(roc.tpr[roc.tpr.length - 1]).toBeCloseTo(1, 10);
  });

  it("rocCurve: matches a hand-computed AUC (0.75)", () => {
    expect(rocCurve([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]).auc).toBeCloseTo(0.75, 10);
  });

  it("rocCurve: all-equal scores → chance (0.5); absent class → NaN", () => {
    expect(rocCurve([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0]).auc).toBeCloseTo(0.5, 10);
    expect(Number.isNaN(rocCurve([0.9, 0.1], [1, 1]).auc)).toBe(true);
  });

  it("prCurve: average precision + baseline", () => {
    const pr = prCurve([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]);
    expect(pr.ap).toBeCloseTo(0.8333333, 5);
    expect(pr.baseline).toBeCloseTo(0.5, 10);
    expect(pr.recall[0]).toBe(0);
    expect(pr.precision[0]).toBe(1);
  });

  it("calibrationCurve: per-bin means + ECE", () => {
    const cal = calibrationCurve([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1], 2);
    expect(cal.meanPredicted[0]).toBeCloseTo(0.15, 10);
    expect(cal.fractionPositive[0]).toBeCloseTo(0, 10);
    expect(cal.meanPredicted[1]).toBeCloseTo(0.85, 10);
    expect(cal.fractionPositive[1]).toBeCloseTo(1, 10);
    expect(cal.ece).toBeCloseTo(0.15, 10);
  });

  it("calibrationCurve: empty bins are NaN", () => {
    const cal = calibrationCurve([0.05, 0.06], [0, 1], 4);
    expect(Number.isNaN(cal.meanPredicted[3]!)).toBe(true);
  });
});

describe("emaSmooth", () => {
  it("debiases so the first sample is exact and a constant stays constant", () => {
    const s = emaSmooth([5, 5, 5, 5], 0.9);
    for (const v of s) expect(v).toBeCloseTo(5, 10);
    expect(emaSmooth([3, 100, 7], 0.6)[0]).toBeCloseTo(3, 10);
  });

  it("passes non-finite values through without advancing the average", () => {
    const s = emaSmooth([2, NaN, 2], 0.5);
    expect(Number.isNaN(s[1]!)).toBe(true);
    expect(s[2]).toBeCloseTo(2, 10);
  });
});

describe("pca", () => {
  it("recovers the dominant axis and explained variance", () => {
    const data = [-3, 0, -1, 0, 1, 0, 3, 0]; // 4×2, variance only in dim 0
    const r = pca(data, 4, 2, 1);
    expect(Math.abs(r.components[0]!)).toBeGreaterThan(0.999);
    expect(Math.abs(r.components[1]!)).toBeLessThan(0.01);
    expect(r.explained[0]).toBeCloseTo(1, 6);
    // Scores are the centered x-coordinates up to a sign flip.
    const mag = Array.from(r.scores, Math.abs);
    expect(mag).toEqual([3, 1, 1, 3].map((v) => expect.closeTo(v, 6)));
  });

  it("is deterministic across runs", () => {
    const data = [1, 2, 2, 1, 3, 5, 4, 3, 5, 8];
    const a = pca(data, 5, 2, 2), b = pca(data, 5, 2, 2);
    expect(Array.from(a.scores)).toEqual(Array.from(b.scores));
  });
});

describe("standardize", () => {
  it("centers each column to zero mean and unit (sample) variance", () => {
    const z = standardize([1, 2, 3], 3, 1);
    expect(Array.from(z)).toEqual([-1, 0, 1].map((v) => expect.closeTo(v, 10)));
  });
});

describe("beeswarmLayout", () => {
  it("returns one bounded, centered offset per point", () => {
    const x = Array.from({ length: 50 }, (_, i) => Math.sin(i));
    const y = beeswarmLayout(x, { spread: 0.8 });
    expect(y).toHaveLength(50);
    for (const v of y) expect(Math.abs(v)).toBeLessThanOrEqual(0.4 + 1e-9);
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    expect(Math.abs(mean)).toBeLessThan(0.2);
  });

  it("handles the empty and identical-value cases", () => {
    expect(beeswarmLayout([])).toEqual([]);
    const y = beeswarmLayout([2, 2, 2, 2]);
    expect(y).toHaveLength(4);
    expect(y.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  });
});
