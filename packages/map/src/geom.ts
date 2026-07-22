/**
 * Small pure geometry helpers for feature picking. Unit-tested.
 */

/** Ray-casting point-in-ring test. `ring` is flat `[x0,y0,x1,y1,…]`. */
export function pointInRing(ring: number[], x: number, y: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i]!;
    const yi = ring[i + 1]!;
    const xj = ring[j]!;
    const yj = ring[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon for a `[exterior, ...holes]` ring set: inside the exterior
 * and outside every hole.
 */
export function pointInPolygon(polygon: number[][], x: number, y: number): boolean {
  if (polygon.length === 0 || !pointInRing(polygon[0]!, x, y)) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(polygon[i]!, x, y)) return false; // inside a hole
  }
  return true;
}
