import {
  addAttentionMap,
  addCalibration,
  addConfusionMatrix,
  addDecisionBoundary,
  addEmbedding,
  addFeatureImportance,
  addPartialDependence,
  addPrCurve,
  addRidgeline,
  addRocCurve,
  addShapBeeswarm,
  addTrainingCurves,
  Annotation,
  Area,
  Bar,
  Bar3D,
  Bollinger,
  Box,
  Candlestick,
  Contour,
  Contour3D,
  Depth,
  ErrorBar,
  firstFinite,
  Graph,
  Heatmap,
  HeikinAshi,
  Hexbin,
  Image,
  Isosurface,
  Line,
  Line3D,
  macd,
  Ohlc,
  Patches,
  pca,
  Pie,
  Plot,
  Plot3D,
  PointCloud,
  PolarLine,
  PolarPlot,
  PolarScatter,
  Quiver,
  Quiver3D,
  Renko,
  rsi,
  Scatter,
  Stem,
  Surface,
  Volume,
  VolumeProfile,
  YAxis,
} from "@photonviz/solid";
import {
  linkX,
  type Plot as CorePlot,
  type Plot3D as CorePlot3D,
  type PolarPlot as CorePolarPlot,
} from "@photonviz/core";
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";

// ============================================================================
// Helpers
// ============================================================================

/** Seeded RNG so every reload draws the same synthetic data. */
function makeRng(seed = 42) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const gaussian = (m: number, sd: number) =>
    m + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * (rand() || 1e-9));
  return { rand, gaussian };
}

const jitter = () => Math.random() - 0.5;

/** Business-day epoch-ms timestamps (skip Sat/Sun) — for the ordinal-time axis. */
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

// ============================================================================
// FPS badge — its own rAF loop, absolute top-left. Dynamic panels only.
// ============================================================================
function FpsBadge(): JSX.Element {
  const [fps, setFps] = createSignal(0);
  let raf = 0;
  let last = 0;
  let avg = 0;
  let paint = 0;
  let stopped = false;
  const loop = (now: number) => {
    if (stopped) return; // panel unmounted — bail before rescheduling.
    if (last > 0) {
      const dt = now - last;
      if (dt > 0) {
        const inst = 1000 / dt;
        avg = avg > 0 ? avg * 0.9 + inst * 0.1 : inst;
      }
    }
    last = now;
    if (now - paint > 250) {
      paint = now;
      setFps(Math.round(avg));
    }
    raf = requestAnimationFrame(loop);
  };
  onMount(() => {
    if (!stopped) raf = requestAnimationFrame(loop);
  });
  onCleanup(() => {
    stopped = true;
    cancelAnimationFrame(raf);
  });
  return <div class="fps">{fps() || "—"} fps</div>;
}

/** Panel: title bar + fixed-height chart area. `fps` adds an FPS badge (top-left).
 * A per-chart fullscreen toggle sits top-right (Photon resizes via ResizeObserver). */
function Panel(props: { title: string; subtitle?: string; fps?: boolean; children: JSX.Element }): JSX.Element {
  let root!: HTMLDivElement;
  const toggleFullscreen = () => {
    if (document.fullscreenElement === root) document.exitFullscreen();
    else root.requestFullscreen().catch(() => { /* ignore */ });
  };
  return (
    <div class="panel" ref={root}>
      <h2>
        {props.title}
        {props.subtitle ? <span> — {props.subtitle}</span> : null}
      </h2>
      <button class="fs-btn" type="button" title="Fullscreen" aria-label="Toggle fullscreen" onClick={toggleFullscreen}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div class="chart">
        {props.fps ? <FpsBadge /> : null}
        {props.children}
      </div>
    </div>
  );
}

const DARK = { theme: "dark" } as const;

