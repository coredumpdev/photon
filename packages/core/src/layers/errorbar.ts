import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

/** A per-point error, given as one value for all points or an array. */
type ErrInput = ArrayLike<number> | number;

export interface ErrorBarOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Symmetric y error (half-height). Scalar or per-point. */
  yerr?: ErrInput;
  /** Asymmetric y error below/above `y` (overrides `yerr`). */
  yerrLow?: ErrInput;
  yerrHigh?: ErrInput;
  /** Symmetric x error (half-width). Scalar or per-point. */
  xerr?: ErrInput;
  color?: string | Color;
  /** Whisker/cap thickness in CSS px. Default 1.5. */
  width?: number;
  /** Cap length in CSS px (0 hides caps). Default 6. */
  capSize?: number;
  /** Draw I-beam whiskers. Default true. */
  whiskers?: boolean;
  /** Fill a shaded band between the low/high y bounds. Default false. */
  band?: boolean;
  /** Band fill opacity. Default 0.2. */
  bandOpacity?: number;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  name?: string;
  yAxis?: string;
}

/** New positions/errors for {@link ErrorBarLayer.setData} (styling stays fixed). */
export interface ErrorBarData {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  yerr?: ErrInput;
  yerrLow?: ErrInput;
  yerrHigh?: ErrInput;
  xerr?: ErrInput;
}

