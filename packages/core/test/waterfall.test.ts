import { describe, expect, it } from "vitest";
import { blockMax, formatDuration, niceTimeStep, waterfallRowTicks, waterfallTimeTicks } from "../src/stats/waterfall.js";

describe("formatDuration", () => {
  it("writes hh:mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(1)).toBe("00:00:01");
    expect(formatDuration(61)).toBe("00:01:01");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(86_399)).toBe("23:59:59");
    // Past a day it keeps counting hours rather than wrapping.
    expect(formatDuration(90_061)).toBe("25:01:01");
  });

  it("writes mm:ss.mmm", () => {
    expect(formatDuration(0, "mm:ss.mmm")).toBe("00:00.000");
    expect(formatDuration(1.5, "mm:ss.mmm")).toBe("00:01.500");
    expect(formatDuration(0.007, "mm:ss.mmm")).toBe("00:00.007");
    expect(formatDuration(125.25, "mm:ss.mmm")).toBe("02:05.250");
  });

  it("carries a rounded millisecond instead of printing a 4th digit", () => {
    expect(formatDuration(59.9999, "mm:ss.mmm")).toBe("01:00.000");
    expect(formatDuration(0.9999, "mm:ss.mmm")).toBe("00:01.000");
    expect(formatDuration(59.6)).toBe("00:01:00");
  });

  it("marks negatives and refuses non-finite", () => {
    expect(formatDuration(-61)).toBe("-00:01:01");
    expect(formatDuration(NaN)).toBe("—");
    expect(formatDuration(Infinity, "mm:ss.mmm")).toBe("—");
  });
});

describe("niceTimeStep", () => {
  it("picks a step a clock reads naturally", () => {
    expect(niceTimeStep(32, 8)).toBe(5);
    expect(niceTimeStep(8, 8)).toBe(1);
    expect(niceTimeStep(0.5, 5)).toBe(0.1);
    expect(niceTimeStep(600, 8)).toBe(120);
  });

  it("never returns zero, however small the span", () => {
    expect(niceTimeStep(1e-9, 8)).toBe(0.001);
    expect(niceTimeStep(0, 8)).toBe(0.001);
  });

  it("keeps scaling past an hour", () => {
    expect(niceTimeStep(86_400, 8)).toBeGreaterThanOrEqual(3600);
  });
});

describe("waterfallTimeTicks", () => {
  const SPAN = 32;

  it("puts the newest row at the top of the axis and older rows below", () => {
    const ticks = waterfallTimeTicks(60, SPAN, { count: 8 });
    expect(ticks.length).toBeGreaterThan(2);
    // value = span - age, so later times sit higher and all land inside the axis.
    for (const t of ticks) {
      expect(t.value).toBeGreaterThanOrEqual(0);
      expect(t.value).toBeLessThanOrEqual(SPAN);
    }
    const values = ticks.map((t) => t.value);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(ticks.at(-1)!.value).toBeGreaterThan(ticks[0]!.value);
  });

  it("labels each tick with the clock of the row it sits on", () => {
    const ticks = waterfallTimeTicks(40, SPAN, { count: 8 });   // step 5s → 10…40
    expect(ticks[0]).toEqual({ value: SPAN - (40 - 10), label: "00:00:10" });
    expect(ticks.at(-1)).toEqual({ value: SPAN, label: "00:00:40" });
  });

  it("labels ride down as the clock advances", () => {
    const step = niceTimeStep(SPAN, 8);
    const a = waterfallTimeTicks(40, SPAN, { count: 8 });
    const b = waterfallTimeTicks(40 + step, SPAN, { count: 8 });
    const sameLabel = b.find((t) => t.label === a.at(-1)!.label)!;
    expect(sameLabel.value).toBeCloseTo(a.at(-1)!.value - step, 9);
  });

  it("emits nothing for rows before the stream started", () => {
    // Only 3s in: everything below 00:00:03 is history that never happened.
    const ticks = waterfallTimeTicks(3, SPAN, { count: 8, startTime: 0 });
    expect(ticks.every((t) => t.value >= SPAN - 3 - 1e-9)).toBe(true);
    expect(ticks.every((t) => t.label >= "00:00:00")).toBe(true);
  });

  it("honours a start offset and a custom formatter", () => {
    const ticks = waterfallTimeTicks(100, SPAN, { count: 4, startTime: 90 });
    expect(ticks[0]!.label >= "00:01:30").toBe(true);
    const custom = waterfallTimeTicks(40, SPAN, { count: 4, format: (s) => `t${s}` });
    expect(custom[0]!.label.startsWith("t")).toBe(true);
  });

  it("uses millisecond labels when asked", () => {
    const ticks = waterfallTimeTicks(1, 0.5, { count: 5, format: "mm:ss.mmm" });
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.at(-1)!.label).toBe("00:01.000");
    expect(/^\d{2}:\d{2}\.\d{3}$/.test(ticks[0]!.label!)).toBe(true);
  });

  it("returns nothing for a degenerate span", () => {
    expect(waterfallTimeTicks(10, 0)).toEqual([]);
    expect(waterfallTimeTicks(NaN, 10)).toEqual([]);
  });
});

