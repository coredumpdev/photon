import {
  Plot, Plot3D, PolarPlot, linkX,
  rsi, macd, firstFinite, addHeikinAshi, addRenko, addVolumeProfile, addBollinger, addDepth,
} from "@photonviz/core";
import {
  addMap, addGeoJson, xyzVectorSource, pmtilesSource, protomapsStyle,
  worldToLonLat, lonLatToWorld, type MapStyle, type MapLayer,
} from "@photonviz/map";
// The world basemap is embedded in the library (Natural Earth 10m) — no fetch.
import { worldCountries } from "@photonviz/map/world";

// ============================================================================
// Tabs — three grids, one shown at a time. Charts are built LAZILY the first
// time a tab is activated so their containers are visible & sized (a Plot built
// while display:none sizes to 0). Static is the default and is built on load.
// ============================================================================
const gridStatic = document.getElementById("grid-static")!;
const gridDynamic = document.getElementById("grid-dynamic")!;
const gridMaps = document.getElementById("grid-maps")!;
const gridFinance = document.getElementById("grid-finance")!;

// FPS badges — only Dynamic-tab panels register one (top-left of the chart).
const fpsBadges: HTMLElement[] = [];

/** Build a panel (title bar + chart div) inside `grid`. `showFps` adds an FPS badge. */
function panel(grid: HTMLElement, title: string, subtitle = "", showFps = false): HTMLElement {
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

  if (showFps) {
    const badge = document.createElement("div");
    badge.className = "fps";
    badge.style.cssText =
      "position:absolute;top:6px;left:8px;z-index:5;padding:2px 7px;border-radius:6px;" +
      "font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e2e8f0;" +
      "background:rgba(14,21,38,.7);border:1px solid #1e293b;backdrop-filter:blur(3px);" +
      "pointer-events:none;font-variant-numeric:tabular-nums;";
    badge.textContent = "— fps";
    // Plot sets the chart container to position:relative, so this anchors to it.
    chart.appendChild(badge);
    fpsBadges.push(badge);
  }
  return chart;
}

/** A small caption pinned bottom-right (map attribution / hints). */
function caption(chart: HTMLElement, text: string): HTMLElement {
  const c = document.createElement("div");
  c.className = "cap";
  c.textContent = text;
  chart.appendChild(c);
  return c;
}

// ============================================================================
// Global animation loop. Dynamic-tab updaters run (and FPS badges repaint) only
// while the Dynamic tab is active — built panels on hidden tabs stay idle.
// ============================================================================
const dynUpdaters: Array<(t: number) => void> = [];
let dynamicActive = false;
let frame = 0;
let fpsAvg = 0, lastNow = 0, fpsPaint = 0;

