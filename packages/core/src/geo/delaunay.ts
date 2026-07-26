/**
 * Delaunay triangulation of a 2-D point set.
 *
 * Incremental insertion with Lawson edge flipping over a half-edge mesh. Points
 * go in along a Hilbert-ish spatial order and each insertion *walks* to its
 * containing triangle from the last one touched, so location stays near O(1)
 * amortised instead of the O(n) scan a naive Bowyer–Watson does.
 *
 * Backs the `tri*` chart family (matplotlib's tricontour / tripcolor / triplot),
 * where the samples are scattered rather than gridded.
 */

/** A triangulated point set. */
export interface Triangulation {
  /** Vertex indices, three per triangle, counter-clockwise. */
  triangles: Uint32Array;
  /** Half-edge twins: `halfedges[e]` is the opposing half-edge, or -1 on the hull. */
  halfedges: Int32Array;
}

const nextEdge = (e: number): number => (e % 3 === 2 ? e - 2 : e + 1);
const prevEdge = (e: number): number => (e % 3 === 0 ? e + 2 : e - 1);

/** Twice the signed area of `abc`; positive when the winding is counter-clockwise. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * True when `d` falls strictly inside the circumcircle of the counter-clockwise
 * triangle `abc` — the Delaunay condition, as the standard 3x3 determinant of
 * the points lifted onto a paraboloid.
 */
function inCircle(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const adx = ax - dx, ady = ay - dy;
  const bdx = bx - dx, bdy = by - dy;
  const cdx = cx - dx, cdy = cy - dy;
  const abdet = adx * bdy - bdx * ady;
  const bcdet = bdx * cdy - cdx * bdy;
  const cadet = cdx * ady - adx * cdy;
  const alift = adx * adx + ady * ady;
  const blift = bdx * bdx + bdy * bdy;
  const clift = cdx * cdx + cdy * cdy;
  return alift * bcdet + blift * cadet + clift * abdet > 0;
}

/**
 * Order points along a coarse grid snake, so consecutive insertions land near
 * each other and the walk from the previous triangle is short.
 */
function spatialOrder(x: ArrayLike<number>, y: ArrayLike<number>, n: number): Uint32Array {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = x[i]!, py = y[i]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const sx = maxX > minX ? side / (maxX - minX) : 0;
  const sy = maxY > minY ? side / (maxY - minY) : 0;
  const key = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(side - 1, Math.floor((x[i]! - minX) * sx));
    const cy = Math.min(side - 1, Math.floor((y[i]! - minY) * sy));
    // Serpentine: reverse every other column so the walk never jumps back.
    key[i] = cx * side + (cx % 2 === 0 ? cy : side - 1 - cy);
  }
  return order.sort((a, b) => key[a]! - key[b]!);
}

/**
 * Triangulate a point set. Collinear or fewer-than-three inputs give an empty
 * triangulation rather than throwing — there is simply no triangle to draw.
 */
