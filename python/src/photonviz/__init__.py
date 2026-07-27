"""
photonviz — GPU-accelerated (WebGL2) charts for Jupyter, JupyterLab and Colab.

A thin Python bridge over `@photonviz/core <https://github.com/coredumpdev/photon>`_.
NumPy arrays and torch tensors cross to the browser as binary buffers, so a
million points still render at 60fps inside a notebook cell.

    import numpy as np, photonviz as pv

    x = np.linspace(0, 10, 100_000)
    pv.line(x, np.sin(x), name="sin", plot={"theme": "dark", "legend": True})

Charts chain, and the last expression in a cell renders itself::

    pv.Plot(theme="dark", title="Two series").line(x, y1, name="a").line(x, y2, name="b")

Several charts at once, matplotlib style — ``figsize`` is in inches::

    fig, axes = pv.subplots(2, 2, figsize=(12, 7), sharex=True, theme="dark")
    axes[0, 0].line(x, y1)
    axes[1, 1].histogram(residuals)
    fig

Model architectures come straight from the framework object::

    pv.model_graph(torch_model, example_input=torch.randn(1, 3, 224, 224))
    pv.model_graph_3d(keras_model)

In Google Colab, enable the widget manager once per session::

    from google.colab import output; output.enable_custom_widget_manager()
"""

from __future__ import annotations

from typing import Any

from ._widget import ChartWidget
from .charts import Axes, Axes3D, Plot, Plot3D, Polar, PolarAxes, _shortcut
from .figure import Figure, figure, subplots
from .models import from_keras, from_layers, from_onnx, from_sklearn, from_torch, to_source

__version__ = "0.7.2"

# -- One-liners: pv.line(x, y) == pv.Plot().line(x, y) ------------------------
line = _shortcut(Plot, "line")
scatter = _shortcut(Plot, "scatter")
bar = _shortcut(Plot, "bar")
area = _shortcut(Plot, "area")
step = _shortcut(Plot, "step")
histogram = _shortcut(Plot, "histogram")
box = _shortcut(Plot, "box")
heatmap = _shortcut(Plot, "heatmap")
contour = _shortcut(Plot, "contour")
contourf = _shortcut(Plot, "contourf")
pcolormesh = _shortcut(Plot, "pcolormesh")
hexbin = _shortcut(Plot, "hexbin")
hist2d = _shortcut(Plot, "hist2d")
eventplot = _shortcut(Plot, "eventplot")
streamplot = _shortcut(Plot, "streamplot")
barbs = _shortcut(Plot, "barbs")
triplot = _shortcut(Plot, "triplot")
tripcolor = _shortcut(Plot, "tripcolor")
tricontour = _shortcut(Plot, "tricontour")
tricontourf = _shortcut(Plot, "tricontourf")

treemap = _shortcut(Plot, "treemap")
funnel = _shortcut(Plot, "funnel")
sunburst = _shortcut(Plot, "sunburst")
gauge = _shortcut(Plot, "gauge")
sankey = _shortcut(Plot, "sankey")
chord = _shortcut(Plot, "chord")
parallel_coordinates = _shortcut(Plot, "parallel_coordinates")
errorbar = _shortcut(Plot, "errorbar")
stem = _shortcut(Plot, "stem")
quiver = _shortcut(Plot, "quiver")
pie = _shortcut(Plot, "pie")
grouped_bars = _shortcut(Plot, "grouped_bars")
stacked_bars = _shortcut(Plot, "stacked_bars")
stacked_area = _shortcut(Plot, "stacked_area")
patches = _shortcut(Plot, "patches")
graph = _shortcut(Plot, "graph")

candlestick = _shortcut(Plot, "candlestick")
ohlc = _shortcut(Plot, "ohlc")
heikin_ashi = _shortcut(Plot, "heikin_ashi")
bollinger = _shortcut(Plot, "bollinger")
renko = _shortcut(Plot, "renko")
depth = _shortcut(Plot, "depth")
volume_profile = _shortcut(Plot, "volume_profile")
drawdown = _shortcut(Plot, "drawdown")

