<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/core

**GPU-accelerated scientific plotting for the web — WebGL2, zero dependencies.**

<p>
  <a href="https://www.npmjs.com/package/@photonviz/core"><img src="https://img.shields.io/npm/v/@photonviz/core?color=cb3837&logo=npm" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@photonviz/core"><img src="https://img.shields.io/npm/dm/@photonviz/core?color=cb3837" alt="downloads"/></a>
  <a href="https://bundlephobia.com/package/@photonviz/core"><img src="https://img.shields.io/bundlephobia/minzip/@photonviz/core?label=minzip" alt="size"/></a>
  · <a href="https://coredumpdev.github.io/photon/">▶ Live demo</a>
  · <a href="https://coredumpdev.github.io/photon/llms-full.txt">Docs for AI agents</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/streaming.gif" alt="Live streaming WebGL2 charts at 60fps" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

The framework-agnostic core of [Photon](https://github.com/coredumpdev/photon).
Renders geometry on the GPU (instanced WebGL2 + min/max decimation) and draws
axes, ticks, and labels on a crisp Canvas2D overlay — so you get both **scale**
(millions of points at 60fps) and **sharp text**.

```bash
npm i @photonviz/core
```

> Framework bindings: [`@photonviz/react`](https://www.npmjs.com/package/@photonviz/react) · [`@photonviz/vue`](https://www.npmjs.com/package/@photonviz/vue) · [`@photonviz/svelte`](https://www.npmjs.com/package/@photonviz/svelte) · [`@photonviz/solid`](https://www.npmjs.com/package/@photonviz/solid) · [`@photonviz/gea`](https://www.npmjs.com/package/@photonviz/gea) · framework-free [`@photonviz/wc`](https://www.npmjs.com/package/@photonviz/wc) Web Components
## Quick start

```ts
import { Plot } from "@photonviz/core";

const plot = new Plot(document.getElementById("chart")!, {
  theme: "dark",
  scales: { y: { type: "log" } },
});

plot.addLine({ x: xs, y: ys, color: "#60a5fa", width: 2, name: "signal" });
// wheel to zoom · drag to pan · box-zoom + home from the toolbar · hover for tooltips
```

## Chart types

| Type | API |
| --- | --- |
| Line / Step | `plot.addLine({ x, y, color, width, step })` — real thick lines, round/miter/bevel joins |
| Scatter | `plot.addScatter({ x, y, size, colorBy })` — instanced, colormap by value |
| Bar | `plot.addBar({ x, y, width, offset, base })` — grouped / stacked |
| Area | `plot.addArea({ x, y, base })` |
| Histogram | `plot.addHistogram(values, { bins })` |
| Box / Violin | `plot.addBox({ groups, violin })` — Tukey quartiles, KDE |
| Heatmap | `plot.addHeatmap({ values, cols, rows, extent, colormap })` |
| Contour | `plot.addContour({ values, cols, rows, extent, levels })` |
| Hexbin | `plot.addHexbin({ x, y, radius, colormap })` |
| Error bar / Stem / Quiver | `plot.addErrorBar` · `addStem` · `addQuiver` |
| Candlestick / OHLC | `plot.addCandlestick({ x, open, high, low, close })` · `addOhlc(...)` — live via `updateLast` / `appendCandle` |
| Pie / Patches / Graph / Image | `plot.addPie` · `addPatches` · `addGraph` · `addImage` |
| **Finance** | `addHeikinAshi` · `addRenko` · `addBollinger` · `addVolumeProfile` · `addDepth` + indicators `sma`/`ema`/`wma`/`rsi`/`macd`/`vwap`/`atr`/`stochastic`/`keltner`/`obv`/`ichimoku`/`adx`/`superTrend`/`fibRetracements` |
| **Diagrams** | `plot.addTreemap` · `addFunnel` · `addSunburst` · `addGauge` · `addSankey` · `addChord` · `addParallelCoordinates` — pure `*Layout` fns exported too |

**Polar** — `new PolarPlot(el)` with `addLine` / `addScatter` (drag to rotate, wheel to zoom).
**3D** — `new Plot3D(el)` with `addSurface` / `addPointCloud` / `addLine3D` / `addBar3D` / `addQuiver3D` / `addContour3D` / `addIsosurface` / `addVolume` (orbit camera).

## Features

- **Scales** — linear, log (decade ticks + GPU log transform), time, categorical, and `ordinal-time` (finance/session axis that collapses market gaps).
- **Streaming** — **every** layer exposes `setData()`; candlesticks add `updateLast`/`appendCandle`; opt into `renderType: "dynamic"` for a `GL_DYNAMIC_DRAW` hint.
- **Linked panes** — `linkX([a, b, …])` syncs pan/zoom + crosshair across plots (price + volume + RSI/MACD dashboards).
- **Interaction** — wheel-zoom, pan, box/X/Y zoom, hover crosshair + tooltips, multiple Y axes, custom ticks.
- **Drawing tools** — `new Plot(el, { drawingTools: true })` adds trendline / horizontal / ray / Fibonacci / rectangle tools; drawings are editable (drag handles, relabel, recolor, delete). API: `setDrawTool`/`getDrawTool`/`addDrawing`/`clearDrawings`.
- **Image export** — every plot has `toDataURL()` / `toBlob()` / `downloadImage()` / `copyToClipboard()` + a toolbar download-PNG button; helpers `canvasToBlob` / `downloadCanvas` / `copyCanvasToClipboard` exported.
- **Data adapters** — `parseCSV(text)` → a `Table` (`.column()` / `.numeric()`), and `lttb(x, y, threshold)` for downsampling long line series.
- **Accessibility** — plots render as `role="img"` with an auto-summarized `aria-label`; override via `ariaLabel` / `setAriaLabel()` / `describe()`.
- **Many charts, one context** — a single shared WebGL2 context backs every plot, so a page can hold dozens.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) — full docs & source at [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon).