export function delaunay(x: ArrayLike<number>, y: ArrayLike<number>): Triangulation {
  const n = Math.min(x.length, y.length);
  const empty: Triangulation = { triangles: new Uint32Array(0), halfedges: new Int32Array(0) };
  if (n < 3) return empty;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = x[i]!, py = y[i]!;
    if (!(isFinite(px) && isFinite(py))) return empty;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  // Working coordinates: the input followed by three super-triangle corners far
  // enough out that every real point is inside, whatever the aspect ratio.
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const far = span * 1000;
  const px = new Float64Array(n + 3);
  const py = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) { px[i] = x[i]!; py[i] = y[i]!; }
  px[n] = cx - far; py[n] = cy - far;
  px[n + 1] = cx + far; py[n + 1] = cy - far;
  px[n + 2] = cx; py[n + 2] = cy + far;

  const tri: number[] = [n, n + 1, n + 2];
  const half: number[] = [-1, -1, -1];
  let walkFrom = 0;

  const link = (a: number, b: number): void => {
    if (a >= 0) half[a] = b;
    if (b >= 0) half[b] = a;
  };
  const inside = (t: number, qx: number, qy: number): boolean => {
    const a = tri[3 * t]!, b = tri[3 * t + 1]!, c = tri[3 * t + 2]!;
    return cross(px[a]!, py[a]!, px[b]!, py[b]!, qx, qy) >= 0
      && cross(px[b]!, py[b]!, px[c]!, py[c]!, qx, qy) >= 0
      && cross(px[c]!, py[c]!, px[a]!, py[a]!, qx, qy) >= 0;
  };

  /** Visibility walk: step across whichever edge the target is behind. */
  const locate = (qx: number, qy: number): number => {
    let t = walkFrom;
    if (t * 3 >= tri.length) t = 0;
    for (let step = 0; step < tri.length; step++) {
      let moved = false;
      for (let i = 0; i < 3; i++) {
        const e = 3 * t + i;
        const a = tri[e]!, b = tri[nextEdge(e)]!;
        if (cross(px[a]!, py[a]!, px[b]!, py[b]!, qx, qy) < 0) {
          const twin = half[e]!;
          if (twin < 0) break; // hull edge — cannot cross it, so stay put
          t = Math.floor(twin / 3);
          moved = true;
          break;
        }
      }
      if (!moved) return t;
    }
    // Degenerate walk (duplicate points, exact collinearity): fall back to a scan.
    for (let t2 = 0; t2 * 3 < tri.length; t2++) if (inside(t2, qx, qy)) return t2;
    return -1;
  };

  /**
   * Flip the quad around `start` until every edge in reach is Delaunay.
   *
   * The flip rewrites only the two apex slots and relinks three half-edges —
   * rewriting all six vertex slots looks symmetric but corrupts the mesh, since
   * the surrounding twins are indexed by slot.
   */
  const legalize = (start: number): void => {
    const stack: number[] = [];
    let e = start;
    for (;;) {
      const twin = half[e]!;
      if (twin < 0) {
        if (!stack.length) return;
        e = stack.pop()!;
        continue;
      }
      const er = prevEdge(e), el = nextEdge(e);
      const tl = prevEdge(twin);
      const p0 = tri[er]!;   // apex of e's triangle
      const pr = tri[e]!;    // origin of e
      const pl = tri[el]!;   // destination of e
      const p1 = tri[tl]!;   // apex across the edge

      if (!inCircle(px[p0]!, py[p0]!, px[pr]!, py[pr]!, px[pl]!, py[pl]!, px[p1]!, py[p1]!)) {
        if (!stack.length) return;
        e = stack.pop()!;
        continue;
      }

      tri[e] = p1;
      tri[twin] = p0;
      link(e, half[tl]!);
      link(twin, half[er]!);
      link(er, tl);

      stack.push(nextEdge(twin));
      // `e` now spans the other diagonal; re-test it before unwinding.
    }
  };

  // Exact duplicates would insert zero-area triangles, so keep the first only.
  const seen = new Map<string, number>();
  for (const i of spatialOrder(x, y, n)) {
    const qx = px[i]!, qy = py[i]!;
    const key = `${qx},${qy}`;
    if (seen.has(key)) continue;
    seen.set(key, i);
    const t = locate(qx, qy);
    if (t < 0) continue;

    const e0 = 3 * t, e1 = e0 + 1, e2 = e0 + 2;
    const a = tri[e0]!, b = tri[e1]!, c = tri[e2]!;
    const h0 = half[e0]!, h1 = half[e1]!, h2 = half[e2]!;
    if (a === i || b === i || c === i) continue; // exact duplicate point

    // Split into (a,b,i) in place, plus (b,c,i) and (c,a,i) appended.
    const t1 = tri.length, t2 = t1 + 3;
    tri[e0] = a; tri[e1] = b; tri[e2] = i;
    tri.push(b, c, i, c, a, i);
    half.push(-1, -1, -1, -1, -1, -1);

    // Outer edges keep their old twins; the three new spokes pair up.
    link(e0, h0);        // a->b
    link(t1, h1);        // b->c
    link(t2, h2);        // c->a
    link(e1, t1 + 2);    // b->i  <->  i->b
    link(e2, t2 + 1);    // i->a  <->  a->i
    link(t1 + 1, t2 + 2); // c->i  <->  i->c

    walkFrom = Math.floor(t2 / 3);
    legalize(e0);
    legalize(t1);
    legalize(t2);
  }

  // Drop the super-triangle fan and any sliver a near-collinear input produced,
  // then compact. A zero-area triangle divides by zero in every interpolation
  // downstream, so it is worse than a hole.
  const minArea = span * span * 1e-12;
  const keep: number[] = [];
  const remap = new Int32Array(tri.length / 3).fill(-1);
  for (let t = 0; t * 3 < tri.length; t++) {
    const a = tri[3 * t]!, b = tri[3 * t + 1]!, c = tri[3 * t + 2]!;
    if (a >= n || b >= n || c >= n) continue;
    if (cross(px[a]!, py[a]!, px[b]!, py[b]!, px[c]!, py[c]!) <= minArea) continue;
    remap[t] = keep.length;
    keep.push(t);
  }
  const triangles = new Uint32Array(keep.length * 3);
  const halfedges = new Int32Array(keep.length * 3).fill(-1);
  for (let k = 0; k < keep.length; k++) {
    const t = keep[k]!;
    for (let i = 0; i < 3; i++) {
      triangles[3 * k + i] = tri[3 * t + i]!;
      const twin = half[3 * t + i]!;
      if (twin < 0) continue;
      const other = remap[Math.floor(twin / 3)]!;
      if (other >= 0) halfedges[3 * k + i] = 3 * other + (twin % 3);
    }
  }
  return { triangles, halfedges };
}

/**
 * Unique undirected edges of a triangle mesh, as flat `[i0, j0, i1, j1, …]`
 * vertex-index pairs — what `triplot` draws.
 */
export function triangleEdges(triangles: ArrayLike<number>): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    for (let i = 0; i < 3; i++) {
      const a = triangles[t + i]!;
      const b = triangles[t + ((i + 1) % 3)]!;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      // Pack the pair into one number; safe while indices stay under 2^26.
      const key = lo * 67108864 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lo, hi);
    }
  }
  return Uint32Array.from(out);
}
