/** Filled contour bands, with the boundaries stroked on top. */
import { addContourFilled } from "@photonviz/core";
import { Plot } from "@photonviz/core";
import { BASE, field } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "contourf — 12 bands" });
  const cols = 96;
  const rows = 96;
  const values = field(cols, rows, (u, v) =>
    Math.sin(u * 3) * Math.cos(v * 3) * Math.exp(-(u * u + v * v) * 0.8));

  addContourFilled(plot, {
    values, cols, rows,
    extent: { x: [-1, 1], y: [-1, 1] },
    levels: 12,
    colormap: "viridis",
    lines: true,
    name: "amplitude",
  });
  return () => plot.destroy();
};
