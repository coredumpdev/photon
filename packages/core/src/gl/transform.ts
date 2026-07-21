/**
 * Shared data→clip transform used by every layer's vertex shader.
 *
 * Two subtleties it handles:
 *  - **Log axes** — when `uLogX/uLogY` is set, the real coordinate is
 *    log10-transformed on the GPU.
 *  - **Float32 precision** — vertex buffers are float32 (~7 significant digits),
 *    which is not enough for large values like epoch-millisecond timestamps.
 *    Layers upload coordinates *relative to a reference* (`x - xRef`) and pass
 *    `uXRef`; the domain is passed in the same offset space, so the subtraction
 *    that computes the normalized position never suffers catastrophic
 *    cancellation. For log axes the reference is added back before log10.
 */
export const TRANSFORM_GLSL = /* glsl */ `
uniform vec2 uDomainX;   // linear: (lo-ref, hi-ref) ; log: (log10 lo, log10 hi)
uniform vec2 uDomainY;
uniform float uXRef;
uniform float uYRef;
uniform float uLogX;     // >0.5 => log axis
uniform float uLogY;

vec2 dataToNorm(vec2 p) {
  float cx = (uLogX > 0.5) ? log(p.x + uXRef) / 2.302585092994046 : p.x;
  float cy = (uLogY > 0.5) ? log(p.y + uYRef) / 2.302585092994046 : p.y;
  float nx = (cx - uDomainX.x) / (uDomainX.y - uDomainX.x);
  float ny = (cy - uDomainY.x) / (uDomainY.y - uDomainY.x);
  return vec2(nx, ny);
}

vec2 dataToClip(vec2 p) {
  return dataToNorm(p) * 2.0 - 1.0;
}
`;

/** Per-axis view state handed to a layer each frame. `lo`/`hi` are raw data-space. */
export interface AxisFrame {
  lo: number;
  hi: number;
  log: boolean;
}

export const TRANSFORM_UNIFORMS = [
  "uDomainX",
  "uDomainY",
  "uXRef",
  "uYRef",
  "uLogX",
  "uLogY",
] as const;

/** Set the shared transform uniforms for a layer given its per-axis references. */
export function setTransformUniforms(
  gl: WebGL2RenderingContext,
  u: Record<string, WebGLUniformLocation | null>,
  x: AxisFrame,
  y: AxisFrame,
  xRef: number,
  yRef: number,
): void {
  const [lox, hix] = x.log ? [Math.log10(x.lo), Math.log10(x.hi)] : [x.lo - xRef, x.hi - xRef];
  const [loy, hiy] = y.log ? [Math.log10(y.lo), Math.log10(y.hi)] : [y.lo - yRef, y.hi - yRef];
  gl.uniform2f(u.uDomainX!, lox, hix);
  gl.uniform2f(u.uDomainY!, loy, hiy);
  gl.uniform1f(u.uXRef!, xRef);
  gl.uniform1f(u.uYRef!, yRef);
  gl.uniform1f(u.uLogX!, x.log ? 1 : 0);
  gl.uniform1f(u.uLogY!, y.log ? 1 : 0);
}