// ============================================================================
// STATIC TAB — declarative Solid wrapper components, renderType="static".
// One `<Plot>`/`<Plot3D>`/`<PolarPlot>` per chart type; layers as children.
// ============================================================================
function StaticGrid(): JSX.Element {
  const { rand, gaussian } = makeRng(42);

  // Line — sine sum.
  const lnN = 600;
  const lnX = Float64Array.from({ length: lnN }, (_, i) => i);
  const lnY = Float64Array.from({ length: lnN }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);

  // Signals — 3 channels.
  const sgN = 500;
  const sgX = Float64Array.from({ length: sgN }, (_, i) => i);
  const sgY = [0, 1, 2].map((k) =>
    Float64Array.from({ length: sgN }, (_, j) => Math.sin(j * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + k * 0.1),
  );

  // Scatter — gaussian cloud.
  const scM = 700;
  const scX = new Float64Array(scM);
  const scY = new Float64Array(scM);
  for (let i = 0; i < scM; i++) {
    scX[i] = gaussian(0, 1);
    scY[i] = gaussian(0, 1);
  }

  // Scatter colorBy.
  const cbM = 1200;
  const cbX = new Float64Array(cbM);
  const cbY = new Float64Array(cbM);
  const cbV = new Float64Array(cbM);
  for (let i = 0; i < cbM; i++) {
    cbX[i] = gaussian(0, 1.4);
    cbY[i] = gaussian(0, 1.4);
    cbV[i] = Math.hypot(cbX[i], cbY[i]);
  }

  // Markers.
  const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
  const mkColors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
  const mkX = Float64Array.from({ length: 12 }, (_, i) => i);

  // Bars.
  const barK = 9;
  const barX = Float64Array.from({ length: barK }, (_, i) => i);
  const barY = Float64Array.from({ length: barK }, () => 40 + rand() * 30);

  // Grouped bars.
  const qCats = ["Q1", "Q2", "Q3", "Q4"];
  const qIdx = Float64Array.from(qCats, (_, i) => i);
  const grpColors = ["#38bdf8", "#f472b6", "#a3e635"];
  const grpNames = ["north", "south", "west"];
  const grpSeries = [0, 1, 2].map(() => Float64Array.from(qCats, () => 20 + rand() * 70));

  // Stacked bars (cumulative base/top per series).
  const stkCats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const stkIdx = Float64Array.from(stkCats, (_, i) => i);
  const stkColors = ["#22d3ee", "#818cf8", "#fbbf24"];
  const stkNames = ["email", "social", "direct"];
  const stkRaw = [10, 8, 6].map((m) => Float64Array.from(stkCats, () => m + rand() * m));
  const stkBands = (() => {
    const cum = new Float64Array(stkCats.length);
    return stkRaw.map((y) => {
      const base = Float64Array.from(cum);
      const top = new Float64Array(stkCats.length);
      for (let i = 0; i < y.length; i++) {
        top[i] = cum[i] + y[i];
        cum[i] = top[i];
      }
      return { base, top };
    });
  })();

  // Horizontal bars.
  const hbCats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
  const hbIdx = Float64Array.from(hbCats, (_, i) => i);
  const hbVals = Float64Array.from(hbCats, (_, i) => 30 + i * 12 + rand() * 10);

  // Area.
  const arN = 400;
  const arX = Float64Array.from({ length: arN }, (_, i) => i);
  const arY = Float64Array.from({ length: arN }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);

  // Stacked area (cumulative bands).
  const saN = 120;
  const saX = Float64Array.from({ length: saN }, (_, i) => i);
  const saAmp = [3, 2.5, 2];
  const saFr = [0.05, 0.06, 0.04];
  const saColors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
  const saBands = (() => {
    const cum = new Float64Array(saN);
    return saAmp.map((a, s) => {
      const base = Float64Array.from(cum);
      const top = new Float64Array(saN);
      for (let i = 0; i < saN; i++) {
        const yv = a + Math.sin(i * saFr[s] + s) * a * 0.4 + a * 0.3;
        top[i] = cum[i] + yv;
        cum[i] = top[i];
      }
      return { base, top };
    });
  })();

  // Step line.
  const stpN = 24;
  const stpX = Float64Array.from({ length: stpN }, (_, i) => i);
  const stpY = Float64Array.from({ length: stpN }, () => Math.round(rand() * 3));

  // Histogram.
  const histBins = 30;
  const histLo = -4;
  const histHi = 4;
  const histBw = (histHi - histLo) / histBins;
  const histCenters = Float64Array.from({ length: histBins }, (_, i) => histLo + (i + 0.5) * histBw);
  const histCounts = new Float64Array(histBins);
  for (let i = 0; i < 5000; i++) {
    const b = Math.floor((gaussian(0, 1) - histLo) / histBw);
    if (b >= 0 && b < histBins) histCounts[b]++;
  }

  // Box plot.
  const boxColors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
  const boxGroups = [0, 1, 2, 3].map((g) => ({
    position: g,
    values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
    color: boxColors[g],
  }));

  // Heatmap.
  const hmCols = 60;
  const hmRows = 40;
  const hmVals = new Float64Array(hmCols * hmRows);
  for (let r = 0; r < hmRows; r++)
    for (let c = 0; c < hmCols; c++) {
      const xx = (c / hmCols) * 6;
      const yy = (r / hmRows) * 6;
      hmVals[r * hmCols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
    }

  // Contour.
  const ctCols = 80;
  const ctRows = 60;
  const ctVals = new Float64Array(ctCols * ctRows);
  for (let r = 0; r < ctRows; r++)
    for (let c = 0; c < ctCols; c++) {
      const xx = (c / ctCols) * 6 - 3;
      const yy = (r / ctRows) * 6 - 3;
      ctVals[r * ctCols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
    }

  // Hexbin.
  const hxM = 25_000;
  const hxX = new Float64Array(hxM);
  const hxY = new Float64Array(hxM);
  for (let i = 0; i < hxM; i++) {
    const blob = i % 2 === 0 ? -1.4 : 1.4;
    hxX[i] = gaussian(blob, 1);
    hxY[i] = gaussian(blob * 0.6, 1.1);
  }

  // Error bars.
  const ebN = 12;
  const ebX = Float64Array.from({ length: ebN }, (_, i) => i);
  const ebY = Float64Array.from({ length: ebN }, (_, i) => Math.sin(i / 2) * 3 + 5);
  const ebErr = Float64Array.from({ length: ebN }, () => 0.4 + rand() * 0.9);

  // Error band.
  const bdN = 120;
  const bdX = Float64Array.from({ length: bdN }, (_, i) => i / 10);
  const bdY = Float64Array.from(bdX, (t) => Math.sin(t));
  const bdErr = Float64Array.from(bdX, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));

  // Stem.
  const stN = 30;
  const stX = Float64Array.from({ length: stN }, (_, i) => i);
  const stY = Float64Array.from({ length: stN }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));

  // Quiver.
  const qG = 16;
  const qvX: number[] = [];
  const qvY: number[] = [];
  for (let i = 0; i < qG; i++)
    for (let j = 0; j < qG; j++) {
      qvX.push((i / (qG - 1)) * 4 - 2);
      qvY.push((j / (qG - 1)) * 4 - 2);
    }
  const qvU = new Float64Array(qvX.length);
  const qvV = new Float64Array(qvX.length);
  for (let k = 0; k < qvX.length; k++) {
    qvU[k] = -qvY[k];
    qvV[k] = qvX[k];
  }

  // Candlestick / OHLC / ordinal — one shared OHLC walk.
  function ohlcWalk(n: number) {
    const o = new Float64Array(n);
    const h = new Float64Array(n);
    const l = new Float64Array(n);
    const c = new Float64Array(n);
    let price = 100;
    for (let i = 0; i < n; i++) {
      const open = price;
      const close = open + gaussian(0, 2.2);
      o[i] = open;
      c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
      price = close;
    }
    return { o, h, l, c };
  }
  const csN = 40;
  const csStart = Date.UTC(2024, 0, 1);
  const csStep = 86_400_000;
  const csX = Float64Array.from({ length: csN }, (_, i) => csStart + i * csStep);
  const csW = ohlcWalk(csN);
  const olW = ohlcWalk(csN);

  const otN = 60;
  const otTimes = businessDays(otN, Date.UTC(2024, 0, 1));
  const otIdx = Float64Array.from({ length: otN }, (_, i) => i);
  const otW = ohlcWalk(otN);

  // Patches.
  const pcCols = 6;
  const pcRows = 4;
  const patchList: { x: number[]; y: number[]; value: number }[] = [];
  for (let r = 0; r < pcRows; r++)
    for (let c = 0; c < pcCols; c++) {
      const j = () => (rand() - 0.5) * 0.22;
      patchList.push({
        x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
        y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
        value: Math.sin(c * 0.7) + Math.cos(r * 0.9) + rand() * 0.4,
      });
    }

  // Annotations demo line.
  const anN = 100;
  const anX = Float64Array.from({ length: anN }, (_, i) => i);
  const anY = Float64Array.from({ length: anN }, (_, i) => Math.sin(i * 0.15) * 3 + 5);

  // Image.
  const iw = 96;
  const ih = 96;
  const imgData = new ImageData(iw, ih);
  for (let yy = 0; yy < ih; yy++)
    for (let xx = 0; xx < iw; xx++) {
      const i = (yy * iw + xx) * 4;
      const d = Math.hypot(xx - iw / 2, yy - ih / 2) / (iw / 2);
      imgData.data[i] = Math.round((xx / iw) * 255);
      imgData.data[i + 1] = Math.round((yy / ih) * 255);
      imgData.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
      imgData.data[i + 3] = 255;
    }

  // Graph.
  const gEdges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
    [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
  ];
  const gNodes = 10;
  const gx = new Float64Array(gNodes);
  const gy = new Float64Array(gNodes);
  for (let i = 0; i < gNodes; i++) {
    gx[i] = Math.cos((i / gNodes) * Math.PI * 2);
    gy[i] = Math.sin((i / gNodes) * Math.PI * 2);
  }

  // Log axis.
  const lgN = 200;
  const lgX = Float64Array.from({ length: lgN }, (_, i) => (i / lgN) * 10);
  const lgTaus = [1.2, 2.5, 5];
  const lgColors = ["#f472b6", "#60a5fa", "#34d399"];
  const lgY = lgTaus.map((tau) => Float64Array.from(lgX, (t) => Math.exp(-t / tau) + 1e-3));

  // Time axis.
  const taStart = Date.UTC(2024, 0, 1);
  const taN = 24 * 60;
  const taX = new Float64Array(taN);
  const taY = new Float64Array(taN);
  for (let i = 0; i < taN; i++) {
    taX[i] = taStart + i * 60_000;
    const h = i / 60;
    taY[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
  }

  // Dual Y.
  const dyN = 400;
  const dyX = Float64Array.from({ length: dyN }, (_, i) => i);
  const dyA = Float64Array.from({ length: dyN }, (_, i) => Math.sin(i * 0.05) * 1.5);
  const dyB = Float64Array.from({ length: dyN }, (_, i) => 25 + Math.sin(i * 0.02) * 6);

  // Styled + categorical.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const mIdx = Float64Array.from(months, (_, i) => i);
  const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
  const target = Float64Array.from(months, () => 70 + rand() * 12);

  // Polar rose + radar.
  const roT = 240;
  const roTheta = Float64Array.from({ length: roT }, (_, i) => (i / (roT - 1)) * Math.PI * 2);
  const roR = Float64Array.from(roTheta, (th) => Math.abs(Math.cos(3 * th)));
  const raB = 14;
  const raTheta = Float64Array.from({ length: raB }, () => rand() * 360);
  const raR = Float64Array.from({ length: raB }, () => 0.2 + rand() * 0.75);

  // 3D sinc surface + wireframe.
  const sfCols = 64;
  const sfRows = 64;
  const sfVals = new Float64Array(sfCols * sfRows);
  for (let r = 0; r < sfRows; r++)
    for (let c = 0; c < sfCols; c++) {
      const xx = (c / sfCols) * 8 - 4;
      const yy = (r / sfRows) * 8 - 4;
      const rr = Math.hypot(xx, yy) + 1e-6;
      sfVals[r * sfCols + c] = (Math.sin(rr * 2) / rr) * 3;
    }

  // 3D bars.
  const b3gx = 8;
  const b3gz = 8;
  const b3x: number[] = [];
  const b3z: number[] = [];
  for (let i = 0; i < b3gx; i++) for (let j = 0; j < b3gz; j++) { b3x.push(i); b3z.push(j); }
  const b3y = Float64Array.from(b3x, (_, k) => 1.5 + Math.sin(b3x[k] * 0.6) * Math.cos(b3z[k] * 0.6) * 1.5);

  // 3D lines.
  const l3N = 400;
  const mkHelix = (phase: number) => {
    const x = new Float64Array(l3N);
    const y = new Float64Array(l3N);
    const z = new Float64Array(l3N);
    for (let i = 0; i < l3N; i++) {
      const tt = (i / (l3N - 1)) * Math.PI * 2 * 4;
      x[i] = Math.cos(tt + phase);
      z[i] = Math.sin(tt + phase);
      y[i] = (i / (l3N - 1)) * 4 - 2;
    }
    return { x, y, z };
  };
  const helA = mkHelix(0);
  const helB = mkHelix(Math.PI);

  // 3D quiver.
  const q3g = 6;
  const q3x: number[] = [];
  const q3y: number[] = [];
  const q3z: number[] = [];
  for (let i = 0; i < q3g; i++)
    for (let j = 0; j < q3g; j++)
      for (let k = 0; k < q3g; k++) {
        q3x.push((i / (q3g - 1)) * 2 - 1);
        q3y.push((j / (q3g - 1)) * 2 - 1);
        q3z.push((k / (q3g - 1)) * 2 - 1);
      }
  const q3u = Float64Array.from(q3x, (_, k) => -q3y[k]);
  const q3v = Float64Array.from(q3x, (_, k) => q3x[k]);
  const q3w = new Float64Array(q3x.length);

  // 3D contour.
  const c3Cols = 50;
  const c3Rows = 50;
  const c3Vals = new Float64Array(c3Cols * c3Rows);
  for (let r = 0; r < c3Rows; r++)
    for (let c = 0; c < c3Cols; c++) {
      const xx = (c / c3Cols) * 8 - 4;
      const yy = (r / c3Rows) * 8 - 4;
      const rr = Math.hypot(xx, yy) + 1e-6;
      c3Vals[r * c3Cols + c] = (Math.sin(rr * 1.5) / rr) * 3;
    }

  // 3D isosurface + volume (metaballs).
  const metaballs = (n: number, blobs: number[][]) => {
    const vol = new Float64Array(n * n * n);
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const px = (x / (n - 1)) * 2 - 1;
          const py = (y / (n - 1)) * 2 - 1;
          const pz = (z / (n - 1)) * 2 - 1;
          let s = 0;
          for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 6);
          vol[x + y * n + z * n * n] = s;
        }
    return vol;
  };
  const isoN = 40;
  const isoVol = metaballs(isoN, [[-0.5, 0, 0], [0.6, 0.3, -0.2], [0.1, -0.5, 0.4]]);
  const volN = 48;
  const volVol = metaballs(volN, [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]]);

  // 3D scatter + point cloud.
  const s3N = 300;
  const s3x = new Float64Array(s3N);
  const s3y = new Float64Array(s3N);
  const s3z = new Float64Array(s3N);
  const s3sizes = new Float64Array(s3N);
  const s3vals = new Float64Array(s3N);
  const s3labels: string[] = [];
  for (let i = 0; i < s3N; i++) {
    s3x[i] = gaussian(0, 1);
    s3y[i] = gaussian(0, 1);
    s3z[i] = gaussian(0, 1);
    const r = Math.hypot(s3x[i], s3y[i], s3z[i]);
    s3sizes[i] = 3 + r * 6;
    s3vals[i] = r;
    s3labels.push(`p${i} · r=${r.toFixed(2)}`);
  }
  const pcN = 6000;
  const pcx = new Float64Array(pcN);
  const pcy = new Float64Array(pcN);
  const pcz = new Float64Array(pcN);
  for (let i = 0; i < pcN; i++) {
    const th = (i / pcN) * Math.PI * 20;
    const rr = 1 + (i / pcN) * 2;
    pcx[i] = Math.cos(th) * rr;
    pcz[i] = Math.sin(th) * rr;
    pcy[i] = (i / pcN) * 4 - 2;
  }

  return (
    <>
      <Panel title="Line" subtitle="sine sum">
        <Plot options={{ ...DARK, scales: { x: { domain: [0, lnN - 1] }, y: { domain: [-2.6, 2.6] } } }}>
          <Line x={lnX} y={lnY} color="#34d399" width={2} decimate={false} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Signals" subtitle="3 channels">
        <Plot options={{ ...DARK, scales: { x: { domain: [0, sgN - 1] }, y: { domain: [-3.5, 3.5] } } }}>
          <Line x={sgX} y={sgY[0]} color="#60a5fa" width={1.5} decimate={false} renderType="static" />
          <Line x={sgX} y={sgY[1]} color="#f472b6" width={1.5} decimate={false} renderType="static" />
          <Line x={sgX} y={sgY[2]} color="#fbbf24" width={1.5} decimate={false} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Scatter" subtitle="gaussian cloud">
        <Plot options={{ ...DARK, scales: { x: { domain: [-4, 4] }, y: { domain: [-4, 4] } } }}>
          <Scatter x={scX} y={scY} size={5} color="#818cf8" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Scatter markers" subtitle="6 glyph shapes">
        <Plot options={{ ...DARK, showToolbar: false, scales: { x: { domain: [-1, 12] }, y: { domain: [-1, 6] } } }}>
          {shapes.map((mk, r) => (
            <Scatter
              x={mkX}
              y={Float64Array.from({ length: 12 }, () => shapes.length - 1 - r)}
              size={14}
              marker={mk}
              color={mkColors[r]}
              name={mk}
              renderType="static"
            />
          ))}
        </Plot>
      </Panel>

      <Panel title="Scatter · colorBy" subtitle="value → viridis">
        <Plot options={{ ...DARK, scales: { x: { domain: [-5, 5] }, y: { domain: [-5, 5] } } }}>
          <Scatter x={cbX} y={cbY} size={6} colorBy={{ values: cbV, colormap: "viridis" }} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Bars" subtitle="categorical">
        <Plot options={{ ...DARK, scales: { x: { domain: [-0.6, barK - 0.4] }, y: { domain: [0, 100] } } }}>
          <Bar x={barX} y={barY} width={0.7} color="#22d3ee" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Grouped bars" subtitle="categorical · 3 series">
        <Plot
          options={{
            ...DARK,
            legend: { position: "top-left" },
            scales: { x: { type: "categorical", factors: qCats }, y: { domain: [0, 100] } },
            showToolbar: false,
          }}
        >
          {grpSeries.map((y, i) => (
            <Bar x={qIdx} y={y} width={0.24} offset={(i - 1) * 0.26} color={grpColors[i]} name={grpNames[i]} renderType="static" />
          ))}
        </Plot>
      </Panel>

      <Panel title="Stacked bars" subtitle="categorical · cumulative">
        <Plot
          options={{ ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: stkCats } }, showToolbar: false }}
        >
          {stkBands.map((band, i) => (
            <Bar x={stkIdx} y={band.top} base={band.base} width={0.6} color={stkColors[i]} name={stkNames[i]} renderType="static" />
          ))}
        </Plot>
      </Panel>

      <Panel title="Horizontal bars" subtitle="hbar · categorical y">
        <Plot options={{ ...DARK, scales: { y: { type: "categorical", factors: hbCats }, x: { domain: [0, 100] } }, showToolbar: false }}>
          <Bar x={hbIdx} y={hbVals} width={0.6} orientation="h" color="#34d399" name="score" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Area" subtitle="filled">
        <Plot options={{ ...DARK, scales: { x: { domain: [0, arN - 1] }, y: { domain: [0, 4] } } }}>
          <Area x={arX} y={arY} color="rgba(52,211,153,0.45)" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Stacked area" subtitle="cumulative bands">
        <Plot options={{ ...DARK, showToolbar: false, scales: { x: { domain: [0, saN - 1] }, y: { domain: [0, 14] } } }}>
          {saBands.map((band, i) => (
            <Area x={saX} y={band.top} base={band.base} color={saColors[i]} name={"abc"[i]} renderType="static" />
          ))}
        </Plot>
      </Panel>

      <Panel title="Step line" subtitle="staircase · step:after">
        <Plot options={{ ...DARK, scales: { x: { domain: [0, stpN - 1] }, y: { domain: [-0.5, 3.5] } } }}>
          <Line x={stpX} y={stpY} color="#fbbf24" width={2.5} step="after" join="miter" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Histogram" subtitle="gaussian · 30 bins">
        <Plot options={DARK}>
          <Bar x={histCenters} y={histCounts} width={histBw * 0.98} color="#34d399" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Box plot" subtitle="Tukey · outliers">
        <Plot options={{ ...DARK, scales: { x: { domain: [-0.6, 3.6] }, y: { domain: [-4, 8] } } }}>
          <Box groups={boxGroups} width={0.6} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Heatmap" subtitle="texture · viridis">
        <Plot options={DARK}>
          <Heatmap values={hmVals} cols={hmCols} rows={hmRows} extent={{ x: [0, 6], y: [0, 6] }} colormap="viridis" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Contour" subtitle="marching squares">
        <Plot options={DARK}>
          <Contour values={ctVals} cols={ctCols} rows={ctRows} extent={{ x: [-3, 3], y: [-3, 3] }} levels={12} colormap="viridis" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Hexbin" subtitle="25k points · density">
        <Plot options={{ ...DARK, scales: { x: { domain: [-5, 5] }, y: { domain: [-5, 5] } } }}>
          <Hexbin x={hxX} y={hxY} radius={0.22} colormap="plasma" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Error bars" subtitle="whiskers + caps">
        <Plot options={{ ...DARK, scales: { x: { domain: [-1, ebN] }, y: { domain: [0, 10] } } }}>
          <Line x={ebX} y={ebY} color="#60a5fa" width={1.5} renderType="static" />
          <ErrorBar x={ebX} y={ebY} yerr={ebErr} color="#60a5fa" capSize={7} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Error band" subtitle="confidence ribbon">
        <Plot options={{ ...DARK, scales: { x: { domain: [0, 12] }, y: { domain: [-1.5, 1.5] } } }}>
          <ErrorBar x={bdX} y={bdY} yerr={bdErr} color="#a78bfa" band whiskers={false} bandOpacity={0.28} renderType="static" />
          <Line x={bdX} y={bdY} color="#a78bfa" width={2} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Stem plot" subtitle="discrete signal">
        <Plot options={{ ...DARK, scales: { x: { domain: [-1, stN] }, y: { domain: [-1, 1.1] } } }}>
          <Stem x={stX} y={stY} color="#34d399" markerSize={6} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Quiver" subtitle="vector field">
        <Plot options={{ ...DARK, scales: { x: { domain: [-2.4, 2.4] }, y: { domain: [-2.4, 2.4] } } }}>
          <Quiver x={qvX} y={qvY} u={qvU} v={qvV} colorBy={{ colormap: "viridis" }} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Candlestick" subtitle="OHLC · daily">
        <Plot options={{ ...DARK, scales: { x: { type: "time" } } }}>
          <Candlestick x={csX} open={csW.o} high={csW.h} low={csW.l} close={csW.c} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="OHLC" subtitle="bars · daily">
        <Plot options={{ ...DARK, scales: { x: { type: "time" } } }}>
          <Ohlc x={csX} open={olW.o} high={olW.h} low={olW.l} close={olW.c} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Ordinal-time axis" subtitle="sessions · weekend gaps collapse">
        <Plot options={{ ...DARK, scales: { x: { type: "ordinal-time", times: otTimes } } }}>
          <Candlestick x={otIdx} open={otW.o} high={otW.h} low={otW.l} close={otW.c} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Pie" subtitle="market share">
        <Plot
          options={{ ...DARK, equalAspect: true, showToolbar: false, hover: false, scales: { x: { domain: [-1.25, 1.25] }, y: { domain: [-1.25, 1.25] } }, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } }}
        >
          <Pie values={[35, 25, 20, 12, 8]} colormap="viridis" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Donut" subtitle="categories">
        <Plot
          options={{ ...DARK, equalAspect: true, showToolbar: false, hover: false, scales: { x: { domain: [-1.25, 1.25] }, y: { domain: [-1.25, 1.25] } }, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } }}
        >
          <Pie values={[8, 6, 5, 4, 3, 2]} innerRadius={0.55} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Patches" subtitle="polygons · choropleth">
        <Plot options={{ ...DARK, showToolbar: false, scales: { x: { domain: [-0.3, pcCols + 0.3] }, y: { domain: [-0.3, pcRows + 0.3] } } }}>
          <Patches patches={patchList} colormap="plasma" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Annotations" subtitle="span · band · box · label">
        <Plot options={{ ...DARK, showToolbar: false, scales: { x: { domain: [0, anN - 1] }, y: { domain: [0, 10] } } }}>
          <Line x={anX} y={anY} color="#38bdf8" width={2} renderType="static" />
          <Annotation type="band" dim="y" from={6} to={8} color="rgba(52,211,153,0.15)" />
          <Annotation type="span" dim="y" value={5} color="#f59e0b" dash={[5, 4]} />
          <Annotation type="span" dim="x" value={50} color="#f472b6" dash={[5, 4]} />
          <Annotation type="box" x={[20, 35]} y={[2, 4]} border="#a78bfa" />
          <Annotation type="label" x={52} y={9} text="event" color="#f472b6" />
        </Plot>
      </Panel>

      <Panel title="Image" subtitle="RGBA glyph · textured quad">
        <Plot options={{ ...DARK, showToolbar: false, scales: { x: { domain: [-0.5, 10.5] }, y: { domain: [-0.5, 10.5] } } }}>
          <Image source={imgData} extent={{ x: [0, 10], y: [0, 10] }} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Graph" subtitle="nodes + edges">
        <Plot options={{ ...DARK, showToolbar: false, equalAspect: true, scales: { x: { domain: [-1.5, 1.5] }, y: { domain: [-1.5, 1.5] } } }}>
          <Graph x={gx} y={gy} edges={gEdges} nodeColor="#38bdf8" edgeColor="rgba(148,163,184,0.4)" nodeSize={13} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Log axis" subtitle="exp decay · log y">
        <Plot options={{ ...DARK, scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } }}>
          {lgY.map((y, k) => (
            <Line x={lgX} y={y} color={lgColors[k]} width={1.5} name={`τ=${lgTaus[k]}`} renderType="static" />
          ))}
        </Plot>
      </Panel>

      <Panel title="Time axis" subtitle="1 day · date ticks">
        <Plot options={{ ...DARK, scales: { x: { type: "time" } } }}>
          <Line x={taX} y={taY} color="#22d3ee" width={1.5} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Dual Y" subtitle="two scales">
        <Plot options={{ ...DARK, axes: { y: { title: "amp" } }, scales: { x: { domain: [0, dyN - 1] }, y: { domain: [-2, 2] } } }}>
          <YAxis id="t" side="right" color="#f472b6" title="temp" domain={[15, 35]} />
          <Line x={dyX} y={dyA} color="#60a5fa" width={1.5} decimate={false} renderType="static" />
          <Line x={dyX} y={dyB} color="#f472b6" width={1.5} yAxis="t" decimate={false} renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Styled + categorical" subtitle="bg · title · legend · rotated">
        <Plot
          options={{
            ...DARK,
            background: "#0b1220",
            title: { text: "Quarterly revenue", align: "left" },
            legend: { position: "top-left" },
            scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
            axes: { x: { labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" }, y: { gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] } },
            showToolbar: false,
          }}
        >
          <Bar x={mIdx} y={revenue} width={0.6} color="#38bdf8" name="revenue" renderType="static" />
          <Line x={mIdx} y={target} color="#f59e0b" width={2.5} name="target" renderType="static" />
        </Plot>
      </Panel>

      <Panel title="Polar radar" subtitle="sweep + blips">
        <PolarPlot options={{ ...DARK, angleUnit: "deg", maxRadius: 1 }}>
          <PolarLine theta={[0, 45]} r={[0, 1]} color="#22d3ee" width={2} />
          <PolarScatter theta={raTheta} r={raR} color="#f472b6" size={6} />
        </PolarPlot>
      </Panel>

      <Panel title="Polar rose" subtitle="cos(3θ) curve">
        <PolarPlot options={{ ...DARK, maxRadius: 1 }}>
          <PolarLine theta={roTheta} r={roR} color="#a78bfa" width={2} closed />
        </PolarPlot>
      </Panel>

      <Panel title="3D surface" subtitle="sinc · colorbar · light">
        <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" }}>
          <Surface values={sfVals} cols={sfCols} rows={sfRows} extentX={[-4, 4]} extentZ={[-4, 4]} colormap="viridis" name="height" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D bars" subtitle="colormapped · lit">
        <Plot3D options={{ axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" }}>
          <Bar3D x={b3x} z={b3z} y={b3y} colorBy={{ colormap: "plasma" }} name="value" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D lines" subtitle="paths · legend">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, legend: true }}>
          <Line3D x={helA.x} y={helA.y} z={helA.z} color="#38bdf8" name="α" />
          <Line3D x={helB.x} y={helB.y} z={helB.z} color="#f472b6" name="β" />
        </Plot3D>
      </Panel>

      <Panel title="3D wireframe" subtitle="lines · hover · reset">
        <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" }}>
          <Surface values={sfVals} cols={sfCols} rows={sfRows} extentX={[-4, 4]} extentZ={[-4, 4]} colormap="plasma" wireframe name="height" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D quiver" subtitle="vector field · colorbar">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" } }}>
          <Quiver3D x={q3x} y={q3y} z={q3z} u={q3u} v={q3v} w={q3w} scale={0.4} colorBy={{ colormap: "viridis" }} name="speed" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D contour" subtitle="iso-height rings">
        <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" }}>
          <Contour3D values={c3Vals} cols={c3Cols} rows={c3Rows} extentX={[-4, 4]} extentZ={[-4, 4]} levels={14} colormap="viridis" name="height" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D isosurface" subtitle="marching cubes · metaballs">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" }}>
          <Isosurface values={isoVol} dims={[isoN, isoN, isoN]} isoLevel={0.5} extent={{ x: [-1, 1], y: [-1, 1], z: [-1, 1] }} color="#38bdf8" name="blob" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D scatter" subtitle="per-point size · labels">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" } }}>
          <PointCloud x={s3x} y={s3y} z={s3z} sizes={s3sizes} labels={s3labels} colorBy={{ values: s3vals, colormap: "plasma" }} name="r" />
        </Plot3D>
      </Panel>

      <Panel title="3D volume" subtitle="raymarch · auto-rotate">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume" }}>
          <Volume values={volVol} dims={[volN, volN, volN]} extent={{ x: [-1, 1], y: [-1, 1], z: [-1, 1] }} colormap="plasma" density={1.3} name="density" renderType="static" />
        </Plot3D>
      </Panel>

      <Panel title="3D point cloud" subtitle="colored by height">
        <Plot3D options={{ axisLabels: { x: "x", y: "height", z: "z" } }}>
          <PointCloud x={pcx} y={pcy} z={pcz} size={4} colorBy={{ values: pcy, colormap: "plasma" }} />
        </Plot3D>
      </Panel>
    </>
  );
}

