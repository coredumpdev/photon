import { createProgram, uniformLocations } from "../gl/program.js";
import { setTransformUniforms, TRANSFORM_GLSL, TRANSFORM_UNIFORMS } from "../gl/transform.js";
import type { Range, RenderType } from "../types.js";
import type { DrawState, Layer } from "./layer.js";

/** Anything `texImage2D` accepts, or a URL string the layer loads itself. */
export type ImageSource = TexImageSource | string;

export interface ImageOptions {
  /** A decoded bitmap/canvas/ImageData, or a URL to load (CORS-enabled). */
  source: ImageSource;
  /** Data-space rectangle the image spans. */
  extent: { x: Range; y: Range };
  /** Bilinear filtering (default) vs. nearest. */
  smooth?: boolean;
  /** Overall opacity 0..1. Default 1. */
  opacity?: number;
  /** Called after an async (URL) image finishes loading — wire to `plot.requestRender`. */
  onLoad?: () => void;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
  name?: string;
  yAxis?: string;
}

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;  // offset data space
layout(location = 1) in vec2 aUV;
${TRANSFORM_GLSL}
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  float a = c.a * uOpacity;
  outColor = vec4(c.rgb * a, a);
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

let counter = 0;

/**
 * An RGBA image (Bokeh `image_rgba` / `image_url`) drawn as a textured quad over
 * a data-space extent — reuses the heatmap quad path. A `string` source is loaded
 * asynchronously; pass `onLoad` (→ `plot.requestRender`) so the plot redraws once
 * the pixels arrive.
 */
export class ImageLayer implements Layer {
  readonly id: string;
  readonly name: string;
  readonly colorCss = "#94a3b8";
  readonly yAxis: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private texture: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private xRef: number;
  private yRef: number;
  private ext: { x: Range; y: Range };
  private opacity: number;
  private smooth: boolean;
  private ready = false;
  private img: HTMLImageElement | null = null;

  constructor(gl: WebGL2RenderingContext, opts: ImageOptions) {
    this.id = `image-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name ?? this.id;
    this.yAxis = opts.yAxis ?? "y";
    this.ext = opts.extent;
    this.opacity = opts.opacity ?? 1;
    this.smooth = opts.smooth !== false;
    const [x0, x1] = opts.extent.x;
    const [y0, y1] = opts.extent.y;
    this.xRef = x0;
    this.yRef = y0;

    this.texture = gl.createTexture()!;
    // A 1×1 transparent placeholder until the real source is uploaded.
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.setSource(opts.source, opts.onLoad);

    // Quad over the extent (v=0 at y0, matching texImage2D row order via flipY).
    const data = new Float32Array([
      x0 - this.xRef, y0 - this.yRef, 0, 0,
      x1 - this.xRef, y0 - this.yRef, 1, 0,
      x1 - this.xRef, y1 - this.yRef, 1, 1,
      x0 - this.xRef, y0 - this.yRef, 0, 0,
      x1 - this.xRef, y1 - this.yRef, 1, 1,
      x0 - this.xRef, y1 - this.yRef, 0, 1,
    ]);
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.vao = vao; this.buffer = buffer;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, [...TRANSFORM_UNIFORMS, "uTex", "uOpacity"]);
  }

  /** Point the texture at a new source: load a URL async, or upload a bitmap now. */
  private setSource(source: ImageSource, onLoad?: () => void): void {
    if (typeof source === "string") {
      if (this.img) this.img.onload = null;
      const img = new Image();
      this.img = img;
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.upload(img);
        onLoad?.();
      };
      img.src = source;
    } else {
      this.img = null;
      this.upload(source);
    }
  }

  /** Replace the image source and re-upload the texture (for streaming). */
  setData(source: ImageSource, onLoad?: () => void): void {
    this.setSource(source, onLoad);
  }

  private upload(src: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Flip so the image's top row lands at the top of the extent (y1).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const filter = this.smooth ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.ready = true;
  }

  bounds() {
    return { x: this.ext.x, y: this.ext.y };
  }

  draw(state: DrawState): void {
    if (!this.ready) return;
    const gl = state.gl;
    gl.useProgram(this.program);
    setTransformUniforms(gl, this.uniforms, state.x, state.y, this.xRef, this.yRef);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.uTex!, 0);
    gl.uniform1f(this.uniforms.uOpacity!, this.opacity);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.img) this.img.onload = null;
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteTexture(this.texture);
  }
}
