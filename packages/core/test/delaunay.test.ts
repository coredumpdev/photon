import { describe, expect, it } from "vitest";
import { delaunay, triangleEdges } from "../src/geo/delaunay.js";

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scatter(n: number, seed = 1): { x: Float64Array; y: Float64Array } {
  const next = rng(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = next() * 100 - 50; y[i] = next() * 100 - 50; }
  return { x, y };
}

/** Twice the signed area — positive for counter-clockwise winding. */
function area2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** The in-circle determinant, used here as the oracle the triangulation must satisfy. */
function inCircle(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  const adx = ax - dx, ady = ay - dy;
  const bdx = bx - dx, bdy = by - dy;
  const cdx = cx - dx, cdy = cy - dy;
  return (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy)
    + (bdx * bdx + bdy * bdy) * (cdx * ady - adx * cdy)
    + (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
}

describe("delaunay", () => {
  it("returns nothing when there is no triangle to make", () => {
    expect(delaunay([], []).triangles).toHaveLength(0);
    expect(delaunay([0, 1], [0, 1]).triangles).toHaveLength(0);
    // Non-finite input is refused rather than producing garbage geometry.
    expect(delaunay([0, 1, NaN], [0, 1, 2]).triangles).toHaveLength(0);
  });

  it("triangulates a single triangle", () => {
    const { triangles } = delaunay([0, 1, 0], [0, 0, 1]);
    expect(triangles).toHaveLength(3);
    expect([...triangles].sort()).toEqual([0, 1, 2]);
  });

  it("covers a square with two triangles", () => {
    const { triangles } = delaunay([0, 1, 1, 0], [0, 0, 1, 1]);
    expect(triangles).toHaveLength(6);
  });

  it("winds every triangle counter-clockwise", () => {
    const { x, y } = scatter(200, 7);
    const { triangles } = delaunay(x, y);
    expect(triangles.length).toBeGreaterThan(0);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]!, b = triangles[t + 1]!, c = triangles[t + 2]!;
      expect(area2(x[a]!, y[a]!, x[b]!, y[b]!, x[c]!, y[c]!)).toBeGreaterThan(0);
    }
  });

  it("satisfies the Delaunay condition: no vertex inside any circumcircle", () => {
    const { x, y } = scatter(150, 3);
    const { triangles } = delaunay(x, y);
    let violations = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]!, b = triangles[t + 1]!, c = triangles[t + 2]!;
      for (let d = 0; d < x.length; d++) {
        if (d === a || d === b || d === c) continue;
        // A generous epsilon: cocircular points are a tie, not a violation.
        if (inCircle(x[a]!, y[a]!, x[b]!, y[b]!, x[c]!, y[c]!, x[d]!, y[d]!) > 1e-6) violations++;
      }
    }
    expect(violations).toBe(0);
  });

  it("uses every input point that is not a duplicate", () => {
    const { x, y } = scatter(120, 11);
    const { triangles } = delaunay(x, y);
    expect(new Set(triangles).size).toBe(x.length);
  });

  it("produces the Euler-consistent triangle count for points in general position", () => {
    // With h hull points and n total, a Delaunay triangulation has 2n - 2 - h triangles.
    const x = [0, 10, 10, 0, 5];
    const y = [0, 0, 10, 10, 5];
    const { triangles } = delaunay(x, y);
    expect(triangles.length / 3).toBe(2 * 5 - 2 - 4);
  });

  it("links half-edges symmetrically, with -1 only on the hull", () => {
    const { x, y } = scatter(80, 5);
    const { triangles, halfedges } = delaunay(x, y);
    expect(halfedges).toHaveLength(triangles.length);
    let hull = 0;
    for (let e = 0; e < halfedges.length; e++) {
      const twin = halfedges[e]!;
      if (twin === -1) { hull++; continue; }
      expect(halfedges[twin]).toBe(e);
    }
    expect(hull).toBeGreaterThan(2); // a hull always has at least three edges
  });

  it("survives duplicate and collinear points", () => {
    const x = [0, 1, 2, 3, 1, 1];
    const y = [0, 0, 0, 0, 0, 1];
    const { triangles } = delaunay(x, y);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]!, b = triangles[t + 1]!, c = triangles[t + 2]!;
      expect(area2(x[a]!, y[a]!, x[b]!, y[b]!, x[c]!, y[c]!)).toBeGreaterThan(0);
    }
  });

  it("handles a grid, where cocircular points make the split ambiguous", () => {
    const x: number[] = [], y: number[] = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { x.push(c); y.push(r); }
    const { triangles } = delaunay(x, y);
    // 64 points, 28 on the hull -> 2*64 - 2 - 28 triangles.
    expect(triangles.length / 3).toBe(2 * 64 - 2 - 28);
  });

  it("scales to a few thousand points", () => {
    const { x, y } = scatter(4000, 13);
    const { triangles } = delaunay(x, y);
    expect(triangles.length / 3).toBeGreaterThan(7800);
    expect(new Set(triangles).size).toBe(4000);
  });
});

describe("triangleEdges", () => {
  it("returns each shared edge once", () => {
    // Two triangles sharing one edge: 5 unique edges, not 6.
    const edges = triangleEdges([0, 1, 2, 1, 3, 2]);
    expect(edges).toHaveLength(10);
    const pairs = new Set<string>();
    for (let i = 0; i < edges.length; i += 2) pairs.add(`${edges[i]}-${edges[i + 1]}`);
    expect(pairs.size).toBe(5);
  });

  it("orients each pair low-to-high so the dedupe is direction-free", () => {
    const edges = triangleEdges([2, 0, 1]);
    for (let i = 0; i < edges.length; i += 2) expect(edges[i]!).toBeLessThan(edges[i + 1]!);
  });
});
