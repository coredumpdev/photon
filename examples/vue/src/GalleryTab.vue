<script setup lang="ts">
// ===========================================================================
// GalleryTab — the full chart catalog, rendered ONCE and reused for both the
// Static and Dynamic tabs. The only difference is the `dynamic` prop:
//   • render-type flips to "dynamic" (GL_DYNAMIC_DRAW buffer hint),
//   • each panel gets a self-measuring FPS badge,
//   • a single requestAnimationFrame loop mutates typed-array buffers and
//     republishes fresh references to the reactive refs, so the @photonviz/vue
//     wrappers stream new data (setData / recreate) under the hood.
// The chart LOGIC is shared; only the data source differs.
//
// This whole component is mounted LAZILY (v-if on the active tab in App.vue),
// so its WebGL containers are always visible & sized when the plots are built.
// ===========================================================================
import {
  Plot,
  Line,
  Scatter,
  Bar,
  Area,
  Heatmap,
  Box,
  Hexbin,
  Contour,
  ErrorBar,
  Stem,
  Quiver,
  Candlestick,
  Ohlc,
  Pie,
  Patches,
  Image,
  Graph,
  YAxis,
  Annotation,
  PolarPlot,
  PolarLine,
  PolarScatter,
  Plot3D,
  Surface,
  PointCloud,
  Line3D,
  Bar3D,
  Quiver3D,
  Contour3D,
  Isosurface,
  Volume,
} from "@photonviz/vue";
import { Plot as CorePlot, linkX } from "@photonviz/core";
import type {
  BoxOptions,
  PatchesOptions,
  PlotOptions,
  Plot3DOptions,
} from "@photonviz/core";
import { onMounted, onUnmounted, ref, shallowRef } from "vue";
import Panel from "./Panel.vue";

const props = defineProps<{ dynamic: boolean }>();
const dyn = props.dynamic;
const rtype = dyn ? "dynamic" : ("static" as const);

// --- Seeded RNG (same seed → Static and Dynamic start from identical data) ---
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
const jitter = (): number => Math.random() - 0.5;

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

// --- Animation plumbing ------------------------------------------------------
const updaters: Array<(t: number) => void> = [];
let raf = 0;
let frame = 0;
let destroyed = false;
function push(fn: (t: number) => void): void {
  if (dyn) updaters.push(fn);
}
const every =
  (k: number, fn: (t: number) => void) =>
  (t: number): void => {
    if (frame % k === 0) fn(t);
  };

const dark = { theme: "dark" } as PlotOptions;

// ===========================================================================
// 2D catalog
// ===========================================================================

