/** Grouped bars on a categorical axis. */
import { Plot } from "@photonviz/core";
import { BASE } from "./_data";

export default (el: HTMLElement) => {
  const quarters = ["Q1", "Q2", "Q3", "Q4"];
  const plot = new Plot(el, {
    ...BASE,
    title: "Revenue by quarter",
    legend: true,
    scales: { x: { type: "categorical", factors: quarters } },
  });

  plot.addGroupedBars({
    x: [0, 1, 2, 3],
    series: [
      { y: [42, 51, 47, 63], color: "#60a5fa", name: "2024" },
      { y: [55, 49, 61, 78], color: "#34d399", name: "2025" },
    ],
  });
  return () => plot.destroy();
};
