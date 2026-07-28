# Photon native — what is left

Everything not yet done in the native port, in the order it makes sense to do
it. Each item names the file to port **from** in `packages/core/src/` and the
file to port **to** in `native/src/`, so a task can be picked up cold.

Line counts are the TypeScript source, as a rough size signal — the C++ tends to
land within about 20% of it.

**State right now:** the ABI, the interaction model, the five scales, ticks, the
GL 3.3 backend and the line + scatter layers are done and tested (4/4 tests,
GCC + Clang, debug/release/asan). Series render; nothing around them does. Only
Linux has ever been compiled.

---

## Faz 1 — finish the single-chart picture

The goal of Faz 1 is one chart that looks like a chart: series, grid, axes,
labels. Do these roughly in order; each unblocks the next.

### 1. SDF text renderer — **the critical path**

Nothing else in this section can start without it. Everything is in place: the
font is committed and verified, `stb_truetype.h` is vendored.

- [ ] `src/text/font.{hpp,cpp}` — load the embedded TTF, build an SDF glyph
      atlas with `stbtt_GetCodepointSDF`, cache glyphs by (codepoint, px size)
      into one `GL_R8` texture. Verified working already: all 15 probe glyphs
      (`0 9 . - A z ğ ı ş ° σ − ≤ × ₺`) rasterize.
- [ ] Embed `third_party/fonts/Inter-Regular-subset.ttf` (29 KB) as a byte array
      **at build time**, not as a committed C array. A CMake step with
      `file(READ ... HEX)` keeps the repo holding one small binary instead of a
      850 KB source file.
- [ ] `src/text/text.{hpp,cpp}` — a textured-quad shader, UTF-8 decoding,
      `measure(text, px) -> width` and `draw(text, x, y, align, baseline, color)`.
      `measure` is needed before anything can be laid out.
- [ ] Kerning via `stbtt_GetCodepointKernAdvance`. The subset keeps `kern`.
- [ ] Decide DPI handling: rasterize the atlas at the device size, or one atlas
      scaled by dpr. A 4K screen and a 1× screen must both look right.

**Gotcha:** `measure()` decides axis margins, which decide the plot region. If
text metrics are wrong, every layout number downstream is wrong — write a test
that pins a few known string widths before building on it.

### 2. Primitives — solid rects and lines in pixel space

- [ ] `src/render/primitives.{hpp,cpp}` — one small shader for axis-aligned
      rects and 1px lines in device-pixel space. Grid, axis lines, tick marks,
      crosshair, legend box and the box-select rectangle all need it. Cheaper to
      write once than to keep reaching for the line layer.

### 3. Theme and axis styling

- [ ] Port `Theme`, `lightTheme`, `darkTheme`, `resolveAxisStyle`,
      `ResolvedAxisStyle` from `render/overlay.ts` (391 lines) →
      `src/render/theme.{hpp,cpp}`.
- [ ] Extend the ABI with `ph_axis_config` covering `AxisConfig` from
      `types.ts`: tick/label/grid colours, widths, fonts, rotation, standoff,
      title. Add `ph_plot_set_axis_config(plot, axis, desc)`. Additive — no ABI
      version bump.
- [ ] Plot background and border fills (`ph_plot_desc.background` / `.border`
      are already in the ABI and currently ignored).
- [ ] Plot title (`ph_plot_desc.title` is accepted and ignored; `TITLE_RESERVE`
      is 28px of top margin in `plot.ts`).

### 4. Grid and axes

- [ ] Port `drawGrid`, `drawXAxis`, `drawYAxis`, `pxX`, `pxY` from
      `render/overlay.ts` → `src/render/overlay.{hpp,cpp}`, drawing through
      primitives + text instead of Canvas2D.
- [ ] Port `axes/axis.ts` (73 lines) — `Axis.resolve()`, which layers explicit
      ticks, `addTicks` and the format callback over the scale's auto ticks, and
      clips out-of-range entries.
- [ ] Dynamic left margin: the y axis needs to widen for wide labels. `plot.ts`
      uses a fixed 56px left margin plus `Y_AXIS_GAP = 52` per extra axis — check
      whether it measures, and match whatever it does.
- [ ] Secondary y axes on the correct side (`side` is stored, never drawn).
- [ ] `ph_plot_set_axis_ticks` — explicit ticks from a host. `TicksSpec` in the
      web is a callback; over a C ABI it should be an array, since a callback
      into a managed runtime is the thing the ABI deliberately avoids.

**Milestone:** after this, a chart drawn natively and the same chart on the web
should be comparable side by side. Do that comparison — it is the acceptance
test for the whole port, and this is the first moment it is possible.

### 5. Offscreen readback

- [ ] Implement `ph_plot_render_pixels` — currently returns `PH_E_UNSUPPORTED`.
      FBO + `GL_RGBA8` texture + depth/stencil renderbuffer, render, `glReadPixels`,
      flip rows (GL is bottom-up, every image consumer is top-down).
