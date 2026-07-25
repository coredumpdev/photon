<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/core

**GPU-accelerated scientific plotting for the web — WebGL2, zero dependencies.**

<p>
  <a href="https://www.npmjs.com/package/@photonviz/core"><img src="https://img.shields.io/npm/v/@photonviz/core?color=cb3837&logo=npm" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@photonviz/core"><img src="https://img.shields.io/npm/dm/@photonviz/core?color=cb3837" alt="downloads"/></a>
  <a href="https://bundlephobia.com/package/@photonviz/core"><img src="https://img.shields.io/bundlephobia/minzip/@photonviz/core?label=minzip" alt="size"/></a>
  · <a href="https://coredumpdev.github.io/photon/docs/">📖 Docs</a>
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
| Line / Step | `plot.addLine({ x, y, color, width, step, dash })` — real thick lines, round/miter/bevel joins, dashed guides |
| Scatter / Bubble | `plot.addScatter({ x, y, size, sizes, colors, colorBy })` — instanced; per-point size/colour or colormap by value |
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
| **Finance** | `addHeikinAshi` · `addRenko` · `addBollinger` · `addVolumeProfile` · `addDepth` · `addDrawdown` + indicators `sma`/`ema`/`wma`/`rsi`/`macd`/`vwap`/`atr`/`stochastic`/`keltner`/`obv`/`ichimoku`/`adx`/`superTrend`/`fibRetracements`/`cci`/`mfi`/`williamsR`/`aroon`/`donchian`/`parabolicSar`/`pivotPoints` + `resampleOhlc`/`drawdown` |
| **Diagrams** | `plot.addTreemap` · `addFunnel` · `addSunburst` · `addGauge` · `addSankey` · `addChord` · `addParallelCoordinates` — pure `*Layout` fns exported too |
| **ML / DL** | `addTrainingCurves` · `addConfusionMatrix` · `addRocCurve` · `addPrCurve` · `addCalibration` · `addEmbedding` · `addDecisionBoundary` · `addFeatureImportance` · `addShapBeeswarm` · `addPartialDependence` · `addAttentionMap` · `addRidgeline` · `addPredVsActual` · `addResiduals` · `addLiftCurve` · `addLearningCurve` + pure `confusionMatrix`/`rocCurve`/`prCurve`/`calibrationCurve`/`classificationReport`/`rocCurveOvR`/`liftCurve`/`r2`/`rmse`/`mae`/`logLoss`/`brierScore`/`pca` |
| **Statistics** | `addRegression` (OLS + CI band or LOESS) · `addEcdf` · `addCorrMatrix` · `addPsd` + pure `linearRegression`/`loess`/`ecdf`/`zscore`/`corrMatrix`/`welch`/`savitzkyGolay`/`crossCorrelate`/`windowFunction` |
| **Model architecture** | `addModelGraph(plot, { graph })` — layered DAG · `addModelGraph3D(plot3d, { graph })` — tensor-shaped blocks (see below) |

**Polar** — `new PolarPlot(el)` with `addLine` / `addScatter` (drag to rotate, wheel to zoom).
**3D** — `new Plot3D(el)` with `addSurface` / `addPointCloud` / `addLine3D` / `addBar3D` / `addBoxes3D` / `addQuiver3D` / `addContour3D` / `addIsosurface` / `addVolume` (orbit camera, perspective or orthographic).

## Model architecture graphs

Render the layers of a real model — in 2D as a Netron-style DAG, or in 3D as
cuboids sized from each layer's output tensor. Both consume the same
`ModelGraph`, so one export drives either view.

```ts
import { Plot, Plot3D, addModelGraph, addModelGraph3D, modelGraphFromTorchFx } from "@photonviz/core";

const graph = modelGraphFromTorchFx(await (await fetch("/model.json")).json());

// Flat DAG — residual/skip edges route around the trunk, boxes colored by layer family.
addModelGraph(new Plot(el, { hover: false }), { graph, direction: "horizontal", sizeBy: "params" });

// Tensor blocks — feature maps shrink while channel depth grows.
addModelGraph3D(new Plot3D(el3d, { aspectMode: "data", showAxes: false, projection: "orthographic" }), { graph });
```

Adapters (all pure, all zero-dependency) — dump the JSON in Python, load it in the browser:

<details><summary><b>PyTorch</b> — <code>modelGraphFromTorchFx</code> (keeps skip connections)</summary>

