import { parseColor } from "../gl/context.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import { boxStats, kde } from "../stats/index.js";
import type { Color, Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface BoxGroup {
  /** X-axis center for this group. */
  position: number;
  values: ArrayLike<number>;
  color?: string | Color;
  label?: string;
}

export interface BoxOptions {
  groups: BoxGroup[];
  /** Group width in data units. */
  width?: number;
  /** Draw the Tukey box + whiskers (default true). */
  box?: boolean;
  /** Draw a violin (KDE) shape behind/instead of the box (default false). */
  violin?: boolean;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  yAxis?: string;
}

// One program: per-vertex color, optional round points.
const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
uniform float uPointSize;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = uPointSize;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
uniform float uIsPoint;
out vec4 outColor;
void main() {
  if (uIsPoint > 0.5) {
    vec2 d = gl_PointCoord - 0.5;
    if (length(d) > 0.5) discard;
  }
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

const DEFAULT_COLOR = "#3b82f6";

let counter = 0;

/** Interleaved [x, y, r, g, b, a] vertex pusher. */
class Mesh {
  data: number[] = [];
  push(x: number, y: number, c: Color): void {
    this.data.push(x, y, c[0], c[1], c[2], c[3]);
  }
  get count(): number {
    return this.data.length / 6;
  }
}

export class BoxLayer implements Layer {
  readonly id: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];
  private triCount = 0;
  private lineStart = 0;
  private lineCount = 0;
  private pointStart = 0;
  private pointCount = 0;
  // Styling captured at construction, reused by setData.
  private width: number;
  private showBox: boolean;
  private showViolin: boolean;
  private usage: number;

  constructor(gl: WebGL2RenderingContext, opts: BoxOptions) {
    this.id = `box-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.usage = bufferUsage(gl, opts.renderType);
    this.yAxis = opts.yAxis ?? "y";

    this.width = opts.width ?? 0.6;
    this.showBox = opts.box !== false;
    this.showViolin = opts.violin === true;

    const all = this.build(opts.groups);

    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, all, this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS, "uPointSize", "uIsPoint"]);
  }

  /** Build box/whisker/violin geometry from the groups; sets refs, bounds and draw ranges. */
  private build(groups: BoxGroup[]): Float32Array {
    const hw = this.width / 2;
    const showBox = this.showBox;
    const showViolin = this.showViolin;

    this.xRef = groups.length ? groups[0]!.position : 0;
    // yRef from the first datum we can find.
    this.yRef = groups.length && groups[0]!.values.length ? groups[0]!.values[0]! : 0;

    const tris = new Mesh();
    const lines = new Mesh();
    const points = new Mesh();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const track = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    const ox = (v: number) => v - this.xRef;
    const oy = (v: number) => v - this.yRef;

    for (const g of groups) {
      const cx = g.position;
      const base = Array.isArray(g.color) ? (g.color as Color) : parseColor((g.color as string) ?? DEFAULT_COLOR);
      const fill: Color = [base[0], base[1], base[2], 0.35];
      const stroke: Color = [base[0], base[1], base[2], 1];
      const s = boxStats(g.values);
      track(cx - hw, s.whiskerLo);
      track(cx + hw, s.whiskerHi);

      if (showViolin) {
        const lo = s.min, hi = s.max;
        const d = kde(g.values, lo, hi, 48);
        let maxD = 0;
        for (let i = 0; i < d.ys.length; i++) maxD = Math.max(maxD, d.ys[i]!);
        maxD = maxD || 1;
        // Triangle strip (as triangles) mirrored around cx.
        for (let i = 0; i < d.xs.length - 1; i++) {
          const w0 = (d.ys[i]! / maxD) * hw;
          const w1 = (d.ys[i + 1]! / maxD) * hw;
          const y0 = d.xs[i]!, y1 = d.xs[i + 1]!;
          // left and right quads
          tris.push(ox(cx - w0), oy(y0), fill); tris.push(ox(cx + w0), oy(y0), fill); tris.push(ox(cx + w1), oy(y1), fill);
          tris.push(ox(cx - w0), oy(y0), fill); tris.push(ox(cx + w1), oy(y1), fill); tris.push(ox(cx - w1), oy(y1), fill);
        }
        track(cx - hw, lo); track(cx + hw, hi);
      }

      if (showBox) {
        // Box body (q1..q3).
        const x0 = ox(cx - hw), x1 = ox(cx + hw);
        const yq1 = oy(s.q1), yq3 = oy(s.q3);
        if (!showViolin) {
          tris.push(x0, yq1, fill); tris.push(x1, yq1, fill); tris.push(x1, yq3, fill);
          tris.push(x0, yq1, fill); tris.push(x1, yq3, fill); tris.push(x0, yq3, fill);
        }
        // Box outline.
        const edge: [number, number, number, number][] = [
          [x0, yq1, x1, yq1], [x1, yq1, x1, yq3], [x1, yq3, x0, yq3], [x0, yq3, x0, yq1],
        ];
        for (const [ax, ay, bx, by] of edge) { lines.push(ax, ay, stroke); lines.push(bx, by, stroke); }
        // Median.
        const ym = oy(s.median);
        lines.push(x0, ym, stroke); lines.push(x1, ym, stroke);
        // Whiskers + caps.
        const cxo = ox(cx);
        lines.push(cxo, oy(s.q3), stroke); lines.push(cxo, oy(s.whiskerHi), stroke);
        lines.push(cxo, oy(s.q1), stroke); lines.push(cxo, oy(s.whiskerLo), stroke);
        const capHw = hw * 0.5;
        lines.push(ox(cx - capHw), oy(s.whiskerHi), stroke); lines.push(ox(cx + capHw), oy(s.whiskerHi), stroke);
        lines.push(ox(cx - capHw), oy(s.whiskerLo), stroke); lines.push(ox(cx + capHw), oy(s.whiskerLo), stroke);
        // Outliers.
        for (const v of s.outliers) { points.push(cxo, oy(v), stroke); track(cx, v); }
      }
    }

    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    this.triCount = tris.count;
    this.lineStart = tris.count;
    this.lineCount = lines.count;
    this.pointStart = tris.count + lines.count;
    this.pointCount = points.count;
    return new Float32Array([...tris.data, ...lines.data, ...points.data]);
  }

  /** Replace the box groups and rebuild the geometry (for streaming). */
  setData(groups: BoxGroup[], width?: number): void {
    if (width != null) this.width = width;
    const all = this.build(groups);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, all, this.usage);
  }

  bounds() {
    if (this.triCount + this.lineCount + this.pointCount === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform1f(this.uniforms.uPointSize!, 5 * state.dpr);
    gl.bindVertexArray(this.vao);
    if (this.triCount > 0) {
      gl.uniform1f(this.uniforms.uIsPoint!, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.triCount);
    }
    if (this.lineCount > 0) {
      gl.uniform1f(this.uniforms.uIsPoint!, 0);
      gl.drawArrays(gl.LINES, this.lineStart, this.lineCount);
    }
    if (this.pointCount > 0) {
      gl.uniform1f(this.uniforms.uIsPoint!, 1);
      gl.drawArrays(gl.POINTS, this.pointStart, this.pointCount);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
  }
}
