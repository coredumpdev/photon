/** A correlation matrix, locked to ±1 on a diverging map. */
import { Plot, addCorrMatrix } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(21);
  const n = 400;
  const age = Float64Array.from({ length: n }, () => gauss(next));
  const income = Float64Array.from(age, (v) => v * 0.85 + gauss(next, 0, 0.5));
  const debt = Float64Array.from(income, (v) => -v * 0.55 + gauss(next, 0, 0.8));
  const noise = Float64Array.from({ length: n }, () => gauss(next));

  const plot = new Plot(el, { ...BASE, title: "Correlation", equalAspect: true });
  addCorrMatrix(plot, { columns: [age, income, debt, noise], names: ["age", "income", "debt", "noise"] });
  return () => plot.destroy();
};
