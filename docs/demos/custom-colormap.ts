/** Register a brand ramp once, then use it by name anywhere a colormap is accepted. */
import { Plot, registerColormap } from "@photonviz/core";
import { BASE, field } from "./_data";

registerColormap("brand", ["#0b1020", "#1d4ed8", "#22d3ee", "#fef08a"]);

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: 'colormap: "brand"' });
  const cols = 96;
  const rows = 96;
  const values = field(cols, rows, (u, v) => Math.hypot(u, v));

  plot.addHeatmap({
    values, cols, rows,
    extent: { x: [-1, 1], y: [-1, 1] },
    colormap: "brand",
    name: "radius",
  });
  return () => plot.destroy();
};
