/**
 * A slippy vector-tile basemap, rendered from scratch on WebGL2 — no mapping
 * library. It plots in Web Mercator "world" coordinates (`[0,1]` each axis,
 * north-up), so data layers projected the same way overlay it directly.
 *
 * Pipeline (all in this package, dependency-free): pick zoom from the view →
 * list visible tiles → {@link TileCache} fetches/decodes/tessellates them →
 * upload one interleaved buffer per tile → draw polygon fills and width-expanded
 * line quads as `TRIANGLES`. Missing tiles fall back to an already-loaded
 * ancestor so there are no blank gaps. Polygon features are kept for
 * {@link MapLayer.pickFeature} hit-testing.
 *
 * Still to come: text labels (glyph atlas + collision).
 */
import { setTransformUniforms, type Range, type DrawState, type Layer } from "@photonviz/core";
import { bindMeshAttribs, getMeshProgram, meshUniforms } from "./mesh-program.js";
import { pointInPolygon } from "./geom.js";
import { lonLatToWorld, pickZoom, tileKey, visibleTiles, type TileId } from "./mercator.js";
import type { PickFeature, TileMesh } from "./mesh.js";
import type { PropValue } from "./mvt.js";
import { defaultStyle, type MapStyle } from "./style.js";
import { TileCache } from "./tile-cache.js";
import type { TileSource } from "./source.js";

export interface MapOptions {
  /** Where tiles come from (e.g. {@link xyzVectorSource} or {@link pmtilesSource}). */
  source: TileSource;
  /** Basemap style; defaults to {@link defaultStyle}. */
  style?: MapStyle;
  /** Initial view `[west, south, east, north]` in degrees. Defaults to the world. */
  bbox?: [number, number, number, number];
  /** Invoked when tiles finish loading, so the host can request a redraw. */
  onUpdate?: () => void;
  /** Cap on cached/GPU-resident tiles. Default 256. */
  maxTiles?: number;
  yAxis?: string;
}

/** A feature hit returned by {@link MapLayer.pickFeature}. */
export interface FeatureHit {
  layer: string;
  properties: Record<string, PropValue>;
}

interface GpuTile {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  fillCount: number;
  lineCount: number;
  originX: number;
  originY: number;
  features: PickFeature[];
  frame: number;
}

let counter = 0;

export class MapLayer implements Layer {
  readonly id: string;
  readonly yAxis: string;
  /** Attribution the host is legally required to display. */
  readonly attribution: string;

  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private cache: TileCache;
  private source: TileSource;
  private gpu = new Map<string, GpuTile>();
  private maxTiles: number;
  private frame = 0;
  private view: { x: Range; y: Range };

  constructor(gl: WebGL2RenderingContext, opts: MapOptions) {
    this.id = `map-${counter++}`;
    this.gl = gl;
    this.yAxis = opts.yAxis ?? "y";
    this.source = opts.source;
    this.attribution = opts.source.attribution;
    this.maxTiles = opts.maxTiles ?? 256;
    this.program = getMeshProgram(gl);
    this.uniforms = meshUniforms(gl, this.program);
    const style = opts.style ?? defaultStyle("light");
    this.cache = new TileCache(this.source, style, () => opts.onUpdate?.(), this.maxTiles);

    if (opts.bbox) {
      const [w, s, e, n] = opts.bbox;
      const [x0, y0] = lonLatToWorld(w, s);
      const [x1, y1] = lonLatToWorld(e, n);
      this.view = { x: [x0, x1], y: [y0, y1] };
    } else {
      this.view = { x: [0, 1], y: [0, 1] };
    }
  }

  bounds(): { x: Range; y: Range } {
    return this.view;
  }

  draw(state: DrawState): void {
    const gl = state.gl;
    this.frame++;
    const worldSpan = Math.max(state.x.hi - state.x.lo, 1e-9);
    const z = pickZoom(worldSpan, state.pixelWidth, this.source.minZoom, this.source.maxZoom);
    const tiles = visibleTiles(state.x.lo, state.y.lo, state.x.hi, state.y.hi, z);

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uWorldPerPixel!, worldSpan / state.pixelWidth);

    // Resolve each visible tile to a ready GPU tile, or a loaded ancestor.
    const ready: GpuTile[] = [];
    const fallbacks = new Set<string>();
    for (const tile of tiles) {
      const key = tileKey(tile);
      let g = this.gpu.get(key);
      if (!g) {
        const entry = this.cache.request(tile);
        if (entry.status === "ready" && entry.mesh) g = this.upload(key, entry.mesh);
      }
      if (g) ready.push(g);
      else {
        const anc = this.findAncestor(tile);
        if (anc) fallbacks.add(anc);
      }
    }

    // Ancestors first (coarse fill), then the crisp tiles on top.
    for (const key of fallbacks) {
      const g = this.gpu.get(key);
      if (g) {
        g.frame = this.frame;
        this.drawTile(gl, state, g);
      }
    }
    for (const g of ready) {
      g.frame = this.frame;
      this.drawTile(gl, state, g);
    }
    this.evictGpu();
  }

  /** Key of the nearest already-loaded ancestor tile, or null. */
  private findAncestor(tile: TileId): string | null {
    let { z, x, y } = tile;
    while (z > this.source.minZoom) {
      z -= 1;
      x >>= 1;
      y >>= 1;
      const key = `${z}/${x}/${y}`;
      if (this.gpu.has(key)) return key;
    }
    return null;
  }

  /** The topmost polygon feature at a world coordinate, or null. */
  pickFeature(worldX: number, worldY: number): FeatureHit | null {
    for (const t of this.gpu.values()) {
      for (const f of t.features) {
        for (const poly of f.polygons) {
          if (pointInPolygon(poly, worldX, worldY)) {
            return { layer: f.layer, properties: f.properties };
          }
        }
      }
    }
    return null;
  }

  private drawTile(gl: WebGL2RenderingContext, state: DrawState, t: GpuTile): void {
    setTransformUniforms(gl, this.uniforms, state.x, state.y, t.originX, t.originY);
    gl.bindVertexArray(t.vao);
    if (t.fillCount > 0) gl.drawArrays(gl.TRIANGLES, 0, t.fillCount);
    if (t.lineCount > 0) gl.drawArrays(gl.TRIANGLES, t.fillCount, t.lineCount);
    gl.bindVertexArray(null);
  }

  private upload(key: string, mesh: TileMesh): GpuTile {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    bindMeshAttribs(gl);
    gl.bindVertexArray(null);

    const gpuTile: GpuTile = {
      vao,
      buffer,
      fillCount: mesh.fillCount,
      lineCount: mesh.lineCount,
      originX: mesh.originX,
      originY: mesh.originY,
      features: mesh.features,
      frame: this.frame,
    };
    this.gpu.set(key, gpuTile);
    return gpuTile;
  }

  /** Free GPU tiles not drawn this frame once we exceed the cap. */
  private evictGpu(): void {
    if (this.gpu.size <= this.maxTiles) return;
    for (const [key, t] of this.gpu) {
      if (this.gpu.size <= this.maxTiles) break;
      if (t.frame === this.frame) continue;
      this.gl.deleteVertexArray(t.vao);
      this.gl.deleteBuffer(t.buffer);
      this.gpu.delete(key);
    }
  }

  dispose(): void {
    for (const t of this.gpu.values()) {
      this.gl.deleteVertexArray(t.vao);
      this.gl.deleteBuffer(t.buffer);
    }
    this.gpu.clear();
    this.cache.dispose();
  }
}
