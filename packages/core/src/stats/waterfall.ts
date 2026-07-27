/**
 * Waterfall — a scrolling spectrogram. Every pushed column lands as the newest
 * row at the top and the whole history slides one row down, so the picture flows
 * downwards while the y axis reads as elapsed time.
 *
 * Two things make it more than "a heatmap you call setData on":
 *  • A heatmap's extent is fixed at construction, so the image cannot move. The
 *    time axis therefore lives in the ticks: each one carries the clock of the
 *    row it sits on and rides down with that row.
 *  • An axis caches its resolved ticks while the domain and the config object
 *    hold still, and this domain never moves — so ticks are handed over as a
 *    fresh array on every push, not as a generator that would be called once.
 */
import type { ColormapSpec } from "../color/colormap.js";
import type { HeatmapLayer } from "../layers/heatmap.js";
import type { Plot } from "../plot.js";
import type { Range, RenderType, Tick } from "../types.js";

/** Built-in tick label shapes for a time axis. */
export type TimeFormat = "hh:mm:ss" | "mm:ss.mmm";

/** Format a duration in seconds as `hh:mm:ss` or `mm:ss.mmm`. */
export function formatDuration(seconds: number, style: TimeFormat = "hh:mm:ss"): string {
  if (!Number.isFinite(seconds)) return "—";
  const sign = seconds < 0 ? "-" : "";
  const t = Math.abs(seconds);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  if (style === "mm:ss.mmm") {
    // Round to whole milliseconds first, so 59.9999 carries into 01:00.000
    // instead of printing a fourth digit.
    const ms = Math.round(t * 1000);
    return `${sign}${p2(Math.floor(ms / 60_000))}:${p2(Math.floor((ms % 60_000) / 1000))}.${String(ms % 1000).padStart(3, "0")}`;
  }
  const v = Math.round(t);
  return `${sign}${p2(Math.floor(v / 3600))}:${p2(Math.floor((v % 3600) / 60))}:${p2(v % 60)}`;
}

// Steps a clock reads naturally — milliseconds up through quarter hours.
const TIME_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5,
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/** The nicest clock step that puts about `count` ticks across `span` seconds. */
export function niceTimeStep(span: number, count = 8): number {
  const target = Math.abs(span) / Math.max(1, count);
  for (const s of TIME_STEPS) if (s >= target) return s;
  return Math.ceil(target / 3600) * 3600;
}

export interface WaterfallTickOptions {
  /** Roughly how many ticks to place. Default 8. */
  count?: number;
  /** A preset, or your own formatter over seconds. Default `"hh:mm:ss"`. */
  format?: TimeFormat | ((seconds: number) => string);
  /** Clock of the first row ever pushed; earlier rows carry no time. Default 0. */
  startTime?: number;
}

/**
 * Ticks for a waterfall's time axis: whole clock steps between `now - span` and
 * `now`, positioned on the age axis so `now` sits at the top (`span`) and each
 * label slides down as its row ages.
 */
export function waterfallTimeTicks(now: number, span: number, opts: WaterfallTickOptions = {}): Tick[] {
  if (!(span > 0) || !Number.isFinite(now)) return [];
  const fmt = opts.format ?? "hh:mm:ss";
  const label = typeof fmt === "function" ? fmt : (s: number): string => formatDuration(s, fmt);
  const start = opts.startTime ?? 0;
  const step = niceTimeStep(span, opts.count);
  const out: Tick[] = [];
  // Stepping by index rather than accumulating keeps a 1ms step from drifting.
  const k0 = Math.ceil(Math.max(start, now - span) / step);
  for (let k = k0; k * step <= now + 1e-9 && out.length < 512; k++) {
    const s = k * step;
    out.push({ value: span - (now - s), label: label(s) });
  }
  return out;
}

/**
 * Reduce a column to `cols` cells by taking each block's maximum — the right
 * reduction for a waterfall, where a peak two bins wide must survive fitting a
 * 200k-bin spectrum into a few hundred cells. Shorter columns are stretched by
 * nearest sample.
 */
export function blockMax(values: ArrayLike<number>, cols: number): Float64Array {
  const out = new Float64Array(cols);
  reduceInto(values, out, 0, cols);
  return out;
}

/** `blockMax` straight into an existing row, so streaming allocates nothing. */
function reduceInto(src: ArrayLike<number>, dst: Float64Array, at: number, cols: number): void {
  const n = src.length;
  if (n === cols) {
    for (let c = 0; c < cols; c++) dst[at + c] = src[c]!;
    return;
  }
  if (n < cols) {
    for (let c = 0; c < cols; c++) dst[at + c] = src[Math.min(n - 1, Math.floor((c * n) / cols))] ?? 0;
    return;
  }
  for (let c = 0; c < cols; c++) {
    const i0 = Math.floor((c * n) / cols);
    const i1 = Math.max(i0 + 1, Math.floor(((c + 1) * n) / cols));
    let m = -Infinity;
    for (let i = i0; i < i1; i++) if (src[i]! > m) m = src[i]!;
    dst[at + c] = m;
  }
}

