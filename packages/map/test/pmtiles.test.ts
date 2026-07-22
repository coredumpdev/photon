import { afterEach, describe, expect, it } from "vitest";
import {
  zxyToTileId,
  deserializeDirectory,
  findTile,
  parseHeader,
  pmtilesSource,
} from "../src/pmtiles.js";

function varint(n: number): number[] {
  const b: number[] = [];
  while (n > 0x7f) {
    b.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  b.push(n);
  return b;
}

describe("zxyToTileId", () => {
  it("matches the known Hilbert ordering", () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    // z1 base = 1; Hilbert order (0,0)→1 (0,1)→2 (1,1)→3 (1,0)→4
    expect(zxyToTileId(1, 0, 0)).toBe(1);
    expect(zxyToTileId(1, 0, 1)).toBe(2);
    expect(zxyToTileId(1, 1, 1)).toBe(3);
    expect(zxyToTileId(1, 1, 0)).toBe(4);
  });

  it("gives every z2 tile a distinct id in [5, 20]", () => {
    const ids = new Set<number>();
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) ids.add(zxyToTileId(2, x, y));
    expect(ids.size).toBe(16);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(5); // base = (4^2−1)/3 = 5
      expect(id).toBeLessThan(21);
    }
  });
});

describe("deserializeDirectory / findTile", () => {
  // 3 entries: ids 0,1,5 — entry1 contiguous (offset 0), entry2 explicit.
  const buf = new Uint8Array([
    ...varint(3), // numEntries
    ...varint(0), ...varint(1), ...varint(4), // id deltas → 0,1,5
    ...varint(1), ...varint(1), ...varint(1), // runLengths
    ...varint(100), ...varint(50), ...varint(30), // lengths
    ...varint(1), ...varint(0), ...varint(201), // offsets → 0, (0+100)=100, 200
  ]);
  const entries = deserializeDirectory(buf);

  it("decodes ids, lengths and offsets (including contiguous run)", () => {
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.tileId)).toEqual([0, 1, 5]);
    expect(entries.map((e) => e.offset)).toEqual([0, 100, 200]);
    expect(entries.map((e) => e.length)).toEqual([100, 50, 30]);
  });

  it("finds the entry with the largest id ≤ target", () => {
    expect(findTile(entries, 1)!.tileId).toBe(1);
    expect(findTile(entries, 3)!.tileId).toBe(1); // gap → falls back to id 1
    expect(findTile(entries, 5)!.tileId).toBe(5);
    expect(findTile(entries, 99)!.tileId).toBe(5);
    expect(findTile(entries, 0)!.tileId).toBe(0);
  });
});

describe("parseHeader", () => {
  it("reads offsets, compression and zoom from a v3 header", () => {
    const buf = new Uint8Array(127);
    buf.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73], 0); // "PMTiles"
    buf[7] = 3;
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(8, 127n, true); // rootOffset
    dv.setBigUint64(16, 40n, true); // rootLength
    dv.setBigUint64(56, 1000n, true); // tileDataOffset
    buf[97] = 2; // internal compression = gzip
    buf[98] = 2; // tile compression = gzip
    buf[100] = 0; // minZoom
    buf[101] = 12; // maxZoom
    const h = parseHeader(buf);
    expect(h.rootOffset).toBe(127);
    expect(h.rootLength).toBe(40);
    expect(h.tileDataOffset).toBe(1000);
    expect(h.internalCompression).toBe(2);
    expect(h.tileCompression).toBe(2);
    expect(h.minZoom).toBe(0);
    expect(h.maxZoom).toBe(12);
  });

  it("rejects a non-PMTiles buffer", () => {
    expect(() => parseHeader(new Uint8Array(127))).toThrow(/PMTiles/);
  });
});

// ---- End-to-end load path over a mocked range-serving fetch -----------------
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Response(data).body!.pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal single-tile (z0) PMTiles archive: header + raw root dir + gzip tile. */
function buildArchive(tileGz: Uint8Array): Uint8Array {
  const dir = new Uint8Array([
    ...varint(1), // numEntries
    ...varint(0), // id delta → tileId 0
    ...varint(1), // runLength
    ...varint(tileGz.length), // length
    ...varint(1), // offset 0 (encoded as 1)
  ]);
  const rootOffset = 127;
  const tileDataOffset = rootOffset + dir.length;
  const buf = new Uint8Array(tileDataOffset + tileGz.length);
  buf.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73], 0);
  buf[7] = 3;
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(8, BigInt(rootOffset), true);
  dv.setBigUint64(16, BigInt(dir.length), true);
  dv.setBigUint64(56, BigInt(tileDataOffset), true);
  buf[97] = 1; // internal compression: none (raw directory)
  buf[98] = 2; // tile compression: gzip
  buf[100] = 0; // minZoom
  buf[101] = 5; // maxZoom
  buf.set(dir, rootOffset);
  buf.set(tileGz, tileDataOffset);
  return buf;
}

