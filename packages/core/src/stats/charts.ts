/**
 * Statistics chart builders — free functions that compose existing layers, the
 * same shape as the finance / diagram / ML packs.
 */
import type { ColormapSpec } from "../color/colormap.js";
import type { AreaLayer } from "../layers/area.js";
import type { HeatmapLayer } from "../layers/heatmap.js";
import type { LineLayer } from "../layers/line.js";
import type { Patch, PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { RenderType } from "../types.js";
import { hist2d, type Histogram2D } from "./index.js";
import { corrMatrix, ecdf, linearRegression, linearTrend, loess, type LinearFit } from "./regression.js";
import { welch, type WindowName } from "./signal.js";

export interface RegressionOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** `"ols"` (default) fits a straight line; `"loess"` fits a local curve. */
  method?: "ols" | "loess";
  /**
   * Shade ±`band`·standard-error around an OLS fit (2 ≈ 95%). Ignored for
   * LOESS, which has no closed-form interval here. Default 0 (no band).
   */
  band?: number;
  /** LOESS neighbourhood as a fraction of the points, 0..1. Default 0.3. */
  bandwidth?: number;
  /** Samples along the fitted curve. Default 2 for OLS, 100 for LOESS. */
  points?: number;
  color?: string;
  bandColor?: string;
  width?: number;
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

export interface RegressionHandle {
  line: LineLayer;
  band?: AreaLayer;
  /** The OLS fit (slope/intercept/r²), or null for LOESS. */
  fit: LinearFit | null;
}

/**
 * A trend line over a scatter — least squares by default, with an optional
 * confidence band, or a LOESS curve when the relationship is not linear. The
 * series name carries r² so the chart states its own fit quality.
 */
export function addRegression(plot: Plot, opts: RegressionOptions): RegressionHandle {
  const method = opts.method ?? "ols";
  const color = opts.color ?? "#f472b6";
  const trend = method === "loess"
    ? loess(opts.x, opts.y, { bandwidth: opts.bandwidth, points: opts.points ?? 100 })
    : linearTrend(opts.x, opts.y, { points: opts.points ?? 2, band: opts.band });
  const fit = method === "ols" ? linearRegression(opts.x, opts.y) : null;

  let band: AreaLayer | undefined;
  if (trend.lower && trend.upper) {
    band = plot.addArea({
      x: trend.x,
      y: trend.upper,
      base: trend.lower,
      color: opts.bandColor ?? `${color}33`,
      yAxis: opts.yAxis,
      renderType: opts.renderType,
    });
  }
  const label = opts.name ?? (fit ? `fit · r²=${fit.r2.toFixed(3)}` : "loess");
  const line = plot.addLine({
    x: trend.x,
    y: trend.y,
    color,
    width: opts.width ?? 2,
    name: label,
    yAxis: opts.yAxis,
    renderType: opts.renderType,
  });
  return { line, ...(band ? { band } : {}), fit };
}

export interface EcdfOptions {
  values: ArrayLike<number>;
  color?: string;
  width?: number;
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

/**
 * The empirical CDF as a step line: the most honest way to compare two
 * distributions, since it involves no binning choice at all.
 */
export function addEcdf(plot: Plot, opts: EcdfOptions): LineLayer {
  const { x, y } = ecdf(opts.values);
  return plot.addLine({
    x,
    y,
    step: "after",
    color: opts.color ?? "#60a5fa",
    width: opts.width ?? 2,
    name: opts.name,
    yAxis: opts.yAxis,
    renderType: opts.renderType,
  });
}

export interface CorrMatrixOptions {
  /** One array per variable. */
  columns: ReadonlyArray<ArrayLike<number>>;
  /** Variable names, used for the axis tick labels. */
  names?: string[];
  /** Defaults to a diverging map so ±1 read as opposites. */
  colormap?: ColormapSpec;
  /** Label the axes with `names`. Default true. */
  labelAxes?: boolean;
  name?: string;
  yAxis?: string;
}

export interface CorrMatrixHandle {
  heatmap: HeatmapLayer;
  /** Row-major `k×k` correlations. */
  values: Float64Array;
  size: number;
}

/**
 * A correlation matrix as a heatmap, on a diverging colormap locked to ±1 so
 * that zero is the neutral colour and sign is readable at a glance.
 */
export function addCorrMatrix(plot: Plot, opts: CorrMatrixOptions): CorrMatrixHandle {
  const { values, size } = corrMatrix(opts.columns);
  const heatmap = plot.addHeatmap({
    values,
    cols: size,
    rows: size,
    extent: { x: [-0.5, size - 0.5], y: [-0.5, size - 0.5] },
    colormap: opts.colormap ?? "RdBu",
    domain: [-1, 1],
    smooth: false,
    name: opts.name ?? "correlation",
    yAxis: opts.yAxis,
  });
  if (opts.labelAxes !== false && opts.names?.length) {
    const names = opts.names;
    const ticks = names.map((_, i) => i);
    const format = (v: number): string => names[Math.round(v)] ?? "";
    plot.setAxis("x", { ticks, format });
    plot.setAxis(opts.yAxis ?? "y", { ticks, format });
  }
  return { heatmap, values, size };
}

export interface PsdOptions {
  signal: ArrayLike<number>;
  sampleRate?: number;
  /** Samples per Welch segment. Default 256. */
  segment?: number;
  overlap?: number;
  window?: WindowName;
  /** Plot power in dB (10·log10). Default true — spectra span decades. */
  decibels?: boolean;
  color?: string;
  width?: number;
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

export interface PsdHandle {
  line: LineLayer;
  frequencies: Float64Array;
  power: Float64Array;
}

/**
 * Welch power spectral density as a line — averaged over overlapping windowed
 * segments, so a noisy signal gives a readable spectrum instead of grass.
 */
export function addPsd(plot: Plot, opts: PsdOptions): PsdHandle {
  const psd = welch(opts.signal, {
    sampleRate: opts.sampleRate,
    segment: opts.segment,
    overlap: opts.overlap,
    window: opts.window,
  });
  const y = opts.decibels === false
    ? psd.power
    : Float64Array.from(psd.power, (p) => 10 * Math.log10(p + 1e-20));
  const line = plot.addLine({
    x: psd.frequencies,
    y,
    color: opts.color ?? "#38bdf8",
    width: opts.width ?? 1.5,
    name: opts.name ?? "PSD",
    yAxis: opts.yAxis,
    renderType: opts.renderType,
  });
  return { line, frequencies: psd.frequencies, power: psd.power };
}

export interface Hist2dOptions {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Bin count, or `[cols, rows]`. Defaults to √n per axis. */
  bins?: number | [number, number];
  /** Fixed binning range; defaults to the data extent. */
  range?: { x: [number, number]; y: [number, number] };
  colormap?: ColormapSpec;
  /** Count range mapped to the colormap. Defaults to `[0, max]`. */
  domain?: [number, number];
  /** Interpolate between cells. Default false — a histogram has hard bins. */
  smooth?: boolean;
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

export interface Hist2dHandle {
  heatmap: HeatmapLayer;
  bins: Histogram2D;
}

/**
 * A 2-D histogram (matplotlib's `hist2d`): rectangular binning of a point cloud,
 * drawn as a heatmap. Reach for `addHexbin` instead when the cloud is dense —
 * hexagons have no preferred direction, so they read density more evenly.
 */
export function addHist2d(plot: Plot, opts: Hist2dOptions): Hist2dHandle {
  const bins = hist2d(opts.x, opts.y, { bins: opts.bins, range: opts.range });
  let max = 0;
  for (let i = 0; i < bins.values.length; i++) if (bins.values[i]! > max) max = bins.values[i]!;
  const heatmap = plot.addHeatmap({
    values: bins.values,
    cols: bins.cols,
    rows: bins.rows,
    extent: bins.extent,
    colormap: opts.colormap ?? "viridis",
    domain: opts.domain ?? [0, max || 1],
    smooth: opts.smooth ?? false,
    name: opts.name ?? "count",
    yAxis: opts.yAxis,
    renderType: opts.renderType,
  });
  return { heatmap, bins };
}

export interface EventPlotOptions {
  /** One array of event positions per row. */
  positions: ReadonlyArray<ArrayLike<number>>;
  /** Row centres. Defaults to `0, 1, 2, …`. */
  offsets?: ArrayLike<number>;
  /** Tick height in data units. Default 0.7. */
  lineLength?: number;
  /** Tick width in data units. Defaults to 1/400 of the position span. */
  lineWidth?: number;
  /** Lay the ticks out along y instead of x. Default `"horizontal"`. */
  orientation?: "horizontal" | "vertical";
  /** One colour, or one per row. */
  color?: string | string[];
  name?: string;
  yAxis?: string;
  renderType?: RenderType;
}

/**
 * An event raster (matplotlib's `eventplot`): one row of tick marks per series —
 * spike trains, arrival times, anything where *when* matters and magnitude does
 * not. Ticks are thin quads, so one layer covers every row.
 */
export function addEventPlot(plot: Plot, opts: EventPlotOptions): PatchesLayer {
  const rows = opts.positions.length;
  const height = opts.lineLength ?? 0.7;
  let lo = Infinity, hi = -Infinity;
  for (const row of opts.positions) {
    for (let i = 0; i < row.length; i++) { const v = row[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  const width = opts.lineWidth ?? (isFinite(hi - lo) && hi > lo ? (hi - lo) / 400 : 0.01);
  const vertical = opts.orientation === "vertical";

  const patches: Patch[] = [];
  for (let r = 0; r < rows; r++) {
    const centre = opts.offsets?.[r] ?? r;
    const color = Array.isArray(opts.color) ? opts.color[r % opts.color.length] : opts.color;
    const a = centre - height / 2, b = centre + height / 2;
    const row = opts.positions[r]!;
    for (let i = 0; i < row.length; i++) {
      const t = row[i]!;
      if (!isFinite(t)) continue;
      const x = vertical ? [a, b, b, a] : [t - width / 2, t + width / 2, t + width / 2, t - width / 2];
      const y = vertical ? [t - width / 2, t - width / 2, t + width / 2, t + width / 2] : [a, a, b, b];
      patches.push({ x: Float64Array.from(x), y: Float64Array.from(y), ...(color ? { color } : {}) });
    }
  }
  return plot.addPatches({
    patches,
    color: Array.isArray(opts.color) ? undefined : (opts.color ?? "#60a5fa"),
    name: opts.name,
    yAxis: opts.yAxis,
    renderType: opts.renderType,
  });
}
