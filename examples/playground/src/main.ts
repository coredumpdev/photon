import * as photon from "@photonviz/core";
import * as photonMap from "@photonviz/map";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

// ---------------------------------------------------------------------------
// Presets — each is a self-contained snippet run with (container, photon, map).
// Streaming snippets guard their rAF loop with `container.isConnected` so an
// old loop stops as soon as the runner swaps in a fresh container.
// ---------------------------------------------------------------------------
const PRESETS: Record<string, string> = {
  Line: `// A simple line chart.
const plot = new photon.Plot(container, { theme: "dark" });
const N = 400;
const x = Float64Array.from({ length: N }, (_, i) => i / 20);
const y = x.map((v) => Math.sin(v) + 0.3 * Math.sin(v * 3));
plot.addLine({ x, y, color: "#34d399", width: 2, name: "sin sum" });
plot.render();`,

  "Streaming line": `// A line that scrolls at 60fps via rAF + setData.
const plot = new photon.Plot(container, { theme: "dark" });
const N = 600;
const x = Float64Array.from({ length: N }, (_, i) => i);
const y = new Float64Array(N);
const line = plot.addLine({ x, y, color: "#60a5fa", width: 1.5, renderType: "dynamic" });
let t = 0;
function frame() {
  if (!container.isConnected) return; // stop when the runner swaps containers
  t += 0.05;
  for (let i = 0; i < N; i++) y[i] = Math.sin(i * 0.05 + t) * Math.exp(-((i - 300) ** 2) / 40000) * 3;
  line.setData(x, y);
  plot.render();
  requestAnimationFrame(frame);
}
frame();`,

  "Candlestick + RSI": `// Candlesticks + a linked RSI(14) line on an ordinal-time axis.
// Weekend gaps collapse because x is an index mapped through \`times\`.
const N = 80;
const times = new Float64Array(N);
const idx = Float64Array.from({ length: N }, (_, i) => i);
const o = new Float64Array(N), h = new Float64Array(N), l = new Float64Array(N), c = new Float64Array(N);
let price = 100, day = Date.UTC(2024, 0, 1);
for (let i = 0; i < N; i++) {
  times[i] = day; day += 86400000;
  const open = price, close = open + (Math.random() - 0.5) * 4;
  o[i] = open; c[i] = close;
  h[i] = Math.max(open, close) + Math.random() * 1.5;
  l[i] = Math.min(open, close) - Math.random() * 1.5;
  price = close;
}

// Two stacked panels inside the preview container, linked on X.
const top = document.createElement("div");
const bot = document.createElement("div");
top.style.cssText = "position:absolute;left:0;right:0;top:0;height:66%";
bot.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:34%";
container.append(top, bot);

const priceP = new photon.Plot(top, {
  theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false,
});
priceP.addCandlestick({ x: idx, open: o, high: h, low: l, close: c });
priceP.render();

const rsiP = new photon.Plot(bot, {
  theme: "dark", scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 100] } }, showToolbar: false,
});
const r = photon.rsi(c, 14);
const s = Math.max(0, photon.firstFinite(r));
rsiP.addLine({ x: idx.subarray(s), y: r.subarray(s), color: "#f472b6", width: 1.5, name: "RSI" });
rsiP.addAnnotation({ type: "span", dim: "y", value: 70, color: "#475569", dash: [4, 4] });
rsiP.addAnnotation({ type: "span", dim: "y", value: 30, color: "#475569", dash: [4, 4] });
rsiP.render();

photon.linkX([priceP, rsiP]);`,

  Treemap: `// Squarified treemap from a flat list of items.
const items = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"]
  .map((label) => ({ label, value: 10 + Math.random() * 90 }));
const plot = new photon.Plot(container, { theme: "dark", showToolbar: false });
photon.addTreemap(plot, { items });
plot.render();`,

  Sankey: `// Sankey flow diagram: nodes + weighted links.
const nodes = ["Coal", "Gas", "Solar", "Grid", "Homes", "Industry", "Export"].map((name) => ({ name }));
const links = [
  { source: 0, target: 3, value: 30 }, { source: 1, target: 3, value: 20 }, { source: 2, target: 3, value: 15 },
  { source: 3, target: 4, value: 25 }, { source: 3, target: 5, value: 28 }, { source: 3, target: 6, value: 12 },
];
const plot = new photon.Plot(container, { theme: "dark", showToolbar: false });
photon.addSankey(plot, { nodes, links });
plot.render();`,

  "3D surface": `// A lit, colormapped 3D surface (drag to orbit).
const p3 = new photon.Plot3D(container, { axisLabels: { x: "x", y: "height", z: "z" }, title: "Sinc surface" });
const cols = 64, rows = 64;
const values = new Float64Array(cols * rows);
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const xx = (c / cols) * 8 - 4, yy = (r / rows) * 8 - 4, rr = Math.hypot(xx, yy) + 1e-6;
  values[r * cols + c] = (Math.sin(rr * 2) / rr) * 3;
}
p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height" });`,

  Polar: `// Polar plot: a rose curve + scatter points.
const pp = new photon.PolarPlot(container, { theme: "dark", maxRadius: 1 });
const T = 240;
const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
const r = new Float64Array(T);
for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(3 * theta[i]));
pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });

const B = 12;
pp.addScatter({
  theta: Float64Array.from({ length: B }, () => Math.random() * Math.PI * 2),
  r: Float64Array.from({ length: B }, () => 0.2 + Math.random() * 0.75),
  color: "#22d3ee", size: 6,
});`,
};

