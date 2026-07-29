import { describe, expect, it } from "vitest";
import { zoomFits } from "../src/plot.js";
import { LinearScale, LogScale, TimeScale } from "../src/scales/scale.js";
import type { Range, Scale } from "../src/scales/scale.js";

/**
 * One wheel step, exactly as `Plot.zoomAround` takes it.
 *
 * Reproduced here rather than driven through `Plot`, which needs a DOM and a
 * WebGL context. The arithmetic is what matters and it is copied verbatim.
 */
function wheelStep(scale: Scale, factor: number, data?: Range, nx = 0.5): void {
  const t = nx * (1 - factor);
  const lo = scale.invert(t);
  const hi = scale.invert(t + factor);
  if (zoomFits(scale, lo, hi, data)) scale.domain = [lo, hi];
}

/** The same step with no guard — how it used to be. */
function unguardedStep(scale: Scale, factor: number, nx = 0.5): void {
  const t = nx * (1 - factor);
  scale.domain = [scale.invert(t), scale.invert(t + factor)];
}

/** What a wheel notch means: the core reads deltaY as factor = exp(deltaY/1000). */
const OUT = Math.exp(0.1);
const IN = Math.exp(-0.1);

const span = (s: Scale) => s.domain[1] - s.domain[0];

describe("zoomFits", () => {
  const linear = new LinearScale([0, 10]);

  it("refuses a domain that is not finite", () => {
    expect(zoomFits(linear, 0, Infinity)).toBe(false);
    expect(zoomFits(linear, -Infinity, 0)).toBe(false);
    expect(zoomFits(linear, NaN, 1)).toBe(false);
    // Two finite ends whose difference is not.
    expect(zoomFits(linear, -1e308, 1e308)).toBe(false);
  });

  it("bounds zooming out by the data's own extent", () => {
    const data: Range = [0, 10];
    expect(zoomFits(linear, -5e9, 5e9, data)).toBe(true); // 1e9 x the extent
    expect(zoomFits(linear, -5e10, 5e10, data)).toBe(false);
  });

  it("bounds zooming in by what a double can still tell apart", () => {
    // Near 1000 the gap between adjacent doubles is about 1.1e-13.
    expect(zoomFits(linear, 1000, 1000 + 1e-9)).toBe(true);
    expect(zoomFits(linear, 1000, 1000 + 1e-13)).toBe(false);
    // A view centred on zero has no such floor: doubles get denser, not sparser.
    expect(zoomFits(linear, -1e-300, 1e-300)).toBe(true);
  });

  it("leaves a legitimate deep zoom alone", () => {
    // One millisecond on an epoch-ms axis — 6e-13 of its own magnitude, and a
    // perfectly ordinary thing to want to look at.
    const time = new TimeScale([1.7e12, 1.7e12 + 86_400_000]);
    const start = 1.7e12;
    expect(zoomFits(time, start, start + 1, [start, start + 86_400_000])).toBe(true);
  });

  it("only checks that a log axis stays finite", () => {
    // A log axis zooms in log space, where the numbers stay within a few
    // hundred; what breaks it is the exponential overflowing.
    const log = new LogScale([1, 1000]);
    expect(zoomFits(log, 1e-200, 1e200, [1, 1000])).toBe(true);
    expect(zoomFits(log, 1, Infinity, [1, 1000])).toBe(false);
  });

  it("allows any finite view when there is nothing plotted", () => {
    expect(zoomFits(linear, -1e30, 1e30)).toBe(true);
  });
});

describe("zooming out and back", () => {
  const data: Range = [0, 10];

  it("returns the view instead of losing it", () => {
    const scale = new LinearScale([0, 10]);

    for (let i = 0; i < 3000; i++) wheelStep(scale, OUT, data);
    const wide = span(scale);
    expect(Number.isFinite(wide)).toBe(true);
    expect(wide).toBeLessThanOrEqual(1e9 * 10 * 1.001);
    expect(wide).toBeGreaterThan(1e8);

    // The far end is a wall: further zooming out does not move.
    for (let i = 0; i < 20; i++) wheelStep(scale, OUT, data);
    expect(span(scale)).toBe(wide);

    // All the way in, then all the way back out. This is the round trip that
    // used to end with both ends of the domain on the same number.
    for (let i = 0; i < 3000; i++) wheelStep(scale, IN, data);
    expect(scale.domain[0]).not.toBe(scale.domain[1]);

    for (let i = 0; i < 3000; i++) wheelStep(scale, OUT, data);
    // Back at the wall, within the one notch the refused step costs.
    expect(span(scale)).toBeLessThanOrEqual(wide);
    expect(span(scale)).toBeGreaterThan(wide / 1.2);
    // And still centred on the data it started over.
    const centre = (scale.domain[0] + scale.domain[1]) / 2;
    expect(Math.abs(centre - 5)).toBeLessThan(wide * 1e-6);
  });

  it("without the guard, the same round trip destroys the view", () => {
    // The control. Not a test of our code but of the arithmetic underneath it:
    // zooming about a point keeps that point fixed, and keeps the rounding
    // error in it too, so by 1e130 wide the centre has drifted further than the
    // view is ever going to be narrow again.
    const scale = new LinearScale([0, 10]);
    for (let i = 0; i < 3000; i++) unguardedStep(scale, OUT);
    expect(span(scale)).toBeGreaterThan(1e100);

    for (let i = 0; i < 3000; i++) unguardedStep(scale, IN);
    // The view came back to roughly the right *width* and to entirely the wrong
    // place: the centre started at 5 and is now past 1e100, so the series is not
    // merely off screen, it is a hundred orders of magnitude away. Depending on
    // where the arithmetic lands, the two ends may also have rounded onto the
    // same number, which is what wedges it for good.
    const centre = (scale.domain[0] + scale.domain[1]) / 2;
    expect(Math.abs(centre)).toBeGreaterThan(1e100);
    expect(scale.norm(0)).toBeLessThan(-1e10);  // x = 0 is nowhere near the view

    // And zooming back out does not rescue it — the centre is preserved.
    for (let i = 0; i < 3000; i++) unguardedStep(scale, OUT);
    expect(Math.abs((scale.domain[0] + scale.domain[1]) / 2)).toBeGreaterThan(1e100);
  });

  it("keeps a log axis positive and ordered however far it is zoomed", () => {
    const scale = new LogScale([1, 1e6]);
    for (let i = 0; i < 3000; i++) wheelStep(scale, OUT, [1, 1e6]);
    expect(scale.domain[0]).toBeGreaterThan(0);
    expect(scale.domain[1]).toBeGreaterThan(scale.domain[0]);
    expect(Number.isFinite(scale.domain[1])).toBe(true);

    for (let i = 0; i < 3000; i++) wheelStep(scale, IN, [1, 1e6]);
    expect(scale.domain[0]).toBeGreaterThan(0);
    expect(scale.domain[1]).toBeGreaterThan(scale.domain[0]);
  });
});
