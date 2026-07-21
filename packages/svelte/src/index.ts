import {
  AreaLayer,
  BarLayer,
  LineLayer,
  Plot as CorePlot,
  ScatterLayer,
  type AreaOptions,
  type BarOptions,
  type Layer,
  type LineOptions,
  type PlotOptions,
  type ScatterOptions,
  type YAxisOptions,
} from "@photonviz/core";

export type SeriesSpec =
  | ({ type: "line" } & LineOptions)
  | ({ type: "scatter" } & ScatterOptions)
  | ({ type: "bar" } & BarOptions)
  | ({ type: "area" } & AreaOptions);

export interface YAxisSpec extends YAxisOptions {
  id: string;
}

export interface PlotConfig {
  options?: PlotOptions;
  yAxes?: YAxisSpec[];
  series?: SeriesSpec[];
}

function addSeries(p: CorePlot, s: SeriesSpec): Layer {
  switch (s.type) {
    case "line": return p.addLine(s);
    case "scatter": return p.addScatter(s);
    case "bar": return p.addBar(s);
    case "area": return p.addArea(s);
  }
}

function updateSeries(layer: Layer, s: SeriesSpec): void {
  switch (s.type) {
    case "line": (layer as LineLayer).setData(s.x, s.y); break;
    case "scatter": (layer as ScatterLayer).setData(s.x, s.y); break;
    case "bar": (layer as BarLayer).setData(s.x, s.y, s.base); break;
    case "area": (layer as AreaLayer).setData(s.x, s.y, s.base); break;
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
    },
    destroy() {
      p.destroy();
    },
  };
}
