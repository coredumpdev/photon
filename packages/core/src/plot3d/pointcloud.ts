import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import type { Color, Range } from "../types.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface PointCloudOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  color?: string | Color;
  size?: number;
  colorBy?: { values: ArrayLike<number>; colormap?: ColormapName; domain?: Range };
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uMVP;
uniform float uSize;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
  gl_PointSize = uSize;
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
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count: number;
  private size: number;
  private b3: Bounds3;

  constructor(gl: WebGL2RenderingContext, opts: PointCloudOptions) {
    this.id = `points3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.size = opts.size ?? 4;
    const n = Math.min(opts.x.length, opts.y.length, opts.z.length);
    this.count = n;

    const base = opts.color != null
      ? (Array.isArray(opts.color) ? (opts.color as Color) : parseColor(opts.color as string))
      : [0.4, 0.7, 1, 1] as Color;
    const cmap = opts.colorBy ? colormap(opts.colorBy.colormap ?? "viridis") : null;
    let lo = opts.colorBy?.domain?.[0] ?? Infinity;
    let hi = opts.colorBy?.domain?.[1] ?? -Infinity;
    if (opts.colorBy && !opts.colorBy.domain) {
      const v = opts.colorBy.values;
      for (let i = 0; i < n; i++) { const t = v[i]!; if (t < lo) lo = t; if (t > hi) hi = t; }
    }
    const span = (hi - lo) || 1;

    const data = new Float32Array(n * 6);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!, z = opts.z[i]!;
      data[i * 6] = x; data[i * 6 + 1] = y; data[i * 6 + 2] = z;
      let c: [number, number, number];
      if (cmap && opts.colorBy) c = cmap((opts.colorBy.values[i]! - lo) / span);
      else c = [base[0], base[1], base[2]];
      data[i * 6 + 3] = c[0]; data[i * 6 + 4] = c[1]; data[i * 6 + 5] = c[2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.b3 = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };

    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uSize"]);
  }

  bounds3() { return this.count ? this.b3 : null; }

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
