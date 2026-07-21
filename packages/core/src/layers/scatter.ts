import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface ScatterOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color?: string | Color;
  /** Marker diameter in CSS pixels. */
  size?: number;
  name?: string;
  yAxis?: string;
  /** Color each point by a value through a colormap. */
  colorBy?: {
    values: ArrayLike<number>;
    colormap?: ColormapName;
    /** Value range mapped to [0,1]. Defaults to the data min/max. */
    domain?: Range;
  };
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit quad [-1,1]^2
layout(location = 1) in vec2 aPos;     // point (offset data space)
layout(location = 2) in vec4 aColor;   // per-point color (used if uUseVertexColor>0.5)
uniform vec2 uResolution;
uniform float uSize;                   // radius in device px
${TRANSFORM_GLSL}
out vec2 vLocal;
out vec4 vColor;
void main() {
  vec2 center = (dataToClip(aPos) * 0.5 + 0.5) * uResolution;
  vec2 pos = center + aCorner * uSize;
  vLocal = aCorner;
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
uniform vec4 uColor;
uniform float uUseVertexColor;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float alpha = smoothstep(1.0, 1.0 - 0.15, r);  // soft edge
  vec4 c = uUseVertexColor > 0.5 ? vColor : uColor;
  outColor = vec4(c.rgb * c.a * alpha, c.a * alpha);
}`;

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class ScatterLayer implements Layer {
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
  private size: number;
  private color: Color;
  private useVertexColor: boolean;
  private xRef = 0;
  private yRef = 0;
  private xs: Float64Array;
  private ys: Float64Array;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: ScatterOptions) {
    this.id = `scatter-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.size = opts.size ?? 5;
    const colorInput = opts.color ?? "#3b82f6";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.useVertexColor = opts.colorBy != null;

    const n = Math.min(opts.x.length, opts.y.length);
    this.count = n;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.xRef = n > 0 ? opts.x[0]! : 0;
    this.yRef = n > 0 ? opts.y[0]! : 0;
    const pos = new Float32Array(n * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!;
      this.xs[i] = x; this.ys[i] = y;
      pos[i * 2] = x - this.xRef;
      pos[i * 2 + 1] = y - this.yRef;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    // Per-point colors (optional).
    const colors = new Float32Array(n * 4);
    if (opts.colorBy) {
      const vals = opts.colorBy.values;
      const cmap = colormap(opts.colorBy.colormap ?? "viridis");
      let lo = opts.colorBy.domain?.[0] ?? Infinity;
      let hi = opts.colorBy.domain?.[1] ?? -Infinity;
      if (!opts.colorBy.domain) {
        for (let i = 0; i < n; i++) {
          const v = vals[i]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const span = hi - lo || 1;
      for (let i = 0; i < n; i++) {
        const [r, g, b] = cmap((vals[i]! - lo) / span);
        colors[i * 4] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = 1;
      }
    }

    const vao = gl.createVertexArray()!;
    this.vao = vao;
    gl.bindVertexArray(vao);

    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    const colorBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    this.buffers = [cornerBuf, posBuf, colorBuf];

    this.uniforms = uniformLocations(gl, this.program, [
      ...TRANSFORM_UNIFORMS, "uColor", "uResolution", "uSize", "uUseVertexColor",
    ]);
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

  /** Replace point positions and re-upload (for streaming). Keeps uniform color. */
  setData(x: ArrayLike<number>, y: ArrayLike<number>): void {
    const n = Math.min(x.length, y.length);
    this.count = n;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.xRef = n > 0 ? x[0]! : 0;
    this.yRef = n > 0 ? y[0]! : 0;
    const pos = new Float32Array(n * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const vx = x[i]!, vy = y[i]!;
      this.xs[i] = vx; this.ys[i] = vy;
      pos[i * 2] = vx - this.xRef; pos[i * 2 + 1] = vy - this.yRef;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    }
    this.xBounds = [minX, maxX]; this.yBounds = [minY, maxY];
    this.useVertexColor = false;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffers[1]!);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, pos, this.gl.DYNAMIC_DRAW);
  }

  draw(state: DrawState): void {
    if (this.count === 0) return;
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uniforms.uColor!, this.color[0], this.color[1], this.color[2], this.color[3]);
    gl.uniform2f(this.uniforms.uResolution!, state.pixelWidth, state.pixelHeight);
    gl.uniform1f(this.uniforms.uSize!, (this.size / 2) * state.dpr);
    gl.uniform1f(this.uniforms.uUseVertexColor!, this.useVertexColor ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
