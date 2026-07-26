import { describe, expect, it } from "vitest";
import { pickNearest, type PickMode, type PickProjection } from "../src/layers/pick.js";

/**
 * The binary-search path is only worth having if it never disagrees with the
 * scan it replaces. Most of this file is that comparison, run over enough shapes
 * that a wrong bound would have to show up somewhere.
 */

function rng(seed = 7): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear data->pixel mapping over [x0,x1] -> [0,W], y inverted as a plot does. */
function linear(x0: number, x1: number, W: number, y0: number, y1: number, H: number): PickProjection {
  return {
    x: (v) => ((v - x0) / (x1 - x0)) * W,
    y: (v) => H - ((v - y0) / (y1 - y0)) * H,
  };
}

/** The reference: the exhaustive scan, written independently of the module. */
function brute(
  xs: ArrayLike<number>, ys: ArrayLike<number>, mode: PickMode,
  cx: number, cy: number, p: PickProjection,
): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const dx = p.x(xs[i]!) - cx, dy = p.y(ys[i]!) - cy;
    const d = mode === "x" ? Math.abs(dx) : mode === "y" ? Math.abs(dy) : Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Both paths must land on the same point, or at least an equally distant one. */
function agrees(
  xs: ArrayLike<number>, ys: ArrayLike<number>, mode: PickMode,
  cx: number, cy: number, p: PickProjection,
): boolean {
  const fast = pickNearest(xs, ys, xs.length, mode, cx, cy, p, Infinity, true);
  const ref = brute(xs, ys, mode, cx, cy, p);
  if (!fast) return ref < 0;
  if (fast.index === ref) return true;
  // A tie is fine as long as the distance matches.
  const dist = (i: number): number => {
    const dx = p.x(xs[i]!) - cx, dy = p.y(ys[i]!) - cy;
    return mode === "x" ? Math.abs(dx) : mode === "y" ? Math.abs(dy) : Math.hypot(dx, dy);
  };
  return Math.abs(dist(fast.index) - dist(ref)) < 1e-9;
}

