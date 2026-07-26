/**
 * Model-architecture diagrams built on existing layers:
 *
 *  - {@link addModelGraph} — a flat Netron-style DAG on a 2D {@link Plot}
 *    (rounded boxes + orthogonal connectors, colored by layer family).
 *  - {@link addModelGraph3D} — the "CNN explainer" view on a {@link Plot3D}:
 *    one cuboid per layer, sized from its output tensor shape, chained along the
 *    flow axis.
 *
 * Both consume the same {@link ModelGraph} and the same {@link modelLayout}, so a
 * PyTorch / ONNX export renders identically in either dimension.
 */
import { parseColor, toColorCss } from "../gl/context.js";
import type { PatchesLayer } from "../layers/patches.js";
import type { Patch } from "../layers/patches.js";
import type { Plot } from "../plot.js";
import type { Boxes3DLayer, Box3D } from "../plot3d/boxes3d.js";
import type { Line3DLayer } from "../plot3d/line3d.js";
import type { Plot3D } from "../plot3d/plot3d.js";
import {
  formatCount,
  formatShape,
  LAYER_COLORS,
  modelBoxDims,
  modelLayout,
  type LayerCategory,
  type ModelBoxSizing,
  type ModelGraph,
  type ModelLayoutOptions,
  type ModelLayoutResult,
  type ModelNode,
  tensorMetrics,
  type ModelNodeBox,
} from "./model.js";

// --- Shared helpers ----------------------------------------------------------

/** Category → color, with the caller's overrides merged over the defaults. */
function colorTable(overrides?: Partial<Record<LayerCategory, string>>): Record<LayerCategory, string> {
  return overrides ? { ...LAYER_COLORS, ...overrides } : LAYER_COLORS;
}

/** Multiply a CSS colour toward black — used to give a card stack depth. */
function shade(css: string, factor: number): string {
  const [r, g, b, a] = parseColor(css);
  return toColorCss([r * factor, g * factor, b * factor, a]);
}

/** One-line summary of a layer: `"conv1 · Conv2d · 64×112×112 · 9.4K params"`. */
function describeNode(node: ModelNode): string {
  const parts = [node.name && node.name !== node.type ? `${node.name} · ${node.type}` : node.type];
  const shape = formatShape(node.shape);
  if (shape) parts.push(shape);
  if (node.params) parts.push(`${formatCount(node.params)} params`);
  if (node.flops) parts.push(`${formatCount(node.flops)} FLOPs`);
  return parts.join(" · ");
}

// --- 2D: flat architecture graph ---------------------------------------------

export interface ModelGraphOptions extends ModelLayoutOptions {
  graph: ModelGraph;
  /** Per-category color overrides (merged over {@link LAYER_COLORS}). */
  colors?: Partial<Record<LayerCategory, string>>;
  /** Box corner radius in data units. Default 0.14. */
  cornerRadius?: number;
  /** Connector thickness in data units. Default 0.05. */
  edgeWidth?: number;
  edgeColor?: string;
  /** Arrowhead length in data units; 0 hides them. Default 0.18. */
  arrowSize?: number;
  /** Box fill opacity, 0..1. Default 0.9. */
  opacity?: number;
  /**
   * Draw each box as a stack of offset cards instead of one rectangle, so a
   * `[3, 224, 224]` layer reads as three feature maps rather than one block.
   *
   * `"channels"` uses the layer's own channel count, a number uses that many for
   * every layer, `"none"` (default) keeps one box. The front card stays where
   * the box was, and keeps the labels, so nothing shifts or becomes unreadable.
   */
  slices?: "none" | "channels" | number;
  /** Cap on cards per layer. Default 12. */
  maxSlices?: number;
  /**
   * How far the stack fans out, as a fraction of the box size. The spread is
   * fixed regardless of the card count. Default 0.3.
   */
  sliceSpread?: number;
  /** What to write inside each box. Default `"full"`. */
  labels?: "none" | "name" | "full";
  labelColor?: string;
  labelFont?: string;
  subLabelColor?: string;
  subLabelFont?: string;
  /** Attach a hover tooltip with the layer's shape + parameter count. Default true. */
  tooltip?: boolean;
  /** Palette for the tooltip chrome. Default `"dark"`. */
  theme?: "light" | "dark";
  /** Blank the axes — a diagram has no meaningful coordinates. Default true. */
  hideAxes?: boolean;
  /**
   * Lock data-units-per-pixel on both axes. Default true, and you almost never
   * want it off: box proportions, corner radii and arrowheads are all in data
   * units, so a free aspect stretches every one of them when the container
   * changes shape (resizing, or going fullscreen).
   */
  equalAspect?: boolean;
  /** Vertical gap between label lines, in CSS px. Default 15. */
  labelLineHeight?: number;
  /** Legend name for the box layer. Omitted by default (diagrams use their own key). */
  name?: string;
}

