/**
 * Model-architecture graphs: a framework-agnostic description of a neural
 * network's layers, adapters that build one from PyTorch / ONNX exports, and a
 * layered-DAG layout shared by the 2D and 3D renderers (`ml/model-chart.ts`).
 *
 * Everything here is pure (array in → array out) and unit-tested; nothing
 * touches WebGL or the DOM.
 */
import type { Range } from "../types.js";

// --- Data model --------------------------------------------------------------

/** One layer / op in a model graph. */
export interface ModelNode {
  /** Unique id — a module path (`features.0`), an fx node name, or a tensor name. */
  id: string;
  /** Display name. Defaults to `id`. */
  name?: string;
  /** Layer or op class: `"Conv2d"`, `"Linear"`, `"ReLU"`, `"Add"`, … */
  type: string;
  /** Output tensor shape with the batch dim dropped, e.g. `[64, 112, 112]`. */
  shape?: number[];
  /** Trainable parameter count. */
  params?: number;
  /** Multiply-accumulates / FLOPs, if known. */
  flops?: number;
  /** Block or stage the layer belongs to (`"layer1"`, `"encoder.3"`, …). */
  group?: string;
}

/** A directed connection (activation tensor) between two {@link ModelNode}s. */
export interface ModelEdge {
  from: string;
  to: string;
  label?: string;
}

/** A model architecture as a directed acyclic graph of layers. */
export interface ModelGraph {
  name?: string;
  nodes: ModelNode[];
  edges: ModelEdge[];
}

// --- Layer categories + palette ----------------------------------------------

/** Coarse layer families, used to color a diagram consistently. */
export type LayerCategory =
  | "input"
  | "conv"
  | "linear"
  | "norm"
  | "activation"
  | "pool"
  | "dropout"
  | "attention"
  | "embedding"
  | "recurrent"
  | "reshape"
  | "merge"
  | "output"
  | "other";

/** Default category → color. Tuned to read on both dark and light backgrounds. */
export const LAYER_COLORS: Record<LayerCategory, string> = {
  input: "#94a3b8",
  conv: "#60a5fa",
  linear: "#a78bfa",
  norm: "#34d399",
  activation: "#fbbf24",
  pool: "#22d3ee",
  dropout: "#64748b",
  attention: "#f472b6",
  embedding: "#c084fc",
  recurrent: "#fb923c",
  reshape: "#7dd3fc",
  merge: "#f87171",
  output: "#94a3b8",
  other: "#8ba3c7",
};

/**
 * Substring rules, checked in order — the first match wins, so more specific
 * families come first (`ConvTranspose2d` is a conv, not a reshape).
 */
const CATEGORY_RULES: ReadonlyArray<readonly [LayerCategory, readonly string[]]> = [
  ["input", ["input", "placeholder"]],
  ["output", ["output"]],
  ["conv", ["conv"]],
  ["attention", ["attention", "attn", "multihead", "mha"]],
  ["recurrent", ["lstm", "gru", "rnn"]],
  ["embedding", ["embed"]],
  ["norm", ["norm"]],
  ["pool", ["pool", "upsample", "interpolate", "resize"]],
  ["dropout", ["dropout"]],
  ["linear", ["linear", "dense", "gemm", "matmul", "fc"]],
  ["activation", [
    "relu", "gelu", "silu", "swish", "sigmoid", "tanh", "softmax", "softplus",
    "elu", "mish", "hardswish", "glu", "activation",
  ]],
  ["merge", ["concat", "cat", "add", "mul", "sum", "residual"]],
  ["reshape", ["flatten", "reshape", "view", "permute", "transpose", "squeeze"]],
];

/** Classify a layer/op type string (`"Conv2d"`, `"aten::relu"`) into a family. */
export function layerCategory(type: string): LayerCategory {
  const t = type.toLowerCase();
  for (const [category, keys] of CATEGORY_RULES) {
    for (const key of keys) if (t.includes(key)) return category;
  }
  return "other";
}

// --- Formatting helpers ------------------------------------------------------

/** `9408` → `"9.4K"`, `2.5e7` → `"25M"`. Used for parameter / FLOP counts. */
export function formatCount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1e3) return String(Math.round(n));
  const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      const v = n / scale;
      return `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}${suffix}`;
    }
  }
  return String(n);
}

