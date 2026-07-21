import { describe, expect, it } from "vitest";
import { computeJoin, decimateIndices } from "../src/layers/line-util.js";

describe("decimateIndices", () => {
  it("brackets the window with its endpoints", () => {
    const ys = Float64Array.from({ length: 100 }, (_, i) => Math.sin(i));
    const idx = decimateIndices(ys, 0, 99, 4);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(99);
  });

  it("keeps min and max of each column in index order", () => {
    // Two columns; craft a clear peak and trough in each.
    const ys = [0, 5, -3, 0, 0, 9, -7, 0]; // n=8
    const idx = decimateIndices(ys, 0, 7, 2);
    // Column 0 spans [0,4): min at 2 (-3), max at 1 (5) -> emitted 1,2 (index order)
    // Column 1 spans [4,8): min at 6 (-7), max at 5 (9) -> emitted 5,6
    expect(idx).toEqual([0, 1, 2, 5, 6, 7]);
  });

  it("emits at most 2*cols + 2 indices", () => {
    const ys = Float64Array.from({ length: 10000 }, (_, i) => i % 7);
    const idx = decimateIndices(ys, 0, 9999, 300);
    expect(idx.length).toBeLessThanOrEqual(2 * 300 + 2);
  });

  it("skips empty columns without error", () => {
    const ys = [1, 2, 3];
    const idx = decimateIndices(ys, 0, 2, 10); // more columns than samples
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(2);
  });
});

describe("computeJoin", () => {
  it("is degenerate for collinear points", () => {
    const j = computeJoin(0, 0, 1, 0, 2, 0, 5, true, 4);
    expect(j.ok).toBe(false);
  });

  it("is degenerate for a repeated point", () => {
    const j = computeJoin(1, 1, 1, 1, 2, 2, 5, true, 4);
    expect(j.ok).toBe(false);
  });

  it("places base corners a half-width from the joint", () => {
    // 90° turn: right then up, joint at origin.
    const hw = 4;
    const j = computeJoin(-1, 0, 0, 0, 0, 1, hw, true, 4);
    expect(j.ok).toBe(true);
    expect(Math.hypot(j.ax, j.ay)).toBeCloseTo(hw);
    expect(Math.hypot(j.bx, j.by)).toBeCloseTo(hw);
  });

  it("miter apex is farther from the joint than the bevel midpoint", () => {
    const hw = 4;
    const miterJoin = computeJoin(-1, 0, 0, 0, 0, 1, hw, true, 10);
    const bevelJoin = computeJoin(-1, 0, 0, 0, 0, 1, hw, false, 10);
    const miterDist = Math.hypot(miterJoin.apexX, miterJoin.apexY);
    const bevelDist = Math.hypot(bevelJoin.apexX, bevelJoin.apexY);
    // For a 90° turn the miter reaches hw*sqrt(2); the bevel chord midpoint is closer.
    expect(miterDist).toBeCloseTo(hw * Math.SQRT2);
    expect(miterDist).toBeGreaterThan(bevelDist);
  });

  it("falls back to the bevel apex past the miter limit", () => {
    // A very sharp spike: tiny miterLimit forces the bevel midpoint.
    const hw = 4;
    const sharp = computeJoin(-1, 0.02, 0, 0, -1, -0.02, hw, true, 1.05);
    const bevel = computeJoin(-1, 0.02, 0, 0, -1, -0.02, hw, false, 1.05);
    expect(sharp.apexX).toBeCloseTo(bevel.apexX);
    expect(sharp.apexY).toBeCloseTo(bevel.apexY);
  });

  it("fills the quadrant left uncovered by the two segment rectangles", () => {
    // Up (0,-1)->(0,0) then left (0,0)->(-1,0). The vertical and horizontal
    // butt rectangles both miss the upper-right quadrant — the wedge fills it.
    const j = computeJoin(0, -1, 0, 0, -1, 0, 4, true, 4);
    expect(j.ok).toBe(true);
    expect(j.apexX).toBeGreaterThan(0);
    expect(j.apexY).toBeGreaterThan(0);
  });
});
