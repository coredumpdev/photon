import { autoTicks, defaultFormat } from "../axes/ticks.js";
import { colormap } from "../color/colormap.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { begin3D, getSharedGL, sizeShared } from "../gl/shared.js";
import { canvasToBlob, copyCanvasToClipboard, downloadCanvas, type ExportOptions } from "../render/export.js";
import type { Range } from "../types.js";
import { Bar3DLayer, type Bar3DOptions } from "./bar3d.js";
import { Contour3DLayer, type Contour3DOptions } from "./contour3d.js";
import { IsosurfaceLayer, type IsosurfaceOptions } from "./isosurface.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import { Line3DLayer, type Line3DOptions } from "./line3d.js";
import { lookAt, multiply, perspective, scaleTranslate, transformPoint, type Mat4 } from "./mat4.js";
import { PointCloudLayer, type PointCloudOptions } from "./pointcloud.js";
import { Quiver3DLayer, type Quiver3DOptions } from "./quiver3d.js";
import { SurfaceLayer, type SurfaceOptions } from "./surface.js";
import { VolumeLayer, type VolumeOptions } from "./volume.js";

export interface Plot3DOptions {
  background?: [number, number, number, number];
  azimuth?: number;
  elevation?: number;
  distance?: number;
  /** Axis titles drawn along the x / y (height) / z edges. */
  axisLabels?: { x?: string; y?: string; z?: string };
  /** Render a small on-canvas panel with light-angle + ambient sliders. */
  lightControls?: boolean;
  /** Plot title, drawn top-center. */
  title?: string;
  /** Show a legend of named solid-colored layers. Default false. */
  legend?: boolean;
  /** Show a colorbar for the first colormapped layer. Default true when one exists. */
  colorbar?: boolean | { label?: string };
  /** Hover tooltip on the nearest pickable point. Default true. */
  hover?: boolean;
  /** Show a reset-view (home) button. Default true. */
  resetButton?: boolean;
  /** Show a download-PNG button. Default true. */
  downloadButton?: boolean;
  /** Draw grid lines on the back walls of the cube. Default true. */
  gridPlanes?: boolean;
  /** Auto-orbit the camera: `true` for a default speed, or radians/frame. Default off. */
  autoRotate?: boolean | number;
}

const LINE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;
const LINE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const BOX_EDGES = new Float32Array([
  -1, -1, -1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, -1, 1, -1, -1, 1, -1, -1, -1, -1,
  -1, -1, 1, 1, -1, 1, 1, -1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, -1, 1, 1, -1, -1, 1,
  -1, -1, -1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1, -1, 1, -1, -1, 1, 1,
]);

interface Label { p: [number, number, number]; text: string; title?: boolean }

/** A 3D scatter/surface plot with an orbit camera, axis ticks, and lighting. */
export class Plot3D {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private displayCtx: CanvasRenderingContext2D;
  private gl: WebGL2RenderingContext;
  private sharedCanvas: HTMLCanvasElement;
  private layers: Layer3D[] = [];
  private normalize: Mat4 = scaleTranslate([1, 1, 1], [0, 0, 0]);
  private dataBounds: Bounds3 | null = null;
  private bg: [number, number, number, number];
  private dpr = 1;

  private azimuth: number;
  private elevation: number;
  private distance: number;
  private axisLabels: { x?: string; y?: string; z?: string };
  private resizeObserver: ResizeObserver;
  private frameRequested = false;

  private lineProgram: WebGLProgram;
  private lineUniforms: Record<string, WebGLUniformLocation | null>;
  private boxVao: WebGLVertexArrayObject;
  private boxBuf: WebGLBuffer;
  private tickVao: WebGLVertexArrayObject;
  private tickBuf: WebGLBuffer;
  private tickCount = 0;
  private labels: Label[] = [];
  /** Tick positions in cube space [-1,1], per axis, for the grid planes. */
  private tickCube: { x: number[]; y: number[]; z: number[] } = { x: [], y: [], z: [] };
  private gridPlanes: boolean;
  private gridVao: WebGLVertexArrayObject | null = null;
  private gridBuf: WebGLBuffer | null = null;
  /** Normalize params (world→cube: `cube = s*world + t`), for the volume camera. */
  private norm = { sx: 1, sy: 1, sz: 1, tx: 0, ty: 0, tz: 0 };
  /** Auto-orbit speed (rad/frame); 0 = off. Paused while the pointer is down. */
  private autoRotateSpeed = 0;
  private rotating = false;
  private interacting = false;