- [ ] Cache the FBO per plot; reallocate only when the size changes.
- [ ] This is what JavaFX and WPF need. Without it those two hosts cannot draw
      at all.

### 6. GLFW host

- [ ] `hosts/glfw/` — window, GL 3.3 core context, `glfwGetProcAddress` into
      `ph_host_desc`, the event loop.
- [ ] Map input: `glfwSetCursorPosCallback` → `ph_plot_pointer_move`, buttons →
      `ph_plot_pointer_down/up`, scroll → `ph_plot_wheel`. **The wheel needs
      converting**: GLFW's `yoffset` is inverted and unscaled relative to the
      browser's `deltaY`; roughly `deltaY = -yoffset * 100`. Get this right or
      native zoom will feel wrong compared to the web at the same scroll speed.
- [ ] Drain `ph_plot_poll_event`; redraw on `PH_EVENT_REDRAW_REQUESTED`.
- [ ] Handle `glfwSetFramebufferSizeCallback` and content scale (dpr).
- [ ] Turn on `PHOTON_BUILD_GLFW_HOST` in `CMakeLists.txt` — it currently
      `FATAL_ERROR`s on purpose. Pull GLFW via `FetchContent` so no system
      install is needed.
- [ ] A gallery example mirroring `examples/vanilla`, so the two can be diffed.

---

## Faz 2 — Qt / QML host

The second host is what proves the first host's abstraction was real. **Do not
start Faz 3 before this lands.**

- [ ] `hosts/qt/` — `QQuickFramebufferObject::Renderer` subclass; hand its FBO
      to `ph_frame_target.framebuffer`.
- [ ] Pin the backend: `QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL)`.
      Qt 6 defaults to RHI and may pick Vulkan/Metal/D3D, in which case there is
      no GL context to give us.
- [ ] **`flip_y` is written but never tested.** Qt's FBOs are top-left origin.
      The current code flips only where the plot region is *placed*; the layer
      content itself may also need flipping. This is the first thing to check
      when the first Qt frame comes out upside down.
- [ ] Create the plot on the **render thread** — `Renderer` lives there, and
      `ph_plot_render` returns `PH_E_WRONG_THREAD` from anywhere else.
- [ ] Map `QMouseEvent`/`QWheelEvent` to the pointer/wheel calls.
- [ ] A `QOpenGLWidget` variant for Qt Widgets — simpler, and worth having.

---

## Faz 3 — C# and Java bindings

- [ ] **Generate them from `include/photon/photon.h`**, do not hand-write. Four
      hand-maintained copies of 48 signatures is four places for a struct field
      to drift, and a field in the wrong order is silent data corruption rather
      than a compile error. `bindings/*/` currently holds hand-written
      *sketches* — reference only, explicitly not shipping bindings.
- [ ] C#: P/Invoke, `CallingConvention.Cdecl` (mandatory — .NET defaults to
      StdCall on 32-bit Windows). Ship an Avalonia `OpenGlControlBase` sample.
- [ ] Java: Panama FFM (JDK 22+). The `ph_line_desc` field offsets in the sketch
      are hand-computed; the generator must emit them from the header. They are
      pinned by `test_struct_layout_is_pinned` in `tests/abi_c_test.c`.
- [ ] JavaFX and WPF samples driving `ph_plot_render_pixels`, since neither can
      share a GL surface.
- [ ] A binding-level test that calls every ABI entry point once. The C tests
      cover the C view; nothing yet covers the marshalled view.

---

## Faz 4 — the rest of the library

Everything below is additive to the ABI: one `ph_<name>_desc` struct, one
`ph_<name>_desc_init`, one `ph_plot_add_<name>`. No ABI version bump.

### Layers with their own shaders (15 remaining of 17)

`area` `bar` `box` `candlestick` `contour` `errorbar` `graph` `heatmap`
`hexbin` `image` `ohlc` `patches` `pie` `quiver` `stem`

- [ ] `patches` first — the diagram and finance chart builders are all composed
      on top of `addPatches`, so it unblocks the most.
- [ ] `heatmap`, `hexbin`, `contour` need `color/colormap.ts` (272 lines) and
      `color/palettes.ts` ported first.
- [ ] `candlestick` + `ohlc` need the ordinal-time axis, which is already done.

### Colour and the colorbar

- [ ] `color/colormap.ts` + `color/palettes.ts` → `src/color/`. Also unblocks
      `ph_scatter_desc.color_by`, which currently returns `PH_E_UNSUPPORTED`
      rather than silently drawing one colour.
- [ ] `render/colorbar.ts` — the `ColorInfo` hook is already in the layer
      contract as a comment; add the virtual.

### Composed charts — free functions, no new shaders

- [ ] `finance/indicators.ts` + `transforms.ts` — pure array→array, port
      directly with their vitest tests.
- [ ] `finance/charts.ts`
- [ ] `charts/`: `chord` `fields` `funnel` `gauge` `parallel` `sankey`
      `sunburst` `treemap` `tri` — pure layout + `addPatches`.
