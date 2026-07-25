/** A least-squares fit with a confidence band; r² lands in the legend. */
import { Plot, addRegression } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(3);
  const n = 200;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = gauss(next, 0, 1.2);
    y[i] = 1.8 * x[i]! - 0.5 + gauss(next, 0, 1.1);
  }

  const plot = new Plot(el, { ...BASE, title: "OLS + 2σ band", legend: true, pick: "xy" });
  plot.addScatter({ x, y, size: 5, color: "#38bdf8", name: "samples" });
  addRegression(plot, { x, y, band: 2 });
  return () => plot.destroy();
};
