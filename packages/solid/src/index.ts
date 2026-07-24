import {
  BoxLayer,
  CandlestickLayer,
  ContourLayer,
  ErrorBarLayer,
  HeatmapLayer,
  HexbinLayer,
  OhlcLayer,
  Plot as CorePlot,
  Plot3D as CorePlot3D,
  PolarPlot as CorePolarPlot,
  QuiverLayer,
  StemLayer,
  addHeikinAshi,
  addRenko,
  addVolumeProfile,
  addBollinger,
  addDepth,
  type HeikinAshiOptions,
  type RenkoOptions,
  type VolumeProfileOptions,
  type BollingerOptions,
  type DepthOptions,
  type AreaOptions,
  type BarOptions,
  type BoxOptions,
  type CandlestickOptions,
  type ContourOptions,
  type ErrorBarOptions,
  type HeatmapOptions,
  type HexbinOptions,
  type Layer,
  type Annotation as AnnotationSpec,
  type Bar3DOptions,
  type Contour3DOptions,
  type GraphInput,
  type ImageOptions,
  type IsosurfaceOptions,
  type Line3DOptions,
  type LineOptions,
  type OhlcOptions,
  type PatchesOptions,
  type Quiver3DOptions,
  type VolumeOptions,
  type PieOptions,
  type Plot3DOptions,
  type PlotOptions,
  type PointCloudOptions,
  type PolarLineOptions,
  type PolarOptions,
  type PolarScatterOptions,
  type PolarSeries,
  type QuiverOptions,
  type ScatterOptions,
  type StemOptions,
  type SurfaceOptions,
  type YAxisOptions,
} from "@photonviz/core";
import {
  createComponent,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

// ---------------------------------------------------------------------------
// Reconcile helpers
//
// Solid is fine-grained, so instead of React's effect+deps-array we use `on()`
// with an explicit tracked-props function. Two shapes:
//   • static  — recreate the layer whenever any prop changes.
//   • stream  — recreate on *structural* props; re-upload via setData on *data*
//               props (no teardown), matching the core streaming path.
// The plot accessor is always tracked so a layer registers as soon as its
// container's core Plot exists.
// ---------------------------------------------------------------------------

function bindStatic<L extends Layer>(
  plot: Accessor<CorePlot | null>,
  track: () => readonly unknown[],
  make: (p: CorePlot) => L,
): void {
  createEffect(
    on(
      () => [plot(), ...track()],
      () => {
        const p = plot();
        if (!p) return;
        const l = make(p);
        p.render();
        onCleanup(() => p.removeLayer(l));
      },
    ),
  );
}

function bindStreaming<L extends Layer>(
  plot: Accessor<CorePlot | null>,
  structural: () => readonly unknown[],
  make: (p: CorePlot) => L,
  data: () => readonly unknown[],
  stream: (l: L) => void,
): void {
  let layer: L | null = null;
  createEffect(
    on(
      () => [plot(), ...structural()],
      () => {
        const p = plot();
        if (!p) return;
        const l = make(p);
        layer = l;
        onCleanup(() => {
          p.removeLayer(l);
          layer = null;
        });
      },
    ),
  );
  createEffect(
    on(data, () => {
      const p = plot();
      if (layer && p) {
        stream(layer);
        p.render();
      }
    }),
  );
}

function makeContainer(style?: JSX.CSSProperties, cls?: string): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, { position: "relative", width: "100%", height: "100%" });
  if (cls) el.className = cls;
  if (style) for (const k in style) (el.style as unknown as Record<string, unknown>)[k] = style[k as keyof JSX.CSSProperties];
  return el;
}

// ---------------------------------------------------------------------------
// Cartesian plot
// ---------------------------------------------------------------------------

const PlotContext = createContext<Accessor<CorePlot | null>>(() => null);

/** Read the enclosing {@link Plot}'s core instance (an accessor; null until mounted). */
export function usePlot(): Accessor<CorePlot | null> {
  return useContext(PlotContext);
}

