export type RGB = [number, number, number];
export type ColormapName = "viridis" | "plasma" | "coolwarm" | "grayscale";

// Coarse anchor points (perceptually-ordered) interpolated linearly.
const ANCHORS: Record<ColormapName, RGB[]> = {
  viridis: [
    [0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.15], [0.993, 0.906, 0.144],
  ],
  plasma: [
    [0.05, 0.03, 0.53], [0.29, 0.01, 0.63], [0.49, 0.01, 0.66],
    [0.66, 0.13, 0.59], [0.8, 0.28, 0.47], [0.9, 0.43, 0.35],
    [0.97, 0.6, 0.24], [0.99, 0.78, 0.15], [0.94, 0.98, 0.13],
  ],
  coolwarm: [
    [0.23, 0.3, 0.75], [0.55, 0.69, 0.98], [0.87, 0.87, 0.87],
    [0.96, 0.6, 0.48], [0.71, 0.02, 0.15],
  ],
  grayscale: [
    [0.05, 0.05, 0.05], [0.95, 0.95, 0.95],
  ],
};

/** Returns a `(t in 0..1) => RGB` sampler for the named colormap. */
export function colormap(name: ColormapName = "viridis"): (t: number) => RGB {
  const anchors = ANCHORS[name];
  const last = anchors.length - 1;
  return (t: number) => {
    const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const pos = clamped * last;
    const i = Math.min(last - 1, Math.floor(pos));
    const f = pos - i;
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}
