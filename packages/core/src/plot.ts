import { Axis } from "./axes/axis.js";
import { defaultFormat } from "./axes/ticks.js";
import { begin2D, getSharedGL, sizeShared } from "./gl/shared.js";
import type { AxisFrame } from "./gl/transform.js";
import { AreaLayer, type AreaOptions } from "./layers/area.js";
import { BarLayer, type BarOptions } from "./layers/bar.js";
import { BoxLayer, type BoxOptions } from "./layers/box.js";
import { CandlestickLayer, type CandlestickOptions } from "./layers/candlestick.js";
import { OhlcLayer, type OhlcOptions } from "./layers/ohlc.js";
import { ContourLayer, type ContourOptions } from "./layers/contour.js";
import { ErrorBarLayer, type ErrorBarOptions } from "./layers/errorbar.js";
import { GraphLayer, type GraphOptions } from "./layers/graph.js";
import { HeatmapLayer, type HeatmapOptions } from "./layers/heatmap.js";
import { HexbinLayer, type HexbinOptions } from "./layers/hexbin.js";
import { ImageLayer, type ImageOptions } from "./layers/image.js";
import type { Layer } from "./layers/layer.js";
import { LineLayer, type LineOptions } from "./layers/line.js";
import { forceLayout } from "./graph/force.js";
import { PatchesLayer, type PatchesOptions } from "./layers/patches.js";
import { PieLayer, type PieOptions } from "./layers/pie.js";
import { QuiverLayer, type QuiverOptions } from "./layers/quiver.js";
import { ScatterLayer, type ScatterOptions } from "./layers/scatter.js";
import { StemLayer, type StemOptions } from "./layers/stem.js";
import { histogram, spectrogram } from "./stats/index.js";
import {
  darkTheme,
  drawCrosshair,
  drawCrosshairXY,
  drawGrid,
  drawMarker,
  drawTitle,
  drawXAxis,
  drawYAxis,
  lightTheme,
  plotRegion,
  pxX,
  pxY,
  resolveAxisStyle,
  type Layout,
  type PlotTitleOptions,
  type Theme,
} from "./render/overlay.js";
import { canvasToBlob, copyCanvasToClipboard, downloadCanvas, type ExportOptions } from "./render/export.js";
import type { PickMode } from "./layers/pick.js";
import { LinearScale, makeScale, type Scale, type ScaleType } from "./scales/scale.js";
import { createToolbar } from "./ui/toolbar.js";
import type { AxisConfig, Dim, InteractionMode, Range } from "./types.js";

export interface AxisScaleOptions {
  type?: ScaleType;
  /** Fixed domain. If omitted, the axis autoscales to the data. */
  domain?: Range;
  /** Factor labels for a `"categorical"` axis (fixes the domain to the bands). */
  factors?: string[];
  /**
   * Per-index epoch-ms timestamps for an `"ordinal-time"` axis (finance/session
   * axis). Plot bars at integer indices `0..times.length-1`; gaps collapse and
   * ticks show calendar dates.
   */
  times?: ArrayLike<number>;
}

/** Legend placement + styling. `legend: true` uses all defaults. */
export interface LegendOptions {
  /** Corner within the plot region. Default `"top-right"`. */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Stack entries vertically (default) or in a row. */
  orientation?: "vertical" | "horizontal";
  background?: string;
  border?: string;
  textColor?: string;
  font?: string;
}

export interface YAxisOptions extends AxisConfig {
  type?: ScaleType;
  domain?: Range;
  /** Factor labels for a `"categorical"` axis. */
  factors?: string[];
  /** Per-index epoch-ms timestamps for an `"ordinal-time"` axis. */
  times?: ArrayLike<number>;
  /** Which side to draw the axis on. Default `"right"` for secondary axes. */
  side?: "left" | "right";
  /** Axis + label color (secondary axes often match their series). */
  color?: string;
}

/** One series in a grouped/stacked bar chart. */
export interface BarSeries {
  /** Value per category (parallel to the shared `x` positions). */
  y: ArrayLike<number>;
  color?: string;
  name?: string;
}

/** Options for {@link Plot.addGroupedBars} — one cluster of bars per category. */
export interface GroupedBarOptions {
  /** Category positions (e.g. `0..n-1` for a categorical axis). */
  x: ArrayLike<number>;
  series: BarSeries[];
  /** Total width of one group (all its bars) in data units. Default 0.8. */
  groupWidth?: number;
  /** Fractional gap between bars within a group, 0..1. Default 0.1. */
  gap?: number;
  /** `"v"` vertical (default) or `"h"` horizontal bars. */
  orientation?: "v" | "h";
  yAxis?: string;
}

/** Options for {@link Plot.addStackedBars} — series stacked on top of each other. */
export interface StackedBarOptions {
  /** Category positions (e.g. `0..n-1` for a categorical axis). */
  x: ArrayLike<number>;
  series: BarSeries[];
  /** Bar width in data units. Defaults to 80% of the median spacing. */
  width?: number;
  /** `"v"` vertical (default) or `"h"` horizontal bars. */
  orientation?: "v" | "h";
  yAxis?: string;
}

/** One series in a stacked area chart. */
export interface AreaSeries {
  y: ArrayLike<number>;
  color?: string;
  name?: string;
}

/** Options for {@link Plot.addStackedArea}. */
export interface StackedAreaOptions {
  x: ArrayLike<number>;
  series: AreaSeries[];
  yAxis?: string;
}

/** Options for {@link Plot.addGraph}. Positions are optional — omit them (give `nodes`) to auto-lay-out. */
export interface GraphInput extends Omit<GraphOptions, "x" | "y"> {
  x?: ArrayLike<number>;
  y?: ArrayLike<number>;
  /** Node count when `x`/`y` are omitted (else inferred from the max edge index). */
  nodes?: number;
}

/**
 * A Canvas2D overlay marker drawn above the data, projected through the scales:
 * a full-width/height guide line (`span`), a shaded range (`band`), a rectangle
 * (`box`), text (`label`), an arbitrary segment (`line` — trendlines), a segment
 * extended past its end (`ray`), or Fibonacci retracement levels (`fib`). `yAxis`
 * targets a secondary axis where relevant. All coordinates are in data space, so
 * annotations pan and zoom with the chart.
 */
export type Annotation =
  | { type: "span"; dim: Dim; value: number; color?: string; width?: number; dash?: number[]; yAxis?: string }
  | { type: "band"; dim: Dim; from: number; to: number; color?: string; yAxis?: string }
  | { type: "box"; x: Range; y: Range; color?: string; border?: string; label?: string; yAxis?: string }
  | { type: "label"; x: number; y: number; text: string; color?: string; font?: string; align?: "left" | "center" | "right"; yAxis?: string }
  | { type: "line"; x0: number; y0: number; x1: number; y1: number; color?: string; width?: number; dash?: number[]; label?: string; yAxis?: string }
  | { type: "ray"; x0: number; y0: number; x1: number; y1: number; color?: string; width?: number; dash?: number[]; label?: string; yAxis?: string }
  | { type: "fib"; x0: number; x1: number; high: number; low: number; ratios?: number[]; color?: string; fill?: boolean; label?: string; yAxis?: string };

/** An interactive drawing tool: click-drag on the plot to place the shape. */
export type DrawTool = "trendline" | "hline" | "ray" | "fib" | "rect";

/** One line of the hover tooltip header, produced by {@link PlotOptions.hoverReadout}. */
export interface HoverReadoutRow {
  label: string;
  value: string;
}

export interface PlotOptions {
  scales?: { x?: AxisScaleOptions; y?: AxisScaleOptions };
  axes?: { x?: AxisConfig; y?: AxisConfig };
  theme?: "light" | "dark" | Theme;
  /** Fill color for the plot region (inside the margins). Default transparent. */
  background?: string;
  /** Fill color for the whole canvas incl. margins. Default transparent. */
  border?: string;
  /** Plot title, drawn in a reserved strip above the plot. */
  title?: string | PlotTitleOptions;
  /** Show a legend of named series. `true` uses defaults; pass an object to place/style it. */
  legend?: boolean | LegendOptions;
  margin?: Partial<Layout["margin"]>;
  /** Enable wheel-zoom and drag interaction. Default true. */
  interactive?: boolean;
  /** Show the built-in toolbar (home + pan/box/X/Y zoom modes). Default true. */
  showToolbar?: boolean;
  /** Add drawing tools (trendline / horizontal / ray / Fibonacci / rectangle) to the toolbar. Default false. */
  drawingTools?: boolean;
  /** Initial interaction mode. Default `"pan"`. */
  mode?: InteractionMode;
  /** Enable hover crosshair + tooltip. Default true. */
  hover?: boolean;
  /**
   * How hover selects the highlighted point: `"x"` nearest by x (classic),
   * `"y"` nearest by y, or `"xy"` nearest by 2D distance — the last checks both
   * axes, which is what a scatter/map needs. Default `"x"`.
   */
  pick?: PickMode;
  /**
   * When a point's pinned detail box appears: `"click"` pins it on click (until
   * you click empty space), `"hover"` shows it while the cursor is over a point.
   * Default `"click"`.
   */
  pointInfo?: "hover" | "click";
  /**
   * Show dashed guide lines on *both* the X and Y axes at the cursor — on hover
   * and while the pointer is pressed. When false, hover shows only the vertical
   * (X) line and there are no press guides. Default true.
   */
  crosshair?: boolean;
  /**
   * Keep data-units-per-pixel equal on both axes so nothing is distorted (the
   * looser axis is expanded to match). Essential for maps. Default false.
   */
  equalAspect?: boolean;
  /**
   * Constrain panning/zooming so the view can't move outside the data bounds
   * (the union of all layers' extents). Zoom still works; the view is just
   * kept inside the limits. Default false (a map turns it on).
   */
  boundedPan?: boolean;
  /**
   * Customize the tooltip header shown on hover. Given the cursor's data-space
   * X and Y (primary y axis), return the lines to display above the series
   * rows — e.g. a map converts world coords to `lon`/`lat`. When omitted, the
   * header is the default single `x = …` line. Default undefined.
   */
  hoverReadout?: (dataX: number, dataY: number) => HoverReadoutRow[];
}

interface YAxisState {
  id: string;
  scale: Scale;
  axis: Axis;
  side: "left" | "right";
  auto: boolean;
  initial: Range | null;
  color?: string;
}

const DEFAULT_MARGIN = { top: 16, right: 16, bottom: 40, left: 56 };
const Y_AXIS_GAP = 52;
/** Extra top margin reserved for the plot title when one is set. */
const TITLE_RESERVE = 28;

