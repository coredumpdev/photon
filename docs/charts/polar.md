# Polar

`PolarPlot` draws a concentric radial grid with angular spokes and renders the
series through the same WebGL pipeline. Drag to rotate, wheel to zoom the radius.

<Demo src="polar" :height="380" />

```ts
import { PolarPlot } from "@photonviz/core";

const plot = new PolarPlot(el, { theme: "dark", angleUnit: "deg" });
plot.addLine({ theta, r, color: "#a78bfa", width: 2, closed: true });
plot.addScatter({ theta, r, size: 6, labels });
```

| Option | Meaning |
| --- | --- |
| `angleUnit` | `"rad"` (default) or `"deg"` for the input theta |
| `maxRadius` | fix the radial domain; omit to auto-fit |
| `pointInfo` | `"click"` (default) pins a point's detail box; `"hover"` follows the cursor |
| `interactive`, `hover`, `showToolbar` | the usual switches |

Both series types return a handle with `setData(theta, r)`, so a polar plot
streams like any other. `getRotation()` / `setRotation(rad)` drive the angular
offset from code.