function loop(now: number): void {
  frame++;
  const t = frame / 60;
  if (dynamicActive) {
    for (const u of dynUpdaters) u(t);
    if (lastNow > 0) {
      const dt = now - lastNow;
      if (dt > 0) { const inst = 1000 / dt; fpsAvg = fpsAvg > 0 ? fpsAvg * 0.9 + inst * 0.1 : inst; }
    }
    if (now - fpsPaint > 250) {
      fpsPaint = now;
      const text = `${Math.round(fpsAvg)} fps`;
      for (const b of fpsBadges) b.textContent = text;
    }
  }
  lastNow = now;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// Seeded RNG so each build looks identical. Reseeded before every tab build.
// ---------------------------------------------------------------------------
let seed = 42;
function reseed(): void { seed = 42; }
function rand(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gaussian(m: number, sd: number): number {
  const u = rand() || 1e-9, v = rand() || 1e-9;
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const jitter = () => (Math.random() - 0.5);

// A throttled updater: only runs `fn` every `k` frames (for expensive rebuilds).
function every(k: number, fn: (t: number) => void): (t: number) => void {
  return (t) => { if (frame % k === 0) fn(t); };
}

// ============================================================================
// CHART BUILDERS. Each takes the target grid + a `dyn` flag. When `dyn`, the
// layer is created with renderType:"dynamic", the panel gets an FPS badge, and
// an updater is registered that streams new data every frame. The chart LOGIC is
// shared between the Static and Dynamic tabs — only the data source differs.
// ============================================================================
type Builder = (grid: HTMLElement, dyn: boolean) => void;

const CHARTS: Builder[] = [
  // --- Line ----------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Line", dyn ? "live · scrolling" : "sine sum", dyn), { theme: "dark" });
    const N = 600;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
    const line = p.addLine({ x, y, color: "#34d399", width: 2, decimate: false, renderType: rt });
    p.setView({ x: [0, N - 1], y: [-2.6, 2.6] });
    if (dyn) {
      let ph = N;
      dynUpdaters.push(() => {
        y.copyWithin(0, 1); ph += 1;
        y[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + jitter() * 0.25;
        line.setData(x, y); p.render();
      });
    }
  },

  // --- Multi-signal --------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Signals", "3 channels", dyn), { theme: "dark" });
    const N = 500;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const ys = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    ys.forEach((y, i) => { for (let j = 0; j < N; j++) y[j] = Math.sin(j * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + i * 0.1; });
    const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
    const lines = ys.map((y, i) => p.addLine({ x, y, color: colors[i], width: 1.5, decimate: false, renderType: rt }));
    p.setView({ x: [0, N - 1], y: [-3.5, 3.5] });
    if (dyn) {
      let ph = N;
      dynUpdaters.push(() => {
        ph += 1;
        ys.forEach((y, i) => {
          y.copyWithin(0, 1);
          y[N - 1] = Math.sin(ph * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + jitter() * 0.2 + i * 0.1;
          lines[i]!.setData(x, y);
        });
        p.render();
      });
    }
  },

  // --- Scatter -------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Scatter", dyn ? "drifting cloud" : "gaussian cloud", dyn), { theme: "dark" });
    const M = 700;
    const x = new Float64Array(M), y = new Float64Array(M);
    for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); }
    const sc = p.addScatter({ x, y, size: 5, color: "#818cf8", renderType: rt });
    p.setView({ x: [-4, 4], y: [-4, 4] });
    if (dyn) {
      dynUpdaters.push(() => {
        for (let i = 0; i < M; i++) {
          x[i] += jitter() * 0.08 - x[i]! * 0.01;
          y[i] += jitter() * 0.08 - y[i]! * 0.01;
        }
        sc.setData(x, y); p.render();
      });
    }
  },

  // --- Scatter markers (6 glyph shapes) ------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Scatter markers", "6 glyph shapes", dyn), { theme: "dark", showToolbar: false });
    const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
    const colors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
    const M = 12;
    const x = Float64Array.from({ length: M }, (_, i) => i);
    const layers = shapes.map((mk, r) => {
      const y = Float64Array.from({ length: M }, () => shapes.length - 1 - r);
      return p.addScatter({ x, y, size: 14, marker: mk, color: colors[r], name: mk, renderType: rt });
    });
    p.setView({ x: [-1, M], y: [-1, shapes.length] });
    if (dyn) {
      dynUpdaters.push((t) => {
        layers.forEach((lyr, r) => {
          const base = shapes.length - 1 - r;
          const y = Float64Array.from({ length: M }, (_, i) => base + Math.sin(t * 2 + i * 0.6 + r) * 0.25);
          lyr.setData(x, y);
        });
        p.render();
      });
    }
  },

  // --- Scatter · colorBy ---------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Scatter · colorBy", "value → viridis", dyn), { theme: "dark" });
    const M = 1200;
    const x = new Float64Array(M), y = new Float64Array(M), v = new Float64Array(M);
    for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1.4); y[i] = gaussian(0, 1.4); v[i] = Math.hypot(x[i]!, y[i]!); }
    const sc = p.addScatter({ x, y, size: 6, colorBy: { values: v, colormap: "viridis" }, renderType: rt });
    p.setView({ x: [-5, 5], y: [-5, 5] });
    if (dyn) {
      dynUpdaters.push(() => {
        for (let i = 0; i < M; i++) { x[i] += jitter() * 0.06 - x[i]! * 0.008; y[i] += jitter() * 0.06 - y[i]! * 0.008; }
        sc.setData(x, y); p.render();
      });
    }
  },

  // --- Bars ----------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Bars", dyn ? "fluctuating" : "categorical", dyn), { theme: "dark" });
    const K = 9;
    const cats = Float64Array.from({ length: K }, (_, i) => i);
    const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
    const bar = p.addBar({ x: cats, y, width: 0.7, color: "#22d3ee", renderType: rt });
    p.setView({ x: [-0.6, K - 0.4], y: [0, 100] });
    if (dyn) {
      dynUpdaters.push(() => {
        for (let i = 0; i < K; i++) y[i] = Math.max(2, Math.min(98, y[i]! + jitter() * 8));
        bar.setData(cats, y); p.render();
      });
    }
  },

  // --- Grouped bars --------------------------------------------------------
  (grid, dyn) => {
    const cats = ["Q1", "Q2", "Q3", "Q4"];
    const p = new Plot(panel(grid, "Grouped bars", "categorical · 3 series", dyn), {
      theme: "dark", legend: { position: "top-left" },
      scales: { x: { type: "categorical", factors: cats }, y: { domain: [0, 100] } }, showToolbar: false,
    });
    const idx = Float64Array.from(cats, (_, i) => i);
    const mk = (): Float64Array => Float64Array.from(cats, () => 20 + rand() * 70);
    const ys = [mk(), mk(), mk()];
    const colors = ["#38bdf8", "#f472b6", "#a3e635"], names = ["north", "south", "west"];
    const layers = p.addGroupedBars({ x: idx, series: ys.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
    if (dyn) {
      dynUpdaters.push(() => {
        ys.forEach((y, s) => {
          for (let i = 0; i < y.length; i++) y[i] = Math.max(4, Math.min(96, y[i]! + jitter() * 7));
          layers[s]!.setData(idx, y);
        });
        p.render();
      });
    }
  },

  // --- Stacked bars --------------------------------------------------------
  (grid, dyn) => {
    const cats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const p = new Plot(panel(grid, "Stacked bars", "categorical · cumulative", dyn), {
      theme: "dark", legend: { position: "top-left" },
      scales: { x: { type: "categorical", factors: cats } }, showToolbar: false,
    });
    const idx = Float64Array.from(cats, (_, i) => i);
    const mk = (m: number): Float64Array => Float64Array.from(cats, () => m + rand() * m);
    const raw = [mk(10), mk(8), mk(6)];
    const colors = ["#22d3ee", "#818cf8", "#fbbf24"], names = ["email", "social", "direct"];
    const layers = p.addStackedBars({ x: idx, width: 0.6, series: raw.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
    if (dyn) {
      dynUpdaters.push(() => {
        const n = idx.length;
        const cum = new Float64Array(n);
        raw.forEach((y, s) => {
          const base = Float64Array.from(cum), top = new Float64Array(n);
          for (let i = 0; i < n; i++) { y[i] = Math.max(2, y[i]! + jitter() * 1.2); top[i] = cum[i]! + y[i]!; cum[i] = top[i]!; }
          layers[s]!.setData(idx, top, base);
        });
        p.render();
      });
    }
  },

  // --- Horizontal bars -----------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const cats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    const p = new Plot(panel(grid, "Horizontal bars", "hbar · categorical y", dyn), {
      theme: "dark", scales: { y: { type: "categorical", factors: cats }, x: { domain: [0, 100] } }, showToolbar: false,
    });
    const idx = Float64Array.from(cats, (_, i) => i);
    const vals = Float64Array.from(cats, (_, i) => 30 + i * 12 + rand() * 10);
    const bar = p.addBar({ x: idx, y: vals, width: 0.6, orientation: "h", color: "#34d399", name: "score", renderType: rt });
    if (dyn) {
      dynUpdaters.push(() => {
        for (let i = 0; i < vals.length; i++) vals[i] = Math.max(6, Math.min(98, vals[i]! + jitter() * 6));
        bar.setData(idx, vals); p.render();
      });
    }
  },

  // --- Area ----------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Area", dyn ? "streaming" : "filled", dyn), { theme: "dark" });
    const N = 400;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
    const area = p.addArea({ x, y, color: "rgba(52,211,153,0.45)", renderType: rt });
    p.setView({ x: [0, N - 1], y: [0, 4] });
    if (dyn) {
      let ph = N;
      dynUpdaters.push(() => {
        y.copyWithin(0, 1); ph += 1;
        y[N - 1] = 2 + Math.sin(ph * 0.06) + Math.sin(ph * 0.017) * 0.7 + Math.random() * 0.2;
        area.setData(x, y); p.render();
      });
    }
  },

  // --- Stacked area --------------------------------------------------------
  (grid, dyn) => {
    const p = new Plot(panel(grid, "Stacked area", "cumulative bands", dyn), { theme: "dark", showToolbar: false });
    const N = 120;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const s = (a: number, b: number, c: number) => Float64Array.from({ length: N }, (_, i) => a + Math.sin(i * b + c) * a * 0.4 + a * 0.3);
    const raw = [s(3, 0.05, 0), s(2.5, 0.06, 1), s(2, 0.04, 2)];
    const colors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
    const layers = p.addStackedArea({ x, series: raw.map((y, i) => ({ y, color: colors[i], name: "abc"[i] })) });
    p.setView({ x: [0, N - 1], y: [0, 14] });
    if (dyn) {
      const amp = [3, 2.5, 2], fr = [0.05, 0.06, 0.04];
      dynUpdaters.push((t) => {
        const cum = new Float64Array(N);
        for (let sIdx = 0; sIdx < raw.length; sIdx++) {
          const base = Float64Array.from(cum), top = new Float64Array(N), a = amp[sIdx]!, b = fr[sIdx]!;
          for (let i = 0; i < N; i++) {
            const yv = a + Math.sin(i * b + sIdx + t * 1.5) * a * 0.4 + a * 0.3;
            top[i] = cum[i]! + yv; cum[i] = top[i]!;
          }
          layers[sIdx]!.setData(x, top, base);
        }
        p.render();
      });
    }
  },

  // --- Step line -----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Step line", "staircase · step:after", dyn), { theme: "dark" });
    const N = 24;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
    const line = p.addLine({ x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: rt });
    p.setView({ x: [0, N - 1], y: [-0.5, 3.5] });
    if (dyn) {
      dynUpdaters.push(() => {
        y.copyWithin(0, 1);
        y[N - 1] = Math.round(Math.random() * 3);
        line.setData(x, y); p.render();
      });
    }
  },

  // --- Line joins ----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Line joins", "miter · bevel · round", dyn), { theme: "dark" });
    const xs = Float64Array.from({ length: 13 }, (_, i) => i);
    const styles = ["miter", "bevel", "round"] as const;
    const colors = ["#f472b6", "#60a5fa", "#34d399"];
    const layers = styles.map((join, k) => {
      const y = Float64Array.from(xs, (_, i) => (i % 2 === 0 ? 0 : 1) + k * 2.2);
      return p.addLine({ x: xs, y, color: colors[k], width: 8, join, name: join, renderType: rt });
    });
    if (dyn) {
      dynUpdaters.push((t) => {
        styles.forEach((_, k) => {
          const amp = 0.6 + 0.4 * Math.sin(t * 2 + k);
          const y = Float64Array.from(xs, (_, i) => (i % 2 === 0 ? 0 : amp) + k * 2.2);
          layers[k]!.setData(xs, y);
        });
        p.render();
      });
    }
  },

  // --- Histogram -----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Histogram", "gaussian · 30 bins", dyn), { theme: "dark" });
    const bins = 30, lo = -4, hi = 4, bw = (hi - lo) / bins;
    const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
    const counts = new Float64Array(bins);
    const fill = () => { counts.fill(0); for (let i = 0; i < 5000; i++) { const b = Math.floor((gaussian(0, 1) - lo) / bw); if (b >= 0 && b < bins) counts[b]!++; } };
    fill();
    const bar = p.addBar({ x: centers, y: counts, width: bw * 0.98, color: "#34d399", renderType: rt });
    if (dyn) {
      // Cheap streaming: nudge each bin toward a re-sampled Gaussian envelope.
      dynUpdaters.push(() => {
        for (let i = 0; i < bins; i++) {
          const target = 5000 * bw * Math.exp(-centers[i]! * centers[i]! / 2) / Math.sqrt(2 * Math.PI);
          counts[i] = Math.max(0, counts[i]! + (target - counts[i]!) * 0.05 + jitter() * target * 0.12);
        }
        bar.setData(centers, counts); p.render();
      });
    }
  },

  // --- Box plot ------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Box plot", "Tukey · outliers", dyn), { theme: "dark" });
    const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
    const mkGroups = (phase: number) => [0, 1, 2, 3].map((g) => ({
      position: g,
      values: Array.from({ length: 120 }, () => gaussian(g + Math.sin(phase + g) * 0.5, 1 + g * 0.3)),
      color: colors[g],
    }));
    const box = p.addBox({ groups: mkGroups(0), width: 0.6, renderType: rt });
    p.setView({ x: [-0.6, 3.6], y: [-4, 8] });
    if (dyn) dynUpdaters.push(every(4, (t) => { box.setData(mkGroups(t)); p.render(); }));
  },

  // --- Heatmap -------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Heatmap", "texture · viridis", dyn), { theme: "dark" });
    const cols = 60, rows = 40;
    const values = new Float64Array(cols * rows);
    const fill = (ph: number) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6, yy = (r / rows) * 6;
        values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) + Math.sin(xx * yy * 0.15);
      }
    };
    fill(0);
    const hm = p.addHeatmap({ values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: rt });
    if (dyn) dynUpdaters.push((t) => { fill(t); hm.setData(values); p.render(); });
  },

  // --- Contour -------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Contour", "marching squares", dyn), { theme: "dark" });
    const cols = 80, rows = 60;
    const values = new Float64Array(cols * rows);
    const fill = (ph: number) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6 - 3, yy = (r / rows) * 6 - 3;
        values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) - 0.02 * (xx * xx + yy * yy);
      }
    };
    fill(0);
    const ct = p.addContour({ values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: rt });
    if (dyn) dynUpdaters.push(every(2, (t) => { fill(t); ct.setData(values); p.render(); }));
  },

  // --- Spectrogram ---------------------------------------------------------
  (grid, dyn) => {
    const p = new Plot(panel(grid, "Spectrogram", dyn ? "waterfall · scroll" : "chirp · STFT", dyn), {
      theme: "dark", axes: { x: { title: "time" }, y: { title: "freq" } },
    });
    const N = 16384, sr = 8000;
    const sig = new Float64Array(N);
    for (let i = 0; i < N; i++) { const tt = i / sr; sig[i] = Math.sin(2 * Math.PI * (200 + 1500 * (i / N)) * tt); }
    const hm = p.addHeatmapSpectrogram(sig, { fftSize: 256, hop: 128, sampleRate: sr, colormap: "plasma" });
    if (dyn) {
      // Scroll the STFT: shift columns left, synthesize a fresh right-most column.
      const cols = Math.floor((N - 256) / 128) + 1, rows = 129;
      const grid2 = new Float64Array(cols * rows);
      // seed from a moving spectral peak
      let ph = 0;
      dynUpdaters.push(() => {
        ph += 0.05;
        // shift left
        for (let r = 0; r < rows; r++) grid2.copyWithin(r * cols, r * cols + 1, (r + 1) * cols);
        const peak = (0.5 + 0.5 * Math.sin(ph)) * (rows - 1);
        for (let r = 0; r < rows; r++) grid2[r * cols + (cols - 1)] = Math.exp(-((r - peak) ** 2) / 40) + Math.random() * 0.05;
        hm.setData(grid2, cols, rows); p.render();
      });
    }
  },

  // --- Hexbin --------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Hexbin", "25k points · density", dyn), { theme: "dark" });
    const M = 25_000;
    const x = new Float64Array(M), y = new Float64Array(M);
    for (let i = 0; i < M; i++) { const blob = i % 2 === 0 ? -1.4 : 1.4; x[i] = gaussian(blob, 1); y[i] = gaussian(blob * 0.6, 1.1); }
    const hx = p.addHexbin({ x, y, radius: 0.22, colormap: "plasma", renderType: rt });
    p.setView({ x: [-5, 5], y: [-5, 5] });
    if (dyn) dynUpdaters.push(every(2, () => {
      for (let i = 0; i < M; i++) { x[i] += jitter() * 0.05 - x[i]! * 0.004; y[i] += jitter() * 0.05 - y[i]! * 0.004; }
      hx.setData(x, y); p.render();
    }));
  },

  // --- Error bars ----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Error bars", "whiskers + caps", dyn), { theme: "dark" });
    const N = 12;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
    const yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
    const line = p.addLine({ x, y, color: "#60a5fa", width: 1.5, renderType: rt });
    const eb = p.addErrorBar({ x, y, yerr, color: "#60a5fa", capSize: 7, renderType: rt });
    p.setView({ x: [-1, N], y: [0, 10] });
    if (dyn) {
      dynUpdaters.push((t) => {
        for (let i = 0; i < N; i++) { y[i] = Math.sin(i / 2 + t) * 3 + 5; yerr[i] = 0.4 + (0.5 + 0.4 * Math.sin(t + i)) * 0.9; }
        line.setData(x, y); eb.setData({ x, y, yerr }); p.render();
      });
    }
  },

  // --- Error band ----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Error band", "confidence ribbon", dyn), { theme: "dark" });
    const N = 120;
    const x = Float64Array.from({ length: N }, (_, i) => i / 10);
    const y = Float64Array.from(x, (t) => Math.sin(t));
    const err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
    const eb = p.addErrorBar({ x, y, yerr: err, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28, renderType: rt });
    const line = p.addLine({ x, y, color: "#a78bfa", width: 2, renderType: rt });
    p.setView({ x: [0, 12], y: [-1.5, 1.5] });
    if (dyn) {
      dynUpdaters.push((t) => {
        for (let i = 0; i < N; i++) { y[i] = Math.sin(x[i]! + t); err[i] = 0.12 + 0.12 * Math.abs(Math.cos(x[i]! + t)); }
        eb.setData({ x, y, yerr: err }); line.setData(x, y); p.render();
      });
    }
  },

  // --- Stem ----------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Stem plot", "discrete signal", dyn), { theme: "dark" });
    const N = 30;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
    const stem = p.addStem({ x, y, color: "#34d399", markerSize: 6, renderType: rt });
    p.setView({ x: [-1, N], y: [-1, 1.1] });
    if (dyn) {
      dynUpdaters.push((t) => {
        for (let i = 0; i < N; i++) y[i] = Math.exp(-i / 12) * Math.cos(i / 2 + t * 2);
        stem.setData(x, y); p.render();
      });
    }
  },

  // --- Quiver --------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Quiver", "vector field", dyn), { theme: "dark" });
    const G = 16;
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { xs.push((i / (G - 1)) * 4 - 2); ys.push((j / (G - 1)) * 4 - 2); }
    const us = new Float64Array(xs.length), vs = new Float64Array(xs.length);
    const fill = (ph: number) => { for (let k = 0; k < xs.length; k++) { const a = Math.cos(ph), b = Math.sin(ph); us[k] = -ys[k]! * a - xs[k]! * b * 0.3; vs[k] = xs[k]! * a - ys[k]! * b * 0.3; } };
    fill(0);
    const q = p.addQuiver({ x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" }, renderType: rt });
    p.setView({ x: [-2.4, 2.4], y: [-2.4, 2.4] });
    if (dyn) dynUpdaters.push((t) => { fill(t); q.setData(xs, ys, us, vs); p.render(); });
  },

  // --- Candlestick ---------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Candlestick", dyn ? "OHLC · streaming" : "OHLC · daily", dyn), {
      theme: "dark", scales: { x: { type: "time" } },
    });
    const N = 40, start = Date.UTC(2024, 0, 1), step = 86_400_000;
    const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
    let price = 100;
    for (let i = 0; i < N; i++) {
      const open = price, close = open + gaussian(0, 2.2);
      x[i] = start + i * step; o[i] = open; c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
      price = close;
    }
    const cs = p.addCandlestick({ x, open: o, high: h, low: l, close: c, renderType: rt });
    if (dyn) {
      let lastX = x[N - 1]!, lastClose = c[N - 1]!, curOpen = lastClose, curClose = lastClose, hi = lastClose, lo = lastClose;
      let sinceClose = 0;
      dynUpdaters.push(() => {
        // Perturb the forming candle every frame.
        curClose += gaussian(0, 0.35);
        hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
        cs.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose });
        p.render();
        // Every ~70 frames the bar closes and a new one opens.
        if (++sinceClose > 70) {
          sinceClose = 0; lastX += step; curOpen = curClose; hi = lo = curOpen;
          cs.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen });
          p.setView({ x: [lastX - step * 42, lastX + step * 2] });
        }
      });
    }
  },

  // --- OHLC bars -----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "OHLC", dyn ? "bars · streaming" : "bars · daily", dyn), {
      theme: "dark", scales: { x: { type: "time" } },
    });
    const N = 40, start = Date.UTC(2024, 0, 1), step = 86_400_000;
    const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
    let price = 100;
    for (let i = 0; i < N; i++) {
      const open = price, close = open + gaussian(0, 2.2);
      x[i] = start + i * step; o[i] = open; c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
      price = close;
    }
    const ol = p.addOhlc({ x, open: o, high: h, low: l, close: c, renderType: rt });
    if (dyn) {
      let lastX = x[N - 1]!, curOpen = c[N - 1]!, curClose = curOpen, hi = curOpen, lo = curOpen, sinceClose = 0;
      dynUpdaters.push(() => {
        curClose += gaussian(0, 0.35); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
        ol.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose });
        p.render();
        if (++sinceClose > 70) {
          sinceClose = 0; lastX += step; curOpen = curClose; hi = lo = curOpen;
          ol.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen });
          p.setView({ x: [lastX - step * 42, lastX + step * 2] });
        }
      });
    }
  },

  // --- Ordinal-time (finance session axis, weekend gaps collapse) ----------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const N = 60;
    const times = businessDays(N, Date.UTC(2024, 0, 1));
    const idx = Float64Array.from({ length: N }, (_, i) => i);
    const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
    let price = 100;
    for (let i = 0; i < N; i++) {
      const open = price, close = open + gaussian(0, 2);
      o[i] = open; c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1));
      price = close;
    }
    const p = new Plot(panel(grid, "Ordinal-time axis", "sessions · weekend gaps collapse", dyn), {
      theme: "dark", scales: { x: { type: "ordinal-time", times } },
    });
    const cs = p.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: rt });
    if (dyn) {
      // Roll the forming bar in place (fixed window keeps indices/times valid).
      let curOpen = c[N - 1]!, curClose = curOpen, hi = curOpen, lo = curOpen, sinceClose = 0;
      dynUpdaters.push(() => {
        curClose += gaussian(0, 0.3); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
        cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
        p.render();
        if (++sinceClose > 60) {
          sinceClose = 0;
          // shift window left by one bar, keep the ordinal-time axis fixed
          for (let i = 0; i < N - 1; i++) { o[i] = o[i + 1]!; h[i] = h[i + 1]!; l[i] = l[i + 1]!; c[i] = c[i + 1]!; }
          curOpen = curClose; o[N - 1] = curOpen; h[N - 1] = curOpen; l[N - 1] = curOpen; c[N - 1] = curOpen;
          hi = lo = curOpen;
          cs.setData({ x: idx, open: o, high: h, low: l, close: c });
        }
      });
    }
  },

  // --- Pie -----------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Pie", "market share", dyn), {
      theme: "dark", equalAspect: true, showToolbar: false, hover: false,
      axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } },
    });
    const vals = [35, 25, 20, 12, 8];
    const pie = p.addPie({ values: vals, colormap: "viridis", renderType: rt });
    p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
    if (dyn) dynUpdaters.push(every(3, () => {
      for (let i = 0; i < vals.length; i++) vals[i] = Math.max(3, vals[i]! + jitter() * 3);
      pie.setData(vals); p.render();
    }));
  },

  // --- Donut ---------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Donut", "categories", dyn), {
      theme: "dark", equalAspect: true, showToolbar: false, hover: false,
      axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } },
    });
    const vals = [8, 6, 5, 4, 3, 2];
    const pie = p.addPie({ values: vals, innerRadius: 0.55, renderType: rt });
    p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
    if (dyn) dynUpdaters.push(every(3, () => {
      for (let i = 0; i < vals.length; i++) vals[i] = Math.max(1.5, vals[i]! + jitter() * 2);
      pie.setData(vals); p.render();
    }));
  },

  // --- Patches (choropleth) ------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Patches", "polygons · choropleth", dyn), { theme: "dark", showToolbar: false });
    const cols = 6, rows = 4;
    const cells: Array<{ x: number[]; y: number[]; base: number }> = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const j = () => (rand() - 0.5) * 0.22;
      cells.push({ x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()], y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()], base: Math.sin(c * 0.7) + Math.cos(r * 0.9) });
    }
    const mk = (ph: number) => cells.map((cell, i) => ({ x: cell.x, y: cell.y, value: cell.base + Math.sin(ph + i * 0.4) * 0.6 }));
    const patch = p.addPatches({ patches: mk(0), colormap: "plasma", renderType: rt });
    p.setView({ x: [-0.3, cols + 0.3], y: [-0.3, rows + 0.3] });
    if (dyn) dynUpdaters.push(every(2, (t) => { patch.setData(mk(t)); p.render(); }));
  },

  // --- Annotations ---------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Annotations", "span · band · box · label", dyn), { theme: "dark", showToolbar: false });
    const N = 100;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.15) * 3 + 5);
    const line = p.addLine({ x, y, color: "#38bdf8", width: 2, renderType: rt });
    p.setView({ x: [0, N - 1], y: [0, 10] });
    p.addAnnotation({ type: "band", dim: "y", from: 6, to: 8, color: "rgba(52,211,153,0.15)" });
    p.addAnnotation({ type: "span", dim: "y", value: 5, color: "#f59e0b", dash: [5, 4] });
    p.addAnnotation({ type: "span", dim: "x", value: 50, color: "#f472b6", dash: [5, 4] });
    p.addAnnotation({ type: "box", x: [20, 35], y: [2, 4], border: "#a78bfa" });
    p.addAnnotation({ type: "label", x: 52, y: 9, text: "event", color: "#f472b6" });
    if (dyn) dynUpdaters.push((t) => {
      for (let i = 0; i < N; i++) y[i] = Math.sin(i * 0.15 + t) * 3 + 5;
      line.setData(x, y); p.render();
    });
  },

  // --- Image ---------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Image", "RGBA glyph · textured quad", dyn), { theme: "dark", showToolbar: false });
    const iw = 96, ih = 96;
    const id = new ImageData(iw, ih);
    const paint = (cx: number, cy: number) => {
      for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) {
        const i = (yy * iw + xx) * 4;
        const d = Math.hypot(xx - cx, yy - cy) / (iw / 2);
        id.data[i] = Math.round((xx / iw) * 255);
        id.data[i + 1] = Math.round((yy / ih) * 255);
        id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
        id.data[i + 3] = 255;
      }
    };
    paint(iw / 2, ih / 2);
    const img = p.addImage({ source: id, extent: { x: [0, 10], y: [0, 10] }, renderType: rt });
    p.setView({ x: [-0.5, 10.5], y: [-0.5, 10.5] });
    if (dyn) dynUpdaters.push((t) => {
      paint(iw / 2 + Math.cos(t * 1.5) * iw * 0.3, ih / 2 + Math.sin(t * 1.5) * ih * 0.3);
      img.setData(id); p.render();
    });
  },

  // --- Graph ---------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Graph", "force layout · nodes + edges", dyn), { theme: "dark", showToolbar: false, equalAspect: true });
    const edges: [number, number][] = [
      [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
      [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
    ];
    const nNodes = 10;
    // fixed base positions on a circle so we can wobble them deterministically
    const bx = new Float64Array(nNodes), by = new Float64Array(nNodes);
    for (let i = 0; i < nNodes; i++) { bx[i] = Math.cos((i / nNodes) * Math.PI * 2); by[i] = Math.sin((i / nNodes) * Math.PI * 2); }
    const g = p.addGraph({ x: bx, y: by, edges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: rt });
    p.setView({ x: [-1.5, 1.5], y: [-1.5, 1.5] });
    if (dyn) {
      const x = new Float64Array(nNodes), y = new Float64Array(nNodes);
      dynUpdaters.push((t) => {
        for (let i = 0; i < nNodes; i++) { x[i] = bx[i]! + Math.sin(t * 2 + i) * 0.12; y[i] = by[i]! + Math.cos(t * 2 + i) * 0.12; }
        g.setData({ x, y, edges }); p.render();
      });
    }
  },

  // --- Log axis ------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Log axis", "exp decay · log y", dyn), {
      theme: "dark", scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } },
    });
    const N = 200;
    const x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10);
    const taus = [1.2, 2.5, 5], colors = ["#f472b6", "#60a5fa", "#34d399"];
    const ys = taus.map((tau) => Float64Array.from(x, (t) => Math.exp(-t / tau) + 1e-3));
    const lines = ys.map((y, k) => p.addLine({ x, y, color: colors[k], width: 1.5, name: `τ=${taus[k]}`, renderType: rt }));
    if (dyn) dynUpdaters.push((t) => {
      taus.forEach((tau, k) => { const y = ys[k]!; for (let i = 0; i < N; i++) y[i] = Math.exp(-x[i]! / tau) * (1 + 0.3 * Math.sin(t * 2 + i * 0.1)) + 1e-3; lines[k]!.setData(x, y); });
      p.render();
    });
  },

  // --- Time axis -----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Time axis", "1 day · date ticks", dyn), { theme: "dark", scales: { x: { type: "time" } } });
    const start = Date.UTC(2024, 0, 1), N = 24 * 60;
    const x = new Float64Array(N), y = new Float64Array(N);
    for (let i = 0; i < N; i++) { x[i] = start + i * 60_000; const h = i / 60; y[i] = 20 + 6 * Math.sin((h - 9) / 24 * 2 * Math.PI) + gaussian(0, 0.4); }
    const line = p.addLine({ x, y, color: "#22d3ee", width: 1.5, renderType: rt });
    if (dyn) {
      let ph = N;
      dynUpdaters.push(() => {
        y.copyWithin(0, 1); x.copyWithin(0, 1); ph++;
        x[N - 1] = start + ph * 60_000; const h = ph / 60;
        y[N - 1] = 20 + 6 * Math.sin((h - 9) / 24 * 2 * Math.PI) + gaussian(0, 0.4);
        line.setData(x, y); p.render();
      });
    }
  },

  // --- Dual Y --------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "Dual Y", "two scales", dyn), { theme: "dark", axes: { y: { title: "amp" } } });
    p.addYAxis("t", { side: "right", color: "#f472b6", title: "temp" });
    const N = 400;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
    const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
    const l1 = p.addLine({ x, y: a, color: "#60a5fa", width: 1.5, decimate: false, renderType: rt });
    const l2 = p.addLine({ x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false, renderType: rt });
    p.setView({ x: [0, N - 1], y: [-2, 2], yAxes: { t: [15, 35] } });
    if (dyn) {
      let ph = N;
      dynUpdaters.push(() => {
        a.copyWithin(0, 1); b.copyWithin(0, 1); ph += 1;
        a[N - 1] = Math.sin(ph * 0.05) * 1.5 + jitter() * 0.15;
        b[N - 1] = 25 + Math.sin(ph * 0.02) * 6 + jitter() * 0.6;
        l1.setData(x, a); l2.setData(x, b); p.render();
      });
    }
  },

  // --- 1M points (decimation) ----------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p = new Plot(panel(grid, "1M points", dyn ? "GPU decimation · panning" : "GPU min/max decimation", dyn), { theme: "dark" });
    const N = 1_000_000;
    const x = new Float64Array(N), y = new Float64Array(N);
    for (let i = 0; i < N; i++) { x[i] = i; y[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05); }
    p.addLine({ x, y, color: "#34d399", width: 1.5, renderType: rt });
    if (dyn) {
      // Cheap "streaming": glide a 50k-wide window across the million points.
      const win = 50_000;
      p.setView({ x: [0, win], y: [-1.5, 1.5] });
      dynUpdaters.push((t) => {
        const c = (Math.sin(t * 0.3) * 0.5 + 0.5) * (N - win);
        p.setView({ x: [c, c + win] }); p.render();
      });
    }
  },

  // --- Styled + categorical ------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const p = new Plot(panel(grid, "Styled + categorical", "bg · title · legend · rotated ticks", dyn), {
      theme: "dark", background: "#0b1220", border: "#060a14",
      title: { text: "Quarterly revenue", align: "left" }, legend: { position: "top-left" },
      scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
      axes: { x: { title: "month", labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" }, y: { title: "revenue", gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] } },
      showToolbar: false,
    });
    const idx = Float64Array.from(months, (_, i) => i);
    const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
    const target = Float64Array.from(months, () => 70 + rand() * 12);
    const bar = p.addBar({ x: idx, y: revenue, width: 0.6, color: "#38bdf8", name: "revenue", renderType: rt });
    const line = p.addLine({ x: idx, y: target, color: "#f59e0b", width: 2.5, name: "target", renderType: rt });
    if (dyn) dynUpdaters.push(() => {
      for (let i = 0; i < months.length; i++) { revenue[i] = Math.max(5, Math.min(105, revenue[i]! + jitter() * 6)); target[i] = Math.max(40, Math.min(100, target[i]! + jitter() * 3)); }
      bar.setData(idx, revenue); line.setData(idx, target); p.render();
    });
  },

  // --- Polar radar ---------------------------------------------------------
  (grid, dyn) => {
    const pp = new PolarPlot(panel(grid, "Polar radar", "rotating sweep", dyn), { theme: "dark", angleUnit: "deg", maxRadius: 1 });
    const sweep = pp.addLine({ theta: [0, 0], r: [0, 1], color: "#22d3ee", width: 2 });
    const B = 14;
    const bt = Float64Array.from({ length: B }, () => rand() * 360);
    const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
    pp.addScatter({ theta: bt, r: br, color: "#f472b6", size: 6, labels: Array.from({ length: B }, (_, i) => `Contact ${i + 1}`) });
    if (dyn) {
      let ang = 0;
      dynUpdaters.push(() => { ang = (ang + 2.5) % 360; sweep.setData([ang, ang], [0, 1]); });
    }
  },

  // --- Polar rose ----------------------------------------------------------
  (grid, dyn) => {
    const pp = new PolarPlot(panel(grid, "Polar rose", "morphing curve", dyn), { theme: "dark", maxRadius: 1 });
    const T = 240;
    const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
    const r = new Float64Array(T);
    for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(3 * theta[i]!));
    const rose = pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
    if (dyn) dynUpdaters.push((t) => { const k = 3 + 2 * Math.sin(t * 0.3); for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(k * theta[i]!)); rose.setData(theta, r); });
  },

  // --- 3D surface ----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D surface", "title · colorbar · light", dyn), { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" });
    const cols = 64, rows = 64;
    const values = new Float64Array(cols * rows);
    const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 2 - ph) / rr) * 3; } };
    fill(0);
    const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height", renderType: rt });
    if (dyn) dynUpdaters.push((t) => { fill(t * 3); surf.setData(values); p3.refresh(); });
  },

  // --- 3D bars -------------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D bars", "colormapped · lit", dyn), { axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" });
    const gx = 8, gz = 8;
    const xa: number[] = [], za: number[] = [];
    for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
    const ya = new Float64Array(xa.length);
    const fill = (ph: number) => { for (let k = 0; k < xa.length; k++) ya[k] = 1.5 + Math.sin(xa[k]! * 0.6 + ph) * Math.cos(za[k]! * 0.6) * 1.5; };
    fill(0);
    const bar = p3.addBar3D({ x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: rt });
    if (dyn) dynUpdaters.push((t) => { fill(t * 2); bar.setData(xa, za, ya); p3.refresh(); });
  },

  // --- 3D lines ------------------------------------------------------------
  (grid, dyn) => {
    const p3 = new Plot3D(panel(grid, "3D lines", "paths · legend", dyn), { axisLabels: { x: "x", y: "y", z: "z" }, legend: true });
    const N = 400;
    const mk = (phase: number) => { const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N); for (let i = 0; i < N; i++) { const tt = (i / (N - 1)) * Math.PI * 2 * 4; x[i] = Math.cos(tt + phase); z[i] = Math.sin(tt + phase); y[i] = (i / (N - 1)) * 4 - 2; } return { x, y, z }; };
    const a = mk(0), b = mk(Math.PI);
    const la = p3.addLine3D({ ...a, color: "#38bdf8", name: "α" });
    const lb = p3.addLine3D({ ...b, color: "#f472b6", name: "β" });
    if (dyn) dynUpdaters.push((t) => { const na = mk(t * 2), nb = mk(Math.PI + t * 2); la.setData(na.x, na.y, na.z); lb.setData(nb.x, nb.y, nb.z); p3.refresh(); });
  },

  // --- 3D wireframe --------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D wireframe", "lines · hover · reset", dyn), { axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" });
    const cols = 40, rows = 40;
    const values = new Float64Array(cols * rows);
    const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 1.5 - ph) / rr) * 3; } };
    fill(0);
    const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "plasma", wireframe: true, name: "height", renderType: rt });
    if (dyn) dynUpdaters.push((t) => { fill(t * 3); surf.setData(values); p3.refresh(); });
  },

  // --- 3D quiver -----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D quiver", "vector field · colorbar", dyn), { axisLabels: { x: "x", y: "y", z: "z" } });
    const g = 6;
    const xa: number[] = [], ya: number[] = [], za: number[] = [];
    for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) { xa.push((i / (g - 1)) * 2 - 1); ya.push((j / (g - 1)) * 2 - 1); za.push((k / (g - 1)) * 2 - 1); }
    const u = new Float64Array(xa.length), v = new Float64Array(xa.length), w = new Float64Array(xa.length);
    const fill = (ph: number) => { const ca = Math.cos(ph), sa = Math.sin(ph); for (let k = 0; k < xa.length; k++) { u[k] = -ya[k]! * ca; v[k] = xa[k]! * ca; w[k] = za[k]! * 0.3 * sa; } };
    fill(0);
    const q = p3.addQuiver3D({ x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: rt });
    if (dyn) dynUpdaters.push((t) => { fill(t * 2); q.setData(xa, ya, za, u, v, w); p3.refresh(); });
  },

  // --- 3D contour ----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D contour", "iso-height rings", dyn), { axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" });
    const cols = 50, rows = 50;
    const values = new Float64Array(cols * rows);
    const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 1.5 - ph) / rr) * 3; } };
    fill(0);
    const ct = p3.addContour3D({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: rt });
    if (dyn) dynUpdaters.push(every(3, (t) => { fill(t * 3); ct.setData(values); p3.refresh(); }));
  },

  // --- 3D isosurface -------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D isosurface", "marching cubes · metaballs", dyn), { axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" });
    const n = dyn ? 28 : 40;
    const vol = new Float64Array(n * n * n);
    const fill = (ph: number) => {
      const blobs = [[-0.5 + Math.sin(ph) * 0.3, 0, 0], [0.6, 0.3 + Math.cos(ph) * 0.3, -0.2], [0.1, -0.5, 0.4 + Math.sin(ph * 1.3) * 0.3]];
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1;
        let s = 0; for (const b of blobs) { const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2; s += Math.exp(-d2 * 6); }
        vol[x + y * n + z * n * n] = s;
      }
    };
    fill(0);
    const iso = p3.addIsosurface({ values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: rt });
    if (dyn) dynUpdaters.push(every(5, (t) => { fill(t); iso.setData(vol, [n, n, n], 0.5, { x: [-1, 1], y: [-1, 1], z: [-1, 1] }); p3.refresh(); }));
  },

  // --- 3D scatter ----------------------------------------------------------
  (grid, dyn) => {
    const p3 = new Plot3D(panel(grid, "3D scatter", "per-point size · labels", dyn), { axisLabels: { x: "x", y: "y", z: "z" } });
    const N = 300;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), sizes = new Float64Array(N), vals = new Float64Array(N);
    const labels: string[] = [];
    for (let i = 0; i < N; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); z[i] = gaussian(0, 1); const r = Math.hypot(x[i]!, y[i]!, z[i]!); sizes[i] = 3 + r * 6; vals[i] = r; labels.push(`p${i} · r=${r.toFixed(2)}`); }
    const sc = p3.addPointCloud({ x, y, z, sizes, labels, colorBy: { values: vals, colormap: "plasma" }, name: "r" });
    if (dyn) dynUpdaters.push(() => { for (let i = 0; i < N; i++) { x[i] += jitter() * 0.04 - x[i]! * 0.006; y[i] += jitter() * 0.04 - y[i]! * 0.006; z[i] += jitter() * 0.04 - z[i]! * 0.006; } sc.setData(x, y, z); p3.refresh(); });
  },

  // --- 3D volume -----------------------------------------------------------
  (grid, dyn) => {
    const rt = dyn ? "dynamic" : "static";
    const p3 = new Plot3D(panel(grid, "3D volume", "raymarch · grid · auto-rotate", dyn), { axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true });
    const n = 48;
    const vol = new Float64Array(n * n * n);
    const blobs = [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]];
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1;
      let s = 0; for (const b of blobs) { const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2; s += Math.exp(-d2 * 5); }
      vol[x + y * n + z * n * n] = s;
    }
    p3.addVolume({ values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: rt });
    // autoRotate already streams frames continuously; no extra updater needed.
  },

  // --- 3D point cloud ------------------------------------------------------
  (grid, dyn) => {
    const p3 = new Plot3D(panel(grid, "3D point cloud", "axes · colored by height", dyn), { axisLabels: { x: "x", y: "height", z: "z" } });
    const N = 6000;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
    const build = (ph: number) => { for (let i = 0; i < N; i++) { const th = (i / N) * Math.PI * 20 + ph, rr = 1 + (i / N) * 2; x[i] = Math.cos(th) * rr; z[i] = Math.sin(th) * rr; y[i] = (i / N) * 4 - 2; } };
    build(0);
    const sc = p3.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
    if (dyn) dynUpdaters.push((t) => { build(t); sc.setData(x, y, z); p3.refresh(); });
  },
];