regression = _shortcut(Plot, "regression")
ecdf = _shortcut(Plot, "ecdf")
corr_matrix = _shortcut(Plot, "corr_matrix")
psd = _shortcut(Plot, "psd")

confusion_matrix = _shortcut(Plot, "confusion_matrix")
roc_curve = _shortcut(Plot, "roc_curve")
pr_curve = _shortcut(Plot, "pr_curve")
calibration = _shortcut(Plot, "calibration")
embedding = _shortcut(Plot, "embedding")
feature_importance = _shortcut(Plot, "feature_importance")
shap_beeswarm = _shortcut(Plot, "shap_beeswarm")
decision_boundary = _shortcut(Plot, "decision_boundary")
partial_dependence = _shortcut(Plot, "partial_dependence")
attention_map = _shortcut(Plot, "attention_map")
ridgeline = _shortcut(Plot, "ridgeline")
pred_vs_actual = _shortcut(Plot, "pred_vs_actual")
residuals = _shortcut(Plot, "residuals")
lift_curve = _shortcut(Plot, "lift_curve")
learning_curve = _shortcut(Plot, "learning_curve")
training_curves = _shortcut(Plot, "training_curves")
model_graph = _shortcut(Plot, "model_graph")

surface = _shortcut(Plot3D, "surface")
scatter3d = _shortcut(Plot3D, "scatter3d")
line3d = _shortcut(Plot3D, "line3d")
bar3d = _shortcut(Plot3D, "bar3d")
isosurface = _shortcut(Plot3D, "isosurface")
volume = _shortcut(Plot3D, "volume")
boxes3d = _shortcut(Plot3D, "boxes3d")
quiver3d = _shortcut(Plot3D, "quiver3d")
contour3d = _shortcut(Plot3D, "contour3d")
model_graph_3d = _shortcut(Plot3D, "model_graph")

polar_line = _shortcut(Polar, "line")
polar_scatter = _shortcut(Polar, "scatter")


def show(chart: Any) -> Any:
    """Explicitly display a chart (notebooks render the last expression anyway)."""
    from IPython.display import display  # noqa: PLC0415 - optional at import time

    display(chart)
    return chart


__all__ = [
    "Plot",
    "Plot3D",
    "Polar",
    "Axes",
    "Axes3D",
    "PolarAxes",
    "Figure",
    "subplots",
    "figure",
    "ChartWidget",
    "show",
    "__version__",
    # model export
    "model_graph",
    "model_graph_3d",
    "to_source",
    "from_torch",
    "from_keras",
    "from_sklearn",
    "from_onnx",
    "from_layers",
    # 2D one-liners
    "line", "scatter", "bar", "area", "step", "histogram", "box", "heatmap",
    "contour", "contourf", "pcolormesh", "hexbin", "hist2d", "eventplot",
    "errorbar", "stem", "quiver", "streamplot", "barbs", "pie",
    "triplot", "tripcolor", "tricontour", "tricontourf",
    # diagrams
    "treemap", "funnel", "sunburst", "gauge", "sankey", "chord", "parallel_coordinates",
    "grouped_bars", "stacked_bars", "stacked_area", "patches", "graph",
    # finance
    "candlestick", "ohlc", "heikin_ashi", "bollinger", "renko", "depth",
    "volume_profile", "drawdown",
    # statistics
    "regression", "ecdf", "corr_matrix", "psd",
    # machine learning
    "confusion_matrix", "roc_curve", "pr_curve", "calibration", "embedding",
    "feature_importance", "shap_beeswarm", "training_curves", "decision_boundary",
    "partial_dependence", "attention_map", "ridgeline", "pred_vs_actual", "residuals",
    "lift_curve", "learning_curve",
    # 3D + polar
    "surface", "scatter3d", "line3d", "bar3d", "isosurface", "volume",
    "boxes3d", "quiver3d", "contour3d",
    "polar_line", "polar_scatter",
]
