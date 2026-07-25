/**
 * Categorical (qualitative) colour palettes — the discrete counterpart to the
 * continuous colormaps in `colormap.ts`. Series colours, class colours, treemap
 * cells and chord groups all draw from here so a page stays visually coherent.
 */

/** Built-in qualitative palettes. */
export type BuiltinPaletteName = "tableau10" | "okabe-ito" | "set2" | "bright";

/**
 * A palette name. Built-ins autocomplete; any other string resolves through the
 * registry, so `registerPalette("brand", […])` makes `"brand"` usable anywhere a
 * palette is accepted. Unknown names fall back to {@link DEFAULT_PALETTE}.
 */
export type PaletteName = BuiltinPaletteName | (string & {});

/** A palette given inline: a registered name, or the colours themselves. */
export type PaletteSpec = PaletteName | readonly string[];

/**
 * Colour-vision-deficiency safety, roughly:
 *  - `okabe-ito` — designed to be distinguishable with any common CVD (8 colours)
 *  - `tableau10` — the default; good separation for ≤10 series
 *  - `set2` — muted pastels, best for large filled areas
 *  - `bright` — high-chroma, best on dark backgrounds
 */
export const PALETTES: Record<string, readonly string[]> = {
  tableau10: [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
    "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
  ],
  "okabe-ito": [
    "#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9",
    "#d55e00", "#f0e442", "#000000",
  ],
  set2: [
    "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
    "#ffd92f", "#e5c494", "#b3b3b3",
  ],
  bright: [
    "#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
    "#22d3ee", "#fb923c", "#f87171", "#c084fc", "#4ade80",
  ],
};

/** The palette used when none is named. */
export const DEFAULT_PALETTE: readonly string[] = PALETTES.tableau10!;

/**
 * Register a custom palette under `name`, so it can be used anywhere a palette
 * name is accepted. Re-registering a name replaces it.
 */
export function registerPalette(name: string, colors: readonly string[]): void {
  if (colors.length === 0) throw new Error(`Palette "${name}" needs at least one colour`);
  PALETTES[name] = colors;
}

/** Every registered palette name (built-ins first, then anything registered). */
export function paletteNames(): string[] {
  return Object.keys(PALETTES);
}

/** Resolve a palette spec to its colours — a name, or the colours themselves. */
export function palette(spec: PaletteSpec = "tableau10"): readonly string[] {
  if (typeof spec !== "string") return spec.length ? spec : DEFAULT_PALETTE;
  return PALETTES[spec] ?? DEFAULT_PALETTE;
}

/** The `index`-th colour of a palette, cycling once the palette is exhausted. */
export function paletteColor(index: number, spec: PaletteSpec = "tableau10"): string {
  const p = palette(spec);
  return p[((index % p.length) + p.length) % p.length]!;
}