// ============================================================================
// DYNAMIC TAB — same catalog, animated. Each panel captures its core Plot via
// `onReady`, builds a renderType:"dynamic" layer, and streams via a rAF loop
// (setData / updateLast). Each panel shows an FPS badge.
// ============================================================================

/**
 * A rAF loop that is guaranteed never to run against a destroyed plot.
 *
 * Solid cleans child owners (the `<Plot>` whose `onCleanup` calls `destroy()`,
 * disposing this shared WebGL context's VAOs/buffers/programs) *before* the
 * parent chart's `onCleanup`. So we cannot rely on cancel-ordering — instead a
 * synchronous `stopped` flag is set the instant the panel unmounts and checked
 * at the top of every frame, so any already-queued frame no-ops rather than
 * touching deleted GL objects. `fn` (which does the setData/render GL work) is
 * only ever called after that guard passes.
 */
function useRaf(): { start: (fn: (frame: number) => void) => void } {
  let raf = 0;
  let frame = 0;
  let stopped = false;
  onCleanup(() => {
    stopped = true; // set synchronously on unmount — before the next frame can fire.
    cancelAnimationFrame(raf);
  });
  const start = (fn: (frame: number) => void) => {
    const loop = () => {
      if (stopped) return; // plot may already be destroyed — bail, touch no GL.
      frame++;
      fn(frame);
      if (stopped) return; // fn may have triggered teardown mid-frame.
      raf = requestAnimationFrame(loop);
    };
    if (!stopped) raf = requestAnimationFrame(loop);
  };
  return { start };
}

