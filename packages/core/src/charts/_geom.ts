/**
 * Geometry helpers shared by the field and triangulation chart builders.
 *
 * Internal: not re-exported from the package index. Both packs turn scalar
 * fields into filled polygons and strokes into quads, and doing it twice would
 * mean two chances to get the clipping wrong.
 */
import type { Patch } from "../layers/patches.js";

/**
 * Clip a polygon by a scalar half-space, interpolating along crossed edges
 * (Sutherland–Hodgman with the scalar itself as the clip predicate).
 *
 * `keepAbove` selects `v >= t`; clipping twice with both senses yields the
 * region of a band. Vertices carry their scalar so the crossing point is exact.
 */
export function clipScalar(
  px: ArrayLike<number>, py: ArrayLike<number>, pv: ArrayLike<number>,
  t: number, keepAbove: boolean,
): { x: number[]; y: number[]; v: number[] } {
  const x: number[] = [], y: number[] = [], v: number[] = [];
  const n = px.length;
  const inside = (val: number): boolean => (keepAbove ? val >= t : val <= t);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const vi = pv[i]!, vj = pv[j]!;
    const ini = inside(vi), inj = inside(vj);
    if (ini) { x.push(px[i]!); y.push(py[i]!); v.push(vi); }
    if (ini !== inj) {
      const f = (t - vi) / (vj - vi || 1e-12);
      x.push(px[i]! + (px[j]! - px[i]!) * f);
      y.push(py[i]! + (py[j]! - py[i]!) * f);
      v.push(t);
    }
  }
  return { x, y, v };
}

/**
 * A thin quad along a segment — the stroke primitive for builders that draw many
 * short, unconnected lines (barbs, mesh edges, iso-segments) in one patches layer.
 */
export function segmentQuad(
  ax: number, ay: number, bx: number, by: number, w: number, color?: string,
): Patch {
  const dx = bx - ax, dy = by - ay;
  const m = Math.hypot(dx, dy) || 1e-12;
  const nx = (-dy / m) * (w / 2), ny = (dx / m) * (w / 2);
  return {
    x: Float64Array.from([ax + nx, bx + nx, bx - nx, ax - nx]),
    y: Float64Array.from([ay + ny, by + ny, by - ny, ay - ny]),
    ...(color ? { color } : {}),
  };
}