export interface PlotProps {
  options?: PlotOptions;
  class?: string;
  style?: JSX.CSSProperties;
  /** Called once with the core `Plot` when it is created. */
  onReady?: (plot: CorePlot) => void;
  children?: JSX.Element;
}

/** Container component. Children (Line, Scatter, …) register once it mounts. */
export function Plot(props: PlotProps): JSX.Element {
  const container = makeContainer(props.style, props.class);
  const [plot, setPlot] = createSignal<CorePlot | null>(null);
  onMount(() => {
    const p = new CorePlot(container, props.options);
    setPlot(p);
    props.onReady?.(p);
  });
  onCleanup(() => plot()?.destroy());
  return [
    container,
    createComponent(PlotContext.Provider, {
      value: plot,
      get children() {
        return props.children;
      },
    }),
  ] as unknown as JSX.Element;
}

export type LineProps = LineOptions;

/** A line series. Streams via `LineLayer.setData(x, y)`. */
export function Line(props: LineProps): JSX.Element {
  const plot = usePlot();
  bindStreaming(
    plot,
    () => [props.color, props.width, props.name, props.yAxis, props.step, props.join, props.miterLimit, props.decimate, props.renderType],
    (p) =>
      p.addLine({
        x: props.x,
        y: props.y,
        color: props.color,
        width: props.width,
        name: props.name,
        yAxis: props.yAxis,
        step: props.step,
        join: props.join,
        miterLimit: props.miterLimit,
        decimate: props.decimate,
        renderType: props.renderType,
      }),
    () => [props.x, props.y],
    (l) => l.setData(props.x, props.y),
  );
  return null;
}

export type ScatterProps = ScatterOptions;

/** A scatter series. Streams via `ScatterLayer.setData(x, y)`. */
export function Scatter(props: ScatterProps): JSX.Element {
  const plot = usePlot();
  bindStreaming(
    plot,
    () => [props.color, props.size, props.marker, props.name, props.yAxis, props.colorBy, props.renderType],
    (p) =>
      p.addScatter({
        x: props.x,
        y: props.y,
        color: props.color,
        size: props.size,
        marker: props.marker,
        name: props.name,
        yAxis: props.yAxis,
        colorBy: props.colorBy,
        renderType: props.renderType,
      }),
    () => [props.x, props.y],
    (l) => l.setData(props.x, props.y),
  );
  return null;
}

export type BarProps = BarOptions;

/** A bar series. Streams via `BarLayer.setData(x, y, base)`. */
export function Bar(props: BarProps): JSX.Element {
  const plot = usePlot();
  bindStreaming(
    plot,
    () => [props.width, props.offset, props.orientation, props.color, props.colors, props.name, props.yAxis, props.renderType],
    (p) =>
      p.addBar({
        x: props.x,
        y: props.y,
        base: props.base,
        width: props.width,
        offset: props.offset,
        orientation: props.orientation,
        color: props.color,
        colors: props.colors,
        name: props.name,
        yAxis: props.yAxis,
        renderType: props.renderType,
      }),
    () => [props.x, props.y, props.base],
    (l) => l.setData(props.x, props.y, props.base),
  );
  return null;
}

export type AreaProps = AreaOptions;

/** An area (filled) series. Streams via `AreaLayer.setData(x, y, base)`. */
export function Area(props: AreaProps): JSX.Element {
  const plot = usePlot();
  bindStreaming(
    plot,
    () => [props.color, props.name, props.yAxis, props.renderType],
    (p) =>
      p.addArea({
        x: props.x,
        y: props.y,
        base: props.base,
        color: props.color,
        name: props.name,
        yAxis: props.yAxis,
        renderType: props.renderType,
      }),
    () => [props.x, props.y, props.base],
    (l) => l.setData(props.x, props.y, props.base),
  );
  return null;
}

export interface YAxisProps extends YAxisOptions {
  id: string;
}

