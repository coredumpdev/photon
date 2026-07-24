import {
  AreaLayer,
  BarLayer,
  BoxLayer,
  CandlestickLayer,
  ContourLayer,
  ErrorBarLayer,
  GraphLayer,
  HeatmapLayer,
  HexbinLayer,
  ImageLayer,
  LineLayer,
  OhlcLayer,
  PatchesLayer,
  PieLayer,
  Plot as CorePlot,
  Plot3D as CorePlot3D,
  PolarPlot as CorePolarPlot,
  QuiverLayer,
  ScatterLayer,
  StemLayer,
  addBollinger,
  addDepth,
  addHeikinAshi,
  addRenko,
  addVolumeProfile,
  type AreaOptions,
  type BarOptions,
  type BollingerHandle,
  type BollingerOptions,
  type DepthHandle,
  type DepthOptions,
  type HeikinAshiOptions,
  type RenkoOptions,
  type VolumeProfileOptions,
  type BoxOptions,
  type CandlestickOptions,
  type ContourOptions,
  type ErrorBarOptions,
  type HeatmapOptions,
  type HexbinOptions,
  type Annotation as AnnotationSpec,
  type Bar3DLayer,
  type Bar3DOptions,
  type Contour3DLayer,
  type Contour3DOptions,
  type GraphInput,
  type IsosurfaceLayer,
  type IsosurfaceOptions,
  type ImageOptions,
  type Line3DLayer,
  type Line3DOptions,
  type LineOptions,
  type OhlcOptions,
  type Quiver3DLayer,
  type Quiver3DOptions,
  type VolumeLayer,
  type VolumeOptions,
  type PatchesOptions,
  type PieOptions,
  type Plot3DOptions,
  type PlotOptions,
  type PointCloudLayer,
  type PointCloudOptions,
  type PolarLineOptions,
  type PolarOptions,
  type PolarScatterOptions,
  type PolarSeries,
  type QuiverOptions,
  type ScatterOptions,
  type StemOptions,
  type SurfaceLayer,
  type SurfaceOptions,
  type YAxisOptions,
} from "@photonviz/core";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

const PlotContext = createContext<CorePlot | null>(null);

/** Imperative escape hatch: get a ref + the underlying core Plot instance. */
export function usePlot(options?: PlotOptions): [RefObject<HTMLDivElement>, CorePlot | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState<CorePlot | null>(null);
  const optsRef = useRef(options);
  useEffect(() => {
    if (!ref.current) return;
    const p = new CorePlot(ref.current, optsRef.current);
    setPlot(p);
    return () => p.destroy();
  }, []);
  return [ref, plot];
}

export interface PlotProps {
  options?: PlotOptions;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Container component. Children (Line, Scatter, …) register once it mounts. */
export function Plot({ options, className, style, children }: PlotProps) {
  const [ref, plot] = usePlot(options);
  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <PlotContext.Provider value={plot}>{plot ? children : null}</PlotContext.Provider>
    </div>
  );
}

export type LineProps = LineOptions;

export function Line({ x, y, color, width, name, yAxis, step, join, miterLimit, decimate, renderType }: LineProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<LineLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addLine({ x, y, color, width, name, yAxis, step, join, miterLimit, decimate, renderType });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // Structural props → recreate the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, width, name, yAxis, step, join, miterLimit, decimate, renderType]);
  useEffect(() => {
    if (layer.current && plot) {
      layer.current.setData(x, y);
      plot.render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);
  return null;
}

export type ScatterProps = ScatterOptions;

export function Scatter({ x, y, color, size, marker, name, yAxis, colorBy, renderType }: ScatterProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<ScatterLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addScatter({ x, y, color, size, marker, name, yAxis, colorBy, renderType });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, size, marker, name, yAxis, colorBy, renderType]);
  useEffect(() => {
    if (layer.current && plot) {
      layer.current.setData(x, y);
      plot.render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);
  return null;
}

export type BarProps = BarOptions;

export function Bar({ x, y, base, width, offset, orientation, color, colors, name, yAxis, renderType }: BarProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<BarLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addBar({ x, y, base, width, offset, orientation, color, colors, name, yAxis, renderType });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, width, offset, orientation, color, colors, name, yAxis, renderType]);
  useEffect(() => {
    if (layer.current && plot) {
      layer.current.setData(x, y, base);
      plot.render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, base]);
  return null;
}

export type AreaProps = AreaOptions;

export function Area({ x, y, base, color, name, yAxis, renderType }: AreaProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<AreaLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addArea({ x, y, base, color, name, yAxis, renderType });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, name, yAxis, renderType]);
  useEffect(() => {
    if (layer.current && plot) {
      layer.current.setData(x, y, base);
      plot.render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, base]);
  return null;
}

export interface YAxisProps extends YAxisOptions {
  id: string;
}

