// Finance tab data — synthetic OHLCV over a business-day session axis, plus a
// synthesized cumulative order book. Seeded so every reload is identical. All
// finance panels are STATIC (no streaming); indicators/transforms come from the
// @photonviz/gea finance re-exports and are applied in FinanceTab.

import { makeRng, businessDays } from "./data";

export interface FinanceData {
  N: number;
  times: number[];
  idx: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  vol: Float64Array;
  bids: [number, number][];
  asks: [number, number][];
}

export function financeData(): FinanceData {
  const { rand, gaussian } = makeRng(42);
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
  // Depth chart — synthesize a cumulative order book around the last price
  // (continues the same rand stream, mirroring the vanilla reference).
  const mid = c[N - 1];
  const bids: [number, number][] = [], asks: [number, number][] = [];
  for (let i = 1; i <= 20; i++) { bids.push([mid - i * 0.5, 5 + rand() * 20]); asks.push([mid + i * 0.5, 5 + rand() * 20]); }

  return { N, times, idx, o, h, l, c, vol, bids, asks };
}