function DynLine(): JSX.Element {
  const N = 600;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
  const raf = useRaf();
  let ph = N;
  const onReady = (p: CorePlot) => {
    const line = p.addLine({ x, y, color: "#34d399", width: 2, decimate: false, renderType: "dynamic" });
    p.setView({ x: [0, N - 1], y: [-2.6, 2.6] });
    raf.start(() => {
      y.copyWithin(0, 1);
      ph += 1;
      y[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + jitter() * 0.25;
      line.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Line" subtitle="live · scrolling" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynSignals(): JSX.Element {
  const N = 500;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const ys = [0, 1, 2].map((k) =>
    Float64Array.from({ length: N }, (_, j) => Math.sin(j * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + k * 0.1),
  );
  const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
  const raf = useRaf();
  let ph = N;
  const onReady = (p: CorePlot) => {
    const lines = ys.map((y, i) => p.addLine({ x, y, color: colors[i], width: 1.5, decimate: false, renderType: "dynamic" }));
    p.setView({ x: [0, N - 1], y: [-3.5, 3.5] });
    raf.start(() => {
      ph += 1;
      ys.forEach((y, i) => {
        y.copyWithin(0, 1);
        y[N - 1] = Math.sin(ph * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + jitter() * 0.2 + i * 0.1;
        lines[i].setData(x, y);
      });
      p.render();
    });
  };
  return (
    <Panel title="Signals" subtitle="3 channels" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynScatter(): JSX.Element {
  const { gaussian } = makeRng(42);
  const M = 700;
  const x = new Float64Array(M);
  const y = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    x[i] = gaussian(0, 1);
    y[i] = gaussian(0, 1);
  }
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const sc = p.addScatter({ x, y, size: 5, color: "#818cf8", renderType: "dynamic" });
    p.setView({ x: [-4, 4], y: [-4, 4] });
    raf.start(() => {
      for (let i = 0; i < M; i++) {
        x[i] += jitter() * 0.08 - x[i] * 0.01;
        y[i] += jitter() * 0.08 - y[i] * 0.01;
      }
      sc.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Scatter" subtitle="drifting cloud" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynScatterMarkers(): JSX.Element {
  const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
  const colors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
  const M = 12;
  const x = Float64Array.from({ length: M }, (_, i) => i);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const layers = shapes.map((mk, r) => {
      const y = Float64Array.from({ length: M }, () => shapes.length - 1 - r);
      return p.addScatter({ x, y, size: 14, marker: mk, color: colors[r], name: mk, renderType: "dynamic" });
    });
    p.setView({ x: [-1, M], y: [-1, shapes.length] });
    raf.start((frame) => {
      const t = frame / 60;
      layers.forEach((lyr, r) => {
        const base = shapes.length - 1 - r;
        lyr.setData(x, Float64Array.from({ length: M }, (_, i) => base + Math.sin(t * 2 + i * 0.6 + r) * 0.25));
      });
      p.render();
    });
  };
  return (
    <Panel title="Scatter markers" subtitle="6 glyph shapes" fps>
      <Plot options={{ ...DARK, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynScatterColorBy(): JSX.Element {
  const { gaussian } = makeRng(42);
  const M = 1200;
  const x = new Float64Array(M);
  const y = new Float64Array(M);
  const v = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    x[i] = gaussian(0, 1.4);
    y[i] = gaussian(0, 1.4);
    v[i] = Math.hypot(x[i], y[i]);
  }
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const sc = p.addScatter({ x, y, size: 6, colorBy: { values: v, colormap: "viridis" }, renderType: "dynamic" });
    p.setView({ x: [-5, 5], y: [-5, 5] });
    raf.start(() => {
      for (let i = 0; i < M; i++) {
        x[i] += jitter() * 0.06 - x[i] * 0.008;
        y[i] += jitter() * 0.06 - y[i] * 0.008;
      }
      sc.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Scatter · colorBy" subtitle="value → viridis" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynBars(): JSX.Element {
  const { rand } = makeRng(42);
  const K = 9;
  const cats = Float64Array.from({ length: K }, (_, i) => i);
  const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const bar = p.addBar({ x: cats, y, width: 0.7, color: "#22d3ee", renderType: "dynamic" });
    p.setView({ x: [-0.6, K - 0.4], y: [0, 100] });
    raf.start(() => {
      for (let i = 0; i < K; i++) y[i] = Math.max(2, Math.min(98, y[i] + jitter() * 8));
      bar.setData(cats, y);
      p.render();
    });
  };
  return (
    <Panel title="Bars" subtitle="fluctuating" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynGroupedBars(): JSX.Element {
  const { rand } = makeRng(42);
  const cats = ["Q1", "Q2", "Q3", "Q4"];
  const idx = Float64Array.from(cats, (_, i) => i);
  const colors = ["#38bdf8", "#f472b6", "#a3e635"];
  const names = ["north", "south", "west"];
  const ys = [0, 1, 2].map(() => Float64Array.from(cats, () => 20 + rand() * 70));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const layers = p.addGroupedBars({ x: idx, series: ys.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
    raf.start(() => {
      ys.forEach((y, s) => {
        for (let i = 0; i < y.length; i++) y[i] = Math.max(4, Math.min(96, y[i] + jitter() * 7));
        layers[s].setData(idx, y);
      });
      p.render();
    });
  };
  return (
    <Panel title="Grouped bars" subtitle="categorical · 3 series" fps>
      <Plot options={{ ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: cats }, y: { domain: [0, 100] } }, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynStackedBars(): JSX.Element {
  const { rand } = makeRng(42);
  const cats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const idx = Float64Array.from(cats, (_, i) => i);
  const colors = ["#22d3ee", "#818cf8", "#fbbf24"];
  const names = ["email", "social", "direct"];
  const raw = [10, 8, 6].map((m) => Float64Array.from(cats, () => m + rand() * m));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const layers = p.addStackedBars({ x: idx, width: 0.6, series: raw.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
    raf.start(() => {
      const n = idx.length;
      const cum = new Float64Array(n);
      raw.forEach((y, s) => {
        const base = Float64Array.from(cum);
        const top = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          y[i] = Math.max(2, y[i] + jitter() * 1.2);
          top[i] = cum[i] + y[i];
          cum[i] = top[i];
        }
        layers[s].setData(idx, top, base);
      });
      p.render();
    });
  };
  return (
    <Panel title="Stacked bars" subtitle="categorical · cumulative" fps>
      <Plot options={{ ...DARK, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: cats } }, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynHBars(): JSX.Element {
  const { rand } = makeRng(42);
  const cats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
  const idx = Float64Array.from(cats, (_, i) => i);
  const vals = Float64Array.from(cats, (_, i) => 30 + i * 12 + rand() * 10);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const bar = p.addBar({ x: idx, y: vals, width: 0.6, orientation: "h", color: "#34d399", name: "score", renderType: "dynamic" });
    raf.start(() => {
      for (let i = 0; i < vals.length; i++) vals[i] = Math.max(6, Math.min(98, vals[i] + jitter() * 6));
      bar.setData(idx, vals);
      p.render();
    });
  };
  return (
    <Panel title="Horizontal bars" subtitle="hbar · categorical y" fps>
      <Plot options={{ ...DARK, scales: { y: { type: "categorical", factors: cats }, x: { domain: [0, 100] } }, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynArea(): JSX.Element {
  const N = 400;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
  const raf = useRaf();
  let ph = N;
  const onReady = (p: CorePlot) => {
    const area = p.addArea({ x, y, color: "rgba(52,211,153,0.45)", renderType: "dynamic" });
    p.setView({ x: [0, N - 1], y: [0, 4] });
    raf.start(() => {
      y.copyWithin(0, 1);
      ph += 1;
      y[N - 1] = 2 + Math.sin(ph * 0.06) + Math.sin(ph * 0.017) * 0.7 + Math.random() * 0.2;
      area.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Area" subtitle="streaming" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynStackedArea(): JSX.Element {
  const N = 120;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const amp = [3, 2.5, 2];
  const fr = [0.05, 0.06, 0.04];
  const colors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
  const raw = amp.map((a, s) => Float64Array.from({ length: N }, (_, i) => a + Math.sin(i * fr[s] + s) * a * 0.4 + a * 0.3));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const layers = p.addStackedArea({ x, series: raw.map((y, i) => ({ y, color: colors[i], name: "abc"[i] })) });
    p.setView({ x: [0, N - 1], y: [0, 14] });
    raf.start((frame) => {
      const t = frame / 60;
      const cum = new Float64Array(N);
      for (let s = 0; s < raw.length; s++) {
        const base = Float64Array.from(cum);
        const top = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          const yv = amp[s] + Math.sin(i * fr[s] + s + t * 1.5) * amp[s] * 0.4 + amp[s] * 0.3;
          top[i] = cum[i] + yv;
          cum[i] = top[i];
        }
        layers[s].setData(x, top, base);
      }
      p.render();
    });
  };
  return (
    <Panel title="Stacked area" subtitle="cumulative bands" fps>
      <Plot options={{ ...DARK, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynStepLine(): JSX.Element {
  const { rand } = makeRng(42);
  const N = 24;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const line = p.addLine({ x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: "dynamic" });
    p.setView({ x: [0, N - 1], y: [-0.5, 3.5] });
    raf.start(() => {
      y.copyWithin(0, 1);
      y[N - 1] = Math.round(Math.random() * 3);
      line.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Step line" subtitle="staircase · step:after" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynHistogram(): JSX.Element {
  const bins = 30;
  const lo = -4;
  const hi = 4;
  const bw = (hi - lo) / bins;
  const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
  const counts = new Float64Array(bins);
  for (let i = 0; i < bins; i++) counts[i] = 5000 * bw * Math.exp(-centers[i] * centers[i] / 2) / Math.sqrt(2 * Math.PI);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const bar = p.addBar({ x: centers, y: counts, width: bw * 0.98, color: "#34d399", renderType: "dynamic" });
    raf.start(() => {
      for (let i = 0; i < bins; i++) {
        const target = 5000 * bw * Math.exp(-centers[i] * centers[i] / 2) / Math.sqrt(2 * Math.PI);
        counts[i] = Math.max(0, counts[i] + (target - counts[i]) * 0.05 + jitter() * target * 0.12);
      }
      bar.setData(centers, counts);
      p.render();
    });
  };
  return (
    <Panel title="Histogram" subtitle="gaussian · 30 bins" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynBox(): JSX.Element {
  const { gaussian } = makeRng(42);
  const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
  const mkGroups = (phase: number) =>
    [0, 1, 2, 3].map((g) => ({
      position: g,
      values: Array.from({ length: 120 }, () => gaussian(g + Math.sin(phase + g) * 0.5, 1 + g * 0.3)),
      color: colors[g],
    }));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const box = p.addBox({ groups: mkGroups(0), width: 0.6, renderType: "dynamic" });
    p.setView({ x: [-0.6, 3.6], y: [-4, 8] });
    raf.start((frame) => {
      if (frame % 4 === 0) {
        box.setData(mkGroups(frame / 60));
        p.render();
      }
    });
  };
  return (
    <Panel title="Box plot" subtitle="Tukey · outliers" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynHeatmap(): JSX.Element {
  const cols = 60;
  const rows = 40;
  const values = new Float64Array(cols * rows);
  const fill = (ph: number) => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6;
        const yy = (r / rows) * 6;
        values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) + Math.sin(xx * yy * 0.15);
      }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const hm = p.addHeatmap({ values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: "dynamic" });
    raf.start((frame) => {
      fill(frame / 60);
      hm.setData(values);
      p.render();
    });
  };
  return (
    <Panel title="Heatmap" subtitle="texture · viridis" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynContour(): JSX.Element {
  const cols = 80;
  const rows = 60;
  const values = new Float64Array(cols * rows);
  const fill = (ph: number) => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6 - 3;
        const yy = (r / rows) * 6 - 3;
        values[r * cols + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) - 0.02 * (xx * xx + yy * yy);
      }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const ct = p.addContour({ values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: "dynamic" });
    raf.start((frame) => {
      if (frame % 2 === 0) {
        fill(frame / 60);
        ct.setData(values);
        p.render();
      }
    });
  };
  return (
    <Panel title="Contour" subtitle="marching squares" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynHexbin(): JSX.Element {
  const { gaussian } = makeRng(42);
  const M = 25_000;
  const x = new Float64Array(M);
  const y = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const blob = i % 2 === 0 ? -1.4 : 1.4;
    x[i] = gaussian(blob, 1);
    y[i] = gaussian(blob * 0.6, 1.1);
  }
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const hx = p.addHexbin({ x, y, radius: 0.22, colormap: "plasma", renderType: "dynamic" });
    p.setView({ x: [-5, 5], y: [-5, 5] });
    raf.start((frame) => {
      if (frame % 2 === 0) {
        for (let i = 0; i < M; i++) {
          x[i] += jitter() * 0.05 - x[i] * 0.004;
          y[i] += jitter() * 0.05 - y[i] * 0.004;
        }
        hx.setData(x, y);
        p.render();
      }
    });
  };
  return (
    <Panel title="Hexbin" subtitle="25k points · density" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynErrorBars(): JSX.Element {
  const { rand } = makeRng(42);
  const N = 12;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
  const yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const line = p.addLine({ x, y, color: "#60a5fa", width: 1.5, renderType: "dynamic" });
    const eb = p.addErrorBar({ x, y, yerr, color: "#60a5fa", capSize: 7, renderType: "dynamic" });
    p.setView({ x: [-1, N], y: [0, 10] });
    raf.start((frame) => {
      const t = frame / 60;
      for (let i = 0; i < N; i++) {
        y[i] = Math.sin(i / 2 + t) * 3 + 5;
        yerr[i] = 0.4 + (0.5 + 0.4 * Math.sin(t + i)) * 0.9;
      }
      line.setData(x, y);
      eb.setData({ x, y, yerr });
      p.render();
    });
  };
  return (
    <Panel title="Error bars" subtitle="whiskers + caps" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynErrorBand(): JSX.Element {
  const N = 120;
  const x = Float64Array.from({ length: N }, (_, i) => i / 10);
  const y = Float64Array.from(x, (t) => Math.sin(t));
  const err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const eb = p.addErrorBar({ x, y, yerr: err, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28, renderType: "dynamic" });
    const line = p.addLine({ x, y, color: "#a78bfa", width: 2, renderType: "dynamic" });
    p.setView({ x: [0, 12], y: [-1.5, 1.5] });
    raf.start((frame) => {
      const t = frame / 60;
      for (let i = 0; i < N; i++) {
        y[i] = Math.sin(x[i] + t);
        err[i] = 0.12 + 0.12 * Math.abs(Math.cos(x[i] + t));
      }
      eb.setData({ x, y, yerr: err });
      line.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Error band" subtitle="confidence ribbon" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynStem(): JSX.Element {
  const N = 30;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const stem = p.addStem({ x, y, color: "#34d399", markerSize: 6, renderType: "dynamic" });
    p.setView({ x: [-1, N], y: [-1, 1.1] });
    raf.start((frame) => {
      const t = frame / 60;
      for (let i = 0; i < N; i++) y[i] = Math.exp(-i / 12) * Math.cos(i / 2 + t * 2);
      stem.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Stem plot" subtitle="discrete signal" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynQuiver(): JSX.Element {
  const G = 16;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < G; i++)
    for (let j = 0; j < G; j++) {
      xs.push((i / (G - 1)) * 4 - 2);
      ys.push((j / (G - 1)) * 4 - 2);
    }
  const us = new Float64Array(xs.length);
  const vs = new Float64Array(xs.length);
  const fill = (ph: number) => {
    const a = Math.cos(ph);
    const b = Math.sin(ph);
    for (let k = 0; k < xs.length; k++) {
      us[k] = -ys[k] * a - xs[k] * b * 0.3;
      vs[k] = xs[k] * a - ys[k] * b * 0.3;
    }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const q = p.addQuiver({ x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" }, renderType: "dynamic" });
    p.setView({ x: [-2.4, 2.4], y: [-2.4, 2.4] });
    raf.start((frame) => {
      fill(frame / 60);
      q.setData(xs, ys, us, vs);
      p.render();
    });
  };
  return (
    <Panel title="Quiver" subtitle="vector field" fps>
      <Plot options={DARK} onReady={onReady} />
    </Panel>
  );
}

function DynCandlestick(): JSX.Element {
  const { gaussian } = makeRng(42);
  const N = 40;
  const start = Date.UTC(2024, 0, 1);
  const step = 86_400_000;
  const x = new Float64Array(N);
  const o = new Float64Array(N);
  const h = new Float64Array(N);
  const l = new Float64Array(N);
  const c = new Float64Array(N);
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price;
    const close = open + gaussian(0, 2.2);
    x[i] = start + i * step;
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
    price = close;
  }
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const cs = p.addCandlestick({ x, open: o, high: h, low: l, close: c, renderType: "dynamic" });
    let lastX = x[N - 1];
    let curOpen = c[N - 1];
    let curClose = curOpen;
    let hi = curOpen;
    let lo = curOpen;
    let sinceClose = 0;
    raf.start(() => {
      curClose += gaussian(0, 0.35);
      hi = Math.max(hi, curClose);
      lo = Math.min(lo, curClose);
      cs.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose });
      p.render();
      if (++sinceClose > 70) {
        sinceClose = 0;
        lastX += step;
        curOpen = curClose;
        hi = lo = curOpen;
        cs.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen });
        p.setView({ x: [lastX - step * 42, lastX + step * 2] });
      }
    });
  };
  return (
    <Panel title="Candlestick" subtitle="OHLC · streaming" fps>
      <Plot options={{ ...DARK, scales: { x: { type: "time" } } }} onReady={onReady} />
    </Panel>
  );
}

function DynOhlc(): JSX.Element {
  const { gaussian } = makeRng(42);
  const N = 40;
  const start = Date.UTC(2024, 0, 1);
  const step = 86_400_000;
  const x = new Float64Array(N);
  const o = new Float64Array(N);
  const h = new Float64Array(N);
  const l = new Float64Array(N);
  const c = new Float64Array(N);
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price;
    const close = open + gaussian(0, 2.2);
    x[i] = start + i * step;
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
    price = close;
  }
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const ol = p.addOhlc({ x, open: o, high: h, low: l, close: c, renderType: "dynamic" });
    let lastX = x[N - 1];
    let curOpen = c[N - 1];
    let curClose = curOpen;
    let hi = curOpen;
    let lo = curOpen;
    let sinceClose = 0;
    raf.start(() => {
      curClose += gaussian(0, 0.35);
      hi = Math.max(hi, curClose);
      lo = Math.min(lo, curClose);
      ol.updateLast({ x: lastX, open: curOpen, high: hi, low: lo, close: curClose });
      p.render();
      if (++sinceClose > 70) {
        sinceClose = 0;
        lastX += step;
        curOpen = curClose;
        hi = lo = curOpen;
        ol.appendCandle({ x: lastX, open: curOpen, high: hi, low: lo, close: curOpen });
        p.setView({ x: [lastX - step * 42, lastX + step * 2] });
      }
    });
  };
  return (
    <Panel title="OHLC" subtitle="bars · streaming" fps>
      <Plot options={{ ...DARK, scales: { x: { type: "time" } } }} onReady={onReady} />
    </Panel>
  );
}

function DynOrdinal(): JSX.Element {
  const { gaussian } = makeRng(42);
  const N = 60;
  const times = businessDays(N, Date.UTC(2024, 0, 1));
  const idx = Float64Array.from({ length: N }, (_, i) => i);
  const o = new Float64Array(N);
  const h = new Float64Array(N);
  const l = new Float64Array(N);
  const c = new Float64Array(N);
  let price = 100;
  for (let i = 0; i < N; i++) {
    const open = price;
    const close = open + gaussian(0, 2);
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1));
    price = close;
  }
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const cs = p.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });
    let curOpen = c[N - 1];
    let curClose = curOpen;
    let hi = curOpen;
    let lo = curOpen;
    let sinceClose = 0;
    raf.start(() => {
      curClose += gaussian(0, 0.3);
      hi = Math.max(hi, curClose);
      lo = Math.min(lo, curClose);
      cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
      p.render();
      if (++sinceClose > 60) {
        sinceClose = 0;
        for (let i = 0; i < N - 1; i++) {
          o[i] = o[i + 1];
          h[i] = h[i + 1];
          l[i] = l[i + 1];
          c[i] = c[i + 1];
        }
        curOpen = curClose;
        o[N - 1] = curOpen;
        h[N - 1] = curOpen;
        l[N - 1] = curOpen;
        c[N - 1] = curOpen;
        hi = lo = curOpen;
        cs.setData({ x: idx, open: o, high: h, low: l, close: c });
      }
    });
  };
  return (
    <Panel title="Ordinal-time axis" subtitle="sessions · weekend gaps collapse" fps>
      <Plot options={{ ...DARK, scales: { x: { type: "ordinal-time", times } } }} onReady={onReady} />
    </Panel>
  );
}

function DynPie(props: { donut?: boolean }): JSX.Element {
  const vals = props.donut ? [8, 6, 5, 4, 3, 2] : [35, 25, 20, 12, 8];
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const pie = props.donut
      ? p.addPie({ values: vals, innerRadius: 0.55, renderType: "dynamic" })
      : p.addPie({ values: vals, colormap: "viridis", renderType: "dynamic" });
    p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
    raf.start((frame) => {
      if (frame % 3 === 0) {
        for (let i = 0; i < vals.length; i++) vals[i] = Math.max(props.donut ? 1.5 : 3, vals[i] + jitter() * (props.donut ? 2 : 3));
        pie.setData(vals);
        p.render();
      }
    });
  };
  return (
    <Panel title={props.donut ? "Donut" : "Pie"} subtitle={props.donut ? "categories" : "market share"} fps>
      <Plot
        options={{ ...DARK, equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } }}
        onReady={onReady}
      />
    </Panel>
  );
}

function DynPatches(): JSX.Element {
  const { rand } = makeRng(42);
  const cols = 6;
  const rows = 4;
  const cells: Array<{ x: number[]; y: number[]; base: number }> = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const j = () => (rand() - 0.5) * 0.22;
      cells.push({
        x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
        y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
        base: Math.sin(c * 0.7) + Math.cos(r * 0.9),
      });
    }
  const mk = (ph: number) => cells.map((cell, i) => ({ x: cell.x, y: cell.y, value: cell.base + Math.sin(ph + i * 0.4) * 0.6 }));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const patch = p.addPatches({ patches: mk(0), colormap: "plasma", renderType: "dynamic" });
    p.setView({ x: [-0.3, cols + 0.3], y: [-0.3, rows + 0.3] });
    raf.start((frame) => {
      if (frame % 2 === 0) {
        patch.setData(mk(frame / 60));
        p.render();
      }
    });
  };
  return (
    <Panel title="Patches" subtitle="polygons · choropleth" fps>
      <Plot options={{ ...DARK, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynAnnotations(): JSX.Element {
  const N = 100;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.15) * 3 + 5);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const line = p.addLine({ x, y, color: "#38bdf8", width: 2, renderType: "dynamic" });
    p.setView({ x: [0, N - 1], y: [0, 10] });
    p.addAnnotation({ type: "band", dim: "y", from: 6, to: 8, color: "rgba(52,211,153,0.15)" });
    p.addAnnotation({ type: "span", dim: "y", value: 5, color: "#f59e0b", dash: [5, 4] });
    p.addAnnotation({ type: "span", dim: "x", value: 50, color: "#f472b6", dash: [5, 4] });
    p.addAnnotation({ type: "box", x: [20, 35], y: [2, 4], border: "#a78bfa" });
    p.addAnnotation({ type: "label", x: 52, y: 9, text: "event", color: "#f472b6" });
    raf.start((frame) => {
      const t = frame / 60;
      for (let i = 0; i < N; i++) y[i] = Math.sin(i * 0.15 + t) * 3 + 5;
      line.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Annotations" subtitle="span · band · box · label" fps>
      <Plot options={{ ...DARK, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynImage(): JSX.Element {
  const iw = 96;
  const ih = 96;
  const id = new ImageData(iw, ih);
  const paint = (cx: number, cy: number) => {
    for (let yy = 0; yy < ih; yy++)
      for (let xx = 0; xx < iw; xx++) {
        const i = (yy * iw + xx) * 4;
        const d = Math.hypot(xx - cx, yy - cy) / (iw / 2);
        id.data[i] = Math.round((xx / iw) * 255);
        id.data[i + 1] = Math.round((yy / ih) * 255);
        id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
        id.data[i + 3] = 255;
      }
  };
  paint(iw / 2, ih / 2);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const img = p.addImage({ source: id, extent: { x: [0, 10], y: [0, 10] }, renderType: "dynamic" });
    p.setView({ x: [-0.5, 10.5], y: [-0.5, 10.5] });
    raf.start((frame) => {
      const t = frame / 60;
      paint(iw / 2 + Math.cos(t * 1.5) * iw * 0.3, ih / 2 + Math.sin(t * 1.5) * ih * 0.3);
      img.setData(id);
      p.render();
    });
  };
  return (
    <Panel title="Image" subtitle="RGBA glyph · textured quad" fps>
      <Plot options={{ ...DARK, showToolbar: false }} onReady={onReady} />
    </Panel>
  );
}

function DynGraph(): JSX.Element {
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
    [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
  ];
  const nNodes = 10;
  const bx = new Float64Array(nNodes);
  const by = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    bx[i] = Math.cos((i / nNodes) * Math.PI * 2);
    by[i] = Math.sin((i / nNodes) * Math.PI * 2);
  }
  const x = new Float64Array(nNodes);
  const y = new Float64Array(nNodes);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const g = p.addGraph({ x: bx, y: by, edges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: "dynamic" });
    p.setView({ x: [-1.5, 1.5], y: [-1.5, 1.5] });
    raf.start((frame) => {
      const t = frame / 60;
      for (let i = 0; i < nNodes; i++) {
        x[i] = bx[i] + Math.sin(t * 2 + i) * 0.12;
        y[i] = by[i] + Math.cos(t * 2 + i) * 0.12;
      }
      g.setData({ x, y, edges });
      p.render();
    });
  };
  return (
    <Panel title="Graph" subtitle="force layout · nodes + edges" fps>
      <Plot options={{ ...DARK, showToolbar: false, equalAspect: true }} onReady={onReady} />
    </Panel>
  );
}

function DynLogAxis(): JSX.Element {
  const N = 200;
  const x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10);
  const taus = [1.2, 2.5, 5];
  const colors = ["#f472b6", "#60a5fa", "#34d399"];
  const ys = taus.map((tau) => Float64Array.from(x, (t) => Math.exp(-t / tau) + 1e-3));
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const lines = ys.map((y, k) => p.addLine({ x, y, color: colors[k], width: 1.5, name: `τ=${taus[k]}`, renderType: "dynamic" }));
    raf.start((frame) => {
      const t = frame / 60;
      taus.forEach((tau, k) => {
        const y = ys[k];
        for (let i = 0; i < N; i++) y[i] = Math.exp(-x[i] / tau) * (1 + 0.3 * Math.sin(t * 2 + i * 0.1)) + 1e-3;
        lines[k].setData(x, y);
      });
      p.render();
    });
  };
  return (
    <Panel title="Log axis" subtitle="exp decay · log y" fps>
      <Plot options={{ ...DARK, scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } }} onReady={onReady} />
    </Panel>
  );
}

function DynTimeAxis(): JSX.Element {
  const { gaussian } = makeRng(42);
  const start = Date.UTC(2024, 0, 1);
  const N = 24 * 60;
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = start + i * 60_000;
    const h = i / 60;
    y[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
  }
  const raf = useRaf();
  let ph = N;
  const onReady = (p: CorePlot) => {
    const line = p.addLine({ x, y, color: "#22d3ee", width: 1.5, renderType: "dynamic" });
    raf.start(() => {
      y.copyWithin(0, 1);
      x.copyWithin(0, 1);
      ph++;
      x[N - 1] = start + ph * 60_000;
      const h = ph / 60;
      y[N - 1] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
      line.setData(x, y);
      p.render();
    });
  };
  return (
    <Panel title="Time axis" subtitle="1 day · date ticks" fps>
      <Plot options={{ ...DARK, scales: { x: { type: "time" } } }} onReady={onReady} />
    </Panel>
  );
}

function DynDualY(): JSX.Element {
  const N = 400;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
  const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
  const raf = useRaf();
  let ph = N;
  const onReady = (p: CorePlot) => {
    p.addYAxis("t", { side: "right", color: "#f472b6", title: "temp" });
    const l1 = p.addLine({ x, y: a, color: "#60a5fa", width: 1.5, decimate: false, renderType: "dynamic" });
    const l2 = p.addLine({ x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false, renderType: "dynamic" });
    p.setView({ x: [0, N - 1], y: [-2, 2], yAxes: { t: [15, 35] } });
    raf.start(() => {
      a.copyWithin(0, 1);
      b.copyWithin(0, 1);
      ph += 1;
      a[N - 1] = Math.sin(ph * 0.05) * 1.5 + jitter() * 0.15;
      b[N - 1] = 25 + Math.sin(ph * 0.02) * 6 + jitter() * 0.6;
      l1.setData(x, a);
      l2.setData(x, b);
      p.render();
    });
  };
  return (
    <Panel title="Dual Y" subtitle="two scales" fps>
      <Plot options={{ ...DARK, axes: { y: { title: "amp" } } }} onReady={onReady} />
    </Panel>
  );
}

function DynStyledCategorical(): JSX.Element {
  const { rand } = makeRng(42);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const idx = Float64Array.from(months, (_, i) => i);
  const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
  const target = Float64Array.from(months, () => 70 + rand() * 12);
  const raf = useRaf();
  const onReady = (p: CorePlot) => {
    const bar = p.addBar({ x: idx, y: revenue, width: 0.6, color: "#38bdf8", name: "revenue", renderType: "dynamic" });
    const line = p.addLine({ x: idx, y: target, color: "#f59e0b", width: 2.5, name: "target", renderType: "dynamic" });
    raf.start(() => {
      for (let i = 0; i < months.length; i++) {
        revenue[i] = Math.max(5, Math.min(105, revenue[i] + jitter() * 6));
        target[i] = Math.max(40, Math.min(100, target[i] + jitter() * 3));
      }
      bar.setData(idx, revenue);
      line.setData(idx, target);
      p.render();
    });
  };
  return (
    <Panel title="Styled + categorical" subtitle="bg · title · legend · rotated" fps>
      <Plot
        options={{
          ...DARK,
          background: "#0b1220",
          title: { text: "Quarterly revenue", align: "left" },
          legend: { position: "top-left" },
          scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
          axes: { x: { labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" }, y: { gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] } },
          showToolbar: false,
        }}
        onReady={onReady}
      />
    </Panel>
  );
}

function DynPolarRadar(): JSX.Element {
  const { rand } = makeRng(42);
  const B = 14;
  const bt = Float64Array.from({ length: B }, () => rand() * 360);
  const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
  const raf = useRaf();
  const onReady = (pp: CorePolarPlot) => {
    const sweep = pp.addLine({ theta: [0, 0], r: [0, 1], color: "#22d3ee", width: 2 });
    pp.addScatter({ theta: bt, r: br, color: "#f472b6", size: 6, labels: Array.from({ length: B }, (_, i) => `Contact ${i + 1}`) });
    let ang = 0;
    raf.start(() => {
      ang = (ang + 2.5) % 360;
      sweep.setData([ang, ang], [0, 1]);
    });
  };
  return (
    <Panel title="Polar radar" subtitle="rotating sweep" fps>
      <PolarPlot options={{ ...DARK, angleUnit: "deg", maxRadius: 1 }} onReady={onReady} />
    </Panel>
  );
}

function DynPolarRose(): JSX.Element {
  const T = 240;
  const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
  const r = new Float64Array(T);
  for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(3 * theta[i]));
  const raf = useRaf();
  const onReady = (pp: CorePolarPlot) => {
    const rose = pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
    raf.start((frame) => {
      const k = 3 + 2 * Math.sin((frame / 60) * 0.3);
      for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(k * theta[i]));
      rose.setData(theta, r);
    });
  };
  return (
    <Panel title="Polar rose" subtitle="morphing curve" fps>
      <PolarPlot options={{ ...DARK, maxRadius: 1 }} onReady={onReady} />
    </Panel>
  );
}

function DynSurface(props: { wireframe?: boolean }): JSX.Element {
  const cols = props.wireframe ? 40 : 64;
  const rows = cols;
  const values = new Float64Array(cols * rows);
  const freq = props.wireframe ? 1.5 : 2;
  const fill = (ph: number) => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4;
        const yy = (r / rows) * 8 - 4;
        const rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * freq - ph) / rr) * 3;
      }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: props.wireframe ? "plasma" : "viridis", wireframe: props.wireframe, name: "height", renderType: "dynamic" });
    raf.start((frame) => {
      fill((frame / 60) * 3);
      surf.setData(values);
      p3.refresh();
    });
  };
  return (
    <Panel title={props.wireframe ? "3D wireframe" : "3D surface"} subtitle={props.wireframe ? "lines · hover · reset" : "title · colorbar · light"} fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, lightControls: !props.wireframe, title: props.wireframe ? "Wireframe" : "Sinc surface" }} onReady={onReady} />
    </Panel>
  );
}

function DynBar3D(): JSX.Element {
  const gx = 8;
  const gz = 8;
  const xa: number[] = [];
  const za: number[] = [];
  for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
  const ya = new Float64Array(xa.length);
  const fill = (ph: number) => {
    for (let k = 0; k < xa.length; k++) ya[k] = 1.5 + Math.sin(xa[k] * 0.6 + ph) * Math.cos(za[k] * 0.6) * 1.5;
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const bar = p3.addBar3D({ x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: "dynamic" });
    raf.start((frame) => {
      fill((frame / 60) * 2);
      bar.setData(xa, za, ya);
      p3.refresh();
    });
  };
  return (
    <Panel title="3D bars" subtitle="colormapped · lit" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" }} onReady={onReady} />
    </Panel>
  );
}

function DynLine3D(): JSX.Element {
  const N = 400;
  const mk = (phase: number) => {
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    const z = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const tt = (i / (N - 1)) * Math.PI * 2 * 4;
      x[i] = Math.cos(tt + phase);
      z[i] = Math.sin(tt + phase);
      y[i] = (i / (N - 1)) * 4 - 2;
    }
    return { x, y, z };
  };
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const a = mk(0);
    const b = mk(Math.PI);
    const la = p3.addLine3D({ ...a, color: "#38bdf8", name: "α" });
    const lb = p3.addLine3D({ ...b, color: "#f472b6", name: "β" });
    raf.start((frame) => {
      const t = frame / 60;
      const na = mk(t * 2);
      const nb = mk(Math.PI + t * 2);
      la.setData(na.x, na.y, na.z);
      lb.setData(nb.x, nb.y, nb.z);
      p3.refresh();
    });
  };
  return (
    <Panel title="3D lines" subtitle="paths · legend" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, legend: true }} onReady={onReady} />
    </Panel>
  );
}

function DynQuiver3D(): JSX.Element {
  const g = 6;
  const xa: number[] = [];
  const ya: number[] = [];
  const za: number[] = [];
  for (let i = 0; i < g; i++)
    for (let j = 0; j < g; j++)
      for (let k = 0; k < g; k++) {
        xa.push((i / (g - 1)) * 2 - 1);
        ya.push((j / (g - 1)) * 2 - 1);
        za.push((k / (g - 1)) * 2 - 1);
      }
  const u = new Float64Array(xa.length);
  const v = new Float64Array(xa.length);
  const w = new Float64Array(xa.length);
  const fill = (ph: number) => {
    const ca = Math.cos(ph);
    const sa = Math.sin(ph);
    for (let k = 0; k < xa.length; k++) {
      u[k] = -ya[k] * ca;
      v[k] = xa[k] * ca;
      w[k] = za[k] * 0.3 * sa;
    }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const q = p3.addQuiver3D({ x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: "dynamic" });
    raf.start((frame) => {
      fill((frame / 60) * 2);
      q.setData(xa, ya, za, u, v, w);
      p3.refresh();
    });
  };
  return (
    <Panel title="3D quiver" subtitle="vector field · colorbar" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" } }} onReady={onReady} />
    </Panel>
  );
}

function DynContour3D(): JSX.Element {
  const cols = 50;
  const rows = 50;
  const values = new Float64Array(cols * rows);
  const fill = (ph: number) => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4;
        const yy = (r / rows) * 8 - 4;
        const rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 1.5 - ph) / rr) * 3;
      }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const ct = p3.addContour3D({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: "dynamic" });
    raf.start((frame) => {
      if (frame % 3 === 0) {
        fill((frame / 60) * 3);
        ct.setData(values);
        p3.refresh();
      }
    });
  };
  return (
    <Panel title="3D contour" subtitle="iso-height rings" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" }} onReady={onReady} />
    </Panel>
  );
}

function DynIsosurface(): JSX.Element {
  const n = 28;
  const vol = new Float64Array(n * n * n);
  const fill = (ph: number) => {
    const blobs = [
      [-0.5 + Math.sin(ph) * 0.3, 0, 0],
      [0.6, 0.3 + Math.cos(ph) * 0.3, -0.2],
      [0.1, -0.5, 0.4 + Math.sin(ph * 1.3) * 0.3],
    ];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const px = (x / (n - 1)) * 2 - 1;
          const py = (y / (n - 1)) * 2 - 1;
          const pz = (z / (n - 1)) * 2 - 1;
          let s = 0;
          for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 6);
          vol[x + y * n + z * n * n] = s;
        }
  };
  fill(0);
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const iso = p3.addIsosurface({ values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: "dynamic" });
    raf.start((frame) => {
      if (frame % 5 === 0) {
        fill(frame / 60);
        iso.setData(vol, [n, n, n], 0.5, { x: [-1, 1], y: [-1, 1], z: [-1, 1] });
        p3.refresh();
      }
    });
  };
  return (
    <Panel title="3D isosurface" subtitle="marching cubes · metaballs" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" }} onReady={onReady} />
    </Panel>
  );
}

function DynScatter3D(): JSX.Element {
  const { gaussian } = makeRng(42);
  const N = 300;
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const z = new Float64Array(N);
  const sizes = new Float64Array(N);
  const vals = new Float64Array(N);
  const labels: string[] = [];
  for (let i = 0; i < N; i++) {
    x[i] = gaussian(0, 1);
    y[i] = gaussian(0, 1);
    z[i] = gaussian(0, 1);
    const r = Math.hypot(x[i], y[i], z[i]);
    sizes[i] = 3 + r * 6;
    vals[i] = r;
    labels.push(`p${i} · r=${r.toFixed(2)}`);
  }
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const sc = p3.addPointCloud({ x, y, z, sizes, labels, colorBy: { values: vals, colormap: "plasma" }, name: "r" });
    raf.start(() => {
      for (let i = 0; i < N; i++) {
        x[i] += jitter() * 0.04 - x[i] * 0.006;
        y[i] += jitter() * 0.04 - y[i] * 0.006;
        z[i] += jitter() * 0.04 - z[i] * 0.006;
      }
      sc.setData(x, y, z);
      p3.refresh();
    });
  };
  return (
    <Panel title="3D scatter" subtitle="per-point size · labels" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" } }} onReady={onReady} />
    </Panel>
  );
}