/** `[64, 112, 112]` → `"64×112×112"`; empty/absent → `""`. */
export function formatShape(shape?: number[]): string {
  return shape && shape.length ? shape.join("×") : "";
}

// --- Adapters ----------------------------------------------------------------

/** A layer in a straight-line model; `id` is derived when omitted. */
export interface SequentialLayer extends Omit<ModelNode, "id"> {
  id?: string;
}

/** Ensure ids are unique, suffixing duplicates (`relu`, `relu_1`, …). */
function uniqueId(base: string, seen: Set<string>): string {
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let i = 1;
  while (seen.has(`${base}_${i}`)) i++;
  const id = `${base}_${i}`;
  seen.add(id);
  return id;
}

/**
 * Build a straight-line graph from an ordered layer list — the one-liner path
 * from `model.named_modules()` / `torchinfo.summary()`. Consecutive layers are
 * connected automatically.
 */
export function sequentialModel(layers: SequentialLayer[], name?: string): ModelGraph {
  const seen = new Set<string>();
  const nodes: ModelNode[] = layers.map((l, i) => ({
    ...l,
    id: uniqueId(l.id ?? l.name ?? `${l.type}_${i}`, seen),
  }));
  const edges: ModelEdge[] = [];
  for (let i = 1; i < nodes.length; i++) edges.push({ from: nodes[i - 1]!.id, to: nodes[i]!.id });
  return { name, nodes, edges };
}

/**
 * One node of a traced `torch.fx` graph. Produce it in Python with:
 *
 * ```python
 * gm = torch.fx.symbolic_trace(model)
 * [{"name": n.name, "op": n.op, "target": str(n.target),
 *   "args": [a.name for a in n.all_input_nodes]} for n in gm.graph.nodes]
 * ```
 */
export interface TorchFxNode {
  name: string;
  /** `placeholder` | `call_module` | `call_function` | `call_method` | `get_attr` | `output`. */
  op: string;
  /** Module path or function name. */
  target?: string;
  /** Names of the input nodes (`[a.name for a in n.all_input_nodes]`). */
  args?: string[];
  /** `type(module).__name__` for `call_module` nodes — the nicest display type. */
  moduleType?: string;
  shape?: number[];
  params?: number;
  flops?: number;
}

/** `"torch.nn.functional.relu"` / `"<built-in function add>"` → `"relu"` / `"add"`. */
function shortTarget(target: string): string {
  const fn = /<built-in (?:function|method) ([^>]+)>/.exec(target);
  const raw = fn ? fn[1]! : target;
  const parts = raw.split(".");
  return parts[parts.length - 1]!.trim() || raw;
}

/** Options shared by the graph adapters. */
export interface AdapterOptions {
  name?: string;
  /** fx ops to drop before building the graph. Default `["get_attr"]`. */
  skipOps?: string[];
}

/** Build a {@link ModelGraph} from traced `torch.fx` nodes (keeps skip connections). */
export function modelGraphFromTorchFx(nodes: TorchFxNode[], opts: AdapterOptions = {}): ModelGraph {
  const skip = new Set(opts.skipOps ?? ["get_attr"]);
  const kept = nodes.filter((n) => !skip.has(n.op));
  const known = new Set(kept.map((n) => n.name));
  const out: ModelNode[] = kept.map((n) => ({
    id: n.name,
    name: n.op === "call_module" ? (n.target ?? n.name) : n.name,
    type: n.moduleType ?? (n.target ? shortTarget(n.target) : n.op),
    ...(n.shape ? { shape: n.shape } : {}),
    ...(n.params != null ? { params: n.params } : {}),
    ...(n.flops != null ? { flops: n.flops } : {}),
  }));
  const edges: ModelEdge[] = [];
  for (const n of kept) {
    for (const a of n.args ?? []) if (known.has(a)) edges.push({ from: a, to: n.name });
  }
  return { name: opts.name, nodes: out, edges };
}

/** A node of an ONNX graph, as produced by `MessageToDict(model.graph)`. */
export interface OnnxNode {
  name?: string;
  opType: string;
  input?: string[];
  output?: string[];
}

