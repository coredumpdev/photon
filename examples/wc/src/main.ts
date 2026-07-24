// Importing the package registers <photon-plot>, <photon-plot3d>, <photon-polar>.
import {
  PhotonPlotElement, PhotonPlot3DElement, PhotonPolarElement,
  addConfusionMatrix, addRocCurve, addEmbedding, addTrainingCurves, addShapBeeswarm, addAttentionMap, pca,
} from "@photonviz/wc";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const gauss = (m: number, sd: number): number =>
  m + sd * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());

// --- Line --------------------------------------------------------------------
{
  const x = Float64Array.from({ length: 240 }, (_, i) => i);
  const y = x.map((v) => Math.sin(v / 14) + Math.sin(v / 37) * 0.4);
  byId<PhotonPlotElement>("line").series = [{ type: "line", x, y, color: "#60a5fa", width: 2, name: "signal" }];
}

// --- Candlestick + Heikin-Ashi (shared OHLC) ---------------------------------
{
  const n = 60;
  const x = Float64Array.from({ length: n }, (_, i) => i);
  const open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price, c = o + (Math.random() - 0.5) * 5;
    open[i] = o; close[i] = c;
    high[i] = Math.max(o, c) + Math.random() * 2;
    low[i] = Math.min(o, c) - Math.random() * 2;
    price = c;
  }
  byId<PhotonPlotElement>("candle").series = [{ type: "candlestick", x, open, high, low, close }];
  byId<PhotonPlotElement>("ha").series = [{ type: "heikinAshi", x, open, high, low, close }];
}

// --- Bars --------------------------------------------------------------------
{
  const x = Float64Array.from({ length: 12 }, (_, i) => i);
  const y = x.map(() => 20 + Math.random() * 80);
  byId<PhotonPlotElement>("bars").series = [{ type: "bar", x, y, color: "#34d399", width: 0.7 }];
}

// --- Pie ---------------------------------------------------------------------
{
  const pie = byId<PhotonPlotElement>("pie");
  pie.options = { theme: "dark", equalAspect: true, showToolbar: false };
  pie.series = [{ type: "pie", values: [38, 24, 18, 12, 8], colormap: "viridis" }];
}

// --- Polar -------------------------------------------------------------------
{
  const theta = Float64Array.from({ length: 180 }, (_, i) => (i * 2 * Math.PI) / 180);
  const r = theta.map((t) => 0.5 + 0.5 * Math.cos(3 * t));
  byId<PhotonPolarElement>("polar").series = [{ type: "line", theta, r, color: "#a78bfa", width: 2, closed: true }];
}

// --- 3D surface --------------------------------------------------------------
{
  const cols = 40, rows = 40;
  const values = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i / cols - 0.5) * 6, v = (j / rows - 0.5) * 6;
      values[j * cols + i] = Math.sin(Math.hypot(u, v)) / (Math.hypot(u, v) + 0.5);
    }
  }
  byId<PhotonPlot3DElement>("surf").layers = [{ type: "surface", values, cols, rows, colormap: "viridis" }];
}

// --- ML / deep-learning ------------------------------------------------------
// The multi-layer ML builders compose imperatively, so reach the underlying core
// Plot via the element's `.plot` getter (the imperative escape hatch).

// --- Confusion matrix --------------------------------------------------------
{
  const C = 5, N = 600;
  const yTrue = new Int32Array(N), yPred = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const t = Math.floor(Math.random() * C);
    yTrue[i] = t;
    yPred[i] = Math.random() < 0.82 ? t : Math.floor(Math.random() * C);
  }
  const el = byId<PhotonPlotElement>("cm");
  el.options = { theme: "dark", showToolbar: false };
  addConfusionMatrix(el.plot!, { yTrue, yPred, classes: C, colormap: "viridis" });
  el.plot!.render();
}

