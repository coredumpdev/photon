/**
 * The eighteen demo charts, built with @photonviz/core.
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
const SLICES = 5;
const IMPULSES = 24;
const TRIALS = 14;
const BOXES = 5;
const BOX_SAMPLES = 60;
const FIELD_COLS = 96;
const FIELD_ROWS = 72;
const SPRITE = 16;
const SESSIONS = 34;
const DENSE_POINTS = 24000;
const FLOW = 14;
const ISO_LEVELS = 9;
const NODES = 48;
const GRAPH_EDGES = 72;

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
    // Two named series, so this is the panel with something to legend.
    legend: { position: "bottom-left" },
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

function share(container) {
  const plot = new Plot(container, {
    ...common,
    title: "Share",
    // A pie has no axes worth reading, and the grid behind it is noise.
    axes: {
      x: { showAxisLine: false, showTicks: false, showGrid: false },
      y: { showAxisLine: false, showTicks: false, showGrid: false },
    },
  });
  plot.addPie({ values: [38, 24, 18, 12, 8], radius: 1.0, innerRadius: 0.55 });
  return plot;
}

function impulse(container) {
  const xs = new Float64Array(IMPULSES);
  const ys = new Float64Array(IMPULSES);
  for (let i = 0; i < IMPULSES; i++) {
    xs[i] = i;
    ys[i] = Math.exp(-i * 0.12) * Math.cos(i * 0.7);
  }
  const plot = new Plot(container, {
    ...common,
    title: "Impulse",
    axes: { x: { title: "n" }, y: { title: "h[n]" } },
  });
  plot.addStem({ x: xs, y: ys, color: "#22d3ee", width: 2, markerSize: 7 });
  return plot;
}

function yieldCurve(container) {
  const xs = new Float64Array(TRIALS);
  const ys = new Float64Array(TRIALS);
  const err = new Float64Array(TRIALS);
  for (let i = 0; i < TRIALS; i++) {
    const dose = i * 0.5;
    xs[i] = dose;
    ys[i] = 90.0 / (1.0 + Math.exp(-(dose - 3.2) * 1.1));
    err[i] = 3.0 + ys[i] * 0.09;
  }
  const plot = new Plot(container, {
    ...common,
    title: "Yield",
    axes: { x: { title: "dose (mg)" }, y: { title: "yield (%)" } },
  });
  plot.addErrorBar({ x: xs, y: ys, yerr: err, band: true, color: "#f59e0b" });
  plot.addLine({ x: xs, y: ys, color: "#f59e0b", width: 2 });
  return plot;
}

function latency(container) {
  const centre = [1.6, 2.0, 2.35, 1.85, 2.6];
  const spread = [0.28, 0.34, 0.22, 0.55, 0.30];
  const colors = ["#38bdf8", "#22d3ee", "#34d399", "#facc15", "#f472b6"];

  // The same LCG as the C panels, drawn in the same order, so the quartiles
  // match rather than merely resemble each other.
  let seed = 987654321;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216.0;
  };
  const groups = [];
  for (let b = 0; b < BOXES; b++) {
    const values = new Float64Array(BOX_SAMPLES);
    for (let i = 0; i < BOX_SAMPLES; i++) {
      const u = next();
      const v = next();
      const gauss = Math.sqrt(-2.0 * Math.log(u + 1e-12)) * Math.cos(6.283185307179586 * v);
      values[i] = Math.exp(centre[b] + spread[b] * gauss);
    }
    groups.push({ position: b, values, color: colors[b] });
  }

  const plot = new Plot(container, {
    ...common,
    title: "Latency",
    axes: {
      x: {
        title: "service",
        ticks: [
          { value: 0, label: "api" }, { value: 1, label: "auth" },
          { value: 2, label: "db" }, { value: 3, label: "cdn" },
          { value: 4, label: "ui" },
        ],
      },
      y: { title: "ms" },
    },
  });
  plot.addBox({ groups, width: 0.62 });
  return plot;
}

/** The interference field at time `t` — it travels, driven by the same clock. */
function fieldValues(t) {
  const values = new Float64Array(FIELD_COLS * FIELD_ROWS);
  for (let row = 0; row < FIELD_ROWS; row++) {
    for (let col = 0; col < FIELD_COLS; col++) {
      const x = (col - FIELD_COLS * 0.5) * 0.12;
      const y = (row - FIELD_ROWS * 0.5) * 0.12;
      const r1 = Math.sqrt((x + 2) * (x + 2) + y * y);
      const r2 = Math.sqrt((x - 2) * (x - 2) + y * y);
      values[row * FIELD_COLS + col] = Math.sin(r1 * 3 - t) + Math.sin(r2 * 3 - t);
    }
  }
  return values;
}