/** Business-day epoch-ms timestamps (skip Sat/Sun) — for the ordinal-time axis. */
function businessDays(n: number, startMs: number): number[] {
  const out: number[] = [];
  let ms = startMs;
  while (out.length < n) {
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) out.push(ms);
    ms += 86_400_000;
  }
  return out;
}

// ============================================================================
// Dynamic-only extra: a linked finance dashboard — price candlesticks over an
// ordinal-time axis with a volume pane below, pan/zoom + crosshair linkX-ed.
// ============================================================================
function buildLinkedFinance(grid: HTMLElement): void {
  const N = 60;
  const times = businessDays(N, Date.UTC(2024, 0, 1));
  const idx = Float64Array.from({ length: N }, (_, i) => i);
  const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N), vol = new Float64Array(N);
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price, close = open + gaussian(0, 2);
    o[i] = open; c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1));
    vol[i] = 20 + Math.abs(close - open) * 6 + rand() * 10;
    price = close;
  }

  const priceChart = panel(grid, "Linked finance · price", "candlesticks · ordinal-time", true);
  const volChart = panel(grid, "Linked finance · volume", "linkX-ed pane", true);

  const priceP = new Plot(priceChart, { theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false });
  const cs = priceP.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });

  const volP = new Plot(volChart, { theme: "dark", scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 80] } }, showToolbar: false });
  const volBar = volP.addBar({ x: idx, y: vol, width: 0.7, color: "#38bdf8", renderType: "dynamic" });

  linkX([priceP, volP]);

  let curOpen = c[N - 1]!, curClose = curOpen, hi = curOpen, lo = curOpen, curVol = vol[N - 1]!, sinceClose = 0;
  dynUpdaters.push(() => {
    curClose += gaussian(0, 0.3); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
    curVol = Math.max(5, curVol + jitter() * 3);
    cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
    vol[N - 1] = curVol; volBar.setData(idx, vol);
    priceP.render(); volP.render();
    if (++sinceClose > 60) {
      sinceClose = 0;
      for (let i = 0; i < N - 1; i++) { o[i] = o[i + 1]!; h[i] = h[i + 1]!; l[i] = l[i + 1]!; c[i] = c[i + 1]!; vol[i] = vol[i + 1]!; }
      curOpen = curClose; o[N - 1] = curOpen; h[N - 1] = curOpen; l[N - 1] = curOpen; c[N - 1] = curOpen; hi = lo = curOpen;
      curVol = 20 + rand() * 10; vol[N - 1] = curVol;
      cs.setData({ x: idx, open: o, high: h, low: l, close: c });
    }
  });
}

