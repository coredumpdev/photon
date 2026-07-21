import { autoTicks, defaultFormat } from "../axes/ticks.js";
import { createProgram, uniformLocations } from "../gl/program.js";
import { begin3D, getSharedGL, sizeShared } from "../gl/shared.js";
import type { Range } from "../types.js";
import type { Bounds3, Layer3D } from "./layer3d.js";
import { lookAt, multiply, perspective, scaleTranslate, transformPoint, type Mat4 } from "./mat4.js";
import { PointCloudLayer, type PointCloudOptions } from "./pointcloud.js";
import { SurfaceLayer, type SurfaceOptions } from "./surface.js";

export interface Plot3DOptions {
  background?: [number, number, number, number];
  azimuth?: number;
  elevation?: number;
  distance?: number;
  /** Axis titles drawn along the x / y (height) / z edges. */
  axisLabels?: { x?: string; y?: string; z?: string };
  /** Render a small on-canvas panel with light-angle + ambient sliders. */
  lightControls?: boolean;
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

  // Lighting.
  private lightAz = 0.9;
  private lightEl = 0.9;
  private ambient = 0.35;
  private controlsEl: HTMLElement | null = null;

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
    this.axisLabels = options.axisLabels ?? {};

    this.lineProgram = createProgram(this.gl, LINE_VERT, LINE_FRAG);
    this.lineUniforms = uniformLocations(this.gl, this.lineProgram, ["uVP", "uColor"]);
    this.boxVao = this.gl.createVertexArray()!;
    this.boxBuf = this.gl.createBuffer()!;
    this.bindLineVao(this.boxVao, this.boxBuf, BOX_EDGES);
    this.tickVao = this.gl.createVertexArray()!;
    this.tickBuf = this.gl.createBuffer()!;
    this.bindLineVao(this.tickVao, this.tickBuf, new Float32Array(0));

    if (options.lightControls) this.buildControls();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.attachControls();
    this.resize();
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

  destroy(): void {
    this.resizeObserver.disconnect();
    for (const l of this.layers) l.dispose();
    this.gl.deleteProgram(this.lineProgram);
    this.gl.deleteVertexArray(this.boxVao);
    this.gl.deleteVertexArray(this.tickVao);
    this.gl.deleteBuffer(this.boxBuf);
    this.gl.deleteBuffer(this.tickBuf);
    this.controlsEl?.remove();
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
    this.buildAxes();
  }

  /** Build tick-mark line geometry + tick/title labels from the data bounds. */
  private buildAxes(): void {
    const b = this.dataBounds;
    if (!b) return;
    const cube = (r: Range, v: number) => (2 * (v - r[0])) / ((r[1] - r[0]) || 1) - 1;
    const seg: number[] = [];
    const labels: Label[] = [];
    const mark = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      seg.push(x0, y0, z0, x1, y1, z1);

    for (const t of autoTicks(b.x[0], b.x[1], 5)) {
      const cx = cube(b.x, t.value);
      mark(cx, -1, -1, cx, -1, -1.06);
      labels.push({ p: [cx, -1, -1.16], text: defaultFormat(t.value) });
    }
    for (const t of autoTicks(b.y[0], b.y[1], 5)) {
      const cy = cube(b.y, t.value);
      mark(-1, cy, -1, -1.06, cy, -1);
      labels.push({ p: [-1.16, cy, -1], text: defaultFormat(t.value) });
    }
    for (const t of autoTicks(b.z[0], b.z[1], 5)) {
      const cz = cube(b.z, t.value);
      mark(-1, -1, cz, -1.06, -1, cz);
      labels.push({ p: [-1.16, -1, cz], text: defaultFormat(t.value) });
    }
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

  private viewProj(): { vp: Mat4; mvp: Mat4 } {
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
    return { vp, mvp: multiply(vp, this.normalize) };
  }

  render(): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    sizeShared(gl, w, h);
    begin3D(gl);
    gl.viewport(0, 0, w, h);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], this.bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { vp, mvp } = this.viewProj();

    gl.useProgram(this.lineProgram);
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

    for (const l of this.layers) l.draw(gl, mvp);

    // Blit WebGL result, then draw projected axis labels on top.
    this.displayCtx.clearRect(0, 0, w, h);
    this.displayCtx.drawImage(this.sharedCanvas, 0, 0);
    this.drawLabels(vp, w, h);
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
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.azimuth -= (e.clientX - lastX) * 0.01;
      this.elevation += (e.clientY - lastY) * 0.01;
      lastX = e.clientX; lastY = e.clientY;
      this.requestRender();
    });
    const end = (e: PointerEvent) => {
      dragging = false;
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
