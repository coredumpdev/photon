export interface RenderContext {
  gl: WebGL2RenderingContext;
  /** CSS pixel width / height of the drawing area (the plot region). */
  width: number;
  height: number;
  /** devicePixelRatio in effect. */
  dpr: number;
}

/** Create a WebGL2 context configured for crisp 2D plotting. */
export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    premultipliedAlpha: true,
    alpha: true,
  });
  if (!gl) throw new Error("WebGL2 is not supported in this environment");
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return gl;
}

/** Parse a CSS hex/rgb color string into normalized RGBA (0..1). */
export function parseColor(input: string): [number, number, number, number] {
  const s = input.trim();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(",").map((p) => parseFloat(p.trim()));
    return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255, parts[3] ?? 1];
  }
  return [0, 0, 0, 1];
}

/** Normalized RGBA (0..1) back to a CSS `rgba(...)` string. */
export function toColorCss(c: readonly [number, number, number, number]): string {
  const to255 = (v: number) => Math.round(v * 255);
  return `rgba(${to255(c[0])},${to255(c[1])},${to255(c[2])},${c[3]})`;
}
