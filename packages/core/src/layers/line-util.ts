/**
 * Pure geometry helpers for {@link LineLayer}, split out so the tricky bits —
 * min/max decimation index selection and screen-space join extrusion — can be
 * unit-tested without a WebGL context. The GLSL in `line.ts` mirrors
 * {@link computeJoin} exactly; keep the two in sync.
 */

/**
 * Min/max decimation: reduce the visible index window `[i0, i1]` to at most
 * `2*cols + 2` representative indices. Each pixel column keeps the sample with
 * the lowest and highest y (emitted in index order so the envelope shape is
 * preserved), bracketed by the window endpoints so the line reaches the edges.
 */
export function decimateIndices(
  ys: ArrayLike<number>,
  i0: number,
  i1: number,
  cols: number,
): number[] {
  const out: number[] = [i0];
  const visN = i1 - i0;
  for (let b = 0; b < cols; b++) {
    const lo = i0 + Math.floor((visN * b) / cols);
    const hi = i0 + Math.floor((visN * (b + 1)) / cols);
    if (hi <= lo) continue;
    let iMin = lo, iMax = lo;
    for (let i = lo; i < hi; i++) {
      if (ys[i]! < ys[iMin]!) iMin = i;
      if (ys[i]! > ys[iMax]!) iMax = i;
    }
    // Emit the two extremes in index order to preserve the envelope shape.
    if (iMin < iMax) out.push(iMin, iMax);
    else out.push(iMax, iMin);
  }
  out.push(i1);
  return out;
}

/** Screen-space geometry for one line join, all coordinates in device pixels. */
export interface JoinGeom {
  /** End corner of the incoming segment on the outer side of the turn. */
  ax: number;
  ay: number;
  /** Start corner of the outgoing segment on the outer side of the turn. */
  bx: number;
  by: number;
  /** Outer tip: the miter point, or the bevel midpoint when clamped/bevelled. */
  apexX: number;
  apexY: number;
  /** False when the joint is degenerate (repeated point or collinear). */
  ok: boolean;
}

const DEGENERATE: JoinGeom = { ax: 0, ay: 0, bx: 0, by: 0, apexX: 0, apexY: 0, ok: false };

/**
 * Extrude the outer wedge that fills the notch two butt-capped segments leave at
 * a joint `p0` between neighbours `prev` and `next`. With `miter` the tip reaches
 * the true miter point unless its length exceeds `miterLimit` (then it collapses
 * to the bevel midpoint); with `miter` false it is always the bevel midpoint.
 *
 * `hw` is the true half line-width in device pixels. This mirrors the join
 * vertex shader in `line.ts` — edit both together.
 */
export function computeJoin(
  prevX: number, prevY: number,
  p0X: number, p0Y: number,
  nextX: number, nextY: number,
  hw: number,
  miter: boolean,
  miterLimit: number,
): JoinGeom {
  let inx = p0X - prevX, iny = p0Y - prevY;
  let outx = nextX - p0X, outy = nextY - p0Y;
  const inl = Math.hypot(inx, iny), outl = Math.hypot(outx, outy);
  if (inl < 1e-6 || outl < 1e-6) return DEGENERATE;
  inx /= inl; iny /= inl; outx /= outl; outy /= outl;

  const inNx = -iny, inNy = inx;
  const outNx = -outy, outNy = outx;
  const cross = inx * outy - iny * outx;
  if (Math.abs(cross) < 1e-6) return DEGENERATE; // collinear — no visible notch

  // Left-turn (cross>0): outer side is to the right of the left normals, so flip.
  const outerSign = cross > 0 ? -1 : 1;
  const ax = p0X + inNx * hw * outerSign, ay = p0Y + inNy * hw * outerSign;
  const bx = p0X + outNx * hw * outerSign, by = p0Y + outNy * hw * outerSign;

  let apexX = (ax + bx) * 0.5, apexY = (ay + by) * 0.5; // bevel default
  if (miter) {
    let mnx = inNx + outNx, mny = inNy + outNy;
    const ml = Math.hypot(mnx, mny);
    if (ml > 1e-6) {
      mnx /= ml; mny /= ml;
      const denom = mnx * outNx + mny * outNy;
      if (denom > 1e-3) {
        const miterLen = 1 / denom;
        if (miterLen <= miterLimit) {
          apexX = p0X + mnx * outerSign * hw * miterLen;
          apexY = p0Y + mny * outerSign * hw * miterLen;
        }
      }
    }
  }
  return { ax, ay, bx, by, apexX, apexY, ok: true };
}
