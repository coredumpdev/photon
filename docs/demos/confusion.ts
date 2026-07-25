/** A confusion matrix with per-cell counts and a colorbar. */
import { Plot, addConfusionMatrix } from "@photonviz/core";
import { BASE, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(4);
  const classes = 5;
  const n = 700;
  const yTrue = new Int32Array(n);
  const yPred = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.floor(next() * classes);
    yTrue[i] = t;
    yPred[i] = next() < 0.84 ? t : Math.floor(next() * classes);
  }

  const plot = new Plot(el, { ...BASE, title: "Confusion matrix", showToolbar: false });
  addConfusionMatrix(plot, { yTrue, yPred, classes, colormap: "viridis" });
  return () => plot.destroy();
};
