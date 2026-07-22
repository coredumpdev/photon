import { describe, expect, it } from "vitest";
import {
  lonLatToWorld,
  worldToLonLat,
  tileWorldBounds,
  pickZoom,
  visibleTiles,
  tileKey,
} from "../src/mercator.js";

describe("lonLatToWorld", () => {
  it("maps the corners of the projectable world", () => {
    const [wx, wy] = lonLatToWorld(-180, 85.0511287798066);
    expect(wx).toBeCloseTo(0, 6);
    expect(wy).toBeCloseTo(1, 6); // north edge, top

    const [ex, ey] = lonLatToWorld(180, -85.0511287798066);
    expect(ex).toBeCloseTo(1, 6);
    expect(ey).toBeCloseTo(0, 6); // south edge, bottom
  });

  it("puts the equator/prime-meridian at the world centre", () => {
    const [wx, wy] = lonLatToWorld(0, 0);
    expect(wx).toBeCloseTo(0.5, 9);
    expect(wy).toBeCloseTo(0.5, 9);
  });

  it("round-trips through worldToLonLat", () => {
    for (const [lon, lat] of [
      [0, 0],
      [28.9784, 41.0082], // Istanbul
      [-122.4194, 37.7749], // San Francisco
      [139.6917, 35.6895], // Tokyo
    ]) {
      const [wx, wy] = lonLatToWorld(lon, lat);
      const [lon2, lat2] = worldToLonLat(wx, wy);
      expect(lon2).toBeCloseTo(lon, 6);
      expect(lat2).toBeCloseTo(lat, 6);
    }
  });
});

describe("tileWorldBounds", () => {
  it("the single z0 tile covers the whole world", () => {
    const b = tileWorldBounds({ z: 0, x: 0, y: 0 });
    expect(b.wx0).toBe(0);
    expect(b.wx1).toBe(1);
    expect(b.wy0).toBe(0);
    expect(b.wy1).toBe(1);
  });

  it("z1 tiles quarter the world with north-up rows", () => {
    // Row 0 is the northern hemisphere → wy in [0.5, 1].
    const nw = tileWorldBounds({ z: 1, x: 0, y: 0 });
    expect(nw.wx0).toBe(0);
    expect(nw.wx1).toBe(0.5);
    expect(nw.wy0).toBeCloseTo(0.5);
    expect(nw.wy1).toBeCloseTo(1);

    const se = tileWorldBounds({ z: 1, x: 1, y: 1 });
    expect(se.wx0).toBe(0.5);
    expect(se.wy0).toBeCloseTo(0);
    expect(se.wy1).toBeCloseTo(0.5);
  });
});

describe("pickZoom", () => {
  it("whole world in ~256px → zoom 0", () => {
    expect(pickZoom(1, 256)).toBe(0);
  });
  it("halving the visible span raises zoom by one", () => {
    const z = pickZoom(0.25, 1024);
    expect(z).toBe(pickZoom(0.5, 1024) + 1);
  });
  it("clamps to the provided range", () => {
    expect(pickZoom(1e-9, 1024, 0, 14)).toBe(14);
    expect(pickZoom(2, 100, 3, 14)).toBe(3);
  });
});

describe("visibleTiles", () => {
  it("returns the four z1 tiles for the full world", () => {
    const tiles = visibleTiles(0, 0, 1, 1, 1);
    const keys = new Set(tiles.map(tileKey));
    expect(keys).toEqual(new Set(["1/0/0", "1/1/0", "1/0/1", "1/1/1"]));
  });

  it("a small window around the centre picks the middle tiles", () => {
    const tiles = visibleTiles(0.49, 0.49, 0.51, 0.51, 2).map(tileKey);
    // Centre of the world at z2 falls on the tx=1..2, ty=1..2 boundary.
    expect(tiles).toContain("2/1/1");
    expect(tiles).toContain("2/2/2");
  });

  it("wraps longitude across the antimeridian", () => {
    const tiles = visibleTiles(0.98, 0.4, 1.02, 0.6, 3);
    // tx sweeps 7 → 8; column 8 wraps to 0.
    const xs = new Set(tiles.map((t) => t.x));
    expect(xs.has(7)).toBe(true);
    expect(xs.has(0)).toBe(true);
  });
});
