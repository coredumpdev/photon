import { colormap, type ColormapName } from "../color/colormap.js";
import { bufferUsage, createProgram, uniformLocations } from "../gl/program.js";
import type { Range, RenderType } from "../types.js";
import type { Bounds3, ColorInfo, Layer3D } from "./layer3d.js";
import type { Mat4 } from "./mat4.js";

export interface VolumeOptions {
  /** Scalar volume, length `nx*ny*nz`, indexed `x + y*nx + z*nx*ny`. */
  values: ArrayLike<number>;
  dims: [number, number, number];
  /** World extent of the volume. Defaults to unit indices. */
  extent?: { x: Range; y: Range; z: Range };
  colormap?: ColormapName;
  /** Value range mapped to the colormap + opacity. Defaults to the data min/max. */
  domain?: Range;
  /** Overall opacity multiplier. Default 1. */
  density?: number;
  name?: string;
  /** Buffer-usage hint; set `"dynamic"` when streaming via setData. Default `"static"`. */
  renderType?: RenderType;
}

const STEPS = 160;

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;    // world position of the box corner
layout(location = 1) in vec3 aLocal;  // [0,1]^3 texture coord of the corner
uniform mat4 uMVP;
out vec3 vLocal;
void main() { vLocal = aLocal; gl_Position = uMVP * vec4(aPos, 1.0); }`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vLocal;
uniform highp sampler3D uVolume;
uniform sampler2D uLUT;
uniform vec3 uCamLocal;
uniform float uDensity;
out vec4 outColor;

void main() {
  vec3 dir = normalize(vLocal - uCamLocal);
  vec3 invDir = 1.0 / dir;
  vec3 t0 = (vec3(0.0) - uCamLocal) * invDir;
  vec3 t1 = (vec3(1.0) - uCamLocal) * invDir;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  tNear = max(tNear, 0.0);
  if (tFar <= tNear) discard;

  float dt = (tFar - tNear) / float(${STEPS});
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${STEPS}; i++) {
    float t = tNear + (float(i) + 0.5) * dt;
    vec3 p = uCamLocal + dir * t;
    float v = texture(uVolume, p).r; // normalized 0..1
    vec3 col = texture(uLUT, vec2(v, 0.5)).rgb;
    float a = clamp(v * uDensity * dt * 120.0, 0.0, 1.0);
    acc.rgb += (1.0 - acc.a) * col * a;
    acc.a += (1.0 - acc.a) * a;
    if (acc.a > 0.98) break;
  }
  if (acc.a < 0.001) discard;
  outColor = acc; // premultiplied
}`;

const programCache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
function getProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = programCache.get(gl);
  if (!p) { p = createProgram(gl, VERT, FRAG); programCache.set(gl, p); }
  return p;
}

// Unit cube [0,1]^3 corners → 36 verts (position == local texcoord; scaled to world at build).
const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const CUBE_FACES = [
  [0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1],
  [3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2],
];

let counter = 0;

/**
 * Direct volume rendering: GPU raymarching through a 3D texture with front-to-back
 * alpha compositing and a colormap transfer function. Draws the volume's bounding
 * box (back faces) and integrates each ray across the box interior.
 */
export class VolumeLayer implements Layer3D {
  readonly id: string;
  readonly name?: string;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private tex: WebGLTexture;
  private lut: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private b3: Bounds3;
  private ext: { x: Range; y: Range; z: Range };
  private density: number;
  private cmapName: ColormapName;
  private vDomain: Range = [0, 1];
  private dims: [number, number, number];
  private domainOpt?: Range;
  private usage: number;
  private camLocal: [number, number, number] = [0.5, 0.5, 2];

