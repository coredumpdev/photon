import { bench, describe } from "vitest";
import { autoTicks } from "../src/axes/ticks.js";
import { colormap, colormapLUT } from "../src/color/colormap.js";
import { forceLayout } from "../src/graph/force.js";
import { decimateIndices } from "../src/layers/line-util.js";
import { earcut } from "../src/geo/earcut.js";
import { marchingCubes } from "../src/plot3d/marching-cubes.js";
import { fft, histogram, kde } from "../src/stats/index.js";
import { pickNearest, type PickProjection } from "../src/layers/pick.js";
import { isobands, streamlines } from "../src/charts/fields.js";
import { delaunay } from "../src/geo/delaunay.js";

// ---- Large-series line decimation (min/max per pixel column) -----------------
describe("decimateIndices", () => {
  const y100k = Float64Array.from({ length: 100_000 }, (_, i) => Math.sin(i * 0.01) + Math.sin(i * 0.0007));
  const y1m = Float64Array.from({ length: 1_000_000 }, (_, i) => Math.sin(i * 0.01) + Math.sin(i * 0.0007));
  bench("100k pts → 1000 cols", () => { decimateIndices(y100k, 0, y100k.length, 1000); });
  bench("1M pts → 1500 cols", () => { decimateIndices(y1m, 0, y1m.length, 1500); });
});

// ---- Polygon triangulation (earcut; z-order path above 80 verts) -------------
describe("earcut", () => {
  const ring = (n: number, r = 100) => {
    const pts: number[] = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push(Math.cos(a) * r, Math.sin(a) * r); }
    return pts;
  };
  const c256 = ring(256), c2000 = ring(2000);
  bench("256-gon", () => { earcut(c256); });
  bench("2000-gon (z-order)", () => { earcut(c2000); });
});

// ---- Marching cubes isosurface ----------------------------------------------
describe("marchingCubes", () => {
  const vol = (n: number) => {
    const v = new Float64Array(n * n * n);
    const c = (n - 1) / 2;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v[x + y * n + z * n * n] = Math.hypot(x - c, y - c, z - c);
    return { v, n };
  };
  const g32 = vol(32), g48 = vol(48);
  bench("32³ volume", () => { marchingCubes(g32.v, [32, 32, 32], 10); });
  bench("48³ volume", () => { marchingCubes(g48.v, [48, 48, 48], 15); });
});

// ---- Force-directed graph layout (O(n²) per iteration) -----------------------
describe("forceLayout", () => {
  const graph = (n: number) => {
    const edges: [number, number][] = [];
    for (let i = 1; i < n; i++) edges.push([i, Math.floor(i / 2)]); // a tree
    return edges;
  };
  const e100 = graph(100), e300 = graph(300), e1000 = graph(1000), e3000 = graph(3000);
  bench("100 nodes · 300 iters", () => { forceLayout(100, e100, { iterations: 300 }); });
  bench("300 nodes · 300 iters", () => { forceLayout(300, e300, { iterations: 300 }); });
  bench("1000 nodes · 300 iters", () => { forceLayout(1000, e1000, { iterations: 300 }); });
  bench("3000 nodes · 300 iters", () => { forceLayout(3000, e3000, { iterations: 300 }); });
  // theta: 0 forces the exact all-pairs sum — the cost before Barnes-Hut.
  bench("1000 nodes · exact (theta 0)", () => { forceLayout(1000, e1000, { iterations: 300, theta: 0 }); });
});

// ---- Signal / stats ----------------------------------------------------------
describe("stats", () => {
  const re = () => Float64Array.from({ length: 16384 }, (_, i) => Math.sin(i * 0.05));
  const samples = Float64Array.from({ length: 1_000_000 }, () => Math.random());
  const kdeSamples = Float64Array.from({ length: 5000 }, () => Math.random() * 4 - 2);
  bench("fft 16384", () => { fft(re(), new Float64Array(16384)); });
  bench("histogram 1M · 60 bins", () => { histogram(samples, { bins: 60 }); });
  bench("kde 5000 → 256", () => { kde(kdeSamples, -2, 2, 256); });
});

