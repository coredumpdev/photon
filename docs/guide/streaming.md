# Streaming

Every layer exposes `setData(...)`. Create it once with the `"dynamic"` buffer
hint, then push new arrays and re-render.

```ts
const line = plot.addLine({ x, y, renderType: "dynamic" });

function frame() {
  line.setData(x, y);   // re-uploads the GPU buffers
  plot.render();
  requestAnimationFrame(frame);
}
```

`renderType` maps to the WebGL buffer-usage hint (`STATIC_DRAW` vs
`DYNAMIC_DRAW`). It is a performance hint only — `setData` works either way.

<Demo src="streaming" :height="320" />

## Candlesticks

Live price charts have two distinct updates, so candlesticks get dedicated
methods that avoid re-uploading the whole series:

```ts
candles.updateLast({ open, high, low, close });  // the forming bar
candles.appendCandle(x, { open, high, low, close }); // roll to a new bar
```

## Cost

`setData` re-uploads; it does not reallocate when the length is unchanged. For
very large series, keep the arrays alive and mutate them in place (as the demo
above does with `copyWithin`) rather than allocating each frame.

Lines decimate to about two points per pixel column when zoomed out, on the GPU
above 200k points, so a million-point series stays interactive without any work
on your side. Set `decimate: false` to draw every vertex.
