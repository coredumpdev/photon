import { describe, expect, it } from "vitest";
import { buildTileMesh } from "../src/mesh.js";
import { defaultStyle } from "../src/style.js";
import type { MvtFeature } from "../src/mvt.js";

const style = defaultStyle("light");
const z0 = { z: 0, x: 0, y: 0 }; // whole world, span 1, origin (0,0)
const STRIDE = 8;

describe("buildTileMesh", () => {
  it("tessellates a polygon fill and keeps it for picking", () => {
    const water: MvtFeature = {
      layer: "water",
      type: "polygon",
      properties: { name: "Ocean" },
      rings: [[0, 0, 1, 0, 1, 1, 0, 1]],
    };
    const mesh = buildTileMesh([water], z0, style);
    expect(mesh.fillCount).toBe(6); // 2 triangles × 3 verts
    expect(mesh.lineCount).toBe(0);
    expect(mesh.verts.length).toBe(6 * STRIDE);
    expect(mesh.originX).toBe(0);
    // Fill verts have zero normal.
    for (let i = 0; i < mesh.fillCount; i++) {
      expect(mesh.verts[i * STRIDE + 2]).toBe(0);
      expect(mesh.verts[i * STRIDE + 3]).toBe(0);
    }
    // Retained for hit-testing, with properties + absolute-world rings.
    expect(mesh.features).toHaveLength(1);
    expect(mesh.features[0]!.properties.name).toBe("Ocean");
    expect(mesh.features[0]!.polygons[0]![0]).toHaveLength(8); // 4 corners
  });

  it("expands a road line into triangle quads with a normal", () => {
    const road: MvtFeature = {
      layer: "transportation",
      type: "line",
      properties: { class: "primary" },
      rings: [[0, 0, 0.5, 0.5, 1, 1]], // 3 points → 2 segments
    };
    const mesh = buildTileMesh([road], z0, style);
    expect(mesh.fillCount).toBe(0);
    expect(mesh.lineCount).toBe(2 * 6); // 2 segments × 6 verts
    expect(mesh.features).toHaveLength(0);
    let hasNormal = false;
    for (let i = 0; i < mesh.lineCount; i++) {
      const off = i * STRIDE;
      if (mesh.verts[off + 2] !== 0 || mesh.verts[off + 3] !== 0) hasNormal = true;
    }
    expect(hasNormal).toBe(true);
  });

  it("skips features the style does not paint", () => {
    const poi: MvtFeature = { layer: "poi", type: "point", properties: {}, rings: [[0.5, 0.5]] };
    const mesh = buildTileMesh([poi], z0, style);
    expect(mesh.fillCount).toBe(0);
    expect(mesh.lineCount).toBe(0);
    expect(mesh.features).toHaveLength(0);
  });

  it("flips v so north maps to the larger world-y", () => {
    const tri: MvtFeature = {
      layer: "water",
      type: "polygon",
      properties: {},
      rings: [[0, 0, 1, 0, 1, 1]], // v=0 north, v=1 south
    };
    const mesh = buildTileMesh([tri], z0, style);
    const ys = [mesh.verts[1]!, mesh.verts[STRIDE + 1]!, mesh.verts[2 * STRIDE + 1]!];
    expect(Math.max(...ys)).toBeCloseTo(1); // north edge → top
    expect(Math.min(...ys)).toBeCloseTo(0); // south edge → bottom
  });
});
