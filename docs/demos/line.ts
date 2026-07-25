/** A line with a legend, a second Y axis, and a dashed reference. */
import { Plot } from "@photonviz/core";
import { BASE, linspace } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "Signal + envelope", legend: true });

  const x = linspace(0, 40, 4000);
  const signal = x.map((v) => Math.sin(v) + 0.35 * Math.sin(v * 5));
  const envelope = x.map((v) => 1 + 0.35 * Math.cos(v / 6));

  plot.addLine({ x, y: signal, color: "#60a5fa", width: 1.6, name: "signal" });
  plot.addLine({ x, y: envelope, color: "#f472b6", width: 1.5, dash: [7, 5], name: "envelope" });
  plot.addLine({ x, y: envelope.map((v) => -v), color: "#f472b6", width: 1.5, dash: [7, 5] });
  plot.addAnnotation({ type: "span", dim: "y", value: 0, color: "#475569", dash: [3, 4] });

  return () => plot.destroy();
};
