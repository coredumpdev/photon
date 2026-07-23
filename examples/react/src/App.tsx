import {
  linkX,
  type Plot as CorePlot,
  type Plot3D as CorePlot3D,
  type PolarPlot as CorePolarPlot,
  type Plot3DOptions,
  type PlotOptions,
  type PolarOptions,
} from "@photonviz/core";
import {
  lonLatToWorld,
  pmtilesSource,
  protomapsStyle,
  worldToLonLat,
  xyzVectorSource,
  type MapStyle,
} from "@photonviz/map";
import { worldCountries } from "@photonviz/map/world";
import {
  Annotation,
  Area,
  Bar,
  Bar3D,
  Box,
  Candlestick,
  Contour,
  Contour3D,
  ErrorBar,
  GeoJson,
  Graph,
  Heatmap,
  Hexbin,
  Image,
  Isosurface,
  Line,
  Line3D,
  Map,
  Ohlc,
  Patches,
  Pie,
  Plot,
  Plot3D,
  PointCloud,
  PolarLine,
  PolarPlot,
  PolarScatter,
  Quiver,
  Quiver3D,
  Scatter,
  Stem,
  Surface,
  Volume,
  YAxis,
  usePlot,
  usePlot3D,
  usePolarPlot,
} from "@photonviz/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";

// ============================================================================
// Shared helpers — seeded RNG (so every reload draws identical synthetic data),
// business-day timestamps for the ordinal-time axis, and a throttle wrapper.
// ============================================================================
type Pair = [number, number];
type Updater = (t: number, frame: number) => void;

function makeRng(seed: number) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const gaussian = (m: number, sd: number) => {
    const u = rand() || 1e-9;
    const v = rand() || 1e-9;
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { rand, gaussian };
}

const jitter = () => Math.random() - 0.5;

/** Only run `fn` every `k` frames (for expensive per-frame rebuilds). */
const every =
  (k: number, fn: (t: number) => void): Updater =>
  (t, f) => {
    if (f % k === 0) fn(t);
  };

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
// Styling (dark theme, mirrors the vanilla reference).
// ============================================================================
const S: Record<string, CSSProperties> = {
  main: { background: "#0b1020", minHeight: "100vh", color: "#cbd5e1", fontFamily: "system-ui, -apple-system, sans-serif" },
  header: { padding: "16px 20px 4px" },
  h1: { margin: 0, fontSize: 18 },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#94a3b8", maxWidth: 900 },
  tabs: { display: "flex", gap: 6, padding: "12px 20px 0" },
  tabLine: { height: 1, background: "#1e293b", margin: "0 20px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
    gap: 14,
    padding: "16px 20px 40px",
  },
  panel: {
    position: "relative",
    border: "1px solid #1e293b",
    borderRadius: 10,
    background: "#0e1526",
    overflow: "hidden",
  },
  panelH: {
    margin: 0,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 600,
    color: "#e2e8f0",
    borderBottom: "1px solid #1e293b",
  },
  panelSub: { color: "#64748b", fontWeight: 400 },
  chartBox: { position: "relative", height: 260 },
  fps: {
    position: "absolute",
    top: 6,
    left: 8,
    zIndex: 5,
    padding: "2px 7px",
    borderRadius: 6,
    font: "600 11px ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#e2e8f0",
    background: "rgba(14,21,38,.7)",
    border: "1px solid #1e293b",
    pointerEvents: "none",
    fontVariantNumeric: "tabular-nums",
  },
  cap: {
    position: "absolute",
    right: 6,
    bottom: 6,
    zIndex: 5,
    padding: "2px 7px",
    borderRadius: 6,
    font: "500 10.5px system-ui, sans-serif",
    color: "#cbd5e1",
    background: "rgba(14,21,38,.72)",
    border: "1px solid #1e293b",
    pointerEvents: "none",
    maxWidth: "70%",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  file: { position: "absolute", left: 8, bottom: 8, zIndex: 6, fontSize: 11, color: "#cbd5e1", maxWidth: "60%" },
  fill: { width: "100%", height: "100%" },
  placeholder: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    fontSize: 12,
    color: "#64748b",
  },
};

function tabStyle(activeTab: boolean): CSSProperties {
  return {
    appearance: "none",
    cursor: "pointer",
    font: "600 13px system-ui, sans-serif",
    color: activeTab ? "#e2e8f0" : "#94a3b8",
    background: activeTab ? "#141d33" : "#0e1526",
    border: `1px solid ${activeTab ? "#334155" : "#1e293b"}`,
    borderBottom: "none",
    padding: "8px 16px",
    borderRadius: "8px 8px 0 0",
  };
}

// ============================================================================
// rAF driver — gated by RunningContext so panels on a hidden tab stay idle
// (the Dynamic tab passes `true` only while it is the active tab).
// ============================================================================
const RunningContext = createContext(true);

