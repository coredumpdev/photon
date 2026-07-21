# Contributing to Photon

Thanks for your interest in improving Photon! 🎉 This guide covers the dev setup,
the repo layout, how to add a new chart type, and the PR checklist.

## Prerequisites

- **Node** ≥ 20
- **pnpm** ≥ 9 (`npm i -g pnpm`)
- A browser with **WebGL2** (any recent Chrome/Firefox/Safari/Edge)

## Getting started

```bash
git clone https://github.com/coredumpdev/photon
cd photon
pnpm install
pnpm example        # live gallery at http://localhost:5173
```

Common scripts (run from the repo root):

| Command | What it does |
| --- | --- |
| `pnpm test` | Run the vitest unit suite |
| `pnpm typecheck` | Strict `tsc --noEmit` across all packages |
| `pnpm build` | Build every package with tsup |
| `pnpm example` | Serve the vanilla gallery (hot-reloads on core changes after a rebuild) |

> While iterating on the core, run `pnpm --filter @photonviz/core dev` in a second
> terminal so `dist/` rebuilds on save and the example picks it up.

## Repository layout

```
packages/
  core/     @photonviz/core   — WebGL2 rendering core (no dependencies)
  react/    @photonviz/react  — React components + usePlot
  vue/      @photonviz/vue    — Vue components (provide/inject)
  svelte/   @photonviz/svelte — Svelte use:plot action
examples/
  vanilla/  — the live chart gallery
assets/     — README media
```

Inside `packages/core/src`:

- `gl/` — WebGL2 helpers: the **shared context** (`shared.ts`), shader compile,
  and the shared **data→clip transform** (`transform.ts`, handles log axes and
  float32 precision).
- `scales/` — `LinearScale`, `LogScale`, `TimeScale`.
- `axes/` — tick generation + `Axis` resolution.
- `layers/` — the 2D chart layers (line, scatter, bar, area, …).
- `plot3d/`, `polar/` — the `Plot3D` and `PolarPlot` classes.
- `stats/` — pure helpers (histogram, quantiles, KDE, FFT/STFT) — **always unit-tested**.
- `render/overlay.ts` — Canvas2D axes/grid/labels.

## Architecture in one paragraph

The **core is imperative** (`plot.addLine(...)`); the framework packages are thin
declarative wrappers over it. WebGL draws geometry; a Canvas2D overlay draws axes
and text. Every chart shares **one** WebGL2 context and blits its result into its
own 2D canvas, so a page can host many charts. Scales normalize data to `[0,1]`;
layers upload positions **relative to a per-layer reference** so large values
(e.g. epoch-ms timestamps) stay precise in float32 buffers.

## Adding a new 2D layer type

1. Create `packages/core/src/layers/<name>.ts` implementing the `Layer` interface
   (`layers/layer.ts`): `id`, `yAxis`, `bounds()`, `draw(state)`, `dispose()`.
2. In the vertex shader, include `TRANSFORM_GLSL` and call `dataToClip(pos)`;
   set the shared uniforms with `setTransformUniforms(...)` in `draw()`. Upload
   positions offset by a reference (`x - xRef`) — see `line.ts` for the pattern.
3. If the layer is pickable (hover), expose `name`, `colorCss`, and
   `nearestByX(x)` (see `line.ts` / `scatter.ts`).
4. Add an `addX(...)` method + registration on `Plot` (`plot.ts`), export the
   layer and its options from `index.ts`.
5. Add a panel to `examples/vanilla/main.ts` and a row to the README chart table.
6. If there's pure logic (binning, stats, geometry), put it in `stats/` (or a new
   pure module) **with a vitest test**.
7. For streaming support, add a `setData(...)` that re-uploads the buffer.

Then wire it into the wrappers if it makes sense (`packages/{react,vue,svelte}`).

## Coding conventions

- **TypeScript strict** — no `any` escapes; keep `pnpm typecheck` green.
- Match the surrounding style (naming, comment density). Comments explain **why**,
  not what.
- Keep the **core dependency-free**. Framework code stays in its own package.
- Prefer small, focused PRs.

## Tests

- Pure logic (scales, ticks, stats) is unit-tested with **vitest** — add/extend
  tests under `packages/core/test/`.
- Rendering is verified visually in the gallery; include before/after screenshots
  or a short clip in your PR when you change visuals.

## Pull request checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (new pure logic has tests)
- [ ] `pnpm build` succeeds
- [ ] The gallery still renders (`pnpm example`), with a screenshot/GIF for visual changes
- [ ] Public API changes are reflected in the README
- [ ] Commit messages are clear; PR describes the motivation

## Commit & PR style

Conventional-ish, present tense:

```
feat(core): add hexbin layer
fix(polar): stop radial labels overlapping the 90° spoke
docs: document streaming setData
```

## Reporting bugs / requesting features

Open an issue with:
- what you expected vs. what happened,
- a minimal repro (data + the `addX` call),
- your browser + OS (WebGL2 quirks vary),
- a screenshot if it's visual.

## Code of Conduct

Be kind and constructive. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/).

Happy plotting! ⚡