/** Layers that can report a nearest point participate in hover/tooltip. */
interface Pickable {
  readonly name: string;
  readonly colorCss: string;
  readonly yAxis: string;
  pick(
    mode: PickMode,
    cursorPx: number,
    cursorPy: number,
    project: (x: number, y: number) => [number, number],
  ): { x: number; y: number; index: number } | null;
  /** Optional user-supplied detail lines for a point index (click info). */
  infoAt?(index: number): string[] | null;
}
/** Distance from point (px,py) to the segment (ax,ay)-(bx,by), in pixels. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isPickable(layer: Layer): layer is Layer & Pickable {
  return typeof (layer as Partial<Pickable>).pick === "function";
}

/** Pad a data range for autoscaling — linearly, or multiplicatively for log axes. */
function padDomain(min: number, max: number, log: boolean, frac: number): Range {
  if (log) {
    // Keep bounds strictly positive and pad by a factor in log space.
    const lo = min > 0 ? min : max > 0 ? max / 1000 : 1e-9;
    const hi = max > lo ? max : lo * 10;
    const f = Math.pow(hi / lo, frac);
    return [lo / f, hi * f];
  }
  const pad = (max - min) * frac || 1;
  return [min - pad, max + pad];
}

/**
 * Translate `[lo,hi]` so it sits within data bounds `[dlo,dhi]` **without
 * changing its span** (so zoom level / aspect are preserved). When the view is
 * wider than the data, the data band is kept fully inside the view instead.
 */
function clampAxis(domain: Range, bounds: Range): Range {
  const [lo, hi] = domain;
  const span = hi - lo;
  const [dlo, dhi] = bounds;
  if (span >= dhi - dlo) {
    const loMin = dhi - span;
    const clampedLo = Math.min(Math.max(lo, loMin), dlo);
    return [clampedLo, clampedLo + span];
  }
  let clampedLo = Math.max(lo, dlo);
  if (clampedLo + span > dhi) clampedLo = dhi - span;
  return [clampedLo, clampedLo + span];
}

/**
 * The imperative core plot. Owns a stack of three canvases (grid / WebGL data /
 * axis overlay), a shared x scale, and one-or-more named y axes.
 */
export class Plot {
  private container: HTMLElement;
  private gridCanvas: HTMLCanvasElement;
  private dataCanvas: HTMLCanvasElement;
  private axisCanvas: HTMLCanvasElement;
  private gridCtx: CanvasRenderingContext2D;
  private dataCtx: CanvasRenderingContext2D;
  private axisCtx: CanvasRenderingContext2D;
  private gl: WebGL2RenderingContext;
  /** Shared offscreen WebGL canvas we render into, then blit onto `dataCanvas`. */
  private sharedCanvas: HTMLCanvasElement;

  private scaleX: Scale;
  private axisX: Axis;
  private autoX: boolean;
  private initialX: Range | null;

  /** Named y axes, insertion-ordered. `"y"` is always the primary. */
  private yAxes = new Map<string, YAxisState>();

  private layers: Layer[] = [];
  private theme: Theme;
  private isDark: boolean;
  private baseMargin: Layout["margin"];
  private dpr = 1;
  private resizeObserver: ResizeObserver;
  private frameRequested = false;

  private mode: InteractionMode;
  private selectionDiv: HTMLDivElement;
  private modeChangeCbs: Array<(mode: InteractionMode) => void> = [];
  private toolbarHandle: { destroy: () => void } | null = null;

  private hoverEnabled: boolean;
  private hoverPx: { x: number; y: number } | null = null;
  private pickMode: PickMode;
  private pointInfo: "hover" | "click";
  private crosshair: boolean;
  private equalAspect: boolean;
  private boundedPan: boolean;
  private hoverReadout?: (dataX: number, dataY: number) => HoverReadoutRow[];
  /** Cursor position while the pointer is pressed, when `crosshair`. */
  private pressPx: { x: number; y: number } | null = null;
  // Linked-pane plumbing (see linkX). View/cursor changes are emitted from render().
  private viewListeners: Array<(x: Range) => void> = [];
  private cursorListeners: Array<(dataX: number | null) => void> = [];
  private lastEmittedX: Range | null = null;
  private lastEmittedCursor: number | null = NaN as unknown as null;
  private linkedCursorX: number | null = null;
  // Interactive drawing tools (see setDrawTool / drawingTools option).
  private drawTool: DrawTool | null = null;
  private drawings: Annotation[] = [];
  private pendingDrawing: Annotation | null = null;
  private drawToolCbs: Array<(t: DrawTool | null) => void> = [];
  // Selection / editing of existing drawings.
  private hoverDrawing = -1;
  private selectedDrawing = -1;
  private drawMenu: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement;
  /** A point clicked to pin its details, until another click clears it. */
  private selected: { layer: Pickable; x: number; y: number; index: number } | null = null;
  private infoBox: HTMLDivElement;

  private annotations: Annotation[] = [];
  private bgFill?: string;
  private borderFill?: string;
  private title: PlotTitleOptions | null;
  private legend: LegendOptions | null;
  private legendDiv: HTMLDivElement;

  constructor(container: HTMLElement, options: PlotOptions = {}) {
    this.container = container;
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    this.gridCanvas = this.makeCanvas(0);
    this.dataCanvas = this.makeCanvas(1);
    this.axisCanvas = this.makeCanvas(2);

    this.gridCtx = this.gridCanvas.getContext("2d")!;
    this.dataCtx = this.dataCanvas.getContext("2d")!;
    this.axisCtx = this.axisCanvas.getContext("2d")!;
    const s = getSharedGL();
    this.gl = s.gl;
    this.sharedCanvas = s.canvas;

    const sx = options.scales?.x ?? {};
    const sy = options.scales?.y ?? {};
    // A "band" axis (categorical factors or ordinal-time indices) is fixed to its
    // band domain: never autoscale, and `home()` restores that band domain.
    const xBand = sx.type === "categorical" || sx.type === "ordinal-time";
    this.scaleX = makeScale(sx.type ?? "linear", sx.domain ?? [0, 1], sx.factors, sx.times);
    this.autoX = !xBand && sx.domain == null;
    this.initialX = xBand ? this.scaleX.domain : (sx.domain ?? null);
    this.axisX = new Axis(options.axes?.x);

    // Primary y axis.
    const yBand = sy.type === "categorical" || sy.type === "ordinal-time";
    const yScale = makeScale(sy.type ?? "linear", sy.domain ?? [0, 1], sy.factors, sy.times);
    this.yAxes.set("y", {
      id: "y",
      scale: yScale,
      axis: new Axis(options.axes?.y),
      side: "left",
      auto: !yBand && sy.domain == null,
      initial: yBand ? yScale.domain : (sy.domain ?? null),
    });

    this.isDark = options.theme === "dark";
    this.theme =
      options.theme === "dark"
        ? darkTheme
        : options.theme === "light" || options.theme == null
          ? lightTheme
          : options.theme;
    this.baseMargin = { ...DEFAULT_MARGIN, ...options.margin };
    this.bgFill = options.background;
    this.borderFill = options.border;
    this.title =
      typeof options.title === "string" ? { text: options.title } : (options.title ?? null);
    this.legend = options.legend === true ? {} : (options.legend || null);
    this.mode = options.mode ?? "pan";
    this.hoverEnabled = options.hover !== false;
    this.pickMode = options.pick ?? "x";
    this.pointInfo = options.pointInfo ?? "click";
    this.crosshair = options.crosshair ?? true;
    this.equalAspect = options.equalAspect ?? false;
    this.boundedPan = options.boundedPan ?? false;
    this.hoverReadout = options.hoverReadout;

    // Selection rectangle overlay for box zoom.
    this.selectionDiv = document.createElement("div");
    Object.assign(this.selectionDiv.style, {
      position: "absolute",
      display: "none",
      zIndex: "2",
      pointerEvents: "none",
      background: "rgba(59,130,246,0.15)",
      border: "1px solid rgba(59,130,246,0.9)",
      borderRadius: "1px",
    } as CSSStyleDeclaration);
    container.appendChild(this.selectionDiv);

    // Tooltip.
    this.tooltip = document.createElement("div");
    Object.assign(this.tooltip.style, {
      position: "absolute",
      display: "none",
      zIndex: "4",
      pointerEvents: "none",
      padding: "6px 8px",
      borderRadius: "6px",
      font: "12px system-ui, -apple-system, sans-serif",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
      background: this.isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.96)",
      color: this.isDark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${this.isDark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.25)"}`,
      boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
    } as CSSStyleDeclaration);
    container.appendChild(this.tooltip);

