export { Plot } from "./plot.js";
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
} from "./plot.js";

export { createToolbar } from "./ui/toolbar.js";
export type { ToolbarHost, ToolbarTheme } from "./ui/toolbar.js";

// Layers
export { LineLayer } from "./layers/line.js";
export type { LineOptions } from "./layers/line.js";
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
export type { ErrorBarOptions } from "./layers/errorbar.js";
export { StemLayer } from "./layers/stem.js";
export type { StemOptions } from "./layers/stem.js";
export { QuiverLayer } from "./layers/quiver.js";
export type { QuiverOptions } from "./layers/quiver.js";
export { CandlestickLayer } from "./layers/candlestick.js";
export type { CandlestickOptions } from "./layers/candlestick.js";
export { PatchesLayer } from "./layers/patches.js";
export type { PatchesOptions, Patch } from "./layers/patches.js";
export { PieLayer } from "./layers/pie.js";
export type { PieOptions } from "./layers/pie.js";
export { ImageLayer } from "./layers/image.js";
export type { ImageOptions, ImageSource } from "./layers/image.js";
export { GraphLayer } from "./layers/graph.js";
export type { GraphOptions } from "./layers/graph.js";
export { forceLayout } from "./graph/force.js";
export type { ForceLayoutOptions } from "./graph/force.js";
export type { Layer, DrawState } from "./layers/layer.js";
export type { PickMode } from "./layers/pick.js";

// Polar
export { PolarPlot } from "./polar/polar.js";
export type { PolarOptions, PolarLineOptions, PolarScatterOptions, PolarSeries } from "./polar/polar.js";

// 3D
export { Plot3D } from "./plot3d/plot3d.js";
export type { Plot3DOptions } from "./plot3d/plot3d.js";
export { SurfaceLayer } from "./plot3d/surface.js";
export type { SurfaceOptions } from "./plot3d/surface.js";
export { PointCloudLayer } from "./plot3d/pointcloud.js";
export type { PointCloudOptions } from "./plot3d/pointcloud.js";
export { Line3DLayer } from "./plot3d/line3d.js";
export type { Line3DOptions } from "./plot3d/line3d.js";
export { Bar3DLayer } from "./plot3d/bar3d.js";
export type { Bar3DOptions } from "./plot3d/bar3d.js";
export { Quiver3DLayer } from "./plot3d/quiver3d.js";
export type { Quiver3DOptions } from "./plot3d/quiver3d.js";
export { Contour3DLayer } from "./plot3d/contour3d.js";
export type { Contour3DOptions } from "./plot3d/contour3d.js";
export { IsosurfaceLayer } from "./plot3d/isosurface.js";
export type { IsosurfaceOptions } from "./plot3d/isosurface.js";
export { marchingCubes } from "./plot3d/marching-cubes.js";
export { VolumeLayer } from "./plot3d/volume.js";
export type { VolumeOptions } from "./plot3d/volume.js";
export type { Layer3D, Bounds3, ColorInfo } from "./plot3d/layer3d.js";

// Axes & ticks
export { Axis } from "./axes/axis.js";
export { autoTicks, defaultFormat, resolveTicks, withMinorTicks } from "./axes/ticks.js";

// Scales
export { LinearScale, LogScale, TimeScale, CategoricalScale, makeScale } from "./scales/scale.js";
export type { Scale, ScaleType } from "./scales/scale.js";

// Stats
export { histogram, boxStats, quantileSorted, kde, fft, spectrogram } from "./stats/index.js";
export type { Histogram, BoxStats, Density, Spectrogram } from "./stats/index.js";

// GL toolkit — building blocks for custom layers (used by @photonviz/map, etc.)
export { createProgram, uniformLocations } from "./gl/program.js";
export {
  setTransformUniforms,
  TRANSFORM_GLSL,
  TRANSFORM_UNIFORMS,
} from "./gl/transform.js";

// Geometry
export { earcut } from "./geo/earcut.js";

// Color
export { colormap, colormapLUT } from "./color/colormap.js";
export type { ColormapName, RGB } from "./color/colormap.js";

// Rendering
export { lightTheme, darkTheme, resolveAxisStyle } from "./render/overlay.js";
export type { Theme, Layout, ResolvedAxisStyle, PlotTitleOptions } from "./render/overlay.js";
export { parseColor, toColorCss } from "./gl/context.js";
export type { AxisFrame } from "./gl/transform.js";

export type { Tick, TicksSpec, AxisConfig, Dim, InteractionMode, Range, Bounds, Color } from "./types.js";
