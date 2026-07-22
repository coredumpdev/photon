import { describe, expect, it } from "vitest";
import { marchingCubes } from "../src/plot3d/marching-cubes.js";

/** A signed-distance-ish sphere field sampled on an n³ grid centered at 0. */
function sphereVolume(n: number): { values: Float64Array; dims: [number, number, number] } {
  const values = new Float64Array(n * n * n);
  const c = (n - 1) / 2;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        values[x + y * n + z * n * n] = Math.hypot(x - c, y - c, z - c);
  return { values, dims: [n, n, n] };
}

describe("marchingCubes", () => {
  it("returns empty geometry when the iso level is outside the data", () => {
    const { values, dims } = sphereVolume(8);
    const r = marchingCubes(values, dims, -5); // no corner is below -5
    expect(r.positions.length).toBe(0);
    expect(r.normals.length).toBe(0);
  });

  it("meshes a sphere: triangles whose vertices sit near the iso radius", () => {
    const n = 24;
    const { values, dims } = sphereVolume(n);
    const R = 8;
    const { positions, normals } = marchingCubes(values, dims, R); // extent defaults to [0,n-1]
    // Non-empty, and a whole number of triangles.
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length % 9).toBe(0);
    expect(normals.length).toBe(positions.length);

    const c = (n - 1) / 2;
    let within = 0;
    const verts = positions.length / 3;
    for (let i = 0; i < verts; i++) {
      const d = Math.hypot(positions[i * 3]! - c, positions[i * 3 + 1]! - c, positions[i * 3 + 2]! - c);
      if (Math.abs(d - R) < 0.6) within++;
    }
    // Nearly every vertex should lie on the iso sphere.
    expect(within / verts).toBeGreaterThan(0.95);
  });

  it("produces unit-length normals", () => {
    const { values, dims } = sphereVolume(16);
    const { normals } = marchingCubes(values, dims, 5);
    const k = Math.floor(normals.length / 3 / 2) * 3; // a sample vertex
    const len = Math.hypot(normals[k]!, normals[k + 1]!, normals[k + 2]!);
    expect(len).toBeCloseTo(1, 5);
  });
});
