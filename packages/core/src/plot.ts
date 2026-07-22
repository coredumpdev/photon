import { Axis } from "./axes/axis.js";
import { defaultFormat } from "./axes/ticks.js";
import { begin2D, getSharedGL, sizeShared } from "./gl/shared.js";
import type { AxisFrame } from "./gl/transform.js";
import { AreaLayer, type AreaOptions } from "./layers/area.js";
import { BarLayer, type BarOptions } from "./layers/bar.js";
import { BoxLayer, type BoxOptions } from "./layers/box.js";
import { CandlestickLayer, type CandlestickOptions } from "./layers/candlestick.js";
import { ContourLayer, type ContourOptions } from "./layers/contour.js";
import { ErrorBarLayer, type ErrorBarOptions } from "./layers/errorbar.js";
import { HeatmapLayer, type HeatmapOptions } from "./layers/heatmap.js";
import { HexbinLayer, type HexbinOptions } from "./layers/hexbin.js";
import type { Layer } from "./layers/layer.js";
import { LineLayer, type LineOptions } from "./layers/line.js";
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
  drawXAxis,
  drawYAxis,
  lightTheme,
  plotRegion,
  pxX,
  pxY,
  type Layout,
  type Theme,
} from "./render/overlay.js";
import type { PickMode } from "./layers/pick.js";
import { LinearScale, makeScale, type Scale, type ScaleType } from "./scales/scale.js";
import { createToolbar } from "./ui/toolbar.js";
import type { AxisConfig, Dim, InteractionMode, Range } from "./types.js";

export interface AxisScaleOptions {
  type?: ScaleType;
  /** Fixed domain. If omitted, the axis autoscales to the data. */
  domain?: Range;
}

export interface YAxisOptions extends AxisConfig {
  type?: ScaleType;
  domain?: Range;
  /** Which side to draw the axis on. Default `"right"` for secondary axes. */
  side?: "left" | "right";
  /** Axis + label color (secondary axes often match their series). */
  color?: string;
}

/** One line of the hover tooltip header, produced by {@link PlotOptions.hoverReadout}. */
export interface HoverReadoutRow {
  label: string;
  value: string;
}

export interface PlotOptions {
  scales?: { x?: AxisScaleOptions; y?: AxisScaleOptions };
  axes?: { x?: AxisConfig; y?: AxisConfig };
  theme?: "light" | "dark" | Theme;
  margin?: Partial<Layout["margin"]>;
  /** Enable wheel-zoom and drag interaction. Default true. */
  interactive?: boolean;
  /** Show the built-in toolbar (home + pan/box/X/Y zoom modes). Default true. */
  showToolbar?: boolean;
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
  private tooltip: HTMLDivElement;
  /** A point clicked to pin its details, until another click clears it. */
  private selected: { layer: Pickable; x: number; y: number; index: number } | null = null;
  private infoBox: HTMLDivElement;

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
    this.scaleX = makeScale(sx.type ?? "linear", sx.domain ?? [0, 1]);
    this.autoX = sx.domain == null;
    this.initialX = sx.domain ?? null;
    this.axisX = new Axis(options.axes?.x);

    // Primary y axis.
    this.yAxes.set("y", {
      id: "y",
      scale: makeScale(sy.type ?? "linear", sy.domain ?? [0, 1]),
      axis: new Axis(options.axes?.y),
      side: "left",
      auto: sy.domain == null,
      initial: sy.domain ?? null,
    });

    this.isDark = options.theme === "dark";
    this.theme =
      options.theme === "dark"
        ? darkTheme
        : options.theme === "light" || options.theme == null
          ? lightTheme
          : options.theme;
    this.baseMargin = { ...DEFAULT_MARGIN, ...options.margin };
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
      top: this.baseMargin.top,
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
    const { type, domain, side, color, ...axisConfig } = opts;
    this.yAxes.set(id, {
      id,
      scale: makeScale(type ?? "linear", domain ?? [0, 1]),
      axis: new Axis(axisConfig),
      side: side ?? "right",
      auto: domain == null,
      initial: domain ?? null,
      color,
    });
    this.autoscale();
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
    this.selectionDiv.remove();
    this.tooltip.remove();
    this.infoBox.remove();
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

  render(): void {
    const layout = this.layout();
    const region = plotRegion(layout);
    if (this.equalAspect) this.applyAspect(region);
    if (this.boundedPan) this.clampView();
    const primary = this.primaryY();
    const ticksX = this.axisX.resolve(this.scaleX);
    const ticksYPrimary = primary.axis.resolve(primary.scale);

    // Grid (behind data): x lines + primary-y lines only, to avoid clutter.
    this.gridCtx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
    drawGrid(this.gridCtx, region, this.scaleX, primary.scale, ticksX, ticksYPrimary, this.theme);

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
    drawXAxis(this.axisCtx, region, this.scaleX, ticksX, this.theme, this.axisX.config.title);

    const positions = this.yAxisPositions();
    for (const ya of this.yAxes.values()) {
      const pos = positions.get(ya.id)!;
      const ticks = ya.axis.resolve(ya.scale);
      drawYAxis(this.axisCtx, region, ya.scale, ticks, this.theme, {
        x: pos.x,
        side: ya.side,
        title: ya.axis.config.title,
        color: ya.color,
        titleX: pos.titleX,
      });
    }

    // Both-axis guide lines while the pointer is pressed.
    if (this.crosshair && this.pressPx) {
      drawCrosshairXY(this.axisCtx, region, this.pressPx.x, this.pressPx.y, this.theme);
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
    this.axisCanvas.style.cursor = this.mode === "pan" ? "grab" : "crosshair";
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
    /** Non-null while dragging an axis strip: `"x"` or a y-axis id. */
    let axisDrag: "x" | { y: string } | null = null;
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    let downX = 0;
    let downY = 0;

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.hoverPx = null;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      downX = px;
      downY = py;
      const zone = this.zoneAt(px, py);

      if (zone.type === "x") {
        axisDrag = "x";
        lastX = e.clientX;
      } else if (zone.type === "y") {
        axisDrag = { y: zone.id };
        lastY = e.clientY;
      } else if (this.mode === "pan") {
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        el.style.cursor = "grabbing";
        if (this.crosshair) this.setPress(px, py);
      } else {
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
      } else if (panning) {
        this.panX(e.clientX - lastX, region);
        this.panY(null, e.clientY - lastY, region);
        lastX = e.clientX;
        lastY = e.clientY;
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
          this.updateCursor();
          if (this.hoverEnabled) this.setHover({ x: px, y: py });
        }
      }
    });

    el.addEventListener("pointerleave", () => this.setHover(null));

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
      } else if (panning) {
        panning = false;
        this.updateCursor();
      } else if (selecting) {
        selecting = false;
        if (!isClick) this.applySelection(startX, startY, upPx, upPy);
        this.selectionDiv.style.display = "none";
      }
      if (isClick) this.handleClick(upPx, upPy);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
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
