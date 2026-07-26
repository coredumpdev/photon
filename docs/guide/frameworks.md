# Frameworks

The core is framework-agnostic. Bindings are thin — they create the plot, add
layers from props, and clean up on unmount. Each depends only on
`@photonviz/core`.

```bash
npm i @photonviz/react   # or vue, svelte, solid, gea, wc
```

## Two shapes

**Component-based** (React, Vue, Solid) — one component per layer:

```tsx
import { Plot, Line, Scatter, YAxis } from "@photonviz/react";

<Plot options={{ theme: "dark", legend: true }}>
  <YAxis id="power" side="right" color="#f472b6" />
  <Line x={x} y={y} color="#60a5fa" width={2} name="signal" />
  <Scatter x={x} y={y} size={4} yAxis="power" />
</Plot>
```

Passing new `x`/`y` arrays streams through `setData` under the hood.

**Series-spec based** (Svelte, Gea, Web Components) — a `series` array:

```svelte
<script>
  import { plot } from "@photonviz/svelte";
  $: config = { options: { theme: "dark" }, series: [{ type: "line", x, y }] };
</script>

<div use:plot={config} style="height: 320px" />
```

```html
<photon-plot id="chart" theme="dark" height="320px"></photon-plot>
<script type="module">
  import "@photonviz/wc";
  document.getElementById("chart").series = [{ type: "line", x, y }];
</script>
```

Both shapes cover the same chart types, including the field builders:
`<ContourFilled>`, `<Pcolormesh>`, `<Hist2d>`, `<EventPlot>`, `<Streamplot>` and
`<Barbs>` in React/Vue/Solid, and `{ type: "contourf" | "pcolormesh" | "hist2d" |
"eventplot" | "streamplot" | "barbs" }` in Svelte/Gea/Web Components.

## Escape hatch

Every binding exposes the underlying core instance — `usePlot()` in React and
Solid, `onReady` in Gea and Solid, `.plot` on the custom elements. The remaining
composed builders (`addConfusionMatrix`, `addRocCurve`, `addPsd`, `addRegression`,
`addTreemap`, …) are used imperatively through it, and each binding re-exports
them along with `PlotGrid` for laying several plots out in one container.

## Python

For notebooks there is a separate bridge — see [Python](/python/).
