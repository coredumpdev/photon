"""The chart objects: :class:`Plot` (2D), :class:`Plot3D`, and :class:`Polar`.

Every method appends a series and returns ``self``, so charts compose in one
expression and the last one in a cell renders itself::

    pv.Plot(theme="dark", title="Signal").line(x, y, name="sin")

Options mirror the TypeScript API one-for-one — anything the JS layer accepts
can be passed as a keyword argument, so the reference docs apply verbatim.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

from ._arrays import series_dict
from ._widget import ChartWidget

__all__ = ["Plot", "Plot3D", "Polar"]


class Plot(ChartWidget):
    """A 2D Cartesian plot."""

    def __init__(self, height: str = "420px", **options: Any) -> None:
        super().__init__("plot", options, height)

    # -- axes / annotations ---------------------------------------------------

    def y_axis(self, id: str, **opts: Any) -> "Plot":
        """Register an extra Y axis; series opt in with ``y_axis="id"``."""
        self._y_axes.append({"id": id, **opts})
        return self._sync()

    def annotate(self, type: str, **opts: Any) -> "Plot":
        """Add a canvas annotation: ``span``, ``band``, ``box``, ``label``, ``line``, ``ray`` or ``fib``."""
        self._annotations.append({"type": type, **opts})
        return self._sync()

    def hline(self, value: float, **opts: Any) -> "Plot":
        """A horizontal guide line at ``value``."""
        return self.annotate("span", dim="y", value=value, **opts)

    def vline(self, value: float, **opts: Any) -> "Plot":
        """A vertical guide line at ``value``."""
        return self.annotate("span", dim="x", value=value, **opts)

    # -- generic series -------------------------------------------------------

    def add(self, type: str, **opts: Any) -> "Plot":
        """Add any series by its JS type name — the escape hatch for new chart types."""
        self._series.append(series_dict(type, opts))
        return self._sync()

    # -- basic marks ----------------------------------------------------------

    def line(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """A line (or step, with `step="before"|"after"|"center"`)."""
        return self.add("line", x=x, y=y, **opts)

    def scatter(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """Scatter; pass ``sizes=`` and/or ``colors=`` for a bubble chart."""
        return self.add("scatter", x=x, y=y, **opts)

    def bar(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """Vertical bars; `orientation="h"` lays them horizontally."""
        return self.add("bar", x=x, y=y, **opts)

    def area(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """A filled area; pass `base=` to stack."""
        return self.add("area", x=x, y=y, **opts)

    def step(self, x: Any, y: Any, where: str = "after", **opts: Any) -> "Plot":
        """A step line — shorthand for `line(..., step=where)`."""
        return self.add("line", x=x, y=y, step=where, **opts)

    def histogram(self, values: Any, **opts: Any) -> "Plot":
        """Bin raw values and draw them as bars."""
        return self.add("histogram", values=values, **opts)

    def box(self, groups: Sequence[Dict[str, Any]], **opts: Any) -> "Plot":
        """Box/violin plot from ``[{"x": 0, "values": [...]}, …]``."""
        return self.add("box", groups=list(groups), **opts)

    def heatmap(self, values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any) -> "Plot":
        """A scalar field as an image; row-major, row 0 at the bottom."""
        return self.add("heatmap", values=values, cols=cols, rows=rows, extent=extent, **opts)

    def contour(self, values: Any, cols: int, rows: int, extent: Dict[str, Any], **opts: Any) -> "Plot":
        """Iso-lines of a scalar field (marching squares)."""
        return self.add("contour", values=values, cols=cols, rows=rows, extent=extent, **opts)

    def hexbin(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """Density of a large point cloud, binned into hexagons."""
        return self.add("hexbin", x=x, y=y, **opts)

    def errorbar(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """Points with error whiskers; `band=True` shades the range instead."""
        return self.add("errorbar", x=x, y=y, **opts)

    def stem(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """Stems from a baseline with a marker at each tip."""
        return self.add("stem", x=x, y=y, **opts)

    def quiver(self, x: Any, y: Any, u: Any, v: Any, **opts: Any) -> "Plot":
        """A vector field of arrows."""
        return self.add("quiver", x=x, y=y, u=u, v=v, **opts)

    def pie(self, values: Any, **opts: Any) -> "Plot":
        """Pie or donut (`innerRadius=`); set `equalAspect` on the plot."""
        return self.add("pie", values=values, **opts)

    def image(self, source: str, extent: Dict[str, Any], **opts: Any) -> "Plot":
        """A bitmap placed in data space."""
        return self.add("image", source=source, extent=extent, **opts)

    # -- finance --------------------------------------------------------------

    def candlestick(self, x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any) -> "Plot":
        """OHLC candles."""
        return self.add("candlestick", x=x, open=open, high=high, low=low, close=close, **opts)

    def ohlc(self, x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any) -> "Plot":
        """OHLC bars (open/close ticks on a high-low line)."""
        return self.add("ohlc", x=x, open=open, high=high, low=low, close=close, **opts)

    def heikin_ashi(self, x: Any, open: Any, high: Any, low: Any, close: Any, **opts: Any) -> "Plot":
        """Heikin-Ashi candles — a smoothed OHLC that filters noise."""
        return self.add("heikinAshi", x=x, open=open, high=high, low=low, close=close, **opts)

    def bollinger(self, x: Any, close: Any, **opts: Any) -> "Plot":
        """Bollinger bands around a moving average."""
        return self.add("bollinger", x=x, close=close, **opts)

    def volume_profile(self, price: Any, volume: Any, **opts: Any) -> "Plot":
        """Traded volume by price level, with the point of control marked."""
        return self.add("volumeProfile", price=price, volume=volume, **opts)

    def drawdown(self, equity: Any, **opts: Any) -> "Plot":
        """Underwater curve of an equity series, with the worst stretch marked."""
        return self.add("drawdown", equity=equity, **opts)

    # -- statistics -----------------------------------------------------------

    def regression(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """OLS trend (optionally with a ±band) or ``method="loess"`` for a local fit."""
        return self.add("regression", x=x, y=y, **opts)

    def ecdf(self, values: Any, **opts: Any) -> "Plot":
        """The empirical CDF as a step line — no binning choice to defend."""
        return self.add("ecdf", values=values, **opts)

    def corr_matrix(self, columns: Sequence[Any], **opts: Any) -> "Plot":
        """Correlation heatmap; pass ``names=[...]`` to label the axes."""
        return self.add("corrMatrix", columns=[c for c in columns], **opts)

    def psd(self, signal: Any, **opts: Any) -> "Plot":
        """Welch power spectral density."""
        return self.add("psd", signal=signal, **opts)

    # -- machine learning -----------------------------------------------------

    def confusion_matrix(self, y_true: Any, y_pred: Any, **opts: Any) -> "Plot":
        """Confusion matrix with per-cell counts and a colorbar."""
        return self.add("confusionMatrix", yTrue=y_true, yPred=y_pred, **opts)

    def roc_curve(self, scores: Any, labels: Any, **opts: Any) -> "Plot":
        """ROC curve with the chance diagonal; AUC lands in the legend."""
        return self.add("rocCurve", scores=scores, labels=labels, **opts)

    def pr_curve(self, scores: Any, labels: Any, **opts: Any) -> "Plot":
        """Precision-recall curve with the no-skill baseline; AP in the legend."""
        return self.add("prCurve", scores=scores, labels=labels, **opts)

    def calibration(self, scores: Any, labels: Any, **opts: Any) -> "Plot":
        """Reliability diagram plus the expected calibration error."""
        return self.add("calibration", scores=scores, labels=labels, **opts)

    def embedding(self, x: Any, y: Any, **opts: Any) -> "Plot":
        """2-D embedding scatter; ``labels=`` colours by class."""
        return self.add("embedding", x=x, y=y, **opts)

    def feature_importance(self, names: Sequence[str], values: Any, **opts: Any) -> "Plot":
        """Sorted horizontal importance bars."""
        return self.add("featureImportance", names=list(names), values=values, **opts)

    def training_curves(self, series: Sequence[Dict[str, Any]], **opts: Any) -> "Plot":
        """Loss/metric curves with EMA smoothing and a best-epoch marker."""
        return self.add("trainingCurves", series=list(series), **opts)

    def model_graph(self, model: Any, **opts: Any) -> "Plot":
        """
        Draw a model's layers as a flat DAG.

        ``model`` may be a PyTorch ``nn.Module``, a Keras model, a scikit-learn
        estimator/Pipeline, an ONNX model, or an already-exported graph dict.
        """
        from .models import to_source

        return self.add("modelGraph", source=to_source(model, **_split_export(opts)), **opts)


class Plot3D(ChartWidget):
    """A 3D plot with an orbit camera."""

    def __init__(self, height: str = "480px", **options: Any) -> None:
        super().__init__("plot3d", options, height)

    def add(self, type: str, **opts: Any) -> "Plot3D":
        """Add any 3D layer by its JS type name."""
        self._layers.append(series_dict(type, opts))
        return self._sync()

    def label(self, x: float, y: float, z: float, text: str, **opts: Any) -> "Plot3D":
        """Pin a text label to a point in data space; it tracks the camera."""
        self._labels3d.append({"x": x, "y": y, "z": z, "text": text, **opts})
        return self._sync()

    def surface(self, values: Any, cols: int, rows: int, **opts: Any) -> "Plot3D":
        """A lit height field."""
        return self.add("surface", values=values, cols=cols, rows=rows, **opts)

    def scatter3d(self, x: Any, y: Any, z: Any, **opts: Any) -> "Plot3D":
        """A 3D point cloud."""
        return self.add("pointcloud", x=x, y=y, z=z, **opts)

    def line3d(self, x: Any, y: Any, z: Any, **opts: Any) -> "Plot3D":
        """A 3D polyline / path."""
        return self.add("line3d", x=x, y=y, z=z, **opts)

    def bar3d(self, x: Any, z: Any, y: Any, **opts: Any) -> "Plot3D":
        """3D bars on an x/z grid."""
        return self.add("bar3d", x=x, z=z, y=y, **opts)

    def boxes3d(self, boxes: Sequence[Dict[str, Any]], **opts: Any) -> "Plot3D":
        """Independently sized lit cuboids."""
        return self.add("boxes3d", boxes=list(boxes), **opts)

    def quiver3d(self, x: Any, y: Any, z: Any, u: Any, v: Any, w: Any, **opts: Any) -> "Plot3D":
        """A 3D vector field."""
        return self.add("quiver3d", x=x, y=y, z=z, u=u, v=v, w=w, **opts)

    def isosurface(self, values: Any, dims: Sequence[int], iso_level: float, **opts: Any) -> "Plot3D":
        """A marching-cubes isosurface of a scalar volume."""
        return self.add("isosurface", values=values, dims=list(dims), isoLevel=iso_level, **opts)

    def volume(self, values: Any, dims: Sequence[int], **opts: Any) -> "Plot3D":
        """Direct volume rendering (GPU raymarch)."""
        return self.add("volume", values=values, dims=list(dims), **opts)

    def model_graph(self, model: Any, **opts: Any) -> "Plot3D":
        """Draw a model's layers as cuboids sized from their output tensors."""
        from .models import to_source

        return self.add("modelGraph3d", source=to_source(model, **_split_export(opts)), **opts)


