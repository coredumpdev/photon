/**
 * A single process-wide WebGL2 context shared by every Plot / Plot3D.
 *
 * Browsers cap the number of simultaneous WebGL contexts (~16 in Chrome); one
 * context per chart quickly exceeds that and the browser silently evicts the
 * oldest contexts, leaving blank charts. Instead we keep ONE offscreen context,
 * render each chart's scene into it, and blit the result into that chart's own
 * lightweight 2D canvas. GPU resources (buffers, textures, programs) live in the
 * shared context, so layers created by different plots coexist fine.
 */
let shared: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null = null;

export function getSharedGL(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    premultipliedAlpha: true,
    alpha: true,
    // Required so the rendered frame survives long enough to be blitted out.
    preserveDrawingBuffer: true,
    depth: true,
  });
  if (!gl) throw new Error("WebGL2 is not supported in this environment");
  shared = { canvas, gl };
  return shared;
}

/** Configure the shared context for 2D (blend on, depth off) rendering. */
export function begin2D(gl: WebGL2RenderingContext): void {
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

/** Configure the shared context for 3D (depth on) rendering. */
export function begin3D(gl: WebGL2RenderingContext): void {
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

/** Resize the shared canvas to the target device-pixel size (idempotent). */
export function sizeShared(gl: WebGL2RenderingContext, w: number, h: number): void {
  const c = gl.canvas as HTMLCanvasElement;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
}
