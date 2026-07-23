import type {
  AreaLayer,
  AreaOptions,
  Bar3DOptions,
  BarLayer,
  BarOptions,
  BoxOptions,
  CandlestickOptions,
  Contour3DOptions,
  ContourOptions,
  ErrorBarOptions,
  GraphInput,
  HeatmapOptions,
  HeikinAshiOptions,
  HexbinOptions,
  ImageOptions,
  IsosurfaceOptions,
  Layer,
  Line3DOptions,
  LineLayer,
  LineOptions,
  OhlcOptions,
  PatchesOptions,
  PieOptions,
  Plot as CorePlot,
  Plot3D as CorePlot3D,
  PointCloudOptions,
  PolarLineOptions,
  PolarPlot as CorePolarPlot,
  PolarScatterOptions,
  PolarSeries,
  Quiver3DOptions,
  QuiverOptions,
  RenkoOptions,
  ScatterLayer,
  ScatterOptions,
  StemOptions,
  SurfaceOptions,
  VolumeOptions,
  VolumeProfileOptions,
  YAxisOptions,
} from "@photonviz/core";
import { addHeikinAshi, addRenko, addVolumeProfile } from "@photonviz/core";
import { addGeoJson, addMap, type GeoJsonOptions, type MapOptions } from "@photonviz/map";

/** Base container sizing, applied imperatively (gea's `style` attr wants an object). */
export function applyContainerStyle(el: HTMLElement, style?: string): void {
  el.style.position = "relative";
  el.style.width = "100%";
  el.style.height = "100%";
  if (style) el.style.cssText += ";" + style;
}

/** A single Cartesian series, discriminated by `type`. */
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
  | ({ type: "map" } & MapOptions)
  | ({ type: "geojson" } & GeoJsonOptions);

export interface YAxisSpec extends YAxisOptions {
  id: string;
}

export function addSeries(p: CorePlot, s: SeriesSpec): Layer {
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
    case "map": return addMap(p, s);
    case "geojson": return addGeoJson(p, s);
  }
}

/** Re-upload data for a streaming series (line/scatter/bar/area); others are static. */
export function updateSeries(layer: Layer, s: SeriesSpec): void {
  switch (s.type) {
    case "line": (layer as LineLayer).setData(s.x, s.y); break;
    case "scatter": (layer as ScatterLayer).setData(s.x, s.y); break;
    case "bar": (layer as BarLayer).setData(s.x, s.y, s.base); break;
    case "area": (layer as AreaLayer).setData(s.x, s.y, s.base); break;
    default: break; // static — nothing to stream
  }
}

// --- Polar -------------------------------------------------------------------

export type PolarSeriesSpec =
  | ({ type: "line" } & PolarLineOptions)
  | ({ type: "scatter" } & PolarScatterOptions);

export function addPolarSeries(p: CorePolarPlot, s: PolarSeriesSpec): PolarSeries {
  switch (s.type) {
    case "line": return p.addLine(s);
    case "scatter": return p.addScatter(s);
  }
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

export function addLayer3D(p: CorePlot3D, s: LayerSpec3D): void {
  switch (s.type) {
    case "surface": p.addSurface(s); break;
    case "pointcloud": p.addPointCloud(s); break;
    case "line3d": p.addLine3D(s); break;
    case "bar3d": p.addBar3D(s); break;
    case "quiver3d": p.addQuiver3D(s); break;
    case "contour3d": p.addContour3D(s); break;
    case "isosurface": p.addIsosurface(s); break;
    case "volume": p.addVolume(s); break;
  }
}
