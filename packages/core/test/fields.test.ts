import { describe, expect, it } from "vitest";
import { isobands, streamlines, type ScalarField, type VectorField } from "../src/charts/fields.js";
import { hist2d } from "../src/stats/index.js";

/** A plane z = x over [0,1]x[0,1], sampled on an n x n lattice. */
function ramp(n: number): ScalarField {
  const values = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) values[r * n + c] = c / (n - 1);
  }
  return { values, cols: n, rows: n, extent: { x: [0, 1], y: [0, 1] } };
}

/** Shoelace area of a polygon ring. */
function area(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, n = x.length; i < n; i++) {
    const j = (i + 1) % n;
    a += x[i]! * y[j]! - x[j]! * y[i]!;
  }
  return Math.abs(a) / 2;
}

describe("hist2d", () => {
  it("bins every in-range point exactly once", () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const y = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
    const h = hist2d(x, y, { bins: [2, 2], range: { x: [0, 10], y: [0, 2] } });
    expect(h.cols).toBe(2);
    expect(h.rows).toBe(2);
    expect(Array.from(h.values).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("puts a point in the cell its coordinates name", () => {
    // One point at (0.25, 0.75) on a 2x2 grid over the unit square: left column,
    // top row -> row 1, col 0 in row-major order with row 0 at the bottom.
    const h = hist2d([0.25], [0.75], { bins: 2, range: { x: [0, 1], y: [0, 1] } });
    expect(Array.from(h.values)).toEqual([0, 0, 1, 0]);
  });

  it("clamps the far edge into the last bin rather than dropping it", () => {
    const h = hist2d([1], [1], { bins: 2, range: { x: [0, 1], y: [0, 1] } });
    expect(h.values[3]).toBe(1);
  });

  it("reports edges that span the requested range", () => {
    const h = hist2d([0, 1], [0, 1], { bins: 4, range: { x: [0, 1], y: [0, 1] } });
    expect(h.xEdges).toHaveLength(5);
    expect(h.xEdges[0]).toBe(0);
    expect(h.xEdges[4]).toBeCloseTo(1);
  });
});

describe("isobands", () => {
  it("tiles the field: the band areas sum to the full extent", () => {
    const bands = isobands(ramp(9), [0, 0.25, 0.5, 0.75, 1]);
    const total = bands.reduce((a, b) => a + area(b.x, b.y), 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("splits a linear ramp into bands of the width the levels ask for", () => {
    // z = x, so the band [0.25, 0.5] must cover exactly the strip 0.25 <= x <= 0.5.
    const bands = isobands(ramp(17), [0, 0.25, 0.5, 0.75, 1]);
    const strip = bands.filter((b) => b.lo === 0.25);
    expect(strip.length).toBeGreaterThan(0);
    const a = strip.reduce((acc, b) => acc + area(b.x, b.y), 0);
    expect(a).toBeCloseTo(0.25, 4);
    for (const b of strip) {
      for (let i = 0; i < b.x.length; i++) {
        expect(b.x[i]!).toBeGreaterThanOrEqual(0.25 - 1e-9);
        expect(b.x[i]!).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  it("emits only closed rings of three or more vertices", () => {
    for (const b of isobands(ramp(11), 6)) expect(b.x.length).toBeGreaterThanOrEqual(3);
  });

  it("derives evenly spaced levels from a count", () => {
    const bands = isobands(ramp(9), 4);
    const los = [...new Set(bands.map((b) => Math.round(b.lo * 1000) / 1000))].sort((a, b) => a - b);
    expect(los).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("returns nothing for a degenerate grid", () => {
    expect(isobands({ values: [1], cols: 1, rows: 1, extent: { x: [0, 1], y: [0, 1] } }, 4)).toEqual([]);
  });
});

describe("streamlines", () => {
  /** Rigid rotation: u = -y, v = x. Every streamline is a circle about the origin. */
  function vortex(n: number): VectorField {
    const u = new Float64Array(n * n);
    const v = new Float64Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = -1 + (2 * c) / (n - 1);
        const y = -1 + (2 * r) / (n - 1);
        u[r * n + c] = -y;
        v[r * n + c] = x;
      }
    }
    return { u, v, cols: n, rows: n, extent: { x: [-1, 1], y: [-1, 1] } };
  }

  it("traces lines that stay inside the field", () => {
    const lines = streamlines(vortex(21), { density: 0.4 });
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      for (let i = 0; i < l.x.length; i++) {
        expect(l.x[i]!).toBeGreaterThanOrEqual(-1.001);
        expect(l.x[i]!).toBeLessThanOrEqual(1.001);
        expect(l.y[i]!).toBeGreaterThanOrEqual(-1.001);
        expect(l.y[i]!).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it("follows the field: a rigid vortex keeps each line at a constant radius", () => {
    const lines = streamlines(vortex(41), { density: 0.5, step: 0.25 });
    // Pick a line that got well away from the singular centre.
    const line = lines.map((l) => ({ l, r: Math.hypot(l.x[0]!, l.y[0]!) }))
      .filter((e) => e.r > 0.3 && e.l.x.length > 20)
      .sort((a, b) => b.l.x.length - a.l.x.length)[0];
    expect(line).toBeDefined();
    const radii = Array.from(line!.l.x, (x, i) => Math.hypot(x, line!.l.y[i]!));
    const drift = Math.max(...radii) - Math.min(...radii);
    expect(drift).toBeLessThan(0.12);
  });

  it("spaces lines out instead of stacking them on one attractor", () => {
    const sparse = streamlines(vortex(21), { density: 0.4 }).length;
    const dense = streamlines(vortex(21), { density: 1.2 }).length;
    expect(dense).toBeGreaterThan(sparse);
  });

  it("gives up on a field with no motion", () => {
    const n = 9;
    const zero: VectorField = {
      u: new Float64Array(n * n), v: new Float64Array(n * n),
      cols: n, rows: n, extent: { x: [0, 1], y: [0, 1] },
    };
    expect(streamlines(zero)).toEqual([]);
  });
});
