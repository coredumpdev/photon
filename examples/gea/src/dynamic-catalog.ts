// Dynamic gallery catalog — the same chart types as Static, but animated.
//
// Each entry's `setup(plot)` runs inside the Gea component's `onReady` handle:
// it adds the layers with renderType:"dynamic" through the imperative core Plot
// API and returns an updater `(t) => void`. DynamicTab drives every updater from
// a single requestAnimationFrame loop and repaints the FPS badges.

import type { Plot as CorePlot, Plot3D as CorePlot3D, PolarPlot as CorePolarPlot } from "@photonviz/core";
import { makeRng, jitter, businessDays } from "./data";

export type Updater = (t: number) => void;

export interface Dyn2D { title: string; subtitle?: string; options?: any; setup: (p: CorePlot) => Updater; }
export interface DynPolar { title: string; subtitle?: string; options?: any; setup: (p: CorePolarPlot) => Updater; }
export interface Dyn3D { title: string; subtitle?: string; options?: any; setup: (p: CorePlot3D) => Updater; }

const RT = "dynamic" as const;
const DARK = { theme: "dark" as const };

/** Throttle: run `fn` every `k`th invocation (for expensive rebuilds). */
function every(k: number, fn: Updater): Updater {
  let n = 0;
  return (t) => { if (n++ % k === 0) fn(t); };
}

