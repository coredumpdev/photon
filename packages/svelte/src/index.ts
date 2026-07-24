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
  addHeikinAshi,
  addRenko,
  addVolumeProfile,
  type HeikinAshiOptions,
  type RenkoOptions,
  type VolumeProfileOptions,
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
  | ({ type: "graph" } & GraphInput);

export interface YAxisSpec extends YAxisOptions {
  id: string;
}

export interface PlotConfig {
  options?: PlotOptions;
  yAxes?: YAxisSpec[];
  series?: SeriesSpec[];
  annotations?: Annotation[];
}

function addSeries(p: CorePlot, s: SeriesSpec): Layer {
  switch (s.type) {
    case "line": return p.addLine(s);
    case "scatter": return p.addScatter(s);
    case "bar": return p.addBar(s);
    case "area": return p.addArea(s);
    case "heatmap": return p.addHeatmap(s);
    case "box": return p.addBox(s);
    case "hexbin": return p.addHexbin(s);
    case "contour": return p.addContour(s);
    case "errorbar": return p.addErrorBar(s);
    case "stem": return p.addStem(s);
    case "quiver": return p.addQuiver(s);
    case "candlestick": return p.addCandlestick(s);
    case "ohlc": return p.addOhlc(s);
    case "heikinAshi": return addHeikinAshi(p, s);
    case "renko": return addRenko(p, s);
    case "volumeProfile": return addVolumeProfile(p, s);
    case "pie": return p.addPie(s);
    case "patches": return p.addPatches(s);
    case "image": return p.addImage(s);
    case "graph": return p.addGraph(s);
  }
}

function updateSeries(layer: Layer, s: SeriesSpec): void {
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
        for (const l of layers) p.removeLayer(l);
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
  | ({ type: "volume" } & VolumeOptions);

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