function useDynRaf(cb: Updater): void {
  const running = useContext(RunningContext);
  const runRef = useRef(running);
  runRef.current = running;
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    let id = 0;
    let frame = 0;
    const loop = () => {
      frame += 1;
      if (runRef.current) cbRef.current(frame / 60, frame);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Absolute top-left FPS badge — measures its own rAF delta (paused when idle). */
function FpsBadge() {
  const running = useContext(RunningContext);
  const runRef = useRef(running);
  runRef.current = running;
  const [txt, setTxt] = useState("— fps");
  useEffect(() => {
    let id = 0;
    let last = 0;
    let avg = 0;
    let paint = 0;
    const loop = (now: number) => {
      if (runRef.current) {
        if (last > 0) {
          const dt = now - last;
          if (dt > 0) {
            const inst = 1000 / dt;
            avg = avg > 0 ? avg * 0.9 + inst * 0.1 : inst;
          }
        }
        if (now - paint > 250) {
          paint = now;
          setTxt(`${Math.round(avg)} fps`);
        }
      }
      last = now;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  return <div style={S.fps}>{txt}</div>;
}

// ============================================================================
// Panel shells.
// ============================================================================
function PanelShell({
  title,
  subtitle,
  fps,
  children,
}: {
  title: string;
  subtitle?: string;
  fps?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={S.panel}>
      <h2 style={S.panelH}>
        {title}
        {subtitle ? <span style={S.panelSub}> — {subtitle}</span> : null}
      </h2>
      <div style={S.chartBox}>
        {fps ? <FpsBadge /> : null}
        {children}
      </div>
    </div>
  );
}

/** Static declarative panel: a PanelShell wrapping a <Plot> with `children` layers. */
function SPanel({
  title,
  subtitle,
  options,
  children,
}: {
  title: string;
  subtitle?: string;
  options?: PlotOptions;
  children: ReactNode;
}) {
  return (
    <PanelShell title={title} subtitle={subtitle}>
      <Plot options={{ theme: "dark", ...options }}>{children}</Plot>
    </PanelShell>
  );
}

// ============================================================================
// Imperative dynamic panels — grab the core Plot via usePlot and drive it with
// setData / updateLast every frame. `setup` runs once the plot mounts and
// returns the per-frame updater. FPS badge overlays each.
// ============================================================================
function DynPlot({
  title,
  subtitle,
  options,
  setup,
}: {
  title: string;
  subtitle: string;
  options?: PlotOptions;
  setup: (p: CorePlot) => Updater | void;
}) {
  const [ref, plot] = usePlot({ theme: "dark", ...options });
  const updater = useRef<Updater | null>(null);
  useEffect(() => {
    if (!plot) return;
    updater.current = setup(plot) ?? null;
    return () => {
      updater.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);
  useDynRaf((t, f) => updater.current?.(t, f));
  return (
    <PanelShell title={title} subtitle={subtitle} fps>
      <div ref={ref} style={S.fill} />
    </PanelShell>
  );
}

function DynPlot3D({
  title,
  subtitle,
  options,
  setup,
}: {
  title: string;
  subtitle: string;
  options?: Plot3DOptions;
  setup: (p: CorePlot3D) => Updater | void;
}) {
  const [ref, plot] = usePlot3D(options);
  const updater = useRef<Updater | null>(null);
  useEffect(() => {
    if (!plot) return;
    updater.current = setup(plot) ?? null;
    return () => {
      updater.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);
  useDynRaf((t, f) => updater.current?.(t, f));
  return (
    <PanelShell title={title} subtitle={subtitle} fps>
      <div ref={ref} style={S.fill} />
    </PanelShell>
  );
}

function DynPolarPlot({
  title,
  subtitle,
  options,
  setup,
}: {
  title: string;
  subtitle: string;
  options?: PolarOptions;
  setup: (p: CorePolarPlot) => Updater | void;
}) {
  const [ref, plot] = usePolarPlot({ theme: "dark", ...options });
  const updater = useRef<Updater | null>(null);
  useEffect(() => {
    if (!plot) return;
    updater.current = setup(plot) ?? null;
    return () => {
      updater.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);
  useDynRaf((t, f) => updater.current?.(t, f));
  return (
    <PanelShell title={title} subtitle={subtitle} fps>
      <div ref={ref} style={S.fill} />
    </PanelShell>
  );
}

// ============================================================================
// STATIC TAB — one panel per chart type, using the declarative React
// components with renderType="static". Full 2D + polar + 3D catalog.
// ============================================================================
function StaticTab() {
  // --- 2D datasets --------------------------------------------------------
  const line = useMemo(() => {
    const N = 600;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
    return { N, x, y };
  }, []);

  const signals = useMemo(() => {
    const N = 500;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const ys = [0, 1, 2].map((k) =>
      Float64Array.from({ length: N }, (_, j) => Math.sin(j * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + k * 0.1),
    );
    return { N, x, ys };
  }, []);

  const scatter = useMemo(() => {
    const { gaussian } = makeRng(11);
    const M = 700;
    const x = new Float64Array(M);
    const y = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      x[i] = gaussian(0, 1);
      y[i] = gaussian(0, 1);
    }
    return { x, y };
  }, []);

  const colorScatter = useMemo(() => {
    const { gaussian } = makeRng(13);
    const M = 1200;
    const x = new Float64Array(M);
    const y = new Float64Array(M);
    const v = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      x[i] = gaussian(0, 1.4);
      y[i] = gaussian(0, 1.4);
      v[i] = Math.hypot(x[i]!, y[i]!);
    }
    return { x, y, v };
  }, []);

  const markers = useMemo(() => {
    const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
    const M = 12;
    const x = Float64Array.from({ length: M }, (_, i) => i);
    return { shapes, M, x };
  }, []);

  const bars = useMemo(() => {
    const { rand } = makeRng(19);
    const K = 9;
    const cats = Float64Array.from({ length: K }, (_, i) => i);
    const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
    return { K, cats, y };
  }, []);

  const grouped = useMemo(() => {
    const { rand } = makeRng(23);
    const cats = ["Q1", "Q2", "Q3", "Q4"];
    const idx = Float64Array.from(cats, (_, i) => i);
    const mk = () => Float64Array.from(cats, () => 20 + rand() * 70);
    return { cats, idx, ys: [mk(), mk(), mk()] };
  }, []);

  const stackedBar = useMemo(() => {
    const { rand } = makeRng(29);
    const cats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const idx = Float64Array.from(cats, (_, i) => i);
    const raw = [10, 8, 6].map((m) => Float64Array.from(cats, () => m + rand() * m));
    // cumulative bases + tops for stacking
    const n = idx.length;
    const cum = new Float64Array(n);
    const tops: Float64Array[] = [];
    const bases: Float64Array[] = [];
    for (const y of raw) {
      const base = Float64Array.from(cum);
      const top = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        top[i] = cum[i]! + y[i]!;
        cum[i] = top[i]!;
      }
      bases.push(base);
      tops.push(top);
    }
    return { cats, idx, tops, bases };
  }, []);

  const hbars = useMemo(() => {
    const { rand } = makeRng(31);
    const cats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    const idx = Float64Array.from(cats, (_, i) => i);
    const vals = Float64Array.from(cats, (_, i) => 30 + i * 12 + rand() * 10);
    return { cats, idx, vals };
  }, []);

  const area = useMemo(() => {
    const N = 400;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
    return { N, x, y };
  }, []);

  const stackedArea = useMemo(() => {
    const N = 120;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const s = (a: number, b: number, c: number) =>
      Float64Array.from({ length: N }, (_, i) => a + Math.sin(i * b + c) * a * 0.4 + a * 0.3);
    const raw = [s(3, 0.05, 0), s(2.5, 0.06, 1), s(2, 0.04, 2)];
    const cum = new Float64Array(N);
    const tops: Float64Array[] = [];
    const bases: Float64Array[] = [];
    for (const y of raw) {
      const base = Float64Array.from(cum);
      const top = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        top[i] = cum[i]! + y[i]!;
        cum[i] = top[i]!;
      }
      bases.push(base);
      tops.push(top);
    }
    return { N, x, tops, bases };
  }, []);

  const step = useMemo(() => {
    const { rand } = makeRng(7);
    const N = 24;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, () => Math.round(rand() * 3));
    return { N, x, y };
  }, []);

  const joins = useMemo(() => {
    const styles = ["miter", "bevel", "round"] as const;
    const x = Float64Array.from({ length: 13 }, (_, i) => i);
    const ys = styles.map((_, k) => Float64Array.from(x, (_, i) => (i % 2 === 0 ? 0 : 1) + k * 2.2));
    return { styles, x, ys };
  }, []);

  const histogram = useMemo(() => {
    const { gaussian } = makeRng(37);
    const bins = 30;
    const lo = -4;
    const hi = 4;
    const bw = (hi - lo) / bins;
    const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
    const counts = new Float64Array(bins);
    for (let i = 0; i < 5000; i++) {
      const b = Math.floor((gaussian(0, 1) - lo) / bw);
      if (b >= 0 && b < bins) counts[b]!++;
    }
    return { centers, counts, bw };
  }, []);

  const boxGroups = useMemo(() => {
    const { gaussian } = makeRng(41);
    const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
    return [0, 1, 2, 3].map((g) => ({
      position: g,
      values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
      color: colors[g],
    }));
  }, []);

  const heatmap = useMemo(() => {
    const cols = 60;
    const rows = 40;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6;
        const yy = (r / rows) * 6;
        values[r * cols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
      }
    return { values, cols, rows, extent: { x: [0, 6] as Pair, y: [0, 6] as Pair } };
  }, []);

  const contour = useMemo(() => {
    const cols = 80;
    const rows = 60;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6 - 3;
        const yy = (r / rows) * 6 - 3;
        values[r * cols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
      }
    return { values, cols, rows, extent: { x: [-3, 3] as Pair, y: [-3, 3] as Pair } };
  }, []);

  const spectro = useMemo(() => {
    // Synthetic chirp magnitude grid (declarative Heatmap stand-in).
    const cols = 120;
    const rows = 128;
    const values = new Float64Array(cols * rows);
    for (let c = 0; c < cols; c++) {
      const peak = (c / cols) * (rows - 1);
      for (let r = 0; r < rows; r++)
        values[r * cols + c] = Math.exp(-((r - peak) ** 2) / 120) + Math.max(0, Math.sin(r * 0.2) * 0.05);
    }
    return { values, cols, rows, extent: { x: [0, 1] as Pair, y: [0, 4000] as Pair } };
  }, []);

  const hexbin = useMemo(() => {
    const { gaussian } = makeRng(43);
    const M = 25_000;
    const x = new Float64Array(M);
    const y = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const blob = i % 2 === 0 ? -1.4 : 1.4;
      x[i] = gaussian(blob, 1);
      y[i] = gaussian(blob * 0.6, 1.1);
    }
    return { x, y };
  }, []);

  const errbar = useMemo(() => {
    const { rand } = makeRng(47);
    const N = 12;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
    const yerr = Float64Array.from({ length: N }, () => 0.4 + rand() * 0.9);
    return { N, x, y, yerr };
  }, []);

  const errband = useMemo(() => {
    const N = 120;
    const x = Float64Array.from({ length: N }, (_, i) => i / 10);
    const y = Float64Array.from(x, (t) => Math.sin(t));
    const err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
    return { x, y, err };
  }, []);

  const stem = useMemo(() => {
    const N = 30;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
    return { N, x, y };
  }, []);

  const quiver = useMemo(() => {
    const G = 16;
    const x: number[] = [];
    const y: number[] = [];
    const u: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < G; i++)
      for (let j = 0; j < G; j++) {
        const px = (i / (G - 1)) * 4 - 2;
        const py = (j / (G - 1)) * 4 - 2;
        x.push(px);
        y.push(py);
        u.push(-py);
        v.push(px);
      }
    return { x, y, u, v };
  }, []);

  const ohlc = useMemo(() => {
    const { gaussian } = makeRng(53);
    const N = 40;
    const start = Date.UTC(2024, 0, 1);
    const stepMs = 86_400_000;
    const x = new Float64Array(N);
    const o = new Float64Array(N);
    const h = new Float64Array(N);
    const l = new Float64Array(N);
    const c = new Float64Array(N);
    let price = 100;
    for (let i = 0; i < N; i++) {
      const open = price;
      const close = open + gaussian(0, 2.2);
      x[i] = start + i * stepMs;
      o[i] = open;
      c[i] = close;
      h[i] = Math.max(open, close) + Math.abs(gaussian(0, 1.1));
      l[i] = Math.min(open, close) - Math.abs(gaussian(0, 1.1));
      price = close;
    }
    return { x, o, h, l, c };
  }, []);

  const ordinal = useMemo(() => {
    const { gaussian } = makeRng(59);
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
    return { times, idx, o, h, l, c };
  }, []);

  const patches = useMemo(() => {
    const { rand } = makeRng(61);
    const cols = 6;
    const rows = 4;
    const out: Array<{ x: number[]; y: number[]; value: number }> = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const j = () => (rand() - 0.5) * 0.22;
        out.push({
          x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
          y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
          value: Math.sin(c * 0.7) + Math.cos(r * 0.9),
        });
      }
    return { cols, rows, patches: out };
  }, []);

  const image = useMemo(() => {
    const iw = 96;
    const ih = 96;
    const id = new ImageData(iw, ih);
    const cx = iw / 2;
    const cy = ih / 2;
    for (let yy = 0; yy < ih; yy++)
      for (let xx = 0; xx < iw; xx++) {
        const i = (yy * iw + xx) * 4;
        const d = Math.hypot(xx - cx, yy - cy) / (iw / 2);
        id.data[i] = Math.round((xx / iw) * 255);
        id.data[i + 1] = Math.round((yy / ih) * 255);
        id.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255);
        id.data[i + 3] = 255;
      }
    return { id };
  }, []);

  const graph = useMemo(() => {
    const edges: Pair[] = [
      [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
      [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
    ];
    const n = 10;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.cos((i / n) * Math.PI * 2);
      y[i] = Math.sin((i / n) * Math.PI * 2);
    }
    return { edges, x, y };
  }, []);

  const logAxis = useMemo(() => {
    const N = 200;
    const x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10);
    const taus = [1.2, 2.5, 5];
    const ys = taus.map((tau) => Float64Array.from(x, (t) => Math.exp(-t / tau) + 1e-3));
    return { x, taus, ys };
  }, []);

  const timeAxis = useMemo(() => {
    const { gaussian } = makeRng(67);
    const start = Date.UTC(2024, 0, 1);
    const N = 24 * 60;
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      x[i] = start + i * 60_000;
      const h = i / 60;
      y[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
    }
    return { x, y };
  }, []);

  const dualY = useMemo(() => {
    const N = 400;
    const x = Float64Array.from({ length: N }, (_, i) => i);
    const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
    const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
    return { N, x, a, b };
  }, []);

  const million = useMemo(() => {
    const { gaussian } = makeRng(71);
    const N = 1_000_000;
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      x[i] = i;
      y[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05);
    }
    return { N, x, y };
  }, []);

  const styled = useMemo(() => {
    const { rand } = makeRng(73);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const idx = Float64Array.from(months, (_, i) => i);
    const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
    const target = Float64Array.from(months, () => 70 + rand() * 12);
    return { months, idx, revenue, target };
  }, []);

  // --- polar datasets -----------------------------------------------------
  const polar = useMemo(() => {
    const { rand } = makeRng(79);
    const B = 14;
    const bt = Float64Array.from({ length: B }, () => rand() * 360);
    const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
    const labels = Array.from({ length: B }, (_, i) => `Contact ${i + 1}`);
    const T = 240;
    const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
    const rose = Float64Array.from(theta, (th) => Math.abs(Math.cos(3 * th)));
    return { bt, br, labels, theta, rose };
  }, []);

  // --- 3D datasets --------------------------------------------------------
  const surface = useMemo(() => {
    const cols = 64;
    const rows = 64;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4;
        const yy = (r / rows) * 8 - 4;
        const rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 2) / rr) * 3;
      }
    return { values, cols, rows, extentX: [-4, 4] as Pair, extentZ: [-4, 4] as Pair };
  }, []);

  const bar3d = useMemo(() => {
    const gx = 8;
    const gz = 8;
    const x: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { x.push(i); z.push(j); }
    const y = new Float64Array(x.length);
    for (let k = 0; k < x.length; k++) y[k] = 1.5 + Math.sin(x[k]! * 0.6) * Math.cos(z[k]! * 0.6) * 1.5;
    return { x, z, y };
  }, []);

  const line3d = useMemo(() => {
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
    return { a: mk(0), b: mk(Math.PI) };
  }, []);

  const wire = useMemo(() => {
    const cols = 40;
    const rows = 40;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4;
        const yy = (r / rows) * 8 - 4;
        const rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 1.5) / rr) * 3;
      }
    return { values, cols, rows, extentX: [-4, 4] as Pair, extentZ: [-4, 4] as Pair };
  }, []);

  const quiver3d = useMemo(() => {
    const g = 6;
    const x: number[] = [];
    const y: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < g; i++)
      for (let j = 0; j < g; j++)
        for (let k = 0; k < g; k++) {
          x.push((i / (g - 1)) * 2 - 1);
          y.push((j / (g - 1)) * 2 - 1);
          z.push((k / (g - 1)) * 2 - 1);
        }
    const u = new Float64Array(x.length);
    const v = new Float64Array(x.length);
    const w = new Float64Array(x.length);
    for (let k = 0; k < x.length; k++) {
      u[k] = -y[k]!;
      v[k] = x[k]!;
      w[k] = z[k]! * 0.3;
    }
    return { x, y, z, u, v, w };
  }, []);

  const contour3d = useMemo(() => {
    const cols = 50;
    const rows = 50;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4;
        const yy = (r / rows) * 8 - 4;
        const rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 1.5) / rr) * 3;
      }
    return { values, cols, rows, extentX: [-4, 4] as Pair, extentZ: [-4, 4] as Pair };
  }, []);

  const iso = useMemo(() => {
    const n = 40;
    const vol = new Float64Array(n * n * n);
    const blobs = [
      [-0.5, 0, 0],
      [0.6, 0.3, -0.2],
      [0.1, -0.5, 0.4],
    ];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const px = (x / (n - 1)) * 2 - 1;
          const py = (y / (n - 1)) * 2 - 1;
          const pz = (z / (n - 1)) * 2 - 1;
          let s = 0;
          for (const b of blobs) {
            const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2;
            s += Math.exp(-d2 * 6);
          }
          vol[x + y * n + z * n * n] = s;
        }
    return { vol, dims: [n, n, n] as [number, number, number] };
  }, []);

  const scatter3d = useMemo(() => {
    const { gaussian } = makeRng(83);
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
      const r = Math.hypot(x[i]!, y[i]!, z[i]!);
      sizes[i] = 3 + r * 6;
      vals[i] = r;
      labels.push(`p${i} · r=${r.toFixed(2)}`);
    }
    return { x, y, z, sizes, vals, labels };
  }, []);

  const volume = useMemo(() => {
    const n = 48;
    const vol = new Float64Array(n * n * n);
    const blobs = [
      [-0.4, 0, 0],
      [0.5, 0.3, -0.2],
      [0.1, -0.4, 0.4],
    ];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const px = (x / (n - 1)) * 2 - 1;
          const py = (y / (n - 1)) * 2 - 1;
          const pz = (z / (n - 1)) * 2 - 1;
          let s = 0;
          for (const b of blobs) {
            const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2;
            s += Math.exp(-d2 * 5);
          }
          vol[x + y * n + z * n * n] = s;
        }
    return { vol, dims: [n, n, n] as [number, number, number] };
  }, []);

  const cloud = useMemo(() => {
    const N = 6000;
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    const z = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 20;
      const rr = 1 + (i / N) * 2;
      x[i] = Math.cos(th) * rr;
      z[i] = Math.sin(th) * rr;
      y[i] = (i / N) * 4 - 2;
    }
    return { x, y, z };
  }, []);

  const colors3 = ["#60a5fa", "#f472b6", "#fbbf24"];
  const groupColors = ["#38bdf8", "#f472b6", "#a3e635"];
  const groupNames = ["north", "south", "west"];
  const stackColors = ["#22d3ee", "#818cf8", "#fbbf24"];
  const stackNames = ["email", "social", "direct"];
  const areaColors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
  const joinColors = ["#f472b6", "#60a5fa", "#34d399"];
  const markerColors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];

  return (
    <div style={S.grid}>
      <SPanel title="Line" subtitle="sine sum" options={{ scales: { x: { domain: [0, line.N - 1] }, y: { domain: [-2.6, 2.6] } } }}>
        <Line x={line.x} y={line.y} color="#34d399" width={2} decimate={false} renderType="static" />
      </SPanel>

      <SPanel title="Signals" subtitle="3 channels" options={{ scales: { x: { domain: [0, signals.N - 1] }, y: { domain: [-3.5, 3.5] } } }}>
        {signals.ys.map((y, k) => (
          <Line key={k} x={signals.x} y={y} color={colors3[k]} width={1.5} decimate={false} renderType="static" />
        ))}
      </SPanel>

      <SPanel title="Scatter" subtitle="gaussian cloud" options={{ scales: { x: { domain: [-4, 4] }, y: { domain: [-4, 4] } } }}>
        <Scatter x={scatter.x} y={scatter.y} size={5} color="#818cf8" renderType="static" />
      </SPanel>

      <SPanel title="Scatter markers" subtitle="6 glyph shapes" options={{ showToolbar: false, scales: { x: { domain: [-1, markers.M] }, y: { domain: [-1, markers.shapes.length] } } }}>
        {markers.shapes.map((mk, r) => (
          <Scatter
            key={mk}
            x={markers.x}
            y={Float64Array.from({ length: markers.M }, () => markers.shapes.length - 1 - r)}
            size={14}
            marker={mk}
            color={markerColors[r]}
            name={mk}
            renderType="static"
          />
        ))}
      </SPanel>

      <SPanel title="Scatter · colorBy" subtitle="value → viridis" options={{ scales: { x: { domain: [-5, 5] }, y: { domain: [-5, 5] } } }}>
        <Scatter x={colorScatter.x} y={colorScatter.y} size={6} colorBy={{ values: colorScatter.v, colormap: "viridis" }} renderType="static" />
      </SPanel>

      <SPanel title="Bars" subtitle="categorical" options={{ scales: { x: { domain: [-0.6, bars.K - 0.4] }, y: { domain: [0, 100] } } }}>
        <Bar x={bars.cats} y={bars.y} width={0.7} color="#22d3ee" renderType="static" />
      </SPanel>

      <SPanel title="Grouped bars" subtitle="categorical · 3 series" options={{ showToolbar: false, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: grouped.cats }, y: { domain: [0, 100] } } }}>
        {grouped.ys.map((y, k) => (
          <Bar key={k} x={grouped.idx} y={y} width={0.25} offset={(k - 1) * 0.26} color={groupColors[k]} name={groupNames[k]} renderType="static" />
        ))}
      </SPanel>

      <SPanel title="Stacked bars" subtitle="categorical · cumulative" options={{ showToolbar: false, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: stackedBar.cats } } }}>
        {stackedBar.tops.map((top, k) => (
          <Bar key={k} x={stackedBar.idx} y={top} base={stackedBar.bases[k]} width={0.6} color={stackColors[k]} name={stackNames[k]} renderType="static" />
        ))}
      </SPanel>

      <SPanel title="Horizontal bars" subtitle="hbar · categorical y" options={{ showToolbar: false, scales: { y: { type: "categorical", factors: hbars.cats }, x: { domain: [0, 100] } } }}>
        <Bar x={hbars.idx} y={hbars.vals} width={0.6} orientation="h" color="#34d399" name="score" renderType="static" />
      </SPanel>

      <SPanel title="Area" subtitle="filled" options={{ scales: { x: { domain: [0, area.N - 1] }, y: { domain: [0, 4] } } }}>
        <Area x={area.x} y={area.y} color="rgba(52,211,153,0.45)" renderType="static" />
      </SPanel>

      <SPanel title="Stacked area" subtitle="cumulative bands" options={{ showToolbar: false, scales: { x: { domain: [0, stackedArea.N - 1] }, y: { domain: [0, 14] } } }}>
        {stackedArea.tops.map((top, k) => (
          <Area key={k} x={stackedArea.x} y={top} base={stackedArea.bases[k]} color={areaColors[k]} name={"abc"[k]} renderType="static" />
        ))}
      </SPanel>

      <SPanel title="Step line" subtitle="staircase · step:after" options={{ scales: { x: { domain: [0, step.N - 1] }, y: { domain: [-0.5, 3.5] } } }}>
        <Line x={step.x} y={step.y} color="#fbbf24" width={2.5} step="after" join="miter" renderType="static" />
      </SPanel>

      <SPanel title="Line joins" subtitle="miter · bevel · round">
        {joins.styles.map((join, k) => (
          <Line key={join} x={joins.x} y={joins.ys[k]!} color={joinColors[k]} width={8} join={join} name={join} renderType="static" />
        ))}
      </SPanel>

      <SPanel title="Histogram" subtitle="gaussian · 30 bins">
        <Bar x={histogram.centers} y={histogram.counts} width={histogram.bw * 0.98} color="#34d399" renderType="static" />
      </SPanel>

      <SPanel title="Box plot" subtitle="Tukey · outliers" options={{ scales: { x: { domain: [-0.6, 3.6] }, y: { domain: [-4, 8] } } }}>
        <Box groups={boxGroups} width={0.6} renderType="static" />
      </SPanel>

      <SPanel title="Heatmap" subtitle="texture · viridis">
        <Heatmap values={heatmap.values} cols={heatmap.cols} rows={heatmap.rows} extent={heatmap.extent} colormap="viridis" renderType="static" />
      </SPanel>

      <SPanel title="Contour" subtitle="marching squares">
        <Contour values={contour.values} cols={contour.cols} rows={contour.rows} extent={contour.extent} levels={12} colormap="viridis" renderType="static" />
      </SPanel>

      <SPanel title="Spectrogram" subtitle="chirp · STFT magnitude" options={{ axes: { x: { title: "time" }, y: { title: "freq" } } }}>
        <Heatmap values={spectro.values} cols={spectro.cols} rows={spectro.rows} extent={spectro.extent} colormap="plasma" renderType="static" />
      </SPanel>

      <SPanel title="Hexbin" subtitle="25k points · density" options={{ scales: { x: { domain: [-5, 5] }, y: { domain: [-5, 5] } } }}>
        <Hexbin x={hexbin.x} y={hexbin.y} radius={0.22} colormap="plasma" renderType="static" />
      </SPanel>

      <SPanel title="Error bars" subtitle="whiskers + caps" options={{ scales: { x: { domain: [-1, errbar.N] }, y: { domain: [0, 10] } } }}>
        <Line x={errbar.x} y={errbar.y} color="#60a5fa" width={1.5} renderType="static" />
        <ErrorBar x={errbar.x} y={errbar.y} yerr={errbar.yerr} color="#60a5fa" capSize={7} renderType="static" />
      </SPanel>

      <SPanel title="Error band" subtitle="confidence ribbon" options={{ scales: { x: { domain: [0, 12] }, y: { domain: [-1.5, 1.5] } } }}>
        <ErrorBar x={errband.x} y={errband.y} yerr={errband.err} color="#a78bfa" band whiskers={false} bandOpacity={0.28} renderType="static" />
        <Line x={errband.x} y={errband.y} color="#a78bfa" width={2} renderType="static" />
      </SPanel>

      <SPanel title="Stem plot" subtitle="discrete signal" options={{ scales: { x: { domain: [-1, stem.N] }, y: { domain: [-1, 1.1] } } }}>
        <Stem x={stem.x} y={stem.y} color="#34d399" markerSize={6} renderType="static" />
      </SPanel>

      <SPanel title="Quiver" subtitle="vector field" options={{ scales: { x: { domain: [-2.4, 2.4] }, y: { domain: [-2.4, 2.4] } } }}>
        <Quiver x={quiver.x} y={quiver.y} u={quiver.u} v={quiver.v} colorBy={{ colormap: "viridis" }} renderType="static" />
      </SPanel>

      <SPanel title="Candlestick" subtitle="OHLC · daily" options={{ scales: { x: { type: "time" } } }}>
        <Candlestick x={ohlc.x} open={ohlc.o} high={ohlc.h} low={ohlc.l} close={ohlc.c} renderType="static" />
      </SPanel>

      <SPanel title="OHLC" subtitle="bars · daily" options={{ scales: { x: { type: "time" } } }}>
        <Ohlc x={ohlc.x} open={ohlc.o} high={ohlc.h} low={ohlc.l} close={ohlc.c} renderType="static" />
      </SPanel>

      <SPanel title="Ordinal-time axis" subtitle="sessions · weekend gaps collapse" options={{ scales: { x: { type: "ordinal-time", times: ordinal.times } } }}>
        <Candlestick x={ordinal.idx} open={ordinal.o} high={ordinal.h} low={ordinal.l} close={ordinal.c} renderType="static" />
      </SPanel>

      <SPanel title="Pie" subtitle="market share" options={{ equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } }, scales: { x: { domain: [-1.25, 1.25] }, y: { domain: [-1.25, 1.25] } } }}>
        <Pie values={[35, 25, 20, 12, 8]} colormap="viridis" renderType="static" />
      </SPanel>

      <SPanel title="Donut" subtitle="categories" options={{ equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } }, scales: { x: { domain: [-1.25, 1.25] }, y: { domain: [-1.25, 1.25] } } }}>
        <Pie values={[8, 6, 5, 4, 3, 2]} innerRadius={0.55} renderType="static" />
      </SPanel>

      <SPanel title="Patches" subtitle="polygons · choropleth" options={{ showToolbar: false, scales: { x: { domain: [-0.3, patches.cols + 0.3] }, y: { domain: [-0.3, patches.rows + 0.3] } } }}>
        <Patches patches={patches.patches} colormap="plasma" renderType="static" />
      </SPanel>

      <SPanel title="Annotations" subtitle="span · band · box · label" options={{ showToolbar: false, scales: { x: { domain: [0, 99] }, y: { domain: [0, 10] } } }}>
        <Line
          x={Float64Array.from({ length: 100 }, (_, i) => i)}
          y={Float64Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.15) * 3 + 5)}
          color="#38bdf8"
          width={2}
          renderType="static"
        />
        <Annotation type="band" dim="y" from={6} to={8} color="rgba(52,211,153,0.15)" />
        <Annotation type="span" dim="y" value={5} color="#f59e0b" dash={[5, 4]} />
        <Annotation type="span" dim="x" value={50} color="#f472b6" dash={[5, 4]} />
        <Annotation type="box" x={[20, 35]} y={[2, 4]} border="#a78bfa" />
        <Annotation type="label" x={52} y={9} text="event" color="#f472b6" />
      </SPanel>

      <SPanel title="Image" subtitle="RGBA glyph · textured quad" options={{ showToolbar: false, scales: { x: { domain: [-0.5, 10.5] }, y: { domain: [-0.5, 10.5] } } }}>
        <Image source={image.id} extent={{ x: [0, 10], y: [0, 10] }} renderType="static" />
      </SPanel>

      <SPanel title="Graph" subtitle="nodes + edges" options={{ showToolbar: false, equalAspect: true, scales: { x: { domain: [-1.5, 1.5] }, y: { domain: [-1.5, 1.5] } } }}>
        <Graph x={graph.x} y={graph.y} edges={graph.edges} nodeColor="#38bdf8" edgeColor="rgba(148,163,184,0.4)" nodeSize={13} renderType="static" />
      </SPanel>

      <SPanel title="Log axis" subtitle="exp decay · log y" options={{ scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } }}>
        {logAxis.ys.map((y, k) => (
          <Line key={k} x={logAxis.x} y={y} color={joinColors[k]} width={1.5} name={`τ=${logAxis.taus[k]}`} renderType="static" />
        ))}
      </SPanel>

      <SPanel title="Time axis" subtitle="1 day · date ticks" options={{ scales: { x: { type: "time" } } }}>
        <Line x={timeAxis.x} y={timeAxis.y} color="#22d3ee" width={1.5} renderType="static" />
      </SPanel>

      <SPanel title="Dual Y" subtitle="two scales" options={{ axes: { y: { title: "amp" } }, scales: { x: { domain: [0, dualY.N - 1] }, y: { domain: [-2, 2] } } }}>
        <YAxis id="t" side="right" color="#f472b6" title="temp" domain={[15, 35]} />
        <Line x={dualY.x} y={dualY.a} color="#60a5fa" width={1.5} decimate={false} renderType="static" />
        <Line x={dualY.x} y={dualY.b} color="#f472b6" width={1.5} yAxis="t" decimate={false} renderType="static" />
      </SPanel>

      <SPanel title="1M points" subtitle="GPU min/max decimation" options={{ scales: { x: { domain: [0, million.N - 1] }, y: { domain: [-1.5, 1.5] } } }}>
        <Line x={million.x} y={million.y} color="#34d399" width={1.5} renderType="static" />
      </SPanel>

      <SPanel
        title="Styled + categorical"
        subtitle="bg · title · legend · rotated ticks"
        options={{
          background: "#0b1220",
          border: "#060a14",
          title: { text: "Quarterly revenue", align: "left" },
          legend: { position: "top-left" },
          showToolbar: false,
          scales: { x: { type: "categorical", factors: styled.months }, y: { domain: [0, 110] } },
          axes: {
            x: { title: "month", labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" },
            y: { title: "revenue", gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] },
          },
        }}
      >
        <Bar x={styled.idx} y={styled.revenue} width={0.6} color="#38bdf8" name="revenue" renderType="static" />
        <Line x={styled.idx} y={styled.target} color="#f59e0b" width={2.5} name="target" renderType="static" />
      </SPanel>

      {/* --- polar --- */}
      <PanelShell title="Polar radar" subtitle="line + scatter">
        <PolarPlot options={{ theme: "dark", angleUnit: "deg", maxRadius: 1 }}>
          <PolarLine theta={[0, 0]} r={[0, 1]} color="#22d3ee" width={2} />
          <PolarScatter theta={polar.bt} r={polar.br} color="#f472b6" size={6} labels={polar.labels} />
        </PolarPlot>
      </PanelShell>

      <PanelShell title="Polar rose" subtitle="cos(3θ) curve">
        <PolarPlot options={{ theme: "dark", maxRadius: 1 }}>
          <PolarLine theta={polar.theta} r={polar.rose} color="#a78bfa" width={2} closed />
        </PolarPlot>
      </PanelShell>

      {/* --- 3D --- */}
      <PanelShell title="3D surface" subtitle="title · colorbar · light">
        <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" }}>
          <Surface values={surface.values} cols={surface.cols} rows={surface.rows} extentX={surface.extentX} extentZ={surface.extentZ} colormap="viridis" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D bars" subtitle="colormapped · lit">
        <Plot3D options={{ axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" }}>
          <Bar3D x={bar3d.x} z={bar3d.z} y={bar3d.y} colorBy={{ colormap: "plasma" }} name="value" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D lines" subtitle="paths · legend">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, legend: true }}>
          <Line3D x={line3d.a.x} y={line3d.a.y} z={line3d.a.z} color="#38bdf8" name="α" />
          <Line3D x={line3d.b.x} y={line3d.b.y} z={line3d.b.z} color="#f472b6" name="β" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D wireframe" subtitle="lines · hover · reset">
        <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" }}>
          <Surface values={wire.values} cols={wire.cols} rows={wire.rows} extentX={wire.extentX} extentZ={wire.extentZ} colormap="plasma" wireframe name="height" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D quiver" subtitle="vector field · colorbar">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" } }}>
          <Quiver3D x={quiver3d.x} y={quiver3d.y} z={quiver3d.z} u={quiver3d.u} v={quiver3d.v} w={quiver3d.w} scale={0.4} colorBy={{ colormap: "viridis" }} name="speed" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D contour" subtitle="iso-height rings">
        <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" }}>
          <Contour3D values={contour3d.values} cols={contour3d.cols} rows={contour3d.rows} extentX={contour3d.extentX} extentZ={contour3d.extentZ} levels={14} colormap="viridis" name="height" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D isosurface" subtitle="marching cubes · metaballs">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" }}>
          <Isosurface values={iso.vol} dims={iso.dims} isoLevel={0.5} extent={{ x: [-1, 1], y: [-1, 1], z: [-1, 1] }} color="#38bdf8" name="blob" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D scatter" subtitle="per-point size · labels">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" } }}>
          <PointCloud x={scatter3d.x} y={scatter3d.y} z={scatter3d.z} sizes={scatter3d.sizes} labels={scatter3d.labels} colorBy={{ values: scatter3d.vals, colormap: "plasma" }} name="r" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D volume" subtitle="raymarch · grid">
        <Plot3D options={{ axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume" }}>
          <Volume values={volume.vol} dims={volume.dims} extent={{ x: [-1, 1], y: [-1, 1], z: [-1, 1] }} colormap="plasma" density={1.3} name="density" renderType="static" />
        </Plot3D>
      </PanelShell>

      <PanelShell title="3D point cloud" subtitle="axes · colored by height">
        <Plot3D options={{ axisLabels: { x: "x", y: "height", z: "z" } }}>
          <PointCloud x={cloud.x} y={cloud.y} z={cloud.z} size={4} colorBy={{ values: cloud.y, colormap: "plasma" }} />
        </Plot3D>
      </PanelShell>
    </div>
  );
}

