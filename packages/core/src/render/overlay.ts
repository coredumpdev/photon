import type { Scale } from "../scales/scale.js";
import type { Tick } from "../types.js";

/** Pixel geometry of the plot, in CSS pixels. The plot region excludes margins. */
export interface Layout {
  cssWidth: number;
  cssHeight: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface PlotRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function plotRegion(layout: Layout): PlotRegion {
  const { margin } = layout;
  return {
    left: margin.left,
    top: margin.top,
    width: Math.max(0, layout.cssWidth - margin.left - margin.right),
    height: Math.max(0, layout.cssHeight - margin.top - margin.bottom),
  };
}

export interface Theme {
  axis: string;
  grid: string;
  gridMinor: string;
  text: string;
  font: string;
}

export const lightTheme: Theme = {
  axis: "#334155",
  grid: "rgba(100,116,139,0.18)",
  gridMinor: "rgba(100,116,139,0.08)",
  text: "#475569",
  font: "12px system-ui, -apple-system, sans-serif",
};

export const darkTheme: Theme = {
  axis: "#cbd5e1",
  grid: "rgba(148,163,184,0.16)",
  gridMinor: "rgba(148,163,184,0.07)",
  text: "#94a3b8",
  font: "12px system-ui, -apple-system, sans-serif",
};

export function pxX(region: PlotRegion, t: number): number {
  return region.left + t * region.width;
}
export function pxY(region: PlotRegion, t: number): number {
  // t is normalized bottom->top; screen y grows downward.
  return region.top + (1 - t) * region.height;
}

/** Draw vertical (x) and horizontal (y) grid lines for the given ticks. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  scaleX: Scale,
  scaleY: Scale,
  ticksX: Tick[],
  ticksY: Tick[],
  theme: Theme,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (const t of ticksX) {
    if (!t.grid) continue;
    const x = Math.round(pxX(region, scaleX.norm(t.value))) + 0.5;
    ctx.strokeStyle = t.minor ? theme.gridMinor : theme.grid;
    ctx.beginPath();
    ctx.moveTo(x, region.top);
    ctx.lineTo(x, region.top + region.height);
    ctx.stroke();
  }
  for (const t of ticksY) {
    if (!t.grid) continue;
    const y = Math.round(pxY(region, scaleY.norm(t.value))) + 0.5;
    ctx.strokeStyle = t.minor ? theme.gridMinor : theme.grid;
    ctx.beginPath();
    ctx.moveTo(region.left, y);
    ctx.lineTo(region.left + region.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw the bottom (x) axis line, ticks, labels, and optional title. */
export function drawXAxis(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  scaleX: Scale,
  ticksX: Tick[],
  theme: Theme,
  title?: string,
): void {
  ctx.save();
  ctx.strokeStyle = theme.axis;
  ctx.fillStyle = theme.text;
  ctx.font = theme.font;
  ctx.lineWidth = 1;
  const bottom = region.top + region.height;

  ctx.beginPath();
  ctx.moveTo(region.left, bottom + 0.5);
  ctx.lineTo(region.left + region.width, bottom + 0.5);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of ticksX) {
    const x = Math.round(pxX(region, scaleX.norm(t.value))) + 0.5;
    const len = t.minor ? 3 : 5;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + len);
    ctx.stroke();
    if (t.label) ctx.fillText(t.label, x, bottom + len + 3);
  }

  if (title) {
    ctx.textBaseline = "bottom";
    ctx.fillText(title, region.left + region.width / 2, bottom + 34);
  }
  ctx.restore();
}

export interface YAxisDraw {
  /** Pixel x-position of the axis line. */
  x: number;
  side: "left" | "right";
  title?: string;
  /** Optional color override (secondary axes often match their series). */
  color?: string;
  /** Pixel x-position for the rotated title. */
  titleX?: number;
}

/** Draw one vertical (y) axis line, ticks, labels, and optional title. */
export function drawYAxis(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  scaleY: Scale,
  ticksY: Tick[],
  theme: Theme,
  opts: YAxisDraw,
): void {
  ctx.save();
  const color = opts.color ?? theme.axis;
  ctx.strokeStyle = color;
  ctx.fillStyle = opts.color ?? theme.text;
  ctx.font = theme.font;
  ctx.lineWidth = 1;

  const ax = Math.round(opts.x) + 0.5;
  const dir = opts.side === "left" ? -1 : 1;

  ctx.beginPath();
  ctx.moveTo(ax, region.top);
  ctx.lineTo(ax, region.top + region.height);
  ctx.stroke();

  ctx.textAlign = opts.side === "left" ? "right" : "left";
  ctx.textBaseline = "middle";
  for (const t of ticksY) {
    const y = Math.round(pxY(region, scaleY.norm(t.value))) + 0.5;
    const len = t.minor ? 3 : 5;
    ctx.beginPath();
    ctx.moveTo(ax, y);
    ctx.lineTo(ax + dir * len, y);
    ctx.stroke();
    if (t.label) ctx.fillText(t.label, ax + dir * (len + 4), y);
  }

  if (opts.title) {
    ctx.save();
    const tx = opts.titleX ?? (opts.side === "left" ? 12 : region.left + region.width + 36);
    ctx.translate(tx, region.top + region.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = opts.side === "left" ? "top" : "bottom";
    ctx.fillText(opts.title, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Draw a vertical crosshair line at pixel x (hover). */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  px: number,
  theme: Theme,
): void {
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  const x = Math.round(px) + 0.5;
  ctx.beginPath();
  ctx.moveTo(x, region.top);
  ctx.lineTo(x, region.top + region.height);
  ctx.stroke();
  ctx.restore();
}

/** Draw a filled marker (hover point highlight). */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
