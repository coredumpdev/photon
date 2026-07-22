import { Component } from "@geajs/core"
import { Plot, PolarPlot, type SeriesSpec } from "@photonviz/gea"

// Seeded RNG so every reload draws identical synthetic data.
function makeRng(seed: number) {
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const gaussian = (m: number, sd: number) =>
    m + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * (rand() || 1e-9))
  return { rand, gaussian }
}

const { rand, gaussian } = makeRng(42)

// Decaying sine line.
const lx = new Float64Array(400)
const ly = new Float64Array(400)
for (let i = 0; i < 400; i++) {
  const t = (i / 400) * 12
  lx[i] = t
  ly[i] = Math.sin(t) * Math.exp(-t / 8)
}

// Scatter markers — one series per glyph.
const shapes = ["circle", "square", "triangle", "diamond", "cross", "plus"] as const
const mkColors = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#34d399"]
const mkX = Float64Array.from({ length: 12 }, (_, i) => i)
const markerSeries: SeriesSpec[] = shapes.map((mk, r) => ({
  type: "scatter",
  x: mkX,
  y: Float64Array.from({ length: 12 }, () => shapes.length - 1 - r),
  size: 13,
  marker: mk,
  color: mkColors[r],
  name: mk,
}))

// Categorical grouped bars + a target line.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
const idx = Float64Array.from(months, (_, i) => i)
const revenue = Float64Array.from(months, (_, i) => 30 + i * 9 + rand() * 12)
const target = Float64Array.from(months, () => 70 + rand() * 12)

// Candlestick OHLC.
const cx = new Float64Array(40)
const co = new Float64Array(40)
const ch = new Float64Array(40)
const cl = new Float64Array(40)
const cc = new Float64Array(40)
let price = 100
for (let i = 0; i < 40; i++) {
  const o = price
  const c = o + gaussian(0, 2.2)
  cx[i] = i
  co[i] = o
  cc[i] = c
  ch[i] = Math.max(o, c) + Math.abs(gaussian(0, 1.1))
  cl[i] = Math.min(o, c) - Math.abs(gaussian(0, 1.1))
  price = c
}

// Patches choropleth grid.
const patchList: { x: number[]; y: number[]; value: number }[] = []
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 6; c++) {
    const j = () => (rand() - 0.5) * 0.22
    patchList.push({
      x: [c + j(), c + 1 + j(), c + 1 + j(), c + j()],
      y: [r + j(), r + j(), r + 1 + j(), r + 1 + j()],
      value: Math.sin(c * 0.7) + Math.cos(r * 0.9) + rand() * 0.4,
    })
  }
}

// Polar rose + blips.
const pTheta = Float64Array.from({ length: 240 }, (_, i) => (i / 239) * Math.PI * 2)
const pR = Float64Array.from(pTheta, (th) => Math.abs(Math.cos(3 * th)))
const bTheta = Float64Array.from({ length: 14 }, () => rand() * Math.PI * 2)
const bR = Float64Array.from({ length: 14 }, () => 0.2 + rand() * 0.75)

const HIDDEN_AXES = { x: { ticks: [], showAxisLine: false }, y: { ticks: [], showAxisLine: false } }

export default class App extends Component {
  template() {
    return (
      <main>
        <h1>Photon · Gea wrapper — gallery</h1>
        <div class="grid">
          <div class="panel">
            <h2>Line (decaying sine)</h2>
            <div class="chart">
              <Plot options={{ theme: "dark" }} series={[{ type: "line", x: lx, y: ly, color: "#38bdf8", width: 2 }]} />
            </div>
          </div>

          <div class="panel">
            <h2>Scatter markers (6 glyphs)</h2>
            <div class="chart">
              <Plot
                options={{ theme: "dark", showToolbar: false, scales: { x: { domain: [-1, 12] }, y: { domain: [-1, 6] } } }}
                series={markerSeries}
              />
            </div>
          </div>

          <div class="panel">
            <h2>Grouped bars + line (categorical)</h2>
            <div class="chart">
              <Plot
                options={{
                  theme: "dark",
                  legend: { position: "top-left" },
                  scales: { x: { type: "categorical", factors: months }, y: { domain: [0, 110] } },
                  showToolbar: false,
                }}
                series={[
                  { type: "bar", x: idx, y: revenue, width: 0.55, color: "#38bdf8", name: "revenue" },
                  { type: "line", x: idx, y: target, color: "#f59e0b", width: 2.5, name: "target" },
                ]}
              />
            </div>
          </div>

          <div class="panel">
            <h2>Pie (viridis)</h2>
            <div class="chart">
              <Plot
                options={{ theme: "dark", equalAspect: true, showToolbar: false, hover: false, axes: HIDDEN_AXES }}
                series={[{ type: "pie", values: [35, 25, 20, 12, 8], colormap: "viridis" }]}
              />
            </div>
          </div>

          <div class="panel">
            <h2>Donut</h2>
            <div class="chart">
              <Plot
                options={{ theme: "dark", equalAspect: true, showToolbar: false, hover: false, axes: HIDDEN_AXES }}
                series={[{ type: "pie", values: [8, 6, 5, 4, 3, 2], innerRadius: 0.55 }]}
              />
            </div>
          </div>

          <div class="panel">
            <h2>Patches (choropleth)</h2>
            <div class="chart">
              <Plot options={{ theme: "dark", showToolbar: false }} series={[{ type: "patches", patches: patchList, colormap: "plasma" }]} />
            </div>
          </div>

          <div class="panel">
            <h2>Candlestick (OHLC)</h2>
            <div class="chart">
              <Plot options={{ theme: "dark" }} series={[{ type: "candlestick", x: cx, open: co, high: ch, low: cl, close: cc }]} />
            </div>
          </div>

          <div class="panel">
            <h2>Polar (line + scatter)</h2>
            <div class="chart">
              <PolarPlot
                options={{ theme: "dark", maxRadius: 1 }}
                series={[
                  { type: "line", theta: pTheta, r: pR, color: "#a78bfa", width: 2, closed: true },
                  { type: "scatter", theta: bTheta, r: bR, color: "#f472b6", size: 6 },
                ]}
              />
            </div>
          </div>
        </div>
      </main>
    )
  }
}