function DynVolume(): JSX.Element {
  const n = 48;
  const vol = new Float64Array(n * n * n);
  const blobs = [[-0.4, 0, 0], [0.5, 0.3, -0.2], [0.1, -0.4, 0.4]];
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const px = (x / (n - 1)) * 2 - 1;
        const py = (y / (n - 1)) * 2 - 1;
        const pz = (z / (n - 1)) * 2 - 1;
        let s = 0;
        for (const b of blobs) s += Math.exp(-((px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2) * 5);
        vol[x + y * n + z * n * n] = s;
      }
  const onReady = (p3: CorePlot3D) => {
    // autoRotate streams frames continuously; no explicit updater needed.
    p3.addVolume({ values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: "dynamic" });
  };
  return (
    <Panel title="3D volume" subtitle="raymarch · auto-rotate" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true }} onReady={onReady} />
    </Panel>
  );
}

function DynPointCloud(): JSX.Element {
  const N = 6000;
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const z = new Float64Array(N);
  const build = (ph: number) => {
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 20 + ph;
      const rr = 1 + (i / N) * 2;
      x[i] = Math.cos(th) * rr;
      z[i] = Math.sin(th) * rr;
      y[i] = (i / N) * 4 - 2;
    }
  };
  build(0);
  const raf = useRaf();
  const onReady = (p3: CorePlot3D) => {
    const sc = p3.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
    raf.start((frame) => {
      build(frame / 60);
      sc.setData(x, y, z);
      p3.refresh();
    });
  };
  return (
    <Panel title="3D point cloud" subtitle="axes · colored by height" fps>
      <Plot3D options={{ axisLabels: { x: "x", y: "height", z: "z" } }} onReady={onReady} />
    </Panel>
  );
}

