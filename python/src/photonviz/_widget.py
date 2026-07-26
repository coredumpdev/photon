"""The anywidget that carries a chart spec to the browser.

One widget class backs every chart kind (2D / 3D / polar / figure). It holds the
spec on the Python side, re-encodes it on each mutation, and lets anywidget
handle the comm — which is why the same object renders in Jupyter Notebook,
JupyterLab, VS Code and Google Colab without any per-frontend code.
"""

from __future__ import annotations

import pathlib
from typing import Any, Dict, Optional, Sequence, Tuple

import anywidget
import traitlets

from ._arrays import encode_spec
from ._spec import ChartSpec

_STATIC = pathlib.Path(__file__).parent / "static"

#: matplotlib's default — `figsize` is in inches, so this is what turns it into px.
DEFAULT_DPI = 100

__all__ = ["ChartWidget", "DEFAULT_DPI", "figure_size"]


def figure_size(
    figsize: Optional[Sequence[float]],
    dpi: Optional[float],
    height: Optional[str],
    default_height: str,
) -> Tuple[str, str]:
    """
    Resolve ``figsize`` / ``height`` into the CSS ``(width, height)`` pair.

    ``figsize`` is matplotlib's ``(width, height)`` **in inches**; multiplying by
    ``dpi`` gives CSS pixels. An explicit ``height`` still wins, so
    ``figsize=(10, 4), height="600px"`` means "10 inches wide, 600px tall".
    """
    if figsize is None:
        return "100%", height or default_height
    if len(figsize) != 2:
        raise ValueError(f"photonviz: figsize must be (width, height) in inches, got {figsize!r}")
    scale = DEFAULT_DPI if dpi is None else dpi
    w, h = (float(v) * float(scale) for v in figsize)
    if w <= 0 or h <= 0:
        raise ValueError(f"photonviz: figsize must be positive, got {figsize!r}")
    return f"{w:g}px", height or f"{h:g}px"


class ChartWidget(anywidget.AnyWidget, ChartSpec):
    """A chart spec plus the traits that carry it to the browser."""

    _esm = _STATIC / "widget.js"

    spec = traitlets.Dict({}).tag(sync=True)
    buffers = traitlets.List(traitlets.Bytes()).tag(sync=True)
    height = traitlets.Unicode("420px").tag(sync=True)
    width = traitlets.Unicode("100%").tag(sync=True)

    def __init__(
        self,
        kind: str,
        options: Optional[Dict[str, Any]] = None,
        height: str = "420px",
        width: str = "100%",
    ) -> None:
        if not _STATIC.joinpath("widget.js").exists():  # pragma: no cover - packaging guard
            raise RuntimeError(
                "photonviz: the bundled widget JS is missing. Install the published "
                "wheel, or run `pnpm build:python` from a source checkout."
            )
        anywidget.AnyWidget.__init__(self, height=height, width=width)
        self._init_spec(kind, options)
        self._sync()

    def _sync(self) -> "ChartWidget":
        """Re-encode and push. Traits are reassigned so the change event fires."""
        encoded, buffers = encode_spec(self._raw_spec())
        self.spec = encoded
        self.buffers = buffers
        return self

    def set_height(self, height: str) -> "ChartWidget":
        """Set the CSS height of the output area (e.g. ``"600px"``)."""
        self.height = height
        return self

    def set_width(self, width: str) -> "ChartWidget":
        """Set the CSS width of the output area. Default ``"100%"`` (fills the cell)."""
        self.width = width
        return self

    def set_figsize(self, figsize: Sequence[float], dpi: Optional[float] = None) -> "ChartWidget":
        """Resize in matplotlib units: ``(width, height)`` in inches at ``dpi``."""
        self.width, self.height = figure_size(figsize, dpi, None, self.height)
        return self
