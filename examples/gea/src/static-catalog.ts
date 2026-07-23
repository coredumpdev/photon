// Static gallery catalog — one entry per chart type.
//
// Where the Gea wrapper exposes the chart as a single `series` type we describe
// it declaratively (`series: [{ type, renderType: "static", ... }]`) so the
// config-driven <Plot>/<PolarPlot>/<Plot3D> components render it with no code.
// Composite charts the wrapper can't express as one series (grouped/stacked
// bars, stacked area, spectrogram) fall back to an imperative `setup(plot)`
// that adds the layers with renderType:"static" via the core Plot handle.

import type { Plot as CorePlot, Plot3D as CorePlot3D } from "@photonviz/core";
import type { SeriesSpec, PolarSeriesSpec, LayerSpec3D, YAxisSpec } from "@photonviz/gea";
import { makeRng, businessDays } from "./data";

export interface Plot2DSpec {
  title: string;
  subtitle?: string;
  options?: any;
  yAxes?: YAxisSpec[];
  series?: SeriesSpec[];
  annotations?: any[];
  setup?: (plot: CorePlot) => void;
}
export interface PolarSpec {
  title: string;
  subtitle?: string;
  options?: any;
  series: PolarSeriesSpec[];
}
export interface Plot3DSpec {
  title: string;
  subtitle?: string;
  options?: any;
  layers?: LayerSpec3D[];
  setup?: (plot: CorePlot3D) => void;
}

const RT = "static" as const;
const DARK = { theme: "dark" as const };

