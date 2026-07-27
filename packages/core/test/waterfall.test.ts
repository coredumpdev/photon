import { describe, expect, it } from "vitest";
import { blockMax, formatDuration, niceTimeStep, waterfallTimeTicks } from "../src/stats/waterfall.js";

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