/** Register an additional Y axis. (Core has no live removal, so it persists.) */
export function YAxis(props: YAxisProps): JSX.Element {
  const plot = usePlot();
  createEffect(
    on(
      () => [plot(), props.id],
      () => {
        const p = plot();
        if (!p) return;
        const { id, ...opts } = props;
        p.addYAxis(id, opts);
      },
    ),
  );
  return null;
}

// ---------------------------------------------------------------------------
// Static Cartesian layers
//
// Unlike Line/Scatter/Bar/Area these have no `setData` — they are rebuilt from
// scratch whenever their (structural) props change.
// ---------------------------------------------------------------------------

export type HeatmapProps = HeatmapOptions;

/** A colormapped image of a row-major value grid. Static (rebuilt on change). */
export function Heatmap(props: HeatmapProps): JSX.Element {
  const plot = usePlot();
  bindStatic<HeatmapLayer>(
    plot,
    () => [props.values, props.cols, props.rows, props.extent, props.colormap, props.domain, props.smooth, props.yAxis],
    (p) => p.addHeatmap(props),
  );
  return null;
}

export type BoxProps = BoxOptions;

/** Tukey box-and-whisker / violin groups. Static (rebuilt on change). */
export function Box(props: BoxProps): JSX.Element {
  const plot = usePlot();
  bindStatic<BoxLayer>(
    plot,
    () => [props.groups, props.width, props.box, props.violin, props.yAxis],
    (p) => p.addBox(props),
  );
  return null;
}

export type HexbinProps = HexbinOptions;

/** Hexagonal binning of a point cloud, colored by count. Static. */
export function Hexbin(props: HexbinProps): JSX.Element {
  const plot = usePlot();
  bindStatic<HexbinLayer>(
    plot,
    () => [props.x, props.y, props.radius, props.colormap, props.domain, props.yAxis],
    (p) => p.addHexbin(props),
  );
  return null;
}

export type ContourProps = ContourOptions;

/** Iso-line contours over a row-major value grid. Static. */
export function Contour(props: ContourProps): JSX.Element {
  const plot = usePlot();
  bindStatic<ContourLayer>(
    plot,
    () => [props.values, props.cols, props.rows, props.extent, props.levels, props.color, props.colormap, props.yAxis],
    (p) => p.addContour(props),
  );
  return null;
}

export type ErrorBarProps = ErrorBarOptions;

/** Error bars (whiskers/caps and/or a shaded band). Static. */
export function ErrorBar(props: ErrorBarProps): JSX.Element {
  const plot = usePlot();
  bindStatic<ErrorBarLayer>(
    plot,
    () => [
      props.x,
      props.y,
      props.yerr,
      props.yerrLow,
      props.yerrHigh,
      props.xerr,
      props.color,
      props.width,
      props.capSize,
      props.whiskers,
      props.band,
      props.bandOpacity,
      props.name,
      props.yAxis,
    ],
    (p) => p.addErrorBar(props),
  );
  return null;
}

export type StemProps = StemOptions;

/** Lollipop / stem plot. Static. */
export function Stem(props: StemProps): JSX.Element {
  const plot = usePlot();
  bindStatic<StemLayer>(
    plot,
    () => [props.x, props.y, props.baseline, props.color, props.width, props.markerSize, props.name, props.yAxis],
    (p) => p.addStem(props),
  );
  return null;
}

export type QuiverProps = QuiverOptions;

/** Arrow / vector field. Static. */
export function Quiver(props: QuiverProps): JSX.Element {
  const plot = usePlot();
  bindStatic<QuiverLayer>(
    plot,
    () => [
      props.x,
      props.y,
      props.u,
      props.v,
      props.scale,
      props.color,
      props.width,
      props.headSize,
      props.colorBy,
      props.name,
      props.yAxis,
    ],
    (p) => p.addQuiver(props),
  );
  return null;
}

export type CandlestickProps = CandlestickOptions;