// ============================================================================
// MAPS TAB — offline vector basemaps. No FPS badges.
// ============================================================================
function buildMaps(grid: HTMLElement): void {
  // 1) GeoJSON world — fully offline (Natural Earth 10m embedded in the lib).
  {
    const chart = panel(grid, "GeoJSON world", "offline · Natural Earth 10m");
    const adminStyle: MapStyle = {
      background: [0.05, 0.09, 0.16, 1],
      paint(_layer, type) {
        if (type === "polygon") return { kind: "fill", color: [0.16, 0.2, 0.26, 1], outline: [0.5, 0.58, 0.68, 1], outlineWidth: 1.2 };
        return { kind: "line", color: [0.5, 0.58, 0.68, 1], width: 1.2 };
      },
    };
    const plot = new Plot(chart, {
      theme: "dark", showToolbar: true, equalAspect: true, boundedPan: true,
      hoverReadout: (x, y) => { const [lon, lat] = worldToLonLat(x, y); return [{ label: "lon", value: `${lon.toFixed(2)}°` }, { label: "lat", value: `${lat.toFixed(2)}°` }]; },
    });
    const layer = addGeoJson(plot, { geojson: worldCountries, layer: "admin", style: adminStyle });
    const cap = caption(chart, "© Natural Earth (public domain) · embedded");
    chart.addEventListener("click", (e) => {
      const d = plot.dataAt(e.clientX, e.clientY); if (!d) return;
      const hit = layer.pickFeature(d.x, d.y);
      cap.textContent = hit ? String(hit.properties.ADMIN ?? hit.properties.NAME ?? "—") : "© Natural Earth · embedded";
    });
  }

  // 2) Vector basemap — keyless MapLibre demo tiles + city overlay (no key/file).
  {
    const chart = panel(grid, "Vector basemap", "addMap · MVT · city overlay");
    const source = xyzVectorSource({ url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf", attribution: "© MapLibre demo tiles", maxZoom: 5 });
    const oceanStyle: MapStyle = {
      background: [0.05, 0.09, 0.16, 1],
      paint(layer, type) {
        if (layer === "countries") return type === "polygon" ? { kind: "fill", color: [0.16, 0.2, 0.26, 1] } : { kind: "line", color: [0.3, 0.36, 0.44, 1], width: 1 };
        if (layer === "geolines") return { kind: "line", color: [0.2, 0.25, 0.32, 1], width: 1 };
        return null;
      },
    };
    const plot = new Plot(chart, {
      theme: "dark", showToolbar: true, equalAspect: true, crosshair: true, pick: "xy", boundedPan: true,
      hoverReadout: (x, y) => { const [lon, lat] = worldToLonLat(x, y); return [{ label: "lon", value: `${lon.toFixed(2)}°` }, { label: "lat", value: `${lat.toFixed(2)}°` }]; },
    });
    const map = addMap(plot, { source, style: oceanStyle, bbox: [-175, -58, 190, 78] });
    const cities: Array<[string, number, number]> = [
      ["Istanbul", 28.98, 41.01], ["Tokyo", 139.69, 35.69], ["New York", -74.0, 40.71],
      ["São Paulo", -46.63, -23.55], ["Sydney", 151.21, -33.87], ["Cairo", 31.24, 30.04],
    ];
    const wx: number[] = [], wy: number[] = [];
    for (const [, lon, lat] of cities) { const [x, y] = lonLatToWorld(lon, lat); wx.push(x); wy.push(y); }
    plot.addScatter({ x: wx, y: wy, size: 8, color: "#f472b6", labels: cities.map(([name]) => name) });
    caption(chart, map.attribution);
  }

  // 3) PMTiles (offline) — guarded: only builds a map once the user picks a file.
  {
    const chart = panel(grid, "PMTiles (offline)", "pick a local .pmtiles file");
    const plot = new Plot(chart, {
      theme: "dark", showToolbar: true, equalAspect: true, boundedPan: true, crosshair: true,
      hoverReadout: (x, y) => { const [lon, lat] = worldToLonLat(x, y); return [{ label: "lon", value: `${lon.toFixed(2)}°` }, { label: "lat", value: `${lat.toFixed(2)}°` }]; },
    });
    const cap = caption(chart, "no network — pick a .pmtiles file →");
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".pmtiles";
    chart.appendChild(input);
    let map: MapLayer | null = null;
    input.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      if (map) { map.dispose(); map = null; }
      const source = pmtilesSource({ blob: file, attribution: `local: ${file.name}` });
      map = addMap(plot, { source, style: protomapsStyle("dark") });
      cap.textContent = `local: ${file.name}`;
    });
    chart.addEventListener("click", (e) => {
      if (!map) return;
      const d = plot.dataAt(e.clientX, e.clientY); if (!d) return;
      const hit = map.pickFeature(d.x, d.y);
      if (hit) cap.textContent = `${hit.layer}: ${JSON.stringify(hit.properties)}`;
    });
  }
}

