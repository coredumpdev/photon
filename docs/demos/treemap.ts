/** Squarified treemap — a pure layout plus one patches layer. */
import { Plot, addTreemap } from "@photonviz/core";
import { BASE } from "./_data";

export default (el: HTMLElement) => {
  const plot = new Plot(el, { ...BASE, title: "Storage by bucket", showToolbar: false });
  addTreemap(plot, {
    items: [
      { label: "media", value: 412 },
      { label: "backups", value: 268 },
      { label: "logs", value: 141 },
      { label: "db", value: 96 },
      { label: "static", value: 63 },
      { label: "tmp", value: 28 },
    ],
    colors: "okabe-ito",
  });
  return () => plot.destroy();
};
