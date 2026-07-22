/**
 * An LRU cache that turns tile addresses into drawable {@link TileMesh}es.
 *
 * `request()` is synchronous and non-blocking: it returns the current entry and,
 * on a miss, kicks off `fetch → decode → tessellate` in the background. When a
 * tile becomes ready it calls `onReady`, which the map layer wires to the plot's
 * redraw so the new geometry appears on the next frame.
 */
import { decodeMvt } from "./mvt.js";
import { buildTileMesh, type TileMesh } from "./mesh.js";
import { tileKey, type TileId } from "./mercator.js";
import type { TileSource } from "./source.js";
import type { MapStyle } from "./style.js";

export type TileStatus = "loading" | "ready" | "empty" | "error";

export interface TileEntry {
  status: TileStatus;
  mesh?: TileMesh;
}

export class TileCache {
  private entries = new Map<string, TileEntry>();
  private controllers = new Map<string, AbortController>();

  constructor(
    private readonly source: TileSource,
    private readonly style: MapStyle,
    private readonly onReady: () => void,
    private readonly maxTiles = 256,
  ) {}

  /** Current entry for a tile, starting a background load on first request. */
  request(tile: TileId): TileEntry {
    const key = tileKey(tile);
    const existing = this.entries.get(key);
    if (existing) {
      this.touch(key, existing);
      return existing;
    }
    const entry: TileEntry = { status: "loading" };
    this.entries.set(key, entry);
    void this.load(tile, key, entry);
    this.evict();
    return entry;
  }

  private async load(tile: TileId, key: string, entry: TileEntry): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(key, controller);
    try {
      const bytes = await this.source.load(tile, controller.signal);
      if (bytes == null) {
        entry.status = "empty";
      } else {
        entry.mesh = buildTileMesh(decodeMvt(bytes), tile, this.style);
        entry.status = "ready";
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // evicted mid-flight
      entry.status = "error";
    } finally {
      this.controllers.delete(key);
      this.onReady();
    }
  }

  /** Move a key to the most-recently-used position. */
  private touch(key: string, entry: TileEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /** Drop least-recently-used tiles (Map preserves insertion order). */
  private evict(): void {
    while (this.entries.size > this.maxTiles) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.controllers.get(oldest)?.abort();
      this.controllers.delete(oldest);
    }
  }

  dispose(): void {
    for (const c of this.controllers.values()) c.abort();
    this.controllers.clear();
    this.entries.clear();
  }
}
