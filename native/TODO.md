# Photon native — what is left

Everything not yet done in the native port, in the order it makes sense to do
it. Each item names the file to port **from** in `packages/core/src/` and the
file to port **to** in `native/src/`, so a task can be picked up cold.

Line counts are the TypeScript source, as a rough size signal — the C++ tends to
land within about 20% of it.

**State right now:** Faz 0 through Faz 3 are done. The ABI (52 entry points),
the interaction model, the five scales, ticks, the GL 3.3 backend, line +
scatter, the SDF text renderer, the grid/axes/labels/title overlay, theme and
axis styling, offscreen readback, three hosts — GLFW, Qt Quick and Qt Widgets —
and generated C# and Java bindings all work and are tested: 8/8 tests on GCC and
Clang across debug/release/asan, including one that drives all 52 entry points
through Panama. **Only Linux has ever been compiled, and the C# binding has not
been compiled at all.**

---

## The acceptance test, and what it found

- [x] ~~Put a native gallery and the web core side by side and diff them.~~ Done:
      `tools/compare-with-web/` transcribes the demo panels onto the web core,
      renders them in headless Chromium, and compares the plot region and every
      grid line against a native grab. **The layout now matches exactly**, in
      all six panels.
- [ ] It is not run by CI. It needs Playwright and a Chromium, which the native
      workflow does not install; running it there would make a native change
      that shifts the layout fail immediately rather than at the next manual
      check.
- [ ] It compares geometry, not colour. Series pixels differ by antialiasing
      and text by font — both by design, both documented — but nothing yet
      checks that a *series* is where it should be beyond the eye and the
      difference image.

It found one bug immediately: the x axis was padded 5% on autoscale where the
web pads 2%. The unit test covering it had been hand-derived from the same
misreading, so the two agreed with each other and neither was right. The chart
was not broken, just different — which is exactly what a numeric test is blind
to.

---

## Faz 3 leftovers

The bindings are generated and the Java one is tested; the samples are not.

- [ ] **Nothing in C# has ever been compiled.** No .NET SDK on the machine that
      generated it. `bindings/csharp/PhotonSmokeTest.cs` exists precisely so that
      one `dotnet run` settles it — run that before writing anything on top.
- [ ] An Avalonia `OpenGlControlBase` sample. `bindings/README.md` describes the
      shape it needs, including the render-thread problem that `hosts/qt/README.md`
      works through in full.
- [ ] JavaFX and WPF samples driving `ph_plot_render_pixels` into a
      `WritableImage` / `WriteableBitmap`.
- [ ] An idiomatic wrapper over each binding. Both are faithful mirrors of the C
      names on purpose; something pleasant belongs above them, not instead. The
      Java gallery shows why one is wanted — it says
      `desc.set(ValueLayout.ADDRESS, ph_line_desc.OFFSET_X, xs)` where a wrapper
      would say `line.x(xs)`.
- [ ] The Java gallery transcribes the demo charts rather than sharing
      `hosts/common/panels.c`, which is ordinary C and not part of the ABI. The
      pixel comparison in `hosts/java/README.md` is what keeps the two honest;
      if a fifth host appears, that comparison should become a script.
- [x] ~~`tools/generate_bindings.py --check` in CI.~~ The `generated` job.
- [ ] The generator assumes a 64-bit target. 32-bit would need its own pair, and
      the layout test skips rather than asserting something false.

---

## Faz 4 — the rest of the library

Everything below is additive to the ABI: one `ph_<name>_desc` struct, one
`ph_<name>_desc_init`, one `ph_plot_add_<name>`. No ABI version bump.

### Layers with their own shaders (10 remaining of 17)

`box` `candlestick` `contour` `errorbar` `graph` `heatmap` `hexbin` `image`
`ohlc` `quiver`

- [x] ~~`patches` first — it unblocks the most.~~ Done, with `geo/earcut.cpp`
      under it.
- [x] ~~`pie`~~ — shares the patches fill program; wedges are fans, or quad
      strips when there is an inner radius.
- [x] ~~`stem`~~ — the line layer's segment quad plus the scatter layer's disc,
      over the same points.
- [x] ~~`area` and `bar`~~ — the two most-used types after line and scatter.
      Neither has `setData`, so neither can stream yet; see the note below.