    // Pinned info box for a clicked point (persists until the next click).
    this.infoBox = document.createElement("div");
    Object.assign(this.infoBox.style, {
      position: "absolute",
      display: "none",
      zIndex: "6",
      pointerEvents: "none",
      padding: "6px 8px",
      borderRadius: "6px",
      font: "12px system-ui, -apple-system, sans-serif",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
      background: this.isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.98)",
      color: this.isDark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${this.isDark ? "rgba(148,163,184,0.4)" : "rgba(100,116,139,0.4)"}`,
      boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    } as CSSStyleDeclaration);
    container.appendChild(this.infoBox);

    // Legend (a DOM overlay like the tooltip; positioned inside the plot region).
    this.legendDiv = document.createElement("div");
    Object.assign(this.legendDiv.style, {
      position: "absolute",
      display: "none",
      zIndex: "5",
      pointerEvents: "none",
      padding: "6px 8px",
      borderRadius: "6px",
      font: "12px system-ui, -apple-system, sans-serif",
      lineHeight: "1.5",
      background: this.isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)",
      color: this.isDark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${this.isDark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.2)"}`,
    } as CSSStyleDeclaration);
    container.appendChild(this.legendDiv);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    if (options.interactive !== false) this.attachInteraction();
    if (options.showToolbar !== false) {
      this.toolbarHandle = createToolbar(
        container,
        {
          setMode: (m) => this.setMode(m),
          getMode: () => this.mode,
          home: () => this.home(),
          onModeChange: (cb) => this.modeChangeCbs.push(cb),
          download: () => void this.downloadImage(),
          drawTools: options.drawingTools
            ? {
                set: (t) => this.setDrawTool(t as DrawTool | null),
                get: () => this.drawTool,
                clear: () => this.clearDrawings(),
                onChange: (cb) => this.onDrawToolChange((t) => cb(t)),
              }
            : undefined,
        },
        this.isDark,
      );
    }
    this.updateCursor();
  }

  private makeCanvas(z: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    Object.assign(c.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: String(z),
    } as CSSStyleDeclaration);
    if (z < 2) c.style.pointerEvents = "none";
    this.container.appendChild(c);
    return c;
  }

  /** Margins grow to make room for extra y axes on each side. */
  private computeMargin(): Layout["margin"] {
    let leftCount = 0;
    let rightCount = 0;
    for (const ya of this.yAxes.values()) {
      if (ya.side === "left") leftCount++;
      else rightCount++;
    }
    return {
      top: this.baseMargin.top + (this.title ? TITLE_RESERVE : 0),
      bottom: this.baseMargin.bottom,
      left: this.baseMargin.left + Math.max(0, leftCount - 1) * Y_AXIS_GAP,
      right: this.baseMargin.right + rightCount * Y_AXIS_GAP,
    };
  }

  private layout(): Layout {
    return {
      cssWidth: this.container.clientWidth,
      cssHeight: this.container.clientHeight,
      margin: this.computeMargin(),
    };
  }

  /** Pixel x-position (and title x) for each y axis, by draw order per side. */
  private yAxisPositions(): Map<string, { x: number; titleX: number }> {
    const region = plotRegion(this.layout());
    const out = new Map<string, { x: number; titleX: number }>();
    let li = 0;
    let ri = 0;
    for (const ya of this.yAxes.values()) {
      if (ya.side === "left") {
        const x = region.left - li * Y_AXIS_GAP;
        out.set(ya.id, { x, titleX: x - 42 });
        li++;
      } else {
        const x = region.left + region.width + ri * Y_AXIS_GAP;
        out.set(ya.id, { x, titleX: x + 42 });
        ri++;
      }
    }
    return out;
  }

  // ---- Public API -----------------------------------------------------------

  private register<T extends Layer>(layer: T): T {
    if (!this.yAxes.has(layer.yAxis)) {
      throw new Error(`Unknown y axis "${layer.yAxis}". Call addYAxis() first.`);
    }
    this.layers.push(layer);
    this.autoscale();
    this.requestRender();
    return layer;
  }

  /**
   * Register a layer built outside core (e.g. `@photonviz/map`). Use with
   * {@link context} to construct the layer against this plot's WebGL2 context.
   */
  add<T extends Layer>(layer: T): T {
    return this.register(layer);
  }

  /** The shared WebGL2 context, for constructing custom layers. */
  get context(): WebGL2RenderingContext {
    return this.gl;
  }

  /**
   * Convert a client (screen) coordinate to data space — the shared x and the
   * primary y. Returns null if the point is outside the plot region. Useful for
   * custom hit-testing (e.g. map feature picking on click).
   */
  dataAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.axisCanvas.getBoundingClientRect();
    const region = plotRegion(this.layout());
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (
      px < region.left || px > region.left + region.width ||
      py < region.top || py > region.top + region.height
    ) {
      return null;
    }
    const nx = (px - region.left) / region.width;
    const ny = 1 - (py - region.top) / region.height;
    return { x: this.scaleX.invert(nx), y: this.primaryY().scale.invert(ny) };
  }

  addLine(opts: LineOptions): LineLayer {
    return this.register(new LineLayer(this.gl, opts));
  }

  addScatter(opts: ScatterOptions): ScatterLayer {
    return this.register(new ScatterLayer(this.gl, opts));
  }

  addBar(opts: BarOptions): BarLayer {
    return this.register(new BarLayer(this.gl, opts));
  }

  /**
   * Grouped (clustered) bars: one {@link BarLayer} per series, each shifted within
   * its category group so the bars sit side by side. Returns the layers in order.
   */
  addGroupedBars(opts: GroupedBarOptions): BarLayer[] {
    const m = opts.series.length;
    if (m === 0) return [];
    const groupWidth = opts.groupWidth ?? 0.8;
    const slot = groupWidth / m;
    const barWidth = slot * (1 - (opts.gap ?? 0.1));
    const layers: BarLayer[] = [];
    for (let s = 0; s < m; s++) {
      const ser = opts.series[s]!;
      // Center the cluster on each category: offsets are symmetric about 0.
      const off = (s - (m - 1) / 2) * slot;
      layers.push(
        new BarLayer(this.gl, {
          x: opts.x,
          y: ser.y,
          width: barWidth,
          offset: off,
          color: ser.color,
          name: ser.name,
          orientation: opts.orientation,
          yAxis: opts.yAxis,
        }),
      );
    }
    for (const l of layers) this.register(l);
    return layers;
  }

  /**
   * Stacked bars: each series is drawn from the running cumulative total of the
   * ones before it, so they stack. Returns the layers bottom-to-top.
   */
  addStackedBars(opts: StackedBarOptions): BarLayer[] {
    const n = opts.x.length;
    const cum = new Float64Array(n); // running baseline per category
    const layers: BarLayer[] = [];
    for (const ser of opts.series) {
      const base = Float64Array.from(cum);
      const top = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        top[i] = cum[i]! + (ser.y[i] ?? 0);
        cum[i] = top[i]!;
      }
      layers.push(
        new BarLayer(this.gl, {
          x: opts.x,
          y: top,
          base,
          width: opts.width,
          color: ser.color,
          name: ser.name,
          orientation: opts.orientation,
          yAxis: opts.yAxis,
        }),
      );
    }
    for (const l of layers) this.register(l);
    return layers;
  }

  addArea(opts: AreaOptions): AreaLayer {
    return this.register(new AreaLayer(this.gl, opts));
  }

  addHeatmap(opts: HeatmapOptions): HeatmapLayer {
    return this.register(new HeatmapLayer(this.gl, opts));
  }

  addBox(opts: BoxOptions): BoxLayer {
    return this.register(new BoxLayer(this.gl, opts));
  }

  addHexbin(opts: HexbinOptions): HexbinLayer {
    return this.register(new HexbinLayer(this.gl, opts));
  }

  addContour(opts: ContourOptions): ContourLayer {
    return this.register(new ContourLayer(this.gl, opts));
  }

  addErrorBar(opts: ErrorBarOptions): ErrorBarLayer {
    return this.register(new ErrorBarLayer(this.gl, opts));
  }

  addStem(opts: StemOptions): StemLayer {
    return this.register(new StemLayer(this.gl, opts));
  }

  addQuiver(opts: QuiverOptions): QuiverLayer {
    return this.register(new QuiverLayer(this.gl, opts));
  }

  addCandlestick(opts: CandlestickOptions): CandlestickLayer {
    return this.register(new CandlestickLayer(this.gl, opts));
  }

  /** An OHLC bar chart (low→high line with open/close ticks). Streams like candlesticks. */
  addOhlc(opts: OhlcOptions): OhlcLayer {
    return this.register(new OhlcLayer(this.gl, opts));
  }

  /** Filled polygons (choropleth-capable). Rings are triangulated with earcut. */
  addPatches(opts: PatchesOptions): PatchesLayer {
    return this.register(new PatchesLayer(this.gl, opts));
  }

  /** A pie / donut chart. Set `equalAspect: true` on the plot so it stays circular. */
  addPie(opts: PieOptions): PieLayer {
    return this.register(new PieLayer(this.gl, opts));
  }

  /** An RGBA image / URL drawn over a data-space extent. URLs redraw on load. */
  addImage(opts: ImageOptions): ImageLayer {
    return this.register(
      new ImageLayer(this.gl, {
        ...opts,
        onLoad: () => {
          this.requestRender();
          opts.onLoad?.();
        },
      }),
    );
  }

  /**
   * A node-link graph. Provide node `x`/`y`, or omit them (with `nodes`, or let the
   * count be inferred from the edges) to auto-place with a force-directed layout.
   */
  addGraph(opts: GraphInput): GraphLayer {
    let { x, y } = opts;
    if (!x || !y) {
      const n = opts.nodes ?? opts.edges.reduce((m, [a, b]) => Math.max(m, a, b), -1) + 1;
      const layout = forceLayout(n, opts.edges);
      x = layout.x;
      y = layout.y;
    }
    return this.register(new GraphLayer(this.gl, { ...opts, x, y }));
  }

  /**
   * Stacked area: each series is filled from the running cumulative total of the
   * ones before it. Returns the layers bottom-to-top.
   */
  addStackedArea(opts: StackedAreaOptions): AreaLayer[] {
    const n = opts.x.length;
    const cum = new Float64Array(n);
    const layers: AreaLayer[] = [];
    for (const ser of opts.series) {
      const base = Float64Array.from(cum);
      const top = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        top[i] = cum[i]! + (ser.y[i] ?? 0);
        cum[i] = top[i]!;
      }
      layers.push(
        new AreaLayer(this.gl, { x: opts.x, y: top, base, color: ser.color, name: ser.name, yAxis: opts.yAxis }),
      );
    }
    for (const l of layers) this.register(l);
    return layers;
  }

  /**
   * Add a Canvas2D annotation (span / band / box / label) drawn above the data.
   * Returns a disposer that removes just this annotation.
   */
  addAnnotation(a: Annotation): () => void {
    this.annotations.push(a);
    this.requestRender();
    return () => {
      const i = this.annotations.indexOf(a);
      if (i >= 0) {
        this.annotations.splice(i, 1);
        this.requestRender();
      }
    };
  }

  /** Remove all annotations. */
  clearAnnotations(): void {
    if (this.annotations.length === 0) return;
    this.annotations = [];
    this.requestRender();
  }

  // --- Interactive drawing ---------------------------------------------------

  /** Activate a drawing tool (click-drag on the plot to place), or `null` to stop drawing. */
  setDrawTool(tool: DrawTool | null): void {
    if (this.drawTool === tool) return;
    this.drawTool = tool;
    this.pendingDrawing = null;
    this.updateCursor();
    for (const cb of this.drawToolCbs) cb(tool);
    this.requestRender();
  }

  /** The active drawing tool, or `null`. */
  getDrawTool(): DrawTool | null {
    return this.drawTool;
  }

  /** Subscribe to draw-tool changes (used by the toolbar). Returns an unsubscribe fn. */
  onDrawToolChange(cb: (t: DrawTool | null) => void): () => void {
    this.drawToolCbs.push(cb);
    return () => { this.drawToolCbs = this.drawToolCbs.filter((f) => f !== cb); };
  }

  /** Add a drawing programmatically (same shapes the tools produce). */
  addDrawing(a: Annotation): void {
    this.drawings.push(a);
    this.requestRender();
  }

  /** All user drawings (trendlines, fib levels, …). */
  getDrawings(): Annotation[] {
    return [...this.drawings];
  }

  /** Remove every user drawing. */
  clearDrawings(): void {
    if (this.drawings.length === 0 && !this.pendingDrawing) return;
    this.drawings = [];
    this.pendingDrawing = null;
    this.requestRender();
  }

  /** Canvas-space pixel → data coordinates on the x + primary y scale. */
  private dataAtPx(px: number, py: number): { x: number; y: number } {
    const region = plotRegion(this.layout());
    const nx = (px - region.left) / region.width;
    const ny = 1 - (py - region.top) / region.height;
    return { x: this.scaleX.invert(nx), y: this.primaryY().scale.invert(ny) };
  }

  /** Build the annotation for a draw tool from its start + current data points. */
  private buildDrawing(tool: DrawTool, s: { x: number; y: number }, c: { x: number; y: number }): Annotation {
    const col = "#f59e0b";
    switch (tool) {
      case "trendline": return { type: "line", x0: s.x, y0: s.y, x1: c.x, y1: c.y, color: col, width: 1.5 };
      case "ray": return { type: "ray", x0: s.x, y0: s.y, x1: c.x, y1: c.y, color: col, width: 1.5 };
      case "hline": return { type: "span", dim: "y", value: c.y, color: col, width: 1.5 };
      case "rect": return { type: "box", x: [s.x, c.x], y: [s.y, c.y], color: "rgba(245,158,11,0.08)", border: col };
      case "fib": return { type: "fib", x0: s.x, x1: c.x, high: Math.max(s.y, c.y), low: Math.min(s.y, c.y), fill: true, color: "#94a3b8" };
    }
  }

  private drawingYScale(a: Annotation): Scale {
    const id = "yAxis" in a ? a.yAxis : undefined;
    return (this.yAxes.get(id ?? "y") ?? this.primaryY()).scale;
  }

  /** Editable handle points (data space) for a drawing; `[]` if it has none. */
  private drawingHandlePts(a: Annotation): Array<{ x: number; y: number }> {
    switch (a.type) {
      case "line": case "ray": return [{ x: a.x0, y: a.y0 }, { x: a.x1, y: a.y1 }];
      case "fib": return [{ x: a.x0, y: a.high }, { x: a.x1, y: a.low }];
      case "box": return [{ x: a.x[0], y: a.y[0] }, { x: a.x[1], y: a.y[1] }];
      case "span": return a.dim === "y"
        ? [{ x: (this.scaleX.domain[0] + this.scaleX.domain[1]) / 2, y: a.value }]
        : [{ x: a.value, y: (this.primaryY().scale.domain[0] + this.primaryY().scale.domain[1]) / 2 }];
      default: return [];
    }
  }

  /** Move handle `i` of a drawing to a new data-space point (all editable types). */
  private setDrawingHandle(a: Annotation, i: number, x: number, y: number): void {
    switch (a.type) {
      case "line": case "ray": if (i === 0) { a.x0 = x; a.y0 = y; } else { a.x1 = x; a.y1 = y; } break;
      case "fib": if (i === 0) { a.x0 = x; a.high = y; } else { a.x1 = x; a.low = y; } break;
      case "box": {
        const m = a as unknown as { x: [number, number]; y: [number, number] };
        if (i === 0) { m.x = [x, a.x[1]]; m.y = [y, a.y[1]]; } else { m.x = [a.x[0], x]; m.y = [a.y[0], y]; }
        break;
      }
      case "span": (a as { value: number }).value = a.dim === "y" ? y : x; break;
    }
  }

  /** Cursor→drawing distance in px (segment for line/ray, edges for box/fib, the line for span). */
  private drawingBodyDist(a: Annotation, px: number, py: number, region: ReturnType<typeof plotRegion>): number {
    const s = this.drawingYScale(a);
    const X = (x: number) => pxX(region, this.scaleX.norm(x));
    const Y = (y: number) => pxY(region, s.norm(y));
    if (a.type === "line" || a.type === "ray") return segDist(px, py, X(a.x0), Y(a.y0), X(a.x1), Y(a.y1));
    if (a.type === "span") return a.dim === "y" ? Math.abs(py - Y(a.value)) : Math.abs(px - X(a.value));
    if (a.type === "box" || a.type === "fib") {
      const [x0, x1] = a.type === "box" ? [X(a.x[0]), X(a.x[1])] : [X(a.x0), X(a.x1)];
      const [y0, y1] = a.type === "box" ? [Y(a.y[0]), Y(a.y[1])] : [Y(a.high), Y(a.low)];
      const inX = px >= Math.min(x0, x1) - 4 && px <= Math.max(x0, x1) + 4;
      const inY = py >= Math.min(y0, y1) - 4 && py <= Math.max(y0, y1) + 4;
      if (inX && inY) return 0; // anywhere inside/near the box counts as a hit
    }
    return Infinity;
  }

  /** Topmost drawing under the cursor and its handle (handle −1 = body, index −1 = none). */
  private hitDrawing(px: number, py: number): { index: number; handle: number } {
    if (this.drawings.length === 0) return { index: -1, handle: -1 };
    const region = plotRegion(this.layout());
    for (let di = this.drawings.length - 1; di >= 0; di--) {
      const a = this.drawings[di]!;
      const s = this.drawingYScale(a);
      const pts = this.drawingHandlePts(a);
      for (let hi = 0; hi < pts.length; hi++) {
        const hx = pxX(region, this.scaleX.norm(pts[hi]!.x)), hy = pxY(region, s.norm(pts[hi]!.y));
        if (Math.hypot(hx - px, hy - py) <= 8) return { index: di, handle: hi };
      }
    }
    for (let di = this.drawings.length - 1; di >= 0; di--) {
      if (this.drawingBodyDist(this.drawings[di]!, px, py, region) <= 6) return { index: di, handle: -1 };
    }
    return { index: -1, handle: -1 };
  }

  private removeDrawing(index: number): void {
    if (index < 0 || index >= this.drawings.length) return;
    this.drawings.splice(index, 1);
    if (this.selectedDrawing === index) this.selectedDrawing = -1;
    else if (this.selectedDrawing > index) this.selectedDrawing--;
    this.hoverDrawing = -1;
    this.hideDrawMenu();
    this.requestRender();
  }

  private hideDrawMenu(): void {
    if (this.drawMenu) { this.drawMenu.remove(); this.drawMenu = null; }
  }

  /** Right-click context menu for a drawing: rename, recolor, delete. */
  private showDrawMenu(clientX: number, clientY: number, index: number): void {
    this.hideDrawMenu();
    const a = this.drawings[index];
    if (!a) return;
    this.selectedDrawing = index;
    const menu = document.createElement("div");
    Object.assign(menu.style, {
      position: "fixed", left: `${clientX}px`, top: `${clientY}px`, zIndex: "1000",
      minWidth: "150px", padding: "4px", borderRadius: "8px",
      background: this.isDark ? "rgba(15,23,42,0.98)" : "rgba(255,255,255,0.99)",
      color: this.isDark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${this.isDark ? "rgba(148,163,184,0.3)" : "rgba(100,116,139,0.3)"}`,
      boxShadow: "0 6px 20px rgba(0,0,0,0.35)", font: "13px system-ui, sans-serif", userSelect: "none",
    } as CSSStyleDeclaration);
    const item = (label: string, onClick: () => void): HTMLDivElement => {
      const row = document.createElement("div");
      row.textContent = label;
      Object.assign(row.style, { padding: "6px 10px", borderRadius: "5px", cursor: "pointer" } as CSSStyleDeclaration);
      row.addEventListener("mouseenter", () => { row.style.background = this.isDark ? "rgba(148,163,184,0.15)" : "rgba(100,116,139,0.12)"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
      row.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
      return row;
    };
    menu.appendChild(item("✎  Rename…", () => { this.hideDrawMenu(); this.renameDrawing(index); }));
    // Color swatches.
    const colorRow = document.createElement("div");
    Object.assign(colorRow.style, { display: "flex", gap: "6px", padding: "6px 10px" } as CSSStyleDeclaration);
    for (const c of ["#f59e0b", "#60a5fa", "#34d399", "#f472b6", "#e2e8f0"]) {
      const sw = document.createElement("span");
      Object.assign(sw.style, { width: "16px", height: "16px", borderRadius: "4px", background: c, cursor: "pointer", border: "1px solid rgba(0,0,0,0.2)" } as CSSStyleDeclaration);
      sw.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); (a as { color?: string }).color = c; this.hideDrawMenu(); this.requestRender(); });
      colorRow.appendChild(sw);
    }
    menu.appendChild(colorRow);
    const del = item("🗑  Delete", () => this.removeDrawing(index));
    del.style.color = "#f87171";
    menu.appendChild(del);
    document.body.appendChild(menu);
    this.drawMenu = menu;
    // Dismiss on an interaction OUTSIDE the menu (clicks inside must reach the items).
    const dismiss = (ev?: Event) => {
      if (ev && ev.target instanceof Node && menu.contains(ev.target)) return;
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("blur", dismiss);
      this.hideDrawMenu();
    };
    setTimeout(() => window.addEventListener("pointerdown", dismiss, true), 0);
    window.addEventListener("blur", dismiss);
    this.requestRender();
  }

  /** Prompt for a label on a drawing (double-click / context menu). */
  private renameDrawing(index: number): void {
    const a = this.drawings[index];
    if (!a || (a.type !== "line" && a.type !== "ray" && a.type !== "box" && a.type !== "fib")) return;
    const next = window.prompt("Label", a.label ?? "");
    if (next === null) return;
    a.label = next || undefined;
    this.requestRender();
  }

  /** Compute an STFT of `signal` and render it as a heatmap (time × frequency). */
  addHeatmapSpectrogram(
    signal: ArrayLike<number>,
    opts: { fftSize?: number; hop?: number; sampleRate?: number; colormap?: HeatmapOptions["colormap"] } = {},
  ): HeatmapLayer {
    const s = spectrogram(signal, opts);
    return this.register(
      new HeatmapLayer(this.gl, {
        values: s.values,
        cols: s.cols,
        rows: s.rows,
        extent: s.extent,
        colormap: opts.colormap ?? "plasma",
      }),
    );
  }

  /** Bin raw `values` and render a histogram as bars. */
  addHistogram(
    values: ArrayLike<number>,
    opts: {
      bins?: number;
      range?: [number, number];
      color?: string;
      name?: string;
      yAxis?: string;
    } = {},
  ): BarLayer {
    const h = histogram(values, { bins: opts.bins, range: opts.range });
    return this.register(
      new BarLayer(this.gl, {
        x: h.centers,
        y: h.counts,
        width: h.binWidth * 0.98,
        color: opts.color,
        name: opts.name,
        yAxis: opts.yAxis,
      }),
    );
  }

  /** Register an additional named y axis. Series opt in via `addLine({ yAxis })`. */
  addYAxis(id: string, opts: YAxisOptions = {}): void {
    if (this.yAxes.has(id)) throw new Error(`Y axis "${id}" already exists`);
    const { type, domain, factors, times, side, color, ...axisConfig } = opts;
    const band = type === "categorical" || type === "ordinal-time";
    const scale = makeScale(type ?? "linear", domain ?? [0, 1], factors, times);
    this.yAxes.set(id, {
      id,
      scale,
      axis: new Axis(axisConfig),
      side: side ?? "right",
      auto: !band && domain == null,
      initial: band ? scale.domain : (domain ?? null),
      color,
    });
    this.autoscale();
    this.requestRender();
  }

  /** Whether a y axis with this id exists (the primary is always `"y"`). */
  hasYAxis(id: string): boolean {
    return this.yAxes.has(id);
  }

  /** Remove a secondary y axis. No-op for the primary `"y"` or an unknown id. */
  removeYAxis(id: string): void {
    if (id === "y" || !this.yAxes.has(id)) return;
    this.yAxes.delete(id);
    this.requestRender();
  }

  removeLayer(layer: Layer): void {
    const i = this.layers.indexOf(layer);
    if (i >= 0) {
      this.layers.splice(i, 1);
      layer.dispose();
      this.autoscale();
      this.requestRender();
    }
  }

  /** Configure ticks/format/title for the x axis or a y axis (default primary "y"). */
  setAxis(dim: Dim | string, config: Partial<AxisConfig>): void {
    if (dim === "x") {
      this.axisX.update(config);
    } else {
      const ya = this.yAxes.get(dim === "y" ? "y" : dim);
      if (!ya) throw new Error(`Unknown axis "${dim}"`);
      ya.axis.update(config);
    }
    this.requestRender();
  }

  /** Set (or lock) the visible domain. `y` targets the primary axis; use `yAxes` for others. */
  setView(view: { x?: Range; y?: Range; yAxes?: Record<string, Range> }): void {
    if (view.x) {
      this.scaleX.domain = view.x;
      this.autoX = false;
    }
    if (view.y) this.setYDomain("y", view.y);
    if (view.yAxes) {
      for (const [id, r] of Object.entries(view.yAxes)) this.setYDomain(id, r);
    }
    this.requestRender();
  }

  /**
   * Subscribe to x-domain changes (pan / zoom / home / setView). Fires once per
   * frame after the domain settles. Returns an unsubscribe function. See {@link linkX}.
   */
  onViewChange(cb: (x: Range) => void): () => void {
    this.viewListeners.push(cb);
    return () => { this.viewListeners = this.viewListeners.filter((f) => f !== cb); };
  }

  /**
   * Subscribe to the hover cursor's data-space x (or `null` when it leaves the
   * plot). Returns an unsubscribe function. Used to share a crosshair across panes.
   */
  onCursorMove(cb: (dataX: number | null) => void): () => void {
    this.cursorListeners.push(cb);
    return () => { this.cursorListeners = this.cursorListeners.filter((f) => f !== cb); };
  }

  /** Draw a linked crosshair at this data-space x (pushed from another pane), or clear it with `null`. */
  setLinkedCursor(dataX: number | null): void {
    if (this.linkedCursorX === dataX) return;
    this.linkedCursorX = dataX;
    this.requestRender();
  }

  private setYDomain(id: string, range: Range): void {
    const ya = this.yAxes.get(id);
    if (!ya) throw new Error(`Unknown y axis "${id}"`);
    ya.scale.domain = range;
    ya.auto = false;
  }

  // ---- Interaction control --------------------------------------------------

  setMode(mode: InteractionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.updateCursor();
    for (const cb of this.modeChangeCbs) cb(mode);
  }

  getMode(): InteractionMode {
    return this.mode;
  }

  onModeChange(cb: (mode: InteractionMode) => void): void {
    this.modeChangeCbs.push(cb);
  }

  /** Reset to the home view: explicit domains restored, auto axes re-fit to data. */
  home(): void {
    if (this.initialX) {
      this.scaleX.domain = this.initialX;
      this.autoX = false;
    } else {
      this.autoX = true;
    }
    for (const ya of this.yAxes.values()) {
      if (ya.initial) {
        ya.scale.domain = ya.initial;
        ya.auto = false;
      } else {
        ya.auto = true;
      }
    }
    this.autoscale();
    this.requestRender();
  }

  // --- Export ---------------------------------------------------------------

  /**
   * Composite this plot's layers (grid → data → axes/labels) into a single 2D
   * canvas at device resolution. `background` fills behind the plot (default the
   * theme's page color; pass `"transparent"` to keep alpha).
   */
  private compositeCanvas(background?: string): HTMLCanvasElement {
    this.render(); // ensure the blitted data canvas holds this plot's latest frame
    const w = this.dataCanvas.width, h = this.dataCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d")!;
    const bg = background ?? (this.isDark ? "#0b1220" : "#ffffff");
    if (bg !== "transparent") { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(this.gridCanvas, 0, 0);
    ctx.drawImage(this.dataCanvas, 0, 0);
    ctx.drawImage(this.axisCanvas, 0, 0);
    return out;
  }

  /** Export the current view as a data URL (default PNG). */
  toDataURL(type = "image/png", opts: ExportOptions = {}): string {
    return this.compositeCanvas(opts.background).toDataURL(type, opts.quality);
  }

  /** Export the current view as a `Blob` (default PNG). */
  toBlob(type = "image/png", opts: ExportOptions = {}): Promise<Blob | null> {
    return canvasToBlob(this.compositeCanvas(opts.background), type, opts.quality);
  }

  /** Download the current view as an image (PNG by default). */
  downloadImage(filename = "chart.png", type = "image/png", opts: ExportOptions = {}): Promise<void> {
    return downloadCanvas(this.compositeCanvas(opts.background), filename, type, opts.quality);
  }

  /** Copy the current view to the clipboard as a PNG. Throws if the browser can't. */
  copyToClipboard(opts: ExportOptions = {}): Promise<void> {
    return copyCanvasToClipboard(this.compositeCanvas(opts.background));
  }

  /** Re-fit auto axes to the data: x over all series, each y axis over its own series. */
  autoscale(): void {
    // X across all layers.
    if (this.autoX) {
      let minX = Infinity, maxX = -Infinity, any = false;
      for (const l of this.layers) {
        const b = l.bounds();
        if (!b) continue;
        any = true;
        minX = Math.min(minX, b.x[0]);
        maxX = Math.max(maxX, b.x[1]);
      }
      if (any) this.scaleX.domain = padDomain(minX, maxX, this.scaleX.log, 0.02);
    }
    // Each y axis over the layers assigned to it.
    for (const ya of this.yAxes.values()) {
      if (!ya.auto) continue;
      let minY = Infinity, maxY = -Infinity, any = false;
      for (const l of this.layers) {
        if (l.yAxis !== ya.id) continue;
        const b = l.bounds();
        if (!b) continue;
        any = true;
        minY = Math.min(minY, b.y[0]);
        maxY = Math.max(maxY, b.y[1]);
      }
      if (any) ya.scale.domain = padDomain(minY, maxY, ya.scale.log, 0.05);
    }
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.toolbarHandle?.destroy();
    this.hideDrawMenu();
    this.selectionDiv.remove();
    this.tooltip.remove();
    this.infoBox.remove();
    this.legendDiv.remove();
    for (const l of this.layers) l.dispose();
    this.container.removeChild(this.gridCanvas);
    this.container.removeChild(this.dataCanvas);
    this.container.removeChild(this.axisCanvas);
  }

  // ---- Rendering ------------------------------------------------------------

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const c of [this.gridCanvas, this.dataCanvas, this.axisCanvas]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    }
    this.gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dataCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.axisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  private primaryY(): YAxisState {
    return this.yAxes.get("y")!;
  }

  /** Fire view/cursor listeners once the frame's x-domain + cursor are settled. */
  private emitLinks(region: ReturnType<typeof plotRegion>): void {
    const dx = this.scaleX.domain;
    if (!this.lastEmittedX || this.lastEmittedX[0] !== dx[0] || this.lastEmittedX[1] !== dx[1]) {
      this.lastEmittedX = [dx[0], dx[1]];
      for (const cb of this.viewListeners) cb(this.lastEmittedX);
    }
    if (this.cursorListeners.length) {
      const cx = this.hoverEnabled && this.hoverPx
        ? this.scaleX.invert(Math.max(0, Math.min(1, (this.hoverPx.x - region.left) / region.width)))
        : null;
      if (cx !== this.lastEmittedCursor) {
        this.lastEmittedCursor = cx;
        for (const cb of this.cursorListeners) cb(cx);
      }
    }
  }

  render(): void {
    const layout = this.layout();
    const region = plotRegion(layout);
    if (this.equalAspect) this.applyAspect(region);
    if (this.boundedPan) this.clampView();
    this.emitLinks(region);
    const primary = this.primaryY();
    const ticksX = this.axisX.resolve(this.scaleX);
    const ticksYPrimary = primary.axis.resolve(primary.scale);
    const styleX = resolveAxisStyle(this.axisX.config, this.theme);
    const styleYPrimary = resolveAxisStyle(primary.axis.config, this.theme, primary.color);

    // Grid (behind data): x lines + primary-y lines only, to avoid clutter.
    this.gridCtx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
    if (this.borderFill) {
      this.gridCtx.fillStyle = this.borderFill;
      this.gridCtx.fillRect(0, 0, layout.cssWidth, layout.cssHeight);
    }
    if (this.bgFill) {
      this.gridCtx.fillStyle = this.bgFill;
      this.gridCtx.fillRect(region.left, region.top, region.width, region.height);
    }
    drawGrid(this.gridCtx, region, this.scaleX, primary.scale, ticksX, ticksYPrimary, styleX, styleYPrimary);

    // Data: render into the shared WebGL canvas (sized to this plot), then blit.
    const gl = this.gl;
    const devW = this.dataCanvas.width;
    const devH = this.dataCanvas.height;
    sizeShared(gl, devW, devH);
    begin2D(gl);
    gl.clearColor(0, 0, 0, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, devW, devH);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const dpr = this.dpr;
    const vx = Math.round(region.left * dpr);
    const vw = Math.round(region.width * dpr);
    const vh = Math.round(region.height * dpr);
    const vy = devH - Math.round((region.top + region.height) * dpr);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);
    gl.viewport(vx, vy, vw, vh);

    const xFrame: AxisFrame = {
      lo: this.scaleX.domain[0],
      hi: this.scaleX.domain[1],
      log: this.scaleX.log,
    };
    for (const layer of this.layers) {
      const ya = this.yAxes.get(layer.yAxis)!;
      layer.draw({
        gl,
        x: xFrame,
        y: { lo: ya.scale.domain[0], hi: ya.scale.domain[1], log: ya.scale.log },
        pixelWidth: vw,
        pixelHeight: vh,
        dpr: this.dpr,
      });
    }
    gl.disable(gl.SCISSOR_TEST);

    // Blit the shared GL result onto this plot's own data canvas.
    this.dataCtx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
    this.dataCtx.drawImage(this.sharedCanvas, 0, 0, layout.cssWidth, layout.cssHeight);

    // Axes (above data).
    this.axisCtx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
    drawXAxis(this.axisCtx, region, this.scaleX, ticksX, styleX, this.axisX.config.title);

    const positions = this.yAxisPositions();
    for (const ya of this.yAxes.values()) {
      const pos = positions.get(ya.id)!;
      const ticks = ya.axis.resolve(ya.scale);
      const styleY = ya === primary ? styleYPrimary : resolveAxisStyle(ya.axis.config, this.theme, ya.color);
      drawYAxis(this.axisCtx, region, ya.scale, ticks, styleY, {
        x: pos.x,
        side: ya.side,
        title: ya.axis.config.title,
        titleX: pos.titleX,
      });
    }

    // Plot title in the reserved top strip.
    if (this.title) drawTitle(this.axisCtx, region, this.title, this.isDark);

    // Annotations (span/band/box/label) above the data, clipped to the region.
    if (this.annotations.length || this.drawings.length || this.pendingDrawing) this.renderAnnotations(region);

    // Both-axis guide lines while the pointer is pressed.
    if (this.crosshair && this.pressPx) {
      drawCrosshairXY(this.axisCtx, region, this.pressPx.x, this.pressPx.y, this.theme);
    }

    // Linked crosshair pushed from another pane (see linkX).
    if (this.linkedCursorX != null) {
      const nx = this.scaleX.norm(this.linkedCursorX);
      if (nx >= -0.001 && nx <= 1.001) {
        drawCrosshair(this.axisCtx, region, pxX(region, nx), this.theme);
      }
    }

    // Hover crosshair + markers + tooltip.
    if (this.hoverEnabled && this.hoverPx) {
      this.renderHover(region);
    } else {
      this.tooltip.style.display = "none";
      if (this.pointInfo === "hover") this.selected = null; // nothing hovered
    }

    // Pinned point details (clicked, or hovered in "hover" mode).
    this.updateInfoBox(region);

    // Legend of named series.
    this.updateLegend(region);
  }

  /** Named series that can appear in the legend: any layer exposing name + colorCss. */
  private legendEntries(): Array<{ name: string; colorCss: string }> {
    const out: Array<{ name: string; colorCss: string }> = [];
    for (const l of this.layers) {
      const a = l as Partial<{ name: string; colorCss: string }>;
      if (typeof a.name === "string" && a.name && typeof a.colorCss === "string") {
        out.push({ name: a.name, colorCss: a.colorCss });
      }
    }
    return out;
  }

  /** Rebuild and position the legend overlay (or hide it). */
  private updateLegend(region: ReturnType<typeof plotRegion>): void {
    const div = this.legendDiv;
    const entries = this.legend ? this.legendEntries() : [];
    if (!this.legend || entries.length === 0) {
      div.style.display = "none";
      return;
    }
    const cfg = this.legend;
    if (cfg.background) div.style.background = cfg.background;
    if (cfg.border) div.style.border = `1px solid ${cfg.border}`;
    if (cfg.textColor) div.style.color = cfg.textColor;
    if (cfg.font) div.style.font = cfg.font;
    const horizontal = cfg.orientation === "horizontal";
    div.style.display = "flex";
    div.style.flexDirection = horizontal ? "row" : "column";
    div.style.gap = horizontal ? "12px" : "3px";

    div.replaceChildren();
    for (const e of entries) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "6px";
      const swatch = document.createElement("span");
      Object.assign(swatch.style, {
        width: "10px",
        height: "10px",
        borderRadius: "2px",
        background: e.colorCss,
        flex: "0 0 auto",
      } as CSSStyleDeclaration);
      const label = document.createElement("span");
      label.textContent = e.name;
      row.appendChild(swatch);
      row.appendChild(label);
      div.appendChild(row);
    }

    // Position inside the plot region, inset from the chosen corner.
    const inset = 8;
    const pos = cfg.position ?? "top-right";
    const w = div.offsetWidth;
    const h = div.offsetHeight;
    const left = pos.endsWith("left")
      ? region.left + inset
      : region.left + region.width - w - inset;
    const top = pos.startsWith("top")
      ? region.top + inset
      : region.top + region.height - h - inset;
    div.style.left = `${Math.max(0, left)}px`;
    div.style.top = `${Math.max(0, top)}px`;
  }

  /** Draw all annotations, projected through the scales and clipped to the region. */
  private renderAnnotations(region: ReturnType<typeof plotRegion>): void {
    const ctx = this.axisCtx;
    const left = region.left, right = region.left + region.width;
    const top = region.top, bottom = region.top + region.height;
    const yScaleOf = (id?: string): Scale => (this.yAxes.get(id ?? "y") ?? this.primaryY()).scale;
    const px = (v: number): number => pxX(region, this.scaleX.norm(v));
    const py = (s: Scale, v: number): number => pxY(region, s.norm(v));
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    const items = this.pendingDrawing
      ? [...this.annotations, ...this.drawings, this.pendingDrawing]
      : this.drawings.length ? [...this.annotations, ...this.drawings] : this.annotations;
    for (const a of items) {
      ctx.setLineDash([]);
      if (a.type === "span") {
        ctx.strokeStyle = a.color ?? this.theme.axis;
        ctx.lineWidth = a.width ?? 1;
        if (a.dash) ctx.setLineDash(a.dash);
        ctx.beginPath();
        if (a.dim === "x") {
          const x = Math.round(px(a.value)) + 0.5;
          ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        } else {
          const y = Math.round(py(yScaleOf(a.yAxis), a.value)) + 0.5;
          ctx.moveTo(left, y); ctx.lineTo(right, y);
        }
        ctx.stroke();
      } else if (a.type === "band") {
        ctx.fillStyle = a.color ?? "rgba(59,130,246,0.15)";
        if (a.dim === "x") {
          const x0 = px(a.from), x1 = px(a.to);
          ctx.fillRect(Math.min(x0, x1), top, Math.abs(x1 - x0), bottom - top);
        } else {
          const s = yScaleOf(a.yAxis);
          const y0 = py(s, a.from), y1 = py(s, a.to);
          ctx.fillRect(left, Math.min(y0, y1), right - left, Math.abs(y1 - y0));
        }
      } else if (a.type === "box") {
        const s = yScaleOf(a.yAxis);
        const x0 = px(a.x[0]), x1 = px(a.x[1]);
        const y0 = py(s, a.y[0]), y1 = py(s, a.y[1]);
        const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
        const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
        if (a.color) { ctx.fillStyle = a.color; ctx.fillRect(rx, ry, rw, rh); }
        if (a.border) { ctx.strokeStyle = a.border; ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh); }
        if (a.label) {
          ctx.fillStyle = a.border ?? a.color ?? this.theme.text;
          ctx.font = this.theme.font; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
          ctx.fillText(a.label, rx + 4, ry - 3);
        }
      } else if (a.type === "label") {
        const s = yScaleOf(a.yAxis);
        ctx.fillStyle = a.color ?? this.theme.text;
        ctx.font = a.font ?? this.theme.font;
        ctx.textAlign = a.align ?? "left";
        ctx.textBaseline = "middle";
        ctx.fillText(a.text, px(a.x), py(s, a.y));
      } else if (a.type === "line" || a.type === "ray") {
        const s = yScaleOf(a.yAxis);
        ctx.strokeStyle = a.color ?? this.theme.axis;
        ctx.lineWidth = a.width ?? 1.5;
        if (a.dash) ctx.setLineDash(a.dash);
        const X0 = px(a.x0), Y0 = py(s, a.y0);
        let X1 = px(a.x1), Y1 = py(s, a.y1);
        if (a.type === "ray") {
          // Extend far past the second point; the region clip trims it to the edge.
          const dx = X1 - X0, dy = Y1 - Y0, len = Math.hypot(dx, dy) || 1, f = 8000 / len;
          X1 = X0 + dx * f; Y1 = Y0 + dy * f;
        }
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        if (a.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = a.color ?? this.theme.text;
          ctx.font = this.theme.font; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
          ctx.fillText(a.label, px(a.x1) + 7, py(s, a.y1) - 4);
        }
      } else {
        // Fibonacci retracement levels between `high` and `low` across [x0, x1].
        const s = yScaleOf(a.yAxis);
        const ratios = a.ratios ?? [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const span = a.high - a.low;
        const fx0 = Math.min(px(a.x0), px(a.x1)), fx1 = Math.max(px(a.x0), px(a.x1));
        const color = a.color ?? this.theme.axis;
        const ys = ratios.map((r) => py(s, a.high - span * r));
        if (a.fill) {
          for (let i = 0; i < ys.length - 1; i++) {
            ctx.fillStyle = `rgba(96,165,250,${i % 2 === 0 ? 0.06 : 0.12})`;
            ctx.fillRect(fx0, Math.min(ys[i]!, ys[i + 1]!), fx1 - fx0, Math.abs(ys[i + 1]! - ys[i]!));
          }
        }
        ctx.setLineDash([]); ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.fillStyle = color; ctx.font = this.theme.font; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        for (let i = 0; i < ratios.length; i++) {
          const y = Math.round(ys[i]!) + 0.5;
          ctx.beginPath(); ctx.moveTo(fx0, y); ctx.lineTo(fx1, y); ctx.stroke();
          ctx.fillText(`${(ratios[i]! * 100).toFixed(1)}% · ${(a.high - span * ratios[i]!).toFixed(2)}`, fx0 + 4, y - 2);
        }
        if (a.label) ctx.fillText(a.label, fx0 + 4, Math.min(...ys) - 4);
      }
    }

    // Editable-handle chrome for the hovered / selected drawing.
    const active = this.selectedDrawing >= 0 ? this.selectedDrawing : this.hoverDrawing;
    if (active >= 0 && active < this.drawings.length) {
      const a = this.drawings[active]!;
      const s = yScaleOf(a.yAxis);
      ctx.setLineDash([]);
      for (const pt of this.drawingHandlePts(a)) {
        const hx = px(pt.x), hy = py(s, pt.y);
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = this.selectedDrawing === active ? "#f59e0b" : (this.isDark ? "#e2e8f0" : "#fff");
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.isDark ? "#0b1220" : "#334155";
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private renderHover(region: ReturnType<typeof plotRegion>): void {
    const cursor = this.hoverPx!;
    // Only show hover inside the plot region.
    if (
      cursor.x < region.left || cursor.x > region.left + region.width ||
      cursor.y < region.top || cursor.y > region.top + region.height
    ) {
      this.tooltip.style.display = "none";
      return;
    }

    const nx = (cursor.x - region.left) / region.width;
    const dataX = this.scaleX.invert(nx);
    // y is north-up: pixels grow downward, so invert the vertical fraction.
    const ny = 1 - (cursor.y - region.top) / region.height;
    const dataY = this.primaryY().scale.invert(ny);
    // Full X+Y crosshair when enabled (e.g. maps); otherwise just the x line.
    if (this.crosshair) {
      drawCrosshairXY(this.axisCtx, region, cursor.x, cursor.y, this.theme);
    } else {
      drawCrosshair(this.axisCtx, region, cursor.x, this.theme);
    }

    const rows: Array<{ layer: Pickable; x: number; y: number }> = [];
    for (const layer of this.layers) {
      if (!isPickable(layer)) continue;
      const ya = this.yAxes.get(layer.yAxis)!;
      const project = (x: number, y: number): [number, number] => [
        pxX(region, this.scaleX.norm(x)),
        pxY(region, ya.scale.norm(y)),
      ];
      const p = layer.pick(this.pickMode, cursor.x, cursor.y, project);
      if (!p) continue;
      const [px, py] = project(p.x, p.y);
      drawMarker(this.axisCtx, px, py, layer.colorCss);
      rows.push({ layer, x: p.x, y: p.y });
    }

    // Always show at least the x readout, even with no series under the cursor.
    this.updateTooltip(rows, cursor, dataX, dataY);

    // In hover mode, the pinned info box tracks the point under the cursor.
    if (this.pointInfo === "hover") this.selected = this.pickPoint(cursor.x, cursor.y);
  }

  private updateTooltip(
    rows: Array<{ layer: Pickable; x: number; y: number }>,
    cursor: { x: number; y: number },
    dataX: number,
    dataY: number,
  ): void {
    const tip = this.tooltip;
    // Rebuild content with safe DOM APIs (no innerHTML).
    tip.replaceChildren();
    if (this.hoverReadout) {
      // Custom header: one line per row returned (e.g. lon/lat on a map).
      for (const line of this.hoverReadout(dataX, dataY)) {
        const el = document.createElement("div");
        el.style.opacity = "0.7";
        el.style.marginBottom = "3px";
        el.textContent = `${line.label} ${line.value}`;
        tip.appendChild(el);
      }
    } else {
      const xfmt = this.axisX.config.format ?? defaultFormat;
      const header = document.createElement("div");
      header.style.opacity = "0.7";
      header.style.marginBottom = "3px";
      header.textContent = `x = ${xfmt(dataX)}`;
      tip.appendChild(header);
    }

    for (const r of rows) {
      const yfmt = this.yAxes.get(r.layer.yAxis)!.axis.config.format ?? defaultFormat;
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "6px";

      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: r.layer.colorCss,
        flex: "0 0 auto",
      } as CSSStyleDeclaration);

      const label = document.createElement("span");
      label.textContent = `${r.layer.name}: ${yfmt(r.y)}`;

      row.appendChild(dot);
      row.appendChild(label);
      tip.appendChild(row);
    }

    tip.style.display = "block";
    // Position near the cursor, flipping to stay inside the container.
    const cw = this.container.clientWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = cursor.x + 14;
    if (left + tw > cw) left = cursor.x - tw - 14;
    let top = cursor.y + 14;
    if (top + th > this.container.clientHeight) top = cursor.y - th - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top)}px`;
  }

  // ---- Interaction ----------------------------------------------------------

  private updateCursor(): void {
    this.axisCanvas.style.cursor = this.drawTool ? "crosshair" : this.mode === "pan" ? "grab" : "crosshair";
  }

  private axisLock(): { x: boolean; y: boolean } {
    if (this.mode === "box-x") return { x: true, y: false };
    if (this.mode === "box-y") return { x: false, y: true };
    return { x: true, y: true };
  }

  /**
   * Which region the pointer is over: the plot body, the x-axis strip (below),
   * or a specific y-axis strip (in a side margin). Dragging an axis strip pans
   * just that axis.
   */
  private zoneAt(px: number, py: number): { type: "plot" } | { type: "x" } | { type: "y"; id: string } {
    const region = plotRegion(this.layout());
    const inX = px >= region.left && px <= region.left + region.width;
    const inY = py >= region.top && py <= region.top + region.height;
    if (inX && py > region.top + region.height) return { type: "x" };
    if (inY && !inX) {
      // Nearest y axis to the cursor within a side margin.
      const positions = this.yAxisPositions();
      let bestId: string | null = null;
      let bestD = Infinity;
      for (const [id, pos] of positions) {
        const d = Math.abs(pos.x - px);
        if (d < bestD) {
          bestD = d;
          bestId = id;
        }
      }
      if (bestId && bestD <= Y_AXIS_GAP) return { type: "y", id: bestId };
    }
    return { type: "plot" };
  }

  // Pan/zoom shift the domain in the scale's *transformed* space (via invert),
  // not raw data space — so a log axis stays positive instead of crossing zero
  // into NaN. For linear/time scales this is identical to the old arithmetic.
  private panX(dxPx: number, region: ReturnType<typeof plotRegion>): void {
    const f = dxPx / region.width;
    this.scaleX.domain = [this.scaleX.invert(-f), this.scaleX.invert(1 - f)];
    this.autoX = false;
  }

  private panY(id: string | null, dyPx: number, region: ReturnType<typeof plotRegion>): void {
    const f = dyPx / region.height;
    for (const ya of this.yAxes.values()) {
      if (id && ya.id !== id) continue;
      ya.scale.domain = [ya.scale.invert(f), ya.scale.invert(1 + f)];
      ya.auto = false;
    }
  }

  private attachInteraction(): void {
    const el = this.axisCanvas;
    el.style.touchAction = "none";
    el.style.outline = "none";

    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const region = plotRegion(this.layout());
        const rect = el.getBoundingClientRect();
        const nx = (e.clientX - rect.left - region.left) / region.width;
        const ny = 1 - (e.clientY - rect.top - region.top) / region.height;
        const factor = Math.exp(e.deltaY * 0.001);
        this.zoomAround(nx, ny, factor);
      },
      { passive: false },
    );

    let panning = false;
    let selecting = false;
    let drawing = false;
    let drawStart = { x: 0, y: 0 };
    /** Non-null while dragging a drawing's handle. */
    let handleDrag: { index: number; handle: number } | null = null;
    /** Non-null while dragging an axis strip: `"x"` or a y-axis id. */
    let axisDrag: "x" | { y: string } | null = null;
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    let downX = 0;
    let downY = 0;

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; // right/middle click → let contextmenu handle it
      el.setPointerCapture(e.pointerId);
      this.hoverPx = null;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      downX = px;
      downY = py;
      const zone = this.zoneAt(px, py);
      const drawHit = !this.drawTool && zone.type === "plot" && this.drawings.length
        ? this.hitDrawing(px, py) : { index: -1, handle: -1 };

      if (zone.type === "x") {
        axisDrag = "x";
        lastX = e.clientX;
      } else if (zone.type === "y") {
        axisDrag = { y: zone.id };
        lastY = e.clientY;
      } else if (this.drawTool) {
        drawing = true;
        drawStart = this.dataAtPx(px, py);
        this.pendingDrawing = this.buildDrawing(this.drawTool, drawStart, drawStart);
        this.requestRender();
      } else if (drawHit.index >= 0) {
        // Select the drawing; grab a handle if the cursor is on one.
        this.selectedDrawing = drawHit.index;
        el.focus({ preventScroll: true });
        if (drawHit.handle >= 0) { handleDrag = drawHit; el.style.cursor = "grabbing"; }
        this.requestRender();
      } else if (this.mode === "pan") {
        this.selectedDrawing = -1;
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        el.style.cursor = "grabbing";
        if (this.crosshair) this.setPress(px, py);
      } else {
        this.selectedDrawing = -1;
        selecting = true;
        startX = px;
        startY = py;
        if (this.crosshair) this.setPress(px, py);
      }
    });

    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      const region = plotRegion(this.layout());
      if (this.pressPx) this.setPress(e.clientX - rect.left, e.clientY - rect.top);
      if (axisDrag === "x") {
        this.panX(e.clientX - lastX, region);
        lastX = e.clientX;
        this.requestRender();
      } else if (axisDrag && typeof axisDrag === "object") {
        this.panY(axisDrag.y, e.clientY - lastY, region);
        lastY = e.clientY;
        this.requestRender();
      } else if (handleDrag) {
        const c = this.dataAtPx(e.clientX - rect.left, e.clientY - rect.top);
        this.setDrawingHandle(this.drawings[handleDrag.index]!, handleDrag.handle, c.x, c.y);
        this.requestRender();
      } else if (panning) {
        this.panX(e.clientX - lastX, region);
        this.panY(null, e.clientY - lastY, region);
        lastX = e.clientX;
        lastY = e.clientY;
        this.requestRender();
      } else if (drawing && this.drawTool) {
        const c = this.dataAtPx(e.clientX - rect.left, e.clientY - rect.top);
        this.pendingDrawing = this.buildDrawing(this.drawTool, drawStart, c);
        this.requestRender();
      } else if (selecting) {
        this.drawSelection(startX, startY, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        // Idle: hover in the plot body, resize cursors over axis strips.
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const zone = this.zoneAt(px, py);
        if (zone.type === "x") {
          el.style.cursor = "ew-resize";
          this.setHover(null);
        } else if (zone.type === "y") {
          el.style.cursor = "ns-resize";
          this.setHover(null);
        } else {
          const hit = !this.drawTool && this.drawings.length ? this.hitDrawing(px, py) : { index: -1, handle: -1 };
          if (hit.index >= 0) {
            if (this.hoverDrawing !== hit.index) { this.hoverDrawing = hit.index; this.requestRender(); }
            el.style.cursor = hit.handle >= 0 ? "grab" : "pointer";
            this.setHover(null);
          } else {
            if (this.hoverDrawing !== -1) { this.hoverDrawing = -1; this.requestRender(); }
            this.updateCursor();
            if (this.hoverEnabled) this.setHover({ x: px, y: py });
          }
        }
      }
    });

    el.addEventListener("pointerleave", () => { this.setHover(null); if (this.hoverDrawing !== -1) { this.hoverDrawing = -1; this.requestRender(); } });

    const end = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (this.pressPx) {
        this.pressPx = null;
        this.requestRender();
      }
      const rect = el.getBoundingClientRect();
      const upPx = e.clientX - rect.left;
      const upPy = e.clientY - rect.top;
      // A press-and-release that barely moved, in the plot body, is a click.
      const isClick =
        e.type === "pointerup" && !axisDrag && Math.hypot(upPx - downX, upPy - downY) < 4;
      if (axisDrag) {
        axisDrag = null;
      } else if (handleDrag) {
        handleDrag = null;
        this.updateCursor();
        this.requestRender();
      } else if (drawing) {
        drawing = false;
        const moved = Math.hypot(upPx - downX, upPy - downY);
        // Commit unless it was a stray click for a drag-only tool.
        if (this.pendingDrawing && (this.drawTool === "hline" || moved >= 3)) this.drawings.push(this.pendingDrawing);
        this.pendingDrawing = null;
        this.requestRender();
      } else if (panning) {
        panning = false;
        this.updateCursor();
      } else if (selecting) {
        selecting = false;
        if (!isClick) this.applySelection(startX, startY, upPx, upPy);
        this.selectionDiv.style.display = "none";
      }
      // A drawing tool / a selected drawing owns clicks in the plot body — don't also pin a point.
      if (isClick && this.drawTool === null && this.selectedDrawing < 0) this.handleClick(upPx, upPy);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    // Double-click a drawing to (re)label it.
    el.addEventListener("dblclick", (e) => {
      const rect = el.getBoundingClientRect();
      const hit = this.hitDrawing(e.clientX - rect.left, e.clientY - rect.top);
      if (hit.index >= 0) { e.preventDefault(); this.selectedDrawing = hit.index; this.renameDrawing(hit.index); }
    });

    // Right-click a drawing for a context menu (rename / recolor / delete).
    el.addEventListener("contextmenu", (e) => {
      const rect = el.getBoundingClientRect();
      const hit = this.hitDrawing(e.clientX - rect.left, e.clientY - rect.top);
      if (hit.index >= 0) { e.preventDefault(); this.showDrawMenu(e.clientX, e.clientY, hit.index); }
    });

    // Delete / Backspace removes the selected drawing (when the plot has focus).
    el.tabIndex = el.tabIndex >= 0 ? el.tabIndex : 0;
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedDrawing >= 0) {
        e.preventDefault();
        this.removeDrawing(this.selectedDrawing);
      }
    });
  }

  private setHover(px: { x: number; y: number } | null): void {
    const had = this.hoverPx !== null;
    if (!px && !had) return;
    this.hoverPx = px;
    this.requestRender();
  }

  /** Update the press-crosshair position and redraw. */
  private setPress(x: number, y: number): void {
    this.pressPx = { x, y };
    this.requestRender();
  }

  /** Nearest point (2D, within a small radius) under the cursor, or null. */
  private pickPoint(
    cursorPx: number,
    cursorPy: number,
  ): { layer: Pickable; x: number; y: number; index: number } | null {
    const region = plotRegion(this.layout());
    let hit: { layer: Pickable; x: number; y: number; index: number } | null = null;
    let hitDist = Infinity;
    for (const layer of this.layers) {
      if (!isPickable(layer)) continue;
      const ya = this.yAxes.get(layer.yAxis)!;
      const project = (x: number, y: number): [number, number] => [
        pxX(region, this.scaleX.norm(x)),
        pxY(region, ya.scale.norm(y)),
      ];
      const p = layer.pick("xy", cursorPx, cursorPy, project);
      if (!p) continue;
      const [ppx, ppy] = project(p.x, p.y);
      const d = Math.hypot(ppx - cursorPx, ppy - cursorPy);
      if (d < hitDist) {
        hitDist = d;
        hit = { layer, x: p.x, y: p.y, index: p.index };
      }
    }
    return hit && hitDist <= 14 ? hit : null;
  }

  /** Click handler: in `pointInfo:"click"` mode, pin the point under the cursor. */
  private handleClick(cursorPx: number, cursorPy: number): void {
    if (this.pointInfo !== "click") return;
    this.selected = this.pickPoint(cursorPx, cursorPy);
    this.requestRender();
  }

  /** Draw the pinned point's marker and position its info box (or hide it). */
  private updateInfoBox(region: ReturnType<typeof plotRegion>): void {
    const box = this.infoBox;
    if (!this.selected) {
      box.style.display = "none";
      return;
    }
    const { layer, x, y, index } = this.selected;
    const ya = this.yAxes.get(layer.yAxis)!;
    const px = pxX(region, this.scaleX.norm(x));
    const py = pxY(region, ya.scale.norm(y));
    // Hide when the point has been panned/zoomed out of the plot region.
    if (
      px < region.left || px > region.left + region.width ||
      py < region.top || py > region.top + region.height
    ) {
      box.style.display = "none";
      return;
    }
    drawMarker(this.axisCtx, px, py, layer.colorCss);

    box.replaceChildren();
    // User-supplied detail for this point, if the layer provides it.
    const info = layer.infoAt ? layer.infoAt(index) : null;
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "2px";
    title.textContent = info && info.length ? info[0]! : layer.name;
    box.appendChild(title);
    if (info && info.length > 1) {
      for (let i = 1; i < info.length; i++) {
        const row = document.createElement("div");
        row.textContent = info[i]!;
        box.appendChild(row);
      }
    } else {
      const lines = this.hoverReadout
        ? this.hoverReadout(x, y)
        : [
            { label: "x", value: (this.axisX.config.format ?? defaultFormat)(x) },
            { label: "y", value: (ya.axis.config.format ?? defaultFormat)(y) },
          ];
      for (const ln of lines) {
        const row = document.createElement("div");
        row.textContent = `${ln.label} ${ln.value}`;
        box.appendChild(row);
      }
    }
    box.style.display = "block";
    const cw = this.container.clientWidth;
    const tw = box.offsetWidth;
    const th = box.offsetHeight;
    let left = px + 12;
    if (left + tw > cw) left = px - tw - 12;
    let top = py + 12;
    if (top + th > this.container.clientHeight) top = py - th - 12;
    box.style.left = `${Math.max(0, left)}px`;
    box.style.top = `${Math.max(0, top)}px`;
  }

  /** Data-space x extent across all layers, or null if empty. */
  private layerBoundsX(): Range | null {
    let lo = Infinity;
    let hi = -Infinity;
    let any = false;
    for (const l of this.layers) {
      const b = l.bounds();
      if (!b) continue;
      any = true;
      lo = Math.min(lo, b.x[0]);
      hi = Math.max(hi, b.x[1]);
    }
    return any ? [lo, hi] : null;
  }

  /** Data-space y extent across the layers bound to axis `id`, or null. */
  private layerBoundsY(id: string): Range | null {
    let lo = Infinity;
    let hi = -Infinity;
    let any = false;
    for (const l of this.layers) {
      if (l.yAxis !== id) continue;
      const b = l.bounds();
      if (!b) continue;
      any = true;
      lo = Math.min(lo, b.y[0]);
      hi = Math.max(hi, b.y[1]);
    }
    return any ? [lo, hi] : null;
  }

  /** Keep the view inside the data bounds (used when `boundedPan`). */
  private clampView(): void {
    if (!this.scaleX.log) {
      const bx = this.layerBoundsX();
      if (bx) this.scaleX.domain = clampAxis(this.scaleX.domain, bx);
    }
    for (const ya of this.yAxes.values()) {
      if (ya.scale.log) continue;
      const by = this.layerBoundsY(ya.id);
      if (by) ya.scale.domain = clampAxis(ya.scale.domain, by);
    }
  }

  /**
   * Expand the looser axis so both axes share the same data-units-per-pixel,
   * preventing distortion (maps set `equalAspect`). Linear axes only; balances
   * the primary y against x, and is idempotent once balanced.
   */
  private applyAspect(region: ReturnType<typeof plotRegion>): void {
    if (this.scaleX.log) return;
    const primary = this.primaryY();
    if (primary.scale.log) return;
    const w = region.width;
    const h = region.height;
    if (w <= 0 || h <= 0) return;
    const [xlo, xhi] = this.scaleX.domain;
    const [ylo, yhi] = primary.scale.domain;
    const uppX = (xhi - xlo) / w;
    const uppY = (yhi - ylo) / h;
    if (uppX <= 0 || uppY <= 0) return;
    if (Math.abs(uppX - uppY) <= 1e-9 * Math.max(uppX, uppY)) return; // already balanced
    if (uppX > uppY) {
      const target = uppX * h;
      const cy = (ylo + yhi) / 2;
      primary.scale.domain = [cy - target / 2, cy + target / 2];
    } else {
      const target = uppY * w;
      const cx = (xlo + xhi) / 2;
      this.scaleX.domain = [cx - target / 2, cx + target / 2];
    }
  }

  private drawSelection(x0: number, y0: number, x1: number, y1: number): void {
    const region = plotRegion(this.layout());
    const lock = this.axisLock();
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    let left: number, width: number, top: number, height: number;
    if (lock.x) {
      const a = clamp(x0, region.left, region.left + region.width);
      const b = clamp(x1, region.left, region.left + region.width);
      left = Math.min(a, b);
      width = Math.abs(a - b);
    } else {
      left = region.left;
      width = region.width;
    }
    if (lock.y) {
      const a = clamp(y0, region.top, region.top + region.height);
      const b = clamp(y1, region.top, region.top + region.height);
      top = Math.min(a, b);
      height = Math.abs(a - b);
    } else {
      top = region.top;
      height = region.height;
    }

    Object.assign(this.selectionDiv.style, {
      display: "block",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  private applySelection(x0: number, y0: number, x1: number, y1: number): void {
    const region = plotRegion(this.layout());
    const lock = this.axisLock();
    const dxPx = Math.abs(x1 - x0);
    const dyPx = Math.abs(y1 - y0);
    // Ignore tiny drags (treat as a click) in whichever dimensions are active.
    if (lock.x && lock.y) {
      if (dxPx < 5 && dyPx < 5) return;
    } else if (lock.x && dxPx < 5) return;
    else if (lock.y && dyPx < 5) return;

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    if (lock.x) {
      const nA = clamp01((Math.min(x0, x1) - region.left) / region.width);
      const nB = clamp01((Math.max(x0, x1) - region.left) / region.width);
      const a = this.scaleX.invert(nA);
      const b = this.scaleX.invert(nB);
      this.scaleX.domain = [Math.min(a, b), Math.max(a, b)];
      this.autoX = false;
    }
    if (lock.y) {
      const nTop = clamp01(1 - (Math.min(y0, y1) - region.top) / region.height);
      const nBot = clamp01(1 - (Math.max(y0, y1) - region.top) / region.height);
      for (const ya of this.yAxes.values()) {
        const a = ya.scale.invert(nTop);
        const b = ya.scale.invert(nBot);
        ya.scale.domain = [Math.min(a, b), Math.max(a, b)];
        ya.auto = false;
      }
    }
    this.requestRender();
  }

  private zoomAround(nx: number, ny: number, factor: number): void {
    const lock = this.axisLock();
    // Zoom about the cursor in transformed space (log-safe; see panX/panY).
    if (lock.x) {
      const t = nx * (1 - factor);
      this.scaleX.domain = [this.scaleX.invert(t), this.scaleX.invert(t + factor)];
      this.autoX = false;
    }
    if (lock.y) {
      const t = ny * (1 - factor);
      for (const ya of this.yAxes.values()) {
        ya.scale.domain = [ya.scale.invert(t), ya.scale.invert(t + factor)];
        ya.auto = false;
      }
    }
    this.requestRender();
  }
}

export { LinearScale };

/**
 * Link the x-axis (pan / zoom) and hover crosshair of several plots so they move
 * together — the standard multi-pane financial layout (price on top, volume /
 * RSI / MACD below, all sharing one time axis). The plots should share the same
 * x-scale semantics (e.g. all `ordinal-time` over the same bars).
 *
 * ```ts
 * const detach = linkX([pricePlot, volumePlot, rsiPlot]);
 * // …later: detach();
 * ```
 *
 * @returns a function that unlinks them again.
 */
export function linkX(plots: Plot[]): () => void {
  let applying = false;
  const unsubs: Array<() => void> = [];
  for (const p of plots) {
    unsubs.push(
      p.onViewChange((x) => {
        if (applying) return;
        applying = true;
        for (const q of plots) if (q !== p) q.setView({ x });
        applying = false;
      }),
    );
    unsubs.push(
      p.onCursorMove((cx) => {
        for (const q of plots) if (q !== p) q.setLinkedCursor(cx);
      }),
    );
  }
  return () => { for (const u of unsubs) u(); };
}
