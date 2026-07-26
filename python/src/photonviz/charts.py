"""The chart objects: :class:`Plot` (2D), :class:`Plot3D`, and :class:`Polar`.

Every method appends a series and returns ``self``, so charts compose in one
expression and the last one in a cell renders itself::

    pv.Plot(theme="dark", title="Signal").line(x, y, name="sin")

Options mirror the TypeScript API one-for-one — anything the JS layer accepts
can be passed as a keyword argument, so the reference docs apply verbatim.

The drawing methods live on :class:`Axes` / :class:`Axes3D` / :class:`PolarAxes`,
which the standalone widgets and the panels of a :func:`~photonviz.subplots`
figure both build on — so ``ax.line(...)`` means the same thing either way.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

from ._arrays import series_dict
from ._spec import ChartSpec
from ._widget import ChartWidget, figure_size

__all__ = ["Plot", "Plot3D", "Polar", "Axes", "Axes3D", "PolarAxes"]


class Axes(ChartSpec):
    """The 2D drawing API — a standalone :class:`Plot` or one panel of a figure."""

    # -- axes / annotations ---------------------------------------------------

    def y_axis(self, id: str, **opts: Any) -> "Axes":
        """Register an extra Y axis; series opt in with ``y_axis="id"``."""
        self._y_axes.append({"id": id, **opts})
        return self._sync()

    def annotate(self, type: str, **opts: Any) -> "Axes":
        """Add a canvas annotation: ``span``, ``band``, ``box``, ``label``, ``line``, ``ray`` or ``fib``."""
        self._annotations.append({"type": type, **opts})
        return self._sync()

    def hline(self, value: float, **opts: Any) -> "Axes":
        """A horizontal guide line at ``value``."""
        return self.annotate("span", dim="y", value=value, **opts)

    def vline(self, value: float, **opts: Any) -> "Axes":
        """A vertical guide line at ``value``."""
        return self.annotate("span", dim="x", value=value, **opts)

    def title(self, text: str, **opts: Any) -> "Axes":
        """Set the panel title — matplotlib's ``ax.set_title``."""
        return self.options(title={"text": text, **opts} if opts else text)

    # -- generic series -------------------------------------------------------

    def add(self, type: str, **opts: Any) -> "Axes":
        """Add any series by its JS type name — the escape hatch for new chart types."""
        self._series.append(series_dict(type, opts))
        return self._sync()

    # -- basic marks ----------------------------------------------------------

    def line(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """A line (or step, with `step="before"|"after"|"center"`)."""
        return self.add("line", x=x, y=y, **opts)

    def scatter(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """Scatter; pass ``sizes=`` and/or ``colors=`` for a bubble chart."""
        return self.add("scatter", x=x, y=y, **opts)

    def bar(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """Vertical bars; `orientation="h"` lays them horizontally."""
        return self.add("bar", x=x, y=y, **opts)

    def area(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """A filled area; pass `base=` to stack."""
        return self.add("area", x=x, y=y, **opts)

    def grouped_bars(self, x: Any, series: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Bars side by side per category, from ``[{"y": [...], "name": "a"}, …]``."""
        return self.add("groupedBars", x=x, series=list(series), **opts)

    def stacked_bars(self, x: Any, series: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Bars stacked per category, from ``[{"y": [...], "name": "a"}, …]``."""
        return self.add("stackedBars", x=x, series=list(series), **opts)

    def stacked_area(self, x: Any, series: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Areas stacked on one another — matplotlib's ``stackplot``."""
        return self.add("stackedArea", x=x, series=list(series), **opts)

    def step(self, x: Any, y: Any, where: str = "after", **opts: Any) -> "Axes":
        """A step line — shorthand for `line(..., step=where)`."""
        return self.add("line", x=x, y=y, step=where, **opts)

    def histogram(self, values: Any, **opts: Any) -> "Axes":
        """Bin raw values and draw them as bars."""
        return self.add("histogram", values=values, **opts)

    def box(self, groups: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Box/violin plot from ``[{"x": 0, "values": [...]}, …]``; `violin=True` adds a KDE shape."""
        return self.add("box", groups=[_box_group(g) for g in groups], **opts)

    def heatmap(self, values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any) -> "Axes":
        """A scalar field as an image; row-major, row 0 at the bottom."""
        return self.add("heatmap", values=values, cols=cols, rows=rows, extent=extent, **opts)

    def contour(self, values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any) -> "Axes":
        """Iso-lines of a scalar field (marching squares)."""
        return self.add("contour", values=values, cols=cols, rows=rows, extent=extent, **opts)

    def contourf(self, values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any) -> "Axes":
        """Filled contour bands — matplotlib's ``contourf``; ``lines=True`` strokes the boundaries."""
        return self.add("contourf", values=values, cols=cols, rows=rows, extent=extent, **opts)

    def pcolormesh(self, values: Any, x_edges: Any, y_edges: Any, **opts: Any) -> "Axes":
        """
        A colour mesh over unevenly spaced cells — matplotlib's ``pcolormesh``.

        ``x_edges`` / ``y_edges`` are the cell boundaries: 1-D (``cols+1`` and
        ``rows+1``) for a rectilinear mesh, or the flattened ``(rows+1, cols+1)``
        corner grids with ``curvilinear=True`` for a warped one. Prefer
        :meth:`heatmap` when the grid is uniform — that is a single textured quad.
        """
        return self.add("pcolormesh", values=values, xEdges=x_edges, yEdges=y_edges, **opts)

    def hexbin(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """Density of a large point cloud, binned into hexagons."""
        return self.add("hexbin", x=x, y=y, **opts)

    def hist2d(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """Rectangular 2-D binning of a point cloud, drawn as a heatmap; ``bins=`` sets the grid."""
        return self.add("hist2d", x=x, y=y, **opts)

    def eventplot(self, positions: Sequence[Any], **opts: Any) -> "Axes":
        """An event raster: one row of tick marks per array in ``positions``."""
        return self.add("eventplot", positions=[p for p in positions], **opts)

    def streamplot(self, u: Any, v: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any) -> "Axes":
        """Streamlines of a vector field, RK4-traced and evenly seeded."""
        return self.add("streamplot", u=u, v=v, cols=cols, rows=rows, extent=extent, **opts)

    def barbs(self, x: Any, y: Any, u: Any, v: Any, **opts: Any) -> "Axes":
        """Wind barbs — speed read off the ticks (half / full / pennant), not the length."""
        return self.add("barbs", x=x, y=y, u=u, v=v, **opts)

    def errorbar(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """Points with error whiskers; `band=True` shades the range instead."""
        return self.add("errorbar", x=x, y=y, **opts)

    def stem(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """Stems from a baseline with a marker at each tip."""
        return self.add("stem", x=x, y=y, **opts)

    def quiver(self, x: Any, y: Any, u: Any, v: Any, **opts: Any) -> "Axes":
        """A vector field of arrows."""
        return self.add("quiver", x=x, y=y, u=u, v=v, **opts)

    def pie(self, values: Any, **opts: Any) -> "Axes":
        """Pie or donut (`innerRadius=`); set `equalAspect` on the plot."""
        return self.add("pie", values=values, **opts)

    def image(self, source: str, extent: Dict[str, Any], **opts: Any) -> "Axes":
        """A bitmap placed in data space."""
        return self.add("image", source=source, extent=extent, **opts)

    def patches(self, patches: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Filled polygons from ``[{"x": [...], "y": [...], "color": "#..."}, …]``."""
        return self.add("patches", patches=list(patches), **opts)

    def graph(self, edges: Sequence[Sequence[int]], **opts: Any) -> "Axes":
        """
        A node-link graph from ``[[i, j], …]`` index pairs.

        Pass ``x=`` and ``y=`` for a fixed layout, or leave them out and a force
        layout places the nodes (``nodes=`` sets the count when no edge names it).
        """
        return self.add("graph", edges=[list(e) for e in edges], **opts)

    # -- triangulations (scattered samples) -----------------------------------

    def triplot(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """The triangulation itself — every mesh edge. Delaunay unless ``triangles=`` is given."""
        return self.add("triplot", x=x, y=y, **opts)

    def tripcolor(self, x: Any, y: Any, z: Any, **opts: Any) -> "Axes":
        """Flat-shaded triangles over scattered samples — matplotlib's ``tripcolor``."""
        return self.add("tripcolor", x=x, y=y, z=z, **opts)

    def tricontour(self, x: Any, y: Any, z: Any, **opts: Any) -> "Axes":
        """Iso-lines over a triangulation — matplotlib's ``tricontour``."""
        return self.add("tricontour", x=x, y=y, z=z, **opts)

    def tricontourf(self, x: Any, y: Any, z: Any, **opts: Any) -> "Axes":
        """Filled contour bands over a triangulation — matplotlib's ``tricontourf``."""
        return self.add("tricontourf", x=x, y=y, z=z, **opts)

    # -- diagrams -------------------------------------------------------------

    def treemap(self, items: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Squarified treemap from ``[{"label": ..., "value": ...}, …]``."""
        return self.add("treemap", items=list(items), **opts)

    def funnel(self, items: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Conversion funnel from ``[{"label": ..., "value": ...}, …]``."""
        return self.add("funnel", items=list(items), **opts)

    def sunburst(self, root: Dict[str, Any], **opts: Any) -> "Axes":
        """Radial hierarchy from a nested ``{"label", "value", "children"}`` tree."""
        return self.add("sunburst", root=root, **opts)

    def gauge(self, value: float, **opts: Any) -> "Axes":
        """A single value on an arc; ``min=`` / ``max=`` set the span."""
        return self.add("gauge", value=value, **opts)

    def sankey(self, nodes: Sequence[Any], links: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Flow diagram: nodes joined by proportional ribbons."""
        return self.add("sankey", nodes=list(nodes), links=list(links), **opts)

    def chord(self, matrix: Sequence[Any], **opts: Any) -> "Axes":
        """Chord diagram of a square flow matrix."""
        return self.add("chord", matrix=[row for row in matrix], **opts)

    def parallel_coordinates(self, dimensions: Sequence[str], rows: Sequence[Sequence[float]], **opts: Any) -> "Axes":
        """Parallel coordinates: axis ``dimensions`` names plus one ``rows`` entry per record."""
        return self.add("parallelCoordinates", dimensions=list(dimensions),
                        rows=[list(r) for r in rows], **opts)

    # -- finance --------------------------------------------------------------

    def candlestick(self, x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any) -> "Axes":
        """OHLC candles."""
        return self.add("candlestick", x=x, open=open, high=high, low=low, close=close, **opts)

    def ohlc(self, x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any) -> "Axes":
        """OHLC bars (open/close ticks on a high-low line)."""
        return self.add("ohlc", x=x, open=open, high=high, low=low, close=close, **opts)

    def heikin_ashi(self, x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any) -> "Axes":
        """Heikin-Ashi candles — a smoothed OHLC that filters noise."""
        return self.add("heikinAshi", x=x, open=open, high=high, low=low, close=close, **opts)

    def bollinger(self, x: Any, close: Any, **opts: Any) -> "Axes":
        """Bollinger bands around a moving average."""
        return self.add("bollinger", x=x, close=close, **opts)

    def renko(self, close: Any, brick_size: float, **opts: Any) -> "Axes":
        """Renko bricks of a fixed price step — time is discarded."""
        return self.add("renko", close=close, brickSize=brick_size, **opts)

    def depth(self, bids: Sequence[Sequence[float]], asks: Sequence[Sequence[float]], **opts: Any) -> "Axes":
        """Order-book depth from ``[[price, size], …]`` levels, as two cumulative areas."""
        return self.add("depth", bids=[list(b) for b in bids], asks=[list(a) for a in asks], **opts)

    def volume_profile(self, price: Any, volume: Any, **opts: Any) -> "Axes":
        """Traded volume by price level, with the point of control marked."""
        return self.add("volumeProfile", price=price, volume=volume, **opts)

    def drawdown(self, equity: Any, **opts: Any) -> "Axes":
        """Underwater curve of an equity series, with the worst stretch marked."""
        return self.add("drawdown", equity=equity, **opts)

    # -- statistics -----------------------------------------------------------

    def regression(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """OLS trend (optionally with a ±band) or ``method="loess"`` for a local fit."""
        return self.add("regression", x=x, y=y, **opts)

    def ecdf(self, values: Any, **opts: Any) -> "Axes":
        """The empirical CDF as a step line — no binning choice to defend."""
        return self.add("ecdf", values=values, **opts)

    def corr_matrix(self, columns: Sequence[Any], **opts: Any) -> "Axes":
        """Correlation heatmap; pass ``names=[...]`` to label the axes."""
        return self.add("corrMatrix", columns=[c for c in columns], **opts)

    def psd(self, signal: Any, **opts: Any) -> "Axes":
        """Welch power spectral density."""
        return self.add("psd", signal=signal, **opts)

    # -- machine learning -----------------------------------------------------

    def confusion_matrix(self, y_true: Any, y_pred: Any, **opts: Any) -> "Axes":
        """Confusion matrix with per-cell counts and a colorbar."""
        return self.add("confusionMatrix", yTrue=y_true, yPred=y_pred, **opts)

    def roc_curve(self, scores: Any, labels: Any, **opts: Any) -> "Axes":
        """ROC curve with the chance diagonal; AUC lands in the legend."""
        return self.add("rocCurve", scores=scores, labels=labels, **opts)

    def pr_curve(self, scores: Any, labels: Any, **opts: Any) -> "Axes":
        """Precision-recall curve with the no-skill baseline; AP in the legend."""
        return self.add("prCurve", scores=scores, labels=labels, **opts)

    def calibration(self, scores: Any, labels: Any, **opts: Any) -> "Axes":
        """Reliability diagram plus the expected calibration error."""
        return self.add("calibration", scores=scores, labels=labels, **opts)

    def embedding(self, x: Any, y: Any, **opts: Any) -> "Axes":
        """2-D embedding scatter; ``labels=`` colours by class."""
        return self.add("embedding", x=x, y=y, **opts)

    def feature_importance(self, names: Sequence[str], values: Any, **opts: Any) -> "Axes":
        """Sorted horizontal importance bars."""
        return self.add("featureImportance", names=list(names), values=values, **opts)

    def shap_beeswarm(self, names: Sequence[str], values: Sequence[Any], **opts: Any) -> "Axes":
        """SHAP beeswarm: one row per feature (``values[f]`` is that feature's row), sorted by mean |SHAP|."""
        return self.add("shapBeeswarm", names=list(names), values=[v for v in values], **opts)

    def training_curves(self, series: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Loss/metric curves from ``[{"y": [...], "name": "train"}, …]``, EMA-smoothed with a best-epoch marker."""
        return self.add("trainingCurves", series=[_training_series(s) for s in series], **opts)

    def decision_boundary(self, x: Any, y: Any, labels: Any, grid: Any, **opts: Any) -> "Axes":
        """A classifier's decision regions under the sample points."""
        return self.add("decisionBoundary", x=x, y=y, labels=labels, grid=grid, **opts)

    def partial_dependence(self, x: Any, pd: Any, **opts: Any) -> "Axes":
        """Partial-dependence curve; pass ``ice=`` for the per-sample fan."""
        return self.add("partialDependence", x=x, pd=pd, **opts)

    def attention_map(self, weights: Any, **opts: Any) -> "Axes":
        """An attention matrix as a heatmap; give ``queries=``/``keys=`` for a flat array."""
        return self.add("attentionMap", weights=weights, **opts)

    def ridgeline(self, groups: Sequence[Dict[str, Any]], **opts: Any) -> "Axes":
        """Stacked density ridges from ``[{"name": ..., "values": [...]}, …]``."""
        return self.add("ridgeline", groups=list(groups), **opts)

    def pred_vs_actual(self, y_true: Any, y_pred: Any, **opts: Any) -> "Axes":
        """Predicted against actual, with the identity line."""
        return self.add("predVsActual", yTrue=y_true, yPred=y_pred, **opts)

    def residuals(self, y_true: Any, y_pred: Any, **opts: Any) -> "Axes":
        """Residuals against the fitted value (or ``against="index"``)."""
        return self.add("residuals", yTrue=y_true, yPred=y_pred, **opts)

    def lift_curve(self, scores: Any, labels: Any, **opts: Any) -> "Axes":
        """Lift / gain curve against the random baseline."""
        return self.add("liftCurve", scores=scores, labels=labels, **opts)

    def learning_curve(self, sizes: Any, train: Any, validation: Any, **opts: Any) -> "Axes":
        """Train and validation score against training-set size."""
        return self.add("learningCurve", sizes=sizes, train=train, validation=validation, **opts)

    def model_graph(self, model: Any, **opts: Any) -> "Axes":
        """
        Draw a model's layers as a flat DAG.

        ``model`` may be a PyTorch ``nn.Module``, a Keras model, a scikit-learn
        estimator/Pipeline, an ONNX model, or an already-exported graph dict.
        """
        from .models import to_source

        return self.add("modelGraph", source=to_source(model, **_split_export(opts)), **opts)


class Axes3D(ChartSpec):
    """The 3D drawing API — a standalone :class:`Plot3D` or one panel of a figure."""

    def add(self, type: str, **opts: Any) -> "Axes3D":
        """Add any 3D layer by its JS type name."""
        self._layers.append(series_dict(type, opts))
        return self._sync()

    def title(self, text: str) -> "Axes3D":
        """Set the panel title."""
        return self.options(title=text)

    def label(self, x: float, y: float, z: float, text: str, **opts: Any) -> "Axes3D":
        """Pin a text label to a point in data space; it tracks the camera."""
        self._labels3d.append({"x": x, "y": y, "z": z, "text": text, **opts})
        return self._sync()

    def surface(self, values: Any, cols: int, rows: int, **opts: Any) -> "Axes3D":
        """A lit height field."""
        return self.add("surface", values=values, cols=cols, rows=rows, **opts)

    def scatter3d(self, x: Any, y: Any, z: Any, **opts: Any) -> "Axes3D":
        """A 3D point cloud."""
        return self.add("pointcloud", x=x, y=y, z=z, **opts)

    def line3d(self, x: Any, y: Any, z: Any, **opts: Any) -> "Axes3D":
        """A 3D polyline / path."""
        return self.add("line3d", x=x, y=y, z=z, **opts)

    def bar3d(self, x: Any, z: Any, y: Any, **opts: Any) -> "Axes3D":
        """3D bars on an x/z grid."""
        return self.add("bar3d", x=x, z=z, y=y, **opts)

    def boxes3d(self, boxes: Sequence[Dict[str, Any]], **opts: Any) -> "Axes3D":
        """Independently sized lit cuboids."""
        return self.add("boxes3d", boxes=list(boxes), **opts)

    def quiver3d(self, x: Any, y: Any, z: Any, u: Any, v: Any, w: Any, **opts: Any) -> "Axes3D":
        """A 3D vector field."""
        return self.add("quiver3d", x=x, y=y, z=z, u=u, v=v, w=w, **opts)

    def isosurface(self, values: Any, dims: Sequence[int], iso_level: float, **opts: Any) -> "Axes3D":
        """A marching-cubes isosurface of a scalar volume."""
        return self.add("isosurface", values=values, dims=list(dims), isoLevel=iso_level, **opts)

    def volume(self, values: Any, dims: Sequence[int], **opts: Any) -> "Axes3D":
        """Direct volume rendering (GPU raymarch)."""
        return self.add("volume", values=values, dims=list(dims), **opts)

    def contour3d(self, values: Any, cols: int, rows: int, **opts: Any) -> "Axes3D":
        """Iso-lines of a height field, floated at their own z."""
        return self.add("contour3d", values=values, cols=cols, rows=rows, **opts)

    def model_graph(self, model: Any, **opts: Any) -> "Axes3D":
        """Draw a model's layers as cuboids sized from their output tensors."""
        from .models import to_source

        return self.add("modelGraph3d", source=to_source(model, **_split_export(opts)), **opts)


class PolarAxes(ChartSpec):
    """The polar drawing API — a standalone :class:`Polar` or one panel of a figure."""

    def line(self, theta: Any, r: Any, **opts: Any) -> "PolarAxes":
        """A polar line; `closed=True` joins the ends."""
        self._series.append(series_dict("line", {"theta": theta, "r": r, **opts}))
        return self._sync()

    def scatter(self, theta: Any, r: Any, **opts: Any) -> "PolarAxes":
        """Polar points."""
        self._series.append(series_dict("scatter", {"theta": theta, "r": r, **opts}))
        return self._sync()


class Plot(ChartWidget, Axes):
    """A 2D Cartesian plot."""

    def __init__(
        self,
        height: Optional[str] = None,
        figsize: Optional[Sequence[float]] = None,
        dpi: Optional[float] = None,
        **options: Any,
    ) -> None:
        w, h = figure_size(figsize, dpi, height, "420px")
        ChartWidget.__init__(self, "plot", options, height=h, width=w)


class Plot3D(ChartWidget, Axes3D):
    """A 3D plot with an orbit camera."""

    def __init__(
        self,
        height: Optional[str] = None,
        figsize: Optional[Sequence[float]] = None,
        dpi: Optional[float] = None,
        **options: Any,
    ) -> None:
        w, h = figure_size(figsize, dpi, height, "480px")
        ChartWidget.__init__(self, "plot3d", options, height=h, width=w)


class Polar(ChartWidget, PolarAxes):
    """A polar (r, θ) plot."""

    def __init__(
        self,
        height: Optional[str] = None,
        figsize: Optional[Sequence[float]] = None,
        dpi: Optional[float] = None,
        **options: Any,
    ) -> None:
        w, h = figure_size(figsize, dpi, height, "420px")
        ChartWidget.__init__(self, "polar", options, height=h, width=w)


#: Panel classes, keyed by the ``kind`` a Figure is asked for.
PANEL_KINDS = {"plot": Axes, "plot3d": Axes3D, "polar": PolarAxes}


def _box_group(group: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize one box group.

    The JS layer calls the group's centre ``position``; every other series here
    calls its horizontal coordinate ``x``, so accept both and translate. Without
    it a group keyed on ``x`` renders a silently empty chart.
    """
    out = dict(group)
    x = out.pop("x", None)
    if "position" not in out:
        if x is None:
            raise ValueError('photonviz: each box group needs an "x" (or "position") and "values"')
        out["position"] = x
    if "values" not in out:
        raise ValueError('photonviz: each box group needs a "values" array')
    return out


def _training_series(series: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize one training-curve series: the JS layer reads `y`, `values` reads naturally."""
    out = dict(series)
    values = out.pop("values", None)
    if "y" not in out:
        if values is None:
            raise ValueError('photonviz: each training-curve series needs a "y" (or "values") array')
        out["y"] = values
    return out


def _split_export(opts: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the export-only keywords out of ``opts``, leaving the styling ones."""
    export: Dict[str, Any] = {}
    for key in ("example_input", "name"):
        if key in opts:
            export[key] = opts.pop(key)
    return export


def _make(cls: type, kwargs: Dict[str, Any]) -> Any:
    return cls(**kwargs)


def _shortcut(cls: type, method: str):
    """Build a module-level one-liner: ``pv.line(x, y)`` == ``pv.Plot().line(x, y)``."""

    def call(*args: Any, **kwargs: Any) -> Any:
        plot_kwargs: Dict[str, Any] = kwargs.pop("plot", {}) or {}
        # Sizing belongs to the plot, not the series — accept it at either level.
        for key in ("height", "figsize", "dpi"):
            if key in kwargs:
                plot_kwargs[key] = kwargs.pop(key)
        chart = _make(cls, plot_kwargs)
        return getattr(chart, method)(*args, **kwargs)

    call.__name__ = method
    call.__doc__ = (
        f"Shorthand for ``{cls.__name__}().{method}(...)``. Pass ``plot={{...}}`` "
        "to configure the plot itself (theme, title, legend, scales…)."
    )
    # Remember what this wraps so the docs generator can show the real signature
    # instead of the (*args, **kwargs) this closure would otherwise report.
    call._photon_target = (cls, method)  # type: ignore[attr-defined]
    return call
