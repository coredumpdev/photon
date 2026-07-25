/** Each layer as a cuboid sized from its output tensor: maps shrink, depth grows. */
import { Plot3D, addModelGraph3D, sequentialModel } from "@photonviz/core";

export default (el: HTMLElement) => {
  const cnn = sequentialModel([
    { name: "input", type: "Input", shape: [3, 224, 224] },
    { name: "conv1", type: "Conv2d", shape: [64, 112, 112], params: 1792 },
    { name: "pool1", type: "MaxPool2d", shape: [64, 56, 56] },
    { name: "conv2", type: "Conv2d", shape: [128, 56, 56], params: 73856 },
    { name: "pool2", type: "MaxPool2d", shape: [128, 28, 28] },
    { name: "conv3", type: "Conv2d", shape: [256, 28, 28], params: 295168 },
    { name: "gap", type: "AdaptiveAvgPool2d", shape: [256, 1, 1] },
    { name: "fc", type: "Linear", shape: [1000], params: 257000 },
  ], "TinyVGG");

  const plot = new Plot3D(el, {
    background: [0.04, 0.06, 0.13, 1],
    // A long chain needs proportional scaling and a parallel camera.
    aspectMode: "data",
    projection: "orthographic",
    showAxes: false,
    gridPlanes: false,
    azimuth: 0.45, elevation: 0.3, distance: 0.95,
    downloadButton: false,
  });
  addModelGraph3D(plot, { graph: cnn, rankSpacing: 0.45, maxFace: 2.3, labels: "full" });
  return () => plot.destroy();
};
