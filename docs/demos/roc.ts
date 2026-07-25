/** ROC with the chance diagonal; AUC is computed and put in the legend. */
import { Plot, addRocCurve } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(17);
  const n = 800;
  const scores = new Float64Array(n);
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const positive = next() < 0.4;
    labels[i] = positive ? 1 : 0;
    scores[i] = Math.min(1, Math.max(0, gauss(next, positive ? 0.68 : 0.36, 0.17)));
  }

  const plot = new Plot(el, { ...BASE, title: "ROC", legend: true });
  addRocCurve(plot, { scores, labels, fill: true });
  return () => plot.destroy();
};
