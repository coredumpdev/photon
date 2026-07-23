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
  heikinAshi,
  renko,
  lineBreak,
  pointAndFigure,
  volumeProfile,
  depth,
} from "@photonviz/core"
