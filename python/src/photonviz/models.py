"""Export a trained model's architecture so it can be drawn.

Each function turns a framework object into a small JSON payload; the browser
side feeds that to the matching adapter in ``@photonviz/core``, so the graph
logic lives in exactly one place. Frameworks are imported lazily and detected by
duck typing — importing :mod:`photonviz` never pulls in PyTorch.

    import photonviz as pv
    pv.model_graph(model)                      # 2D DAG
    pv.model_graph_3d(model, example_input=x)  # tensor-shaped blocks
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

__all__ = [
    "to_source",
    "from_torch",
    "from_keras",
    "from_sklearn",
    "from_onnx",
    "from_layers",
]


def _class_path(obj: Any) -> str:
    cls = type(obj)
    return f"{cls.__module__}.{cls.__qualname__}"


def to_source(model: Any, example_input: Any = None, name: Optional[str] = None) -> Dict[str, Any]:
    """Dispatch on what ``model`` actually is and return a browser-ready payload."""
    if isinstance(model, dict):
        if "nodes" in model and "edges" in model:
            return {"framework": "graph", "graph": model}
        if "framework" in model:  # already a source payload
            return model
        raise TypeError("photonviz: a dict model must be a ModelGraph with 'nodes' and 'edges'")

    path = _class_path(model)
    if path.startswith("torch.") or hasattr(model, "named_modules"):
        return from_torch(model, example_input=example_input, name=name)
    if hasattr(model, "to_json") and hasattr(model, "layers"):
        return from_keras(model, name=name)
    if hasattr(model, "graph") and hasattr(model.graph, "node"):
        return from_onnx(model, name=name)
    if hasattr(model, "get_params"):
        return from_sklearn(model, name=name)
    raise TypeError(
        f"photonviz: don't know how to export a {path}. Pass a PyTorch Module, "
        "a Keras model, a scikit-learn estimator, an ONNX model, or a ModelGraph dict."
    )


# -- PyTorch ------------------------------------------------------------------


def from_torch(model: Any, example_input: Any = None, name: Optional[str] = None) -> Dict[str, Any]:
    """
    Trace a ``torch.nn.Module`` with ``torch.fx`` so branches and residual
    connections survive. Pass ``example_input`` to also record output shapes.

    Models with data-dependent control flow cannot be traced; those fall back to
    a flat chain of the leaf modules, which still shows the layer stack.
    """
    try:
        import torch  # noqa: F401
        from torch.fx import symbolic_trace
    except ImportError as exc:  # pragma: no cover - depends on the user's env
        raise ImportError("photonviz: PyTorch is required to export a torch model") from exc

    try:
        traced = symbolic_trace(model)
    except Exception:
        # Dynamic control flow (if/loops on tensor values) defeats symbolic tracing.
        return from_layers(_torch_leaf_layers(model), name=name or type(model).__name__)

    if example_input is not None:
        try:
            from torch.fx.passes.shape_prop import ShapeProp

            args = example_input if isinstance(example_input, (list, tuple)) else (example_input,)
            ShapeProp(traced).propagate(*args)
        except Exception:
            pass  # shapes are a bonus; the topology is the point

    modules = dict(traced.named_modules())
    nodes: List[Dict[str, Any]] = []
    for node in traced.graph.nodes:
        entry: Dict[str, Any] = {
            "name": node.name,
            "op": node.op,
            "target": str(node.target),
            "args": [a.name for a in node.all_input_nodes],
        }
        if node.op == "call_module":
            mod = modules.get(str(node.target))
            if mod is not None:
                entry["moduleType"] = type(mod).__name__
                try:
                    entry["params"] = int(sum(p.numel() for p in mod.parameters(recurse=False)))
                except Exception:
                    pass
        shape = _torch_shape(node)
        if shape:
            entry["shape"] = shape
        nodes.append(entry)

    return {"framework": "torch-fx", "nodes": nodes, "name": name or type(model).__name__}


def _torch_shape(node: Any) -> Optional[List[int]]:
    """Output shape with the batch dim dropped, when ShapeProp filled it in."""
    meta = getattr(node, "meta", {}) or {}
    tensor_meta = meta.get("tensor_meta")
    shape = getattr(tensor_meta, "shape", None)
    if shape is None:
        return None
    dims = [int(d) for d in list(shape)[1:] if isinstance(d, int) or hasattr(d, "__index__")]
    return dims or None


def _torch_leaf_layers(model: Any) -> List[Dict[str, Any]]:
    """Leaf modules in declaration order — the untraceable-model fallback."""
    layers: List[Dict[str, Any]] = []
    for path, mod in model.named_modules():
        if not path or len(list(mod.children())):
            continue  # skip the root and every container
        entry: Dict[str, Any] = {"id": path, "name": path, "type": type(mod).__name__}
        try:
            count = int(sum(p.numel() for p in mod.parameters(recurse=False)))
            if count:
                entry["params"] = count
        except Exception:
            pass
        layers.append(entry)
    return layers


# -- TensorFlow / Keras -------------------------------------------------------


def from_keras(model: Any, name: Optional[str] = None) -> Dict[str, Any]:
    """
    Export a Keras model config plus per-layer shapes and parameter counts.
    Sequential models chain; functional ones keep their real wiring.
    """
    import json

    config = json.loads(model.to_json())
    shapes: Dict[str, List[int]] = {}
    params: Dict[str, int] = {}
    for layer in model.layers:
        try:
            out = getattr(layer, "output_shape", None)
            if out is None:
                out = tuple(layer.output.shape)
            # Multi-output layers report a list of shapes; take the first.
            if out and isinstance(out[0], (list, tuple)):
                out = out[0]
            dims = [int(d) for d in list(out)[1:] if d is not None]
            if dims:
                shapes[layer.name] = dims
        except Exception:
            pass
        try:
            params[layer.name] = int(layer.count_params())
        except Exception:
            pass
    return {
        "framework": "keras",
        "model": config,
        "shapes": shapes,
        "params": params,
        "name": name or getattr(model, "name", None),
    }


# -- scikit-learn -------------------------------------------------------------


def from_sklearn(estimator: Any, name: Optional[str] = None) -> Dict[str, Any]:
    """
    Walk a ``Pipeline`` / ``ColumnTransformer`` / ``FeatureUnion`` into a step
    tree. A bare ``MLPClassifier``/``MLPRegressor`` is expanded into its real
    dense layer stack instead.
    """
    kind = type(estimator).__name__
    if kind.startswith("MLP") and hasattr(estimator, "hidden_layer_sizes"):
        return _mlp_source(estimator, name)
    return {"framework": "sklearn", "step": _sklearn_step("pipeline", estimator), "name": name or kind}


def _sklearn_step(step_name: str, est: Any, columns: Any = None) -> Dict[str, Any]:
    node: Dict[str, Any] = {"name": step_name, "type": type(est).__name__}
    if columns is not None and not isinstance(columns, str):
        try:
            node["columns"] = [str(c) for c in columns]
        except TypeError:
            pass
    elif isinstance(columns, str):
        node["columns"] = [columns]

    steps = getattr(est, "steps", None)  # Pipeline
    if steps:
        node["mode"] = "sequential"
        node["steps"] = [_sklearn_step(n, e) for n, e in steps]
        return node
    transformers = getattr(est, "transformers", None)  # ColumnTransformer
    if transformers:
        node["mode"] = "parallel"
        node["steps"] = [_sklearn_step(n, e, c) for n, e, c in transformers]
        return node
    union = getattr(est, "transformer_list", None)  # FeatureUnion
    if union:
        node["mode"] = "parallel"
        node["steps"] = [_sklearn_step(n, e) for n, e in union]
        return node
    return node


def _mlp_source(estimator: Any, name: Optional[str]) -> Dict[str, Any]:
    """An MLP's layer sizes, as a plain dense stack."""
    hidden = estimator.hidden_layer_sizes
    hidden = [int(hidden)] if isinstance(hidden, int) else [int(h) for h in hidden]
    n_in = int(getattr(estimator, "n_features_in_", 0)) or None
    n_out = int(getattr(estimator, "n_outputs_", 0)) or None
    sizes = ([n_in] if n_in else []) + hidden + ([n_out] if n_out else [])

    layers: List[Dict[str, Any]] = []
    if sizes:
        layers.append({"id": "input", "name": "input", "type": "Input", "shape": [sizes[0]]})
        activation = str(getattr(estimator, "activation", "relu")).capitalize()
        for i in range(1, len(sizes)):
            last = i == len(sizes) - 1
            layers.append({
                "id": f"dense_{i}",
                "name": "output" if last else f"dense_{i}",
                "type": "Linear",
                "shape": [sizes[i]],
                "params": sizes[i - 1] * sizes[i] + sizes[i],
            })
            act = str(getattr(estimator, "out_activation_", "Softmax")).capitalize() if last else activation
            if act and act.lower() != "identity":
                layers.append({"id": f"{act.lower()}_{i}", "type": act, "shape": [sizes[i]]})
    return {"framework": "sequential", "layers": layers, "name": name or type(estimator).__name__}


