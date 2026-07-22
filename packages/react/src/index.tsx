import {
  AreaLayer,
  BarLayer,
  BoxLayer,
  CandlestickLayer,
  ContourLayer,
  ErrorBarLayer,
  HeatmapLayer,
  HexbinLayer,
  LineLayer,
  Plot as CorePlot,
  Plot3D as CorePlot3D,
  PolarPlot as CorePolarPlot,
  QuiverLayer,
  ScatterLayer,
  StemLayer,
  type AreaOptions,
  type BarOptions,
  type BoxOptions,
  type CandlestickOptions,
  type ContourOptions,
  type ErrorBarOptions,
  type HeatmapOptions,
  type HexbinOptions,
  type LineOptions,
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
  addGeoJson,
  addMap,
  type GeoJsonLayer,
  type GeoJsonOptions,
  type MapLayer,
  type MapOptions,
} from "@photonviz/map";
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

export function Line({ x, y, color, width, name, yAxis, step, join, miterLimit, decimate }: LineProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<LineLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addLine({ x, y, color, width, name, yAxis, step, join, miterLimit, decimate });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // Structural props → recreate the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, width, name, yAxis, step, join, miterLimit, decimate]);
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

export function Scatter({ x, y, color, size, name, yAxis, colorBy }: ScatterProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<ScatterLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addScatter({ x, y, color, size, name, yAxis, colorBy });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, size, name, yAxis, colorBy]);
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

export function Bar({ x, y, base, width, offset, color, name, yAxis }: BarProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<BarLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addBar({ x, y, base, width, offset, color, name, yAxis });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, width, offset, color, name, yAxis]);
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

export function Area({ x, y, base, color, name, yAxis }: AreaProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<AreaLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = plot.addArea({ x, y, base, color, name, yAxis });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, color, name, yAxis]);
  useEffect(() => {
    if (layer.current && plot) {
      layer.current.setData(x, y, base);
      plot.render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, base]);
  return null;
}

export type MapProps = MapOptions;

/** A Web Mercator vector-tile basemap (from `@photonviz/map`). */
export function Map({ source, style, bbox, maxTiles, yAxis, onUpdate }: MapProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<MapLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = addMap(plot, { source, style, bbox, maxTiles, yAxis, onUpdate });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, source, style, bbox, maxTiles, yAxis]);
  return null;
}

export type GeoJsonProps = GeoJsonOptions;

/** A static vector layer rendered from a GeoJSON FeatureCollection. */
export function GeoJson({ geojson, style, layer: layerName, yAxis }: GeoJsonProps) {
  const plot = useContext(PlotContext);
  const layer = useRef<GeoJsonLayer | null>(null);
  useEffect(() => {
    if (!plot) return;
    const l = addGeoJson(plot, { geojson, style, layer: layerName, yAxis });
    layer.current = l;
    return () => {
      plot.removeLayer(l);
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, geojson, style, layerName, yAxis]);
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
    plot.addYAxis(id, opts);
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
    layer.current = plot.addPointCloud(props);
    // Plot3D has no layer removal → nothing to clean up (layer persists).
    return () => {
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, props.x, props.y, props.z, props.color, props.size, props.colorBy]);
  return null;
}
