/** `slices: "voxels"` — a real channels × height × width grid of cubes per layer. */
import { Plot3D, addModelGraph3D, sequentialModel } from "@photonviz/core";

export default (el: HTMLElement) => {
  const cnn = sequentialModel([
    { name: "input", type: "Input", shape: [3, 24, 24] },
    { name: "conv1", type: "Conv2d", shape: [8, 12, 12], params: 1792 },
    { name: "pool1", type: "MaxPool2d", shape: [8, 6, 6] },
    { name: "fc", type: "Linear", shape: [10], params: 2570 },
  ], "VoxelCNN");

  const plot = new Plot3D(el, {
    background: [0.04, 0.06, 0.13, 1],
    aspectMode: "data",
    projection: "orthographic",
    showAxes: false,
    gridPlanes: false,
    azimuth: 0.62, elevation: 0.34, distance: 2.4,
    downloadButton: false,
  });
  // maxSlices bounds each axis; maxVoxels bounds the product. Both are generous
  // here because the tensors are small — a 224×224 layer needs far more.
  addModelGraph3D(plot, {
    graph: cnn,
    slices: "voxels",
    maxSlices: 24,
    maxVoxels: 30_000,
    rankSpacing: 1.1,
    maxFace: 2.2,
    labels: "name",
  });
  return () => plot.destroy();
};