// ============================================================================
// DYNAMIC TAB — the same catalog with renderType="dynamic", each animated and
// each showing a top-left FPS badge. Panels drive the core plot imperatively
// (setData / updateLast / appendCandle). Plus a linkX-ed finance dashboard.
// ============================================================================
type Dyn2D = { title: string; subtitle: string; options?: PlotOptions; setup: (p: CorePlot) => Updater | void };

const DYN2D: Dyn2D[] = [
  {
    title: "Line",
    subtitle: "live · scrolling",
    setup(p) {
      const N = 600;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
      const line = p.addLine({ x, y, color: "#34d399", width: 2, decimate: false, renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [-2.6, 2.6] });
      let ph = N;
      return () => {
        y.copyWithin(0, 1);
        ph += 1;
        y[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + jitter() * 0.25;
        line.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Signals",
    subtitle: "3 channels",
    setup(p) {
      const N = 500;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const ys = [0, 1, 2].map((k) => Float64Array.from({ length: N }, (_, j) => Math.sin(j * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + k * 0.1));
      const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
      const lines = ys.map((y, i) => p.addLine({ x, y, color: colors[i], width: 1.5, decimate: false, renderType: "dynamic" }));
      p.setView({ x: [0, N - 1], y: [-3.5, 3.5] });
      let ph = N;
      return () => {
        ph += 1;
        ys.forEach((y, i) => {
          y.copyWithin(0, 1);
          y[N - 1] = Math.sin(ph * (0.05 + i * 0.03)) * (1.5 - i * 0.3) + jitter() * 0.2 + i * 0.1;
          lines[i]!.setData(x, y);
        });
        p.render();
      };
    },
  },
  {
    title: "Scatter",
    subtitle: "drifting cloud",
    setup(p) {
      const { gaussian } = makeRng(101);
      const M = 700;
      const x = new Float64Array(M);
      const y = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        x[i] = gaussian(0, 1);
        y[i] = gaussian(0, 1);
      }
      const sc = p.addScatter({ x, y, size: 5, color: "#818cf8", renderType: "dynamic" });
      p.setView({ x: [-4, 4], y: [-4, 4] });
      return () => {
        for (let i = 0; i < M; i++) {
          x[i] += jitter() * 0.08 - x[i]! * 0.01;
          y[i] += jitter() * 0.08 - y[i]! * 0.01;
        }
        sc.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Scatter markers",
    subtitle: "6 glyph shapes",
    options: { showToolbar: false },
    setup(p) {
      const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
      const colors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
      const M = 12;
      const x = Float64Array.from({ length: M }, (_, i) => i);
      const layers = shapes.map((mk, r) => {
        const y = Float64Array.from({ length: M }, () => shapes.length - 1 - r);
        return p.addScatter({ x, y, size: 14, marker: mk, color: colors[r], name: mk, renderType: "dynamic" });
      });
      p.setView({ x: [-1, M], y: [-1, shapes.length] });
      return (t) => {
        layers.forEach((lyr, r) => {
          const base = shapes.length - 1 - r;
          const y = Float64Array.from({ length: M }, (_, i) => base + Math.sin(t * 2 + i * 0.6 + r) * 0.25);
          lyr.setData(x, y);
        });
        p.render();
      };
    },
  },
  {
    title: "Scatter · colorBy",
    subtitle: "value → viridis",
    setup(p) {
      const { gaussian } = makeRng(103);
      const M = 1200;
      const x = new Float64Array(M);
      const y = new Float64Array(M);
      const v = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        x[i] = gaussian(0, 1.4);
        y[i] = gaussian(0, 1.4);
        v[i] = Math.hypot(x[i]!, y[i]!);
      }
      const sc = p.addScatter({ x, y, size: 6, colorBy: { values: v, colormap: "viridis" }, renderType: "dynamic" });
      p.setView({ x: [-5, 5], y: [-5, 5] });
      return () => {
        for (let i = 0; i < M; i++) {
          x[i] += jitter() * 0.06 - x[i]! * 0.008;
          y[i] += jitter() * 0.06 - y[i]! * 0.008;
        }
        sc.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Bars",
    subtitle: "fluctuating",
    setup(p) {
      const { rand } = makeRng(105);
      const K = 9;
      const cats = Float64Array.from({ length: K }, (_, i) => i);
      const y = Float64Array.from({ length: K }, () => 40 + rand() * 30);
      const bar = p.addBar({ x: cats, y, width: 0.7, color: "#22d3ee", renderType: "dynamic" });
      p.setView({ x: [-0.6, K - 0.4], y: [0, 100] });
      return () => {
        for (let i = 0; i < K; i++) y[i] = Math.max(2, Math.min(98, y[i]! + jitter() * 8));
        bar.setData(cats, y);
        p.render();
      };
    },
  },
  {
    title: "Grouped bars",
    subtitle: "categorical · 3 series",
    options: { showToolbar: false, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: ["Q1", "Q2", "Q3", "Q4"] }, y: { domain: [0, 100] } } },
    setup(p) {
      const { rand } = makeRng(107);
      const cats = ["Q1", "Q2", "Q3", "Q4"];
      const idx = Float64Array.from(cats, (_, i) => i);
      const mk = () => Float64Array.from(cats, () => 20 + rand() * 70);
      const ys = [mk(), mk(), mk()];
      const colors = ["#38bdf8", "#f472b6", "#a3e635"];
      const names = ["north", "south", "west"];
      const layers = p.addGroupedBars({ x: idx, series: ys.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
      return () => {
        ys.forEach((y, s) => {
          for (let i = 0; i < y.length; i++) y[i] = Math.max(4, Math.min(96, y[i]! + jitter() * 7));
          layers[s]!.setData(idx, y);
        });
        p.render();
      };
    },
  },
  {
    title: "Stacked bars",
    subtitle: "categorical · cumulative",
    options: { showToolbar: false, legend: { position: "top-left" }, scales: { x: { type: "categorical", factors: ["Mon", "Tue", "Wed", "Thu", "Fri"] } } },
    setup(p) {
      const { rand } = makeRng(109);
      const cats = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const idx = Float64Array.from(cats, (_, i) => i);
      const raw = [10, 8, 6].map((m) => Float64Array.from(cats, () => m + rand() * m));
      const colors = ["#22d3ee", "#818cf8", "#fbbf24"];
      const names = ["email", "social", "direct"];
      const layers = p.addStackedBars({ x: idx, width: 0.6, series: raw.map((y, i) => ({ y, color: colors[i], name: names[i] })) });
      return () => {
        const n = idx.length;
        const cum = new Float64Array(n);
        raw.forEach((y, s) => {
          const base = Float64Array.from(cum);
          const top = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            y[i] = Math.max(2, y[i]! + jitter() * 1.2);
            top[i] = cum[i]! + y[i]!;
            cum[i] = top[i]!;
          }
          layers[s]!.setData(idx, top, base);
        });
        p.render();
      };
    },
  },
  {
    title: "Horizontal bars",
    subtitle: "hbar · categorical y",
    options: { showToolbar: false, scales: { y: { type: "categorical", factors: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"] }, x: { domain: [0, 100] } } },
    setup(p) {
      const { rand } = makeRng(111);
      const cats = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
      const idx = Float64Array.from(cats, (_, i) => i);
      const vals = Float64Array.from(cats, (_, i) => 30 + i * 12 + rand() * 10);
      const bar = p.addBar({ x: idx, y: vals, width: 0.6, orientation: "h", color: "#34d399", name: "score", renderType: "dynamic" });
      return () => {
        for (let i = 0; i < vals.length; i++) vals[i] = Math.max(6, Math.min(98, vals[i]! + jitter() * 6));
        bar.setData(idx, vals);
        p.render();
      };
    },
  },
  {
    title: "Area",
    subtitle: "streaming",
    setup(p) {
      const N = 400;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7);
      const area = p.addArea({ x, y, color: "rgba(52,211,153,0.45)", renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [0, 4] });
      let ph = N;
      return () => {
        y.copyWithin(0, 1);
        ph += 1;
        y[N - 1] = 2 + Math.sin(ph * 0.06) + Math.sin(ph * 0.017) * 0.7 + Math.random() * 0.2;
        area.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Stacked area",
    subtitle: "cumulative bands",
    options: { showToolbar: false },
    setup(p) {
      const N = 120;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const s = (a: number, b: number, c: number) => Float64Array.from({ length: N }, (_, i) => a + Math.sin(i * b + c) * a * 0.4 + a * 0.3);
      const raw = [s(3, 0.05, 0), s(2.5, 0.06, 1), s(2, 0.04, 2)];
      const colors = ["rgba(56,189,248,0.6)", "rgba(244,114,182,0.6)", "rgba(163,230,53,0.6)"];
      const layers = p.addStackedArea({ x, series: raw.map((y, i) => ({ y, color: colors[i], name: "abc"[i] })) });
      p.setView({ x: [0, N - 1], y: [0, 14] });
      const amp = [3, 2.5, 2];
      const fr = [0.05, 0.06, 0.04];
      return (t) => {
        const cum = new Float64Array(N);
        for (let sIdx = 0; sIdx < raw.length; sIdx++) {
          const base = Float64Array.from(cum);
          const top = new Float64Array(N);
          const a = amp[sIdx]!;
          const b = fr[sIdx]!;
          for (let i = 0; i < N; i++) {
            const yv = a + Math.sin(i * b + sIdx + t * 1.5) * a * 0.4 + a * 0.3;
            top[i] = cum[i]! + yv;
            cum[i] = top[i]!;
          }
          layers[sIdx]!.setData(x, top, base);
        }
        p.render();
      };
    },
  },
  {
    title: "Step line",
    subtitle: "staircase · step:after",
    setup(p) {
      const N = 24;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, () => Math.round(Math.random() * 3));
      const line = p.addLine({ x, y, color: "#fbbf24", width: 2.5, step: "after", join: "miter", renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [-0.5, 3.5] });
      return () => {
        y.copyWithin(0, 1);
        y[N - 1] = Math.round(Math.random() * 3);
        line.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Line joins",
    subtitle: "miter · bevel · round",
    setup(p) {
      const xs = Float64Array.from({ length: 13 }, (_, i) => i);
      const styles = ["miter", "bevel", "round"] as const;
      const colors = ["#f472b6", "#60a5fa", "#34d399"];
      const layers = styles.map((join, k) => {
        const y = Float64Array.from(xs, (_, i) => (i % 2 === 0 ? 0 : 1) + k * 2.2);
        return p.addLine({ x: xs, y, color: colors[k], width: 8, join, name: join, renderType: "dynamic" });
      });
      return (t) => {
        styles.forEach((_, k) => {
          const amp = 0.6 + 0.4 * Math.sin(t * 2 + k);
          const y = Float64Array.from(xs, (_, i) => (i % 2 === 0 ? 0 : amp) + k * 2.2);
          layers[k]!.setData(xs, y);
        });
        p.render();
      };
    },
  },
  {
    title: "Histogram",
    subtitle: "gaussian · 30 bins",
    setup(p) {
      const { gaussian } = makeRng(113);
      const bins = 30;
      const lo = -4;
      const hi = 4;
      const bw = (hi - lo) / bins;
      const centers = Float64Array.from({ length: bins }, (_, i) => lo + (i + 0.5) * bw);
      const counts = new Float64Array(bins);
      for (let i = 0; i < 5000; i++) {
        const b = Math.floor((gaussian(0, 1) - lo) / bw);
        if (b >= 0 && b < bins) counts[b]!++;
      }
      const bar = p.addBar({ x: centers, y: counts, width: bw * 0.98, color: "#34d399", renderType: "dynamic" });
      return () => {
        for (let i = 0; i < bins; i++) {
          const target = (5000 * bw * Math.exp((-centers[i]! * centers[i]!) / 2)) / Math.sqrt(2 * Math.PI);
          counts[i] = Math.max(0, counts[i]! + (target - counts[i]!) * 0.05 + jitter() * target * 0.12);
        }
        bar.setData(centers, counts);
        p.render();
      };
    },
  },
  {
    title: "Box plot",
    subtitle: "Tukey · outliers",
    setup(p) {
      const { gaussian } = makeRng(115);
      const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
      const mkGroups = (phase: number) =>
        [0, 1, 2, 3].map((g) => ({
          position: g,
          values: Array.from({ length: 120 }, () => gaussian(g + Math.sin(phase + g) * 0.5, 1 + g * 0.3)),
          color: colors[g],
        }));
      const box = p.addBox({ groups: mkGroups(0), width: 0.6, renderType: "dynamic" });
      p.setView({ x: [-0.6, 3.6], y: [-4, 8] });
      return every(4, (t) => {
        box.setData(mkGroups(t));
        p.render();
      });
    },
  },
  {
    title: "Heatmap",
    subtitle: "texture · viridis",
    setup(p) {
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
      const hm = p.addHeatmap({ values, cols, rows, extent: { x: [0, 6], y: [0, 6] }, colormap: "viridis", renderType: "dynamic" });
      return (t) => {
        fill(t);
        hm.setData(values);
        p.render();
      };
    },
  },
  {
    title: "Contour",
    subtitle: "marching squares",
    setup(p) {
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
      const ct = p.addContour({ values, cols, rows, extent: { x: [-3, 3], y: [-3, 3] }, levels: 12, colormap: "viridis", renderType: "dynamic" });
      return every(2, (t) => {
        fill(t);
        ct.setData(values);
        p.render();
      });
    },
  },
  {
    title: "Spectrogram",
    subtitle: "waterfall · scroll",
    options: { axes: { x: { title: "time" }, y: { title: "freq" } } },
    setup(p) {
      const N = 16384;
      const sr = 8000;
      const sig = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const tt = i / sr;
        sig[i] = Math.sin(2 * Math.PI * (200 + 1500 * (i / N)) * tt);
      }
      const hm = p.addHeatmapSpectrogram(sig, { fftSize: 256, hop: 128, sampleRate: sr, colormap: "plasma" });
      const cols = Math.floor((N - 256) / 128) + 1;
      const rows = 129;
      const grid = new Float64Array(cols * rows);
      let ph = 0;
      return () => {
        ph += 0.05;
        for (let r = 0; r < rows; r++) grid.copyWithin(r * cols, r * cols + 1, (r + 1) * cols);
        const peak = (0.5 + 0.5 * Math.sin(ph)) * (rows - 1);
        for (let r = 0; r < rows; r++) grid[r * cols + (cols - 1)] = Math.exp(-((r - peak) ** 2) / 40) + Math.random() * 0.05;
        hm.setData(grid, cols, rows);
        p.render();
      };
    },
  },
  {
    title: "Hexbin",
    subtitle: "25k points · density",
    setup(p) {
      const { gaussian } = makeRng(117);
      const M = 25_000;
      const x = new Float64Array(M);
      const y = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        const blob = i % 2 === 0 ? -1.4 : 1.4;
        x[i] = gaussian(blob, 1);
        y[i] = gaussian(blob * 0.6, 1.1);
      }
      const hx = p.addHexbin({ x, y, radius: 0.22, colormap: "plasma", renderType: "dynamic" });
      p.setView({ x: [-5, 5], y: [-5, 5] });
      return every(2, () => {
        for (let i = 0; i < M; i++) {
          x[i] += jitter() * 0.05 - x[i]! * 0.004;
          y[i] += jitter() * 0.05 - y[i]! * 0.004;
        }
        hx.setData(x, y);
        p.render();
      });
    },
  },
  {
    title: "Error bars",
    subtitle: "whiskers + caps",
    setup(p) {
      const N = 12;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 2) * 3 + 5);
      const yerr = Float64Array.from({ length: N }, () => 0.4 + Math.random() * 0.9);
      const line = p.addLine({ x, y, color: "#60a5fa", width: 1.5, renderType: "dynamic" });
      const eb = p.addErrorBar({ x, y, yerr, color: "#60a5fa", capSize: 7, renderType: "dynamic" });
      p.setView({ x: [-1, N], y: [0, 10] });
      return (t) => {
        for (let i = 0; i < N; i++) {
          y[i] = Math.sin(i / 2 + t) * 3 + 5;
          yerr[i] = 0.4 + (0.5 + 0.4 * Math.sin(t + i)) * 0.9;
        }
        line.setData(x, y);
        eb.setData({ x, y, yerr });
        p.render();
      };
    },
  },
  {
    title: "Error band",
    subtitle: "confidence ribbon",
    setup(p) {
      const N = 120;
      const x = Float64Array.from({ length: N }, (_, i) => i / 10);
      const y = Float64Array.from(x, (t) => Math.sin(t));
      const err = Float64Array.from(x, (t) => 0.12 + 0.12 * Math.abs(Math.cos(t)));
      const eb = p.addErrorBar({ x, y, yerr: err, color: "#a78bfa", band: true, whiskers: false, bandOpacity: 0.28, renderType: "dynamic" });
      const line = p.addLine({ x, y, color: "#a78bfa", width: 2, renderType: "dynamic" });
      p.setView({ x: [0, 12], y: [-1.5, 1.5] });
      return (t) => {
        for (let i = 0; i < N; i++) {
          y[i] = Math.sin(x[i]! + t);
          err[i] = 0.12 + 0.12 * Math.abs(Math.cos(x[i]! + t));
        }
        eb.setData({ x, y, yerr: err });
        line.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Stem plot",
    subtitle: "discrete signal",
    setup(p) {
      const N = 30;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.exp(-i / 12) * Math.cos(i / 2));
      const stem = p.addStem({ x, y, color: "#34d399", markerSize: 6, renderType: "dynamic" });
      p.setView({ x: [-1, N], y: [-1, 1.1] });
      return (t) => {
        for (let i = 0; i < N; i++) y[i] = Math.exp(-i / 12) * Math.cos(i / 2 + t * 2);
        stem.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Quiver",
    subtitle: "vector field",
    setup(p) {
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
        for (let k = 0; k < xs.length; k++) {
          const a = Math.cos(ph);
          const b = Math.sin(ph);
          us[k] = -ys[k]! * a - xs[k]! * b * 0.3;
          vs[k] = xs[k]! * a - ys[k]! * b * 0.3;
        }
      };
      fill(0);
      const q = p.addQuiver({ x: xs, y: ys, u: us, v: vs, colorBy: { colormap: "viridis" }, renderType: "dynamic" });
      p.setView({ x: [-2.4, 2.4], y: [-2.4, 2.4] });
      return (t) => {
        fill(t);
        q.setData(xs, ys, us, vs);
        p.render();
      };
    },
  },
  {
    title: "Candlestick",
    subtitle: "OHLC · streaming",
    options: { scales: { x: { type: "time" } } },
    setup(p) {
      const { gaussian } = makeRng(119);
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
      const cs = p.addCandlestick({ x, open: o, high: h, low: l, close: c, renderType: "dynamic" });
      let lastX = x[N - 1]!;
      let curOpen = c[N - 1]!;
      let curClose = curOpen;
      let hi = curOpen;
      let lo = curOpen;
      let sinceClose = 0;
      return () => {
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
      };
    },
  },
  {
    title: "OHLC",
    subtitle: "bars · streaming",
    options: { scales: { x: { type: "time" } } },
    setup(p) {
      const { gaussian } = makeRng(121);
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
      const ol = p.addOhlc({ x, open: o, high: h, low: l, close: c, renderType: "dynamic" });
      let lastX = x[N - 1]!;
      let curOpen = c[N - 1]!;
      let curClose = curOpen;
      let hi = curOpen;
      let lo = curOpen;
      let sinceClose = 0;
      return () => {
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
      };
    },
  },
  {
    title: "Ordinal-time axis",
    subtitle: "sessions · weekend gaps collapse",
    options: { scales: { x: { type: "ordinal-time", times: businessDays(60, Date.UTC(2024, 0, 1)) } } },
    setup(p) {
      const { gaussian } = makeRng(123);
      const N = 60;
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
      const cs = p.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });
      let curOpen = c[N - 1]!;
      let curClose = curOpen;
      let hi = curOpen;
      let lo = curOpen;
      let sinceClose = 0;
      return () => {
        curClose += gaussian(0, 0.3);
        hi = Math.max(hi, curClose);
        lo = Math.min(lo, curClose);
        cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
        p.render();
        if (++sinceClose > 60) {
          sinceClose = 0;
          for (let i = 0; i < N - 1; i++) {
            o[i] = o[i + 1]!;
            h[i] = h[i + 1]!;
            l[i] = l[i + 1]!;
            c[i] = c[i + 1]!;
          }
          curOpen = curClose;
          o[N - 1] = curOpen;
          h[N - 1] = curOpen;
          l[N - 1] = curOpen;
          c[N - 1] = curOpen;
          hi = lo = curOpen;
          cs.setData({ x: idx, open: o, high: h, low: l, close: c });
        }
      };
    },
  },
  {
    title: "Pie",
    subtitle: "market share",
    options: { equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } },
    setup(p) {
      const vals = [35, 25, 20, 12, 8];
      const pie = p.addPie({ values: vals, colormap: "viridis", renderType: "dynamic" });
      p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
      return every(3, () => {
        for (let i = 0; i < vals.length; i++) vals[i] = Math.max(3, vals[i]! + jitter() * 3);
        pie.setData(vals);
        p.render();
      });
    },
  },
  {
    title: "Donut",
    subtitle: "categories",
    options: { equalAspect: true, showToolbar: false, hover: false, axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } } },
    setup(p) {
      const vals = [8, 6, 5, 4, 3, 2];
      const pie = p.addPie({ values: vals, innerRadius: 0.55, renderType: "dynamic" });
      p.setView({ x: [-1.25, 1.25], y: [-1.25, 1.25] });
      return every(3, () => {
        for (let i = 0; i < vals.length; i++) vals[i] = Math.max(1.5, vals[i]! + jitter() * 2);
        pie.setData(vals);
        p.render();
      });
    },
  },
  {
    title: "Patches",
    subtitle: "polygons · choropleth",
    options: { showToolbar: false },
    setup(p) {
      const { rand } = makeRng(125);
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
      const patch = p.addPatches({ patches: mk(0), colormap: "plasma", renderType: "dynamic" });
      p.setView({ x: [-0.3, cols + 0.3], y: [-0.3, rows + 0.3] });
      return every(2, (t) => {
        patch.setData(mk(t));
        p.render();
      });
    },
  },
  {
    title: "Annotations",
    subtitle: "span · band · box · label",
    options: { showToolbar: false },
    setup(p) {
      const N = 100;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const y = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.15) * 3 + 5);
      const line = p.addLine({ x, y, color: "#38bdf8", width: 2, renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [0, 10] });
      p.addAnnotation({ type: "band", dim: "y", from: 6, to: 8, color: "rgba(52,211,153,0.15)" });
      p.addAnnotation({ type: "span", dim: "y", value: 5, color: "#f59e0b", dash: [5, 4] });
      p.addAnnotation({ type: "span", dim: "x", value: 50, color: "#f472b6", dash: [5, 4] });
      p.addAnnotation({ type: "box", x: [20, 35], y: [2, 4], border: "#a78bfa" });
      p.addAnnotation({ type: "label", x: 52, y: 9, text: "event", color: "#f472b6" });
      return (t) => {
        for (let i = 0; i < N; i++) y[i] = Math.sin(i * 0.15 + t) * 3 + 5;
        line.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Image",
    subtitle: "RGBA glyph · textured quad",
    options: { showToolbar: false },
    setup(p) {
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
      const img = p.addImage({ source: id, extent: { x: [0, 10], y: [0, 10] }, renderType: "dynamic" });
      p.setView({ x: [-0.5, 10.5], y: [-0.5, 10.5] });
      return (t) => {
        paint(iw / 2 + Math.cos(t * 1.5) * iw * 0.3, ih / 2 + Math.sin(t * 1.5) * ih * 0.3);
        img.setData(id);
        p.render();
      };
    },
  },
  {
    title: "Graph",
    subtitle: "force layout · nodes + edges",
    options: { showToolbar: false, equalAspect: true },
    setup(p) {
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
      const g = p.addGraph({ x: bx, y: by, edges, nodeColor: "#38bdf8", edgeColor: "rgba(148,163,184,0.4)", nodeSize: 13, renderType: "dynamic" });
      p.setView({ x: [-1.5, 1.5], y: [-1.5, 1.5] });
      const x = new Float64Array(nNodes);
      const y = new Float64Array(nNodes);
      return (t) => {
        for (let i = 0; i < nNodes; i++) {
          x[i] = bx[i]! + Math.sin(t * 2 + i) * 0.12;
          y[i] = by[i]! + Math.cos(t * 2 + i) * 0.12;
        }
        g.setData({ x, y, edges });
        p.render();
      };
    },
  },
  {
    title: "Log axis",
    subtitle: "exp decay · log y",
    options: { scales: { y: { type: "log" } }, axes: { x: { title: "t" }, y: { title: "amplitude" } } },
    setup(p) {
      const N = 200;
      const x = Float64Array.from({ length: N }, (_, i) => (i / N) * 10);
      const taus = [1.2, 2.5, 5];
      const colors = ["#f472b6", "#60a5fa", "#34d399"];
      const ys = taus.map((tau) => Float64Array.from(x, (t) => Math.exp(-t / tau) + 1e-3));
      const lines = ys.map((y, k) => p.addLine({ x, y, color: colors[k], width: 1.5, name: `τ=${taus[k]}`, renderType: "dynamic" }));
      return (t) => {
        taus.forEach((tau, k) => {
          const y = ys[k]!;
          for (let i = 0; i < N; i++) y[i] = Math.exp(-x[i]! / tau) * (1 + 0.3 * Math.sin(t * 2 + i * 0.1)) + 1e-3;
          lines[k]!.setData(x, y);
        });
        p.render();
      };
    },
  },
  {
    title: "Time axis",
    subtitle: "1 day · date ticks",
    options: { scales: { x: { type: "time" } } },
    setup(p) {
      const { gaussian } = makeRng(127);
      const start = Date.UTC(2024, 0, 1);
      const N = 24 * 60;
      const x = new Float64Array(N);
      const y = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        x[i] = start + i * 60_000;
        const h = i / 60;
        y[i] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
      }
      const line = p.addLine({ x, y, color: "#22d3ee", width: 1.5, renderType: "dynamic" });
      let ph = N;
      return () => {
        y.copyWithin(0, 1);
        x.copyWithin(0, 1);
        ph++;
        x[N - 1] = start + ph * 60_000;
        const h = ph / 60;
        y[N - 1] = 20 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(0, 0.4);
        line.setData(x, y);
        p.render();
      };
    },
  },
  {
    title: "Dual Y",
    subtitle: "two scales",
    options: { axes: { y: { title: "amp" } } },
    setup(p) {
      p.addYAxis("t", { side: "right", color: "#f472b6", title: "temp" });
      const N = 400;
      const x = Float64Array.from({ length: N }, (_, i) => i);
      const a = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.05) * 1.5);
      const b = Float64Array.from({ length: N }, (_, i) => 25 + Math.sin(i * 0.02) * 6);
      const l1 = p.addLine({ x, y: a, color: "#60a5fa", width: 1.5, decimate: false, renderType: "dynamic" });
      const l2 = p.addLine({ x, y: b, color: "#f472b6", width: 1.5, yAxis: "t", decimate: false, renderType: "dynamic" });
      p.setView({ x: [0, N - 1], y: [-2, 2], yAxes: { t: [15, 35] } });
      let ph = N;
      return () => {
        a.copyWithin(0, 1);
        b.copyWithin(0, 1);
        ph += 1;
        a[N - 1] = Math.sin(ph * 0.05) * 1.5 + jitter() * 0.15;
        b[N - 1] = 25 + Math.sin(ph * 0.02) * 6 + jitter() * 0.6;
        l1.setData(x, a);
        l2.setData(x, b);
        p.render();
      };
    },
  },
  {
    title: "1M points",
    subtitle: "GPU decimation · panning",
    setup(p) {
      const { gaussian } = makeRng(129);
      const N = 1_000_000;
      const x = new Float64Array(N);
      const y = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        x[i] = i;
        y[i] = Math.sin(i / 5000) + 0.15 * Math.sin(i / 30) + gaussian(0, 0.05);
      }
      p.addLine({ x, y, color: "#34d399", width: 1.5, renderType: "dynamic" });
      const win = 50_000;
      p.setView({ x: [0, win], y: [-1.5, 1.5] });
      return (t) => {
        const c = (Math.sin(t * 0.3) * 0.5 + 0.5) * (N - win);
        p.setView({ x: [c, c + win] });
        p.render();
      };
    },
  },
  {
    title: "Styled + categorical",
    subtitle: "bg · title · legend · rotated ticks",
    options: {
      background: "#0b1220",
      border: "#060a14",
      title: { text: "Quarterly revenue", align: "left" },
      legend: { position: "top-left" },
      showToolbar: false,
      scales: { x: { type: "categorical", factors: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] }, y: { domain: [0, 110] } },
      axes: {
        x: { title: "month", labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" },
        y: { title: "revenue", gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] },
      },
    },
    setup(p) {
      const { rand } = makeRng(131);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
      const idx = Float64Array.from(months, (_, i) => i);
      const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
      const target = Float64Array.from(months, () => 70 + rand() * 12);
      const bar = p.addBar({ x: idx, y: revenue, width: 0.6, color: "#38bdf8", name: "revenue", renderType: "dynamic" });
      const line = p.addLine({ x: idx, y: target, color: "#f59e0b", width: 2.5, name: "target", renderType: "dynamic" });
      return () => {
        for (let i = 0; i < months.length; i++) {
          revenue[i] = Math.max(5, Math.min(105, revenue[i]! + jitter() * 6));
          target[i] = Math.max(40, Math.min(100, target[i]! + jitter() * 3));
        }
        bar.setData(idx, revenue);
        line.setData(idx, target);
        p.render();
      };
    },
  },
];

