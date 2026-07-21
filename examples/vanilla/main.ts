import { Plot, Plot3D, PolarPlot } from "@photonviz/core";

const grid = document.getElementById("grid")!;

// One FPS badge per chart, pinned to that chart's top-right corner.
const fpsBadges: HTMLElement[] = [];

function panel(title: string, subtitle = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = "panel";
  const h = document.createElement("h2");
  h.textContent = title;
  if (subtitle) { const s = document.createElement("span"); s.textContent = ` — ${subtitle}`; h.appendChild(s); }
  const chart = document.createElement("div");
  chart.className = "chart";
  el.appendChild(h);
  el.appendChild(chart);
  grid.appendChild(el);

  const badge = document.createElement("div");
  badge.className = "fps";
  badge.style.cssText =
    "position:absolute;top:6px;right:8px;z-index:5;padding:2px 7px;border-radius:6px;" +
    "font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e2e8f0;" +
    "background:rgba(14,21,38,.7);border:1px solid #1e293b;backdrop-filter:blur(3px);" +
    "pointer-events:none;font-variant-numeric:tabular-nums;";
  badge.textContent = "— fps";
  // Plot sets the chart container to position:relative, so this anchors to it.
  chart.appendChild(badge);
  fpsBadges.push(badge);

  return chart;
}

