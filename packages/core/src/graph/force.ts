/**
 * A tiny deterministic force-directed layout (Fruchterman–Reingold style). Nodes
 * seed on a unit circle (no RNG — pure and unit-testable), then relax under
 * repulsion + per-edge attraction + a gentle pull to the center, with
 * temperature cooling. Returns node positions in roughly a unit box around 0.
 *
 * Repulsion is the quadratic term. Above a few dozen nodes it goes through a
 * Barnes–Hut quadtree, which lumps distant clusters into one body and turns the
 * per-iteration cost from O(n²) into roughly O(n log n). Below that the tree
 * costs more to build than the pairs cost to walk, so small graphs stay exact.
 */
import { Quadtree } from "./quadtree.js";

export interface ForceLayoutOptions {
  /** Relaxation steps. Default 300. */
  iterations?: number;
  /** Layout area; the ideal edge length is `sqrt(area / n)`. Default 1. */
  area?: number;
  /** Pull toward the origin each step. Default 0.05. */
  gravity?: number;
  /**
   * Barnes–Hut opening angle. Smaller is more accurate and slower; 0 forces the
   * exact all-pairs sum. Default 0.9.
   */
  theta?: number;
}

/** Below this, all-pairs is cheaper than building a tree each iteration. */
const BARNES_HUT_MIN = 64;

export function forceLayout(
  nodeCount: number,
  edges: ReadonlyArray<readonly [number, number]>,
  opts: ForceLayoutOptions = {},
): { x: Float64Array; y: Float64Array } {
  const n = nodeCount;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    x[i] = Math.cos(a);
    y[i] = Math.sin(a);
  }
  if (n < 2) return { x, y };

  const iterations = opts.iterations ?? 300;
  const area = opts.area ?? 1;
  const k = Math.sqrt(area / n); // ideal edge length
  const gravity = opts.gravity ?? 0.05;
  const dispX = new Float64Array(n);
  const dispY = new Float64Array(n);
  let temp = 0.1;

  const theta = opts.theta ?? 0.9;
  const useTree = theta > 0 && n >= BARNES_HUT_MIN;
  const tree = useTree ? new Quadtree(n * 2) : null;
  const kk = k * k;
  const repel = (d: number): number => kk / d;
  const acc = { x: 0, y: 0 };

  for (let it = 0; it < iterations; it++) {
    dispX.fill(0);
    dispY.fill(0);
    // Repulsion: f = k^2 / d, summed over pairs — approximated for large graphs.
    if (tree) {
      tree.build(x, y, n);
      for (let i = 0; i < n; i++) {
        tree.repulsion(x[i]!, y[i]!, i, theta, repel, acc);
        dispX[i]! += acc.x;
        dispY[i]! += acc.y;
      }
    } else {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = x[i]! - x[j]!;
          const dy = y[i]! - y[j]!;
          const d = Math.hypot(dx, dy) || 1e-6;
          const f = kk / d;
          const ux = dx / d, uy = dy / d;
          dispX[i]! += ux * f; dispY[i]! += uy * f;
          dispX[j]! -= ux * f; dispY[j]! -= uy * f;
        }
      }
    }
    // Attraction along edges: f = d^2 / k.
    for (const [a, b] of edges) {
      const dx = x[a]! - x[b]!;
      const dy = y[a]! - y[b]!;
      const d = Math.hypot(dx, dy) || 1e-6;
      const f = (d * d) / k;
      const ux = dx / d, uy = dy / d;
      dispX[a]! -= ux * f; dispY[a]! -= uy * f;
      dispX[b]! += ux * f; dispY[b]! += uy * f;
    }
    // Gravity + move, capped by the current temperature.
    for (let i = 0; i < n; i++) {
      dispX[i]! -= x[i]! * gravity;
      dispY[i]! -= y[i]! * gravity;
      const d = Math.hypot(dispX[i]!, dispY[i]!) || 1e-6;
      const lim = Math.min(d, temp);
      x[i]! += (dispX[i]! / d) * lim;
      y[i]! += (dispY[i]! / d) * lim;
    }
    temp *= 0.99;
  }
  return { x, y };
}