type DynPolar = { title: string; subtitle: string; options?: PolarOptions; setup: (p: CorePolarPlot) => Updater | void };

const DYN_POLAR: DynPolar[] = [
  {
    title: "Polar radar",
    subtitle: "rotating sweep",
    options: { angleUnit: "deg", maxRadius: 1 },
    setup(pp) {
      const { rand } = makeRng(133);
      const sweep = pp.addLine({ theta: [0, 0], r: [0, 1], color: "#22d3ee", width: 2 });
      const B = 14;
      const bt = Float64Array.from({ length: B }, () => rand() * 360);
      const br = Float64Array.from({ length: B }, () => 0.2 + rand() * 0.75);
      pp.addScatter({ theta: bt, r: br, color: "#f472b6", size: 6, labels: Array.from({ length: B }, (_, i) => `Contact ${i + 1}`) });
      let ang = 0;
      return () => {
        ang = (ang + 2.5) % 360;
        sweep.setData([ang, ang], [0, 1]);
      };
    },
  },
  {
    title: "Polar rose",
    subtitle: "morphing curve",
    options: { maxRadius: 1 },
    setup(pp) {
      const T = 240;
      const theta = Float64Array.from({ length: T }, (_, i) => (i / (T - 1)) * Math.PI * 2);
      const r = new Float64Array(T);
      for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(3 * theta[i]!));
      const rose = pp.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
      return (t) => {
        const k = 3 + 2 * Math.sin(t * 0.3);
        for (let i = 0; i < T; i++) r[i] = Math.abs(Math.cos(k * theta[i]!));
        rose.setData(theta, r);
      };
    },
  },
];

