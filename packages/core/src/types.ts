/** A single axis tick. Only `value` is required; everything else has sensible defaults. */
export interface Tick {
  /** Position in data space. */
  value: number;
  /** Text shown next to the tick. If omitted, the axis `format` fn is used. */
  label?: string;
  /** Minor ticks are short, unlabeled, and (by default) draw no grid line. */
  minor?: boolean;
  /** Whether this tick draws a grid line. Defaults to `true` for major, `false` for minor. */
  grid?: boolean;
}

/** How a user may specify ticks for an axis. */
export type TicksSpec =
  | number[]
  | Tick[]
  | ((min: number, max: number) => Array<number | Tick>);

export interface AxisConfig {
  /** Ticks: an array of positions, an array of `Tick` objects, or a generator fn. */
  ticks?: TicksSpec;
  /** Extra ticks layered on top of the auto ticks (only used when `ticks` is not set). */
  addTicks?: Array<number | Tick>;
  /** Formats a numeric tick value into a label when the tick has no explicit `label`. */
  format?: (value: number) => string;
  /** Auto minor ticks: `true` for a default count, or a number of subdivisions per major interval. */
  minorTicks?: boolean | number;
  /** Axis title, drawn along the axis. */
  title?: string;

  // ---- Styling (all optional; omitting a field keeps the theme default). ------
  /** Draw the axis line. Default true. */
  showAxisLine?: boolean;
  /** Axis line color. Default: the per-axis `color`, else `theme.axis`. */
  axisLineColor?: string;
  /** Axis line width in px. Default 1. */
  axisLineWidth?: number;
  /** Draw tick marks. Default true. */
  showTicks?: boolean;
  /** Tick mark color. Default: the per-axis `color`, else `theme.axis`. */
  tickColor?: string;
  /** Major tick length in px. Default 5 (minor ticks are 3). */
  tickLength?: number;
  /** Tick mark line width in px. Default 1. */
  tickWidth?: number;
  /** Tick label color. Default: the per-axis `color`, else `theme.text`. */
  labelColor?: string;
  /** Tick label font (CSS `font` shorthand). Default `theme.font`. */
  labelFont?: string;
  /** Rotate tick labels by this many degrees. Default 0. */
  labelRotation?: number;
  /** Gap in px between a tick and its label. Default 3. */
  labelStandoff?: number;
  /** Axis title color. Default: the per-axis `color`, else `theme.text`. */
  titleColor?: string;
  /** Axis title font (CSS `font` shorthand). Default `theme.font`. */
  titleFont?: string;
  /** Draw grid lines for this axis. Default true. */
  showGrid?: boolean;
  /** Major grid line color. Default `theme.grid`. */
  gridColor?: string;
  /** Grid line width in px. Default 1. */
  gridWidth?: number;
  /** Grid line dash pattern (Canvas `setLineDash`). Default solid. */
  gridDash?: number[];
  /** Minor grid line color. Default `theme.gridMinor`. */
  gridMinorColor?: string;
}

export type Dim = "x" | "y";

/**
 * Pointer interaction modes:
 *  - `pan`    drag pans the view, wheel zooms both axes
 *  - `box`    drag selects a rectangle and zooms into it (both axes)
 *  - `box-x`  drag selects an x-range only (full height band) — X-only zoom
 *  - `box-y`  drag selects a y-range only (full width band) — Y-only zoom
 */
export type InteractionMode = "pan" | "box" | "box-x" | "box-y";

export type Range = readonly [number, number];

export interface Bounds {
  x: Range;
  y: Range;
}

/** RGBA in 0..1. */
export type Color = readonly [number, number, number, number];