/** Linked finance: candlesticks + volume on an ordinal-time axis, joined via `linkX`. */
function LinkedFinance(): JSX.Element {
  const { rand, gaussian } = makeRng(42);
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

  let priceP: CorePlot | null = null;
  let volP: CorePlot | null = null;
  const raf = useRaf();

  const tryLink = () => {
    if (!priceP || !volP) return;
    const pp = priceP;
    const vp = volP;
    const cs = pp.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });
    const volBar = vp.addBar({ x: idx, y: vol, width: 0.7, color: "#38bdf8", renderType: "dynamic" });
    linkX([pp, vp]);

    let curOpen = c[N - 1];
    let curClose = curOpen;
    let hi = curOpen;
    let lo = curOpen;
    let curVol = vol[N - 1];
    let sinceClose = 0;
    raf.start(() => {
      curClose += gaussian(0, 0.3);
      hi = Math.max(hi, curClose);
      lo = Math.min(lo, curClose);
      curVol = Math.max(5, curVol + jitter() * 3);
      cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
      vol[N - 1] = curVol;
      volBar.setData(idx, vol);
      pp.render();
      vp.render();
      if (++sinceClose > 60) {
        sinceClose = 0;
        for (let i = 0; i < N - 1; i++) {
          o[i] = o[i + 1];
          h[i] = h[i + 1];
          l[i] = l[i + 1];
          c[i] = c[i + 1];
          vol[i] = vol[i + 1];
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
    });
  };

  return (
    <>
      <Panel title="Linked finance · price" subtitle="candlesticks · ordinal-time" fps>
        <Plot
          options={{ ...DARK, scales: { x: { type: "ordinal-time", times } }, showToolbar: false }}
          onReady={(p) => {
            priceP = p;
            tryLink();
          }}
        />
      </Panel>
      <Panel title="Linked finance · volume" subtitle="linkX-ed pane" fps>
        <Plot
          options={{ ...DARK, scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 80] } }, showToolbar: false }}
          onReady={(p) => {
            volP = p;
            tryLink();
          }}
        />
      </Panel>
    </>
  );
}

