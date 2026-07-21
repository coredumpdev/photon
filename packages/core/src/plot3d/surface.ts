import { colormap, type ColormapName } from "../color/colormap.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import type { Range } from "../types.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface SurfaceOptions {
  /** Row-major height grid, length `cols * rows`. */
  values: ArrayLike<number>;
  cols: number;
  rows: number;
  /** World extent of the grid footprint. Defaults to unit indices. */
  extentX?: Range;
  extentZ?: Range;
  colormap?: ColormapName;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
out vec3 vN;
void main() { vColor = aColor; vN = aNormal; gl_Position = uMVP * vec4(aPos, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
uniform vec3 uLightDir;
uniform float uAmbient;
out vec4 outColor;
void main() {
  float d = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * d;
  outColor = vec4(vColor * shade, 1.0);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class SurfaceLayer implements Layer3D {
  readonly id: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertexCount: number;
  private b3: Bounds3;
  private lightDir: [number, number, number] = [0.5, 1, 0.35];
  private ambient = 0.35;

  constructor(gl: WebGL2RenderingContext, opts: SurfaceOptions) {
    this.id = `surface-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    const { cols, rows, values } = opts;
    const [x0, x1] = opts.extentX ?? [0, cols - 1];
    const [z0, z1] = opts.extentZ ?? [0, rows - 1];
    const dxWorld = (x1 - x0) / Math.max(1, cols - 1);
    const dzWorld = (z1 - z0) / Math.max(1, rows - 1);

    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < values.length; i++) { const v = values[i]!; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    const span = vmax - vmin || 1;
    const cmap = colormap(opts.colormap ?? "viridis");
    const wx = (c: number) => x0 + (c / (cols - 1)) * (x1 - x0);
    const wz = (r: number) => z0 + (r / (rows - 1)) * (z1 - z0);
    const at = (c: number, r: number) => values[r * cols + c]!;

    const normalAt = (c: number, r: number): [number, number, number] => {
      const cl = Math.max(0, Math.min(cols - 1, c)), rl = Math.max(0, Math.min(rows - 1, r));
      const dzdx = (at(Math.min(cols - 1, cl + 1), rl) - at(Math.max(0, cl - 1), rl)) / (2 * dxWorld);
      const dzdz = (at(cl, Math.min(rows - 1, rl + 1)) - at(cl, Math.max(0, rl - 1))) / (2 * dzWorld);
      const nl = Math.hypot(-dzdx, 1, -dzdz) || 1;
      return [-dzdx / nl, 1 / nl, -dzdz / nl];
    };

    const data: number[] = [];
    const vert = (c: number, r: number) => {
      const [nx, ny, nz] = normalAt(c, r);
      const [cr, cg, cb] = cmap((at(c, r) - vmin) / span);
      data.push(wx(c), at(c, r), wz(r), nx, ny, nz, cr, cg, cb);
    };
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        vert(c, r); vert(c + 1, r); vert(c + 1, r + 1);
        vert(c, r); vert(c + 1, r + 1); vert(c, r + 1);
      }
    }

    this.vertexCount = data.length / 9;
    this.b3 = { x: [x0, x1], y: [vmin, vmax], z: [z0, z1] };

    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uLightDir", "uAmbient"]);
  }

  bounds3() { return this.b3; }

  /** Set the light direction (world space) and ambient term (0..1). */
  setLight(dir: [number, number, number], ambient: number): void {
    this.lightDir = dir;
    this.ambient = ambient;
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform3f(this.uniforms.uLightDir!, this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    gl.uniform1f(this.uniforms.uAmbient!, this.ambient);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
