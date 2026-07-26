/** A 2x2 grid in one container, sharing an x view. */
import { PlotGrid } from "@photonviz/core";
import { BASE, gauss, linspace, rng } from "./_data";

export default (el: HTMLElement) => {
  const grid = new PlotGrid(el, {
    rows: 2, cols: 2, gap: 14,
    title: "PlotGrid — pan one pane, they all move",
    theme: "dark",
    linkX: true,
  });

  const next = rng(11);
  const x = linspace(0, 12, 600);
  const noisy = (f: (t: number) => number): Float64Array =>
    Float64Array.from(x, (t) => f(t) + gauss(next, 0, 0.06));

  grid.addPlot({}, { ...BASE, title: "signal" })
    .addLine({ x, y: noisy(Math.sin), color: "#60a5fa", width: 2 });
  grid.addPlot({}, { ...BASE, title: "quadrature" })
    .addLine({ x, y: noisy(Math.cos), color: "#f472b6", width: 2 });
  grid.addPlot({}, { ...BASE, title: "envelope" })
    .addArea({ x, y: Float64Array.from(x, (t) => Math.exp(-t / 6)), color: "#34d399" });
  grid.addPlot({}, { ...BASE, title: "beat" })
    .addLine({ x, y: noisy((t) => Math.sin(t) * Math.cos(t * 3)), color: "#fbbf24", width: 2 });

  return () => grid.destroy();
};
