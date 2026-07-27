export { Plot, linkX, linkY } from "./plot.js";
export type {
  PlotOptions,
  AxisScaleOptions,
  YAxisOptions,
  HoverReadoutRow,
  LegendOptions,
  BarSeries,
  GroupedBarOptions,
  StackedBarOptions,
  AreaSeries,
  StackedAreaOptions,
  GraphInput,
  Annotation,
  DrawTool,
} from "./plot.js";

export { PlotGrid } from "./grid.js";
export type { PlotGridOptions, GridTitleOptions, CellPlacement } from "./grid.js";

export { createToolbar } from "./ui/toolbar.js";
export type { ToolbarHost, ToolbarTheme } from "./ui/toolbar.js";

// Layers
export { LineLayer } from "./layers/line.js";
export type { LineOptions, LineJoin } from "./layers/line.js";
export { ScatterLayer } from "./layers/scatter.js";
export type { ScatterOptions, MarkerShape } from "./layers/scatter.js";
export { BarLayer } from "./layers/bar.js";
export type { BarOptions } from "./layers/bar.js";
export { AreaLayer } from "./layers/area.js";
export type { AreaOptions } from "./layers/area.js";
export { HeatmapLayer } from "./layers/heatmap.js";
export type { HeatmapOptions } from "./layers/heatmap.js";
export { BoxLayer } from "./layers/box.js";
export type { BoxOptions, BoxGroup } from "./layers/box.js";
export { HexbinLayer } from "./layers/hexbin.js";
export type { HexbinOptions } from "./layers/hexbin.js";
export { ContourLayer } from "./layers/contour.js";
export type { ContourOptions } from "./layers/contour.js";
export { ErrorBarLayer } from "./layers/errorbar.js";
export type { ErrorBarOptions, ErrInput, ErrorBarData } from "./layers/errorbar.js";
export { StemLayer } from "./layers/stem.js";
export type { StemOptions } from "./layers/stem.js";
export { QuiverLayer } from "./layers/quiver.js";
export type { QuiverOptions } from "./layers/quiver.js";
export { CandlestickLayer } from "./layers/candlestick.js";
export type { CandlestickOptions, Candle, CandlestickData } from "./layers/candlestick.js";
export { OhlcLayer } from "./layers/ohlc.js";
export type { OhlcOptions } from "./layers/ohlc.js";
export { PatchesLayer } from "./layers/patches.js";
export type { PatchesOptions, Patch } from "./layers/patches.js";
export { PieLayer } from "./layers/pie.js";
export type { PieOptions } from "./layers/pie.js";
export { ImageLayer } from "./layers/image.js";
export type { ImageOptions, ImageSource } from "./layers/image.js";
export { GraphLayer } from "./layers/graph.js";
export type { GraphOptions, GraphData } from "./layers/graph.js";
export { forceLayout } from "./graph/force.js";
export type { ForceLayoutOptions } from "./graph/force.js";
export type { Layer, DrawState } from "./layers/layer.js";
export { isLayer, collectLayers } from "./layers/layer.js";
export type { PickMode, Picked } from "./layers/pick.js";

// Polar
export { PolarPlot } from "./polar/polar.js";
export type { PolarOptions, PolarLineOptions, PolarScatterOptions, PolarSeries } from "./polar/polar.js";

// 3D
export { Plot3D } from "./plot3d/plot3d.js";
export type { Plot3DOptions, Label3D } from "./plot3d/plot3d.js";
export { SurfaceLayer } from "./plot3d/surface.js";
export type { SurfaceOptions } from "./plot3d/surface.js";
export { PointCloudLayer } from "./plot3d/pointcloud.js";
export type { PointCloudOptions } from "./plot3d/pointcloud.js";
export { Line3DLayer } from "./plot3d/line3d.js";
export type { Line3DOptions } from "./plot3d/line3d.js";
export { Bar3DLayer } from "./plot3d/bar3d.js";
export type { Bar3DOptions } from "./plot3d/bar3d.js";
export { Boxes3DLayer } from "./plot3d/boxes3d.js";
export type { Boxes3DOptions, Box3D } from "./plot3d/boxes3d.js";
export { Quiver3DLayer } from "./plot3d/quiver3d.js";
export type { Quiver3DOptions } from "./plot3d/quiver3d.js";
export { Contour3DLayer } from "./plot3d/contour3d.js";
export type { Contour3DOptions } from "./plot3d/contour3d.js";
export { IsosurfaceLayer } from "./plot3d/isosurface.js";
export type { IsosurfaceOptions } from "./plot3d/isosurface.js";
export { marchingCubes } from "./plot3d/marching-cubes.js";
export { VolumeLayer } from "./plot3d/volume.js";
export type { VolumeOptions } from "./plot3d/volume.js";
export type { Layer3D, Bounds3 } from "./plot3d/layer3d.js";
export type { Mat4 } from "./plot3d/mat4.js";

// Axes & ticks
export { Axis } from "./axes/axis.js";
export { autoTicks, defaultFormat, resolveTicks, withMinorTicks } from "./axes/ticks.js";

// Scales
export { LinearScale, LogScale, TimeScale, CategoricalScale, OrdinalTimeScale, makeScale } from "./scales/scale.js";
export type { Scale, ScaleType } from "./scales/scale.js";

