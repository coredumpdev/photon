/** A polar rose — drag to rotate, wheel to zoom the radius. */
import { PolarPlot } from "@photonviz/core";

export default (el: HTMLElement) => {
  const plot = new PolarPlot(el, { theme: "dark" });
  const n = 720;
  const theta = new Float64Array(n);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    theta[i] = (i / n) * Math.PI * 2;
    r[i] = 0.4 + 0.6 * Math.abs(Math.cos(3 * theta[i]!));
  }
  plot.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
  return () => plot.destroy();
};
