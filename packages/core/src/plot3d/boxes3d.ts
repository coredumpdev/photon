import { parseColor, toColorCss } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Color, RenderType } from "../types.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

/** One axis-aligned cuboid: a center plus a full size on each axis. */
export interface Box3D {
  /** Center (world space). */
  x: number;
  y: number;
  z: number;
  /** Full size along x / y / z. */
  w: number;
  h: number;
  d: number;
  /** Fill color; falls back to the layer default. */
  color?: string | Color;
  /** Hover tooltip text for this box. */
  label?: string;
}

export interface Boxes3DOptions {
  boxes: Box3D[];
  /** Default fill for boxes without their own `color`. */
  color?: string | Color;
  /**
   * Fill opacity 0..1. Default 1. Values below 1 blend without depth sorting,
   * so overlapping translucent boxes can composite out of order.
   */
  opacity?: number;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

/** A unit cube centered on the origin (all axes in [-0.5, 0.5]), with per-face normals. */
function buildCube(): Float32Array {
  const faces: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
    { n: [1, 0, 0], v: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]] },
    { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
  ];
  const out: number[] = [];
  for (const f of faces) for (const p of f.v) out.push(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2]);
  return new Float32Array(out);
}
const CUBE = buildCube();
const CUBE_VERTS = CUBE.length / 6;

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aCube;    // unit cube centered on the origin
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aCenter;  // instance center
layout(location = 3) in vec3 aSize;    // instance full size
layout(location = 4) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
out vec3 vN;
void main() {
  vColor = aColor;
  // Box normals stay axis-aligned under a non-uniform scale, so pass them through.
  vN = aNormal;
  gl_Position = uMVP * vec4(aCenter + aCube * aSize, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uOpacity;
out vec4 outColor;
void main() {
  float d = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * d;
  outColor = vec4(vColor * shade * uOpacity, uOpacity);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) {
    p = createProgram(gl, VERT, FRAG);
    programCache.set(gl, p);
  }
  return p;
}

/** Floats per instance: center(3) + size(3) + color(3). */
const INSTANCE_FLOATS = 9;
const INSTANCE_STRIDE = INSTANCE_FLOATS * 4;

let counter = 0;

/**
 * Independently sized, lit cuboids drawn as one instanced call — voxels,
 * bounding boxes, 3D waterfalls, and the layer blocks of a model diagram.
 * Unlike {@link Bar3DLayer} every box carries its own center and 3-axis size.
 */
export class Boxes3DLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  readonly colorCss: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private instBuf: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private count = 0;
  private b3: Bounds3 = { x: [0, 0], y: [0, 0], z: [0, 0] };
  private positions = new Float32Array(0);
  private labels: Array<string | undefined> = [];
  private base: Color;
  private opacity: number;
  private usage: number;
  private lightDir: [number, number, number] = [0.5, 1, 0.35];
  private ambient = 0.35;

  constructor(gl: WebGL2RenderingContext, opts: Boxes3DOptions) {
    this.id = `boxes3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    this.usage = bufferUsage(gl, opts.renderType);
    this.opacity = opts.opacity ?? 1;
    const ci = opts.color ?? "#60a5fa";
    this.base = Array.isArray(ci) ? (ci as Color) : parseColor(ci as string);
    this.colorCss = typeof ci === "string" ? ci : toColorCss(this.base);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const cubeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (let loc = 2; loc <= 4; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, INSTANCE_STRIDE, (loc - 2) * 12);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.buffers = [cubeBuf, instBuf];
    this.instBuf = instBuf;

    this.build(opts.boxes);
    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uLightDir", "uAmbient", "uOpacity"]);
  }

  /** Pack the instance attributes, recompute bounds/pick data, and upload. */
  private build(boxes: Box3D[]): void {
    const n = boxes.length;
    this.count = n;
    const inst = new Float32Array(n * INSTANCE_FLOATS);
    this.positions = new Float32Array(n * 3);
    this.labels = new Array<string | undefined>(n);
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const b = boxes[i]!;
      const o = i * INSTANCE_FLOATS;
      inst[o] = b.x; inst[o + 1] = b.y; inst[o + 2] = b.z;
      inst[o + 3] = b.w; inst[o + 4] = b.h; inst[o + 5] = b.d;
      const rgba = b.color != null
        ? (Array.isArray(b.color) ? (b.color as Color) : parseColor(b.color as string))
        : this.base;
      inst[o + 6] = rgba[0]; inst[o + 7] = rgba[1]; inst[o + 8] = rgba[2];
      this.positions[i * 3] = b.x;
      this.positions[i * 3 + 1] = b.y;
      this.positions[i * 3 + 2] = b.z;
      this.labels[i] = b.label;
      const hw = b.w / 2, hh = b.h / 2, hd = b.d / 2;
      if (b.x - hw < minX) minX = b.x - hw;
      if (b.x + hw > maxX) maxX = b.x + hw;
      if (b.y - hh < minY) minY = b.y - hh;
      if (b.y + hh > maxY) maxY = b.y + hh;
      if (b.z - hd < minZ) minZ = b.z - hd;
      if (b.z + hd > maxZ) maxZ = b.z + hd;
    }
    this.b3 = n
      ? { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] }
      : { x: [0, 0], y: [0, 0], z: [0, 0] };
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, inst, this.usage);
  }

  /** Replace every box. Call `plot.refresh()` afterwards to re-fit + redraw. */
  setData(boxes: Box3D[]): void {
    this.build(boxes);
  }

  bounds3(): Bounds3 | null {
    return this.count ? this.b3 : null;
  }

  pickData() {
    if (!this.count) return null;
    const labels = this.labels;
    const hasLabels = labels.some((l) => l != null);
    return hasLabels
      ? { positions: this.positions, label: (i: number) => labels[i] ?? "" }
      : { positions: this.positions };
  }

  /** Set the light direction (world space) and ambient term (0..1). */
  setLight(dir: [number, number, number], ambient: number): void {
    this.lightDir = dir;
    this.ambient = ambient;
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.count === 0) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform3f(this.uniforms.uLightDir!, this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    gl.uniform1f(this.uniforms.uAmbient!, this.ambient);
    gl.uniform1f(this.uniforms.uOpacity!, this.opacity);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, CUBE_VERTS, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
