import { colormap, type ColormapName } from "../color/colormap.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface HexbinOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Hex radius in data units. Defaults to ~1/30 of the x-extent. */
  radius?: number;
  colormap?: ColormapName;
  /** Count range mapped to the colormap. Defaults to [1, maxCount]. */
  domain?: Range;
  yAxis?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit hexagon (data-unit offsets)
layout(location = 1) in vec2 aCenter;  // offset data space
layout(location = 2) in vec4 aColor;
uniform float uRadius;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = vec4(dataToClip(aCenter + aCorner * uRadius), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

// Pointy-top unit hexagon as 6 triangles (fan around the center).
const HEX = (() => {
  const verts: number[] = [];
  const pt = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI / 3) * i + Math.PI / 6;
    const a1 = (Math.PI / 3) * (i + 1) + Math.PI / 6;
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    verts.push(0, 0, x0, y0, x1, y1);
  }
  return new Float32Array(verts);
})();

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

export class HexbinLayer implements Layer {
  readonly id: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private radius: number;
  private cellCount: number;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: HexbinOptions) {
    this.id = `hexbin-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.yAxis = opts.yAxis ?? "y";

    const n = Math.min(opts.x.length, opts.y.length);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = opts.x[i]!, y = opts.y[i]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    this.xBounds = [minX, maxX]; this.yBounds = [minY, maxY];
    const r = opts.radius ?? ((maxX - minX) / 30 || 1);
    this.radius = r;
    const dx = r * 2 * Math.sin(Math.PI / 3);
    const dy = r * 1.5;

    // Aggregate points into hex cells (simplified d3-hexbin binning).
    const cells = new Map<string, { cx: number; cy: number; count: number }>();
    let maxCount = 1;
    for (let i = 0; i < n; i++) {
      const px = opts.x[i]!, py = opts.y[i]!;
      const pj = Math.round(py / dy);
      const pi = Math.round(px / dx - (pj & 1) / 2);
      const key = `${pi},${pj}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { cx: (pi + (pj & 1) / 2) * dx, cy: pj * dy, count: 0 };
        cells.set(key, cell);
      }
      cell.count++;
      if (cell.count > maxCount) maxCount = cell.count;
    }

    this.cellCount = cells.size;
    this.xRef = minX; this.yRef = minY;
    const centers = new Float32Array(this.cellCount * 2);
    const colors = new Float32Array(this.cellCount * 4);
    const cmap = colormap(opts.colormap ?? "viridis");
    const lo = opts.domain?.[0] ?? 1;
    const hi = opts.domain?.[1] ?? maxCount;
    const span = hi - lo || 1;
    let k = 0;
    for (const cell of cells.values()) {
      centers[k * 2] = cell.cx - this.xRef;
      centers[k * 2 + 1] = cell.cy - this.yRef;
      const [cr, cg, cb] = cmap((cell.count - lo) / span);
      colors[k * 4] = cr; colors[k * 4 + 1] = cg; colors[k * 4 + 2] = cb; colors[k * 4 + 3] = 1;
      k++;
    }

    const vao = gl.createVertexArray()!;
    this.vao = vao;
    gl.bindVertexArray(vao);
    const hexBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuf);
    gl.bufferData(gl.ARRAY_BUFFER, HEX, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const centerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, centers, gl.STATIC_DRAW);
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
    this.buffers = [hexBuf, centerBuf, colorBuf];

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS, "uRadius"]);
  }

  bounds() {
    if (this.cellCount === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    if (this.cellCount === 0) return;
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform1f(this.uniforms.uRadius!, this.radius);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, this.cellCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
