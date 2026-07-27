/** A live waterfall: push one PSD column per frame, the clock rides down with it. */
import { Plot, addWaterfall, welch } from "@photonviz/core";
import { BASE, gauss, rng } from "./_data";

export default (el: HTMLElement) => {
  const next = rng(7);
  const SR = 8000, WIN = 1024, HOP = 128, SEG = 512;
  const ROWS = 200, COLS = 256;
  const TAU = Math.PI * 2;

  // Two steady tones plus one climbing 200 → 2600 Hz, in noise. Phase is
  // integrated per sample, so the climbing tone's frequency is the one we set.
  let pA = 0, pB = 0, pS = 0, sweep = 0;
  const sample = (): number => {
    pA += (TAU * 700) / SR;
    pB += (TAU * 2000) / SR;
    pS += (TAU * (200 + 2400 * (sweep / 12))) / SR;
    sweep += 1 / SR;
    if (sweep >= 12) sweep = 0;
    return Math.sin(pA) + 0.6 * Math.sin(pB) + 0.9 * Math.sin(pS) + gauss(next, 0, 0.35);
  };
  const buf = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) buf[i] = sample();

  const plot = new Plot(el, {
    ...BASE,
    title: "Waterfall — frequency across, time down",
    margin: { left: 72 },
    axes: { x: { title: "Hz" } },
  });
  const wf = addWaterfall(plot, {
    extent: [0, SR / 2],
    cols: COLS,
    rows: ROWS,
    rowSeconds: HOP / SR,          // 16ms per row → 3.2s of history
    domain: [-70, -20],
    colormap: "plasma",
    name: "dB",
    timeFormat: "mm:ss.mmm",
    timeTitle: "time",
  });

  const db = new Float64Array(SEG >> 1);
  let frame = 0;
  const tick = (): void => {
    buf.copyWithin(0, HOP);
    for (let k = WIN - HOP; k < WIN; k++) buf[k] = sample();
    const { power } = welch(buf, { sampleRate: SR, segment: SEG, window: "hann" });
    for (let b = 0; b < db.length; b++) db[b] = 10 * Math.log10(power[b]! + 1e-20);
    wf.push(db);
    plot.render();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    plot.destroy();
  };
};
