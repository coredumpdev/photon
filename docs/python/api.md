# Python API

Generated from the `photonviz` package. Every chart keyword maps 1:1 onto the
[TypeScript options](/api/), so anything documented there can be passed straight
through as a keyword argument.

```bash
pip install photonviz
```

::: tip Regenerating
`python python/scripts/gen_api_docs.py` — run it after changing the Python API.
:::

## `Plot`

A 2D Cartesian plot.

```python
Plot(height: str = '420px', **options: Any)
```

| Method | Description |
| --- | --- |
| `y_axis(id: str, **opts: Any)` | Register an extra Y axis; series opt in with ``y_axis="id"``. |
| `annotate(type: str, **opts: Any)` | Add a canvas annotation: ``span``, ``band``, ``box``, ``label``, ``line``, ``ray`` or ``fib``. |
| `hline(value: float, **opts: Any)` | A horizontal guide line at ``value``. |
| `vline(value: float, **opts: Any)` | A vertical guide line at ``value``. |
| `add(type: str, **opts: Any)` | Add any series by its JS type name — the escape hatch for new chart types. |
| `line(x: Any, y: Any, **opts: Any)` | A line (or step, with `step="before"\|"after"\|"center"`). |
| `scatter(x: Any, y: Any, **opts: Any)` | Scatter; pass ``sizes=`` and/or ``colors=`` for a bubble chart. |
| `bar(x: Any, y: Any, **opts: Any)` | Vertical bars; `orientation="h"` lays them horizontally. |
| `area(x: Any, y: Any, **opts: Any)` | A filled area; pass `base=` to stack. |
| `step(x: Any, y: Any, where: str = 'after', **opts: Any)` | A step line — shorthand for `line(..., step=where)`. |
| `histogram(values: Any, **opts: Any)` | Bin raw values and draw them as bars. |
| `box(groups: Sequence[Dict[str, Any]], **opts: Any)` | Box/violin plot from ``[{"x": 0, "values": [...]}, …]``. |
| `heatmap(values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any)` | A scalar field as an image; row-major, row 0 at the bottom. |
| `contour(values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any)` | Iso-lines of a scalar field (marching squares). |
| `hexbin(x: Any, y: Any, **opts: Any)` | Density of a large point cloud, binned into hexagons. |
| `errorbar(x: Any, y: Any, **opts: Any)` | Points with error whiskers; `band=True` shades the range instead. |
| `stem(x: Any, y: Any, **opts: Any)` | Stems from a baseline with a marker at each tip. |
| `quiver(x: Any, y: Any, u: Any, v: Any, **opts: Any)` | A vector field of arrows. |
| `pie(values: Any, **opts: Any)` | Pie or donut (`innerRadius=`); set `equalAspect` on the plot. |
| `image(source: str, extent: Dict[str, Any], **opts: Any)` | A bitmap placed in data space. |
| `candlestick(x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any)` | OHLC candles. |
| `ohlc(x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any)` | OHLC bars (open/close ticks on a high-low line). |
| `heikin_ashi(x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any)` | Heikin-Ashi candles — a smoothed OHLC that filters noise. |
| `bollinger(x: Any, close: Any, **opts: Any)` | Bollinger bands around a moving average. |
| `volume_profile(price: Any, volume: Any, **opts: Any)` | Traded volume by price level, with the point of control marked. |
| `drawdown(equity: Any, **opts: Any)` | Underwater curve of an equity series, with the worst stretch marked. |
| `regression(x: Any, y: Any, **opts: Any)` | OLS trend (optionally with a ±band) or ``method="loess"`` for a local fit. |
| `ecdf(values: Any, **opts: Any)` | The empirical CDF as a step line — no binning choice to defend. |
| `corr_matrix(columns: Sequence[Any], **opts: Any)` | Correlation heatmap; pass ``names=[...]`` to label the axes. |
| `psd(signal: Any, **opts: Any)` | Welch power spectral density. |
| `confusion_matrix(y_true: Any, y_pred: Any, **opts: Any)` | Confusion matrix with per-cell counts and a colorbar. |
| `roc_curve(scores: Any, labels: Any, **opts: Any)` | ROC curve with the chance diagonal; AUC lands in the legend. |
| `pr_curve(scores: Any, labels: Any, **opts: Any)` | Precision-recall curve with the no-skill baseline; AP in the legend. |
| `calibration(scores: Any, labels: Any, **opts: Any)` | Reliability diagram plus the expected calibration error. |
| `embedding(x: Any, y: Any, **opts: Any)` | 2-D embedding scatter; ``labels=`` colours by class. |
| `feature_importance(names: Sequence[str], values: Any, **opts: Any)` | Sorted horizontal importance bars. |
| `training_curves(series: Sequence[Dict[str, Any]], **opts: Any)` | Loss/metric curves with EMA smoothing and a best-epoch marker. |
| `model_graph(model: Any, **opts: Any)` | Draw a model's layers as a flat DAG. |

