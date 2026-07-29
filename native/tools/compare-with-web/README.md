# Comparing the native output against the web core

The acceptance test for the whole port: *a chart drawn natively and the same
chart on the web are the same chart.* Everything else in the native suite checks
the port against itself; this checks it against the thing it is a port of.

```bash
npx vite build --config native/tools/compare-with-web/vite.config.mjs
node native/tools/compare-with-web/capture.mjs web.png
./hosts/java/run-gallery.sh --grab native.png
node native/tools/compare-with-web/compare.mjs native.png web.png --out diff.png
```

`panels.js` is a transcription of `hosts/common/panels.c`, line for line, so the
comparison is between two engines rather than two charts. The scatter and box panels use
a fixed LCG in both for the same reason.

## What is compared, and what cannot be

Not a pixel diff, because two things differ by design and always will:

- **Text.** The web core draws with Canvas2D and the system UI font; the native
  core rasterizes an embedded Inter subset through a signed distance field. That
  is deliberate — DESIGN.md explains why discovering a system font would make
  the two *layouts* disagree, which is worse than the glyphs disagreeing.
- **Antialiasing.** Different GL implementations round edge coverage
  differently, and headless Chromium runs on SwiftShader.

One panel opts out of the *grid* comparison: **Field**. Its heatmap covers the
whole plot region, so no grid line is visible in either image — and worse than
nothing, the two GL implementations resolve the quad's edge column differently
and the native blend lands within a level of the grid colour, which the detector
cannot tell from a real line. The region is still compared there; only the grid
is skipped, and only because there is no grid to see.

What must match is the geometry, because that is what the port reproduces number
for number. `compare.mjs` extracts the plot region and every grid line from both
images and compares them position by position. One pixel of drift is a failure.

The `--out` image is the amplified difference, for looking at. Black is
identical. Text glows, series edges glow faintly — and if the geometry were
wrong you would see doubled lines rather than halos, which is the distinction
the eye is good at and a number is not.

## What it found

The x axis was padded by 5% on autoscale where the web pads by 2% — the web
pads the two axes differently on purpose, and the port had used one number for
both. It survived because `tests/interaction_test.cpp` had been hand-derived
from the same misreading of `plot.ts`, so the unit test and the code agreed with
each other. The padding cascades into a different tick step, so the chart was
not broken, merely *different*: the exact failure a numeric unit test is blind
to and an image comparison is not.

## Requirements

Playwright (a devDependency of the repo) and a Chromium. `CHROMIUM` overrides
the executable, which defaults to `/usr/bin/chromium`. SwiftShader means no GPU
is needed, so this can run in CI — it does not yet.
