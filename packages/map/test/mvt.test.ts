import { describe, expect, it } from "vitest";
import { decodeMvt, classifyRings, signedArea } from "../src/mvt.js";

// ---- Minimal protobuf encoder, just enough to synthesize a known tile --------
const enc = new TextEncoder();
function varint(n: number): number[] {
  const b: number[] = [];
  while (n > 0x7f) {
    b.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  b.push(n);
  return b;
}
const tag = (field: number, wire: number) => varint((field << 3) | wire);
const lenDelim = (field: number, payload: number[]) => [
  ...tag(field, 2),
  ...varint(payload.length),
  ...payload,
];
const varintField = (field: number, n: number) => [...tag(field, 0), ...varint(n)];
const stringField = (field: number, s: string) => lenDelim(field, [...enc.encode(s)]);
const packed = (field: number, nums: number[]) =>
  lenDelim(field, nums.flatMap((n) => varint(n)));

function buildTile(): Uint8Array {
  // A single 90×90 square ring at tile coords (10,10)-(100,100), extent 4096.
  const geometry = [
    9, // MoveTo, count 1
    20, 20, // zig-zag(10), zig-zag(10)
    26, // LineTo, count 3
    180, 0, // +90, +0
    0, 180, // +0, +90
    179, 0, // −90, +0
    15, // ClosePath, count 1
  ];
  const feature = [
    ...varintField(3, 3), // type = POLYGON
    ...packed(2, [0, 0]), // tags → keys[0]=values[0]
    ...packed(4, geometry),
  ];
  const value = stringField(1, "residential"); // Value.string_value
  const layer = [
    ...varintField(15, 2), // version
    ...stringField(1, "buildings"), // name
    ...varintField(5, 4096), // extent
    ...stringField(3, "class"), // keys[0]
    ...lenDelim(4, value), // values[0]
    ...lenDelim(2, feature), // features[0]
  ];
  return new Uint8Array(lenDelim(3, layer)); // Tile.layers[0]
}

describe("decodeMvt", () => {
  const features = decodeMvt(buildTile());

  it("decodes the layer, type and properties", () => {
    expect(features).toHaveLength(1);
    const f = features[0]!;
    expect(f.layer).toBe("buildings");
    expect(f.type).toBe("polygon");
    expect(f.properties.class).toBe("residential");
  });

  it("normalizes geometry to [0,1] within the tile", () => {
    const ring = features[0]!.rings[0]!;
    expect(ring).toHaveLength(8); // 4 corners, ClosePath adds none
    expect(ring[0]).toBeCloseTo(10 / 4096, 9);
    expect(ring[1]).toBeCloseTo(10 / 4096, 9);
    expect(ring[2]).toBeCloseTo(100 / 4096, 9);
    expect(ring[5]).toBeCloseTo(100 / 4096, 9);
  });
});

describe("signedArea / classifyRings", () => {
  const square = [0, 0, 0, 1, 1, 1, 1, 0]; // one unit ring
  const holeReversed = [0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75];

  const reversePoints = (r: number[]) => {
    const out: number[] = [];
    for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i]!, r[i + 1]!);
    return out;
  };

  it("sign flips with winding order", () => {
    const a = signedArea(square);
    const b = signedArea(reversePoints(square));
    expect(Math.sign(a)).toBe(-Math.sign(b));
    expect(a).not.toBe(0);
  });

  it("keeps a single ring as one polygon", () => {
    expect(classifyRings([square])).toEqual([[square]]);
  });

  it("attaches an opposite-wound ring as a hole", () => {
    const polys = classifyRings([square, holeReversed]);
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(2); // exterior + 1 hole
  });

  it("starts a new polygon on a same-wound ring", () => {
    const far = [2, 2, 2, 3, 3, 3, 3, 2];
    const polys = classifyRings([square, far]);
    expect(polys).toHaveLength(2);
  });
});