// Shared binary-classifier scores for the ROC card.
const NB = 500;
const scores = new Float64Array(NB), labels = new Int32Array(NB);
for (let i = 0; i < NB; i++) {
  const pos = Math.random() < 0.4 ? 1 : 0;
  labels[i] = pos;
  scores[i] = Math.min(1, Math.max(0, pos ? gauss(0.7, 0.16) : gauss(0.35, 0.16)));
}

// --- ROC curve ---------------------------------------------------------------
{
  const el = byId<PhotonPlotElement>("roc");
  el.options = { theme: "dark", legend: true, showToolbar: false };
  addRocCurve(el.plot!, { scores, labels, fill: true });
  el.plot!.render();
}

// --- Embedding (PCA) ---------------------------------------------------------
{
  const D = 12, K = 3, per = 80, N = K * per;
  const means = Array.from({ length: K }, () => Array.from({ length: D }, () => gauss(0, 2.4)));
  const data = new Float64Array(N * D);
  const cls = new Int32Array(N);
  let r = 0;
  for (let k = 0; k < K; k++) for (let j = 0; j < per; j++, r++) {
    cls[r] = k;
    for (let c = 0; c < D; c++) data[r * D + c] = means[k]![c]! + gauss(0, 1);
  }
  const proj = pca(data, N, D, 2);
  const xs = new Float64Array(N), ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { xs[i] = proj.scores[i * 2]!; ys[i] = proj.scores[i * 2 + 1]!; }
  const el = byId<PhotonPlotElement>("emb");
  el.options = { theme: "dark", legend: true, pick: "xy", showToolbar: false };
  addEmbedding(el.plot!, { x: xs, y: ys, labels: cls, classNames: ["cats", "dogs", "birds"], size: 5 });
  el.plot!.render();
}

// --- Training curves ---------------------------------------------------------
{
  const E = 90;
  const train = new Float64Array(E), val = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    train[e] = 2.4 * Math.exp(-e / 24) + 0.16 + Math.random() * 0.05;
    val[e] = 2.4 * Math.exp(-e / 21) + 0.28 + Math.max(0, (e - 55) * 0.004) + Math.random() * 0.09;
  }
  const el = byId<PhotonPlotElement>("train");
  el.options = { theme: "dark", legend: true, showToolbar: false };
  addTrainingCurves(el.plot!, {
    series: [{ name: "train loss", y: train, color: "#60a5fa" }, { name: "val loss", y: val, color: "#f472b6" }],
    smoothing: 0.6, showRaw: true, best: "min",
  });
  el.plot!.render();
}

// --- SHAP beeswarm -----------------------------------------------------------
{
  const names = ["bmi", "s5", "bp", "age", "s3", "sex"];
  const F = names.length, N = 160;
  const shap: number[][] = [], fval: number[][] = [];
  for (let f = 0; f < F; f++) {
    const w = (F - f) / F;
    const sv: number[] = [], fv: number[] = [];
    for (let i = 0; i < N; i++) { const v = gauss(0, 1); fv.push(v); sv.push(w * v * 0.6 + gauss(0, 0.08)); }
    shap.push(sv); fval.push(fv);
  }
  const el = byId<PhotonPlotElement>("shap");
  el.options = { theme: "dark", showToolbar: false };
  addShapBeeswarm(el.plot!, { values: shap, featureValues: fval, names, size: 4 });
  el.plot!.render();
}

// --- Attention map -----------------------------------------------------------
{
  const T = 11;
  const w: number[][] = [];
  for (let q = 0; q < T; q++) {
    const row: number[] = [];
    let z = 0;
    for (let k = 0; k <= q; k++) { const bias = -Math.abs(q - k) * 0.55 + (k === 0 ? 0.9 : 0) + gauss(0, 0.12); const e = Math.exp(bias); row.push(e); z += e; }
    for (let k = q + 1; k < T; k++) row.push(0);
    for (let k = 0; k < T; k++) row[k]! /= z || 1;
    w.push(row);
  }
  const el = byId<PhotonPlotElement>("attn");
  el.options = { theme: "dark", showToolbar: false };
  addAttentionMap(el.plot!, { weights: w, colormap: "viridis" });
  el.plot!.render();
}
