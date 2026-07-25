import { describe, expect, it } from "vitest";
import {
  COLORMAP_KIND,
  colormap,
  colormapFromStops,
  colormapLUT,
  colormapNames,
  discreteColormap,
  registerColormap,
  reverseColormap,
  symmetricDomain,
} from "../src/color/colormap.js";
import {
  DEFAULT_PALETTE,
  PALETTES,
  palette,
  paletteColor,
  paletteNames,
  registerPalette,
} from "../src/color/palettes.js";

describe("colormaps", () => {
  it("ships sequential, diverging and cyclic families", () => {
    const names = colormapNames();
    expect(names).toContain("viridis");
    expect(names).toContain("inferno");
    expect(names).toContain("cividis");
    expect(names).toContain("turbo");
    expect(names).toContain("RdBu");
    expect(COLORMAP_KIND.viridis).toBe("sequential");
    expect(COLORMAP_KIND.RdBu).toBe("diverging");
    expect(COLORMAP_KIND.twilight).toBe("cyclic");
  });

  it("samples the full ramp and clamps outside 0..1", () => {
    const cmap = colormap("viridis");
    expect(cmap(0)).not.toEqual(cmap(1));
    expect(cmap(-5)).toEqual(cmap(0));
    expect(cmap(5)).toEqual(cmap(1));
  });

  it("a cyclic map starts and ends on the same colour", () => {
    const cmap = colormap("twilight");
    const [r0, g0, b0] = cmap(0);
    const [r1, g1, b1] = cmap(1);
    expect(r1).toBeCloseTo(r0, 6);
    expect(g1).toBeCloseTo(g0, 6);
    expect(b1).toBeCloseTo(b0, 6);
  });

  it("caches the LUT per name", () => {
    expect(colormapLUT("plasma")).toBe(colormapLUT("plasma"));
    expect(colormapLUT("plasma")).not.toBe(colormapLUT("magma"));
  });

  it("falls back to viridis for an unknown name", () => {
    expect(Array.from(colormapLUT("nope-not-real"))).toEqual(Array.from(colormapLUT("viridis")));
  });

  it("accepts inline stops, as triples or hex", () => {
    const fromHex = colormapFromStops(["#000000", "#ffffff"]);
    expect(fromHex(0)).toEqual([0, 0, 0]);
    expect(fromHex(1)[0]).toBeCloseTo(1, 5);
    // Inline stops also work anywhere a name does.
    const inline = colormap([[0, 0, 0], [1, 0, 0]]);
    expect(inline(1)[0]).toBeCloseTo(1, 5);
    expect(inline(1)[1]).toBeCloseTo(0, 5);
  });

  it("registers a custom colormap usable by name", () => {
    registerColormap("test-brand", ["#000000", "#00ff00"]);
    expect(colormapNames()).toContain("test-brand");
    const cmap = colormap("test-brand");
    expect(cmap(0)).toEqual([0, 0, 0]);
    expect(cmap(1)[1]).toBeCloseTo(1, 5);
    // Re-registering replaces, and invalidates the cached LUT.
    registerColormap("test-brand", ["#000000", "#0000ff"]);
    expect(colormap("test-brand")(1)[2]).toBeCloseTo(1, 5);
  });

  it("rejects a colormap with fewer than two stops", () => {
    expect(() => registerColormap("too-short", ["#fff"])).toThrow(/at least 2/);
  });

  it("reverses a ramp end for end", () => {
    const fwd = colormap("viridis");
    const rev = reverseColormap("viridis");
    expect(rev(0)).toEqual(fwd(1));
    expect(rev(1)).toEqual(fwd(0));
  });

  it("quantizes into flat bands", () => {
    const d = discreteColormap("viridis", 3);
    // Everything inside a band shares one colour…
    expect(d(0.01)).toEqual(d(0.32));
    // …and neighbouring bands differ.
    expect(d(0.1)).not.toEqual(d(0.5));
    expect(d(0.5)).not.toEqual(d(0.9));
  });

  it("centres a diverging domain on the reference value", () => {
    expect(symmetricDomain([-2, 1, 5])).toEqual([-5, 5]);
    expect(symmetricDomain([8, 12], 10)).toEqual([8, 12]);
    // A constant series would collapse to a zero-width domain.
    expect(symmetricDomain([3, 3], 3)).toEqual([2, 4]);
    // Non-finite values never widen the reach.
    expect(symmetricDomain([1, NaN, Infinity])).toEqual([-1, 1]);
  });
});

describe("palettes", () => {
  it("exposes the built-ins and defaults to tableau10", () => {
    expect(paletteNames()).toEqual(expect.arrayContaining(["tableau10", "okabe-ito", "set2", "bright"]));
    expect(palette()).toBe(DEFAULT_PALETTE);
    expect(DEFAULT_PALETTE).toBe(PALETTES.tableau10);
  });

  it("cycles colours by index, including negatives", () => {
    const p = palette("okabe-ito");
    expect(paletteColor(0, "okabe-ito")).toBe(p[0]);
    expect(paletteColor(p.length, "okabe-ito")).toBe(p[0]);
    expect(paletteColor(-1, "okabe-ito")).toBe(p[p.length - 1]);
  });

  it("accepts colours inline as well as by name", () => {
    expect(palette(["#111", "#222"])).toEqual(["#111", "#222"]);
    expect(paletteColor(3, ["#111", "#222"])).toBe("#222");
    // An empty inline palette is meaningless — fall back rather than divide by zero.
    expect(palette([])).toBe(DEFAULT_PALETTE);
  });

  it("registers a custom palette usable by name", () => {
    registerPalette("test-brand", ["#abcdef", "#123456"]);
    expect(palette("test-brand")).toEqual(["#abcdef", "#123456"]);
    expect(paletteColor(1, "test-brand")).toBe("#123456");
  });

  it("falls back for an unknown name and rejects an empty registration", () => {
    expect(palette("nope-not-real")).toBe(DEFAULT_PALETTE);
    expect(() => registerPalette("empty", [])).toThrow(/at least one/);
  });
});