// Global animation loop — every registered updater runs once per frame.
const updaters: Array<(t: number) => void> = [];
let frame = 0;
let fpsAvg = 0;       // smoothed frames-per-second
let lastNow = 0;      // previous frame timestamp (ms)
let fpsPaint = 0;     // throttle the DOM text update
function loop(now: number): void {
  frame++;
  const t = frame / 60;
  for (const u of updaters) u(t);

  if (lastNow > 0) {
    const dt = now - lastNow;
    if (dt > 0) {
      const inst = 1000 / dt;
      // Exponential moving average so the readout doesn't jitter.
      fpsAvg = fpsAvg > 0 ? fpsAvg * 0.9 + inst * 0.1 : inst;
    }
  }
  lastNow = now;
  if (now - fpsPaint > 250) { // repaint ~4x/sec
    fpsPaint = now;
    const text = `${Math.round(fpsAvg)} fps`;
    for (const b of fpsBadges) b.textContent = text;
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Seeded RNG for the static panels (identical every reload).
let seed = 42;
function rand(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gaussian(m: number, sd: number): number {
  const u = rand() || 1e-9, v = rand() || 1e-9;
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ============================ LIVE PANELS ==================================

// Oscilloscope — a single signal scrolling right-to-left.
{
  const p = new Plot(panel("Oscilloscope", "live · scrolling"), { theme: "dark", toolbar: false });
  const N = 600;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
  const line = p.addLine({ x, y, color: "#34d399", width: 2, decimate: false });
  p.setView({ x: [0, N - 1], y: [-2.6, 2.6] });
  let ph = N;
  updaters.push(() => {
    y.copyWithin(0, 1);
    ph += 1;
    y[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + (Math.random() - 0.5) * 0.25;
    line.setData(x, y);
    p.render();
  });
}

// Three live signals.
{
  const p = new Plot(panel("Signals", "live · 3 channels"), { theme: "dark", toolbar: false });
  const N = 500;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const ys = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  ys.forEach((y, i) => { for (let j = 0; j < N; j++) y[j] = Math.sin(j * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + i * 0.1; });
  const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
  const lines = ys.map((y, i) => p.addLine({ x, y, color: colors[i], width: 1.5, decimate: false }));
  p.setView({ x: [0, N - 1], y: [-3.5, 3.5] });
  let ph = N;
  updaters.push(() => {
    ph += 1;
    ys.forEach((y, i) => {
      y.copyWithin(0, 1);
      y[N - 1] = Math.sin(ph * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + (Math.random() - 0.5) * 0.2 + i * 0.1;
      lines[i]!.setData(x, y);
    });
    p.render();
  });
}

// Live scatter cloud (random walk).
{
  const p = new Plot(panel("Scatter", "live · drifting cloud"), { theme: "dark", toolbar: false });
  const M = 700;
  const x = new Float64Array(M), y = new Float64Array(M);
  for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); }
  const sc = p.addScatter({ x, y, size: 5, color: "#818cf8" });
  p.setView({ x: [-4, 4], y: [-4, 4] });
  updaters.push(() => {
    for (let i = 0; i < M; i++) {
      x[i] += (Math.random() - 0.5) * 0.08 - x[i]! * 0.01;
      y[i] += (Math.random() - 0.5) * 0.08 - y[i]! * 0.01;
    }
    sc.setData(x, y);
    p.render();
  });
}

// Live bars.
{
  const p = new Plot(panel("Bars", "live · fluctuating"), { theme: "dark", toolbar: false });
  const K = 9;
  const cats = Float64Array.from({ length: K }, (_, i) => i);
  const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
  const bar = p.addBar({ x: cats, y, width: 0.7, color: "#22d3ee" });
  p.setView({ x: [-0.6, K - 0.4], y: [0, 100] });
  updaters.push(() => {
    for (let i = 0; i < K; i++) {
      y[i] = Math.max(2, Math.min(98, y[i]! + (Math.random() - 0.5) * 8));
    }
    bar.setData(cats, y);
    p.render();
  });
}

// Streaming area.
{
  const p = new Plot(panel("Area", "live · streaming"), { theme: "dark", toolbar: false });
  const N = 400;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
  const area = p.addArea({ x, y, color: "rgba(52,211,153,0.45)" });
  p.setView({ x: [0, N - 1], y: [0, 4] });
  let ph = N;
  updaters.push(() => {
    y.copyWithin(0, 1);
    ph += 1;
    y[N - 1] = 2 + Math.sin(ph * 0.06) + Math.sin(ph * 0.017) * 0.7 + Math.random() * 0.2;
    area.setData(x, y);
    p.render();
  });
}

// Polar radar — rotating sweep + blips.
{
  const pp = new PolarPlot(panel("Polar radar", "rotating sweep"), { theme: "dark", angleUnit: "deg", maxRadius: 1 });
  const sweep = pp.addLine({ theta: [0, 0], r: [0, 1], color: "#22d3ee", width: 2 });
  const B = 14;
  const bt = Float64Array.from({ length: B }, () => rand() * 360);
  const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
  pp.addScatter({ theta: bt, r: br, color: "#f472b6", size: 6 });
  let ang = 0;
  updaters.push(() => {
    ang = (ang + 2.5) % 360;
    sweep.setData([ang, ang], [0, 1]);
  });
}

// Polar rose — morphing r = |cos(k·θ)|.
{
  const pp = new PolarPlot(panel("Polar rose", "morphing curve"), { theme: "dark", maxRadius: 1 });
  const T = 240;
  const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
  const r = new Float64Array(T);
  const rose = pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
  updaters.push((t) => {
    const k = 3 + 2 * Math.sin(t * 0.3);
    for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(k * theta[i]!));
    rose.setData(theta, r);
  });
}

// Live dual-Y.
{
  const p = new Plot(panel("Dual Y", "live · two scales"), { theme: "dark", toolbar: false, axes: { y: { title: "amp" } } });
  p.addYAxis("t", { side: "right", color: "#f472b6", title: "temp" });
  const N = 400;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
  const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
  const l1 = p.addLine({ x, y: a, color: "#60a5fa", width: 1.5, decimate: false });
  const l2 = p.addLine({ x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false });
  p.setView({ x: [0, N - 1], y: [-2, 2], yAxes: { t: [15, 35] } });
  let ph = N;
  updaters.push(() => {
    a.copyWithin(0, 1); b.copyWithin(0, 1);
    ph += 1;
    a[N - 1] = Math.sin(ph * 0.05) * 1.5 + (Math.random() - 0.5) * 0.15;
    b[N - 1] = 25 + Math.sin(ph * 0.02) * 6 + (Math.random() - 0.5) * 0.6;
    l1.setData(x, a); l2.setData(x, b);
    p.render();
  });
}

// ============================ STATIC PANELS ================================

// Histogram.
{
  const p = new Plot(panel("Histogram", "gaussian · 30 bins"), { theme: "dark" });
  const vals = new Float64Array(5000);
  for (let i = 0; i < vals.length; i++) vals[i] = gaussian(0, 1);
  p.addHistogram(vals, { bins: 30, color: "#34d399" });
}

// Box plot.
{
  const p = new Plot(panel("Box plot", "Tukey · outliers"), { theme: "dark" });
  const groups = [0, 1, 2, 3].map((g) => ({
    position: g,
    values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
    color: ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"][g],
  }));
  p.addBox({ groups, width: 0.6 });
}

// Heatmap.
{
  const p = new Plot(panel("Heatmap", "texture · viridis"), { theme: "dark" });
  const cols = 60, rows = 40;
  const values = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const xx = (c / cols) * 6, yy = (r / rows) * 6;
    values[r * cols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
  }
  p.addHeatmap({ values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis" });
}

// Contour.
{
  const p = new Plot(panel("Contour", "marching squares"), { theme: "dark" });
  const cols = 80, rows = 60;
  const values = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const xx = (c / cols) * 6 - 3, yy = (r / rows) * 6 - 3;
    values[r * cols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
  }
  p.addContour({ values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis" });
}

// Spectrogram.
{
  const p = new Plot(panel("Spectrogram", "chirp · STFT"), { theme: "dark", axes: { x: { title: "time" }, y: { title: "freq" } } });
  const N = 16384, sr = 8000;
  const sig = new Float64Array(N);
  for (let i = 0; i < N; i++) { const tt = i / sr; sig[i] = Math.sin(2 * Math.PI * (200 + 1500 * (i / N)) * tt); }
  p.addHeatmapSpectrogram(sig, { fftSize: 256, hop: 128, sampleRate: sr, colormap: "plasma" });
}

// Line joins (miter / bevel / round on sharp corners).
{
  const p = new Plot(panel("Line joins", "miter · bevel · round"), { theme: "dark", toolbar: false });
  const xs: number[] = [];
  const zig: number[] = [];
  for (let i = 0; i <= 12; i++) { xs.push(i); zig.push(i % 2 === 0 ? 0 : 1); } // sharp zigzag
  const styles = ["miter", "bevel", "round"] as const;
  const colors = ["#f472b6", "#60a5fa", "#34d399"];
  styles.forEach((join, k) => {
    const y = zig.map((v) => v + k * 2.2); // stack the three strokes
    p.addLine({ x: xs, y, color: colors[k], width: 8, join, name: join });
  });
}

// 1M points (decimation — GPU transform feedback above 200k points).
{
  const p = new Plot(panel("1M points", "GPU min/max decimation"), { theme: "dark" });
  const N = 1_000_000;
  const x = new Float64Array(N), y = new Float64Array(N);
  for (let i = 0; i < N; i++) { x[i] = i; y[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05); }
  p.addLine({ x, y, color: "#34d399", width: 1.5 });
}

// Hexbin — 2D density of a two-blob cloud.
{
  const p = new Plot(panel("Hexbin", "25k points · density"), { theme: "dark" });
  const M = 25_000;
  const x = new Float64Array(M), y = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const blob = i % 2 === 0 ? -1.4 : 1.4;
    x[i] = gaussian(blob, 1);
    y[i] = gaussian(blob * 0.6, 1.1);
  }
  p.addHexbin({ x, y, radius: 0.22, colormap: "plasma" });
  p.setView({ x: [-5, 5], y: [-5, 5] });
}

// colorBy scatter — points colored by a scalar field.
{
  const p = new Plot(panel("Scatter · colorBy", "value → viridis"), { theme: "dark" });
  const M = 1200;
  const x = new Float64Array(M), y = new Float64Array(M), v = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    x[i] = gaussian(0, 1.4); y[i] = gaussian(0, 1.4);
    v[i] = Math.hypot(x[i]!, y[i]!); // color by distance from origin
  }
  p.addScatter({ x, y, size: 6, colorBy: { values: v, colormap: "viridis" } });
  p.setView({ x: [-5, 5], y: [-5, 5] });
}

// Log axis — exponential decays on a log-y scale (straight lines).
{
  const p = new Plot(panel("Log axis", "exp decay · log y"), {
    theme: "dark", scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } },
  });
  const N = 200;
  const x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10);
  const taus = [1.2, 2.5, 5];
  const colors = ["#f472b6", "#60a5fa", "#34d399"];
  taus.forEach((tau, k) => {
    const y = Float64Array.from(x, (t) => Math.exp(-t / tau) * (1 + gaussian(0, 0.02)) + 1e-3);
    p.addLine({ x, y, color: colors[k], width: 1.5, name: `τ=${tau}` });
  });
}

// Time axis — a day of samples with date-formatted ticks.
{
  const p = new Plot(panel("Time axis", "1 day · date ticks"), {
    theme: "dark", scales: { x: { type: "time" } },
  });
  const start = Date.UTC(2024, 0, 1);
  const N = 24 * 60; // one sample per minute
  const x = new Float64Array(N), y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = start + i * 60_000;
    const h = i / 60;
    y[i] = 20 + 6 * Math.sin((h - 9) / 24 * 2 * Math.PI) + gaussian(0, 0.4); // diurnal curve
  }
  p.addLine({ x, y, color: "#22d3ee", width: 1.5 });
}

// Step line — a digital/staircase signal.
{
  const p = new Plot(panel("Step line", "staircase · step:after"), { theme: "dark", toolbar: false });
  const N = 24;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
  p.addLine({ x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter" });
  p.setView({ x: [0, N - 1], y: [-0.5, 3.5] });
}

// Butt vs miter — the join fix, side by side on sharp corners.
{
  const p = new Plot(panel("Butt vs miter", "gaps vs filled joins"), { theme: "dark", toolbar: false });
  const xs: number[] = [], zig: number[] = [];
  for (let i = 0; i <= 12; i++) { xs.push(i); zig.push(i % 2 === 0 ? 0 : 1); }
  p.addLine({ x: xs, y: zig.map((v) => v + 2.4), color: "#94a3b8", width: 9, join: "butt", name: "butt" });
  p.addLine({ x: xs, y: zig, color: "#f472b6", width: 9, join: "miter", name: "miter" });
}

// Error bars — I-beam whiskers with caps over a line.
{
  const p = new Plot(panel("Error bars", "whiskers + caps"), { theme: "dark" });
  const N = 12;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
  const yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
  p.addLine({ x, y, color: "#60a5fa", width: 1.5 });
  p.addErrorBar({ x, y, yerr, color: "#60a5fa", capSize: 7 });
}

// Error band — shaded confidence ribbon around a curve.
{
  const p = new Plot(panel("Error band", "confidence ribbon"), { theme: "dark" });
  const N = 120;
  const x = Float64Array.from({ length: N }, (_, i) => (i / 10));
  const y = Float64Array.from(x, (t) => Math.sin(t));
  const err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
  p.addErrorBar({ x, y, yerr: err, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28 });
  p.addLine({ x, y, color: "#a78bfa", width: 2 });
}

// Stem plot — a discrete, sampled signal.
{
  const p = new Plot(panel("Stem plot", "discrete signal"), { theme: "dark", toolbar: false });
  const N = 30;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
  p.addStem({ x, y, color: "#34d399", markerSize: 6 });
  p.setView({ x: [-1, N], y: [-1, 1.1] });
}

// Quiver — a rotational vector field, arrows colored by magnitude.
{
  const p = new Plot(panel("Quiver", "vector field"), { theme: "dark" });
  const G = 16;
  const xs: number[] = [], ys: number[] = [], us: number[] = [], vs: number[] = [];
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const x = (i / (G - 1)) * 4 - 2, y = (j / (G - 1)) * 4 - 2;
    xs.push(x); ys.push(y);
    us.push(-y); vs.push(x); // curl / rotation
  }
  p.addQuiver({ x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" } });
  p.setView({ x: [-2.4, 2.4], y: [-2.4, 2.4] });
}

// Candlestick — OHLC random walk on a time axis.
{
  const p = new Plot(panel("Candlestick", "OHLC · daily"), { theme: "dark", scales: { x: { type: "time" } } });
  const N = 40;
  const start = Date.UTC(2024, 0, 1);
  const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price;
    const close = open + gaussian(0, 2.2);
    x[i] = start + i * 86_400_000;
    o[i] = open; c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
    price = close;
  }
  p.addCandlestick({ x, open: o, high: h, low: l, close: c });
}

// 3D surface.
{
  const p3 = new Plot3D(panel("3D surface", "axes · light controls"), {
    axisLabels: { x: "x", y: "z", z: "y" },
    lightControls: true,
  });
  const cols = 64, rows = 64;
  const values = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4;
    const rr = Math.hypot(xx, yy) + 1e-6;
    values[r * cols + c] = (Math.sin(rr * 2) / rr) * 3;
  }
  p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis" });
}

// 3D point cloud.
{
  const p3 = new Plot3D(panel("3D point cloud", "axes · colored by height"), {
    axisLabels: { x: "x", y: "height", z: "z" },
  });
  const N = 6000;
  const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 20, rr = 1 + (i / N) * 2;
    x[i] = Math.cos(th) * rr + gaussian(0, 0.1);
    z[i] = Math.sin(th) * rr + gaussian(0, 0.1);
    y[i] = (i / N) * 4 - 2 + gaussian(0, 0.05);
  }
  p3.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
}
