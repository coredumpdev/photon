import { autoTicks, defaultFormat } from "../axes/ticks.js";
import type { Range, Tick } from "../types.js";

/**
 * A scale maps data-space values to normalized [0,1] and back, and knows how to
 * generate its own "nice" ticks + default label format. `log` tells layers to
 * apply a log10 transform on the GPU.
 */
export interface Scale {
  readonly type: string;
  readonly log: boolean;
  domain: Range;
  norm(value: number): number;
  invert(t: number): number;
  /** Auto ticks appropriate for this scale type. */
  ticks(target?: number): Tick[];
  /** Default label formatter for a tick value. */
  formatTick(value: number): string;
}

export class LinearScale implements Scale {
  readonly type = "linear";
  readonly log = false;
  domain: Range;
  constructor(domain: Range = [0, 1]) {
    this.domain = domain;
  }
  norm(value: number): number {
    const [a, b] = this.domain;
    return b === a ? 0 : (value - a) / (b - a);
  }
  invert(t: number): number {
    const [a, b] = this.domain;
    return a + t * (b - a);
  }
  ticks(target = 6): Tick[] {
    return autoTicks(this.domain[0], this.domain[1], target);
  }
  formatTick(value: number): string {
    return defaultFormat(value);
  }
}

export class LogScale implements Scale {
  readonly type = "log";
  readonly log = true;
  domain: Range;
  constructor(domain: Range = [1, 1000]) {
    this.domain = LogScale.sanitize(domain);
  }
  private static sanitize(d: Range): Range {
    // Log requires strictly positive bounds.
    const lo = d[0] > 0 ? d[0] : 1e-9;
    const hi = d[1] > lo ? d[1] : lo * 10;
    return [lo, hi];
  }
  private get la() {
    return Math.log10(this.domain[0]);
  }
  private get lb() {
    return Math.log10(this.domain[1]);
  }
  norm(value: number): number {
    if (value <= 0) return 0;
    return (Math.log10(value) - this.la) / (this.lb - this.la);
  }
  invert(t: number): number {
    return Math.pow(10, this.la + t * (this.lb - this.la));
  }
  ticks(): Tick[] {
    const [a, b] = this.domain;
    const lo = Math.floor(Math.log10(a));
    const hi = Math.ceil(Math.log10(b));
    const ticks: Tick[] = [];
    for (let e = lo; e <= hi; e++) {
      const base = Math.pow(10, e);
      ticks.push({ value: base });
      for (let m = 2; m <= 9; m++) ticks.push({ value: m * base, minor: true, grid: false });
    }
    return ticks;
  }
  formatTick(value: number): string {
    const e = Math.round(Math.log10(value));
    if (e <= -4 || e >= 5) return `1e${e}`;
    return defaultFormat(value);
  }
}

// Candidate time steps in milliseconds, coarse→fine chosen by target count.
const SECOND = 1000, MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const TIME_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, 365 * DAY,
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Linear over epoch-millisecond values, with calendar-aware ticks/labels. */
export class TimeScale implements Scale {
  readonly type = "time";
  readonly log = false;
  domain: Range;
  constructor(domain: Range = [0, DAY]) {
    this.domain = domain;
  }
  norm(value: number): number {
    const [a, b] = this.domain;
    return b === a ? 0 : (value - a) / (b - a);
  }
  invert(t: number): number {
    const [a, b] = this.domain;
    return a + t * (b - a);
  }
  private chooseStep(target: number): number {
    const ideal = (this.domain[1] - this.domain[0]) / target;
    for (const s of TIME_STEPS) if (s >= ideal) return s;
    return TIME_STEPS[TIME_STEPS.length - 1]!;
  }
  ticks(target = 6): Tick[] {
    const [a, b] = this.domain;
    if (!isFinite(a) || !isFinite(b) || a === b) return [];
    const step = this.chooseStep(target);
    const start = Math.ceil(a / step) * step;
    const ticks: Tick[] = [];
    for (let i = 0; i < 1000; i++) {
      const v = start + i * step;
      if (v > b) break;
      ticks.push({ value: v });
    }
    return ticks;
  }
  formatTick(value: number): string {
    const span = this.domain[1] - this.domain[0];
    const d = new Date(value);
    if (span < DAY) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (span < 90 * DAY) return `${d.getMonth() + 1}/${d.getDate()}`;
    return `${d.getFullYear()}`;
  }
}

/**
 * A categorical (factor) axis. Internally it is **linear over a band domain**
 * `[-0.5, n-0.5]`, so factor `i` sits at the band centre and `norm(i)` equals the
 * ordinary linear projection — the GPU transform needs no special handling, and a
 * layer plotting at integer indices lands on band centres automatically.
 * "Categorical-ness" lives only in the ticks/labels (one per factor).
 */
export class CategoricalScale implements Scale {
  readonly type = "categorical";
  readonly log = false;
  factors: string[];
  domain: Range;
  constructor(factors: string[] = []) {
    this.factors = factors;
    const n = factors.length;
    this.domain = n > 0 ? [-0.5, n - 0.5] : [-0.5, 0.5];
  }
  norm(value: number): number {
    const [a, b] = this.domain;
    return b === a ? 0 : (value - a) / (b - a);
  }
  // Continuous linear inverse (satisfies the Scale contract used by pan/box math).
  // The nearest factor index is `Math.round(scale.invert(t))`.
  invert(t: number): number {
    const [a, b] = this.domain;
    return a + t * (b - a);
  }
  ticks(): Tick[] {
    return this.factors.map((f, i) => ({ value: i, label: f, grid: false }));
  }
  formatTick(value: number): string {
    return this.factors[Math.round(value)] ?? "";
  }
}

export type ScaleType = "linear" | "log" | "time" | "categorical";

export function makeScale(type: ScaleType, domain?: Range, factors?: string[]): Scale {
  switch (type) {
    case "linear":
      return new LinearScale(domain);
    case "log":
      return new LogScale(domain);
    case "time":
      return new TimeScale(domain);
    case "categorical":
      return new CategoricalScale(factors ?? []);
    default:
      throw new Error(`Unknown scale type: ${type as string}`);
  }
}
