/**
 * The thirty-three demo charts, built with @photonviz/core.
 *
 * A transcription of hosts/common/panels.c — deliberately line for line, so the
 * comparison this directory exists to run is comparing the two engines rather
 * than two different charts. Everything numeric here has a counterpart there;
 * if one changes, both must.
 */

import {
  Plot, addChord, addGauge, addParallelCoordinates, addSankey, addSunburst, addTreemap,
  bollinger, linearTrend, loess, pca, rocCurve, welch,
} from "@photonviz/core";

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
const BOLLINGER_PERIOD = 10;
const FIT_POINTS = 160;
const FIT_GRID = 60;
const PSD_SAMPLES = 2048;
const PSD_SEGMENT = 256;
const PSD_RATE = 256;
const ROC_SAMPLES = 240;
const EMBED_POINTS = 300;
const EMBED_DIMS = 4;
const PARALLEL_DIMS = 4;
const PARALLEL_ROWS = 40;
const STREAMS = 3;
const HIST_SAMPLES = 4000;

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
      // A choropleth: the value beats the colour above, and earns a colorbar.
      value: 5 - i,
    });
  }

  const plot = new Plot(container, {
    ...common,
    title: "Funnel",
    axes: { x: { title: "share" }, y: { title: "stage" } },
  });
  plot.addPatches({ patches, colormap: "cividis" });
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

function signals(container) {
  const plot = sessionPlot(container, "Signals");
  const { index, open, high, low, close } = SESSION_BARS;
  plot.addCandlestick({ x: index, open, high, low, close });
  // The indicator is not a layer: bollinger() turns one array into three and
  // three ordinary line layers draw them. Exactly what panels.c does through
  // ph_fin_bollinger, which is the point of comparing this panel at all.
  const { middle, upper, lower } = bollinger(close, BOLLINGER_PERIOD, 2);
  plot.addLine({ x: index, y: middle, color: "#facc15", width: 1.25, name: "SMA 10" });
  // The two edges share a colour and a dash: they are one band, drawn twice.
  const edge = { color: "#38bdf8", width: 1.25, dash: [4, 3] };
  plot.addLine({ x: index, y: upper, ...edge, name: "+2 sigma" });
  plot.addLine({ x: index, y: lower, ...edge, name: "-2 sigma" });
  return plot;
}

function fit(container) {
  const xs = new Float64Array(FIT_POINTS);
  const ys = new Float64Array(FIT_POINTS);
  let seed = 24681357;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < FIT_POINTS; i++) {
    const x = -3 + i * (6 / (FIT_POINTS - 1));
    const noise = (nextUnit() - 0.5) * 2.4;
    xs[i] = x;
    ys[i] = 0.6 * x * x - 0.4 * x + 1 + noise;
  }
  const smooth = loess(xs, ys, { bandwidth: 0.3, points: FIT_GRID });
  const straight = linearTrend(xs, ys, { points: 2 });

  const plot = new Plot(container, {
    ...common,
    title: "Fit",
    axes: { x: { title: "x" }, y: { title: "y" } },
  });
  plot.addScatter({ x: xs, y: ys, size: 4, color: "#64748b", marker: "circle" });
  // The OLS line through a symmetric parabola is flat; LOESS is not. Drawing
  // both is the point of the panel.
  plot.addLine({ x: straight.x, y: straight.y, color: "#f87171", width: 1.5, dash: [6, 4],
                 name: "least squares" });
  plot.addLine({ x: smooth.x, y: smooth.y, color: "#22d3ee", width: 2.5, name: "loess" });
  return plot;
}

function spectrum(container) {
  const signal = new Float64Array(PSD_SAMPLES);
  let seed = 31415926;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < PSD_SAMPLES; i++) {
    const t = i / PSD_RATE;
    const noise = (nextUnit() - 0.5) * 0.8;
    signal[i] = Math.sin(2 * Math.PI * 24 * t) + 0.5 * Math.sin(2 * Math.PI * 61 * t) + noise;
  }
  const psd = welch(signal, { segment: PSD_SEGMENT, overlap: 0.5, window: "hann", sampleRate: PSD_RATE });

  const plot = new Plot(container, {
    ...common,
    title: "Spectrum",
    // Power spans four decades, so a linear axis would show one spike and a
    // flat line where the noise floor is.
    scales: { y: { type: "log" } },
    axes: { x: { title: "frequency (Hz)" }, y: { title: "power" } },
  });
  plot.addLine({ x: psd.frequencies, y: psd.power, color: "#a3e635", width: 1.5 });
  return plot;
}

