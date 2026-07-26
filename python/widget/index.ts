/**
 * The browser half of the `photonviz` Python package.
 *
 * Python sends a declarative spec (plus binary buffers for the arrays) over the
 * anywidget/ipywidgets comm; this module rebuilds it into a real Photon plot.
 * Bundled with `@photonviz/core` into a single ESM file that anywidget loads —
 * so a notebook needs no CDN, no extension install, and works the same in
 * Jupyter Notebook, JupyterLab, VS Code and Google Colab.
 */
import {
  Plot,
  Plot3D,
  PlotGrid,
  PolarPlot,
  addBarbs,
  addTriplot,
  addTripcolor,
  addTricontour,
  addTricontourf,
  addTreemap,
  addFunnel,
  addSunburst,
  addGauge,
  addSankey,
  addChord,
  addParallelCoordinates,
  addDecisionBoundary,
  addPartialDependence,
  addAttentionMap,
  addRidgeline,
  addPredVsActual,
  addResiduals,
  addLiftCurve,
  addLearningCurve,
  addBollinger,
  addCalibration,
  addContourFilled,
  addConfusionMatrix,
  addCorrMatrix,
  addDepth,
  addDrawdown,
  addEcdf,
  addEmbedding,
  addEventPlot,
  addFeatureImportance,
  addHeikinAshi,
  addHist2d,
  addModelGraph,
  addModelGraph3D,
  modelGraphFromKeras,
  modelGraphFromOnnx,
  modelGraphFromSklearn,
  modelGraphFromTorchFx,
  sequentialModel,
  addPcolormesh,
  addPrCurve,
  addPsd,
  addRegression,
  addRenko,
  addRocCurve,
  addShapBeeswarm,
  addStreamplot,
  addTrainingCurves,
  addVolumeProfile,
  type CellPlacement,
  type Plot3DOptions,
  type PlotOptions,
  type PolarOptions,
} from "@photonviz/core";

/** A model, as anywidget hands it to us. */
interface Model {
  get(key: string): unknown;
  on(event: string, cb: () => void): void;
  off(event: string, cb: () => void): void;
}

interface RenderProps {
  model: Model;
  el: HTMLElement;
}

/** Placeholder Python leaves in the spec wherever an array was. */
interface BufferRef {
  $buffer: number;
  dtype: "f8" | "f4" | "i4" | "u1";
}

type Spec = {
  kind?: "plot" | "plot3d" | "polar";
  options?: Record<string, unknown>;
  yAxes?: Array<Record<string, unknown>>;
  series?: Array<Record<string, unknown>>;
  layers?: Array<Record<string, unknown>>;
  annotations?: Array<Record<string, unknown>>;
  labels3d?: Array<Record<string, unknown>>;
};

/** A `pv.subplots(...)` figure: grid geometry plus one placed spec per panel. */
type FigureSpec = {
  kind: "figure";
  rows?: number;
  cols?: number;
  gap?: number;
  title?: string;
  theme?: "light" | "dark";
  background?: string;
  rowRatios?: number[];
  colRatios?: number[];
  linkX?: boolean;
  linkY?: boolean;
  panels?: Array<CellPlacement & Spec>;
};

const VIEWS = {
  f8: Float64Array,
  f4: Float32Array,
  i4: Int32Array,
  u1: Uint8Array,
} as const;

function isBufferRef(v: unknown): v is BufferRef {
  return typeof v === "object" && v !== null && "$buffer" in v && "dtype" in v;
}

/**
 * Replace every `{$buffer, dtype}` marker with a typed-array view over the
 * matching binary buffer. anywidget delivers buffers as `DataView`s.
 */
function hydrate(value: unknown, buffers: DataView[]): unknown {
  if (isBufferRef(value)) {
    const view = buffers[value.$buffer];
    if (!view) return new Float64Array(0);
    const Ctor = VIEWS[value.dtype] ?? Float64Array;
    // The DataView may be a window into a larger ArrayBuffer, so honour its offset.
    return new Ctor(view.buffer, view.byteOffset, view.byteLength / Ctor.BYTES_PER_ELEMENT);
  }
  if (Array.isArray(value)) return value.map((v) => hydrate(v, buffers));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = hydrate(v, buffers);
    return out;
  }
  return value;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/**
 * A model-graph series may carry an already-normalized `graph`, or a raw
 * framework export that one of the core adapters turns into one. Keeping the
 * adapters here means Python only has to dump what the framework already knows.
 */
