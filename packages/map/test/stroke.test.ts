import { describe, expect, it } from "vitest";
import { strokePolyline } from "../src/stroke.js";

const WHITE = [1, 1, 1, 1] as const;

describe("strokePolyline", () => {
  it("emits a rectangle ribbon for a straight segment", () => {
    const out: number[] = [];
    strokePolyline([0, 0, 10, 0], 1, WHITE, out);
    expect(out.length).toBe(6 * 8); // 1 segment → 2 triangles
    // A horizontal segment gets a vertical (0,±1) normal.
    for (let i = 0; i < out.length; i += 8) {
      expect(out[i + 2]).toBeCloseTo(0); // nx
      expect(Math.abs(out[i + 3]!)).toBeCloseTo(1); // |ny| = hw
    }
  });

  it("produces one ribbon per open polyline segment (shared corners)", () => {
    const out: number[] = [];
    strokePolyline([0, 0, 10, 0, 10, 10], 1, WHITE, out);
    expect(out.length).toBe(2 * 6 * 8); // 2 segments
  });

  it("loops a closed ring with a miter at every corner", () => {
    const out: number[] = [];
    // square (first == last) → 4 logical points, 4 segments
    strokePolyline([0, 0, 10, 0, 10, 10, 0, 10, 0, 0], 1, WHITE, out);
    expect(out.length).toBe(4 * 6 * 8);
    // A 90° corner miter reaches √2·hw from the vertex.
    let maxMiter = 0;
    for (let i = 0; i < out.length; i += 8) {
      maxMiter = Math.max(maxMiter, Math.hypot(out[i + 2]!, out[i + 3]!));
    }
    expect(maxMiter).toBeCloseTo(Math.SQRT2, 5);
  });

  it("ignores degenerate input", () => {
    const out: number[] = [];
    strokePolyline([1, 1], 1, WHITE, out); // single point
    strokePolyline([0, 0, 1, 1], 0, WHITE, out); // zero width
    expect(out.length).toBe(0);
  });
});
