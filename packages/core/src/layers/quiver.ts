import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface QuiverOptions {
  /** Arrow anchor positions (data space). */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Vector components at each anchor. */
  u: ArrayLike<number>;
  v: ArrayLike<number>;
  /** Multiplier applied to (u,v) in data units. Default auto-fits the field. */
  scale?: number;
  color?: string | Color;
  /** Shaft thickness in CSS px. Default 1.5. */
  width?: number;
  /** Arrowhead length in CSS px. Default 9. */
  headSize?: number;
  /** Color each arrow by a value (default: its magnitude) through a colormap. */
  colorBy?: {
    values?: ArrayLike<number>;
    colormap?: ColormapName;
    domain?: Range;
  };
  name?: string;
  yAxis?: string;
}

// Shaft: base->tip segment, pixel-thick.
const SHAFT_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // (along 0..1, side -1..1)
layout(location = 1) in vec4 aArrow;   // (bx,by,tx,ty) offset data space
layout(location = 2) in vec4 aColor;
uniform vec2 uResolution;
uniform float uWidth;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vec2 s0 = (dataToClip(aArrow.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aArrow.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = mix(s0, s1, aCorner.x) + nrm * (aCorner.y * uWidth * 0.5);
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

// Head: a screen-space triangle at the tip, pointing along the arrow.
const HEAD_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 1) in vec4 aArrow;   // (bx,by,tx,ty) offset data space
layout(location = 2) in vec4 aColor;
uniform vec2 uResolution;
uniform float uHeadSize;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vec2 s0 = (dataToClip(aArrow.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aArrow.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uHeadSize * 0.6;
  vec2 pos;
  if (gl_VertexID == 0) pos = s1;                                  // tip
  else if (gl_VertexID == 1) pos = s1 - dir * uHeadSize + nrm * w; // back-left
  else pos = s1 - dir * uHeadSize - nrm * w;                       // back-right
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
uniform vec4 uColor;
uniform float uUseVertexColor;
out vec4 outColor;
void main() {
  vec4 c = uUseVertexColor > 0.5 ? vColor : uColor;
  outColor = vec4(c.rgb * c.a, c.a);
}`;

const SEG_CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

type Key = "shaft" | "head";
const cache = new WeakMap<WebGL2RenderingContext, Record<Key, WebGLProgram>>();
function programs(gl: WebGL2RenderingContext): Record<Key, WebGLProgram> {
  let p = cache.get(gl);
  if (!p) {
    p = { shaft: createProgram(gl, SHAFT_VERT, FRAG), head: createProgram(gl, HEAD_VERT, FRAG) };
    cache.set(gl, p);
  }
  return p;
}

let counter = 0;

export class QuiverLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private progs: Record<Key, WebGLProgram>;
  private shaftVao: WebGLVertexArrayObject;
  private headVao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uShaft: Record<string, WebGLUniformLocation | null>;
  private uHead: Record<string, WebGLUniformLocation | null>;
  private color: Color;
  private width: number;
  private headSize: number;
  private useVertexColor: boolean;
  private count: number;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: QuiverOptions) {
    this.id = `quiver-${counter++}`;
    this.gl = gl;
    this.progs = programs(gl);
    const colorInput = opts.color ?? "#3b82f6";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.width = opts.width ?? 1.5;
    this.headSize = opts.headSize ?? 9;
    this.useVertexColor = opts.colorBy != null;

    const n = Math.min(opts.x.length, opts.y.length, opts.u.length, opts.v.length);
    this.count = n;
    this.xRef = n > 0 ? opts.x[0]! : 0;
    this.yRef = n > 0 ? opts.y[0]! : 0;

    // Auto scale so the largest arrow spans ~90% of a nominal grid cell.
    let maxMag = 0;
    for (let i = 0; i < n; i++) maxMag = Math.max(maxMag, Math.hypot(opts.u[i]!, opts.v[i]!));
    let scale = opts.scale;
    if (scale == null) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        minX = Math.min(minX, opts.x[i]!); maxX = Math.max(maxX, opts.x[i]!);
        minY = Math.min(minY, opts.y[i]!); maxY = Math.max(maxY, opts.y[i]!);
      }
      const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
      const cell = diag / Math.max(1, Math.sqrt(n));
      scale = maxMag > 0 ? (0.9 * cell) / maxMag : 1;
    }

    const arrows = new Float32Array(n * 4);
    const colors = new Float32Array(n * 4);
    const cmap = colormap(opts.colorBy?.colormap ?? "viridis");
    const vals = opts.colorBy?.values;
    let lo = opts.colorBy?.domain?.[0] ?? Infinity;
    let hi = opts.colorBy?.domain?.[1] ?? -Infinity;
    if (this.useVertexColor && !opts.colorBy?.domain) {
      for (let i = 0; i < n; i++) {
        const v = vals ? vals[i]! : Math.hypot(opts.u[i]!, opts.v[i]!);
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
    }
    const span = (hi - lo) || 1;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!;
      const tx = x + opts.u[i]! * scale, ty = y + opts.v[i]! * scale;
      arrows[i * 4] = x - this.xRef; arrows[i * 4 + 1] = y - this.yRef;
      arrows[i * 4 + 2] = tx - this.xRef; arrows[i * 4 + 3] = ty - this.yRef;
      if (this.useVertexColor) {
        const v = vals ? vals[i]! : Math.hypot(opts.u[i]!, opts.v[i]!);
        const [r, g, b] = cmap((v - lo) / span);
        colors[i * 4] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = 1;
      }
      minX = Math.min(minX, x, tx); maxX = Math.max(maxX, x, tx);
      minY = Math.min(minY, y, ty); maxY = Math.max(maxY, y, ty);
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, SEG_CORNERS, gl.STATIC_DRAW);
    const arrowBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arrows, gl.STATIC_DRAW);
    const colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    this.buffers = [cornerBuf, arrowBuf, colorBuf];

    this.shaftVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.shaftVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bindInstanceAttribs(arrowBuf, colorBuf);
    gl.bindVertexArray(null);

    // Head VAO uses gl_VertexID for the triangle, only the instanced attribs.
    this.headVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.headVao);
    this.bindInstanceAttribs(arrowBuf, colorBuf);
    gl.bindVertexArray(null);

    this.uShaft = uniformLocations(gl, this.progs.shaft, [
      ...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uWidth", "uUseVertexColor",
    ]);
    this.uHead = uniformLocations(gl, this.progs.head, [
      ...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uHeadSize", "uUseVertexColor",
    ]);
  }

  private bindInstanceAttribs(arrowBuf: WebGLBuffer, colorBuf: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
  }

  bounds() {
    if (this.count === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    if (this.count === 0) return;
    const gl = state.gl;
    const [r, g, b, a] = this.color;
    const uvc = this.useVertexColor ? 1 : 0;

    gl.useProgram(this.progs.shaft);
    setTransformUniforms(gl, this.uShaft, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uShaft.uColor!, r, g, b, a);
    gl.uniform2f(this.uShaft.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uShaft.uWidth!, this.width * state.dpr);
    gl.uniform1f(this.uShaft.uUseVertexColor!, uvc);
    gl.bindVertexArray(this.shaftVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);

    gl.useProgram(this.progs.head);
    setTransformUniforms(gl, this.uHead, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uHead.uColor!, r, g, b, a);
    gl.uniform2f(this.uHead.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uHead.uHeadSize!, this.headSize * state.dpr);
    gl.uniform1f(this.uHead.uUseVertexColor!, uvc);
    gl.bindVertexArray(this.headVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.shaftVao);
    this.gl.deleteVertexArray(this.headVao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
