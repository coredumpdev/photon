import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import type { Color } from "../types.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface Line3DOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  color?: string | Color;
  name?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

/** A 3D polyline / path (`GL_LINE_STRIP`). */
export class Line3DLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  readonly colorCss: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count: number;
  private color: Color;
  private b3: Bounds3;
  private positions: Float32Array;

  constructor(gl: WebGL2RenderingContext, opts: Line3DOptions) {
    this.id = `line3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    const ci = opts.color ?? "#38bdf8";
    this.color = Array.isArray(ci) ? (ci as Color) : parseColor(ci as string);
    this.colorCss = typeof ci === "string" ? ci : toColorCss(this.color);

    const n = Math.min(opts.x.length, opts.y.length, opts.z.length);
    this.count = n;
    const data = new Float32Array(n * 3);
    this.positions = data;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!, z = opts.z[i]!;
      data[i * 3] = x; data[i * 3 + 1] = y; data[i * 3 + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.b3 = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };

    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uColor"]);
  }

  bounds3() { return this.count ? this.b3 : null; }

  pickData() { return this.count ? { positions: this.positions } : null; }

  /** Stream a new path. Call `plot.refresh()` afterwards to re-fit + redraw. */
  setData(x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): void {
    const n = Math.min(x.length, y.length, z.length);
    this.count = n;
    const data = new Float32Array(n * 3);
    this.positions = data;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = x[i]!, py = y[i]!, pz = z[i]!;
      data[i * 3] = px; data[i * 3 + 1] = py; data[i * 3 + 2] = pz;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    this.b3 = { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.count < 2) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform4f(this.uniforms.uColor!, this.color[0], this.color[1], this.color[2], this.color[3]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINE_STRIP, 0, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
