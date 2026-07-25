export { default as Plot } from "./plot"
export type { PlotProps } from "./plot"
export { default as PolarPlot } from "./polar-plot"
export type { PolarPlotProps } from "./polar-plot"
export { default as Plot3D } from "./plot3d"
export type { Plot3DProps } from "./plot3d"
export { addSeries, updateSeries, addPolarSeries, addLayer3D } from "./series"
export type { SeriesSpec, YAxisSpec, PolarSeriesSpec, LayerSpec3D } from "./series"

// --- Finance -----------------------------------------------------------------
// Multi-layer finance builders (Bollinger, Depth) don't fit one-series=one-Layer,
// so use them imperatively via `onReady(plot)`.
export { addBollinger, addDepth } from "@photonviz/core"
export type { BollingerOptions, DepthOptions } from "@photonviz/core"

// Pure finance/statistics math.
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
} from "@photonviz/core"

// ML / deep-learning: pure metrics + reducers and Plot builders (imperative use).
export {
  confusionMatrix, rocCurve, prCurve, calibrationCurve, emaSmooth,
  pca, standardize, beeswarmLayout, ML_PALETTE,
  addConfusionMatrix, addRocCurve, addPrCurve, addCalibration,
  addEmbedding, addDecisionBoundary, addFeatureImportance, addShapBeeswarm,
  addPartialDependence, addAttentionMap, addTrainingCurves, addRidgeline,
} from "@photonviz/core"

// Model architecture graphs: the framework adapters + the pure layout, so a
// ModelGraph can be built from a PyTorch / ONNX / Keras / scikit-learn export.
export {
  sequentialModel, mlpModel, modelLayout, modelBoxDims, layerCategory,
  formatCount, formatShape, LAYER_COLORS,
  modelGraphFromTorchFx, modelGraphFromOnnx, modelGraphFromKeras, modelGraphFromSklearn,
} from "@photonviz/core"
export type {
  ModelGraph as ModelGraphSpec, ModelNode, ModelEdge, ModelNodeBox, ModelEdgePath,
  ModelLayoutOptions, ModelLayoutResult, LayerCategory, ModelBlock,
  TorchFxNode, OnnxGraph, OnnxNode, KerasModelConfig, KerasLayerConfig, SklearnStep,
} from "@photonviz/core"
