import { Component } from "@geajs/core";
import { Plot as CorePlot, type Annotation, type Layer, type PlotOptions } from "@photonviz/core";
import { addSeries, applyContainerStyle, type SeriesSpec, type YAxisSpec } from "./series";

export interface PlotProps {
  options?: PlotOptions;
  /** Extra named y axes to register before the series. */
  yAxes?: YAxisSpec[];
  /** Series to add, discriminated by `type`. */
  series?: SeriesSpec[];
  /** Canvas2D annotations (span / band / box / label) drawn above the data. */
  annotations?: Annotation[];
  class?: string;
  /** Extra inline CSS applied to the container (appended to the base sizing). */
  style?: string;
  /** Called once with the core `Plot` — the imperative handle for streaming. */
  onReady?: (plot: CorePlot) => void;
}

/**
 * A Cartesian plot. Gea has no context API, so — like the Svelte binding — this is
 * a single config-driven component: pass `options`/`yAxes`/`series`. The core `Plot`
 * is built once the element is in the DOM and torn down on dispose. Because the plot
 * is an imperative WebGL canvas outside gea's reactive DOM, stream data via the
 * `onReady` handle (`layer.setData(...)` + `plot.render()`).
 */
export default class Plot extends Component<PlotProps> {
  private plot: CorePlot | null = null;
  private layers: Layer[] = [];

  template(props: PlotProps) {
    return <div class={props.class}></div>;
  }

  onAfterRender(): void {
    const el = this.el;
    if (!el) return;
    applyContainerStyle(el, this.props.style);
    const p = new CorePlot(el, this.props.options);
    this.plot = p;
    for (const ya of this.props.yAxes ?? []) p.addYAxis(ya.id, ya);
    this.layers = (this.props.series ?? []).map((s) => addSeries(p, s));
    for (const a of this.props.annotations ?? []) p.addAnnotation(a);
    this.props.onReady?.(p);
  }

  dispose(): void {
    this.plot?.destroy();
    this.plot = null;
    this.layers = [];
    super.dispose();
  }
}