export function buildStatic(): {
  plots2D: Plot2DSpec[];
  polars: PolarSpec[];
  plots3D: Plot3DSpec[];
} {
  const { rand, gaussian } = makeRng(42);

  // ---- Line ---------------------------------------------------------------
  const lineN = 600;
  const lineX = Float64Array.from({ length: lineN }, (_, i) => i);
  const lineY = Float64Array.from({ length: lineN }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);

  // ---- Signals ------------------------------------------------------------
  const sigN = 500;
  const sigX = Float64Array.from({ length: sigN }, (_, i) => i);
  const sigColors = ["#60a5fa", "#f472b6", "#fbbf24"];
  const sigSeries: SeriesSpec[] = [0, 1, 2].map((k) => ({
    type: "line",
    x: sigX,
    y: Float64Array.from({ length: sigN }, (_, j) => Math.sin(j * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + k * 0.1),
    color: sigColors[k],
    width: 1.5,
    decimate: false,
    renderType: RT,
  }));

  // ---- Scatter ------------------------------------------------------------
  const scM = 700;
  const scX = new Float64Array(scM), scY = new Float64Array(scM);
  for (let i = 0; i < scM; i++) { scX[i] = gaussian(0, 1); scY[i] = gaussian(0, 1); }

  // ---- Scatter markers ----------------------------------------------------
  const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
  const mkColors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
  const mkX = Float64Array.from({ length: 12 }, (_, i) => i);
  const markerSeries: SeriesSpec[] = shapes.map((mk, r) => ({
    type: "scatter",
    x: mkX,
    y: Float64Array.from({ length: 12 }, () => shapes.length - 1 - r),
    size: 14,
    marker: mk,
    color: mkColors[r],
    name: mk,
    renderType: RT,
  }));

  // ---- Scatter colorBy ----------------------------------------------------
  const cbM = 1200;
  const cbX = new Float64Array(cbM), cbY = new Float64Array(cbM), cbV = new Float64Array(cbM);
  for (let i = 0; i < cbM; i++) { cbX[i] = gaussian(0, 1.4); cbY[i] = gaussian(0, 1.4); cbV[i] = Math.hypot(cbX[i], cbY[i]); }

  // ---- Bars ---------------------------------------------------------------
  const barK = 9;
  const barX = Float64Array.from({ length: barK }, (_, i) => i);
  const barY = Float64Array.from({ length: barK }, () => 40 + rand() * 30);

  // ---- Horizontal bars ----------------------------------------------------
  const hcats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
  const hIdx = Float64Array.from(hcats, (_, i) => i);
  const hVals = Float64Array.from(hcats, (_, i) => 30 + i * 12 + rand() * 10);

  // ---- Area ---------------------------------------------------------------
  const areaN = 400;
  const areaX = Float64Array.from({ length: areaN }, (_, i) => i);
  const areaY = Float64Array.from({ length: areaN }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);

  // ---- Step line ----------------------------------------------------------
  const stepN = 24;
  const stepX = Float64Array.from({ length: stepN }, (_, i) => i);
  const stepY = Float64Array.from({ length: stepN }, () => Math.round(rand() * 3));

  // ---- Histogram ----------------------------------------------------------
  const bins = 30, lo = -4, hi = 4, bw = (hi - lo) / bins;
  const histX = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
  const histY = new Float64Array(bins);
  for (let i = 0; i < 5000; i++) { const b = Math.floor((gaussian(0, 1) - lo) / bw); if (b >= 0 && b < bins) histY[b]++; }

  // ---- Box ----------------------------------------------------------------
  const boxColors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
  const boxGroups = [0, 1, 2, 3].map((g) => ({
    position: g,
    values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
    color: boxColors[g],
  }));

  // ---- Heatmap ------------------------------------------------------------
  const hmCols = 60, hmRows = 40;
  const hmVals = new Float64Array(hmCols * hmRows);
  for (let r = 0; r < hmRows; r++) for (let c = 0; c < hmCols; c++) {
    const xx = (c / hmCols) * 6, yy = (r / hmRows) * 6;
    hmVals[r * hmCols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
  }

  // ---- Contour ------------------------------------------------------------
  const ctCols = 80, ctRows = 60;
  const ctVals = new Float64Array(ctCols * ctRows);
  for (let r = 0; r < ctRows; r++) for (let c = 0; c < ctCols; c++) {
    const xx = (c / ctCols) * 6 - 3, yy = (r / ctRows) * 6 - 3;
    ctVals[r * ctCols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
  }

  // ---- Hexbin -------------------------------------------------------------
  const hxM = 25_000;
  const hxX = new Float64Array(hxM), hxY = new Float64Array(hxM);
  for (let i = 0; i < hxM; i++) { const blob = i % 2 === 0 ? -1.4 : 1.4; hxX[i] = gaussian(blob, 1); hxY[i] = gaussian(blob * 0.6, 1.1); }

  // ---- Error bars ---------------------------------------------------------
  const ebN = 12;
  const ebX = Float64Array.from({ length: ebN }, (_, i) => i);
  const ebY = Float64Array.from({ length: ebN }, (_, i) => Math.sin(i / 2) * 3 + 5);
  const ebErr = Float64Array.from({ length: ebN }, () => 0.4 + rand() * 0.9);

  // ---- Error band ---------------------------------------------------------
  const bandN = 120;
  const bandX = Float64Array.from({ length: bandN }, (_, i) => i / 10);
  const bandY = Float64Array.from(bandX, (t) => Math.sin(t));
  const bandErr = Float64Array.from(bandX, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));

  // ---- Stem ---------------------------------------------------------------
  const stemN = 30;
  const stemX = Float64Array.from({ length: stemN }, (_, i) => i);
  const stemY = Float64Array.from({ length: stemN }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));

  // ---- Quiver -------------------------------------------------------------
  const qG = 16;
  const qX: number[] = [], qY: number[] = [];
  for (let i = 0; i < qG; i++) for (let j = 0; j < qG; j++) { qX.push((i / (qG - 1)) * 4 - 2); qY.push((j / (qG - 1)) * 4 - 2); }
  const qU = new Float64Array(qX.length), qV = new Float64Array(qX.length);
  for (let k = 0; k < qX.length; k++) { qU[k] = -qY[k]; qV[k] = qX[k]; }

  // ---- OHLC / candlestick (time) ------------------------------------------
  const ohlcN = 40, ohlcStart = Date.UTC(2024, 0, 1), ohlcStep = 86_400_000;
  const ohlcT = new Float64Array(ohlcN);
  const oO = new Float64Array(ohlcN), oH = new Float64Array(ohlcN), oL = new Float64Array(ohlcN), oC = new Float64Array(ohlcN);
  {
    let price = 100;
    for (let i = 0; i < ohlcN; i++) {
      const open = price, close = open + gaussian(0, 2.2);
      ohlcT[i] = ohlcStart + i * ohlcStep; oO[i] = open; oC[i] = close;
      oH[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
      oL[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
      price = close;
    }
  }

  // ---- Ordinal-time candlestick -------------------------------------------
  const ordN = 60;
  const ordTimes = businessDays(ordN, Date.UTC(2024, 0, 1));
  const ordIdx = Float64Array.from({ length: ordN }, (_, i) => i);
  const ordO = new Float64Array(ordN), ordH = new Float64Array(ordN), ordL = new Float64Array(ordN), ordC = new Float64Array(ordN);
  {
    let price = 100;
    for (let i = 0; i < ordN; i++) {
      const open = price, close = open + gaussian(0, 2);
      ordO[i] = open; ordC[i] = close;
      ordH[i] = Math.max(open, close) + Math.abs(gaussian(0, 1));
      ordL[i] = Math.min(open, close) - Math.abs(gaussian(0, 1));
      price = close;
    }
  }

  // ---- Patches ------------------------------------------------------------
  const pCols = 6, pRows = 4;
  const patchList: { x: number[]; y: number[]; value: number }[] = [];
  for (let r = 0; r < pRows; r++) for (let c = 0; c < pCols; c++) {
    const j = () => (rand() - 0.5) * 0.22;
    patchList.push({
      x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
      y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
      value: Math.sin(c * 0.7) + Math.cos(r * 0.9),
    });
  }

  // ---- Image --------------------------------------------------------------
  const iw = 96, ih = 96;
  const imgData = new ImageData(iw, ih);
  for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) {
    const i = (yy * iw + xx) * 4;
    const d = Math.hypot(xx - iw / 2, yy - ih / 2) / (iw / 2);
    imgData.data[i] = Math.round((xx / iw) * 255);
    imgData.data[i + 1] = Math.round((yy / ih) * 255);
    imgData.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
    imgData.data[i + 3] = 255;
  }

  // ---- Graph --------------------------------------------------------------
  const gEdges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
    [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
  ];
  const gN = 10;
  const gX = new Float64Array(gN), gY = new Float64Array(gN);
  for (let i = 0; i < gN; i++) { gX[i] = Math.cos((i / gN) * Math.PI * 2); gY[i] = Math.sin((i / gN) * Math.PI * 2); }

  // ---- Annotations --------------------------------------------------------
  const annN = 100;
  const annX = Float64Array.from({ length: annN }, (_, i) => i);
  const annY = Float64Array.from({ length: annN }, (_, i) => Math.sin(i * 0.15) * 3 + 5);

  // ---- Log axis -----------------------------------------------------------
  const logN = 200;
  const logX = Float64Array.from({ length: logN }, (_, i) => (i / logN) * 10);
  const taus = [1.2, 2.5, 5], logColors = ["#f472b6", "#60a5fa", "#34d399"];
  const logSeries: SeriesSpec[] = taus.map((tau, k) => ({
    type: "line",
    x: logX,
    y: Float64Array.from(logX, (t) => Math.exp(-t / tau) + 1e-3),
    color: logColors[k],
    width: 1.5,
    name: `τ=${tau}`,
    renderType: RT,
  }));

  // ---- Time axis ----------------------------------------------------------
  const timeStart = Date.UTC(2024, 0, 1), timeN = 24 * 60;
  const timeX = new Float64Array(timeN), timeY = new Float64Array(timeN);
  for (let i = 0; i < timeN; i++) { timeX[i] = timeStart + i * 60_000; const h = i / 60; timeY[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4); }

  // ---- Dual Y (declarative yAxes) -----------------------------------------
  const dyN = 400;
  const dyX = Float64Array.from({ length: dyN }, (_, i) => i);
  const dyA = Float64Array.from({ length: dyN }, (_, i) => Math.sin(i * 0.05) * 1.5);
  const dyB = Float64Array.from({ length: dyN }, (_, i) => 25 + Math.sin(i * 0.02) * 6);

  // ---- Styled + categorical -----------------------------------------------
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const monIdx = Float64Array.from(months, (_, i) => i);
  const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
  const target = Float64Array.from(months, () => 70 + rand() * 12);

  // ---- 1M points ----------------------------------------------------------
  const bigN = 1_000_000;
  const bigX = new Float64Array(bigN), bigY = new Float64Array(bigN);
  for (let i = 0; i < bigN; i++) { bigX[i] = i; bigY[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05); }

  // ---- Polar --------------------------------------------------------------
  const roseT = Float64Array.from({ length: 240 }, (_, i) => (i / 239) * Math.PI * 2);
  const roseR = Float64Array.from(roseT, (th) => Math.abs(Math.cos(3 * th)));
  const radarT = Float64Array.from({ length: 14 }, () => rand() * 360);
  const radarR = Float64Array.from({ length: 14 }, () => 0.2 + rand() * 0.75);

  const HIDDEN_AXES = { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } };

  const plots2D: Plot2DSpec[] = [
    { title: "Line", subtitle: "sine sum", options: DARK, series: [{ type: "line", x: lineX, y: lineY, color: "#34d399", width: 2, decimate: false, renderType: RT }] },
    { title: "Signals", subtitle: "3 channels", options: DARK, series: sigSeries },
    { title: "Scatter", subtitle: "gaussian cloud", options: DARK, series: [{ type: "scatter", x: scX, y: scY, size: 5, color: "#818cf8", renderType: RT }] },
    { title: "Scatter markers", subtitle: "6 glyph shapes", options: { ...DARK, showToolbar: false, scales: { x: { domain: [-1, 12] }, y: { domain: [-1, 6] } } }, series: markerSeries },
    { title: "Scatter · colorBy", subtitle: "value → viridis", options: DARK, series: [{ type: "scatter", x: cbX, y: cbY, size: 6, colorBy: { values: cbV, colormap: "viridis" }, renderType: RT }] },
    { title: "Bars", subtitle: "categorical", options: DARK, series: [{ type: "bar", x: barX, y: barY, width: 0.7, color: "#22d3ee", renderType: RT }] },

    // Grouped bars — composite (addGroupedBars), imperative static setup.
    {
      title: "Grouped bars", subtitle: "categorical · 3 series",
      options: { ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: ["Q1", "Q2", "Q3", "Q4"] }, y: { domain: [0, 100] } }, showToolbar: false },
      setup: (p) => {
        const idx = Float64Array.from([0, 1, 2, 3]);
        const mk = () => Float64Array.from([0, 1, 2, 3], () => 20 + rand() * 70);
        p.addGroupedBars({ x: idx, series: [{ y: mk(), color: "#38bdf8", name: "north" }, { y: mk(), color: "#f472b6", name: "south" }, { y: mk(), color: "#a3e635", name: "west" }] });
      },
    },
    // Stacked bars — composite.
    {
      title: "Stacked bars", subtitle: "categorical · cumulative",
      options: { ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: ["Mon", "Tue", "Wed", "Thu", "Fri"] } }, showToolbar: false },
      setup: (p) => {
        const idx = Float64Array.from([0, 1, 2, 3, 4]);
        const mk = (m: number) => Float64Array.from([0, 1, 2, 3, 4], () => m + rand() * m);
        p.addStackedBars({ x: idx, width: 0.6, series: [{ y: mk(10), color: "#22d3ee", name: "email" }, { y: mk(8), color: "#818cf8", name: "social" }, { y: mk(6), color: "#fbbf24", name: "direct" }] });
      },
    },
    { title: "Horizontal bars", subtitle: "hbar · categorical y", options: { ...DARK, scales: { y: { type: "categorical", factors: hcats }, x: { domain: [0, 100] } }, showToolbar: false }, series: [{ type: "bar", x: hIdx, y: hVals, width: 0.6, orientation: "h", color: "#34d399", name: "score", renderType: RT }] },

    { title: "Area", subtitle: "filled", options: DARK, series: [{ type: "area", x: areaX, y: areaY, color: "rgba(52,211,153,0.45)", renderType: RT }] },
    // Stacked area — composite.
    {
      title: "Stacked area", subtitle: "cumulative bands",
      options: { ...DARK, showToolbar: false },
      setup: (p) => {
        const N = 120;
        const x = Float64Array.from({ length: N }, (_, i) => i);
        const s = (a: number, b: number) => Float64Array.from({ length: N }, (_, i) => a + Math.sin(i * b) * a * 0.4 + a * 0.3);
        const colors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
        p.addStackedArea({ x, series: [s(3, 0.05), s(2.5, 0.06), s(2, 0.04)].map((y, i) => ({ y, color: colors[i], name: "abc"[i] })) });
        p.setView({ x: [0, N - 1], y: [0, 14] });
      },
    },
    { title: "Step line", subtitle: "staircase · step:after", options: DARK, series: [{ type: "line", x: stepX, y: stepY, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: RT }] },
    { title: "Histogram", subtitle: "gaussian · 30 bins", options: DARK, series: [{ type: "bar", x: histX, y: histY, width: bw * 0.98, color: "#34d399", renderType: RT }] },
    { title: "Box plot", subtitle: "Tukey · outliers", options: DARK, series: [{ type: "box", groups: boxGroups, width: 0.6, renderType: RT }] },
    { title: "Heatmap", subtitle: "texture · viridis", options: DARK, series: [{ type: "heatmap", values: hmVals, cols: hmCols, rows: hmRows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: RT }] },
    { title: "Contour", subtitle: "marching squares", options: DARK, series: [{ type: "contour", values: ctVals, cols: ctCols, rows: ctRows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: RT }] },
    // Spectrogram — composite (addHeatmapSpectrogram).
    {
      title: "Spectrogram", subtitle: "chirp · STFT",
      options: { ...DARK, axes: { x: { title: "time" }, y: { title: "freq" } } },
      setup: (p) => {
        const N = 16384, sr = 8000;
        const sig = new Float64Array(N);
        for (let i = 0; i < N; i++) { const tt = i / sr; sig[i] = Math.sin(2 * Math.PI * (200 + 1500 * (i / N)) * tt); }
        p.addHeatmapSpectrogram(sig, { fftSize: 256, hop: 128, sampleRate: sr, colormap: "plasma" });
      },
    },
    { title: "Hexbin", subtitle: "25k points · density", options: DARK, series: [{ type: "hexbin", x: hxX, y: hxY, radius: 0.22, colormap: "plasma", renderType: RT }] },
    { title: "Error bars", subtitle: "whiskers + caps", options: DARK, series: [{ type: "line", x: ebX, y: ebY, color: "#60a5fa", width: 1.5, renderType: RT }, { type: "errorbar", x: ebX, y: ebY, yerr: ebErr, color: "#60a5fa", capSize: 7, renderType: RT }] },
    { title: "Error band", subtitle: "confidence ribbon", options: DARK, series: [{ type: "errorbar", x: bandX, y: bandY, yerr: bandErr, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28, renderType: RT }, { type: "line", x: bandX, y: bandY, color: "#a78bfa", width: 2, renderType: RT }] },
    { title: "Stem plot", subtitle: "discrete signal", options: DARK, series: [{ type: "stem", x: stemX, y: stemY, color: "#34d399", markerSize: 6, renderType: RT }] },
    { title: "Quiver", subtitle: "vector field", options: DARK, series: [{ type: "quiver", x: qX, y: qY, u: qU, v: qV, colorBy: { colormap: "viridis" }, renderType: RT }] },
    { title: "Candlestick", subtitle: "OHLC · daily", options: { ...DARK, scales: { x: { type: "time" } } }, series: [{ type: "candlestick", x: ohlcT, open: oO, high: oH, low: oL, close: oC, renderType: RT }] },
    { title: "OHLC", subtitle: "bars · daily", options: { ...DARK, scales: { x: { type: "time" } } }, series: [{ type: "ohlc", x: ohlcT, open: oO, high: oH, low: oL, close: oC, renderType: RT }] },
    { title: "Ordinal-time axis", subtitle: "sessions · weekend gaps collapse", options: { ...DARK, scales: { x: { type: "ordinal-time", times: ordTimes } } }, series: [{ type: "candlestick", x: ordIdx, open: ordO, high: ordH, low: ordL, close: ordC, renderType: RT }] },
    { title: "Pie", subtitle: "market share", options: { ...DARK, equalAspect: true, showToolbar: false, hover: false, axes: HIDDEN_AXES }, series: [{ type: "pie", values: [35, 25, 20, 12, 8], colormap: "viridis", renderType: RT }] },
    { title: "Donut", subtitle: "categories", options: { ...DARK, equalAspect: true, showToolbar: false, hover: false, axes: HIDDEN_AXES }, series: [{ type: "pie", values: [8, 6, 5, 4, 3, 2], innerRadius: 0.55, renderType: RT }] },
    { title: "Patches", subtitle: "polygons · choropleth", options: { ...DARK, showToolbar: false }, series: [{ type: "patches", patches: patchList, colormap: "plasma", renderType: RT }] },
    { title: "Image", subtitle: "RGBA glyph · textured quad", options: { ...DARK, showToolbar: false }, series: [{ type: "image", source: imgData, extent: { x: [0, 10], y: [0, 10] }, renderType: RT }] },
    { title: "Graph", subtitle: "nodes + edges", options: { ...DARK, showToolbar: false, equalAspect: true }, series: [{ type: "graph", x: gX, y: gY, edges: gEdges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: RT }] },
    {
      title: "Annotations", subtitle: "span · band · box · label", options: { ...DARK, showToolbar: false },
      series: [{ type: "line", x: annX, y: annY, color: "#38bdf8", width: 2, renderType: RT }],
      annotations: [
        { type: "band", dim: "y", from: 6, to: 8, color: "rgba(52,211,153,0.15)" },
        { type: "span", dim: "y", value: 5, color: "#f59e0b", dash: [5, 4] },
        { type: "span", dim: "x", value: 50, color: "#f472b6", dash: [5, 4] },
        { type: "box", x: [20, 35], y: [2, 4], border: "#a78bfa" },
        { type: "label", x: 52, y: 9, text: "event", color: "#f472b6" },
      ],
    },
    { title: "Log axis", subtitle: "exp decay · log y", options: { ...DARK, scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } }, series: logSeries },
    { title: "Time axis", subtitle: "1 day · date ticks", options: { ...DARK, scales: { x: { type: "time" } } }, series: [{ type: "line", x: timeX, y: timeY, color: "#22d3ee", width: 1.5, renderType: RT }] },
    {
      title: "Dual Y", subtitle: "two scales",
      options: { ...DARK, axes: { y: { title: "amp" } } },
      yAxes: [{ id: "t", side: "right", color: "#f472b6", title: "temp" }],
      series: [
        { type: "line", x: dyX, y: dyA, color: "#60a5fa", width: 1.5, decimate: false, renderType: RT },
        { type: "line", x: dyX, y: dyB, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false, renderType: RT },
      ],
    },
    {
      title: "Styled + categorical", subtitle: "bg · title · legend · rotated ticks",
      options: {
        ...DARK, background: "#0b1220", border: "#060a14", title: { text: "Quarterly revenue", align: "left" }, legend: { position: "top-left" },
        scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
        axes: { x: { title: "month", labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" }, y: { title: "revenue", gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] } },
        showToolbar: false,
      },
      series: [
        { type: "bar", x: monIdx, y: revenue, width: 0.6, color: "#38bdf8", name: "revenue", renderType: RT },
        { type: "line", x: monIdx, y: target, color: "#f59e0b", width: 2.5, name: "target", renderType: RT },
      ],
    },
    { title: "1M points", subtitle: "GPU min/max decimation", options: DARK, series: [{ type: "line", x: bigX, y: bigY, color: "#34d399", width: 1.5, renderType: RT }] },
  ];

  const polars: PolarSpec[] = [
    {
      title: "Polar radar", subtitle: "sweep + blips", options: { ...DARK, angleUnit: "deg", maxRadius: 1 },
      series: [
        { type: "line", theta: [0, 45], r: [0, 1], color: "#22d3ee", width: 2 },
        { type: "scatter", theta: radarT, r: radarR, color: "#f472b6", size: 6, labels: Array.from({ length: 14 }, (_, i) => `Contact ${i + 1}`) },
      ],
    },
    {
      title: "Polar rose", subtitle: "cos(3θ) curve", options: { ...DARK, maxRadius: 1 },
      series: [{ type: "line", theta: roseT, r: roseR, color: "#a78bfa", width: 2, closed: true }],
    },
  ];

  const plots3D: Plot3DSpec[] = [
    {
      title: "3D surface", subtitle: "title · colorbar · light", options: { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" },
      setup: (p) => { const { values, cols, rows } = sinc(64, 2); p.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height", renderType: RT }); },
    },
    {
      title: "3D bars", subtitle: "colormapped · lit", options: { axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" },
      setup: (p) => {
        const gx = 8, gz = 8; const xa: number[] = [], za: number[] = [];
        for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
        const ya = Float64Array.from(xa, (_, k) => 1.5 + Math.sin(xa[k] * 0.6) * Math.cos(za[k] * 0.6) * 1.5);
        p.addBar3D({ x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: RT });
      },
    },
    {
      title: "3D lines", subtitle: "paths · legend", options: { axisLabels: { x: "x", y: "y", z: "z" }, legend: true },
      setup: (p) => {
        const mk = (phase: number) => { const N = 400, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N); for (let i = 0; i < N; i++) { const tt = (i / (N - 1)) * Math.PI * 8; x[i] = Math.cos(tt + phase); z[i] = Math.sin(tt + phase); y[i] = (i / (N - 1)) * 4 - 2; } return { x, y, z }; };
        p.addLine3D({ ...mk(0), color: "#38bdf8", name: "α" });
        p.addLine3D({ ...mk(Math.PI), color: "#f472b6", name: "β" });
      },
    },
    {
      title: "3D wireframe", subtitle: "lines · hover · reset", options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" },
      setup: (p) => { const { values, cols, rows } = sinc(40, 1.5); p.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "plasma", wireframe: true, name: "height", renderType: RT }); },
    },
    {
      title: "3D quiver", subtitle: "vector field · colorbar", options: { axisLabels: { x: "x", y: "y", z: "z" } },
      setup: (p) => {
        const g = 6; const xa: number[] = [], ya: number[] = [], za: number[] = [];
        for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) { xa.push((i / (g - 1)) * 2 - 1); ya.push((j / (g - 1)) * 2 - 1); za.push((k / (g - 1)) * 2 - 1); }
        const u = Float64Array.from(xa, (_, k) => -ya[k]), v = Float64Array.from(xa, (_, k) => xa[k]), w = new Float64Array(xa.length);
        p.addQuiver3D({ x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: RT });
      },
    },
    {
      title: "3D contour", subtitle: "iso-height rings", options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" },
      setup: (p) => { const { values, cols, rows } = sinc(50, 1.5); p.addContour3D({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: RT }); },
    },
    {
      title: "3D isosurface", subtitle: "marching cubes · metaballs", options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" },
      setup: (p) => {
        const n = 40, vol = new Float64Array(n * n * n);
        const blobs = [[-0.4, 0, 0], [0.6, 0.3, -0.2], [0.1, -0.5, 0.4]];
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1;
          let s = 0; for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 6);
          vol[x + y * n + z * n * n] = s;
        }
        p.addIsosurface({ values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: RT });
      },
    },
    {
      title: "3D scatter", subtitle: "per-point size · labels", options: { axisLabels: { x: "x", y: "y", z: "z" } },
      setup: (p) => {
        const N = 300, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), sizes = new Float64Array(N), vals = new Float64Array(N);
        const labels: string[] = [];
        for (let i = 0; i < N; i++) { x[i] = gaussian(0, 1); y[i] = gaussian(0, 1); z[i] = gaussian(0, 1); const r = Math.hypot(x[i], y[i], z[i]); sizes[i] = 3 + r * 6; vals[i] = r; labels.push(`p${i} · r=${r.toFixed(2)}`); }
        p.addPointCloud({ x, y, z, sizes, labels, colorBy: { values: vals, colormap: "plasma" }, name: "r" });
      },
    },
    {
      title: "3D volume", subtitle: "raymarch · grid · auto-rotate", options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true },
      setup: (p) => {
        const n = 48, vol = new Float64Array(n * n * n);
        const blobs = [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]];
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const px = (x / (n - 1)) * 2 - 1, py = (y / (n - 1)) * 2 - 1, pz = (z / (n - 1)) * 2 - 1;
          let s = 0; for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 5);
          vol[x + y * n + z * n * n] = s;
        }
        p.addVolume({ values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: RT });
      },
    },
    {
      title: "3D point cloud", subtitle: "axes · colored by height", options: { axisLabels: { x: "x", y: "height", z: "z" } },
      setup: (p) => {
        const N = 6000, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
        for (let i = 0; i < N; i++) { const th = (i / N) * Math.PI * 20, rr = 1 + (i / N) * 2; x[i] = Math.cos(th) * rr; z[i] = Math.sin(th) * rr; y[i] = (i / N) * 4 - 2; }
        p.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
      },
    },
  ];

  return { plots2D, polars, plots3D };
}

/** Sinc-style radial surface grid shared by several 3D demos. */
function sinc(dim: number, freq: number): { values: Float64Array; cols: number; rows: number } {
  const values = new Float64Array(dim * dim);
  for (let r = 0; r < dim; r++) for (let c = 0; c < dim; c++) {
    const xx = (c / dim) * 8 - 4, yy = (r / dim) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6;
    values[r * dim + c] = (Math.sin(rr * freq) / rr) * 3;
  }
  return { values, cols: dim, rows: dim };
}