describe("pmtilesSource.load (end-to-end)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("fetches ranges, walks the directory, and gunzips the tile", async () => {
    const tile = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const archive = buildArchive(await gzip(tile));
    globalThis.fetch = (async (_url: string, init: { headers: { Range: string } }) => {
      const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;
      return new Response(archive.slice(+m[1], +m[2] + 1), { status: 206 });
    }) as unknown as typeof fetch;

    const src = pmtilesSource({ url: "http://x/a.pmtiles", attribution: "t" });
    const got = await src.load({ z: 0, x: 0, y: 0 });
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(tile));

    expect(await src.load({ z: 1, x: 1, y: 1 })).toBeNull(); // absent tile
    expect(await src.load({ z: 9, x: 0, y: 0 })).toBeNull(); // out of zoom range
  });
});

describe("pmtilesSource.load (leaf directories)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("descends a leaf directory to reach the tile", async () => {
    const tile = new Uint8Array([42, 7, 7, 42]);
    const tileGz = await gzip(tile);
    // Leaf dir: one tile entry (id 0, runLength 1) at tile-data offset 0.
    const leaf = new Uint8Array([
      ...varint(1), ...varint(0), ...varint(1), ...varint(tileGz.length), ...varint(1),
    ]);
    // Root dir: one leaf pointer (runLength 0) → leaf section offset 0.
    const root = new Uint8Array([
      ...varint(1), ...varint(0), ...varint(0), ...varint(leaf.length), ...varint(1),
    ]);
    const rootOffset = 127;
    const leafOffset = rootOffset + root.length;
    const tileDataOffset = leafOffset + leaf.length;
    const buf = new Uint8Array(tileDataOffset + tileGz.length);
    buf.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73], 0);
    buf[7] = 3;
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(8, BigInt(rootOffset), true);
    dv.setBigUint64(16, BigInt(root.length), true);
    dv.setBigUint64(40, BigInt(leafOffset), true);
    dv.setBigUint64(48, BigInt(leaf.length), true);
    dv.setBigUint64(56, BigInt(tileDataOffset), true);
    buf[97] = 1; // internal none
    buf[98] = 2; // tile gzip
    buf[100] = 0;
    buf[101] = 5;
    buf.set(root, rootOffset);
    buf.set(leaf, leafOffset);
    buf.set(tileGz, tileDataOffset);

    globalThis.fetch = (async (_url: string, init: { headers: { Range: string } }) => {
      const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;
      return new Response(buf.slice(+m[1], +m[2] + 1), { status: 206 });
    }) as unknown as typeof fetch;

    const src = pmtilesSource({ url: "http://x/leaf.pmtiles", attribution: "t" });
    const got = await src.load({ z: 0, x: 0, y: 0 });
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(tile));
  });
});

describe("pmtilesSource.load (offline, no HTTP)", () => {
  it("reads a tile from an in-memory archive via `data`", async () => {
    const tile = new Uint8Array([1, 2, 3, 4, 5]);
    const archive = buildArchive(await gzip(tile));
    const src = pmtilesSource({ data: archive, attribution: "offline" });
    const got = await src.load({ z: 0, x: 0, y: 0 });
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(tile));
    expect(await src.load({ z: 9, x: 0, y: 0 })).toBeNull();
  });

  it("reads a tile from a local Blob via `slice()` (browser file path)", async () => {
    const tile = new Uint8Array([7, 7, 7]);
    const archive = buildArchive(await gzip(tile));
    const blob = new Blob([archive]);
    const src = pmtilesSource({ blob, attribution: "offline" });
    const got = await src.load({ z: 0, x: 0, y: 0 });
    expect(Array.from(got!)).toEqual(Array.from(tile));
  });

  it("throws if no source is given", () => {
    expect(() => pmtilesSource({ attribution: "x" })).toThrow(/url.*blob.*data/);
  });
});
