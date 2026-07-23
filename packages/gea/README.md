<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/gea

**[Gea](https://github.com/dashersw/gea) bindings for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

Config-driven Gea components over [`@photonviz/core`](https://www.npmjs.com/package/@photonviz/core). Gea has no context API, so — like the Svelte binding — each component owns a whole plot: pass `options`, `yAxes`, and a typed `series` array. The core `Plot` is an imperative WebGL canvas, so stream new data through the `onReady` handle.

```bash
npm i @geajs/core @photonviz/core @photonviz/gea
```

## Quick start

```tsx
import { Component } from "@geajs/core";
import { Plot } from "@photonviz/gea";

export default class Chart extends Component {
  template() {
    return (
      <div style="height:320px">
        <Plot
          options={{ theme: "dark" }}
          series={[
            { type: "line", x: this.props.x, y: this.props.y, color: "#60a5fa", width: 2, name: "signal" },
            { type: "scatter", x: this.props.x, y: this.props.y, size: 4, marker: "diamond" },
          ]}
        />
      </div>
    );
  }
}

// Streaming — grab the core Plot via onReady and drive it imperatively:
//   <Plot options={...} series={[...]} onReady={(plot) => { /* layer.setData(...); plot.render() */ }} />
```

## Components

`Plot` (Cartesian) · `PolarPlot` · `Plot3D`

Each takes `options`, an optional `class`/`style`, `onReady`, and:
- **`Plot`** — `yAxes` + a `series` array of `{ type, ...options }` (line, scatter, bar, area, heatmap, box, hexbin, contour, errorbar, stem, quiver, candlestick, **ohlc**, pie, patches, image, graph, **heikinAshi**, **renko**, **volumeProfile**, map, geojson).
- **`PolarPlot`** — `series` of `{ type: "line" | "scatter", ... }`.
- **`Plot3D`** — `layers` of `{ type: "surface" | "pointcloud" | "line3d" | "bar3d" | "quiver3d" | "contour3d" | "isosurface" | "volume", ... }`.

Multi-layer `addBollinger` / `addDepth` and the indicators (`rsi`, `macd`, `sma`, `ema`, `vwap`, `atr`, …) are re-exported for imperative use via `onReady(plot)`. Series options accept `renderType`; use the `ordinal-time` x scale for gap-free session charts.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
