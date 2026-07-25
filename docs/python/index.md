# Python — Jupyter, JupyterLab & Colab

```bash
pip install photonviz
```

Nothing else to install: the widget ships one self-contained ESM bundle, so there
is no CDN fetch, no `jupyter labextension install`, and no separate JS package.

![photonviz in JupyterLab](https://raw.githubusercontent.com/coredumpdev/photon/master/assets/jupyter-hero.png)

NumPy arrays and torch tensors cross to the browser as **binary buffers**, so a
million points still pan and zoom inside a notebook cell.

## Quick start

```python
import numpy as np, photonviz as pv

x = np.linspace(0, 40, 200_000)
pv.line(x, np.sin(x), name="signal", plot={"theme": "dark", "legend": True})
```

Charts chain, and the last expression in a cell renders itself:

```python
(pv.Plot(theme="dark", title="Two series", legend=True)
   .line(x, np.sin(x), name="sin", color="#60a5fa")
   .line(x, np.cos(x), name="cos", color="#f472b6", dash=[6, 4])
   .hline(0, color="#64748b"))
```

Every keyword maps 1:1 onto the TypeScript options, so everything in this
documentation applies verbatim.

## Google Colab

Run once per session, then use `photonviz` normally:

```python
from google.colab import output
output.enable_custom_widget_manager()
```

## What you can draw

```python
pv.scatter(x, y, sizes=area, colors=hex_list)     # bubble chart
pv.histogram(samples, bins=40)
pv.heatmap(z, cols, rows, extent={"x": [0, 1], "y": [0, 1]}, colormap="magma")
pv.candlestick(t, o, h, l, c)                     # + heikin_ashi, bollinger, drawdown…
pv.regression(x, y, band=2)                       # OLS + confidence band
pv.corr_matrix([a, b, c], names=["a", "b", "c"])
pv.psd(signal, sampleRate=1000)                   # Welch spectrum
pv.confusion_matrix(y_true, y_pred)               # + roc_curve, pr_curve, embedding…
pv.surface(z, cols, rows)                         # 3D — orbit with the mouse
```

`Plot`, `Plot3D` and `Polar` are the full objects; the module-level names are
one-line shortcuts. Pass `plot={...}` to configure the plot itself.

## Model architecture

Hand a **PyTorch**, **Keras**, **scikit-learn** or **ONNX** model straight over —
the export happens in Python, the layout in the browser.

```python
pv.model_graph(model, example_input=torch.randn(1, 3, 224, 224), direction="horizontal")

pv.model_graph_3d(
    model, example_input=torch.randn(1, 3, 224, 224), labels="full",
    plot={"aspectMode": "data", "projection": "orthographic", "showAxes": False},
)
```

![A CNN as tensor-shaped 3D blocks](https://raw.githubusercontent.com/coredumpdev/photon/master/assets/jupyter-model3d.png)

The exporters work standalone too: `pv.from_torch`, `pv.from_keras`,
`pv.from_sklearn`, `pv.from_onnx`, `pv.from_layers`.

## Example notebooks

Runnable, in the repo under [`examples/notebooks/`](https://github.com/coredumpdev/photon/tree/master/examples/notebooks):

- **`quickstart.ipynb`** — a 200k-point line, a bubble chart with an OLS fit, a
  confusion matrix, a 3D model graph, a 3D surface.
- **`gallery.ipynb`** — distributions, fields, custom colours, finance, signal
  processing, ML metrics, model architecture and 3D.

## API reference

Every class, method and shortcut: **[Python API](/python/api)** — generated from
the package itself, so the signatures are always the real ones.

## How it works

`photonviz` is an [anywidget](https://anywidget.dev), which is why one object
renders in Jupyter Notebook 7, JupyterLab 4, VS Code and Colab with no
per-frontend code.

Chart calls build a plain dict. On sync, every array-like is swapped for a
`{"$buffer": i}` marker and its raw bytes are appended to a buffer list;
ipywidgets ships those as binary. The browser rebuilds typed-array views and
hands them to `@photonviz/core`. Colours, names, extents and other structural
values stay JSON.