/** OHLC candlestick chart. Static. */
export function Candlestick(props: CandlestickProps): JSX.Element {
  const plot = usePlot();
  bindStatic<CandlestickLayer>(
    plot,
    () => [
      props.x,
      props.open,
      props.high,
      props.low,
      props.close,
      props.width,
      props.upColor,
      props.downColor,
      props.wickWidth,
      props.name,
      props.yAxis,
    ],
    (p) => p.addCandlestick(props),
  );
  return null;
}

export type OhlcProps = OhlcOptions;

/** OHLC bar chart. Static. */
export function Ohlc(props: OhlcProps): JSX.Element {
  const plot = usePlot();
  bindStatic<OhlcLayer>(
    plot,
    () => [
      props.x,
      props.open,
      props.high,
      props.low,
      props.close,
      props.width,
      props.upColor,
      props.downColor,
      props.lineWidth,
      props.name,
      props.yAxis,
    ],
    (p) => p.addOhlc(props),
  );
  return null;
}

export type PieProps = PieOptions;

/** A pie / donut chart. Set the plot's `equalAspect` so it stays circular. Static. */
export function Pie(props: PieProps): JSX.Element {
  const plot = usePlot();
  bindStatic(
    plot,
    () => [
      props.values,
      props.colors,
      props.colormap,
      props.center,
      props.radius,
      props.innerRadius,
      props.startAngle,
      props.name,
      props.yAxis,
    ],
    (p) => p.addPie(props),
  );
  return null;
}

export type PatchesProps = PatchesOptions;

/** Filled polygons (choropleth-capable), triangulated with earcut. Static. */
export function Patches(props: PatchesProps): JSX.Element {
  const plot = usePlot();
  bindStatic(
    plot,
    () => [props.patches, props.color, props.colormap, props.domain, props.opacity, props.name, props.yAxis],
    (p) => p.addPatches(props),
  );
  return null;
}

export type ImageProps = ImageOptions;

/** An RGBA image / URL over a data-space extent. Static. */
export function Image(props: ImageProps): JSX.Element {
  const plot = usePlot();
  bindStatic(
    plot,
    () => [props.source, props.extent, props.smooth, props.opacity, props.name, props.yAxis],
    (p) => p.addImage(props),
  );
  return null;
}

export type GraphProps = GraphInput;

/** A node-link graph (auto force-layout when positions are omitted). Static. */
export function Graph(props: GraphProps): JSX.Element {
  const plot = usePlot();
  bindStatic(
    plot,
    () => [props.x, props.y, props.edges, props.nodes, props.nodeColor, props.edgeColor, props.nodeSize, props.name, props.yAxis],
    (p) => p.addGraph(props),
  );
  return null;
}

export type AnnotationProps = AnnotationSpec;

/** A span / band / box / label annotation drawn above the data. */
export function Annotation(props: AnnotationProps): JSX.Element {
  const plot = usePlot();
  createEffect(
    on(
      () => [plot(), JSON.stringify(props)],
      () => {
        const p = plot();
        if (!p) return;
        onCleanup(p.addAnnotation({ ...props } as AnnotationSpec));
      },
    ),
  );
  return null;
}

// ---------------------------------------------------------------------------
// Finance
//
// HeikinAshi / Renko / VolumeProfile are single-layer, so they mirror
// Candlestick via `bindStatic` with the matching `add*` builder. Bollinger and
// Depth build several layers at once, so each gets a small dedicated binder
// that removes every returned layer on cleanup.
// ---------------------------------------------------------------------------

export type HeikinAshiProps = HeikinAshiOptions;

/** Heikin-Ashi candlesticks (smoothed OHLC). Static. */
export function HeikinAshi(props: HeikinAshiProps): JSX.Element {
  const plot = usePlot();
  bindStatic<CandlestickLayer>(
    plot,
    () => [
      props.x,
      props.open,
      props.high,
      props.low,
      props.close,
      props.upColor,
      props.downColor,
      props.width,
      props.wickWidth,
      props.name,
      props.yAxis,
      props.renderType,
    ],
    (p) => addHeikinAshi(p, props),
  );
  return null;
}