## `Plot3D`

A 3D plot with an orbit camera.

```python
Plot3D(height: str = '480px', **options: Any)
```

| Method | Description |
| --- | --- |
| `add(type: str, **opts: Any)` | Add any 3D layer by its JS type name. |
| `label(x: float, y: float, z: float, text: str, **opts: Any)` | Pin a text label to a point in data space; it tracks the camera. |
| `surface(values: Any, cols: int, rows: int, **opts: Any)` | A lit height field. |
| `scatter3d(x: Any, y: Any, z: Any, **opts: Any)` | A 3D point cloud. |
| `line3d(x: Any, y: Any, z: Any, **opts: Any)` | A 3D polyline / path. |
| `bar3d(x: Any, z: Any, y: Any, **opts: Any)` | 3D bars on an x/z grid. |
| `boxes3d(boxes: Sequence[Dict[str, Any]], **opts: Any)` | Independently sized lit cuboids. |
| `quiver3d(x: Any, y: Any, z: Any, u: Any, v: Any, w: Any, **opts: Any)` | A 3D vector field. |
| `isosurface(values: Any, dims: Sequence[int], iso_level: float, **opts: Any)` | A marching-cubes isosurface of a scalar volume. |
| `volume(values: Any, dims: Sequence[int], **opts: Any)` | Direct volume rendering (GPU raymarch). |
| `model_graph(model: Any, **opts: Any)` | Draw a model's layers as cuboids sized from their output tensors. |

## `Polar`

A polar (r, θ) plot.

```python
Polar(height: str = '420px', **options: Any)
```

| Method | Description |
| --- | --- |
| `line(theta: Any, r: Any, **opts: Any)` | A polar line; `closed=True` joins the ends. |
| `scatter(theta: Any, r: Any, **opts: Any)` | Polar points. |

## Module shortcuts

Each one builds the chart object for you: `pv.line(x, y)` is exactly
`pv.Plot().line(x, y)`. Pass `plot={...}` to configure the plot itself
(theme, title, legend, scales, height…).

### Basic marks

| Shortcut | Equivalent to |
| --- | --- |
| `pv.line(x: Any, y: Any, **opts: Any)` | `Plot().line(...)` |
| `pv.scatter(x: Any, y: Any, **opts: Any)` | `Plot().scatter(...)` |
| `pv.bar(x: Any, y: Any, **opts: Any)` | `Plot().bar(...)` |
| `pv.area(x: Any, y: Any, **opts: Any)` | `Plot().area(...)` |
| `pv.step(x: Any, y: Any, where: str = 'after', **opts: Any)` | `Plot().step(...)` |
| `pv.histogram(values: Any, **opts: Any)` | `Plot().histogram(...)` |
| `pv.box(groups: Sequence[Dict[str, Any]], **opts: Any)` | `Plot().box(...)` |
| `pv.heatmap(values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any)` | `Plot().heatmap(...)` |
| `pv.contour(values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any)` | `Plot().contour(...)` |
| `pv.hexbin(x: Any, y: Any, **opts: Any)` | `Plot().hexbin(...)` |
| `pv.errorbar(x: Any, y: Any, **opts: Any)` | `Plot().errorbar(...)` |
| `pv.stem(x: Any, y: Any, **opts: Any)` | `Plot().stem(...)` |
| `pv.quiver(x: Any, y: Any, u: Any, v: Any, **opts: Any)` | `Plot().quiver(...)` |
| `pv.pie(values: Any, **opts: Any)` | `Plot().pie(...)` |

### Finance

| Shortcut | Equivalent to |
| --- | --- |
| `pv.candlestick(x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any)` | `Plot().candlestick(...)` |
| `pv.ohlc(x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any)` | `Plot().ohlc(...)` |
| `pv.heikin_ashi(x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any)` | `Plot().heikin_ashi(...)` |
| `pv.bollinger(x: Any, close: Any, **opts: Any)` | `Plot().bollinger(...)` |
| `pv.volume_profile(price: Any, volume: Any, **opts: Any)` | `Plot().volume_profile(...)` |
| `pv.drawdown(equity: Any, **opts: Any)` | `Plot().drawdown(...)` |

