# Interaction & legend

## Pointer

| Gesture | Effect |
| --- | --- |
| Wheel | zoom both axes about the cursor |
| Drag | pan (in `mode: "pan"`) or select a box to zoom into |
| Drag an axis strip | pan that axis alone |
| Hover | crosshair, nearest-point markers, tooltip |

`mode` starts as `"pan"`; the toolbar switches to `"box"`, `"box-x"` and
`"box-y"`, and the home button restores the initial view.

## Picking

`pick` decides how hover chooses a point: `"x"` nearest by horizontal distance
(the classic crosshair), `"y"`, or `"xy"` by true 2D distance. Use `"xy"` for
scatters and maps — an x-only match highlights the wrong point.

```ts
new Plot(el, { pick: "xy", pointInfo: "hover" });
```

Attach your own text per point with `labels`, and it shows in the pinned detail
box instead of the raw coordinates.

## Interactive legend

Legend entries are switches. Click one to hide its series; the auto axes re-fit
to what is left. They are focusable and respond to Enter/Space.

<Demo src="legend-toggle" :height="320" />

```ts
new Plot(el, { legend: { position: "top-left", interactive: false } }); // opt out
```

The same thing from code:

```ts
plot.toggleLayer(layer);
plot.setLayerVisible(layer, false);
plot.isLayerVisible(layer);
plot.onVisibilityChange((layer, visible) => { /* … */ });
```

## Drawing tools

Opt in with `drawingTools: true` for trendline, horizontal, ray, Fibonacci and
rectangle tools. Drawings are editable — drag the handles, relabel, recolour or
delete from the context menu.

```ts
plot.setDrawTool("trendline");
plot.getDrawings();
plot.clearDrawings();
```

## Export

Every plot (2D, 3D and polar) can serialise itself:

```ts
await plot.downloadImage("chart.png");
await plot.copyToClipboard();
const url = plot.toDataURL();
const blob = await plot.toBlob();
```

## Accessibility

Plots render as `role="img"` with an auto-summarised `aria-label`. Override it
with `ariaLabel`, `setAriaLabel()`, or read the summary via `describe()`.