export function buildDynamic(): { plots2D: Dyn2D[]; polars: DynPolar[]; plots3D: Dyn3D[] } {
  const { rand, gaussian } = makeRng(42);

  const plots2D: Dyn2D[] = [
    {
      title: "Line", subtitle: "live · scrolling", options: DARK,
      setup: (p) => {
        const N = 600;
        const x = Float64Array.from({ length: N }, (_, i) => i);
        const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
        const line = p.addLine({ x, y, color: "#34d399", width: 2, decimate: false, renderType: RT });
        p.setView({ x: [0, N - 1], y: [-2.6, 2.6] });
        let ph = N;
        return () => { y.copyWithin(0, 1); ph++; y[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + jitter() * 0.25; line.setData(x, y); p.render(); };
      },
    },
    {
      title: "Signals", subtitle: "3 channels", options: DARK,
      setup: (p) => {
        const N = 500;
        const x = Float64Array.from({ length: N }, (_, i) => i);
        const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
        const ys = [0, 1, 2].map((i) => Float64Array.from({ length: N }, (_, j) => Math.sin(j * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + i * 0.1));
        const lines = ys.map((y, i) => p.addLine({ x, y, color: colors[i], width: 1.5, decimate: false, renderType: RT }));
        p.setView({ x: [0, N - 1], y: [-3.5, 3.5] });
        let ph = N;
        return () => { ph++; ys.forEach((y, i) => { y.copyWithin(0, 1); y[N - 1] = Math.sin(ph * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + jitter() * 0.2 + i * 0.1; lines[i].setData(x, y); }); p.render(); };
      },
    },
    {
      title: "Scatter", subtitle: "drifting cloud", options: DARK,
      setup: (p) => {
        const M = 700, x = new Float64Array(M), y = new Float64Array(M);
        for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); }
        const sc = p.addScatter({ x, y, size: 5, color: "#818cf8", renderType: RT });
        p.setView({ x: [-4, 4], y: [-4, 4] });
        return () => { for (let i = 0; i < M; i++) { x[i] += jitter() * 0.08 - x[i] * 0.01; y[i] += jitter() * 0.08 - y[i] * 0.01; } sc.setData(x, y); p.render(); };
      },
    },
    {
      title: "Scatter markers", subtitle: "6 glyph shapes", options: { ...DARK, showToolbar: false },
      setup: (p) => {
        const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
        const colors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
        const M = 12, x = Float64Array.from({ length: M }, (_, i) => i);
        const layers = shapes.map((mk, r) => p.addScatter({ x, y: Float64Array.from({ length: M }, () => shapes.length - 1 - r), size: 14, marker: mk, color: colors[r], name: mk, renderType: RT }));
        p.setView({ x: [-1, M], y: [-1, shapes.length] });
        return (t) => { layers.forEach((lyr, r) => { const base = shapes.length - 1 - r; lyr.setData(x, Float64Array.from({ length: M }, (_, i) => base + Math.sin(t * 2 + i * 0.6 + r) * 0.25)); }); p.render(); };
      },
    },
    {
      title: "Scatter · colorBy", subtitle: "value → viridis", options: DARK,
      setup: (p) => {
        const M = 1200, x = new Float64Array(M), y = new Float64Array(M), v = new Float64Array(M);
        for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1.4); y[i] = gaussian(0, 1.4); v[i] = Math.hypot(x[i], y[i]); }
        const sc = p.addScatter({ x, y, size: 6, colorBy: { values: v, colormap: "viridis" }, renderType: RT });
        p.setView({ x: [-5, 5], y: [-5, 5] });
        return () => { for (let i = 0; i < M; i++) { x[i] += jitter() * 0.06 - x[i] * 0.008; y[i] += jitter() * 0.06 - y[i] * 0.008; } sc.setData(x, y); p.render(); };
      },
    },
    {
      title: "Bars", subtitle: "fluctuating", options: DARK,
      setup: (p) => {
        const K = 9, x = Float64Array.from({ length: K }, (_, i) => i), y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
        const bar = p.addBar({ x, y, width: 0.7, color: "#22d3ee", renderType: RT });
        p.setView({ x: [-0.6, K - 0.4], y: [0, 100] });
        return () => { for (let i = 0; i < K; i++) y[i] = Math.max(2, Math.min(98, y[i] + jitter() * 8)); bar.setData(x, y); p.render(); };
      },
    },
    {
      title: "Grouped bars", subtitle: "categorical · 3 series",
      options: { ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: ["Q1", "Q2", "Q3", "Q4"] }, y: { domain: [0, 100] } }, showToolbar: false },
      setup: (p) => {
        const idx = Float64Array.from([0, 1, 2, 3]);
        const mk = () => Float64Array.from([0, 1, 2, 3], () => 20 + rand() * 70);
        const ys = [mk(), mk(), mk()], colors = ["#38bdf8", "#f472b6", "#a3e635"], names = ["north", "south", "west"];
        const layers = p.addGroupedBars({ x: idx, series: ys.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
        return () => { ys.forEach((y, s) => { for (let i = 0; i < y.length; i++) y[i] = Math.max(4, Math.min(96, y[i] + jitter() * 7)); layers[s].setData(idx, y); }); p.render(); };
      },
    },
    {
      title: "Stacked bars", subtitle: "categorical · cumulative",
      options: { ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: ["Mon", "Tue", "Wed", "Thu", "Fri"] } }, showToolbar: false },
      setup: (p) => {
        const idx = Float64Array.from([0, 1, 2, 3, 4]);
        const mk = (m: number) => Float64Array.from([0, 1, 2, 3, 4], () => m + rand() * m);
        const raw = [mk(10), mk(8), mk(6)], colors = ["#22d3ee", "#818cf8", "#fbbf24"], names = ["email", "social", "direct"];
        const layers = p.addStackedBars({ x: idx, width: 0.6, series: raw.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
        return () => {
          const n = idx.length, cum = new Float64Array(n);
          raw.forEach((y, s) => { const base = Float64Array.from(cum), top = new Float64Array(n); for (let i = 0; i < n; i++) { y[i] = Math.max(2, y[i] + jitter() * 1.2); top[i] = cum[i] + y[i]; cum[i] = top[i]; } layers[s].setData(idx, top, base); });
          p.render();
        };
      },
    },
    {
      title: "Horizontal bars", subtitle: "hbar · categorical y",
      options: { ...DARK, scales: { y: { type: "categorical", factors: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"] }, x: { domain: [0, 100] } }, showToolbar: false },
      setup: (p) => {
        const idx = Float64Array.from([0, 1, 2, 3, 4]), vals = Float64Array.from([0, 1, 2, 3, 4], (i) => 30 + i * 12 + rand() * 10);
        const bar = p.addBar({ x: idx, y: vals, width: 0.6, orientation: "h", color: "#34d399", name: "score", renderType: RT });
        return () => { for (let i = 0; i < vals.length; i++) vals[i] = Math.max(6, Math.min(98, vals[i] + jitter() * 6)); bar.setData(idx, vals); p.render(); };
      },
    },
    {
      title: "Area", subtitle: "streaming", options: DARK,
      setup: (p) => {
        const N = 400, x = Float64Array.from({ length: N }, (_, i) => i), y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
        const area = p.addArea({ x, y, color: "rgba(52,211,153,0.45)", renderType: RT });
        p.setView({ x: [0, N - 1], y: [0, 4] });
        let ph = N;
        return () => { y.copyWithin(0, 1); ph++; y[N - 1] = 2 + Math.sin(ph * 0.06) + Math.sin(ph * 0.017) * 0.7 + Math.random() * 0.2; area.setData(x, y); p.render(); };
      },
    },
    {
      title: "Stacked area", subtitle: "cumulative bands", options: { ...DARK, showToolbar: false },
      setup: (p) => {
        const N = 120, x = Float64Array.from({ length: N }, (_, i) => i);
        const s = (a: number, b: number) => Float64Array.from({ length: N }, (_, i) => a + Math.sin(i * b) * a * 0.4 + a * 0.3);
        const raw = [s(3, 0.05), s(2.5, 0.06), s(2, 0.04)], colors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
        const layers = p.addStackedArea({ x, series: raw.map((y, i) => ({ y, color: colors[i], name: "abc"[i] })) });
        p.setView({ x: [0, N - 1], y: [0, 14] });
        const amp = [3, 2.5, 2], fr = [0.05, 0.06, 0.04];
        return (t) => {
          const cum = new Float64Array(N);
          for (let sIdx = 0; sIdx < raw.length; sIdx++) { const base = Float64Array.from(cum), top = new Float64Array(N), a = amp[sIdx], b = fr[sIdx]; for (let i = 0; i < N; i++) { const yv = a + Math.sin(i * b + sIdx + t * 1.5) * a * 0.4 + a * 0.3; top[i] = cum[i] + yv; cum[i] = top[i]; } layers[sIdx].setData(x, top, base); }
          p.render();
        };
      },
    },
    {
      title: "Step line", subtitle: "staircase · step:after", options: DARK,
      setup: (p) => {
        const N = 24, x = Float64Array.from({ length: N }, (_, i) => i), y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
        const line = p.addLine({ x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: RT });
        p.setView({ x: [0, N - 1], y: [-0.5, 3.5] });
        return every(6, () => { y.copyWithin(0, 1); y[N - 1] = Math.round(Math.random() * 3); line.setData(x, y); p.render(); });
      },
    },
    {
      title: "Histogram", subtitle: "gaussian envelope", options: DARK,
      setup: (p) => {
        const bins = 30, lo = -4, hi = 4, bw = (hi - lo) / bins;
        const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw), counts = new Float64Array(bins);
        for (let i = 0; i < 5000; i++) { const b = Math.floor((gaussian(0, 1) - lo) / bw); if (b >= 0 && b < bins) counts[b]++; }
        const bar = p.addBar({ x: centers, y: counts, width: bw * 0.98, color: "#34d399", renderType: RT });
        return () => { for (let i = 0; i < bins; i++) { const target = 5000 * bw * Math.exp((-centers[i] * centers[i]) / 2) / Math.sqrt(2 * Math.PI); counts[i] = Math.max(0, counts[i] + (target - counts[i]) * 0.05 + jitter() * target * 0.12); } bar.setData(centers, counts); p.render(); };
      },
    },
    {
      title: "Box plot", subtitle: "Tukey · outliers", options: DARK,
      setup: (p) => {
        const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
        const mk = (phase: number) => [0, 1, 2, 3].map((g) => ({ position: g, values: Array.from({ length: 120 }, () => gaussian(g + Math.sin(phase + g) * 0.5, 1 + g * 0.3)), color: colors[g] }));
        const box = p.addBox({ groups: mk(0), width: 0.6, renderType: RT });
        p.setView({ x: [-0.6, 3.6], y: [-4, 8] });
        return every(4, (t) => { box.setData(mk(t)); p.render(); });
      },
    },
    {
      title: "Heatmap", subtitle: "texture · viridis", options: DARK,
      setup: (p) => {
        const cols = 60, rows = 40, values = new Float64Array(cols * rows);
        const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 6, yy = (r / rows) * 6; values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) + Math.sin(xx * yy * 0.15); } };
        fill(0);
        const hm = p.addHeatmap({ values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: RT });
        return (t) => { fill(t); hm.setData(values); p.render(); };
      },
    },
    {
      title: "Contour", subtitle: "marching squares", options: DARK,
      setup: (p) => {
        const cols = 80, rows = 60, values = new Float64Array(cols * rows);
        const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 6 - 3, yy = (r / rows) * 6 - 3; values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) - 0.02 * (xx * xx + yy * yy); } };
        fill(0);
        const ct = p.addContour({ values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: RT });
        return every(2, (t) => { fill(t); ct.setData(values); p.render(); });
      },
    },
    {
      title: "Spectrogram", subtitle: "waterfall · scroll", options: { ...DARK, axes: { x: { title: "time" }, y: { title: "freq" } } },
      setup: (p) => {
        const N = 16384, sr = 8000, sig = new Float64Array(N);
        for (let i = 0; i < N; i++) { const tt = i / sr; sig[i] = Math.sin(2 * Math.PI * (200 + 1500 * (i / N)) * tt); }
        const hm = p.addHeatmapSpectrogram(sig, { fftSize: 256, hop: 128, sampleRate: sr, colormap: "plasma" });
        const cols = Math.floor((N - 256) / 128) + 1, rows = 129, grid = new Float64Array(cols * rows);
        let ph = 0;
        return () => {
          ph += 0.05;
          for (let r = 0; r < rows; r++) grid.copyWithin(r * cols, r * cols + 1, (r + 1) * cols);
          const peak = (0.5 + 0.5 * Math.sin(ph)) * (rows - 1);
          for (let r = 0; r < rows; r++) grid[r * cols + (cols - 1)] = Math.exp(-((r - peak) ** 2) / 40) + Math.random() * 0.05;
          hm.setData(grid, cols, rows); p.render();
        };
      },
    },
    {
      title: "Hexbin", subtitle: "25k points · density", options: DARK,
      setup: (p) => {
        const M = 25_000, x = new Float64Array(M), y = new Float64Array(M);
        for (let i = 0; i < M; i++) { const blob = i % 2 === 0 ? -1.4 : 1.4; x[i] = gaussian(blob, 1); y[i] = gaussian(blob * 0.6, 1.1); }
        const hx = p.addHexbin({ x, y, radius: 0.22, colormap: "plasma", renderType: RT });
        p.setView({ x: [-5, 5], y: [-5, 5] });
        return every(2, () => { for (let i = 0; i < M; i++) { x[i] += jitter() * 0.05 - x[i] * 0.004; y[i] += jitter() * 0.05 - y[i] * 0.004; } hx.setData(x, y); p.render(); });
      },
    },
    {
      title: "Error bars", subtitle: "whiskers + caps", options: DARK,
      setup: (p) => {
        const N = 12, x = Float64Array.from({ length: N }, (_, i) => i), y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5), yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
        const line = p.addLine({ x, y, color: "#60a5fa", width: 1.5, renderType: RT });
        const eb = p.addErrorBar({ x, y, yerr, color: "#60a5fa", capSize: 7, renderType: RT });
        p.setView({ x: [-1, N], y: [0, 10] });
        return (t) => { for (let i = 0; i < N; i++) { y[i] = Math.sin(i / 2 + t) * 3 + 5; yerr[i] = 0.4 + (0.5 + 0.4 * Math.sin(t + i)) * 0.9; } line.setData(x, y); eb.setData({ x, y, yerr }); p.render(); };
      },
    },
    {
      title: "Error band", subtitle: "confidence ribbon", options: DARK,
      setup: (p) => {
        const N = 120, x = Float64Array.from({ length: N }, (_, i) => i / 10), y = Float64Array.from(x, (t) => Math.sin(t)), err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
        const eb = p.addErrorBar({ x, y, yerr: err, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28, renderType: RT });
        const line = p.addLine({ x, y, color: "#a78bfa", width: 2, renderType: RT });
        p.setView({ x: [0, 12], y: [-1.5, 1.5] });
        return (t) => { for (let i = 0; i < N; i++) { y[i] = Math.sin(x[i] + t); err[i] = 0.12 + 0.12 * Math.abs(Math.cos(x[i] + t)); } eb.setData({ x, y, yerr: err }); line.setData(x, y); p.render(); };
      },
    },
    {
      title: "Stem plot", subtitle: "discrete signal", options: DARK,
      setup: (p) => {
        const N = 30, x = Float64Array.from({ length: N }, (_, i) => i), y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
        const stem = p.addStem({ x, y, color: "#34d399", markerSize: 6, renderType: RT });
        p.setView({ x: [-1, N], y: [-1, 1.1] });
        return (t) => { for (let i = 0; i < N; i++) y[i] = Math.exp(-i / 12) * Math.cos(i / 2 + t * 2); stem.setData(x, y); p.render(); };
      },
    },
    {
      title: "Quiver", subtitle: "vector field", options: DARK,
      setup: (p) => {
        const G = 16, xs: number[] = [], ys: number[] = [];
        for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { xs.push((i / (G - 1)) * 4 - 2); ys.push((j / (G - 1)) * 4 - 2); }
        const us = new Float64Array(xs.length), vs = new Float64Array(xs.length);
        const fill = (ph: number) => { for (let k = 0; k < xs.length; k++) { const a = Math.cos(ph), b = Math.sin(ph); us[k] = -ys[k] * a - xs[k] * b * 0.3; vs[k] = xs[k] * a - ys[k] * b * 0.3; } };
        fill(0);
        const q = p.addQuiver({ x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" }, renderType: RT });
        p.setView({ x: [-2.4, 2.4], y: [-2.4, 2.4] });
        return (t) => { fill(t); q.setData(xs, ys, us, vs); p.render(); };
      },
    },
    {
      title: "Candlestick", subtitle: "OHLC · streaming", options: { ...DARK, scales: { x: { type: "time" } } },
      setup: (p) => {
        const N = 40, start = Date.UTC(2024, 0, 1), step = 86_400_000;
        const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
        let price = 100;
        for (let i = 0; i < N; i++) { const open = price, close = open + gaussian(0, 2.2); x[i] = start + i * step; o[i] = open; c[i] = close; h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1)); l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1)); price = close; }
        const cs = p.addCandlestick({ x, open: o, high: h, low: l, close: c, renderType: RT });
        let lastX = x[N - 1], curOpen = c[N - 1], curClose = curOpen, hi = curOpen, lo = curOpen, sinceClose = 0;
        return () => {
          curClose += gaussian(0, 0.35); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
          cs.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose }); p.render();
          if (++sinceClose > 70) { sinceClose = 0; lastX += step; curOpen = curClose; hi = lo = curOpen; cs.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen }); p.setView({ x: [lastX - step * 42, lastX + step * 2] }); }
        };
      },
    },
    {
      title: "OHLC", subtitle: "bars · streaming", options: { ...DARK, scales: { x: { type: "time" } } },
      setup: (p) => {
        const N = 40, start = Date.UTC(2024, 0, 1), step = 86_400_000;
        const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
        let price = 100;
        for (let i = 0; i < N; i++) { const open = price, close = open + gaussian(0, 2.2); x[i] = start + i * step; o[i] = open; c[i] = close; h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1)); l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1)); price = close; }
        const ol = p.addOhlc({ x, open: o, high: h, low: l, close: c, renderType: RT });
        let lastX = x[N - 1], curOpen = c[N - 1], curClose = curOpen, hi = curOpen, lo = curOpen, sinceClose = 0;
        return () => {
          curClose += gaussian(0, 0.35); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
          ol.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose }); p.render();
          if (++sinceClose > 70) { sinceClose = 0; lastX += step; curOpen = curClose; hi = lo = curOpen; ol.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen }); p.setView({ x: [lastX - step * 42, lastX + step * 2] }); }
        };
      },
    },
    {
      title: "Ordinal-time axis", subtitle: "sessions · weekend gaps collapse",
      options: { ...DARK, scales: { x: { type: "ordinal-time", times: businessDays(60, Date.UTC(2024, 0, 1)) } } },
      setup: (p) => {
        const N = 60, idx = Float64Array.from({ length: N }, (_, i) => i);
        const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
        let price = 100;
        for (let i = 0; i < N; i++) { const open = price, close = open + gaussian(0, 2); o[i] = open; c[i] = close; h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1)); l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1)); price = close; }
        const cs = p.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: RT });
        let curOpen = c[N - 1], curClose = curOpen, hi = curOpen, lo = curOpen, sinceClose = 0;
        return () => {
          curClose += gaussian(0, 0.3); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
          cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose }); p.render();
          if (++sinceClose > 60) { sinceClose = 0; for (let i = 0; i < N - 1; i++) { o[i] = o[i + 1]; h[i] = h[i + 1]; l[i] = l[i + 1]; c[i] = c[i + 1]; } curOpen = curClose; o[N - 1] = curOpen; h[N - 1] = curOpen; l[N - 1] = curOpen; c[N - 1] = curOpen; hi = lo = curOpen; cs.setData({ x: idx, open: o, high: h, low: l, close: c }); }
        };
      },
    },
    {
      title: "Pie", subtitle: "market share", options: { ...DARK, equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } },
      setup: (p) => {
        const vals = [35, 25, 20, 12, 8];
        const pie = p.addPie({ values: vals, colormap: "viridis", renderType: RT });
        p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
        return every(3, () => { for (let i = 0; i < vals.length; i++) vals[i] = Math.max(3, vals[i] + jitter() * 3); pie.setData(vals); p.render(); });
      },
    },
    {
      title: "Donut", subtitle: "categories", options: { ...DARK, equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } },
      setup: (p) => {
        const vals = [8, 6, 5, 4, 3, 2];
        const pie = p.addPie({ values: vals, innerRadius: 0.55, renderType: RT });
        p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
        return every(3, () => { for (let i = 0; i < vals.length; i++) vals[i] = Math.max(1.5, vals[i] + jitter() * 2); pie.setData(vals); p.render(); });
      },
    },
    {
      title: "Patches", subtitle: "polygons · choropleth", options: { ...DARK, showToolbar: false },
      setup: (p) => {
        const cols = 6, rows = 4, cells: Array<{ x: number[]; y: number[]; base: number }> = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const j = () => (rand() - 0.5) * 0.22; cells.push({ x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()], y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()], base: Math.sin(c * 0.7) + Math.cos(r * 0.9) }); }
        const mk = (ph: number) => cells.map((cell, i) => ({ x: cell.x, y: cell.y, value: cell.base + Math.sin(ph + i * 0.4) * 0.6 }));
        const patch = p.addPatches({ patches: mk(0), colormap: "plasma", renderType: RT });
        p.setView({ x: [-0.3, cols + 0.3], y: [-0.3, rows + 0.3] });
        return every(2, (t) => { patch.setData(mk(t)); p.render(); });
      },
    },
    {
      title: "Image", subtitle: "RGBA glyph · textured quad", options: { ...DARK, showToolbar: false },
      setup: (p) => {
        const iw = 96, ih = 96, id = new ImageData(iw, ih);
        const paint = (cx: number, cy: number) => { for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) { const i = (yy * iw + xx) * 4; const d = Math.hypot(xx - cx, yy - cy) / (iw / 2); id.data[i] = Math.round((xx / iw) * 255); id.data[i + 1] = Math.round((yy / ih) * 255); id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255); id.data[i + 3] = 255; } };
        paint(iw / 2, ih / 2);
        const img = p.addImage({ source: id, extent: { x: [0, 10], y: [0, 10] }, renderType: RT });
        p.setView({ x: [-0.5, 10.5], y: [-0.5, 10.5] });
        return (t) => { paint(iw / 2 + Math.cos(t * 1.5) * iw * 0.3, ih / 2 + Math.sin(t * 1.5) * ih * 0.3); img.setData(id); p.render(); };
      },
    },
    {
      title: "Graph", subtitle: "nodes + edges · wobble", options: { ...DARK, showToolbar: false, equalAspect: true },
      setup: (p) => {
        const edges: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3], [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4]];
        const n = 10, bx = new Float64Array(n), by = new Float64Array(n);
        for (let i = 0; i < n; i++) { bx[i] = Math.cos((i / n) * Math.PI * 2); by[i] = Math.sin((i / n) * Math.PI * 2); }
        const g = p.addGraph({ x: bx, y: by, edges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: RT });
        p.setView({ x: [-1.5, 1.5], y: [-1.5, 1.5] });
        const x = new Float64Array(n), y = new Float64Array(n);
        return (t) => { for (let i = 0; i < n; i++) { x[i] = bx[i] + Math.sin(t * 2 + i) * 0.12; y[i] = by[i] + Math.cos(t * 2 + i) * 0.12; } g.setData({ x, y, edges }); p.render(); };
      },
    },
    {
      title: "Annotations", subtitle: "span · band · box · label", options: { ...DARK, showToolbar: false },
      setup: (p) => {
        const N = 100, x = Float64Array.from({ length: N }, (_, i) => i), y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.15) * 3 + 5);
        const line = p.addLine({ x, y, color: "#38bdf8", width: 2, renderType: RT });
        p.setView({ x: [0, N - 1], y: [0, 10] });
        p.addAnnotation({ type: "band", dim: "y", from: 6, to: 8, color: "rgba(52,211,153,0.15)" });
        p.addAnnotation({ type: "span", dim: "y", value: 5, color: "#f59e0b", dash: [5, 4] });
        p.addAnnotation({ type: "span", dim: "x", value: 50, color: "#f472b6", dash: [5, 4] });
        p.addAnnotation({ type: "box", x: [20, 35], y: [2, 4], border: "#a78bfa" });
        p.addAnnotation({ type: "label", x: 52, y: 9, text: "event", color: "#f472b6" });
        return (t) => { for (let i = 0; i < N; i++) y[i] = Math.sin(i * 0.15 + t) * 3 + 5; line.setData(x, y); p.render(); };
      },
    },
    {
      title: "Log axis", subtitle: "exp decay · log y", options: { ...DARK, scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } },
      setup: (p) => {
        const N = 200, x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10), taus = [1.2, 2.5, 5], colors = ["#f472b6", "#60a5fa", "#34d399"];
        const ys = taus.map((tau) => Float64Array.from(x, (t) => Math.exp(-t / tau) + 1e-3));
        const lines = ys.map((y, k) => p.addLine({ x, y, color: colors[k], width: 1.5, name: `τ=${taus[k]}`, renderType: RT }));
        return (t) => { taus.forEach((tau, k) => { const y = ys[k]; for (let i = 0; i < N; i++) y[i] = Math.exp(-x[i] / tau) * (1 + 0.3 * Math.sin(t * 2 + i * 0.1)) + 1e-3; lines[k].setData(x, y); }); p.render(); };
      },
    },
    {
      title: "Time axis", subtitle: "1 day · scrolling", options: { ...DARK, scales: { x: { type: "time" } } },
      setup: (p) => {
        const start = Date.UTC(2024, 0, 1), N = 24 * 60, x = new Float64Array(N), y = new Float64Array(N);
        for (let i = 0; i < N; i++) { x[i] = start + i * 60_000; const h = i / 60; y[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4); }
        const line = p.addLine({ x, y, color: "#22d3ee", width: 1.5, renderType: RT });
        let ph = N;
        return () => { y.copyWithin(0, 1); x.copyWithin(0, 1); ph++; x[N - 1] = start + ph * 60_000; const h = ph / 60; y[N - 1] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4); line.setData(x, y); p.render(); };
      },
    },
    {
      title: "Dual Y", subtitle: "two scales", options: { ...DARK, axes: { y: { title: "amp" } } },
      setup: (p) => {
        p.addYAxis("t", { side: "right", color: "#f472b6", title: "temp" });
        const N = 400, x = Float64Array.from({ length: N }, (_, i) => i), a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5), b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
        const l1 = p.addLine({ x, y: a, color: "#60a5fa", width: 1.5, decimate: false, renderType: RT });
        const l2 = p.addLine({ x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false, renderType: RT });
        p.setView({ x: [0, N - 1], y: [-2, 2], yAxes: { t: [15, 35] } });
        let ph = N;
        return () => { a.copyWithin(0, 1); b.copyWithin(0, 1); ph++; a[N - 1] = Math.sin(ph * 0.05) * 1.5 + jitter() * 0.15; b[N - 1] = 25 + Math.sin(ph * 0.02) * 6 + jitter() * 0.6; l1.setData(x, a); l2.setData(x, b); p.render(); };
      },
    },
    {
      title: "1M points", subtitle: "GPU decimation · panning", options: DARK,
      setup: (p) => {
        const N = 1_000_000, x = new Float64Array(N), y = new Float64Array(N);
        for (let i = 0; i < N; i++) { x[i] = i; y[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05); }
        p.addLine({ x, y, color: "#34d399", width: 1.5, renderType: RT });
        const win = 50_000; p.setView({ x: [0, win], y: [-1.5, 1.5] });
        return (t) => { const c = (Math.sin(t * 0.3) * 0.5 + 0.5) * (N - win); p.setView({ x: [c, c + win] }); p.render(); };
      },
    },
  ];

  const polars: DynPolar[] = [
    {
      title: "Polar radar", subtitle: "rotating sweep", options: { ...DARK, angleUnit: "deg", maxRadius: 1 },
      setup: (pp) => {
        const sweep = pp.addLine({ theta: [0, 0], r: [0, 1], color: "#22d3ee", width: 2 });
        const B = 14, bt = Float64Array.from({ length: B }, () => rand() * 360), br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
        pp.addScatter({ theta: bt, r: br, color: "#f472b6", size: 6, labels: Array.from({ length: B }, (_, i) => `Contact ${i + 1}`) });
        let ang = 0;
        return () => { ang = (ang + 2.5) % 360; sweep.setData([ang, ang], [0, 1]); };
      },
    },
    {
      title: "Polar rose", subtitle: "morphing curve", options: { ...DARK, maxRadius: 1 },
      setup: (pp) => {
        const T = 240, theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2), r = new Float64Array(T);
        for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(3 * theta[i]));
        const rose = pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
        return (t) => { const k = 3 + 2 * Math.sin(t * 0.3); for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(k * theta[i])); rose.setData(theta, r); };
      },
    },
  ];

  const plots3D: Dyn3D[] = [
    {
      title: "3D surface", subtitle: "title · colorbar · light", options: { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" },
      setup: (p3) => {
        const cols = 64, rows = 64, values = new Float64Array(cols * rows);
        const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 2 - ph) / rr) * 3; } };
        fill(0);
        const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height", renderType: RT });
        return (t) => { fill(t * 3); surf.setData(values); p3.refresh(); };
      },
    },
    {
      title: "3D bars", subtitle: "colormapped · lit", options: { axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" },
      setup: (p3) => {
        const gx = 8, gz = 8, xa: number[] = [], za: number[] = [];
        for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
        const ya = new Float64Array(xa.length);
        const fill = (ph: number) => { for (let k = 0; k < xa.length; k++) ya[k] = 1.5 + Math.sin(xa[k] * 0.6 + ph) * Math.cos(za[k] * 0.6) * 1.5; };
        fill(0);
        const bar = p3.addBar3D({ x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: RT });
        return (t) => { fill(t * 2); bar.setData(xa, za, ya); p3.refresh(); };
      },
    },
    {
      title: "3D lines", subtitle: "paths · legend", options: { axisLabels: { x: "x", y: "y", z: "z" }, legend: true },
      setup: (p3) => {
        const N = 400;
        const mk = (phase: number) => { const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N); for (let i = 0; i < N; i++) { const tt = (i / (N - 1)) * Math.PI * 8; x[i] = Math.cos(tt + phase); z[i] = Math.sin(tt + phase); y[i] = (i / (N - 1)) * 4 - 2; } return { x, y, z }; };
        const la = p3.addLine3D({ ...mk(0), color: "#38bdf8", name: "α" });
        const lb = p3.addLine3D({ ...mk(Math.PI), color: "#f472b6", name: "β" });
        return (t) => { const na = mk(t * 2), nb = mk(Math.PI + t * 2); la.setData(na.x, na.y, na.z); lb.setData(nb.x, nb.y, nb.z); p3.refresh(); };
      },
    },
    {
      title: "3D wireframe", subtitle: "lines · hover · reset", options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" },
      setup: (p3) => {
        const cols = 40, rows = 40, values = new Float64Array(cols * rows);
        const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 1.5 - ph) / rr) * 3; } };
        fill(0);
        const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "plasma", wireframe: true, name: "height", renderType: RT });
        return (t) => { fill(t * 3); surf.setData(values); p3.refresh(); };
      },
    },
    {
      title: "3D quiver", subtitle: "vector field · colorbar", options: { axisLabels: { x: "x", y: "y", z: "z" } },
      setup: (p3) => {
        const g = 6, xa: number[] = [], ya: number[] = [], za: number[] = [];
        for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) { xa.push((i / (g - 1)) * 2 - 1); ya.push((j / (g - 1)) * 2 - 1); za.push((k / (g - 1)) * 2 - 1); }
        const u = new Float64Array(xa.length), v = new Float64Array(xa.length), w = new Float64Array(xa.length);
        const fill = (ph: number) => { const ca = Math.cos(ph), sa = Math.sin(ph); for (let k = 0; k < xa.length; k++) { u[k] = -ya[k] * ca; v[k] = xa[k] * ca; w[k] = za[k] * 0.3 * sa; } };
        fill(0);
        const q = p3.addQuiver3D({ x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: RT });
        return (t) => { fill(t * 2); q.setData(xa, ya, za, u, v, w); p3.refresh(); };
      },
    },
    {
      title: "3D contour", subtitle: "iso-height rings", options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" },
      setup: (p3) => {
        const cols = 50, rows = 50, values = new Float64Array(cols * rows);
        const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 1.5 - ph) / rr) * 3; } };
        fill(0);
        const ct = p3.addContour3D({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: RT });
        return every(3, (t) => { fill(t * 3); ct.setData(values); p3.refresh(); });
      },
    },
    {
      title: "3D isosurface", subtitle: "marching cubes · metaballs", options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" },
      setup: (p3) => {
        const n = 28, vol = new Float64Array(n * n * n);
        const fill = (ph: number) => {
          const blobs = [[-0.5 + Math.sin(ph) * 0.3, 0, 0], [0.6, 0.3 + Math.cos(ph) * 0.3, -0.2], [0.1, -0.5, 0.4 + Math.sin(ph * 1.3) * 0.3]];
          for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1; let s = 0; for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 6); vol[x + y * n + z * n * n] = s; }
        };
        fill(0);
        const iso = p3.addIsosurface({ values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: RT });
        return every(5, (t) => { fill(t); iso.setData(vol, [n, n, n], 0.5, { x: [-1, 1], y: [-1, 1], z: [-1, 1] }); p3.refresh(); });
      },
    },
    {
      title: "3D scatter", subtitle: "per-point size · labels", options: { axisLabels: { x: "x", y: "y", z: "z" } },
      setup: (p3) => {
        const N = 300, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), sizes = new Float64Array(N), vals = new Float64Array(N), labels: string[] = [];
        for (let i = 0; i < N; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); z[i] = gaussian(0, 1); const r = Math.hypot(x[i], y[i], z[i]); sizes[i] = 3 + r * 6; vals[i] = r; labels.push(`p${i} · r=${r.toFixed(2)}`); }
        const sc = p3.addPointCloud({ x, y, z, sizes, labels, colorBy: { values: vals, colormap: "plasma" }, name: "r" });
        return () => { for (let i = 0; i < N; i++) { x[i] += jitter() * 0.04 - x[i] * 0.006; y[i] += jitter() * 0.04 - y[i] * 0.006; z[i] += jitter() * 0.04 - z[i] * 0.006; } sc.setData(x, y, z); p3.refresh(); };
      },
    },
    {
      title: "3D volume", subtitle: "raymarch · grid · auto-rotate", options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true },
      setup: (p3) => {
        const n = 48, vol = new Float64Array(n * n * n), blobs = [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]];
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1; let s = 0; for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 5); vol[x + y * n + z * n * n] = s; }
        p3.addVolume({ values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: RT });
        // autoRotate streams frames on its own; nudge refresh to keep the loop warm.
        return () => { p3.refresh(); };
      },
    },
    {
      title: "3D point cloud", subtitle: "axes · colored by height", options: { axisLabels: { x: "x", y: "height", z: "z" } },
      setup: (p3) => {
        const N = 6000, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
        const build = (ph: number) => { for (let i = 0; i < N; i++) { const th = (i / N) * Math.PI * 20 + ph, rr = 1 + (i / N) * 2; x[i] = Math.cos(th) * rr; z[i] = Math.sin(th) * rr; y[i] = (i / N) * 4 - 2; } };
        build(0);
        const sc = p3.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
        return (t) => { build(t); sc.setData(x, y, z); p3.refresh(); };
      },
    },
  ];

  return { plots2D, polars, plots3D };
}
