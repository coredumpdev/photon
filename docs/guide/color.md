# Colour & colorbars

## Colormaps

Continuous scales come in three families, and the family matters:

- **Sequential** — `viridis`, `plasma`, `inferno`, `magma`, `cividis`, `turbo`, `grayscale`
- **Diverging** — `coolwarm`, `RdBu`, `BrBG`, `spectral`
- **Cyclic** — `twilight`, for phase and angle

`viridis`, `cividis` and `turbo` stay legible with common colour-vision
deficiencies; `RdBu` and `BrBG` are the safe diverging picks.

<Demo src="heatmap" :height="360" />

## Colorbars come free

Any layer that maps values to colours reports a `colorInfo()`, and the plot
draws a bar per scale in the right margin. It is **on by default** — a colour
scale nobody can read is not a scale.

```ts
new Plot(el, { colorbar: false });                       // off
new Plot(el, { colorbar: { position: "left", ticks: 7 } }); // placed and tuned
```

Layers that report one: heatmap, hexbin, contour, choropleth patches, and
`colorBy` scatter/quiver — plus the 3D surface, bars, quiver and volume.

## Diverging maps need a centred domain

A diverging colormap puts its neutral colour at the middle of the **domain**, not
at zero. If the data is lopsided, the neutral band drifts and the sign stops
reading. `symmetricDomain` fixes that:

```ts
import { symmetricDomain } from "@photonviz/core";

plot.addHeatmap({ values, cols, rows, extent, colormap: "RdBu", domain: symmetricDomain(values) });
```

<Demo src="diverging" :height="360" />

## Your own ramp

Register a name once and use it anywhere a colormap is accepted:

```ts
import { registerColormap } from "@photonviz/core";

registerColormap("brand", ["#0b1020", "#1d4ed8", "#22d3ee", "#fef08a"]);
plot.addHeatmap({ /* … */ colormap: "brand" });
```

Or pass the anchor colours inline — `colormap: ["#000", "#0af"]` works too.

<Demo src="custom-colormap" :height="340" />

Also available: `reverseColormap(spec)`, `discreteColormap(spec, steps)` for flat
bands, and `colormapFromStops(stops)` for a one-off sampler.

## Categorical palettes

For series and class colours, not magnitudes: `tableau10` (the default),
`okabe-ito` (colour-vision-deficiency safe), `set2`, `bright`.

```ts
import { palette, paletteColor, registerPalette } from "@photonviz/core";

paletteColor(i, "okabe-ito");            // cycles by index
registerPalette("brand", ["#0af", "#f0a"]);
addTreemap(plot, { items, colors: "brand" });
```

<Demo src="bubble" :height="340" />
