import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Color, Range, RenderType } from "../types.js";
import type { Bounds3, ColorInfo, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface Quiver3DOptions {
  /** Arrow base points. */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  /** Vector components. */
  u: ArrayLike<number>;
  v: ArrayLike<number>;
  w: ArrayLike<number>;
  /** Multiply the vectors before drawing. Default 1. */
  scale?: number;
  color?: string | Color;
  /** Color arrows by magnitude via a colormap. */
  colorBy?: { colormap?: ColormapName; domain?: Range };
  /** Arrowhead length as a fraction of the arrow. Default 0.28. */
  headSize?: number;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main() { vColor = aColor; gl_Position = uMVP * vec4(aPos, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

let counter = 0;

/** A 3D vector field: each arrow is a shaft + a 4-wing arrowhead, drawn as lines. */
export class Quiver3DLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  readonly colorCss?: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertCount!: number;
  private b3!: Bounds3;
  private cInfo: ColorInfo | null = null;
  private positions!: Float32Array;
  private base: Color;
  private scale: number;
  private headSize: number;
  private colorByOpt?: Quiver3DOptions["colorBy"];
  private usage: number;

  constructor(gl: WebGL2RenderingContext, opts: Quiver3DOptions) {
    this.id = `quiver3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    this.usage = bufferUsage(gl, opts.renderType);
    this.scale = opts.scale ?? 1;
    this.headSize = opts.headSize ?? 0.28;
    this.colorByOpt = opts.colorBy;
    this.base = opts.color != null
      ? (Array.isArray(opts.color) ? (opts.color as Color) : parseColor(opts.color as string))
      : [0.5, 0.8, 1, 1] as Color;
    if (!opts.colorBy) this.colorCss = typeof opts.color === "string" ? opts.color : toColorCss(this.base);

    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    this.build(opts.x, opts.y, opts.z, opts.u, opts.v, opts.w);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP"]);
  }

  /** Build the arrow line geometry (shaft + 4-wing head) and (re)upload the vertex buffer. */
  private build(
    x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>,
    u: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>,
  ): void {
    const gl = this.gl;
    const scale = this.scale;
    const headSize = this.headSize;
    const n = Math.min(x.length, y.length, z.length, u.length, v.length, w.length);

    const base = this.base;
    const cmap = this.colorByOpt ? colormap(this.colorByOpt.colormap ?? "viridis") : null;
    // Magnitudes (for colorBy).
    let lo = this.colorByOpt?.domain?.[0] ?? Infinity;
    let hi = this.colorByOpt?.domain?.[1] ?? -Infinity;
    const mag = (i: number) => Math.hypot(u[i]!, v[i]!, w[i]!);
    if (cmap && !this.colorByOpt?.domain) {
      for (let i = 0; i < n; i++) { const m = mag(i); if (m < lo) lo = m; if (m > hi) hi = m; }
    }
    const span = (hi - lo) || 1;
    if (cmap) this.cInfo = { colormap: this.colorByOpt!.colormap ?? "viridis", domain: [lo, hi], label: this.name };

    const data: number[] = [];
    this.positions = new Float32Array(n * 3);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const bump = (x: number, y: number, z: number) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };
    for (let i = 0; i < n; i++) {
      const bx = x[i]!, by = y[i]!, bz = z[i]!;
      const ux = u[i]! * scale, uy = v[i]! * scale, uz = w[i]! * scale;
      const tx = bx + ux, ty = by + uy, tz = bz + uz;
      this.positions[i * 3] = bx; this.positions[i * 3 + 1] = by; this.positions[i * 3 + 2] = bz;
      const c = cmap ? cmap((mag(i) - lo) / span) : [base[0], base[1], base[2]] as [number, number, number];
      const seg = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
        data.push(x0, y0, z0, c[0], c[1], c[2], x1, y1, z1, c[0], c[1], c[2]);
      };
      seg(bx, by, bz, tx, ty, tz); // shaft
      bump(bx, by, bz); bump(tx, ty, tz);
      // Arrowhead: 4 wings back from the tip.
      const len = Math.hypot(ux, uy, uz);
      if (len > 1e-6) {
        const dir = norm(ux, uy, uz);
        const ref: [number, number, number] = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const p1 = norm(...cross(dir, ref));
        const p2 = norm(...cross(dir, p1));
        const hl = len * headSize, hw = hl * 0.5;
        const backX = tx - dir[0] * hl, backY = ty - dir[1] * hl, backZ = tz - dir[2] * hl;
        for (const p of [p1, p2, [-p1[0], -p1[1], -p1[2]] as [number, number, number], [-p2[0], -p2[1], -p2[2]] as [number, number, number]]) {
          seg(tx, ty, tz, backX + p[0] * hw, backY + p[1] * hw, backZ + p[2] * hw);
        }
      }
    }

    this.vertCount = data.length / 6;
    this.b3 = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  /** Stream a new vector field (arrows rebuilt). Call `plot.refresh()` after. */
  setData(
    x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>,
    u: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>,
  ): void {
    this.build(x, y, z, u, v, w);
  }

  bounds3() { return this.vertCount ? this.b3 : null; }

  colorInfo(): ColorInfo | null { return this.cInfo; }

  pickData() { return this.positions.length ? { positions: this.positions } : null; }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.vertCount === 0) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
