"""Array coercion and spec encoding.

Charts are described as plain dicts. Anywhere an array-like appears, it is
replaced by a ``{"$buffer": i, "dtype": ...}`` marker and the raw bytes are
appended to a buffer list — ipywidgets ships those as binary, so a million
points cross the comm without a detour through JSON.

Accepts NumPy arrays, PyTorch/TensorFlow tensors, pandas Series/Index, and
plain Python sequences. Anything exposing ``__array__`` works.
"""

from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

import numpy as np

__all__ = ["as_array", "encode_spec", "is_array_like", "matrix_shape"]

#: NumPy dtype -> the code the browser side uses to pick a typed-array view.
_DTYPE_CODES = {
    np.dtype("float64"): "f8",
    np.dtype("float32"): "f4",
    np.dtype("int32"): "i4",
    np.dtype("uint8"): "u1",
}

#: Keys whose value — and everything nested under it — must stay JSON.
#:
#: These are structural, not data: colours, dash patterns, extents, tick and
#: level lists. The browser reads them as strings/objects/plain arrays, and some
#: (``levels``, ``ticks``, ``ratios``) are branched on with ``Array.isArray``,
#: which a typed array would fail.
_NEVER_BINARY = frozenset(
    {
        "color",
        "colors",
        "colormap",
        "palette",
        "upColor",
        "downColor",
        "edgeColor",
        "nodeColor",
        "labelColor",
        "subLabelColor",
        "bandColor",
        "pocColor",
        "bidColor",
        "askColor",
        "baselineColor",
        "referenceColor",
        "connectorColor",
        "trainColor",
        "validationColor",
        "background",
        "border",
        "dash",
        "gridDash",
        "domain",
        "extent",
        "extentX",
        "extentZ",
        "dims",
        "bins",
        "center",
        "range",
        "sizeRange",
        "names",
        "classNames",
        "factors",
        "ratios",
        "ticks",
        "levels",
        "axisLabels",
        "margin",
    }
)


def is_array_like(value: Any) -> bool:
    """True when ``value`` should travel as a binary buffer."""
    if isinstance(value, (str, bytes, bool, int, float, dict)) or value is None:
        return False
    if isinstance(value, np.ndarray):
        return value.ndim >= 1
    # Tensors and Series expose __array__ / .numpy(); duck-type instead of
    # importing torch or pandas just to check.
    if hasattr(value, "__array__") or hasattr(value, "detach"):
        return True
    if isinstance(value, Sequence):
        return len(value) > 0 and all(isinstance(v, (int, float, np.number)) for v in value)
    return False


def matrix_shape(value: Any) -> Tuple[int, int]:
    """``(rows, cols)`` for a rectangular 2-D input, ``(0, 0)`` for anything else.

    Buffers cross the bridge flat, so a chart that takes a matrix has to send its
    shape alongside — this is what tells it whether it was given one.
    """
    if isinstance(value, (str, bytes, dict)) or value is None:
        return 0, 0
    try:
        arr = as_array(value)
    except (TypeError, ValueError):
        return 0, 0
    return (int(arr.shape[0]), int(arr.shape[1])) if arr.ndim == 2 else (0, 0)


def as_array(value: Any) -> np.ndarray:
    """Coerce any supported array-like into a contiguous NumPy array."""
    if isinstance(value, np.ndarray):
        arr = value
    elif hasattr(value, "detach"):  # torch.Tensor (possibly on GPU / autograd)
        arr = np.asarray(value.detach().cpu())
    elif hasattr(value, "to_numpy"):  # pandas Series / Index
        arr = value.to_numpy()
    else:
        arr = np.asarray(value)
    if arr.dtype == np.bool_:
        arr = arr.astype(np.int32)
    if not np.issubdtype(arr.dtype, np.number):
        raise TypeError(f"photonviz: expected numeric data, got dtype {arr.dtype!r}")
    return np.ascontiguousarray(arr)


def _to_buffer(value: Any) -> Tuple[bytes, str]:
    """Flattened little-endian bytes plus the dtype code for the browser."""
    arr = as_array(value).ravel()
    dtype = arr.dtype
    if dtype not in _DTYPE_CODES:
        # Everything else (int64, float16, uint32 …) becomes float64: it is what
        # the GPU path uses anyway, and it keeps the browser side to four cases.
        arr = arr.astype(np.float64)
        dtype = arr.dtype
    # The browser assumes little-endian; byteswap on the rare big-endian host.
    if arr.dtype.byteorder == ">":
        arr = arr.astype(arr.dtype.newbyteorder("<"))
    return arr.tobytes(), _DTYPE_CODES[np.dtype(arr.dtype)]


def encode_spec(spec: Any) -> Tuple[Any, List[bytes]]:
    """Split a chart spec into a JSON-safe tree plus the binary buffers it referenced."""
    buffers: List[bytes] = []

    def jsonify(value: Any) -> Any:
        """Deep-convert to plain JSON, never extracting a buffer."""
        if isinstance(value, dict):
            return {k: jsonify(v) for k, v in value.items() if v is not None}
        if isinstance(value, (list, tuple)):
            return [jsonify(v) for v in value]
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, np.generic):
            return value.item()
        return value

    def walk(value: Any, key: str | None = None) -> Any:
        # Structural keys short-circuit *before* the dict branch, so nothing
        # nested under an `extent` or a `margin` is mistaken for data.
        if key in _NEVER_BINARY:
            return jsonify(value)
        if isinstance(value, dict):
            return {k: walk(v, k) for k, v in value.items() if v is not None}
        if is_array_like(value):
            data, code = _to_buffer(value)
            buffers.append(data)
            return {"$buffer": len(buffers) - 1, "dtype": code}
        if isinstance(value, (list, tuple)):
            return [walk(v) for v in value]
        if isinstance(value, np.generic):
            return value.item()
        return value

    return walk(spec), buffers


def series_dict(kind: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Build a series dict, dropping ``None`` so JS defaults apply."""
    out: Dict[str, Any] = {"type": kind}
    for key, value in kwargs.items():
        if value is None:
            continue
        out[key] = value
    return out
