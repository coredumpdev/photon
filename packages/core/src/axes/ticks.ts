import type { Tick, TicksSpec } from "../types.js";

/**
 * Produce a "nice" step for an interval, e.g. 1, 2, 5 × 10^n.
 * Classic Wilkinson-style rounding used by most plotting libraries.
 */
function niceStep(rawStep: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag; // in [1, 10)
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

/**
 * Auto ticks for a linear axis using nice-number rounding.
 * Returns major ticks; minor ticks are added separately.
 */
export function autoTicks(min: number, max: number, target = 6): Tick[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [];
  const span = max - min;
  const step = niceStep(span / Math.max(1, target));
  const start = Math.ceil(min / step) * step;
  const ticks: Tick[] = [];
  // Guard against float drift accumulating over many steps.
  for (let i = 0; i < 1000; i++) {
    const v = start + i * step;
    if (v > max + step * 1e-6) break;
    // Snap tiny float errors to zero-ish clean values.
    ticks.push({ value: Math.abs(v) < step * 1e-6 ? 0 : v });
  }
  return ticks;
}

/** Insert `count` evenly spaced minor ticks between each pair of major ticks. */
export function withMinorTicks(major: Tick[], count: number): Tick[] {
  if (count <= 0 || major.length < 2) return major;
  const out: Tick[] = [];
  for (let i = 0; i < major.length; i++) {
    out.push(major[i]!);
    if (i < major.length - 1) {
      const a = major[i]!.value;
      const b = major[i + 1]!.value;
      const step = (b - a) / (count + 1);
      for (let k = 1; k <= count; k++) {
        out.push({ value: a + step * k, minor: true, grid: false });
      }
    }
  }
  return out;
}

/** Normalize a loose tick entry (number or partial Tick) into a full Tick. */
function normalize(entry: number | Tick): Tick {
  return typeof entry === "number" ? { value: entry } : entry;
}

/**
 * Resolve a user `TicksSpec` (array | Tick[] | generator) against the current
 * axis range into a concrete, sorted Tick list. Returns `null` if no explicit
 * spec was given, signaling the caller to fall back to auto ticks.
 */
export function resolveTicks(
  spec: TicksSpec | undefined,
  min: number,
  max: number,
): Tick[] | null {
  if (spec == null) return null;
  const raw = typeof spec === "function" ? spec(min, max) : spec;
  return raw.map(normalize).sort((a, b) => a.value - b.value);
}

/** Default number formatter: compact, avoids noisy trailing decimals. */
export function defaultFormat(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(1);
  // Up to 6 significant digits, trimmed.
  return parseFloat(value.toPrecision(6)).toString();
}