- [ ] Grouped and stacked bars are the caller's job in the web core too
      (`addGroupedBars` passes an `offset`, `addStackedBars` a cumulative
      `base`), and both fields are in `ph_bar_desc`. What is missing is the
      convenience wrapper, which belongs above the ABI.
- [ ] `heatmap`, `hexbin`, `contour` need `color/colormap.ts` (272 lines) and
      `color/palettes.ts` ported first.
- [ ] `candlestick` + `ohlc` need the ordinal-time axis, which is already done.
- [ ] Patches has no choropleth: the web colours a patch by a per-patch `value`
      through a colormap, and those fields are absent from `ph_patches_desc`
      rather than accepted and ignored. Adding them is additive once the
      colormaps land.
- [ ] **No layer added in Faz 4 can stream.** `ph_layer_set_xy` fits line and
      scatter and nothing else: patches is a list of rings, area has a base and
      bar has a base, a width and per-bar colours. Each wants a
      `ph_layer_set_<name>` taking its own descriptor, which is additive.

### Colour and the colorbar

- [ ] `color/colormap.ts` + `color/palettes.ts` → `src/color/`. Also unblocks
      `ph_scatter_desc.color_by`, which currently returns `PH_E_UNSUPPORTED`
      rather than silently drawing one colour.
- [ ] `render/colorbar.ts` — the `ColorInfo` hook is already in the layer
      contract as a comment; add the virtual. `Plot::compute_margin` reserves
      nothing for it yet, and the web's `COLORBAR_GAP` is the number to match.

### Composed charts — free functions, no new shaders

- [ ] `finance/indicators.ts` + `transforms.ts` — pure array→array, port
      directly with their vitest tests.
- [ ] `finance/charts.ts`
- [ ] `charts/`: `chord` `fields` `funnel` `gauge` `parallel` `sankey`
      `sunburst` `treemap` `tri` — pure layout + `addPatches`.
- [ ] `ml/metrics.ts`, `ml/reduce.ts`, `ml/charts.ts`, `ml/model.ts`,
      `ml/model-chart.ts`
- [ ] `stats/regression.ts`, `signal.ts`, `waterfall.ts`, `charts.ts`
- [x] ~~`geo/earcut.ts`~~ — ported with its vitest suite transcribed, plus two
      cases the TypeScript does not have (winding independence, two holes).
- [ ] `geo/delaunay.ts` (needed by contour)
- [ ] `graph/force.ts` + `graph/quadtree.ts` (needed by the graph layer)
- [ ] `data/csv.ts` + `data/downsample.ts`

All of the above are pure functions with existing unit tests in
`packages/core/test/` — transcribe the tests along with the code, the way
`tests/scale_test.cpp` does.

### 3D

- [ ] `plot3d/plot3d.ts` (1031 lines) + `mat4.ts` + `marching-cubes.ts`
- [ ] Layers: `bar3d` `boxes3d` `contour3d` `isosurface` `line3d` `pointcloud`
      `quiver3d` `surface` `volume`
- [ ] Needs `begin3D` state (depth test on) and a `ph_plot3d` handle type.

### Polar

- [ ] `polar/polar.ts` (812 lines) — its own handle type and ABI surface.

---

## Plot features not in the ABI at all

These exist in `plot.ts` and have no native equivalent yet. Roughly by value:

- [ ] **Hover / pick** — `layers/pick.ts` (150 lines). `PH_EVENT_CURSOR_MOVED`
      reports the cursor's data coordinates but never which *point* it is near.
      Needs `pickNearest`, a `pick()` virtual on layers, and a
      `PH_EVENT_POINT_PICKED` carrying layer + index + x/y. The hover crosshair
      and marker in `drawCrosshair`/`drawMarker` are waiting on it — the
      press-and-drag crosshair is drawn, the hover one is not.
- [ ] **Tooltip / hover readout** — depends on pick. The text renderer can draw
      it; what is missing is a rounded panel primitive and multi-line layout.
- [ ] **Legend** — `ph_plot_desc.legend` is accepted and ignored. Layer names are
      already stored. Interactive legend entries toggle series visibility in the
      web core, which means hit-testing, which means it wants pick first.
