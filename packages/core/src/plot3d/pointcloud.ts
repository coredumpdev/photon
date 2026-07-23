import { colormapLUT, type ColormapName } from "../color/colormap.js";
import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Color, Range, RenderType } from "../types.js";
import type { Bounds3, ColorInfo, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface PointCloudOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  color?: string | Color;
  /** Uniform point diameter (px) when `sizes` is omitted. Default 4. */
  size?: number;
  /** Per-point diameter (px); overrides `size` where > 0. */
  sizes?: ArrayLike<number>;
  colorBy?: { values: ArrayLike<number>; colormap?: ColormapName; domain?: Range };
  /** Per-point tooltip text (parallel to x/y/z). */
  labels?: ArrayLike<string>;
  /** Series name (legend / colorbar label). */
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;
uniform mat4 uMVP;
uniform float uSize;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
  gl_PointSize = aSize > 0.0 ? aSize : uSize;
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (length(d) > 0.5) discard;
  outColor = vec4(vColor, 1.0);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class PointCloudLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  readonly colorCss?: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count: number;
  private size: number;
  private b3: Bounds3 = { x: [0, 0], y: [0, 0], z: [0, 0] };
  private cInfo: ColorInfo | null = null;
  private positions: Float32Array;
  private labels?: ArrayLike<string>;
  /** Interleaved pos(3)+color(3)+size(1); positions are streamed in place. */
  private data: Float32Array;
  private usage: number;

  constructor(gl: WebGL2RenderingContext, opts: PointCloudOptions) {
    this.id = `points3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.usage = bufferUsage(gl, opts.renderType);
    this.size = opts.size ?? 4;
    this.name = opts.name;
    this.labels = opts.labels;
    const n = Math.min(opts.x.length, opts.y.length, opts.z.length);
    this.count = n;

    const base = opts.color != null
      ? (Array.isArray(opts.color) ? (opts.color as Color) : parseColor(opts.color as string))
      : [0.4, 0.7, 1, 1] as Color;
    const lut = opts.colorBy ? colormapLUT(opts.colorBy.colormap ?? "viridis") : null;
    let lo = opts.colorBy?.domain?.[0] ?? Infinity;
    let hi = opts.colorBy?.domain?.[1] ?? -Infinity;
    if (opts.colorBy && !opts.colorBy.domain) {
      const v = opts.colorBy.values;
      for (let i = 0; i < n; i++) { const t = v[i]!; if (t < lo) lo = t; if (t > hi) hi = t; }
    }
    const span = (hi - lo) || 1;
    // Legend swatch when solid-colored; colorbar info when colored by value.
    if (opts.colorBy) this.cInfo = { colormap: opts.colorBy.colormap ?? "viridis", domain: [lo, hi], label: opts.name };
    else (this as { colorCss?: string }).colorCss = toColorCss(base);

    this.data = new Float32Array(n * 7);
    this.positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!, z = opts.z[i]!;
      this.data[i * 7] = x; this.data[i * 7 + 1] = y; this.data[i * 7 + 2] = z;
      this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
      if (lut && opts.colorBy) {
        let t = (opts.colorBy.values[i]! - lo) / span;
        t = t <= 0 ? 0 : t >= 1 ? 1 : t;
        const j = ((t * 255) | 0) * 3;
        this.data[i * 7 + 3] = lut[j]!; this.data[i * 7 + 4] = lut[j + 1]!; this.data[i * 7 + 5] = lut[j + 2]!;
      } else {
        this.data[i * 7 + 3] = base[0]; this.data[i * 7 + 4] = base[1]; this.data[i * 7 + 5] = base[2];
      }
      this.data[i * 7 + 6] = opts.sizes ? opts.sizes[i]! : 0;
    }
    this.updateBounds();

    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uSize"]);
  }

  private updateBounds(): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const x = this.positions[i * 3]!, y = this.positions[i * 3 + 1]!, z = this.positions[i * 3 + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.b3 = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };
  }

  /** Stream new point positions (same count keeps colors/sizes). Call `plot.refresh()` after. */
  setData(x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): void {
    const n = Math.min(x.length, y.length, z.length, this.count);
    for (let i = 0; i < n; i++) {
      const px = x[i]!, py = y[i]!, pz = z[i]!;
      this.data[i * 7] = px; this.data[i * 7 + 1] = py; this.data[i * 7 + 2] = pz;
      this.positions[i * 3] = px; this.positions[i * 3 + 1] = py; this.positions[i * 3 + 2] = pz;
    }
    this.updateBounds();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.data, this.usage);
  }

  bounds3() { return this.count ? this.b3 : null; }

  colorInfo(): ColorInfo | null { return this.cInfo; }

  pickData() {
    if (!this.count) return null;
    return { positions: this.positions, label: this.labels ? (i: number) => String(this.labels![i]) : undefined };
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.count === 0) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform1f(this.uniforms.uSize!, this.size);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
