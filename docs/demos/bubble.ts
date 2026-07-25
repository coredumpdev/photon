/** Per-point size and colour turn a scatter into a bubble chart. */
import { Plot, paletteColor } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "Bubbles", legend: true, pick: "xy" });

  const next = rng(11);
  const n = 120;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const sizes = new Float64Array(n);
  const colors: string[] = [];
  for (let i = 0; i < n; i++) {
    x[i] = gauss(next, 0, 1.1);
    y[i] = x[i]! * 0.6 + gauss(next, 0, 0.7);
    sizes[i] = 5 + Math.abs(gauss(next)) * 16;
    // A colour-vision-safe palette, cycled by group.
    colors.push(paletteColor(i % 5, "okabe-ito"));
  }

  plot.addScatter({ x, y, sizes, colors, name: "samples" });
  return () => plot.destroy();
};