# -- ONNX ---------------------------------------------------------------------


def from_onnx(model: Any, name: Optional[str] = None) -> Dict[str, Any]:
    """
    Export an ONNX graph — the framework-neutral path. Accepts a loaded
    ``ModelProto`` or a path to a ``.onnx`` file; shape inference is run when
    available so the blocks can be sized.
    """
    try:
        import onnx
        from google.protobuf.json_format import MessageToDict
    except ImportError as exc:  # pragma: no cover - depends on the user's env
        raise ImportError("photonviz: `onnx` is required to export an ONNX model") from exc

    if isinstance(model, (str, bytes)) or hasattr(model, "__fspath__"):
        model = onnx.load(model)
    try:
        model = onnx.shape_inference.infer_shapes(model)
    except Exception:
        pass

    graph = MessageToDict(model.graph)
    shapes: Dict[str, List[int]] = {}
    for info in list(getattr(model.graph, "value_info", [])) + list(model.graph.output):
        dims = [int(d.dim_value) for d in info.type.tensor_type.shape.dim if d.dim_value > 0]
        if len(dims) > 1:
            shapes[info.name] = dims[1:]  # drop the batch dim

    param_counts: Dict[str, int] = {}
    for init in model.graph.initializer:
        count = 1
        for d in init.dims:
            count *= int(d)
        param_counts[init.name] = count

    return {
        "framework": "onnx",
        "graph": graph,
        "shapes": shapes,
        "paramCounts": param_counts,
        "name": name or getattr(model.graph, "name", None) or "onnx",
    }


# -- Hand-written ------------------------------------------------------------


def from_layers(layers: List[Dict[str, Any]], name: Optional[str] = None) -> Dict[str, Any]:
    """A straight chain from an ordered layer list — the manual escape hatch."""
    return {"framework": "sequential", "layers": layers, "name": name}