type Dyn3D = { title: string; subtitle: string; options?: Plot3DOptions; setup: (p: CorePlot3D) => Updater | void };

const DYN3D: Dyn3D[] = [
  {
    title: "3D surface",
    subtitle: "title · colorbar · light",
    options: { axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true, title: "Sinc surface" },
    setup(p3) {
      const cols = 64;
      const rows = 64;
      const values = new Float64Array(cols * rows);
      const fill = (ph: number) => {
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const xx = (c / cols) * 8 - 4;
            const yy = (r / rows) * 8 - 4;
            const rr = Math.hypot(xx, yy) + 1e-6;
            values[r * cols + c] = (Math.sin(rr * 2 - ph) / rr) * 3;
          }
      };
      fill(0);
      const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "viridis", name: "height", renderType: "dynamic" });
      return (t) => {
        fill(t * 3);
        surf.setData(values);
        p3.refresh();
      };
    },
  },
  {
    title: "3D bars",
    subtitle: "colormapped · lit",
    options: { axisLabels: { x: "x", y: "value", z: "z" }, title: "Bar field" },
    setup(p3) {
      const gx = 8;
      const gz = 8;
      const xa: number[] = [];
      const za: number[] = [];
      for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) { xa.push(i); za.push(j); }
      const ya = new Float64Array(xa.length);
      const fill = (ph: number) => {
        for (let k = 0; k < xa.length; k++) ya[k] = 1.5 + Math.sin(xa[k]! * 0.6 + ph) * Math.cos(za[k]! * 0.6) * 1.5;
      };
      fill(0);
      const bar = p3.addBar3D({ x: xa, z: za, y: ya, colorBy: { colormap: "plasma" }, name: "value", renderType: "dynamic" });
      return (t) => {
        fill(t * 2);
        bar.setData(xa, za, ya);
        p3.refresh();
      };
    },
  },
  {
    title: "3D lines",
    subtitle: "paths · legend",
    options: { axisLabels: { x: "x", y: "y", z: "z" }, legend: true },
    setup(p3) {
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
      const a = mk(0);
      const b = mk(Math.PI);
      const la = p3.addLine3D({ ...a, color: "#38bdf8", name: "α" });
      const lb = p3.addLine3D({ ...b, color: "#f472b6", name: "β" });
      return (t) => {
        const na = mk(t * 2);
        const nb = mk(Math.PI + t * 2);
        la.setData(na.x, na.y, na.z);
        lb.setData(nb.x, nb.y, nb.z);
        p3.refresh();
      };
    },
  },
  {
    title: "3D wireframe",
    subtitle: "lines · hover · reset",
    options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Wireframe" },
    setup(p3) {
      const cols = 40;
      const rows = 40;
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
      const surf = p3.addSurface({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], colormap: "plasma", wireframe: true, name: "height", renderType: "dynamic" });
      return (t) => {
        fill(t * 3);
        surf.setData(values);
        p3.refresh();
      };
    },
  },
  {
    title: "3D quiver",
    subtitle: "vector field · colorbar",
    options: { axisLabels: { x: "x", y: "y", z: "z" } },
    setup(p3) {
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
          u[k] = -ya[k]! * ca;
          v[k] = xa[k]! * ca;
          w[k] = za[k]! * 0.3 * sa;
        }
      };
      fill(0);
      const q = p3.addQuiver3D({ x: xa, y: ya, z: za, u, v, w, scale: 0.4, colorBy: { colormap: "viridis" }, name: "speed", renderType: "dynamic" });
      return (t) => {
        fill(t * 2);
        q.setData(xa, ya, za, u, v, w);
        p3.refresh();
      };
    },
  },
  {
    title: "3D contour",
    subtitle: "iso-height rings",
    options: { axisLabels: { x: "x", y: "z", z: "y" }, title: "Contour" },
    setup(p3) {
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
      const ct = p3.addContour3D({ values, cols, rows, extentX: [-4, 4], extentZ: [-4, 4], levels: 14, colormap: "viridis", name: "height", renderType: "dynamic" });
      return every(3, (t) => {
        fill(t * 3);
        ct.setData(values);
        p3.refresh();
      });
    },
  },
  {
    title: "3D isosurface",
    subtitle: "marching cubes · metaballs",
    options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Isosurface" },
    setup(p3) {
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
              for (const b of blobs) {
                const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2;
                s += Math.exp(-d2 * 6);
              }
              vol[x + y * n + z * n * n] = s;
            }
      };
      fill(0);
      const iso = p3.addIsosurface({ values: vol, dims: [n, n, n], isoLevel: 0.5, extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, color: "#38bdf8", name: "blob", renderType: "dynamic" });
      return every(5, (t) => {
        fill(t);
        iso.setData(vol, [n, n, n], 0.5, { x: [-1, 1], y: [-1, 1], z: [-1, 1] });
        p3.refresh();
      });
    },
  },
  {
    title: "3D scatter",
    subtitle: "per-point size · labels",
    options: { axisLabels: { x: "x", y: "y", z: "z" } },
    setup(p3) {
      const { gaussian } = makeRng(135);
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
        const r = Math.hypot(x[i]!, y[i]!, z[i]!);
        sizes[i] = 3 + r * 6;
        vals[i] = r;
        labels.push(`p${i} · r=${r.toFixed(2)}`);
      }
      const sc = p3.addPointCloud({ x, y, z, sizes, labels, colorBy: { values: vals, colormap: "plasma" }, name: "r" });
      return () => {
        for (let i = 0; i < N; i++) {
          x[i] += jitter() * 0.04 - x[i]! * 0.006;
          y[i] += jitter() * 0.04 - y[i]! * 0.006;
          z[i] += jitter() * 0.04 - z[i]! * 0.006;
        }
        sc.setData(x, y, z);
        p3.refresh();
      };
    },
  },
  {
    title: "3D volume",
    subtitle: "raymarch · auto-rotate",
    options: { axisLabels: { x: "x", y: "y", z: "z" }, title: "Volume", autoRotate: true },
    setup(p3) {
      const n = 48;
      const vol = new Float64Array(n * n * n);
      const blobs = [
        [-0.4, 0, 0],
        [0.5, 0.3, -0.2],
        [0.1, -0.4, 0.4],
      ];
      for (let z = 0; z < n; z++)
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const px = (x / (n - 1)) * 2 - 1;
            const py = (y / (n - 1)) * 2 - 1;
            const pz = (z / (n - 1)) * 2 - 1;
            let s = 0;
            for (const b of blobs) {
              const d2 = (px - b[0]!) ** 2 + (py - b[1]!) ** 2 + (pz - b[2]!) ** 2;
              s += Math.exp(-d2 * 5);
            }
            vol[x + y * n + z * n * n] = s;
          }
      p3.addVolume({ values: vol, dims: [n, n, n], extent: { x: [-1, 1], y: [-1, 1], z: [-1, 1] }, colormap: "plasma", density: 1.3, name: "density", renderType: "dynamic" });
      // autoRotate streams frames on its own — no extra updater needed.
    },
  },
  {
    title: "3D point cloud",
    subtitle: "axes · colored by height",
    options: { axisLabels: { x: "x", y: "height", z: "z" } },
    setup(p3) {
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
      const sc = p3.addPointCloud({ x, y, z, size: 4, colorBy: { values: y, colormap: "plasma" } });
      return (t) => {
        build(t);
        sc.setData(x, y, z);
        p3.refresh();
      };
    },
  },
];