// ============================================================================
// Lazy tab building + switching.
// ============================================================================
// ============================ FINANCE PANELS ===============================
// Specialist finance charts built on the finance module (indicators + transforms).
function buildFinance(grid: HTMLElement): void {
  reseed();
  const N = 90;
  const times = businessDays(N, Date.UTC(2024, 0, 1));
  const idx = Float64Array.from({ length: N }, (_, i) => i);
  const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N), vol = new Float64Array(N);
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price, close = open + gaussian(0, 2.2);
    o[i] = open; c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.2));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.2));
    vol[i] = 20 + Math.abs(close - open) * 6 + rand() * 12;
    price = close;
  }
  // Slice a series past its warm-up NaNs (indicators return leading NaN).
  const trim = (y: Float64Array): { x: Float64Array; y: Float64Array } => {
    const s = Math.max(0, firstFinite(y));
    return { x: idx.subarray(s), y: y.subarray(s) };
  };

  // Heikin-Ashi — smoothed candles on the gap-collapsing session axis.
  const ha = new Plot(panel(grid, "Heikin-Ashi", "smoothed candles"), {
    theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false,
  });
  addHeikinAshi(ha, { x: idx, open: o, high: h, low: l, close: c });
  ha.render();

  // Renko — fixed-size bricks (time discarded).
  const rk = new Plot(panel(grid, "Renko", "brickSize 2 · wickless"), { theme: "dark", showToolbar: false });
  addRenko(rk, { close: c, brickSize: 2 });
  rk.render();

  // Bollinger Bands over the candles.
  const bb = new Plot(panel(grid, "Bollinger Bands", "20 · 2σ"), {
    theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false,
  });
  bb.addCandlestick({ x: idx, open: o, high: h, low: l, close: c });
  addBollinger(bb, { x: idx, close: c, period: 20, k: 2, bandColor: "rgba(167,139,250,0.14)" });
  bb.render();

  // Volume profile — volume by price (horizontal), POC highlighted.
  const vp = new Plot(panel(grid, "Volume profile", "volume by price · POC"), { theme: "dark", showToolbar: false });
  addVolumeProfile(vp, { price: c, volume: vol, bins: 24, color: "#3b82f6", pocColor: "#f59e0b" });
  vp.render();

  // Depth chart — synthesize a cumulative order book around the last price.
  const mid = c[N - 1]!;
  const bids: [number, number][] = [], asks: [number, number][] = [];
  for (let i = 1; i <= 20; i++) { bids.push([mid - i * 0.5, 5 + rand() * 20]); asks.push([mid + i * 0.5, 5 + rand() * 20]); }
  const dp = new Plot(panel(grid, "Depth chart", "cumulative order book"), { theme: "dark", showToolbar: false });
  addDepth(dp, { bids, asks });
  dp.render();

  // Linked dashboard: price + RSI(14) + MACD, all synced on the ordinal-time axis.
  const priceP = new Plot(panel(grid, "Linked · price", "candles · drag to pan"), {
    theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false,
  });
  priceP.addCandlestick({ x: idx, open: o, high: h, low: l, close: c });
  priceP.render();

  const rsiP = new Plot(panel(grid, "Linked · RSI(14)", "70 / 30 guides"), {
    theme: "dark", scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 100] } }, showToolbar: false,
  });
  const r = trim(rsi(c, 14));
  rsiP.addLine({ x: r.x, y: r.y, color: "#f472b6", width: 1.5, name: "RSI" });
  rsiP.addAnnotation({ type: "span", dim: "y", value: 70, color: "#475569", dash: [4, 4] });
  rsiP.addAnnotation({ type: "span", dim: "y", value: 30, color: "#475569", dash: [4, 4] });
  rsiP.render();

  const m = macd(c, 12, 26, 9);
  const macdP = new Plot(panel(grid, "Linked · MACD", "12/26/9"), {
    theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false,
  });
  const hist = trim(m.histogram);
  macdP.addBar({ x: hist.x, y: hist.y, width: 0.7, color: "#64748b" });
  const ml = trim(m.macd), sl = trim(m.signal);
  macdP.addLine({ x: ml.x, y: ml.y, color: "#60a5fa", width: 1.5, name: "MACD" });
  macdP.addLine({ x: sl.x, y: sl.y, color: "#f59e0b", width: 1.5, name: "signal" });
  macdP.render();

  linkX([priceP, rsiP, macdP]);
}