/** Register an additional Y axis. (Core has no live removal, so it persists.) */
export function YAxis({ id, ...opts }: YAxisProps) {
  const plot = useContext(PlotContext);
  useEffect(() => {
    if (!plot) return;
    // Guard against React StrictMode's double-invoke (and re-adds): the axis is
    // removed on cleanup, so a remount re-adds it cleanly instead of throwing.
    if (!plot.hasYAxis(id)) plot.addYAxis(id, opts);
    return () => plot.removeYAxis(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, id]);
  return null;
}

// ---------------------------------------------------------------------------
// Static Cartesian layers
//
// Unlike Line/Scatter/Bar/Area these have no `setData` — they are rebuilt from
// scratch whenever their (structural) props change. Each keeps the file's
// add-in-effect / removeLayer-on-cleanup pattern, but with no data effect.
// ---------------------------------------------------------------------------

export type HeatmapProps = HeatmapOptions;

/** A colormapped image of a row-major value grid. Static (rebuilt on change). */
export function Heatmap(props: HeatmapProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<HeatmapLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addHeatmap(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.cols, props.rows, props.extent, props.colormap, props.domain, props.smooth, props.yAxis]);
  return null;
}

export type BoxProps = BoxOptions;

/** Tukey box-and-whisker / violin groups. Static (rebuilt on change). */
export function Box(props: BoxProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<BoxLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addBox(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.groups, props.width, props.box, props.violin, props.yAxis]);
  return null;
}

export type HexbinProps = HexbinOptions;

/** Hexagonal binning of a point cloud, colored by count. Static. */
export function Hexbin(props: HexbinProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<HexbinLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addHexbin(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.radius, props.colormap, props.domain, props.yAxis]);
  return null;
}

export type ContourProps = ContourOptions;

/** Iso-line contours over a row-major value grid. Static. */
export function Contour(props: ContourProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<ContourLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addContour(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.cols, props.rows, props.extent, props.levels, props.color, props.colormap, props.yAxis]);
  return null;
}

export type ErrorBarProps = ErrorBarOptions;

/** Error bars (whiskers/caps and/or a shaded band). Static. */
export function ErrorBar(props: ErrorBarProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<ErrorBarLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addErrorBar(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plot,
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
  ]);
  return null;
}

export type StemProps = StemOptions;

/** Lollipop / stem plot. Static. */
export function Stem(props: StemProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<StemLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addStem(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.baseline, props.color, props.width, props.markerSize, props.name, props.yAxis]);
  return null;
}

export type QuiverProps = QuiverOptions;

/** Arrow / vector field. Static. */
export function Quiver(props: QuiverProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<QuiverLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addQuiver(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plot,
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
  ]);
  return null;
}

export type CandlestickProps = CandlestickOptions;

/** OHLC candlestick chart. Static. */
export function Candlestick(props: CandlestickProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<CandlestickLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addCandlestick(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plot,
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
  ]);
  return null;
}

export type OhlcProps = OhlcOptions;

/** OHLC bar chart. Static. */
export function Ohlc(props: OhlcProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<OhlcLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addOhlc(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plot,
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
  ]);
  return null;
}

export type PieProps = PieOptions;

/** A pie / donut chart. Set `equalAspect` on the Plot so it stays circular. Static. */
export function Pie(props: PieProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<PieLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addPie(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.colors, props.colormap, props.center, props.radius, props.innerRadius, props.startAngle, props.name, props.yAxis]);
  return null;
}

export type PatchesProps = PatchesOptions;

/** Filled polygons (choropleth-capable), triangulated with earcut. Static. */
export function Patches(props: PatchesProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<PatchesLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addPatches(props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.patches, props.color, props.colormap, props.domain, props.opacity, props.name, props.yAxis]);
  return null;
}

export type ImageProps = ImageOptions;

/** An RGBA image / URL over a data-space extent. Static (rebuilt on change). */
export function Image(props: ImageProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<ImageLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addImage(props);
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.source, props.extent, props.smooth, props.opacity, props.name, props.yAxis]);
  return null;
}

export type GraphProps = GraphInput;

/** A node-link graph (auto force-layout when positions are omitted). Static. */
export function Graph(props: GraphProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<GraphLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addGraph(props);
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.edges, props.nodes, props.nodeColor, props.edgeColor, props.nodeSize, props.name, props.yAxis]);
  return null;
}

export type AnnotationProps = AnnotationSpec;

