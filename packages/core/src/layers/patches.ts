import { colormap, type ColormapName } from "../color/colormap.js";
import { earcut } from "../geo/earcut.js";
import { parseColor } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

/** A solid-fill program driven by a per-vertex color triangle soup (shared with pie). */
export const FILL_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;   // offset data-space position
layout(location = 1) in vec4 aColor; // per-vertex color (premultiplied on output)
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
}`;

export const FILL_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
export function getFillProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) {
    p = createProgram(gl, FILL_VERT, FILL_FRAG);
    programCache.set(gl, p);
  }
  return p;
}

/** One filled polygon: a ring of `x`/`y`, with optional holes. */
export interface Patch {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Vertex indices where each hole ring starts (mapbox-earcut convention). */
  holes?: number[];
  /** Explicit fill color (overrides the layer default / colormap). */
  color?: string | Color;
  /** Value used to color this patch via the layer `colormap` (choropleth). */
  value?: number;
}

export interface PatchesOptions {
  patches: Patch[];
  /** Default fill for patches without their own `color`/`value`. */
  color?: string | Color;
  /** Color patches by `value` through this colormap (choropleth). */
  colormap?: ColormapName;
  /** Value range mapped to [0,1] for the colormap. Defaults to the data min/max. */
  domain?: Range;
  /** Fill opacity, 0..1. Default 1. */
  opacity?: number;
  name?: string;
  yAxis?: string;
}

let counter = 0;

/**
 * Filled polygons (Bokeh `patches`). Each ring is triangulated once on the CPU
 * with ear-clipping (holes supported), then rendered as a static per-vertex-color
 * triangle soup — only the transform uniforms change per frame.
 */
export class PatchesLayer implements Layer {
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
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: PatchesOptions) {
    this.id = `patches-${counter++}`;
    this.gl = gl;
    this.program = getFillProgram(gl);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    const defColor = opts.color ?? "#3b82f6";
    const defRgba = Array.isArray(defColor) ? (defColor as Color) : parseColor(defColor as string);
    this.colorCss = typeof defColor === "string" ? defColor : "#3b82f6";
    const opacity = opts.opacity ?? 1;

    // Colormap domain (choropleth), if coloring by value.
    const cmap = opts.colormap ? colormap(opts.colormap) : null;
    let lo = opts.domain?.[0] ?? Infinity;
    let hi = opts.domain?.[1] ?? -Infinity;
    if (cmap && !opts.domain) {
      for (const patch of opts.patches) {
        const v = patch.value;
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = hi - lo || 1;

    // First vertex of the first non-empty patch anchors the float32 reference.
    for (const patch of opts.patches) {
      if (patch.x.length > 0) {
        this.xRef = patch.x[0]!;
        this.yRef = patch.y[0]!;
        break;
      }
    }

    const positions: number[] = [];
    const colors: number[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const patch of opts.patches) {
      const n = Math.min(patch.x.length, patch.y.length);
      if (n < 3) continue;
      // Resolve this patch's fill color.
      let rgba: Color;
      if (patch.color != null) {
        rgba = Array.isArray(patch.color) ? (patch.color as Color) : parseColor(patch.color as string);
      } else if (cmap && patch.value != null) {
        const [r, g, b] = cmap((patch.value - lo) / span);
        rgba = [r, g, b, 1];
      } else {
        rgba = defRgba;
      }
      const a = rgba[3] * opacity;

      // Flat [x0,y0,x1,y1,…] for earcut (raw coords; offset applied on write).
      const flat = new Array<number>(n * 2);
      for (let i = 0; i < n; i++) {
        flat[i * 2] = patch.x[i]!;
        flat[i * 2 + 1] = patch.y[i]!;
      }
      const tris = earcut(flat, patch.holes && patch.holes.length ? patch.holes : undefined, 2);
      for (const idx of tris) {
        const px = flat[idx * 2]!;
        const py = flat[idx * 2 + 1]!;
        positions.push(px - this.xRef, py - this.yRef);
        colors.push(rgba[0], rgba[1], rgba[2], a);
      }
      for (let i = 0; i < n; i++) {
        const px = patch.x[i]!, py = patch.y[i]!;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }

    this.vertexCount = positions.length / 2;
    this.xBounds = minX <= maxX ? [minX, maxX] : [0, 0];
    this.yBounds = minY <= maxY ? [minY, maxY] : [0, 0];

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
