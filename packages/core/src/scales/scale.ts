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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An **ordinal time** axis — the standard financial x-axis. Bars are plotted at
 * evenly-spaced integer indices `0..n-1` (like {@link CategoricalScale}, so the
 * domain is the band `[-0.5, n-1+0.5]`), which **collapses market gaps**
 * (weekends, overnight, holidays) instead of leaving blank space the way a real
 * {@link TimeScale} would. Each index carries a timestamp; ticks are placed at
 * natural calendar boundaries (day / month / year, or hour / minute when zoomed
 * in) and subsampled toward the target count, so labels stay readable at any zoom.
 *
 * Plot your candles/bars at `x = 0,1,2,…` and pass the per-bar epoch-ms `times`.
 */
export class OrdinalTimeScale implements Scale {
  readonly type = "ordinal-time";
  readonly log = false;
  times: number[];
  domain: Range;
  constructor(times: ArrayLike<number> = []) {
    this.times = Array.from({ length: times.length }, (_, i) => times[i]!);
    const n = this.times.length;
    this.domain = n > 0 ? [-0.5, n - 0.5] : [-0.5, 0.5];
  }
  norm(value: number): number {
    const [a, b] = this.domain;
    return b === a ? 0 : (value - a) / (b - a);
  }
  invert(t: number): number {
    const [a, b] = this.domain;
    return a + t * (b - a);
  }
  /** Timestamp at a (rounded, clamped) index. */
  private timeAt(i: number): number {
    const n = this.times.length;
    if (n === 0) return 0;
    const k = Math.max(0, Math.min(n - 1, Math.round(i)));
    return this.times[k]!;
  }
  ticks(target = 6): Tick[] {
    const n = this.times.length;
    if (n === 0) return [];
    const i0 = Math.max(0, Math.ceil(this.domain[0] - 1e-9));
    const i1 = Math.min(n - 1, Math.floor(this.domain[1] + 1e-9));
    if (i1 < i0) return [];

    // Calendar levels coarse→fine. Each `key` labels a bar's period; ticks land on
    // the FIRST bar of every period — so gridlines snap to real calendar dates
    // (month starts, Mondays, …) and stay put when you pan (no drift).
    const DAY = 86_400_000;
    const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
    const weekKey = (d: Date) => {
      const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dow = (m.getDay() + 6) % 7; // Monday = 0
      return Math.floor((m.getTime() - dow * DAY) / DAY);
    };
    const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    const monthLabel = (d: Date) => (d.getMonth() === 0 ? `${d.getFullYear()}` : MONTHS[d.getMonth()]!);
    const levels = [
      { key: (d: Date) => d.getFullYear(), label: (d: Date) => `${d.getFullYear()}` },
      { key: (d: Date) => d.getFullYear() * 4 + Math.floor(d.getMonth() / 3), label: monthLabel },
      { key: (d: Date) => d.getFullYear() * 12 + d.getMonth(), label: monthLabel },
      { key: weekKey, label: dayMonth },
      { key: dayKey, label: dayMonth },
      { key: (d: Date) => dayKey(d) * 4 + Math.floor(d.getHours() / 6), label: hhmm },
      { key: (d: Date) => dayKey(d) * 24 + d.getHours(), label: hhmm },
      { key: (d: Date) => (dayKey(d) * 24 + d.getHours()) * 4 + Math.floor(d.getMinutes() / 15), label: hhmm },
      { key: (d: Date) => (dayKey(d) * 24 + d.getHours()) * 60 + d.getMinutes(), label: hhmm },
    ];
    const periodStarts = (lvl: (typeof levels)[number]): number[] => {
      const out: number[] = [];
      let prev = i0 > 0 ? lvl.key(new Date(this.times[i0 - 1]!)) : NaN;
      for (let i = i0; i <= i1; i++) {
        const k = lvl.key(new Date(this.times[i]!));
        if (k !== prev) { out.push(i); prev = k; }
      }
      return out;
    };
    // Pick the level whose tick count is closest to `target` (penalize over-dense + too-sparse).
    let chosen: { lvl: (typeof levels)[number]; b: number[] } | null = null;
    let bestScore = Infinity;
    for (const lvl of levels) {
      const b = periodStarts(lvl);
      if (b.length === 0) continue;
      const over = b.length > target * 1.5 ? (b.length - target * 1.5) * 3 : 0;
      const sparse = b.length < 2 ? 100 : 0;
      const score = Math.abs(b.length - target) + over + sparse;
      if (score < bestScore) { bestScore = score; chosen = { lvl, b }; }
    }
    if (!chosen) {
      // No calendar change across the view (a few same-minute bars): space evenly.
      const out: Tick[] = [];
      const step = Math.max(1, Math.floor((i1 - i0) / Math.max(1, target - 1)));
      for (let i = i0; i <= i1; i += step) {
        const d = new Date(this.times[i]!);
        out.push({ value: i, label: `${dayMonth(d)} ${hhmm(d)}` });
      }
      return out;
    }
    const c = chosen;
    return c.b.map((i) => ({ value: i, label: c.lvl.label(new Date(this.times[i]!)) }));
  }
  formatTick(value: number): string {
    const d = new Date(this.timeAt(value));
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hhmm(d)}`;
  }
}

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export type ScaleType = "linear" | "log" | "time" | "categorical" | "ordinal-time";

export function makeScale(
  type: ScaleType, domain?: Range, factors?: string[], times?: ArrayLike<number>,
): Scale {
  switch (type) {
    case "linear":
      return new LinearScale(domain);
    case "log":
      return new LogScale(domain);
    case "time":
      return new TimeScale(domain);
    case "categorical":
      return new CategoricalScale(factors ?? []);
    case "ordinal-time":
      return new OrdinalTimeScale(times ?? []);
    default:
      throw new Error(`Unknown scale type: ${type as string}`);
  }
}
