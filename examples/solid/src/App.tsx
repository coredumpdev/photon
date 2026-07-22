import {
  Annotation,
  Area,
  Bar,
  Candlestick,
  Graph,
  Heatmap,
  Image,
  Line,
  Patches,
  Pie,
  Plot,
  Plot3D,
  PolarLine,
  PolarPlot,
  PolarScatter,
  Scatter,
  Surface,
} from "@photonviz/solid";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";

// Seeded RNG so every reload draws the same synthetic data.
function makeRng(seed: number) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const gaussian = (m: number, sd: number) =>
    m + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * (rand() || 1e-9));
  return { rand, gaussian };
}

function Panel(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ border: "1px solid #333", "border-radius": "8px", overflow: "hidden", background: "#111" }}>
      <div style={{ padding: "8px 12px", font: "600 13px system-ui, sans-serif", color: "#ddd", "border-bottom": "1px solid #333" }}>
        {props.title}
      </div>
      <div style={{ height: "260px" }}>{props.children}</div>
    </div>
  );
}

// ---- Streaming: an oscilloscope that scrolls once per frame. ----------------
function LiveOscilloscope(): JSX.Element {
  const N = 600;
  const x = Float64Array.from({ length: N }, (_, i) => i);
  const buf = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.08) * 1.6 + Math.sin(i * 0.021) * 0.7);
  const [y, setY] = createSignal(buf.slice());
  onMount(() => {
    let id = 0;
    let ph = N;
    const loop = () => {
      buf.copyWithin(0, 1);
      ph += 1;
      buf[N - 1] = Math.sin(ph * 0.08) * 1.6 + Math.sin(ph * 0.021) * 0.7 + (Math.random() - 0.5) * 0.25;
      setY(buf.slice());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(id));
  });
  return (
    <Plot options={{ theme: "dark", scales: { x: { domain: [0, N - 1] }, y: { domain: [-2.6, 2.6] } } }}>
      <Line x={x} y={y()} color="#34d399" width={2} decimate={false} />
    </Plot>
  );
}

// ---- Streaming: fluctuating bars. -------------------------------------------
function LiveBars(): JSX.Element {
  const K = 9;
  const cats = Float64Array.from({ length: K }, (_, i) => i);
  const buf = Float64Array.from({ length: K }, () => 40 + Math.random() * 30);
  const [y, setY] = createSignal(buf.slice());
  onMount(() => {
    let id = 0;
    const loop = () => {
      for (let i = 0; i < K; i++) buf[i] = Math.max(2, Math.min(98, buf[i]! + (Math.random() - 0.5) * 8));
      setY(buf.slice());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(id));
  });
  return (
    <Plot options={{ theme: "dark", scales: { x: { domain: [-0.6, K - 0.4] }, y: { domain: [0, 100] } } }}>
      <Bar x={cats} y={y()} width={0.7} color="#22d3ee" />
    </Plot>
  );
}