  constructor(gl: WebGL2RenderingContext, opts: VolumeOptions) {
    this.id = `volume-${counter++}`;
    this.gl = gl;
    this.program = getProgram(gl);
    this.name = opts.name;
    this.usage = bufferUsage(gl, opts.renderType);
    this.density = opts.density ?? 1;
    this.cmapName = opts.colormap ?? "viridis";
    this.dims = opts.dims;
    this.domainOpt = opts.domain;
    const [nx, ny, nz] = opts.dims;
    const ex = opts.extent?.x ?? [0, nx - 1];
    const ey = opts.extent?.y ?? [0, ny - 1];
    const ez = opts.extent?.z ?? [0, nz - 1];
    this.ext = { x: ex, y: ey, z: ez };
    this.b3 = { x: ex, y: ey, z: ez };

    // R8 3D texture (normalized value), linear-filtered.
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    this.uploadVolume(opts.values);

    // 256×1 colormap LUT.
    const cmap = colormap(this.cmapName);
    const lutPix = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = cmap(i / 255);
      lutPix[i * 4] = Math.round(r * 255); lutPix[i * 4 + 1] = Math.round(g * 255); lutPix[i * 4 + 2] = Math.round(b * 255); lutPix[i * 4 + 3] = 255;
    }
    this.lut = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutPix);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Box geometry: world position (extent) + [0,1] local texcoord per corner.
    const data: number[] = [];
    for (const face of CUBE_FACES) {
      for (const ci of face) {
        const c = CUBE_CORNERS[ci]!;
        const wxp = ex[0] + c[0]! * (ex[1] - ex[0]);
        const wyp = ey[0] + c[1]! * (ey[1] - ey[0]);
        const wzp = ez[0] + c[2]! * (ez[1] - ez[0]);
        data.push(wxp, wyp, wzp, c[0]!, c[1]!, c[2]!);
      }
    }
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), this.usage);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    this.uniforms = uniformLocations(gl, this.program, ["uMVP", "uVolume", "uLUT", "uCamLocal", "uDensity"]);
  }

  /** Normalize the scalar field and (re)upload it into the R8 3D texture. */
  private uploadVolume(values: ArrayLike<number>): void {
    const gl = this.gl;
    const [nx, ny, nz] = this.dims;
    let vmin = this.domainOpt?.[0] ?? Infinity;
    let vmax = this.domainOpt?.[1] ?? -Infinity;
    if (!this.domainOpt) {
      for (let i = 0; i < values.length; i++) { const v = values[i]!; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    }
    this.vDomain = [vmin, vmax];
    const span = vmax - vmin || 1;

    const voxels = new Uint8Array(nx * ny * nz);
    for (let i = 0; i < voxels.length; i++) voxels[i] = Math.max(0, Math.min(255, Math.round(((values[i]! - vmin) / span) * 255)));
    gl.bindTexture(gl.TEXTURE_3D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, nx, ny, nz, 0, gl.RED, gl.UNSIGNED_BYTE, voxels);
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  /** Stream a new scalar volume (same dims); re-uploads the 3D texture. Call `plot.refresh()` after. */
  setData(values: ArrayLike<number>): void {
    this.uploadVolume(values);
  }

  bounds3() { return this.b3; }

  colorInfo(): ColorInfo { return { colormap: this.cmapName, domain: this.vDomain, label: this.name }; }

  /** Set the camera position in world space; converted to the volume's [0,1] local space. */
  setCamera(worldEye: [number, number, number]): void {
    const { x, y, z } = this.ext;
    this.camLocal = [
      (worldEye[0] - x[0]) / ((x[1] - x[0]) || 1),
      (worldEye[1] - y[0]) / ((y[1] - y[0]) || 1),
      (worldEye[2] - z[0]) / ((z[1] - z[0]) || 1),
    ];
  }

  draw(gl: WebGL2RenderingContext, mvp: Mat4): void {
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMVP!, false, mvp);
    gl.uniform3f(this.uniforms.uCamLocal!, this.camLocal[0], this.camLocal[1], this.camLocal[2]);
    gl.uniform1f(this.uniforms.uDensity!, this.density);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.tex);
    gl.uniform1i(this.uniforms.uVolume!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.uniform1i(this.uniforms.uLUT!, 1);

    // Translucent: composite over the scene, don't write depth, integrate each ray
    // once by keeping only back faces.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteTexture(this.tex);
    this.gl.deleteTexture(this.lut);
  }
}