export interface ModelGraphHandle {
  /** The computed layout — box centers, sizes, ranks and routed edge paths. */
  layout: ModelLayoutResult;
  /** Layer holding the layer boxes. */
  nodes: PatchesLayer;
  /** Layer holding the connectors (drawn beneath the boxes). */
  edges: PatchesLayer;
  /** The box containing a data-space point, or null. */
  nodeAt(x: number, y: number): ModelNodeBox | null;
  /** Remove the labels and tooltip this builder added (layers are yours to remove). */
  destroy(): void;
}

/** A rounded rectangle as a polygon ring, CCW, with `seg` segments per corner. */
function roundedRect(cx: number, cy: number, w: number, h: number, r: number, seg = 3): Patch {
  const hw = w / 2;
  const hh = h / 2;
  const rad = Math.max(0, Math.min(r, hw, hh));
  if (rad === 0) {
    return { x: [cx - hw, cx + hw, cx + hw, cx - hw], y: [cy - hh, cy - hh, cy + hh, cy + hh] };
  }
  const corners: Array<[number, number, number]> = [
    [cx + hw - rad, cy + hh - rad, 0],
    [cx - hw + rad, cy + hh - rad, Math.PI / 2],
    [cx - hw + rad, cy - hh + rad, Math.PI],
    [cx + hw - rad, cy - hh + rad, (3 * Math.PI) / 2],
  ];
  const x: number[] = [];
  const y: number[] = [];
  for (const [ccx, ccy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      x.push(ccx + rad * Math.cos(a));
      y.push(ccy + rad * Math.sin(a));
    }
  }
  return { x, y };
}

/**
 * A polyline segment as a quad, extended by half its thickness at both ends so
 * consecutive segments overlap into a filled corner (the paths are orthogonal,
 * so a square joint is exact).
 */
function segmentQuad(
  x0: number, y0: number, x1: number, y1: number, thickness: number,
): { x: number[]; y: number[] } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return null;
  const ux = dx / len;
  const uy = dy / len;
  const half = thickness / 2;
  const ax = x0 - ux * half;
  const ay = y0 - uy * half;
  const bx = x1 + ux * half;
  const by = y1 + uy * half;
  const nx = -uy * half;
  const ny = ux * half;
  return {
    x: [ax + nx, bx + nx, bx - nx, ax - nx],
    y: [ay + ny, by + ny, by - ny, ay - ny],
  };
}

/** An arrowhead triangle whose tip sits at the path's final point. */
function arrowHead(
  x0: number, y0: number, x1: number, y1: number, size: number,
): { x: number[]; y: number[] } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12 || size <= 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x1 - ux * size;
  const by = y1 - uy * size;
  const wx = -uy * size * 0.45;
  const wy = ux * size * 0.45;
  return { x: [x1, bx + wx, bx - wx], y: [y1, by + wy, by - wy] };
}

/**
 * Draw a model architecture as a flat layered graph. Boxes are colored by layer
 * family, residual/skip connections route around the trunk, and each box shows
 * its type, name and output shape.
 *
 * The aspect is locked for you (a schematic must not shear), the axes are
 * blanked, and a purpose-built hover tooltip is attached — so pair it with
 * `new Plot(el, { hover: false })` to suppress the series tooltip it replaces.
 */
