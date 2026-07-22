import { bench, describe } from "vitest";
import { autoTicks } from "../src/axes/ticks.js";
import { colormap, colormapLUT } from "../src/color/colormap.js";
import { forceLayout } from "../src/graph/force.js";
import { decimateIndices } from "../src/layers/line-util.js";
import { earcut } from "../src/geo/earcut.js";
import { marchingCubes } from "../src/plot3d/marching-cubes.js";
import { fft, histogram, kde } from "../src/stats/index.js";

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
  const e100 = graph(100), e300 = graph(300);
  bench("100 nodes · 300 iters", () => { forceLayout(100, e100, { iterations: 300 }); });
  bench("300 nodes · 300 iters", () => { forceLayout(300, e300, { iterations: 300 }); });
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
