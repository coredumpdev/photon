import { describe, expect, it } from "vitest";
import {
  CategoricalScale, LinearScale, LogScale, OrdinalTimeScale, TimeScale, makeScale,
} from "../src/scales/scale.js";

describe("LinearScale", () => {
  it("normalizes and inverts", () => {
    const s = new LinearScale([0, 10]);
    expect(s.norm(5)).toBeCloseTo(0.5);
    expect(s.invert(0.5)).toBeCloseTo(5);
    expect(s.log).toBe(false);
  });
});

describe("LogScale", () => {
  it("maps decades linearly in log space", () => {
    const s = new LogScale([1, 1000]);
    expect(s.norm(1)).toBeCloseTo(0);
    expect(s.norm(1000)).toBeCloseTo(1);
    expect(s.norm(10)).toBeCloseTo(1 / 3);
    expect(s.invert(1 / 3)).toBeCloseTo(10);
    expect(s.log).toBe(true);
  });
  it("emits decade majors with 2..9 minors", () => {
    const ticks = new LogScale([1, 100]).ticks();
    const majors = ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(majors).toContain(1);
    expect(majors).toContain(10);
    expect(majors).toContain(100);
    expect(ticks.some((t) => t.minor && t.value === 50)).toBe(true);
  });
  it("sanitizes non-positive bounds", () => {
    const s = new LogScale([0, 100]);
    expect(s.domain[0]).toBeGreaterThan(0);
  });
});

describe("TimeScale", () => {
  it("is linear over epoch millis", () => {
    const s = new TimeScale([0, 1000]);
    expect(s.norm(500)).toBeCloseTo(0.5);
  });
  it("produces ticks inside the domain", () => {
    const day = 86_400_000;
    const s = new TimeScale([0, day]);
    const ticks = s.ticks();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.value >= 0 && t.value <= day)).toBe(true);
  });
});

describe("CategoricalScale", () => {
  it("fixes the domain to the factor bands", () => {
    const s = new CategoricalScale(["a", "b", "c"]);
    expect(s.domain).toEqual([-0.5, 2.5]);
    expect(s.log).toBe(false);
  });
  it("places factors at band centres", () => {
    const s = new CategoricalScale(["a", "b", "c"]);
    expect(s.norm(0)).toBeCloseTo(1 / 6);
    expect(s.norm(1)).toBeCloseTo(0.5);
    expect(s.norm(2)).toBeCloseTo(5 / 6);
  });
  it("inverts continuously; round() gives the nearest factor index", () => {
    const s = new CategoricalScale(["a", "b", "c"]);
    expect(s.invert(0.5)).toBeCloseTo(1);
    expect(s.invert(1 / 6)).toBeCloseTo(0);
    expect(Math.round(s.invert(0.83))).toBe(2);
  });
  it("emits one gridless tick per factor", () => {
    const ticks = new CategoricalScale(["a", "b", "c"]).ticks();
    expect(ticks.map((t) => t.value)).toEqual([0, 1, 2]);
    expect(ticks.map((t) => t.label)).toEqual(["a", "b", "c"]);
    expect(ticks.every((t) => t.grid === false)).toBe(true);
  });
  it("formats a value to its (rounded) factor label", () => {
    const s = new CategoricalScale(["a", "b", "c"]);
    expect(s.formatTick(1)).toBe("b");
    expect(s.formatTick(0.4)).toBe("a");
    expect(s.formatTick(2.4)).toBe("c");
  });
  it("is built by makeScale with factors", () => {
    const s = makeScale("categorical", undefined, ["x", "y"]);
    expect(s).toBeInstanceOf(CategoricalScale);
    expect(s.domain).toEqual([-0.5, 1.5]);
    expect(s.log).toBe(false);
  });
  it("handles empty factors", () => {
    const s = new CategoricalScale([]);
    expect(s.domain).toEqual([-0.5, 0.5]);
    expect(s.ticks()).toHaveLength(0);
    expect(s.formatTick(0)).toBe("");
  });
});

describe("OrdinalTimeScale", () => {
  const DAY = 86_400_000, HOUR = 3_600_000;
  // Six bars across three calendar days, two bars per day, with big overnight gaps.
  const base = Date.UTC(2024, 0, 1, 9, 0, 0);
  const times = [base, base + HOUR, base + DAY, base + DAY + HOUR, base + 2 * DAY, base + 2 * DAY + HOUR];

  it("fixes the domain to the index bands", () => {
    const s = new OrdinalTimeScale(times);
    expect(s.domain).toEqual([-0.5, 5.5]);
    expect(s.type).toBe("ordinal-time");
    expect(s.log).toBe(false);
  });

  it("collapses market gaps: bars are evenly spaced regardless of time deltas", () => {
    const even = new OrdinalTimeScale(times).norm.bind(new OrdinalTimeScale(times));
    // An irregularly-timed series with the same COUNT must map to identical positions.
    const irregular = [0, 1, 2, 100, 101, 5000].map((k) => base + k * HOUR);
    const a = new OrdinalTimeScale(times);
    const b = new OrdinalTimeScale(irregular);
    for (let i = 0; i < 6; i++) expect(a.norm(i)).toBeCloseTo(b.norm(i));
    // Index i sits at its band centre, like a categorical axis.
    expect(a.norm(0)).toBeCloseTo(1 / 12);
    expect(even(2)).toBeCloseTo((2 + 0.5) / 6);
  });

  it("places calendar-boundary ticks at integer indices with labels", () => {
    const s = new OrdinalTimeScale(times);
    const ticks = s.ticks();
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(Number.isInteger(t.value)).toBe(true);
      expect(t.value).toBeGreaterThanOrEqual(0);
      expect(t.value).toBeLessThanOrEqual(5);
      expect(typeof t.label).toBe("string");
      expect(t.label!.length).toBeGreaterThan(0);
    }
  });

  it("formats a value from the timestamp at its (rounded) index", () => {
    const s = new OrdinalTimeScale(times);
    expect(s.formatTick(0)).toMatch(/\d/);
  });

  it("is built by makeScale from a times array", () => {
    const s = makeScale("ordinal-time", undefined, undefined, times);
    expect(s).toBeInstanceOf(OrdinalTimeScale);
    expect(s.domain).toEqual([-0.5, 5.5]);
  });

  it("handles empty times", () => {
    const s = new OrdinalTimeScale([]);
    expect(s.domain).toEqual([-0.5, 0.5]);
    expect(s.ticks()).toHaveLength(0);
  });
});