export function addModelGraph(plot: Plot, opts: ModelGraphOptions): ModelGraphHandle {
  const layout = modelLayout(opts.graph, opts);
  const colors = colorTable(opts.colors);
  const cornerRadius = opts.cornerRadius ?? 0.14;
  const edgeWidth = opts.edgeWidth ?? 0.05;
  const arrowSize = opts.arrowSize ?? 0.18;
  const dark = (opts.theme ?? "dark") === "dark";
  const edgeColor = opts.edgeColor ?? (dark ? "#64748b" : "#94a3b8");
  const labelMode = opts.labels ?? "full";
  const labelColor = opts.labelColor ?? (dark ? "#f1f5f9" : "#0f172a");
  const subLabelColor = opts.subLabelColor ?? (dark ? "#cbd5e1" : "#475569");
  const labelFont = opts.labelFont ?? "600 12px system-ui, -apple-system, sans-serif";
  const subLabelFont = opts.subLabelFont ?? "10px system-ui, -apple-system, sans-serif";

  // Connectors first so the boxes paint over their endpoints.
  const edgePatches: Patch[] = [];
  for (const e of layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!;
      const b = e.points[i]!;
      const quad = segmentQuad(a.x, a.y, b.x, b.y, edgeWidth);
      if (quad) edgePatches.push({ ...quad, color: edgeColor });
    }
    const last = e.points[e.points.length - 1]!;
    const prev = e.points[e.points.length - 2];
    if (prev) {
      const head = arrowHead(prev.x, prev.y, last.x, last.y, arrowSize);
      if (head) edgePatches.push({ ...head, color: edgeColor });
    }
  }
  const edges = plot.addPatches({ patches: edgePatches, color: edgeColor });

  // Cards are emitted back-to-front and darkened with depth, so the stack reads
  // as one object rather than a smear of identical rectangles.
  const sliceMode = opts.slices ?? "none";
  const maxSlices = opts.maxSlices ?? 12;
  const spread = opts.sliceSpread ?? 0.3;
  const nodePatches: Patch[] = layout.nodes.flatMap((b) => {
    const color = colors[b.category];
    const n = sliceCount(b.node, sliceMode, maxSlices);
    if (n <= 1) return [{ ...roundedRect(b.x, b.y, b.w, b.h, cornerRadius), color }];
    const dx = (b.w * spread) / (n - 1);
    const dy = (b.h * spread) / (n - 1);
    const out: Patch[] = [];
    for (let i = n - 1; i >= 0; i--) {
      out.push({
        ...roundedRect(b.x + dx * i, b.y + dy * i, b.w, b.h, cornerRadius),
        // The front card keeps the true colour; each one behind steps darker.
        color: i === 0 ? color : shade(color, 1 - (0.45 * i) / (n - 1)),
      });
    }
    return out;
  });
  const nodes = plot.addPatches({
    patches: nodePatches,
    opacity: opts.opacity ?? 0.9,
    ...(opts.name ? { name: opts.name } : {}),
  });

  // Text is Canvas2D (crisp at any zoom), placed in data space so it pans along.
  const disposers: Array<() => void> = [];
  if (labelMode !== "none") {
    for (const b of layout.nodes) {
      const lines: Array<{ text: string; sub: boolean }> = [];
      if (labelMode === "name") {
        lines.push({ text: b.node.name ?? b.node.type, sub: false });
      } else {
        lines.push({ text: b.node.type, sub: false });
        const name = b.node.name ?? b.node.id;
        if (name && name !== b.node.type) lines.push({ text: name, sub: true });
        const detail = [formatShape(b.node.shape), b.node.params ? `${formatCount(b.node.params)}p` : ""]
          .filter(Boolean)
          .join("  ");
        if (detail) lines.push({ text: detail, sub: true });
      }
      // All lines share the box centre and are offset in *pixels*, so the block
      // stays tight whatever the zoom or the box's data-space height.
      const step = opts.labelLineHeight ?? 15;
      const top = -((lines.length - 1) / 2) * step;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        disposers.push(
          plot.addAnnotation({
            type: "label",
            x: b.x,
            y: b.y,
            dy: top + i * step,
            text: line.text,
            align: "center",
            color: line.sub ? subLabelColor : labelColor,
            font: line.sub ? subLabelFont : labelFont,
          }),
        );
      }
    }
  }

  if (opts.hideAxes !== false) {
    plot.setAxis("x", { ticks: [], showAxisLine: false });
    plot.setAxis("y", { ticks: [], showAxisLine: false });
  }
  // Without this the diagram shears whenever the container's aspect changes.
  if (opts.equalAspect !== false) plot.setEqualAspect(true);

  const nodeAt = (x: number, y: number): ModelNodeBox | null => {
    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const b = layout.nodes[i]!;
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2) return b;
    }
    return null;
  };

  // Purpose-built hover tooltip: the series tooltip has nothing useful to say
  // about a diagram, so we hit-test the boxes directly.
  let teardownTooltip = (): void => {};
  if (opts.tooltip !== false) {
    const host = plot.element;
    const tip = document.createElement("div");
    Object.assign(tip.style, {
      position: "absolute",
      display: "none",
      zIndex: "7",
      pointerEvents: "none",
      padding: "6px 8px",
      borderRadius: "6px",
      font: "12px system-ui, -apple-system, sans-serif",
      lineHeight: "1.45",
      whiteSpace: "nowrap",
      background: dark ? "rgba(15,23,42,0.94)" : "rgba(255,255,255,0.97)",
      color: dark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${dark ? "rgba(148,163,184,0.3)" : "rgba(100,116,139,0.3)"}`,
      boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    } as CSSStyleDeclaration);
    host.appendChild(tip);

    const hide = (): void => { tip.style.display = "none"; };
    const move = (ev: PointerEvent): void => {
      const data = plot.dataAt(ev.clientX, ev.clientY);
      const box = data && nodeAt(data.x, data.y);
      if (!box) { hide(); return; }
      tip.replaceChildren();
      const title = document.createElement("div");
      title.textContent = box.node.name ?? box.node.id;
      title.style.fontWeight = "600";
      tip.appendChild(title);
      const detail = document.createElement("div");
      detail.style.opacity = "0.75";
      detail.textContent = describeNode(box.node);
      tip.appendChild(detail);
      tip.style.display = "block";
      const rect = host.getBoundingClientRect();
      const lx = ev.clientX - rect.left;
      const ly = ev.clientY - rect.top;
      let left = lx + 14;
      if (left + tip.offsetWidth > host.clientWidth) left = lx - tip.offsetWidth - 14;
      let top = ly + 14;
      if (top + tip.offsetHeight > host.clientHeight) top = ly - tip.offsetHeight - 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, top)}px`;
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", hide);
    teardownTooltip = () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", hide);
      tip.remove();
    };
  }

  return {
    layout,
    nodes,
    edges,
    nodeAt,
    destroy(): void {
      for (const d of disposers) d();
      disposers.length = 0;
      teardownTooltip();
      teardownTooltip = () => {};
    },
  };
}