/** Linked finance dashboard — candlesticks + volume bars on ordinal-time, linkX-ed. */
function LinkedFinance() {
  const data = useMemo(() => {
    const { rand, gaussian } = makeRng(137);
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
    return { N, times, idx, o, h, l, c, vol };
  }, []);

  const priceOpts = useMemo<PlotOptions>(
    () => ({ theme: "dark", scales: { x: { type: "ordinal-time", times: data.times } }, showToolbar: false }),
    [data.times],
  );
  const volOpts = useMemo<PlotOptions>(
    () => ({ theme: "dark", scales: { x: { type: "ordinal-time", times: data.times }, y: { domain: [0, 80] } }, showToolbar: false }),
    [data.times],
  );

  const [priceRef, priceP] = usePlot(priceOpts);
  const [volRef, volP] = usePlot(volOpts);
  const updater = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!priceP || !volP) return;
    const { N, idx, o, h, l, c, vol } = data;
    const cs = priceP.addCandlestick({ x: idx, open: o, high: h, low: l, close: c, renderType: "dynamic" });
    const volBar = volP.addBar({ x: idx, y: vol, width: 0.7, color: "#38bdf8", renderType: "dynamic" });
    const detach = linkX([priceP, volP]);
    const { gaussian } = makeRng(211);
    let curOpen = c[N - 1]!;
    let curClose = curOpen;
    let hi = curOpen;
    let lo = curOpen;
    let curVol = vol[N - 1]!;
    let sinceClose = 0;
    updater.current = () => {
      curClose += gaussian(0, 0.3);
      hi = Math.max(hi, curClose);
      lo = Math.min(lo, curClose);
      curVol = Math.max(5, curVol + jitter() * 3);
      cs.updateLast({ x: N - 1, open: curOpen, high: hi, low: lo, close: curClose });
      vol[N - 1] = curVol;
      volBar.setData(idx, vol);
      priceP.render();
      volP.render();
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
        curVol = 20 + jitter() * 10 + 10;
        vol[N - 1] = curVol;
        cs.setData({ x: idx, open: o, high: h, low: l, close: c });
      }
    };
    return () => {
      detach();
      updater.current = null;
    };
  }, [priceP, volP, data]);

  useDynRaf(() => updater.current?.());

  return (
    <>
      <PanelShell title="Linked finance · price" subtitle="candlesticks · ordinal-time" fps>
        <div ref={priceRef} style={S.fill} />
      </PanelShell>
      <PanelShell title="Linked finance · volume" subtitle="linkX-ed pane" fps>
        <div ref={volRef} style={S.fill} />
      </PanelShell>
    </>
  );
}

