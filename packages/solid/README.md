<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/solid

**Solid.js bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/streaming.gif" alt="Live streaming WebGL2 charts at 60fps" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

Declarative components over [`@photonviz/core`](https://www.npmjs.com/package/@photonviz/core): a `<Plot>` container with chart children that register on mount and stream via `setData` when you pass new data. Fine-grained and reactive — update a signal and only that layer re-uploads.

```bash
npm i @photonviz/core @photonviz/solid
```

## Quick start

```tsx
import { Plot, Line, Scatter, YAxis } from "@photonviz/solid";
import { createSignal } from "solid-js";

export function Chart(props: { x: Float64Array; y: Float64Array }) {
  return (
    <div style={{ height: "320px" }}>
      <Plot options={{ theme: "dark" }}>
        <YAxis id="power" side="right" color="#f472b6" />
        <Line x={props.x} y={props.y} color="#60a5fa" width={2} name="signal" />
        <Scatter x={props.x} y={props.y} size={4} yAxis="power" />
      </Plot>
    </div>
  );
}
// Pass a signal to a data prop to stream — the layer updates via setData under the hood:
//   const [y, setY] = createSignal(buf);
//   <Line x={x} y={y()} .../>   // setY(next) re-uploads without recreating the layer
```

## Components

`Plot` · `Line` · `Scatter` · `Bar` · `Area` · `Heatmap` · `Box` · `Hexbin` · `Contour` · `ErrorBar` · `Stem` · `Quiver` · `Candlestick` · `Pie` · `Patches` · `YAxis`

**Polar** — `PolarPlot` with `PolarLine` / `PolarScatter`.
**3D** — `Plot3D` with `Surface` / `PointCloud`.
**Maps** ([`@photonviz/map`](https://www.npmjs.com/package/@photonviz/map)) — `Map` / `GeoJson`.

Imperative escape hatch: pass `onReady={(plot) => …}` to `<Plot>` (or `usePlot()` from inside a child) to reach the underlying core `Plot`.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