/** A span / band / box / label annotation drawn above the data. */
export function Annotation(props: AnnotationProps) {
  const plot = useContext(PlotContext);
  useEffect(() => {
    if (!plot) return;
    return plot.addAnnotation(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, JSON.stringify(props)]);
  return null;
}

// ---------------------------------------------------------------------------
// Finance
//
// Convenience chart builders from the core finance module. Each composes one or
// more existing layers from a transform/indicator, so — like the static layers
// above — they are rebuilt from scratch on any (structural) prop change, and
// every layer they create is removed on cleanup.
// ---------------------------------------------------------------------------

export type HeikinAshiProps = HeikinAshiOptions;

/** Heikin-Ashi candles (smoothed OHLC). Static (rebuilt on change). */
export function HeikinAshi(props: HeikinAshiProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<CandlestickLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = addHeikinAshi(plot, props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    plot,
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
    props.renderType,
  ]);
  return null;
}

export type RenkoProps = RenkoOptions;

/** Renko bricks (wickless candles at successive indices). Static. */
export function Renko(props: RenkoProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<CandlestickLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = addRenko(plot, props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.close, props.brickSize, props.upColor, props.downColor, props.name, props.yAxis, props.renderType]);
  return null;
}

export type VolumeProfileProps = VolumeProfileOptions;

/** Volume-by-price histogram (horizontal bars). Static. */
export function VolumeProfile(props: VolumeProfileProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<BarLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = addVolumeProfile(plot, props);
    layer.current = l;
    plot.render();
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.price, props.volume, props.bins, props.color, props.pocColor, props.name, props.yAxis, props.renderType]);
  return null;
}

export type BollingerProps = BollingerOptions;

/** Bollinger Bands: an optional shaded band plus upper/middle/lower lines. Static. */
export function Bollinger(props: BollingerProps) {
  const plot = useContext(PlotContext);
  const handle = useRef<BollingerHandle | null>(null);
  useEffect(() => {
    if (!plot) return;
    const h = addBollinger(plot, props);
    handle.current = h;
    plot.render();
    return () => {
      if (h.band) plot.removeLayer(h.band);
      plot.removeLayer(h.upper);
      plot.removeLayer(h.middle);
      plot.removeLayer(h.lower);
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.close, props.period, props.k, props.color, props.bandColor, props.width, props.yAxis, props.renderType]);
  return null;
}

export type DepthProps = DepthOptions;

/** Order-book depth: cumulative bid/ask volume as two filled areas. Static. */
export function Depth(props: DepthProps) {
  const plot = useContext(PlotContext);
  const handle = useRef<DepthHandle | null>(null);
  useEffect(() => {
    if (!plot) return;
    const h = addDepth(plot, props);
    handle.current = h;
    plot.render();
    return () => {
      plot.removeLayer(h.bid);
      plot.removeLayer(h.ask);
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.bids, props.asks, props.bidColor, props.askColor, props.yAxis, props.renderType]);
  return null;
}

// ---------------------------------------------------------------------------
// Polar plot
//
// A separate core class with its own container + context. `PolarPlot` has no
// `removeLayer`, so child cleanup is a no-op (the series lives until the plot
// is destroyed).
// ---------------------------------------------------------------------------

const PolarContext = createContext<CorePolarPlot | null>(null);

/** Imperative escape hatch: get a ref + the underlying core PolarPlot. */
export function usePolarPlot(options?: PolarOptions): [RefObject<HTMLDivElement>, CorePolarPlot | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState<CorePolarPlot | null>(null);
  const optsRef = useRef(options);
  useEffect(() => {
    if (!ref.current) return;
    const p = new CorePolarPlot(ref.current, optsRef.current);
    setPlot(p);
    return () => p.destroy();
  }, []);
  return [ref, plot];
}

export interface PolarPlotProps {
  options?: PolarOptions;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Container for a polar (θ, r) plot. Children (PolarLine, PolarScatter) register once it mounts. */
export function PolarPlot({ options, className, style, children }: PolarPlotProps) {
  const [ref, plot] = usePolarPlot(options);
  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <PolarContext.Provider value={plot}>{plot ? children : null}</PolarContext.Provider>
    </div>
  );
}

export type PolarLineProps = PolarLineOptions;

/** A polar line series. Streams via `PolarSeries.setData(theta, r)`. */
export function PolarLine({ theta, r, color, width, closed }: PolarLineProps) {
  const plot = useContext(PolarContext);
  const series = useRef<PolarSeries | null>(null);
  useEffect(() => {
    if (!plot) return;
    series.current = plot.addLine({ theta, r, color, width, closed });
    // PolarPlot has no removeLayer → nothing to clean up (series persists).
    return () => {
      series.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, width, closed]);
  useEffect(() => {
    series.current?.setData(theta, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theta, r]);
  return null;
}

export type PolarScatterProps = PolarScatterOptions;

/** A polar scatter series. Streams via `PolarSeries.setData(theta, r)`. */
export function PolarScatter({ theta, r, color, size, labels }: PolarScatterProps) {
  const plot = useContext(PolarContext);
  const series = useRef<PolarSeries | null>(null);
  useEffect(() => {
    if (!plot) return;
    series.current = plot.addScatter({ theta, r, color, size, labels });
    // PolarPlot has no removeLayer → nothing to clean up (series persists).
    return () => {
      series.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, size, labels]);
  useEffect(() => {
    series.current?.setData(theta, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theta, r]);
  return null;
}

// ---------------------------------------------------------------------------
// 3D plot
//
// A separate core class with its own container + context. `Plot3D` has no
// layer-removal API, so child cleanup is a no-op (layers live until the plot
// is destroyed).
// ---------------------------------------------------------------------------

const Plot3DContext = createContext<CorePlot3D | null>(null);

/** Imperative escape hatch: get a ref + the underlying core Plot3D. */
export function usePlot3D(options?: Plot3DOptions): [RefObject<HTMLDivElement>, CorePlot3D | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState<CorePlot3D | null>(null);
  const optsRef = useRef(options);
  useEffect(() => {
    if (!ref.current) return;
    const p = new CorePlot3D(ref.current, optsRef.current);
    setPlot(p);
    return () => p.destroy();
  }, []);
  return [ref, plot];
}

export interface Plot3DProps {
  options?: Plot3DOptions;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Container for a 3D plot with an orbit camera. Children (Surface, PointCloud) register once it mounts. */
export function Plot3D({ options, className, style, children }: Plot3DProps) {
  const [ref, plot] = usePlot3D(options);
  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <Plot3DContext.Provider value={plot}>{plot ? children : null}</Plot3DContext.Provider>
    </div>
  );
}

export type SurfaceProps = SurfaceOptions;

/** A 3D height-field surface. Static — Plot3D has no removal API (no-op cleanup). */
export function Surface(props: SurfaceProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<SurfaceLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    layer.current = plot.addSurface(props);
    // Plot3D has no layer removal → nothing to clean up (layer persists).
    return () => {
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.cols, props.rows, props.extentX, props.extentZ, props.colormap]);
  return null;
}

export type PointCloudProps = PointCloudOptions;

/** A 3D point cloud. Static — Plot3D has no removal API (no-op cleanup). */
export function PointCloud(props: PointCloudProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<PointCloudLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addPointCloud(props);
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.z, props.color, props.size, props.sizes, props.colorBy, props.labels, props.name]);
  return null;
}

export type Line3DProps = Line3DOptions;

/** A 3D polyline / path. Static — Plot3D has no removal API (no-op cleanup). */
export function Line3D(props: Line3DProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<Line3DLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    layer.current = plot.addLine3D(props);
    return () => {
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.z, props.color, props.name]);
  return null;
}

export type Bar3DProps = Bar3DOptions;

/** 3D bars on an x/z grid. Static — Plot3D has no removal API (no-op cleanup). */
export function Bar3D(props: Bar3DProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<Bar3DLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    layer.current = plot.addBar3D(props);
    return () => {
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.z, props.width, props.color, props.colorBy, props.name]);
  return null;
}

export type Quiver3DProps = Quiver3DOptions;

/** A 3D vector field. Static — Plot3D has no removal API (no-op cleanup). */
export function Quiver3D(props: Quiver3DProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<Quiver3DLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    layer.current = plot.addQuiver3D(props);
    return () => {
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.z, props.u, props.v, props.w, props.scale, props.color, props.colorBy, props.headSize, props.name]);
  return null;
}

