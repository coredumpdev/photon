import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatShape,
  layerCategory,
  mlpModel,
  modelBoxDims,
  modelGraphFromKeras,
  modelGraphFromOnnx,
  modelGraphFromSklearn,
  modelGraphFromTorchFx,
  modelLayout,
  sequentialModel,
  type ModelGraph,
} from "../src/ml/model.js";

/** A tiny residual block: stem → conv → bn → relu → add(stem) → pool. */
const resnetish: ModelGraph = {
  name: "block",
  nodes: [
    { id: "stem", type: "Conv2d", shape: [64, 56, 56], params: 9408 },
    { id: "conv", type: "Conv2d", shape: [64, 56, 56], params: 36864 },
    { id: "bn", type: "BatchNorm2d", shape: [64, 56, 56], params: 128 },
    { id: "relu", type: "ReLU", shape: [64, 56, 56] },
    { id: "add", type: "Add", shape: [64, 56, 56] },
    { id: "pool", type: "AdaptiveAvgPool2d", shape: [64, 1, 1] },
  ],
  edges: [
    { from: "stem", to: "conv" },
    { from: "conv", to: "bn" },
    { from: "bn", to: "relu" },
    { from: "relu", to: "add" },
    { from: "stem", to: "add" },
    { from: "add", to: "pool" },
  ],
};

describe("layer categories", () => {
  it("maps common PyTorch / ONNX / Keras op names to families", () => {
    expect(layerCategory("Conv2d")).toBe("conv");
    expect(layerCategory("ConvTranspose2d")).toBe("conv"); // not "reshape"
    expect(layerCategory("BatchNorm2d")).toBe("norm");
    expect(layerCategory("LayerNormalization")).toBe("norm");
    expect(layerCategory("MaxPool2d")).toBe("pool");
    expect(layerCategory("AdaptiveAvgPool2d")).toBe("pool");
    expect(layerCategory("ReLU")).toBe("activation");
    expect(layerCategory("Softmax")).toBe("activation");
    expect(layerCategory("Linear")).toBe("linear");
    expect(layerCategory("Gemm")).toBe("linear");
    expect(layerCategory("MultiheadAttention")).toBe("attention"); // not "merge" via "mul"
    expect(layerCategory("Concat")).toBe("merge");
    expect(layerCategory("Flatten")).toBe("reshape");
    expect(layerCategory("InputLayer")).toBe("input");
    expect(layerCategory("RandomForestClassifier")).toBe("other");
  });
});

describe("formatting", () => {
  it("formatCount abbreviates with one decimal below 10", () => {
    expect(formatCount(512)).toBe("512");
    expect(formatCount(9408)).toBe("9.4K");
    expect(formatCount(25_000_000)).toBe("25M");
    expect(formatCount(1_500_000_000)).toBe("1.5B");
  });

  it("formatShape joins dims, blank when absent", () => {
    expect(formatShape([64, 112, 112])).toBe("64×112×112");
    expect(formatShape()).toBe("");
    expect(formatShape([])).toBe("");
  });
});