/** An ONNX graph dict: `MessageToDict(onnx.load(path).graph)`. */
export interface OnnxGraph {
  name?: string;
  node: OnnxNode[];
  input?: Array<{ name: string }>;
  output?: Array<{ name: string }>;
  /** Initializers (weights) — their names are excluded from the edge set. */
  initializer?: Array<{ name: string }>;
}

/** ONNX adapter options: tensor shapes are supplied separately (shape inference is optional in ONNX). */
export interface OnnxAdapterOptions extends AdapterOptions {
  /** Tensor name → shape (batch dim already dropped), for node output shapes. */
  shapes?: Record<string, number[]>;
  /** Tensor name → element count, to attribute weights to their consuming op. */
  paramCounts?: Record<string, number>;
}

/**
 * Build a {@link ModelGraph} from an ONNX graph dict — the framework-neutral
 * path (works for models exported from PyTorch, TensorFlow, JAX, sklearn…).
 * Edges are recovered by matching each node's inputs to the node that produced
 * them; weights (initializers) are folded into the consuming node's `params`.
 */
export function modelGraphFromOnnx(graph: OnnxGraph, opts: OnnxAdapterOptions = {}): ModelGraph {
  const initializers = new Set((graph.initializer ?? []).map((i) => i.name));
  const shapes = opts.shapes ?? {};
  const paramCounts = opts.paramCounts ?? {};

  const nodes: ModelNode[] = [];
  const seen = new Set<string>();
  /** Tensor name → id of the node that produces it. */
  const producer = new Map<string, string>();

  for (const gi of graph.input ?? []) {
    if (initializers.has(gi.name)) continue; // a weight, not a real graph input
    const id = uniqueId(gi.name, seen);
    nodes.push({
      id,
      name: gi.name,
      type: "Input",
      ...(shapes[gi.name] ? { shape: shapes[gi.name]! } : {}),
    });
    producer.set(gi.name, id);
  }

  for (let i = 0; i < graph.node.length; i++) {
    const n = graph.node[i]!;
    const id = uniqueId(n.name || `${n.opType}_${i}`, seen);
    const outName = n.output?.[0];
    let params = 0;
    for (const inp of n.input ?? []) if (initializers.has(inp)) params += paramCounts[inp] ?? 0;
    nodes.push({
      id,
      name: n.name || n.opType,
      type: n.opType,
      ...(outName && shapes[outName] ? { shape: shapes[outName]! } : {}),
      ...(params > 0 ? { params } : {}),
    });
    for (const o of n.output ?? []) producer.set(o, id);
  }

  const edges: ModelEdge[] = [];
  for (let i = 0; i < graph.node.length; i++) {
    const n = graph.node[i]!;
    const to = producer.get(n.output?.[0] ?? "");
    if (!to) continue;
    for (const inp of n.input ?? []) {
      if (initializers.has(inp)) continue;
      const from = producer.get(inp);
      if (from && from !== to) edges.push({ from, to });
    }
  }
  return { name: opts.name ?? graph.name, nodes, edges };
}