// --- 3D: tensor-shaped layer blocks ------------------------------------------

export interface ModelGraph3DOptions extends ModelLayoutOptions, ModelBoxSizing {
  graph: ModelGraph;
  /** Per-category color overrides (merged over {@link LAYER_COLORS}). */
  colors?: Partial<Record<LayerCategory, string>>;
  /** Clear space between consecutive layer blocks along the flow axis. Default 1.1. */
  rankSpacing?: number;
  /** Lateral offset between branches that share a rank. Default 3. */
  branchSpacing?: number;
  /**
   * Draw each block as a stack of slices along the flow axis instead of one
   * solid cuboid — the classic feature-map look, where `[3, 224, 224]` reads as
   * three separate planes rather than a single slab.
   *
   * `"channels"` uses the layer's own channel count, a number uses that many for
   * every layer, `"none"` (default) keeps one block. `"voxels"` goes further and
   * subdivides all three axes — a `[3, 224, 224]` layer becomes a real
   * channels × height × width grid of cubes rather than 3 planes.
   *
   * The stack occupies exactly the same space either way, so the layout does not
   * shift.
   */
  slices?: "none" | "channels" | "voxels" | number;
  /**
   * Cap per axis, so a 512-channel block does not become a solid smear. Default
   * 12. With `slices: "voxels"` this bounds every axis, so the default draws at
   * most 12³ cubes per layer — raise it for the literal grid.
   */
  maxSlices?: number;
  /**
   * Total cube budget per layer for `slices: "voxels"`. When the capped grid
   * would exceed it, all three axes are scaled down together so the proportions
   * survive. Default 20 000 — raise it deliberately, since the count is the
   * product of three dimensions.
   */
  maxVoxels?: number;
  /** Fraction of each slice's cell left empty as the gap, 0..1. Default 0.35. */
  sliceGap?: number;
  /** Draw connectors between blocks. Default true. */
  connectors?: boolean;
  connectorColor?: string;
  /** Block opacity, 0..1. Default 1. */
  opacity?: number;
  /**
   * Text pinned above each block: `"name"` (default) the layer name, `"type"`
   * its class, `"full"` the name above and the output shape below, `"none"` to
   * rely on the hover tooltip alone.
   */
  labels?: "none" | "name" | "type" | "full";
  labelColor?: string;
  labelFont?: string;
  subLabelColor?: string;
  subLabelFont?: string;
  name?: string;
}

