"""Tests for the Python bridge: array encoding, spec shape, and model export."""

from __future__ import annotations

import numpy as np
import pytest

import photonviz as pv
from photonviz._arrays import as_array, encode_spec, is_array_like


# -- array coercion + encoding ------------------------------------------------


def test_is_array_like_rejects_scalars_and_strings():
    assert is_array_like(np.arange(3))
    assert is_array_like([1, 2, 3])
    assert not is_array_like("#ff0000")
    assert not is_array_like(5)
    assert not is_array_like(None)
    assert not is_array_like({"a": 1})
    # A list of strings is metadata (class names, labels), never a buffer.
    assert not is_array_like(["a", "b"])


def test_as_array_handles_lists_and_bools():
    assert as_array([1, 2, 3]).dtype.kind in "iuf"
    assert as_array(np.array([True, False])).dtype == np.int32
    with pytest.raises(TypeError):
        as_array(np.array(["a", "b"]))


def test_encode_spec_extracts_buffers_and_leaves_json():
    spec = {
        "kind": "plot",
        "series": [{"type": "line", "x": np.arange(4, dtype=np.float64), "y": [1.0, 2.0, 3.0, 4.0], "color": "#f00"}],
    }
    encoded, buffers = encode_spec(spec)
    series = encoded["series"][0]
    assert series["x"] == {"$buffer": 0, "dtype": "f8"}
    assert series["y"] == {"$buffer": 1, "dtype": "f8"}
    assert series["color"] == "#f00"           # colours stay JSON
    assert len(buffers) == 2
    assert len(buffers[0]) == 4 * 8            # four float64s
    # Round-trip the bytes to be sure the payload is what the browser will read.
    assert np.frombuffer(buffers[0], dtype=np.float64).tolist() == [0, 1, 2, 3]


def test_encode_spec_preserves_structural_lists():
    """`extent`, `dims`, `domain` … are geometry, not data — they must stay JSON."""
    spec = {"series": [{"type": "heatmap", "values": np.zeros(4), "extent": {"x": [0, 1], "y": [0, 1]},
                        "dims": [2, 2], "domain": [0, 1], "dash": [4, 2]}]}
    encoded, buffers = encode_spec(spec)
    s = encoded["series"][0]
    assert s["extent"] == {"x": [0, 1], "y": [0, 1]}
    assert s["dims"] == [2, 2]
    assert s["domain"] == [0, 1]
    assert s["dash"] == [4, 2]
    assert len(buffers) == 1  # only `values` became binary


def test_encode_spec_downcasts_unsupported_dtypes():
    encoded, buffers = encode_spec({"v": np.arange(3, dtype=np.int64)})
    assert encoded["v"]["dtype"] == "f8"
    assert np.frombuffer(buffers[0], dtype=np.float64).tolist() == [0, 1, 2]
    # int32 and float32 survive as-is.
    assert encode_spec({"v": np.arange(3, dtype=np.int32)})[0]["v"]["dtype"] == "i4"
    assert encode_spec({"v": np.arange(3, dtype=np.float32)})[0]["v"]["dtype"] == "f4"


def test_encode_spec_drops_none():
    encoded, _ = encode_spec({"a": 1, "b": None})
    assert encoded == {"a": 1}


# -- chart construction -------------------------------------------------------


def test_plot_chains_and_builds_a_spec():
    x = np.linspace(0, 1, 8)
    plot = pv.Plot(theme="dark", legend=True).line(x, np.sin(x), name="sin").scatter(x, np.cos(x), size=4)
    spec = plot.to_spec()
    assert spec["kind"] == "plot"
    assert spec["options"] == {"theme": "dark", "legend": True}
    assert [s["type"] for s in spec["series"]] == ["line", "scatter"]
    assert spec["series"][0]["name"] == "sin"
    # And the synced trait is the encoded form, with buffers alongside.
    assert plot.spec["series"][0]["x"]["dtype"] == "f8"
    assert len(plot.buffers) == 4


def test_plot_y_axes_and_annotations():
    plot = (
        pv.Plot()
        .y_axis("rhs", side="right", color="#f472b6")
        .line([0, 1], [0, 1], yAxis="rhs")
        .hline(0.5, color="#888")
        .vline(0.25)
    )
    spec = plot.to_spec()
    assert spec["yAxes"] == [{"id": "rhs", "side": "right", "color": "#f472b6"}]
    assert [a["dim"] for a in spec["annotations"]] == ["y", "x"]
    assert spec["annotations"][0]["value"] == 0.5


def test_bubble_chart_keeps_sizes_binary_and_colors_json():
    plot = pv.Plot().scatter([0, 1], [0, 1], sizes=[4, 20], colors=["#f00", "#0f0"])
    s = plot.spec["series"][0]
    assert s["sizes"]["dtype"] == "f8"
    assert s["colors"] == ["#f00", "#0f0"]


