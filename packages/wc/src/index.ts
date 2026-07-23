/**
 * @photonviz/wc — framework-agnostic Web Components (custom elements) for Photon.
 *
 * Three elements are registered on import: `<photon-plot>` (Cartesian),
 * `<photon-plot3d>` (3D), and `<photon-polar>` (polar). Configure them by
 * assigning JS properties on the element (`series`, `options`, `layers`, …);
 * the `theme` and `height` attributes are also honoured.
 *
 *   const el = document.querySelector("photon-plot");
 *   el.series = [{ type: "line", x, y, color: "#60a5fa" }];
 */
import {
  AreaLayer,
  BarLayer,
  LineLayer,
  Plot as CorePlot,
  Plot3D as CorePlot3D,
  PolarPlot as CorePolarPlot,
  ScatterLayer,
  addHeikinAshi,
  addRenko,
  addVolumeProfile,
} from "@photonviz/core";
import type {
  Annotation,
  AreaOptions,
  Bar3DOptions,
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
  LineOptions,
  OhlcOptions,
  PatchesOptions,
  PieOptions,
  Plot3DOptions,
  PlotOptions,
  PointCloudOptions,
  PolarLineOptions,
  PolarOptions,
  PolarScatterOptions,
  PolarSeries,
  Quiver3DOptions,
  QuiverOptions,
  RenkoOptions,
  ScatterOptions,
  StemOptions,
  SurfaceOptions,
  VolumeOptions,
  VolumeProfileOptions,
  YAxisOptions,
} from "@photonviz/core";
import { addGeoJson, addMap } from "@photonviz/map";
import type { GeoJsonOptions, MapOptions } from "@photonviz/map";

// --- Cartesian series --------------------------------------------------------

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
    case "map": return addMap(p, s);
    case "geojson": return addGeoJson(p, s);
  }
}