### Statistics

| Shortcut | Equivalent to |
| --- | --- |
| `pv.regression(x: Any, y: Any, **opts: Any)` | `Plot().regression(...)` |
| `pv.ecdf(values: Any, **opts: Any)` | `Plot().ecdf(...)` |
| `pv.corr_matrix(columns: Sequence[Any], **opts: Any)` | `Plot().corr_matrix(...)` |
| `pv.psd(signal: Any, **opts: Any)` | `Plot().psd(...)` |

### Machine learning

| Shortcut | Equivalent to |
| --- | --- |
| `pv.confusion_matrix(y_true: Any, y_pred: Any, **opts: Any)` | `Plot().confusion_matrix(...)` |
| `pv.roc_curve(scores: Any, labels: Any, **opts: Any)` | `Plot().roc_curve(...)` |
| `pv.pr_curve(scores: Any, labels: Any, **opts: Any)` | `Plot().pr_curve(...)` |
| `pv.calibration(scores: Any, labels: Any, **opts: Any)` | `Plot().calibration(...)` |
| `pv.embedding(x: Any, y: Any, **opts: Any)` | `Plot().embedding(...)` |
| `pv.feature_importance(names: Sequence[str], values: Any, **opts: Any)` | `Plot().feature_importance(...)` |
| `pv.training_curves(series: Sequence[Dict[str, Any]], **opts: Any)` | `Plot().training_curves(...)` |

### 3D

| Shortcut | Equivalent to |
| --- | --- |
| `pv.surface(values: Any, cols: int, rows: int, **opts: Any)` | `Plot3D().surface(...)` |
| `pv.scatter3d(x: Any, y: Any, z: Any, **opts: Any)` | `Plot3D().scatter3d(...)` |
| `pv.line3d(x: Any, y: Any, z: Any, **opts: Any)` | `Plot3D().line3d(...)` |
| `pv.bar3d(x: Any, z: Any, y: Any, **opts: Any)` | `Plot3D().bar3d(...)` |
| `pv.isosurface(values: Any, dims: Sequence[int], iso_level: float, **opts: Any)` | `Plot3D().isosurface(...)` |
| `pv.volume(values: Any, dims: Sequence[int], **opts: Any)` | `Plot3D().volume(...)` |

### Polar

| Shortcut | Equivalent to |
| --- | --- |
| `pv.polar_line(theta: Any, r: Any, **opts: Any)` | `Polar().line(...)` |
| `pv.polar_scatter(theta: Any, r: Any, **opts: Any)` | `Polar().scatter(...)` |

### Model architecture

| Shortcut | Equivalent to |
| --- | --- |
| `pv.model_graph(model: Any, **opts: Any)` | `Plot().model_graph(...)` |
| `pv.model_graph_3d(model: Any, **opts: Any)` | `Plot3D().model_graph(...)` |

## Model export

`pv.model_graph(model)` and `pv.model_graph_3d(model)` call these for you;
they are exported so you can inspect or cache the payload yourself.

### `to_source`

```python
to_source(model: Any, example_input: Any = None, name: str | None = None)
```

Dispatch on what ``model`` actually is and return a browser-ready payload.

### `from_torch`

```python
from_torch(model: Any, example_input: Any = None, name: str | None = None)
```

Trace a ``torch.nn.Module`` with ``torch.fx`` so branches and residual
connections survive. Pass ``example_input`` to also record output shapes.

Models with data-dependent control flow cannot be traced; those fall back to
a flat chain of the leaf modules, which still shows the layer stack.

### `from_keras`

```python
from_keras(model: Any, name: str | None = None)
```

Export a Keras model config plus per-layer shapes and parameter counts.
Sequential models chain; functional ones keep their real wiring.

### `from_sklearn`

```python
from_sklearn(estimator: Any, name: str | None = None)
```

Walk a ``Pipeline`` / ``ColumnTransformer`` / ``FeatureUnion`` into a step
tree. A bare ``MLPClassifier``/``MLPRegressor`` is expanded into its real
dense layer stack instead.

### `from_onnx`

```python
from_onnx(model: Any, name: str | None = None)
```

Export an ONNX graph — the framework-neutral path. Accepts a loaded
``ModelProto`` or a path to a ``.onnx`` file; shape inference is run when
available so the blocks can be sized.

### `from_layers`

```python
from_layers(layers: List[Dict[str, Any]], name: str | None = None)
```

A straight chain from an ordered layer list — the manual escape hatch.

## Version

```python
photonviz.__version__  # "0.5.0"
```
