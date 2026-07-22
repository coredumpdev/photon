import { parseColor, toColorCss } from "../gl/context.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Color, Range } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

export interface GraphOptions {
  /** Node positions (data space). */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Edges as index pairs into the node arrays. */
  edges: ReadonlyArray<readonly [number, number]>;
  nodeColor?: string | Color;
  /** Node diameter in CSS pixels. Default 10. */
  nodeSize?: number;
  edgeColor?: string | Color;
  name?: string;
  yAxis?: string;
}

// Edges: plain data-space segments.
const EDGE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
${TRANSFORM_GLSL}
void main() { gl_Position = vec4(dataToClip(aPos), 0.0, 1.0); }`;

const SOLID_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

// Nodes: round points sized in device pixels.
const NODE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform float uSize;
${TRANSFORM_GLSL}
void main() {
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
  gl_PointSize = uSize;
}`;

const NODE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.82, r);
  outColor = vec4(uColor.rgb * uColor.a * a, uColor.a * a);
}`;

interface Programs {
  edge: WebGLProgram;
  node: WebGLProgram;
}
const programCache = new WeakMap<WebGL2RenderingContext, Programs>();
function getPrograms(gl: WebGL2RenderingContext): Programs {
  let p = programCache.get(gl);
  if (!p) {
    p = { edge: createProgram(gl, EDGE_VERT, SOLID_FRAG), node: createProgram(gl, NODE_VERT, NODE_FRAG) };
    programCache.set(gl, p);
  }
  return p;
}

let counter = 0;

/** A node-link graph: edges as line segments, nodes as round points. */
export class GraphLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private progs: Programs;
  private nodeVao: WebGLVertexArrayObject;
  private edgeVao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private edgeUniforms: Record<string, WebGLUniformLocation | null>;
  private nodeUniforms: Record<string, WebGLUniformLocation | null>;
  private nodeCount: number;
  private edgeVerts: number;
  private nodeColor: Color;
  private edgeColor: Color;
  private nodeSize: number;
  private xRef = 0;
  private yRef = 0;
  private xBounds: Range = [0, 0];
  private yBounds: Range = [0, 0];

  constructor(gl: WebGL2RenderingContext, opts: GraphOptions) {
    this.id = `graph-${counter++}`;
    this.gl = gl;
    this.progs = getPrograms(gl);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    const nc = opts.nodeColor ?? "#60a5fa";
    this.nodeColor = Array.isArray(nc) ? (nc as Color) : parseColor(nc as string);
    this.colorCss = typeof nc === "string" ? nc : toColorCss(this.nodeColor);
    const ec = opts.edgeColor ?? "rgba(148,163,184,0.5)";
    this.edgeColor = Array.isArray(ec) ? (ec as Color) : parseColor(ec as string);
    this.nodeSize = opts.nodeSize ?? 10;

    const n = Math.min(opts.x.length, opts.y.length);
    this.nodeCount = n;
    this.xRef = n > 0 ? opts.x[0]! : 0;
    this.yRef = n > 0 ? opts.y[0]! : 0;

    const nodePos = new Float32Array(n * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = opts.x[i]!, py = opts.y[i]!;
      nodePos[i * 2] = px - this.xRef;
      nodePos[i * 2 + 1] = py - this.yRef;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    this.xBounds = [minX, maxX];
    this.yBounds = [minY, maxY];

    // Two endpoints per edge (skip edges referencing out-of-range nodes).
    const edgePos: number[] = [];
    for (const [a, b] of opts.edges) {
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      edgePos.push(opts.x[a]! - this.xRef, opts.y[a]! - this.yRef, opts.x[b]! - this.xRef, opts.y[b]! - this.yRef);
    }
    this.edgeVerts = edgePos.length / 2;

    const nodeBuf = gl.createBuffer()!;
    const edgeBuf = gl.createBuffer()!;
    this.buffers = [nodeBuf, edgeBuf];

    this.nodeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, nodePos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.edgeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edgePos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.edgeUniforms = uniformLocations(gl, this.progs.edge, [...TRANSFORM_UNIFORMS, "uColor"]);
    this.nodeUniforms = uniformLocations(gl, this.progs.node, [...TRANSFORM_UNIFORMS, "uColor", "uSize"]);
  }

  bounds() {
    if (this.nodeCount === 0) return null;
    return { x: this.xBounds, y: this.yBounds };
  }

  draw(state: DrawState): void {
    if (this.nodeCount === 0) return;
    const gl = state.gl;
    // Edges first, nodes on top.
    if (this.edgeVerts > 0) {
      gl.useProgram(this.progs.edge);
      setTransformUniforms(gl, this.edgeUniforms, state.x, state.y, this.xRef, this.yRef);
      gl.uniform4f(this.edgeUniforms.uColor!, this.edgeColor[0], this.edgeColor[1], this.edgeColor[2], this.edgeColor[3]);
      gl.bindVertexArray(this.edgeVao);
      gl.drawArrays(gl.LINES, 0, this.edgeVerts);
    }
    gl.useProgram(this.progs.node);
    setTransformUniforms(gl, this.nodeUniforms, state.x, state.y, this.xRef, this.yRef);
    gl.uniform4f(this.nodeUniforms.uColor!, this.nodeColor[0], this.nodeColor[1], this.nodeColor[2], this.nodeColor[3]);
    gl.uniform1f(this.nodeUniforms.uSize!, this.nodeSize * state.dpr);
    gl.bindVertexArray(this.nodeVao);
    gl.drawArrays(gl.POINTS, 0, this.nodeCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.nodeVao);
    this.gl.deleteVertexArray(this.edgeVao);
    for (const b of this.buffers) this.gl.deleteBuffer(b);
  }
}