/** Re-upload data for a streaming series (line/scatter/bar/area); others static. */
function updateSeries(layer: Layer, s: SeriesSpec): void {
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

function addPolarSeries(p: CorePolarPlot, s: PolarSeriesSpec): PolarSeries {
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

function addLayer3D(p: CorePlot3D, s: LayerSpec3D): void {
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

// --- Shared element scaffolding ---------------------------------------------

const HOST_CSS =
  ":host{display:block;height:320px;position:relative}" +
  ".photon-root{width:100%;height:100%}";

/** Build the shadow root once, returning the container the plot mounts into. */
function mountShadow(host: HTMLElement): HTMLDivElement {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  root.replaceChildren();
  const style = document.createElement("style");
  style.textContent = HOST_CSS;
  const container = document.createElement("div");
  container.className = "photon-root";
  root.append(style, container);
  return container;
}

/** Apply a `height` attribute value (e.g. "480px", "50vh") to the host. */
function applyHeight(host: HTMLElement, value: string | null): void {
  host.style.height = value ?? "";
}

/** Merge a `theme` attribute ("dark"/"light") into a plot options object. */
function withThemeAttr<T extends { theme?: unknown }>(host: HTMLElement, options: T): T {
  const theme = host.getAttribute("theme");
  if (theme === "dark" || theme === "light") return { ...options, theme };
  return options;
}

// --- <photon-plot> -----------------------------------------------------------

/**
 * `<photon-plot>` — Cartesian plot. Configure via JS properties:
 * `options`, `series`, `yAxes`, `annotations`. Attributes: `theme`, `height`.
 */
export class PhotonPlotElement extends HTMLElement {
  static readonly observedAttributes = ["theme", "height"];

  #plot: CorePlot | undefined;
  #container: HTMLDivElement | undefined;
  #layers: Layer[] = [];

  #options: PlotOptions = {};
  #series: SeriesSpec[] = [];
  #yAxes: YAxisSpec[] = [];
  #annotations: Annotation[] = [];

  get options(): PlotOptions { return this.#options; }
  set options(v: PlotOptions | undefined) { this.#options = v ?? {}; this.#rebuild(); }

  get series(): SeriesSpec[] { return this.#series; }
  set series(v: SeriesSpec[] | undefined) {
    const next = v ?? [];
    const prev = this.#series;
    this.#series = next;
    if (!this.#plot) return;
    // Same count → stream data through the existing layers; else rebuild.
    if (next.length === prev.length && next.every((s, i) => s.type === prev[i]!.type)) {
      for (let i = 0; i < this.#layers.length; i++) updateSeries(this.#layers[i]!, next[i]!);
      this.#plot.render();
    } else {
      this.#buildSeries();
    }
  }

  get yAxes(): YAxisSpec[] { return this.#yAxes; }
  set yAxes(v: YAxisSpec[] | undefined) { this.#yAxes = v ?? []; this.#rebuild(); }

  get annotations(): Annotation[] { return this.#annotations; }
  set annotations(v: Annotation[] | undefined) {
    this.#annotations = v ?? [];
    if (!this.#plot) return;
    this.#plot.clearAnnotations();
    for (const a of this.#annotations) this.#plot.addAnnotation(a);
  }

  connectedCallback(): void { this.#mount(); }
  disconnectedCallback(): void { this.#unmount(); }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "height") applyHeight(this, value);
    else if (name === "theme") this.#rebuild();
  }

  #mount(): void {
    this.#container = mountShadow(this);
    applyHeight(this, this.getAttribute("height"));
    this.#plot = new CorePlot(this.#container, withThemeAttr(this, this.#options));
    for (const ya of this.#yAxes) this.#plot.addYAxis(ya.id, ya);
    this.#buildSeries();
    for (const a of this.#annotations) this.#plot.addAnnotation(a);
  }

  #buildSeries(): void {
    if (!this.#plot) return;
    for (const l of this.#layers) this.#plot.removeLayer(l);
    this.#layers = this.#series.map((s) => addSeries(this.#plot!, s));
  }

  #unmount(): void {
    this.#plot?.destroy();
    this.#plot = undefined;
    this.#layers = [];
    this.#container = undefined;
  }

  /** Rebuild the whole plot in place (used when options/axes/theme change). */
  #rebuild(): void {
    if (!this.isConnected) return;
    this.#unmount();
    this.#mount();
  }
}

// --- <photon-plot3d> ---------------------------------------------------------

/**
 * `<photon-plot3d>` — 3D plot. Configure via JS properties: `options`, `layers`.
 * Attributes: `theme`, `height`.
 */
export class PhotonPlot3DElement extends HTMLElement {
  // Plot3DOptions has no `theme`; only `height` is reflected here.
  static readonly observedAttributes = ["height"];

  #plot: CorePlot3D | undefined;
  #container: HTMLDivElement | undefined;
  #options: Plot3DOptions = {};
  #layers: LayerSpec3D[] = [];

  get options(): Plot3DOptions { return this.#options; }
  set options(v: Plot3DOptions | undefined) { this.#options = v ?? {}; this.#rebuild(); }

  get layers(): LayerSpec3D[] { return this.#layers; }
  set layers(v: LayerSpec3D[] | undefined) { this.#layers = v ?? []; this.#rebuild(); }

  connectedCallback(): void { this.#mount(); }
  disconnectedCallback(): void { this.#unmount(); }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "height") applyHeight(this, value);
  }

  #mount(): void {
    this.#container = mountShadow(this);
    applyHeight(this, this.getAttribute("height"));
    this.#plot = new CorePlot3D(this.#container, this.#options);
    for (const l of this.#layers) addLayer3D(this.#plot, l);
  }

  #unmount(): void {
    this.#plot?.destroy();
    this.#plot = undefined;
    this.#container = undefined;
  }

  #rebuild(): void {
    if (!this.isConnected) return;
    this.#unmount();
    this.#mount();
  }
}

// --- <photon-polar> ----------------------------------------------------------

/**
 * `<photon-polar>` — polar plot. Configure via JS properties: `options`,
 * `series` (`line` / `scatter`). Attributes: `theme`, `height`.
 */
export class PhotonPolarElement extends HTMLElement {
  static readonly observedAttributes = ["theme", "height"];

  #plot: CorePolarPlot | undefined;
  #container: HTMLDivElement | undefined;
  #series: PolarSeries[] = [];
  #options: PolarOptions = {};
  #specs: PolarSeriesSpec[] = [];

  get options(): PolarOptions { return this.#options; }
  set options(v: PolarOptions | undefined) { this.#options = v ?? {}; this.#rebuild(); }

  get series(): PolarSeriesSpec[] { return this.#specs; }
  set series(v: PolarSeriesSpec[] | undefined) {
    const next = v ?? [];
    const prev = this.#specs;
    this.#specs = next;
    if (!this.#plot) return;
    // PolarPlot has no removeLayer; stream when the shape matches, else rebuild.
    if (next.length === prev.length && next.every((s, i) => s.type === prev[i]!.type)) {
      for (let i = 0; i < this.#series.length; i++) this.#series[i]!.setData(next[i]!.theta, next[i]!.r);
    } else {
      this.#rebuild();
    }
  }

  connectedCallback(): void { this.#mount(); }
  disconnectedCallback(): void { this.#unmount(); }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "height") applyHeight(this, value);
    else if (name === "theme") this.#rebuild();
  }

  #mount(): void {
    this.#container = mountShadow(this);
    applyHeight(this, this.getAttribute("height"));
    this.#plot = new CorePolarPlot(this.#container, withThemeAttr(this, this.#options));
    this.#series = this.#specs.map((s) => addPolarSeries(this.#plot!, s));
  }

  #unmount(): void {
    this.#plot?.destroy();
    this.#plot = undefined;
    this.#series = [];
    this.#container = undefined;
  }

  #rebuild(): void {
    if (!this.isConnected) return;
    this.#unmount();
    this.#mount();
  }
}

// --- Registration ------------------------------------------------------------

/** Register all three custom elements. Safe to call multiple times. */
export function defineElements(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("photon-plot")) customElements.define("photon-plot", PhotonPlotElement);
  if (!customElements.get("photon-plot3d")) customElements.define("photon-plot3d", PhotonPlot3DElement);
  if (!customElements.get("photon-polar")) customElements.define("photon-polar", PhotonPolarElement);
}

// Auto-register on import (no-op in non-DOM environments).
if (typeof customElements !== "undefined") defineElements();

declare global {
  interface HTMLElementTagNameMap {
    "photon-plot": PhotonPlotElement;
    "photon-plot3d": PhotonPlot3DElement;
    "photon-polar": PhotonPolarElement;
  }
}
