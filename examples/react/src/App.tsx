import { xyzVectorSource } from "@photonviz/map";
import {
  Area,
  Bar,
  Box,
  Candlestick,
  Contour,
  ErrorBar,
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
} from "@photonviz/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const PANEL_HEIGHT = 260;

type Pair = [number, number];

// Run a callback once per animation frame; `frame` counts up from 1.
function useRaf(cb: (frame: number) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    let id = 0;
    let frame = 0;
    const loop = () => {
      frame += 1;
      ref.current(frame);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

// Seeded RNG so every reload draws the same synthetic data.
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

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const box: CSSProperties = {
    border: "1px solid #333",
    borderRadius: 8,
    overflow: "hidden",
    background: "#111",
  };
  const head: CSSProperties = {
    padding: "8px 12px",
    font: "600 13px system-ui, sans-serif",
    color: "#ddd",
    borderBottom: "1px solid #333",
  };
  return (
    <div style={box}>
      <div style={head}>{title}</div>
      <div style={{ height: PANEL_HEIGHT }}>{children}</div>
    </div>
  );
}

// ---- Live / streaming panels -------------------------------------------
// Each keeps its data in a mutable ref buffer, advances it once per frame,
// and pushes a fresh array reference into state so the wrapper re-streams it.

function LiveOscilloscope() {
  const N = 600;
  const x = useMemo(() => Float64Array.from({ length: N }, (_, i) => i), []);
  const buf = useRef(
    Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7),
  );
  const [y, setY] = useState<Float64Array>(() => buf.current.slice());
  const phase = useRef(N);
  useRaf(() => {
    const b = buf.current;
    b.copyWithin(0, 1);
    phase.current += 1;
    b[N - 1] =
      Math.sin(phase.current * 0.08) * 1.6 +
      Math.sin(phase.current * 0.021) * 0.7 +
      (Math.random() - 0.5) * 0.25;
    setY(b.slice());
  });
  return (
    <Plot options={{ scales: { x: { domain: [0, N - 1] }, y: { domain: [-2.6, 2.6] } } }}>
      <Line x={x} y={y} color="#34d399" width={2} decimate={false} />
    </Plot>
  );
}

