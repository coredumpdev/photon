/** Legend entries are switches: click one to hide its series and re-fit the axes. */
import { Plot } from "@photonviz/core";
import { BASE, linspace } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "Click a legend entry", legend: { position: "top-left" } });
  const x = linspace(0, 20, 800);
  plot.addLine({ x, y: x.map((v) => Math.sin(v)), color: "#60a5fa", width: 2, name: "sin" });
  plot.addLine({ x, y: x.map((v) => Math.cos(v) * 3), color: "#f472b6", width: 2, name: "cos ×3" });
  plot.addLine({ x, y: x.map((v) => v / 4), color: "#fbbf24", width: 2, name: "ramp" });
  return () => plot.destroy();
};
