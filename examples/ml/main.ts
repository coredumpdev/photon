import {
  Plot,
  addTrainingCurves, addConfusionMatrix, addRocCurve, addPrCurve, addCalibration,
  addEmbedding, addDecisionBoundary, addFeatureImportance, addShapBeeswarm,
  addPartialDependence, addAttentionMap, addRidgeline, pca,
} from "@photonviz/core";

// ── Deterministic synthetic data (seeded — stable across reloads) ────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
/** Standard normal via Box–Muller. */
function gauss(mean = 0, sd = 1): number {
  const u = 1 - rng(), v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const grid = document.getElementById("grid")!;
/** Create a titled panel and return its chart container. */
function panel(title: string, sub: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "panel";
  d.innerHTML = `<h2>${title}<span>${sub}</span></h2><div class="chart"></div>`;
  grid.appendChild(d);
  return d.querySelector(".chart") as HTMLElement;
}
const base = { theme: "dark" as const, showToolbar: false };

// 1 ── Training curves (EMA smoothing + best-epoch marker) ───────────────────
{
  const E = 90;
  const train = new Float64Array(E), val = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    train[e] = 2.4 * Math.exp(-e / 24) + 0.16 + Math.abs(gauss(0, 0.05));
    // Validation dips then slightly overfits after ~epoch 55.
    val[e] = 2.4 * Math.exp(-e / 21) + 0.28 + Math.max(0, (e - 55) * 0.004) + Math.abs(gauss(0, 0.09));
  }
  const p = new Plot(panel("Training curves", "· EMA smoothing"), { ...base, legend: true });
  addTrainingCurves(p, {
    series: [{ name: "train loss", y: train, color: "#60a5fa" }, { name: "val loss", y: val, color: "#f472b6" }],
    smoothing: 0.6, showRaw: true, best: "min",
  });
}

// 2 ── Confusion matrix (5 classes) ──────────────────────────────────────────
{
  const C = 5, N = 600;
  const yTrue = new Int32Array(N), yPred = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const t = Math.floor(rng() * C);
    yTrue[i] = t;
    yPred[i] = rng() < 0.82 ? t : Math.floor(rng() * C); // 82% accurate, rest confused
  }
  const p = new Plot(panel("Confusion matrix", "· 5 classes"), base);
  addConfusionMatrix(p, { yTrue, yPred, classes: C, colormap: "viridis" });
}

// ROC / PR / calibration all share one binary classifier's scores.
const NB = 500;
const scores = new Float64Array(NB), labels = new Int32Array(NB);
for (let i = 0; i < NB; i++) {
  const pos = rng() < 0.4 ? 1 : 0;
  labels[i] = pos;
  scores[i] = Math.min(1, Math.max(0, pos ? gauss(0.68, 0.17) : gauss(0.36, 0.17)));
}

// 3 ── ROC curve ─────────────────────────────────────────────────────────────
{
  const p = new Plot(panel("ROC curve", "· AUC in legend"), { ...base, legend: true });
  addRocCurve(p, { scores, labels, fill: true, color: "#38bdf8" });
}

// 4 ── Precision–recall curve ────────────────────────────────────────────────
{
  const p = new Plot(panel("Precision–recall", "· AP in legend"), { ...base, legend: true });
  addPrCurve(p, { scores, labels, fill: true });
}

// 5 ── Calibration / reliability diagram ─────────────────────────────────────
{
  const p = new Plot(panel("Calibration", "· reliability + ECE"), { ...base, legend: true });
  addCalibration(p, { scores, labels, bins: 10 });
}

// 6 ── Embedding projector (high-D Gaussians → PCA 2-D) ──────────────────────
{
  const D = 12, K = 3, per = 90, N = K * per;
  const means: number[][] = Array.from({ length: K }, () => Array.from({ length: D }, () => gauss(0, 2.4)));
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
  const p = new Plot(panel("Embedding (PCA)", "· color by class"), { ...base, legend: true, pick: "xy" });
  addEmbedding(p, { x: xs, y: ys, labels: cls, classNames: ["cats", "dogs", "birds"], size: 5 });
}