/**
 * How many slices a block is drawn with: its channel count, a fixed number, or
 * one — always at least 1 and never more than `maxSlices`.
 */
function sliceCount(
  node: ModelNode,
  mode: "none" | "channels" | "voxels" | number,
  maxSlices: number,
): number {
  if (mode === "none") return 1;
  // "voxels" is 3D-only; along one axis it degenerates to the channel count.
  const wanted = typeof mode === "number" ? mode : tensorMetrics(node.shape)[0];
  return Math.max(1, Math.min(Math.floor(maxSlices), Math.floor(wanted) || 1));
}

/**
 * Cubes per axis for `slices: "voxels"` — the tensor's own dimensions, each
 * capped, then all three scaled down together if the product blows the budget.
 * Scaling them together keeps the grid's proportions honest.
 */
function voxelCounts(node: ModelNode, maxSlices: number, maxVoxels: number): [number, number, number] {
  const cap = Math.max(1, Math.floor(maxSlices));
  const dims = tensorMetrics(node.shape).map((d) => Math.max(1, Math.min(cap, Math.floor(d)))) as
    [number, number, number];
  let total = dims[0] * dims[1] * dims[2];
  if (total <= maxVoxels) return dims;
  // Shrink uniformly: the cube root of the overshoot applies to each axis.
  const factor = Math.cbrt(maxVoxels / total);
  const scaled = dims.map((d) => Math.max(1, Math.floor(d * factor))) as [number, number, number];
  // Floor can leave headroom; spend it on the longest axis first.
  total = scaled[0] * scaled[1] * scaled[2];
  for (let guard = 0; guard < 8 && total < maxVoxels; guard++) {
    const order = [0, 1, 2].sort((a, b) => dims[b]! - dims[a]!);
    let grew = false;
    for (const axis of order) {
      if (scaled[axis]! >= dims[axis]!) continue;
      const next = total / scaled[axis]! * (scaled[axis]! + 1);
      if (next > maxVoxels) continue;
      scaled[axis]!++;
      total = next;
      grew = true;
      break;
    }
    if (!grew) break;
  }
  return scaled;
}

/**
 * Fill a block with an `nx × ny × nz` grid of cubes, occupying exactly the
 * extent the solid cuboid did.
 */
