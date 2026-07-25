/** An equity curve and its underwater profile, on linked Y axes. */
import { Plot, addDrawdown } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(5);
  const n = 600;
  const equity = new Float64Array(n);
  let value = 100;
  for (let i = 0; i < n; i++) {
    value *= 1 + gauss(next, 0.0006, 0.013);
    equity[i] = value;
  }
  const x = Float64Array.from({ length: n }, (_, i) => i);

  const plot = new Plot(el, { ...BASE, title: "Equity and drawdown", legend: true });
  plot.addLine({ x, y: equity, color: "#34d399", width: 1.8, name: "equity" });
  plot.addYAxis("dd", { side: "right", color: "#ef4444", title: "%" });
  addDrawdown(plot, { equity, x, yAxis: "dd" });
  return () => plot.destroy();
};