function DynamicTab({ running }: { running: boolean }) {
  return (
    <RunningContext.Provider value={running}>
      <div style={S.grid}>
        {DYN2D.map((d) => (
          <DynPlot key={d.title} title={d.title} subtitle={d.subtitle} options={d.options} setup={d.setup} />
        ))}
        {DYN_POLAR.map((d) => (
          <DynPolarPlot key={d.title} title={d.title} subtitle={d.subtitle} options={d.options} setup={d.setup} />
        ))}
        {DYN3D.map((d) => (
          <DynPlot3D key={d.title} title={d.title} subtitle={d.subtitle} options={d.options} setup={d.setup} />
        ))}
        <LinkedFinance />
      </div>
    </RunningContext.Provider>
  );
}

// ============================================================================
// MAPS TAB — offline GeoJSON world + a vector basemap. No FPS badges.
// ============================================================================
const adminStyle: MapStyle = {
  background: [0.05, 0.09, 0.16, 1],
  paint(_layer, type) {
    if (type === "polygon") return { kind: "fill", color: [0.16, 0.2, 0.26, 1], outline: [0.5, 0.58, 0.68, 1], outlineWidth: 1.2 };
    return { kind: "line", color: [0.5, 0.58, 0.68, 1], width: 1.2 };
  },
};

