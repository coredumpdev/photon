# Model architecture

Draw a real model's layers — a Netron-style DAG in 2D, or cuboids sized from each
layer's output tensor in 3D. Both consume the same `ModelGraph`, so one export
drives either view.

<Demo src="model-graph" :height="300" />

Boxes are coloured by layer family, and an edge that skips ranks — a residual
connection — routes around the trunk instead of cutting through it.

```ts
import { Plot, addModelGraph, modelGraphFromTorchFx } from "@photonviz/core";

const graph = modelGraphFromTorchFx(await (await fetch("/model.json")).json());
addModelGraph(new Plot(el, { hover: false }), { graph, direction: "horizontal", sizeBy: "params" });
```

## In 3D

The visible face is the last two shape dims (H×W); the thickness is everything
before them (channels). A CNN therefore reads as feature maps shrinking while
depth grows.

<Demo src="model-graph-3d" :height="420" />

```ts
const plot = new Plot3D(el, { aspectMode: "data", projection: "orthographic", showAxes: false });
addModelGraph3D(plot, { graph, labels: "full" });
```

Those three options matter: the default cube fit would stretch a long chain until
the blocks lose their proportions, perspective would magnify the near end, and a
diagram has no axes to label.

## The graph

```ts
interface ModelGraph {
  name?: string;
  nodes: Array<{ id: string; name?: string; type: string; shape?: number[]; params?: number; flops?: number; group?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}
```

`shape` is the output tensor with the batch dim dropped.

## Adapters

All pure and zero-dependency — dump the JSON in Python, load it in the browser.
Or use the [Python bridge](/python/), which hands the model object over directly.

| Source | Adapter |
| --- | --- |
| PyTorch `torch.fx` trace | `modelGraphFromTorchFx(nodes)` — keeps branches and skips |
| Keras `model.to_json()` | `modelGraphFromKeras(config, { shapes, params })` — Sequential and functional, Keras 2 and 3 |
| scikit-learn | `modelGraphFromSklearn(step)` — Pipeline / ColumnTransformer / FeatureUnion; `mlpModel(sizes)` for an MLP |
| ONNX | `modelGraphFromOnnx(graph, { shapes, paramCounts })` |
| Anything | `sequentialModel(layers)` — an ordered list, edges added for you |

::: details PyTorch export
```python
import json, torch
from torch.fx import symbolic_trace
from torch.fx.passes.shape_prop import ShapeProp

gm = symbolic_trace(model)
ShapeProp(gm).propagate(torch.randn(1, 3, 224, 224))   # optional: records shapes
mods = dict(gm.named_modules())

def shape_of(n):
    t = n.meta.get("tensor_meta")
    return list(t.shape)[1:] if t is not None else None

json.dump([{
    "name": n.name, "op": n.op, "target": str(n.target),
    "args": [a.name for a in n.all_input_nodes],
    "moduleType": type(mods[str(n.target)]).__name__ if n.op == "call_module" else None,
    "shape": shape_of(n),
    "params": sum(p.numel() for p in mods[str(n.target)].parameters()) if n.op == "call_module" else None,
} for n in gm.graph.nodes], open("model.json", "w"))
```
:::

## Options

`direction` (`"vertical"` | `"horizontal"`), `sizeBy` (`"params"` | `"flops"`),
`labels`, `colors` (per layer family), `nodeWidth` / `nodeHeight` / `rankGap` /
`nodeGap`, `cornerRadius`, `edgeWidth`, `arrowSize`, `tooltip`, `hideAxes`.

The layout itself is exported — `modelLayout(graph, opts)` returns box centres,
sizes, ranks and routed edge paths if you would rather draw it yourself.
