import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface CandlestickOptions {
  /** Candle positions (data space — e.g. epoch ms on a time axis). */
  x: ArrayLike<number>;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  /** Body width in data units. Defaults to 70% of the median spacing. */
  width?: number;
  /** Close ≥ open color. Default green. */
  upColor?: string | Color;
  /** Close < open color. Default red. */
  downColor?: string | Color;
  /** Wick thickness in CSS px. Default 1.5. */
  wickWidth?: number;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  name?: string;
  yAxis?: string;
}

/** The OHLC of a single candle — used by {@link CandlestickLayer.updateLast}/`appendCandle`. */
export interface Candle {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** New OHLC arrays for {@link CandlestickLayer.setData} (colors/width stay fixed). */
export interface CandlestickData {
  x: ArrayLike<number>;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  /** Optional new body width; keeps the previous width if omitted. */
  width?: number;
}

// Body: an instanced data-space rectangle with a per-candle color.
const BODY_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit rect [0,1]^2
layout(location = 1) in vec4 aRect;    // (x0,y0,x1,y1) offset data space
layout(location = 2) in vec4 aColor;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vec2 p = mix(aRect.xy, aRect.zw, aCorner);
  vColor = aColor;
  gl_Position = vec4(dataToClip(p), 0.0, 1.0);
}`;

// Wick: a data-space low->high segment, pixel-thick, per-candle color.
const WICK_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // (along 0..1, side -1..1)
layout(location = 1) in vec4 aSeg;     // (x0,y0,x1,y1) offset data space
layout(location = 2) in vec4 aColor;
uniform vec2 uResolution;
uniform float uWidth;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vec2 s0 = (dataToClip(aSeg.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aSeg.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = mix(s0, s1, aCorner.x) + nrm * (aCorner.y * uWidth * 0.5);
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

const RECT_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
const SEG_CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

type Key = "body" | "wick";
const cache = new WeakMap<WebGL2RenderingContext, Record<Key, WebGLProgram>>();
function programs(gl: WebGL2RenderingContext): Record<Key, WebGLProgram> {
  let p = cache.get(gl);
  if (!p) {
    p = { body: createProgram(gl, BODY_VERT, FRAG), wick: createProgram(gl, WICK_VERT, FRAG) };
    cache.set(gl, p);
  }
  return p;
}

function medianSpacing(x: ArrayLike<number>, n: number): number {
  if (n < 2) return 1;
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(Math.abs(x[i]! - x[i - 1]!));
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

let counter = 0;

export class CandlestickLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private progs: Record<Key, WebGLProgram>;
  private bodyVao: WebGLVertexArrayObject;
  private wickVao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uBody: Record<string, WebGLUniformLocation | null>;
  private uWick: Record<string, WebGLUniformLocation | null>;
  private wickWidth: number;
  private usage: number;
  private up: Color;
  private down: Color;
  /** Body width in data units (median-derived unless the user fixed it). */
  private bodyWidth = 1;
  private explicitWidth: number | undefined;
  // Retained OHLC (plain arrays so streaming can mutate/grow in place).
  private xs: number[] = [];
  private os: number[] = [];
  private hs: number[] = [];
  private ls: number[] = [];
  private cs: number[] = [];
  private rects = new Float32Array(0);
  private wicks = new Float32Array(0);
  private colors = new Float32Array(0);
  private count = 0;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: CandlestickOptions) {
    this.id = `candlestick-${counter++}`;
    this.gl = gl;
    this.progs = programs(gl);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.wickWidth = opts.wickWidth ?? 1.5;
    this.usage = bufferUsage(gl, opts.renderType);

    this.up = toColor(opts.upColor ?? "#26a69a");
    this.down = toColor(opts.downColor ?? "#ef5350");
    this.colorCss = toColorCss(this.up);

    this.explicitWidth = opts.width;
    this.ingest(opts);
    this.rebuild();

    const cornerRect = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerRect);
    gl.bufferData(gl.ARRAY_BUFFER, RECT_CORNERS, gl.STATIC_DRAW);
    const cornerSeg = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.bufferData(gl.ARRAY_BUFFER, SEG_CORNERS, gl.STATIC_DRAW);
    const rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.rects, this.usage);
    const wickBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wickBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.wicks, this.usage);
    const colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.colors, this.usage);
    this.buffers = [cornerRect, cornerSeg, rectBuf, wickBuf, colorBuf];

    this.bodyVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.bodyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerRect);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    this.wickVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.wickVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, wickBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.uBody = uniformLocations(gl, this.progs.body, [...TRANSFORM_UNIFORMS]);
    this.uWick = uniformLocations(gl, this.progs.wick, [...TRANSFORM_UNIFORMS, "uResolution", "uWidth"]);
  }

  /** Copy the incoming OHLC arrays into the retained plain arrays. */
  private ingest(d: CandlestickData): void {
    const n = Math.min(d.x.length, d.open.length, d.high.length, d.low.length, d.close.length);
    this.xs = Array.from({ length: n }, (_, i) => d.x[i]!);
    this.os = Array.from({ length: n }, (_, i) => d.open[i]!);
    this.hs = Array.from({ length: n }, (_, i) => d.high[i]!);
    this.ls = Array.from({ length: n }, (_, i) => d.low[i]!);
    this.cs = Array.from({ length: n }, (_, i) => d.close[i]!);
    if (d.width != null) this.explicitWidth = d.width;
  }

  /** Write candle `i`'s body rect, wick segment and up/down color into the arrays. */
  private emitCandle(i: number): void {
    const cx = this.xs[i]!, o = this.os[i]!, h = this.hs[i]!, l = this.ls[i]!, c = this.cs[i]!;
    const x0 = cx - this.bodyWidth / 2, x1 = cx + this.bodyWidth / 2;
    const r = this.rects, wk = this.wicks, col = this.colors;
    r[i * 4] = x0 - this.xRef; r[i * 4 + 1] = o - this.yRef;
    r[i * 4 + 2] = x1 - this.xRef; r[i * 4 + 3] = c - this.yRef;
    wk[i * 4] = cx - this.xRef; wk[i * 4 + 1] = l - this.yRef;
    wk[i * 4 + 2] = cx - this.xRef; wk[i * 4 + 3] = h - this.yRef;
    const cc = c >= o ? this.up : this.down;
    col[i * 4] = cc[0]; col[i * 4 + 1] = cc[1]; col[i * 4 + 2] = cc[2]; col[i * 4 + 3] = cc[3];
  }

  /** Recompute width/refs/bounds and refill the vertex arrays from the retained OHLC. */
  private rebuild(): void {
    const n = this.xs.length;
    this.count = n;
    this.bodyWidth = this.explicitWidth ?? medianSpacing(this.xs, n) * 0.7;
    this.rects = new Float32Array(n * 4);
    this.wicks = new Float32Array(n * 4);
    this.colors = new Float32Array(n * 4);
    this.xRef = n > 0 ? this.xs[0]! : 0;
    this.yRef = n > 0 ? this.os[0]! : 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      this.emitCandle(i);
      minX = Math.min(minX, this.xs[i]! - this.bodyWidth / 2);
      maxX = Math.max(maxX, this.xs[i]! + this.bodyWidth / 2);
      minY = Math.min(minY, this.ls[i]!);
      maxY = Math.max(maxY, this.hs[i]!);
    }
    this.xBounds = n > 0 ? [minX, maxX] : [0, 0];
    this.yBounds = n > 0 ? [minY, maxY] : [0, 0];
  }

  /** Re-upload all three per-candle buffers (after a full rebuild). */
  private upload(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
    gl.bufferData(gl.ARRAY_BUFFER, this.rects, this.usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!);
    gl.bufferData(gl.ARRAY_BUFFER, this.wicks, this.usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[4]!);
    gl.bufferData(gl.ARRAY_BUFFER, this.colors, this.usage);
  }

  /** Replace every candle and re-upload (for streaming a whole new window). */
  setData(data: CandlestickData): void {
    this.ingest(data);
    this.rebuild();
    this.upload();
  }

  /**
   * Append one new candle (grows the series). Prefer {@link updateLast} for the
   * in-progress candle and `appendCandle` only when a bar closes and a new one opens.
   */
  appendCandle(c: Candle): void {
    this.xs.push(c.x); this.os.push(c.open); this.hs.push(c.high);
    this.ls.push(c.low); this.cs.push(c.close);
    this.rebuild();
    this.upload();
  }

  /**
   * Update the most recent candle in place — the cheap hot path for a live
   * (forming) bar. Only that candle's 12 floats are re-uploaded; bounds are
   * extended (never shrunk) to include it. No-op when the series is empty.
   */
  updateLast(c: Candle): void {
    const i = this.xs.length - 1;
    if (i < 0) return;
    this.xs[i] = c.x; this.os[i] = c.open; this.hs[i] = c.high;
    this.ls[i] = c.low; this.cs[i] = c.close;
    this.emitCandle(i);
    const gl = this.gl, off = i * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
    gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, this.rects.subarray(off, off + 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!);
    gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, this.wicks.subarray(off, off + 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[4]!);
    gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, this.colors.subarray(off, off + 4));
    this.xBounds = [
      Math.min(this.xBounds[0], c.x - this.bodyWidth / 2),
      Math.max(this.xBounds[1], c.x + this.bodyWidth / 2),
    ];
    this.yBounds = [Math.min(this.yBounds[0], c.low), Math.max(this.yBounds[1], c.high)];
  }

  bounds() {
    if (this.count === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    if (this.count === 0) return;
    const gl = state.gl;

    gl.useProgram(this.progs.wick);
    setTransformUniforms(gl, this.uWick, state.x, state.y, this.xRef, this.yRef);
    gl.uniform2f(this.uWick.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uWick.uWidth!, this.wickWidth * state.dpr);
    gl.bindVertexArray(this.wickVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);

    gl.useProgram(this.progs.body);
    setTransformUniforms(gl, this.uBody, state.x, state.y, this.xRef, this.yRef);
    gl.bindVertexArray(this.bodyVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.bodyVao);
    this.gl.deleteVertexArray(this.wickVao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}

function toColor(input: string | Color): Color {
  return Array.isArray(input) ? (input as Color) : parseColor(input as string);
}
