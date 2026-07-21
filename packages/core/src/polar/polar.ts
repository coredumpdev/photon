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
}

/** A live handle to update a polar series with new (theta, r) data. */
export interface PolarSeries {
  setData(theta: ArrayLike<number>, r: ArrayLike<number>): void;
}

interface Entry {
  layer: LineLayer | ScatterLayer;
  closed: boolean;
  maxR: number;
}

/** A polar (r, θ) plot: concentric radial grid + angular spokes, WebGL data. */
export class PolarPlot {
  private container: HTMLElement;
  private gridCanvas: HTMLCanvasElement;
  private dataCanvas: HTMLCanvasElement;
  private gridCtx: CanvasRenderingContext2D;
  private dataCtx: CanvasRenderingContext2D;
  private gl: WebGL2RenderingContext;
  private sharedCanvas: HTMLCanvasElement;
  private theme: Theme;
  private toRad: number;
  private fixedR?: number;
  private margin: number;
  private entries: Entry[] = [];
  private R = 1;
  private dpr = 1;
  private resizeObserver: ResizeObserver;
  private frameRequested = false;

  constructor(container: HTMLElement, options: PolarOptions = {}) {
    this.container = container;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.gridCanvas = this.makeCanvas(0);
    this.dataCanvas = this.makeCanvas(1);
    this.gridCtx = this.gridCanvas.getContext("2d")!;
    this.dataCtx = this.dataCanvas.getContext("2d")!;
    const s = getSharedGL();
    this.gl = s.gl;
    this.sharedCanvas = s.canvas;
    this.theme = options.theme === "dark" ? darkTheme
      : options.theme === "light" || options.theme == null ? lightTheme
      : options.theme;
    this.toRad = options.angleUnit === "deg" ? Math.PI / 180 : 1;
    this.fixedR = options.maxRadius;
    this.margin = options.margin ?? 28;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private makeCanvas(z: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: String(z) } as CSSStyleDeclaration);
    c.style.pointerEvents = "none";
    this.container.appendChild(c);
    return c;
  }

  private toXY(theta: ArrayLike<number>, r: ArrayLike<number>, closed: boolean) {
    const n = Math.min(theta.length, r.length);
    const m = closed && n > 0 ? n + 1 : n;
    const x = new Float64Array(m), y = new Float64Array(m);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const a = theta[i]! * this.toRad, rr = r[i]!;
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
    const entry: Entry = { layer, closed, maxR };
    this.entries.push(entry);
    this.refit();
    return this.handle(entry);
  }

  addScatter(opts: PolarScatterOptions): PolarSeries {
    const { x, y, maxR } = this.toXY(opts.theta, opts.r, false);
    const layer = new ScatterLayer(this.gl, { x, y, color: opts.color, size: opts.size ?? 5 });
    const entry: Entry = { layer, closed: false, maxR };
    this.entries.push(entry);
    this.refit();
    return this.handle(entry);
  }

  private handle(entry: Entry): PolarSeries {
    return {
      setData: (theta, r) => {
        const { x, y, maxR } = this.toXY(theta, r, entry.closed);
        entry.layer.setData(x, y);
        entry.maxR = maxR;
        this.refit();
        this.requestRender();
      },
    };
  }

  private refit(): void {
    if (this.fixedR != null) { this.R = this.fixedR; return; }
    let m = 0;
    for (const e of this.entries) m = Math.max(m, e.maxR);
    this.R = m || 1;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    for (const e of this.entries) e.layer.dispose();
    this.container.removeChild(this.gridCanvas);
    this.container.removeChild(this.dataCanvas);
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    for (const c of [this.gridCanvas, this.dataCanvas]) {
      c.width = Math.max(1, Math.round(w * this.dpr));
      c.height = Math.max(1, Math.round(h * this.dpr));
    }
    this.gridCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.dataCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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

    // Angular spokes + degree labels every 30°.
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180;
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
}
