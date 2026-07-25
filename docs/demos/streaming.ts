/** A live series: create the layer once with `renderType: "dynamic"`, then setData. */
import { Plot } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const N = 2000;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = new Float64Array(N);
  const next = rng(2);

  const plot = new Plot(el, { ...BASE, title: "Streaming", legend: true });
  const line = plot.addLine({ x, y, color: "#34d399", width: 1.6, name: "live", renderType: "dynamic" });

  let t = 0;
  let frame = 0;
  const tick = () => {
    // Shift left by one sample and append a fresh one.
    y.copyWithin(0, 1);
    y[N - 1] = Math.sin(t / 18) * 1.2 + gauss(next, 0, 0.18);
    t++;
    line.setData(x, y);
    plot.render();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    plot.destroy();
  };
};
