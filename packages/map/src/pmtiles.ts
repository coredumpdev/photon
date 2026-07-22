/**
 * A {@link TileSource} that reads a single **PMTiles v3** archive over HTTP
 * range requests — self-hosted, key-free, offline-capable, "our own" tiles.
 *
 * PMTiles packs every tile of a pyramid into one file: a 127-byte header, a
 * root directory, optional leaf directories, and the tile blobs. Looking up a
 * tile is: header → compute its Hilbert tile-id → binary-search the root (and
 * maybe a leaf) directory → range-fetch the blob → gunzip → MVT bytes. Only
 * `bytes=a-b` ranges are fetched, so the whole planet can live in one URL.
 *
 * Build such a file from your own data (GADM / OSM admin boundaries, etc.):
 *   tippecanoe -o admin.pmtiles -Z0 -z12 -l admin --coalesce-densest-as-needed \
 *     gadm_level0.geojson gadm_level1.geojson gadm_level2.geojson
 * then host it statically (S3/R2/any range-capable server) and point here.
 *
 * The header parsing, directory decoding, and Hilbert tile-id math are pure and
 * unit-tested; only `load()` does I/O.
 */
import { Pbf } from "./pbf.js";
import type { TileId } from "./mercator.js";
import type { TileSource } from "./source.js";

const COMPRESSION_GZIP = 2;

export interface PmtilesOptions {
  /** URL of the `.pmtiles` file (server must support HTTP range requests). */
  url?: string;
  /** A local `.pmtiles` file/blob — read via `slice()`, fully offline (no HTTP). */
  blob?: Blob;
  /** An in-memory `.pmtiles` archive (e.g. a bundled asset). */
  data?: ArrayBuffer | Uint8Array;
  attribution: string;
  /** Fallbacks until the header loads; the archive's own min/max then win. */
  minZoom?: number;
  maxZoom?: number;
}

/** Reads a byte range `[offset, offset+length)` from the archive. */
type RangeReader = (offset: number, length: number, signal?: AbortSignal) => Promise<Uint8Array>;