// 7 ── Decision boundary (field + training points) ───────────────────────────
{
  const nx = 72, ny = 72, lo = -3, hi = 3;
  const values = new Float64Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const x = lo + ((hi - lo) * ix) / (nx - 1), y = lo + ((hi - lo) * iy) / (ny - 1);
    values[iy * nx + ix] = 1 / (1 + Math.exp(-(1.6 - (x * x + y * y)) * 2.2)); // radial P(class 1)
  }
  const M = 220;
  const px = new Float64Array(M), py = new Float64Array(M), pl = new Int32Array(M);
  for (let i = 0; i < M; i++) {
    const x = lo + rng() * (hi - lo), y = lo + rng() * (hi - lo);
    px[i] = x; py[i] = y;
    const inside = x * x + y * y < 1.6;
    pl[i] = (rng() < 0.9 ? inside : !inside) ? 1 : 0; // 10% label noise
  }
  const p = new Plot(panel("Decision boundary", "· field + points"), { ...base, pick: "xy" });
  addDecisionBoundary(p, {
    values, cols: nx, rows: ny, extent: { x: [lo, hi], y: [lo, hi] }, colormap: "coolwarm", domain: [0, 1],
    points: { x: px, y: py, labels: pl, classNames: ["outside", "inside"], palette: ["#0b1020", "#e5e7eb"], size: 5 },
  });
}

// 8 ── Feature importance (sorted horizontal bars) ───────────────────────────
{
  const names = ["bmi", "s5", "bp", "age", "s3", "sex", "s1", "s6", "s4"];
  const values = names.map(() => rng() * rng()); // skewed toward small
  const p = new Plot(panel("Feature importance", "· sorted"), base);
  addFeatureImportance(p, { names, values, color: "#34d399", top: 9 });
}

// 9 ── SHAP beeswarm (per-sample impact, colored by feature value) ───────────
{
  const names = ["bmi", "s5", "bp", "age", "s3", "sex"];
  const F = names.length, N = 180;
  const shap: number[][] = [], fval: number[][] = [];
  for (let f = 0; f < F; f++) {
    const w = (F - f) / F; // decreasing importance
    const sv: number[] = [], fv: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = gauss(0, 1);
      fv.push(v);
      sv.push(w * v * 0.6 + gauss(0, 0.08)); // impact correlates with feature value
    }
    shap.push(sv); fval.push(fv);
  }
  const p = new Plot(panel("SHAP beeswarm", "· impact by feature value"), base);
  addShapBeeswarm(p, { values: shap, featureValues: fval, names, size: 4 });
}

// 10 ── Partial dependence (+ ICE) ───────────────────────────────────────────
{
  const G = 32;
  const x = new Float64Array(G), pd = new Float64Array(G);
  for (let i = 0; i < G; i++) { const t = i / (G - 1); x[i] = t; pd[i] = 0.2 + 0.6 / (1 + Math.exp(-(t - 0.5) * 10)); }
  const ice: number[][] = [];
  for (let k = 0; k < 16; k++) {
    const scale = 0.7 + rng() * 0.6, off = gauss(0, 0.04);
    ice.push(Array.from(pd, (v) => Math.min(1, Math.max(0, 0.2 + (v - 0.2) * scale + off + gauss(0, 0.015)))));
  }
  const p = new Plot(panel("Partial dependence", "· PDP + ICE"), { ...base, legend: true });
  addPartialDependence(p, { x, pd, ice });
}

// 11 ── Attention map (transformer, query × key) ─────────────────────────────
{
  const T = 11;
  const w: number[][] = [];
  for (let q = 0; q < T; q++) {
    const row: number[] = [];
    let z = 0;
    for (let k = 0; k <= q; k++) { // causal mask
      const bias = -Math.abs(q - k) * 0.55 + (k === 0 ? 0.9 : 0) + gauss(0, 0.12);
      const e = Math.exp(bias); row.push(e); z += e;
    }
    for (let k = q + 1; k < T; k++) row.push(0);
    for (let k = 0; k < T; k++) row[k]! /= z || 1;
    w.push(row);
  }
  const p = new Plot(panel("Attention map", "· causal, query × key"), base);
  addAttentionMap(p, { weights: w, colormap: "viridis" });
}

// 12 ── Ridgeline (weight distribution over epochs) ──────────────────────────
{
  const epochs = 8;
  const groups = Array.from({ length: epochs }, (_, e) => {
    const mean = 1.1 * Math.exp(-e / 3), sd = 0.45 * Math.exp(-e / 6) + 0.14;
    return { label: `epoch ${e}`, values: Float64Array.from({ length: 320 }, () => gauss(mean, sd)) };
  });
  const p = new Plot(panel("Ridgeline", "· weights over epochs"), base);
  addRidgeline(p, { groups, overlap: 1.6, range: [-1.5, 2.5] });
}
