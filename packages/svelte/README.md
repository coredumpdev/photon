# @photonviz/svelte

**Svelte bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

A `use:plot` action over [`@photonviz/core`](https://www.npmjs.com/package/@photonviz/core): pass a config with a `series` array; reassign it to stream (layers update via `setData` when the series count is unchanged).

```bash
npm i @photonviz/core @photonviz/svelte
```

## Quick start

```svelte
<script lang="ts">
  import { plot } from "@photonviz/svelte";
  export let x: Float64Array;
  export let y: Float64Array;
  $: config = {
    options: { theme: "dark" },
    series: [{ type: "line", x, y, color: "#60a5fa", width: 2 }],
  };
</script>

<div style="height: 320px" use:plot={config}></div>
<!-- reassigning `config` streams new data through setData -->
```

## Series types

The `plot` action's `series` is a discriminated union by `type`:

`line` · `scatter` · `bar` · `area` · `heatmap` · `box` · `hexbin` · `contour` · `errorbar` · `stem` · `quiver` · `candlestick` · `map` · `geojson`

Separate actions:
- **`polarPlot`** — polar `line` / `scatter` series.
- **`plot3d`** — `surface` / `pointcloud` layers.

Maps use [`@photonviz/map`](https://www.npmjs.com/package/@photonviz/map) sources (e.g. `xyzVectorSource`) in `{ type: "map" }` series.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
