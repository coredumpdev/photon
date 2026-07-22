<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/vue

**Vue 3 bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

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

`Plot` · `Line` · `Scatter` · `Bar` · `Area` · `Heatmap` · `Box` · `Hexbin` · `Contour` · `ErrorBar` · `Stem` · `Quiver` · `Candlestick` · `YAxis`

**Polar** — `PolarPlot` with `PolarLine` / `PolarScatter`.
**3D** — `Plot3D` with `Surface` / `PointCloud`.
**Maps** ([`@photonviz/map`](https://www.npmjs.com/package/@photonviz/map)) — `Map` / `GeoJson`.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