describe("adapters", () => {
  it("sequentialModel chains layers and de-duplicates ids", () => {
    const g = sequentialModel([
      { type: "Conv2d", name: "conv" },
      { type: "ReLU", name: "act" },
      { type: "ReLU", name: "act" },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(["conv", "act", "act_1"]);
    expect(g.edges).toEqual([{ from: "conv", to: "act" }, { from: "act", to: "act_1" }]);
  });

  it("torch.fx: keeps skip connections, drops get_attr, prefers moduleType", () => {
    const g = modelGraphFromTorchFx([
      { name: "x", op: "placeholder" },
      { name: "w", op: "get_attr", target: "conv.weight" },
      { name: "conv", op: "call_module", target: "conv", moduleType: "Conv2d", args: ["x", "w"] },
      { name: "add", op: "call_function", target: "<built-in function add>", args: ["conv", "x"] },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(["x", "conv", "add"]); // get_attr dropped
    expect(g.nodes[1]!.type).toBe("Conv2d");
    expect(g.nodes[2]!.type).toBe("add"); // "<built-in function add>" shortened
    expect(g.edges).toEqual([
      { from: "x", to: "conv" }, // the get_attr arg produced no edge
      { from: "conv", to: "add" },
      { from: "x", to: "add" },
    ]);
  });

  it("onnx: wires nodes through tensor names and folds weights into params", () => {
    const g = modelGraphFromOnnx(
      {
        node: [
          { name: "c1", opType: "Conv", input: ["data", "W1"], output: ["t1"] },
          { name: "r1", opType: "Relu", input: ["t1"], output: ["t2"] },
        ],
        input: [{ name: "data" }, { name: "W1" }],
        initializer: [{ name: "W1" }],
      },
      { shapes: { t1: [16, 32, 32] }, paramCounts: { W1: 432 } },
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["data", "c1", "r1"]);
    expect(g.nodes[0]!.type).toBe("Input"); // weights are not graph inputs
    expect(g.nodes[1]!.params).toBe(432);
    expect(g.nodes[1]!.shape).toEqual([16, 32, 32]);
    expect(g.edges).toEqual([{ from: "data", to: "c1" }, { from: "c1", to: "r1" }]);
  });

  it("keras: chains a Sequential config that has no inbound_nodes", () => {
    const g = modelGraphFromKeras({
      class_name: "Sequential",
      config: {
        name: "mnist",
        layers: [
          { class_name: "InputLayer", config: { name: "in", batch_input_shape: [null, 28, 28, 1] } },
          { class_name: "Conv2D", config: { name: "c1" } },
          { class_name: "Dense", config: { name: "d1" } },
        ],
      },
    }, { shapes: { d1: [10] }, params: { d1: 1290 } });
    expect(g.name).toBe("mnist");
    expect(g.nodes[0]!.shape).toEqual([28, 28, 1]); // batch dim dropped
    expect(g.nodes[2]!.params).toBe(1290);
    expect(g.edges).toEqual([{ from: "in", to: "c1" }, { from: "c1", to: "d1" }]);
  });

  it("keras: wires a functional model from either inbound_nodes format", () => {
    const g = modelGraphFromKeras({
      class_name: "Functional",
      config: {
        layers: [
          { class_name: "InputLayer", config: { name: "in" } },
          // Keras 2 nesting.
          { class_name: "Conv2D", config: { name: "c1" }, inbound_nodes: [[["in", 0, 0, {}]]] },
          // Keras 3 nesting.
          {
            class_name: "Add",
            config: { name: "add" },
            inbound_nodes: [{
              args: [
                { class_name: "__keras_tensor__", config: { keras_history: ["c1", 0, 0] } },
                { class_name: "__keras_tensor__", config: { keras_history: ["in", 0, 0] } },
              ],
            }],
          },
        ],
      },
    });
    expect(g.edges).toEqual([
      { from: "in", to: "c1" },
      { from: "c1", to: "add" },
      { from: "in", to: "add" },
    ]);
  });

  it("sklearn: parallel branches fan out from and back into the sequential trunk", () => {
    const g = modelGraphFromSklearn({
      name: "pipe",
      type: "Pipeline",
      steps: [
        {
          name: "prep",
          type: "ColumnTransformer",
          mode: "parallel",
          steps: [
            { name: "num", type: "StandardScaler", columns: ["age"] },
            { name: "cat", type: "OneHotEncoder", columns: ["city"] },
          ],
        },
        { name: "clf", type: "RandomForestClassifier" },
      ],
    });
    expect(g.nodes.map((n) => n.id)).toEqual(["pipe.prep.num", "pipe.prep.cat", "pipe.clf"]);
    expect(g.nodes[0]!.name).toBe("num [age]");
    expect(g.edges).toEqual([
      { from: "pipe.prep.num", to: "pipe.clf" },
      { from: "pipe.prep.cat", to: "pipe.clf" },
    ]);
  });

  it("mlpModel: dense stack with in×out+out parameter counts", () => {
    const g = mlpModel([4, 8, 3], { outputActivation: "Softmax" });
    expect(g.nodes.map((n) => n.type)).toEqual(["Input", "Linear", "ReLU", "Linear", "Softmax"]);
    expect(g.nodes[1]!.params).toBe(4 * 8 + 8);
    expect(g.nodes[3]!.params).toBe(8 * 3 + 3);
    expect(g.edges).toHaveLength(4);
  });
});

describe("modelLayout", () => {
  it("ranks by longest path, so a skip target waits for its deepest input", () => {
    const l = modelLayout(resnetish);
    const rank = new Map(l.nodes.map((b) => [b.node.id, b.rank]));
    expect(rank.get("stem")).toBe(0);
    expect(rank.get("relu")).toBe(3);
    // `add` has inputs at rank 0 and rank 3 — longest path wins.
    expect(rank.get("add")).toBe(4);
    expect(rank.get("pool")).toBe(5);
    expect(l.ranks).toBe(6);
  });

  it("boxes within a rank never overlap and stay centered", () => {
    const l = modelLayout({
      nodes: [
        { id: "a", type: "Input" },
        { id: "b", type: "Conv2d" },
        { id: "c", type: "Conv2d" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }],
    }, { nodeWidth: 2, nodeGap: 0.5 });
    const rank1 = l.nodes.filter((b) => b.rank === 1).sort((p, q) => p.x - q.x);
    expect(rank1).toHaveLength(2);
    const gap = (rank1[1]!.x - rank1[1]!.w / 2) - (rank1[0]!.x + rank1[0]!.w / 2);
    expect(gap).toBeCloseTo(0.5, 10);
    expect(rank1[0]!.x + rank1[1]!.x).toBeCloseTo(0, 10); // centered on x = 0
  });

  it("routes edges from box edge to box edge, with a bypass lane for skips", () => {
    const l = modelLayout(resnetish, { nodeHeight: 1, rankGap: 0.5 });
    const box = new Map(l.nodes.map((b) => [b.node.id, b]));
    const direct = l.edges.find((e) => e.from === "conv" && e.to === "bn")!;
    expect(direct.points[0]!.y).toBeCloseTo(box.get("conv")!.y - 0.5, 10);
    expect(direct.points[direct.points.length - 1]!.y).toBeCloseTo(box.get("bn")!.y + 0.5, 10);
    // stem → add spans 4 ranks, so it detours around the trunk.
    const skip = l.edges.find((e) => e.from === "stem" && e.to === "add")!;
    expect(skip.points).toHaveLength(6);
    const laneX = Math.max(...skip.points.map((p) => p.x));
    expect(laneX).toBeGreaterThan(box.get("stem")!.x + box.get("stem")!.w / 2);
  });

  it("lays out horizontally and covers every box in the extent", () => {
    const l = modelLayout(resnetish, { direction: "horizontal" });
    const ranked = l.nodes.filter((b) => b.rank === 0)[0]!;
    expect(ranked.x).toBeCloseTo(0, 10);
    expect(l.nodes.find((b) => b.node.id === "pool")!.x).toBeGreaterThan(ranked.x);
    for (const b of l.nodes) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(l.extent.x[0] - 1e-9);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(l.extent.x[1] + 1e-9);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(l.extent.y[0] - 1e-9);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(l.extent.y[1] + 1e-9);
    }
  });

  it("scales boxes by a metric when sizeBy is set", () => {
    const g: ModelGraph = {
      nodes: [{ id: "a", type: "Linear", params: 1 }, { id: "b", type: "Linear", params: 1e6 }],
      edges: [{ from: "a", to: "b" }],
    };
    const l = modelLayout(g, { sizeBy: "params", nodeWidth: 2, sizeRange: [0.5, 1.5] });
    const [a, b] = [l.nodes[0]!, l.nodes[1]!];
    expect(b.w).toBeCloseTo(3, 10); // the max metric hits the top of the range
    expect(a.w).toBeGreaterThan(1);
    expect(a.w).toBeLessThan(b.w);
  });

  it("survives a cycle instead of throwing", () => {
    const l = modelLayout({
      nodes: [{ id: "a", type: "RNN" }, { id: "b", type: "RNN" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    });
    expect(l.nodes).toHaveLength(2);
    expect(l.edges).toHaveLength(2);
  });

  it("returns an empty layout for an empty graph", () => {
    const l = modelLayout({ nodes: [], edges: [] });
    expect(l.nodes).toEqual([]);
    expect(l.ranks).toBe(0);
  });
});

describe("modelBoxDims", () => {
  it("folds leading dims into thickness and normalizes to the maxima", () => {
    const dims = modelBoxDims(
      [
        { id: "a", type: "Conv2d", shape: [64, 112, 112] },
        { id: "b", type: "Conv2d", shape: [512, 7, 7] },
      ],
      { maxThickness: 1, maxFace: 2, sizeScale: "log" },
    );
    // The deepest layer is the thickest; the largest feature map is the widest face.
    expect(dims[1]![0]).toBeCloseTo(1, 10);
    expect(dims[0]![0]).toBeLessThan(dims[1]![0]);
    expect(dims[0]![1]).toBeCloseTo(2, 10);
    expect(dims[1]![1]).toBeLessThan(dims[0]![1]);
  });

  it("draws a 1-D layer beside feature maps as a thin tall plate", () => {
    const dims = modelBoxDims(
      [{ id: "a", type: "Conv2d", shape: [64, 112, 112] }, { id: "b", type: "Linear", shape: [512] }],
      { maxThickness: 1, maxFace: 2, minSize: 0.1 },
    );
    // The vector has no channel or width dim, so both are floored…
    expect(dims[1]![0]).toBeCloseTo(0.1, 10);
    expect(dims[1]![2]).toBeCloseTo(0.1, 10);
    // …while 512 units make it the tallest block in the model.
    expect(dims[1]![1]).toBeCloseTo(2, 10);
    expect(dims[0]![1]).toBeLessThan(dims[1]![1]);
    expect(dims[0]![2]).toBeCloseTo(2, 10);
  });

  it("falls back to uniform blocks when no shape carries information", () => {
    const dims = modelBoxDims(
      [{ id: "a", type: "Dropout" }, { id: "b", type: "StandardScaler" }],
      { maxThickness: 1, maxFace: 2 },
    );
    for (const d of dims) {
      expect(d[0]).toBeCloseTo(1, 10);
      expect(d[1]).toBeCloseTo(2, 10);
      expect(d[2]).toBeCloseTo(2, 10);
    }
  });
});
