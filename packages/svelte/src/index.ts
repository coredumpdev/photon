import {
  AreaLayer,
  BarLayer,
  LineLayer,
  Plot as CorePlot,
  Plot3D as CorePlot3D,
  PolarPlot as CorePolarPlot,
  ScatterLayer,
  type Annotation,
  type AreaOptions,
  type Bar3DOptions,
  type BarOptions,
  type BoxOptions,
  type Contour3DOptions,
  type GraphInput,
  type ImageOptions,
  type IsosurfaceOptions,
  type Line3DOptions,
  type CandlestickOptions,
  type ContourOptions,
  type ErrorBarOptions,
  type HeatmapOptions,
  type HexbinOptions,
  type Layer,
  type LineOptions,
  type OhlcOptions,
  type PatchesOptions,
  type PieOptions,
  type PlotOptions,
  type Plot3DOptions,
  type PointCloudOptions,
  type PolarLineOptions,
  type PolarOptions,
  type PolarScatterOptions,
  type PolarSeries,
  type Quiver3DOptions,
  type QuiverOptions,
  type ScatterOptions,
  type StemOptions,
  type VolumeOptions,
  type SurfaceOptions,
  type YAxisOptions,
  addBarbs,
  addDrawdown,
  addConfusionMatrix,
  addRocCurve,
  addPrCurve,
  addCalibration,
  addEmbedding,
  addDecisionBoundary,
  addFeatureImportance,
  addShapBeeswarm,
  addPartialDependence,
  addAttentionMap,
  addTrainingCurves,
  addRidgeline,
  addPredVsActual,
  addResiduals,
  addLiftCurve,
  addLearningCurve,
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
  addRegression,
  addEcdf,
  addCorrMatrix,
  addPsd,
  addWaterfall,
  collectLayers,
  addContourFilled,
  addEventPlot,
  addHeikinAshi,
  addHist2d,
  addPcolormesh,
  addStreamplot,
  addRenko,
  addVolumeProfile,
  addModelGraph,
  addModelGraph3D,
  type BarbsOptions,
  type DrawdownOptions,
  type ConfusionMatrixOptions,
  type RocCurveOptions,
  type PrCurveOptions,
  type CalibrationOptions,
  type EmbeddingOptions,
  type DecisionBoundaryOptions,
  type FeatureImportanceOptions,
  type ShapBeeswarmOptions,
  type PartialDependenceOptions,
  type AttentionMapOptions,
  type TrainingCurvesOptions,
  type RidgelineOptions,
  type PredVsActualOptions,
  type ResidualsOptions,
  type LiftCurveOptions,
  type LearningCurveOptions,
  type TriplotOptions,
  type TripcolorOptions,
  type TricontourOptions,
  type TricontourfOptions,
  type TreemapOptions,
  type FunnelOptions,
  type SunburstOptions,
  type GaugeOptions,
  type SankeyOptions,
  type ChordOptions,
  type ParallelOptions,
  type RegressionOptions,
  type EcdfOptions,
  type CorrMatrixOptions,
  type PsdOptions,
  type WaterfallOptions,
  type ContourFilledOptions,
  type EventPlotOptions,
  type Hist2dOptions,
  type PcolormeshOptions,
  type StreamplotOptions,
  type HeikinAshiOptions,
  type RenkoOptions,
  type VolumeProfileOptions,
  type Boxes3DOptions,
  type ModelGraph3DOptions,
  type ModelGraphOptions,
} from "@photonviz/core";