function makeReader(opts: PmtilesOptions): RangeReader {
  if (opts.blob) {
    const blob = opts.blob;
    return async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  }
  if (opts.data) {
    const bytes = opts.data instanceof Uint8Array ? opts.data : new Uint8Array(opts.data);
    return async (offset, length) => bytes.subarray(offset, offset + length);
  }
  if (opts.url) {
    const url = opts.url;
    return async (offset, length, signal) => {
      const res = await fetch(url, {
        signal,
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (!res.ok) throw new Error(`PMTiles range ${offset}+${length} → HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // Some hosts ignore Range and return 200 with the whole file — slice it.
      return res.status === 200 && buf.length > length ? buf.subarray(offset, offset + length) : buf;
    };
  }
  throw new Error("pmtilesSource: one of `url`, `blob`, or `data` is required");
}

/** One PMTiles directory entry: a tile run, or (runLength 0) a leaf pointer. */
export interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

export interface PmtilesHeader {
  rootOffset: number;
  rootLength: number;
  leafOffset: number;
  leafLength: number;
  tileDataOffset: number;
  internalCompression: number;
  tileCompression: number;
  minZoom: number;
  maxZoom: number;
}

/**
 * ZXY → PMTiles tile-id: the number of tiles in all lower zooms, plus the
 * point's position along the Hilbert curve at this zoom.
 */
export function zxyToTileId(z: number, x: number, y: number): number {
  let acc = (Math.pow(4, z) - 1) / 3; // Σ 4^i for i<z (exact for z ≤ 26)
  const n = 1 << z;
  let xx = x;
  let yy = y;
  let d = 0;
  for (let s = n >> 1; s > 0; s = s >> 1) {
    const rx = (xx & s) > 0 ? 1 : 0;
    const ry = (yy & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate the quadrant so the curve stays continuous.
    if (ry === 0) {
      if (rx === 1) {
        xx = s - 1 - xx;
        yy = s - 1 - yy;
      }
      const t = xx;
      xx = yy;
      yy = t;
    }
  }
  return acc + d;
}

const MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]; // "PMTiles"

export function parseHeader(buf: Uint8Array): PmtilesHeader {
  for (let i = 0; i < 7; i++) {
    if (buf[i] !== MAGIC[i]) throw new Error("Not a PMTiles archive (bad magic)");
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u64 = (o: number): number => Number(dv.getBigUint64(o, true));
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    leafOffset: u64(40),
    leafLength: u64(48),
    tileDataOffset: u64(56),
    internalCompression: dv.getUint8(97),
    tileCompression: dv.getUint8(98),
    minZoom: dv.getUint8(100),
    maxZoom: dv.getUint8(101),
  };
}

/** Decode a directory blob (varint arrays: id-deltas, runLengths, lengths, offsets). */
export function deserializeDirectory(buf: Uint8Array): Entry[] {
  const p = new Pbf(buf);
  const n = p.readVarint();
  const entries: Entry[] = new Array(n);
  let tileId = 0;
  for (let i = 0; i < n; i++) {
    tileId += p.readVarint();
    entries[i] = { tileId, offset: 0, length: 0, runLength: 0 };
  }
  for (let i = 0; i < n; i++) entries[i]!.runLength = p.readVarint();
  for (let i = 0; i < n; i++) entries[i]!.length = p.readVarint();
  for (let i = 0; i < n; i++) {
    const v = p.readVarint();
    entries[i]!.offset = v === 0 && i > 0 ? entries[i - 1]!.offset + entries[i - 1]!.length : v - 1;
  }
  return entries;
}

/** Largest entry whose tileId ≤ target (binary search), or null. */
export function findTile(entries: Entry[], tileId: number): Entry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = entries[mid]!.tileId;
    if (tileId < t) hi = mid - 1;
    else if (tileId > t) lo = mid + 1;
    else return entries[mid]!;
  }
  return hi >= 0 ? entries[hi]! : null;
}

async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(new Blob([buf as unknown as BlobPart])).body!.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Build a {@link TileSource} backed by a PMTiles archive — from a URL (HTTP
 * range requests), a local `blob`/`File` (fully offline), or in-memory `data`.
 */
export function pmtilesSource(opts: PmtilesOptions): TileSource {
  const read = makeReader(opts);
  const leafCache = new Map<string, Entry[]>();
  let initPromise: Promise<{ header: PmtilesHeader; root: Entry[] }> | null = null;

  async function decompress(buf: Uint8Array, compression: number): Promise<Uint8Array> {
    if (compression === COMPRESSION_GZIP) return gunzip(buf);
    if (compression <= 1) return buf; // 0 unknown / 1 none
    throw new Error(`PMTiles: unsupported compression ${compression} (only gzip/none)`);
  }

  function init(): Promise<{ header: PmtilesHeader; root: Entry[] }> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // The header + root directory usually fit in the first 16 KB.
      const head = await read(0, 16384);
      const header = parseHeader(head);
      const rootEnd = header.rootOffset + header.rootLength;
      const rootRaw =
        rootEnd <= head.length
          ? head.subarray(header.rootOffset, rootEnd)
          : await read(header.rootOffset, header.rootLength);
      const root = deserializeDirectory(await decompress(rootRaw, header.internalCompression));
      src.minZoom = header.minZoom;
      src.maxZoom = header.maxZoom;
      return { header, root };
    })();
    return initPromise;
  }

  const src: TileSource & { minZoom: number; maxZoom: number } = {
    minZoom: opts.minZoom ?? 0,
    maxZoom: opts.maxZoom ?? 14,
    attribution: opts.attribution,
    async load(tile: TileId, signal?: AbortSignal): Promise<Uint8Array | null> {
      const { header, root } = await init();
      if (tile.z < header.minZoom || tile.z > header.maxZoom) return null;
      const tileId = zxyToTileId(tile.z, tile.x, tile.y);

      let entries = root;
      for (let depth = 0; depth < 4; depth++) {
        const e = findTile(entries, tileId);
        if (!e) return null;
        if (e.runLength === 0) {
          // Leaf-directory pointer — fetch, decode, cache, and descend.
          const key = `${e.offset}:${e.length}`;
          let leaf = leafCache.get(key);
          if (!leaf) {
            const raw = await read(header.leafOffset + e.offset, e.length, signal);
            leaf = deserializeDirectory(await decompress(raw, header.internalCompression));
            leafCache.set(key, leaf);
          }
          entries = leaf;
          continue;
        }
        // Tile entry — confirm the run actually covers this id.
        if (tileId >= e.tileId + e.runLength) return null;
        const raw = await read(header.tileDataOffset + e.offset, e.length, signal);
        return raw.length === 0 ? null : decompress(raw, header.tileCompression);
      }
      return null;
    },
  };

  // Warm the header so min/max zoom are known before the first draw.
  void init().catch(() => {});
  return src;
}