const oceanStyle: MapStyle = {
  background: [0.05, 0.09, 0.16, 1],
  paint(layer, type) {
    if (layer === "countries") return type === "polygon" ? { kind: "fill", color: [0.16, 0.2, 0.26, 1] } : { kind: "line", color: [0.3, 0.36, 0.44, 1], width: 1 };
    if (layer === "geolines") return { kind: "line", color: [0.2, 0.25, 0.32, 1], width: 1 };
    return null;
  },
};

const lonLatReadout = (x: number, y: number) => {
  const [lon, lat] = worldToLonLat(x, y);
  return [
    { label: "lon", value: `${lon.toFixed(2)}°` },
    { label: "lat", value: `${lat.toFixed(2)}°` },
  ];
};

function PmtilesPanel() {
  const [source, setSource] = useState<ReturnType<typeof pmtilesSource> | null>(null);
  const [name, setName] = useState("");
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setName(file.name);
    setSource(pmtilesSource({ blob: file, attribution: `local: ${file.name}` }));
  };
  return (
    <PanelShell title="PMTiles (offline)" subtitle="pick a local .pmtiles file">
      {source ? (
        <Plot options={{ theme: "dark", showToolbar: true, equalAspect: true, boundedPan: true, crosshair: true, hoverReadout: lonLatReadout }}>
          <Map source={source} style={protomapsStyle("dark")} />
        </Plot>
      ) : (
        <div style={S.placeholder}>no network — pick a .pmtiles file →</div>
      )}
      <input type="file" accept=".pmtiles" onChange={onFile} style={S.file} />
      <div style={S.cap}>{name ? `local: ${name}` : "offline vector tiles"}</div>
    </PanelShell>
  );
}

function MapsTab() {
  const demoSource = useMemo(
    () => xyzVectorSource({ url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf", attribution: "© MapLibre demo tiles", maxZoom: 5 }),
    [],
  );
  const cities = useMemo(() => {
    const list: Array<[string, number, number]> = [
      ["Istanbul", 28.98, 41.01],
      ["Tokyo", 139.69, 35.69],
      ["New York", -74.0, 40.71],
      ["São Paulo", -46.63, -23.55],
      ["Sydney", 151.21, -33.87],
      ["Cairo", 31.24, 30.04],
    ];
    const x: number[] = [];
    const y: number[] = [];
    for (const [, lon, lat] of list) {
      const [wx, wy] = lonLatToWorld(lon, lat);
      x.push(wx);
      y.push(wy);
    }
    return { x, y, labels: list.map(([n]) => n) };
  }, []);

  return (
    <div style={S.grid}>
      <PanelShell title="GeoJSON world" subtitle="offline · Natural Earth 10m">
        <Plot options={{ theme: "dark", showToolbar: true, equalAspect: true, boundedPan: true, hoverReadout: lonLatReadout }}>
          <GeoJson geojson={worldCountries} layer="admin" style={adminStyle} />
        </Plot>
        <div style={S.cap}>© Natural Earth (public domain) · embedded</div>
      </PanelShell>

      <PanelShell title="Vector basemap" subtitle="addMap · MVT · city overlay">
        <Plot options={{ theme: "dark", showToolbar: true, equalAspect: true, crosshair: true, boundedPan: true, hoverReadout: lonLatReadout }}>
          <Map source={demoSource} style={oceanStyle} bbox={[-175, -58, 190, 78]} />
          <Scatter x={cities.x} y={cities.y} size={8} color="#f472b6" labels={cities.labels} />
        </Plot>
        <div style={S.cap}>© MapLibre demo tiles</div>
      </PanelShell>

      <PmtilesPanel />
    </div>
  );
}

// ============================================================================
// App — three lazily-built tabs. Static is the default and mounts on load;
// Dynamic and Maps mount only once their tab is first activated (a WebGL plot
// built while display:none would size to 0). Visited tabs stay mounted; the
// Dynamic tab's rAF pauses whenever it is not the active tab.
// ============================================================================
type Tab = "static" | "dynamic" | "maps";

const TABS: Array<{ id: Tab; label: string; count: number }> = [
  { id: "static", label: "Static", count: 49 },
  { id: "dynamic", label: "Dynamic", count: DYN2D.length + DYN_POLAR.length + DYN3D.length + 2 },
  { id: "maps", label: "Maps", count: 3 },
];

export function App() {
  const [active, setActive] = useState<Tab>("static");
  const [seen, setSeen] = useState<Record<Tab, boolean>>({ static: true, dynamic: false, maps: false });

  const go = (t: Tab) => {
    setActive(t);
    setSeen((s) => (s[t] ? s : { ...s, [t]: true }));
  };

  return (
    <main style={S.main}>
      <header style={S.header}>
        <h1 style={S.h1}>
          <b style={{ color: "#60a5fa" }}>Photon</b> · React — WebGL2 chart gallery
        </h1>
        <p style={S.sub}>
          Three tabs via React components. <b>Static</b>: the full catalog with <code>renderType="static"</code>. <b>Dynamic</b>: the
          same types with <code>renderType="dynamic"</code>, streaming live at ~60fps (imperative <code>usePlot</code> + per-panel FPS
          badge), plus a <code>linkX</code>-ed finance dashboard. <b>Maps</b>: offline vector basemaps. Dynamic and Maps mount lazily on
          first activation.
        </p>
      </header>

      <div style={S.tabs}>
        {TABS.map((t) => (
          <button key={t.id} style={tabStyle(active === t.id)} onClick={() => go(t.id)}>
            {t.label}
            <span style={{ color: active === t.id ? "#60a5fa" : "#475569", fontWeight: 400, marginLeft: 6 }}>{t.count}</span>
          </button>
        ))}
      </div>
      <div style={S.tabLine} />

      <section style={{ display: active === "static" ? "block" : "none" }}>{seen.static && <StaticTab />}</section>
      <section style={{ display: active === "dynamic" ? "block" : "none" }}>{seen.dynamic && <DynamicTab running={active === "dynamic"} />}</section>
      <section style={{ display: active === "maps" ? "block" : "none" }}>{seen.maps && <MapsTab />}</section>
    </main>
  );
}
