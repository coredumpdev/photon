/**
 * Sankey diagram — pure layout geometry plus an `addSankey(plot, opts)` builder
 * that composes the existing {@link PatchesLayer}. Nodes are thin rectangles;
 * links are bezier ribbons whose thickness encodes value. Mirrors the
 * `add*(plot, opts)` free-function style of the finance chart helpers.
 */
import { parseColor } from "../gl/context.js";
import { type Patch, type PatchesLayer } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { Color, Range, RenderType } from "../types.js";

/** Cycled default node palette (by node index). */
const DEFAULT_COLORS = [
  "#3b82f6", "#f472b6", "#22d3ee", "#a3e635", "#fbbf24",
  "#a78bfa", "#34d399", "#fb7185", "#60a5fa", "#f59e0b",
];

/** A node: a display `name` and an optional explicit fill `color`. */
export interface SankeyNode {
  name: string;
  color?: string;
}

/** A flow from node index `source` to node index `target` carrying `value`. */
export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

/** Tuning for the pure {@link sankeyLayout}. All in normalized-extent units. */
export interface SankeyLayoutOptions {
  /** Drawing box. Defaults to x `[0,1]`, y `[0,1]`. */
  extent?: { x?: Range; y?: Range };
  /** Node rectangle width along x. Default 0.02. */
  nodeWidth?: number;
  /** Vertical gap between stacked nodes, as a fraction of the y extent. Default 0.02. */
  nodePadding?: number;
}

