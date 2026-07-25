import type { ColorInfo } from "../color/colormap.js";
import type { AxisFrame } from "../gl/transform.js";
import type { Range } from "../types.js";

/** State handed to a layer each frame so it can transform data to clip space. */
export interface DrawState {
  gl: WebGL2RenderingContext;
  x: AxisFrame;
  y: AxisFrame;
  /** Plot-region size in device pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** devicePixelRatio, for converting pixel-space widths/sizes. */
  dpr: number;
}

/** A drawable data series backed by GPU buffers. */
export interface Layer {
  readonly id: string;
  /** The y axis this layer is bound to. */
  readonly yAxis: string;
  /** Data-space bounds of this layer, for autoscaling. `null` if empty. */
  bounds(): { x: Range; y: Range } | null;
  /**
   * Colormap + value range, when this layer maps values to colours — the plot
   * uses it to draw a colorbar. `null`/absent for solid-coloured layers.
   */
  colorInfo?(): ColorInfo | null;
  draw(state: DrawState): void;
  dispose(): void;
}
