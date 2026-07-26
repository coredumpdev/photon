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


## Off-screen charts

`offscreenCulling: true` makes a chart stop drawing while it is scrolled out of
view, and paint once as it comes back. It is **off** by default, so a `render()`
always paints; turn it on for a page that holds many charts. Export
(`toDataURL`, `downloadImage`, …) always draws, culled or not.

```ts
const plot = new Plot(el, { offscreenCulling: true });
```

Photon can only skip its *own* work. Generating the data is yours, and on a
streaming page that is usually the larger half — so ask before you do it:

```ts
function tick() {
  for (const { plot, series } of charts) {
    if (!plot.isOnScreen()) continue;   // nobody is looking; don't even build the frame
    series.setData(x, nextY());
    plot.render();
  }
  requestAnimationFrame(tick);
}
```

This matters most in Firefox, where reading the shared WebGL canvas back into a
chart's own canvas costs about 1ms per chart per frame — over 100x what Chromium
charges. Measured on the 52-panel gallery, with both halves in place:

| | culling off | culling on |
| --- | --- | --- |
| Firefox | 15.1 fps | **58.6** |
| Firefox, `devicePixelRatio` 2 | 7.5 | **30.2** |
| Chromium | 59.9 | 59.9 (frame JS 6.4ms → 1.4ms) |

A page with a handful of charts does not need any of this, which is why it is off
by default.
