import { describe, expect, it } from "vitest";
import { forceLayout } from "../src/graph/force.js";

/** Euclidean distance between nodes i and j. */
function dist(p: { x: Float64Array; y: Float64Array }, i: number, j: number): number {
  return Math.hypot(p.x[i]! - p.x[j]!, p.y[i]! - p.y[j]!);
}

describe("forceLayout", () => {
  it("is deterministic (no RNG) — same input, same output", () => {
    const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
    const a = forceLayout(3, edges);
    const b = forceLayout(3, edges);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
  });

  it("lays a triangle out with near-equal edge lengths", () => {
    const p = forceLayout(3, [[0, 1], [1, 2], [2, 0]]);
    const d01 = dist(p, 0, 1), d12 = dist(p, 1, 2), d20 = dist(p, 2, 0);
    const max = Math.max(d01, d12, d20), min = Math.min(d01, d12, d20);
    expect(max / min).toBeLessThan(1.2); // roughly equilateral
  });

  it("keeps all coordinates finite and separates connected nodes", () => {
    const p = forceLayout(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    expect(p.x.every((v) => Number.isFinite(v))).toBe(true);
    expect(p.y.every((v) => Number.isFinite(v))).toBe(true);
    expect(dist(p, 0, 1)).toBeGreaterThan(1e-3); // not collapsed onto each other
  });

  it("handles trivial sizes", () => {
    expect(forceLayout(0, []).x).toHaveLength(0);
    const one = forceLayout(1, []);
    expect(one.x).toHaveLength(1);
    expect(Number.isFinite(one.x[0]!)).toBe(true);
  });
});