export type SeriesSpec =
  | ({ type: "line" } & LineOptions)
  | ({ type: "scatter" } & ScatterOptions)
  | ({ type: "bar" } & BarOptions)
  | ({ type: "area" } & AreaOptions)
  | ({ type: "heatmap" } & HeatmapOptions)
  | ({ type: "box" } & BoxOptions)
  | ({ type: "hexbin" } & HexbinOptions)
  | ({ type: "contour" } & ContourOptions)
  | ({ type: "errorbar" } & ErrorBarOptions)
  | ({ type: "stem" } & StemOptions)
  | ({ type: "quiver" } & QuiverOptions)
  | ({ type: "candlestick" } & CandlestickOptions)
  | ({ type: "ohlc" } & OhlcOptions)
  | ({ type: "heikinAshi" } & HeikinAshiOptions)
  | ({ type: "renko" } & RenkoOptions)
  | ({ type: "volumeProfile" } & VolumeProfileOptions)
  | ({ type: "pie" } & PieOptions)
  | ({ type: "patches" } & PatchesOptions)
  | ({ type: "image" } & ImageOptions)
  | ({ type: "graph" } & GraphInput)
  | ({ type: "contourf" } & ContourFilledOptions)
  | ({ type: "pcolormesh" } & PcolormeshOptions)
  | ({ type: "hist2d" } & Hist2dOptions)
  | ({ type: "eventplot" } & EventPlotOptions)
  | ({ type: "streamplot" } & StreamplotOptions)
  | ({ type: "barbs" } & BarbsOptions)
  | ({ type: "drawdown" } & DrawdownOptions)
  | ({ type: "confusionMatrix" } & ConfusionMatrixOptions)
  | ({ type: "rocCurve" } & RocCurveOptions)
  | ({ type: "prCurve" } & PrCurveOptions)
  | ({ type: "calibration" } & CalibrationOptions)
  | ({ type: "embedding" } & EmbeddingOptions)
  | ({ type: "decisionBoundary" } & DecisionBoundaryOptions)
  | ({ type: "featureImportance" } & FeatureImportanceOptions)
  | ({ type: "shapBeeswarm" } & ShapBeeswarmOptions)
  | ({ type: "partialDependence" } & PartialDependenceOptions)
  | ({ type: "attentionMap" } & AttentionMapOptions)
  | ({ type: "trainingCurves" } & TrainingCurvesOptions)
  | ({ type: "ridgeline" } & RidgelineOptions)
  | ({ type: "predVsActual" } & PredVsActualOptions)
  | ({ type: "residuals" } & ResidualsOptions)
  | ({ type: "liftCurve" } & LiftCurveOptions)
  | ({ type: "learningCurve" } & LearningCurveOptions)
  | ({ type: "triplot" } & TriplotOptions)
  | ({ type: "tripcolor" } & TripcolorOptions)
  | ({ type: "tricontour" } & TricontourOptions)
  | ({ type: "tricontourf" } & TricontourfOptions)
  | ({ type: "treemap" } & TreemapOptions)
  | ({ type: "funnel" } & FunnelOptions)
  | ({ type: "sunburst" } & SunburstOptions)
  | ({ type: "gauge" } & GaugeOptions)
  | ({ type: "sankey" } & SankeyOptions)
  | ({ type: "chord" } & ChordOptions)
  | ({ type: "parallelCoordinates" } & ParallelOptions)
  | ({ type: "regression" } & RegressionOptions)
  | ({ type: "ecdf" } & EcdfOptions)
  | ({ type: "corrMatrix" } & CorrMatrixOptions)
  | ({ type: "psd" } & PsdOptions)
  | ({ type: "waterfall" } & WaterfallOptions)
  | ({ type: "modelGraph" } & ModelGraphOptions);

export interface YAxisSpec extends YAxisOptions {
  id: string;
}

export interface PlotConfig {
  options?: PlotOptions;
  yAxes?: YAxisSpec[];
  series?: SeriesSpec[];
  annotations?: Annotation[];
}

