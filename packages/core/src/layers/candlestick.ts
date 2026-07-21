import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
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
  name?: string;
  yAxis?: string;
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
  private count: number;
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

    const up = toColor(opts.upColor ?? "#26a69a");
    const down = toColor(opts.downColor ?? "#ef5350");
    this.colorCss = toColorCss(up);

    const n = Math.min(opts.x.length, opts.open.length, opts.high.length, opts.low.length, opts.close.length);
    this.count = n;
    const width = opts.width ?? medianSpacing(opts.x, n) * 0.7;
    this.xRef = n > 0 ? opts.x[0]! : 0;
    this.yRef = n > 0 ? opts.open[0]! : 0;

    const rects = new Float32Array(n * 4);
    const wicks = new Float32Array(n * 4);
    const colors = new Float32Array(n * 4);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const cx = opts.x[i]!, o = opts.open[i]!, h = opts.high[i]!, l = opts.low[i]!, c = opts.close[i]!;
      const x0 = cx - width / 2, x1 = cx + width / 2;
      rects[i * 4] = x0 - this.xRef; rects[i * 4 + 1] = o - this.yRef;
      rects[i * 4 + 2] = x1 - this.xRef; rects[i * 4 + 3] = c - this.yRef;
      wicks[i * 4] = cx - this.xRef; wicks[i * 4 + 1] = l - this.yRef;
      wicks[i * 4 + 2] = cx - this.xRef; wicks[i * 4 + 3] = h - this.yRef;
      const col = c >= o ? up : down;
      colors[i * 4] = col[0]; colors[i * 4 + 1] = col[1]; colors[i * 4 + 2] = col[2]; colors[i * 4 + 3] = col[3];
      minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
      minY = Math.min(minY, l); maxY = Math.max(maxY, h);
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    const cornerRect = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerRect);
    gl.bufferData(gl.ARRAY_BUFFER, RECT_CORNERS, gl.STATIC_DRAW);
    const cornerSeg = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.bufferData(gl.ARRAY_BUFFER, SEG_CORNERS, gl.STATIC_DRAW);
    const rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rects, gl.STATIC_DRAW);
    const wickBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wickBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wicks, gl.STATIC_DRAW);
    const colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
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
