import { describe, expect, it } from "vitest";
import { Axis } from "../src/axes/axis.js";
import { autoTicks, defaultFormat, resolveTicks, withMinorTicks } from "../src/axes/ticks.js";
import { LinearScale } from "../src/scales/scale.js";

const lin = (a: number, b: number) => new LinearScale([a, b]);

describe("autoTicks", () => {
  it("produces nice round values within range", () => {
    const ticks = autoTicks(0, 100).map((t) => t.value);
    expect(ticks[0]).toBe(0);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks.every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it("handles negative ranges and snaps zero", () => {
    expect(autoTicks(-5, 5).map((t) => t.value)).toContain(0);
  });

  it("returns empty for degenerate ranges", () => {
    expect(autoTicks(3, 3)).toEqual([]);
    expect(autoTicks(NaN, 1)).toEqual([]);
  });
});

describe("withMinorTicks", () => {
  it("inserts the requested count between majors", () => {
    const all = withMinorTicks([{ value: 0 }, { value: 10 }], 4);
    expect(all).toHaveLength(6);
    const minors = all.filter((t) => t.minor);
    expect(minors.map((m) => m.value)).toEqual([2, 4, 6, 8]);
    expect(minors.every((m) => m.grid === false)).toBe(true);
  });
});

describe("resolveTicks", () => {
  it("returns null when no spec is given (auto mode)", () => {
    expect(resolveTicks(undefined, 0, 1)).toBeNull();
  });
  it("normalizes and sorts a number[] spec", () => {
    expect(resolveTicks([5, 1, 3], 0, 10)?.map((t) => t.value)).toEqual([1, 3, 5]);
  });
  it("supports a generator of the range", () => {
    const ticks = resolveTicks((min, max) => [min, (min + max) / 2, max], 0, 8);
    expect(ticks?.map((t) => t.value)).toEqual([0, 4, 8]);
  });
});

describe("Axis.resolve", () => {
  it("fills labels via format and clips out-of-range ticks", () => {
    const axis = new Axis({ ticks: [-1, 0, 5, 99], format: (v) => `v${v}` });
    const ticks = axis.resolve(lin(0, 10));
    expect(ticks.map((t) => t.value)).toEqual([0, 5]);
    expect(ticks[0]!.label).toBe("v0");
  });
  it("keeps explicit labels over the formatter", () => {
    const axis = new Axis({ ticks: [{ value: 3.14, label: "π" }] });
    expect(axis.resolve(lin(0, 10))[0]!.label).toBe("π");
  });
  it("layers addTicks on top of auto ticks", () => {
    const axis = new Axis({ addTicks: [{ value: 42, label: "threshold" }] });
    const t = axis.resolve(lin(0, 100)).find((x) => x.value === 42);
    expect(t?.label).toBe("threshold");
  });
  it("delegates auto ticks to the scale", () => {
    const ticks = new Axis().resolve(lin(0, 100)).map((t) => t.value);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

describe("defaultFormat", () => {
  it("formats zero, small, and large numbers sanely", () => {
    expect(defaultFormat(0)).toBe("0");
    expect(defaultFormat(1234.5)).toBe("1234.5");
    expect(defaultFormat(1e7)).toMatch(/e/);
  });
});
