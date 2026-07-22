import {
  Plot as CorePlot,
  PolarPlot as CorePolarPlot,
  Plot3D as CorePlot3D,
  type AreaOptions,
  type BarOptions,
  type BoxOptions,
  type CandlestickOptions,
  type ContourOptions,
  type ErrorBarOptions,
  type HeatmapOptions,
  type HexbinOptions,
  type Layer,
  type LineOptions,
  type PlotOptions,
  type Plot3DOptions,
  type PointCloudOptions,
  type PolarLineOptions,
  type PolarOptions,
  type PolarScatterOptions,
  type PolarSeries,
  type QuiverOptions,
  type ScatterOptions,
  type StemOptions,
  type SurfaceOptions,
  type YAxisOptions,
} from "@photonviz/core";
import { addGeoJson, addMap, type GeoJsonOptions, type MapOptions } from "@photonviz/map";
import {
  defineComponent,
  h,
  inject,
  markRaw,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
  type PropType,
  type Ref,
} from "vue";

const PlotKey: InjectionKey<Ref<CorePlot | null>> = Symbol("photon-plot");

export const Plot = defineComponent({
  name: "PhotonPlot",
  props: {
    options: { type: Object as PropType<PlotOptions>, default: undefined },
  },
  setup(props, { slots }) {
    const el = ref<HTMLDivElement | null>(null);
    const plot = shallowRef<CorePlot | null>(null);
    provide(PlotKey, plot);
    onMounted(() => {
      if (el.value) plot.value = markRaw(new CorePlot(el.value, props.options));
    });
    onUnmounted(() => plot.value?.destroy());
    return () =>
      h(
        "div",
        { ref: el, style: "position:relative;width:100%;height:100%" },
        plot.value && slots.default ? slots.default() : [],
      );
  },
});

/** Shared layer lifecycle: add on mount, recreate on structural change, setData on data change. */
function useLayer<L extends Layer>(
  add: (p: CorePlot) => L,
  structural: () => unknown[],
  data: () => unknown[],
  update: (l: L, p: CorePlot) => void,
): void {
  const plotRef = inject(PlotKey);
  if (!plotRef) throw new Error("Photon layer must be used inside <Plot>");
  let layer: L | null = null;
  const create = () => {
    const p = plotRef.value;
    if (p) layer = markRaw(add(p)) as L;
  };
  const destroy = () => {
    if (layer && plotRef.value) plotRef.value.removeLayer(layer);
    layer = null;
  };
  onMounted(create);
  onUnmounted(destroy);
  watch(structural, () => {
    destroy();
    create();
  });
  watch(data, () => {
    if (layer && plotRef.value) {
      update(layer, plotRef.value);
      plotRef.value.render();
    }
  });
}

const arr = () => ({ type: [Array, Object, Float64Array, Float32Array] as unknown as PropType<ArrayLike<number>>, required: true as const });
const opt = <T,>() => ({ type: [String, Number, Object, Array, Boolean, Float64Array, Float32Array] as unknown as PropType<T>, default: undefined });

export const Line = defineComponent({
  name: "PhotonLine",
  props: {
    x: arr(), y: arr(),
    color: opt<LineOptions["color"]>(), width: opt<number>(), name: opt<string>(),
    yAxis: opt<string>(), step: opt<LineOptions["step"]>(), join: opt<LineOptions["join"]>(),
    miterLimit: opt<number>(), decimate: opt<boolean>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addLine({ x: props.x, y: props.y, color: props.color, width: props.width, name: props.name, yAxis: props.yAxis, step: props.step, join: props.join, miterLimit: props.miterLimit, decimate: props.decimate }),
      () => [props.color, props.width, props.name, props.yAxis, props.step, props.join, props.miterLimit, props.decimate],
      () => [props.x, props.y],
      (l) => l.setData(props.x, props.y),
    );
    return () => null;
  },
});

export const Scatter = defineComponent({
  name: "PhotonScatter",
  props: {
    x: arr(), y: arr(),
    color: opt<ScatterOptions["color"]>(), size: opt<number>(), name: opt<string>(),
    yAxis: opt<string>(), colorBy: opt<ScatterOptions["colorBy"]>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addScatter({ x: props.x, y: props.y, color: props.color, size: props.size, name: props.name, yAxis: props.yAxis, colorBy: props.colorBy }),
      () => [props.color, props.size, props.name, props.yAxis, props.colorBy],
      () => [props.x, props.y],
      (l) => l.setData(props.x, props.y),
    );
    return () => null;
  },
});

