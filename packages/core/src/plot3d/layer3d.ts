import type { ColormapName } from "../color/colormap.js";
import type { Range } from "../types.js";
import type { Mat4 } from "./mat4.js";

export interface Bounds3 {
  x: Range;
  y: Range;
  z: Range;
}

/** A colormapped layer's scale, surfaced to {@link Plot3D} for a colorbar. */
export interface ColorInfo {
  colormap: ColormapName;
  domain: Range;
  label?: string;
}

/** A drawable in the 3D scene. Positions are in world space; Plot3D supplies the MVP. */
export interface Layer3D {
  readonly id: string;
  /** Series name for the legend (optional). */
  readonly name?: string;
  /** A solid CSS color for the legend swatch (solid-colored layers only). */
  readonly colorCss?: string;
  bounds3(): Bounds3 | null;
  /** Colormap + value range for a colorbar, if this layer is colormapped. */
  colorInfo?(): ColorInfo | null;
  /**
   * Data-space points for hover picking (xyz triples), with an optional per-point
   * tooltip label builder. Null if the layer isn't pickable.
   */
  pickData?(): { positions: Float32Array; label?: (i: number) => string } | null;
  draw(gl: WebGL2RenderingContext, mvp: Mat4): void;
  dispose(): void;
}
