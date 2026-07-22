import { Component } from "@geajs/core";
import { Plot3D as CorePlot3D, type Plot3DOptions } from "@photonviz/core";
import { addLayer3D, applyContainerStyle, type LayerSpec3D } from "./series";

export interface Plot3DProps {
  options?: Plot3DOptions;
  layers?: LayerSpec3D[];
  class?: string;
  style?: string;
  onReady?: (plot: CorePlot3D) => void;
}

/** A 3D plot with an orbit camera. Config-driven like {@link Plot}. */
export default class Plot3D extends Component<Plot3DProps> {
  private plot: CorePlot3D | null = null;

  template(props: Plot3DProps) {
    return <div class={props.class}></div>;
  }

  onAfterRender(): void {
    const el = this.el;
    if (!el) return;
    applyContainerStyle(el, this.props.style);
    const p = new CorePlot3D(el, this.props.options);
    this.plot = p;
    for (const l of this.props.layers ?? []) addLayer3D(p, l);
    this.props.onReady?.(p);
  }

  dispose(): void {
    this.plot?.destroy();
    this.plot = null;
    super.dispose();
  }
}
