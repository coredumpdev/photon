"""The anywidget that carries a chart spec to the browser.

One widget class backs every chart kind (2D / 3D / polar). It holds the spec on
the Python side, re-encodes it on each mutation, and lets anywidget handle the
comm — which is why the same object renders in Jupyter Notebook, JupyterLab,
VS Code and Google Colab without any per-frontend code.
"""

from __future__ import annotations

import pathlib
from typing import Any, Dict, List, Optional

import anywidget
import traitlets

from ._arrays import encode_spec

_STATIC = pathlib.Path(__file__).parent / "static"

__all__ = ["ChartWidget"]


class ChartWidget(anywidget.AnyWidget):
    """Base widget: a spec, its binary buffers, and a CSS height."""

    _esm = _STATIC / "widget.js"

    spec = traitlets.Dict({}).tag(sync=True)
    buffers = traitlets.List(traitlets.Bytes()).tag(sync=True)
    height = traitlets.Unicode("420px").tag(sync=True)

    def __init__(self, kind: str, options: Optional[Dict[str, Any]] = None, height: str = "420px") -> None:
        if not _STATIC.joinpath("widget.js").exists():  # pragma: no cover - packaging guard
            raise RuntimeError(
                "photonviz: the bundled widget JS is missing. Install the published "
                "wheel, or run `pnpm build:python` from a source checkout."
            )
        super().__init__(height=height)
        self._kind = kind
        self._options: Dict[str, Any] = dict(options or {})
        self._series: List[Dict[str, Any]] = []
        self._layers: List[Dict[str, Any]] = []
        self._y_axes: List[Dict[str, Any]] = []
        self._annotations: List[Dict[str, Any]] = []
        self._labels3d: List[Dict[str, Any]] = []
        self._sync()

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

    def _sync(self) -> "ChartWidget":
        """Re-encode and push. Traits are reassigned so the change event fires."""
        encoded, buffers = encode_spec(self._raw_spec())
        self.spec = encoded
        self.buffers = buffers
        return self

    # -- shared configuration -------------------------------------------------

    def options(self, **kwargs: Any) -> "ChartWidget":
        """Merge extra plot options (theme, title, legend, scales, …)."""
        self._options.update({k: v for k, v in kwargs.items() if v is not None})
        return self._sync()

    def set_height(self, height: str) -> "ChartWidget":
        """Set the CSS height of the output area (e.g. ``"600px"``)."""
        self.height = height
        return self

    def to_spec(self) -> Dict[str, Any]:
        """The chart description, before array encoding — handy for tests and debugging."""
        return self._raw_spec()
