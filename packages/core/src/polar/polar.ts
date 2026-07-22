import { autoTicks } from "../axes/ticks.js";
import { begin2D, getSharedGL, sizeShared } from "../gl/shared.js";
import type { AxisFrame } from "../gl/transform.js";
import { LineLayer } from "../layers/line.js";
import { ScatterLayer } from "../layers/scatter.js";
import { darkTheme, lightTheme, type Theme } from "../render/overlay.js";
import type { Color } from "../types.js";

export interface PolarOptions {
  theme?: "light" | "dark" | Theme;
  /** Angle unit of input theta values. Default `"rad"`. */
  angleUnit?: "rad" | "deg";
  /** Fixed max radius. If omitted, autoscales to the data. */
  maxRadius?: number;
  margin?: number;
  /** Enable wheel-zoom (r scale) and drag-rotate interaction. Default true. */
  interactive?: boolean;
  /** Enable hover: highlight the nearest point + show a tooltip. Default true. */
  hover?: boolean;
  /** Show the built-in home (reset) button. Default true. */
  showToolbar?: boolean;
  /**
   * How the pinned point-info box is triggered: `"click"` pins a point until
   * empty space is clicked; `"hover"` shows the point under the cursor
   * automatically (no click). Default `"click"`.
   */
  pointInfo?: "hover" | "click";
}

export interface PolarLineOptions {
  theta: ArrayLike<number>;
  r: ArrayLike<number>;
  color?: string | Color;
  width?: number;
  /** Connect the last point back to the first. */
  closed?: boolean;
}

export interface PolarScatterOptions {
  theta: ArrayLike<number>;
  r: ArrayLike<number>;
  color?: string | Color;
  size?: number;
  /** Optional per-point labels (one per point), shown as the title of the click-pinned info box. */
  labels?: ArrayLike<string>;
}

/** A live handle to update a polar series with new (theta, r) data. */
export interface PolarSeries {
  setData(theta: ArrayLike<number>, r: ArrayLike<number>): void;
}

interface Entry {
  layer: LineLayer | ScatterLayer;
  closed: boolean;
  maxR: number;
  /** Raw input data, retained so we can re-project on rotation change and pick on hover. */
  theta: ArrayLike<number>;
  r: ArrayLike<number>;
  /** Optional per-point labels (scatter only), used as the pinned info-box title. */
  labels?: ArrayLike<string>;
}

/** A nearest-point pick result, in both data and screen (CSS px) space. */
interface Pick {
  entry: Entry;
  index: number;
  px: number;
  py: number;
  theta: number;
  r: number;
  d2: number;
}

/** A polar (r, θ) plot: concentric radial grid + angular spokes, WebGL data. */
export class PolarPlot {
  private container: HTMLElement;
  private gridCanvas: HTMLCanvasElement;
  private dataCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private gridCtx: CanvasRenderingContext2D;
  private dataCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  private gl: WebGL2RenderingContext;
  private sharedCanvas: HTMLCanvasElement;
  private theme: Theme;
  private isDark: boolean;
  private toRad: number;
  private fixedR?: number;
  private margin: number;
  private entries: Entry[] = [];
  private R = 1;
  private baseR = 1;
  private dpr = 1;
  private resizeObserver: ResizeObserver;
  private frameRequested = false;

  // Interaction state.
  private interactive: boolean;
  private hoverEnabled: boolean;
  /** Multiplier on the fitted radius: <1 zooms in (smaller r-domain), >1 out. */
  private zoom = 1;
  /** Angular offset (radians, CCW) applied to all series + gridlines. */
  private rotation = 0;
  private hoverPx: { x: number; y: number } | null = null;
  private tooltip: HTMLDivElement;
  private homeButton: HTMLButtonElement | null = null;
  /** A point clicked to pin its details, until another click clears it. */
  private selected: { entry: Entry; index: number } | null = null;
  private infoBox: HTMLDivElement;
  /** Whether the info box is triggered by `"click"` (pinned) or `"hover"`. */
  private pointInfo: "hover" | "click";