- [ ] `ml/metrics.ts`, `ml/reduce.ts`, `ml/charts.ts`, `ml/model.ts`,
      `ml/model-chart.ts`
- [ ] `stats/regression.ts`, `signal.ts`, `waterfall.ts`, `charts.ts`
- [ ] `geo/earcut.ts` + `geo/delaunay.ts` (needed by patches/contour)
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
      currently reports the cursor's data coordinates but never which *point* it
      is near. Needs `pickNearest`, a `pick()` virtual on layers, and a
      `PH_EVENT_POINT_PICKED` carrying layer + index + x/y.
- [ ] **Tooltip / hover readout** — depends on pick and on text.
- [ ] **Legend** — `ph_plot_desc.legend` is accepted and ignored. Interactive
      legend entries toggle series visibility in the web core.
- [ ] **Toolbar** (`ui/toolbar.ts`) — probably *not* core's job natively; a Qt
      or Avalonia host builds a better one with its own widgets. Decide, then
      write the decision down in DESIGN.md.
- [ ] **Annotations** — `Annotation` union, `addAnnotation`, `clearAnnotations`.
- [ ] **Drawing tools** — trendline / hline / ray / fib / rect, plus hit-testing
      and handle dragging. Large; likely Faz 5.
- [ ] **`setEqualAspect`** — `equal_aspect` is stored in the descriptor and
      never applied. Needs the layout, so it was blocked until now; it is not
      any more.
- [ ] **Grouped / stacked bars and stacked areas** — `addGroupedBars`,
      `addStackedBars`, `addStackedArea` compose multiple bar/area layers.
- [ ] **`addHistogram` / `addHeatmapSpectrogram`** — need `stats/`.
- [ ] **`linkX` / `linkY`** — link several plots' views. Over the ABI this is
      just "read one plot's domain, write another's", so it may belong in the
      host rather than in core. Decide.
- [ ] **Export** (`render/export.ts`) — PNG out. `ph_plot_render_pixels` gives
      the pixels; a PNG encoder is a separate (small) decision.
- [ ] **`grid.ts`** (229 lines) — the multi-plot grid layout helper.
- [ ] **Accessibility** — `setAriaLabel` has no native meaning. Note it as
      deliberately dropped.

---

## Cross-cutting / risks

- [ ] **Only Linux has ever been compiled.** Windows (MSVC) and macOS are
      unverified. The `msvc` preset exists but has never run. Expect the first
      MSVC build to surface `/W4` warnings and possibly `__stdcall` issues in
      the GL loader.
- [ ] **No CI for `native/`.** Add a workflow matrixing
      {ubuntu, macos, windows} × {debug, release}, plus the asan leg on Linux.
      `.github/workflows/release.yml` covers only the npm packages.
- [ ] **The `PH_GFX_GLES30` path is untested.** `translate()` passes the shader
      through unchanged for ES; nothing has ever run it. ANGLE/WinUI needs it.
- [ ] **`flip_y` is untested** — see Faz 2.
- [ ] The program cache is keyed on `const Api*` and there is exactly one `Api`
      per process. If a second GL context is ever supported, check that the
      cache and `clear_program_cache` still do the right thing.
- [ ] Thread affinity is enforced only in `ph_plot_render`. Every other entry
      point trusts the host. Document it louder, or check more.
- [ ] `ph_layer_set_xy` only replaces x/y. Scatter's per-point sizes and colours
      cannot be streamed; the web core's `setData` resets them.
- [ ] Decide what `ph_plot_render` should do when a layer fails: it currently
      stops at the first error so the message is not overwritten. A partly-drawn
      frame may be worse than a blank one — or better. Pick one on purpose.
- [ ] `Scale::ordinal_time_ticks` uses `std::mktime` for local-midnight, which
      is not thread-safe on every libc and is affected by `TZ`. Check against
      the JS behaviour near DST boundaries.

---

## Open questions (also in DESIGN.md)

- [ ] `ph_color_parse` handles the hex forms only; `rgb()`, `rgba()` and named
      colours need a real CSS parser. Comes with the text work, which needs one
      anyway.
- [ ] Whether composed charts (finance, diagrams, ML) live **above** the ABI in
      each binding, or **below** it as `ph_plot_add_<chart>`. Below means one
      implementation for four hosts; above means four. Below is probably right,
      but it widens the ABI a lot.
- [ ] Python: `python/` already bridges to the web core. Once the C ABI is
      stable it could bind natively via ctypes/cffi instead — worth deciding
      before Faz 3 fixes the binding-generation approach.

---

## Not doing

- The shared-context blit from `gl/shared.ts`. It solves a browser limit that
  native hosts do not have. `ph_plot_render_pixels` is the compatibility path
  and that is deliberate — see DESIGN.md.
- `@photonviz/map`. Removed in v0.4.0; per CLAUDE.md it must not come back.
