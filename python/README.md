<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# photonviz

**GPU-accelerated (WebGL2) charts for Jupyter, JupyterLab and Google Colab.**

<p>
  <a href="https://pypi.org/project/photonviz/"><img src="https://img.shields.io/pypi/v/photonviz?color=3775a9&logo=pypi&logoColor=white" alt="PyPI"/></a>
  <a href="https://pypi.org/project/photonviz/"><img src="https://img.shields.io/pypi/dm/photonviz?color=3775a9" alt="downloads"/></a>
  <a href="https://pypi.org/project/photonviz/"><img src="https://img.shields.io/pypi/pyversions/photonviz?color=3775a9" alt="Python versions"/></a>
  <img src="https://img.shields.io/badge/WebGL2-required-8b5cf6" alt="WebGL2"/>
  <img src="https://img.shields.io/badge/Jupyter%20%C2%B7%20Lab%20%C2%B7%20Colab-supported-f37626?logo=jupyter&logoColor=white" alt="Jupyter · Lab · Colab"/>
  <a href="https://github.com/coredumpdev/photon/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"/></a>
  · <a href="https://coredumpdev.github.io/photon/docs/python/">📖 Docs</a>
  · <a href="https://coredumpdev.github.io/photon/">▶ Live demo</a>
</p>

