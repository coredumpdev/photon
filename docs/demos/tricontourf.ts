/** Filled contour bands over scattered (not gridded) samples. */
import { Plot, addTricontourf } from "@photonviz/core";
import { BASE, rng } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "tricontourf — 500 scattered samples" });
  const next = rng(19);
  const n = 500;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = next() * 6 - 3;
    y[i] = next() * 6 - 3;
    z[i] = Math.sin(x[i]!) * Math.cos(y[i]!) * Math.exp(-(x[i]! ** 2 + y[i]! ** 2) / 12);
  }

  addTricontourf(plot, { x, y, z, levels: 12, lines: true, name: "amplitude" });
  return () => plot.destroy();
};
