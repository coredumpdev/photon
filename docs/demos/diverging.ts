/** A diverging colormap only reads correctly on a domain centred at its midpoint. */
import { Plot, symmetricDomain } from "@photonviz/core";
import { BASE, field } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "Anomaly vs. baseline" });
  const cols = 96;
  const rows = 96;
  const values = field(cols, rows, (u, v) => Math.sin(u * 3) + 0.6 * Math.cos(v * 5) - 0.4);

  plot.addHeatmap({
    values, cols, rows,
    extent: { x: [-1, 1], y: [-1, 1] },
    colormap: "RdBu",
    // Without this the neutral colour drifts off zero and the sign stops reading.
    domain: symmetricDomain(values),
    name: "anomaly",
  });
  return () => plot.destroy();
};