/** One laid-out node rectangle, keyed by node index `i`. */
export interface SankeyNodeRect {
  i: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One laid-out ribbon polygon (closed ring), keyed by link index. */
export interface SankeyRibbon {
  link: number;
  x: number[];
  y: number[];
}

/** Result of {@link sankeyLayout}: node rectangles and link ribbons. */
export interface SankeyLayoutResult {
  nodeRects: SankeyNodeRect[];
  ribbons: SankeyRibbon[];
}

/** Points sampled along each bezier edge of a ribbon. */
const RIBBON_SAMPLES = 20;

/** Cubic-bezier x/y at parameter `t` for scalar control values. */
function cubic(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/**
 * Pure, side-effect-free Sankey layout. Assigns each node a layer by longest
 * path from the sources, stacks nodes vertically by throughput, and traces each
 * link as a bezier ribbon between its source and target edges.
 */
export function sankeyLayout(
  nodes: SankeyNode[],
  links: SankeyLink[],
  opts: SankeyLayoutOptions = {},
): SankeyLayoutResult {
  const n = nodes.length;
  const [ex0, ex1] = opts.extent?.x ?? [0, 1];
  const [ey0, ey1] = opts.extent?.y ?? [0, 1];
  const nodeWidth = opts.nodeWidth ?? 0.02;
  const yHeight = ey1 - ey0;
  const pad = (opts.nodePadding ?? 0.02) * yHeight;

  if (n === 0) return { nodeRects: [], ribbons: [] };

  // --- Layer assignment: longest path from sources (relax, cap for cycles). ---
  const layer = new Array<number>(n).fill(0);
  const valid = links.filter((l) => l.source >= 0 && l.source < n && l.target >= 0 && l.target < n);
  for (let iter = 0; iter < n; iter++) {
    let changed = false;
    for (const l of valid) {
      if (layer[l.target]! < layer[l.source]! + 1) {
        layer[l.target] = layer[l.source]! + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const numLayers = Math.max(...layer) + 1;

  // --- Throughput per node = max(sum incoming, sum outgoing). ---
  const inSum = new Array<number>(n).fill(0);
  const outSum = new Array<number>(n).fill(0);
  for (const l of valid) {
    const v = Math.max(0, l.value);
    outSum[l.source]! += v;
    inSum[l.target]! += v;
  }
  const flow = new Array<number>(n);
  for (let i = 0; i < n; i++) flow[i] = Math.max(inSum[i]!, outSum[i]!);

  // --- Nodes grouped by layer (column). ---
  const columns: number[][] = Array.from({ length: numLayers }, () => []);
  for (let i = 0; i < n; i++) columns[layer[i]!]!.push(i);

  // --- Value→height scale k so the tallest column fits the y extent. ---
  let k = Infinity;
  for (const col of columns) {
    let sum = 0;
    for (const i of col) sum += flow[i]!;
    const avail = yHeight - (col.length - 1) * pad;
    if (sum > 0 && avail > 0) k = Math.min(k, avail / sum);
  }
  if (!isFinite(k) || k <= 0) k = 0;

  // --- Place columns across x and stack nodes (centered) within each. ---
  const nodeRects: SankeyNodeRect[] = [];
  const rectOf = new Array<SankeyNodeRect | null>(n).fill(null);
  for (let li = 0; li < numLayers; li++) {
    const col = columns[li]!;
    const frac = numLayers > 1 ? li / (numLayers - 1) : 0.5;
    const xc = ex0 + (ex1 - ex0 - nodeWidth) * frac;
    const x0 = xc;
    const x1 = xc + nodeWidth;
    let colH = (col.length - 1) * pad;
    for (const i of col) colH += k * flow[i]!;
    let depth = Math.max(0, (yHeight - colH) / 2); // from the top of the extent
    for (const i of col) {
      const h = k * flow[i]!;
      const yTop = ey1 - depth;
      const yBot = yTop - h;
      const r: SankeyNodeRect = { i, x0, y0: yBot, x1, y1: yTop };
      nodeRects.push(r);
      rectOf[i] = r;
      depth += h + pad;
    }
  }

  // --- Ribbons: stack links on each node's source/target edge by value. ---
  const srcOff = new Array<number>(n).fill(0);
  const tgtOff = new Array<number>(n).fill(0);
  const ribbons: SankeyRibbon[] = [];
  for (let li = 0; li < links.length; li++) {
    const l = links[li]!;
    if (l.source < 0 || l.source >= n || l.target < 0 || l.target >= n) continue;
    const sr = rectOf[l.source]!;
    const tr = rectOf[l.target]!;
    const thick = k * Math.max(0, l.value);
    const sTop = sr.y1 - srcOff[l.source]!;
    srcOff[l.source]! += thick;
    const tTop = tr.y1 - tgtOff[l.target]!;
    tgtOff[l.target]! += thick;
    const sBot = sTop - thick;
    const tBot = tTop - thick;
    const sx = sr.x1; // source right edge
    const tx = tr.x0; // target left edge
    const mx = (sx + tx) / 2;

    const x: number[] = [];
    const y: number[] = [];
    // Top edge forward: source → target.
    for (let s = 0; s <= RIBBON_SAMPLES; s++) {
      const t = s / RIBBON_SAMPLES;
      x.push(cubic(t, sx, mx, mx, tx));
      y.push(cubic(t, sTop, sTop, tTop, tTop));
    }
    // Bottom edge back: target → source (closes the ring).
    for (let s = 0; s <= RIBBON_SAMPLES; s++) {
      const t = s / RIBBON_SAMPLES;
      x.push(cubic(t, tx, mx, mx, sx));
      y.push(cubic(t, tBot, tBot, sBot, sBot));
    }
    ribbons.push({ link: li, x, y });
  }

  return { nodeRects, ribbons };
}

/** Options for {@link addSankey}. */
export interface SankeyOptions {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Drawing box in data space. Defaults to x `[0,1]`, y `[0,1]`. */
  extent?: { x?: Range; y?: Range };
  nodeWidth?: number;
  nodePadding?: number;
  /** Per-node colors (by index); overridden by a node's own `color`. */
  colors?: string[];
  /** Layer fill opacity (0..1), forwarded to the patches layer. Default 1. */
  opacity?: number;
  name?: string;
  renderType?: RenderType;
  /** Draw node name labels. Default true. */
  labels?: boolean;
}

/** Resolve a node's fill CSS color: own color, then `colors[i]`, then the palette. */
function nodeColor(nodes: SankeyNode[], colors: string[] | undefined, i: number): string {
  return nodes[i]!.color ?? colors?.[i] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]!;
}

/** Alpha applied to ribbon fills so overlapping flows read through each other. */
const RIBBON_ALPHA = 0.5;

/**
 * Build a Sankey diagram on `plot`: one node rectangle {@link Patch} per node
 * plus one semi-transparent ribbon patch per link (colored from its source
 * node), added as a single {@link PatchesLayer}. Node name labels are added as
 * plot annotations unless `labels` is false.
 */
export function addSankey(plot: Plot, opts: SankeyOptions): PatchesLayer {
  const { nodes, links } = opts;
  const { nodeRects, ribbons } = sankeyLayout(nodes, links, {
    extent: opts.extent,
    nodeWidth: opts.nodeWidth,
    nodePadding: opts.nodePadding,
  });

  const patches: Patch[] = [];

  // Ribbons first (drawn under the nodes), tinted from their source node.
  for (const rb of ribbons) {
    const src = links[rb.link]!.source;
    const base = parseColor(nodeColor(nodes, opts.colors, src));
    const color: Color = [base[0], base[1], base[2], base[3] * RIBBON_ALPHA];
    patches.push({ x: rb.x, y: rb.y, color });
  }

  // Node rectangles on top, solid node color.
  for (const r of nodeRects) {
    patches.push({
      x: [r.x0, r.x1, r.x1, r.x0],
      y: [r.y0, r.y0, r.y1, r.y1],
      color: nodeColor(nodes, opts.colors, r.i),
    });
  }

  const layer = plot.addPatches({
    patches,
    opacity: opts.opacity ?? 1,
    name: opts.name,
    renderType: opts.renderType,
  });

  // Node name labels, centered on each rectangle.
  if (opts.labels !== false) {
    for (const r of nodeRects) {
      plot.addAnnotation({
        type: "label",
        x: (r.x0 + r.x1) / 2,
        y: (r.y0 + r.y1) / 2,
        text: nodes[r.i]!.name,
        align: "center",
      });
    }
  }

  return layer;
}
