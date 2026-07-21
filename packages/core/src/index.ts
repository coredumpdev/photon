export { Plot } from "./plot.js";
export type { PlotOptions, AxisScaleOptions, YAxisOptions } from "./plot.js";

export { createToolbar } from "./ui/toolbar.js";
export type { ToolbarHost, ToolbarTheme } from "./ui/toolbar.js";

// Layers
export { LineLayer } from "./layers/line.js";
export type { LineOptions } from "./layers/line.js";
export { ScatterLayer } from "./layers/scatter.js";
export type { ScatterOptions } from "./layers/scatter.js";
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
export type { Layer, DrawState } from "./layers/layer.js";

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
export type { Layer3D, Bounds3 } from "./plot3d/layer3d.js";

// Axes & ticks
export { Axis } from "./axes/axis.js";
export { autoTicks, defaultFormat, resolveTicks, withMinorTicks } from "./axes/ticks.js";

// Scales
export { LinearScale, LogScale, TimeScale, makeScale } from "./scales/scale.js";
export type { Scale, ScaleType } from "./scales/scale.js";

// Stats
export { histogram, boxStats, quantileSorted, kde, fft, spectrogram } from "./stats/index.js";
export type { Histogram, BoxStats, Density, Spectrogram } from "./stats/index.js";

// Color
export { colormap } from "./color/colormap.js";
export type { ColormapName, RGB } from "./color/colormap.js";

// Rendering
export { lightTheme, darkTheme } from "./render/overlay.js";
export type { Theme, Layout } from "./render/overlay.js";
export { parseColor, toColorCss } from "./gl/context.js";
export type { AxisFrame } from "./gl/transform.js";

export type { Tick, TicksSpec, AxisConfig, Dim, InteractionMode, Range, Bounds, Color } from "./types.js";
