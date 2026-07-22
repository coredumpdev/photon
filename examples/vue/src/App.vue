<script setup lang="ts">
import { xyzVectorSource, type GeoJsonOptions, type MapStyle } from "@photonviz/map";
import { worldCountries } from "@photonviz/map/world";
import {
  Area,
  Bar,
  Box,
  Candlestick,
  Contour,
  ErrorBar,
  GeoJson,
  Heatmap,
  Hexbin,
  Line,
  Map,
  Plot,
  Plot3D,
  PointCloud,
  PolarLine,
  PolarPlot,
  PolarScatter,
  Quiver,
  Scatter,
  Stem,
  Surface,
  YAxis,
} from "@photonviz/vue";
import type {
  BoxOptions,
  ContourOptions,
  HeatmapOptions,
  ScatterOptions,
  QuiverOptions,
} from "@photonviz/core";
import { computed, onMounted, onUnmounted, shallowRef } from "vue";

// ---------------------------------------------------------------------------
// Seeded RNG so every reload draws the same synthetic data.
// ---------------------------------------------------------------------------
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

const plotDark = { theme: "dark" } as const;

// --- Line: a decaying sine wave ---------------------------------------------
const N = 400;
const lineX = Float64Array.from({ length: N }, (_, i) => (i / N) * 20);
const lineY = lineX.map((x) => Math.sin(x) * Math.exp(-x / 15));

// --- Step line: a digital staircase -----------------------------------------
const STEP_N = 24;
const stepX = Float64Array.from({ length: STEP_N }, (_, i) => i);
const stepY = Float64Array.from({ length: STEP_N }, () => Math.round(rand() * 3));

// --- Scatter (colorBy): value → viridis -------------------------------------
const SM = 1200;
const scatterX = new Float64Array(SM);
const scatterY = new Float64Array(SM);
const scatterV = new Float64Array(SM);
for (let i = 0; i < SM; i++) {
  scatterX[i] = gaussian(0, 1.4);
  scatterY[i] = gaussian(0, 1.4);
  scatterV[i] = Math.hypot(scatterX[i]!, scatterY[i]!);
}
const scatterColorBy: ScatterOptions["colorBy"] = { values: scatterV, colormap: "viridis" };

// --- Bar (grouped): two side-by-side series ---------------------------------
const BK = 8;
const barX = Float64Array.from({ length: BK }, (_, i) => i);
const barY1 = Float64Array.from({ length: BK }, () => 20 + rand() * 60);
const barY2 = Float64Array.from({ length: BK }, () => 20 + rand() * 60);