def test_plot3d_layers_and_labels():
    plot = pv.Plot3D(aspectMode="data").surface(np.zeros(9), 3, 3).label(0, 1, 2, "peak", color="#fff")
    spec = plot.to_spec()
    assert spec["kind"] == "plot3d"
    assert spec["layers"][0]["type"] == "surface"
    assert spec["labels3d"] == [{"x": 0, "y": 1, "z": 2, "text": "peak", "color": "#fff"}]


def test_polar_series():
    plot = pv.Polar().line([0, 1], [1, 1]).scatter([0.5], [0.5])
    assert [s["type"] for s in plot.to_spec()["series"]] == ["line", "scatter"]


def test_module_shortcuts_build_a_plot():
    chart = pv.line([0, 1], [0, 1], name="a", plot={"theme": "dark"})
    assert isinstance(chart, pv.Plot)
    assert chart.to_spec()["options"]["theme"] == "dark"
    assert chart.to_spec()["series"][0]["name"] == "a"


def test_height_flows_through():
    assert pv.Plot(height="700px").height == "700px"
    assert pv.line([0, 1], [0, 1], height="123px").height == "123px"


def test_options_merge_after_construction():
    plot = pv.Plot(theme="dark").options(title="Later", legend=True)
    assert plot.to_spec()["options"] == {"theme": "dark", "title": "Later", "legend": True}


# -- model export -------------------------------------------------------------


def test_to_source_accepts_a_ready_made_graph():
    graph = {"nodes": [{"id": "a", "type": "Conv2d"}], "edges": []}
    assert pv.to_source(graph) == {"framework": "graph", "graph": graph}


def test_to_source_passes_through_an_existing_source():
    src = {"framework": "sequential", "layers": []}
    assert pv.to_source(src) is src


def test_to_source_rejects_unknown_objects():
    with pytest.raises(TypeError, match="don't know how to export"):
        pv.to_source(object())
    with pytest.raises(TypeError, match="ModelGraph"):
        pv.to_source({"not": "a graph"})


def test_from_layers_builds_a_sequential_source():
    src = pv.from_layers([{"id": "a", "type": "Input"}], name="net")
    assert src == {"framework": "sequential", "layers": [{"id": "a", "type": "Input"}], "name": "net"}


def test_model_graph_series_carries_the_source():
    graph = {"nodes": [{"id": "a", "type": "Linear"}], "edges": []}
    plot = pv.Plot().model_graph(graph, direction="horizontal")
    series = plot.to_spec()["series"][0]
    assert series["type"] == "modelGraph"
    assert series["source"]["framework"] == "graph"
    assert series["direction"] == "horizontal"


def test_model_graph_3d_series():
    graph = {"nodes": [], "edges": []}
    plot = pv.Plot3D().model_graph(graph, labels="full")
    layer = plot.to_spec()["layers"][0]
    assert layer["type"] == "modelGraph3d"
    assert layer["labels"] == "full"


def _fake_estimator(name, **attrs):
    """A stand-in estimator whose *class name* is what the walker reads."""
    cls = type(name, (), {"get_params": lambda self: {}, **attrs})
    return cls()


def test_from_sklearn_walks_pipelines_and_column_transformers():
    scaler = _fake_estimator("StandardScaler")
    encoder = _fake_estimator("OneHotEncoder")
    ct = _fake_estimator("ColumnTransformer", transformers=[("num", scaler, ["age"]), ("cat", encoder, ["city"])])
    clf = _fake_estimator("RandomForestClassifier")
    pipe = _fake_estimator("Pipeline", steps=[("prep", ct), ("clf", clf)])

    src = pv.from_sklearn(pipe)
    assert src["framework"] == "sklearn"
    root = src["step"]
    assert root["mode"] == "sequential"
    prep, tail = root["steps"]
    assert prep["mode"] == "parallel"
    assert [s["type"] for s in prep["steps"]] == ["StandardScaler", "OneHotEncoder"]
    assert prep["steps"][0]["columns"] == ["age"]
    assert tail["type"] == "RandomForestClassifier"


def test_from_sklearn_expands_an_mlp_into_dense_layers():
    mlp = _fake_estimator(
        "MLPClassifier",
        hidden_layer_sizes=(8, 4),
        n_features_in_=5,
        n_outputs_=3,
        activation="relu",
        out_activation_="softmax",
    )
    src = pv.from_sklearn(mlp)
    assert src["framework"] == "sequential"
    types = [layer["type"] for layer in src["layers"]]
    assert types == ["Input", "Linear", "Relu", "Linear", "Relu", "Linear", "Softmax"]
    dense = [layer for layer in src["layers"] if layer["type"] == "Linear"]
    assert dense[0]["params"] == 5 * 8 + 8
    assert dense[-1]["shape"] == [3]
