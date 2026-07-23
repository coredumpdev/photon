<script lang="ts">
  import {
    addBollinger,
    addDepth,
    type SeriesSpec,
    type PolarSeriesSpec,
    type LayerSpec3D,
    type PlotConfig,
    type PolarConfig,
    type Plot3DConfig,
  } from "@photonviz/svelte";
  import {
    Plot as CorePlot,
    Plot3D as CorePlot3D,
    PolarPlot as CorePolarPlot,
  } from "@photonviz/core";
  import { xyzVectorSource, worldToLonLat, type MapStyle } from "@photonviz/map";
  import { worldCountries } from "@photonviz/map/world";

  import StatPanel from "./StatPanel.svelte";
  import DynPanel from "./DynPanel.svelte";
  import ImpPanel from "./ImpPanel.svelte";
  import LinkedFinance from "./LinkedFinance.svelte";
  import FinanceDashboard from "./FinanceDashboard.svelte";
  import type { LiveHandle } from "./live";
  import type { Plot as CorePlotT } from "@photonviz/core";

  // ==========================================================================
  // Seeded RNG — identical gallery on every reload.
  // ==========================================================================
  let seed = 42;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  function gaussian(m: number, sd: number): number {
    const u = rand() || 1e-9;
    const v = rand() || 1e-9;
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const jitter = () => Math.random() - 0.5;

  /** Business-day epoch-ms timestamps (skip Sat/Sun) — for ordinal-time axes. */
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

  const dark = { theme: "dark" as const };

  // ==========================================================================
  // STATIC catalog — declarative, one panel per chart type via the Svelte
  // actions (use:plot / use:polarPlot / use:plot3d). Every series carries
  // renderType:"static".
  // ==========================================================================
  interface Stat {
    title: string;
    subtitle?: string;
    kind: "plot" | "polar" | "plot3d";
    cfg: PlotConfig | PolarConfig | Plot3DConfig;
  }

  function buildStatic(): Stat[] {
    seed = 42;
    const out: Stat[] = [];
    const rt = "static" as const;

    // --- Line ---------------------------------------------------------------
    {
      const N = 600;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
      out.push({ title: "Line", subtitle: "sine sum", kind: "plot", cfg: {
        options: dark, series: [{ type: "line", x, y, color: "#34d399", width: 2, renderType: rt }] } });
    }

    // --- Signals (3 channels) ----------------------------------------------
    {
      const N = 500;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
      const series: SeriesSpec[] = colors.map((color, i) => {
        const y = Float64Array.from({ length: N }, (_, j) => Math.sin(j * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + i * 0.1);
        return { type: "line", x, y, color, width: 1.5, renderType: rt };
      });
      out.push({ title: "Signals", subtitle: "3 channels", kind: "plot", cfg: { options: dark, series } });
    }

    // --- Scatter markers (6 glyph shapes) ----------------------------------
    {
      const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
      const colors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
      const M = 12;
      const x = Float64Array.from({ length: M }, (_, i) => i);
      const series: SeriesSpec[] = shapes.map((marker, r) => ({
        type: "scatter", x, y: Float64Array.from({ length: M }, () => shapes.length - 1 - r),
        size: 14, marker, color: colors[r], name: marker, renderType: rt,
      }));
      out.push({ title: "Scatter markers", subtitle: "6 glyph shapes", kind: "plot",
        cfg: { options: { ...dark, showToolbar: false }, series } });
    }

    // --- Scatter · colorBy --------------------------------------------------
    {
      const M = 1200;
      const x = new Float64Array(M), y = new Float64Array(M), v = new Float64Array(M);
      for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1.4); y[i] = gaussian(0, 1.4); v[i] = Math.hypot(x[i]!, y[i]!); }
      out.push({ title: "Scatter · colorBy", subtitle: "value → viridis", kind: "plot", cfg: {
        options: dark, series: [{ type: "scatter", x, y, size: 6, colorBy: { values: v, colormap: "viridis" }, renderType: rt }] } });
    }

    // --- Bars ---------------------------------------------------------------
    {
      const K = 9;
      const x = Float64Array.from({ length: K }, (_, i) => i);
      const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
      out.push({ title: "Bars", subtitle: "categorical", kind: "plot", cfg: {
        options: dark, series: [{ type: "bar", x, y, width: 0.7, color: "#22d3ee", renderType: rt }] } });
    }

    // --- Horizontal bars ----------------------------------------------------
    {
      const cats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
      const x = Float64Array.from(cats, (_, i) => i);
      const y = Float64Array.from(cats, (_, i) => 30 + i * 12 + rand() * 10);
      out.push({ title: "Horizontal bars", subtitle: "hbar · categorical y", kind: "plot", cfg: {
        options: { ...dark, showToolbar: false, scales: { y: { type: "categorical", factors: cats }, x: { domain: [0, 100] } } },
        series: [{ type: "bar", x, y, width: 0.6, orientation: "h", color: "#34d399", name: "score", renderType: rt }] } });
    }

    // --- Area ---------------------------------------------------------------
    {
      const N = 400;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
      out.push({ title: "Area", subtitle: "filled", kind: "plot", cfg: {
        options: dark, series: [{ type: "area", x, y, color: "rgba(52,211,153,0.45)", renderType: rt }] } });
    }

    // --- Step line ----------------------------------------------------------
    {
      const N = 24;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
      out.push({ title: "Step line", subtitle: "staircase · step:after", kind: "plot", cfg: {
        options: dark, series: [{ type: "line", x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: rt }] } });
    }

    // --- Histogram ----------------------------------------------------------
    {
      const bins = 30, lo = -4, hi = 4, bw = (hi - lo) / bins;
      const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
      const counts = new Float64Array(bins);
      for (let i = 0; i < 5000; i++) { const b = Math.floor((gaussian(0, 1) - lo) / bw); if (b >= 0 && b < bins) counts[b]!++; }
      out.push({ title: "Histogram", subtitle: "gaussian · 30 bins", kind: "plot", cfg: {
        options: dark, series: [{ type: "bar", x: centers, y: counts, width: bw * 0.98, color: "#34d399", renderType: rt }] } });
    }

    // --- Box plot -----------------------------------------------------------
    {
      const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
      const groups = [0, 1, 2, 3].map((g) => ({
        position: g,
        values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
        color: colors[g],
      }));
      out.push({ title: "Box plot", subtitle: "Tukey · outliers", kind: "plot", cfg: {
        options: dark, series: [{ type: "box", groups, width: 0.6, renderType: rt }] } });
    }

    // --- Heatmap ------------------------------------------------------------
    {
      const cols = 60, rows = 40;
      const values = new Float64Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6, yy = (r / rows) * 6;
        values[r * cols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
      }
      out.push({ title: "Heatmap", subtitle: "texture · viridis", kind: "plot", cfg: {
        options: dark, series: [{ type: "heatmap", values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: rt }] } });
    }

    // --- Contour ------------------------------------------------------------
    {
      const cols = 80, rows = 60;
      const values = new Float64Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6 - 3, yy = (r / rows) * 6 - 3;
        values[r * cols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
      }
      out.push({ title: "Contour", subtitle: "marching squares", kind: "plot", cfg: {
        options: dark, series: [{ type: "contour", values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: rt }] } });
    }

    // --- Hexbin -------------------------------------------------------------
    {
      const M = 25_000;
      const x = new Float64Array(M), y = new Float64Array(M);
      for (let i = 0; i < M; i++) { const blob = i % 2 === 0 ? -1.4 : 1.4; x[i] = gaussian(blob, 1); y[i] = gaussian(blob * 0.6, 1.1); }
      out.push({ title: "Hexbin", subtitle: "25k points · density", kind: "plot", cfg: {
        options: dark, series: [{ type: "hexbin", x, y, radius: 0.22, colormap: "plasma", renderType: rt }] } });
    }

    // --- Error bars ---------------------------------------------------------
    {
      const N = 12;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
      const yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
      out.push({ title: "Error bars", subtitle: "whiskers + caps", kind: "plot", cfg: {
        options: dark, series: [
          { type: "line", x, y, color: "#60a5fa", width: 1.5, renderType: rt },
          { type: "errorbar", x, y, yerr, color: "#60a5fa", capSize: 7, renderType: rt },
        ] } });
    }

    // --- Error band ---------------------------------------------------------
    {
      const N = 120;
      const x = Float64Array.from({ length: N }, (_, i) => i / 10);
      const y = Float64Array.from(x, (t) => Math.sin(t));
      const err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
      out.push({ title: "Error band", subtitle: "confidence ribbon", kind: "plot", cfg: {
        options: dark, series: [
          { type: "errorbar", x, y, yerr: err, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28, renderType: rt },
          { type: "line", x, y, color: "#a78bfa", width: 2, renderType: rt },
        ] } });
    }

    // --- Stem ---------------------------------------------------------------
    {
      const N = 30;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
      out.push({ title: "Stem plot", subtitle: "discrete signal", kind: "plot", cfg: {
        options: dark, series: [{ type: "stem", x, y, color: "#34d399", markerSize: 6, renderType: rt }] } });
    }

    // --- Quiver -------------------------------------------------------------
    {
      const G = 16;
      const xs: number[] = [], ys: number[] = [], us: number[] = [], vs: number[] = [];
      for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
        const gx = (i / (G - 1)) * 4 - 2, gy = (j / (G - 1)) * 4 - 2;
        xs.push(gx); ys.push(gy); us.push(-gy); vs.push(gx);
      }
      out.push({ title: "Quiver", subtitle: "vector field", kind: "plot", cfg: {
        options: dark, series: [{ type: "quiver", x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" }, renderType: rt }] } });
    }

    // --- Candlestick (time axis) -------------------------------------------
    {
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
      out.push({ title: "Candlestick", subtitle: "OHLC · daily", kind: "plot", cfg: {
        options: { ...dark, scales: { x: { type: "time" } } },
        series: [{ type: "candlestick", x, open: o, high: h, low: l, close: c, renderType: rt }] } });
    }

    // --- OHLC bars (time axis) ---------------------------------------------
    {
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
      out.push({ title: "OHLC", subtitle: "bars · daily", kind: "plot", cfg: {
        options: { ...dark, scales: { x: { type: "time" } } },
        series: [{ type: "ohlc", x, open: o, high: h, low: l, close: c, renderType: rt }] } });
    }

    // --- Ordinal-time candlestick (weekend gaps collapse) ------------------
    {
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
      out.push({ title: "Ordinal-time axis", subtitle: "sessions · weekend gaps collapse", kind: "plot", cfg: {
        options: { ...dark, scales: { x: { type: "ordinal-time", times } } },
        series: [{ type: "candlestick", x: idx, open: o, high: h, low: l, close: c, renderType: rt }] } });
    }

    // --- Pie ----------------------------------------------------------------
    out.push({ title: "Pie", subtitle: "market share", kind: "plot", cfg: {
      options: { ...dark, equalAspect: true, showToolbar: false, hover: false,
        axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } },
      series: [{ type: "pie", values: [35, 25, 20, 12, 8], colormap: "viridis", renderType: rt }] } });

    // --- Donut --------------------------------------------------------------
    out.push({ title: "Donut", subtitle: "categories", kind: "plot", cfg: {
      options: { ...dark, equalAspect: true, showToolbar: false, hover: false,
        axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } },
      series: [{ type: "pie", values: [8, 6, 5, 4, 3, 2], innerRadius: 0.55, renderType: rt }] } });

    // --- Patches (choropleth) ----------------------------------------------
    {
      const cols = 6, rows = 4;
      const patches: Array<{ x: number[]; y: number[]; value: number }> = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const j = () => (rand() - 0.5) * 0.22;
        patches.push({
          x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
          y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
          value: Math.sin(c * 0.7) + Math.cos(r * 0.9),
        });
      }
      out.push({ title: "Patches", subtitle: "polygons · choropleth", kind: "plot", cfg: {
        options: { ...dark, showToolbar: false }, series: [{ type: "patches", patches, colormap: "plasma", renderType: rt }] } });
    }

    // --- Image --------------------------------------------------------------
    {
      const iw = 96, ih = 96;
      const id = new ImageData(iw, ih);
      for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) {
        const i = (yy * iw + xx) * 4, d = Math.hypot(xx - iw / 2, yy - ih / 2) / (iw / 2);
        id.data[i] = Math.round((xx / iw) * 255);
        id.data[i + 1] = Math.round((yy / ih) * 255);
        id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
        id.data[i + 3] = 255;
      }
      out.push({ title: "Image", subtitle: "RGBA glyph · textured quad", kind: "plot", cfg: {
        options: { ...dark, showToolbar: false }, series: [{ type: "image", source: id, extent: { x: [0, 10], y: [0, 10] }, renderType: rt }] } });
    }

    // --- Graph --------------------------------------------------------------
    {
      const edges: [number, number][] = [
        [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
        [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
      ];
      const n = 10;
      const x = new Float64Array(n), y = new Float64Array(n);
      for (let i = 0; i < n; i++) { x[i] = Math.cos((i / n) * Math.PI * 2); y[i] = Math.sin((i / n) * Math.PI * 2); }
      out.push({ title: "Graph", subtitle: "force layout · nodes + edges", kind: "plot", cfg: {
        options: { ...dark, showToolbar: false, equalAspect: true },
        series: [{ type: "graph", x, y, edges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: rt }] } });
    }

    // --- Log axis -----------------------------------------------------------
    {
      const N = 200;
      const x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10);
      const taus = [1.2, 2.5, 5], colors = ["#f472b6", "#60a5fa", "#34d399"];
      const series: SeriesSpec[] = taus.map((tau, k) => ({
        type: "line", x, y: Float64Array.from(x, (t) => Math.exp(-t / tau) + 1e-3),
        color: colors[k], width: 1.5, name: `τ=${tau}`, renderType: rt,
      }));
      out.push({ title: "Log axis", subtitle: "exp decay · log y", kind: "plot", cfg: {
        options: { ...dark, scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } }, series } });
    }

    // --- Time axis ----------------------------------------------------------
    {
      const start = Date.UTC(2024, 0, 1), N = 24 * 60;
      const x = new Float64Array(N), y = new Float64Array(N);
      for (let i = 0; i < N; i++) { x[i] = start + i * 60_000; const h = i / 60; y[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4); }
      out.push({ title: "Time axis", subtitle: "1 day · date ticks", kind: "plot", cfg: {
        options: { ...dark, scales: { x: { type: "time" } } }, series: [{ type: "line", x, y, color: "#22d3ee", width: 1.5, renderType: rt }] } });
    }

    // --- Dual Y -------------------------------------------------------------
    {
      const N = 400;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
      const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
      out.push({ title: "Dual Y", subtitle: "two scales", kind: "plot", cfg: {
        options: { ...dark, axes: { y: { title: "amp" } } },
        yAxes: [{ id: "t", side: "right", color: "#f472b6", title: "temp" }],
        series: [
          { type: "line", x, y: a, color: "#60a5fa", width: 1.5, renderType: rt },
          { type: "line", x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", renderType: rt },
        ] } });
    }

    // --- Annotations --------------------------------------------------------
    {
      const N = 100;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.15) * 3 + 5);
      out.push({ title: "Annotations", subtitle: "span · band · box · label", kind: "plot", cfg: {
        options: { ...dark, showToolbar: false },
        series: [{ type: "line", x, y, color: "#38bdf8", width: 2, renderType: rt }],
        annotations: [
          { type: "band", dim: "y", from: 6, to: 8, color: "rgba(52,211,153,0.15)" },
          { type: "span", dim: "y", value: 5, color: "#f59e0b", dash: [5, 4] },
          { type: "span", dim: "x", value: 50, color: "#f472b6", dash: [5, 4] },
          { type: "box", x: [20, 35], y: [2, 4], border: "#a78bfa" },
          { type: "label", x: 52, y: 9, text: "event", color: "#f472b6" },
        ] } });
    }

    // --- Styled + categorical ----------------------------------------------
    {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
      const idx = Float64Array.from(months, (_, i) => i);
      const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
      const target = Float64Array.from(months, () => 70 + rand() * 12);
      out.push({ title: "Styled + categorical", subtitle: "title · legend · rotated ticks", kind: "plot", cfg: {
        options: {
          ...dark, background: "#0b1220", border: "#060a14",
          title: { text: "Quarterly revenue", align: "left" }, legend: { position: "top-left" },
          scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
          axes: { x: { title: "month", labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" }, y: { title: "revenue", gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] } },
          showToolbar: false,
        },
        series: [
          { type: "bar", x: idx, y: revenue, width: 0.6, color: "#38bdf8", name: "revenue", renderType: rt },
          { type: "line", x: idx, y: target, color: "#f59e0b", width: 2.5, name: "target", renderType: rt },
        ] } });
    }

    // --- Polar radar --------------------------------------------------------
    {
      const B = 14;
      const bt = Float64Array.from({ length: B }, () => rand() * 360);
      const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
      const series: PolarSeriesSpec[] = [
        { type: "line", theta: [0, 90], r: [0, 1], color: "#22d3ee", width: 2 },
        { type: "scatter", theta: bt, r: br, color: "#f472b6", size: 6 },
      ];
      out.push({ title: "Polar radar", subtitle: "angle · scatter", kind: "polar", cfg: {
        options: { theme: "dark", angleUnit: "deg", maxRadius: 1 }, series } });
    }

    // --- Polar rose ---------------------------------------------------------
    {
      const T = 240;
      const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
      const r = Float64Array.from(theta, (t) => Math.abs(Math.cos(3 * t)));
      out.push({ title: "Polar rose", subtitle: "closed curve", kind: "polar", cfg: {
        options: { theme: "dark", maxRadius: 1 }, series: [{ type: "line", theta, r, color: "#a78bfa", width: 2, closed: true }] } });
    }

    // --- 3D surface ---------------------------------------------------------
    {
      const cols = 64, rows = 64;
      const values = new Float64Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 2) / rr) * 3;
      }
      out.push({ title: "3D surface", subtitle: "colorbar · light", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" },
        layers: [{ type: "surface", values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height", renderType: rt }] } });
    }

    // --- 3D bars ------------------------------------------------------------
    {
      const gx = 8, gz = 8;
      const xa: number[] = [], za: number[] = [];
      for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
      const ya = Float64Array.from(xa, (v, k) => 1.5 + Math.sin(v * 0.6) * Math.cos(za[k]! * 0.6) * 1.5);
      out.push({ title: "3D bars", subtitle: "colormapped · lit", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" },
        layers: [{ type: "bar3d", x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: rt }] } });
    }

    // --- 3D lines -----------------------------------------------------------
    {
      const N = 400;
      const mk = (phase: number) => {
        const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
        for (let i = 0; i < N; i++) { const tt = (i / (N - 1)) * Math.PI * 2 * 4; x[i] = Math.cos(tt + phase); z[i] = Math.sin(tt + phase); y[i] = (i / (N - 1)) * 4 - 2; }
        return { x, y, z };
      };
      const a = mk(0), b = mk(Math.PI);
      out.push({ title: "3D lines", subtitle: "paths · legend", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "y", z: "z" }, legend: true },
        layers: [
          { type: "line3d", ...a, color: "#38bdf8", name: "α" },
          { type: "line3d", ...b, color: "#f472b6", name: "β" },
        ] } });
    }

    // --- 3D wireframe -------------------------------------------------------
    {
      const cols = 40, rows = 40;
      const values = new Float64Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 1.5) / rr) * 3;
      }
      out.push({ title: "3D wireframe", subtitle: "lines · hover", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" },
        layers: [{ type: "surface", values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "plasma", wireframe: true, name: "height", renderType: rt }] } });
    }

    // --- 3D quiver ----------------------------------------------------------
    {
      const g = 6;
      const xa: number[] = [], ya: number[] = [], za: number[] = [];
      for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) {
        xa.push((i / (g - 1)) * 2 - 1); ya.push((j / (g - 1)) * 2 - 1); za.push((k / (g - 1)) * 2 - 1);
      }
      const u = new Float64Array(xa.length), v = new Float64Array(xa.length), w = new Float64Array(xa.length);
      for (let k = 0; k < xa.length; k++) { u[k] = -ya[k]!; v[k] = xa[k]!; w[k] = za[k]! * 0.3; }
      out.push({ title: "3D quiver", subtitle: "vector field · colorbar", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "y", z: "z" } },
        layers: [{ type: "quiver3d", x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: rt }] } });
    }

    // --- 3D contour ---------------------------------------------------------
    {
      const cols = 50, rows = 50;
      const values = new Float64Array(cols * rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 1.5) / rr) * 3;
      }
      out.push({ title: "3D contour", subtitle: "iso-height rings", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" },
        layers: [{ type: "contour3d", values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: rt }] } });
    }

    // --- 3D isosurface ------------------------------------------------------
    {
      const n = 40;
      const vol = new Float64Array(n * n * n);
      const blobs = [[-0.5, 0, 0], [0.6, 0.3, -0.2], [0.1, -0.5, 0.4]];
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1;
        let s = 0; for (const b of blobs) { const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2; s += Math.exp(-d2 * 6); }
        vol[x + y * n + z * n * n] = s;
      }
      out.push({ title: "3D isosurface", subtitle: "marching cubes · metaballs", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" },
        layers: [{ type: "isosurface", values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: rt }] } });
    }

    // --- 3D scatter ---------------------------------------------------------
    {
      const N = 300;
      const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), sizes = new Float64Array(N), vals = new Float64Array(N);
      for (let i = 0; i < N; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); z[i] = gaussian(0, 1); const r = Math.hypot(x[i]!, y[i]!, z[i]!); sizes[i] = 3 + r * 6; vals[i] = r; }
      out.push({ title: "3D scatter", subtitle: "per-point size", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "y", z: "z" } },
        layers: [{ type: "pointcloud", x, y, z, sizes, colorBy: { values: vals, colormap: "plasma" }, name: "r" }] } });
    }

    // --- 3D volume ----------------------------------------------------------
    {
      const n = 48;
      const vol = new Float64Array(n * n * n);
      const blobs = [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]];
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1;
        let s = 0; for (const b of blobs) { const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2; s += Math.exp(-d2 * 5); }
        vol[x + y * n + z * n * n] = s;
      }
      out.push({ title: "3D volume", subtitle: "raymarch · auto-rotate", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true },
        layers: [{ type: "volume", values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: rt }] } });
    }

    // --- 3D point cloud -----------------------------------------------------
    {
      const N = 6000;
      const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
      for (let i = 0; i < N; i++) { const th = (i / N) * Math.PI * 20, rr = 1 + (i / N) * 2; x[i] = Math.cos(th) * rr; z[i] = Math.sin(th) * rr; y[i] = (i / N) * 4 - 2; }
      out.push({ title: "3D point cloud", subtitle: "colored by height", kind: "plot3d", cfg: {
        options: { axisLabels: { x: "x", y: "height", z: "z" } },
        layers: [{ type: "pointcloud", x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } }] } });
    }

    return out;
  }

  const statPanels = buildStatic();

  // ==========================================================================
  // DYNAMIC catalog — imperative streaming. Each panel's `setup` builds a core
  // plot with renderType:"dynamic" and returns a per-frame step + destroy; the
  // `live` action (in DynPanel) owns the rAF loop and repaints an FPS badge.
  // ==========================================================================
  interface Dyn {
    title: string;
    subtitle?: string;
    setup: (node: HTMLElement) => LiveHandle;
  }

  /** Throttle: only run `fn` every `k`-th step. */
  function throttle(k: number, fn: (t: number) => void): (t: number) => void {
    let n = 0;
    return (t) => { if (n++ % k === 0) fn(t); };
  }

  const dynPanels: Dyn[] = [
    // --- Line · scrolling -------------------------------------------------
    { title: "Line", subtitle: "live · scrolling", setup(node) {
      const p = new CorePlot(node, dark);
      const N = 600;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
      const line = p.addLine({ x, y, color: "#34d399", width: 2, decimate: false, renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [-2.6, 2.6] });
      let ph = N;
      return { step() {
        y.copyWithin(0, 1); ph++;
        y[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + jitter() * 0.25;
        line.setData(x, y); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Signals ----------------------------------------------------------
    { title: "Signals", subtitle: "3 channels", setup(node) {
      const p = new CorePlot(node, dark);
      const N = 500;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
      const ys = colors.map((_, i) => Float64Array.from({ length: N }, (_, j) => Math.sin(j * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + i * 0.1));
      const lines = ys.map((y, i) => p.addLine({ x, y, color: colors[i], width: 1.5, decimate: false, renderType: "dynamic" }));
      p.setView({ x: [0, N - 1], y: [-3.5, 3.5] });
      let ph = N;
      return { step() {
        ph++;
        ys.forEach((y, i) => { y.copyWithin(0, 1); y[N - 1] = Math.sin(ph * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + jitter() * 0.2 + i * 0.1; lines[i]!.setData(x, y); });
        p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Scatter · drifting cloud -----------------------------------------
    { title: "Scatter", subtitle: "drifting cloud", setup(node) {
      const p = new CorePlot(node, dark);
      const M = 700;
      const x = new Float64Array(M), y = new Float64Array(M);
      for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); }
      const sc = p.addScatter({ x, y, size: 5, color: "#818cf8", renderType: "dynamic" });
      p.setView({ x: [-4, 4], y: [-4, 4] });
      return { step() {
        for (let i = 0; i < M; i++) { x[i] += jitter() * 0.08 - x[i]! * 0.01; y[i] += jitter() * 0.08 - y[i]! * 0.01; }
        sc.setData(x, y); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Scatter · colorBy ------------------------------------------------
    { title: "Scatter · colorBy", subtitle: "value → viridis", setup(node) {
      const p = new CorePlot(node, dark);
      const M = 1200;
      const x = new Float64Array(M), y = new Float64Array(M), v = new Float64Array(M);
      for (let i = 0; i < M; i++) { x[i] = gaussian(0, 1.4); y[i] = gaussian(0, 1.4); v[i] = Math.hypot(x[i]!, y[i]!); }
      const sc = p.addScatter({ x, y, size: 6, colorBy: { values: v, colormap: "viridis" }, renderType: "dynamic" });
      p.setView({ x: [-5, 5], y: [-5, 5] });
      return { step() {
        for (let i = 0; i < M; i++) { x[i] += jitter() * 0.06 - x[i]! * 0.008; y[i] += jitter() * 0.06 - y[i]! * 0.008; }
        sc.setData(x, y); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Bars -------------------------------------------------------------
    { title: "Bars", subtitle: "fluctuating", setup(node) {
      const p = new CorePlot(node, dark);
      const K = 9;
      const x = Float64Array.from({ length: K }, (_, i) => i);
      const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
      const bar = p.addBar({ x, y, width: 0.7, color: "#22d3ee", renderType: "dynamic" });
      p.setView({ x: [-0.6, K - 0.4], y: [0, 100] });
      return { step() {
        for (let i = 0; i < K; i++) y[i] = Math.max(2, Math.min(98, y[i]! + jitter() * 8));
        bar.setData(x, y); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Area · streaming -------------------------------------------------
    { title: "Area", subtitle: "streaming", setup(node) {
      const p = new CorePlot(node, dark);
      const N = 400;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
      const area = p.addArea({ x, y, color: "rgba(52,211,153,0.45)", renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [0, 4] });
      let ph = N;
      return { step() {
        y.copyWithin(0, 1); ph++;
        y[N - 1] = 2 + Math.sin(ph * 0.06) + Math.sin(ph * 0.017) * 0.7 + Math.random() * 0.2;
        area.setData(x, y); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Step line --------------------------------------------------------
    { title: "Step line", subtitle: "staircase", setup(node) {
      const p = new CorePlot(node, dark);
      const N = 24;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
      const line = p.addLine({ x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [-0.5, 3.5] });
      return { step: throttle(6, () => { y.copyWithin(0, 1); y[N - 1] = Math.round(Math.random() * 3); line.setData(x, y); p.render(); }), destroy: () => p.destroy() };
    } },

    // --- Histogram --------------------------------------------------------
    { title: "Histogram", subtitle: "gaussian envelope", setup(node) {
      const p = new CorePlot(node, dark);
      const bins = 30, lo = -4, hi = 4, bw = (hi - lo) / bins;
      const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
      const counts = new Float64Array(bins);
      for (let i = 0; i < 5000; i++) { const b = Math.floor((gaussian(0, 1) - lo) / bw); if (b >= 0 && b < bins) counts[b]!++; }
      const bar = p.addBar({ x: centers, y: counts, width: bw * 0.98, color: "#34d399", renderType: "dynamic" });
      return { step() {
        for (let i = 0; i < bins; i++) {
          const target = (5000 * bw * Math.exp((-centers[i]! * centers[i]!) / 2)) / Math.sqrt(2 * Math.PI);
          counts[i] = Math.max(0, counts[i]! + (target - counts[i]!) * 0.05 + jitter() * target * 0.12);
        }
        bar.setData(centers, counts); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Heatmap ----------------------------------------------------------
    { title: "Heatmap", subtitle: "texture · viridis", setup(node) {
      const p = new CorePlot(node, dark);
      const cols = 60, rows = 40;
      const values = new Float64Array(cols * rows);
      const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 6, yy = (r / rows) * 6; values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) + Math.sin(xx * yy * 0.15); } };
      fill(0);
      const hm = p.addHeatmap({ values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: "dynamic" });
      return { step: (t) => { fill(t); hm.setData(values); p.render(); }, destroy: () => p.destroy() };
    } },

    // --- Contour ----------------------------------------------------------
    { title: "Contour", subtitle: "marching squares", setup(node) {
      const p = new CorePlot(node, dark);
      const cols = 80, rows = 60;
      const values = new Float64Array(cols * rows);
      const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 6 - 3, yy = (r / rows) * 6 - 3; values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) - 0.02 * (xx * xx + yy * yy); } };
      fill(0);
      const ct = p.addContour({ values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: "dynamic" });
      return { step: throttle(2, (t) => { fill(t); ct.setData(values); p.render(); }), destroy: () => p.destroy() };
    } },

    // --- Hexbin -----------------------------------------------------------
    { title: "Hexbin", subtitle: "25k points · density", setup(node) {
      const p = new CorePlot(node, dark);
      const M = 25_000;
      const x = new Float64Array(M), y = new Float64Array(M);
      for (let i = 0; i < M; i++) { const blob = i % 2 === 0 ? -1.4 : 1.4; x[i] = gaussian(blob, 1); y[i] = gaussian(blob * 0.6, 1.1); }
      const hx = p.addHexbin({ x, y, radius: 0.22, colormap: "plasma", renderType: "dynamic" });
      p.setView({ x: [-5, 5], y: [-5, 5] });
      return { step: throttle(2, () => {
        for (let i = 0; i < M; i++) { x[i] += jitter() * 0.05 - x[i]! * 0.004; y[i] += jitter() * 0.05 - y[i]! * 0.004; }
        hx.setData(x, y); p.render();
      }), destroy: () => p.destroy() };
    } },

    // --- Error bars -------------------------------------------------------
    { title: "Error bars", subtitle: "whiskers + caps", setup(node) {
      const p = new CorePlot(node, dark);
      const N = 12;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
      const yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
      const line = p.addLine({ x, y, color: "#60a5fa", width: 1.5, renderType: "dynamic" });
      const eb = p.addErrorBar({ x, y, yerr, color: "#60a5fa", capSize: 7, renderType: "dynamic" });
      p.setView({ x: [-1, N], y: [0, 10] });
      return { step: (t) => {
        for (let i = 0; i < N; i++) { y[i] = Math.sin(i / 2 + t) * 3 + 5; yerr[i] = 0.4 + (0.5 + 0.4 * Math.sin(t + i)) * 0.9; }
        line.setData(x, y); eb.setData({ x, y, yerr }); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Stem -------------------------------------------------------------
    { title: "Stem plot", subtitle: "discrete signal", setup(node) {
      const p = new CorePlot(node, dark);
      const N = 30;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
      const stem = p.addStem({ x, y, color: "#34d399", markerSize: 6, renderType: "dynamic" });
      p.setView({ x: [-1, N], y: [-1, 1.1] });
      return { step: (t) => { for (let i = 0; i < N; i++) y[i] = Math.exp(-i / 12) * Math.cos(i / 2 + t * 2); stem.setData(x, y); p.render(); }, destroy: () => p.destroy() };
    } },

    // --- Quiver -----------------------------------------------------------
    { title: "Quiver", subtitle: "rotating field", setup(node) {
      const p = new CorePlot(node, dark);
      const G = 16;
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { xs.push((i / (G - 1)) * 4 - 2); ys.push((j / (G - 1)) * 4 - 2); }
      const us = new Float64Array(xs.length), vs = new Float64Array(xs.length);
      const fill = (ph: number) => { const a = Math.cos(ph), b = Math.sin(ph); for (let k = 0; k < xs.length; k++) { us[k] = -ys[k]! * a - xs[k]! * b * 0.3; vs[k] = xs[k]! * a - ys[k]! * b * 0.3; } };
      fill(0);
      const q = p.addQuiver({ x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" }, renderType: "dynamic" });
      p.setView({ x: [-2.4, 2.4], y: [-2.4, 2.4] });
      return { step: (t) => { fill(t); q.setData(xs, ys, us, vs); p.render(); }, destroy: () => p.destroy() };
    } },

    // --- Candlestick · streaming ------------------------------------------
    { title: "Candlestick", subtitle: "OHLC · streaming", setup(node) {
      const p = new CorePlot(node, { ...dark, scales: { x: { type: "time" } } });
      const N = 40, start = Date.UTC(2024, 0, 1), step = 86_400_000;
      const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
      let price = 100;
      for (let i = 0; i < N; i++) { const open = price, close = open + gaussian(0, 2.2); x[i] = start + i * step; o[i] = open; c[i] = close; h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1)); l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1)); price = close; }
      const cs = p.addCandlestick({ x, open: o, high: h, low: l, close: c, renderType: "dynamic" });
      let lastX = x[N - 1]!, curOpen = c[N - 1]!, curClose = curOpen, hi = curOpen, lo = curOpen, since = 0;
      return { step() {
        curClose += gaussian(0, 0.35); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
        cs.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose }); p.render();
        if (++since > 70) { since = 0; lastX += step; curOpen = curClose; hi = lo = curOpen; cs.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen }); p.setView({ x: [lastX - step * 42, lastX + step * 2] }); }
      }, destroy: () => p.destroy() };
    } },

    // --- OHLC · streaming -------------------------------------------------
    { title: "OHLC", subtitle: "bars · streaming", setup(node) {
      const p = new CorePlot(node, { ...dark, scales: { x: { type: "time" } } });
      const N = 40, start = Date.UTC(2024, 0, 1), step = 86_400_000;
      const x = new Float64Array(N), o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
      let price = 100;
      for (let i = 0; i < N; i++) { const open = price, close = open + gaussian(0, 2.2); x[i] = start + i * step; o[i] = open; c[i] = close; h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1)); l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1)); price = close; }
      const ol = p.addOhlc({ x, open: o, high: h, low: l, close: c, renderType: "dynamic" });
      let lastX = x[N - 1]!, curOpen = c[N - 1]!, curClose = curOpen, hi = curOpen, lo = curOpen, since = 0;
      return { step() {
        curClose += gaussian(0, 0.35); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
        ol.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose }); p.render();
        if (++since > 70) { since = 0; lastX += step; curOpen = curClose; hi = lo = curOpen; ol.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen }); p.setView({ x: [lastX - step * 42, lastX + step * 2] }); }
      }, destroy: () => p.destroy() };
    } },

    // --- Ordinal-time candlestick -----------------------------------------
    { title: "Ordinal-time axis", subtitle: "sessions · rolling", setup(node) {
      const N = 60;
      const times = businessDays(N, Date.UTC(2024, 0, 1));
      const idx = Float64Array.from({ length: N }, (_, i) => i);
      const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
      let price = 100;
      for (let i = 0; i < N; i++) { const open = price, close = open + gaussian(0, 2); o[i] = open; c[i] = close; h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1)); l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1)); price = close; }
      const p = new CorePlot(node, { ...dark, scales: { x: { type: "ordinal-time", times } } });
      const cs = p.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });
      let curOpen = c[N - 1]!, curClose = curOpen, hi = curOpen, lo = curOpen, since = 0;
      return { step() {
        curClose += gaussian(0, 0.3); hi = Math.max(hi, curClose); lo = Math.min(lo, curClose);
        cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose }); p.render();
        if (++since > 60) {
          since = 0;
          for (let i = 0; i < N - 1; i++) { o[i] = o[i + 1]!; h[i] = h[i + 1]!; l[i] = l[i + 1]!; c[i] = c[i + 1]!; }
          curOpen = curClose; o[N - 1] = curOpen; h[N - 1] = curOpen; l[N - 1] = curOpen; c[N - 1] = curOpen; hi = lo = curOpen;
          cs.setData({ x: idx, open: o, high: h, low: l, close: c });
        }
      }, destroy: () => p.destroy() };
    } },

    // --- Pie --------------------------------------------------------------
    { title: "Pie", subtitle: "market share", setup(node) {
      const p = new CorePlot(node, { ...dark, equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } });
      const vals = [35, 25, 20, 12, 8];
      const pie = p.addPie({ values: vals, colormap: "viridis", renderType: "dynamic" });
      p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
      return { step: throttle(3, () => { for (let i = 0; i < vals.length; i++) vals[i] = Math.max(3, vals[i]! + jitter() * 3); pie.setData(vals); p.render(); }), destroy: () => p.destroy() };
    } },

    // --- Donut ------------------------------------------------------------
    { title: "Donut", subtitle: "categories", setup(node) {
      const p = new CorePlot(node, { ...dark, equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } });
      const vals = [8, 6, 5, 4, 3, 2];
      const pie = p.addPie({ values: vals, innerRadius: 0.55, renderType: "dynamic" });
      p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
      return { step: throttle(3, () => { for (let i = 0; i < vals.length; i++) vals[i] = Math.max(1.5, vals[i]! + jitter() * 2); pie.setData(vals); p.render(); }), destroy: () => p.destroy() };
    } },

    // --- Patches ----------------------------------------------------------
    { title: "Patches", subtitle: "polygons · choropleth", setup(node) {
      const p = new CorePlot(node, { ...dark, showToolbar: false });
      const cols = 6, rows = 4;
      const cells: Array<{ x: number[]; y: number[]; base: number }> = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const j = () => (rand() - 0.5) * 0.22; cells.push({ x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()], y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()], base: Math.sin(c * 0.7) + Math.cos(r * 0.9) }); }
      const mk = (ph: number) => cells.map((cell, i) => ({ x: cell.x, y: cell.y, value: cell.base + Math.sin(ph + i * 0.4) * 0.6 }));
      const patch = p.addPatches({ patches: mk(0), colormap: "plasma", renderType: "dynamic" });
      p.setView({ x: [-0.3, cols + 0.3], y: [-0.3, rows + 0.3] });
      return { step: throttle(2, (t) => { patch.setData(mk(t)); p.render(); }), destroy: () => p.destroy() };
    } },

    // --- Image ------------------------------------------------------------
    { title: "Image", subtitle: "RGBA · moving glow", setup(node) {
      const p = new CorePlot(node, { ...dark, showToolbar: false });
      const iw = 96, ih = 96, id = new ImageData(iw, ih);
      const paint = (cx: number, cy: number) => { for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) { const i = (yy * iw + xx) * 4, d = Math.hypot(xx - cx, yy - cy) / (iw / 2); id.data[i] = Math.round((xx / iw) * 255); id.data[i + 1] = Math.round((yy / ih) * 255); id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255); id.data[i + 3] = 255; } };
      paint(iw / 2, ih / 2);
      const img = p.addImage({ source: id, extent: { x: [0, 10], y: [0, 10] }, renderType: "dynamic" });
      p.setView({ x: [-0.5, 10.5], y: [-0.5, 10.5] });
      return { step: (t) => { paint(iw / 2 + Math.cos(t * 1.5) * iw * 0.3, ih / 2 + Math.sin(t * 1.5) * ih * 0.3); img.setData(id); p.render(); }, destroy: () => p.destroy() };
    } },

    // --- Graph ------------------------------------------------------------
    { title: "Graph", subtitle: "wobbling nodes", setup(node) {
      const p = new CorePlot(node, { ...dark, showToolbar: false, equalAspect: true });
      const edges: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3], [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4]];
      const n = 10;
      const bx = new Float64Array(n), by = new Float64Array(n);
      for (let i = 0; i < n; i++) { bx[i] = Math.cos((i / n) * Math.PI * 2); by[i] = Math.sin((i / n) * Math.PI * 2); }
      const g = p.addGraph({ x: bx, y: by, edges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: "dynamic" });
      p.setView({ x: [-1.5, 1.5], y: [-1.5, 1.5] });
      const x = new Float64Array(n), y = new Float64Array(n);
      return { step: (t) => { for (let i = 0; i < n; i++) { x[i] = bx[i]! + Math.sin(t * 2 + i) * 0.12; y[i] = by[i]! + Math.cos(t * 2 + i) * 0.12; } g.setData({ x, y, edges }); p.render(); }, destroy: () => p.destroy() };
    } },

    // --- Dual Y -----------------------------------------------------------
    { title: "Dual Y", subtitle: "two scales · scrolling", setup(node) {
      const p = new CorePlot(node, { ...dark, axes: { y: { title: "amp" } } });
      p.addYAxis("t", { side: "right", color: "#f472b6", title: "temp" });
      const N = 400;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
      const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
      const l1 = p.addLine({ x, y: a, color: "#60a5fa", width: 1.5, decimate: false, renderType: "dynamic" });
      const l2 = p.addLine({ x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false, renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [-2, 2], yAxes: { t: [15, 35] } });
      let ph = N;
      return { step() {
        a.copyWithin(0, 1); b.copyWithin(0, 1); ph++;
        a[N - 1] = Math.sin(ph * 0.05) * 1.5 + jitter() * 0.15;
        b[N - 1] = 25 + Math.sin(ph * 0.02) * 6 + jitter() * 0.6;
        l1.setData(x, a); l2.setData(x, b); p.render();
      }, destroy: () => p.destroy() };
    } },

    // --- Polar radar ------------------------------------------------------
    { title: "Polar radar", subtitle: "rotating sweep", setup(node) {
      const pp = new CorePolarPlot(node, { theme: "dark", angleUnit: "deg", maxRadius: 1 });
      const sweep = pp.addLine({ theta: [0, 0], r: [0, 1], color: "#22d3ee", width: 2 });
      const B = 14;
      const bt = Float64Array.from({ length: B }, () => rand() * 360);
      const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
      pp.addScatter({ theta: bt, r: br, color: "#f472b6", size: 6 });
      let ang = 0;
      return { step() { ang = (ang + 2.5) % 360; sweep.setData([ang, ang], [0, 1]); pp.render(); }, destroy: () => pp.destroy() };
    } },

    // --- Polar rose -------------------------------------------------------
    { title: "Polar rose", subtitle: "morphing curve", setup(node) {
      const pp = new CorePolarPlot(node, { theme: "dark", maxRadius: 1 });
      const T = 240;
      const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
      const r = new Float64Array(T);
      for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(3 * theta[i]!));
      const rose = pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
      return { step: (t) => { const k = 3 + 2 * Math.sin(t * 0.3); for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(k * theta[i]!)); rose.setData(theta, r); pp.render(); }, destroy: () => pp.destroy() };
    } },

    // --- 3D surface -------------------------------------------------------
    { title: "3D surface", subtitle: "rippling sinc", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" });
      const cols = 64, rows = 64;
      const values = new Float64Array(cols * rows);
      const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 2 - ph) / rr) * 3; } };
      fill(0);
      const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height", renderType: "dynamic" });
      return { step: (t) => { fill(t * 3); surf.setData(values); p3.refresh(); }, destroy: () => p3.destroy() };
    } },

    // --- 3D bars ----------------------------------------------------------
    { title: "3D bars", subtitle: "colormapped · lit", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" });
      const gx = 8, gz = 8;
      const xa: number[] = [], za: number[] = [];
      for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
      const ya = new Float64Array(xa.length);
      const fill = (ph: number) => { for (let k = 0; k < xa.length; k++) ya[k] = 1.5 + Math.sin(xa[k]! * 0.6 + ph) * Math.cos(za[k]! * 0.6) * 1.5; };
      fill(0);
      const bar = p3.addBar3D({ x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: "dynamic" });
      return { step: (t) => { fill(t * 2); bar.setData(xa, za, ya); p3.refresh(); }, destroy: () => p3.destroy() };
    } },

    // --- 3D lines ---------------------------------------------------------
    { title: "3D lines", subtitle: "spinning paths", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "y", z: "z" }, legend: true });
      const N = 400;
      const mk = (phase: number) => { const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N); for (let i = 0; i < N; i++) { const tt = (i / (N - 1)) * Math.PI * 2 * 4; x[i] = Math.cos(tt + phase); z[i] = Math.sin(tt + phase); y[i] = (i / (N - 1)) * 4 - 2; } return { x, y, z }; };
      const a = mk(0), b = mk(Math.PI);
      const la = p3.addLine3D({ ...a, color: "#38bdf8", name: "α" });
      const lb = p3.addLine3D({ ...b, color: "#f472b6", name: "β" });
      return { step: (t) => { const na = mk(t * 2), nb = mk(Math.PI + t * 2); la.setData(na.x, na.y, na.z); lb.setData(nb.x, nb.y, nb.z); p3.refresh(); }, destroy: () => p3.destroy() };
    } },

    // --- 3D quiver --------------------------------------------------------
    { title: "3D quiver", subtitle: "vector field", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "y", z: "z" } });
      const g = 6;
      const xa: number[] = [], ya: number[] = [], za: number[] = [];
      for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) { xa.push((i / (g - 1)) * 2 - 1); ya.push((j / (g - 1)) * 2 - 1); za.push((k / (g - 1)) * 2 - 1); }
      const u = new Float64Array(xa.length), v = new Float64Array(xa.length), w = new Float64Array(xa.length);
      const fill = (ph: number) => { const ca = Math.cos(ph), sa = Math.sin(ph); for (let k = 0; k < xa.length; k++) { u[k] = -ya[k]! * ca; v[k] = xa[k]! * ca; w[k] = za[k]! * 0.3 * sa; } };
      fill(0);
      const q = p3.addQuiver3D({ x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: "dynamic" });
      return { step: (t) => { fill(t * 2); q.setData(xa, ya, za, u, v, w); p3.refresh(); }, destroy: () => p3.destroy() };
    } },

    // --- 3D contour -------------------------------------------------------
    { title: "3D contour", subtitle: "iso-height rings", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" });
      const cols = 50, rows = 50;
      const values = new Float64Array(cols * rows);
      const fill = (ph: number) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6; values[r * cols + c] = (Math.sin(rr * 1.5 - ph) / rr) * 3; } };
      fill(0);
      const ct = p3.addContour3D({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: "dynamic" });
      return { step: throttle(3, (t) => { fill(t * 3); ct.setData(values); p3.refresh(); }), destroy: () => p3.destroy() };
    } },

    // --- 3D isosurface ----------------------------------------------------
    { title: "3D isosurface", subtitle: "marching cubes · metaballs", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" });
      const n = 28;
      const vol = new Float64Array(n * n * n);
      const fill = (ph: number) => { const blobs = [[-0.5 + Math.sin(ph) * 0.3, 0, 0], [0.6, 0.3 + Math.cos(ph) * 0.3, -0.2], [0.1, -0.5, 0.4 + Math.sin(ph * 1.3) * 0.3]]; for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1; let s = 0; for (const b of blobs) { const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2; s += Math.exp(-d2 * 6); } vol[x + y * n + z * n * n] = s; } };
      fill(0);
      const iso = p3.addIsosurface({ values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: "dynamic" });
      return { step: throttle(5, (t) => { fill(t); iso.setData(vol, [n, n, n], 0.5, { x: [-1, 1], y: [-1, 1], z: [-1, 1] }); p3.refresh(); }), destroy: () => p3.destroy() };
    } },

    // --- 3D scatter -------------------------------------------------------
    { title: "3D scatter", subtitle: "jittering cloud", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "y", z: "z" } });
      const N = 300;
      const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), sizes = new Float64Array(N), vals = new Float64Array(N);
      for (let i = 0; i < N; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); z[i] = gaussian(0, 1); const r = Math.hypot(x[i]!, y[i]!, z[i]!); sizes[i] = 3 + r * 6; vals[i] = r; }
      const sc = p3.addPointCloud({ x, y, z, sizes, colorBy: { values: vals, colormap: "plasma" }, name: "r" });
      return { step() { for (let i = 0; i < N; i++) { x[i] += jitter() * 0.04 - x[i]! * 0.006; y[i] += jitter() * 0.04 - y[i]! * 0.006; z[i] += jitter() * 0.04 - z[i]! * 0.006; } sc.setData(x, y, z); p3.refresh(); }, destroy: () => p3.destroy() };
    } },

    // --- 3D volume --------------------------------------------------------
    { title: "3D volume", subtitle: "raymarch · auto-rotate", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true });
      const n = 48;
      const vol = new Float64Array(n * n * n);
      const blobs = [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]];
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1; let s = 0; for (const b of blobs) { const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2; s += Math.exp(-d2 * 5); } vol[x + y * n + z * n * n] = s; }
      p3.addVolume({ values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: "dynamic" });
      // autoRotate streams frames internally; the loop just keeps the FPS badge live.
      return { step() {}, destroy: () => p3.destroy() };
    } },

    // --- 3D point cloud ---------------------------------------------------
    { title: "3D point cloud", subtitle: "swirling helix", setup(node) {
      const p3 = new CorePlot3D(node, { axisLabels: { x: "x", y: "height", z: "z" } });
      const N = 6000;
      const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
      const build = (ph: number) => { for (let i = 0; i < N; i++) { const th = (i / N) * Math.PI * 20 + ph, rr = 1 + (i / N) * 2; x[i] = Math.cos(th) * rr; z[i] = Math.sin(th) * rr; y[i] = (i / N) * 4 - 2; } };
      build(0);
      const sc = p3.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
      return { step: (t) => { build(t); sc.setData(x, y, z); p3.refresh(); }, destroy: () => p3.destroy() };
    } },
  ];

  // ==========================================================================
  // MAPS — offline embedded world (GeoJSON) + keyless demo vector basemap.
  // Declarative via use:plot. No FPS badges.
  // ==========================================================================
  const lonLat = (x: number, y: number) => {
    const [lon, lat] = worldToLonLat(x, y);
    return [
      { label: "lon", value: `${lon.toFixed(2)}°` },
      { label: "lat", value: `${lat.toFixed(2)}°` },
    ];
  };

  const adminStyle: MapStyle = {
    background: [0.05, 0.09, 0.16, 1],
    paint(_layer, type) {
      if (type === "polygon") return { kind: "fill", color: [0.16, 0.2, 0.26, 1], outline: [0.5, 0.58, 0.68, 1], outlineWidth: 1.2 };
      return { kind: "line", color: [0.5, 0.58, 0.68, 1], width: 1.2 };
    },
  };
  const geojsonCfg: PlotConfig = {
    options: { theme: "dark", showToolbar: true, equalAspect: true, boundedPan: true, hoverReadout: lonLat },
    series: [{ type: "geojson", geojson: worldCountries, layer: "admin", style: adminStyle }],
  };

  const oceanStyle: MapStyle = {
    background: [0.05, 0.09, 0.16, 1],
    paint(layer, type) {
      if (layer === "countries") return type === "polygon" ? { kind: "fill", color: [0.16, 0.2, 0.26, 1] } : { kind: "line", color: [0.3, 0.36, 0.44, 1], width: 1 };
      if (layer === "geolines") return { kind: "line", color: [0.2, 0.25, 0.32, 1], width: 1 };
      return null;
    },
  };
  const basemapSource = xyzVectorSource({ url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf", attribution: "© MapLibre demo tiles", maxZoom: 5 });
  const basemapCfg: PlotConfig = {
    options: { theme: "dark", showToolbar: true, equalAspect: true, crosshair: true, boundedPan: true, hoverReadout: lonLat },
    series: [{ type: "map", source: basemapSource, style: oceanStyle, bbox: [-175, -58, 190, 78] }],
  };

  // ==========================================================================
  // FINANCE — specialist finance charts (indicators + transforms). All STATIC,
  // no FPS. Single-layer charts (Heikin-Ashi, Renko, Volume profile) go through
  // the declarative use:plot SeriesSpec; multi-layer ones (Bollinger, Depth,
  // linked RSI/MACD dashboard) are built imperatively with the core Plot.
  // ==========================================================================
  function buildFinanceData() {
    seed = 42; // deterministic OHLCV regardless of earlier RNG use
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
    // Synthesize a cumulative order book around the last price for the depth chart.
    const mid = c[N - 1]!;
    const bids: [number, number][] = [], asks: [number, number][] = [];
    for (let i = 1; i <= 20; i++) { bids.push([mid - i * 0.5, 5 + rand() * 20]); asks.push([mid + i * 0.5, 5 + rand() * 20]); }
    return { N, times, idx, o, h, l, c, vol, bids, asks };
  }
  const fin = buildFinanceData();
  const ordX = { type: "ordinal-time" as const, times: fin.times };

  // Declarative single-layer finance panels.
  const heikinCfg: PlotConfig = {
    options: { theme: "dark", scales: { x: ordX }, showToolbar: false },
    series: [{ type: "heikinAshi", x: fin.idx, open: fin.o, high: fin.h, low: fin.l, close: fin.c }],
  };
  const renkoCfg: PlotConfig = {
    options: { theme: "dark", showToolbar: false },
    series: [{ type: "renko", close: fin.c, brickSize: 2 }],
  };
  const volProfileCfg: PlotConfig = {
    options: { theme: "dark", showToolbar: false },
    series: [{ type: "volumeProfile", price: fin.c, volume: fin.vol, bins: 24, color: "#3b82f6", pocColor: "#f59e0b" }],
  };

  // Imperative multi-layer finance panels (candles + indicator overlays).
  const bollingerOpts = { theme: "dark" as const, scales: { x: ordX }, showToolbar: false };
  function buildBollinger(p: CorePlotT): void {
    p.addCandlestick({ x: fin.idx, open: fin.o, high: fin.h, low: fin.l, close: fin.c });
    addBollinger(p, { x: fin.idx, close: fin.c, period: 20, k: 2, bandColor: "rgba(167,139,250,0.14)" });
  }
  const depthOpts = { theme: "dark" as const, showToolbar: false };
  function buildDepth(p: CorePlotT): void {
    addDepth(p, { bids: fin.bids, asks: fin.asks });
  }

  // ==========================================================================
  // Tabs. Only the active tab is mounted ({#if}) so charts are always built into
  // a visible, sized container (a WebGL plot built while display:none sizes to
  // 0). Static is the default; switching away unmounts + cleans up (rAF/plots).
  // ==========================================================================
  type Tab = "static" | "dynamic" | "finance" | "maps";
  let activeTab: Tab = "static";
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "static", label: "Static", count: statPanels.length },
    { id: "dynamic", label: "Dynamic", count: dynPanels.length + 1 },
    { id: "finance", label: "Finance", count: 6 },
    { id: "maps", label: "Maps", count: 2 },
  ];
