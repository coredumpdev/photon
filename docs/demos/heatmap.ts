/** A scalar field; the colorbar appears on its own because the layer reports a scale. */
import { Plot } from "@photonviz/core";
import { BASE, field } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "sin·cos, damped" });
  const cols = 128;
  const rows = 128;
  const values = field(cols, rows, (u, v) =>
    Math.sin(u * 4) * Math.cos(v * 4) * Math.exp(-(u * u + v * v) * 1.2));

  plot.addHeatmap({
    values, cols, rows,
    extent: { x: [-1, 1], y: [-1, 1] },
    colormap: "magma",
    name: "amplitude",
  });
  return () => plot.destroy();
};