The Python bridge to [Photon](https://github.com/coredumpdev/photon). NumPy
arrays and torch tensors cross to the browser as **binary buffers**, so a million
points still pan and zoom at 60fps inside a notebook cell — no image round-trip,
no JSON blow-up.

```bash
pip install photonviz
```

Nothing else to install: the widget ships one self-contained ESM bundle, so there
is no CDN fetch, no `jupyter labextension install`, and no separate JS package.

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/jupyter-hero.png" alt="A 200,000-point line chart rendered by photonviz in JupyterLab" width="100%" />
</p>

<sub>Real capture from JupyterLab — 200k points, interactive: wheel to zoom, drag to pan, hover for a tooltip.</sub>

---

## Quick start

```python
import numpy as np
import photonviz as pv

x = np.linspace(0, 10, 200_000)
pv.line(x, np.sin(x) + 0.3 * np.sin(x * 7), name="signal", plot={"theme": "dark", "legend": True})
```

Charts chain, and the last expression in a cell renders itself:

```python
(pv.Plot(theme="dark", title="Two series", legend=True)
   .line(x, np.sin(x), name="sin", color="#60a5fa")
   .line(x, np.cos(x), name="cos", color="#f472b6", dash=[6, 4])
   .hline(0, color="#64748b"))
```

Every keyword maps 1:1 onto the [TypeScript options](https://coredumpdev.github.io/photon/llms-full.txt),
so the JS reference applies verbatim — `color`, `width`, `step`, `colorBy`,
`yAxis`, `renderType`, and so on.

### Google Colab

Run once per session, then use `photonviz` normally:

```python
from google.colab import output
output.enable_custom_widget_manager()
```

---

## What you can draw

```python
pv.scatter(x, y, sizes=area, colors=hex_list)     # bubble chart
pv.histogram(samples, bins=40)
pv.heatmap(z, cols, rows, extent={"x": [0, 1], "y": [0, 1]}, colormap="magma")
pv.candlestick(t, o, h, l, c)                     # + heikin_ashi, bollinger, drawdown…
pv.regression(x, y, band=2)                       # OLS + confidence band (or method="loess")
pv.corr_matrix([a, b, c], names=["a", "b", "c"])  # diverging, locked to ±1
pv.psd(signal, sampleRate=1000)                   # Welch spectrum
pv.confusion_matrix(y_true, y_pred)               # + roc_curve, pr_curve, calibration, embedding…
pv.surface(z, cols, rows)                         # 3D — orbit with the mouse
pv.polar_line(theta, r)
```

`Plot`, `Plot3D` and `Polar` are the full objects; the module-level names are
one-line shortcuts. Pass `plot={...}` to a shortcut to configure the plot itself:

```python
pv.scatter(x, y, size=4, plot={"theme": "dark", "pick": "xy", "colorbar": False})
```

---

## Model architecture

Hand a **PyTorch**, **Keras**, **scikit-learn** or **ONNX** model straight to
`model_graph` — the export happens in Python, the layout in the browser.

```python
import torch, torchvision, photonviz as pv

model = torchvision.models.resnet18()

# 2D — a Netron-style DAG, with residual connections routed around the trunk.
pv.model_graph(model, example_input=torch.randn(1, 3, 224, 224), direction="horizontal")

# 3D — one cuboid per layer, sized from its output tensor: feature maps shrink
# while channel depth grows.
pv.model_graph_3d(
    model,
    example_input=torch.randn(1, 3, 224, 224),
    labels="full",
    plot={"aspectMode": "data", "projection": "orthographic", "showAxes": False},
)
```

| Framework | How it is read | Notes |
| --- | --- | --- |
| PyTorch | `torch.fx` symbolic trace | Branches and skip connections survive. Pass `example_input=` to record shapes. Untraceable models fall back to a flat chain of leaf modules. |
| Keras / TF | `model.to_json()` + per-layer shapes | Sequential and functional, Keras 2 and 3. |
| scikit-learn | `Pipeline` / `ColumnTransformer` / `FeatureUnion` walk | Parallel branches fan out and back in. An `MLPClassifier` expands into its real dense stack. |
| ONNX | `MessageToDict` + shape inference | The framework-neutral path. |

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/jupyter-model3d.png" alt="A CNN drawn as tensor-shaped 3D blocks inside a notebook" width="100%" />
</p>

<sub>Each cuboid is one layer: the visible face is its feature map, the thickness its channel count. Drag to orbit.</sub>

The exporters are usable on their own — `pv.from_torch(model)`, `pv.from_keras`,
`pv.from_sklearn`, `pv.from_onnx` — and a hand-written
`{"nodes": [...], "edges": [...]}` graph works too.

---

## Example notebooks

Runnable, in the repo — [`examples/notebooks/`](https://github.com/coredumpdev/photon/tree/master/examples/notebooks):

| Notebook | What it covers |
| --- | --- |
| [`quickstart.ipynb`](https://github.com/coredumpdev/photon/blob/master/examples/notebooks/quickstart.ipynb) | The five-minute tour: a 200k-point line, a bubble chart with an OLS fit, a confusion matrix, a 3D model graph, a 3D surface. |
| [`gallery.ipynb`](https://github.com/coredumpdev/photon/blob/master/examples/notebooks/gallery.ipynb) | The full spread — distributions, fields, custom colours, finance, signal processing, ML metrics, model architecture, and 3D. |

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/jupyter-bubble.png" alt="Bubble chart with a least-squares fit and confidence band" width="49%" />
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/jupyter-surface.png" alt="A lit 3D surface rendered in a notebook cell" width="49%" />
</p>

## How it works

`photonviz` is an [anywidget](https://anywidget.dev), which is why the same
object renders in Jupyter Notebook 7, JupyterLab 4, VS Code and Colab with no
per-frontend code.

Chart calls build a plain dict. On sync, every array-like is swapped for a
`{"$buffer": i}` marker and its raw bytes are appended to a buffer list;
ipywidgets ships those as binary. The browser rebuilds typed-array views over
them and hands them to `@photonviz/core`, which uploads straight to GPU buffers.
Colours, names, extents and other structural values stay JSON.

All plots on a page share **one** WebGL2 context, so a notebook with dozens of
charts will not exhaust the browser's context limit.

---

## Development

From a checkout of the [monorepo](https://github.com/coredumpdev/photon):

```bash
pnpm install
pnpm build:python          # bundles the widget into src/photonviz/static/widget.js
cd python
pip install -e ".[dev]"
pytest
```

## License

MIT