</script>

<header>
  <h1><b>Photon</b> · Svelte — WebGL2 chart gallery</h1>
  <p>
    Three tabs, built with the <code>@photonviz/svelte</code> actions.
    <b>Static</b>: the full catalog (hover, box/X/Y zoom, drag an axis to pan · 3D: drag to orbit).
    <b>Dynamic</b>: the same catalog streaming live at ~60fps, each panel with an FPS badge.
    <b>Maps</b>: offline vector basemaps.
  </p>
</header>

<nav class="tabs">
  {#each tabs as t (t.id)}
    <button class="tab" class:active={activeTab === t.id} on:click={() => (activeTab = t.id)}>
      {t.label}<span class="count">{t.count}</span>
    </button>
  {/each}
</nav>
<div class="tabbar-line"></div>

{#if activeTab === "static"}
  <div class="grid">
    {#each statPanels as p (p.title)}
      <StatPanel title={p.title} subtitle={p.subtitle} kind={p.kind} cfg={p.cfg} />
    {/each}
  </div>
{:else if activeTab === "dynamic"}
  <div class="grid">
    {#each dynPanels as p (p.title)}
      <DynPanel title={p.title} subtitle={p.subtitle} setup={p.setup} />
    {/each}
    <LinkedFinance />
  </div>
{:else if activeTab === "finance"}
  <div class="grid">
    <StatPanel title="Heikin-Ashi" subtitle="smoothed candles" kind="plot" cfg={heikinCfg} />
    <StatPanel title="Renko" subtitle="brickSize 2 · wickless" kind="plot" cfg={renkoCfg} />
    <ImpPanel title="Bollinger Bands" subtitle="20 · 2σ" options={bollingerOpts} build={buildBollinger} />
    <StatPanel title="Volume profile" subtitle="volume by price · POC" kind="plot" cfg={volProfileCfg} />
    <ImpPanel title="Depth chart" subtitle="cumulative order book" options={depthOpts} build={buildDepth} />
    <FinanceDashboard times={fin.times} idx={fin.idx} open={fin.o} high={fin.h} low={fin.l} close={fin.c} />
  </div>
{:else}
  <div class="grid">
    <StatPanel title="GeoJSON world" subtitle="offline · Natural Earth 10m" kind="plot" cfg={geojsonCfg} />
    <StatPanel title="Vector basemap" subtitle="addMap · MVT demo tiles" kind="plot" cfg={basemapCfg} />
  </div>
{/if}

<style>
  :global(:root) {
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: #0b1020;
    color: #cbd5e1;
    font-family: system-ui, -apple-system, sans-serif;
  }
  header {
    padding: 16px 20px 4px;
  }
  header h1 {
    margin: 0;
    font-size: 18px;
  }
  header h1 :global(b) {
    color: #60a5fa;
  }
  header p {
    margin: 4px 0 0;
    font-size: 13px;
    color: #94a3b8;
    max-width: 70ch;
  }
  header :global(code) {
    color: #cbd5e1;
    font-size: 12px;
  }

  .tabs {
    display: flex;
    gap: 6px;
    padding: 12px 20px 0;
  }
  .tab {
    appearance: none;
    cursor: pointer;
    font: 600 13px system-ui, sans-serif;
    color: #94a3b8;
    background: #0e1526;
    border: 1px solid #1e293b;
    border-bottom: none;
    padding: 8px 16px;
    border-radius: 8px 8px 0 0;
  }
  .tab:hover {
    color: #cbd5e1;
  }
  .tab.active {
    color: #e2e8f0;
    background: #141d33;
    border-color: #334155;
  }
  .tab .count {
    color: #475569;
    font-weight: 400;
    margin-left: 6px;
  }
  .tab.active .count {
    color: #60a5fa;
  }
  .tabbar-line {
    height: 1px;
    background: #1e293b;
    margin: 0 20px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 14px;
    padding: 16px 20px 40px;
  }

  /* Shared card + chart chrome, styled globally so child components inherit. */
  :global(.card) {
    position: relative;
    border: 1px solid #1e293b;
    border-radius: 10px;
    background: #0e1526;
    overflow: hidden;
  }
  :global(.card.wide) {
    grid-column: 1 / -1;
  }
  :global(.card h2) {
    margin: 0;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    border-bottom: 1px solid #1e293b;
  }
  :global(.card h2 span) {
    color: #64748b;
    font-weight: 400;
  }
  :global(.chartwrap) {
    position: relative;
  }
  :global(.chart) {
    height: 260px;
  }
  /* Per-chart fullscreen button — top-right, revealed on panel hover. */
  :global(.fs-btn) {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 7;
    width: 24px;
    height: 24px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid #334155;
    background: rgba(20, 29, 51, 0.7);
    color: #94a3b8;
    opacity: 0;
    transition: opacity 0.15s, color 0.12s, background 0.12s;
  }
  :global(.card:hover .fs-btn),
  :global(.card:fullscreen .fs-btn) {
    opacity: 1;
  }
  :global(.fs-btn:hover) {
    color: #e2e8f0;
    background: rgba(30, 41, 59, 0.95);
  }
  /* Fullscreen a single panel: fill the viewport, chart flexes to fill. */
  :global(.card:fullscreen) {
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 14px;
    box-sizing: border-box;
    background: #0b1220;
    display: flex;
    flex-direction: column;
  }
  :global(.card:fullscreen .chartwrap) {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  :global(.card:fullscreen .chart) {
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
  }

  /* FPS badge — pinned top-left of the chart (Dynamic tab only). */
  :global(.fps) {
    position: absolute;
    top: 6px;
    left: 8px;
    z-index: 5;
    padding: 2px 7px;
    border-radius: 6px;
    font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #e2e8f0;
    background: rgba(14, 21, 38, 0.7);
    border: 1px solid #1e293b;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
</style>
