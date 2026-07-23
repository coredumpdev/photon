import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range, RenderType } from "../types.js";
import type { Candle, CandlestickData } from "./candlestick.js";
import type { DrawState, Layer } from "./layer.js";

/**
 * An OHLC bar chart — the western cousin of the candlestick. Each period is a
 * vertical low→high line with a left tick at the open and a right tick at the
 * close, colored up/down by direction. Streams like {@link CandlestickLayer}.
 */
export interface OhlcOptions {
  /** Bar positions (data space — e.g. epoch ms on a time axis). */
  x: ArrayLike<number>;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  /** Total tick span in data units (each open/close tick is half of this). Default 70% of median spacing. */
  width?: number;
  /** Close ≥ open color. Default green. */
  upColor?: string | Color;
  /** Close < open color. Default red. */
  downColor?: string | Color;
  /** Line thickness in CSS px. Default 1.5. */
  lineWidth?: number;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  name?: string;
  yAxis?: string;
}

// Pixel-thick data-space segment, per-segment color (same idea as the candle wick).
const SEG_VERT = /* glsl */ `#version 300 es
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

const SEG_CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);
const SEGS_PER_BAR = 3; // vertical low→high, open tick (left), close tick (right)

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, SEG_VERT, FRAG); programCache.set(gl, p); }
  return p;
}

function medianSpacing(x: ArrayLike<number>, n: number): number {
  if (n < 2) return 1;
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(Math.abs(x[i]! - x[i - 1]!));
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

function toColor(input: string | Color): Color {
  return Array.isArray(input) ? (input as Color) : parseColor(input as string);
}

let counter = 0;

export class OhlcLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private lineWidth: number;
  private usage: number;
  private up: Color;
  private down: Color;
  private barWidth = 1;
  private explicitWidth: number | undefined;
  private xs: number[] = [];
  private os: number[] = [];
  private hs: number[] = [];
  private ls: number[] = [];
  private cs: number[] = [];
  private segs = new Float32Array(0);
  private colors = new Float32Array(0);
  private count = 0; // number of bars
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: OhlcOptions) {
    this.id = `ohlc-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.lineWidth = opts.lineWidth ?? 1.5;
    this.usage = bufferUsage(gl, opts.renderType);
    this.up = toColor(opts.upColor ?? "#26a69a");
    this.down = toColor(opts.downColor ?? "#ef5350");
    this.colorCss = toColorCss(this.up);
    this.explicitWidth = opts.width;
    this.ingest(opts);
    this.rebuild();

    const vao = gl.createVertexArray()!;
    this.vao = vao;
    gl.bindVertexArray(vao);
    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, SEG_CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const segBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.segs, this.usage);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    const colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.colors, this.usage);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.buffers = [cornerBuf, segBuf, colorBuf];

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS, "uResolution", "uWidth"]);
  }

  private ingest(d: CandlestickData): void {
    const n = Math.min(d.x.length, d.open.length, d.high.length, d.low.length, d.close.length);
    this.xs = Array.from({ length: n }, (_, i) => d.x[i]!);
    this.os = Array.from({ length: n }, (_, i) => d.open[i]!);
    this.hs = Array.from({ length: n }, (_, i) => d.high[i]!);
    this.ls = Array.from({ length: n }, (_, i) => d.low[i]!);
    this.cs = Array.from({ length: n }, (_, i) => d.close[i]!);
    if (d.width != null) this.explicitWidth = d.width;
  }

  /** Write bar `i`'s three segments (+ colors) at instance base `i * SEGS_PER_BAR`. */
  private emitBar(i: number): void {
    const cx = this.xs[i]!, o = this.os[i]!, h = this.hs[i]!, l = this.ls[i]!, c = this.cs[i]!;
    const half = this.barWidth / 2;
    const s = this.segs, col = this.colors;
    const b = i * SEGS_PER_BAR * 4;
    // vertical low→high
    s[b] = cx - this.xRef; s[b + 1] = l - this.yRef; s[b + 2] = cx - this.xRef; s[b + 3] = h - this.yRef;
    // open tick (left)
    s[b + 4] = cx - half - this.xRef; s[b + 5] = o - this.yRef; s[b + 6] = cx - this.xRef; s[b + 7] = o - this.yRef;
    // close tick (right)
    s[b + 8] = cx - this.xRef; s[b + 9] = c - this.yRef; s[b + 10] = cx + half - this.xRef; s[b + 11] = c - this.yRef;
    const cc = c >= o ? this.up : this.down;
    for (let k = 0; k < SEGS_PER_BAR; k++) {
      const o4 = (i * SEGS_PER_BAR + k) * 4;
      col[o4] = cc[0]; col[o4 + 1] = cc[1]; col[o4 + 2] = cc[2]; col[o4 + 3] = cc[3];
    }
  }

  private rebuild(): void {
    const n = this.xs.length;
    this.count = n;
    this.barWidth = this.explicitWidth ?? medianSpacing(this.xs, n) * 0.7;
    this.segs = new Float32Array(n * SEGS_PER_BAR * 4);
    this.colors = new Float32Array(n * SEGS_PER_BAR * 4);
    this.xRef = n > 0 ? this.xs[0]! : 0;
    this.yRef = n > 0 ? this.os[0]! : 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      this.emitBar(i);
      minX = Math.min(minX, this.xs[i]! - this.barWidth / 2);
      maxX = Math.max(maxX, this.xs[i]! + this.barWidth / 2);
      minY = Math.min(minY, this.ls[i]!);
      maxY = Math.max(maxY, this.hs[i]!);
    }
    this.xBounds = n > 0 ? [minX, maxX] : [0, 0];
    this.yBounds = n > 0 ? [minY, maxY] : [0, 0];
  }

  private upload(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]!);
    gl.bufferData(gl.ARRAY_BUFFER, this.segs, this.usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
    gl.bufferData(gl.ARRAY_BUFFER, this.colors, this.usage);
  }

  /** Replace every bar and re-upload (for streaming a whole new window). */
  setData(data: CandlestickData): void {
    this.ingest(data);
    this.rebuild();
    this.upload();
  }

  /** Append one new bar (grows the series). */
  appendCandle(c: Candle): void {
    this.xs.push(c.x); this.os.push(c.open); this.hs.push(c.high);
    this.ls.push(c.low); this.cs.push(c.close);
    this.rebuild();
    this.upload();
  }

  /** Update the most recent bar in place — the cheap hot path for a live bar. */
  updateLast(c: Candle): void {
    const i = this.xs.length - 1;
    if (i < 0) return;
    this.xs[i] = c.x; this.os[i] = c.open; this.hs[i] = c.high;
    this.ls[i] = c.low; this.cs[i] = c.close;
    this.emitBar(i);
    const gl = this.gl, off = i * SEGS_PER_BAR * 4;
    const span = SEGS_PER_BAR * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]!);
    gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, this.segs.subarray(off, off + span));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
    gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, this.colors.subarray(off, off + span));
    this.xBounds = [
      Math.min(this.xBounds[0], c.x - this.barWidth / 2),
      Math.max(this.xBounds[1], c.x + this.barWidth / 2),
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
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform2f(this.uniforms.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uniforms.uWidth!, this.lineWidth * state.dpr);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count * SEGS_PER_BAR);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