function addSeries(p: CorePlot, s: SeriesSpec): Layer[] {
  switch (s.type) {
    case "line": return [p.addLine(s)];
    case "scatter": return [p.addScatter(s)];
    case "bar": return [p.addBar(s)];
    case "area": return [p.addArea(s)];
    case "heatmap": return [p.addHeatmap(s)];
    case "box": return [p.addBox(s)];
    case "hexbin": return [p.addHexbin(s)];
    case "contour": return [p.addContour(s)];
    case "errorbar": return [p.addErrorBar(s)];
    case "stem": return [p.addStem(s)];
    case "quiver": return [p.addQuiver(s)];
    case "candlestick": return [p.addCandlestick(s)];
    case "ohlc": return [p.addOhlc(s)];
    case "heikinAshi": return [addHeikinAshi(p, s)];
    case "renko": return [addRenko(p, s)];
    case "volumeProfile": return [addVolumeProfile(p, s)];
    case "pie": return [p.addPie(s)];
    case "patches": return [p.addPatches(s)];
    case "image": return [p.addImage(s)];
    case "graph": return [p.addGraph(s)];
    case "contourf": { const h = addContourFilled(p, s); return h.lines ? [h.bands, h.lines] : [h.bands]; }
    case "pcolormesh": return [addPcolormesh(p, s)];
    case "hist2d": return [addHist2d(p, s).heatmap];
    case "eventplot": return [addEventPlot(p, s)];
    case "streamplot": { const h = addStreamplot(p, s); return h.arrows ? [...h.lines, h.arrows] : h.lines; }
    case "barbs": { const h = addBarbs(p, s); return h.pennants ? [h.staff, h.pennants] : [h.staff]; }
    case "drawdown": return collectLayers(addDrawdown(p, s));
    case "confusionMatrix": return collectLayers(addConfusionMatrix(p, s));
    case "rocCurve": return collectLayers(addRocCurve(p, s));
    case "prCurve": return collectLayers(addPrCurve(p, s));
    case "calibration": return collectLayers(addCalibration(p, s));
    case "embedding": return collectLayers(addEmbedding(p, s));
    case "decisionBoundary": return collectLayers(addDecisionBoundary(p, s));
    case "featureImportance": return collectLayers(addFeatureImportance(p, s));
    case "shapBeeswarm": return collectLayers(addShapBeeswarm(p, s));
    case "partialDependence": return collectLayers(addPartialDependence(p, s));
    case "attentionMap": return collectLayers(addAttentionMap(p, s));
    case "trainingCurves": return collectLayers(addTrainingCurves(p, s));
    case "ridgeline": return collectLayers(addRidgeline(p, s));
    case "predVsActual": return collectLayers(addPredVsActual(p, s));
    case "residuals": return collectLayers(addResiduals(p, s));
    case "liftCurve": return collectLayers(addLiftCurve(p, s));
    case "learningCurve": return collectLayers(addLearningCurve(p, s));
    case "triplot": return collectLayers(addTriplot(p, s));
    case "tripcolor": return collectLayers(addTripcolor(p, s));
    case "tricontour": return collectLayers(addTricontour(p, s));
    case "tricontourf": return collectLayers(addTricontourf(p, s));
    case "treemap": return collectLayers(addTreemap(p, s));
    case "funnel": return collectLayers(addFunnel(p, s));
    case "sunburst": return collectLayers(addSunburst(p, s));
    case "gauge": return collectLayers(addGauge(p, s));
    case "sankey": return collectLayers(addSankey(p, s));
    case "chord": return collectLayers(addChord(p, s));
    case "parallelCoordinates": return collectLayers(addParallelCoordinates(p, s));
    case "regression": return collectLayers(addRegression(p, s));
    case "ecdf": return collectLayers(addEcdf(p, s));
    case "corrMatrix": return collectLayers(addCorrMatrix(p, s));
    case "psd": return collectLayers(addPsd(p, s));
    case "waterfall": return collectLayers(addWaterfall(p, s));
    // Labels are Canvas2D annotations, not layers, so they need no removal here.
    case "modelGraph": { const h = addModelGraph(p, s); return [h.nodes, h.edges]; }
  }
}

function updateSeries(layers: Layer[], s: SeriesSpec): void {
  // Only single-layer specs stream; the primary layer is always first.
  const layer = layers[0];
  if (!layer) return;
  switch (s.type) {
    case "line": (layer as LineLayer).setData(s.x, s.y); break;
    case "scatter": (layer as ScatterLayer).setData(s.x, s.y); break;
    case "bar": (layer as BarLayer).setData(s.x, s.y, s.base); break;
    case "area": (layer as AreaLayer).setData(s.x, s.y, s.base); break;
    case "heatmap": break; // static
    case "box": break; // static
    case "hexbin": break; // static
    case "contour": break; // static
    case "errorbar": break; // static
    case "stem": break; // static
    case "quiver": break; // static
    case "candlestick": break; // static
    case "ohlc": break; // static
    case "heikinAshi": break; // static
    case "renko": break; // static
    case "volumeProfile": break; // static
    case "pie": break; // static
    case "patches": break; // static
    case "image": break; // static
    case "graph": break; // static
    case "modelGraph": break; // static
  }
}

