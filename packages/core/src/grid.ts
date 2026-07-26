/**
 * A CSS-grid of independent plots in one container — matplotlib's
 * `subplots(rows, cols)` without the figure/axes ceremony.
 *
 * Each cell owns a full {@link Plot}, {@link Plot3D} or {@link PolarPlot}, so
 * every panel keeps its own scales, toolbar and interaction. They all draw
 * through the one shared WebGL context the engine already keeps, which is why a
 * 3x3 grid costs no more GPU contexts than a single chart does.
 *
 * ```ts
 * const grid = new PlotGrid(el, { rows: 2, cols: 2, title: "Sensors", linkX: true });
 * grid.addPlot().addLine({ x, y: a });
 * grid.addPlot().addLine({ x, y: b });
 * grid.addPlot({ colSpan: 2 }).addLine({ x, y: total });
 * ```
 */
import { Plot, linkX, linkY, type PlotOptions } from "./plot.js";
import { Plot3D, type Plot3DOptions } from "./plot3d/plot3d.js";
import { PolarPlot, type PolarOptions } from "./polar/polar.js";

/** Figure-wide title drawn above the grid. */
export interface GridTitleOptions {
  text: string;
  color?: string;
  /** CSS `font` shorthand. Default a 15px semibold system font. */
  font?: string;
  align?: "left" | "center" | "right";
}

export interface PlotGridOptions {
  /** Grid shape. Both default to 1. */
  rows?: number;
  cols?: number;
  /** Gap between cells in CSS px. Default 12. */
  gap?: number;
  /** Title strip above the grid. */
  title?: string | GridTitleOptions;
  /** Theme each 2D/polar cell inherits unless its own options set one. */
  theme?: "light" | "dark";
  /** Fill behind the whole grid. Default transparent. */
  background?: string;
  /** Relative row heights / column widths — matplotlib's `height_ratios` / `width_ratios`. */
  rowRatios?: number[];
  colRatios?: number[];
  /** Share the x view (pan / zoom) and hover crosshair across every 2D cell. */
  linkX?: boolean;
  /** Share the primary y view across every 2D cell. */
  linkY?: boolean;
}

/** Where a cell sits. Omit `row`/`col` to take the next free slot in reading order. */
export interface CellPlacement {
  row?: number;
  col?: number;
  rowSpan?: number;
  colSpan?: number;
}

/** `1fr` tracks, or the caller's ratios when they match the track count. */
function tracks(n: number, ratios?: number[]): string {
  if (ratios && ratios.length === n && ratios.every((r) => r > 0)) {
    return ratios.map((r) => `${r}fr`).join(" ");
  }
  // minmax(0, 1fr) — a bare 1fr has `min-width: auto`, which lets a wide cell
  // push the whole grid past its container instead of shrinking.
  return `repeat(${n}, minmax(0, 1fr))`;
}

export class PlotGrid {
  readonly rows: number;
  readonly cols: number;

  private root: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private opts: PlotGridOptions;
  private children: Array<{ destroy(): void }> = [];
  private cartesian: Plot[] = [];
  /** Auto-placement cursor, in cells. */
  private next = 0;
  private unlink: Array<() => void> = [];

