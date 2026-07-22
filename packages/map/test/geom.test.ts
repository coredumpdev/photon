import { describe, expect, it } from "vitest";
import { pointInRing, pointInPolygon } from "../src/geom.js";

describe("pointInRing", () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  it("detects inside and outside", () => {
    expect(pointInRing(square, 5, 5)).toBe(true);
    expect(pointInRing(square, -1, 5)).toBe(false);
    expect(pointInRing(square, 15, 5)).toBe(false);
    expect(pointInRing(square, 5, 11)).toBe(false);
  });
  it("works for a concave ring", () => {
    // C-shape opening to the right.
    const c = [0, 0, 10, 0, 10, 3, 3, 3, 3, 7, 10, 7, 10, 10, 0, 10];
    expect(pointInRing(c, 1, 5)).toBe(true); // in the solid left bar
    expect(pointInRing(c, 7, 5)).toBe(false); // in the notch
  });
});

describe("pointInPolygon (with holes)", () => {
  const outer = [0, 0, 10, 0, 10, 10, 0, 10];
  const hole = [3, 3, 7, 3, 7, 7, 3, 7];
  const poly = [outer, hole];
  it("is inside the exterior but not inside a hole", () => {
    expect(pointInPolygon(poly, 1, 1)).toBe(true);
    expect(pointInPolygon(poly, 5, 5)).toBe(false); // in the hole
    expect(pointInPolygon(poly, 20, 20)).toBe(false); // outside
  });
});