/** Recursively collect any string that names a known layer (format-agnostic wiring scan). */
function collectNames(value: unknown, known: Set<string>, out: Set<string>): void {
  if (typeof value === "string") {
    if (known.has(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNames(v, known, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNames(v, known, out);
  }
}

/** One layer of a Keras config (`json.loads(model.to_json())`). */
export interface KerasLayerConfig {
  class_name: string;
  name?: string;
  config?: Record<string, unknown>;
  /**
   * Functional-API wiring. Keras 2 nests `[["conv1", 0, 0, {}]]` and Keras 3
   * nests `keras_history` — both are handled by scanning for known layer names.
   */
  inbound_nodes?: unknown;
}

/** A Keras model config: `json.loads(model.to_json())`. */
export interface KerasModelConfig {
  /** `"Sequential"` | `"Functional"` | `"Model"`. */
  class_name?: string;
  config?: { name?: string; layers?: KerasLayerConfig[] };
  /** Some exports hoist the layer list to the top level. */
  layers?: KerasLayerConfig[];
}

/** Keras adapter options — output shapes come from `[l.output_shape for l in model.layers]`. */
export interface KerasAdapterOptions extends AdapterOptions {
  /** Layer name → output shape (batch dim already dropped). */
  shapes?: Record<string, number[]>;
  /** Layer name → parameter count (`l.count_params()`). */
  params?: Record<string, number>;
}

/**
 * Build a {@link ModelGraph} from a TensorFlow / Keras model config. Sequential
 * models chain in declaration order; functional models are wired from each
 * layer's `inbound_nodes`, so multi-input and residual topologies survive.
 */
export function modelGraphFromKeras(
  model: KerasModelConfig,
  opts: KerasAdapterOptions = {},
): ModelGraph {
  const layers = model.config?.layers ?? model.layers ?? [];
  const shapes = opts.shapes ?? {};
  const params = opts.params ?? {};
  const seen = new Set<string>();
  const names = layers.map((l, i) =>
    uniqueId((l.config?.name as string | undefined) ?? l.name ?? `${l.class_name}_${i}`, seen),
  );
  const known = new Set(names);

  const nodes: ModelNode[] = layers.map((l, i) => {
    const id = names[i]!;
    // The input layer often carries the only shape a bare config knows about.
    const batchShape = (l.config?.batch_input_shape ?? l.config?.batch_shape) as
      | Array<number | null>
      | undefined;
    const inferred = batchShape
      ? batchShape.slice(1).filter((v): v is number => typeof v === "number")
      : undefined;
    const shape = shapes[id] ?? (inferred && inferred.length ? inferred : undefined);
    return {
      id,
      name: id,
      type: l.class_name,
      ...(shape ? { shape } : {}),
      ...(params[id] != null ? { params: params[id]! } : {}),
    };
  });

  const inbound = layers.map((l) => {
    const out = new Set<string>();
    collectNames(l.inbound_nodes, known, out);
    return out;
  });
  const wired = inbound.some((s) => s.size > 0);

  const edges: ModelEdge[] = [];
  if (wired) {
    for (let i = 0; i < layers.length; i++) {
      for (const from of inbound[i]!) if (from !== names[i]) edges.push({ from, to: names[i]! });
    }
  } else {
    for (let i = 1; i < names.length; i++) edges.push({ from: names[i - 1]!, to: names[i]! });
  }
  return { name: opts.name ?? model.config?.name, nodes, edges };
}

/**
 * A scikit-learn estimator as a tree of steps. Leaves are estimators; `steps`
 * makes a composite — a `Pipeline` (`mode: "sequential"`) or a
 * `FeatureUnion` / `ColumnTransformer` (`mode: "parallel"`).
 */
export interface SklearnStep {
  /** Step name (`"scaler"`, `"clf"`, …). */
  name: string;
  /** Estimator class: `"StandardScaler"`, `"RandomForestClassifier"`, … */
  type: string;
  /** Child steps of a composite estimator. */
  steps?: SklearnStep[];
  /** How the children combine. Default `"sequential"`. */
  mode?: "sequential" | "parallel";
  /** Output feature count / shape, if known. */
  shape?: number[];
  /** Fitted parameter count, if known. */
  params?: number;
  /** Columns a `ColumnTransformer` branch operates on (shown in the label). */
  columns?: string[];
}

/** Entry / exit ids of a laid-out subtree, used to splice composites together. */
interface SubGraph {
  entries: string[];
  exits: string[];
}

/**
 * Build a {@link ModelGraph} from a scikit-learn `Pipeline` /
 * `ColumnTransformer` / `FeatureUnion` tree: sequential steps chain, parallel
 * branches fan out from the previous step and fan back in to the next one.
 */
export function modelGraphFromSklearn(root: SklearnStep, opts: AdapterOptions = {}): ModelGraph {
  const nodes: ModelNode[] = [];
  const edges: ModelEdge[] = [];
  const seen = new Set<string>();

  const walk = (step: SklearnStep, path: string): SubGraph => {
    const id = uniqueId(path ? `${path}.${step.name}` : step.name, seen);
    if (!step.steps || step.steps.length === 0) {
      const label = step.columns?.length ? `${step.name} [${step.columns.join(", ")}]` : step.name;
      nodes.push({
        id,
        name: label,
        type: step.type,
        ...(step.shape ? { shape: step.shape } : {}),
        ...(step.params != null ? { params: step.params } : {}),
        ...(path ? { group: path } : {}),
      });
      return { entries: [id], exits: [id] };
    }
    const childPath = path ? `${path}.${step.name}` : step.name;
    const children = step.steps.map((child) => walk(child, childPath));
    if ((step.mode ?? "sequential") === "parallel") {
      return {
        entries: children.flatMap((c) => c.entries),
        exits: children.flatMap((c) => c.exits),
      };
    }
    for (let i = 1; i < children.length; i++) {
      for (const from of children[i - 1]!.exits) {
        for (const to of children[i]!.entries) edges.push({ from, to });
      }
    }
    return { entries: children[0]!.entries, exits: children[children.length - 1]!.exits };
  };

  walk(root, "");
  return { name: opts.name ?? root.name, nodes, edges };
}

/** Options for {@link mlpModel}. */
export interface MlpOptions {
  /** Activation inserted between dense layers. Default `"ReLU"`; `""` omits it. */
  activation?: string;
  /** Activation after the final layer (`"Softmax"`, `"Sigmoid"`, …). */
  outputActivation?: string;
  name?: string;
}

/**
 * A dense feed-forward net from its layer sizes — the shape a scikit-learn
 * `MLPClassifier` reports as `[n_features, *hidden_layer_sizes, n_outputs]`.
 * Parameter counts are computed as `in × out + out`.
 */
export function mlpModel(layerSizes: number[], opts: MlpOptions = {}): ModelGraph {
  const activation = opts.activation ?? "ReLU";
  const layers: SequentialLayer[] = [];
  if (layerSizes.length === 0) return { name: opts.name, nodes: [], edges: [] };
  layers.push({ id: "input", name: "input", type: "Input", shape: [layerSizes[0]!] });
  for (let i = 1; i < layerSizes.length; i++) {
    const nIn = layerSizes[i - 1]!;
    const nOut = layerSizes[i]!;
    const last = i === layerSizes.length - 1;
    layers.push({
      id: `dense_${i}`,
      name: last ? "output" : `dense_${i}`,
      type: "Linear",
      shape: [nOut],
      params: nIn * nOut + nOut,
    });
    const act = last ? opts.outputActivation : activation;
    if (act) layers.push({ id: `${act.toLowerCase()}_${i}`, type: act, shape: [nOut] });
  }
  return sequentialModel(layers, opts.name);
}

// --- Layered DAG layout ------------------------------------------------------

export interface ModelLayoutOptions {
  /** Flow direction: `"vertical"` top→bottom (default) or `"horizontal"` left→right. */
  direction?: "vertical" | "horizontal";
  /** Box width in data units. Default 2.6. */
  nodeWidth?: number;
  /** Box height in data units. Default 0.9. */
  nodeHeight?: number;
  /** Gap between consecutive ranks. Default 0.7. */
  rankGap?: number;
  /** Gap between siblings inside a rank. Default 0.6. */
  nodeGap?: number;
  /**
   * Scale the box across the flow (width when vertical, height when horizontal)
   * by a metric, so heavy layers read as bigger. Default `"none"`.
   */
  sizeBy?: "none" | "params" | "flops";
  /** Multiplier range applied when `sizeBy` is set. Default `[0.55, 1.5]`. */
  sizeRange?: Range;
  /** Barycenter passes used to reduce edge crossings. Default 4. */
  sweeps?: number;
}

/** A laid-out layer box (center + size in data units). */
export interface ModelNodeBox {
  node: ModelNode;
  category: LayerCategory;
  color: string;
  /** Center. */
  x: number;
  y: number;
  /** Full size. */
  w: number;
  h: number;
  rank: number;
  /** Position within the rank, left→right (or top→bottom when horizontal). */
  order: number;
}

/** A routed connector: an orthogonal polyline from one box edge to another. */
export interface ModelEdgePath {
  from: string;
  to: string;
  label?: string;
  points: Array<{ x: number; y: number }>;
}

export interface ModelLayoutResult {
  nodes: ModelNodeBox[];
  edges: ModelEdgePath[];
  extent: { x: Range; y: Range };
  /** Depth of the DAG (number of ranks). */
  ranks: number;
}

/**
 * Assign each node a rank via longest-path layering over the DAG. Nodes left
 * over by a cycle fall back to "one past their deepest known predecessor", so a
 * cyclic graph still lays out instead of throwing.
 */
function assignRanks(n: number, outAdj: number[][], inAdj: number[][]): number[] {
  const rank = new Array<number>(n).fill(0);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) indeg[i] = inAdj[i]!.length;
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  const visited = new Uint8Array(n);
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    visited[u] = 1;
    for (const v of outAdj[u]!) {
      if (rank[u]! + 1 > rank[v]!) rank[v] = rank[u]! + 1;
      if (--indeg[v]! === 0) queue.push(v);
    }
  }
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    let r = 0;
    for (const p of inAdj[i]!) if (visited[p] && rank[p]! + 1 > r) r = rank[p]! + 1;
    rank[i] = r;
    visited[i] = 1;
  }
  return rank;
}