function DynamicGrid(): JSX.Element {
  return (
    <>
      <DynLine />
      <DynSignals />
      <DynScatter />
      <DynScatterMarkers />
      <DynScatterColorBy />
      <DynBars />
      <DynGroupedBars />
      <DynStackedBars />
      <DynHBars />
      <DynArea />
      <DynStackedArea />
      <DynStepLine />
      <DynHistogram />
      <DynBox />
      <DynHeatmap />
      <DynContour />
      <DynHexbin />
      <DynErrorBars />
      <DynErrorBand />
      <DynStem />
      <DynQuiver />
      <DynCandlestick />
      <DynOhlc />
      <DynOrdinal />
      <DynPie />
      <DynPie donut />
      <DynPatches />
      <DynAnnotations />
      <DynImage />
      <DynGraph />
      <DynLogAxis />
      <DynTimeAxis />
      <DynDualY />
      <DynStyledCategorical />
      <DynPolarRadar />
      <DynPolarRose />
      <DynSurface />
      <DynBar3D />
      <DynLine3D />
      <DynSurface wireframe />
      <DynQuiver3D />
      <DynContour3D />
      <DynIsosurface />
      <DynScatter3D />
      <DynVolume />
      <DynPointCloud />
      <LinkedFinance />
    </>
  );
}

// ============================================================================
// FINANCE TAB — specialised finance charts + a linkX-synced indicator
// dashboard. All STATIC (no FPS badges, no rAF). Mirrors vanilla buildFinance().
// ============================================================================
function FinanceGrid(): JSX.Element {
  const { rand, gaussian } = makeRng(42);
  const N = 90;
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
    const close = open + gaussian(0, 2.2);
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.2));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.2));
    vol[i] = 20 + Math.abs(close - open) * 6 + rand() * 12;
    price = close;
  }

  // Slice a series past its warm-up NaNs (indicators return leading NaN).
  const trim = (y: Float64Array): { x: Float64Array; y: Float64Array } => {
    const s = Math.max(0, firstFinite(y));
    return { x: idx.subarray(s), y: y.subarray(s) };
  };

  // Depth chart — synthesize a cumulative order book around the last price.
  const mid = c[N - 1];
  const bids: [number, number][] = [];
  const asks: [number, number][] = [];
  for (let i = 1; i <= 20; i++) {
    bids.push([mid - i * 0.5, 5 + rand() * 20]);
    asks.push([mid + i * 0.5, 5 + rand() * 20]);
  }

  // Indicators for the linked dashboard.
  const rsiSeries = trim(rsi(c, 14));
  const m = macd(c, 12, 26, 9);
  const macdHist = trim(m.histogram);
  const macdLine = trim(m.macd);
  const macdSignal = trim(m.signal);

  // Three linked panes: build each pane's layers imperatively in its `onReady`,
  // then `linkX` all three once every core plot exists.
  let priceP: CorePlot | null = null;
  let rsiP: CorePlot | null = null;
  let macdP: CorePlot | null = null;
  const tryLink = () => {
    if (priceP && rsiP && macdP) linkX([priceP, rsiP, macdP]);
  };

  return (
    <>
      <Panel title="Heikin-Ashi" subtitle="smoothed candles">
        <Plot options={{ ...DARK, scales: { x: { type: "ordinal-time", times } }, showToolbar: false }}>
          <HeikinAshi x={idx} open={o} high={h} low={l} close={c} />
        </Plot>
      </Panel>

      <Panel title="Renko" subtitle="brickSize 2 · wickless">
        <Plot options={{ ...DARK, showToolbar: false }}>
          <Renko close={c} brickSize={2} />
        </Plot>
      </Panel>

      <Panel title="Bollinger Bands" subtitle="20 · 2σ">
        <Plot options={{ ...DARK, scales: { x: { type: "ordinal-time", times } }, showToolbar: false }}>
          <Candlestick x={idx} open={o} high={h} low={l} close={c} />
          <Bollinger x={idx} close={c} period={20} k={2} bandColor="rgba(167,139,250,0.14)" />
        </Plot>
      </Panel>

      <Panel title="Volume profile" subtitle="volume by price · POC">
        <Plot options={{ ...DARK, showToolbar: false }}>
          <VolumeProfile price={c} volume={vol} bins={24} color="#3b82f6" pocColor="#f59e0b" />
        </Plot>
      </Panel>

      <Panel title="Depth chart" subtitle="cumulative order book">
        <Plot options={{ ...DARK, showToolbar: false }}>
          <Depth bids={bids} asks={asks} />
        </Plot>
      </Panel>

      <Panel title="Linked · price" subtitle="candles · drag to pan">
        <Plot
          options={{ ...DARK, scales: { x: { type: "ordinal-time", times } }, showToolbar: false }}
          onReady={(p) => {
            priceP = p;
            p.addCandlestick({ x: idx, open: o, high: h, low: l, close: c });
            p.render();
            tryLink();
          }}
        />
      </Panel>

      <Panel title="Linked · RSI(14)" subtitle="70 / 30 guides">
        <Plot
          options={{ ...DARK, scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 100] } }, showToolbar: false }}
          onReady={(p) => {
            rsiP = p;
            p.addLine({ x: rsiSeries.x, y: rsiSeries.y, color: "#f472b6", width: 1.5, name: "RSI" });
            p.addAnnotation({ type: "span", dim: "y", value: 70, color: "#475569", dash: [4, 4] });
            p.addAnnotation({ type: "span", dim: "y", value: 30, color: "#475569", dash: [4, 4] });
            p.render();
            tryLink();
          }}
        />
      </Panel>

      <Panel title="Linked · MACD" subtitle="12/26/9">
        <Plot
          options={{ ...DARK, scales: { x: { type: "ordinal-time", times } }, showToolbar: false }}
          onReady={(p) => {
            macdP = p;
            p.addBar({ x: macdHist.x, y: macdHist.y, width: 0.7, color: "#64748b" });
            p.addLine({ x: macdLine.x, y: macdLine.y, color: "#60a5fa", width: 1.5, name: "MACD" });
            p.addLine({ x: macdSignal.x, y: macdSignal.y, color: "#f59e0b", width: 1.5, name: "signal" });
            p.render();
            tryLink();
          }}
        />
      </Panel>
    </>
  );
}

