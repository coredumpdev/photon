/**
 * The colorbar: the legend for a *continuous* colour scale. Any layer that maps
 * values to colours (heatmap, hexbin, contour, choropleth patches, `colorBy`
 * scatter / quiver, and the 3D surfaces) reports a {@link ColorInfo}, and the
 * plot renders one bar per scale so the colours can actually be read.
 *
 * Built as a DOM overlay — like the legend and tooltip — so the gradient and
 * tick labels stay crisp at any device-pixel ratio.
 */
import { autoTicks } from "../axes/ticks.js";
import { colormap, type ColorInfo, type ColormapSpec } from "../color/colormap.js";

export interface ColorbarOptions {
  /** Which side of the plot region the bar sits on. Default `"right"`. */
  position?: "right" | "left";
  /** Caption above the bar. Defaults to the layer's `name`. */
  label?: string;
  /** Bar thickness in px. Default 12. */
  width?: number;
  /** Fraction of the plot height the bar spans, 0..1. Default 0.72. */
  heightFraction?: number;
  /** Target number of tick labels. Default 5. */
  ticks?: number;
  /** Formats a tick value. Defaults to a compact 3-significant-digit formatter. */
  format?: (value: number) => string;
  textColor?: string;
  borderColor?: string;
  font?: string;
}

/** Resolved chrome colours, so the bar can match either plot theme. */
export interface ColorbarTheme {
  text: string;
  border: string;
  font: string;
}

/** How many gradient stops to emit — enough that banding is invisible. */
const GRADIENT_STOPS = 24;

/**
 * A CSS `linear-gradient` for a colormap. `to top` puts the domain minimum at
 * the bottom, matching the tick labels drawn beside it.
 */
export function colormapGradient(spec: ColormapSpec, stops = GRADIENT_STOPS): string {
  const cmap = colormap(spec);
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const [r, g, b] = cmap(t);
    parts.push(
      `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${(t * 100).toFixed(2)}%`,
    );
  }
  return `linear-gradient(to top, ${parts.join(",")})`;
}

/** Round tick values inside the domain — the same nice numbers an axis would pick. */
function barTicks(domain: readonly [number, number], target: number): number[] {
  const [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) return [lo];
  const ticks = autoTicks(lo, hi, target).map((t) => t.value).filter((v) => v >= lo && v <= hi);
  // A very narrow domain can round away every candidate — fall back to the ends.
  return ticks.length >= 2 ? ticks : [lo, hi];
}

/** Compact colorbar formatter: 3 significant digits is plenty beside a gradient. */
function compact(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1).replace("e+", "e");
  return String(parseFloat(value.toPrecision(3)));
}

/** One bar (gradient + caption + tick labels) as a detached element. */
function buildBar(
  info: ColorInfo,
  opts: ColorbarOptions,
  theme: ColorbarTheme,
  heightPx: number,
): HTMLDivElement {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "3px",
  } as CSSStyleDeclaration);

  const label = opts.label ?? info.label;
  if (label) {
    const caption = document.createElement("div");
    caption.textContent = label;
    Object.assign(caption.style, {
      color: theme.text,
      font: theme.font,
      opacity: "0.85",
      whiteSpace: "nowrap",
    } as CSSStyleDeclaration);
    wrap.appendChild(caption);
  }

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", alignItems: "stretch", gap: "4px" } as CSSStyleDeclaration);

  const barHeight = Math.max(24, heightPx);
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    width: `${opts.width ?? 12}px`,
    height: `${barHeight}px`,
    borderRadius: "2px",
    background: colormapGradient(info.colormap),
    border: `1px solid ${theme.border}`,
    flex: "0 0 auto",
  } as CSSStyleDeclaration);

  // Each label is placed at its true fraction of the bar, so a tick reads
  // against the exact colour it names (evenly-spaced labels would lie whenever
  // the nice tick values are not evenly spaced inside the domain).
  const format = opts.format ?? compact;
  const [lo, hi] = info.domain;
  const span = hi - lo || 1;
  const ticks = document.createElement("div");
  Object.assign(ticks.style, {
    position: "relative",
    height: `${barHeight}px`,
    minWidth: "1px",
    color: theme.text,
    font: theme.font,
    whiteSpace: "nowrap",
  } as CSSStyleDeclaration);
  for (const v of barTicks(info.domain, opts.ticks ?? 5)) {
    const t = document.createElement("span");
    t.textContent = format(v);
    Object.assign(t.style, {
      position: "absolute",
      left: "0",
      top: `${(1 - (v - lo) / span) * barHeight}px`,
      transform: "translateY(-50%)",
    } as CSSStyleDeclaration);
    ticks.appendChild(t);
  }

  row.append(bar, ticks);
  wrap.appendChild(row);
  return wrap;
}

/**
 * Fill `host` with one bar per colour scale, stacked vertically inside
 * `regionHeight` px. Hides the host when there is nothing to show.
 */
export function renderColorbars(
  host: HTMLElement,
  infos: readonly ColorInfo[],
  opts: ColorbarOptions,
  theme: ColorbarTheme,
  regionHeight: number,
): void {
  if (infos.length === 0) {
    host.style.display = "none";
    return;
  }
  const fraction = opts.heightFraction ?? 0.72;
  // Share the available height between bars, leaving room for captions/gaps.
  const per = (regionHeight * fraction) / infos.length - (infos.length > 1 ? 22 : 0);
  host.replaceChildren();
  for (const info of infos) host.appendChild(buildBar(info, opts, theme, per));
  host.style.display = "flex";
}
