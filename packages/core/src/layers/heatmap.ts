import { colormapLUT, type ColormapName } from "../color/colormap.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface HeatmapOptions {
  /** Row-major grid values, length `cols * rows` (row 0 at the bottom). */
  values: ArrayLike<number>;
  cols: number;
  rows: number;
  /** Data-space extent the grid spans. */
  extent: { x: Range; y: Range };
  colormap?: ColormapName;
  /** Value range mapped to the colormap. Defaults to the data min/max. */
  domain?: Range;
  /** Bilinear filtering (default true) vs. hard cells. */
  smooth?: boolean;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  yAxis?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;  // offset data space
layout(location = 1) in vec2 aUV;
${TRANSFORM_GLSL}
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  outColor = vec4(c.rgb * c.a, c.a);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class HeatmapLayer implements Layer {
  readonly id: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private texture: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private xRef: number;
  private yRef: number;
  private ext: { x: Range; y: Range };
  // Styling captured at construction, reused by setData.
  private lut: Float32Array;
  private fixedDomain: Range | undefined;
  private cols: number;
  private rows: number;

  constructor(gl: WebGL2RenderingContext, opts: HeatmapOptions) {
    this.id = `heatmap-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.yAxis = opts.yAxis ?? "y";
    this.ext = opts.extent;
    const [x0, x1] = opts.extent.x;
    const [y0, y1] = opts.extent.y;
    this.xRef = x0;
    this.yRef = y0;

    this.lut = colormapLUT(opts.colormap ?? "viridis");
    this.fixedDomain = opts.domain;
    this.cols = opts.cols;
    this.rows = opts.rows;

    const texture = gl.createTexture()!;
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = opts.smooth === false ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    // Bake values into the RGBA texture via the colormap.
    this.uploadValues(opts.values, opts.cols, opts.rows);

    // Quad over the extent: (posX, posY, u, v). v=0 at y0 (row 0 bottom).
    const data = new Float32Array([
      x0 - this.xRef, y0 - this.yRef, 0, 0,
      x1 - this.xRef, y0 - this.yRef, 1, 0,
      x1 - this.xRef, y1 - this.yRef, 1, 1,
      x0 - this.xRef, y0 - this.yRef, 0, 0,
      x1 - this.xRef, y1 - this.yRef, 1, 1,
      x0 - this.xRef, y1 - this.yRef, 0, 1,
    ]);
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS, "uTex"]);
  }

  /** Bake a `cols*rows` value grid into the RGBA data texture via the colormap. */
  private uploadValues(values: ArrayLike<number>, cols: number, rows: number): void {
    const gl = this.gl;
    const lut = this.lut;
    let lo = this.fixedDomain?.[0] ?? Infinity;
    let hi = this.fixedDomain?.[1] ?? -Infinity;
    if (!this.fixedDomain) {
      for (let i = 0; i < values.length; i++) {
        const v = values[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = hi - lo || 1;
    const pixels = new Uint8Array(cols * rows * 4);
    // Direct LUT indexing — no per-cell closure call or tuple allocation.
    for (let i = 0; i < cols * rows; i++) {
      let t = (values[i]! - lo) / span;
      t = t <= 0 ? 0 : t >= 1 ? 1 : t;
      const j = ((t * 255) | 0) * 3;
      pixels[i * 4] = (lut[j]! * 255 + 0.5) | 0;
      pixels[i * 4 + 1] = (lut[j + 1]! * 255 + 0.5) | 0;
      pixels[i * 4 + 2] = (lut[j + 2]! * 255 + 0.5) | 0;
      pixels[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Replace the value grid and re-bake the data texture (for streaming). */
  setData(values: ArrayLike<number>, cols: number = this.cols, rows: number = this.rows): void {
    this.cols = cols;
    this.rows = rows;
    this.uploadValues(values, cols, rows);
  }

  bounds() {
    return { x: this.ext.x, y: this.ext.y };
  }

  draw(state: DrawState): void {
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.uTex!, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteTexture(this.texture);
  }
}