// ---- Hot per-element utilities ----------------------------------------------
describe("utilities", () => {
  const cmap = colormap("viridis");
  const lut = colormapLUT("viridis");
  bench("colormap sampler ×1M", () => { let s = 0; for (let i = 0; i < 1_000_000; i++) s += cmap((i % 1000) / 1000)[0]; return s; });
  bench("colormapLUT direct ×1M", () => { let s = 0; for (let i = 0; i < 1_000_000; i++) { const t = (i % 1000) / 1000; s += lut[((t * 255) | 0) * 3]!; } return s; });
  bench("autoTicks ×10k", () => { for (let i = 0; i < 10_000; i++) autoTicks(0, i + 1, 6); });
});

// ---- Hover picking at scale --------------------------------------------------
//
// The one path where an algorithm change moved the numbers by three orders of
// magnitude, so it is the one most worth guarding. `sorted: false` is the scan
// that used to run for every series; `sorted: true` is what ships.
describe("pickNearest", () => {
  const make = (n: number) => {
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) { xs[i] = i; ys[i] = Math.sin(i / 500) + Math.sin(i / 37) * 0.1; }
    return { xs, ys };
  };
  const project = (n: number): PickProjection => ({
    x: (v) => (v / n) * 900,
    y: (v) => 250 - v * 100,
  });

  for (const n of [100_000, 1_000_000, 5_000_000]) {
    const { xs, ys } = make(n);
    const p = project(n);
    const label = `${(n / 1000).toLocaleString()}k pts`;
    bench(`${label} · x · sorted`, () => { pickNearest(xs, ys, n, "x", 450, 250, p, Infinity, true); });
    bench(`${label} · xy · sorted`, () => { pickNearest(xs, ys, n, "xy", 450, 250, p, Infinity, true); });
    // A scatter passes its marker radius, which bounds the search outright.
    bench(`${label} · xy · gated 8px`, () => { pickNearest(xs, ys, n, "xy", 450, 250, p, 8, true); });
  }
  // One unsorted case, so the fallback's cost stays visible rather than assumed.
  {
    const n = 100_000;
    const { xs, ys } = make(n);
    for (let i = 0; i < n; i += 7) xs[i] = (xs[i]! + 500) % n; // break monotonicity
    const p = project(n);
    bench("100k pts · xy · unsorted (scan)", () => { pickNearest(xs, ys, n, "xy", 450, 120, p); });
  }
});

// ---- Field and mesh builders -------------------------------------------------
//
// One-shot CPU work at chart-build time. These are the only paths that can still
// block a frame for longer than a frame, so their growth matters.
describe("field builders", () => {
  const field = (n: number) => {
    const v = new Float64Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) v[r * n + c] = Math.sin(c / 9) * Math.cos(r / 11);
    return { values: v, cols: n, rows: n, extent: { x: [0, 1] as [number, number], y: [0, 1] as [number, number] } };
  };
  const f64 = field(64), f128 = field(128);
  bench("isobands 64² · 12 bands", () => { isobands(f64, 12); });
  bench("isobands 128² · 12 bands", () => { isobands(f128, 12); });

  const scatter = (n: number) => {
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = Math.sin(i * 7.31) * 100; y[i] = Math.cos(i * 3.17) * 100; }
    return { x, y };
  };
  const s2k = scatter(2000), s20k = scatter(20_000);
  bench("delaunay 2k pts", () => { delaunay(s2k.x, s2k.y); });
  bench("delaunay 20k pts", () => { delaunay(s20k.x, s20k.y); });

  const vf = (n: number) => {
    const u = new Float64Array(n * n), v = new Float64Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = -1 + (2 * c) / (n - 1), y = -1 + (2 * r) / (n - 1);
      u[r * n + c] = -y; v[r * n + c] = x;
    }
    return { u, v, cols: n, rows: n, extent: { x: [-1, 1] as [number, number], y: [-1, 1] as [number, number] } };
  };
  const field48 = vf(48);
  bench("streamlines 48² · density 1", () => { streamlines(field48, { density: 1 }); });
});