- [ ] **Annotations** — `Annotation` union, `addAnnotation`, `clearAnnotations`.
- [ ] **Drawing tools** — trendline / hline / ray / fib / rect, plus hit-testing
      and handle dragging. Large; likely Faz 5.
- [ ] **Grouped / stacked bars and stacked areas** — `addGroupedBars`,
      `addStackedBars`, `addStackedArea` compose multiple bar/area layers.
- [ ] **`addHistogram` / `addHeatmapSpectrogram`** — need `stats/`.
- [ ] **`linkX` / `linkY`** — link several plots' views. Over the ABI this is
      just "read one plot's domain, write another's", so it may belong in the
      host rather than in core. Decide.
- [ ] **Export** (`render/export.ts`) — PNG out. `ph_plot_render_pixels` gives
      the pixels; a PNG encoder is a separate (small) decision.
- [ ] **`grid.ts`** (229 lines) — the multi-plot grid layout helper. Note the
      GLFW host already does a crude version of this; the two should not diverge.
- [x] **Toolbar** (`ui/toolbar.ts`) — **decided in Faz 2: not core's job.** Both
      Qt galleries build one out of ordinary `ToolBar` / `QToolBar` actions over
      `ph_plot_set_mode` and `ph_plot_reset_view`, and the result is native,
      themed, keyboard-navigable and accessible in a way a GL-drawn strip of
      buttons could not be. The web core draws its own because a browser gives it
      nothing better. Recorded in DESIGN.md.
- [ ] **Accessibility** — `setAriaLabel` has no native meaning. Note it as
      deliberately dropped.

---

## Text and the overlay — known gaps

- [ ] **The glyph atlas never evicts.** 1024×1024 holds a few thousand glyphs at
      chart sizes, which is far more than a chart uses — but a host that animates
      a font size, or one that renders CJK, would fill it, and a full atlas
      silently stops drawing new glyphs. Either evict least-recently-used shelves
      or grow to a second page.
- [ ] **No CJK, no RTL, no shaping.** The subset is Latin + Greek and the
      renderer walks code points left to right. Arabic or Devanagari labels need
      HarfBuzz, which is a dependency decision, not a bug fix.
- [ ] **No multi-line text.** Everything drawn today is a single run. Tooltips
      and wrapped titles need line breaking, which needs `line_height` (already
      there) and a wrap width.
- [ ] **`label_rotation` applies to x axis labels only**, matching `drawXAxis`.
      Rotated y labels are drawn upright in both cores.
- [ ] **Secondary y axes cannot be coloured through the ABI.**
      `resolve_axis_style` takes a `color_override` and the web's `addYAxis`
      takes a `color`, but `ph_plot_add_y_axis` has nowhere to put it. Add it to
      `ph_axis_desc` (additive) rather than inventing a second call.
- [ ] **The plot title is not configurable.** `drawTitle` in the web takes font,
      colour and alignment; here it is centred, 15px, theme-coloured, with a
      fixed SDF weight offset standing in for semibold. If it needs options they
      belong in a `ph_title_config`, not in more `ph_plot_set_*` calls.
- [ ] **`ph_color_parse` handles the hex forms only.** `rgb()`, `rgba()` and
      named colours still need a real CSS parser. No longer blocked on anything.

---

## Cross-cutting / risks

- [x] ~~The same zoom collapse is still in the web core.~~ Fixed there too:
      `zoomFits` in `packages/core/src/plot.ts`, same two constants, same
      reasoning, applied to both the wheel and box zoom. `packages/core/test/
      zoom.test.ts` covers it, including a control that shows the unguarded
      arithmetic still destroys the view. Not yet released to npm.

- [x] ~~Only Linux has ever been compiled.~~ Linux, macOS and Windows all build
      and pass in CI, debug and release. It took five runs to get there and the
      first four each found something — none of it in the engine:
      * `tests/scale_test.cpp` used `std::fabs`, `std::nan`, `std::lround` and
        `std::floor` with no `<cmath>`. libstdc++ drags it in and MSVC does not,
        so the file had been wrong since it was written.
      * A zoom test asserted against where the first pass *happened* to stop
        rather than against the cap, and arm64 contracts multiply-adds where
        x86-64 does not, so three thousand chained steps end a few ulps apart.
      * The Qt floor said 6.5 because that was the version on the author's
        machine; Ubuntu LTS ships 6.4.2. Lowering it then exposed two 6.5-isms
        in the gallery — `loadFromModule`, and the QML resource prefix whose
        *default* moved in 6.5.
      * `java-version: 22` stopped resolving: a non-LTS release that has gone.
      * A JVM crash on Windows Release turned out to be Temurin 22.0.2 rather
        than this library, and went with the JDK bump.
