import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Color, Range, RenderType } from "../types.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import { marchingCubes } from "./marching-cubes.js";
import type { Mat4 } from "./mat4.js";

export interface IsosurfaceOptions {
  /** Scalar volume, length `nx*ny*nz`, indexed `x + y*nx + z*nx*ny`. */
  values: ArrayLike<number>;
  dims: [number, number, number];
  /** The iso value to extract the surface at. */
  isoLevel: number;
  /** World extent of the volume. Defaults to unit indices. */
  extent?: { x: Range; y: Range; z: Range };
  color?: string | Color;
  /** Fill opacity 0..1. Default 1. */
  opacity?: number;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uMVP;
out vec3 vN;
void main() { vN = aNormal; gl_Position = uMVP * vec4(aPos, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vN;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uOpacity;
out vec4 outColor;
void main() {
  // Two-sided: isosurfaces are viewed from inside and out.
  float d = abs(dot(normalize(vN), normalize(uLightDir)));
  float shade = uAmbient + (1.0 - uAmbient) * d;
  outColor = vec4(uColor * shade * uOpacity, uOpacity);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

/** A marching-cubes isosurface of a 3D scalar volume, lit and solid-colored. */
export class IsosurfaceLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  readonly colorCss: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertCount!: number;
  private color: Color;
  private opacity: number;
  private b3!: Bounds3;
  private usage: number;
  private lightDir: [number, number, number] = [0.5, 1, 0.35];
  private ambient = 0.35;

  constructor(gl: WebGL2RenderingContext, opts: IsosurfaceOptions) {
    this.id = `isosurface-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    this.usage = bufferUsage(gl, opts.renderType);
    const ci = opts.color ?? "#38bdf8";
    this.color = Array.isArray(ci) ? (ci as Color) : parseColor(ci as string);
    this.colorCss = typeof ci === "string" ? ci : toColorCss(this.color);
    this.opacity = opts.opacity ?? 1;

    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    this.build(opts.values, opts.dims, opts.isoLevel, opts.extent);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uColor", "uLightDir", "uAmbient", "uOpacity"]);
  }

  /** Run marching cubes and (re)upload the interleaved pos/normal vertex buffer. */
  private build(
    values: ArrayLike<number>,
    dims: [number, number, number],
    isoLevel: number,
    extent?: { x: Range; y: Range; z: Range },
  ): void {
    const gl = this.gl;
    const { positions, normals } = marchingCubes(values, dims, isoLevel, extent);
    this.vertCount = positions.length / 3;
    const ex = extent?.x ?? [0, dims[0] - 1];
    const ey = extent?.y ?? [0, dims[1] - 1];
    const ez = extent?.z ?? [0, dims[2] - 1];
    this.b3 = { x: ex, y: ey, z: ez };

    // Interleave pos(3)+normal(3).
    const data = new Float32Array(this.vertCount * 6);
    for (let i = 0; i < this.vertCount; i++) {
      data[i * 6] = positions[i * 3]!; data[i * 6 + 1] = positions[i * 3 + 1]!; data[i * 6 + 2] = positions[i * 3 + 2]!;
      data[i * 6 + 3] = normals[i * 3]!; data[i * 6 + 4] = normals[i * 3 + 1]!; data[i * 6 + 5] = normals[i * 3 + 2]!;
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  /** Stream a new volume + iso level (marching-cubes mesh recomputed). Call `plot.refresh()` after. */
  setData(
    values: ArrayLike<number>,
    dims: [number, number, number],
    isoLevel: number,
    extent?: { x: Range; y: Range; z: Range },
  ): void {
    this.build(values, dims, isoLevel, extent);
  }

  bounds3() { return this.vertCount ? this.b3 : null; }

  /** Set the light direction (world space) and ambient term (0..1). */
  setLight(dir: [number, number, number], ambient: number): void {
    this.lightDir = dir;
    this.ambient = ambient;
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.vertCount === 0) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform3f(this.uniforms.uColor!, this.color[0], this.color[1], this.color[2]);
    gl.uniform3f(this.uniforms.uLightDir!, this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    gl.uniform1f(this.uniforms.uAmbient!, this.ambient);
    gl.uniform1f(this.uniforms.uOpacity!, this.opacity);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