/**
 * Svelte action. Usage:
 *
 *   <div style="height:300px" use:plot={{ options, series }}></div>
 *
 * On data updates (same series count) the layers stream via `setData`; a change
 * in series count rebuilds them.
 */
export function plot(node: HTMLElement, config: PlotConfig) {
  const p = new CorePlot(node, config.options);
  for (const ya of config.yAxes ?? []) p.addYAxis(ya.id, ya);
  let layers = (config.series ?? []).map((s) => addSeries(p, s));
  for (const a of config.annotations ?? []) p.addAnnotation(a);

  return {
    update(next: PlotConfig) {
      const specs = next.series ?? [];
      if (specs.length !== layers.length) {
        for (const group of layers) for (const l of group) p.removeLayer(l);
        layers = specs.map((s) => addSeries(p, s));
      } else {
        for (let i = 0; i < layers.length; i++) updateSeries(layers[i]!, specs[i]!);
        p.render();
      }
      // Re-apply annotations wholesale (cheap; they're Canvas2D overlays).
      p.clearAnnotations();
      for (const a of next.annotations ?? []) p.addAnnotation(a);
    },
    destroy() {
      p.destroy();
    },
  };
}

// --- Polar -------------------------------------------------------------------

export type PolarSeriesSpec =
  | ({ type: "line" } & PolarLineOptions)
  | ({ type: "scatter" } & PolarScatterOptions);

export interface PolarConfig {
  options?: PolarOptions;
  series: PolarSeriesSpec[];
}

function addPolarSeries(p: CorePolarPlot, s: PolarSeriesSpec): PolarSeries {
  switch (s.type) {
    case "line": return p.addLine(s);
    case "scatter": return p.addScatter(s);
  }
}

/**
 * Svelte action mirroring `plot` for {@link CorePolarPlot}. Usage:
 *
 *   <div style="height:300px" use:polarPlot={{ options, series }}></div>
 *
 * On a data update with the SAME series count, each series streams via
 * `PolarSeries.setData(theta, r)`.
 *
 * NOTE: `PolarPlot` has no `removeLayer`, so series cannot be rebuilt in place.
 * If the series count changes we recreate the whole plot (destroy + new). Prefer
 * keeping the count stable, or remount the component when it must change.
 */
export function polarPlot(node: HTMLElement, config: PolarConfig) {
  let p = new CorePolarPlot(node, config.options);
  let series = config.series.map((s) => addPolarSeries(p, s));

  return {
    update(next: PolarConfig) {
      if (next.series.length !== series.length) {
        // No in-place rebuild available — recreate the whole PolarPlot.
        p.destroy();
        p = new CorePolarPlot(node, next.options);
        series = next.series.map((s) => addPolarSeries(p, s));
      } else {
        for (let i = 0; i < series.length; i++) {
          series[i]!.setData(next.series[i]!.theta, next.series[i]!.r);
        }
      }
    },
    destroy() {
      p.destroy();
    },
  };
}

// --- 3D ----------------------------------------------------------------------

export type LayerSpec3D =
  | ({ type: "surface" } & SurfaceOptions)
  | ({ type: "pointcloud" } & PointCloudOptions)
  | ({ type: "line3d" } & Line3DOptions)
  | ({ type: "bar3d" } & Bar3DOptions)
  | ({ type: "quiver3d" } & Quiver3DOptions)
  | ({ type: "contour3d" } & Contour3DOptions)
  | ({ type: "isosurface" } & IsosurfaceOptions)
  | ({ type: "volume" } & VolumeOptions)
  | ({ type: "boxes3d" } & Boxes3DOptions)
  | ({ type: "modelGraph3d" } & ModelGraph3DOptions);

