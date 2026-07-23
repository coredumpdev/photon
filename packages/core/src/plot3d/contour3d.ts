import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Color, Range, RenderType } from "../types.js";
import type { Bounds3, ColorInfo, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface Contour3DOptions {
  /** Row-major height grid, length `cols * rows`. */
  values: ArrayLike<number>;
  cols: number;
  rows: number;
  /** World footprint. Defaults to unit indices. */
  extentX?: Range;
  extentZ?: Range;
  /** Iso levels: an explicit list, or a count of evenly-spaced levels. Default 10. */
  levels?: number[] | number;
  /** Single line color; if omitted, levels are colored by a colormap. */
  color?: string | Color;
  colormap?: ColormapName;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

// Marching squares: case → edge pairs (e0 bottom, e1 right, e2 top, e3 left).
const CASES: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
];

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main() { vColor = aColor; gl_Position = uMVP * vec4(aPos, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

/**
 * 3D contour: iso-height lines of a grid, each drawn at its own level height
 * (`y = level`) so they stack into a floating topographic map. Marching squares
 * on the CPU, per-vertex colored by level.
 */
export class Contour3DLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertCount!: number;
  private b3!: Bounds3;
  private cInfo: ColorInfo | null = null;
  private cmapName: ColormapName;
  private fixed: Color | null;
  private levelsOpt?: number[] | number;
  private cols!: number;
  private rows!: number;
  private extentX!: Range;
  private extentZ!: Range;
  private usage: number;

  constructor(gl: WebGL2RenderingContext, opts: Contour3DOptions) {
    this.id = `contour3d-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    this.usage = bufferUsage(gl, opts.renderType);
    this.cmapName = opts.colormap ?? "viridis";
    this.levelsOpt = opts.levels;
    this.fixed = opts.color != null
      ? (Array.isArray(opts.color) ? (opts.color as Color) : parseColor(opts.color as string))
      : null;

    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    this.build(opts.values, opts.cols, opts.rows, opts.extentX, opts.extentZ);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP"]);
  }

  /** Marching-squares the grid at each iso level and (re)upload the line buffer. */
  private build(values: ArrayLike<number>, cols: number, rows: number, extentX?: Range, extentZ?: Range): void {
    const gl = this.gl;
    this.cols = cols; this.rows = rows;
    const [x0, x1] = extentX ?? [0, cols - 1];
    const [z0, z1] = extentZ ?? [0, rows - 1];
    this.extentX = [x0, x1]; this.extentZ = [z0, z1];

    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < values.length; i++) { const v = values[i]!; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    const lspan = vmax - vmin || 1;
    const count = typeof this.levelsOpt === "number" ? this.levelsOpt : 10;
    const levels = Array.isArray(this.levelsOpt)
      ? this.levelsOpt
      : Array.from({ length: count }, (_, i) => vmin + (lspan * (i + 1)) / (count + 1));

    const cmap = colormap(this.cmapName);
    const fixed = this.fixed;
    if (!fixed) this.cInfo = { colormap: this.cmapName, domain: [vmin, vmax], label: this.name };

    const wx = (c: number) => x0 + (c / (cols - 1)) * (x1 - x0);
    const wz = (r: number) => z0 + (r / (rows - 1)) * (z1 - z0);
    const at = (c: number, r: number) => values[r * cols + c]!;

    const data: number[] = [];
    for (const L of levels) {
      const col: [number, number, number] = fixed ? [fixed[0], fixed[1], fixed[2]] : cmap((L - vmin) / lspan);
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const v0 = at(c, r), v1 = at(c + 1, r), v2 = at(c + 1, r + 1), v3 = at(c, r + 1);
          const idx = (v0 >= L ? 1 : 0) | (v1 >= L ? 2 : 0) | (v2 >= L ? 4 : 0) | (v3 >= L ? 8 : 0);
          const segs = CASES[idx]!;
          if (segs.length === 0) continue;
          const lerp = (t: number, ax: number, az: number, bx: number, bz: number): [number, number] =>
            [ax + (bx - ax) * t, az + (bz - az) * t];
          const edge = (e: number): [number, number] => {
            if (e === 0) return lerp((L - v0) / (v1 - v0 || 1e-9), wx(c), wz(r), wx(c + 1), wz(r));
            if (e === 1) return lerp((L - v1) / (v2 - v1 || 1e-9), wx(c + 1), wz(r), wx(c + 1), wz(r + 1));
            if (e === 2) return lerp((L - v2) / (v3 - v2 || 1e-9), wx(c + 1), wz(r + 1), wx(c), wz(r + 1));
            return lerp((L - v3) / (v0 - v3 || 1e-9), wx(c), wz(r + 1), wx(c), wz(r));
          };
          for (const [ea, eb] of segs) {
            const pa = edge(ea), pb = edge(eb);
            data.push(pa[0], L, pa[1], col[0], col[1], col[2]);
            data.push(pb[0], L, pb[1], col[0], col[1], col[2]);
          }
        }
      }
    }

    this.vertCount = data.length / 6;
    this.b3 = { x: [x0, x1], y: [vmin, vmax], z: [z0, z1] };

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  /** Stream a new scalar field (contours recomputed). Call `plot.refresh()` after. */
  setData(values: ArrayLike<number>, opts?: { cols?: number; rows?: number; extentX?: Range; extentZ?: Range }): void {
    this.build(
      values,
      opts?.cols ?? this.cols,
      opts?.rows ?? this.rows,
      opts?.extentX ?? this.extentX,
      opts?.extentZ ?? this.extentZ,
    );
  }

  bounds3() { return this.vertCount ? this.b3 : null; }

  colorInfo(): ColorInfo | null { return this.cInfo; }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    if (this.vertCount === 0) return;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
