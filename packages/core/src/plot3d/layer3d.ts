import type { Range } from "../types.js";
import type { Mat4 } from "./mat4.js";

export interface Bounds3 {
  x: Range;
  y: Range;
  z: Range;
}

/** A drawable in the 3D scene. Positions are in world space; Plot3D supplies the MVP. */
export interface Layer3D {
  readonly id: string;
  bounds3(): Bounds3 | null;
  draw(gl: WebGL2RenderingContext, mvp: Mat4): void;
  dispose(): void;
}
