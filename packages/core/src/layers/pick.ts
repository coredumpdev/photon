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
 * Distances are computed in pixels via `project`, so x and y are compared on
 * the same footing regardless of each axis's data range.
 */
export type PickMode = "x" | "y" | "xy";

export interface Picked {
  x: number;
  y: number;
  index: number;
}

export function pickNearest(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  mode: PickMode,
  cursorPx: number,
  cursorPy: number,
  project: (x: number, y: number) => [number, number],
  /**
   * Max distance (in px, in the chosen metric) for a hit. Beyond it, nothing is
   * picked — so a point only highlights when the cursor is on it. Point clouds
   * (scatter) pass their marker radius; series layers leave it `Infinity`.
   */
  gatePx = Infinity,
): Picked | null {
  if (count === 0) return null;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const [px, py] = project(xs[i]!, ys[i]!);
    const dx = px - cursorPx;
    const dy = py - cursorPy;
    const d = mode === "x" ? Math.abs(dx) : mode === "y" ? Math.abs(dy) : Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0 || bestDist > gatePx) return null;
  return { x: xs[best]!, y: ys[best]!, index: best };
}
