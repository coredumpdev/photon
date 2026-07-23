/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling — reduce a series to
 * `threshold` points while preserving its visual shape (peaks/troughs), the
 * standard technique for plotting very long line series. First and last points
 * are always kept.
 */
export function lttb(
  x: ArrayLike<number>, y: ArrayLike<number>, threshold: number,
): { x: Float64Array; y: Float64Array } {
  const n = Math.min(x.length, y.length);
  if (threshold >= n || threshold <= 2) {
    const rx = new Float64Array(n), ry = new Float64Array(n);
    for (let i = 0; i < n; i++) { rx[i] = x[i]!; ry[i] = y[i]!; }
    return { x: rx, y: ry };
  }

  const sx = new Float64Array(threshold), sy = new Float64Array(threshold);
  const bucket = (n - 2) / (threshold - 2);
  let a = 0; // index of the previously-kept point
  sx[0] = x[0]!; sy[0] = y[0]!;
  let out = 1;

  for (let i = 0; i < threshold - 2; i++) {
    // Average of the next bucket (the triangle's third vertex).
    let avgX = 0, avgY = 0;
    let rs = Math.floor((i + 1) * bucket) + 1;
    const re = Math.min(Math.floor((i + 2) * bucket) + 1, n);
    const rlen = re - rs || 1;
    for (let k = rs; k < re; k++) { avgX += x[k]!; avgY += y[k]!; }
    avgX /= rlen; avgY /= rlen;

    // Point in this bucket forming the largest triangle with `a` and the average.
    let cs = Math.floor(i * bucket) + 1;
    const ce = Math.floor((i + 1) * bucket) + 1;
    const ax = x[a]!, ay = y[a]!;
    let maxArea = -1, chosen = cs, cx = x[cs]!, cy = y[cs]!;
    for (; cs < ce; cs++) {
      const area = Math.abs((ax - avgX) * (y[cs]! - ay) - (ax - x[cs]!) * (avgY - ay));
      if (area > maxArea) { maxArea = area; chosen = cs; cx = x[cs]!; cy = y[cs]!; }
    }
    sx[out] = cx; sy[out] = cy; out++;
    a = chosen;
  }

  sx[out] = x[n - 1]!; sy[out] = y[n - 1]!;
  return { x: sx, y: sy };
}
