import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";
import { pickNearest, type PickMode, type Picked } from "./pick.js";

export interface StemOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Where stems start. Default 0. */
  baseline?: number;
  color?: string | Color;
  /** Stem thickness in CSS px. Default 1.5. */
  width?: number;
  /** Tip marker diameter in CSS px (0 hides). Default 6. */
  markerSize?: number;
  name?: string;
  yAxis?: string;
}

// Vertical stem: a data-space segment from (x, base) to (x, y), pixel-thick.
const STEM_VERT = /* glsl */ `#version 300 es
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

const MARKER_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit quad [-1,1]^2
layout(location = 1) in vec2 aPos;     // tip point (offset data space)
uniform vec2 uResolution;
uniform float uSize;                   // radius in device px
${TRANSFORM_GLSL}
out vec2 vLocal;
void main() {
  vec2 c = (dataToClip(aPos) * 0.5 + 0.5) * uResolution;
  vLocal = aCorner;
  vec2 pos = c + aCorner * uSize;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

const SOLID_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

const DISC_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float alpha = smoothstep(1.0, 1.0 - 0.15, r);
  outColor = vec4(uColor.rgb * uColor.a * alpha, uColor.a * alpha);
}`;

const SEG_CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

type Key = "stem" | "marker";
const cache = new WeakMap<WebGL2RenderingContext, Record<Key, WebGLProgram>>();
function programs(gl: WebGL2RenderingContext): Record<Key, WebGLProgram> {
  let p = cache.get(gl);
  if (!p) {
    p = { stem: createProgram(gl, STEM_VERT, SOLID_FRAG), marker: createProgram(gl, MARKER_VERT, DISC_FRAG) };
    cache.set(gl, p);
  }
  return p;
}

let counter = 0;

export class StemLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private progs: Record<Key, WebGLProgram>;
  private stemVao: WebGLVertexArrayObject;
  private markerVao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uStem: Record<string, WebGLUniformLocation | null>;
  private uMarker: Record<string, WebGLUniformLocation | null>;
  private color: Color;
  private width: number;
  private markerSize: number;
  private count: number;
  private baseline: number;
  private xRef = 0;
  private yRef = 0;
  private xs: Float64Array;
  private ys: Float64Array;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: StemOptions) {
    this.id = `stem-${counter++}`;
    this.gl = gl;
    this.progs = programs(gl);
    const colorInput = opts.color ?? "#3b82f6";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.width = opts.width ?? 1.5;
    this.markerSize = opts.markerSize ?? 6;
    this.baseline = opts.baseline ?? 0;

    const n = Math.min(opts.x.length, opts.y.length);
    this.count = n;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.xRef = n > 0 ? opts.x[0]! : 0;
    this.yRef = n > 0 ? opts.y[0]! : 0;

    const segs = new Float32Array(n * 4);
    const tips = new Float32Array(n * 2);
    let minX = Infinity, maxX = -Infinity;
    let minY = Math.min(this.baseline, Infinity), maxY = Math.max(this.baseline, -Infinity);
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!;
      this.xs[i] = x; this.ys[i] = y;
      segs[i * 4] = x - this.xRef; segs[i * 4 + 1] = this.baseline - this.yRef;
      segs[i * 4 + 2] = x - this.xRef; segs[i * 4 + 3] = y - this.yRef;
      tips[i * 2] = x - this.xRef; tips[i * 2 + 1] = y - this.yRef;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    const cornerSeg = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.bufferData(gl.ARRAY_BUFFER, SEG_CORNERS, gl.STATIC_DRAW);
    const cornerQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerQuad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);
    const segBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segs, gl.STATIC_DRAW);
    const tipBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, tipBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tips, gl.STATIC_DRAW);
    this.buffers = [cornerSeg, cornerQuad, segBuf, tipBuf];

    this.stemVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.stemVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerSeg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    this.markerVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.markerVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tipBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.uStem = uniformLocations(gl, this.progs.stem, [...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uWidth"]);
    this.uMarker = uniformLocations(gl, this.progs.marker, [...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uSize"]);
  }

  bounds() {
    if (this.count === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  pick(
    mode: PickMode,
    cursorPx: number,
    cursorPy: number,
    project: (x: number, y: number) => [number, number],
  ): Picked | null {
    return pickNearest(this.xs, this.ys, this.count, mode, cursorPx, cursorPy, project);
  }

  draw(state: DrawState): void {
    if (this.count === 0) return;
    const gl = state.gl;
    const [r, g, b, a] = this.color;

    gl.useProgram(this.progs.stem);
    setTransformUniforms(gl, this.uStem, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uStem.uColor!, r, g, b, a);
    gl.uniform2f(this.uStem.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uStem.uWidth!, this.width * state.dpr);
    gl.bindVertexArray(this.stemVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);

    if (this.markerSize > 0) {
      gl.useProgram(this.progs.marker);
      setTransformUniforms(gl, this.uMarker, state.x, state.y, this.xRef, this.yRef);
      gl.uniform4f(this.uMarker.uColor!, r, g, b, a);
      gl.uniform2f(this.uMarker.uResolution!, state.pixelWidth, state.pixelHeight);
      gl.uniform1f(this.uMarker.uSize!, (this.markerSize / 2) * state.dpr);
      gl.bindVertexArray(this.markerVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
      gl.bindVertexArray(null);
    }
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.stemVao);
    this.gl.deleteVertexArray(this.markerVao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
