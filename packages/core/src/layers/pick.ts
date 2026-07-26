/**
 * Shared hover-picking used by point/series layers (line, scatter, stem).
 *
 * The mode decides which pixel-space distance is minimized:
 *  - `"x"`  — nearest by horizontal distance (classic crosshair-along-x)
 *  - `"y"`  — nearest by vertical distance
 *  - `"xy"` — nearest by true 2D distance (checks both axes; right for point
 *             clouds / maps, where an x-only match would highlight the wrong
 *             point)
 *
 * Distances are computed in pixels via {@link PickProjection}, so x and y are
 * compared on the same footing regardless of each axis's data range.
 *
 * When the series' x is sorted — which the line and stem layers already know,
 * since decimation needs it — the cursor is located by binary search and only
 * the handful of points that can still win are measured. That is what keeps
 * hover interactive on a multi-million-point series; the linear scan it replaces
 * cost ~185ms per frame at 6M points, roughly 200x the draw itself.
 */
export type PickMode = "x" | "y" | "xy";

export interface Picked {
  x: number;
  y: number;
  index: number;
}

/**
 * Data space to pixel space, one axis at a time.
 *
 * Two scalar calls rather than one returning a tuple: a tuple per point is an
 * allocation per point, which on its own cost about half of every pick.
 */
export interface PickProjection {
  x(value: number): number;
  y(value: number): number;
}

/** Below this, a linear scan beats the setup a binary search needs. */
const BINARY_SEARCH_MIN = 64;

/**
 * Index of the last point whose projected x is at or before the cursor.
 *
 * Searches on the *projected* value rather than the data value, so a log scale
 * or a reversed domain works without a special case — all that is required is
 * that projection be monotonic, which every scale here is.
 */
function locate(
  xs: ArrayLike<number>, count: number, project: PickProjection, cursorPx: number, ascending: boolean,
): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const before = ascending ? project.x(xs[mid]!) < cursorPx : project.x(xs[mid]!) > cursorPx;
    if (before) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Straight scan — the fallback for unsorted data (a scatter cloud, say). */
function scan(
  xs: ArrayLike<number>, ys: ArrayLike<number>, count: number, mode: PickMode,
  cursorPx: number, cursorPy: number, project: PickProjection,
): { best: number; dist: number } {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = project.x(xs[i]!) - cursorPx;
    const dy = project.y(ys[i]!) - cursorPy;
    const d = mode === "x" ? (dx < 0 ? -dx : dx) : mode === "y" ? (dy < 0 ? -dy : dy) : Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return { best, dist: bestDist };
}

/**
 * Sorted x: land on the cursor, then widen outwards. The x gap alone is a lower
 * bound on the distance, so the walk stops as soon as it exceeds the best found
 * — usually after a couple of points.
 */
function sortedSearch(
  xs: ArrayLike<number>, ys: ArrayLike<number>, count: number, mode: PickMode,
  cursorPx: number, cursorPy: number, project: PickProjection, ascending: boolean,
  gatePx: number,
): { best: number; dist: number } {
  const start = locate(xs, count, project, cursorPx, ascending);
  let best = -1;
  // Anything past the gate is unpickable, so it bounds the walk from the start.
  // Without it an "xy" pick whose cursor sits off the data keeps a loose bound
  // and walks a large share of a dense series.
  let bestDist = gatePx;

  const consider = (i: number): number => {
    const dx = project.x(xs[i]!) - cursorPx;
    const adx = dx < 0 ? -dx : dx;
    if (mode === "x") {
      if (adx < bestDist) { bestDist = adx; best = i; }
      return adx;
    }
    const dy = project.y(ys[i]!) - cursorPy;
    const d = mode === "y" ? (dy < 0 ? -dy : dy) : Math.hypot(dx, dy);
    if (d < bestDist) { bestDist = d; best = i; }
    return adx;
  };

  for (let dir = -1; dir <= 1; dir += 2) {
    for (let i = dir < 0 ? start - 1 : start; i >= 0 && i < count; i += dir) {
      // `mode === "y"` cannot bound on x at all, so it needs the full scan; the
      // caller keeps it off this path.
      if (consider(i) > bestDist) break;
    }
  }
  return { best, dist: best < 0 ? Infinity : bestDist };
}

export function pickNearest(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  mode: PickMode,
  cursorPx: number,
  cursorPy: number,
  project: PickProjection,
  /**
   * Max distance (in px, in the chosen metric) for a hit. Beyond it, nothing is
   * picked — so a point only highlights when the cursor is on it. Point clouds
   * (scatter) pass their marker radius; series layers leave it `Infinity`.
   */
  gatePx = Infinity,
  /** Set when `xs` is non-decreasing, which unlocks the binary search. */
  sortedX = false,
): Picked | null {
  if (count === 0) return null;

  // A "y" pick ranks purely on vertical distance, so no x bound can prune it.
  const canBisect = sortedX && mode !== "y" && count >= BINARY_SEARCH_MIN;
  const { best, dist } = canBisect
    ? sortedSearch(xs, ys, count, mode, cursorPx, cursorPy, project,
                   project.x(xs[count - 1]!) >= project.x(xs[0]!), gatePx)
    : scan(xs, ys, count, mode, cursorPx, cursorPy, project);

  if (best < 0 || dist > gatePx) return null;
  return { x: xs[best]!, y: ys[best]!, index: best };
}
