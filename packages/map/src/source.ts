/**
 * Where vector tiles come from. A `TileSource` fetches one tile and returns raw
 * MVT bytes, already decompressed. The default implementation talks to any
 * XYZ `.pbf` endpoint (OpenMapTiles-schema servers: MapTiler, Stadia, a
 * self-hosted tileserver, …). Gzip is undone with the browser-native
 * `DecompressionStream` — no dependency.
 *
 * A PMTiles-archive source (single-file self-hosting) is a natural follow-up;
 * it would implement this same interface.
 */
import type { TileId } from "./mercator.js";

export interface TileSource {
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Attribution string the map layer must display (legal requirement). */
  readonly attribution: string;
  /** Raw MVT bytes for a tile, or `null` if the tile is empty (204/404). */
  load(tile: TileId, signal?: AbortSignal): Promise<Uint8Array | null>;
}

export interface XYZVectorOptions {
  /**
   * URL template with `{z}`/`{x}`/`{y}` (and optional `{s}` subdomain), or a
   * function. Append your API key here, e.g.
   * `https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=YOUR_KEY`.
   */
  url: string | ((tile: TileId) => string);
  attribution: string;
  minZoom?: number;
  maxZoom?: number;
  /** Subdomains cycled through `{s}` (default `["a","b","c"]`). */
  subdomains?: string[];
}

/** Build a `TileSource` for a standard XYZ vector-tile endpoint. */
export function xyzVectorSource(opts: XYZVectorOptions): TileSource {
  const subdomains = opts.subdomains ?? ["a", "b", "c"];
  const urlFor =
    typeof opts.url === "function"
      ? opts.url
      : (tile: TileId): string =>
          opts.url
            .toString()
            .replace("{z}", String(tile.z))
            .replace("{x}", String(tile.x))
            .replace("{y}", String(tile.y))
            .replace("{s}", subdomains[(tile.x + tile.y) % subdomains.length]!);

  return {
    minZoom: opts.minZoom ?? 0,
    maxZoom: opts.maxZoom ?? 14,
    attribution: opts.attribution,
    async load(tile, signal) {
      const res = await fetch(urlFor(tile), { signal });
      if (res.status === 204 || res.status === 404) return null;
      if (!res.ok) throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y} → HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) return null;
      // Undo gzip if the server sent a raw gzip body (magic 0x1f 0x8b).
      return buf[0] === 0x1f && buf[1] === 0x8b ? gunzip(buf) : buf;
    },
  };
}

/** Decompress a gzip buffer using the native DecompressionStream. */
async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(new Blob([buf as unknown as BlobPart])).body!.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