/** Barycenter sweeps: reorder each rank by the mean position of its neighbours. */
function orderRanks(byRank: number[][], outAdj: number[][], inAdj: number[][], sweeps: number): void {
  const pos = new Map<number, number>();
  const reindex = (): void => {
    for (const rankNodes of byRank) {
      for (let i = 0; i < rankNodes.length; i++) pos.set(rankNodes[i]!, i);
    }
  };
  const barycenter = (v: number, neighbours: number[]): number => {
    let sum = 0;
    let count = 0;
    for (const u of neighbours) {
      const p = pos.get(u);
      if (p != null) {
        sum += p;
        count++;
      }
    }
    return count === 0 ? pos.get(v)! : sum / count;
  };
  reindex();
  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0;
    const order = down
      ? byRank.map((_, i) => i).slice(1)
      : byRank.map((_, i) => i).slice(0, -1).reverse();
    for (const r of order) {
      const rankNodes = byRank[r]!;
      const keys = new Map<number, number>();
      for (const v of rankNodes) keys.set(v, barycenter(v, down ? inAdj[v]! : outAdj[v]!));
      rankNodes.sort((a, b) => (keys.get(a)! - keys.get(b)!) || (pos.get(a)! - pos.get(b)!));
      reindex();
    }
  }
}

/**
 * Lay a {@link ModelGraph} out as a layered DAG: longest-path ranks, barycenter
 * ordering to reduce crossings, then orthogonal edge routing. Edges that skip
 * more than one rank (residual connections) are routed through a bypass lane
 * beside the boxes so they don't cut across them.
 */
