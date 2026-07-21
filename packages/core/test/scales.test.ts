import { describe, expect, it } from "vitest";
import { LinearScale, LogScale, TimeScale } from "../src/scales/scale.js";

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