  constructor(container: HTMLElement, options: PlotGridOptions = {}) {
    this.opts = options;
    this.rows = Math.max(1, Math.floor(options.rows ?? 1));
    this.cols = Math.max(1, Math.floor(options.cols ?? 1));

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      minHeight: "0",
      boxSizing: "border-box",
      background: options.background ?? "transparent",
    } as Partial<CSSStyleDeclaration>);

    const title = typeof options.title === "string" ? { text: options.title } : options.title;
    if (title?.text) {
      const el = document.createElement("div");
      el.textContent = title.text;
      Object.assign(el.style, {
        flex: "0 0 auto",
        padding: "2px 4px 8px",
        textAlign: title.align ?? "center",
        font: title.font ?? "600 15px/1.25 system-ui, -apple-system, sans-serif",
        color: title.color ?? (options.theme === "dark" ? "#e2e8f0" : "#1e293b"),
      } as Partial<CSSStyleDeclaration>);
      this.root.append(el);
    }

    this.gridEl = document.createElement("div");
    Object.assign(this.gridEl.style, {
      flex: "1 1 auto",
      minHeight: "0",
      display: "grid",
      gap: `${options.gap ?? 12}px`,
      gridTemplateRows: tracks(this.rows, options.rowRatios),
      gridTemplateColumns: tracks(this.cols, options.colRatios),
    } as Partial<CSSStyleDeclaration>);
    this.root.append(this.gridEl);
    container.append(this.root);
  }

  /** Every 2D plot in the grid, in creation order. */
  get plots(): Plot[] {
    return this.cartesian;
  }

  /** The grid's own element — handy for measuring or styling the whole figure. */
  get element(): HTMLElement {
    return this.root;
  }

  /**
   * Claim a cell and return its (empty) element. Use it to mount something the
   * grid doesn't know about — a legend, a table, a plain `<div>` of numbers.
   */
  cell(place: CellPlacement = {}): HTMLDivElement {
    const rowSpan = Math.max(1, Math.floor(place.rowSpan ?? 1));
    const colSpan = Math.max(1, Math.floor(place.colSpan ?? 1));
    // Explicit placement never moves the auto cursor: mixing the two is the
    // caller's business, and silently shifting later cells would surprise them.
    const auto = place.row == null && place.col == null;
    const row = place.row ?? Math.floor(this.next / this.cols);
    const col = place.col ?? this.next % this.cols;
    if (auto) this.next += colSpan;

    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "relative",
      minWidth: "0",
      minHeight: "0",
    } as Partial<CSSStyleDeclaration>);
    el.style.gridRow = `${row + 1} / span ${rowSpan}`;
    el.style.gridColumn = `${col + 1} / span ${colSpan}`;
    this.gridEl.append(el);
    return el;
  }

  /** Add a Cartesian plot in the next (or given) cell. */
  addPlot(place: CellPlacement = {}, options: PlotOptions = {}): Plot {
    return this.adopt(new Plot(this.cell(place), this.themed(options)));
  }

  /** Add a 3D plot in the next (or given) cell. */
  addPlot3D(place: CellPlacement = {}, options: Plot3DOptions = {}): Plot3D {
    return this.adopt(new Plot3D(this.cell(place), options));
  }

  /** Add a polar plot in the next (or given) cell. */
  addPolar(place: CellPlacement = {}, options: PolarOptions = {}): PolarPlot {
    return this.adopt(new PolarPlot(this.cell(place), this.themed(options)));
  }

  /**
   * Hand the grid a plot you built yourself in a {@link cell}, so it owns the
   * teardown and (for a 2D plot) the `linkX` / `linkY` wiring.
   */
  adopt<T extends Plot | Plot3D | PolarPlot>(plot: T): T {
    this.children.push(plot);
    if (plot instanceof Plot) {
      this.cartesian.push(plot);
      this.relink();
    }
    return plot;
  }

  /**
   * Re-apply `linkX` / `linkY` across the current 2D cells. Called for you by
   * {@link addPlot}; call it yourself only after adding plots by hand.
   */
  relink(): void {
    for (const u of this.unlink) u();
    this.unlink = [];
    if (this.cartesian.length < 2) return;
    if (this.opts.linkX) this.unlink.push(linkX(this.cartesian));
    if (this.opts.linkY) this.unlink.push(linkY(this.cartesian));
  }

  /** Render every cell — a Plot3D needs this once its layers are in. */
  refresh(): void {
    for (const child of this.children) {
      if (child instanceof Plot3D) child.refresh();
      else if (child instanceof Plot) child.render();
    }
  }

  destroy(): void {
    for (const u of this.unlink) u();
    this.unlink = [];
    for (const child of this.children) {
      try {
        child.destroy();
      } catch {
        /* a half-built panel may not tear down cleanly; keep going */
      }
    }
    this.children = [];
    this.cartesian = [];
    this.root.remove();
  }

  /** Fold the grid's theme onto a cell's options, letting the cell win. */
  private themed<T extends { theme?: PlotOptions["theme"] }>(options: T): T {
    if (!this.opts.theme || options.theme !== undefined) return options;
    return { ...options, theme: this.opts.theme };
  }
}
