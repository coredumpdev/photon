<script lang="ts">
  import {
    plot,
    polarPlot,
    plot3d,
    type SeriesSpec,
    type PolarSeriesSpec,
    type LayerSpec3D,
    type PlotConfig,
  } from "@photonviz/svelte";
  import { Plot as CorePlot, type PlotOptions } from "@photonviz/core";
  import { xyzVectorSource } from "@photonviz/map";

  // --- Seeded RNG (identical every reload) -----------------------------------
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

  // --- Line + step line ------------------------------------------------------
  const N = 200;
  const x = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 10);
  const sine = x.map((v) => Math.sin(v));
  const cosine = x.map((v) => Math.cos(v) * 0.6);

  const stepN = 24;
  const stepX = Array.from({ length: stepN }, (_, i) => i);
  const stepY = Array.from({ length: stepN }, () => Math.round(rand() * 3));

  const lineSeries: SeriesSpec[] = [
    { type: "line", x, y: sine, color: "#38bdf8", width: 2 },
    { type: "line", x, y: cosine, color: "#f472b6", width: 2 },
  ];

  const stepSeries: SeriesSpec[] = [
    { type: "line", x: stepX, y: stepY, color: "#fbbf24", width: 2.5, step: "after", join: "miter" },
  ];

  // --- Scatter ---------------------------------------------------------------
  const M = 1200;
  const scx = new Float64Array(M);
  const scy = new Float64Array(M);
  const scv = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    scx[i] = gaussian(0, 1.4);
    scy[i] = gaussian(0, 1.4);
    scv[i] = Math.hypot(scx[i]!, scy[i]!);
  }
  const scatterSeries: SeriesSpec[] = [
    { type: "scatter", x: scx, y: scy, size: 6, colorBy: { values: scv, colormap: "viridis" } },
  ];

  // --- Bar -------------------------------------------------------------------
  const K = 9;
  const barX = Array.from({ length: K }, (_, i) => i);
  const barY = Array.from({ length: K }, () => 20 + rand() * 70);
  const barSeries: SeriesSpec[] = [
    { type: "bar", x: barX, y: barY, width: 0.7, color: "#22d3ee" },
  ];

  // --- Area ------------------------------------------------------------------
  const AN = 400;
  const areaX = Array.from({ length: AN }, (_, i) => i);
  const areaY = areaX.map((i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
  const areaSeries: SeriesSpec[] = [
    { type: "area", x: areaX, y: areaY, color: "rgba(52,211,153,0.45)" },
  ];

  // --- Heatmap ---------------------------------------------------------------
  const hCols = 60;
  const hRows = 40;
  const hValues = new Float64Array(hCols * hRows);
  for (let r = 0; r < hRows; r++)
    for (let c = 0; c < hCols; c++) {
      const xx = (c / hCols) * 6;
      const yy = (r / hRows) * 6;
      hValues[r * hCols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
    }
  const heatmapSeries: SeriesSpec[] = [
    { type: "heatmap", values: hValues, cols: hCols, rows: hRows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis" },
  ];

  // --- Box plot --------------------------------------------------------------
  const boxSeries: SeriesSpec[] = [
    {
      type: "box",
      width: 0.6,
      groups: [0, 1, 2, 3].map((g) => ({
        position: g,
        values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
        color: ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"][g],
      })),
    },
  ];

  // --- Hexbin ----------------------------------------------------------------
  const HM = 25_000;
  const hbx = new Float64Array(HM);
  const hby = new Float64Array(HM);
  for (let i = 0; i < HM; i++) {
    const blob = i % 2 === 0 ? -1.4 : 1.4;
    hbx[i] = gaussian(blob, 1);
    hby[i] = gaussian(blob * 0.6, 1.1);
  }
  const hexbinSeries: SeriesSpec[] = [
    { type: "hexbin", x: hbx, y: hby, radius: 0.22, colormap: "plasma" },
  ];

  // --- Contour ---------------------------------------------------------------
  const cCols = 80;
  const cRows = 60;
  const cValues = new Float64Array(cCols * cRows);
  for (let r = 0; r < cRows; r++)
    for (let c = 0; c < cCols; c++) {
      const xx = (c / cCols) * 6 - 3;
      const yy = (r / cRows) * 6 - 3;
      cValues[r * cCols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
    }
  const contourSeries: SeriesSpec[] = [
    { type: "contour", values: cValues, cols: cCols, rows: cRows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis" },
  ];

  // --- Error bars ------------------------------------------------------------
  const EN = 12;
  const ebX = Array.from({ length: EN }, (_, i) => i);
  const ebY = Array.from({ length: EN }, (_, i) => Math.sin(i / 2) * 3 + 5);
  const ebErr = Array.from({ length: EN }, () => 0.4 + rand() * 0.9);
  const errorbarSeries: SeriesSpec[] = [
    { type: "line", x: ebX, y: ebY, color: "#60a5fa", width: 1.5 },
    { type: "errorbar", x: ebX, y: ebY, yerr: ebErr, color: "#60a5fa", capSize: 7 },
  ];

  // --- Stem ------------------------------------------------------------------
  const SN = 30;
  const stemX = Array.from({ length: SN }, (_, i) => i);
  const stemY = Array.from({ length: SN }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
  const stemSeries: SeriesSpec[] = [
    { type: "stem", x: stemX, y: stemY, color: "#34d399", markerSize: 6 },
  ];

  // --- Quiver ----------------------------------------------------------------
  const G = 16;
  const qx: number[] = [];
  const qy: number[] = [];
  const qu: number[] = [];
  const qv: number[] = [];
  for (let i = 0; i < G; i++)
    for (let j = 0; j < G; j++) {
      const gxv = (i / (G - 1)) * 4 - 2;
      const gyv = (j / (G - 1)) * 4 - 2;
      qx.push(gxv);
      qy.push(gyv);
      qu.push(-gyv);
      qv.push(gxv);
    }
  const quiverSeries: SeriesSpec[] = [
    { type: "quiver", x: qx, y: qy, u: qu, v: qv, colorBy: { colormap: "viridis" } },
  ];

  // --- Candlestick -----------------------------------------------------------
  const CN = 40;
  const candX = new Float64Array(CN);
  const candO = new Float64Array(CN);
  const candH = new Float64Array(CN);
  const candL = new Float64Array(CN);
  const candC = new Float64Array(CN);
  let price = 100;
  for (let i = 0; i < CN; i++) {
    const o = price;
    const c = o + gaussian(0, 2.2);
    candX[i] = i;
    candO[i] = o;
    candC[i] = c;
    candH[i] = Math.max(o, c) + Math.abs(gaussian(0, 1.1));
    candL[i] = Math.min(o, c) - Math.abs(gaussian(0, 1.1));
    price = c;
  }
  const candleSeries: SeriesSpec[] = [
    { type: "candlestick", x: candX, open: candO, high: candH, low: candL, close: candC },
  ];

  // --- The Cartesian panel grid ----------------------------------------------
  interface Panel {
    title: string;
    cfg: PlotConfig;
  }
  const panels: Panel[] = [
    { title: "Line", cfg: { options: { theme: "dark" }, series: lineSeries } },
    { title: "Step line", cfg: { options: { theme: "dark" }, series: stepSeries } },
    { title: "Scatter · colorBy", cfg: { options: { theme: "dark" }, series: scatterSeries } },
    { title: "Bar", cfg: { options: { theme: "dark" }, series: barSeries } },
    { title: "Area", cfg: { options: { theme: "dark" }, series: areaSeries } },
    { title: "Heatmap", cfg: { options: { theme: "dark" }, series: heatmapSeries } },
    { title: "Box plot", cfg: { options: { theme: "dark" }, series: boxSeries } },
    { title: "Hexbin", cfg: { options: { theme: "dark" }, series: hexbinSeries } },
    { title: "Contour", cfg: { options: { theme: "dark" }, series: contourSeries } },
    { title: "Error bars", cfg: { options: { theme: "dark" }, series: errorbarSeries } },
    { title: "Stem", cfg: { options: { theme: "dark" }, series: stemSeries } },
    { title: "Quiver", cfg: { options: { theme: "dark" }, series: quiverSeries } },
    { title: "Candlestick", cfg: { options: { theme: "dark" }, series: candleSeries } },
  ];

  // --- Polar -----------------------------------------------------------------
  const PT = 240;
  const roseTheta = Array.from({ length: PT }, (_, i) => (i / (PT - 1)) * Math.PI * 2);
  const roseR = roseTheta.map((t) => Math.abs(Math.cos(4 * t)));
  const B = 14;
  const blipTheta = Array.from({ length: B }, () => rand() * Math.PI * 2);
  const blipR = Array.from({ length: B }, () => 0.2 + rand() * 0.75);
  const polarSeries: PolarSeriesSpec[] = [
    { type: "line", theta: roseTheta, r: roseR, color: "#a78bfa", width: 2, closed: true },
    { type: "scatter", theta: blipTheta, r: blipR, color: "#f472b6", size: 6 },
  ];

  // --- 3D --------------------------------------------------------------------
  const s3Cols = 64;
  const s3Rows = 64;
  const s3Values = new Float64Array(s3Cols * s3Rows);
  for (let r = 0; r < s3Rows; r++)
    for (let c = 0; c < s3Cols; c++) {
      const xx = (c / s3Cols) * 8 - 4;
      const yy = (r / s3Rows) * 8 - 4;
      const rr = Math.hypot(xx, yy) + 1e-6;
      s3Values[r * s3Cols + c] = (Math.sin(rr * 2) / rr) * 3;
    }
  const pcN = 6000;
  const pcx = new Float64Array(pcN);
  const pcy = new Float64Array(pcN);
  const pcz = new Float64Array(pcN);
  for (let i = 0; i < pcN; i++) {
    const th = (i / pcN) * Math.PI * 20;
    const rr = 1 + (i / pcN) * 2;
    pcx[i] = Math.cos(th) * rr + gaussian(0, 0.1);
    pcz[i] = Math.sin(th) * rr + gaussian(0, 0.1);
    pcy[i] = (i / pcN) * 8 - 4 + gaussian(0, 0.05);
  }
  const layers3d: LayerSpec3D[] = [
    { type: "surface", values: s3Values, cols: s3Cols, rows: s3Rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis" },
    { type: "pointcloud", x: pcx, y: pcy, z: pcz, size: 4, colorBy: { values: pcy, colormap: "plasma" } },
  ];

  // --- Map: MapLibre demo vector tiles (no key needed), zoom 0-5. ------------
  const mapSource = xyzVectorSource({
    url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf",
    attribution: "© MapLibre demo tiles",
    maxZoom: 5,
  });
  const mapSeries: SeriesSpec[] = [{ type: "map", source: mapSource }];

  // === LIVE / streaming panels — imperative, exactly like the vanilla example.
  // A reusable action: create a Plot, run setup(plot) → a per-frame step, then
  // animate via requestAnimationFrame (setData + render each frame). This does
  // not depend on any reactive prop diffing, so it always streams.
  function livePlot(
    node: HTMLElement,
    cfg: { options?: PlotOptions; setup: (p: CorePlot) => () => void },
  ) {
    const p = new CorePlot(node, cfg.options);
    const step = cfg.setup(p);
    let raf = requestAnimationFrame(function loop() {
      step();
      p.render();
      raf = requestAnimationFrame(loop);
    });
    return {
      destroy() {
        cancelAnimationFrame(raf);
        p.destroy();
      },
    };
  }
  const liveOpts: PlotOptions = { theme: "dark" };

  // Oscilloscope — one signal scrolling right-to-left.
  const OSC_N = 400;
  const oscX = Float64Array.from({ length: OSC_N }, (_, i) => i);
  const oscY = Float64Array.from({ length: OSC_N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
  let oscPhase = OSC_N;
  const oscSetup = (p: CorePlot) => {
    const line = p.addLine({ x: oscX, y: oscY, color: "#34d399", width: 2, decimate: false });
    p.setView({ x: [0, OSC_N - 1], y: [-2.6, 2.6] });
    return () => {
      oscY.copyWithin(0, 1);
      oscPhase += 1;
      oscY[OSC_N - 1] = Math.sin(oscPhase * 0.08) * 1.6 + Math.sin(oscPhase * 0.021) * 0.7 + (Math.random() - 0.5) * 0.25;
      line.setData(oscX, oscY);
    };
  };

  // Drifting scatter cloud (random walk).
  const SCAT_N = 400;
  const dsx = new Float64Array(SCAT_N);
  const dsy = new Float64Array(SCAT_N);
  for (let i = 0; i < SCAT_N; i++) { dsx[i] = gaussian(0, 1); dsy[i] = gaussian(0, 1); }
  const scatSetup = (p: CorePlot) => {
    const sc = p.addScatter({ x: dsx, y: dsy, size: 5, color: "#818cf8" });
    p.setView({ x: [-4, 4], y: [-4, 4] });
    return () => {
      for (let i = 0; i < SCAT_N; i++) {
        dsx[i] += (Math.random() - 0.5) * 0.08 - dsx[i]! * 0.01;
        dsy[i] += (Math.random() - 0.5) * 0.08 - dsy[i]! * 0.01;
      }
      sc.setData(dsx, dsy);
    };
  };

  // Fluctuating bars.
  const BAR_N = 9;
  const lbX = Float64Array.from({ length: BAR_N }, (_, i) => i);
  const lbY = Float64Array.from({ length: BAR_N }, () => 40 + rand() * 30);
  const barSetup = (p: CorePlot) => {
    const bar = p.addBar({ x: lbX, y: lbY, width: 0.7, color: "#22d3ee" });
    p.setView({ x: [-0.6, BAR_N - 0.4], y: [0, 100] });
    return () => {
      for (let i = 0; i < BAR_N; i++) lbY[i] = Math.max(2, Math.min(98, lbY[i]! + (Math.random() - 0.5) * 8));
      bar.setData(lbX, lbY);
    };
  };

  // Streaming area.
  const AREA_LN = 300;
  const laX = Float64Array.from({ length: AREA_LN }, (_, i) => i);
  const laY = Float64Array.from({ length: AREA_LN }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
  let areaPhase = AREA_LN;
  const areaSetup = (p: CorePlot) => {
    const area = p.addArea({ x: laX, y: laY, color: "rgba(52,211,153,0.45)" });
    p.setView({ x: [0, AREA_LN - 1], y: [0, 4] });
    return () => {
      laY.copyWithin(0, 1);
      areaPhase += 1;
      laY[AREA_LN - 1] = 2 + Math.sin(areaPhase * 0.06) + Math.sin(areaPhase * 0.017) * 0.7 + Math.random() * 0.2;
      area.setData(laX, laY);
    };
  };
</script>

<main>
  <h1>Photon · Svelte — full gallery</h1>

  <h2 class="section">Live / streaming · ~60fps</h2>
  <div class="grid">
    <section>
      <h2>Oscilloscope · scrolling line</h2>
      <div class="panel" use:livePlot={{ options: liveOpts, setup: oscSetup }}></div>
    </section>
    <section>
      <h2>Scatter · drifting cloud</h2>
      <div class="panel" use:livePlot={{ options: liveOpts, setup: scatSetup }}></div>
    </section>
    <section>
      <h2>Bars · fluctuating</h2>
      <div class="panel" use:livePlot={{ options: liveOpts, setup: barSetup }}></div>
    </section>
    <section>
      <h2>Area · streaming</h2>
      <div class="panel" use:livePlot={{ options: liveOpts, setup: areaSetup }}></div>
    </section>
  </div>

  <h2 class="section">Static gallery</h2>
  <div class="grid">
    {#each panels as p (p.title)}
      <section>
        <h2>{p.title}</h2>
        <div class="panel" use:plot={p.cfg}></div>
      </section>
    {/each}

    <section>
      <h2>Polar</h2>
      <div class="panel" use:polarPlot={{ options: { theme: "dark", maxRadius: 1 }, series: polarSeries }}></div>
    </section>

    <section>
      <h2>3D · surface + point cloud</h2>
      <div class="panel" use:plot3d={{ options: { axisLabels: { x: "x", y: "height", z: "z" }, lightControls: true }, layers: layers3d }}></div>
    </section>

    <section class="wide">
      <h2>Map</h2>
      <div
        class="panel"
        use:plot={{
          options: { theme: "dark", equalAspect: true, boundedPan: true },
          series: mapSeries,
        }}
      ></div>
    </section>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0b1020;
    color: #e2e8f0;
    font-family: system-ui, sans-serif;
  }
  main {
    max-width: 1300px;
    margin: 0 auto;
    padding: 1.5rem;
  }
  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }
  h2 {
    font-size: 0.85rem;
    font-weight: 500;
    color: #94a3b8;
    margin: 0 0 0.4rem;
  }
  h2.section {
    font-size: 1rem;
    font-weight: 600;
    color: #e2e8f0;
    margin: 1.75rem 0 0.9rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid #1e293b;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.25rem;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .panel {
    height: 260px;
    border: 1px solid #1e293b;
    border-radius: 8px;
    overflow: hidden;
  }
</style>
