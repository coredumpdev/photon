import {
  Plot as CorePlot,
  type AreaOptions,
  type BarOptions,
  type Layer,
  type LineOptions,
  type PlotOptions,
  type ScatterOptions,
  type YAxisOptions,
} from "@photonviz/core";
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
    decimate: opt<boolean>(),
  },
  setup(props) {
    useLayer(
      (p) => p.addLine({ x: props.x, y: props.y, color: props.color, width: props.width, name: props.name, yAxis: props.yAxis, step: props.step, join: props.join, decimate: props.decimate }),
      () => [props.color, props.width, props.name, props.yAxis, props.step, props.join, props.decimate],
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
