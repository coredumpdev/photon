/** GPU raymarching through a 3D scalar field. */
import { Plot3D } from "@photonviz/core";

export default (el: HTMLElement) => {
  const plot = new Plot3D(el, { title: "Two blobs", autoRotate: true });
  const d = 56;
  const values = new Float64Array(d * d * d);
  for (let z = 0; z < d; z++) {
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        const u = (x / (d - 1)) * 2 - 1;
        const v = (y / (d - 1)) * 2 - 1;
        const w = (z / (d - 1)) * 2 - 1;
        values[x + y * d + z * d * d] =
          Math.exp(-((u - 0.3) ** 2 + v * v + w * w) * 7) +
          Math.exp(-((u + 0.35) ** 2 + (v - 0.2) ** 2 + w * w) * 9);
      }
    }
  }
  plot.addVolume({ values, dims: [d, d, d], colormap: "inferno", density: 0.9, name: "density" });
  return () => plot.destroy();
};