describe("blockMax", () => {
  it("keeps the loudest bin of every block", () => {
    const col = [0, 9, 0, 0, /**/ 1, 1, 1, 1, /**/ 0, 0, 7, 0];
    expect(Array.from(blockMax(col, 3))).toEqual([9, 1, 7]);
  });

  it("lets a two-bin peak survive a 100:1 reduction", () => {
    const col = new Float64Array(1000).fill(-80);
    col[500] = -5; col[501] = -6;
    const out = blockMax(col, 10);
    expect(Math.max(...out)).toBe(-5);
    expect(out[5]).toBe(-5);
  });

  it("copies a column that already fits", () => {
    expect(Array.from(blockMax([3, 1, 2], 3))).toEqual([3, 1, 2]);
  });

  it("stretches a short column by nearest sample", () => {
    expect(Array.from(blockMax([1, 2], 4))).toEqual([1, 1, 2, 2]);
  });

  it("handles blocks that do not divide evenly", () => {
    // 5 into 2: floor boundaries → [0,1] and [2,3,4].
    expect(Array.from(blockMax([1, 5, 2, 9, 3], 2))).toEqual([5, 9]);
  });
});

describe("waterfallRowTicks", () => {
  /** Row clocks for a waterfall fed every `rowSeconds`, oldest first. */
  const uniform = (rows: number, rowSeconds: number, now: number): Float64Array =>
    Float64Array.from({ length: rows }, (_, i) => now - (rows - 1 - i) * rowSeconds);

  it("agrees with the uniform formula when the rows are evenly spaced", () => {
    const rows = 40;
    const rowSeconds = 0.25;
    const span = rows * rowSeconds;
    const times = uniform(rows, rowSeconds, 30);

    const even = waterfallRowTicks(times, span);
    const uniformTicks = waterfallTimeTicks(30, span, { startTime: times[0]! });

    expect(even.map((t) => t.label)).toEqual(uniformTicks.map((t) => t.label));
    for (let i = 0; i < even.length; i++) {
      expect(even[i]!.value).toBeCloseTo(uniformTicks[i]!.value, 6);
    }
  });

  it("interpolates rows that did not arrive on a cadence", () => {
    // A baud pane: ten rows over four and a half seconds, irregularly.
    const times = Float64Array.from([0, 0.31, 0.74, 1.02, 1.55, 2.1, 2.2, 3.4, 3.9, 4.6]);
    const ticks = waterfallRowTicks(times, 10, { format: "mm:ss.mmm" });

    expect(ticks.length).toBeGreaterThan(1);
    // Ascending in both clock and position, and inside the image.
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]!.value).toBeGreaterThan(0);
      expect(ticks[i]!.value).toBeLessThanOrEqual(10);
      if (i > 0) expect(ticks[i]!.value).toBeGreaterThan(ticks[i - 1]!.value);
    }
    // A clock landing exactly on a row sits at that row's top edge.
    const atRow4 = waterfallRowTicks(Float64Array.from([0, 2]), 2)[0]!;
    expect(atRow4.value).toBeCloseTo(1, 6);
  });

  it("labels only the rows that have streamed", () => {
    const times = Float64Array.from([NaN, NaN, NaN, 1, 2, 3]);
    const ticks = waterfallRowTicks(times, 6);
    expect(ticks.length).toBeGreaterThan(0);
    // Nothing is placed below the oldest row carrying a clock.
    for (const tick of ticks) expect(tick.value).toBeGreaterThanOrEqual(4);
  });

  it("gives a run's first row a label rather than nothing", () => {
    const ticks = waterfallRowTicks(Float64Array.from([NaN, NaN, 7]), 3);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.label).toBe(formatDuration(7));
  });

  it("returns nothing when no row carries a clock", () => {
    expect(waterfallRowTicks(Float64Array.from([NaN, NaN]), 2)).toEqual([]);
    expect(waterfallRowTicks(Float64Array.from([]), 2)).toEqual([]);
    expect(waterfallRowTicks(Float64Array.from([1, 2]), 0)).toEqual([]);
  });
});
