import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { AxisFrame } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface LineOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color?: string | Color;
  /** Line width in CSS pixels (real thickness via GPU triangle expansion). */
  width?: number;
  name?: string;
  yAxis?: string;
  step?: "before" | "after" | "center";
  /** Round joins/caps (default) or square/butt ends. */
  join?: "round" | "butt";
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

const CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
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
  private fullVao: WebGLVertexArrayObject;
  private decVao: WebGLVertexArrayObject;
  private cornerBuf: WebGLBuffer;
  private posBuf: WebGLBuffer;
  private decBuf: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count: number;
  private color: Color;
  private width: number;
  private round: boolean;
  private decimateOn: boolean;
  private monotonic: boolean;
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
    this.width = opts.width ?? 1.5;
    this.round = (opts.join ?? "round") === "round";
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

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    this.configureVao(this.fullVao, this.posBuf);
    this.configureVao(this.decVao, this.decBuf);

    this.uniforms = uniformLocations(gl, this.program, [
      ...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uWidth", "uRound",
    ]);
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
    this.decKey = key;

    const out: number[] = [];
    const push = (i: number) => out.push(this.xs[i]! - this.xRef, this.ys[i]! - this.yRef);
    push(i0);
    for (let b = 0; b < cols; b++) {
      const lo = i0 + Math.floor((visN * b) / cols);
      const hi = i0 + Math.floor((visN * (b + 1)) / cols);
      if (hi <= lo) continue;
      let iMin = lo, iMax = lo;
      for (let i = lo; i < hi; i++) {
        if (this.ys[i]! < this.ys[iMin]!) iMin = i;
        if (this.ys[i]! > this.ys[iMax]!) iMax = i;
      }
      // Emit the two extremes in index order to preserve the envelope shape.
      if (iMin < iMax) { push(iMin); push(iMax); } else { push(iMax); push(iMin); }
    }
    push(i1);

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.decBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
    this.decSegments = out.length / 2 - 1;
    return this.decSegments;
  }

  draw(state: DrawState): void {
    if (this.count < 2) return;
    const gl = state.gl;
    const decSegs = this.decimate(state.x, Math.max(1, Math.round(state.pixelWidth)));
    const vao = decSegs != null ? this.decVao : this.fullVao;
    const segments = decSegs != null ? decSegs : this.count - 1;
    if (segments < 1) return;

    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uniforms.uColor!, this.color[0], this.color[1], this.color[2], this.color[3]);
    gl.uniform2f(this.uniforms.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uniforms.uWidth!, this.width * state.dpr);
    gl.uniform1f(this.uniforms.uRound!, this.round ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, segments);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteVertexArray(this.fullVao);
    gl.deleteVertexArray(this.decVao);
    gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.decBuf);
  }
}
