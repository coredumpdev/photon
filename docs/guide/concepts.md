# Plot, layers & scales

## The model

A **Plot** owns a container, a shared X scale, one or more named Y axes, and an
ordered list of **layers**. Each layer holds its own GPU buffers and knows how to
draw itself given the current transform.

```ts
const plot = new Plot(el, options);
const line = plot.addLine({ x, y });   // returns the layer
plot.removeLayer(line);
```

Layers draw in insertion order, so add fills before the lines that sit on them.

## Scales

Set per axis through `scales`:

| Type | Use for |
| --- | --- |
| `linear` | the default |
| `log` | decade ticks, log transform applied on the GPU |
| `time` | epoch milliseconds, calendar-aware ticks |
| `categorical` | a fixed set of factors; series plot at integer indices |
| `ordinal-time` | a market session axis: plots at integer indices, collapses weekends and gaps, ticks still show calendar dates |

```ts
new Plot(el, {
  scales: {
    x: { type: "time" },
    y: { type: "log", domain: [1, 1e6] },
  },
});
```

A `domain` locks the axis; omit it and the axis auto-fits its data (and re-fits
whenever a series is added, removed or hidden).

## Multiple Y axes

```ts
plot.addYAxis("volume", { side: "right", color: "#f472b6" });
plot.addBar({ x, y: volume, yAxis: "volume" });
```

Each Y axis auto-fits only the layers bound to it. Margins grow to make room.

## Axes

`setAxis(dim, config)` controls ticks, formatting and grid per axis:

```ts
plot.setAxis("x", {
  title: "time",
  minorTicks: true,
  format: (v) => new Date(v).toISOString().slice(11, 19),
});
```

Pass an explicit `ticks` array for full control — an empty array removes them
entirely, which is what the diagram builders do.

## Annotations

Canvas2D overlays projected through the scales, so they pan and zoom with the
data: `span`, `band`, `box`, `label`, `line`, `ray`, `fib`.

```ts
plot.addAnnotation({ type: "span", dim: "y", value: 0, dash: [4, 4] });
plot.addAnnotation({ type: "band", dim: "x", from: 10, to: 20, color: "rgba(96,165,250,.12)" });
```

## Linked panes

`linkX([a, b, c])` syncs pan, zoom and the crosshair across plots — the standard
price / volume / indicator dashboard.
