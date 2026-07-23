// A tiny reusable Svelte action that drives an animated Photon plot.
//
// `setup(node)` creates whatever plot it likes (Plot / Plot3D / PolarPlot) and
// returns a per-frame `step(t)` plus a `destroy()`. The action owns the
// requestAnimationFrame loop, measures an EMA-smoothed FPS, and reports it via
// `onFps` (repainted ~4×/s). Because streaming is imperative (`setData` + render
// inside `step`), it does not depend on any reactive prop diffing — it always
// streams reliably. The rAF is cancelled and the plot destroyed on unmount.

export interface LiveHandle {
  /** Advance one frame. `t` is seconds-ish (frame / 60). Must render/refresh. */
  step: (t: number) => void;
  /** Tear down the underlying plot. */
  destroy: () => void;
}

export interface LiveConfig {
  setup: (node: HTMLElement) => LiveHandle;
  /** Called ~4×/s with the current rounded FPS. */
  onFps?: (fps: number) => void;
}

export function live(node: HTMLElement, cfg: LiveConfig) {
  const handle = cfg.setup(node);
  let frame = 0;
  let raf = 0;
  let fpsAvg = 0;
  let last = 0;
  let lastPaint = 0;

  const loop = (now: number): void => {
    frame++;
    handle.step(frame / 60);
    if (last > 0) {
      const dt = now - last;
      if (dt > 0) {
        const inst = 1000 / dt;
        fpsAvg = fpsAvg > 0 ? fpsAvg * 0.9 + inst * 0.1 : inst;
      }
    }
    if (cfg.onFps && now - lastPaint > 250) {
      lastPaint = now;
      cfg.onFps(Math.round(fpsAvg));
    }
    last = now;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      handle.destroy();
    },
  };
}