function roc(container) {
  const scores = new Float64Array(ROC_SAMPLES);
  const labels = new Float64Array(ROC_SAMPLES);
  let seed = 55443322;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < ROC_SAMPLES; i++) {
    const positive = i % 2 === 0;
    const u = nextUnit();
    const v = nextUnit();
    // Box-Muller, so the two score distributions are Gaussian and overlap.
    const g = Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
    labels[i] = positive ? 1 : 0;
    scores[i] = (positive ? 1.1 : -1.1) + g * 0.9;
  }
  const curve = rocCurve(scores, labels);
  const hundredths = Math.round(curve.auc * 100);

  const plot = new Plot(container, {
    ...common,
    title: `ROC ${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`,
    axes: { x: { title: "false positive rate" }, y: { title: "true positive rate" } },
  });
  plot.addLine({ x: [0, 1], y: [0, 1], color: "#64748b", width: 1, dash: [5, 5], name: "chance" });
  plot.addLine({ x: curve.fpr, y: curve.tpr, color: "#f472b6", width: 2, name: "model" });
  return plot;
}

function embedding(container) {
  const centres = [[2.5, 0, -1, 0.5], [-2, 2, 0.5, -1], [0, -2.5, 2, 1.5]];
  const classColor = ["#60a5fa", "#f59e0b", "#34d399"];
  const raw = new Float64Array(EMBED_POINTS * EMBED_DIMS);
  const colors = new Array(EMBED_POINTS);
  let seed = 77665544;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < EMBED_POINTS; i++) {
    const cluster = i % 3;
    for (let d = 0; d < EMBED_DIMS; d++) {
      const u = nextUnit();
      const v = nextUnit();
      const g = Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
      raw[i * EMBED_DIMS + d] = centres[cluster][d] + g * 0.55;
    }
    colors[i] = classColor[cluster];
  }
  const { scores } = pca(raw, EMBED_POINTS, EMBED_DIMS, 2);
  const xs = new Float64Array(EMBED_POINTS);
  const ys = new Float64Array(EMBED_POINTS);
  for (let i = 0; i < EMBED_POINTS; i++) { xs[i] = scores[i * 2]; ys[i] = scores[i * 2 + 1]; }

  const plot = new Plot(container, {
    ...common,
    title: "Embedding",
    axes: { x: { title: "PC 1" }, y: { title: "PC 2" } },
  });
  // The colours are the true classes, which the projection never saw.
  plot.addScatter({ x: xs, y: ys, size: 5, colors, marker: "circle" });
  return plot;
}

/** Axes with no meaning to show: a composed chart's coordinates are arbitrary. */
const bare = { showTicks: false, showGrid: false };

function treemap(container) {
  const products = ["Search", "Cloud", "Ads", "Devices", "Media", "Support", "Labs", "Other"];
  const share = [38, 24, 16, 9, 6, 4, 2, 1];
  const plot = new Plot(container, {
    ...common,
    title: "Treemap",
    axes: { x: bare, y: bare },
  });
  addTreemap(plot, { items: products.map((label, i) => ({ label, value: share[i] })) });
  return plot;
}

/** The regions-and-cities hierarchy the sunburst draws. */
function hierarchy() {
  return {
    name: "world",
    children: [
      { name: "EMEA", children: [{ name: "London", value: 5 }, { name: "Berlin", value: 4 }, { name: "Paris", value: 3 }] },
      { name: "APAC", children: [{ name: "Tokyo", value: 6 }, { name: "Seoul", value: 3 }, { name: "Sydney", value: 2 }] },
      { name: "AMER", children: [{ name: "NYC", value: 7 }, { name: "SF", value: 5 }, { name: "Toronto", value: 2 }] },
    ],
  };
}

function sunburst(container) {
  const plot = new Plot(container, {
    ...common,
    title: "Sunburst",
    axes: { x: bare, y: bare },
    // The rings are circles only if one data unit is the same length on both
    // axes, which is the whole job of the equal-aspect lock.
    equalAspect: true,
  });
  addSunburst(plot, { root: hierarchy() });
  return plot;
}

function sankey(container) {
  const names = ["coal", "gas", "grid", "loss", "homes", "works"];
  const wiring = [[0, 2, 30], [1, 2, 45], [2, 3, 18], [2, 4, 34], [2, 5, 23], [1, 5, 6]];
  const plot = new Plot(container, {
    ...common,
    title: "Sankey",
    axes: { x: bare, y: bare },
  });
  addSankey(plot, {
    nodes: names.map((name) => ({ name })),
    links: wiring.map(([source, target, value]) => ({ source, target, value })),
  });
  return plot;
}

