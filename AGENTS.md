# AGENTS.md

Guidance for AI agents (and humans) working in the **Photon** repo — a
GPU-accelerated (WebGL2) scientific / finance / ML charting library. pnpm
workspace monorepo, TypeScript, zero runtime deps. (Claude Code users also get a
local `CLAUDE.md`; this file is the committed, tool-agnostic version.)

## Commands

```bash
pnpm build         # build all packages (tsup) — run before typecheck (wrappers need core's dist types)
pnpm typecheck     # strict tsc --noEmit across packages
pnpm test          # vitest run (unit tests live in packages/*/test)
pnpm bench         # core micro-benchmarks
pnpm example       # vanilla gallery (vite); also :react :vue :svelte :solid :gea :wc :playground :ml
```

Single package: `pnpm --filter @photonviz/core exec tsc --noEmit`,
`pnpm --filter @photonviz/core build`, `pnpm --filter @photonviz/core test`.
An example builds with `npx vite build examples/<name>`; dev-serve with
`npx vite examples/<name> --port <p> --strictPort`.

## Packages

- `@photonviz/core` — the engine (Plot, Plot3D, PolarPlot, all layers, finance +
  diagram builders, ML metrics/reducers, data adapters). Zero deps.
- `@photonviz/{react,vue,svelte,solid,gea}` — framework wrappers.
  `@photonviz/wc` — framework-free Web Components.
- `examples/*` — one runnable app per wrapper + `vanilla`, `playground`, `wc`, `ml`.

`core/src/` layout: `layers/` (2D), `plot3d/` (3D), `polar/`, `scales/`, `axes/`,
`render/`, `gl/`, `finance/`, `charts/` (diagrams), `ml/`, `data/`, `stats/`,
`color/`, `ui/`.

## Architecture (the non-obvious parts)

- **One shared WebGL2 context** (`gl/shared.ts` `getSharedGL()`) backs *every*
  plot — browsers cap live contexts (~16), so each chart renders its scene into
  the shared offscreen canvas, then **blits** the pixels to its own cheap 2D
  canvas (`drawImage`). This is why a page can hold dozens of charts. GPU
  programs are cached per-gl in module-level `WeakMap<gl, program>` and shared
  across all plots — **never `deleteProgram` a cached program in a layer's
  `dispose()`**.
- **Layer contract** (`layers/layer.ts`): a class with `bounds()`, `draw(state)`,
  `dispose()`, `setData(...)`. Data is baked into GPU buffers offset by an
  `xRef`/`yRef` (the first data point) for float32 precision; transform uniforms
  carry the refs each frame. Every layer takes `renderType?: "static" |
  "dynamic"` → `bufferUsage(gl, renderType)`; default static.
- **Scales** (`scales/scale.ts`): `linear`, `log`, `time`, `categorical`,
  `ordinal-time` (finance session axis — plots at integer indices, collapses
  market gaps, ticks snap to calendar dates). Set per-axis via `scales: { x: {
  type, domain?, factors?, times? } }`.
- **Composed charts**: finance charts (`finance/charts.ts`), diagrams
  (`charts/*.ts`) and ML charts (`ml/charts.ts`) are **free functions**
  `addX(plot, opts)` that compose existing layers (`addPatches`/`addLine`/…) —
  not new WebGL layers. Prefer this pattern for new chart types (low-risk).
  Indicators/metrics/transforms are pure array→array functions.
- **Wrappers** come in two shapes: component-based (react/vue/solid — one
  component per layer) and series-spec based (svelte/gea/wc — a `series` array of
  `{ type, ...opts }` with an `addSeries` switch). When adding a chart type,
  update **both** shapes + re-export any new pure functions.

## Conventions

- **TS strict**, `verbatimModuleSyntax`, `noUnusedLocals`/`noUnusedParameters`.
  ESM everywhere — **imports use `.js` specifiers** (`from "./scale.js"`) even
  for `.ts` files.
- Internal deps are `workspace:*`; version bumps don't touch the lockfile.
- Match surrounding style: dense one-line JSDoc, no comment noise, explicit types.
- **Commits: never add a `Co-Authored-By` / AI trailer.** Plain message only. If
  on `master`, committing directly is the repo norm (releases + features land on
  master).
- Tests are `vitest`; pure logic (scales, indicators, transforms, layouts, ml
  metrics, csv/lttb) is unit-tested — rendering is verified via the example apps.

## Adding a chart type

1. If it's a colored polygon/line mesh (treemap, funnel, an indicator overlay, an
   ML chart, …): add a pure layout/transform + an `addX(plot, opts)` builder that
   calls `plot.addPatches`/`plot.addLine`/etc. Only write a new WebGL `Layer`
   class when you need custom shaders.
2. Export from `core/src/index.ts`. Add a focused unit test for the pure math.
3. Expose in the wrappers (component for react/vue/solid; `SeriesSpec` case for
   svelte/gea/wc) and re-export any pure helpers.
4. `pnpm build && pnpm typecheck && pnpm test`, then add a panel to the relevant
   example(s).

## Releasing

Bump all `packages/*/package.json` versions, commit `release: vX.Y.Z …` (no
co-author), push. Then `gh release create vX.Y.Z --title vX.Y.Z --latest --target
master --notes "…"` — this creates+pushes the tag, which triggers
`.github/workflows/release.yml` → build/typecheck/test → `pnpm -r publish
--provenance` to npm.
