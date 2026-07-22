/**
 * Stroke a polyline into a **continuous** triangle ribbon with miter joins, so
 * adjacent segments share their offset vertices — no gaps or notches at corners
 * (what independent per-segment quads leave behind). Widths are in pixels: the
 * emitted normal is the miter direction × half-width, and the vertex shader
 * scales it by `worldPerPixel` for constant screen thickness.
 *
 * Output vertices are `[x, y, nx, ny, r, g, b, a]`, appended to `out`. Closed
 * rings (first point == last) are stroked as loops so the seam joins cleanly.
 * Pure and unit-tested.
 */
export function strokePolyline(
  path: number[],
  halfWidth: number,
  color: readonly [number, number, number, number],
  out: number[],
): void {
  const n = path.length / 2;
  if (n < 2 || halfWidth <= 0) return;
  const px = (i: number): number => path[i * 2]!;
  const py = (i: number): number => path[i * 2 + 1]!;
  const closed = n > 2 && px(0) === px(n - 1) && py(0) === py(n - 1);
  const count = closed ? n - 1 : n; // logical point count
  if (count < 2) return;

  // Per-point miter normal, scaled by half-width.
  const mx = new Array<number>(count);
  const my = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const hasIn = closed || i > 0;
    const hasOut = closed || i < count - 1;
    let inx = 0;
    let iny = 0;
    let outx = 0;
    let outy = 0;
    if (hasIn) {
      const p = (i - 1 + count) % count;
      inx = px(i) - px(p);
      iny = py(i) - py(p);
      const l = Math.hypot(inx, iny) || 1;
      inx /= l;
      iny /= l;
    }
    if (hasOut) {
      const q = (i + 1) % count;
      outx = px(q) - px(i);
      outy = py(q) - py(i);
      const l = Math.hypot(outx, outy) || 1;
      outx /= l;
      outy /= l;
    }

    let dirx: number;
    let diry: number;
    if (hasIn && hasOut) {
      // Interior: bisector of the two segment normals (left perpendiculars).
      const n1x = -iny;
      const n1y = inx;
      const n2x = -outy;
      const n2y = outx;
      let bx = n1x + n2x;
      let by = n1y + n2y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-6) {
        // ~180° reversal — fall back to a plain perpendicular.
        dirx = n2x;
        diry = n2y;
      } else {
        bx /= bl;
        by /= bl;
        // Miter length 1/cos(θ), clamped to a limit of 4 to avoid spikes.
        const scale = 1 / Math.max(bx * n2x + by * n2y, 0.25);
        dirx = bx * scale;
        diry = by * scale;
      }
    } else if (hasOut) {
      dirx = -outy; // start cap
      diry = outx;
    } else {
      dirx = -iny; // end cap
      diry = inx;
    }
    mx[i] = dirx * halfWidth;
    my[i] = diry * halfWidth;
  }

  const [r, g, b, a] = color;
  const segs = closed ? count : count - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % count;
    const ax = px(i);
    const ay = py(i);
    const bxp = px(j);
    const byp = py(j);
    const am = mx[i]!;
    const an = my[i]!;
    const bm = mx[j]!;
    const bn = my[j]!;
    out.push(ax, ay, am, an, r, g, b, a);
    out.push(ax, ay, -am, -an, r, g, b, a);
    out.push(bxp, byp, bm, bn, r, g, b, a);
    out.push(bxp, byp, bm, bn, r, g, b, a);
    out.push(ax, ay, -am, -an, r, g, b, a);
    out.push(bxp, byp, -bm, -bn, r, g, b, a);
  }
}
