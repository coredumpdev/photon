/**
 * Web Mercator (EPSG:3857) projection + XYZ slippy-map tile math.
 *
 * All "world" coordinates are normalized to `[0, 1]`:
 *  - `wx` runs west→east   (0 at lon −180°, 1 at lon +180°)
 *  - `wy` runs south→north (0 at the south edge, 1 at the north edge)
 *
 * The north-up convention (wy increasing upward) matches Photon's y axis, so a
 * map layer plots directly with the shared linear `dataToClip` transform — no
 * axis inversion needed. Tile rows, however, count from the *north* edge (the
 * XYZ standard), so the tile helpers below convert between the two.
 *
 * Everything here is pure and unit-tested; the WebGL layer never re-derives it.
 */

/** Max latitude the projection can represent (where wy would hit 0/1). ~85.051°. */
export const MAX_LAT = 85.0511287798066;
const DEG = Math.PI / 180;

/** Longitude/latitude (degrees) → world `[0,1]`, north-up. */
export function lonLatToWorld(lon: number, lat: number): [number, number] {
  const wx = (lon + 180) / 360;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin(clamped * DEG);
  const mercY = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); // 0 north … 1 south
  return [wx, 1 - mercY];
}

/** World `[0,1]` (north-up) → longitude/latitude in degrees. */
export function worldToLonLat(wx: number, wy: number): [number, number] {
  const lon = wx * 360 - 180;
  const mercY = 1 - wy;
  const lat = (2 * Math.atan(Math.exp((0.5 - mercY) * 2 * Math.PI)) - Math.PI / 2) / DEG;
  return [lon, lat];
}

/** A single XYZ tile address. `x`/`y` count from the north-west corner. */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Stable string key for caches/maps, e.g. `"12/2048/1361"`. */
export function tileKey(t: TileId): string {
  return `${t.z}/${t.x}/${t.y}`;
}

/**
 * World-space `[0,1]` bounds a tile covers, north-up. Returned as
 * `{ wx0, wy0, wx1, wy1 }` with `wy0 < wy1` (south edge < north edge).
 */
export function tileWorldBounds(t: TileId): {
  wx0: number;
  wy0: number;
  wx1: number;
  wy1: number;
} {
  const n = 2 ** t.z;
  const wx0 = t.x / n;
  const wx1 = (t.x + 1) / n;
  // Tile row 0 is the north edge; mercY = row/n. Convert to north-up wy = 1 − mercY.
  const wy1 = 1 - t.y / n; // north edge (larger wy)
  const wy0 = 1 - (t.y + 1) / n; // south edge (smaller wy)
  return { wx0, wy0, wx1, wy1 };
}

/**
 * Pick the integer zoom whose tiles are closest to `TILE`-pixel size on screen.
 * `worldSpan` is the visible world width (fraction of the globe, 0..1) and
 * `pixelWidth` the plot-region width in device pixels.
 */
export function pickZoom(
  worldSpan: number,
  pixelWidth: number,
  minZoom = 0,
  maxZoom = 14,
  tileSize = 256,
): number {
  if (worldSpan <= 0) return maxZoom;
  const tilesAcross = pixelWidth / tileSize;
  const z = Math.round(Math.log2(tilesAcross / worldSpan));
  return Math.max(minZoom, Math.min(maxZoom, z));
}

/**
 * Every tile at zoom `z` overlapping the world rectangle
 * `[wx0, wx1] × [wy0, wy1]` (north-up). Longitude wraps around the antimeridian;
 * latitude is clamped to the valid tile range.
 */
export function visibleTiles(
  wx0: number,
  wy0: number,
  wx1: number,
  wy1: number,
  z: number,
): TileId[] {
  const n = 2 ** z;
  // World y is north-up; tile rows count from the north (mercY = 1 − wy).
  const row = (wy: number) => Math.floor((1 - wy) * n);
  const ty0 = Math.max(0, Math.min(n - 1, row(wy1))); // north edge → smaller row
  const ty1 = Math.max(0, Math.min(n - 1, row(wy0))); // south edge → larger row
  const txStart = Math.floor(wx0 * n);
  const txEnd = Math.floor(wx1 * n);

  const out: TileId[] = [];
  for (let tx = txStart; tx <= txEnd; tx++) {
    const x = ((tx % n) + n) % n; // wrap longitude
    for (let ty = ty0; ty <= ty1; ty++) out.push({ z, x, y: ty });
  }
  return out;
}