function resolveGraph(s: Any): Any {
  if (s.graph) return s.graph;
  const src = s.source;
  if (!src) throw new Error("modelGraph needs either `graph` or `source`");
  switch (src.framework) {
    case "graph": return src.graph;
    case "torch-fx": return modelGraphFromTorchFx(src.nodes, { name: src.name });
    case "sequential": return sequentialModel(src.layers, src.name);
    case "keras": return modelGraphFromKeras(src.model, { shapes: src.shapes, params: src.params, name: src.name });
    case "sklearn": return modelGraphFromSklearn(src.step, { name: src.name });
    case "onnx": return modelGraphFromOnnx(src.graph, { shapes: src.shapes, paramCounts: src.paramCounts, name: src.name });
    default: throw new Error(`Unknown model source "${src.framework}"`);
  }
}

/** Add one 2D series. Mirrors the `SeriesSpec` switch in the framework wrappers. */
function addSeries(plot: Plot, s: Any): void {
  switch (s.type) {
    case "line": plot.addLine(s); break;
    case "scatter": plot.addScatter(s); break;
    case "bar": plot.addBar(s); break;
    case "groupedBars": plot.addGroupedBars(s); break;
    case "stackedBars": plot.addStackedBars(s); break;
    case "area": plot.addArea(s); break;
    case "stackedArea": plot.addStackedArea(s); break;
    case "heatmap": plot.addHeatmap(s); break;
    case "histogram": plot.addHistogram(s.values, s); break;
    case "box": plot.addBox(s); break;
    case "hexbin": plot.addHexbin(s); break;
    case "contour": plot.addContour(s); break;
    case "errorbar": plot.addErrorBar(s); break;
    case "stem": plot.addStem(s); break;
    case "quiver": plot.addQuiver(s); break;
    case "candlestick": plot.addCandlestick(s); break;
    case "ohlc": plot.addOhlc(s); break;
    case "pie": plot.addPie(s); break;
    case "patches": plot.addPatches(s); break;
    case "graph": plot.addGraph(s); break;
    case "image": plot.addImage(s); break;
    // Composed builders — same free functions the JS API exposes.
    case "heikinAshi": addHeikinAshi(plot, s); break;
    case "renko": addRenko(plot, s); break;
    case "volumeProfile": addVolumeProfile(plot, s); break;
    case "bollinger": addBollinger(plot, s); break;
    case "depth": addDepth(plot, s); break;
    case "drawdown": addDrawdown(plot, s); break;
    case "confusionMatrix": addConfusionMatrix(plot, s); break;
    case "rocCurve": addRocCurve(plot, s); break;
    case "prCurve": addPrCurve(plot, s); break;
    case "calibration": addCalibration(plot, s); break;
    case "embedding": addEmbedding(plot, s); break;
    case "featureImportance": addFeatureImportance(plot, s); break;
    case "shapBeeswarm": addShapBeeswarm(plot, s); break;
    case "trainingCurves": addTrainingCurves(plot, s); break;
    case "regression": addRegression(plot, s); break;
    case "ecdf": addEcdf(plot, s); break;
    case "corrMatrix": addCorrMatrix(plot, s); break;
    case "psd": addPsd(plot, s); break;
    case "hist2d": addHist2d(plot, s); break;
    case "eventplot": addEventPlot(plot, s); break;
    case "contourf": addContourFilled(plot, s); break;
    case "pcolormesh": addPcolormesh(plot, s); break;
    case "streamplot": addStreamplot(plot, s); break;
    case "barbs": addBarbs(plot, s); break;
    case "triplot": addTriplot(plot, s); break;
    case "tripcolor": addTripcolor(plot, s); break;
    case "tricontour": addTricontour(plot, s); break;
    case "tricontourf": addTricontourf(plot, s); break;
    case "treemap": addTreemap(plot, s); break;
    case "funnel": addFunnel(plot, s); break;
    case "sunburst": addSunburst(plot, s); break;
    case "gauge": addGauge(plot, s); break;
    case "sankey": addSankey(plot, s); break;
    case "chord": addChord(plot, s); break;
    case "parallelCoordinates": addParallelCoordinates(plot, s); break;
    case "decisionBoundary": addDecisionBoundary(plot, s); break;
    case "partialDependence": addPartialDependence(plot, s); break;
    case "attentionMap": addAttentionMap(plot, s); break;
    case "ridgeline": addRidgeline(plot, s); break;
    case "predVsActual": addPredVsActual(plot, s); break;
    case "residuals": addResiduals(plot, s); break;
    case "liftCurve": addLiftCurve(plot, s); break;
    case "learningCurve": addLearningCurve(plot, s); break;
    case "modelGraph": addModelGraph(plot, { ...s, graph: resolveGraph(s) }); break;
    default: throw new Error(`Unknown series type "${s.type}"`);
  }
}