describe("pickNearest", () => {
  it("returns nothing for an empty series", () => {
    expect(pickNearest([], [], 0, "x", 0, 0, linear(0, 1, 100, 0, 1, 100))).toBeNull();
  });

  it("finds the nearest point by x", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [0, 0, 0, 0, 0];
    const p = linear(0, 4, 400, -1, 1, 200);
    // Cursor at pixel 210 sits just past x=2 (pixel 200).
    expect(pickNearest(xs, ys, 5, "x", 210, 0, p)!.index).toBe(2);
    expect(pickNearest(xs, ys, 5, "x", 290, 0, p)!.index).toBe(3);
  });

  it("honours the hit gate", () => {
    const p = linear(0, 4, 400, -1, 1, 200);
    expect(pickNearest([0, 1], [0, 0], 2, "x", 380, 0, p, 8)).toBeNull();
    expect(pickNearest([0, 1], [0, 0], 2, "x", 104, 0, p, 8)!.index).toBe(1);
  });

  it("ranks by 2D distance in xy mode, not by x alone", () => {
    // Two candidates: one closer in x, one much closer overall.
    const xs = [0, 1];
    const ys = [10, 0];
    const p = linear(0, 1, 100, 0, 10, 100);
    const near = pickNearest(xs, ys, 2, "xy", 10, 100, p)!;
    expect(near.index).toBe(1);
    expect(pickNearest(xs, ys, 2, "x", 10, 100, p)!.index).toBe(0);
  });

  // --- the binary path must match the scan, everywhere ------------------------

  const CASES: Array<[string, number]> = [["just over the threshold", 64], ["mid", 500], ["large", 5000]];

  for (const [label, n] of CASES) {
    for (const mode of ["x", "xy"] as PickMode[]) {
      it(`agrees with the exhaustive scan (${label}, ${n} pts, mode "${mode}")`, () => {
        const next = rng(n + mode.length);
        const xs = new Float64Array(n);
        const ys = new Float64Array(n);
        // Non-uniform spacing, so a "nearest index" shortcut cannot fake it.
        let acc = 0;
        for (let i = 0; i < n; i++) {
          acc += next() * 3 + 0.01;
          xs[i] = acc;
          ys[i] = Math.sin(i / 9) * 5 + next();
        }
        const p = linear(xs[0]!, xs[n - 1]!, 900, -6, 6, 500);
        for (let k = 0; k < 200; k++) {
          const cx = -50 + next() * 1000;
          const cy = -50 + next() * 600;
          expect(agrees(xs, ys, mode, cx, cy, p)).toBe(true);
        }
      });
    }
  }

  it("agrees when the projection runs the other way (reversed domain)", () => {
    const n = 300;
    const xs = Float64Array.from({ length: n }, (_, i) => i);
    const ys = Float64Array.from({ length: n }, (_, i) => Math.cos(i / 7));
    // x1 < x0: pixels decrease as data increases.
    const p = linear(n - 1, 0, 800, -1, 1, 400);
    const next = rng(3);
    for (let k = 0; k < 200; k++) {
      const cx = next() * 800, cy = next() * 400;
      expect(agrees(xs, ys, "x", cx, cy, p)).toBe(true);
      expect(agrees(xs, ys, "xy", cx, cy, p)).toBe(true);
    }
  });

  it("agrees under a non-linear but monotonic projection (log-like)", () => {
    const n = 400;
    const xs = Float64Array.from({ length: n }, (_, i) => 1 + i * 25);
    const ys = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 11));
    const lo = Math.log10(xs[0]!), hi = Math.log10(xs[n - 1]!);
    const p: PickProjection = {
      x: (v) => ((Math.log10(v) - lo) / (hi - lo)) * 900,
      y: (v) => 250 - v * 100,
    };
    const next = rng(11);
    for (let k = 0; k < 200; k++) {
      expect(agrees(xs, ys, "x", next() * 900, next() * 500, p)).toBe(true);
      expect(agrees(xs, ys, "xy", next() * 900, next() * 500, p)).toBe(true);
    }
  });

  it("agrees when many points share an x", () => {
    // A step series or a categorical scatter: long runs of equal x.
    const xs: number[] = [], ys: number[] = [];
    for (let g = 0; g < 40; g++) {
      for (let k = 0; k < 10; k++) { xs.push(g); ys.push(Math.sin(g + k)); }
    }
    const p = linear(0, 39, 800, -1, 1, 400);
    const next = rng(23);
    for (let k = 0; k < 200; k++) {
      expect(agrees(xs, ys, "x", next() * 800, next() * 400, p)).toBe(true);
      expect(agrees(xs, ys, "xy", next() * 800, next() * 400, p)).toBe(true);
    }
  });

  it("agrees when every point is identical", () => {
    const xs = new Float64Array(200).fill(5);
    const ys = new Float64Array(200).fill(2);
    const p = linear(0, 10, 500, 0, 4, 300);
    expect(agrees(xs, ys, "x", 100, 100, p)).toBe(true);
    expect(agrees(xs, ys, "xy", 400, 20, p)).toBe(true);
  });

  it("still scans when the data is not sorted, even if told it is not", () => {
    const next = rng(5);
    const n = 300;
    const xs = Float64Array.from({ length: n }, () => next() * 100);
    const ys = Float64Array.from({ length: n }, () => next() * 100);
    const p = linear(0, 100, 600, 0, 100, 400);
    for (let k = 0; k < 100; k++) {
      const cx = next() * 600, cy = next() * 400;
      const got = pickNearest(xs, ys, n, "xy", cx, cy, p, Infinity, false);
      expect(got!.index).toBe(brute(xs, ys, "xy", cx, cy, p));
    }
  });

  it("keeps y mode on the scan, where an x bound would be wrong", () => {
    // The nearest point in y is far away in x, so a bounded walk would miss it.
    const n = 200;
    const xs = Float64Array.from({ length: n }, (_, i) => i);
    const ys = Float64Array.from({ length: n }, (_, i) => (i === n - 1 ? 0 : 100 + i));
    const p = linear(0, n - 1, 900, 0, 300, 500);
    const got = pickNearest(xs, ys, n, "y", 0, p.y(0), p, Infinity, true)!;
    expect(got.index).toBe(n - 1);
  });

  it("matches the scan just below and just above the binary-search threshold", () => {
    for (const n of [63, 64, 65]) {
      const xs = Float64Array.from({ length: n }, (_, i) => i * 1.7);
      const ys = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
      const p = linear(0, n * 1.7, 700, -1, 1, 300);
      const next = rng(n);
      for (let k = 0; k < 100; k++) {
        expect(agrees(xs, ys, "x", next() * 700, next() * 300, p)).toBe(true);
        expect(agrees(xs, ys, "xy", next() * 700, next() * 300, p)).toBe(true);
      }
    }
  });
});