export interface Plot3DConfig {
  options?: Plot3DOptions;
  layers: LayerSpec3D[];
}

function addLayer3D(p: CorePlot3D, s: LayerSpec3D) {
  switch (s.type) {
    case "surface": return p.addSurface(s);
    case "pointcloud": return p.addPointCloud(s);
    case "line3d": return p.addLine3D(s);
    case "bar3d": return p.addBar3D(s);
    case "quiver3d": return p.addQuiver3D(s);
    case "contour3d": return p.addContour3D(s);
    case "isosurface": return p.addIsosurface(s);
    case "volume": return p.addVolume(s);
    case "boxes3d": return p.addBoxes3D(s);
    case "modelGraph3d": return addModelGraph3D(p, s).boxes;
  }
}

/**
 * Svelte action for {@link CorePlot3D}. Static: layers are built on mount and
 * the plot is destroyed on unmount. Usage:
 *
 *   <div style="height:400px" use:plot3d={{ options, layers }}></div>
 */
export function plot3d(node: HTMLElement, config: Plot3DConfig) {
  const p = new CorePlot3D(node, config.options);
  for (const l of config.layers) addLayer3D(p, l);

  return {
    destroy() {
      p.destroy();
    },
  };
}

// --- Finance -----------------------------------------------------------------

// Multi-layer builders (Bollinger, Depth) don't fit the one-series=one-Layer
// model, so they're exposed imperatively: call them against a core Plot.
export {
  addBollinger,
  addDepth,
  type BollingerOptions,
  type DepthOptions,
} from "@photonviz/core";

// Pure finance math (transforms + indicators). Note `heikinAshi`, `renko` and
// `volumeProfile` here are the transform functions — distinct from the
// `add*` chart builders wired into SeriesSpec above.
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

// ML / deep-learning: pure metrics + reducers and the Plot builders that render
// them (imperative use on a core Plot, like the finance helpers above).
export {
  confusionMatrix, rocCurve, prCurve, calibrationCurve, emaSmooth,
  pca, standardize, beeswarmLayout, ML_PALETTE,
  addConfusionMatrix, addRocCurve, addPrCurve, addCalibration,
  addEmbedding, addDecisionBoundary, addFeatureImportance, addShapBeeswarm,
  addPartialDependence, addAttentionMap, addTrainingCurves, addRidgeline,
} from "@photonviz/core";

// Model architecture graphs: the framework adapters + the pure layout, so a
// ModelGraph can be built from a PyTorch / ONNX / Keras / scikit-learn export.
export {
  sequentialModel, mlpModel, modelLayout, modelBoxDims, layerCategory,
  formatCount, formatShape, LAYER_COLORS,
  modelGraphFromTorchFx, modelGraphFromOnnx, modelGraphFromKeras, modelGraphFromSklearn,
} from "@photonviz/core";
export type {
  ModelGraph as ModelGraphSpec, ModelNode, ModelEdge, ModelNodeBox, ModelEdgePath,
  ModelLayoutOptions, ModelLayoutResult, LayerCategory, ModelBlock,
  TorchFxNode, OnnxGraph, OnnxNode, KerasModelConfig, KerasLayerConfig, SklearnStep,
} from "@photonviz/core";

// Gridded + vector-field charts — matplotlib's contourf / pcolormesh /
// streamplot / barbs / hist2d / eventplot, as imperative builders on a core Plot.
export {
  addContourFilled, addPcolormesh, addStreamplot, addBarbs, addHist2d, addEventPlot,
  isobands, streamlines, hist2d,
} from "@photonviz/core";
export type {
  ContourFilledOptions, PcolormeshOptions, StreamplotOptions, StreamplotHandle,
  BarbsOptions, BarbsHandle, Hist2dOptions, Hist2dHandle, EventPlotOptions,
  ScalarField, VectorField, IsobandPolygon, Streamline, Histogram2D,
} from "@photonviz/core";

// A grid of plots in one container (matplotlib's `subplots`), plus y-view linking.
export { PlotGrid, linkY } from "@photonviz/core";
export type { PlotGridOptions, GridTitleOptions, CellPlacement } from "@photonviz/core";
