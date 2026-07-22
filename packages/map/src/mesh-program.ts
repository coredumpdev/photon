/**
 * The shared WebGL2 program for drawing tile/GeoJSON meshes: polygon fills and
 * width-expanded line quads, from the interleaved `[x,y,nx,ny,r,g,b,a]` buffer.
 * Used by both {@link MapLayer} and the GeoJSON layer.
 */
import { createProgram, TRANSFORM_GLSL, TRANSFORM_UNIFORMS, uniformLocations } from "@photonviz/core";

/** Bytes per vertex: 8 float32s. */
export const MESH_STRIDE = 32;

/** Uniform names the mesh program exposes. */
export const MESH_UNIFORMS = [...TRANSFORM_UNIFORMS, "uWorldPerPixel"];

const VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aNormal;   // perpendicular × half-width (px)
layout(location = 2) in vec4 aColor;
uniform float uWorldPerPixel;
${TRANSFORM_GLSL}
out vec4 vColor;
void main() {
  vColor = aColor;
  vec2 wp = aPos + aNormal * uWorldPerPixel; // constant screen-space thickness
  gl_Position = vec4(dataToClip(wp), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor.rgb * vColor.a, vColor.a); // premultiplied
}`;

const cache = new WeakMap<WebGL2RenderingContext, WebGLProgram>();

export function getMeshProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let p = cache.get(gl);
  if (!p) {
    p = createProgram(gl, VERT, FRAG);
    cache.set(gl, p);
  }
  return p;
}

export function meshUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Record<string, WebGLUniformLocation | null> {
  return uniformLocations(gl, program, MESH_UNIFORMS);
}

/** Wire the three vertex attributes; call with the VAO and buffer already bound. */
export function bindMeshAttribs(gl: WebGL2RenderingContext): void {
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, MESH_STRIDE, 0); // aPos
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, MESH_STRIDE, 8); // aNormal
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, MESH_STRIDE, 16); // aColor
}
