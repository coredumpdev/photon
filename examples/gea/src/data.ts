// Shared deterministic data helpers for the Gea gallery.
// A seeded RNG keeps every reload byte-identical; each catalog reseeds so the
// Static and Dynamic tabs draw the same synthetic data.

export function makeRng(seed = 42) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const gaussian = (m: number, sd: number) =>
    m + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * (rand() || 1e-9));
  return { rand, gaussian };
}

/** Small unseeded jitter for live streaming (visual only). */
export const jitter = () => Math.random() - 0.5;

/** Business-day epoch-ms timestamps (skip Sat/Sun) — for the ordinal-time axis. */
export function businessDays(n: number, startMs: number): number[] {
  const out: number[] = [];
  let ms = startMs;
  while (out.length < n) {
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) out.push(ms);
    ms += 86_400_000;
  }
  return out;
}
