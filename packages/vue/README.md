<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/vue

**Vue 3 bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

<p>
  <a href="https://www.npmjs.com/package/@photonviz/vue"><img src="https://img.shields.io/npm/v/@photonviz/vue?color=cb3837&logo=npm" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@photonviz/vue"><img src="https://img.shields.io/npm/dm/@photonviz/vue?color=cb3837" alt="downloads"/></a>
  · <a href="https://coredumpdev.github.io/photon/">▶ Live demo</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/streaming.gif" alt="Live streaming WebGL2 charts at 60fps" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

Declarative components over [`@photonviz/core`](https://www.npmjs.com/package/@photonviz/core) using provide/inject: a `<Plot>` container with chart children that stream via `setData` on reactive data changes.

```bash
npm i @photonviz/core @photonviz/vue
```

## Quick start

```vue
<script setup lang="ts">
import { Plot, Line, YAxis } from "@photonviz/vue";
defineProps<{ x: Float64Array; y: Float64Array }>();
</script>

<template>
  <div style="height: 320px">
    <Plot :options="{ theme: 'dark' }">
      <YAxis id="power" side="right" color="#f472b6" />
      <Line :x="x" :y="y" color="#60a5fa" :width="2" name="signal" />
    </Plot>
  </div>
</template>
```

Pass a new typed-array reference to stream — the layer updates via `setData` under the hood.

## Components

`Plot` · `Line` · `Scatter` · `Bar` · `Area` · `Heatmap` · `Box` · `Hexbin` · `Contour` · `ErrorBar` · `Stem` · `Quiver` · `Candlestick` · `Ohlc` · `Pie` · `Patches` · `Image` · `Graph` · `YAxis`

**Polar** — `PolarPlot` with `PolarLine` / `PolarScatter`.
**3D** — `Plot3D` with `Surface` / `PointCloud` / `Line3D` / `Bar3D` / `Quiver3D` / `Contour3D` / `Isosurface` / `Volume`.
**Finance** — `HeikinAshi` / `Renko` / `Bollinger` / `VolumeProfile` / `Depth`, plus re-exported indicators (`rsi`, `macd`, `sma`, `ema`, `wma`, `vwap`, `atr`, `stochastic`, `keltner`, `obv`, `ichimoku`, `adx`, `superTrend`, `fibRetracements`).
Every layer accepts `:render-type="'static' | 'dynamic'"`; pass new typed arrays to stream.

The toolbar includes a one-click download-PNG button; the underlying core `Plot` also exposes image export (`downloadImage()` / `toDataURL()` / `toBlob()` / `copyToClipboard()`).

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