function field(container) {
  const plot = new Plot(container, {
    ...common,
    title: "Field",
    axes: { x: { title: "x" }, y: { title: "y" } },
  });
  // Diverging, because the field is signed and its zero means something —
  // paired with a fixed domain centred on it, so the colours mean the same
  // thing from frame to frame as the waves travel.
  plot.addHeatmap({
    values: fieldValues(STREAM_SECONDS * 2),
    cols: FIELD_COLS, rows: FIELD_ROWS,
    extent: { x: [-6, 6], y: [-4.5, 4.5] },
    colormap: "RdBu",
    domain: [-2, 2],
  });
  return plot;
}

function sprite(container) {
  const pixels = new Uint8ClampedArray(SPRITE * SPRITE * 4);
  for (let row = 0; row < SPRITE; row++) {
    for (let col = 0; col < SPRITE; col++) {
      const dx = col - (SPRITE - 1) / 2;
      const dy = row - (SPRITE - 1) / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / (SPRITE / 2);
      const ring = d > 0.78 && d < 0.98 ? 1 : 0;
      const disc = d < 0.62 ? 1 - d : 0;
      const base = (row * SPRITE + col) * 4;
      pixels[base] = 255 * (ring + disc * 0.2);
      pixels[base + 1] = 255 * disc * 0.9;
      pixels[base + 2] = 255 * (ring * 0.3 + disc);
      pixels[base + 3] = ring > 0 || disc > 0 ? 255 : 0;
    }
  }
  const source = new ImageData(pixels, SPRITE, SPRITE);

  const plot = new Plot(container, {
    ...common,
    title: "Sprite",
    axes: { x: { title: "x" }, y: { title: "y" } },
  });
  plot.addImage({ source, extent: { x: [0, 4], y: [0, 4] }, smooth: false });
  plot.addImage({ source, extent: { x: [2.5, 6.5], y: [1.5, 5.5] }, opacity: 0.65 });
  return plot;
}

/** The five OHLC arrays plus the session dates, shared by the last two panels. */
function sessions() {
  const index = new Float64Array(SESSIONS);
  const time = new Float64Array(SESSIONS);
  const open = new Float64Array(SESSIONS);
  const high = new Float64Array(SESSIONS);
  const low = new Float64Array(SESSIONS);
  const close = new Float64Array(SESSIONS);

  let seed = 24681357;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216.0;
  };
  let price = 100;
  let day = 1704067200000; // 2024-01-01T00:00:00Z, a Monday
  for (let i = 0; i < SESSIONS; i++) {
    const drift = (next() - 0.48) * 3.2;
    const reach = next() * 2.4 + 0.4;
    const o = price;
    const c = price + drift;
    index[i] = i;
    time[i] = day;
    open[i] = o;
    close[i] = c;
    high[i] = Math.max(o, c) + reach;
    low[i] = Math.min(o, c) - reach;
    price = c;
    // Skip the weekend, so consecutive indices are consecutive sessions.
    day += 86400000;
    if ((i + 1) % 7 === 4) day += 2 * 86400000;
  }
  return { index, time, open, high, low, close };
}

const SESSION_BARS = sessions();

function sessionPlot(container, title) {
  return new Plot(container, {
    ...common,
    title,
    // The x values are indices; `times` is what turns them back into dates for
    // the tick labels, and what collapses the weekends between them.
    scales: { x: { type: "ordinal-time", times: SESSION_BARS.time } },
    axes: { x: { title: "session" }, y: { title: "price" } },
  });
}

