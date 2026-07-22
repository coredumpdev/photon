import { describe, expect, it } from "vitest";
import { earcut } from "../src/earcut.js";

/** Sum of |triangle| areas produced for a flat coord array + index list. */
function triangulatedArea(data: number[], tris: number[]): number {
  let sum = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i]! * 2;
    const b = tris[i + 1]! * 2;
    const c = tris[i + 2]! * 2;
    sum += Math.abs(
      (data[b]! - data[a]!) * (data[c + 1]! - data[a + 1]!) -
        (data[c]! - data[a]!) * (data[b + 1]! - data[a + 1]!),
    ) / 2;
  }
  return sum;
}

describe("earcut", () => {
  it("triangulates a square into two triangles", () => {
    const data = [0, 0, 10, 0, 10, 10, 0, 10];
    const tris = earcut(data);
    expect(tris).toHaveLength(6);
    expect(triangulatedArea(data, tris)).toBeCloseTo(100);
    for (const idx of tris) expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("handles a concave (arrow) polygon", () => {
    // Chevron pointing right; area computed independently by shoelace.
    const data = [0, 0, 6, 4, 0, 8, 2, 4];
    const tris = earcut(data);
    expect(triangulatedArea(data, tris)).toBeCloseTo(16);
  });

  it("cuts a hole out of a square", () => {
    // 10×10 outer, 4×4 hole → area 100 − 16 = 84.
    const outer = [0, 0, 10, 0, 10, 10, 0, 10];
    const hole = [3, 3, 3, 7, 7, 7, 7, 3]; // opposite winding
    const data = [...outer, ...hole];
    const tris = earcut(data, [4]); // hole starts at vertex index 4
    expect(triangulatedArea(data, tris)).toBeCloseTo(84);
  });

  it("returns nothing for a degenerate ring", () => {
    expect(earcut([0, 0, 1, 1])).toEqual([]);
    expect(earcut([0, 0, 0, 0, 0, 0])).toEqual([]);
  });

  /** |shoelace| of a flat ring, for independent area checks. */
  function ringArea(pts: number[]): number {
    let s = 0;
    const n = pts.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      s += pts[i]! * pts[j + 1]! - pts[j]! * pts[i + 1]!;
    }
    return Math.abs(s) / 2;
  }

  function circle(n: number, r: number, cw = false): number[] {
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const ang = ((cw ? -k : k) / n) * Math.PI * 2;
      pts.push(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    return pts;
  }

  it("uses the z-order path for a large ring (256-gon) and stays exact", () => {
    const pts = circle(256, 100); // > 80 verts → hashed path
    const tris = earcut(pts);
    expect(tris).toHaveLength((256 - 2) * 3);
    expect(triangulatedArea(pts, tris)).toBeCloseTo(ringArea(pts), 5);
  });

  it("z-order path handles a big ring with a hole", () => {
    const outer = circle(160, 100);
    const hole = circle(64, 40, true); // opposite winding, concentric
    const data = [...outer, ...hole];
    const tris = earcut(data, [160]);
    const expected = ringArea(outer) - ringArea(hole);
    expect(triangulatedArea(data, tris)).toBeCloseTo(expected, 4);
  });

  it("triangulates a larger random-ish convex polygon exactly", () => {
    // Regular octagon, area = 2(1+√2)·s² with s the side; verify via shoelace.
    const pts: number[] = [];
    const N = 8;
    for (let k = 0; k < N; k++) {
      const ang = (k / N) * Math.PI * 2;
      pts.push(Math.cos(ang) * 100, Math.sin(ang) * 100);
    }
    let expected = 0;
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      const b = ((i + 1) % N) * 2;
      expected += pts[a]! * pts[b + 1]! - pts[b]! * pts[a + 1]!;
    }
    expected = Math.abs(expected) / 2;
    const tris = earcut(pts);
    expect(tris).toHaveLength((N - 2) * 3);
    expect(triangulatedArea(pts, tris)).toBeCloseTo(expected);
  });
});