class Polar(ChartWidget):
    """A polar (r, θ) plot."""

    def __init__(self, height: str = "420px", **options: Any) -> None:
        super().__init__("polar", options, height)

    def line(self, theta: Any, r: Any, **opts: Any) -> "Polar":
        """A polar line; `closed=True` joins the ends."""
        self._series.append(series_dict("line", {"theta": theta, "r": r, **opts}))
        return self._sync()

    def scatter(self, theta: Any, r: Any, **opts: Any) -> "Polar":
        """Polar points."""
        self._series.append(series_dict("scatter", {"theta": theta, "r": r, **opts}))
        return self._sync()


def _split_export(opts: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the export-only keywords out of ``opts``, leaving the styling ones."""
    export: Dict[str, Any] = {}
    for key in ("example_input", "name"):
        if key in opts:
            export[key] = opts.pop(key)
    return export


def _make(cls: type, kwargs: Dict[str, Any]) -> Any:
    height = kwargs.pop("height", None)
    return cls(**({"height": height} if height else {}), **kwargs)


def _shortcut(cls: type, method: str):
    """Build a module-level one-liner: ``pv.line(x, y)`` == ``pv.Plot().line(x, y)``."""

    def call(*args: Any, **kwargs: Any) -> Any:
        plot_kwargs: Dict[str, Any] = kwargs.pop("plot", {}) or {}
        if "height" in kwargs:
            plot_kwargs["height"] = kwargs.pop("height")
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