// Stats
export { histogram, hist2d, boxStats, quantileSorted, kde, fft, spectrogram } from "./stats/index.js";
export type { Histogram, Histogram2D, BoxStats, Density, Spectrogram } from "./stats/index.js";
// Signal processing: windows, Welch PSD, Savitzky-Golay, cross-correlation.
export { windowFunction, welch, savitzkyGolay, crossCorrelate } from "./stats/signal.js";
export type { WindowName, Psd, WelchOptions, Correlation } from "./stats/signal.js";
// Scrolling waterfall (spectrogram that streams downwards) + its time-axis math.
export { addWaterfall, waterfallTimeTicks, formatDuration, niceTimeStep, blockMax } from "./stats/waterfall.js";
export type { WaterfallOptions, WaterfallHandle, WaterfallTickOptions, TimeFormat } from "./stats/waterfall.js";
// Fits + summaries: regression, LOESS, ECDF, z-score, correlation matrix.
export {
  linearRegression, linearTrend, loess, ecdf, zscore, correlation, corrMatrix,
} from "./stats/regression.js";
export type { LinearFit, Trend } from "./stats/regression.js";

// GL toolkit — building blocks for custom layers.
export { createProgram, uniformLocations, bufferUsage } from "./gl/program.js";
export {
  setTransformUniforms,
  TRANSFORM_GLSL,
  TRANSFORM_UNIFORMS,
} from "./gl/transform.js";

// Geometry
export { earcut } from "./geo/earcut.js";

// Color
// --- Finance: TA indicators, chart transforms, and Plot builders -------------
export {
  sma, ema, wma, rollingStd, bollinger, rsi, macd, vwap, trueRange, atr, firstFinite,
  stochastic, keltner, obv, ichimoku, adx, superTrend, fibRetracements,
  cci, mfi, williamsR, aroon, donchian, parabolicSar, pivotPoints,
} from "./finance/indicators.js";
export type {
  BollingerBands, Macd, Stochastic, Channel, Ichimoku, Adx, SuperTrend, FibLevel,
  Aroon, PivotLevels,
} from "./finance/indicators.js";
export {
  heikinAshi, renko, lineBreak, pointAndFigure, volumeProfile, depth,
  resampleOhlc, drawdown,
} from "./finance/transforms.js";
export type {
  Ohlc, OhlcArrays, Brick, PfColumn, VolumeProfile, DepthCurves,
  ResampledOhlc, Drawdown,
} from "./finance/transforms.js";
export { addHeikinAshi, addRenko, addVolumeProfile, addBollinger, addDepth, addDrawdown } from "./finance/charts.js";

// --- Data: CSV parsing + LTTB downsampling -----------------------------------
export { parseCSV } from "./data/csv.js";
export type { Table, CSVOptions } from "./data/csv.js";
export { lttb } from "./data/downsample.js";

// --- ML / deep-learning: metrics, reducers, and Plot builders ----------------
export * from "./ml/metrics.js";
export * from "./ml/reduce.js";
export * from "./ml/charts.js";
// Model architecture graphs (PyTorch / ONNX → 2D DAG or 3D tensor blocks).
export * from "./ml/model.js";
export * from "./ml/model-chart.js";

// --- Charts: gridded + vector fields (contourf, pcolormesh, streamplot, barbs)
export * from "./charts/fields.js";
export * from "./charts/tri.js";
export { delaunay, triangleEdges } from "./geo/delaunay.js";
export type { Triangulation } from "./geo/delaunay.js";

// --- Charts: hierarchy / flow / composition diagrams -------------------------
export * from "./charts/treemap.js";
export * from "./charts/funnel.js";
export * from "./charts/sunburst.js";
export * from "./charts/gauge.js";
export * from "./charts/sankey.js";
export * from "./charts/chord.js";
export * from "./charts/parallel.js";
export type {
  HeikinAshiOptions, RenkoOptions, VolumeProfileOptions, BollingerOptions, BollingerHandle,
  DepthOptions, DepthHandle, OhlcInput, DrawdownOptions, DrawdownHandle,
} from "./finance/charts.js";

export {
  colormap, colormapLUT, colormapFromStops, reverseColormap, discreteColormap,
  symmetricDomain, registerColormap, colormapNames, COLORMAP_KIND,
} from "./color/colormap.js";
export type { ColormapName, BuiltinColormapName, ColormapSpec, ColormapKind, RGB } from "./color/colormap.js";
export {
  PALETTES, DEFAULT_PALETTE, palette, paletteColor, registerPalette, paletteNames,
} from "./color/palettes.js";
export type { PaletteName, BuiltinPaletteName, PaletteSpec } from "./color/palettes.js";

// Rendering
export { lightTheme, darkTheme, resolveAxisStyle } from "./render/overlay.js";
export { renderColorbars, colormapGradient } from "./render/colorbar.js";
export type { ColorbarOptions, ColorbarTheme } from "./render/colorbar.js";
export type { ColorInfo } from "./color/colormap.js";
export { canvasToBlob, downloadCanvas, copyCanvasToClipboard } from "./render/export.js";
export type { ExportOptions } from "./render/export.js";
export type { Theme, Layout, ResolvedAxisStyle, PlotTitleOptions } from "./render/overlay.js";
export { parseColor, toColorCss } from "./gl/context.js";
export type { AxisFrame } from "./gl/transform.js";

export type { Tick, TicksSpec, AxisConfig, Dim, InteractionMode, Range, Bounds, Color, RenderType } from "./types.js";

// --- Statistics chart builders (regression, ECDF, correlation, spectra) ------
export * from "./stats/charts.js";