/** Add one 3D layer. */
function addLayer3D(plot: Plot3D, s: Any): void {
  switch (s.type) {
    case "surface": plot.addSurface(s); break;
    case "pointcloud": plot.addPointCloud(s); break;
    case "line3d": plot.addLine3D(s); break;
    case "bar3d": plot.addBar3D(s); break;
    case "boxes3d": plot.addBoxes3D(s); break;
    case "quiver3d": plot.addQuiver3D(s); break;
    case "contour3d": plot.addContour3D(s); break;
    case "isosurface": plot.addIsosurface(s); break;
    case "volume": plot.addVolume(s); break;
    case "modelGraph3d": addModelGraph3D(plot, { ...s, graph: resolveGraph(s) }); break;
    default: throw new Error(`Unknown 3D layer type "${s.type}"`);
  }
}

/** Show a build error inside the output cell rather than failing silently. */
function showError(el: HTMLElement, err: unknown): void {
  const box = document.createElement("pre");
  Object.assign(box.style, {
    margin: "0",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid #ef4444",
    background: "rgba(239,68,68,0.08)",
    color: "#b91c1c",
    font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre-wrap",
  } as CSSStyleDeclaration);
  box.textContent = `photonviz: ${err instanceof Error ? err.message : String(err)}`;
  el.replaceChildren(box);
}

/**
 * Build one chart into `container`. The instance comes back alongside the
 * teardown so a figure can hand it to {@link PlotGrid.adopt} for view linking.
 */
function buildChart(container: HTMLElement, spec: Spec): Plot | Plot3D | PolarPlot {
  const options = (spec.options ?? {}) as Record<string, unknown>;

  if (spec.kind === "plot3d") {
    const plot = new Plot3D(container, options as Plot3DOptions);
    for (const layer of spec.layers ?? []) addLayer3D(plot, layer);
    for (const label of spec.labels3d ?? []) plot.addLabel3D(label as Any);
    plot.refresh();
    return plot;
  }
  if (spec.kind === "polar") {
    const plot = new PolarPlot(container, options as PolarOptions);
    for (const s of spec.series ?? []) {
      const series = s as Any;
      if (series.type === "scatter") plot.addScatter(series);
      else plot.addLine(series);
    }
    return plot;
  }

  const plot = new Plot(container, options as PlotOptions);
  for (const axis of spec.yAxes ?? []) {
    const { id, ...rest } = axis as { id: string };
    plot.addYAxis(id, rest as Any);
  }
  for (const s of spec.series ?? []) addSeries(plot, s);
  for (const a of spec.annotations ?? []) plot.addAnnotation(a as Any);
  plot.render();
  return plot;
}

/** Build a grid of charts. A panel that fails shows its error in its own cell. */
function buildFigure(container: HTMLElement, fig: FigureSpec): () => void {
  const grid = new PlotGrid(container, {
    rows: fig.rows,
    cols: fig.cols,
    gap: fig.gap,
    title: fig.title,
    theme: fig.theme,
    background: fig.background,
    rowRatios: fig.rowRatios,
    colRatios: fig.colRatios,
    linkX: fig.linkX,
    linkY: fig.linkY,
  });
  for (const panel of fig.panels ?? []) {
    const { row, col, rowSpan, colSpan, ...spec } = panel;
    const cell = grid.cell({ row, col, rowSpan, colSpan });
    try {
      grid.adopt(buildChart(cell, spec as Spec));
    } catch (err) {
      showError(cell, err);
    }
  }
  return () => grid.destroy();
}

/** Build (or rebuild) whatever the model's current state describes. */
function build(el: HTMLElement, model: Model): () => void {
  const spec = (model.get("spec") ?? {}) as Spec;
  const buffers = (model.get("buffers") ?? []) as DataView[];
  const height = String(model.get("height") ?? "420px");
  const width = String(model.get("width") ?? "100%");

  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "relative",
    width,
    // A `figsize` wider than the notebook must shrink, not overflow the cell.
    maxWidth: "100%",
    height,
    minHeight: "80px",
  } as CSSStyleDeclaration);
  el.replaceChildren(container);

  const hydrated = hydrate(spec, buffers) as Spec | FigureSpec;
  if (hydrated.kind === "figure") return buildFigure(container, hydrated as FigureSpec);
  const chart = buildChart(container, hydrated as Spec);
  return () => chart.destroy();
}

export default {
  render({ model, el }: RenderProps) {
    let destroy: (() => void) | null = null;
    const rebuild = (): void => {
      try {
        destroy?.();
      } catch {
        /* a half-built plot may not tear down cleanly; keep going */
      }
      try {
        destroy = build(el, model);
      } catch (err) {
        destroy = null;
        showError(el, err);
      }
    };
    rebuild();
    // Re-render whenever Python assigns a new spec (e.g. `plot.line(...)` again).
    model.on("change:spec", rebuild);
    model.on("change:height", rebuild);
    model.on("change:width", rebuild);
    return () => {
      model.off("change:spec", rebuild);
      model.off("change:height", rebuild);
      model.off("change:width", rebuild);
      try {
        destroy?.();
      } catch {
        /* ignore */
      }
    };
  },
};
