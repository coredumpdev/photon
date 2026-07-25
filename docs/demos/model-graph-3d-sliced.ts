/** The same model with `slices: "channels"` — each block becomes feature planes. */
import { Plot3D, addModelGraph3D, sequentialModel } from "@photonviz/core";

export default (el: HTMLElement) => {
  const cnn = sequentialModel([
    { name: "input", type: "Input", shape: [3, 224, 224] },
    { name: "conv1", type: "Conv2d", shape: [8, 112, 112], params: 1792 },
    { name: "pool1", type: "MaxPool2d", shape: [8, 56, 56] },
    { name: "conv2", type: "Conv2d", shape: [16, 56, 56], params: 73856 },
    { name: "gap", type: "AdaptiveAvgPool2d", shape: [16, 1, 1] },
    { name: "fc", type: "Linear", shape: [10], params: 2570 },
  ], "SlicedCNN");

  const plot = new Plot3D(el, {
    background: [0.04, 0.06, 0.13, 1],
    aspectMode: "data",
    projection: "orthographic",
    showAxes: false,
    gridPlanes: false,
    azimuth: 0.5, elevation: 0.28, distance: 1.95,
    downloadButton: false,
  });
  // The input's 3 channels draw as 3 planes; deeper layers cap at maxSlices.
  addModelGraph3D(plot, {
    graph: cnn,
    slices: "channels",
    maxSlices: 16,
    rankSpacing: 0.85,
    maxFace: 2.3,
    labels: "full",
  });
  return () => plot.destroy();
};
