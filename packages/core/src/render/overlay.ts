import type { Scale } from "../scales/scale.js";
import type { AxisConfig, Tick } from "../types.js";

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

/** Concrete axis styling, resolved from an {@link AxisConfig} against a {@link Theme}. */
export interface ResolvedAxisStyle {
  showAxisLine: boolean;
  axisLineColor: string;
  axisLineWidth: number;
  showTicks: boolean;
  tickColor: string;
  tickLength: number;
  tickMinorLength: number;
  tickWidth: number;
  labelColor: string;
  labelFont: string;
  labelRotation: number;
  labelStandoff: number;
  titleColor: string;
  titleFont: string;
  showGrid: boolean;
  gridColor: string;
  gridMinorColor: string;
  gridWidth: number;
  gridDash: number[];
}

/**
 * Fold an {@link AxisConfig}'s optional style fields onto the theme defaults.
 * Colored fields fall back to `colorOverride` (a secondary y-axis's `color`) before
 * the theme, so an unstyled colored axis still tints its line/ticks/labels/title.
 * With an empty config this reproduces the pre-styling look exactly.
 */
export function resolveAxisStyle(
  cfg: AxisConfig,
  theme: Theme,
  colorOverride?: string,
): ResolvedAxisStyle {
  const line = colorOverride ?? theme.axis;
  const text = colorOverride ?? theme.text;
  return {
    showAxisLine: cfg.showAxisLine ?? true,
    axisLineColor: cfg.axisLineColor ?? line,
    axisLineWidth: cfg.axisLineWidth ?? 1,
    showTicks: cfg.showTicks ?? true,
    tickColor: cfg.tickColor ?? line,
    tickLength: cfg.tickLength ?? 5,
    tickMinorLength: 3,
    tickWidth: cfg.tickWidth ?? 1,
    labelColor: cfg.labelColor ?? text,
    labelFont: cfg.labelFont ?? theme.font,
    labelRotation: cfg.labelRotation ?? 0,
    labelStandoff: cfg.labelStandoff ?? 3,
    titleColor: cfg.titleColor ?? text,
    titleFont: cfg.titleFont ?? theme.font,
    showGrid: cfg.showGrid ?? true,
    gridColor: cfg.gridColor ?? theme.grid,
    gridMinorColor: cfg.gridMinorColor ?? theme.gridMinor,
    gridWidth: cfg.gridWidth ?? 1,
    gridDash: cfg.gridDash ?? [],
  };
}

export interface PlotTitleOptions {
  text: string;
  /** CSS `font` shorthand. Default `"600 15px system-ui, ..."`. */
  font?: string;
  color?: string;
  align?: "left" | "center" | "right";
}

/** Draw the plot title in the reserved strip above the plot region. */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  title: PlotTitleOptions,
  isDark: boolean,
): void {
  ctx.save();
  ctx.font = title.font ?? "600 15px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = title.color ?? (isDark ? "#e2e8f0" : "#1e293b");
  ctx.textBaseline = "middle";
  const align = title.align ?? "center";
  const y = region.top / 2;
  let x: number;
  if (align === "left") {
    ctx.textAlign = "left";
    x = region.left;
  } else if (align === "right") {
    ctx.textAlign = "right";
    x = region.left + region.width;
  } else {
    ctx.textAlign = "center";
    x = region.left + region.width / 2;
  }
  ctx.fillText(title.text, x, y);
  ctx.restore();
}

export function pxX(region: PlotRegion, t: number): number {
  return region.left + t * region.width;
}
export function pxY(region: PlotRegion, t: number): number {
  // t is normalized bottom->top; screen y grows downward.
  return region.top + (1 - t) * region.height;
}

/** Draw vertical (x) and horizontal (y) grid lines, each axis styled independently. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  scaleX: Scale,
  scaleY: Scale,
  ticksX: Tick[],
  ticksY: Tick[],
  styleX: ResolvedAxisStyle,
  styleY: ResolvedAxisStyle,
): void {
  ctx.save();
  if (styleX.showGrid) {
    ctx.lineWidth = styleX.gridWidth;
    ctx.setLineDash(styleX.gridDash);
    for (const t of ticksX) {
      if (!t.grid) continue;
      const x = Math.round(pxX(region, scaleX.norm(t.value))) + 0.5;
      ctx.strokeStyle = t.minor ? styleX.gridMinorColor : styleX.gridColor;
      ctx.beginPath();
      ctx.moveTo(x, region.top);
      ctx.lineTo(x, region.top + region.height);
      ctx.stroke();
    }
  }
  if (styleY.showGrid) {
    ctx.lineWidth = styleY.gridWidth;
    ctx.setLineDash(styleY.gridDash);
    for (const t of ticksY) {
      if (!t.grid) continue;
      const y = Math.round(pxY(region, scaleY.norm(t.value))) + 0.5;
      ctx.strokeStyle = t.minor ? styleY.gridMinorColor : styleY.gridColor;
      ctx.beginPath();
      ctx.moveTo(region.left, y);
      ctx.lineTo(region.left + region.width, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draw the bottom (x) axis line, ticks, labels, and optional title. */