function voxelBoxes(
  block: ModelBlock,
  counts: [number, number, number],
  gap: number,
  color: string,
  label: string,
): Box3D[] {
  const [nx, ny, nz] = counts;
  const cell: [number, number, number] = [block.w / nx, block.h / ny, block.d / nz];
  const size = cell.map((c) => Math.max(c * (1 - gap), c * 0.05)) as [number, number, number];
  const origin: [number, number, number] = [
    block.x - block.w / 2 + cell[0] / 2,
    block.y - block.h / 2 + cell[1] / 2,
    block.z - block.d / 2 + cell[2] / 2,
  ];
  const out: Box3D[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        out.push({
          x: origin[0] + i * cell[0],
          y: origin[1] + j * cell[1],
          z: origin[2] + k * cell[2],
          w: size[0],
          h: size[1],
          d: size[2],
          color,
          label,
        });
      }
    }
  }
  return out;
}

/**
 * Cut a block into `n` slabs along x, filling the same extent it occupied whole.
 * Each cell is `w/n` wide and the slab takes `1 - gap` of it, so the stack reads
 * as separate planes without growing the model.
 */
function sliceBoxes(block: ModelBlock, n: number, gap: number, color: string, label: string): Box3D[] {
  if (n <= 1) {
    return [{ x: block.x, y: block.y, z: block.z, w: block.w, h: block.h, d: block.d, color, label }];
  }
  const cell = block.w / n;
  const thickness = Math.max(cell * (1 - gap), cell * 0.05);
  const start = block.x - block.w / 2 + cell / 2;
  const out: Box3D[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: start + i * cell,
      y: block.y,
      z: block.z,
      w: thickness,
      h: block.h,
      d: block.d,
      color,
      label,
    });
  }
  return out;
}

/** Where one layer's cuboid ended up, in world space. */
export interface ModelBlock {
  node: ModelNode;
  category: LayerCategory;
  /** Center. */
  x: number;
  y: number;
  z: number;
  /** Full size: `w` along the flow axis, `h` up, `d` lateral. */
  w: number;
  h: number;
  d: number;
  rank: number;
}

export interface ModelGraph3DHandle {
  boxes: Boxes3DLayer;
  /** One polyline per drawn connector (empty when `connectors: false`). */
  connectors: Line3DLayer[];
  /** One entry per layer, whatever the slice count. */
  blocks: ModelBlock[];
  /** Cubes drawn for each block, parallel to {@link blocks}. */
  slices: number[];
  /** Voxel grid per block as `[nx, ny, nz]`, or null unless `slices: "voxels"`. */
  voxelGrid: Array<[number, number, number]> | null;
  /** Remove the labels this builder pinned (the layers are yours to remove). */
  destroy(): void;
}

/**
 * Draw a model as a chain of cuboids sized from each layer's output tensor: the
 * visible face is the last two dims (H×W) and the thickness is everything before
 * them (channels) — so a CNN reads as feature maps shrinking while depth grows.
 * Blocks flow along +x, branches spread along z, and hovering one shows its
 * shape and parameter count.
 *
 * Build the plot with `new Plot3D(el, { aspectMode: "data", showAxes: false })`
 * — the default cube fit would stretch a long chain until the blocks lose their
 * proportions, and a diagram has no axes to label.
 */