export type Contour3DProps = Contour3DOptions;

/** 3D iso-height contour lines. Static — Plot3D has no removal API (no-op cleanup). */
export function Contour3D(props: Contour3DProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<Contour3DLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    layer.current = plot.addContour3D(props);
    return () => {
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.cols, props.rows, props.extentX, props.extentZ, props.levels, props.color, props.colormap, props.name]);
  return null;
}

export type IsosurfaceProps = IsosurfaceOptions;

/** A marching-cubes isosurface of a 3D scalar volume. Static. */
export function Isosurface(props: IsosurfaceProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<IsosurfaceLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addIsosurface(props);
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.dims, props.isoLevel, props.extent, props.color, props.opacity, props.name]);
  return null;
}

export type VolumeProps = VolumeOptions;

/** Direct volume rendering (GPU raymarch) of a 3D scalar field. Static. */
export function Volume(props: VolumeProps) {
  const plot = useContext(Plot3DContext);
  const layer = useRef<VolumeLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addVolume(props);
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.values, props.dims, props.extent, props.colormap, props.domain, props.density, props.name]);
  return null;
}

// ---------------------------------------------------------------------------
// Finance math re-exports
//
// The pure indicator/transform functions (and their result types) from
// `@photonviz/core`, re-exported so React users can compute indicators without
// a second import.
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
  BollingerBands,
  Macd,
  Ohlc as OhlcData,
  OhlcArrays,
  OhlcInput,
  Brick,
  PfColumn,
  VolumeProfile as VolumeProfileResult,
  DepthCurves,
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
