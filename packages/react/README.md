<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/react

**React bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/streaming.gif" alt="Live streaming WebGL2 charts at 60fps" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

Declarative components over [`@photonviz/core`](https://www.npmjs.com/package/@photonviz/core): a `<Plot>` container with chart children that register on mount and stream via `setData` when you pass new data.

```bash
npm i @photonviz/core @photonviz/react
```

## Quick start

```tsx
import { Plot, Line, Scatter, YAxis } from "@photonviz/react";

export function Chart({ x, y }: { x: Float64Array; y: Float64Array }) {
  return (
    <div style={{ height: 320 }}>
      <Plot options={{ theme: "dark" }}>
        <YAxis id="power" side="right" color="#f472b6" />
        <Line x={x} y={y} color="#60a5fa" width={2} name="signal" />
        <Scatter x={x} y={y} size={4} yAxis="power" />
      </Plot>
    </div>
  );
}
// Pass new x/y arrays to stream — layers update via setData under the hood.
```

## Components

`Plot` · `Line` · `Scatter` · `Bar` · `Area` · `Heatmap` · `Box` · `Hexbin` · `Contour` · `ErrorBar` · `Stem` · `Quiver` · `Candlestick` · `Pie` · `Patches` · `YAxis`

**Polar** — `PolarPlot` with `PolarLine` / `PolarScatter`.
**3D** — `Plot3D` with `Surface` / `PointCloud`.
**Maps** ([`@photonviz/map`](https://www.npmjs.com/package/@photonviz/map)) — `Map` / `GeoJson`.

Imperative escape hatch: `const [ref, plot] = usePlot(options)` gives you the underlying core `Plot`.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