export function addModelGraph3D(plot: Plot3D, opts: ModelGraph3DOptions): ModelGraph3DHandle {
  const { graph } = opts;
  const layout = modelLayout(graph, opts);
  const dims = modelBoxDims(graph.nodes, opts);
  const colors = colorTable(opts.colors);
  const rankSpacing = opts.rankSpacing ?? 1.1;
  const branchSpacing = opts.branchSpacing ?? 3;

  // Thickest block per rank, so ranks step by their real extent (never overlap).
  const rankThickness = new Array<number>(layout.ranks).fill(0);
  const rankCount = new Array<number>(layout.ranks).fill(0);
  for (let i = 0; i < layout.nodes.length; i++) {
    const r = layout.nodes[i]!.rank;
    const t = dims[i]![0];
    if (t > rankThickness[r]!) rankThickness[r] = t;
    rankCount[r]!++;
  }
  const rankX = new Array<number>(layout.ranks).fill(0);
  for (let r = 1; r < layout.ranks; r++) {
    rankX[r] = rankX[r - 1]! + rankThickness[r - 1]! / 2 + rankSpacing + rankThickness[r]! / 2;
  }

  const blocks: ModelBlock[] = layout.nodes.map((b, i) => {
    const [w, h, d] = dims[i]!;
    const siblings = rankCount[b.rank]!;
    return {
      node: b.node,
      category: b.category,
      x: rankX[b.rank]!,
      y: 0,
      z: (b.order - (siblings - 1) / 2) * branchSpacing,
      w,
      h,
      d,
      rank: b.rank,
    };
  });

  const sliceMode = opts.slices ?? "none";
  const maxSlices = opts.maxSlices ?? 12;
  const maxVoxels = opts.maxVoxels ?? 20_000;
  const sliceGap = Math.min(0.9, Math.max(0, opts.sliceGap ?? 0.35));
  const voxels = sliceMode === "voxels";
  const grids = voxels ? blocks.map((b) => voxelCounts(b.node, maxSlices, maxVoxels)) : null;
  const slices = grids
    ? grids.map(([nx, ny, nz]) => nx * ny * nz)
    : blocks.map((b) => sliceCount(b.node, sliceMode, maxSlices));

  const boxes = plot.addBoxes3D({
    boxes: blocks.flatMap((b, i) =>
      grids
        ? voxelBoxes(b, grids[i]!, sliceGap, colors[b.category], describeNode(b.node))
        : sliceBoxes(b, slices[i]!, sliceGap, colors[b.category], describeNode(b.node)),
    ),
    opacity: opts.opacity ?? 1,
    ...(opts.name ? { name: opts.name } : {}),
  });

  // Text pinned in data space, so it tracks the blocks as the camera orbits.
  const labelMode = opts.labels ?? "name";
  const disposers: Array<() => void> = [];
  if (labelMode !== "none") {
    const labelColor = opts.labelColor ?? "#e2e8f0";
    const subLabelColor = opts.subLabelColor ?? "#94a3b8";
    const labelFont = opts.labelFont ?? "600 11px system-ui, -apple-system, sans-serif";
    const subLabelFont = opts.subLabelFont ?? "9px system-ui, -apple-system, sans-serif";
    for (const b of blocks) {
      const head = labelMode === "type" ? b.node.type : (b.node.name ?? b.node.id);
      disposers.push(plot.addLabel3D({
        x: b.x, y: b.y + b.h / 2, z: b.z,
        text: head,
        color: labelColor,
        font: labelFont,
        dy: -10,
        baseline: "bottom",
      }));
      const shape = labelMode === "full" ? formatShape(b.node.shape) : "";
      if (shape) {
        disposers.push(plot.addLabel3D({
          x: b.x, y: b.y - b.h / 2, z: b.z,
          text: shape,
          color: subLabelColor,
          font: subLabelFont,
          dy: 10,
          baseline: "top",
        }));
      }
    }
  }

  const connectors: Line3DLayer[] = [];
  if (opts.connectors !== false) {
    const byId = new Map<string, ModelBlock>();
    for (const b of blocks) byId.set(b.node.id, b);
    const color = opts.connectorColor ?? "#64748b";
    for (const e of graph.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const x0 = a.x + a.w / 2;
      const x1 = b.x - b.w / 2;
      const mid = (x0 + x1) / 2;
      const straight = Math.abs(a.z - b.z) < 1e-9;
      const xs = straight ? [x0, x1] : [x0, mid, mid, x1];
      const ys = straight ? [a.y, b.y] : [a.y, a.y, b.y, b.y];
      const zs = straight ? [a.z, b.z] : [a.z, a.z, b.z, b.z];
      connectors.push(plot.addLine3D({ x: xs, y: ys, z: zs, color }));
    }
  }

  return {
    boxes,
    connectors,
    blocks,
    slices,
    voxelGrid: grids,
    destroy(): void {
      for (const d of disposers) d();
      disposers.length = 0;
    },
  };
}
