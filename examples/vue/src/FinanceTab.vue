<script setup lang="ts">
// ===========================================================================
// FinanceTab — specialist finance charts on the @photonviz finance module.
// Mirrors examples/vanilla → buildFinance(). All panels are STATIC (no FPS).
// Mounted lazily (v-if in App.vue) so containers are sized when plots build.
//
// The five single-plot panels use the declarative wrappers. The linked
// dashboard (price + RSI + MACD synced via linkX) is built against
// @photonviz/core directly, because the Vue <Plot> keeps its core plot private.
// ===========================================================================
import { Bollinger, Candlestick, Depth, HeikinAshi, Plot, Renko, VolumeProfile, firstFinite, macd, rsi } from "@photonviz/vue";
import { Plot as CorePlot, linkX, type PlotOptions } from "@photonviz/core";
import { onMounted, onUnmounted, ref } from "vue";
import Panel from "./Panel.vue";

// --- Seeded RNG + business-day session times (same recipe as vanilla) -------
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

// --- Synthetic OHLCV random walk --------------------------------------------
const N = 90;
const times = businessDays(N, Date.UTC(2024, 0, 1));
const idx = Float64Array.from({ length: N }, (_, i) => i);
const o = new Float64Array(N);
const h = new Float64Array(N);
const l = new Float64Array(N);
const c = new Float64Array(N);
const vol = new Float64Array(N);
{
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price;
    const close = open + gaussian(0, 2.2);
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.2));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.2));
    vol[i] = 20 + Math.abs(close - open) * 6 + rand() * 12;
    price = close;
  }
}

const ordinalTime = { theme: "dark", scales: { x: { type: "ordinal-time", times } }, showToolbar: false } as PlotOptions;
const plain = { theme: "dark", showToolbar: false } as PlotOptions;

// --- Depth chart — cumulative order book synthesized around the last price ---
const mid = c[N - 1]!;
const bids: [number, number][] = [];
const asks: [number, number][] = [];
for (let i = 1; i <= 20; i++) {
  bids.push([mid - i * 0.5, 5 + rand() * 20]);
  asks.push([mid + i * 0.5, 5 + rand() * 20]);
}

// ===========================================================================
// Linked dashboard — price candles + RSI(14) + MACD(12/26/9), synced via
// linkX. Indicators carry leading-NaN warm-up, trimmed with firstFinite.
// ===========================================================================
const priceEl = ref<HTMLDivElement | null>(null);
const rsiEl = ref<HTMLDivElement | null>(null);
const macdEl = ref<HTMLDivElement | null>(null);
let plots: CorePlot[] = [];
let detachLink: (() => void) | null = null;

/** Slice a series past its warm-up NaNs (indicators return leading NaN). */
function trim(y: Float64Array): { x: Float64Array; y: Float64Array } {
  const s = Math.max(0, firstFinite(y));
  return { x: idx.subarray(s), y: y.subarray(s) };
}

function buildLinked(): void {
  if (!priceEl.value || !rsiEl.value || !macdEl.value) return;

  const priceP = new CorePlot(priceEl.value, {
    theme: "dark",
    scales: { x: { type: "ordinal-time", times } },
    showToolbar: false,
  });
  priceP.addCandlestick({ x: idx, open: o, high: h, low: l, close: c });
  priceP.render();

  const rsiP = new CorePlot(rsiEl.value, {
    theme: "dark",
    scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 100] } },
    showToolbar: false,
  });
  const r = trim(rsi(c, 14));
  rsiP.addLine({ x: r.x, y: r.y, color: "#f472b6", width: 1.5, name: "RSI" });
  rsiP.addAnnotation({ type: "span", dim: "y", value: 70, color: "#475569", dash: [4, 4] });
  rsiP.addAnnotation({ type: "span", dim: "y", value: 30, color: "#475569", dash: [4, 4] });
  rsiP.render();

  const m = macd(c, 12, 26, 9);
  const macdP = new CorePlot(macdEl.value, {
    theme: "dark",
    scales: { x: { type: "ordinal-time", times } },
    showToolbar: false,
  });
  const hist = trim(m.histogram);
  macdP.addBar({ x: hist.x, y: hist.y, width: 0.7, color: "#64748b" });
  const ml = trim(m.macd);
  const sl = trim(m.signal);
  macdP.addLine({ x: ml.x, y: ml.y, color: "#60a5fa", width: 1.5, name: "MACD" });
  macdP.addLine({ x: sl.x, y: sl.y, color: "#f59e0b", width: 1.5, name: "signal" });
  macdP.render();

  plots = [priceP, rsiP, macdP];
  detachLink = linkX(plots);
}

onMounted(buildLinked);
onUnmounted(() => {
  detachLink?.();
  detachLink = null;
  for (const p of plots) p.destroy();
  plots = [];
});
</script>

<template>
  <div class="grid">
    <Panel title="Heikin-Ashi" subtitle="smoothed candles">
      <Plot :options="ordinalTime">
        <HeikinAshi :x="idx" :open="o" :high="h" :low="l" :close="c" />
      </Plot>
    </Panel>

    <Panel title="Renko" subtitle="brickSize 2 · wickless">
      <Plot :options="plain">
        <Renko :close="c" :brick-size="2" />
      </Plot>
    </Panel>

    <Panel title="Bollinger Bands" subtitle="20 · 2σ">
      <Plot :options="ordinalTime">
        <Candlestick :x="idx" :open="o" :high="h" :low="l" :close="c" />
        <Bollinger :x="idx" :close="c" :period="20" :k="2" band-color="rgba(167,139,250,0.14)" />
      </Plot>
    </Panel>

    <Panel title="Volume profile" subtitle="volume by price · POC">
      <Plot :options="plain">
        <VolumeProfile :price="c" :volume="vol" :bins="24" color="#3b82f6" poc-color="#f59e0b" />
      </Plot>
    </Panel>

    <Panel title="Depth chart" subtitle="cumulative order book">
      <Plot :options="plain">
        <Depth :bids="bids" :asks="asks" />
      </Plot>
    </Panel>

    <!-- Linked dashboard: price + RSI + MACD, synced with linkX (core plots). -->
    <Panel title="Linked · price" subtitle="candles · drag to pan">
      <div ref="priceEl" style="position: relative; width: 100%; height: 100%"></div>
    </Panel>
    <Panel title="Linked · RSI(14)" subtitle="70 / 30 guides">
      <div ref="rsiEl" style="position: relative; width: 100%; height: 100%"></div>
    </Panel>
    <Panel title="Linked · MACD" subtitle="12/26/9">
      <div ref="macdEl" style="position: relative; width: 100%; height: 100%"></div>
    </Panel>
  </div>
</template>
