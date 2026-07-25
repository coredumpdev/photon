/** The 2D graph with `slices: "channels"` — each layer becomes a stack of cards. */
import { Plot, addModelGraph, sequentialModel } from "@photonviz/core";

export default (el: HTMLElement) => {
  const cnn = sequentialModel([
    { name: "input", type: "Input", shape: [3, 224, 224] },
    { name: "conv1", type: "Conv2d", shape: [8, 112, 112], params: 1792 },
    { name: "pool1", type: "MaxPool2d", shape: [8, 56, 56] },
    { name: "conv2", type: "Conv2d", shape: [16, 56, 56], params: 73856 },
    { name: "fc", type: "Linear", shape: [10], params: 2570 },
  ], "SlicedCNN");

  const plot = new Plot(el, { theme: "dark", border: "#0b1220", hover: false });
  addModelGraph(plot, {
    graph: cnn,
    direction: "horizontal",
    slices: "channels",
    maxSlices: 10,
    nodeWidth: 2.8, nodeHeight: 1.3, rankGap: 1.1,
    labelFont: "600 11px system-ui, sans-serif",
    subLabelFont: "9px system-ui, sans-serif",
  });
  return () => plot.destroy();
};