export const Bar = defineComponent({
  name: "PhotonBar",
  props: {
    x: arr(), y: arr(),
    base: opt<BarOptions["base"]>(), width: opt<number>(), offset: opt<number>(),
    color: opt<BarOptions["color"]>(), name: opt<string>(), yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addBar({ x: props.x, y: props.y, base: props.base, width: props.width, offset: props.offset, color: props.color, name: props.name, yAxis: props.yAxis }),
      () => [props.width, props.offset, props.color, props.name, props.yAxis],
      () => [props.x, props.y, props.base],
      (l) => l.setData(props.x, props.y, props.base),
    );
    return () => null;
  },
});

export const Area = defineComponent({
  name: "PhotonArea",
  props: {
    x: arr(), y: arr(),
    base: opt<AreaOptions["base"]>(), color: opt<AreaOptions["color"]>(),
    name: opt<string>(), yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addArea({ x: props.x, y: props.y, base: props.base, color: props.color, name: props.name, yAxis: props.yAxis }),
      () => [props.color, props.name, props.yAxis],
      () => [props.x, props.y, props.base],
      (l) => l.setData(props.x, props.y, props.base),
    );
    return () => null;
  },
});

export const Map = defineComponent({
  name: "PhotonMap",
  props: {
    source: { type: Object as PropType<MapOptions["source"]>, required: true },
    style: opt<MapOptions["style"]>(),
    bbox: opt<MapOptions["bbox"]>(),
    maxTiles: opt<number>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => addMap(p, { source: props.source, style: props.style, bbox: props.bbox, maxTiles: props.maxTiles, yAxis: props.yAxis }),
      () => [props.source, props.style, props.bbox, props.maxTiles, props.yAxis],
      () => [],
      () => {},
    );
    return () => null;
  },
});

export const GeoJson = defineComponent({
  name: "PhotonGeoJson",
  props: {
    geojson: { type: Object as PropType<GeoJsonOptions["geojson"]>, required: true },
    style: opt<GeoJsonOptions["style"]>(),
    layer: opt<string>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => addGeoJson(p, { geojson: props.geojson, style: props.style, layer: props.layer, yAxis: props.yAxis }),
      () => [props.geojson, props.style, props.layer, props.yAxis],
      () => [],
      () => {},
    );
    return () => null;
  },
});

export const YAxis = defineComponent({
  name: "PhotonYAxis",
  props: {
    id: { type: String, required: true },
    side: opt<YAxisOptions["side"]>(),
    color: opt<string>(),
    title: opt<string>(),
    domain: opt<YAxisOptions["domain"]>(),
    type: opt<YAxisOptions["type"]>(),
  },
  setup(props) {
    const plotRef = inject(PlotKey);
    if (!plotRef) throw new Error("<YAxis> must be used inside <Plot>");
    onMounted(() => {
      plotRef.value?.addYAxis(props.id, { side: props.side, color: props.color, title: props.title, domain: props.domain, type: props.type });
    });
    return () => null;
  },
});

// ---------------------------------------------------------------------------
// Static Cartesian layers (no setData → data getter is empty, update is a no-op).
// ---------------------------------------------------------------------------

const noData = () => [] as unknown[];
const noUpdate = () => {};

