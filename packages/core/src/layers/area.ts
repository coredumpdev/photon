import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface AreaOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Lower edge(s). Number or per-point array — pass cumulative to stack. */
  base?: number | ArrayLike<number>;
  color?: string | Color;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  name?: string;
  yAxis?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;  // offset data space
${TRANSFORM_GLSL}
void main() { gl_Position = vec4(dataToClip(aPos), 0.0, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class AreaLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertexCount: number;
  private color: Color;
  private usage: number;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: AreaOptions) {
    this.id = `area-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    const colorInput = opts.color ?? "rgba(59,130,246,0.4)";
    this.color = Array.isArray(colorInput) ? (colorInput as Color) : parseColor(colorInput as string);
    this.colorCss = typeof colorInput === "string" ? colorInput : toColorCss(this.color);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.usage = bufferUsage(gl, opts.renderType);

    const n = Math.min(opts.x.length, opts.y.length);
    this.vertexCount = n * 2;
    const baseAt = (i: number): number =>
      opts.base == null ? 0 : typeof opts.base === "number" ? opts.base : opts.base[i]!;

    this.xRef = n > 0 ? opts.x[0]! : 0;
    this.yRef = n > 0 ? opts.y[0]! : 0;
    // Triangle strip: alternate base and top vertices per x.
    const data = new Float32Array(n * 4);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, b = baseAt(i), top = opts.y[i]!;
      data[i * 4] = x - this.xRef;
      data[i * 4 + 1] = b - this.yRef;
      data[i * 4 + 2] = x - this.xRef;
      data[i * 4 + 3] = top - this.yRef;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, b, top); maxY = Math.max(maxY, b, top);
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS, "uColor"]);
  }

  /** Replace the area data and re-upload (for streaming). */
  setData(x: ArrayLike<number>, y: ArrayLike<number>, base?: number | ArrayLike<number>): void {
    const n = Math.min(x.length, y.length);
    this.vertexCount = n * 2;
    const baseAt = (i: number): number =>
      base == null ? 0 : typeof base === "number" ? base : base[i]!;
    this.xRef = n > 0 ? x[0]! : 0;
    this.yRef = n > 0 ? y[0]! : 0;
    const data = new Float32Array(n * 4);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const vx = x[i]!, b = baseAt(i), top = y[i]!;
      data[i * 4] = vx - this.xRef; data[i * 4 + 1] = b - this.yRef;
      data[i * 4 + 2] = vx - this.xRef; data[i * 4 + 3] = top - this.yRef;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      minY = Math.min(minY, b, top); maxY = Math.max(maxY, b, top);
    }
    this.xBounds = [minX, maxX]; this.yBounds = [minY, maxY];
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.usage);
  }

  bounds() {
    if (this.vertexCount === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    if (this.vertexCount < 4) return;
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.uniforms.uColor!, this.color[0], this.color[1], this.color[2], this.color[3]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