export type RenkoProps = RenkoOptions;

/** Renko bricks from a close series. Static. */
export function Renko(props: RenkoProps): JSX.Element {
  const plot = usePlot();
  bindStatic<CandlestickLayer>(
    plot,
    () => [props.close, props.brickSize, props.upColor, props.downColor, props.name, props.yAxis, props.renderType],
    (p) => addRenko(p, props),
  );
  return null;
}

export type VolumeProfileProps = VolumeProfileOptions;

/** Horizontal volume-by-price histogram with a POC highlight. Static. */
export function VolumeProfile(props: VolumeProfileProps): JSX.Element {
  const plot = usePlot();
  bindStatic(
    plot,
    () => [props.price, props.volume, props.bins, props.color, props.pocColor, props.name, props.yAxis, props.renderType],
    (p) => addVolumeProfile(p, props),
  );
  return null;
}

export type BollingerProps = BollingerOptions;

/** Bollinger bands (upper/middle/lower plus an optional fill band). Static. */
export function Bollinger(props: BollingerProps): JSX.Element {
  const plot = usePlot();
  createEffect(
    on(
      () => [
        plot(),
        props.x,
        props.close,
        props.period,
        props.k,
        props.color,
        props.bandColor,
        props.width,
        props.yAxis,
        props.renderType,
      ],
      () => {
        const p = plot();
        if (!p) return;
        const { band, upper, middle, lower } = addBollinger(p, props);
        p.render();
        onCleanup(() => {
          if (band) p.removeLayer(band);
          p.removeLayer(upper);
          p.removeLayer(middle);
          p.removeLayer(lower);
        });
      },
    ),
  );
  return null;
}

export type DepthProps = DepthOptions;

/** A market-depth chart (cumulative bid/ask area curves). Static. */
export function Depth(props: DepthProps): JSX.Element {
  const plot = usePlot();
  createEffect(
    on(
      () => [plot(), props.bids, props.asks, props.bidColor, props.askColor, props.yAxis, props.renderType],
      () => {
        const p = plot();
        if (!p) return;
        const { bid, ask } = addDepth(p, props);
        p.render();
        onCleanup(() => {
          p.removeLayer(bid);
          p.removeLayer(ask);
        });
      },
    ),
  );
  return null;
}

// ---------------------------------------------------------------------------
// Polar plot
//
// A separate core class with its own container + context. `PolarPlot` has no
// `removeLayer`, so child cleanup is a no-op (the series lives until the plot
// is destroyed).
// ---------------------------------------------------------------------------

const PolarContext = createContext<Accessor<CorePolarPlot | null>>(() => null);

/** Read the enclosing {@link PolarPlot}'s core instance (an accessor). */
export function usePolarPlot(): Accessor<CorePolarPlot | null> {
  return useContext(PolarContext);
}

export interface PolarPlotProps {
  options?: PolarOptions;
  class?: string;
  style?: JSX.CSSProperties;
  onReady?: (plot: CorePolarPlot) => void;
  children?: JSX.Element;
}

/** Container for a polar (θ, r) plot. Children (PolarLine, PolarScatter) register once it mounts. */
export function PolarPlot(props: PolarPlotProps): JSX.Element {
  const container = makeContainer(props.style, props.class);
  const [plot, setPlot] = createSignal<CorePolarPlot | null>(null);
  onMount(() => {
    const p = new CorePolarPlot(container, props.options);
    setPlot(p);
    props.onReady?.(p);
  });
  onCleanup(() => plot()?.destroy());
  return [
    container,
    createComponent(PolarContext.Provider, {
      value: plot,
      get children() {
        return props.children;
      },
    }),
  ] as unknown as JSX.Element;
}

export type PolarLineProps = PolarLineOptions;