const PRESET_NAMES = Object.keys(PRESETS);
const DEFAULT_PRESET = "Line";
const STORAGE_KEY = "photon-playground-code";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

const editorEl = $<HTMLDivElement>("#editor");
const previewEl = $<HTMLDivElement>("#preview");
const statusEl = $<HTMLDivElement>("#status");
const presetEl = $<HTMLSelectElement>("#preset");
const runBtn = $<HTMLButtonElement>("#run");

// Populate the preset dropdown.
for (const name of PRESET_NAMES) {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  presetEl.append(opt);
}

// ---------------------------------------------------------------------------
// Status bar helpers
// ---------------------------------------------------------------------------
function setStatus(kind: "ok" | "err" | "info", msg: string): void {
  statusEl.className = "status" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
  statusEl.textContent = msg;
}

// ---------------------------------------------------------------------------
// Runner — clears #preview, mounts a fresh container, evals the code.
// ---------------------------------------------------------------------------
function run(code: string): void {
  // Replace the preview contents with a fresh child container. Removing the
  // old node makes any lingering rAF loop see `container.isConnected === false`.
  previewEl.replaceChildren();
  const container = document.createElement("div");
  previewEl.append(container);

  try {
    const fn = new Function("container", "photon", "map", code);
    fn(container, photon, photonMap);
    setStatus("ok", "✓ ran");
  } catch (err) {
    const e = err as Error;
    setStatus("err", "✗ " + (e && e.stack ? e.stack : String(err)));
  }
}

// ---------------------------------------------------------------------------
// CodeMirror 6 editor. Doc changes → persist + debounced auto-run.
// ---------------------------------------------------------------------------
let debounce: number | undefined;
function scheduleRun(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => run(getCode()), 600);
}

const view = new EditorView({
  parent: editorEl,
  extensions: [
    basicSetup,
    javascript({ typescript: true }),
    oneDark,
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      localStorage.setItem(STORAGE_KEY, getCode());
      scheduleRun();
    }),
  ],
});

const getCode = (): string => view.state.doc.toString();
const setCode = (text: string): void => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
};

// ---------------------------------------------------------------------------
// Wiring: run button, preset switch, persistence.
// ---------------------------------------------------------------------------
runBtn.addEventListener("click", () => run(getCode()));

presetEl.addEventListener("change", () => {
  const code = PRESETS[presetEl.value] ?? "";
  setCode(code); // updateListener persists this
  run(code);
});

// Initial load: restore saved edits, else the default preset.
const saved = localStorage.getItem(STORAGE_KEY);
presetEl.value = DEFAULT_PRESET;
setCode(saved ?? PRESETS[DEFAULT_PRESET]);
run(getCode());
