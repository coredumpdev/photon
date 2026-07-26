"""Figures: several charts laid out in one grid, matplotlib style.

    fig, axes = pv.subplots(2, 2, figsize=(12, 7), title="Run 41")
    axes[0, 0].line(t, loss, name="loss")
    axes[0, 1].roc_curve(scores, labels)
    axes[1, 0].confusion_matrix(y_true, y_pred)
    axes[1, 1].histogram(residuals)
    fig

``figsize`` is matplotlib's ``(width, height)`` in inches at ``dpi`` (100 by
default), so ``figsize=(12, 7)`` is a 1200x700 CSS-pixel figure.

The whole grid is **one** widget: the panels share a single comm and a single
copy of the bundled engine, and — because every Photon plot already draws
through one shared WebGL context — a 4x4 figure costs no more GPU contexts than
a single chart. Panels stay fully independent otherwise, each with its own
scales, toolbar and hover, unless ``sharex`` / ``sharey`` links their views.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

from ._spec import ChartSpec
from ._widget import ChartWidget, figure_size
from .charts import Axes, Axes3D, PANEL_KINDS, PolarAxes

__all__ = ["Figure", "subplots", "figure"]

#: Height of one panel row, in CSS px, when neither `figsize` nor `height` is given.
ROW_HEIGHT = 280
#: Vertical room the suptitle strip takes.
TITLE_STRIP = 28

AnyAxes = Union[Axes, Axes3D, PolarAxes]


class Figure(ChartWidget):
    """A grid of charts in a single widget. Build it with :func:`subplots`."""

    def __init__(
        self,
        nrows: int = 1,
        ncols: int = 1,
        figsize: Optional[Sequence[float]] = None,
        dpi: Optional[float] = None,
        height: Optional[str] = None,
        gap: int = 12,
        title: Optional[Union[str, Dict[str, Any]]] = None,
        background: Optional[str] = None,
        sharex: bool = False,
        sharey: bool = False,
        height_ratios: Optional[Sequence[float]] = None,
        width_ratios: Optional[Sequence[float]] = None,
        **options: Any,
    ) -> None:
        self._rows = max(1, int(nrows))
        self._cols = max(1, int(ncols))
        self._gap = int(gap)
        self._title = title
        self._background = background
        self._sharex = bool(sharex)
        self._sharey = bool(sharey)
        self._height_ratios = list(height_ratios) if height_ratios else None
        self._width_ratios = list(width_ratios) if width_ratios else None
        self._panels: List[ChartSpec] = []

        if figsize is None and height is None:
            rows = self._rows
            height = f"{rows * ROW_HEIGHT + (rows - 1) * self._gap + (TITLE_STRIP if title else 0)}px"
        w, h = figure_size(figsize, dpi, height, f"{ROW_HEIGHT}px")
        # `options` are the per-panel defaults (theme, legend, hover…); a panel's
        # own keyword always wins over them.
        ChartWidget.__init__(self, "figure", options, height=h, width=w)

    # -- layout ---------------------------------------------------------------

    @property
    def shape(self) -> Tuple[int, int]:
        """``(nrows, ncols)`` of the grid."""
        return (self._rows, self._cols)

    @property
    def axes(self) -> List[AnyAxes]:
        """Every panel, in the order it was added."""
        return list(self._panels)  # type: ignore[arg-type]

    def suptitle(self, text: str, **opts: Any) -> "Figure":
        """Set the figure-wide title drawn above the grid."""
        self._title = {"text": text, **opts} if opts else text
        return self._sync()

    def add_subplot(
        self,
        row: Optional[int] = None,
        col: Optional[int] = None,
        rowspan: int = 1,
        colspan: int = 1,
        kind: str = "plot",
        **options: Any,
    ) -> AnyAxes:
        """
        Add one panel and return its axes.

        ``row`` / ``col`` are 0-based; omit both to take the next free cell in
        reading order. ``rowspan`` / ``colspan`` let a panel straddle several
        cells. ``kind`` picks the chart type: ``"plot"`` (default), ``"plot3d"``
        or ``"polar"``.
        """
        cls = PANEL_KINDS.get(kind)
        if cls is None:
            raise ValueError(f"photonviz: unknown subplot kind {kind!r}; expected one of {sorted(PANEL_KINDS)}")
        panel = cls._panel(kind, options)
        panel._parent = self
        place: Dict[str, Any] = {}
        if row is not None:
            place["row"] = int(row)
        if col is not None:
            place["col"] = int(col)
        if rowspan != 1:
            place["rowSpan"] = int(rowspan)
        if colspan != 1:
            place["colSpan"] = int(colspan)
        panel._place = place
        self._panels.append(panel)
        self._sync()
        return panel  # type: ignore[return-value]

    # -- spec -----------------------------------------------------------------

    def _panel_spec(self, panel: ChartSpec) -> Dict[str, Any]:
        """One panel's spec, with the figure's defaults folded under its own options."""
        raw = panel._raw_spec()
        if self._options:
            raw["options"] = {**self._options, **raw["options"]}
        raw.update(panel._place)
        return raw

    def _raw_spec(self) -> Dict[str, Any]:
        spec: Dict[str, Any] = {
            "kind": "figure",
            "rows": self._rows,
            "cols": self._cols,
            "gap": self._gap,
            "panels": [self._panel_spec(p) for p in self._panels],
        }
        if self._title:
            spec["title"] = self._title
        if self._background:
            spec["background"] = self._background
        if self._height_ratios:
            spec["rowRatios"] = self._height_ratios
        if self._width_ratios:
            spec["colRatios"] = self._width_ratios
        if self._sharex:
            spec["linkX"] = True
        if self._sharey:
            spec["linkY"] = True
        # The suptitle is drawn by the grid, not by a plot, so it needs the theme.
        theme = self._options.get("theme")
        if isinstance(theme, str):
            spec["theme"] = theme
        return spec


def subplots(
    nrows: int = 1,
    ncols: int = 1,
    figsize: Optional[Sequence[float]] = None,
    dpi: Optional[float] = None,
    height: Optional[str] = None,
    sharex: bool = False,
    sharey: bool = False,
    gap: int = 12,
    title: Optional[Union[str, Dict[str, Any]]] = None,
    background: Optional[str] = None,
    height_ratios: Optional[Sequence[float]] = None,
    width_ratios: Optional[Sequence[float]] = None,
    kind: str = "plot",
    squeeze: bool = True,
    **options: Any,
) -> Tuple[Figure, Any]:
    """
    Create a figure and a grid of axes — the matplotlib entry point.

        fig, axes = pv.subplots(2, 2, figsize=(12, 7), sharex=True)
        axes[0, 0].line(x, y)

    Returns ``(figure, axes)``. As in matplotlib, ``squeeze`` drops length-1
    dimensions: a 1x1 grid yields the bare axes object, a single row or column
    yields a 1-D array, anything larger a 2-D array — so ``axes[i, j]``,
    ``axes[i]``, ``axes.flat`` and ``for ax in axes.flat`` all work.

    ``sharex`` / ``sharey`` link the panels' views, so panning or zooming one
    moves them all (``sharex`` shares the hover crosshair too). Extra keyword
    arguments become the default options of every panel: ``theme="dark"``,
    ``legend=True``, and so on.
    """
    fig = Figure(
        nrows,
        ncols,
        figsize=figsize,
        dpi=dpi,
        height=height,
        gap=gap,
        title=title,
        background=background,
        sharex=sharex,
        sharey=sharey,
        height_ratios=height_ratios,
        width_ratios=width_ratios,
        **options,
    )
    grid = np.empty((fig.shape[0], fig.shape[1]), dtype=object)
    for r in range(fig.shape[0]):
        for c in range(fig.shape[1]):
            grid[r, c] = fig.add_subplot(row=r, col=c, kind=kind)
    if squeeze:
        if grid.size == 1:
            return fig, grid[0, 0]
        if 1 in grid.shape:
            return fig, grid.reshape(-1)
    return fig, grid


def figure(
    figsize: Optional[Sequence[float]] = None,
    dpi: Optional[float] = None,
    height: Optional[str] = None,
    rows: int = 1,
    cols: int = 1,
    **options: Any,
) -> Figure:
    """
    An empty figure — fill it with :meth:`Figure.add_subplot`.

    Use this over :func:`subplots` when the panels aren't a uniform grid::

        fig = pv.figure(figsize=(12, 8), rows=2, cols=2)
        fig.add_subplot(colspan=2).line(t, price)      # full-width top row
        fig.add_subplot(row=1, col=0).histogram(returns)
        fig.add_subplot(row=1, col=1, kind="polar").line(theta, r)
    """
    return Figure(rows, cols, figsize=figsize, dpi=dpi, height=height, **options)