/** A polar line series. Streams via `PolarSeries.setData(theta, r)`. */
export function PolarLine(props: PolarLineProps): JSX.Element {
  const plot = usePolarPlot();
  let series: PolarSeries | null = null;
  createEffect(
    on(
      () => [plot(), props.color, props.width, props.closed],
      () => {
        const p = plot();
        if (!p) return;
        series = p.addLine({ theta: props.theta, r: props.r, color: props.color, width: props.width, closed: props.closed });
        // PolarPlot has no removeLayer → nothing to clean up (series persists).
        onCleanup(() => {
          series = null;
        });
      },
    ),
  );
  createEffect(
    on(
      () => [props.theta, props.r],
      () => series?.setData(props.theta, props.r),
    ),
  );
  return null;
}

export type PolarScatterProps = PolarScatterOptions;

/** A polar scatter series. Streams via `PolarSeries.setData(theta, r)`. */
export function PolarScatter(props: PolarScatterProps): JSX.Element {
  const plot = usePolarPlot();
  let series: PolarSeries | null = null;
  createEffect(
    on(
      () => [plot(), props.color, props.size, props.labels],
      () => {
        const p = plot();
        if (!p) return;
        series = p.addScatter({ theta: props.theta, r: props.r, color: props.color, size: props.size, labels: props.labels });
        onCleanup(() => {
          series = null;
        });
      },
    ),
  );
  createEffect(
    on(
      () => [props.theta, props.r],
      () => series?.setData(props.theta, props.r),
    ),
  );
  return null;
}

// ---------------------------------------------------------------------------
// 3D plot
//
// A separate core class with its own container + context. `Plot3D` has no
// layer-removal API, so child cleanup is a no-op (layers live until the plot
// is destroyed).
// ---------------------------------------------------------------------------

const Plot3DContext = createContext<Accessor<CorePlot3D | null>>(() => null);

/** Read the enclosing {@link Plot3D}'s core instance (an accessor). */
export function usePlot3D(): Accessor<CorePlot3D | null> {
  return useContext(Plot3DContext);
}

export interface Plot3DProps {
  options?: Plot3DOptions;
  class?: string;
  style?: JSX.CSSProperties;
  onReady?: (plot: CorePlot3D) => void;
  children?: JSX.Element;
}

/** Container for a 3D plot with an orbit camera. Children (Surface, PointCloud) register once it mounts. */
export function Plot3D(props: Plot3DProps): JSX.Element {
  const container = makeContainer(props.style, props.class);
  const [plot, setPlot] = createSignal<CorePlot3D | null>(null);
  onMount(() => {
    const p = new CorePlot3D(container, props.options);
    setPlot(p);
    props.onReady?.(p);
  });
  onCleanup(() => plot()?.destroy());
  return [
    container,
    createComponent(Plot3DContext.Provider, {
      value: plot,
      get children() {
        return props.children;
      },
    }),
  ] as unknown as JSX.Element;
}

export type SurfaceProps = SurfaceOptions;

/** A 3D height-field surface. Static — Plot3D has no removal API (no-op cleanup). */
export function Surface(props: SurfaceProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.values, props.cols, props.rows, props.extentX, props.extentZ, props.colormap],
      () => {
        const p = plot();
        if (!p) return;
        // Plot3D has no layer removal → nothing to clean up (layer persists).
        p.addSurface(props);
      },
    ),
  );
  return null;
}

export type PointCloudProps = PointCloudOptions;

/** A 3D point cloud. Static — Plot3D has no removal API (no-op cleanup). */
export function PointCloud(props: PointCloudProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.x, props.y, props.z, props.color, props.size, props.sizes, props.colorBy, props.labels, props.name],
      () => {
        const p = plot();
        if (!p) return;
        const l = p.addPointCloud(props);
        onCleanup(() => p.removeLayer(l));
      },
    ),
  );
  return null;
}

export type Line3DProps = Line3DOptions;