export function App(): JSX.Element {
  const { rand, gaussian } = makeRng(42);

  // Static line: a decaying sine.
  const ln = { x: new Float64Array(400), y: new Float64Array(400) };
  for (let i = 0; i < 400; i++) {
    const t = (i / 400) * 12;
    ln.x[i] = t;
    ln.y[i] = Math.sin(t) * Math.exp(-t / 8);
  }

  // Scatter cloud colored by distance.
  const sc = { x: new Float64Array(1200), y: new Float64Array(1200), v: new Float64Array(1200) };
  for (let i = 0; i < 1200; i++) {
    sc.x[i] = gaussian(0, 1.4);
    sc.y[i] = gaussian(0, 1.4);
    sc.v[i] = Math.hypot(sc.x[i]!, sc.y[i]!);
  }

  // Styled + categorical revenue.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const idx = Float64Array.from(months, (_, i) => i);
  const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12);
  const target = Float64Array.from(months, () => 70 + rand() * 12);

  // Grouped bars (two offset series over a categorical axis).
  const qCats = ["Q1", "Q2", "Q3", "Q4"];
  const qIdx = Float64Array.from(qCats, (_, i) => i);
  const north = Float64Array.from(qCats, () => 20 + rand() * 70);
  const south = Float64Array.from(qCats, () => 20 + rand() * 70);

  // Heatmap texture.
  const hm = { cols: 60, rows: 40, values: new Float64Array(60 * 40) };
  for (let r = 0; r < hm.rows; r++)
    for (let c = 0; c < hm.cols; c++) {
      const xx = (c / hm.cols) * 6;
      const yy = (r / hm.rows) * 6;
      hm.values[r * hm.cols + c] = Math.sin(xx) * Math.cos(yy) + Math.sin(xx * yy * 0.15);
    }

  // Candlestick OHLC walk.
  const cs = {
    x: new Float64Array(40),
    open: new Float64Array(40),
    high: new Float64Array(40),
    low: new Float64Array(40),
    close: new Float64Array(40),
  };
  let price = 100;
  for (let i = 0; i < 40; i++) {
    const o = price;
    const c = o + gaussian(0, 2.2);
    cs.x[i] = i;
    cs.open[i] = o;
    cs.close[i] = c;
    cs.high[i] = Math.max(o, c) + Math.abs(gaussian(0, 1.1));
    cs.low[i] = Math.min(o, c) - Math.abs(gaussian(0, 1.1));
    price = c;
  }

  // Polar rose + blips.
  const pTheta = Float64Array.from({ length: 240 }, (_, i) => (i / 239) * Math.PI * 2);
  const pR = Float64Array.from(pTheta, (th) => Math.abs(Math.cos(3 * th)));
  const bTheta = Float64Array.from({ length: 14 }, () => rand() * Math.PI * 2);
  const bR = Float64Array.from({ length: 14 }, () => 0.2 + rand() * 0.75);

  // 3D sinc surface.
  const sf = { cols: 64, rows: 64, values: new Float64Array(64 * 64) };
  for (let r = 0; r < sf.rows; r++)
    for (let c = 0; c < sf.cols; c++) {
      const xx = (c / sf.cols) * 8 - 4;
      const yy = (r / sf.rows) * 8 - 4;
      const rr = Math.hypot(xx, yy) + 1e-6;
      sf.values[r * sf.cols + c] = (Math.sin(rr * 2) / rr) * 3;
    }

  // Marker glyph rows.
  const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const;
  const mkColors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"];
  const mkX = Float64Array.from({ length: 12 }, (_, i) => i);

  // Patches choropleth grid.
  const patchList: { x: number[]; y: number[]; value: number }[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const j = (): number => (rand() - 0.5) * 0.22;
      patchList.push({
        x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
        y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
        value: Math.sin(c * 0.7) + Math.cos(r * 0.9) + rand() * 0.4,
      });
    }
  }

  // Annotations demo line.
  const anN = 100
  const anX = Float64Array.from({ length: anN }, (_, i) => i)
  const anY = Float64Array.from({ length: anN }, (_, i) => Math.sin(i * 0.15) * 3 + 5)

  // Graph edges (auto force layout).
  const gEdges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [3, 4], [4, 5], [5, 3],
    [2, 6], [6, 7], [7, 2], [8, 9], [9, 0], [6, 8], [1, 4],
  ]

  // Procedural RGBA image.
  const iw = 96, ih = 96
  const imgData = new ImageData(iw, ih)
  for (let yy = 0; yy < ih; yy++) {
    for (let xx = 0; xx < iw; xx++) {
      const i = (yy * iw + xx) * 4
      const d = Math.hypot(xx - iw / 2, yy - ih / 2) / (iw / 2)
      imgData.data[i] = Math.round((xx / iw) * 255)
      imgData.data[i + 1] = Math.round((yy / ih) * 255)
      imgData.data[i + 2] = Math.round(Math.max(0, 1 - d) * 255)
      imgData.data[i + 3] = 255
    }
  }

  const grid: JSX.CSSProperties = {
    display: "grid",
    "grid-template-columns": "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    padding: "16px",
  };

  return (
    <main style={{ background: "#0a0a0a", "min-height": "100vh", color: "#eee" }}>
      <h1 style={{ font: "700 22px system-ui, sans-serif", padding: "16px 16px 0" }}>
        Photon · Solid wrappers — gallery
      </h1>
      <div style={grid}>
        <Panel title="Oscilloscope (streaming line)">
          <LiveOscilloscope />
        </Panel>
        <Panel title="Bars (streaming)">
          <LiveBars />
        </Panel>

        <Panel title="Line (decaying sine)">
          <Plot options={{ theme: "dark" }}>
            <Line x={ln.x} y={ln.y} color="#38bdf8" width={2} />
          </Plot>
        </Panel>

        <Panel title="Scatter (colorBy)">
          <Plot options={{ theme: "dark" }}>
            <Scatter x={sc.x} y={sc.y} size={6} colorBy={{ values: sc.v, colormap: "viridis" }} />
          </Plot>
        </Panel>

        <Panel title="Styled + categorical (bg · title · legend · rotated)">
          <Plot
            options={{
              theme: "dark",
              background: "#0b1220",
              title: { text: "Quarterly revenue", align: "left" },
              legend: { position: "top-left" },
              scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
              axes: {
                x: { labelRotation: 40, gridColor: "rgba(148,163,184,0.10)" },
                y: { gridColor: "rgba(148,163,184,0.10)", gridDash: [3, 3] },
              },
              showToolbar: false,
            }}
          >
            <Bar x={idx} y={revenue} width={0.6} color="#38bdf8" name="revenue" />
            <Line x={idx} y={target} color="#f59e0b" width={2.5} name="target" />
          </Plot>
        </Panel>

        <Panel title="Grouped bars (categorical)">
          <Plot
            options={{
              theme: "dark",
              legend: { position: "top-left" },
              scales: { x: { type: "categorical", factors: qCats }, y: { domain: [0, 100] } },
              showToolbar: false,
            }}
          >
            <Bar x={qIdx} y={north} width={0.38} offset={-0.2} color="#38bdf8" name="north" />
            <Bar x={qIdx} y={south} width={0.38} offset={0.2} color="#f472b6" name="south" />
          </Plot>
        </Panel>

        <Panel title="Area">
          <Plot options={{ theme: "dark" }}>
            <Area x={ln.x} y={ln.y.map((v) => v + 1.5)} color="rgba(52,211,153,0.45)" />
          </Plot>
        </Panel>

        <Panel title="Heatmap (viridis)">
          <Plot options={{ theme: "dark" }}>
            <Heatmap values={hm.values} cols={hm.cols} rows={hm.rows} extent={{ x: [0, 6], y: [0, 6] }} colormap="viridis" />
          </Plot>
        </Panel>

        <Panel title="Candlestick (OHLC)">
          <Plot options={{ theme: "dark" }}>
            <Candlestick x={cs.x} open={cs.open} high={cs.high} low={cs.low} close={cs.close} />
          </Plot>
        </Panel>

        <Panel title="Polar (line + scatter)">
          <PolarPlot options={{ theme: "dark", maxRadius: 1 }}>
            <PolarLine theta={pTheta} r={pR} color="#a78bfa" width={2} closed />
            <PolarScatter theta={bTheta} r={bR} color="#f472b6" size={6} />
          </PolarPlot>
        </Panel>

        <Panel title="Scatter markers (6 glyphs)">
          <Plot options={{ theme: "dark", showToolbar: false, scales: { x: { domain: [-1, 12] }, y: { domain: [-1, 6] } } }}>
            {shapes.map((mk, r) => (
              <Scatter
                x={mkX}
                y={Float64Array.from({ length: 12 }, () => shapes.length - 1 - r)}
                size={13}
                marker={mk}
                color={mkColors[r]}
                name={mk}
              />
            ))}
          </Plot>
        </Panel>

        <Panel title="Pie (market share)">
          <Plot
            options={{
              theme: "dark",
              equalAspect: true,
              showToolbar: false,
              hover: false,
              axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } },
            }}
          >
            <Pie values={[35, 25, 20, 12, 8]} colormap="viridis" />
          </Plot>
        </Panel>

        <Panel title="Donut">
          <Plot
            options={{
              theme: "dark",
              equalAspect: true,
              showToolbar: false,
              hover: false,
              axes: { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } },
            }}
          >
            <Pie values={[8, 6, 5, 4, 3, 2]} innerRadius={0.55} />
          </Plot>
        </Panel>

        <Panel title="Patches (choropleth)">
          <Plot options={{ theme: "dark", showToolbar: false }}>
            <Patches patches={patchList} colormap="plasma" />
          </Plot>
        </Panel>

        <Panel title="Annotations (span · band · box · label)">
          <Plot options={{ theme: "dark", showToolbar: false, scales: { x: { domain: [0, anN - 1] }, y: { domain: [0, 10] } } }}>
            <Line x={anX} y={anY} color="#38bdf8" width={2} />
            <Annotation type="band" dim="y" from={6} to={8} color="rgba(52,211,153,0.15)" />
            <Annotation type="span" dim="y" value={5} color="#f59e0b" dash={[5, 4]} />
            <Annotation type="span" dim="x" value={50} color="#f472b6" dash={[5, 4]} />
            <Annotation type="box" x={[20, 35]} y={[2, 4]} border="#a78bfa" />
            <Annotation type="label" x={52} y={9} text="event" color="#f472b6" />
          </Plot>
        </Panel>

        <Panel title="Graph (force layout)">
          <Plot options={{ theme: "dark", showToolbar: false, equalAspect: true }}>
            <Graph edges={gEdges} nodeColor="#38bdf8" edgeColor="rgba(148,163,184,0.4)" nodeSize={13} />
          </Plot>
        </Panel>

        <Panel title="Image (RGBA glyph)">
          <Plot options={{ theme: "dark", showToolbar: false, scales: { x: { domain: [-0.5, 10.5] }, y: { domain: [-0.5, 10.5] } } }}>
            <Image source={imgData} extent={{ x: [0, 10], y: [0, 10] }} />
          </Plot>
        </Panel>

        <Panel title="3D surface">
          <Plot3D options={{ axisLabels: { x: "x", y: "z", z: "y" }, lightControls: true }}>
            <Surface values={sf.values} cols={sf.cols} rows={sf.rows} extentX={[-4, 4]} extentZ={[-4, 4]} colormap="viridis" />
          </Plot3D>
        </Panel>
      </div>
    </main>
  );
}