const built = { static: false, dynamic: false, maps: false, finance: false };

function buildStatic(): void { reseed(); for (const b of CHARTS) b(gridStatic, false); }
function buildDynamic(): void { reseed(); for (const b of CHARTS) b(gridDynamic, true); buildLinkedFinance(gridDynamic); }

type TabName = "static" | "dynamic" | "finance" | "maps";
const gridOf: Record<TabName, HTMLElement> = { static: gridStatic, dynamic: gridDynamic, finance: gridFinance, maps: gridMaps };

function activate(name: TabName): void {
  for (const t of document.querySelectorAll<HTMLElement>(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const s of document.querySelectorAll<HTMLElement>(".tabpanel")) s.classList.toggle("active", s.id === `panel-${name}`);

  if (!built[name]) {
    built[name] = true;
    if (name === "static") buildStatic();
    else if (name === "dynamic") buildDynamic();
    else if (name === "finance") buildFinance(gridFinance);
    else buildMaps(gridMaps);
    // Reflect the panel count in the tab label.
    document.getElementById(`count-${name}`)!.textContent = String(gridOf[name].children.length);
  }
  dynamicActive = name === "dynamic";
}

for (const t of document.querySelectorAll<HTMLElement>(".tab")) {
  t.addEventListener("click", () => activate(t.dataset.tab as TabName));
}

// Static is the default and is visible on load, so build it immediately.
activate("static");
