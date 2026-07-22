import { describe, expect, it } from "vitest";
import { buildGeoJsonMesh, type GeoJsonFeatureCollection } from "../src/geojson.js";
import { pointInPolygon } from "../src/geom.js";
import { lonLatToWorld } from "../src/mercator.js";
import type { MapStyle } from "../src/style.js";

const style: MapStyle = {
  background: [0, 0, 0, 1],
  paint(_layer, type) {
    if (type === "polygon") return { kind: "fill", color: [0.2, 0.4, 0.6, 1] };
    if (type === "line") return { kind: "line", color: [1, 1, 1, 1], width: 2 };
    return null;
  },
};

const fc: GeoJsonFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Region A" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    },
    {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 10]] },
    },
  ],
};

describe("buildGeoJsonMesh", () => {
  const mesh = buildGeoJsonMesh(fc, style, "admin");

  it("tessellates a polygon fill and a line", () => {
    expect(mesh.fillCount).toBe(6); // square → 2 triangles
    expect(mesh.lineCount).toBe(6); // 1 segment → 6 verts
    expect(mesh.verts.length).toBe(12 * 8);
  });

  it("computes world bounds from the data", () => {
    expect(mesh.boundsX[0]).toBeLessThan(mesh.boundsX[1]);
    expect(mesh.boundsY[0]).toBeLessThan(mesh.boundsY[1]);
    // lon 0 → world x 0.5
    expect(mesh.boundsX[0]).toBeCloseTo(0.5, 6);
  });

  it("keeps the polygon feature (with properties) for picking", () => {
    expect(mesh.features).toHaveLength(1);
    expect(mesh.features[0]!.properties.name).toBe("Region A");
    const poly = mesh.features[0]!.polygons[0]!;
    const [wx, wy] = lonLatToWorld(5, 5); // inside the region
    expect(pointInPolygon(poly, wx, wy)).toBe(true);
    const [ox, oy] = lonLatToWorld(20, 20); // outside
    expect(pointInPolygon(poly, ox, oy)).toBe(false);
  });
});