// --- Area: streaming-style bumpy envelope -----------------------------------
const AN = 300;
const areaX = Float64Array.from({ length: AN }, (_, i) => i);
const areaY = Float64Array.from(
  { length: AN },
  (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7,
);

// --- Heatmap: sin·cos field -------------------------------------------------
const HC = 60;
const HR = 40;
const heatValues = new Float64Array(HC * HR);
for (let r = 0; r < HR; r++) {
  for (let c = 0; c < HC; c++) {
    const xx = (c / HC) * 6;
    const yy = (r / HR) * 6;
    heatValues[r * HC + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
  }
}
const heatExtent: HeatmapOptions["extent"] = { x: [0, 6], y: [0, 6] };

// --- Box: Tukey groups with outliers ----------------------------------------
const boxGroups: BoxOptions["groups"] = [0, 1, 2, 3].map((g) => ({
  position: g,
  values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
  color: ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"][g],
}));

// --- Hexbin: 2D density of a two-blob cloud ---------------------------------
const HM = 25_000;
const hexX = new Float64Array(HM);
const hexY = new Float64Array(HM);
for (let i = 0; i < HM; i++) {
  const blob = i % 2 === 0 ? -1.4 : 1.4;
  hexX[i] = gaussian(blob, 1);
  hexY[i] = gaussian(blob * 0.6, 1.1);
}

// --- Contour: marching squares over a saddle --------------------------------
const CC = 80;
const CR = 60;
const contourValues = new Float64Array(CC * CR);
for (let r = 0; r < CR; r++) {
  for (let c = 0; c < CC; c++) {
    const xx = (c / CC) * 6 - 3;
    const yy = (r / CR) * 6 - 3;
    contourValues[r * CC + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
  }
}
const contourExtent: ContourOptions["extent"] = { x: [-3, 3], y: [-3, 3] };

// --- Error bars: whiskers + caps over a line --------------------------------
const EN = 12;
const errX = Float64Array.from({ length: EN }, (_, i) => i);
const errY = Float64Array.from({ length: EN }, (_, i) => Math.sin(i / 2) * 3 + 5);
const errYerr = Float64Array.from({ length: EN }, () => 0.4 + rand() * 0.9);

// --- Stem: a discrete damped-cosine signal ----------------------------------
const STN = 30;
const stemX = Float64Array.from({ length: STN }, (_, i) => i);
const stemY = Float64Array.from({ length: STN }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));

// --- Quiver: a rotational vector field --------------------------------------
const QG = 16;
const quiverX: number[] = [];
const quiverY: number[] = [];
const quiverU: number[] = [];
const quiverV: number[] = [];
for (let i = 0; i < QG; i++) {
  for (let j = 0; j < QG; j++) {
    const x = (i / (QG - 1)) * 4 - 2;
    const y = (j / (QG - 1)) * 4 - 2;
    quiverX.push(x);
    quiverY.push(y);
    quiverU.push(-y);
    quiverV.push(x);
  }
}
const quiverColorBy: QuiverOptions["colorBy"] = { colormap: "viridis" };

// --- Candlestick: OHLC random walk ------------------------------------------
const CK = 60;
const candleX = new Float64Array(CK);
const candleOpen = new Float64Array(CK);
const candleHigh = new Float64Array(CK);
const candleLow = new Float64Array(CK);
const candleClose = new Float64Array(CK);
let price = 100;
for (let i = 0; i < CK; i++) {
  const o = price;
  const c = o + gaussian(0, 2.2);
  candleX[i] = i;
  candleOpen[i] = o;
  candleClose[i] = c;
  candleHigh[i] = Math.max(o, c) + Math.abs(gaussian(0, 1.1));
  candleLow[i] = Math.min(o, c) - Math.abs(gaussian(0, 1.1));
  price = c;
}

// --- Dual-Y (YAxis): two lines on independent scales ------------------------
const DN = 300;
const dualX = Float64Array.from({ length: DN }, (_, i) => i);
const dualA = Float64Array.from({ length: DN }, (_, i) => Math.sin(i * 0.05) * 1.5);
const dualB = Float64Array.from({ length: DN }, (_, i) => 25 + Math.sin(i * 0.02) * 6);

// --- Polar: line rose + scatter blips ---------------------------------------
const PT = 240;
const polarTheta = Float64Array.from({ length: PT }, (_, i) => (i / (PT - 1)) * Math.PI * 2);
const polarR = polarTheta.map((t) => Math.abs(Math.cos(3 * t)));
const PB = 12;
const polarScatterTheta = Float64Array.from({ length: PB }, () => rand() * Math.PI * 2);
const polarScatterR = Float64Array.from({ length: PB }, () => 0.3 + rand() * 0.7);
const polarLabels = Array.from({ length: PB }, (_, i) => `p${i + 1}`);

// --- 3D surface: a radial ripple --------------------------------------------
const SC = 64;
const SR = 64;
const surfaceValues = new Float64Array(SC * SR);
for (let r = 0; r < SR; r++) {
  for (let c = 0; c < SC; c++) {
    const xx = (c / SC) * 8 - 4;
    const yy = (r / SR) * 8 - 4;
    const rr = Math.hypot(xx, yy) + 1e-6;
    surfaceValues[r * SC + c] = (Math.sin(rr * 2) / rr) * 3;
  }
}
const surfaceExtentX: [number, number] = [-4, 4];
const surfaceExtentZ: [number, number] = [-4, 4];
const surface3DOptions = { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true } as const;

// --- 3D point cloud: a colored helix ----------------------------------------
const PCN = 6000;
const cloudX = new Float64Array(PCN);
const cloudY = new Float64Array(PCN);
const cloudZ = new Float64Array(PCN);
for (let i = 0; i < PCN; i++) {
  const th = (i / PCN) * Math.PI * 20;
  const rr = 1 + (i / PCN) * 2;
  cloudX[i] = Math.cos(th) * rr + gaussian(0, 0.1);
  cloudZ[i] = Math.sin(th) * rr + gaussian(0, 0.1);
  cloudY[i] = (i / PCN) * 4 - 2 + gaussian(0, 0.05);
}
const cloud3DOptions = { axisLabels: { x: "x", y: "height", z: "z" } } as const;
const cloudColorBy = { values: cloudY, colormap: "plasma" as const };

// ---------------------------------------------------------------------------
// LIVE / streaming panels — buffers mutate in place each frame, then a fresh
// typed-array reference is published to the ref so the wrapper's data `watch`
// fires setData() under the hood.  Modest point counts, ~60fps via rAF.
// ---------------------------------------------------------------------------

// Oscilloscope — a single signal scrolling right-to-left.
const OSC_N = 400;
const oscX = Float64Array.from({ length: OSC_N }, (_, i) => i);
const oscBuf = Float64Array.from(
  { length: OSC_N },
  (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7,
);
const oscY = shallowRef<Float64Array>(oscBuf.slice());
let oscPhase = OSC_N;

// Drifting scatter cloud — a slowly diffusing random walk.
const DRIFT_M = 350;
const driftBufX = new Float64Array(DRIFT_M);
const driftBufY = new Float64Array(DRIFT_M);
for (let i = 0; i < DRIFT_M; i++) {
  driftBufX[i] = gaussian(0, 1);
  driftBufY[i] = gaussian(0, 1);
}
const driftX = shallowRef<Float64Array>(driftBufX.slice());
const driftY = shallowRef<Float64Array>(driftBufY.slice());

// Fluctuating bars — a handful of jittering categories.
const LIVE_BARS = 9;
const liveBarX = Float64Array.from({ length: LIVE_BARS }, (_, i) => i);
const liveBarBuf = Float64Array.from({ length: LIVE_BARS }, () => 40 + rand() * 30);
const liveBarY = shallowRef<Float64Array>(liveBarBuf.slice());

// Streaming area — a scrolling filled envelope.
const AREA_N = 300;
const streamX = Float64Array.from({ length: AREA_N }, (_, i) => i);
const streamBuf = Float64Array.from(
  { length: AREA_N },
  (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7,
);
const streamY = shallowRef<Float64Array>(streamBuf.slice());
let streamPhase = AREA_N;

let raf = 0;
function tick(): void {
  // Oscilloscope: scroll and append one sample.
  oscBuf.copyWithin(0, 1);
  oscPhase += 1;
  oscBuf[OSC_N - 1] =
    Math.sin(oscPhase * 0.08) * 1.6 +
    Math.sin(oscPhase * 0.021) * 0.7 +
    (Math.random() - 0.5) * 0.25;
  oscY.value = oscBuf.slice();

  // Scatter cloud: diffuse with a gentle pull back to the origin.
  for (let i = 0; i < DRIFT_M; i++) {
    driftBufX[i] += (Math.random() - 0.5) * 0.08 - driftBufX[i]! * 0.01;
    driftBufY[i] += (Math.random() - 0.5) * 0.08 - driftBufY[i]! * 0.01;
  }
  driftX.value = driftBufX.slice();
  driftY.value = driftBufY.slice();

  // Bars: bounded random fluctuation.
  for (let i = 0; i < LIVE_BARS; i++) {
    liveBarBuf[i] = Math.max(2, Math.min(98, liveBarBuf[i]! + (Math.random() - 0.5) * 8));
  }
  liveBarY.value = liveBarBuf.slice();

  // Area: scroll and append one sample.
  streamBuf.copyWithin(0, 1);
  streamPhase += 1;
  streamBuf[AREA_N - 1] =
    2 + Math.sin(streamPhase * 0.06) + Math.sin(streamPhase * 0.017) * 0.7 + Math.random() * 0.2;
  streamY.value = streamBuf.slice();

  raf = requestAnimationFrame(tick);
}
onMounted(() => {
  raf = requestAnimationFrame(tick);
});
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf);
});

// --- Polar plot options -----------------------------------------------------
const polarOptions = { theme: "dark", maxRadius: 1 } as const;

// --- Map: MapLibre demo vector tiles ----------------------------------------
const mapSource = computed(() =>
  xyzVectorSource({
    url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf",
    attribution: "© MapLibre",
    maxZoom: 5,
  }),
);
const mapOptions = { theme: "dark", equalAspect: true, boundedPan: true } as const;

// --- GeoJson: a small hand-built feature collection -------------------------
// The default style skips the "geojson" layer, so supply a style that paints
// the polygon fill + outline and the line stroke explicitly (otherwise nothing
// renders).
const geoStyle: MapStyle = {
  background: [0.055, 0.063, 0.125, 1],
  paint(_layer, type) {
    return type === "polygon"
      ? {
          kind: "fill",
          color: [0.12, 0.23, 0.54, 1],
          outline: [0.38, 0.65, 0.98, 1],
          outlineWidth: 1.5,
        }
      : { kind: "line", color: [0.96, 0.45, 0.71, 1], width: 2.5 };
  },
};
// The Natural Earth 10m world is embedded in @photonviz/map/world — no fetch.
const geo = worldCountries as GeoJsonOptions["geojson"];
</script>

<template>
  <div class="page">
    <header>
      <h1><b>Photon</b> — Vue gallery</h1>
      <p>Every chart type in <code>@photonviz/vue</code>, each as a Vue component with inline synthetic data.</p>
    </header>

    <h2 class="section">Live / streaming <span>— ~60fps via requestAnimationFrame</span></h2>
    <div class="grid">
      <section class="panel">
        <h2>Oscilloscope <span>— live · scrolling</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Line :x="oscX" :y="oscY" color="#34d399" :width="2" :decimate="false" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Scatter <span>— live · drifting cloud</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Scatter :x="driftX" :y="driftY" :size="5" color="#818cf8" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Bars <span>— live · fluctuating</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Bar :x="liveBarX" :y="liveBarY" :width="0.7" color="#22d3ee" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Area <span>— live · streaming</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Area :x="streamX" :y="streamY" color="rgba(52,211,153,0.45)" />
          </Plot>
        </div>
      </section>
    </div>

    <h2 class="section">Static gallery <span>— every chart type</span></h2>
    <div class="grid">
      <section class="panel">
        <h2>Line <span>— decaying sine</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Line :x="lineX" :y="lineY" color="#60a5fa" :width="2" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Step line <span>— step: after</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Line :x="stepX" :y="stepY" color="#fbbf24" :width="2.5" step="after" join="miter" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Scatter <span>— colorBy · viridis</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Scatter :x="scatterX" :y="scatterY" :size="6" :colorBy="scatterColorBy" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Bar <span>— grouped · 2 series</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Bar :x="barX" :y="barY1" :width="0.38" :offset="-0.2" color="#22d3ee" name="A" />
            <Bar :x="barX" :y="barY2" :width="0.38" :offset="0.2" color="#f472b6" name="B" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Area <span>— filled envelope</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Area :x="areaX" :y="areaY" color="rgba(52,211,153,0.45)" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Heatmap <span>— sin·cos · viridis</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Heatmap
              :values="heatValues"
              :cols="HC"
              :rows="HR"
              :extent="heatExtent"
              colormap="viridis"
            />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Box <span>— Tukey · outliers</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Box :groups="boxGroups" :width="0.6" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Hexbin <span>— 25k pts · density</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Hexbin :x="hexX" :y="hexY" :radius="0.22" colormap="plasma" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Contour <span>— 12 levels</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Contour
              :values="contourValues"
              :cols="CC"
              :rows="CR"
              :extent="contourExtent"
              :levels="12"
              colormap="viridis"
            />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Error bars <span>— whiskers + caps</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Line :x="errX" :y="errY" color="#60a5fa" :width="1.5" />
            <ErrorBar :x="errX" :y="errY" :yerr="errYerr" color="#60a5fa" :capSize="7" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Stem <span>— discrete signal</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Stem :x="stemX" :y="stemY" color="#34d399" :markerSize="6" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Quiver <span>— vector field</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Quiver :x="quiverX" :y="quiverY" :u="quiverU" :v="quiverV" :colorBy="quiverColorBy" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Candlestick <span>— OHLC walk</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <Candlestick
              :x="candleX"
              :open="candleOpen"
              :high="candleHigh"
              :low="candleLow"
              :close="candleClose"
            />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Dual Y (YAxis) <span>— two scales</span></h2>
        <div class="chart">
          <Plot :options="plotDark">
            <YAxis id="temp" side="right" color="#f472b6" title="temp" />
            <Line :x="dualX" :y="dualA" color="#60a5fa" :width="1.5" />
            <Line :x="dualX" :y="dualB" color="#f472b6" :width="1.5" yAxis="temp" />
          </Plot>
        </div>
      </section>

      <section class="panel">
        <h2>Polar <span>— line rose + scatter</span></h2>
        <div class="chart">
          <PolarPlot :options="polarOptions">
            <PolarLine :theta="polarTheta" :r="polarR" color="#a78bfa" :width="2" :closed="true" />
            <PolarScatter
              :theta="polarScatterTheta"
              :r="polarScatterR"
              color="#f472b6"
              :size="6"
              :labels="polarLabels"
            />
          </PolarPlot>
        </div>
      </section>

      <section class="panel">
        <h2>3D surface <span>— radial ripple</span></h2>
        <div class="chart">
          <Plot3D :options="surface3DOptions">
            <Surface
              :values="surfaceValues"
              :cols="SC"
              :rows="SR"
              :extentX="surfaceExtentX"
              :extentZ="surfaceExtentZ"
              colormap="viridis"
            />
          </Plot3D>
        </div>
      </section>

      <section class="panel">
        <h2>3D point cloud <span>— colored helix</span></h2>
        <div class="chart">
          <Plot3D :options="cloud3DOptions">
            <PointCloud
              :x="cloudX"
              :y="cloudY"
              :z="cloudZ"
              :size="4"
              :colorBy="cloudColorBy"
            />
          </Plot3D>
        </div>
      </section>

      <section class="panel">
        <h2>GeoJson <span>— world admin boundaries</span></h2>
        <div class="chart">
          <Plot :options="mapOptions">
            <GeoJson :geojson="geo" :style="geoStyle" />
          </Plot>
        </div>
      </section>

      <section class="panel wide">
        <h2>Map <span>— MapLibre demo vector tiles</span></h2>
        <div class="chart">
          <Plot :options="mapOptions">
            <Map :source="mapSource" />
          </Plot>
        </div>
      </section>
    </div>
  </div>
</template>

<style>
:root { color-scheme: dark; }
html, body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0b1020; color: #cbd5e1; }
.page { padding: 16px 20px 40px; }
header h1 { margin: 0; font-size: 18px; }
header h1 b { color: #60a5fa; }
header p { margin: 4px 0 16px; font-size: 13px; color: #94a3b8; }
header code { color: #7dd3fc; font-size: 12px; }
.section { margin: 22px 0 12px; font-size: 14px; font-weight: 700; color: #e2e8f0; }
.section span { color: #64748b; font-weight: 400; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.panel { border: 1px solid #1e293b; border-radius: 10px; background: #0e1526; overflow: hidden; }
.panel.wide { grid-column: 1 / -1; }
.panel h2 { margin: 0; padding: 8px 12px; font-size: 13px; font-weight: 600; color: #e2e8f0; border-bottom: 1px solid #1e293b; }
.panel h2 span { color: #64748b; font-weight: 400; }
.chart { height: 260px; }
</style>
