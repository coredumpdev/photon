/**
 * Deterministic sample data shared by the docs demos, so every page renders the
 * same picture on every build (and screenshots stay comparable).
 */

/** Small, fast, seedable PRNG — same one the examples use. */
export function rng(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function gauss(next: () => number, mean = 0, sd = 1): number {
  const u = 1 - next();
  const v = next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** `n` evenly spaced values from `lo` to `hi`. */
export function linspace(lo: number, hi: number, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = lo + ((hi - lo) * i) / (n - 1);
  return out;
}

/** A synthetic OHLC series (a random walk with plausible wicks). */
export function ohlc(bars = 140, seed = 7) {
  const next = rng(seed);
  const x = new Float64Array(bars);
  const open = new Float64Array(bars);
  const high = new Float64Array(bars);
  const low = new Float64Array(bars);
  const close = new Float64Array(bars);
  const volume = new Float64Array(bars);
  let price = 100;
  for (let i = 0; i < bars; i++) {
    const o = price;
    const c = o + gauss(next, 0.05, 1.4);
    x[i] = i;
    open[i] = o;
    close[i] = c;
    high[i] = Math.max(o, c) + next() * 1.2;
    low[i] = Math.min(o, c) - next() * 1.2;
    volume[i] = 500 + next() * 1500;
    price = c;
  }
  return { x, open, high, low, close, volume };
}

/** A `cols × rows` scalar field, row-major with row 0 at the bottom. */
export function field(cols: number, rows: number, fn: (x: number, y: number) => number): Float64Array {
  const out = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[r * cols + c] = fn((c / (cols - 1)) * 2 - 1, (r / (rows - 1)) * 2 - 1);
    }
  }
  return out;
}

/** The theme every demo uses, so the docs read as one system. */
export const BASE = { theme: "dark" as const, border: "#0b1220" };
