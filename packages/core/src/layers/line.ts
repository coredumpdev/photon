import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { AxisFrame } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import { decimateIndices } from "./line-util.js";
import { GpuDecimator } from "./gpu-decimate.js";
import type { DrawState, Layer } from "./layer.js";

/** Above this point count, decimation runs on the GPU (below, CPU is cheaper). */
const GPU_DECIMATE_MIN = 200_000;

/** How adjacent segments meet at a vertex. */
export type LineJoin = "round" | "miter" | "bevel" | "butt";

export interface LineOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color?: string | Color;
  /** Line width in CSS pixels (real thickness via GPU triangle expansion). */
  width?: number;
  name?: string;
  yAxis?: string;
  step?: "before" | "after" | "center";
  /**
   * How segments meet at each vertex:
   *  - `round` (default) — round caps and joins via an SDF; no seams.
   *  - `miter` — sharp mitered corners, clamped to {@link LineOptions.miterLimit}.
   *  - `bevel` — corners cut flat.
   *  - `butt` — flat ends with no join fill (segments may gap at sharp angles).
   */
  join?: LineJoin;
  /**
   * For `join: "miter"`, the max ratio of miter length to half line-width before
   * a corner falls back to a bevel (prevents spikes at very sharp angles).
   * Default 4.
   */
  miterLimit?: number;
  /**
   * Min/max decimate very large series to ~2 points per pixel column when
   * zoomed out (preserves peaks). Requires monotonic x; auto-detected. Default true.
   */
  decimate?: boolean;
}

// Each segment is an instanced quad, extended and round-capped in the fragment
// shader via a signed-distance test so joins between segments never gap.
const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // (along 0..1, side -1..1)
layout(location = 1) in vec2 aP0;
layout(location = 2) in vec2 aP1;
uniform vec2 uResolution;
uniform float uWidth;
uniform float uRound;
${TRANSFORM_GLSL}
out vec2 vPix;
out vec2 vS0;
out vec2 vS1;
void main() {
  vec2 s0 = (dataToClip(aP0) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aP1) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = uWidth * 0.5 + 1.5;                 // half width + AA margin
  float ext = uRound > 0.5 ? hw : 0.0;           // extend for round caps
  vec2 endpoint = mix(s0, s1, aCorner.x);
  vec2 outward = (aCorner.x < 0.5 ? -dir : dir) * ext;
  vec2 pos = endpoint + outward + nrm * (aCorner.y * hw);
  vPix = pos; vS0 = s0; vS1 = s1;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPix;
in vec2 vS0;
in vec2 vS1;
uniform vec4 uColor;
uniform float uWidth;
uniform float uRound;
out vec4 outColor;
void main() {
  vec2 pa = vPix - vS0;
  vec2 ba = vS1 - vS0;
  float bb = dot(ba, ba);
  float t = bb > 1e-6 ? dot(pa, ba) / bb : 0.0;
  float d;
  if (uRound > 0.5) {
    d = length(pa - ba * clamp(t, 0.0, 1.0));    // round caps/joins
  } else {
    if (t < 0.0 || t > 1.0) discard;             // butt caps
    d = length(pa - ba * t);
  }
  float hw = uWidth * 0.5;
  float alpha = 1.0 - smoothstep(hw - 1.0, hw + 1.0, d);
  if (alpha <= 0.0) discard;
  outColor = vec4(uColor.rgb * uColor.a, uColor.a) * alpha;
}`;

// Miter/bevel join fill: one instanced wedge per interior vertex, filling the
// notch two butt-capped segments leave on the outer side of the turn. The
// geometry mirrors computeJoin() in line-util.ts — keep the two in sync.
const JOIN_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPrev;
layout(location = 1) in vec2 aP0;
layout(location = 2) in vec2 aNext;
uniform vec2 uResolution;
uniform float uWidth;
uniform float uMiter;        // >0.5 => miter, else bevel
uniform float uMiterLimit;
${TRANSFORM_GLSL}
out vec2 vPix;
flat out vec2 vE0;
flat out vec2 vE1;
flat out vec2 vInner;
void main() {
  vec2 sp = (dataToClip(aPrev) * 0.5 + 0.5) * uResolution;
  vec2 s0 = (dataToClip(aP0)   * 0.5 + 0.5) * uResolution;
  vec2 sn = (dataToClip(aNext) * 0.5 + 0.5) * uResolution;
  vec2 din = s0 - sp;
  vec2 dout = sn - s0;
  float inl = length(din), outl = length(dout);
  vec2 inN = vec2(0.0), outN = vec2(0.0);
  float crs = 0.0;
  bool ok = inl > 1e-6 && outl > 1e-6;
  if (ok) {
    din /= inl; dout /= outl;
    inN = vec2(-din.y, din.x);
    outN = vec2(-dout.y, dout.x);
    crs = din.x * dout.y - din.y * dout.x;
    ok = abs(crs) > 1e-6;                         // collinear => no notch
  }
  if (!ok) {                                       // degenerate: cull the wedge
    vE0 = vec2(0.0); vE1 = vec2(0.0); vInner = vec2(0.0); vPix = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float hw = uWidth * 0.5;
  float outerSign = crs > 0.0 ? -1.0 : 1.0;
  vec2 A = s0 + inN * hw * outerSign;
  vec2 B = s0 + outN * hw * outerSign;
  vec2 apex = 0.5 * (A + B);                        // bevel midpoint
  if (uMiter > 0.5) {
    vec2 mN = inN + outN;
    float ml = length(mN);
    if (ml > 1e-6) {
      mN /= ml;
      float denom = dot(mN, outN);
      if (denom > 1e-3) {
        float miterLen = 1.0 / denom;
        if (miterLen <= uMiterLimit) apex = s0 + mN * outerSign * hw * miterLen;
      }
    }
  }
  int vid = gl_VertexID;
  vec2 pos;
  if (vid == 0 || vid == 3) pos = s0;
  else if (vid == 1) pos = A;
  else if (vid == 2 || vid == 4) pos = apex;
  else pos = B;                                    // vid == 5
  if (vid < 3) { vE0 = A; vE1 = apex; }            // triangle [s0, A, apex]
  else { vE0 = apex; vE1 = B; }                    // triangle [s0, apex, B]
  vInner = s0;
  vPix = pos;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

const JOIN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPix;
flat in vec2 vE0;
flat in vec2 vE1;
flat in vec2 vInner;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  vec2 e = vE1 - vE0;
  float el = length(e);
  if (el < 1e-6) discard;
  vec2 n = vec2(-e.y, e.x) / el;
  float sideInner = dot(vInner - vE0, n) >= 0.0 ? 1.0 : -1.0;
  float d = dot(vPix - vE0, n) * sideInner;        // >0 inside the outer edge
  float alpha = clamp(d + 0.5, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  outColor = vec4(uColor.rgb * uColor.a, uColor.a) * alpha;
}`;

const CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

const joinProgramCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getJoinProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = joinProgramCache.get(gl);
  if (!p) { p = createProgram(gl, JOIN_VERT, JOIN_FRAG); joinProgramCache.set(gl, p); }
  return p;
}

