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

/** Duck-type test: everything a `Plot` needs to draw and dispose a series. */
export function isLayer(value: unknown): value is Layer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Layer>;
  return typeof v.id === "string"
    && typeof v.draw === "function"
    && typeof v.bounds === "function"
    && typeof v.dispose === "function";
}

/**
 * Every layer reachable from a chart builder's return value.
 *
 * Builders hand back handles of every shape — a bare layer, `{ upper, middle,
 * lower, band? }`, `{ lines: Layer[], arrows? }` — mixed in with computed data
 * like `auc` or `layout`. A binding that wants to tear the chart down has to
 * find the layers among that, and enumerating each handle by hand is how one
 * gets forgotten (a model graph leaked its connectors for exactly that reason).
 *
 * Walks one level into arrays and plain objects, which covers every builder here.
 */
export function collectLayers(handle: unknown): Layer[] {
  const out: Layer[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (isLayer(value)) { out.push(value); return; }
    if (depth <= 0 || typeof value !== "object" || value === null) return;
    if (ArrayBuffer.isView(value)) return; // typed arrays are data, not handles
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth - 1);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) visit(item, depth - 1);
  };
  visit(handle, 3);
  return out;
}
