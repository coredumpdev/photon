"""Generate the Python API reference for the docs site.

Introspects the installed `photonviz` package and writes `docs/python/api.md`.
Only members the package itself defines are listed — the traitlets and anywidget
machinery a chart class inherits is noise here.

    python python/scripts/gen_api_docs.py
"""

from __future__ import annotations

import inspect
import pathlib
import sys
from typing import Any, Dict, List

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

import photonviz as pv  # noqa: E402
from photonviz import charts, models  # noqa: E402
from photonviz.figure import Figure, figure as figure_fn, subplots as subplots_fn  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "python" / "api.md"

#: Chart classes, in the order they should appear.
CLASSES = [charts.Plot, charts.Plot3D, charts.Polar, Figure]

#: Figure constructors, documented above the classes.
FIGURE_FUNCTIONS = [("subplots", subplots_fn), ("figure", figure_fn)]

#: Module-level shortcuts, grouped for readability.
SHORTCUT_GROUPS = [
    ("Basic marks", ["line", "scatter", "bar", "area", "step", "histogram", "box",
                     "heatmap", "contour", "hexbin", "errorbar", "stem", "quiver", "pie",
                     "grouped_bars", "stacked_bars", "stacked_area", "patches", "graph"]),
    ("Fields and rasters", ["contourf", "pcolormesh", "hist2d", "eventplot", "streamplot", "barbs"]),
    ("Finance", ["candlestick", "ohlc", "heikin_ashi", "bollinger", "renko", "depth",
                 "volume_profile", "drawdown"]),
    ("Statistics", ["regression", "ecdf", "corr_matrix", "psd"]),
    ("Machine learning", ["confusion_matrix", "roc_curve", "pr_curve", "calibration",
                          "embedding", "feature_importance", "shap_beeswarm", "training_curves"]),
    ("3D", ["surface", "scatter3d", "line3d", "bar3d", "isosurface", "volume",
            "boxes3d", "quiver3d", "contour3d"]),
    ("Polar", ["polar_line", "polar_scatter"]),
    ("Model architecture", ["model_graph", "model_graph_3d"]),
]

EXPORTERS = ["to_source", "from_torch", "from_keras", "from_sklearn", "from_onnx", "from_layers"]


def first_line(obj: Any) -> str:
    """The summary line of a docstring, collapsed to one line."""
    doc = inspect.getdoc(obj) or ""
    if not doc:
        return ""
    parts: List[str] = []
    for line in doc.splitlines():
        if not line.strip():
            break
        parts.append(line.strip())
    return " ".join(parts)


def full_doc(obj: Any) -> str:
    return inspect.getdoc(obj) or ""


def signature(obj: Any, name: str, drop_self: bool = False) -> str:
    # `from __future__ import annotations` leaves annotations as strings, which
    # would render as `x: 'Any'`. Resolve them where the runtime allows it.
    try:
        sig = inspect.signature(obj, eval_str=True)
    except (TypeError, ValueError, NameError):
        try:
            sig = inspect.signature(obj)
        except (TypeError, ValueError):
            return f"{name}(...)"
    params = list(sig.parameters.values())
    if drop_self and params and params[0].name == "self":
        params = params[1:]
    rendered = ", ".join(str(p) for p in params)
    return f"{name}({rendered})"


def own_methods(cls: type) -> List[tuple[str, Any]]:
    """
    Public methods the package defines on `cls` or its own bases.

    Walking the MRO matters since the drawing API lives on `Axes` while the
    widget classes only add the comm plumbing — `vars(Plot)` alone is nearly
    empty. Traitlets / anywidget bases are skipped: that machinery is noise here.
    """
    out: Dict[str, Any] = {}
    for base in reversed(cls.__mro__):
        if not getattr(base, "__module__", "").startswith("photonviz"):
            continue
        for name, member in vars(base).items():
            if name.startswith("_") or not callable(member):
                continue
            out[name] = member
    return list(out.items())


def render() -> str:
    lines: List[str] = []
    add = lines.append

    add("# Python API")
    add("")
    add("Generated from the `photonviz` package. Every chart keyword maps 1:1 onto the")
    add("[TypeScript options](/api/), so anything documented there can be passed straight")
    add("through as a keyword argument.")
    add("")
    add("```bash")
    add("pip install photonviz")
    add("```")
    add("")
    add("::: tip Regenerating")
    add("`python python/scripts/gen_api_docs.py` — run it after changing the Python API.")
    add(":::")
    add("")

    # -- figures --------------------------------------------------------------
    add("## Figures")
    add("")
    add("`figsize` is matplotlib's `(width, height)` in inches at `dpi` (100 by")
    add("default), so `figsize=(12, 7)` is a 1200x700 figure. It works on a single")
    add("chart too: `pv.Plot(figsize=(8, 4))`.")
    add("")
    for name, fn in FIGURE_FUNCTIONS:
        add(f"### `{name}`")
        add("")
        add(f"```python\n{signature(fn, name)}\n```")
        add("")
        doc = full_doc(fn)
        if doc:
            add(doc)
            add("")

    # -- classes --------------------------------------------------------------
    for cls in CLASSES:
        add(f"## `{cls.__name__}`")
        add("")
        doc = full_doc(cls)
        if doc:
            add(doc)
            add("")
        add(f"```python\n{signature(cls.__init__, cls.__name__, drop_self=True)}\n```")
        add("")
        add("| Method | Description |")
        add("| --- | --- |")
        for name, member in own_methods(cls):
            sig = signature(member, name, drop_self=True).replace("|", "\\|")
            summary = first_line(member).replace("|", "\\|") or "—"
            add(f"| `{sig}` | {summary} |")
        add("")

    # -- shortcuts ------------------------------------------------------------
    add("## Module shortcuts")
    add("")
    add("Each one builds the chart object for you: `pv.line(x, y)` is exactly")
    add("`pv.Plot().line(x, y)`. Pass `plot={...}` to configure the plot itself")
    add("(theme, title, legend, scales, height…).")
    add("")
    for title, names in SHORTCUT_GROUPS:
        add(f"### {title}")
        add("")
        add("| Shortcut | Equivalent to |")
        add("| --- | --- |")
        for name in names:
            fn = getattr(pv, name, None)
            if fn is None:
                continue
            target = getattr(fn, "_photon_target", None)
            if target:
                cls, method = target
                sig = signature(getattr(cls, method), name, drop_self=True).replace("|", "\\|")
                add(f"| `pv.{sig}` | `{cls.__name__}().{method}(...)` |")
            else:  # pragma: no cover - every shortcut carries a target
                add(f"| `pv.{name}(...)` | — |")
        add("")

    # -- model exporters ------------------------------------------------------
    add("## Model export")
    add("")
    add("`pv.model_graph(model)` and `pv.model_graph_3d(model)` call these for you;")
    add("they are exported so you can inspect or cache the payload yourself.")
    add("")
    for name in EXPORTERS:
        fn = getattr(models, name, None)
        if fn is None:
            continue
        add(f"### `{name}`")
        add("")
        add(f"```python\n{signature(fn, name)}\n```")
        add("")
        doc = full_doc(fn)
        if doc:
            add(doc)
            add("")

    add("## Version")
    add("")
    add(f"```python\nphotonviz.__version__  # \"{pv.__version__}\"\n```")
    add("")
    return "\n".join(lines)


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT.relative_to(pathlib.Path.cwd())} ({OUT.stat().st_size} bytes)")