function candles(container) {
  const plot = sessionPlot(container, "Candles");
  const { index, open, high, low, close } = SESSION_BARS;
  plot.addCandlestick({ x: index, open, high, low, close });
  // Annotations are what a price chart is usually marked up with: a value area,
  // the level it is measured from, and a trendline through the low.
  plot.addAnnotation({ type: "band", dim: "y", from: 96, to: 100, color: "rgba(56,189,248,0.15)" });
  plot.addAnnotation({ type: "span", dim: "y", value: 100, color: "#94a3b8", dash: [5, 4] });
  plot.addAnnotation({ type: "line", x0: 12, y0: 91, x1: 33, y1: 103, color: "#a3e635", width: 1.5 });
  return plot;
}

function bars(container) {
  const plot = sessionPlot(container, "Bars");
  const { index, open, high, low, close } = SESSION_BARS;
  plot.addOhlc({ x: index, open, high, low, close });
  return plot;
}

function density(container) {
  const xs = new Float64Array(DENSE_POINTS);
  const ys = new Float64Array(DENSE_POINTS);
  let seed = 13572468;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216.0;
  };
  for (let i = 0; i < DENSE_POINTS; i++) {
    const u = next();
    const v = next();
    const radius = Math.sqrt(-2 * Math.log(u + 1e-12));
    const angle = 6.283185307179586 * v;
    const cx = i % 3 === 0 ? 2.2 : -1.4;
    const cy = i % 3 === 0 ? 1.1 : -0.7;
    xs[i] = cx + radius * Math.cos(angle) * 1.15;
    ys[i] = cy + radius * Math.sin(angle) * 0.85;
  }

  const plot = new Plot(container, {
    ...common,
    title: "Density",
    axes: { x: { title: "x" }, y: { title: "y" } },
  });
  plot.addHexbin({ x: xs, y: ys, radius: 0.16, colormap: "magma" });
  return plot;
}

function flow(container) {
  const n = FLOW * FLOW;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const us = new Float64Array(n);
  const vs = new Float64Array(n);
  for (let row = 0; row < FLOW; row++) {
    for (let col = 0; col < FLOW; col++) {
      const x = -3 + col * (6 / (FLOW - 1));
      const y = -3 + row * (6 / (FLOW - 1));
      const r2 = x * x + y * y + 0.6;
      const i = row * FLOW + col;
      xs[i] = x;
      ys[i] = y;
      us[i] = ((-y - x * 0.35) / r2) * 4;
      vs[i] = ((x - y * 0.35) / r2) * 4;
    }
  }

  const plot = new Plot(container, {
    ...common,
    title: "Flow",
    axes: { x: { title: "x" }, y: { title: "y" } },
  });
  // No values given, so the colour follows each arrow's own magnitude.
  plot.addQuiver({ x: xs, y: ys, u: us, v: vs, width: 2, colorBy: { colormap: "turbo" } });
  return plot;
}

function contour(container) {
  // The contour panel is the *static* field: only the heatmap streams.
  const values = fieldValues(0);

  const plot = new Plot(container, {
    ...common,
    title: "Contour",
    axes: { x: { title: "x" }, y: { title: "y" } },
  });
  // No `color`, so each level takes its own from the colormap.
  plot.addContour({
    values, cols: FIELD_COLS, rows: FIELD_ROWS,
    extent: { x: [-6, 6], y: [-4.5, 4.5] },
    levels: ISO_LEVELS,
    colormap: "turbo",
  });
  return plot;
}

function network(container) {
  const edges = [];
  let seed = 99887766;
  const nextInt = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) & 0xffffff;
  };
  for (let i = 0; i < NODES; i++) edges.push([i, (i + 1) % NODES]);
  for (let i = NODES; i < GRAPH_EDGES; i++) {
    const a = nextInt() % NODES;
    const b = nextInt() % NODES;
    edges.push([a, b === a ? (a + NODES / 2) % NODES : b]);
  }

  const plot = new Plot(container, {
    ...common,
    title: "Network",
    // A force layout's axes are arbitrary units, so the numbers mean nothing.
    axes: { x: { showTicks: false, showGrid: false }, y: { showTicks: false, showGrid: false } },
  });
  // No x/y: the layer lays it out from the edges alone, the same way the
  // native one does when no positions are given.
  plot.addGraph({
    edges, nodes: NODES,
    nodeColor: "#f472b6", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 9,
  });
  return plot;
}

export const PANELS = [waves, decay, scatter, streaming, revenue, funnel,
                       share, impulse, yieldCurve, latency, field, sprite,
                       candles, bars, density, flow, contour, network];