/** A 3D polyline / path. Static — Plot3D has no removal API. */
export function Line3D(props: Line3DProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.x, props.y, props.z, props.color, props.name],
      () => {
        const p = plot();
        if (!p) return;
        p.addLine3D(props);
      },
    ),
  );
  return null;
}

export type Bar3DProps = Bar3DOptions;

/** 3D bars on an x/z grid. Static — Plot3D has no removal API. */
export function Bar3D(props: Bar3DProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.x, props.y, props.z, props.width, props.color, props.colorBy, props.name],
      () => {
        const p = plot();
        if (!p) return;
        p.addBar3D(props);
      },
    ),
  );
  return null;
}

export type Quiver3DProps = Quiver3DOptions;

/** A 3D vector field. Static — Plot3D has no removal API. */
export function Quiver3D(props: Quiver3DProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.x, props.y, props.z, props.u, props.v, props.w, props.scale, props.color, props.colorBy, props.headSize, props.name],
      () => {
        const p = plot();
        if (!p) return;
        p.addQuiver3D(props);
      },
    ),
  );
  return null;
}

export type Contour3DProps = Contour3DOptions;

/** 3D iso-height contour lines. Static — Plot3D has no removal API. */
export function Contour3D(props: Contour3DProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.values, props.cols, props.rows, props.extentX, props.extentZ, props.levels, props.color, props.colormap, props.name],
      () => {
        const p = plot();
        if (!p) return;
        p.addContour3D(props);
      },
    ),
  );
  return null;
}

export type IsosurfaceProps = IsosurfaceOptions;

/** A marching-cubes isosurface of a 3D scalar volume. Static. */
export function Isosurface(props: IsosurfaceProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.values, props.dims, props.isoLevel, props.extent, props.color, props.opacity, props.name],
      () => {
        const p = plot();
        if (!p) return;
        const l = p.addIsosurface(props);
        onCleanup(() => p.removeLayer(l));
      },
    ),
  );
  return null;
}

export type VolumeProps = VolumeOptions;

/** Direct volume rendering (GPU raymarch) of a 3D scalar field. Static. */
export function Volume(props: VolumeProps): JSX.Element {
  const plot = usePlot3D();
  createEffect(
    on(
      () => [plot(), props.values, props.dims, props.extent, props.colormap, props.domain, props.density, props.name],
      () => {
        const p = plot();
        if (!p) return;
        const l = p.addVolume(props);
        onCleanup(() => p.removeLayer(l));
      },
    ),
  );
  return null;
}

// ---------------------------------------------------------------------------
// Finance — pure math re-exports
//
// Framework-agnostic indicator/transform helpers, re-exported verbatim from the
// core so consumers can `import { sma, macd, … } from "@photonviz/solid"`.
// ---------------------------------------------------------------------------

export {
  sma,
  ema,
  wma,
  rollingStd,
  bollinger,
  rsi,
  macd,
  vwap,
  trueRange,
  atr,
  firstFinite,
  stochastic,
  keltner,
  obv,
  ichimoku,
  adx,
  superTrend,
  fibRetracements,
  heikinAshi,
  renko,
  lineBreak,
  pointAndFigure,
  volumeProfile,
  depth,
} from "@photonviz/core";
export type {
  HeikinAshiOptions,
  RenkoOptions,
  VolumeProfileOptions,
  BollingerOptions,
  DepthOptions,
} from "@photonviz/core";

// ML / deep-learning: pure metrics + reducers and the Plot builders that render
// them (imperative use on a core Plot, like the finance helpers above).
export {
  confusionMatrix, rocCurve, prCurve, calibrationCurve, emaSmooth,
  pca, standardize, beeswarmLayout, ML_PALETTE,
  addConfusionMatrix, addRocCurve, addPrCurve, addCalibration,
  addEmbedding, addDecisionBoundary, addFeatureImportance, addShapBeeswarm,
  addPartialDependence, addAttentionMap, addTrainingCurves, addRidgeline,
} from "@photonviz/core";