  // Lighting.
  private lightAz = 0.9;
  private lightEl = 0.9;
  private ambient = 0.35;
  private controlsEl: HTMLElement | null = null;

  // Chrome.
  private title?: string;
  private showLegend: boolean;
  private colorbarOpt: boolean | { label?: string };
  private legendDiv: HTMLDivElement;
  private colorbarDiv: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private resetBtn: HTMLButtonElement | null = null;
  private downloadBtn: HTMLButtonElement | null = null;
  private hoverEnabled: boolean;
  /** Screen position (device px) of the picked point, for the highlight ring. */
  private hoverHit: { sx: number; sy: number } | null = null;
  /** Initial camera, restored by {@link resetView}. */
  private initialAz: number;
  private initialEl: number;
  private initialDist: number;

  constructor(container: HTMLElement, options: Plot3DOptions = {}) {
    this.container = container;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%" } as CSSStyleDeclaration);
    container.appendChild(this.canvas);
    this.displayCtx = this.canvas.getContext("2d")!;
    const s = getSharedGL();
    this.gl = s.gl;
    this.sharedCanvas = s.canvas;
    this.bg = options.background ?? [0.04, 0.06, 0.13, 1];
    this.azimuth = options.azimuth ?? 0.7;
    this.elevation = options.elevation ?? 0.5;
    this.distance = options.distance ?? 3.6;
    this.initialAz = this.azimuth;
    this.initialEl = this.elevation;
    this.initialDist = this.distance;
    this.axisLabels = options.axisLabels ?? {};
    this.title = options.title;
    this.showLegend = options.legend ?? false;
    this.colorbarOpt = options.colorbar ?? true;
    this.hoverEnabled = options.hover !== false;
    this.gridPlanes = options.gridPlanes !== false;

    // Legend + colorbar DOM overlays.
    this.legendDiv = document.createElement("div");
    Object.assign(this.legendDiv.style, {
      position: "absolute", top: "8px", right: "8px", zIndex: "5", display: "none",
      pointerEvents: "none", padding: "6px 8px", borderRadius: "6px",
      font: "12px system-ui, sans-serif", lineHeight: "1.5",
      background: "rgba(15,23,42,0.8)", color: "#e2e8f0",
      border: "1px solid rgba(148,163,184,0.25)",
    } as CSSStyleDeclaration);
    container.appendChild(this.legendDiv);
    this.colorbarDiv = document.createElement("div");
    Object.assign(this.colorbarDiv.style, {
      position: "absolute", bottom: "12px", right: "10px", zIndex: "5", display: "none",
      pointerEvents: "none", font: "10px system-ui, sans-serif", color: "#cbd5e1",
      textAlign: "center",
    } as CSSStyleDeclaration);
    container.appendChild(this.colorbarDiv);

    // Hover tooltip.
    this.tooltip = document.createElement("div");
    Object.assign(this.tooltip.style, {
      position: "absolute", display: "none", zIndex: "6", pointerEvents: "none",
      padding: "5px 7px", borderRadius: "6px", font: "12px system-ui, sans-serif",
      whiteSpace: "nowrap", background: "rgba(15,23,42,0.92)", color: "#e2e8f0",
      border: "1px solid rgba(148,163,184,0.3)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    } as CSSStyleDeclaration);
    container.appendChild(this.tooltip);

    // Reset-view (home) button.
    if (options.resetButton !== false) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = "Reset view";
      btn.textContent = "⌂";
      Object.assign(btn.style, {
        position: "absolute", bottom: "8px", left: "8px", zIndex: "6",
        width: "26px", height: "26px", padding: "0", cursor: "pointer",
        borderRadius: "6px", font: "15px system-ui, sans-serif", lineHeight: "24px",
        background: "rgba(15,23,42,0.8)", color: "#cbd5e1",
        border: "1px solid rgba(148,163,184,0.25)",
      } as CSSStyleDeclaration);
      btn.addEventListener("click", () => this.resetView());
      container.appendChild(btn);
      this.resetBtn = btn;
    }

    // Download-PNG button (next to reset).
    if (options.downloadButton !== false) {
      const dl = document.createElement("button");
      dl.type = "button";
      dl.title = "Download PNG";
      dl.textContent = "⤓";
      Object.assign(dl.style, {
        position: "absolute", bottom: "8px", left: options.resetButton !== false ? "40px" : "8px", zIndex: "6",
        width: "26px", height: "26px", padding: "0", cursor: "pointer",
        borderRadius: "6px", font: "16px system-ui, sans-serif", lineHeight: "24px",
        background: "rgba(15,23,42,0.8)", color: "#cbd5e1",
        border: "1px solid rgba(148,163,184,0.25)",
      } as CSSStyleDeclaration);
      dl.addEventListener("click", () => void this.downloadImage());
      container.appendChild(dl);
      this.downloadBtn = dl;
    }

    this.lineProgram = createProgram(this.gl, LINE_VERT, LINE_FRAG);
    this.lineUniforms = uniformLocations(this.gl, this.lineProgram, ["uVP", "uColor"]);
    this.boxVao = this.gl.createVertexArray()!;
    this.boxBuf = this.gl.createBuffer()!;
    this.bindLineVao(this.boxVao, this.boxBuf, BOX_EDGES);
    this.tickVao = this.gl.createVertexArray()!;
    this.tickBuf = this.gl.createBuffer()!;
    this.bindLineVao(this.tickVao, this.tickBuf, new Float32Array(0));
    this.gridVao = this.gl.createVertexArray()!;
    this.gridBuf = this.gl.createBuffer()!;
    this.bindLineVao(this.gridVao, this.gridBuf, new Float32Array(0));

    if (options.lightControls) this.buildControls();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.attachControls();
    this.resize();
    if (options.autoRotate) this.setAutoRotate(options.autoRotate);
  }

  private bindLineVao(vao: WebGLVertexArrayObject, buf: WebGLBuffer, data: Float32Array): void {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  addSurface(opts: SurfaceOptions): SurfaceLayer {
    const l = new SurfaceLayer(this.gl, opts);
    l.setLight(this.lightDir(), this.ambient);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  addPointCloud(opts: PointCloudOptions): PointCloudLayer {
    const l = new PointCloudLayer(this.gl, opts);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** A 3D polyline / path. */
  addLine3D(opts: Line3DOptions): Line3DLayer {
    const l = new Line3DLayer(this.gl, opts);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** 3D bars (columns) on an x/z grid, lit and optionally colormapped. */
  addBar3D(opts: Bar3DOptions): Bar3DLayer {
    const l = new Bar3DLayer(this.gl, opts);
    l.setLight(this.lightDir(), this.ambient);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** A 3D vector field (arrows), optionally colored by magnitude. */
  addQuiver3D(opts: Quiver3DOptions): Quiver3DLayer {
    const l = new Quiver3DLayer(this.gl, opts);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** 3D iso-height contour lines of a grid, stacked at their level heights. */
  addContour3D(opts: Contour3DOptions): Contour3DLayer {
    const l = new Contour3DLayer(this.gl, opts);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** A marching-cubes isosurface of a 3D scalar volume (lit, solid-colored). */
  addIsosurface(opts: IsosurfaceOptions): IsosurfaceLayer {
    const l = new IsosurfaceLayer(this.gl, opts);
    l.setLight(this.lightDir(), this.ambient);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** Direct volume rendering (GPU raymarch) of a 3D scalar field. */
  addVolume(opts: VolumeOptions): VolumeLayer {
    const l = new VolumeLayer(this.gl, opts);
    this.layers.push(l);
    this.recompute();
    this.requestRender();
    return l;
  }

  /** Update the light direction (azimuth/elevation, radians) and ambient (0..1). */
  setLight(params: { azimuth?: number; elevation?: number; ambient?: number }): void {
    if (params.azimuth != null) this.lightAz = params.azimuth;
    if (params.elevation != null) this.lightEl = params.elevation;
    if (params.ambient != null) this.ambient = params.ambient;
    const dir = this.lightDir();
    for (const l of this.layers) {
      if ("setLight" in l) (l as SurfaceLayer).setLight(dir, this.ambient);
    }
    this.requestRender();
  }

  private lightDir(): [number, number, number] {
    const el = this.lightEl, az = this.lightAz;
    return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  }

  /** Auto-orbit the camera. `true` = default speed, number = radians/frame, `false`/0 stops. */
  setAutoRotate(speed: number | boolean): void {
    this.autoRotateSpeed = speed === true ? 0.006 : speed === false ? 0 : speed;
    if (this.autoRotateSpeed !== 0 && !this.rotating) {
      this.rotating = true;
      const loop = () => {
        if (this.autoRotateSpeed === 0) { this.rotating = false; return; }
        if (!this.interacting) { this.azimuth += this.autoRotateSpeed; this.render(); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  /** Restore the initial camera orientation and zoom. */
  resetView(): void {
    this.azimuth = this.initialAz;
    this.elevation = this.initialEl;
    this.distance = this.initialDist;
    this.requestRender();
  }

  /** Nearest pickable point to the cursor. Screen coords are device px. */
  private pick(clientX: number, clientY: number): { label: string; sx: number; sy: number } | null {
    const { mvp } = this.viewProj();
    const w = this.canvas.width, h = this.canvas.height;
    const rect = this.canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * this.dpr;
    const cy = (clientY - rect.top) * this.dpr;
    const gate = 14 * this.dpr;
    let bestD = gate * gate;
    let best: { label: string; sx: number; sy: number } | null = null;
    for (const l of this.layers) {
      const pd = l.pickData?.();
      if (!pd) continue;
      const pos = pd.positions;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const c = transformPoint(mvp, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        if (c[3] <= 0) continue;
        const sx = (c[0] / c[3] * 0.5 + 0.5) * w;
        const sy = (1 - (c[1] / c[3] * 0.5 + 0.5)) * h;
        const dx = sx - cx, dy = sy - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = {
            sx, sy,
            label: pd.label
              ? pd.label(i)
              : `${defaultFormat(pos[i * 3]!)}, ${defaultFormat(pos[i * 3 + 1]!)}, ${defaultFormat(pos[i * 3 + 2]!)}`,
          };
        }
      }
    }
    return best;
  }

  /** Show/hide the hover tooltip + highlight ring for the point under the cursor. */
  private updateHover(clientX: number, clientY: number): void {
    if (!this.hoverEnabled) return;
    const hit = this.pick(clientX, clientY);
    const had = this.hoverHit !== null;
    if (!hit) {
      this.tooltip.style.display = "none";
      if (had) { this.hoverHit = null; this.requestRender(); }
      return;
    }
    this.hoverHit = { sx: hit.sx, sy: hit.sy };
    this.requestRender(); // redraw so the highlight ring tracks the point
    const rect = this.canvas.getBoundingClientRect();
    this.tooltip.textContent = hit.label;
    this.tooltip.style.display = "block";
    const lx = clientX - rect.left, ly = clientY - rect.top;
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    let left = lx + 14; if (left + tw > cw) left = lx - tw - 14;
    let top = ly + 14; if (top + th > ch) top = ly - th - 14;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${Math.max(0, top)}px`;
  }

  /** Remove a layer, re-fit, and redraw. */
  removeLayer(layer: Layer3D): void {
    const i = this.layers.indexOf(layer);
    if (i >= 0) {
      this.layers.splice(i, 1);
      layer.dispose();
      this.recompute();
      this.requestRender();
    }
  }

  /** Re-fit the axes to the data and redraw — call after a layer's `setData(...)`. */
  refresh(): void {
    this.recompute();
    this.requestRender();
  }

  // --- Export ---------------------------------------------------------------

  /** Copy the current 3D frame (already composited on one canvas) into a fresh canvas. */
  private compositeCanvas(background?: string): HTMLCanvasElement {
    this.render();
    const w = this.canvas.width, h = this.canvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d")!;
    if (background && background !== "transparent") { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(this.canvas, 0, 0);
    return out;
  }

  /** Export the current view as a data URL (default PNG). */
  toDataURL(type = "image/png", opts: ExportOptions = {}): string {
    return this.compositeCanvas(opts.background).toDataURL(type, opts.quality);
  }

  /** Export the current view as a `Blob` (default PNG). */
  toBlob(type = "image/png", opts: ExportOptions = {}): Promise<Blob | null> {
    return canvasToBlob(this.compositeCanvas(opts.background), type, opts.quality);
  }

  /** Download the current view as an image (PNG by default). */
  downloadImage(filename = "chart.png", type = "image/png", opts: ExportOptions = {}): Promise<void> {
    return downloadCanvas(this.compositeCanvas(opts.background), filename, type, opts.quality);
  }

  /** Copy the current view to the clipboard as a PNG. */
  copyToClipboard(opts: ExportOptions = {}): Promise<void> {
    return copyCanvasToClipboard(this.compositeCanvas(opts.background));
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.autoRotateSpeed = 0; // stop the orbit loop
    for (const l of this.layers) l.dispose();
    this.gl.deleteProgram(this.lineProgram);
    this.gl.deleteVertexArray(this.boxVao);
    this.gl.deleteVertexArray(this.tickVao);
    if (this.gridVao) this.gl.deleteVertexArray(this.gridVao);
    this.gl.deleteBuffer(this.boxBuf);
    this.gl.deleteBuffer(this.tickBuf);
    if (this.gridBuf) this.gl.deleteBuffer(this.gridBuf);
    this.controlsEl?.remove();
    this.legendDiv.remove();
    this.colorbarDiv.remove();
    this.tooltip.remove();
    this.resetBtn?.remove();
    this.downloadBtn?.remove();
    this.container.removeChild(this.canvas);
  }

  private recompute(): void {
    let b: Bounds3 | null = null;
    for (const l of this.layers) {
      const lb = l.bounds3();
      if (!lb) continue;
      b = b ? {
        x: [Math.min(b.x[0], lb.x[0]), Math.max(b.x[1], lb.x[1])],
        y: [Math.min(b.y[0], lb.y[0]), Math.max(b.y[1], lb.y[1])],
        z: [Math.min(b.z[0], lb.z[0]), Math.max(b.z[1], lb.z[1])],
      } : lb;
    }
    if (!b) return;
    this.dataBounds = b;
    const axis = (r: Range): [number, number] => {
      const span = r[1] - r[0];
      return span === 0 ? [1, -r[0]] : [2 / span, -(r[1] + r[0]) / span];
    };
    const [sx, tx] = axis(b.x), [sy, ty] = axis(b.y), [sz, tz] = axis(b.z);
    this.normalize = scaleTranslate([sx, sy, sz], [tx, ty, tz]);
    this.norm = { sx, sy, sz, tx, ty, tz };
    this.buildAxes();
  }

  /** Build tick-mark line geometry + tick/title labels from the data bounds. */
  private buildAxes(): void {
    const b = this.dataBounds;
    if (!b) return;
    const cube = (r: Range, v: number) => (2 * (v - r[0])) / ((r[1] - r[0]) || 1) - 1;
    const seg: number[] = [];
    const labels: Label[] = [];
    const tc: { x: number[]; y: number[]; z: number[] } = { x: [], y: [], z: [] };
    const mark = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      seg.push(x0, y0, z0, x1, y1, z1);

    for (const t of autoTicks(b.x[0], b.x[1], 5)) {
      const cx = cube(b.x, t.value);
      tc.x.push(cx);
      mark(cx, -1, -1, cx, -1, -1.06);
      labels.push({ p: [cx, -1, -1.16], text: defaultFormat(t.value) });
    }
    for (const t of autoTicks(b.y[0], b.y[1], 5)) {
      const cy = cube(b.y, t.value);
      tc.y.push(cy);
      mark(-1, cy, -1, -1.06, cy, -1);
      labels.push({ p: [-1.16, cy, -1], text: defaultFormat(t.value) });
    }
    for (const t of autoTicks(b.z[0], b.z[1], 5)) {
      const cz = cube(b.z, t.value);
      tc.z.push(cz);
      mark(-1, -1, cz, -1.06, -1, cz);
      labels.push({ p: [-1.16, -1, cz], text: defaultFormat(t.value) });
    }
    this.tickCube = tc;
    if (this.axisLabels.x) labels.push({ p: [0, -1.25, -1.3], text: this.axisLabels.x, title: true });
    if (this.axisLabels.y) labels.push({ p: [-1.35, 0, -1], text: this.axisLabels.y, title: true });
    if (this.axisLabels.z) labels.push({ p: [-1.3, -1.25, 0], text: this.axisLabels.z, title: true });

    this.labels = labels;
    this.tickCount = seg.length / 3;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.tickBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(seg), this.gl.STATIC_DRAW);
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.render();
  }

  requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => { this.frameRequested = false; this.render(); });
  }

  private viewProj(): { vp: Mat4; mvp: Mat4; eye: [number, number, number] } {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective((50 * Math.PI) / 180, aspect, 0.01, 100);
    const el = Math.max(-1.5, Math.min(1.5, this.elevation));
    const eye: [number, number, number] = [
      this.distance * Math.cos(el) * Math.sin(this.azimuth),
      this.distance * Math.sin(el),
      this.distance * Math.cos(el) * Math.cos(this.azimuth),
    ];
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const vp = multiply(proj, view);
    return { vp, mvp: multiply(vp, this.normalize), eye };
  }

  /** Build + draw grid lines on the 3 back walls (cube space) for the current eye. */
  private drawGridPlanes(vp: Mat4, eye: [number, number, number]): void {
    const tc = this.tickCube;
    if (!this.gridVao || (tc.x.length + tc.y.length + tc.z.length) === 0) return;
    const sx = eye[0] > 0 ? -1 : 1; // grid on the far wall so data stays unobscured
    const sy = eye[1] > 0 ? -1 : 1;
    const sz = eye[2] > 0 ? -1 : 1;
    const seg: number[] = [];
    const L = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      seg.push(x0, y0, z0, x1, y1, z1);
    // Plane ⟂ X (at x=sx): lines of constant y (vary z) and constant z (vary y).
    for (const cy of tc.y) L(sx, cy, -1, sx, cy, 1);
    for (const cz of tc.z) L(sx, -1, cz, sx, 1, cz);
    // Plane ⟂ Y (floor/ceiling, at y=sy).
    for (const cx of tc.x) L(cx, sy, -1, cx, sy, 1);
    for (const cz of tc.z) L(-1, sy, cz, 1, sy, cz);
    // Plane ⟂ Z (at z=sz).
    for (const cx of tc.x) L(cx, -1, sz, cx, 1, sz);
    for (const cy of tc.y) L(-1, cy, sz, 1, cy, sz);

    const gl = this.gl;
    gl.bindVertexArray(this.gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seg), gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(this.lineUniforms.uVP!, false, vp);
    gl.uniform4f(this.lineUniforms.uColor!, 0.55, 0.6, 0.72, 0.22);
    gl.drawArrays(gl.LINES, 0, seg.length / 3);
    gl.bindVertexArray(null);
  }

  render(): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    sizeShared(gl, w, h);
    begin3D(gl);
    gl.viewport(0, 0, w, h);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], this.bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { vp, mvp, eye } = this.viewProj();

    gl.useProgram(this.lineProgram);
    // Back-wall grid planes (behind the data).
    if (this.gridPlanes) this.drawGridPlanes(vp, eye);
    gl.uniformMatrix4fv(this.lineUniforms.uVP!, false, vp);
    // Bounding box.
    gl.uniform4f(this.lineUniforms.uColor!, 0.6, 0.65, 0.75, 0.4);
    gl.bindVertexArray(this.boxVao);
    gl.drawArrays(gl.LINES, 0, BOX_EDGES.length / 3);
    // Axis tick marks.
    if (this.tickCount > 0) {
      gl.uniform4f(this.lineUniforms.uColor!, 0.75, 0.8, 0.9, 0.8);
      gl.bindVertexArray(this.tickVao);
      gl.drawArrays(gl.LINES, 0, this.tickCount);
    }
    gl.bindVertexArray(null);

    // Camera in world space (volume layers raymarch in their local [0,1] space).
    const n = this.norm;
    const worldEye: [number, number, number] = [(eye[0] - n.tx) / n.sx, (eye[1] - n.ty) / n.sy, (eye[2] - n.tz) / n.sz];
    for (const l of this.layers) {
      if ("setCamera" in l) (l as VolumeLayer).setCamera(worldEye);
      l.draw(gl, mvp);
    }

    // Blit WebGL result, then draw projected axis labels on top.
    this.displayCtx.clearRect(0, 0, w, h);
    this.displayCtx.drawImage(this.sharedCanvas, 0, 0);
    this.drawLabels(vp, w, h);

    if (this.title) {
      const ctx = this.displayCtx;
      ctx.save();
      ctx.font = `600 ${15 * this.dpr}px system-ui, sans-serif`;
      ctx.fillStyle = "#e2e8f0";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(this.title, w / 2, 10 * this.dpr);
      ctx.restore();
    }
    if (this.hoverHit) {
      const ctx = this.displayCtx;
      ctx.save();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2 * this.dpr;
      ctx.beginPath();
      ctx.arc(this.hoverHit.sx, this.hoverHit.sy, 7 * this.dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    this.updateLegend();
    this.updateColorbar();
  }

  /** DOM legend of named, solid-colored layers. */
  private updateLegend(): void {
    const div = this.legendDiv;
    const entries = this.showLegend
      ? this.layers.filter((l): l is Layer3D & { name: string; colorCss: string } =>
          typeof l.name === "string" && !!l.name && typeof l.colorCss === "string")
      : [];
    if (entries.length === 0) { div.style.display = "none"; return; }
    div.replaceChildren();
    for (const e of entries) {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "6px" } as CSSStyleDeclaration);
      const sw = document.createElement("span");
      Object.assign(sw.style, { width: "10px", height: "10px", borderRadius: "2px", background: e.colorCss, flex: "0 0 auto" } as CSSStyleDeclaration);
      const label = document.createElement("span");
      label.textContent = e.name;
      row.appendChild(sw); row.appendChild(label);
      div.appendChild(row);
    }
    div.style.display = "block";
  }

  /** DOM colorbar for the first colormapped layer (gradient + value range). */
  private updateColorbar(): void {
    const div = this.colorbarDiv;
    if (this.colorbarOpt === false) { div.style.display = "none"; return; }
    let info = null as ReturnType<NonNullable<Layer3D["colorInfo"]>> | null;
    for (const l of this.layers) {
      const ci = l.colorInfo?.();
      if (ci) { info = ci; break; }
    }
    if (!info) { div.style.display = "none"; return; }
    const cmap = colormap(info.colormap);
    // 12-stop CSS gradient. `to top` puts 0% at the bottom, so cmap(t) at t·100%
    // makes the high value (cmap(1)) sit at the top, matching the tick labels.
    const stops: string[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const [r, g, b] = cmap(t);
      stops.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${t * 100}%`);
    }
    const label = (typeof this.colorbarOpt === "object" ? this.colorbarOpt.label : undefined) ?? info.label;
    div.replaceChildren();
    if (label) {
      const cap = document.createElement("div");
      cap.textContent = label;
      cap.style.marginBottom = "3px";
      div.appendChild(cap);
    }
    const rowWrap = document.createElement("div");
    Object.assign(rowWrap.style, { display: "flex", alignItems: "stretch", gap: "4px", justifyContent: "flex-end" } as CSSStyleDeclaration);
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      width: "10px", height: "90px", borderRadius: "2px",
      background: `linear-gradient(to top, ${stops.join(",")})`,
      border: "1px solid rgba(148,163,184,0.3)",
    } as CSSStyleDeclaration);
    const ticks = document.createElement("div");
    Object.assign(ticks.style, { display: "flex", flexDirection: "column", justifyContent: "space-between" } as CSSStyleDeclaration);
    const hi = document.createElement("span"); hi.textContent = defaultFormat(info.domain[1]);
    const mid = document.createElement("span"); mid.textContent = defaultFormat((info.domain[0] + info.domain[1]) / 2);
    const lo = document.createElement("span"); lo.textContent = defaultFormat(info.domain[0]);
    ticks.appendChild(hi); ticks.appendChild(mid); ticks.appendChild(lo);
    rowWrap.appendChild(ticks); rowWrap.appendChild(bar);
    div.appendChild(rowWrap);
    div.style.display = "block";
  }

  private drawLabels(vp: Mat4, w: number, h: number): void {
    if (this.labels.length === 0) return;
    const ctx = this.displayCtx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#cbd5e1";
    for (const lab of this.labels) {
      const c = transformPoint(vp, lab.p[0], lab.p[1], lab.p[2]);
      if (c[3] <= 0) continue;
      const sx = (c[0] / c[3] * 0.5 + 0.5) * w;
      const sy = (1 - (c[1] / c[3] * 0.5 + 0.5)) * h;
      ctx.font = `${(lab.title ? 13 : 11) * this.dpr}px system-ui, sans-serif`;
      ctx.fillStyle = lab.title ? "#e2e8f0" : "#94a3b8";
      ctx.fillText(lab.text, sx, sy);
    }
    ctx.restore();
  }

  private attachControls(): void {
    const el = this.canvas;
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    let dragging = false, lastX = 0, lastY = 0;
    el.addEventListener("pointerdown", (e) => {
      dragging = true; this.interacting = true; lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing";
      this.tooltip.style.display = "none"; // no hover while orbiting
      this.hoverHit = null;
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) {
        this.updateHover(e.clientX, e.clientY);
        return;
      }
      this.azimuth -= (e.clientX - lastX) * 0.01;
      this.elevation += (e.clientY - lastY) * 0.01;
      lastX = e.clientX; lastY = e.clientY;
      this.requestRender();
    });
    el.addEventListener("pointerleave", () => {
      this.tooltip.style.display = "none";
      if (this.hoverHit) { this.hoverHit = null; this.requestRender(); }
    });
    const end = (e: PointerEvent) => {
      dragging = false; this.interacting = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = "grab";
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.distance = Math.max(0.5, Math.min(20, this.distance * Math.exp(e.deltaY * 0.001)));
      this.requestRender();
    }, { passive: false });
  }

  private buildControls(): void {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "absolute", top: "8px", left: "8px", zIndex: "5",
      display: "flex", flexDirection: "column", gap: "4px",
      padding: "8px 10px", borderRadius: "8px",
      background: "rgba(15,23,42,0.8)", border: "1px solid rgba(148,163,184,0.25)",
      font: "11px system-ui, sans-serif", color: "#cbd5e1", backdropFilter: "blur(6px)",
    } as CSSStyleDeclaration);
    const row = (label: string, min: number, max: number, val: number, on: (v: number) => void) => {
      const wrap = document.createElement("label");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "6px";
      const span = document.createElement("span");
      span.textContent = label;
      span.style.width = "48px";
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min); input.max = String(max); input.value = String(val);
      input.style.width = "90px";
      input.addEventListener("input", () => on(parseFloat(input.value)));
      wrap.appendChild(span); wrap.appendChild(input);
      panel.appendChild(wrap);
    };
    row("light", 0, 360, (this.lightAz * 180) / Math.PI, (v) => this.setLight({ azimuth: (v * Math.PI) / 180 }));
    row("ambient", 0, 100, this.ambient * 100, (v) => this.setLight({ ambient: v / 100 }));
    this.container.appendChild(panel);
    this.controlsEl = panel;
  }
}