export function modelLayout(graph: ModelGraph, opts: ModelLayoutOptions = {}): ModelLayoutResult {
  const vertical = (opts.direction ?? "vertical") === "vertical";
  const nodeWidth = opts.nodeWidth ?? 2.6;
  const nodeHeight = opts.nodeHeight ?? 0.9;
  const rankGap = opts.rankGap ?? 0.7;
  const nodeGap = opts.nodeGap ?? 0.6;
  const sweeps = opts.sweeps ?? 4;
  const [minScale, maxScale] = opts.sizeRange ?? [0.55, 1.5];

  const n = graph.nodes.length;
  if (n === 0) {
    return { nodes: [], edges: [], extent: { x: [0, 1], y: [0, 1] }, ranks: 0 };
  }

  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(graph.nodes[i]!.id, i);
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  const inAdj: number[][] = Array.from({ length: n }, () => []);
  const edgeList: Array<{ edge: ModelEdge; from: number; to: number }> = [];
  for (const e of graph.edges) {
    const from = index.get(e.from);
    const to = index.get(e.to);
    if (from == null || to == null || from === to) continue;
    outAdj[from]!.push(to);
    inAdj[to]!.push(from);
    edgeList.push({ edge: e, from, to });
  }

  const rank = assignRanks(n, outAdj, inAdj);
  const ranks = Math.max(...rank) + 1;
  const byRank: number[][] = Array.from({ length: ranks }, () => []);
  for (let i = 0; i < n; i++) byRank[rank[i]!]!.push(i);
  orderRanks(byRank, outAdj, inAdj, sweeps);

  // Size multiplier across the flow, from the chosen metric (log-compressed).
  const metric = opts.sizeBy && opts.sizeBy !== "none"
    ? graph.nodes.map((node) => Math.max(0, (opts.sizeBy === "flops" ? node.flops : node.params) ?? 0))
    : null;
  let metricMax = 0;
  if (metric) for (const v of metric) if (v > metricMax) metricMax = v;
  const scaleOf = (i: number): number => {
    if (!metric || metricMax <= 0) return 1;
    const t = Math.log1p(metric[i]!) / Math.log1p(metricMax);
    return minScale + (maxScale - minScale) * t;
  };

  // Place: ranks step along the flow axis, siblings spread across it.
  const boxes = new Array<ModelNodeBox>(n);
  const rankStep = (vertical ? nodeHeight : nodeWidth) + rankGap;
  for (let r = 0; r < ranks; r++) {
    const rankNodes = byRank[r]!;
    const sizes = rankNodes.map((i) => (vertical ? nodeWidth : nodeHeight) * scaleOf(i));
    let total = 0;
    for (const s of sizes) total += s;
    total += nodeGap * Math.max(0, rankNodes.length - 1);
    let cursor = -total / 2;
    for (let k = 0; k < rankNodes.length; k++) {
      const i = rankNodes[k]!;
      const across = sizes[k]!;
      const center = cursor + across / 2;
      cursor += across + nodeGap;
      const node = graph.nodes[i]!;
      const category = layerCategory(node.type);
      boxes[i] = {
        node,
        category,
        color: LAYER_COLORS[category],
        x: vertical ? center : r * rankStep,
        y: vertical ? -r * rankStep : -center,
        w: vertical ? across : nodeWidth,
        h: vertical ? nodeHeight : across,
        rank: r,
        order: k,
      };
    }
  }

  // Outer edge of each rank on the across-axis, so a bypass lane can clear every
  // box it passes — not just the two it connects.
  const rankEdge = new Array<number>(ranks).fill(vertical ? -Infinity : Infinity);
  for (const b of boxes) {
    rankEdge[b.rank] = vertical
      ? Math.max(rankEdge[b.rank]!, b.x + b.w / 2)
      : Math.min(rankEdge[b.rank]!, b.y - b.h / 2);
  }

  // Route edges: box edge → box edge, orthogonal, with a bypass lane for skips.
  const lead = rankGap * 0.4;
  const laneFor = (ra: number, rb: number): number => {
    const lo = Math.min(ra, rb);
    const hi = Math.max(ra, rb);
    let lane = rankEdge[lo]!;
    for (let r = lo + 1; r <= hi; r++) {
      lane = vertical ? Math.max(lane, rankEdge[r]!) : Math.min(lane, rankEdge[r]!);
    }
    return lane + (vertical ? 1 : -1) * nodeGap * 0.8;
  };
  const edges: ModelEdgePath[] = [];
  for (const { edge, from, to } of edgeList) {
    const a = boxes[from]!;
    const b = boxes[to]!;
    const span = b.rank - a.rank;
    const points: Array<{ x: number; y: number }> = [];
    if (vertical) {
      const y0 = a.y - a.h / 2;
      const y1 = b.y + b.h / 2;
      if (span === 1 && Math.abs(a.x - b.x) < 1e-9) {
        points.push({ x: a.x, y: y0 }, { x: b.x, y: y1 });
      } else if (span === 1) {
        const mid = (y0 + y1) / 2;
        points.push({ x: a.x, y: y0 }, { x: a.x, y: mid }, { x: b.x, y: mid }, { x: b.x, y: y1 });
      } else {
        const lane = laneFor(a.rank, b.rank);
        points.push(
          { x: a.x, y: y0 },
          { x: a.x, y: y0 - lead },
          { x: lane, y: y0 - lead },
          { x: lane, y: y1 + lead },
          { x: b.x, y: y1 + lead },
          { x: b.x, y: y1 },
        );
      }
    } else {
      const x0 = a.x + a.w / 2;
      const x1 = b.x - b.w / 2;
      if (span === 1 && Math.abs(a.y - b.y) < 1e-9) {
        points.push({ x: x0, y: a.y }, { x: x1, y: b.y });
      } else if (span === 1) {
        const mid = (x0 + x1) / 2;
        points.push({ x: x0, y: a.y }, { x: mid, y: a.y }, { x: mid, y: b.y }, { x: x1, y: b.y });
      } else {
        const lane = laneFor(a.rank, b.rank);
        points.push(
          { x: x0, y: a.y },
          { x: x0 + lead, y: a.y },
          { x: x0 + lead, y: lane },
          { x: x1 - lead, y: lane },
          { x: x1 - lead, y: b.y },
          { x: x1, y: b.y },
        );
      }
    }
    edges.push({ from: edge.from, to: edge.to, ...(edge.label ? { label: edge.label } : {}), points });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const cover = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const b of boxes) {
    cover(b.x - b.w / 2, b.y - b.h / 2);
    cover(b.x + b.w / 2, b.y + b.h / 2);
  }
  for (const e of edges) for (const p of e.points) cover(p.x, p.y);

  return { nodes: boxes, edges, extent: { x: [minX, maxX], y: [minY, maxY] }, ranks };
}