// ============================================================================
// ML TAB — deep-learning / model-eval chart pack. Each panel captures its core
// Plot via `onReady` and calls an `addX(plot, opts)` builder. All STATIC (no
// FPS badges, no rAF). Mirrors vanilla buildML().
// ============================================================================
function MLGrid(): JSX.Element {
  const { rand, gaussian } = makeRng(42);

  // 1 — Training curves (EMA smoothing + best-epoch marker).
  const E = 90;
  const tcTrain = new Float64Array(E);
  const tcVal = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    tcTrain[e] = 2.4 * Math.exp(-e / 24) + 0.16 + Math.abs(gaussian(0, 0.05));
    tcVal[e] = 2.4 * Math.exp(-e / 21) + 0.28 + Math.max(0, (e - 55) * 0.004) + Math.abs(gaussian(0, 0.09));
  }

  // 2 — Confusion matrix (5 classes).
  const C = 5;
  const cmN = 600;
  const yTrue = new Int32Array(cmN);
  const yPred = new Int32Array(cmN);
  for (let i = 0; i < cmN; i++) {
    const t = Math.floor(rand() * C);
    yTrue[i] = t;
    yPred[i] = rand() < 0.82 ? t : Math.floor(rand() * C);
  }

  // Shared binary-classifier scores for ROC / PR / calibration (3, 4, 5).
  const NB = 500;
  const scores = new Float64Array(NB);
  const labels = new Int32Array(NB);
  for (let i = 0; i < NB; i++) {
    const pos = rand() < 0.4 ? 1 : 0;
    labels[i] = pos;
    scores[i] = Math.min(1, Math.max(0, pos ? gaussian(0.68, 0.17) : gaussian(0.36, 0.17)));
  }

  // 6 — Embedding projector (high-D Gaussians → PCA 2-D).
  const D = 12;
  const K = 3;
  const per = 90;
  const emN = K * per;
  const means: number[][] = Array.from({ length: K }, () => Array.from({ length: D }, () => gaussian(0, 2.4)));
  const emData = new Float64Array(emN * D);
  const emCls = new Int32Array(emN);
  let er = 0;
  for (let k = 0; k < K; k++)
    for (let j = 0; j < per; j++, er++) {
      emCls[er] = k;
      for (let cc = 0; cc < D; cc++) emData[er * D + cc] = means[k]![cc]! + gaussian(0, 1);
    }
  const proj = pca(emData, emN, D, 2);
  const emX = new Float64Array(emN);
  const emY = new Float64Array(emN);
  for (let i = 0; i < emN; i++) {
    emX[i] = proj.scores[i * 2]!;
    emY[i] = proj.scores[i * 2 + 1]!;
  }

  // 7 — Decision boundary (field + training points).
  const dbNx = 72;
  const dbNy = 72;
  const dbLo = -3;
  const dbHi = 3;
  const dbValues = new Float64Array(dbNx * dbNy);
  for (let iy = 0; iy < dbNy; iy++)
    for (let ix = 0; ix < dbNx; ix++) {
      const x = dbLo + ((dbHi - dbLo) * ix) / (dbNx - 1);
      const y = dbLo + ((dbHi - dbLo) * iy) / (dbNy - 1);
      dbValues[iy * dbNx + ix] = 1 / (1 + Math.exp(-(1.6 - (x * x + y * y)) * 2.2));
    }
  const dbM = 220;
  const dbPx = new Float64Array(dbM);
  const dbPy = new Float64Array(dbM);
  const dbPl = new Int32Array(dbM);
  for (let i = 0; i < dbM; i++) {
    const x = dbLo + rand() * (dbHi - dbLo);
    const y = dbLo + rand() * (dbHi - dbLo);
    dbPx[i] = x;
    dbPy[i] = y;
    const inside = x * x + y * y < 1.6;
    dbPl[i] = (rand() < 0.9 ? inside : !inside) ? 1 : 0;
  }

  // 8 — Feature importance (sorted horizontal bars).
  const fiNames = ["bmi", "s5", "bp", "age", "s3", "sex", "s1", "s6", "s4"];
  const fiValues = fiNames.map(() => rand() * rand());

  // 9 — SHAP beeswarm (per-sample impact, colored by feature value).
  const shNames = ["bmi", "s5", "bp", "age", "s3", "sex"];
  const shF = shNames.length;
  const shN = 180;
  const shap: number[][] = [];
  const fval: number[][] = [];
  for (let f = 0; f < shF; f++) {
    const w = (shF - f) / shF;
    const sv: number[] = [];
    const fv: number[] = [];
    for (let i = 0; i < shN; i++) {
      const v = gaussian(0, 1);
      fv.push(v);
      sv.push(w * v * 0.6 + gaussian(0, 0.08));
    }
    shap.push(sv);
    fval.push(fv);
  }

  // 10 — Partial dependence (+ ICE).
  const G = 32;
  const pdX = new Float64Array(G);
  const pdPd = new Float64Array(G);
  for (let i = 0; i < G; i++) {
    const t = i / (G - 1);
    pdX[i] = t;
    pdPd[i] = 0.2 + 0.6 / (1 + Math.exp(-(t - 0.5) * 10));
  }
  const pdIce: number[][] = [];
  for (let k = 0; k < 16; k++) {
    const scale = 0.7 + rand() * 0.6;
    const off = gaussian(0, 0.04);
    pdIce.push(Array.from(pdPd, (v) => Math.min(1, Math.max(0, 0.2 + (v - 0.2) * scale + off + gaussian(0, 0.015)))));
  }

  // 11 — Attention map (transformer, causal, query × key).
  const T = 11;
  const amW: number[][] = [];
  for (let q = 0; q < T; q++) {
    const row: number[] = [];
    let z = 0;
    for (let k = 0; k <= q; k++) {
      const bias = -Math.abs(q - k) * 0.55 + (k === 0 ? 0.9 : 0) + gaussian(0, 0.12);
      const ex = Math.exp(bias);
      row.push(ex);
      z += ex;
    }
    for (let k = q + 1; k < T; k++) row.push(0);
    for (let k = 0; k < T; k++) row[k]! /= z || 1;
    amW.push(row);
  }

  // 12 — Ridgeline (weight distribution over epochs).
  const rlEpochs = 8;
  const rlGroups = Array.from({ length: rlEpochs }, (_, e) => {
    const mean = 1.1 * Math.exp(-e / 3);
    const sd = 0.45 * Math.exp(-e / 6) + 0.14;
    return { label: `epoch ${e}`, values: Float64Array.from({ length: 320 }, () => gaussian(mean, sd)) };
  });

  return (
    <>
      <Panel title="Training curves" subtitle="EMA smoothing">
        <Plot
          options={{ ...DARK, showToolbar: false, legend: true }}
          onReady={(p) => {
            addTrainingCurves(p, {
              series: [{ name: "train loss", y: tcTrain, color: "#60a5fa" }, { name: "val loss", y: tcVal, color: "#f472b6" }],
              smoothing: 0.6,
              showRaw: true,
              best: "min",
            });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Confusion matrix" subtitle="5 classes">
        <Plot
          options={{ ...DARK, showToolbar: false }}
          onReady={(p) => {
            addConfusionMatrix(p, { yTrue, yPred, classes: C, colormap: "viridis" });
            p.render();
          }}
        />
      </Panel>

      <Panel title="ROC curve" subtitle="AUC in legend">
        <Plot
          options={{ ...DARK, showToolbar: false, legend: true }}
          onReady={(p) => {
            addRocCurve(p, { scores, labels, fill: true, color: "#38bdf8" });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Precision–recall" subtitle="AP in legend">
        <Plot
          options={{ ...DARK, showToolbar: false, legend: true }}
          onReady={(p) => {
            addPrCurve(p, { scores, labels, fill: true });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Calibration" subtitle="reliability + ECE">
        <Plot
          options={{ ...DARK, showToolbar: false, legend: true }}
          onReady={(p) => {
            addCalibration(p, { scores, labels, bins: 10 });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Embedding (PCA)" subtitle="color by class">
        <Plot
          options={{ ...DARK, showToolbar: false, legend: true, pick: "xy" }}
          onReady={(p) => {
            addEmbedding(p, { x: emX, y: emY, labels: emCls, classNames: ["cats", "dogs", "birds"], size: 5 });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Decision boundary" subtitle="field + points">
        <Plot
          options={{ ...DARK, showToolbar: false, pick: "xy" }}
          onReady={(p) => {
            addDecisionBoundary(p, {
              values: dbValues,
              cols: dbNx,
              rows: dbNy,
              extent: { x: [dbLo, dbHi], y: [dbLo, dbHi] },
              colormap: "coolwarm",
              domain: [0, 1],
              points: { x: dbPx, y: dbPy, labels: dbPl, classNames: ["outside", "inside"], palette: ["#0b1020", "#e5e7eb"], size: 5 },
            });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Feature importance" subtitle="sorted">
        <Plot
          options={{ ...DARK, showToolbar: false }}
          onReady={(p) => {
            addFeatureImportance(p, { names: fiNames, values: fiValues, color: "#34d399", top: 9 });
            p.render();
          }}
        />
      </Panel>

      <Panel title="SHAP beeswarm" subtitle="impact by feature value">
        <Plot
          options={{ ...DARK, showToolbar: false }}
          onReady={(p) => {
            addShapBeeswarm(p, { values: shap, featureValues: fval, names: shNames, size: 4 });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Partial dependence" subtitle="PDP + ICE">
        <Plot
          options={{ ...DARK, showToolbar: false, legend: true }}
          onReady={(p) => {
            addPartialDependence(p, { x: pdX, pd: pdPd, ice: pdIce });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Attention map" subtitle="causal · query × key">
        <Plot
          options={{ ...DARK, showToolbar: false }}
          onReady={(p) => {
            addAttentionMap(p, { weights: amW, colormap: "viridis" });
            p.render();
          }}
        />
      </Panel>

      <Panel title="Ridgeline" subtitle="weights over epochs">
        <Plot
          options={{ ...DARK, showToolbar: false }}
          onReady={(p) => {
            addRidgeline(p, { groups: rlGroups, overlap: 1.6, range: [-1.5, 2.5] });
            p.render();
          }}
        />
      </Panel>
    </>
  );
}

// ============================================================================
// App — four tabs. Static is the default (built on load). The others are
// mounted LAZILY (via <Show>) the first time their tab is shown, so their WebGL
// plots size correctly (a plot built while display:none sizes to 0).
// ============================================================================
type Tab = "static" | "dynamic" | "finance" | "ml";

const COUNTS: Record<Tab, number> = { static: 46, dynamic: 48, finance: 8, ml: 12 };

export function App(): JSX.Element {
  const [tab, setTab] = createSignal<Tab>("static");

  const TabButton = (props: { id: Tab; label: string }) => (
    <button class={`tab${tab() === props.id ? " active" : ""}`} onClick={() => setTab(props.id)}>
      {props.label}
      <span class="count">{COUNTS[props.id]}</span>
    </button>
  );

  return (
    <main>
      <header>
        <h1>
          <b>Photon</b> · Solid — WebGL2 chart gallery
        </h1>
        <p>
          Four tabs, declarative Solid wrappers. <b>Static</b>: the full chart catalog. <b>Dynamic</b>: the same
          catalog streaming live at 60fps, each panel with an FPS badge. <b>Finance</b>: Heikin-Ashi, Renko,
          Bollinger, volume profile, depth + a linkX-synced RSI/MACD dashboard. <b>ML</b>: training curves,
          confusion matrix, ROC/PR, embeddings, decision boundary, SHAP + more.
        </p>
      </header>

      <div class="tabs">
        <TabButton id="static" label="Static" />
        <TabButton id="dynamic" label="Dynamic" />
        <TabButton id="finance" label="Finance" />
        <TabButton id="ml" label="ML" />
      </div>
      <div class="tabbar-line" />

      <Show when={tab() === "static"}>
        <div class="grid">
          <StaticGrid />
        </div>
      </Show>
      <Show when={tab() === "dynamic"}>
        <div class="grid">
          <DynamicGrid />
        </div>
      </Show>
      <Show when={tab() === "finance"}>
        <div class="grid">
          <FinanceGrid />
        </div>
      </Show>
      <Show when={tab() === "ml"}>
        <div class="grid">
          <MLGrid />
        </div>
      </Show>
    </main>
  );
}
