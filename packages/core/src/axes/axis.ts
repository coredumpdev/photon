import type { Scale } from "../scales/scale.js";
import type { AxisConfig, Tick } from "../types.js";
import { resolveTicks, withMinorTicks } from "./ticks.js";

/**
 * Owns the tick configuration for one axis and resolves the final tick list
 * against a scale. Modes: auto (delegates to the scale), custom (array), or
 * generator (function of the range) — plus major/minor, per-tick labels, and
 * `addTicks` layering.
 */
export class Axis {
  config: AxisConfig;

  constructor(config: AxisConfig = {}) {
    this.config = config;
  }

  update(patch: Partial<AxisConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /** Resolve the concrete tick list (labels filled) for the scale's domain. */
  resolve(scale: Scale): Tick[] {
    const [min, max] = scale.domain;
    const explicit = resolveTicks(this.config.ticks, min, max);

    let ticks: Tick[];
    if (explicit) {
      ticks = explicit;
    } else {
      let major = scale.ticks();
      // Auto minor ticks only make sense for linear-style scales; log/time
      // scales already emit their own minor ticks.
      const minor = this.config.minorTicks;
      if (minor && scale.type === "linear") {
        major = withMinorTicks(major, minor === true ? 4 : minor);
      }
      if (this.config.addTicks?.length) {
        const extra = this.config.addTicks.map((e) =>
          typeof e === "number" ? { value: e } : e,
        );
        major = [...major, ...extra].sort((a, b) => a.value - b.value);
      }
      ticks = major;
    }

    const fmt = this.config.format ?? ((v: number) => scale.formatTick(v));
    return ticks
      .filter((t) => t.value >= min && t.value <= max)
      .map((t) => ({
        value: t.value,
        label: t.minor ? "" : (t.label ?? fmt(t.value)),
        minor: t.minor ?? false,
        grid: t.grid ?? !t.minor,
      }));
  }
}