export const Heatmap = defineComponent({
  name: "PhotonHeatmap",
  props: {
    values: arr(),
    cols: { type: Number, required: true },
    rows: { type: Number, required: true },
    extent: { type: Object as PropType<HeatmapOptions["extent"]>, required: true },
    colormap: opt<HeatmapOptions["colormap"]>(),
    domain: opt<HeatmapOptions["domain"]>(),
    smooth: opt<boolean>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addHeatmap({ values: props.values, cols: props.cols, rows: props.rows, extent: props.extent, colormap: props.colormap, domain: props.domain, smooth: props.smooth, yAxis: props.yAxis }),
      () => [props.values, props.cols, props.rows, props.extent, props.colormap, props.domain, props.smooth, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const Box = defineComponent({
  name: "PhotonBox",
  props: {
    groups: { type: Array as PropType<BoxOptions["groups"]>, required: true },
    width: opt<number>(),
    box: opt<boolean>(),
    violin: opt<boolean>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addBox({ groups: props.groups, width: props.width, box: props.box, violin: props.violin, yAxis: props.yAxis }),
      () => [props.groups, props.width, props.box, props.violin, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const Hexbin = defineComponent({
  name: "PhotonHexbin",
  props: {
    x: arr(), y: arr(),
    radius: opt<number>(),
    colormap: opt<HexbinOptions["colormap"]>(),
    domain: opt<HexbinOptions["domain"]>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addHexbin({ x: props.x, y: props.y, radius: props.radius, colormap: props.colormap, domain: props.domain, yAxis: props.yAxis }),
      () => [props.x, props.y, props.radius, props.colormap, props.domain, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const Contour = defineComponent({
  name: "PhotonContour",
  props: {
    values: arr(),
    cols: { type: Number, required: true },
    rows: { type: Number, required: true },
    extent: { type: Object as PropType<ContourOptions["extent"]>, required: true },
    levels: opt<ContourOptions["levels"]>(),
    color: opt<ContourOptions["color"]>(),
    colormap: opt<ContourOptions["colormap"]>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addContour({ values: props.values, cols: props.cols, rows: props.rows, extent: props.extent, levels: props.levels, color: props.color, colormap: props.colormap, yAxis: props.yAxis }),
      () => [props.values, props.cols, props.rows, props.extent, props.levels, props.color, props.colormap, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const ErrorBar = defineComponent({
  name: "PhotonErrorBar",
  props: {
    x: arr(), y: arr(),
    yerr: opt<ErrorBarOptions["yerr"]>(),
    yerrLow: opt<ErrorBarOptions["yerrLow"]>(),
    yerrHigh: opt<ErrorBarOptions["yerrHigh"]>(),
    xerr: opt<ErrorBarOptions["xerr"]>(),
    color: opt<ErrorBarOptions["color"]>(),
    width: opt<number>(),
    capSize: opt<number>(),
    whiskers: opt<boolean>(),
    band: opt<boolean>(),
    bandOpacity: opt<number>(),
    name: opt<string>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addErrorBar({ x: props.x, y: props.y, yerr: props.yerr, yerrLow: props.yerrLow, yerrHigh: props.yerrHigh, xerr: props.xerr, color: props.color, width: props.width, capSize: props.capSize, whiskers: props.whiskers, band: props.band, bandOpacity: props.bandOpacity, name: props.name, yAxis: props.yAxis }),
      () => [props.x, props.y, props.yerr, props.yerrLow, props.yerrHigh, props.xerr, props.color, props.width, props.capSize, props.whiskers, props.band, props.bandOpacity, props.name, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const Stem = defineComponent({
  name: "PhotonStem",
  props: {
    x: arr(), y: arr(),
    baseline: opt<number>(),
    color: opt<StemOptions["color"]>(),
    width: opt<number>(),
    markerSize: opt<number>(),
    name: opt<string>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addStem({ x: props.x, y: props.y, baseline: props.baseline, color: props.color, width: props.width, markerSize: props.markerSize, name: props.name, yAxis: props.yAxis }),
      () => [props.x, props.y, props.baseline, props.color, props.width, props.markerSize, props.name, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const Quiver = defineComponent({
  name: "PhotonQuiver",
  props: {
    x: arr(), y: arr(), u: arr(), v: arr(),
    scale: opt<number>(),
    color: opt<QuiverOptions["color"]>(),
    width: opt<number>(),
    headSize: opt<number>(),
    colorBy: opt<QuiverOptions["colorBy"]>(),
    name: opt<string>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addQuiver({ x: props.x, y: props.y, u: props.u, v: props.v, scale: props.scale, color: props.color, width: props.width, headSize: props.headSize, colorBy: props.colorBy, name: props.name, yAxis: props.yAxis }),
      () => [props.x, props.y, props.u, props.v, props.scale, props.color, props.width, props.headSize, props.colorBy, props.name, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

export const Candlestick = defineComponent({
  name: "PhotonCandlestick",
  props: {
    x: arr(),
    open: arr(),
    high: arr(),
    low: arr(),
    close: arr(),
    width: opt<number>(),
    upColor: opt<CandlestickOptions["upColor"]>(),
    downColor: opt<CandlestickOptions["downColor"]>(),
    wickWidth: opt<number>(),
    name: opt<string>(),
    yAxis: opt<string>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addCandlestick({ x: props.x, open: props.open, high: props.high, low: props.low, close: props.close, width: props.width, upColor: props.upColor, downColor: props.downColor, wickWidth: props.wickWidth, name: props.name, yAxis: props.yAxis }),
      () => [props.x, props.open, props.high, props.low, props.close, props.width, props.upColor, props.downColor, props.wickWidth, props.name, props.yAxis],
      noData,
      noUpdate,
    );
    return () => null;
  },
});

// ---------------------------------------------------------------------------
// Polar plot — a separate core class with its own container + provide/inject.
// ---------------------------------------------------------------------------

const PolarKey: InjectionKey<Ref<CorePolarPlot | null>> = Symbol("photon-polar");

export const PolarPlot = defineComponent({
  name: "PhotonPolarPlot",
  props: {
    options: { type: Object as PropType<PolarOptions>, default: undefined },
  },
  setup(props, { slots }) {
    const el = ref<HTMLDivElement | null>(null);
    const plot = shallowRef<CorePolarPlot | null>(null);
    provide(PolarKey, plot);
    onMounted(() => {
      if (el.value) plot.value = markRaw(new CorePolarPlot(el.value, props.options));
    });
    onUnmounted(() => plot.value?.destroy());
    return () =>
      h(
        "div",
        { ref: el, style: "position:relative;width:100%;height:100%" },
        plot.value && slots.default ? slots.default() : [],
      );
  },
});

/** Shared polar-series lifecycle: PolarPlot has no removeLayer → cleanup is a no-op. */
function usePolarSeries(
  add: (p: CorePolarPlot) => PolarSeries,
  structural: () => unknown[],
  theta: () => ArrayLike<number>,
  r: () => ArrayLike<number>,
): void {
  const plotRef = inject(PolarKey);
  if (!plotRef) throw new Error("Photon polar layer must be used inside <PolarPlot>");
  let series: PolarSeries | null = null;
  const create = () => {
    const p = plotRef.value;
    if (p) series = markRaw(add(p)) as PolarSeries;
  };
  onMounted(create);
  watch(structural, () => {
    // No removeLayer on PolarPlot; re-add to reflect structural changes.
    create();
  });
  watch([theta, r], () => {
    if (series) series.setData(theta(), r());
  });
}

export const PolarLine = defineComponent({
  name: "PhotonPolarLine",
  props: {
    theta: arr(), r: arr(),
    color: opt<PolarLineOptions["color"]>(),
    width: opt<number>(),
    closed: opt<boolean>(),
  },
  setup(props) {
    usePolarSeries(
      (p) => p.addLine({ theta: props.theta, r: props.r, color: props.color, width: props.width, closed: props.closed }),
      () => [props.color, props.width, props.closed],
      () => props.theta,
      () => props.r,
    );
    return () => null;
  },
});

export const PolarScatter = defineComponent({
  name: "PhotonPolarScatter",
  props: {
    theta: arr(), r: arr(),
    color: opt<PolarScatterOptions["color"]>(),
    size: opt<number>(),
    labels: opt<PolarScatterOptions["labels"]>(),
  },
  setup(props) {
    usePolarSeries(
      (p) => p.addScatter({ theta: props.theta, r: props.r, color: props.color, size: props.size, labels: props.labels }),
      () => [props.color, props.size, props.labels],
      () => props.theta,
      () => props.r,
    );
    return () => null;
  },
});

// ---------------------------------------------------------------------------
// 3D plot — a separate core class; children are static (no removal → no-op).
// ---------------------------------------------------------------------------

const Plot3DKey: InjectionKey<Ref<CorePlot3D | null>> = Symbol("photon-plot3d");

export const Plot3D = defineComponent({
  name: "PhotonPlot3D",
  props: {
    options: { type: Object as PropType<Plot3DOptions>, default: undefined },
  },
  setup(props, { slots }) {
    const el = ref<HTMLDivElement | null>(null);
    const plot = shallowRef<CorePlot3D | null>(null);
    provide(Plot3DKey, plot);
    onMounted(() => {
      if (el.value) plot.value = markRaw(new CorePlot3D(el.value, props.options));
    });
    onUnmounted(() => plot.value?.destroy());
    return () =>
      h(
        "div",
        { ref: el, style: "position:relative;width:100%;height:100%" },
        plot.value && slots.default ? slots.default() : [],
      );
  },
});

/** Add a 3D layer on mount. No removal API → cleanup is a no-op. */
function usePlot3DLayer(add: (p: CorePlot3D) => unknown): void {
  const plotRef = inject(Plot3DKey);
  if (!plotRef) throw new Error("Photon 3D layer must be used inside <Plot3D>");
  onMounted(() => {
    const p = plotRef.value;
    if (p) markRaw(add(p) as object);
  });
}

export const Surface = defineComponent({
  name: "PhotonSurface",
  props: {
    values: arr(),
    cols: { type: Number, required: true },
    rows: { type: Number, required: true },
    extentX: opt<SurfaceOptions["extentX"]>(),
    extentZ: opt<SurfaceOptions["extentZ"]>(),
    colormap: opt<SurfaceOptions["colormap"]>(),
  },
  setup(props) {
    usePlot3DLayer((p) => p.addSurface({ values: props.values, cols: props.cols, rows: props.rows, extentX: props.extentX, extentZ: props.extentZ, colormap: props.colormap }));
    return () => null;
  },
});

export const PointCloud = defineComponent({
  name: "PhotonPointCloud",
  props: {
    x: arr(), y: arr(), z: arr(),
    color: opt<PointCloudOptions["color"]>(),
    size: opt<number>(),
    colorBy: opt<PointCloudOptions["colorBy"]>(),
  },
  setup(props) {
    usePlot3DLayer((p) => p.addPointCloud({ x: props.x, y: props.y, z: props.z, color: props.color, size: props.size, colorBy: props.colorBy }));
    return () => null;
  },
});
