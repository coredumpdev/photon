/**
 * Mapbox Vector Tile (MVT) decoder — protobuf in, drawable geometry out.
 *
 * A tile holds named layers ("water", "roads", …); each layer holds features
 * with integer geometry in a tile-local grid of side `extent` (default 4096),
 * origin at the tile's north-west corner, y increasing *southward*. We decode
 * that into rings normalized to `[0,1]` within the tile (`u` east, `v` south),
 * ready for the map layer to place with {@link tileWorldBounds}.
 *
 * Only the read path is implemented, and only the fields a renderer needs.
 * Pure and unit-tested; see the MVT 2.1 spec for the wire layout.
 */
import { Pbf } from "./pbf.js";

export type GeomType = "point" | "line" | "polygon";
export type PropValue = string | number | boolean;

/** One decoded feature. `rings` are flat `[u0,v0,u1,v1,…]`, normalized `[0,1]`. */
export interface MvtFeature {
  layer: string;
  type: GeomType;
  properties: Record<string, PropValue>;
  /** Sub-paths (lines) or rings (polygons); a single entry for points. */
  rings: number[][];
}

interface RawFeature {
  type: number;
  tags: number[];
  geometry: number[];
}

interface RawLayer {
  name: string;
  extent: number;
  keys: string[];
  values: PropValue[];
  features: RawFeature[];
}

const GEOM_TYPE: Record<number, GeomType> = { 1: "point", 2: "line", 3: "polygon" };

/** Decode a whole tile into a flat list of features (all layers concatenated). */
export function decodeMvt(bytes: Uint8Array): MvtFeature[] {
  const pbf = new Pbf(bytes);
  const layers: RawLayer[] = [];
  pbf.readFields((tag, _l, p) => {
    if (tag === 3) layers.push(readLayer(p));
  }, null);

  const out: MvtFeature[] = [];
  for (const layer of layers) {
    for (const f of layer.features) out.push(buildFeature(layer, f));
  }
  return out;
}

function readLayer(pbf: Pbf): RawLayer {
  const layer: RawLayer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  return pbf.readMessage((tag, l: RawLayer, p) => {
    if (tag === 15) p.readVarint(); // version
    else if (tag === 1) l.name = p.readString();
    else if (tag === 2) l.features.push(readFeature(p));
    else if (tag === 3) l.keys.push(p.readString());
    else if (tag === 4) l.values.push(readValue(p));
    else if (tag === 5) l.extent = p.readVarint();
  }, layer);
}

function readFeature(pbf: Pbf): RawFeature {
  const feature: RawFeature = { type: 0, tags: [], geometry: [] };
  return pbf.readMessage((tag, f: RawFeature, p) => {
    if (tag === 1) p.readVarint(); // id (unused)
    else if (tag === 2) p.readPackedVarint(f.tags);
    else if (tag === 3) f.type = p.readVarint();
    else if (tag === 4) p.readPackedVarint(f.geometry);
  }, feature);
}

function readValue(pbf: Pbf): PropValue {
  let value: PropValue = "";
  pbf.readMessage((tag, _r, p) => {
    if (tag === 1) value = p.readString();
    else if (tag === 2) value = p.readFloat();
    else if (tag === 3) value = p.readDouble();
    else if (tag === 4) value = p.readVarint();
    else if (tag === 5) value = p.readVarint();
    else if (tag === 6) value = p.readSVarint();
    else if (tag === 7) value = p.readBoolean();
  }, null);
  return value;
}

function buildFeature(layer: RawLayer, f: RawFeature): MvtFeature {
  const properties: Record<string, PropValue> = {};
  for (let i = 0; i + 1 < f.tags.length; i += 2) {
    const key = layer.keys[f.tags[i]!];
    const val = layer.values[f.tags[i + 1]!];
    if (key !== undefined && val !== undefined) properties[key] = val;
  }
  return {
    layer: layer.name,
    type: GEOM_TYPE[f.type] ?? "point",
    properties,
    rings: decodeGeometry(f.geometry, layer.extent),
  };
}

/**
 * Turn the packed command/parameter integers into normalized sub-paths.
 * Commands: 1 MoveTo, 2 LineTo, 7 ClosePath (params are zig-zag deltas).
 */
function decodeGeometry(geom: number[], extent: number): number[][] {
  const rings: number[][] = [];
  let ring: number[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const inv = 1 / extent;
  while (i < geom.length) {
    const cmd = geom[i++]!;
    const id = cmd & 0x7;
    const count = cmd >> 3;
    if (id === 1 || id === 2) {
      for (let c = 0; c < count; c++) {
        x += unzig(geom[i++]!);
        y += unzig(geom[i++]!);
        if (id === 1 && ring.length) {
          rings.push(ring);
          ring = [];
        }
        ring.push(x * inv, y * inv);
      }
    } else if (id === 7) {
      // ClosePath: the ring is implicitly closed; start a fresh one.
      if (ring.length) rings.push(ring);
      ring = [];
    }
  }
  if (ring.length) rings.push(ring);
  return rings;
}

const unzig = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

/**
 * Group a polygon feature's rings into `[exterior, ...holes]` sets using ring
 * winding, following the MVT rule that a sign change marks a new exterior ring.
 */
export function classifyRings(rings: number[][]): number[][][] {
  if (rings.length <= 1) return [rings];
  const polygons: number[][][] = [];
  let current: number[][] | null = null;
  let exteriorNegative: boolean | undefined;
  for (const ring of rings) {
    const area = signedArea(ring);
    if (area === 0) continue;
    const negative = area < 0;
    if (exteriorNegative === undefined) exteriorNegative = negative;
    if (negative === exteriorNegative) {
      if (current) polygons.push(current);
      current = [ring];
    } else if (current) {
      current.push(ring);
    }
  }
  if (current) polygons.push(current);
  return polygons;
}

/** Twice the signed area of a flat `[x0,y0,…]` ring (sign encodes winding). */
export function signedArea(ring: number[]): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const x1 = ring[i]!;
    const y1 = ring[i + 1]!;
    const x2 = ring[(i + 2) % n]!;
    const y2 = ring[(i + 3) % n]!;
    sum += (x2 - x1) * (y1 + y2);
  }
  return sum;
}
