"""The chart description every plot object accumulates.

A chart is just a dict: some options plus lists of series, layers, axes and
annotations. :class:`ChartSpec` owns that dict — *rendering* it is somebody
else's job. A :class:`~photonviz._widget.ChartWidget` pushes it over the comm; a
panel inside a :class:`~photonviz.figure.Figure` hands it to the parent instead.

That split is the whole reason a 2x2 grid ships one widget: the bundled engine
(a few hundred KB) crosses the comm once per widget, so four independent widgets
would put four copies of it in the notebook file.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

__all__ = ["ChartSpec"]


class ChartSpec:
    """Accumulates a chart description and tells its owner when it changed."""

    # Deliberately not `__init__`: traitlets walks the MRO with a cooperative
    # `super().__init__(**kwargs)`, so a widget subclass would call this one with
    # the widget's keywords and blow up. Initialization is an explicit step.
    def _init_spec(self, kind: str, options: Optional[Dict[str, Any]] = None) -> None:
        self._kind = kind
        self._options: Dict[str, Any] = dict(options or {})
        self._series: List[Dict[str, Any]] = []
        self._layers: List[Dict[str, Any]] = []
        self._y_axes: List[Dict[str, Any]] = []
        self._annotations: List[Dict[str, Any]] = []
        self._labels3d: List[Dict[str, Any]] = []
        #: Set when this chart is a panel in a Figure; then the figure syncs.
        self._parent: Optional[Any] = None
        #: Grid placement, only meaningful for a panel.
        self._place: Dict[str, Any] = {}

    @classmethod
    def _panel(cls, kind: str, options: Optional[Dict[str, Any]] = None) -> "ChartSpec":
        """Build a bare (non-widget) chart — one cell of a Figure."""
        spec = cls()
        spec._init_spec(kind, options)
        return spec

    # -- spec plumbing --------------------------------------------------------

    def _raw_spec(self) -> Dict[str, Any]:
        spec: Dict[str, Any] = {"kind": self._kind, "options": self._options}
        if self._y_axes:
            spec["yAxes"] = self._y_axes
        if self._series:
            spec["series"] = self._series
        if self._layers:
            spec["layers"] = self._layers
        if self._annotations:
            spec["annotations"] = self._annotations
        if self._labels3d:
            spec["labels3d"] = self._labels3d
        return spec

    def _sync(self) -> "ChartSpec":
        """Push the current spec to whoever renders it."""
        if self._parent is not None:
            self._parent._sync()
        return self

    # -- shared configuration -------------------------------------------------

    def options(self, **kwargs: Any) -> "ChartSpec":
        """Merge extra plot options (theme, title, legend, scales, …)."""
        self._options.update({k: v for k, v in kwargs.items() if v is not None})
        return self._sync()

    def to_spec(self) -> Dict[str, Any]:
        """The chart description, before array encoding — handy for tests and debugging."""
        return self._raw_spec()
