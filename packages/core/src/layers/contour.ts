import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface ContourOptions {
  /** Row-major grid values, length `cols * rows` (row 0 at the bottom). */
  values: ArrayLike<number>;
  cols: number;
  rows: number;
  extent: { x: Range; y: Range };
  /** Iso levels: an explicit list, or a count of evenly-spaced levels. */
  levels?: number[] | number;
  /** Single line color; if omitted, levels are colored by a colormap. */
  color?: string | Color;
  colormap?: ColormapName;
  yAxis?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() { vColor = aColor; gl_Position = vec4(dataToClip(aPos), 0.0, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

// Marching-squares: case → pairs of edges to connect (e0 bottom, e1 right, e2 top, e3 left).
const CASES: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
];

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class ContourLayer implements Layer {
  readonly id: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertexCount: number;
  private xRef: number;
  private yRef: number;
  private ext: { x: Range; y: Range };

  constructor(gl: WebGL2RenderingContext, opts: ContourOptions) {
    this.id = `contour-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.yAxis = opts.yAxis ?? "y";
    this.ext = opts.extent;
    const { cols, rows, values } = opts;
    const [x0, x1] = opts.extent.x, [y0, y1] = opts.extent.y;
    this.xRef = x0; this.yRef = y0;

    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < values.length; i++) { const v = values[i]!; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    const count = typeof opts.levels === "number" ? opts.levels : 8;
    const levels = Array.isArray(opts.levels)
      ? opts.levels
      : Array.from({ length: count }, (_, i) => vmin + ((vmax - vmin) * (i + 1)) / (count + 1));

    const cmap = colormap(opts.colormap ?? "viridis");
    const fixed = opts.color != null
      ? (Array.isArray(opts.color) ? (opts.color as Color) : parseColor(opts.color as string))
      : null;
    const gx = (c: number) => x0 + (c / (cols - 1)) * (x1 - x0) - this.xRef;
    const gy = (r: number) => y0 + (r / (rows - 1)) * (y1 - y0) - this.yRef;
    const at = (c: number, r: number) => values[r * cols + c]!;

    const data: number[] = [];
    const lspan = vmax - vmin || 1;
    for (let li = 0; li < levels.length; li++) {
      const L = levels[li]!;
      const col: Color = fixed ?? [...cmap((L - vmin) / lspan), 1] as Color;
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const v0 = at(c, r), v1 = at(c + 1, r), v2 = at(c + 1, r + 1), v3 = at(c, r + 1);
          const idx = (v0 >= L ? 1 : 0) | (v1 >= L ? 2 : 0) | (v2 >= L ? 4 : 0) | (v3 >= L ? 8 : 0);
          const segs = CASES[idx]!;
          if (segs.length === 0) continue;
          // Edge interpolation points (in offset data space).
          const lerp = (t: number, ax: number, ay: number, bx: number, by: number): [number, number] =>
            [ax + (bx - ax) * t, ay + (by - ay) * t];
          const edge = (e: number): [number, number] => {
            if (e === 0) return lerp((L - v0) / (v1 - v0 || 1e-9), gx(c), gy(r), gx(c + 1), gy(r));
            if (e === 1) return lerp((L - v1) / (v2 - v1 || 1e-9), gx(c + 1), gy(r), gx(c + 1), gy(r + 1));
            if (e === 2) return lerp((L - v2) / (v3 - v2 || 1e-9), gx(c + 1), gy(r + 1), gx(c), gy(r + 1));
            return lerp((L - v3) / (v0 - v3 || 1e-9), gx(c), gy(r + 1), gx(c), gy(r));
          };
          for (const [ea, eb] of segs) {
            const pa = edge(ea), pb = edge(eb);
            data.push(pa[0], pa[1], col[0], col[1], col[2], col[3]);
            data.push(pb[0], pb[1], col[0], col[1], col[2], col[3]);
          }
        }
      }
    }

    this.vertexCount = data.length / 6;
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS]);
  }

  bounds() {
    return { x: this.ext.x, y: this.ext.y };
  }

  draw(state: DrawState): void {
    if (this.vertexCount === 0) return;
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