function LiveSignals() {
  const N = 500;
  const colors = ["#60a5fa", "#f472b6", "#fbbf24"];
  const x = useMemo(() => Float64Array.from({ length: N }, (_, i) => i), []);
  const bufs = useRef(
    colors.map((_, k) =>
      Float64Array.from(
        { length: N },
        (_, j) => Math.sin(j * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + k * 0.1,
      ),
    ),
  );
  const [ys, setYs] = useState<Float64Array[]>(() => bufs.current.map((b) => b.slice()));
  const phase = useRef(N);
  useRaf(() => {
    phase.current += 1;
    const ph = phase.current;
    bufs.current.forEach((b, k) => {
      b.copyWithin(0, 1);
      b[N - 1] =
        Math.sin(ph * (0.05 + k * 0.03)) * (1.5 - k * 0.3) + (Math.random() - 0.5) * 0.2 + k * 0.1;
    });
    setYs(bufs.current.map((b) => b.slice()));
  });
  return (
    <Plot options={{ scales: { x: { domain: [0, N - 1] }, y: { domain: [-3.5, 3.5] } } }}>
      {ys.map((y, k) => (
        <Line key={k} x={x} y={y} color={colors[k]} width={1.5} decimate={false} />
      ))}
    </Plot>
  );
}

function LiveScatter() {
  const M = 700;
  const bx = useRef(new Float64Array(M));
  const by = useRef(new Float64Array(M));
  const init = useRef(false);
  if (!init.current) {
    const { gaussian } = makeRng(101);
    for (let i = 0; i < M; i++) {
      bx.current[i] = gaussian(0, 1);
      by.current[i] = gaussian(0, 1);
    }
    init.current = true;
  }
  const [pt, setPt] = useState(() => ({ x: bx.current.slice(), y: by.current.slice() }));
  useRaf(() => {
    const x = bx.current;
    const y = by.current;
    for (let i = 0; i < M; i++) {
      x[i] += (Math.random() - 0.5) * 0.08 - x[i] * 0.01;
      y[i] += (Math.random() - 0.5) * 0.08 - y[i] * 0.01;
    }
    setPt({ x: x.slice(), y: y.slice() });
  });
  return (
    <Plot options={{ scales: { x: { domain: [-4, 4] }, y: { domain: [-4, 4] } } }}>
      <Scatter x={pt.x} y={pt.y} size={5} color="#818cf8" />
    </Plot>
  );
}

function LiveBars() {
  const K = 9;
  const cats = useMemo(() => Float64Array.from({ length: K }, (_, i) => i), []);
  const buf = useRef<Float64Array | null>(null);
  if (!buf.current) {
    const { rand } = makeRng(103);
    buf.current = Float64Array.from({ length: K }, () => 40 + rand() * 30);
  }
  const [y, setY] = useState<Float64Array>(() => buf.current!.slice());
  useRaf(() => {
    const b = buf.current!;
    for (let i = 0; i < K; i++) b[i] = Math.max(2, Math.min(98, b[i] + (Math.random() - 0.5) * 8));
    setY(b.slice());
  });
  return (
    <Plot options={{ scales: { x: { domain: [-0.6, K - 0.4] }, y: { domain: [0, 100] } } }}>
      <Bar x={cats} y={y} width={0.7} color="#22d3ee" />
    </Plot>
  );
}

function LiveArea() {
  const N = 400;
  const x = useMemo(() => Float64Array.from({ length: N }, (_, i) => i), []);
  const buf = useRef(
    Float64Array.from({ length: N }, (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7),
  );
  const [y, setY] = useState<Float64Array>(() => buf.current.slice());
  const phase = useRef(N);
  useRaf(() => {
    const b = buf.current;
    b.copyWithin(0, 1);
    phase.current += 1;
    b[N - 1] = 2 + Math.sin(phase.current * 0.06) + Math.sin(phase.current * 0.017) * 0.7 + Math.random() * 0.2;
    setY(b.slice());
  });
  return (
    <Plot options={{ scales: { x: { domain: [0, N - 1] }, y: { domain: [0, 4] } } }}>
      <Area x={x} y={y} color="rgba(52,211,153,0.45)" />
    </Plot>
  );
}

function LivePolarRadar() {
  const blips = useMemo(() => {
    const { rand } = makeRng(107);
    const b = 14;
    const theta = Float64Array.from({ length: b }, () => rand() * 360);
    const r = Float64Array.from({ length: b }, () => 0.2 + rand() * 0.75);
    const labels = Array.from({ length: b }, (_, i) => `Contact ${i + 1}`);
    return { theta, r, labels };
  }, []);
  const [sweep, setSweep] = useState<Pair>([0, 0]);
  useRaf((frame) => {
    const ang = (frame * 2.5) % 360;
    setSweep([ang, ang]);
  });
  return (
    <PolarPlot options={{ theme: "dark", angleUnit: "deg", maxRadius: 1 }}>
      <PolarLine theta={sweep} r={[0, 1]} color="#22d3ee" width={2} />
      <PolarScatter theta={blips.theta} r={blips.r} color="#f472b6" size={6} labels={blips.labels} />
    </PolarPlot>
  );
}

export function App() {
  // ---- Synthetic data (generated once, seeded) ---------------------------

  // Line: a decaying sine wave.
  const line = useMemo(() => {
    const n = 400;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 12;
      x[i] = t;
      y[i] = Math.sin(t) * Math.exp(-t / 8);
    }
    return { x, y };
  }, []);

  // Step line: a digital / staircase signal.
  const step = useMemo(() => {
    const { rand } = makeRng(7);
    const n = 24;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, () => Math.round(rand() * 3));
    return { x, y };
  }, []);

  // Scatter: a value-colored cloud (color by distance from origin).
  const scatter = useMemo(() => {
    const { gaussian } = makeRng(11);
    const n = 1200;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = gaussian(0, 1.4);
      y[i] = gaussian(0, 1.4);
      v[i] = Math.hypot(x[i], y[i]);
    }
    return { x, y, v };
  }, []);

  // Bars: two grouped series (offset) plus a stacked overlay (base).
  const bars = useMemo(() => {
    const { rand } = makeRng(19);
    const k = 8;
    const cats = Float64Array.from({ length: k }, (_, i) => i);
    const a = Float64Array.from({ length: k }, () => 30 + rand() * 40);
    const b = Float64Array.from({ length: k }, () => 30 + rand() * 40);
    const stackTop = Float64Array.from({ length: k }, () => 15 + rand() * 25);
    return { cats, a, b, stackTop };
  }, []);

  // Area: a smooth streamed-looking band.
  const area = useMemo(() => {
    const n = 300;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from(
      { length: n },
      (_, i) => 2 + Math.sin(i * 0.06) + Math.sin(i * 0.017) * 0.7,
    );
    return { x, y };
  }, []);

  // Heatmap: sinusoidal texture on a grid.
  const heatmap = useMemo(() => {
    const cols = 60;
    const rows = 40;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6;
        const yy = (r / rows) * 6;
        values[r * cols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
      }
    }
    return {
      values,
      cols,
      rows,
      extent: { x: [0, 6] as Pair, y: [0, 6] as Pair },
    };
  }, []);

  // Box: four Tukey groups with increasing spread.
  const boxGroups = useMemo(() => {
    const { gaussian } = makeRng(23);
    const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];
    return [0, 1, 2, 3].map((g) => ({
      position: g,
      values: Array.from({ length: 120 }, () => gaussian(g, 1 + g * 0.3)),
      color: colors[g],
    }));
  }, []);

  // Hexbin: a two-blob density cloud.
  const hexbin = useMemo(() => {
    const { gaussian } = makeRng(29);
    const m = 25_000;
    const x = new Float64Array(m);
    const y = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const blob = i % 2 === 0 ? -1.4 : 1.4;
      x[i] = gaussian(blob, 1);
      y[i] = gaussian(blob * 0.6, 1.1);
    }
    return { x, y };
  }, []);

  // Contour: iso-lines over a ripple field.
  const contour = useMemo(() => {
    const cols = 80;
    const rows = 60;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 6 - 3;
        const yy = (r / rows) * 6 - 3;
        values[r * cols + c] = Math.sin(xx) * Math.cos(yy) - 0.02 * (xx * xx + yy * yy);
      }
    }
    return {
      values,
      cols,
      rows,
      extent: { x: [-3, 3] as Pair, y: [-3, 3] as Pair },
    };
  }, []);

  // Error bars: whiskers + caps over a sampled curve.
  const errorbar = useMemo(() => {
    const { rand } = makeRng(31);
    const n = 12;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 2) * 3 + 5);
    const yerr = Float64Array.from({ length: n }, () => 0.4 + rand() * 0.9);
    return { x, y, yerr };
  }, []);

  // Stem: a discrete damped oscillation.
  const stem = useMemo(() => {
    const n = 30;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from(
      { length: n },
      (_, i) => Math.exp(-i / 12) * Math.cos(i / 2),
    );
    return { x, y };
  }, []);

  // Quiver: a rotational vector field, arrows colored by magnitude.
  const quiver = useMemo(() => {
    const g = 16;
    const x: number[] = [];
    const y: number[] = [];
    const u: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < g; i++) {
      for (let j = 0; j < g; j++) {
        const px = (i / (g - 1)) * 4 - 2;
        const py = (j / (g - 1)) * 4 - 2;
        x.push(px);
        y.push(py);
        u.push(-py);
        v.push(px);
      }
    }
    return { x, y, u, v };
  }, []);

  // Candlestick: an OHLC random walk.
  const candles = useMemo(() => {
    const { gaussian } = makeRng(37);
    const n = 40;
    const x = new Float64Array(n);
    const open = new Float64Array(n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const close = new Float64Array(n);
    let price = 100;
    for (let i = 0; i < n; i++) {
      const o = price;
      const c = o + gaussian(0, 2.2);
      x[i] = i;
      open[i] = o;
      close[i] = c;
      high[i] = Math.max(o, c) + Math.abs(gaussian(0, 1.1));
      low[i] = Math.min(o, c) - Math.abs(gaussian(0, 1.1));
      price = c;
    }
    return { x, open, high, low, close };
  }, []);

  // Polar: a rose curve line + scatter blips.
  const polar = useMemo(() => {
    const { rand } = makeRng(41);
    const t = 240;
    const theta = Float64Array.from({ length: t }, (_, i) => (i / (t - 1)) * Math.PI * 2);
    const r = Float64Array.from(theta, (th) => Math.abs(Math.cos(3 * th)));
    const b = 14;
    const blipTheta = Float64Array.from({ length: b }, () => rand() * Math.PI * 2);
    const blipR = Float64Array.from({ length: b }, () => 0.2 + rand() * 0.75);
    const blipLabels = Array.from({ length: b }, (_, i) => `Contact ${i + 1}`);
    return { theta, r, blipTheta, blipR, blipLabels };
  }, []);

  // 3D surface: a radial sinc height field.
  const surface = useMemo(() => {
    const cols = 64;
    const rows = 64;
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const xx = (c / cols) * 8 - 4;
        const yy = (r / rows) * 8 - 4;
        const rr = Math.hypot(xx, yy) + 1e-6;
        values[r * cols + c] = (Math.sin(rr * 2) / rr) * 3;
      }
    }
    return {
      values,
      cols,
      rows,
      extentX: [-4, 4] as Pair,
      extentZ: [-4, 4] as Pair,
    };
  }, []);

  // 3D point cloud: a rising spiral, colored by height.
  const cloud = useMemo(() => {
    const { gaussian } = makeRng(43);
    const n = 6000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 20;
      const rr = 1 + (i / n) * 2;
      x[i] = Math.cos(th) * rr + gaussian(0, 0.1);
      z[i] = Math.sin(th) * rr + gaussian(0, 0.1);
      y[i] = (i / n) * 4 - 2 + gaussian(0, 0.05);
    }
    return { x, y, z };
  }, []);

  // Map: MapLibre demo vector tiles.
  const mapSource = useMemo(
    () =>
      xyzVectorSource({
        url: "https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf",
        attribution: "© MapLibre",
        maxZoom: 5,
      }),
    [],
  );

  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
    padding: 16,
  };

  return (
    <main style={{ background: "#0a0a0a", minHeight: "100vh", color: "#eee" }}>
      <h1 style={{ font: "700 22px system-ui, sans-serif", padding: "16px 16px 0" }}>
        Photon · React wrappers — full gallery
      </h1>

      <h2 style={{ font: "600 16px system-ui, sans-serif", padding: "16px 16px 0", color: "#9ca3af" }}>
        Live / streaming · ~60fps
      </h2>
      <div style={grid}>
        <Panel title="Oscilloscope (scrolling line)">
          <LiveOscilloscope />
        </Panel>
        <Panel title="Signals (3 channels)">
          <LiveSignals />
        </Panel>
        <Panel title="Scatter (drifting cloud)">
          <LiveScatter />
        </Panel>
        <Panel title="Bars (fluctuating)">
          <LiveBars />
        </Panel>
        <Panel title="Area (streaming)">
          <LiveArea />
        </Panel>
        <Panel title="Polar radar (rotating sweep)">
          <LivePolarRadar />
        </Panel>
      </div>

      <h2 style={{ font: "600 16px system-ui, sans-serif", padding: "16px 16px 0", color: "#9ca3af" }}>
        Static gallery
      </h2>
      <div style={grid}>
        <Panel title="Line">
          <Plot>
            <Line x={line.x} y={line.y} color="#38bdf8" width={2} />
          </Plot>
        </Panel>

        <Panel title="Step line (step: after)">
          <Plot>
            <Line
              x={step.x}
              y={step.y}
              color="#fbbf24"
              width={2.5}
              step="after"
              join="miter"
            />
          </Plot>
        </Panel>

        <Panel title="Scatter (colorBy)">
          <Plot>
            <Scatter
              x={scatter.x}
              y={scatter.y}
              size={6}
              colorBy={{ values: scatter.v, colormap: "viridis" }}
            />
          </Plot>
        </Panel>

        <Panel title="Bar (grouped + stacked)">
          <Plot>
            <Bar x={bars.cats} y={bars.a} width={0.35} offset={-0.2} color="#22d3ee" name="A" />
            <Bar x={bars.cats} y={bars.b} width={0.35} offset={0.2} color="#f472b6" name="B" />
            <Bar
              x={bars.cats}
              y={bars.stackTop}
              base={bars.a}
              width={0.35}
              offset={-0.2}
              color="#a78bfa"
              name="A · stacked"
            />
          </Plot>
        </Panel>

        <Panel title="Area">
          <Plot>
            <Area x={area.x} y={area.y} color="rgba(52,211,153,0.45)" />
          </Plot>
        </Panel>

        <Panel title="Heatmap (viridis)">
          <Plot>
            <Heatmap
              values={heatmap.values}
              cols={heatmap.cols}
              rows={heatmap.rows}
              extent={heatmap.extent}
              colormap="viridis"
            />
          </Plot>
        </Panel>

        <Panel title="Box (Tukey groups)">
          <Plot>
            <Box groups={boxGroups} width={0.6} />
          </Plot>
        </Panel>

        <Panel title="Hexbin (density)">
          <Plot options={{ equalAspect: false }}>
            <Hexbin x={hexbin.x} y={hexbin.y} radius={0.22} colormap="plasma" />
          </Plot>
        </Panel>

        <Panel title="Contour (marching squares)">
          <Plot>
            <Contour
              values={contour.values}
              cols={contour.cols}
              rows={contour.rows}
              extent={contour.extent}
              levels={12}
              colormap="viridis"
            />
          </Plot>
        </Panel>

        <Panel title="Error bars (whiskers + caps)">
          <Plot>
            <Line x={errorbar.x} y={errorbar.y} color="#60a5fa" width={1.5} />
            <ErrorBar x={errorbar.x} y={errorbar.y} yerr={errorbar.yerr} color="#60a5fa" capSize={7} />
          </Plot>
        </Panel>

        <Panel title="Stem (lollipop)">
          <Plot>
            <Stem x={stem.x} y={stem.y} color="#34d399" markerSize={6} />
          </Plot>
        </Panel>

        <Panel title="Quiver (vector field)">
          <Plot>
            <Quiver
              x={quiver.x}
              y={quiver.y}
              u={quiver.u}
              v={quiver.v}
              colorBy={{ colormap: "viridis" }}
            />
          </Plot>
        </Panel>

        <Panel title="Candlestick (OHLC)">
          <Plot>
            <Candlestick
              x={candles.x}
              open={candles.open}
              high={candles.high}
              low={candles.low}
              close={candles.close}
            />
          </Plot>
        </Panel>

        <Panel title="Polar (line + scatter)">
          <PolarPlot options={{ theme: "dark", maxRadius: 1 }}>
            <PolarLine theta={polar.theta} r={polar.r} color="#a78bfa" width={2} closed />
            <PolarScatter
              theta={polar.blipTheta}
              r={polar.blipR}
              color="#f472b6"
              size={6}
              labels={polar.blipLabels}
            />
          </PolarPlot>
        </Panel>

        <Panel title="3D surface">
          <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true }}>
            <Surface
              values={surface.values}
              cols={surface.cols}
              rows={surface.rows}
              extentX={surface.extentX}
              extentZ={surface.extentZ}
              colormap="viridis"
            />
          </Plot3D>
        </Panel>

        <Panel title="3D point cloud">
          <Plot3D options={{ axisLabels: { x: "x", y: "height", z: "z" } }}>
            <PointCloud
              x={cloud.x}
              y={cloud.y}
              z={cloud.z}
              size={4}
              colorBy={{ values: cloud.y, colormap: "plasma" }}
            />
          </Plot3D>
        </Panel>

        <Panel title="Map (vector tiles)">
          <Plot options={{ equalAspect: true, boundedPan: true }}>
            <Map source={mapSource} />
          </Plot>
        </Panel>
      </div>
    </main>
  );
}
