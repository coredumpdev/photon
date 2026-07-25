/** A lit height field — drag to orbit, wheel to zoom. */
import { Plot3D } from "@photonviz/core";
import { field } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot3D(el, {
    title: "sinc",
    axisLabels: { x: "x", y: "z", z: "y" },
    lightControls: true,
  });
  const cols = 96;
  const rows = 96;
  const values = field(cols, rows, (u, v) => {
    const r = Math.hypot(u, v) * 6;
    return Math.sin(r) / (r + 0.8);
  });
  plot.addSurface({ values, cols, rows, colormap: "turbo", name: "height" });
  return () => plot.destroy();
};