// --- 3D box sizing -----------------------------------------------------------

export interface ModelBoxSizing {
  /** Compression applied to each tensor dim before scaling. Default `"log"`. */
  sizeScale?: "log" | "sqrt" | "linear";
  /** Thickness of the widest layer along the flow axis (channels). Default 0.9. */
  maxThickness?: number;
  /** Height / lateral depth of the largest feature-map face. Default 2.2. */
  maxFace?: number;
  /** Floor (world units) applied to every axis so singleton dims stay visible. Default 0.08. */
  minSize?: number;
}

/** Size of one layer's cuboid: `[thickness (flow), height, depth (lateral)]`. */
export type BoxDims = [number, number, number];

/**
 * Split a tensor shape into the three quantities a cuboid shows: the last two
 * dims become the visible face (height × depth) and everything before them is
 * folded into the thickness — so `[64,112,112]` is a thin 112×112 slab 64 deep,
 * and `[512]` is a tall thin bar.
 */
function shapeMetrics(shape?: number[]): [number, number, number] {
  if (!shape || shape.length === 0) return [1, 1, 1];
  if (shape.length === 1) return [1, Math.max(1, shape[0]!), 1];
  const h = Math.max(1, shape[shape.length - 2]!);
  const w = Math.max(1, shape[shape.length - 1]!);
  let c = 1;
  for (let i = 0; i < shape.length - 2; i++) c *= Math.max(1, shape[i]!);
  return [c, h, w];
}

