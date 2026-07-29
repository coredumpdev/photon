/**
 * The four demo charts, built with @photonviz/core.
 *
 * A transcription of hosts/common/panels.c — deliberately line for line, so the
 * comparison this directory exists to run is comparing the two engines rather
 * than two different charts. Everything numeric here has a counterpart there;
 * if one changes, both must.
 */

import { Plot } from "@photonviz/core";

const SAMPLES = 512;
const SCATTER_POINTS = 1500;
const STREAM_POINTS = 400;

/** The phase the native `--grab` freezes the streaming panel at. */
export const STREAM_SECONDS = 1.7;

const common = {
  theme: "dark",
  background: "#0f172a",
  border: "#0d1117",
  // The native hosts have no toolbar — Faz 2 decided that is the host's job —
  // so the web one has to be turned off or the two pictures differ by a widget.
  showToolbar: false,
  interactive: false,
  hover: false,
};

function waves(container) {
  const xs = new Float64Array(SAMPLES);
  const sine = new Float64Array(SAMPLES);
  const damped = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const t = i * 0.05;
    xs[i] = t;
    sine[i] = Math.sin(t);
    damped[i] = Math.exp(-t * 0.12) * Math.cos(t * 1.6);
  }
  const plot = new Plot(container, {
    ...common,
    title: "Waves",
    axes: { x: { title: "time (s)", minorTicks: 4 }, y: { title: "amplitude" } },
  });
  plot.addLine({ x: xs, y: sine, color: "#38bdf8", width: 2, name: "sin t" });
  plot.addLine({
    x: xs, y: damped, color: "#f472b6", width: 2, name: "damped",
    dash: [6, 4], join: "miter",
  });
  return plot;
}

function decay(container) {
  const xs = new Float64Array(SAMPLES);
  const ys = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    xs[i] = i;
    ys[i] = 1.0e6 * Math.exp(-i * 0.022) + 1.0;
  }
  const plot = new Plot(container, {
    ...common,
    title: "Log decay",
    scales: { y: { type: "log" } },
    axes: { x: { title: "sample" }, y: { title: "counts" } },
  });
  plot.addLine({ x: xs, y: ys, color: "#a3e635", width: 2 });
  return plot;
}

function scatter(container) {
  const xs = new Float64Array(SCATTER_POINTS);
  const ys = new Float64Array(SCATTER_POINTS);
  const sizes = new Float32Array(SCATTER_POINTS);
  const colors = new Array(SCATTER_POINTS);

  // The same plain LCG the C panels use, in the same order, so the point cloud
  // is identical rather than merely similar. 32-bit wraparound is explicit
  // because JavaScript numbers are doubles.
  let seed = 12345;
  const palette = ["#60a5fa", "#f59e0b", "#34d399", "#f87171"];
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216.0;
  };
  for (let i = 0; i < SCATTER_POINTS; i++) {
    const u = next();
    const v = next();
    const radius = Math.sqrt(-2.0 * Math.log(u + 1e-12));
    const angle = 6.283185307179586 * v;
    xs[i] = radius * Math.cos(angle);
    ys[i] = radius * Math.sin(angle) * 0.6 + xs[i] * 0.35;
    sizes[i] = 3.0 + u * 7.0;
    colors[i] = palette[i & 3];
  }

  const plot = new Plot(container, {
    ...common,
    title: "Scatter",
    axes: {
      x: {
        title: "x",
        ticks: [
          { value: -3.0 }, { value: -1.5 }, { value: 0.0, label: "origin" },
          { value: 1.5 }, { value: 3.0 },
        ],
      },
      y: { title: "y" },
    },
  });
  plot.addScatter({ x: xs, y: ys, sizes, colors, marker: "circle" });
  return plot;
}

function streaming(container) {
  const xs = new Float64Array(STREAM_POINTS);
  const ys = new Float64Array(STREAM_POINTS);
  for (let i = 0; i < STREAM_POINTS; i++) {
    xs[i] = i;
    const phase = STREAM_SECONDS * 2.0 + i * 0.035;
    ys[i] = Math.sin(phase) + 0.4 * Math.sin(phase * 3.1 + 1.0) + 0.15 * Math.sin(phase * 7.7);
  }
  const plot = new Plot(container, {
    ...common,
    title: "Streaming",
    scales: { y: { domain: [-2.2, 2.2] } },
    axes: { x: { title: "tick" }, y: { title: "value" } },
  });
  plot.addLine({ x: xs, y: ys, color: "#c084fc", width: 1.5, renderType: "dynamic" });
  return plot;
}

function revenue(container) {
  const REVENUE = [42, 47, 51, 49, 58, 63, 61, 68, 72, 70, 78, 84];
  const month = REVENUE.map((_, i) => i);
  const low = REVENUE.map((v) => v * 0.82);
  const high = REVENUE.map((v) => v * 1.14);

  const plot = new Plot(container, {
    ...common,
    title: "Revenue",
    axes: { x: { title: "month" }, y: { title: "k$" } },
  });
  // The band first, so the bars land on top of it — layers draw in the order
  // they were added, in both cores.
  plot.addArea({ x: month, y: high, base: low, color: "rgba(56,189,248,0.24)" });
  plot.addBar({ x: month, y: REVENUE, width: 0.62, color: "#3b82f6" });
  return plot;
}

function funnel(container) {
  const reach = [1.0, 0.72, 0.46, 0.28, 0.15, 0.09];
  const colors = ["#38bdf8", "#22d3ee", "#34d399", "#a3e635", "#facc15"];
  const patches = [];
  for (let i = 0; i < 5; i++) {
    const top = 5 - i;
    const bottom = top - 0.86;
    const halfTop = reach[i] / 2;
    const halfBottom = reach[i + 1] / 2;
    patches.push({
      x: [0.5 - halfTop, 0.5 + halfTop, 0.5 + halfBottom, 0.5 - halfBottom],
      y: [top, top, bottom, bottom],
      color: colors[i],
    });
  }

  const plot = new Plot(container, {
    ...common,
    title: "Funnel",
    axes: { x: { title: "share" }, y: { title: "stage" } },
  });
  plot.addPatches({ patches });
  return plot;
}

export const PANELS = [waves, decay, scatter, streaming, revenue, funnel];