function stepExpand(
  xs: ArrayLike<number>, ys: ArrayLike<number>, n: number,
  mode: "before" | "after" | "center",
): { xs: Float64Array; ys: Float64Array } {
  const ox: number[] = [], oy: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i]!, y0 = ys[i]!, x1 = xs[i + 1]!, y1 = ys[i + 1]!;
    if (mode === "center") { const xm = (x0 + x1) / 2; ox.push(x0, xm, xm); oy.push(y0, y0, y1); }
    else if (mode === "after") { ox.push(x0, x1); oy.push(y0, y0); }
    else { ox.push(x0, x0); oy.push(y0, y1); }
  }
  ox.push(xs[n - 1]!); oy.push(ys[n - 1]!);
  return { xs: Float64Array.from(ox), ys: Float64Array.from(oy) };
}

function upperBound(a: Float64Array, v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= v) lo = m + 1; else hi = m; }
  return lo;
}

let counter = 0;

export class LineLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private joinProgram: WebGLProgram;
  private fullVao: WebGLVertexArrayObject;
  private decVao: WebGLVertexArrayObject;
  private joinFullVao: WebGLVertexArrayObject;
  private joinDecVao: WebGLVertexArrayObject;
  private cornerBuf: WebGLBuffer;
  private posBuf: WebGLBuffer;
  private decBuf: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private joinUniforms: Record<string, WebGLUniformLocation | null>;
  private count: number;
  private color: Color;
  private width: number;
  private round: boolean;
  private joinStyle: LineJoin;
  private miterLimit: number;
  private decimateOn: boolean;
  private monotonic: boolean;
  private gpuDec: GpuDecimator | null = null;
  private step?: "before" | "after" | "center";
  private xRef = 0;
  private yRef = 0;
  private xs: Float64Array;
  private ys: Float64Array;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];
  private decKey = "";
  private decSegments = 0;

  constructor(gl: WebGL2RenderingContext, opts: LineOptions) {
    this.id = `line-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.joinProgram = getJoinProgram(gl);
    this.width = opts.width ?? 1.5;
    this.joinStyle = opts.join ?? "round";
    this.round = this.joinStyle === "round";
    this.miterLimit = opts.miterLimit ?? 4;
    this.decimateOn = opts.decimate !== false;
    this.step = opts.step;
    const colorInput = opts.color ?? "#3b82f6";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";

    let n = Math.min(opts.x.length, opts.y.length);
    let xs: ArrayLike<number> = opts.x, ys: ArrayLike<number> = opts.y;
    if (opts.step && n >= 2) { const e = stepExpand(opts.x, opts.y, n, opts.step); xs = e.xs; ys = e.ys; n = e.xs.length; }

    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.xRef = n > 0 ? xs[0]! : 0;
    this.yRef = n > 0 ? ys[0]! : 0;
    const data = new Float32Array(n * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, mono = true;
    for (let i = 0; i < n; i++) {
      const x = xs[i]!, y = ys[i]!;
      this.xs[i] = x; this.ys[i] = y;
      data[i * 2] = x - this.xRef; data[i * 2 + 1] = y - this.yRef;
      if (i > 0 && x < xs[i - 1]!) mono = false;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    this.xBounds = [minX, maxX]; this.yBounds = [minY, maxY];
    this.count = n; this.monotonic = mono;

    this.cornerBuf = gl.createBuffer()!;
    this.posBuf = gl.createBuffer()!;
    this.decBuf = gl.createBuffer()!;
    this.fullVao = gl.createVertexArray()!;
    this.decVao = gl.createVertexArray()!;
    this.joinFullVao = gl.createVertexArray()!;
    this.joinDecVao = gl.createVertexArray()!;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    this.configureVao(this.fullVao, this.posBuf);
    this.configureVao(this.decVao, this.decBuf);
    this.configureJoinVao(this.joinFullVao, this.posBuf);
    this.configureJoinVao(this.joinDecVao, this.decBuf);

    this.uniforms = uniformLocations(gl, this.program, [
      ...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uWidth", "uRound",
    ]);
    this.joinUniforms = uniformLocations(gl, this.joinProgram, [
      ...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uWidth", "uMiter", "uMiterLimit",
    ]);

    this.syncGpu(data, n);
  }

  // Keep the GPU decimation texture in sync for large series; disable it (fall
  // back to CPU decimation) if the context can't support the path.
  private syncGpu(data: Float32Array, n: number): void {
    if (!this.decimateOn || n < GPU_DECIMATE_MIN) { this.disposeGpu(); return; }
    if (!this.gpuDec) {
      const dec = new GpuDecimator(this.gl);
      if (!dec.supported) return;
      this.gpuDec = dec;
    }
    if (!this.gpuDec.setPoints(data, n)) this.disposeGpu();
  }

  private disposeGpu(): void {
    if (this.gpuDec) { this.gpuDec.dispose(); this.gpuDec = null; }
  }

  private configureVao(vao: WebGLVertexArrayObject, pointBuf: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  // Join instances read three consecutive points (prev, p0, next) from the same
  // buffer via overlapping attribute offsets; instance i covers vertex i+1.
  private configureJoinVao(vao: WebGLVertexArrayObject, pointBuf: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
    for (let loc = 0; loc < 3; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 8, loc * 8);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
  }

  bounds() {
    if (this.count === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  nearestByX(x: number): { x: number; y: number; index: number } | null {
    if (this.count === 0) return null;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = Math.abs(this.xs[i]! - x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return { x: this.xs[best]!, y: this.ys[best]!, index: best };
  }

  /** Replace the series data and re-upload the GPU buffer (for streaming). */
  setData(x: ArrayLike<number>, y: ArrayLike<number>): void {
    let n = Math.min(x.length, y.length);
    let xs: ArrayLike<number> = x, ys: ArrayLike<number> = y;
    if (this.step && n >= 2) { const e = stepExpand(x, y, n, this.step); xs = e.xs; ys = e.ys; n = e.xs.length; }
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.xRef = n > 0 ? xs[0]! : 0;
    this.yRef = n > 0 ? ys[0]! : 0;
    const data = new Float32Array(n * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, mono = true;
    for (let i = 0; i < n; i++) {
      const vx = xs[i]!, vy = ys[i]!;
      this.xs[i] = vx; this.ys[i] = vy;
      data[i * 2] = vx - this.xRef; data[i * 2 + 1] = vy - this.yRef;
      if (i > 0 && vx < xs[i - 1]!) mono = false;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    }
    this.xBounds = [minX, maxX]; this.yBounds = [minY, maxY];
    this.count = n; this.monotonic = mono; this.decKey = "";
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);
    this.syncGpu(data, n);
  }

  /**
   * Rebuild the min/max-decimated buffer for the visible x-window if it changed.
   * Returns the segment count to draw from `decVao`, or null to draw everything.
   */
  private decimate(x: AxisFrame, cols: number): number | null {
    if (!this.decimateOn || !this.monotonic || this.count < 4 * cols) return null;
    const target = Math.max(2, cols * 2);
    // Visible index window (with a one-sample margin so lines reach the edges).
    let i0 = upperBound(this.xs, x.lo) - 1;
    let i1 = upperBound(this.xs, x.hi);
    i0 = Math.max(0, i0); i1 = Math.min(this.count - 1, i1);
    const visN = i1 - i0;
    if (visN <= target * 1.5) return null;

    const key = `${i0}:${i1}:${target}`;
    if (key === this.decKey) return this.decSegments;

    // GPU path: reduce the envelope with transform feedback, no main-thread work.
    if (this.gpuDec) {
      const outCount = this.gpuDec.run(i0, i1, cols, this.decBuf);
      if (outCount != null) {
        this.decKey = key;
        this.decSegments = outCount - 1;
        return this.decSegments;
      }
      this.disposeGpu(); // GPU path failed once — stop trying, use CPU below.
    }

    this.decKey = key;
    const indices = decimateIndices(this.ys, i0, i1, cols);
    const out = new Float32Array(indices.length * 2);
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k]!;
      out[k * 2] = this.xs[i]! - this.xRef;
      out[k * 2 + 1] = this.ys[i]! - this.yRef;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.decBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    this.decSegments = indices.length - 1;
    return this.decSegments;
  }

  draw(state: DrawState): void {
    if (this.count < 2) return;
    const gl = state.gl;
    const decSegs = this.decimate(state.x, Math.max(1, Math.round(state.pixelWidth)));
    const decimated = decSegs != null;
    const vao = decimated ? this.decVao : this.fullVao;
    const segments = decimated ? decSegs! : this.count - 1;
    if (segments < 1) return;
    const points = segments + 1;

    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uniforms.uColor!, this.color[0], this.color[1], this.color[2], this.color[3]);
    gl.uniform2f(this.uniforms.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uniforms.uWidth!, this.width * state.dpr);
    // round joins use the SDF cap extension; miter/bevel/butt draw plain rectangles.
    gl.uniform1f(this.uniforms.uRound!, this.round ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, segments);
    gl.bindVertexArray(null);

    // Miter/bevel joins fill the outer notch left between the butt rectangles.
    if ((this.joinStyle === "miter" || this.joinStyle === "bevel") && points >= 3) {
      gl.useProgram(this.joinProgram);
      setTransformUniforms(gl, this.joinUniforms, state.x, state.y, this.xRef, this.yRef);
      gl.uniform4f(this.joinUniforms.uColor!, this.color[0], this.color[1], this.color[2], this.color[3]);
      gl.uniform2f(this.joinUniforms.uResolution!, state.pixelWidth, state.pixelHeight);
      gl.uniform1f(this.joinUniforms.uWidth!, this.width * state.dpr);
      gl.uniform1f(this.joinUniforms.uMiter!, this.joinStyle === "miter" ? 1 : 0);
      gl.uniform1f(this.joinUniforms.uMiterLimit!, this.miterLimit);
      gl.bindVertexArray(decimated ? this.joinDecVao : this.joinFullVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, points - 2);
      gl.bindVertexArray(null);
    }
  }

  dispose(): void {
    const gl = this.gl;
    this.disposeGpu();
    gl.deleteVertexArray(this.fullVao);
    gl.deleteVertexArray(this.decVao);
    gl.deleteVertexArray(this.joinFullVao);
    gl.deleteVertexArray(this.joinDecVao);
    gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.decBuf);
  }
}
