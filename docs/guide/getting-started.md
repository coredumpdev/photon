# Getting started

Photon renders chart geometry on the GPU and draws axes, ticks and labels on a
Canvas2D overlay — so you get **scale** and **sharp text** at once.

```bash
npm i @photonviz/core
```

WebGL2 is required (every evergreen browser). The package is ESM-only and has
**no runtime dependencies**.

## Your first plot

A `Plot` owns a container element and a stack of layers. It sizes itself to the
container, so give that container a height.

```ts
import { Plot } from "@photonviz/core";

const plot = new Plot(document.getElementById("chart")!, {
  theme: "dark",
  title: "Signal",
  legend: true,
});

plot.addLine({ x, y, color: "#60a5fa", width: 2, name: "signal" });
```

Wheel to zoom, drag to pan, box-zoom and home from the toolbar, hover for a
tooltip. Everything below is live — drag it.

<Demo src="line" :height="340" />

## Data

Pass `number[]` or, preferably, a `Float64Array`. Data is uploaded to GPU
buffers offset by the first point, which keeps float32 precision usable for
epoch-millisecond timestamps and other large magnitudes.

```ts
const x = Float64Array.from({ length: 1e6 }, (_, i) => i);
const y = x.map((v) => Math.sin(v / 1000));
plot.addLine({ x, y });   // decimates to ~2 points per pixel column when zoomed out
```

## Cleaning up

`plot.destroy()` releases the layers and detaches the observers. In a component
framework the bindings do this for you.

## Next

- [Plot, layers & scales](/guide/concepts) — the model behind the API
- [Chart catalog](/charts/2d) — everything you can draw
- [Python](/python/) — the same engine inside a notebook
