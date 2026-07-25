/** A traced PyTorch residual block: the skip edge routes around the trunk. */
import { Plot, addModelGraph, modelGraphFromTorchFx } from "@photonviz/core";

export default (el: HTMLElement) => {
  // Exactly the shape `torch.fx.symbolic_trace(...)` + ShapeProp dumps.
  const graph = modelGraphFromTorchFx([
    { name: "x", op: "placeholder", shape: [64, 56, 56] },
    { name: "conv1", op: "call_module", target: "conv1", moduleType: "Conv2d", args: ["x"], shape: [64, 56, 56], params: 36864 },
    { name: "bn1", op: "call_module", target: "bn1", moduleType: "BatchNorm2d", args: ["conv1"], shape: [64, 56, 56], params: 128 },
    { name: "relu", op: "call_module", target: "relu", moduleType: "ReLU", args: ["bn1"], shape: [64, 56, 56] },
    { name: "conv2", op: "call_module", target: "conv2", moduleType: "Conv2d", args: ["relu"], shape: [64, 56, 56], params: 36864 },
    { name: "add", op: "call_function", target: "<built-in function add>", args: ["conv2", "x"], shape: [64, 56, 56] },
  ], { name: "BasicBlock" });

  const plot = new Plot(el, { theme: "dark", border: "#0b1220", hover: false });
  addModelGraph(plot, {
    graph,
    direction: "horizontal",
    nodeWidth: 3, nodeHeight: 1.4, rankGap: 0.8,
    sizeBy: "params",
    labelFont: "600 11px system-ui, sans-serif",
    subLabelFont: "9px system-ui, sans-serif",
  });
  return () => plot.destroy();
};