  constructor(container: HTMLElement, options: PolarOptions = {}) {
    this.container = container;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.gridCanvas = this.makeCanvas(0, false);
    this.dataCanvas = this.makeCanvas(1, false);
    this.overlayCanvas = this.makeCanvas(2, true);
    this.gridCtx = this.gridCanvas.getContext("2d")!;
    this.dataCtx = this.dataCanvas.getContext("2d")!;
    this.overlayCtx = this.overlayCanvas.getContext("2d")!;
    const s = getSharedGL();
    this.gl = s.gl;
    this.sharedCanvas = s.canvas;
    this.isDark = options.theme === "dark";
    this.theme = options.theme === "dark" ? darkTheme
      : options.theme === "light" || options.theme == null ? lightTheme
      : options.theme;
    this.toRad = options.angleUnit === "deg" ? Math.PI / 180 : 1;
    this.fixedR = options.maxRadius;
    this.margin = options.margin ?? 28;
    this.interactive = options.interactive !== false;
    this.hoverEnabled = options.hover !== false;
    this.pointInfo = options.pointInfo ?? "click";

    // Tooltip (shared with hover).
    this.tooltip = document.createElement("div");
    Object.assign(this.tooltip.style, {
      position: "absolute",
      display: "none",
      zIndex: "4",
      pointerEvents: "none",
      padding: "6px 8px",
      borderRadius: "6px",
      font: "12px system-ui, -apple-system, sans-serif",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
      background: this.isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.96)",
      color: this.isDark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${this.isDark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.25)"}`,
      boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
    } as CSSStyleDeclaration);
    container.appendChild(this.tooltip);

