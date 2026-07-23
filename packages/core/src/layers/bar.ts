import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface BarOptions {
  /** Bar center positions (data space). */
  x: ArrayLike<number>;
  /** Bar top values. */
  y: ArrayLike<number>;
  /** Baseline(s). Number or per-bar array — pass cumulative values to stack. */
  base?: number | ArrayLike<number>;
  /** Bar width in data units. Defaults to 80% of the median spacing. */
  width?: number;
  /** Shift bars by this many data units (use for grouped bars). */
  offset?: number;
  /**
   * `"v"` (default) draws vertical bars: `x` positions along the x axis, `y`
   * values along the y axis. `"h"` draws horizontal bars: `x` positions along the
   * **y** axis, `y` values along the **x** axis, `width` is the bar thickness.
   */
  orientation?: "v" | "h";
  color?: string | Color;
  /**
   * Per-bar colors (overrides {@link color}). Handy for tinting each bar — e.g.
   * volume bars green/red by the candle's direction. Length should match `x`.
   */
  colors?: Array<string | Color>;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  name?: string;
  yAxis?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit rect [0,1]^2
layout(location = 1) in vec4 aRect;    // (x0,y0,x1,y1) offset data space
layout(location = 2) in vec4 aColor;   // per-bar color
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vec2 p = mix(aRect.xy, aRect.zw, aCorner);
  vColor = aColor;
  gl_Position = vec4(dataToClip(p), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

const CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

function toColor(input: string | Color): Color {
  return Array.isArray(input) ? (input as Color) : parseColor(input as string);
}

function medianSpacing(x: ArrayLike<number>, n: number): number {
  if (n < 2) return 1;
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(Math.abs(x[i]! - x[i - 1]!));
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

let counter = 0;

export class BarLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count: number;
  private color: Color;
  private colorsInput?: Array<string | Color>;
  private usage: number;
  private barWidth: number;
  private offset: number;
  private orientation: "v" | "h";
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: BarOptions) {
    this.id = `bar-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    const colorInput = opts.color ?? "#3b82f6";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.usage = bufferUsage(gl, opts.renderType);

    const n = Math.min(opts.x.length, opts.y.length);
    this.count = n;
    this.barWidth = opts.width ?? medianSpacing(opts.x, n) * 0.8;
    this.offset = opts.offset ?? 0;
    this.orientation = opts.orientation ?? "v";
    const rects = this.buildRects(opts.x, opts.y, opts.base, n);
    this.colorsInput = opts.colors;
    const colors = this.buildColors(n);

    const vao = gl.createVertexArray()!;
    this.vao = vao;
    gl.bindVertexArray(vao);
    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rects, this.usage);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    const colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, this.usage);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.buffers = [cornerBuf, rectBuf, colorBuf];

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS]);
  }

  /** Per-bar color array (each bar uses its `colors[i]` or falls back to `color`). */
  private buildColors(n: number): Float32Array {
    const arr = new Float32Array(n * 4);
    const per = this.colorsInput;
    for (let i = 0; i < n; i++) {
      const c = per && per[i] != null ? toColor(per[i]!) : this.color;
      arr[i * 4] = c[0]; arr[i * 4 + 1] = c[1]; arr[i * 4 + 2] = c[2]; arr[i * 4 + 3] = c[3];
    }
    return arr;
  }

  private buildRects(
    x: ArrayLike<number>, y: ArrayLike<number>,
    base: number | ArrayLike<number> | undefined, n: number,
  ): Float32Array {
    const width = this.barWidth, off = this.offset;
    const horizontal = this.orientation === "h";
    const baseAt = (i: number): number =>
      base == null ? 0 : typeof base === "number" ? base : base[i]!;
    // The position axis references x[0]; the value axis references y[0]. Which one
    // is horizontal (x) vs vertical (y) depends on orientation.
    const posRef = n > 0 ? x[0]! : 0;
    const valRef = n > 0 ? y[0]! : 0;
    this.xRef = horizontal ? valRef : posRef;
    this.yRef = horizontal ? posRef : valRef;
    const rects = new Float32Array(n * 4);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const cpos = x[i]! + off;                 // center along the position axis
      const p0 = cpos - width / 2, p1 = cpos + width / 2;
      const b = baseAt(i), val = y[i]!;         // extent along the value axis
      // Emit the rect in actual (axis-x, axis-y) space, offset by the refs.
      const ax0 = horizontal ? b : p0;
      const ax1 = horizontal ? val : p1;
      const ay0 = horizontal ? p0 : b;
      const ay1 = horizontal ? p1 : val;
      rects[i * 4] = ax0 - this.xRef;
      rects[i * 4 + 1] = ay0 - this.yRef;
      rects[i * 4 + 2] = ax1 - this.xRef;
      rects[i * 4 + 3] = ay1 - this.yRef;
      minX = Math.min(minX, ax0, ax1); maxX = Math.max(maxX, ax0, ax1);
      minY = Math.min(minY, ay0, ay1); maxY = Math.max(maxY, ay0, ay1);
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];
    return rects;
  }

  /** Replace bar values (and optionally per-bar colors) and re-upload for streaming. */
  setData(
    x: ArrayLike<number>, y: ArrayLike<number>,
    base?: number | ArrayLike<number>, colors?: Array<string | Color>,
  ): void {
    const n = Math.min(x.length, y.length);
    this.count = n;
    const rects = this.buildRects(x, y, base, n);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffers[1]!);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, rects, this.usage);
    if (colors !== undefined) this.colorsInput = colors;
    const colorArr = this.buildColors(n);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffers[2]!);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, colorArr, this.usage);
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
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
