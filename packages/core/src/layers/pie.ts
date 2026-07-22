import { colormap, type ColormapName } from "../color/colormap.js";
import { parseColor } from "../gl/context.js";
import { uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";
import { getFillProgram } from "./patches.js";

const DEFAULT_COLORS = [
  "#3b82f6", "#f472b6", "#22d3ee", "#a3e635", "#fbbf24",
  "#a78bfa", "#34d399", "#fb7185", "#60a5fa", "#f59e0b",
];

export interface PieOptions {
  /** Slice magnitudes (need not sum to 1 — they are normalized). */
  values: ArrayLike<number>;
  /** Explicit per-slice colors; falls back to `colormap`, then a default palette. */
  colors?: (string | Color)[];
  /** Color slices by index through this colormap instead of the palette. */
  colormap?: ColormapName;
  /** Center in data space. Default `[0, 0]`. */
  center?: [number, number];
  /** Outer radius in data units. Default `1`. */
  radius?: number;
  /** Inner radius (> 0 makes a donut). Default `0`. */
  innerRadius?: number;
  /** Angle of the first slice edge, radians. Default `Math.PI / 2` (12 o'clock). */
  startAngle?: number;
  name?: string;
  yAxis?: string;
}

let counter = 0;

/**
 * A pie / donut chart drawn as a per-vertex-color triangle soup (wedges as fans,
 * or quad strips when a donut). Reuses the shared solid-fill program. Slices sweep
 * clockwise from `startAngle`. Set the plot's `equalAspect` so it stays circular.
 */
export class PieLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private vertexCount = 0;
  private xRef: number;
  private yRef: number;
  private xBounds: Range;
  private yBounds: Range;

  constructor(gl: WebGL2RenderingContext, opts: PieOptions) {
    this.id = `pie-${counter++}`;
    this.gl = gl;
    this.program = getFillProgram(gl);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";

    const [cx, cy] = opts.center ?? [0, 0];
    const R = opts.radius ?? 1;
    const rIn = opts.innerRadius ?? 0;
    const start = opts.startAngle ?? Math.PI / 2;
    this.xRef = cx;
    this.yRef = cy;
    this.xBounds = [cx - R, cx + R];
    this.yBounds = [cy - R, cy + R];
    this.colorCss = "#3b82f6";

    const n = opts.values.length;
    let total = 0;
    for (let i = 0; i < n; i++) total += Math.max(0, opts.values[i]!);
    if (total <= 0) total = 1;

    const cmap = opts.colormap ? colormap(opts.colormap) : null;
    const colorAt = (i: number): Color => {
      if (opts.colors?.[i] != null) {
        const c = opts.colors[i]!;
        return Array.isArray(c) ? (c as Color) : parseColor(c as string);
      }
      if (cmap) {
        const [r, g, b] = cmap(n > 1 ? i / (n - 1) : 0);
        return [r, g, b, 1];
      }
      return parseColor(DEFAULT_COLORS[i % DEFAULT_COLORS.length]!);
    };

    // Positions are offset by the center; the center is xRef/yRef so it maps to 0.
    const positions: number[] = [];
    const colors: number[] = [];
    const push = (x: number, y: number, c: Color): void => {
      positions.push(x - cx, y - cy);
      colors.push(c[0], c[1], c[2], c[3]);
    };

    let a0 = start;
    for (let i = 0; i < n; i++) {
      const frac = Math.max(0, opts.values[i]!) / total;
      const span = frac * Math.PI * 2;
      if (span <= 0) continue;
      const a1 = a0 - span; // clockwise
      const c = colorAt(i);
      const segs = Math.max(2, Math.ceil(span / (Math.PI / 64)));
      for (let s = 0; s < segs; s++) {
        const t0 = a0 + ((a1 - a0) * s) / segs;
        const t1 = a0 + ((a1 - a0) * (s + 1)) / segs;
        const ox0 = cx + R * Math.cos(t0), oy0 = cy + R * Math.sin(t0);
        const ox1 = cx + R * Math.cos(t1), oy1 = cy + R * Math.sin(t1);
        if (rIn <= 0) {
          push(cx, cy, c);
          push(ox0, oy0, c);
          push(ox1, oy1, c);
        } else {
          const ix0 = cx + rIn * Math.cos(t0), iy0 = cy + rIn * Math.sin(t0);
          const ix1 = cx + rIn * Math.cos(t1), iy1 = cy + rIn * Math.sin(t1);
          push(ix0, iy0, c);
          push(ox0, oy0, c);
          push(ox1, oy1, c);
          push(ix0, iy0, c);
          push(ox1, oy1, c);
          push(ix1, iy1, c);
        }
      }
      a0 = a1;
    }

    this.vertexCount = positions.length / 2;
    const vao = gl.createVertexArray()!;
    this.vao = vao;
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const colBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.buffers = [posBuf, colBuf];

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS]);
  }

  bounds() {
    if (this.vertexCount === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    if (this.vertexCount === 0) return;
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