// --- Line: sine sum, scrolling ----------------------------------------------
const LN = 600;
const lineX = Float64Array.from({ length: LN }, (_, i) => i);
const lineBuf = Float64Array.from(
  { length: LN },
  (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7,
);
const lineY = shallowRef(lineBuf.slice());
let linePh = LN;
push(() => {
  lineBuf.copyWithin(0, 1);
  linePh += 1;
  lineBuf[LN - 1] =
    Math.sin(linePh * 0.08) * 1.6 + Math.sin(linePh * 0.021) * 0.7 + jitter() * 0.25;
  lineY.value = lineBuf.slice();
});

// --- Signals: 3 channels -----------------------------------------------------
const SGN = 500;
const sigX = Float64Array.from({ length: SGN }, (_, i) => i);
const sigColors = ["#60a5fa", "#f472b6", "#fbbf24"];
const sigBufs = [new Float64Array(SGN), new Float64Array(SGN), new Float64Array(SGN)];
sigBufs.forEach((y, i) => {
  for (let j = 0; j < SGN; j++) y[j] = Math.sin(j * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + i * 0.1;
});
// NOTE: a single ref holding an array-of-arrays — NOT an array of refs. Vue only
// auto-unwraps top-level refs in templates, so refs nested inside a v-for array
// would be passed to the layer as raw Ref objects (empty data → blank panel).
const sigY = shallowRef<Float64Array[]>(sigBufs.map((b) => b.slice()));
let sigPh = SGN;
push(() => {
  sigPh += 1;
  sigBufs.forEach((y, i) => {
    y.copyWithin(0, 1);
    y[SGN - 1] = Math.sin(sigPh * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + jitter() * 0.2 + i * 0.1;
  });
  sigY.value = sigBufs.map((b) => b.slice());
});

// --- Scatter: gaussian cloud, drifting --------------------------------------
const SCM = 700;
const scBufX = new Float64Array(SCM);
const scBufY = new Float64Array(SCM);
for (let i = 0; i < SCM; i++) {
  scBufX[i] = gaussian(0, 1);
  scBufY[i] = gaussian(0, 1);
}
const scX = shallowRef(scBufX.slice());
const scY = shallowRef(scBufY.slice());
push(() => {
  for (let i = 0; i < SCM; i++) {
    scBufX[i] += jitter() * 0.08 - scBufX[i]! * 0.01;
    scBufY[i] += jitter() * 0.08 - scBufY[i]! * 0.01;
  }
  scX.value = scBufX.slice();
  scY.value = scBufY.slice();
});

// --- Scatter markers: 6 glyph shapes ----------------------------------------
const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
const mkColors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
const MKM = 12;
const mkX = Float64Array.from({ length: MKM }, (_, i) => i);
const mkY = shallowRef<Float64Array[]>(
  shapes.map((_, r) => Float64Array.from({ length: MKM }, () => shapes.length - 1 - r)),
);
push((t) => {
  mkY.value = shapes.map((_, r) => {
    const base = shapes.length - 1 - r;
    return Float64Array.from({ length: MKM }, (_, i) => base + Math.sin(t * 2 + i * 0.6 + r) * 0.25);
  });
});

// --- Scatter · colorBy -------------------------------------------------------
const CBM = 1200;
const cbBufX = new Float64Array(CBM);
const cbBufY = new Float64Array(CBM);
const cbVal = new Float64Array(CBM);
for (let i = 0; i < CBM; i++) {
  cbBufX[i] = gaussian(0, 1.4);
  cbBufY[i] = gaussian(0, 1.4);
  cbVal[i] = Math.hypot(cbBufX[i]!, cbBufY[i]!);
}
const cbX = shallowRef(cbBufX.slice());
const cbY = shallowRef(cbBufY.slice());
const cbColorBy = { values: cbVal, colormap: "viridis" as const };
push(() => {
  for (let i = 0; i < CBM; i++) {
    cbBufX[i] += jitter() * 0.06 - cbBufX[i]! * 0.008;
    cbBufY[i] += jitter() * 0.06 - cbBufY[i]! * 0.008;
  }
  cbX.value = cbBufX.slice();
  cbY.value = cbBufY.slice();
});

// --- Bars: categorical, fluctuating -----------------------------------------
const BK = 9;
const barX = Float64Array.from({ length: BK }, (_, i) => i);
const barBuf = Float64Array.from({ length: BK }, () => 40 + rand() * 30);
const barY = shallowRef(barBuf.slice());
push(() => {
  for (let i = 0; i < BK; i++) barBuf[i] = Math.max(2, Math.min(98, barBuf[i]! + jitter() * 8));
  barY.value = barBuf.slice();
});

// --- Grouped bars: 2 side-by-side series (offset) ---------------------------
const GBK = 8;
const gbX = Float64Array.from({ length: GBK }, (_, i) => i);
const gbBuf1 = Float64Array.from({ length: GBK }, () => 20 + rand() * 60);
const gbBuf2 = Float64Array.from({ length: GBK }, () => 20 + rand() * 60);
const gbY1 = shallowRef(gbBuf1.slice());
const gbY2 = shallowRef(gbBuf2.slice());
push(() => {
  for (let i = 0; i < GBK; i++) {
    gbBuf1[i] = Math.max(4, Math.min(96, gbBuf1[i]! + jitter() * 7));
    gbBuf2[i] = Math.max(4, Math.min(96, gbBuf2[i]! + jitter() * 7));
  }
  gbY1.value = gbBuf1.slice();
  gbY2.value = gbBuf2.slice();
});

// --- Stacked bars: 3 series via base offsets --------------------------------
const sbCats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const sbX = Float64Array.from(sbCats, (_, i) => i);
const sbRaw = [
  Float64Array.from(sbCats, () => 10 + rand() * 10),
  Float64Array.from(sbCats, () => 8 + rand() * 8),
  Float64Array.from(sbCats, () => 6 + rand() * 6),
];
const sbColors = ["#22d3ee", "#818cf8", "#fbbf24"];
const sbNames = ["email", "social", "direct"];
function stack(raw: Float64Array[]): { base: Float64Array; top: Float64Array }[] {
  const n = raw[0]!.length;
  const cum = new Float64Array(n);
  return raw.map((y) => {
    const base = cum.slice();
    const top = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      top[i] = cum[i]! + y[i]!;
      cum[i] = top[i]!;
    }
    return { base, top };
  });
}
const sbInit = stack(sbRaw);
const sbBase = shallowRef<Float64Array[]>(sbInit.map((s) => s.base));
const sbTop = shallowRef<Float64Array[]>(sbInit.map((s) => s.top));
push(() => {
  for (const y of sbRaw) for (let i = 0; i < y.length; i++) y[i] = Math.max(2, y[i]! + jitter() * 1.2);
  const s = stack(sbRaw);
  sbBase.value = s.map((seg) => seg.base);
  sbTop.value = s.map((seg) => seg.top);
});

// --- Horizontal bars ---------------------------------------------------------
const hbCats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
const hbX = Float64Array.from(hbCats, (_, i) => i);
const hbBuf = Float64Array.from(hbCats, (_, i) => 30 + i * 12 + rand() * 10);
const hbY = shallowRef(hbBuf.slice());
push(() => {
  for (let i = 0; i < hbBuf.length; i++) hbBuf[i] = Math.max(6, Math.min(98, hbBuf[i]! + jitter() * 6));
  hbY.value = hbBuf.slice();
});

// --- Area: filled envelope, streaming ---------------------------------------
const AN = 400;
const areaX = Float64Array.from({ length: AN }, (_, i) => i);
const areaBuf = Float64Array.from(
  { length: AN },
  (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7,
);
const areaY = shallowRef(areaBuf.slice());
let areaPh = AN;
push(() => {
  areaBuf.copyWithin(0, 1);
  areaPh += 1;
  areaBuf[AN - 1] = 2 + Math.sin(areaPh * 0.06) + Math.sin(areaPh * 0.017) * 0.7 + Math.random() * 0.2;
  areaY.value = areaBuf.slice();
});

// --- Stacked area: 3 cumulative bands via base ------------------------------
const SAN = 120;
const saX = Float64Array.from({ length: SAN }, (_, i) => i);
const saColors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
const saAmp = [3, 2.5, 2];
const saFr = [0.05, 0.06, 0.04];
function stackArea(t: number): { base: Float64Array; top: Float64Array }[] {
  const cum = new Float64Array(SAN);
  return saAmp.map((a, s) => {
    const base = cum.slice();
    const top = new Float64Array(SAN);
    for (let i = 0; i < SAN; i++) {
      const yv = a + Math.sin(i * saFr[s]! + s + t * 1.5) * a * 0.4 + a * 0.3;
      top[i] = cum[i]! + yv;
      cum[i] = top[i]!;
    }
    return { base, top };
  });
}
const saInit = stackArea(0);
const saBase = shallowRef<Float64Array[]>(saInit.map((s) => s.base));
const saTop = shallowRef<Float64Array[]>(saInit.map((s) => s.top));
push((t) => {
  const s = stackArea(t);
  saBase.value = s.map((seg) => seg.base);
  saTop.value = s.map((seg) => seg.top);
});

// --- Step line ---------------------------------------------------------------
const STN = 24;
const stepX = Float64Array.from({ length: STN }, (_, i) => i);
const stepBuf = Float64Array.from({ length: STN }, () => Math.round(rand() * 3));
const stepY = shallowRef(stepBuf.slice());
push(() => {
  stepBuf.copyWithin(0, 1);
  stepBuf[STN - 1] = Math.round(Math.random() * 3);
  stepY.value = stepBuf.slice();
});

// --- Line joins: miter / bevel / round --------------------------------------
const joins = ["miter", "bevel", "round"] as const;
const joinColors = ["#f472b6", "#60a5fa", "#34d399"];
const joinX = Float64Array.from({ length: 13 }, (_, i) => i);
const joinY = shallowRef<Float64Array[]>(
  joins.map((_, k) => Float64Array.from(joinX, (_, i) => (i % 2 === 0 ? 0 : 1) + k * 2.2)),
);
push((t) => {
  joinY.value = joins.map((_, k) => {
    const amp = 0.6 + 0.4 * Math.sin(t * 2 + k);
    return Float64Array.from(joinX, (_, i) => (i % 2 === 0 ? 0 : amp) + k * 2.2);
  });
});

// --- Histogram (a Bar of gaussian counts) -----------------------------------
const HBINS = 30;
const hLo = -4;
const hBw = 8 / HBINS;
const histCenters = Float64Array.from({ length: HBINS }, (_, i) => hLo + (i + 0.5) * hBw);
const histBuf = new Float64Array(HBINS);
(function fillHist(): void {
  histBuf.fill(0);
  for (let i = 0; i < 5000; i++) {
    const b = Math.floor((gaussian(0, 1) - hLo) / hBw);
    if (b >= 0 && b < HBINS) histBuf[b]!++;
  }
})();
const histY = shallowRef(histBuf.slice());
push(() => {
  for (let i = 0; i < HBINS; i++) {
    const target =
      (5000 * hBw * Math.exp((-histCenters[i]! * histCenters[i]!) / 2)) / Math.sqrt(2 * Math.PI);
    histBuf[i] = Math.max(0, histBuf[i]! + (target - histBuf[i]!) * 0.05 + jitter() * target * 0.12);
  }
  histY.value = histBuf.slice();
});

// --- Box plot ----------------------------------------------------------------
const boxColors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
function mkBoxGroups(phase: number): BoxOptions["groups"] {
  return [0, 1, 2, 3].map((g) => ({
    position: g,
    values: Array.from({ length: 120 }, () => gaussian(g + Math.sin(phase + g) * 0.5, 1 + g * 0.3)),
    color: boxColors[g],
  }));
}
const boxGroups = shallowRef(mkBoxGroups(0));
push(every(4, (t) => (boxGroups.value = mkBoxGroups(t))));

// --- Heatmap -----------------------------------------------------------------
const HC = 60;
const HR = 40;
const heatBuf = new Float64Array(HC * HR);
function fillHeat(ph: number): void {
  for (let r = 0; r < HR; r++)
    for (let c = 0; c < HC; c++) {
      const xx = (c / HC) * 6;
      const yy = (r / HR) * 6;
      heatBuf[r * HC + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) + Math.sin(xx * yy * 0.15);
    }
}
fillHeat(0);
const heatValues = shallowRef(heatBuf.slice());
const heatExtent = { x: [0, 6], y: [0, 6] } as const;
push((t) => {
  fillHeat(t);
  heatValues.value = heatBuf.slice();
});

// --- Contour -----------------------------------------------------------------
const CC = 80;
const CR = 60;
const contBuf = new Float64Array(CC * CR);
function fillCont(ph: number): void {
  for (let r = 0; r < CR; r++)
    for (let c = 0; c < CC; c++) {
      const xx = (c / CC) * 6 - 3;
      const yy = (r / CR) * 6 - 3;
      contBuf[r * CC + c] = Math.sin(xx + ph) * Math.cos(yy - ph * 0.5) - 0.02 * (xx * xx + yy * yy);
    }
}
fillCont(0);
const contValues = shallowRef(contBuf.slice());
const contExtent = { x: [-3, 3], y: [-3, 3] } as const;
push(every(2, (t) => {
  fillCont(t);
  contValues.value = contBuf.slice();
}));

// --- Spectrogram (heatmap of a moving spectral peak) ------------------------
const SPC = 90;
const SPR = 64;
const specBuf = new Float64Array(SPC * SPR);
function fillSpec(ph: number): void {
  for (let c = 0; c < SPC; c++) {
    const peak = (0.5 + 0.5 * Math.sin(ph + c * 0.12)) * (SPR - 1);
    for (let r = 0; r < SPR; r++) specBuf[r * SPC + c] = Math.exp(-((r - peak) ** 2) / 40) + Math.random() * 0.03;
  }
}
fillSpec(0);
const specValues = shallowRef(specBuf.slice());
const specExtent = { x: [0, 6], y: [0, 4] } as const;
push((t) => {
  fillSpec(t);
  specValues.value = specBuf.slice();
});

// --- Hexbin ------------------------------------------------------------------
const HXM = 25_000;
const hxBufX = new Float64Array(HXM);
const hxBufY = new Float64Array(HXM);
for (let i = 0; i < HXM; i++) {
  const blob = i % 2 === 0 ? -1.4 : 1.4;
  hxBufX[i] = gaussian(blob, 1);
  hxBufY[i] = gaussian(blob * 0.6, 1.1);
}
const hxX = shallowRef(hxBufX.slice());
const hxY = shallowRef(hxBufY.slice());
push(every(3, () => {
  for (let i = 0; i < HXM; i++) {
    hxBufX[i] += jitter() * 0.05 - hxBufX[i]! * 0.004;
    hxBufY[i] += jitter() * 0.05 - hxBufY[i]! * 0.004;
  }
  hxX.value = hxBufX.slice();
  hxY.value = hxBufY.slice();
}));

// --- Error bars --------------------------------------------------------------
const EBN = 12;
const ebX = Float64Array.from({ length: EBN }, (_, i) => i);
const ebBufY = Float64Array.from({ length: EBN }, (_, i) => Math.sin(i / 2) * 3 + 5);
const ebBufErr = Float64Array.from({ length: EBN }, () => 0.4 + rand() * 0.9);
const ebY = shallowRef(ebBufY.slice());
const ebErr = shallowRef(ebBufErr.slice());
push((t) => {
  for (let i = 0; i < EBN; i++) {
    ebBufY[i] = Math.sin(i / 2 + t) * 3 + 5;
    ebBufErr[i] = 0.4 + (0.5 + 0.4 * Math.sin(t + i)) * 0.9;
  }
  ebY.value = ebBufY.slice();
  ebErr.value = ebBufErr.slice();
});

// --- Error band --------------------------------------------------------------
const BBN = 120;
const bbX = Float64Array.from({ length: BBN }, (_, i) => i / 10);
const bbBufY = Float64Array.from(bbX, (t) => Math.sin(t));
const bbBufErr = Float64Array.from(bbX, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
const bbY = shallowRef(bbBufY.slice());
const bbErr = shallowRef(bbBufErr.slice());
push((t) => {
  for (let i = 0; i < BBN; i++) {
    bbBufY[i] = Math.sin(bbX[i]! + t);
    bbBufErr[i] = 0.12 + 0.12 * Math.abs(Math.cos(bbX[i]! + t));
  }
  bbY.value = bbBufY.slice();
  bbErr.value = bbBufErr.slice();
});

// --- Stem --------------------------------------------------------------------
const SMN = 30;
const stemX = Float64Array.from({ length: SMN }, (_, i) => i);
const stemBuf = Float64Array.from({ length: SMN }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
const stemY = shallowRef(stemBuf.slice());
push((t) => {
  for (let i = 0; i < SMN; i++) stemBuf[i] = Math.exp(-i / 12) * Math.cos(i / 2 + t * 2);
  stemY.value = stemBuf.slice();
});

// --- Quiver ------------------------------------------------------------------
const QG = 16;
const qX: number[] = [];
const qY: number[] = [];
for (let i = 0; i < QG; i++)
  for (let j = 0; j < QG; j++) {
    qX.push((i / (QG - 1)) * 4 - 2);
    qY.push((j / (QG - 1)) * 4 - 2);
  }
const qBufU = new Float64Array(qX.length);
const qBufV = new Float64Array(qX.length);
function fillQuiver(ph: number): void {
  const a = Math.cos(ph);
  const b = Math.sin(ph);
  for (let k = 0; k < qX.length; k++) {
    qBufU[k] = -qY[k]! * a - qX[k]! * b * 0.3;
    qBufV[k] = qX[k]! * a - qY[k]! * b * 0.3;
  }
}
fillQuiver(0);
const qU = shallowRef(qBufU.slice());
const qV = shallowRef(qBufV.slice());
const qColorBy = { colormap: "viridis" as const };
push((t) => {
  fillQuiver(t);
  qU.value = qBufU.slice();
  qV.value = qBufV.slice();
});

// --- Candlestick / OHLC (shared OHLC generator over a time axis) -------------
function makeOhlc(n: number, startMs: number, step: number) {
  const x = new Float64Array(n);
  const o = new Float64Array(n);
  const h = new Float64Array(n);
  const l = new Float64Array(n);
  const c = new Float64Array(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open + gaussian(0, 2.2);
    x[i] = startMs + i * step;
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
    l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
    price = close;
  }
  return { x, o, h, l, c };
}
const DAY = 86_400_000;

const cs = makeOhlc(40, Date.UTC(2024, 0, 1), DAY);
const csHigh = shallowRef(cs.h);
const csLow = shallowRef(cs.l);
const csClose = shallowRef(cs.c);
{
  let hi = cs.c[39]!;
  let lo = cs.c[39]!;
  let cur = cs.c[39]!;
  push(() => {
    cur += gaussian(0, 0.35);
    hi = Math.max(hi, cur);
    lo = Math.min(lo, cur);
    cs.h[39] = hi;
    cs.l[39] = lo;
    cs.c[39] = cur;
    csHigh.value = cs.h.slice();
    csLow.value = cs.l.slice();
    csClose.value = cs.c.slice();
  });
}

const ol = makeOhlc(40, Date.UTC(2024, 0, 1), DAY);
const olHigh = shallowRef(ol.h);
const olLow = shallowRef(ol.l);
const olClose = shallowRef(ol.c);
{
  let hi = ol.c[39]!;
  let lo = ol.c[39]!;
  let cur = ol.c[39]!;
  push(() => {
    cur += gaussian(0, 0.35);
    hi = Math.max(hi, cur);
    lo = Math.min(lo, cur);
    ol.h[39] = hi;
    ol.l[39] = lo;
    ol.c[39] = cur;
    olHigh.value = ol.h.slice();
    olLow.value = ol.l.slice();
    olClose.value = ol.c.slice();
  });
}

// --- Ordinal-time candlestick (weekend gaps collapse) -----------------------
const OTN = 60;
const otTimes = businessDays(OTN, Date.UTC(2024, 0, 1));
const otIdx = Float64Array.from({ length: OTN }, (_, i) => i);
const ot = makeOhlc(OTN, 0, 1);
const otHigh = shallowRef(ot.h.slice());
const otLow = shallowRef(ot.l.slice());
const otClose = shallowRef(ot.c.slice());
const otOptions = { theme: "dark", scales: { x: { type: "ordinal-time", times: otTimes } } } as PlotOptions;
{
  let hi = ot.c[OTN - 1]!;
  let lo = ot.c[OTN - 1]!;
  let cur = ot.c[OTN - 1]!;
  push(() => {
    cur += gaussian(0, 0.3);
    hi = Math.max(hi, cur);
    lo = Math.min(lo, cur);
    ot.h[OTN - 1] = hi;
    ot.l[OTN - 1] = lo;
    ot.c[OTN - 1] = cur;
    otHigh.value = ot.h.slice();
    otLow.value = ot.l.slice();
    otClose.value = ot.c.slice();
  });
}

// --- Pie / Donut -------------------------------------------------------------
const pieNoAxis = {
  theme: "dark",
  equalAspect: true,
  showToolbar: false,
  hover: false,
  axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } },
} as PlotOptions;
const pieBuf = [35, 25, 20, 12, 8];
const pieVals = shallowRef(pieBuf.slice());
push(every(3, () => {
  for (let i = 0; i < pieBuf.length; i++) pieBuf[i] = Math.max(3, pieBuf[i]! + jitter() * 3);
  pieVals.value = pieBuf.slice();
}));
const donutBuf = [8, 6, 5, 4, 3, 2];
const donutVals = shallowRef(donutBuf.slice());
push(every(3, () => {
  for (let i = 0; i < donutBuf.length; i++) donutBuf[i] = Math.max(1.5, donutBuf[i]! + jitter() * 2);
  donutVals.value = donutBuf.slice();
}));

// --- Patches (choropleth) ----------------------------------------------------
const patchCols = 6;
const patchRows = 4;
const patchCells: Array<{ x: number[]; y: number[]; base: number }> = [];
for (let r = 0; r < patchRows; r++)
  for (let c = 0; c < patchCols; c++) {
    const j = (): number => (rand() - 0.5) * 0.22;
    patchCells.push({
      x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
      y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
      base: Math.sin(c * 0.7) + Math.cos(r * 0.9),
    });
  }
function mkPatches(ph: number): PatchesOptions["patches"] {
  return patchCells.map((cell, i) => ({ x: cell.x, y: cell.y, value: cell.base + Math.sin(ph + i * 0.4) * 0.6 }));
}
const patches = shallowRef(mkPatches(0));
push(every(2, (t) => (patches.value = mkPatches(t))));

// --- Annotations -------------------------------------------------------------
const ANN = 100;
const annX = Float64Array.from({ length: ANN }, (_, i) => i);
const annBuf = Float64Array.from({ length: ANN }, (_, i) => Math.sin(i * 0.15) * 3 + 5);
const annY = shallowRef(annBuf.slice());
push((t) => {
  for (let i = 0; i < ANN; i++) annBuf[i] = Math.sin(i * 0.15 + t) * 3 + 5;
  annY.value = annBuf.slice();
});

// --- Image (RGBA glyph on a textured quad) ----------------------------------
const IW = 96;
const IH = 96;
function paintImage(cx: number, cy: number): ImageData {
  const id = new ImageData(IW, IH);
  for (let yy = 0; yy < IH; yy++)
    for (let xx = 0; xx < IW; xx++) {
      const i = (yy * IW + xx) * 4;
      const d = Math.hypot(xx - cx, yy - cy) / (IW / 2);
      id.data[i] = Math.round((xx / IW) * 255);
      id.data[i + 1] = Math.round((yy / IH) * 255);
      id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
      id.data[i + 3] = 255;
    }
  return id;
}
const imgSource = shallowRef(paintImage(IW / 2, IH / 2));
const imgExtent = { x: [0, 10], y: [0, 10] } as const;
push(every(2, (t) => {
  imgSource.value = paintImage(IW / 2 + Math.cos(t * 1.5) * IW * 0.3, IH / 2 + Math.sin(t * 1.5) * IH * 0.3);
}));

// --- Graph (nodes + edges wobble) -------------------------------------------
const graphEdges: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
  [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
];
const gN = 10;
const gBx = new Float64Array(gN);
const gBy = new Float64Array(gN);
for (let i = 0; i < gN; i++) {
  gBx[i] = Math.cos((i / gN) * Math.PI * 2);
  gBy[i] = Math.sin((i / gN) * Math.PI * 2);
}
const graphX = shallowRef(gBx.slice());
const graphY = shallowRef(gBy.slice());
push((t) => {
  const x = new Float64Array(gN);
  const y = new Float64Array(gN);
  for (let i = 0; i < gN; i++) {
    x[i] = gBx[i]! + Math.sin(t * 2 + i) * 0.12;
    y[i] = gBy[i]! + Math.cos(t * 2 + i) * 0.12;
  }
  graphX.value = x;
  graphY.value = y;
});

// --- Log axis ----------------------------------------------------------------
const LGN = 200;
const lgX = Float64Array.from({ length: LGN }, (_, i) => (i / LGN) * 10);
const lgTaus = [1.2, 2.5, 5];
const lgColors = ["#f472b6", "#60a5fa", "#34d399"];
const lgY = shallowRef<Float64Array[]>(
  lgTaus.map((tau) => Float64Array.from(lgX, (t) => Math.exp(-t / tau) + 1e-3)),
);
const logOptions = {
  theme: "dark",
  scales: { y: { type: "log" } },
  axes: { x: { title: "t" }, y: { title: "amplitude" } },
} as PlotOptions;
push((t) => {
  lgY.value = lgTaus.map((tau) =>
    Float64Array.from(lgX, (x, i) => Math.exp(-x / tau) * (1 + 0.3 * Math.sin(t * 2 + i * 0.1)) + 1e-3),
  );
});

// --- Time axis ---------------------------------------------------------------
const TAN = 24 * 60;
const taStart = Date.UTC(2024, 0, 1);
const taBufX = new Float64Array(TAN);
const taBufY = new Float64Array(TAN);
for (let i = 0; i < TAN; i++) {
  taBufX[i] = taStart + i * 60_000;
  const hh = i / 60;
  taBufY[i] = 20 + 6 * Math.sin(((hh - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
}
const taX = shallowRef(taBufX.slice());
const taY = shallowRef(taBufY.slice());
const timeOptions = { theme: "dark", scales: { x: { type: "time" } } } as PlotOptions;
let taPh = TAN;
push(() => {
  taBufX.copyWithin(0, 1);
  taBufY.copyWithin(0, 1);
  taPh++;
  taBufX[TAN - 1] = taStart + taPh * 60_000;
  const hh = taPh / 60;
  taBufY[TAN - 1] = 20 + 6 * Math.sin(((hh - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
  taX.value = taBufX.slice();
  taY.value = taBufY.slice();
});

// --- Dual Y ------------------------------------------------------------------
const DYN = 400;
const dyX = Float64Array.from({ length: DYN }, (_, i) => i);
const dyBufA = Float64Array.from({ length: DYN }, (_, i) => Math.sin(i * 0.05) * 1.5);
const dyBufB = Float64Array.from({ length: DYN }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
const dyA = shallowRef(dyBufA.slice());
const dyB = shallowRef(dyBufB.slice());
let dyPh = DYN;
push(() => {
  dyBufA.copyWithin(0, 1);
  dyBufB.copyWithin(0, 1);
  dyPh += 1;
  dyBufA[DYN - 1] = Math.sin(dyPh * 0.05) * 1.5 + jitter() * 0.15;
  dyBufB[DYN - 1] = 25 + Math.sin(dyPh * 0.02) * 6 + jitter() * 0.6;
  dyA.value = dyBufA.slice();
  dyB.value = dyBufB.slice();
});

// --- 1M points (GPU decimation) ---------------------------------------------
const MEG = 1_000_000;
const megX = new Float64Array(MEG);
const megY = new Float64Array(MEG);
for (let i = 0; i < MEG; i++) {
  megX[i] = i;
  megY[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05);
}

// --- Styled + categorical ----------------------------------------------------
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const styledOptions = {
  theme: "dark",
  background: "#0b1220",
  border: "#060a14",
  title: { text: "Quarterly revenue", align: "left" },
  legend: { position: "top-left" },
  scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
  axes: {
    x: { title: "month", labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" },
    y: { title: "revenue", gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] },
  },
  showToolbar: false,
} as PlotOptions;
const styledX = Float64Array.from(months, (_, i) => i);
const styledRevBuf = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
const styledTgtBuf = Float64Array.from(months, () => 70 + rand() * 12);
const styledRev = shallowRef(styledRevBuf.slice());
const styledTgt = shallowRef(styledTgtBuf.slice());
push(() => {
  for (let i = 0; i < months.length; i++) {
    styledRevBuf[i] = Math.max(5, Math.min(105, styledRevBuf[i]! + jitter() * 6));
    styledTgtBuf[i] = Math.max(40, Math.min(100, styledTgtBuf[i]! + jitter() * 3));
  }
  styledRev.value = styledRevBuf.slice();
  styledTgt.value = styledTgtBuf.slice();
});

// ===========================================================================
// Polar
// ===========================================================================
const polarOptions = { theme: "dark", maxRadius: 1 } as const;

// Polar line rose + scatter blips (from the original example)
const PLT = 240;
const polarTheta = Float64Array.from({ length: PLT }, (_, i) => (i / (PLT - 1)) * Math.PI * 2);
const polarRBuf = polarTheta.map((t) => Math.abs(Math.cos(3 * t)));
const polarR = shallowRef(polarRBuf.slice());
const PBL = 12;
const polarScTheta = Float64Array.from({ length: PBL }, () => rand() * Math.PI * 2);
const polarScR = Float64Array.from({ length: PBL }, () => 0.3 + rand() * 0.7);
const polarLabels = Array.from({ length: PBL }, (_, i) => `p${i + 1}`);
push((t) => {
  const k = 3 + 2 * Math.sin(t * 0.3);
  polarR.value = Float64Array.from(polarTheta, (th) => Math.abs(Math.cos(k * th)));
});

// Polar radar — rotating sweep + contacts
const radarOptions = { theme: "dark", angleUnit: "deg", maxRadius: 1 } as const;
const RB = 14;
const radarTheta = Float64Array.from({ length: RB }, () => rand() * 360);
const radarR = Float64Array.from({ length: RB }, () => 0.2 + rand() * 0.75);
const radarLabels = Array.from({ length: RB }, (_, i) => `Contact ${i + 1}`);
const sweepTheta = shallowRef<number[]>([0, 0]);
const sweepR = [0, 1];
let radarAng = 0;
push(() => {
  radarAng = (radarAng + 2.5) % 360;
  sweepTheta.value = [radarAng, radarAng];
});

// ===========================================================================
// 3D — the wrapper's 3D layers add-on-mount only (no per-frame setData), so in
// the Dynamic tab we give them motion via autoRotate on the Plot3D itself.
// ===========================================================================
function opts3d(extra: Record<string, unknown>): Plot3DOptions {
  return { ...extra, autoRotate: dyn } as Plot3DOptions;
}

// 3D surface (sinc)
const S3C = 64;
const S3R = 64;
const surfValues = new Float64Array(S3C * S3R);
for (let r = 0; r < S3R; r++)
  for (let c = 0; c < S3C; c++) {
    const xx = (c / S3C) * 8 - 4;
    const yy = (r / S3R) * 8 - 4;
    const rr = Math.hypot(xx, yy) + 1e-6;
    surfValues[r * S3C + c] = (Math.sin(rr * 2) / rr) * 3;
  }

// 3D bars
const B3G = 8;
const b3x: number[] = [];
const b3z: number[] = [];
for (let i = 0; i < B3G; i++) for (let j = 0; j < B3G; j++) { b3x.push(i); b3z.push(j); }
const b3y = new Float64Array(b3x.length);
for (let k = 0; k < b3x.length; k++) b3y[k] = 1.5 + Math.sin(b3x[k]! * 0.6) * Math.cos(b3z[k]! * 0.6) * 1.5;

// 3D lines (two helices)
const L3N = 400;
function helix3d(phase: number) {
  const x = new Float64Array(L3N);
  const y = new Float64Array(L3N);
  const z = new Float64Array(L3N);
  for (let i = 0; i < L3N; i++) {
    const tt = (i / (L3N - 1)) * Math.PI * 2 * 4;
    x[i] = Math.cos(tt + phase);
    z[i] = Math.sin(tt + phase);
    y[i] = (i / (L3N - 1)) * 4 - 2;
  }
  return { x, y, z };
}
const helixA = helix3d(0);
const helixB = helix3d(Math.PI);

// 3D quiver
const Q3G = 6;
const q3x: number[] = [];
const q3y: number[] = [];
const q3z: number[] = [];
for (let i = 0; i < Q3G; i++)
  for (let j = 0; j < Q3G; j++)
    for (let k = 0; k < Q3G; k++) {
      q3x.push((i / (Q3G - 1)) * 2 - 1);
      q3y.push((j / (Q3G - 1)) * 2 - 1);
      q3z.push((k / (Q3G - 1)) * 2 - 1);
    }
const q3u = new Float64Array(q3x.length);
const q3v = new Float64Array(q3x.length);
const q3w = new Float64Array(q3x.length);
for (let k = 0; k < q3x.length; k++) {
  q3u[k] = -q3y[k]!;
  q3v[k] = q3x[k]!;
  q3w[k] = q3z[k]! * 0.3;
}

// 3D contour
const C3C = 50;
const C3R = 50;
const cont3Values = new Float64Array(C3C * C3R);
for (let r = 0; r < C3R; r++)
  for (let c = 0; c < C3C; c++) {
    const xx = (c / C3C) * 8 - 4;
    const yy = (r / C3R) * 8 - 4;
    const rr = Math.hypot(xx, yy) + 1e-6;
    cont3Values[r * C3C + c] = (Math.sin(rr * 1.5) / rr) * 3;
  }

// 3D isosurface (metaballs)
const ISN = 40;
const isoVol = new Float64Array(ISN * ISN * ISN);
{
  const blobs = [
    [-0.5, 0, 0],
    [0.6, 0.3, -0.2],
    [0.1, -0.5, 0.4],
  ];
  for (let z = 0; z < ISN; z++)
    for (let y = 0; y < ISN; y++)
      for (let x = 0; x < ISN; x++) {
        const px = (x / (ISN - 1)) * 2 - 1;
        const py = (y / (ISN - 1)) * 2 - 1;
        const pz = (z / (ISN - 1)) * 2 - 1;
        let s = 0;
        for (const b of blobs) {
          const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2;
          s += Math.exp(-d2 * 6);
        }
        isoVol[x + y * ISN + z * ISN * ISN] = s;
      }
}
const isoExtent = { x: [-1, 1], y: [-1, 1], z: [-1, 1] } as const;

// 3D scatter
const SC3 = 300;
const sc3x = new Float64Array(SC3);
const sc3y = new Float64Array(SC3);
const sc3z = new Float64Array(SC3);
const sc3sizes = new Float64Array(SC3);
const sc3vals = new Float64Array(SC3);
const sc3labels: string[] = [];
for (let i = 0; i < SC3; i++) {
  sc3x[i] = gaussian(0, 1);
  sc3y[i] = gaussian(0, 1);
  sc3z[i] = gaussian(0, 1);
  const r = Math.hypot(sc3x[i]!, sc3y[i]!, sc3z[i]!);
  sc3sizes[i] = 3 + r * 6;
  sc3vals[i] = r;
  sc3labels.push(`p${i} · r=${r.toFixed(2)}`);
}
const sc3ColorBy = { values: sc3vals, colormap: "plasma" as const };

// 3D volume (raymarched blobs)
const V3N = 48;
const volVol = new Float64Array(V3N * V3N * V3N);
{
  const blobs = [
    [-0.4, 0, 0],
    [0.5, 0.3, -0.2],
    [0.1, -0.4, 0.4],
  ];
  for (let z = 0; z < V3N; z++)
    for (let y = 0; y < V3N; y++)
      for (let x = 0; x < V3N; x++) {
        const px = (x / (V3N - 1)) * 2 - 1;
        const py = (y / (V3N - 1)) * 2 - 1;
        const pz = (z / (V3N - 1)) * 2 - 1;
        let s = 0;
        for (const b of blobs) {
          const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2;
          s += Math.exp(-d2 * 5);
        }
        volVol[x + y * V3N + z * V3N * V3N] = s;
      }
}

// 3D point cloud (colored helix)
const PC3 = 6000;
const pc3x = new Float64Array(PC3);
const pc3y = new Float64Array(PC3);
const pc3z = new Float64Array(PC3);
for (let i = 0; i < PC3; i++) {
  const th = (i / PC3) * Math.PI * 20;
  const rr = 1 + (i / PC3) * 2;
  pc3x[i] = Math.cos(th) * rr + gaussian(0, 0.1);
  pc3z[i] = Math.sin(th) * rr + gaussian(0, 0.1);
  pc3y[i] = (i / PC3) * 4 - 2 + gaussian(0, 0.05);
}
const pc3ColorBy = { values: pc3y, colormap: "plasma" as const };

// ===========================================================================
// Dynamic-only: linked finance dashboard (candles + volume, ordinal-time,
// crosshair/pan/zoom joined with linkX). The @photonviz/vue <Plot> keeps its
// core plot private, so this one demo is built against @photonviz/core directly
// (updateLast streams the forming bar; linkX joins the two panes).
// ===========================================================================
const priceEl = ref<HTMLDivElement | null>(null);
const volEl = ref<HTMLDivElement | null>(null);
let pricePlot: CorePlot | null = null;
let volPlot: CorePlot | null = null;
let detachLink: (() => void) | null = null;

function buildLinkedFinance(): void {
  if (!priceEl.value || !volEl.value) return;
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

  pricePlot = new CorePlot(priceEl.value, {
    theme: "dark",
    scales: { x: { type: "ordinal-time", times } },
    showToolbar: false,
  });
  const candle = pricePlot.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });

  volPlot = new CorePlot(volEl.value, {
    theme: "dark",
    scales: { x: { type: "ordinal-time", times }, y: { domain: [0, 80] } },
    showToolbar: false,
  });
  const volBar = volPlot.addBar({ x: idx, y: vol, width: 0.7, color: "#38bdf8", renderType: "dynamic" });

  detachLink = linkX([pricePlot, volPlot]);

  let curOpen = c[N - 1]!;
  let curClose = curOpen;
  let hi = curOpen;
  let lo = curOpen;
  let curVol = vol[N - 1]!;
  let sinceClose = 0;
  updaters.push(() => {
    curClose += gaussian(0, 0.3);
    hi = Math.max(hi, curClose);
    lo = Math.min(lo, curClose);
    curVol = Math.max(5, curVol + jitter() * 3);
    candle.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
    vol[N - 1] = curVol;
    volBar.setData(idx, vol);
    pricePlot!.render();
    volPlot!.render();
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
      candle.setData({ x: idx, open: o, high: h, low: l, close: c });
    }
  });
}

// ===========================================================================
// Lifecycle
// ===========================================================================
function tick(): void {
  if (destroyed) return; // never touch GL after teardown began
  frame++;
  const t = frame / 60;
  for (const u of updaters) u(t);
  raf = requestAnimationFrame(tick);
}
onMounted(() => {
  if (dyn) {
    buildLinkedFinance();
    raf = requestAnimationFrame(tick);
  }
});
onUnmounted(() => {
  // Stop the animation loop SYNCHRONOUSLY before any plot is disposed, so no
  // queued frame or updater can render into a destroyed WebGL context.
  destroyed = true;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  updaters.length = 0;
  detachLink?.();
  detachLink = null;
  pricePlot?.destroy();
  pricePlot = null;
  volPlot?.destroy();
  volPlot = null;
});
</script>

<template>
  <div class="grid">
    <!-- Line -->
    <Panel title="Line" :subtitle="dynamic ? 'live · scrolling' : 'sine sum'" :fps="dynamic">
      <Plot :options="dark">
        <Line :x="lineX" :y="lineY" color="#34d399" :width="2" :decimate="false" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Signals -->
    <Panel title="Signals" subtitle="3 channels" :fps="dynamic">
      <Plot :options="dark">
        <Line
          v-for="(y, i) in sigY"
          :key="i"
          :x="sigX"
          :y="y"
          :color="sigColors[i]"
          :width="1.5"
          :decimate="false"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Scatter -->
    <Panel title="Scatter" :subtitle="dynamic ? 'drifting cloud' : 'gaussian cloud'" :fps="dynamic">
      <Plot :options="dark">
        <Scatter :x="scX" :y="scY" :size="5" color="#818cf8" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Scatter markers -->
    <Panel title="Scatter markers" subtitle="6 glyph shapes" :fps="dynamic">
      <Plot :options="dark">
        <Scatter
          v-for="(y, r) in mkY"
          :key="r"
          :x="mkX"
          :y="y"
          :size="14"
          :marker="shapes[r]"
          :color="mkColors[r]"
          :name="shapes[r]"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Scatter · colorBy -->
    <Panel title="Scatter · colorBy" subtitle="value → viridis" :fps="dynamic">
      <Plot :options="dark">
        <Scatter :x="cbX" :y="cbY" :size="6" :color-by="cbColorBy" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Bars -->
    <Panel title="Bars" :subtitle="dynamic ? 'fluctuating' : 'categorical'" :fps="dynamic">
      <Plot :options="dark">
        <Bar :x="barX" :y="barY" :width="0.7" color="#22d3ee" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Grouped bars -->
    <Panel title="Grouped bars" subtitle="2 series" :fps="dynamic">
      <Plot :options="dark">
        <Bar :x="gbX" :y="gbY1" :width="0.38" :offset="-0.2" color="#22d3ee" name="A" :render-type="rtype" />
        <Bar :x="gbX" :y="gbY2" :width="0.38" :offset="0.2" color="#f472b6" name="B" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Stacked bars -->
    <Panel title="Stacked bars" subtitle="cumulative" :fps="dynamic">
      <Plot :options="{ theme: 'dark', legend: { position: 'top-left' }, scales: { x: { type: 'categorical', factors: sbCats } }, showToolbar: false }">
        <Bar
          v-for="(top, i) in sbTop"
          :key="i"
          :x="sbX"
          :y="top"
          :base="sbBase[i]"
          :width="0.6"
          :color="sbColors[i]"
          :name="sbNames[i]"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Horizontal bars -->
    <Panel title="Horizontal bars" subtitle="hbar · categorical y" :fps="dynamic">
      <Plot :options="{ theme: 'dark', scales: { y: { type: 'categorical', factors: hbCats }, x: { domain: [0, 100] } }, showToolbar: false }">
        <Bar :x="hbX" :y="hbY" :width="0.6" orientation="h" color="#34d399" name="score" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Area -->
    <Panel title="Area" :subtitle="dynamic ? 'streaming' : 'filled'" :fps="dynamic">
      <Plot :options="dark">
        <Area :x="areaX" :y="areaY" color="rgba(52,211,153,0.45)" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Stacked area -->
    <Panel title="Stacked area" subtitle="cumulative bands" :fps="dynamic">
      <Plot :options="{ theme: 'dark', showToolbar: false }">
        <Area
          v-for="(top, i) in saTop"
          :key="i"
          :x="saX"
          :y="top"
          :base="saBase[i]"
          :color="saColors[i]"
          :name="'abc'[i]"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Step line -->
    <Panel title="Step line" subtitle="staircase · step:after" :fps="dynamic">
      <Plot :options="dark">
        <Line :x="stepX" :y="stepY" color="#fbbf24" :width="2.5" step="after" join="miter" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Line joins -->
    <Panel title="Line joins" subtitle="miter · bevel · round" :fps="dynamic">
      <Plot :options="dark">
        <Line
          v-for="(y, k) in joinY"
          :key="k"
          :x="joinX"
          :y="y"
          :color="joinColors[k]"
          :width="8"
          :join="joins[k]"
          :name="joins[k]"
          :decimate="false"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Histogram -->
    <Panel title="Histogram" subtitle="gaussian · 30 bins" :fps="dynamic">
      <Plot :options="dark">
        <Bar :x="histCenters" :y="histY" :width="hBw * 0.98" color="#34d399" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Box -->
    <Panel title="Box plot" subtitle="Tukey · outliers" :fps="dynamic">
      <Plot :options="dark">
        <Box :groups="boxGroups" :width="0.6" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Heatmap -->
    <Panel title="Heatmap" subtitle="texture · viridis" :fps="dynamic">
      <Plot :options="dark">
        <Heatmap :values="heatValues" :cols="HC" :rows="HR" :extent="heatExtent" colormap="viridis" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Contour -->
    <Panel title="Contour" subtitle="marching squares" :fps="dynamic">
      <Plot :options="dark">
        <Contour :values="contValues" :cols="CC" :rows="CR" :extent="contExtent" :levels="12" colormap="viridis" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Spectrogram -->
    <Panel title="Spectrogram" :subtitle="dynamic ? 'waterfall' : 'STFT · plasma'" :fps="dynamic">
      <Plot :options="dark">
        <Heatmap :values="specValues" :cols="SPC" :rows="SPR" :extent="specExtent" colormap="plasma" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Hexbin -->
    <Panel title="Hexbin" subtitle="25k points · density" :fps="dynamic">
      <Plot :options="dark">
        <Hexbin :x="hxX" :y="hxY" :radius="0.22" colormap="plasma" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Error bars -->
    <Panel title="Error bars" subtitle="whiskers + caps" :fps="dynamic">
      <Plot :options="dark">
        <Line :x="ebX" :y="ebY" color="#60a5fa" :width="1.5" :render-type="rtype" />
        <ErrorBar :x="ebX" :y="ebY" :yerr="ebErr" color="#60a5fa" :cap-size="7" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Error band -->
    <Panel title="Error band" subtitle="confidence ribbon" :fps="dynamic">
      <Plot :options="dark">
        <ErrorBar :x="bbX" :y="bbY" :yerr="bbErr" color="#a78bfa" :band="true" :whiskers="false" :band-opacity="0.28" :render-type="rtype" />
        <Line :x="bbX" :y="bbY" color="#a78bfa" :width="2" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Stem -->
    <Panel title="Stem plot" subtitle="discrete signal" :fps="dynamic">
      <Plot :options="dark">
        <Stem :x="stemX" :y="stemY" color="#34d399" :marker-size="6" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Quiver -->
    <Panel title="Quiver" subtitle="vector field" :fps="dynamic">
      <Plot :options="dark">
        <Quiver :x="qX" :y="qY" :u="qU" :v="qV" :color-by="qColorBy" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Candlestick -->
    <Panel title="Candlestick" :subtitle="dynamic ? 'OHLC · streaming' : 'OHLC · daily'" :fps="dynamic">
      <Plot :options="timeOptions">
        <Candlestick :x="cs.x" :open="cs.o" :high="csHigh" :low="csLow" :close="csClose" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- OHLC -->
    <Panel title="OHLC" :subtitle="dynamic ? 'bars · streaming' : 'bars · daily'" :fps="dynamic">
      <Plot :options="timeOptions">
        <Ohlc :x="ol.x" :open="ol.o" :high="olHigh" :low="olLow" :close="olClose" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Ordinal-time candlestick -->
    <Panel title="Ordinal-time axis" subtitle="sessions · weekend gaps collapse" :fps="dynamic">
      <Plot :options="otOptions">
        <Candlestick :x="otIdx" :open="ot.o" :high="otHigh" :low="otLow" :close="otClose" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Pie -->
    <Panel title="Pie" subtitle="market share" :fps="dynamic">
      <Plot :options="pieNoAxis">
        <Pie :values="pieVals" colormap="viridis" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Donut -->
    <Panel title="Donut" subtitle="categories" :fps="dynamic">
      <Plot :options="pieNoAxis">
        <Pie :values="donutVals" :inner-radius="0.55" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Patches -->
    <Panel title="Patches" subtitle="polygons · choropleth" :fps="dynamic">
      <Plot :options="{ theme: 'dark', showToolbar: false }">
        <Patches :patches="patches" colormap="plasma" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Annotations -->
    <Panel title="Annotations" subtitle="span · band · box · label" :fps="dynamic">
      <Plot :options="{ theme: 'dark', showToolbar: false }">
        <Line :x="annX" :y="annY" color="#38bdf8" :width="2" :render-type="rtype" />
        <Annotation type="band" dim="y" :from="6" :to="8" color="rgba(52,211,153,0.15)" />
        <Annotation type="span" dim="y" :value="5" color="#f59e0b" :dash="[5, 4]" />
        <Annotation type="span" dim="x" :value="50" color="#f472b6" :dash="[5, 4]" />
        <Annotation type="box" :x="[20, 35]" :y="[2, 4]" border="#a78bfa" />
        <Annotation type="label" :x="52" :y="9" text="event" color="#f472b6" />
      </Plot>
    </Panel>

    <!-- Image -->
    <Panel title="Image" subtitle="RGBA glyph · textured quad" :fps="dynamic">
      <Plot :options="{ theme: 'dark', showToolbar: false }">
        <Image :source="imgSource" :extent="imgExtent" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Graph -->
    <Panel title="Graph" subtitle="nodes + edges" :fps="dynamic">
      <Plot :options="{ theme: 'dark', showToolbar: false, equalAspect: true }">
        <Graph
          :x="graphX"
          :y="graphY"
          :edges="graphEdges"
          node-color="#38bdf8"
          edge-color="rgba(148,163,184,0.4)"
          :node-size="13"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Log axis -->
    <Panel title="Log axis" subtitle="exp decay · log y" :fps="dynamic">
      <Plot :options="logOptions">
        <Line
          v-for="(y, k) in lgY"
          :key="k"
          :x="lgX"
          :y="y"
          :color="lgColors[k]"
          :width="1.5"
          :name="`τ=${lgTaus[k]}`"
          :decimate="false"
          :render-type="rtype"
        />
      </Plot>
    </Panel>

    <!-- Time axis -->
    <Panel title="Time axis" subtitle="1 day · date ticks" :fps="dynamic">
      <Plot :options="timeOptions">
        <Line :x="taX" :y="taY" color="#22d3ee" :width="1.5" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Dual Y -->
    <Panel title="Dual Y" subtitle="two scales" :fps="dynamic">
      <Plot :options="{ theme: 'dark', axes: { y: { title: 'amp' } } }">
        <YAxis id="temp" side="right" color="#f472b6" title="temp" :domain="[15, 35]" />
        <Line :x="dyX" :y="dyA" color="#60a5fa" :width="1.5" :decimate="false" :render-type="rtype" />
        <Line :x="dyX" :y="dyB" color="#f472b6" :width="1.5" y-axis="temp" :decimate="false" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- 1M points -->
    <Panel title="1M points" subtitle="GPU min/max decimation" :fps="dynamic">
      <Plot :options="dark">
        <Line :x="megX" :y="megY" color="#34d399" :width="1.5" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Styled + categorical -->
    <Panel title="Styled + categorical" subtitle="bg · title · legend · rotated ticks" :fps="dynamic">
      <Plot :options="styledOptions">
        <Bar :x="styledX" :y="styledRev" :width="0.6" color="#38bdf8" name="revenue" :render-type="rtype" />
        <Line :x="styledX" :y="styledTgt" color="#f59e0b" :width="2.5" name="target" :render-type="rtype" />
      </Plot>
    </Panel>

    <!-- Polar rose + scatter -->
    <Panel title="Polar" subtitle="line rose + scatter" :fps="dynamic">
      <PolarPlot :options="polarOptions">
        <PolarLine :theta="polarTheta" :r="polarR" color="#a78bfa" :width="2" :closed="true" />
        <PolarScatter :theta="polarScTheta" :r="polarScR" color="#f472b6" :size="6" :labels="polarLabels" />
      </PolarPlot>
    </Panel>

    <!-- Polar radar -->
    <Panel title="Polar radar" subtitle="rotating sweep" :fps="dynamic">
      <PolarPlot :options="radarOptions">
        <PolarLine :theta="sweepTheta" :r="sweepR" color="#22d3ee" :width="2" />
        <PolarScatter :theta="radarTheta" :r="radarR" color="#f472b6" :size="6" :labels="radarLabels" />
      </PolarPlot>
    </Panel>

    <!-- 3D surface -->
    <Panel title="3D surface" subtitle="sinc · lit" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'z', z: 'y' }, lightControls: true, title: 'Sinc surface' })">
        <Surface :values="surfValues" :cols="S3C" :rows="S3R" :extent-x="[-4, 4]" :extent-z="[-4, 4]" colormap="viridis" :render-type="rtype" />
      </Plot3D>
    </Panel>

    <!-- 3D bars -->
    <Panel title="3D bars" subtitle="colormapped · lit" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'value', z: 'z' }, title: 'Bar field' })">
        <Bar3D :x="b3x" :z="b3z" :y="b3y" :color-by="{ colormap: 'plasma' }" name="value" :render-type="rtype" />
      </Plot3D>
    </Panel>

    <!-- 3D lines -->
    <Panel title="3D lines" subtitle="paths · legend" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'y', z: 'z' }, legend: true })">
        <Line3D :x="helixA.x" :y="helixA.y" :z="helixA.z" color="#38bdf8" name="α" />
        <Line3D :x="helixB.x" :y="helixB.y" :z="helixB.z" color="#f472b6" name="β" />
      </Plot3D>
    </Panel>

    <!-- 3D quiver -->
    <Panel title="3D quiver" subtitle="vector field · colorbar" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'y', z: 'z' } })">
        <Quiver3D :x="q3x" :y="q3y" :z="q3z" :u="q3u" :v="q3v" :w="q3w" :scale="0.4" :color-by="{ colormap: 'viridis' }" name="speed" :render-type="rtype" />
      </Plot3D>
    </Panel>

    <!-- 3D contour -->
    <Panel title="3D contour" subtitle="iso-height rings" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'z', z: 'y' }, title: 'Contour' })">
        <Contour3D :values="cont3Values" :cols="C3C" :rows="C3R" :extent-x="[-4, 4]" :extent-z="[-4, 4]" :levels="14" colormap="viridis" name="height" :render-type="rtype" />
      </Plot3D>
    </Panel>

    <!-- 3D isosurface -->
    <Panel title="3D isosurface" subtitle="marching cubes · metaballs" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'y', z: 'z' }, title: 'Isosurface' })">
        <Isosurface :values="isoVol" :dims="[ISN, ISN, ISN]" :iso-level="0.5" :extent="isoExtent" color="#38bdf8" name="blob" :render-type="rtype" />
      </Plot3D>
    </Panel>

    <!-- 3D scatter -->
    <Panel title="3D scatter" subtitle="per-point size · labels" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'y', z: 'z' } })">
        <PointCloud :x="sc3x" :y="sc3y" :z="sc3z" :sizes="sc3sizes" :labels="sc3labels" :color-by="sc3ColorBy" name="r" />
      </Plot3D>
    </Panel>

    <!-- 3D volume -->
    <Panel title="3D volume" subtitle="raymarch · auto-rotate" :fps="dynamic">
      <Plot3D :options="{ axisLabels: { x: 'x', y: 'y', z: 'z' }, title: 'Volume', autoRotate: true }">
        <Volume :values="volVol" :dims="[V3N, V3N, V3N]" :extent="isoExtent" colormap="plasma" :density="1.3" name="density" :render-type="rtype" />
      </Plot3D>
    </Panel>

    <!-- 3D point cloud -->
    <Panel title="3D point cloud" subtitle="colored by height" :fps="dynamic">
      <Plot3D :options="opts3d({ axisLabels: { x: 'x', y: 'height', z: 'z' } })">
        <PointCloud :x="pc3x" :y="pc3y" :z="pc3z" :size="4" :color-by="pc3ColorBy" />
      </Plot3D>
    </Panel>

    <!-- Dynamic-only: linked finance dashboard (built against @photonviz/core) -->
    <template v-if="dynamic">
      <Panel title="Linked finance · price" subtitle="candlesticks · ordinal-time" :fps="true">
        <div ref="priceEl" style="position: relative; width: 100%; height: 100%"></div>
      </Panel>
      <Panel title="Linked finance · volume" subtitle="linkX-ed pane" :fps="true">
        <div ref="volEl" style="position: relative; width: 100%; height: 100%"></div>
      </Panel>
    </template>
  </div>
</template>
