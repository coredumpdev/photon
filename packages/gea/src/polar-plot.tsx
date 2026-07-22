import { Component } from "@geajs/core";
import { PolarPlot as CorePolarPlot, type PolarOptions } from "@photonviz/core";
import { addPolarSeries, applyContainerStyle, type PolarSeriesSpec } from "./series";

export interface PolarPlotProps {
  options?: PolarOptions;
  series?: PolarSeriesSpec[];
  class?: string;
  style?: string;
  onReady?: (plot: CorePolarPlot) => void;
}

/** A polar (θ, r) plot. Config-driven like {@link Plot}; stream via `onReady`. */
export default class PolarPlot extends Component<PolarPlotProps> {
  private plot: CorePolarPlot | null = null;

  template(props: PolarPlotProps) {
    return <div class={props.class}></div>;
  }

  onAfterRender(): void {
    const el = this.el;
    if (!el) return;
    applyContainerStyle(el, this.props.style);
    const p = new CorePolarPlot(el, this.props.options);
    this.plot = p;
    for (const s of this.props.series ?? []) addPolarSeries(p, s);
    this.props.onReady?.(p);
  }

  dispose(): void {
    this.plot?.destroy();
    this.plot = null;
    super.dispose();
  }
}