- [ ] The `msvc` preset still pins "Visual Studio 17 2022" and CI does not use
      it — the runner has moved past that generator. It is fine for a developer
      who has VS2022 and untested for anyone else.
- [ ] Windows and macOS build the library and run the tests; neither builds a
      *host*. The GLFW and Qt hosts are compiled on Linux only.
- [x] ~~No CI for `native/`.~~ `.github/workflows/native.yml` matrixes
      {ubuntu, macos, windows} × {debug, release}, plus an asan leg, a
      generated-sources check and a host build. **It has never run** — the
      commands were verified locally on Linux, but Windows and macOS are still
      unproven and the first run is likely to surface something.
- [ ] **The `PH_GFX_GLES30` path is untested.** `translate()` passes the shader
      through unchanged for ES; nothing has ever run it. ANGLE/WinUI needs it,
      and the text shader's `textureSize` and `fwidth` are both core in ES 3.0,
      so it *should* work — but "should" is why this line is here.
- [ ] **A Qt host that loses its scene graph loses its view.** When Qt drops and
      recreates the render thread's context, `PhotonPlotRenderer` goes with it
      and the plot is rebuilt from scratch — panned and zoomed state included.
      Saving and restoring the domains around that belongs in the host, but it
      is the kind of thing every host will have to be told.
- [ ] **QML cannot build its own series.** `PhotonPlot.panel` picks from the
      shared demo charts and there is no way for an application to add its own
      data from QML. That needs the same `synchronize()` treatment the input
      queue gets, and is a real design question rather than a missing function.
- [ ] The program cache and the glyph atlas are both keyed on there being **one
      GL context per process**. The cache is keyed on `const Api*` and there is
      exactly one `Api`; the atlas texture is a single process-global. If a
      second context is ever supported, both need a context key, and
      `release_atlas_gl` needs to stop being all-or-nothing.
- [ ] Thread affinity is enforced only in `ph_plot_render` and
      `ph_plot_render_pixels`. Every other entry point trusts the host.
      Document it louder, or check more.
- [ ] `ph_layer_set_xy` only replaces x/y. Scatter's per-point sizes and colours
      cannot be streamed; the web core's `setData` resets them.
- [ ] `ph_plot_render` stops at the first layer that fails, so the message is not
      overwritten — which leaves a half-drawn frame. A blank frame may be better,
      or worse. Pick one on purpose.
- [ ] `Scale::ordinal_time_ticks` uses `std::mktime` for local-midnight, which
      is not thread-safe on every libc and is affected by `TZ`. Check against
      the JS behaviour near DST boundaries.
- [ ] The GLFW host's window and plot tables are fixed at 8 and 16. That is a
      deliberate no-allocation choice for a reference host, not a limit anyone
      should inherit; a real host should say so in its own code.
- [ ] **Nothing has been compared against a browser yet.** `tests/gl_smoke_test.c`
      proves pixels land in the right *regions* and that the flipped frame is a
      mirror of the upright one; it does not prove a native chart and a web chart
      look the same. See the top of this file.
- [ ] **No host is tested by CI, or at all.** The galleries are run by hand.
      A headless Qt run under `QT_QPA_PLATFORM=offscreen` produced an empty
      window here — the offscreen platform gives no usable GL context — so
      testing a host in CI needs Xvfb or a software GL stack, and neither is
      set up.

---

## Not doing

- The shared-context blit from `gl/shared.ts`. It solves a browser limit that
  native hosts do not have. `ph_plot_render_pixels` is the compatibility path
  and that is deliberate — see DESIGN.md.
- `@photonviz/map`. Removed in v0.4.0; per CLAUDE.md it must not come back.
- Host-supplied font families. One face is embedded so that native and web
  layouts agree; a family name would be a promise the library cannot keep. If
  custom fonts are ever wanted it is a call that takes TTF bytes.