function chord(container) {
  const trade = [[0, 12, 7, 4], [9, 0, 11, 3], [5, 8, 0, 14], [6, 2, 10, 0]];
  const plot = new Plot(container, {
    ...common,
    title: "Chord",
    axes: { x: bare, y: bare },
    equalAspect: true,
  });
  addChord(plot, { matrix: trade, labels: ["EU", "US", "CN", "JP"] });
  return plot;
}

function gauge(container) {
  const plot = new Plot(container, {
    ...common,
    title: "Gauge",
    axes: { x: bare, y: bare },
    equalAspect: true,
  });
  addGauge(plot, {
    value: 62,
    thresholds: [{ value: 50, color: "#f59e0b" }, { value: 80, color: "#ef4444" }],
    trackColor: "rgba(51,65,85,0.4)",
    needleColor: "#e2e8f0",
  });
  return plot;
}

function parallel(container) {
  const dims = ["sepal", "petal", "weight", "score"];
  const rows = [];
  const classes = [];
  let seed = 19283746;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let r = 0; r < PARALLEL_ROWS; r++) {
    const cls = r % 2;
    classes.push(cls);
    const row = [];
    for (let d = 0; d < PARALLEL_DIMS; d++) {
      const noise = (nextUnit() - 0.5) * 0.6;
      row.push((cls ? 1 + d * 0.4 : 3 - d * 0.5) + noise);
    }
    rows.push(row);
  }
  const plot = new Plot(container, {
    ...common,
    title: "Parallel",
    axes: { x: bare, y: { title: "normalised" } },
  });
  addParallelCoordinates(plot, { dimensions: dims, rows, colorBy: classes, width: 1.5 });
  return plot;
}

/** The three revenue streams the grouped and stacked panels share. */
function streams() {
  const revenue = [42, 47, 51, 49, 58, 63, 61, 68, 72, 70, 78, 84];
  const weight = [0.55, 0.3, 0.15];
  const names = ["licence", "services", "support"];
  const colors = ["#60a5fa", "#f59e0b", "#34d399"];
  return Array.from({ length: STREAMS }, (_, s) => ({
    y: Float64Array.from(revenue, (v) => v * weight[s]),
    color: colors[s],
    name: names[s],
  }));
}

const MONTH_X = Float64Array.from({ length: 12 }, (_, i) => i);

function grouped(container) {
  const plot = new Plot(container, {
    ...common,
    title: "Grouped",
    axes: { x: { title: "month" }, y: { title: "revenue" } },
  });
  plot.addGroupedBars({ x: MONTH_X, series: streams() });
  return plot;
}

function stacked(container) {
  const plot = new Plot(container, {
    ...common,
    title: "Stacked",
    axes: { x: { title: "month" }, y: { title: "revenue" } },
    legend: { position: "top-left" },
  });
  plot.addStackedArea({ x: MONTH_X, series: streams() });
  return plot;
}

function histogramPanel(container) {
  const values = new Float64Array(HIST_SAMPLES);
  let seed = 44556677;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < HIST_SAMPLES; i++) {
    const u = nextUnit();
    const v = nextUnit();
    const g = Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v);
    values[i] = (i % 3 === 0 ? 6 : 2) + g * (i % 3 === 0 ? 0.8 : 1.2);
  }
  const plot = new Plot(container, {
    ...common,
    title: "Histogram",
    axes: { x: { title: "value" }, y: { title: "count" } },
  });
  plot.addHistogram(values, { bins: 40, color: "#38bdf8" });
  return plot;
}

function spectrogramPanel(container) {
  const signal = new Float64Array(PSD_SAMPLES);
  let seed = 31415926;
  const nextUnit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffffff) / 16777216;
  };
  for (let i = 0; i < PSD_SAMPLES; i++) {
    const t = i / PSD_RATE;
    const noise = (nextUnit() - 0.5) * 0.8;
    signal[i] = Math.sin(2 * Math.PI * 24 * t) + 0.5 * Math.sin(2 * Math.PI * 61 * t) + noise;
  }
  const plot = new Plot(container, {
    ...common,
    title: "Spectrogram",
    axes: { x: { title: "time (s)" }, y: { title: "frequency (Hz)" } },
  });
  // The same two tones as the Spectrum panel, seen the other way round: the PSD
  // says what frequencies are there, this says when.
  plot.addHeatmapSpectrogram(signal, { fftSize: 128, sampleRate: PSD_RATE });
  return plot;
}

export const PANELS = [waves, decay, scatter, streaming, revenue, funnel,
                       share, impulse, yieldCurve, latency, field, sprite,
                       candles, bars, density, flow, contour, network, signals,
                       fit, spectrum, roc, embedding, treemap, sunburst, sankey,
                       chord, gauge, parallel, grouped, stacked, histogramPanel,
                       spectrogramPanel];