export function drawXAxis(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  scaleX: Scale,
  ticksX: Tick[],
  style: ResolvedAxisStyle,
  title?: string,
): void {
  ctx.save();
  ctx.lineWidth = style.axisLineWidth;
  const bottom = region.top + region.height;

  if (style.showAxisLine) {
    ctx.strokeStyle = style.axisLineColor;
    ctx.beginPath();
    ctx.moveTo(region.left, bottom + 0.5);
    ctx.lineTo(region.left + region.width, bottom + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = style.labelColor;
  ctx.font = style.labelFont;
  const rot = (style.labelRotation * Math.PI) / 180;
  for (const t of ticksX) {
    const x = Math.round(pxX(region, scaleX.norm(t.value))) + 0.5;
    const len = t.minor ? style.tickMinorLength : style.tickLength;
    if (style.showTicks) {
      ctx.strokeStyle = style.tickColor;
      ctx.lineWidth = style.tickWidth;
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + len);
      ctx.stroke();
    }
    if (!t.label) continue;
    const ly = bottom + (style.showTicks ? len : 0) + style.labelStandoff;
    if (rot !== 0) {
      // Rotate labels about the tick; right-align so they trail down-left.
      ctx.save();
      ctx.translate(x, ly);
      ctx.rotate(rot);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(t.label, 0, 0);
      ctx.restore();
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(t.label, x, ly);
    }
  }

  if (title) {
    ctx.fillStyle = style.titleColor;
    ctx.font = style.titleFont;
    ctx.textAlign = "center";
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
  /** Pixel x-position for the rotated title. */
  titleX?: number;
}

/** Draw one vertical (y) axis line, ticks, labels, and optional title. */
export function drawYAxis(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  scaleY: Scale,
  ticksY: Tick[],
  style: ResolvedAxisStyle,
  opts: YAxisDraw,
): void {
  ctx.save();
  ctx.font = style.labelFont;
  ctx.lineWidth = style.axisLineWidth;

  const ax = Math.round(opts.x) + 0.5;
  const dir = opts.side === "left" ? -1 : 1;

  if (style.showAxisLine) {
    ctx.strokeStyle = style.axisLineColor;
    ctx.beginPath();
    ctx.moveTo(ax, region.top);
    ctx.lineTo(ax, region.top + region.height);
    ctx.stroke();
  }

  ctx.fillStyle = style.labelColor;
  ctx.textAlign = opts.side === "left" ? "right" : "left";
  ctx.textBaseline = "middle";
  for (const t of ticksY) {
    const y = Math.round(pxY(region, scaleY.norm(t.value))) + 0.5;
    const len = t.minor ? style.tickMinorLength : style.tickLength;
    if (style.showTicks) {
      ctx.strokeStyle = style.tickColor;
      ctx.lineWidth = style.tickWidth;
      ctx.beginPath();
      ctx.moveTo(ax, y);
      ctx.lineTo(ax + dir * len, y);
      ctx.stroke();
    }
    if (t.label) {
      ctx.fillText(t.label, ax + dir * ((style.showTicks ? len : 0) + style.labelStandoff + 1), y);
    }
  }

  if (opts.title) {
    ctx.save();
    ctx.fillStyle = style.titleColor;
    ctx.font = style.titleFont;
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

/** Draw both a vertical and a horizontal dashed guide line through (px, py). */
export function drawCrosshairXY(
  ctx: CanvasRenderingContext2D,
  region: PlotRegion,
  px: number,
  py: number,
  theme: Theme,
): void {
  const left = region.left;
  const right = region.left + region.width;
  const top = region.top;
  const bottom = region.top + region.height;
  if (px < left || px > right || py < top || py > bottom) return;
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  const x = Math.round(px) + 0.5;
  const y = Math.round(py) + 0.5;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
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
