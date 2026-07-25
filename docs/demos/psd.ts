/** Welch's method: averaged periodograms pull two tones out of heavy noise. */
import { Plot, addPsd } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(9);
  const sr = 500;
  const n = 8192;
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    signal[i] = Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 120 * t) + gauss(next, 0, 0.8);
  }

  const plot = new Plot(el, {
    ...BASE,
    title: "Power spectral density",
    legend: true,
    axes: { x: { title: "Hz" }, y: { title: "dB" } },
  });
  addPsd(plot, { signal, sampleRate: sr, segment: 1024, window: "hann" });
  return () => plot.destroy();
};
