/**
 * A static vector layer rendered from a GeoJSON FeatureCollection — a whole
 * self-contained map from one file (no tiles, no server, no API key). Reuses the
 * shared mesh program (fills + thick lines) and supports feature picking.
 */
import { setTransformUniforms, type DrawState, type Layer, type Range } from "@photonviz/core";
import { pointInPolygon } from "./geom.js";
import { buildGeoJsonMesh, type GeoJsonFeatureCollection } from "./geojson.js";
import type { FeatureHit } from "./map-layer.js";
import { bindMeshAttribs, getMeshProgram, meshUniforms } from "./mesh-program.js";
import type { PickFeature } from "./mesh.js";
import { defaultGeoJsonStyle, type MapStyle } from "./style.js";

export interface GeoJsonOptions {
  geojson: GeoJsonFeatureCollection;
  /** Basemap style; defaults to {@link defaultGeoJsonStyle}. */
  style?: MapStyle;
  /** Name handed to `style.paint(layer, …)` so a style can switch on it. Default `"geojson"`. */
  layer?: string;
  yAxis?: string;
}

let counter = 0;

export class GeoJsonLayer implements Layer {
  readonly id: string;
  readonly yAxis: string;

  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private fillCount: number;
  private lineCount: number;
  private originX: number;
  private originY: number;
  private features: PickFeature[];
  private view: { x: Range; y: Range };

  constructor(gl: WebGL2RenderingContext, opts: GeoJsonOptions) {
    this.id = `geojson-${counter++}`;
    this.gl = gl;
    this.yAxis = opts.yAxis ?? "y";
    this.program = getMeshProgram(gl);
    this.uniforms = meshUniforms(gl, this.program);

    const mesh = buildGeoJsonMesh(opts.geojson, opts.style ?? defaultGeoJsonStyle("dark"), opts.layer);
    this.fillCount = mesh.fillCount;
    this.lineCount = mesh.lineCount;
    this.originX = mesh.originX;
    this.originY = mesh.originY;
    this.features = mesh.features;
    this.view = { x: mesh.boundsX, y: mesh.boundsY };

    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    bindMeshAttribs(gl);
    gl.bindVertexArray(null);
  }

  bounds(): { x: Range; y: Range } {
    return this.view;
  }

  /** The topmost polygon feature at a world coordinate, or null. */
  pickFeature(worldX: number, worldY: number): FeatureHit | null {
    for (const f of this.features) {
      for (const poly of f.polygons) {
        if (pointInPolygon(poly, worldX, worldY)) return { layer: f.layer, properties: f.properties };
      }
    }
    return null;
  }

  draw(state: DrawState): void {
    const gl = state.gl;
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uWorldPerPixel!, (state.x.hi - state.x.lo) / state.pixelWidth);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.originX, this.originY);
    gl.bindVertexArray(this.vao);
    if (this.fillCount > 0) gl.drawArrays(gl.TRIANGLES, 0, this.fillCount);
    if (this.lineCount > 0) gl.drawArrays(gl.TRIANGLES, this.fillCount, this.lineCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
