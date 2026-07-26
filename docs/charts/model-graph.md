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

## Slices

By default a layer is one shape. `slices` draws it as its channels instead —
`[3, 224, 224]` as three feature maps rather than one block. It works the same
way in both dimensions, and neither changes the layout: in 2D the front card
stays where the box was (so the labels stay put), and in 3D the stack fills
exactly the space the solid cuboid occupied.

<Demo src="model-graph-sliced" :height="300" />

```ts
addModelGraph(plot,   { graph, slices: "channels", maxSlices: 10 });
addModelGraph3D(plot, { graph, slices: "channels", maxSlices: 16 });
addModelGraph(plot,   { graph, slices: 4 });   // four for every layer
```

<Demo src="model-graph-3d-sliced" :height="420" />

### Voxels

`slices: "voxels"` goes all the way: instead of splitting one axis it fills the
block with a real **channels × height × width** grid of cubes.

<Demo src="model-graph-3d-voxels" :height="420" />

```ts
addModelGraph3D(plot, { graph, slices: "voxels", maxSlices: 24, maxVoxels: 30_000 });
```

The count is a product of three dimensions, so it grows fast — a single
`[3, 224, 224]` layer is 150 528 cubes. `maxSlices` caps each axis and
`maxVoxels` (default 20 000) caps the product; when the grid exceeds it all
three axes shrink together, so the proportions stay honest. Raise both
deliberately for the literal grid — the layer is one instanced draw call, but the
geometry is real.

| Option | Meaning |
| --- | --- |
| `slices` | `"none"` (default) · `"channels"` · a fixed number |
| `maxSlices` | cap per layer, so a 512-channel block stays readable. Default 12 |
| `sliceSpread` (2D) | how far the card stack fans out, as a fraction of the box. Default 0.3 |
| `sliceGap` (3D) | fraction of each slice cell left empty. Default 0.35 |

`tensorMetrics(shape)` is exported if you want the `[channels, height, width]`
split that both the sizing and the slice count are derived from.

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
