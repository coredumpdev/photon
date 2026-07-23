<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/svelte

**Svelte bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/streaming.gif" alt="Live streaming WebGL2 charts at 60fps" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

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

`line` · `scatter` · `bar` · `area` · `heatmap` · `box` · `hexbin` · `contour` · `errorbar` · `stem` · `quiver` · `candlestick` · `ohlc` · `pie` · `patches` · `image` · `graph` · `map` · `geojson`

**Finance** series — `heikinAshi` · `renko` · `volumeProfile`. Multi-layer `addBollinger` / `addDepth` and the indicators (`rsi`, `macd`, `sma`, `ema`, `wma`, `vwap`, `atr`, `stochastic`, `keltner`, `obv`, `ichimoku`, `adx`, `superTrend`, `fibRetracements`) are re-exported for imperative use on a core `Plot`. Every series options object accepts `renderType`; use the `ordinal-time` x scale for gap-free session charts.

The toolbar includes a one-click download-PNG button; the underlying core `Plot` also exposes image export (`downloadImage()` / `toDataURL()` / `toBlob()` / `copyToClipboard()`).

Separate actions:
- **`polarPlot`** — polar `line` / `scatter` series.
- **`plot3d`** — `surface` / `pointcloud` / `line3d` / `bar3d` / `quiver3d` / `contour3d` / `isosurface` / `volume` layers.

Maps use [`@photonviz/map`](https://www.npmjs.com/package/@photonviz/map) sources (e.g. `xyzVectorSource`) in `{ type: "map" }` series.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
