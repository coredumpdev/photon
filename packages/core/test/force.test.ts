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

describe("Barnes–Hut repulsion", () => {
  /** Exact all-pairs repulsion on point i, the sum the tree approximates. */
  function exact(x: Float64Array, y: Float64Array, i: number, force: (d: number) => number) {
    let fx = 0, fy = 0;
    for (let j = 0; j < x.length; j++) {
      if (j === i) continue;
      const dx = x[i]! - x[j]!, dy = y[i]! - y[j]!;
      const d = Math.hypot(dx, dy) || 1e-6;
      const f = force(d);
      fx += (dx / d) * f;
      fy += (dy / d) * f;
    }
    return { x: fx, y: fy };
  }

  function cloud(n: number, seed = 3) {
    let a = seed >>> 0;
    const next = (): number => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const x = Float64Array.from({ length: n }, () => next() * 20 - 10);
    const y = Float64Array.from({ length: n }, () => next() * 20 - 10);
    return { x, y };
  }

  it("matches the exact sum when the opening angle forces full descent", async () => {
    const { Quadtree } = await import("../src/graph/quadtree.js");
    const { x, y } = cloud(200);
    const t = new Quadtree(400);
    t.build(x, y, x.length);
    const force = (d: number): number => 1 / d;
    const out = { x: 0, y: 0 };
    for (const i of [0, 17, 99, 199]) {
      t.repulsion(x[i]!, y[i]!, i, 0.0001, force, out);
      const ref = exact(x, y, i, force);
      expect(out.x).toBeCloseTo(ref.x, 6);
      expect(out.y).toBeCloseTo(ref.y, 6);
    }
  });

  it("stays close to the exact sum at the default opening angle", async () => {
    const { Quadtree } = await import("../src/graph/quadtree.js");
    const { x, y } = cloud(500, 11);
    const t = new Quadtree(1000);
    t.build(x, y, x.length);
    const force = (d: number): number => 1 / d;
    const out = { x: 0, y: 0 };
    let worst = 0;
    for (let i = 0; i < x.length; i += 7) {
      t.repulsion(x[i]!, y[i]!, i, 0.9, force, out);
      const ref = exact(x, y, i, force);
      const mag = Math.hypot(ref.x, ref.y) || 1e-9;
      worst = Math.max(worst, Math.hypot(out.x - ref.x, out.y - ref.y) / mag);
    }
    // An approximation, not an identity — but it must track the real field.
    expect(worst).toBeLessThan(0.35);
  });

  it("conserves total mass over the tree", async () => {
    const { Quadtree } = await import("../src/graph/quadtree.js");
    const { x, y } = cloud(300, 5);
    const t = new Quadtree(600);
    t.build(x, y, x.length);
    // Every point repels a far-away probe with total weight n.
    const out = { x: 0, y: 0 };
    t.repulsion(1e6, 0, -1, 0.5, () => 1, out);
    expect(out.x).toBeCloseTo(300, 3);
  });

  it("survives coincident points", async () => {
    const { Quadtree } = await import("../src/graph/quadtree.js");
    const x = new Float64Array(200).fill(1);
    const y = new Float64Array(200).fill(2);
    const t = new Quadtree(400);
    t.build(x, y, 200);
    const out = { x: 0, y: 0 };
    t.repulsion(1, 2, 0, 0.9, (d) => 1 / d, out);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
  });

  it("lays out a large graph as well as the exact solver does", () => {
    const edges: [number, number][] = [];
    for (let i = 1; i < 400; i++) edges.push([i, Math.floor(i / 2)]);
    const approx = forceLayout(400, edges, { iterations: 120 });
    const precise = forceLayout(400, edges, { iterations: 120, theta: 0 });
    expect(approx.x.every((v) => Number.isFinite(v))).toBe(true);
    // Connected nodes should end up at a comparable spread either way.
    const spread = (p: { x: Float64Array; y: Float64Array }): number => {
      let s = 0;
      for (const [a, b] of edges) s += Math.hypot(p.x[a]! - p.x[b]!, p.y[a]! - p.y[b]!);
      return s / edges.length;
    };
    const ratio = spread(approx) / spread(precise);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