export interface WaterfallOptions {
  /** Data-space extent one row spans — the frequency band, for a spectrogram. */
  extent: Range;
  /** Cells across a row. A longer pushed column is block-maxed down to this. */
  cols: number;
  /** Rows of history kept on screen. */
  rows: number;
  /** Seconds of signal one row covers; with `rows` this sets the time span. */
  rowSeconds: number;
  /**
   * Value range mapped to the colormap. Strongly recommended: without it the
   * heatmap re-reads its own min/max on every push and the colours breathe.
   */
  domain?: Range;
  colormap?: ColormapSpec;
  /** Value filling rows that have not streamed in yet. Default `domain[0]`, else 0. */
  fill?: number;
  /**
   * A history to open with, `cols * rows` row-major with row 0 at the bottom (the
   * oldest). The clock then reads the top row as the newest, so a pre-computed
   * spectrogram gets the same time axis a streaming one does.
   */
  history?: ArrayLike<number>;
  /** Bilinear filtering (default true) vs. hard cells. */
  smooth?: boolean;
  /** Series name — used as the colorbar caption. */
  name?: string;
  /** Clock of the first pushed row, in seconds. Default 0. */
  startTime?: number;
  /** Time tick labels: a preset or your own formatter. Default `"hh:mm:ss"`. */
  timeFormat?: TimeFormat | ((seconds: number) => string);
  /** Roughly how many time ticks to place. Default 8. */
  timeTicks?: number;
  /** Axis title for the time axis. Left alone when omitted. */
  timeTitle?: string;
  /** Pin the view to the image (default true) — autoscale would pad around it. */
  fitView?: boolean;
  yAxis?: string;
  /** Buffer-usage hint. Default `"dynamic"`: a waterfall exists to stream. */
  renderType?: RenderType;
}

export interface WaterfallHandle {
  heatmap: HeatmapLayer;
  /** The history grid, `cols * rows`, row 0 at the bottom (the oldest row). */
  values: Float64Array;
  /** Seconds one row covers. */
  rowSeconds: number;
  /** Seconds of history the axis spans. */
  span: number;
  /** Clock of the newest row — the top of the time axis. */
  now(): number;
  /** Newest column in: the history ages one row down and the clock advances one. */
  push(column: ArrayLike<number>): void;
  /** Re-label the time axis — swap the format, the tick count or the title. */
  setTimeAxis(opts: { format?: TimeFormat | ((seconds: number) => string); count?: number; title?: string }): void;
  /** Wipe the history back to `fill` and restart the clock at `startTime`. */
  reset(): void;
}

/**
 * Add a scrolling waterfall: frequency (or any x) across, time down, newest row
 * on top. Feed it one column per step with {@link WaterfallHandle.push}; the
 * time ticks follow on their own.
 *
 * Clock labels are wider than plain numbers and the plot's left margin is not
 * measured from them, so give it room — `margin: { left: 72 }` fits `mm:ss.mmm`.
 */
export function addWaterfall(plot: Plot, opts: WaterfallOptions): WaterfallHandle {
  const cols = Math.floor(opts.cols);
  const rows = Math.floor(opts.rows);
  if (!(cols >= 2) || !(rows >= 2)) {
    throw new Error(`addWaterfall: cols and rows must be >= 2 (got ${opts.cols} x ${opts.rows})`);
  }
  if (!(opts.rowSeconds > 0)) {
    throw new Error(`addWaterfall: rowSeconds must be > 0 (got ${opts.rowSeconds})`);
  }
  const [x0, x1] = opts.extent;
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) {
    throw new Error(`addWaterfall: extent must be a finite non-empty range (got [${x0}, ${x1}])`);
  }

  const rowSeconds = opts.rowSeconds;
  const span = rows * rowSeconds;
  const start = opts.startTime ?? 0;
  const fill = opts.fill ?? opts.domain?.[0] ?? 0;
  const yAxis = opts.yAxis ?? "y";
  const tickOpts: WaterfallTickOptions = {
    count: opts.timeTicks,
    ...(opts.timeFormat ? { format: opts.timeFormat } : {}),
    startTime: start,
  };

  const values = new Float64Array(cols * rows).fill(fill);
  if (opts.history) {
    const n = Math.min(values.length, opts.history.length);
    for (let i = 0; i < n; i++) values[i] = opts.history[i]!;
  }
  const heatmap = plot.addHeatmap({
    values,
    cols,
    rows,
    extent: { x: [x0, x1], y: [0, span] },
    ...(opts.domain ? { domain: opts.domain } : {}),
    ...(opts.colormap ? { colormap: opts.colormap } : {}),
    ...(opts.smooth === undefined ? {} : { smooth: opts.smooth }),
    ...(opts.name ? { name: opts.name } : {}),
    yAxis,
    renderType: opts.renderType ?? "dynamic",
  });
  if (opts.fitView !== false) {
    plot.setView(yAxis === "y"
      ? { x: [x0, x1], y: [0, span] }
      : { x: [x0, x1], yAxes: { [yAxis]: [0, span] } });
  }

  // One row before the first push, so that push lands it on `startTime` exactly —
  // otherwise the top edge of the not-yet-streamed history sits a row off its tick.
  // A supplied history is already on screen, so its top row is the newest one.
  let clock = opts.history ? start + (rows - 1) * rowSeconds : start - rowSeconds;
  let title = opts.timeTitle;
  const setTicks = (): void => {
    plot.setAxis(yAxis, {
      ...(title === undefined ? {} : { title }),
      ticks: waterfallTimeTicks(clock, span, tickOpts),
    });
  };
  setTicks();

  return {
    heatmap,
    values,
    rowSeconds,
    span,
    now: () => clock,
    push(column) {
      // Row 0 is the bottom of the image, so ageing the whole history by one row
      // is a single memmove; the fresh column lands on top.
      values.copyWithin(0, cols);
      reduceInto(column, values, (rows - 1) * cols, cols);
      clock += rowSeconds;
      heatmap.setData(values, cols, rows);
      setTicks();
    },
    setTimeAxis(next) {
      if (next.format !== undefined) tickOpts.format = next.format;
      if (next.count !== undefined) tickOpts.count = next.count;
      if (next.title !== undefined) title = next.title;
      setTicks();
    },
    reset() {
      values.fill(fill);
      clock = start - rowSeconds;
      heatmap.setData(values, cols, rows);
      setTicks();
    },
  };
}