    // Pinned info box for a clicked point (persists until the next click).
    this.infoBox = document.createElement("div");
    Object.assign(this.infoBox.style, {
      position: "absolute",
      display: "none",
      zIndex: "6",
      pointerEvents: "none",
      padding: "6px 8px",
      borderRadius: "6px",
      font: "12px system-ui, -apple-system, sans-serif",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
      background: this.isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.98)",
      color: this.isDark ? "#e2e8f0" : "#1e293b",
      border: `1px solid ${this.isDark ? "rgba(148,163,184,0.4)" : "rgba(100,116,139,0.4)"}`,
      boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    } as CSSStyleDeclaration);
    container.appendChild(this.infoBox);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    if (this.interactive) this.attachInteraction();
    if (options.showToolbar !== false) this.homeButton = this.makeHomeButton();
  }

  private makeCanvas(z: number, interactive: boolean): HTMLCanvasElement {
    const c = document.createElement("canvas");
    Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: String(z) } as CSSStyleDeclaration);
    if (!interactive) c.style.pointerEvents = "none";
    this.container.appendChild(c);
    return c;
  }

  private toXY(theta: ArrayLike<number>, r: ArrayLike<number>, closed: boolean) {
    const n = Math.min(theta.length, r.length);
    const m = closed && n > 0 ? n + 1 : n;
    const x = new Float64Array(m), y = new Float64Array(m);
    const rot = this.rotation;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const a = theta[i]! * this.toRad + rot, rr = r[i]!;
      x[i] = rr * Math.cos(a); y[i] = rr * Math.sin(a);
      if (Math.abs(rr) > maxR) maxR = Math.abs(rr);
    }
    if (closed && n > 0) { x[n] = x[0]!; y[n] = y[0]!; }
    return { x, y, maxR };
  }

  addLine(opts: PolarLineOptions): PolarSeries {
    const closed = opts.closed ?? false;
    const { x, y, maxR } = this.toXY(opts.theta, opts.r, closed);
    const layer = new LineLayer(this.gl, { x, y, color: opts.color, width: opts.width ?? 2, decimate: false });
    const entry: Entry = { layer, closed, maxR, theta: opts.theta, r: opts.r };
    this.entries.push(entry);
    this.refit();
    return this.handle(entry);
  }

  addScatter(opts: PolarScatterOptions): PolarSeries {
    const { x, y, maxR } = this.toXY(opts.theta, opts.r, false);
    const layer = new ScatterLayer(this.gl, { x, y, color: opts.color, size: opts.size ?? 5 });
    const entry: Entry = { layer, closed: false, maxR, theta: opts.theta, r: opts.r, labels: opts.labels };
    this.entries.push(entry);
    this.refit();
    return this.handle(entry);
  }

  private handle(entry: Entry): PolarSeries {
    return {
      setData: (theta, r) => {
        entry.theta = theta;
        entry.r = r;
        const { x, y, maxR } = this.toXY(theta, r, entry.closed);
        entry.layer.setData(x, y);
        entry.maxR = maxR;
        this.refit();
        this.requestRender();
      },
    };
  }

  private refit(): void {
    let base: number;
    if (this.fixedR != null) {
      base = this.fixedR;
    } else {
      let m = 0;
      for (const e of this.entries) m = Math.max(m, e.maxR);
      base = m || 1;
    }
    this.baseR = base;
    this.R = base * this.zoom;
  }

  /** Re-project every series with the current rotation (called when rotation changes). */
  private retransform(): void {
    for (const e of this.entries) {
      const { x, y } = this.toXY(e.theta, e.r, e.closed);
      e.layer.setData(x, y);
    }
  }

  // ---- Interaction control --------------------------------------------------

  /** Reset zoom (r-domain) and rotation back to the initial view. */
  home(): void {
    this.zoom = 1;
    this.rotation = 0;
    this.refit();
    this.retransform();
    this.requestRender();
  }

  /** Current rotation offset in radians (CCW). */
  getRotation(): number {
    return this.rotation;
  }

  /** Set the rotation offset (radians, CCW) and redraw. */
  setRotation(rad: number): void {
    this.rotation = rad;
    this.retransform();
    this.requestRender();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    for (const e of this.entries) e.layer.dispose();
    this.tooltip.remove();
    this.infoBox.remove();
    this.homeButton?.remove();
    this.container.removeChild(this.gridCanvas);
    this.container.removeChild(this.dataCanvas);
    this.container.removeChild(this.overlayCanvas);
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    for (const c of [this.gridCanvas, this.dataCanvas, this.overlayCanvas]) {
      c.width = Math.max(1, Math.round(w * this.dpr));
      c.height = Math.max(1, Math.round(h * this.dpr));
    }
    this.gridCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.dataCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.overlayCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => { this.frameRequested = false; this.render(); });
  }

  /** The square drawing region (CSS px). */
  private square() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const side = Math.max(1, Math.min(w, h) - this.margin * 2);
    return { cx: w / 2, cy: h / 2, side, left: (w - side) / 2, top: (h - side) / 2 };
  }

  render(): void {
    const sq = this.square();
    const w = this.container.clientWidth, h = this.container.clientHeight;

    // Data via shared WebGL, clipped to the square region, domain [-R, R].
    const gl = this.gl;
    const devW = this.dataCanvas.width, devH = this.dataCanvas.height;
    sizeShared(gl, devW, devH);
    begin2D(gl);
    gl.clearColor(0, 0, 0, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, devW, devH);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const dpr = this.dpr;
    const vx = Math.round(sq.left * dpr), vw = Math.round(sq.side * dpr), vh = Math.round(sq.side * dpr);
    const vy = devH - Math.round((sq.top + sq.side) * dpr);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);
    gl.viewport(vx, vy, vw, vh);
    const frame: AxisFrame = { lo: -this.R, hi: this.R, log: false };
    for (const e of this.entries) {
      e.layer.draw({ gl, x: frame, y: frame, pixelWidth: vw, pixelHeight: vh, dpr });
    }
    gl.disable(gl.SCISSOR_TEST);

    this.dataCtx.clearRect(0, 0, w, h);
    this.dataCtx.drawImage(this.sharedCanvas, 0, 0, w, h);

    this.drawGrid(sq);

    // Overlay: hover marker/tooltip + the pinned/hover point marker/info box.
    this.overlayCtx.clearRect(0, 0, w, h);
    if (this.hoverEnabled && this.hoverPx) {
      this.renderHover(sq);
    } else {
      this.tooltip.style.display = "none";
      // In "hover" mode the box follows the cursor, so drop it when idle/left.
      if (this.pointInfo === "hover") this.selected = null;
    }
    this.updateInfoBox(sq);
  }

  private drawGrid(sq: { cx: number; cy: number; side: number }): void {
    const ctx = this.gridCtx;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const pr = sq.side / 2;
    const { cx, cy } = sq;
    ctx.save();
    ctx.font = this.theme.font;
    ctx.fillStyle = this.theme.text;

    // Angular spokes + degree labels every 30°, rotated by the current offset.
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180 + this.rotation;
      const ex = cx + Math.cos(a) * pr, ey = cy - Math.sin(a) * pr;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const lx = cx + Math.cos(a) * (pr + 12), ly = cy - Math.sin(a) * (pr + 12);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${deg}°`, lx, ly);
    }

    // Radial grid circles (no numeric labels).
    const ticks = autoTicks(0, this.R, 4).map((t) => t.value).filter((v) => v > 0);
    ctx.strokeStyle = this.theme.grid;
    for (const rv of ticks) {
      const rad = (rv / this.R) * pr;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- Hover ----------------------------------------------------------------

  private setHover(px: { x: number; y: number } | null): void {
    const had = this.hoverPx !== null;
    if (!px && !had) return;
    this.hoverPx = px;
    this.requestRender();
  }

  /** Nearest data point (across all series) to a cursor position, in CSS px. */
  private pickNearest(sq: { cx: number; cy: number; side: number }, cursorX: number, cursorY: number): Pick | null {
    const pr = sq.side / 2;
    const { cx, cy } = sq;
    const rot = this.rotation;
    let best: Pick | null = null;
    for (const e of this.entries) {
      const n = Math.min(e.theta.length, e.r.length);
      for (let i = 0; i < n; i++) {
        const a = e.theta[i]! * this.toRad + rot, rr = e.r[i]!;
        const px = cx + (rr * Math.cos(a) / this.R) * pr;
        const py = cy - (rr * Math.sin(a) / this.R) * pr;
        const dx = px - cursorX, dy = py - cursorY;
        const d2 = dx * dx + dy * dy;
        if (!best || d2 < best.d2) best = { entry: e, index: i, px, py, theta: e.theta[i]!, r: rr, d2 };
      }
    }
    return best;
  }

  /** Draw a filled, white-ringed marker on the overlay at a screen position. */
  private drawPointMarker(px: number, py: number, color: string): void {
    const ctx = this.overlayCtx;
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

  private renderHover(sq: { cx: number; cy: number; side: number }): void {
    const cursor = this.hoverPx!;
    const best = this.pickNearest(sq, cursor.x, cursor.y);
    const within = best != null && best.d2 <= 24 * 24;
    // In "hover" mode the info box follows the point under the cursor.
    if (this.pointInfo === "hover") {
      this.selected = within ? { entry: best!.entry, index: best!.index } : null;
    }
    // Only highlight within a reasonable pixel radius.
    if (!within) {
      this.tooltip.style.display = "none";
      return;
    }
    this.drawPointMarker(best!.px, best!.py, best!.entry.layer.colorCss);
    this.updateTooltip(best!.entry, best!.theta, best!.r, cursor);
  }

  /** Click handler: pin the nearest point's details, or clear on empty space. */
  private handleClick(sq: { cx: number; cy: number; side: number }, cursorX: number, cursorY: number): void {
    // Only "click" mode pins/clears via clicks; "hover" is driven by renderHover.
    if (this.pointInfo !== "click") return;
    const hit = this.pickNearest(sq, cursorX, cursorY);
    this.selected = hit && hit.d2 <= 14 * 14 ? { entry: hit.entry, index: hit.index } : null;
    this.requestRender();
  }

  /** Draw the pinned point's marker and position its info box (or hide it). */
  private updateInfoBox(sq: { cx: number; cy: number; side: number; left: number; top: number }): void {
    const box = this.infoBox;
    if (!this.selected) {
      box.style.display = "none";
      return;
    }
    const { entry, index } = this.selected;
    // A data update may have shrunk the series; drop a now-invalid pin.
    if (index >= Math.min(entry.theta.length, entry.r.length)) {
      this.selected = null;
      box.style.display = "none";
      return;
    }
    const pr = sq.side / 2;
    const a = entry.theta[index]! * this.toRad + this.rotation, rr = entry.r[index]!;
    const px = sq.cx + (rr * Math.cos(a) / this.R) * pr;
    const py = sq.cy - (rr * Math.sin(a) / this.R) * pr;
    // Hide when the point has been rotated/zoomed out of the square region.
    if (px < sq.left || px > sq.left + sq.side || py < sq.top || py > sq.top + sq.side) {
      box.style.display = "none";
      return;
    }
    this.drawPointMarker(px, py, entry.layer.colorCss);

    box.replaceChildren();
    const label = entry.labels && index < entry.labels.length ? entry.labels[index] : undefined;
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "2px";
    title.textContent = label != null && label !== "" ? label : entry.layer.name;
    box.appendChild(title);

    const unit = this.toRad === 1 ? "" : "°";
    const rRow = document.createElement("div");
    rRow.textContent = `r = ${fmt(rr)}`;
    const tRow = document.createElement("div");
    tRow.textContent = `θ = ${fmt(entry.theta[index]!)}${unit}`;
    box.appendChild(rRow);
    box.appendChild(tRow);

    box.style.display = "block";
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    const tw = box.offsetWidth, th = box.offsetHeight;
    let left = px + 12;
    if (left + tw > cw) left = px - tw - 12;
    let top = py + 12;
    if (top + th > ch) top = py - th - 12;
    box.style.left = `${Math.max(0, left)}px`;
    box.style.top = `${Math.max(0, top)}px`;
  }

  private updateTooltip(entry: Entry, theta: number, r: number, cursor: { x: number; y: number }): void {
    const tip = this.tooltip;
    tip.replaceChildren();

    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.gap = "6px";
    head.style.marginBottom = "3px";
    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: entry.layer.colorCss,
      flex: "0 0 auto",
    } as CSSStyleDeclaration);
    const nameEl = document.createElement("span");
    nameEl.textContent = entry.layer.name;
    head.appendChild(dot);
    head.appendChild(nameEl);
    tip.appendChild(head);

    const unit = this.toRad === 1 ? "" : "°";
    const rRow = document.createElement("div");
    rRow.textContent = `r = ${fmt(r)}`;
    const tRow = document.createElement("div");
    tRow.textContent = `θ = ${fmt(theta)}${unit}`;
    tip.appendChild(rRow);
    tip.appendChild(tRow);

    tip.style.display = "block";
    const cw = this.container.clientWidth;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = cursor.x + 14;
    if (left + tw > cw) left = cursor.x - tw - 14;
    let top = cursor.y + 14;
    if (top + th > this.container.clientHeight) top = cursor.y - th - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top)}px`;
  }

  // ---- Interaction ----------------------------------------------------------

  private attachInteraction(): void {
    const el = this.overlayCanvas;
    el.style.touchAction = "none";
    el.style.cursor = "grab";

    // Wheel zooms the radial (r) scale about the center. r-min stays 0.
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.001);
        this.zoom = Math.max(1e-3, Math.min(1e3, this.zoom * factor));
        this.R = this.baseR * this.zoom;
        this.requestRender();
      },
      { passive: false },
    );

    let rotating = false;
    let lastAngle = 0;
    // Pointer-down position (CSS px), to distinguish a click from a rotate drag.
    let downX = 0, downY = 0;
    // Cursor angle around the center (y-up, matching the data projection).
    const cursorAngle = (px: number, py: number): number => {
      const sq = this.square();
      return Math.atan2(sq.cy - py, px - sq.cx);
    };

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      downX = e.clientX - rect.left;
      downY = e.clientY - rect.top;
      rotating = true;
      lastAngle = cursorAngle(downX, downY);
      this.hoverPx = null;
      el.style.cursor = "grabbing";
    });

    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (rotating) {
        // Turn the dial: the plot follows the cursor's angle about the center,
        // as if you grabbed the point under the cursor. Accumulate deltas
        // (normalized to ±π) so crossing the angle seam doesn't jump.
        const ang = cursorAngle(px, py);
        let d = ang - lastAngle;
        if (d > Math.PI) d -= 2 * Math.PI;
        else if (d < -Math.PI) d += 2 * Math.PI;
        this.rotation += d;
        lastAngle = ang;
        this.retransform();
        this.requestRender();
      } else if (this.hoverEnabled) {
        this.setHover({ x: px, y: py });
      }
    });

    el.addEventListener("pointerleave", () => this.setHover(null));

    const end = (e: PointerEvent, click: boolean) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (rotating) {
        rotating = false;
        el.style.cursor = "grab";
      }
      if (!click) return;
      // A near-stationary press is a click: pin the nearest point (or clear).
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (Math.hypot(px - downX, py - downY) < 4) this.handleClick(this.square(), px, py);
    };
    el.addEventListener("pointerup", (e) => end(e, true));
    el.addEventListener("pointercancel", (e) => end(e, false));
  }

  private makeHomeButton(): HTMLButtonElement {
    const dark = this.isDark;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Reset view (Home)";
    btn.setAttribute("aria-label", "Reset view (Home)");
    Object.assign(btn.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      zIndex: "5",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "26px",
      height: "26px",
      padding: "0",
      borderRadius: "6px",
      background: dark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)",
      color: dark ? "#cbd5e1" : "#475569",
      border: `1px solid ${dark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.25)"}`,
      backdropFilter: "blur(6px)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      cursor: "pointer",
    } as CSSStyleDeclaration);

    // Home glyph, built with safe DOM APIs (no innerHTML).
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const mkPath = (d: string) => {
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "1.5");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
      return p;
    };
    svg.appendChild(mkPath("M2 7.5 8 2l6 5.5"));
    svg.appendChild(mkPath("M4 7v6.5h3.2V10h1.6v3.5H12V7"));
    btn.appendChild(svg);

    btn.addEventListener("click", () => this.home());
    this.container.appendChild(btn);
    return btn;
  }
}

/** Compact numeric formatting for tooltip values. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(Math.round(v * 1000) / 1000);
}