/**
 * Cuboid dimensions for every node, normalized together so the largest layer on
 * each axis hits its max — the classic "CNN funnel" where feature maps shrink
 * while channel depth grows.
 */
export function modelBoxDims(nodes: ModelNode[], opts: ModelBoxSizing = {}): BoxDims[] {
  const maxThickness = opts.maxThickness ?? 0.9;
  const maxFace = opts.maxFace ?? 2.2;
  const minSize = opts.minSize ?? 0.08;
  const scale = opts.sizeScale ?? "log";
  const f = scale === "log"
    ? (v: number) => Math.log1p(v)
    : scale === "sqrt"
      ? (v: number) => Math.sqrt(v)
      : (v: number) => v;

  // Measure each dim above the "dimension is absent" baseline of 1, so a vector
  // like [512] gets a minimal channel thickness instead of the maximum one.
  const baseline = f(1);
  const raw = nodes.map(
    (node) => shapeMetrics(node.shape).map((v) => Math.max(0, f(v) - baseline)) as [number, number, number],
  );
  let maxC = 0;
  let maxH = 0;
  let maxW = 0;
  for (const [c, h, w] of raw) {
    if (c > maxC) maxC = c;
    if (h > maxH) maxH = h;
    if (w > maxW) maxW = w;
  }
  // An axis where nothing rises above the baseline carries no information, so
  // every block gets the full size there (a shapeless graph reads as uniform).
  const norm = (v: number, max: number, target: number): number =>
    max > 0 ? Math.max(minSize, (v / max) * target) : target;
  return raw.map(([c, h, w]) => [
    norm(c, maxC, maxThickness),
    norm(h, maxH, maxFace),
    norm(w, maxW, maxFace),
  ] as BoxDims);
}
