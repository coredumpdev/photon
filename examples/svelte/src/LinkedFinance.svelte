<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Plot as CorePlot, linkX } from "@photonviz/core";
  import FsButton from "./FsButton.svelte";

  /** Deterministic RNG (isolated instance so it doesn't perturb the page). */
  let seed = 1337;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const gaussian = (m: number, sd: number) => {
    const u = rand() || 1e-9;
    const v = rand() || 1e-9;
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const jitter = () => Math.random() - 0.5;

  /** Business-day epoch-ms timestamps (skip Sat/Sun) for the ordinal-time axis. */
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

  let priceNode: HTMLDivElement;
  let volNode: HTMLDivElement;
  let fps = 0;

  let raf = 0;
  let priceP: CorePlot | undefined;
  let volP: CorePlot | undefined;

  onMount(() => {
    const N = 60;
    const times = businessDays(N, Date.UTC(2024, 0, 1));
    const idx = Float64Array.from({ length: N }, (_, i) => i);
    const o = new Float64Array(N);
    const h = new Float64Array(N);
    const l = new Float64Array(N);
    const c = new Float64Array(N);
    const vol = new Float64Array(N);
    let price = 100;
    for (let i = 0; i < N; i++) {
      const open = price;
      const close = open + gaussian(0, 2);
      o[i] = open;
      c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1));
      vol[i] = 20 + Math.abs(close - open) * 6 + rand() * 10;
      price = close;
    }

    priceP = new CorePlot(priceNode, {
      theme: "dark",
      scales: { x: { type: "ordinal-time", times } },
      showToolbar: false,
    });
    const cs = priceP.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });

    volP = new CorePlot(volNode, {
      theme: "dark",
      scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 80] } },
      showToolbar: false,
    });
    const volBar = volP.addBar({ x: idx, y: vol, width: 0.7, color: "#38bdf8", renderType: "dynamic" });

    // Pan/zoom + crosshair on either pane drives both.
    linkX([priceP, volP]);

    let curOpen = c[N - 1]!;
    let curClose = curOpen;
    let hi = curOpen;
    let lo = curOpen;
    let curVol = vol[N - 1]!;
    let sinceClose = 0;

    let fpsAvg = 0;
    let last = 0;
    let lastPaint = 0;

    const loop = (now: number): void => {
      curClose += gaussian(0, 0.3);
      hi = Math.max(hi, curClose);
      lo = Math.min(lo, curClose);
      curVol = Math.max(5, curVol + jitter() * 3);
      cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
      vol[N - 1] = curVol;
      volBar.setData(idx, vol);
      priceP!.render();
      volP!.render();

      if (++sinceClose > 60) {
        sinceClose = 0;
        for (let i = 0; i < N - 1; i++) {
          o[i] = o[i + 1]!;
          h[i] = h[i + 1]!;
          l[i] = l[i + 1]!;
          c[i] = c[i + 1]!;
          vol[i] = vol[i + 1]!;
        }
        curOpen = curClose;
        o[N - 1] = curOpen;
        h[N - 1] = curOpen;
        l[N - 1] = curOpen;
        c[N - 1] = curOpen;
        hi = lo = curOpen;
        curVol = 20 + rand() * 10;
        vol[N - 1] = curVol;
        cs.setData({ x: idx, open: o, high: h, low: l, close: c });
      }

      if (last > 0) {
        const dt = now - last;
        if (dt > 0) {
          const inst = 1000 / dt;
          fpsAvg = fpsAvg > 0 ? fpsAvg * 0.9 + inst * 0.1 : inst;
        }
      }
      if (now - lastPaint > 250) {
        lastPaint = now;
        fps = Math.round(fpsAvg);
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });

  onDestroy(() => {
    cancelAnimationFrame(raf);
    priceP?.destroy();
    volP?.destroy();
  });
</script>

<section class="card wide">
  <FsButton />
  <h2>Linked finance<span> — candlesticks + volume · ordinal-time · linkX</span></h2>
  <div class="finance">
    <div class="chartwrap">
      <div class="chart" bind:this={priceNode}></div>
      <div class="fps">{fps} fps</div>
    </div>
    <div class="chartwrap">
      <div class="chart chart--short" bind:this={volNode}></div>
    </div>
  </div>
</section>

<style>
  .finance {
    display: flex;
    flex-direction: column;
  }
  .chart--short {
    height: 120px;
  }
</style>