```python
import json, torch
from torch.fx import symbolic_trace
from torch.fx.passes.shape_prop import ShapeProp

gm = symbolic_trace(model)
ShapeProp(gm).propagate(torch.randn(1, 3, 224, 224))   # optional: fills in shapes
mods = dict(gm.named_modules())

def shape_of(n):
    t = n.meta.get("tensor_meta")
    return list(t.shape)[1:] if t is not None else None    # drop the batch dim

json.dump([{
    "name": n.name,
    "op": n.op,
    "target": str(n.target),
    "args": [a.name for a in n.all_input_nodes],
    "moduleType": type(mods[str(n.target)]).__name__ if n.op == "call_module" else None,
    "shape": shape_of(n),
    "params": sum(p.numel() for p in mods[str(n.target)].parameters())
              if n.op == "call_module" else None,
} for n in gm.graph.nodes], open("model.json", "w"))
```
</details>

<details><summary><b>TensorFlow / Keras</b> — <code>modelGraphFromKeras</code></summary>

```python
import json
json.dump({
    "model": json.loads(model.to_json()),
    "shapes": {l.name: list(l.output_shape)[1:] for l in model.layers},
    "params": {l.name: l.count_params() for l in model.layers},
}, open("model.json", "w"))
```

Sequential models chain in declaration order; functional models are wired from
`inbound_nodes` (both the Keras 2 and Keras 3 nestings are understood).
</details>

<details><summary><b>scikit-learn</b> — <code>modelGraphFromSklearn</code> / <code>mlpModel</code></summary>

```python
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.compose import ColumnTransformer

def to_step(name, est, columns=None):
    node = {"name": name, "type": type(est).__name__}
    if columns is not None: node["columns"] = list(columns)
    if isinstance(est, Pipeline):
        node.update(steps=[to_step(n, e) for n, e in est.steps], mode="sequential")
    elif isinstance(est, ColumnTransformer):
        node.update(steps=[to_step(n, e, c) for n, e, c in est.transformers], mode="parallel")
    elif isinstance(est, FeatureUnion):
        node.update(steps=[to_step(n, e) for n, e in est.transformer_list], mode="parallel")
    return node

json.dump(to_step("pipe", pipeline), open("model.json", "w"))
```

An `MLPClassifier` is a real layer stack instead:
`mlpModel([n_features, *clf.hidden_layer_sizes, clf.n_outputs_])`.
</details>

<details><summary><b>ONNX</b> — <code>modelGraphFromOnnx</code> (any framework)</summary>

```python
import json, onnx
from google.protobuf.json_format import MessageToDict

m = onnx.shape_inference.infer_shapes(onnx.load("model.onnx"))
json.dump(MessageToDict(m.graph), open("model.json", "w"))
```
</details>

Layers are colored by family (`layerCategory` → conv / linear / norm / activation
/ pool / attention / …); override with `colors`. The layout itself is pure and
exported — `modelLayout(graph, opts)` gives box centers, sizes, ranks and routed
edge paths if you want to draw it yourself.

## Features

- **Scales** — linear, log (decade ticks + GPU log transform), time, categorical, and `ordinal-time` (finance/session axis that collapses market gaps).
- **Streaming** — **every** layer exposes `setData()`; candlesticks add `updateLast`/`appendCandle`; opt into `renderType: "dynamic"` for a `GL_DYNAMIC_DRAW` hint.
- **Linked panes** — `linkX([a, b, …])` syncs pan/zoom + crosshair across plots (price + volume + RSI/MACD dashboards).
- **Interaction** — wheel-zoom, pan, box/X/Y zoom, hover crosshair + tooltips, multiple Y axes, custom ticks.
- **Drawing tools** — `new Plot(el, { drawingTools: true })` adds trendline / horizontal / ray / Fibonacci / rectangle tools; drawings are editable (drag handles, relabel, recolor, delete). API: `setDrawTool`/`getDrawTool`/`addDrawing`/`clearDrawings`.
- **Image export** — every plot has `toDataURL()` / `toBlob()` / `downloadImage()` / `copyToClipboard()` + a toolbar download-PNG button; helpers `canvasToBlob` / `downloadCanvas` / `copyCanvasToClipboard` exported.
- **Data adapters** — `parseCSV(text)` → a `Table` (`.column()` / `.numeric()`), and `lttb(x, y, threshold)` for downsampling long line series.
- **Colorbar** — layers that map values to colours report `colorInfo()` and the plot draws a bar per scale (on by default; `colorbar: false` opts out).
- **Colour** — 12 colormaps (sequential / diverging / cyclic) + 4 categorical palettes; pass inline colours or register your own with `registerColormap` / `registerPalette`.
- **Interactive legend** — click an entry to hide/show a series; the auto axes re-fit to what is left. `plot.toggleLayer()` / `setLayerVisible()` / `onVisibilityChange()`.
- **Accessibility** — plots render as `role="img"` with an auto-summarized `aria-label`; override via `ariaLabel` / `setAriaLabel()` / `describe()`.
- **Many charts, one context** — a single shared WebGL2 context backs every plot, so a page can hold dozens.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) — full docs & source at [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon).
