import {
  AreaLayer,
  BarLayer,
  LineLayer,
  Plot as CorePlot,
  ScatterLayer,
  type AreaOptions,
  type BarOptions,
  type LineOptions,
  type PlotOptions,
  type ScatterOptions,
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
