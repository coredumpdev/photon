/** Streamlines of a vector field, coloured by speed. */
import { Plot, addStreamplot } from "@photonviz/core";
import { BASE } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "streamplot — a dipole", equalAspect: true });
  const cols = 48;
  const rows = 48;
  const u = new Float64Array(cols * rows);
  const v = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -2 + (4 * c) / (cols - 1);
      const y = -2 + (4 * r) / (rows - 1);
      // Two opposite sources, so the field has a saddle between them.
      const d1 = Math.max(0.05, (x + 1) ** 2 + y * y);
      const d2 = Math.max(0.05, (x - 1) ** 2 + y * y);
      u[r * cols + c] = (x + 1) / d1 - (x - 1) / d2;
      v[r * cols + c] = y / d1 - y / d2;
    }
  }

  addStreamplot(plot, {
    u, v, cols, rows,
    extent: { x: [-2, 2], y: [-2, 2] },
    colormap: "plasma",
    density: 1.1,
  });
  return () => plot.destroy();
};