// Data-space segment expanded to a pixel-thick rect (butt ends).
const SEG_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // (along 0..1, side -1..1)
layout(location = 1) in vec4 aSeg;     // (x0,y0,x1,y1) offset data space
uniform vec2 uResolution;
uniform float uWidth;
${TRANSFORM_GLSL}
void main() {
  vec2 s0 = (dataToClip(aSeg.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aSeg.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = mix(s0, s1, aCorner.x) + nrm * (aCorner.y * uWidth * 0.5);
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

// Pixel-sized tick centered on a data point; orient 0 = horizontal, 1 = vertical.
const CAP_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit quad [-1,1]^2
layout(location = 1) in vec3 aCap;     // (cx, cy, orient) offset data space
uniform vec2 uResolution;
uniform float uCapSize;
uniform float uWidth;
${TRANSFORM_GLSL}
void main() {
  vec2 c = (dataToClip(aCap.xy) * 0.5 + 0.5) * uResolution;
  vec2 h = aCap.z < 0.5 ? vec2(uCapSize * 0.5, uWidth * 0.5) : vec2(uWidth * 0.5, uCapSize * 0.5);
  vec2 pos = c + aCorner * h;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shaded band between the low/high envelope (triangle strip in data space).
const BAND_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;     // offset data space
${TRANSFORM_GLSL}
void main() { gl_Position = vec4(dataToClip(aPos), 0.0, 1.0); }`;

const SOLID_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

const SEG_CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

type Key = "seg" | "cap" | "band";
const cache = new WeakMap<WebGL2RenderingContext, Record<Key, WebGLProgram>>();
function programs(gl: WebGL2RenderingContext): Record<Key, WebGLProgram> {
  let p = cache.get(gl);
  if (!p) {
    p = {
      seg: createProgram(gl, SEG_VERT, SOLID_FRAG),
      cap: createProgram(gl, CAP_VERT, SOLID_FRAG),
      band: createProgram(gl, BAND_VERT, SOLID_FRAG),
    };
    cache.set(gl, p);
  }
  return p;
}

const errAt = (e: ErrInput | undefined, i: number): number =>
  e == null ? 0 : typeof e === "number" ? e : (e[i] ?? 0);

let counter = 0;

export class ErrorBarLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private progs: Record<Key, WebGLProgram>;
  private segVao: WebGLVertexArrayObject;
  private capVao: WebGLVertexArrayObject;
  private bandVao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uSeg: Record<string, WebGLUniformLocation | null>;
  private uCap: Record<string, WebGLUniformLocation | null>;
  private uBand: Record<string, WebGLUniformLocation | null>;
  private color: Color;
  private width: number;
  private capSize: number;
  private bandOpacity: number;
  private showWhiskers: boolean;
  private showBand: boolean;
  private usage: number;
  private segCount = 0;
  private capCount = 0;
  private bandVerts = 0;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: ErrorBarOptions) {
    this.id = `errorbar-${counter++}`;
    this.gl = gl;
    this.progs = programs(gl);
    const colorInput = opts.color ?? "#3b82f6";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.width = opts.width ?? 1.5;
    this.capSize = opts.capSize ?? 6;
    this.bandOpacity = opts.bandOpacity ?? 0.2;
    this.showBand = opts.band === true;
    this.showWhiskers = opts.whiskers ?? true;
    this.usage = bufferUsage(gl, opts.renderType);

    const { segs, caps, band } = this.build(opts);

    const cornerSeg = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.bufferData(gl.ARRAY_BUFFER, SEG_CORNERS, gl.STATIC_DRAW);
    const cornerQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerQuad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);

    const segBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segs, this.usage);
    const capBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, capBuf);
    gl.bufferData(gl.ARRAY_BUFFER, caps, this.usage);
    const bandBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, bandBuf);
    gl.bufferData(gl.ARRAY_BUFFER, band, this.usage);
    this.buffers = [cornerSeg, cornerQuad, segBuf, capBuf, bandBuf];

    // Whisker VAO: unit segment + instanced vec4 endpoints.
    this.segVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    // Cap VAO: unit quad + instanced vec3 (center, orient).
    this.capVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.capVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, capBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    // Band VAO: raw triangle-strip positions.
    this.bandVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.bandVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bandBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.uSeg = uniformLocations(gl, this.progs.seg, [...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uWidth"]);
    this.uCap = uniformLocations(gl, this.progs.cap, [...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uCapSize", "uWidth"]);
    this.uBand = uniformLocations(gl, this.progs.band, [...TRANSFORM_UNIFORMS, "uColor"]);
  }

  /** Recompute refs/bounds/counts and the whisker/cap/band vertex arrays from new data. */
  private build(d: ErrorBarData): { segs: Float32Array; caps: Float32Array; band: Float32Array } {
    const n = Math.min(d.x.length, d.y.length);
    this.xRef = n > 0 ? d.x[0]! : 0;
    this.yRef = n > 0 ? d.y[0]! : 0;

    const segs: number[] = [];   // vec4 per whisker
    const caps: number[] = [];   // vec3 per cap
    const lowPts: Array<[number, number]> = []; // for the band envelope
    const highPts: Array<[number, number]> = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    const hasY = d.yerr != null || d.yerrLow != null || d.yerrHigh != null;
    const hasX = d.xerr != null;

    for (let i = 0; i < n; i++) {
      const x = d.x[i]!, y = d.y[i]!;
      const eyLo = d.yerrLow != null ? errAt(d.yerrLow, i) : errAt(d.yerr, i);
      const eyHi = d.yerrHigh != null ? errAt(d.yerrHigh, i) : errAt(d.yerr, i);
      const ex = errAt(d.xerr, i);
      const yLo = y - eyLo, yHi = y + eyHi;
      const xLo = x - ex, xHi = x + ex;

      if (hasY) {
        segs.push(x - this.xRef, yLo - this.yRef, x - this.xRef, yHi - this.yRef);
        caps.push(x - this.xRef, yLo - this.yRef, 0, x - this.xRef, yHi - this.yRef, 0);
      }
      if (hasX) {
        segs.push(xLo - this.xRef, y - this.yRef, xHi - this.xRef, y - this.yRef);
        caps.push(xLo - this.xRef, y - this.yRef, 1, xHi - this.xRef, y - this.yRef, 1);
      }
      lowPts.push([x - this.xRef, yLo - this.yRef]);
      highPts.push([x - this.xRef, yHi - this.yRef]);

      minX = Math.min(minX, xLo); maxX = Math.max(maxX, xHi);
      minY = Math.min(minY, yLo); maxY = Math.max(maxY, yHi);
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];
    this.segCount = segs.length / 4;
    this.capCount = this.capSize > 0 ? caps.length / 3 : 0;

    // Band as a triangle strip alternating high/low along x.
    const band: number[] = [];
    for (let i = 0; i < n; i++) {
      band.push(highPts[i]![0], highPts[i]![1], lowPts[i]![0], lowPts[i]![1]);
    }
    this.bandVerts = n * 2;

    return { segs: new Float32Array(segs), caps: new Float32Array(caps), band: new Float32Array(band) };
  }

  /** Replace the data and re-upload (for streaming). */
  setData(data: ErrorBarData): void {
    const gl = this.gl;
    const { segs, caps, band } = this.build(data);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
    gl.bufferData(gl.ARRAY_BUFFER, segs, this.usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!);
    gl.bufferData(gl.ARRAY_BUFFER, caps, this.usage);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[4]!);
    gl.bufferData(gl.ARRAY_BUFFER, band, this.usage);
  }

  bounds() {
    if (this.segCount === 0 && this.bandVerts === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    const gl = state.gl;
    const [r, g, b, a] = this.color;

    if (this.showBand && this.bandVerts >= 4) {
      gl.useProgram(this.progs.band);
      setTransformUniforms(gl, this.uBand, state.x, state.y, this.xRef, this.yRef);
      gl.uniform4f(this.uBand.uColor!, r, g, b, a * this.bandOpacity);
      gl.bindVertexArray(this.bandVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.bandVerts);
      gl.bindVertexArray(null);
    }

    if (this.showWhiskers && this.segCount > 0) {
      gl.useProgram(this.progs.seg);
      setTransformUniforms(gl, this.uSeg, state.x, state.y, this.xRef, this.yRef);
      gl.uniform4f(this.uSeg.uColor!, r, g, b, a);
      gl.uniform2f(this.uSeg.uResolution!, state.pixelWidth, state.pixelHeight);
      gl.uniform1f(this.uSeg.uWidth!, this.width * state.dpr);
      gl.bindVertexArray(this.segVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.segCount);
      gl.bindVertexArray(null);

      if (this.capCount > 0) {
        gl.useProgram(this.progs.cap);
        setTransformUniforms(gl, this.uCap, state.x, state.y, this.xRef, this.yRef);
        gl.uniform4f(this.uCap.uColor!, r, g, b, a);
        gl.uniform2f(this.uCap.uResolution!, state.pixelWidth, state.pixelHeight);
        gl.uniform1f(this.uCap.uCapSize!, this.capSize * state.dpr);
        gl.uniform1f(this.uCap.uWidth!, this.width * state.dpr);
        gl.bindVertexArray(this.capVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.capCount);
        gl.bindVertexArray(null);
      }
    }
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.segVao);
    this.gl.deleteVertexArray(this.capVao);
    this.gl.deleteVertexArray(this.bandVao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
