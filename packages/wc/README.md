<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/banner.png" alt="Photon" width="100%" />
</p>

# @photonviz/wc

**Web Components (custom elements) for [Photon](https://github.com/coredumpdev/photon) — GPU-accelerated WebGL2 charts.**

<p>
  <a href="https://www.npmjs.com/package/@photonviz/wc"><img src="https://img.shields.io/npm/v/@photonviz/wc?color=cb3837&logo=npm" alt="npm"/></a>
  <a href="https://www.npmjs.com/package/@photonviz/wc"><img src="https://img.shields.io/npm/dm/@photonviz/wc?color=cb3837" alt="downloads"/></a>
  · <a href="https://coredumpdev.github.io/photon/">▶ Live demo</a>
  · <a href="https://coredumpdev.github.io/photon/llms-full.txt">Docs for AI agents</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/streaming.gif" alt="Live streaming WebGL2 charts at 60fps" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coredumpdev/photon/master/assets/gallery-full.png" alt="Photon chart gallery" width="100%" />
</p>

Framework-agnostic custom elements over [`@photonviz/core`](https://www.npmjs.com/package/@photonviz/core). Drop them into plain HTML, Angular, or any framework — no dedicated binding required. Import the package once (it auto-registers `<photon-plot>`, `<photon-plot3d>`, and `<photon-polar>`) and configure each element through JS properties. Reassign `series` to stream: line/scatter/bar/area layers update via `setData` when the series shape is unchanged.

```bash
npm i @photonviz/core @photonviz/wc
```

## Quick start (plain HTML)

```html
<script type="module">
  import "@photonviz/wc"; // registers the elements

  const c = document.getElementById("c");
  c.options = { theme: "dark" };
  c.series = [{ type: "line", x, y, color: "#60a5fa", width: 2 }];
  // reassigning `c.series` streams new data through setData
</script>

<photon-plot id="c" height="320px"></photon-plot>
```

Each element gives itself `display:block` and a default height of `320px`; set the `height` attribute (`height="480px"`) or the `theme` attribute (`theme="dark"` / `"light"`) to override.

## Components

- **`<photon-plot>`** — Cartesian. Properties: `options` (`PlotOptions`), `series` (`SeriesSpec[]`), `yAxes` (`YAxisSpec[]`), `annotations` (`Annotation[]`).

  `series` is a discriminated union by `type`:
  `line` · `scatter` · `bar` · `area` · `heatmap` · `box` · `hexbin` · `contour` · `errorbar` · `stem` · `quiver` · `candlestick` · `ohlc` · `pie` · `patches` · `image` · `graph`, plus **finance** `heikinAshi` · `renko` · `volumeProfile`.

- **`<photon-plot3d>`** — 3D. Properties: `options` (`Plot3DOptions`), `layers` — `surface` · `pointcloud` · `line3d` · `bar3d` · `quiver3d` · `contour3d` · `isosurface` · `volume`.

- **`<photon-polar>`** — polar. Properties: `options` (`PolarOptions`), `series` — `line` · `scatter`.

`defineElements()` is exported for manual registration (it is called automatically on import, guarded against double-define). The element classes `PhotonPlotElement`, `PhotonPlot3DElement`, and `PhotonPolarElement` are exported too.

## License

[MIT](https://github.com/coredumpdev/photon/blob/master/LICENSE) · [github.com/coredumpdev/photon](https://github.com/coredumpdev/photon)
