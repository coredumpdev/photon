import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Color, Range, RenderType } from "../types.js";
import type { Bounds3, ColorInfo, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface Bar3DOptions {
  /** Grid x positions (world). */
  x: ArrayLike<number>;
  /** Grid z positions (world). */
  z: ArrayLike<number>;
  /** Bar heights. */
  y: ArrayLike<number>;
  /** Footprint (world units). Defaults to ~0.7× the median grid spacing. */
  width?: number;
  color?: string | Color;
  /** Color bars via a colormap (over `values`, default the heights). */
  colorBy?: { values?: ArrayLike<number>; colormap?: ColormapName; domain?: Range };
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

// A unit cube: y in [0,1], x/z in [-0.5,0.5], with per-face normals.
function buildCube(): Float32Array {
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [0.5, 0, -0.5], [0.5, 1, 0.5], [0.5, 0, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], [-0.5, 0, 0.5], [-0.5, 1, -0.5], [-0.5, 0, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]] },
    { n: [0, -1, 0], v: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]] },
    { n: [0, 0, 1], v: [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]] },
  ];
  const out: number[] = [];
  for (const f of faces) for (const p of f.v) out.push(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2]);
  return new Float32Array(out);
}
const CUBE = buildCube();

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aCube;   // unit cube (y in [0,1])
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aBase;   // instance x,z
layout(location = 3) in float aHeight;
layout(location = 4) in vec3 aColor;
uniform mat4 uMVP;
uniform float uWidth;
out vec3 vColor;
out vec3 vN;
void main() {
  vec3 world = vec3(aBase.x + aCube.x * uWidth, aCube.y * aHeight, aBase.y + aCube.z * uWidth);
  vColor = aColor;
  vN = aNormal;
  gl_Position = uMVP * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
uniform vec3 uLightDir;
uniform float uAmbient;
out vec4 outColor;
void main() {
  float d = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * d;
  outColor = vec4(vColor * shade, 1.0);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

function medianSpacing(vals: ArrayLike<number>, n: number): number {
  const s = Array.from({ length: n }, (_, i) => vals[i]!).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) { const d = s[i]! - s[i - 1]!; if (d > 1e-9) diffs.push(d); }
  if (!diffs.length) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

let counter = 0;

/** 3D bars (columns) on an x/z grid, lit like the surface and optionally colormapped. */
export class Bar3DLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  readonly colorCss?: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private instBuf!: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count!: number;
  private width!: number;
  private b3!: Bounds3;
  private cInfo: ColorInfo | null = null;
  private positions!: Float32Array;
  private base: Color;
  private optWidth?: number;
  private colorByOpt?: Bar3DOptions["colorBy"];
  private usage: number;
  private lightDir: [number, number, number] = [0.5, 1, 0.35];
  private ambient = 0.35;

  constructor(gl: WebGL2RenderingContext, opts: Bar3DOptions) {
    this.id = `bar3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    this.usage = bufferUsage(gl, opts.renderType);
    this.optWidth = opts.width;
    this.colorByOpt = opts.colorBy;
    this.base = opts.color != null
      ? (Array.isArray(opts.color) ? (opts.color as Color) : parseColor(opts.color as string))
      : [0.24, 0.55, 0.96, 1] as Color;
    if (!opts.colorBy) this.colorCss = opts.color != null && typeof opts.color === "string" ? opts.color : "#3b82f6";

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const cubeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 8);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    this.buffers = [cubeBuf, instBuf];
    this.instBuf = instBuf;

    this.build(opts.x, opts.z, opts.y);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uWidth", "uLightDir", "uAmbient"]);
  }

  /** Build the per-bar instances (base/height/color) and (re)upload the instance buffer. */
  private build(x: ArrayLike<number>, z: ArrayLike<number>, y: ArrayLike<number>): void {
    const gl = this.gl;
    const n = Math.min(x.length, y.length, z.length);
    this.count = n;
    const dx = medianSpacing(x, n), dz = medianSpacing(z, n);
    this.width = this.optWidth ?? Math.min(dx, dz) * 0.7;

    const base = this.base;
    const cvals = this.colorByOpt?.values ?? (this.colorByOpt ? y : null);
    const cmap = this.colorByOpt ? colormap(this.colorByOpt.colormap ?? "viridis") : null;
    let lo = this.colorByOpt?.domain?.[0] ?? Infinity;
    let hi = this.colorByOpt?.domain?.[1] ?? -Infinity;
    if (cmap && cvals && !this.colorByOpt?.domain) {
      for (let i = 0; i < n; i++) { const v = cvals[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const span = (hi - lo) || 1;
    if (cmap) this.cInfo = { colormap: this.colorByOpt!.colormap ?? "viridis", domain: [lo, hi], label: this.name };

    // Instance buffer: base(2) + height(1) + color(3).
    const inst = new Float32Array(n * 6);
    this.positions = new Float32Array(n * 3); // bar tops, for hover picking
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = 0, maxY = 0;
    const hw = this.width / 2;
    for (let i = 0; i < n; i++) {
      const px = x[i]!, pz = z[i]!, h = y[i]!;
      inst[i * 6] = px; inst[i * 6 + 1] = pz; inst[i * 6 + 2] = h;
      this.positions[i * 3] = px; this.positions[i * 3 + 1] = h; this.positions[i * 3 + 2] = pz;
      let c: [number, number, number];
      if (cmap && cvals) c = cmap((cvals[i]! - lo) / span);
      else c = [base[0], base[1], base[2]];
      inst[i * 6 + 3] = c[0]; inst[i * 6 + 4] = c[1]; inst[i * 6 + 5] = c[2];
      if (px - hw < minX) minX = px - hw; if (px + hw > maxX) maxX = px + hw;
      if (pz - hw < minZ) minZ = pz - hw; if (pz + hw > maxZ) maxZ = pz + hw;
      if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
    this.b3 = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst, this.usage);
  }

  /** Stream new bar positions/heights (instances rebuilt). Call `plot.refresh()` after. */
  setData(x: ArrayLike<number>, z: ArrayLike<number>, y: ArrayLike<number>): void {
    this.build(x, z, y);
  }

  bounds3() { return this.count ? this.b3 : null; }

  colorInfo(): ColorInfo | null { return this.cInfo; }

  pickData() { return this.count ? { positions: this.positions } : null; }

  /** Set the light direction (world space) and ambient term (0..1). */
  setLight(dir: [number, number, number], ambient: number): void {
    this.lightDir = dir;
    this.ambient = ambient;
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.count === 0) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform1f(this.uniforms.uWidth!, this.width);
    gl.uniform3f(this.uniforms.uLightDir!, this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    gl.uniform1f(this.uniforms.uAmbient!, this.ambient);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
