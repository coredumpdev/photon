# Photon native — design

The native port of `@photonviz/core`, built so that one C++ engine drives GLFW,
Qt/QML, C# and Java hosts through a single C ABI.

This document records the ABI, the host contract, and the decisions that are
expensive to change later. It says *why*, not just what — the what is in
[`include/photon/photon.h`](include/photon/photon.h).

## Status

Faz 0, Faz 1 and Faz 2 are complete: a chart drawn natively is a chart, and it
draws under three hosts from one engine. Faz 3 is the C# and Java bindings.

| Area | State |
| --- | --- |
| C ABI (52 entry points) | plot, axes, styling, ticks, view, input, events, line + scatter |
| Handle safety | generation-tagged, double-free and use-after-free tested |
| Scales | all five projections, ticks and label formatting — checked against the vitest suite |
| Interaction | pan, wheel zoom, box zoom, axis lock, bounded pan, equal aspect — verified against `plot.ts` |
| Autoscale | `padDomain` + non-finite skipping, verified against `plot.ts` |
| Event queue | polled, coalescing, bounded |
| GL loader | OpenGL 3.3 core, ~65 entry points, resolved via the host's `get_proc_address` |
| Line layer | ported incl. min/max decimation, dashes, miter/bevel joins |
| Scatter layer | ported incl. per-point size and colour, all six markers |
| Text | SDF atlas on stb_truetype, kerned, rotated, batched into one draw call |
| Grid, axes, labels, title | ported from `render/overlay.ts`, down to the half-pixel snapping |
| Theme and axis styling | `lightTheme` / `darkTheme` / `resolveAxisStyle`, exposed as `ph_axis_config` |
| Rendering | draws to the host's framebuffer, scissored to the plot region — **verified headless on a real GL 3.3 context** |
| Offscreen readback | `ph_plot_render_pixels`, top-row-first RGBA8 |
| GLFW host | window, input, dpr, and a four-panel gallery |
| Qt Quick host | `QQuickFramebufferObject` item, render-thread safe, QML module |
| Qt Widgets host | `QOpenGLWidget`, same charts, GUI thread |
| C# / Java bindings | not started (Faz 3) |

`tests/gl_smoke_test.c` is the one that matters most here: it creates a
surfaceless EGL context, renders a chart through the public ABI, and reads the
pixels back — checking not just that something was drawn, but that the series
stayed inside the scissor while the tick labels landed outside it. It is the
only test that compiles a shader, so it is the only thing that can catch a
broken GLSL ES 3.00 → 3.30 translation.

## Layering

```
                      ┌──────────────────────────────────┐
                      │  photon-core  (C++20, GL 3.3)    │
                      │  scales · layout · interaction   │
                      │  layers · shaders · text         │
                      └───────────────┬──────────────────┘
                                      │  C ABI — photon.h
      ┌───────────────┬───────────────┼───────────────┬───────────────┐
      │               │               │               │               │
   GLFW host       Qt / QML       C# binding      Java binding    (Faz 4+)
  (reference)   QQuickFbo­Object    P/Invoke      Panama FFM
```

The core knows nothing about windows, event loops or toolkits. It knows how to
draw into a framebuffer it is handed, and how to respond to input it is told
about. Everything else is the host's.

## The host contract

One struct carries the entire relationship:

```c
typedef struct ph_frame_target {
  uint32_t struct_size;
  uint32_t framebuffer;   /* GL FBO name; 0 = the host's default */
  int32_t  x, y, width, height;   /* viewport, device pixels, origin bottom-left */
  float    dpr;
  ph_bool  flip_y;        /* target origin is top-left (Qt's FBOs) */
} ph_frame_target;
```

The host makes its GL context current, fills this in, and calls
`ph_plot_render`. Zero copies:

| Host | framebuffer | Notes |
| --- | --- | --- |
| GLFW | `0` | reference host; `flip_y = 0` |
| Qt Quick / QML | `QQuickFramebufferObject::Renderer`'s FBO | `flip_y = 0` and `setMirrorVertically(true)` — see below; pin the backend with `QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL)` |
| Qt Widgets | `QOpenGLWidget::defaultFramebufferObject()` | simplest Qt path; `flip_y = 0` |
| Avalonia | `OpenGlControlBase`'s FBO | the clean .NET path |
| WPF | — | no GL interop; use `ph_plot_render_pixels` |
| LWJGL | `0` | GLFW underneath anyway |
| JavaFX | — | no GL interop; use `ph_plot_render_pixels` into a `WritableImage` |

### The readback path, and where it came from

`ph_plot_render_pixels` renders offscreen and reads the pixels back. It exists
for JavaFX and classic WPF, which give no way to share a GL surface.

This is the native descendant of the web core's shared-context blit
(`gl/shared.ts`). On the web that readback is *mandatory* — browsers cap live
WebGL contexts at around 16, so every chart renders into one shared context and
blits into its own 2D canvas. Natively that constraint does not exist: one
context, many viewports, no copy. So the mechanism survives but its role
inverts, from a hard requirement to a compatibility fallback. **Do not port the
shared-context design itself.** It solves a problem native hosts do not have.

### `flip_y`, and what Faz 2 found

Faz 0 added `flip_y` on the assumption that "Qt's FBOs are top-left origin".
They are not. A `QQuickFramebufferObject`'s FBO is an ordinary
bottom-left-origin GL framebuffer; what Qt does differently is not *mirror* the
texture when it composites the item, and the fix is Qt's own
`setMirrorVertically(true)`, which folds the flip into a composite it was going
to do anyway.

Worse, the flag as first implemented was wrong: it moved the plot region and the
overlay's pixel transform and left the layers drawing upright, so a host that
set it would have got right-way-up axes over upside-down data. It is now handled
once, for the whole frame, as a flipped `glBlitFramebuffer` out of a private
target — no shader knows about it and no layer added in Faz 4 can forget it. The
smoke test renders the same chart both ways and checks that one is the mirror of
the other.

No host known to us needs it. It stays because a host that renders into a
surface it cannot mirror itself would, and because it now costs one blit rather
than a trap.

## ABI rules, and the reasoning

Six rules, each paying for a specific failure we would otherwise hit in one of
the four target languages.

**1. Pure C99, fixed-width scalars only.** No `int`, `long`, `size_t` or `bool`
crosses the boundary — their widths differ across our platforms, and a
`sizeof(bool)` mismatch is a silent struct-layout corruption, not a link error.
`tests/abi_c_test.c` is compiled *as C* so a C++-ism in the header fails the
build immediately rather than in a binding months later.

**2. Enums are `typedef int32_t` plus an anonymous enum.** Compilers are free to
size a C enum however they like; the ABI is not.

**3. Handles are 64-bit generation-tagged integers, not pointers.**
High 32 bits are a generation, low 32 an index. Two of our four hosts (Java, C#)
free from a garbage collector's finalizer thread, and will eventually double-free
or use-after-free. With pointers that is undefined behaviour deep in the
renderer; here it is `PH_E_INVALID_HANDLE` at the call that made the mistake.
Destroying a plot invalidates its layer handles first, so a layer outliving its
plot is caught too. Tested in `test_handle_safety`.

**4. Descriptors start with `struct_size`, and zero means default.** A shorter
struct from an older binding is accepted and its missing tail stays at defaults;
a longer one is rejected, because we cannot guess at fields we do not know. And
because a binding may hand us a `calloc`'d or default-constructed struct,
**all-zero must equal the core's defaults**. That is why the four features the
core enables by default are spelled negatively in `ph_plot_desc`:
`no_interaction`, `no_hover`, `no_crosshair`, `no_colorbar`. Fields whose
default is off (`legend`, `equal_aspect`, `bounded_pan`) read positively.

**5. Events are polled, never delivered by callback.** Reverse-calling into a
managed runtime — JNI upcalls, pinned C# delegates, a GC moving your callback
target — is the most fragile thing an FFI can do. A queue costs one call per
frame and behaves identically in all four hosts. High-rate events
(`VIEW_CHANGED`, `CURSOR_MOVED`, `REDRAW_REQUESTED`) coalesce, so a 500-move
drag leaves one of each in the queue, and the queue is capped so a host that
never polls leaks nothing. Tested in `test_event_queue_coalesces_and_drains`.

**6. Array arguments are copied during the call.** The engine never retains a
caller's pointer. This is what lets a GC'd language pass an array without
pinning it, and it matches the web core, which uploads to GPU buffers
immediately.

Two more, less visible:

**Errors are result codes plus a thread-local message.** An exception unwinding
into a C caller is undefined behaviour; every entry point catches. `ph_last_error()`
is `thread_local` so a Qt render thread and a GUI thread never overwrite each
other's diagnostics.

**Only `ph_*` is exported.** `-fvisibility=hidden` is not enough: libstdc++ marks
some inline template instantiations with explicit default visibility, and they
leak as weak symbols the dynamic linker may interpose. Since this `.so` gets
loaded into a JVM, a CLR and a Qt process — each with its own libstdc++ already
resident — the build adds a version script (`cmake/photon.map`, and
`cmake/photon.symbols` on macOS). Verified: 52 exports, all `ph_*`.

## Threading

A plot belongs to the thread that created it, and `ph_plot_render` refuses any
other thread with `PH_E_WRONG_THREAD` — the GL context is only current on one.
This is the first mistake a Qt host makes, because `QQuickFramebufferObject::Renderer`
lives on the render thread while the rest of the app lives on the GUI thread:
**create the plot on the render thread**. The handle tables are mutex-guarded so
plots on different threads coexist; a single plot is not internally synchronized.

## What ports 1:1, and what does not

Measured against the TypeScript core: 80 files, ~23k lines, 13 of which touch
the DOM, 26 of which carry GLSL.

**Ports mechanically** (~45% of the source): `scales/`, `axes/ticks`,
`finance/indicators` + `transforms`, `ml/metrics` + `reduce`, `stats/`,
`geo/earcut` + `delaunay`, `graph/force` + `quadtree`, `charts/*` layouts,
`data/csv` + `downsample`. All pure array→array. Their vitest suites port with
them.

**Ports with a header swap**: the ~60 shader programs. GLSL ES 3.00 → GLSL 3.30
core is `#version 300 es` → `#version 330 core` plus dropping `precision`
qualifiers.

**Must not use the C locale**: number formatting. This is the bug the Qt host
found, and it is worth recording because nothing else would have. Qt calls
`setlocale(LC_ALL, "")` before `main()`, so every `printf`-family conversion
starts following the desktop's locale — and the same build that printed a tick
as `0.5` under GLFW printed `0,5` under Qt on a Turkish or German machine, while
the web core printed `0.5` everywhere because JavaScript has no locale to
consult. Tick formatting goes through `std::to_chars`, which is specified to
behave as printf does in the C locale, and `tests/scale_test.cpp` checks it
under a comma-decimal locale.

**Reproduced numerically, rewritten structurally**: `plot.ts`. Layout,
autoscale, and the pan/zoom/box math are reproduced exactly — `tests/interaction_test.cpp`
checks them against values hand-derived from `plot.ts`, not from running this
code. The DOM half (three stacked canvases, pointer listeners, toolbar, context
menu) does not cross over.

**Deliberately diverges**: the zoom bounds. `plot.ts` lets a wheel zoom run
until the domain overflows a double, and the native port used to as well —
until the Qt gallery showed what that costs. A few thousand notches out takes
the span past 1e130, and because zooming about the centre preserves the centre
it preserves the rounding error in it too, which by then is around 1e117; when
the span comes back down to something readable, both ends have rounded onto the
same double and the chart is blank for good. The mirror image happens zooming
in, below about an eps of the view's own magnitude.

So `Plot::zoom_fits` bounds a zoom-out at a billion times the data's extent and
a zoom-in at 1e-14 of the view's magnitude — both far outside any readable
chart, both leaving the way back intact. **The web core still has the original
behaviour**, so this is a real divergence rather than a port detail, and it is
recorded here because parity is otherwise the rule.

**Deliberately not ported**: `gl/shared.ts`. See above.

**Had no equivalent and had to be written**: text, and the overlay that uses it.
See the next two sections.

## Text

The web core gets fonts free from Canvas2D — around 200 `ctx.` calls across
`render/overlay.ts` and `plot.ts` for tick labels, legend, tooltip and title.
Natively every one of them is a glyph atlas, a shader and a pile of metrics.
Three decisions shape it.

**The font is embedded, not discovered from the system.** A system font means a
chart's tick labels have different metrics on Windows, macOS and Linux —
different label widths, different axis margins, a different plot region for the
same data. Embedding is what makes a native chart and a web chart line up.
`third_party/fonts/` holds Inter, instanced to Regular and subset to the 418
code points a chart actually draws: ASCII, Latin-1 and Latin Extended-A (so
Turkish, Polish and Czech labels render), Greek, and the maths and currency
symbols scientific and finance charts need. That is 51 KB, down from 856 KB for
the full variable face, and `tools/make_font.py` regenerates it. The subset
keeps GPOS's `kern` feature: Inter has no legacy `kern` table, so dropping GPOS
would silently turn kerning off, and `tests/text_test.cpp` asserts it is on.
The bytes are turned into a C++ array at build time by `cmake/embed_binary.cmake`,
so the repository holds one small binary rather than 300 KB of hex literals.

**Glyphs are signed distance fields, rasterized at the device size.** SDF because
a chart rotates text (the y axis title, rotated tick labels) and wants a heavier
title than a Regular-only subset carries — rotation stays smooth because the
field is resampled rather than the coverage, and weight is a constant added to
the distance threshold. But the usual SDF trick of scaling one atlas entry to
every size is exactly where SDF text earns its reputation for soft corners at
12px. So the cache is keyed on the *quantized device size*: a chart uses two or
three text sizes, the field is sampled at 1:1, and the result is as sharp as a
coverage bitmap. A dpr change adds entries rather than resampling existing ones.

**A frame's text is one draw call.** Glyph quads accumulate into a single vertex
buffer and are drawn once. Forty short strings is forty draw calls otherwise,
per chart, per frame.

## The overlay

`render/overlay.ts` strokes a 2D canvas; `src/render/overlay.cpp` fills
rectangles and queues glyphs. Everything between those two ends is deliberately
identical, down to the `Math.round(x) + 0.5` that makes a hairline crisp —
because the acceptance test for this whole port is putting a native chart and a
web chart side by side.

There is no line primitive. Everything the overlay draws is axis-aligned, so one
shader that fills quads covers grid lines, axis lines, tick marks, the crosshair,
the box-select rectangle and the plot background; a dashed line is a run of
quads. Positions are computed in *logical* pixels, exactly as the web computes
CSS pixels, and converted to device pixels at the last moment — which is also
where `ph_frame_target.flip_y` is handled for everything except the layers.

## What the hosts own

Faz 2 settled a question Faz 0 left open: how much chrome belongs in the engine.

**The toolbar does not.** The web core draws its own (`ui/toolbar.ts`) because a
browser gives it nothing better. Both Qt galleries build one out of ordinary
`ToolBar` / `QToolBar` actions over `ph_plot_set_mode` and `ph_plot_reset_view`,
and the result is native, themed, keyboard-navigable and accessible in a way a
GL-drawn strip of buttons could never be. The same goes for status readouts,
menus and dialogs. The engine's job ends at the plot's own furniture — grid,
axes, labels, legend, tooltip — the parts that have to line up with the data.

**Clearing does not either.** The Quick item clears to nothing and composites
onto a themed QML window; the widget clears to the chart's page colour because a
`QOpenGLWidget` composites onto whatever the palette put behind it. Neither is
more correct. The engine draws its region background and leaves the rest alone.

## Binding mapping

The ABI was shaped so that each binding is mechanical:

| C | C# (P/Invoke) | Java (Panama, JDK 22+) |
| --- | --- | --- |
| `uint64_t` handle | `ulong` | `long` |
| `int32_t` / enum | `int` | `JAVA_INT` |
| `double` | `double` | `JAVA_DOUBLE` |
| `const double*` | `double[]` (blittable, no pinning) | `MemorySegment` |
| `const char*` (UTF-8) | `[MarshalAs(UnmanagedType.LPUTF8Str)] string` | `arena.allocateFrom(s)` |
| descriptor struct | `[StructLayout(LayoutKind.Sequential)] struct` | `MemoryLayout.structLayout` |
| `PH_CALL` | `CallingConvention.Cdecl` — **must be explicit** | n/a |

Sketches live in [`bindings/`](bindings/). They are reference, not built.

## Adding the remaining layers

The other 24 layer types (bar, area, heatmap, box, hexbin, contour, errorbar,
stem, quiver, candlestick, ohlc, patches, pie, image, graph, and the `plot3d`
family) each follow the same three-part shape:

1. `ph_<name>_desc` struct with `struct_size` first and zero-means-default.
2. `ph_<name>_desc_init` filling the core's documented defaults.
3. `ph_plot_add_<name>` returning a `ph_layer`.

Appending them is additive — it does not change `PHOTON_ABI_VERSION`.

Composed charts (finance, diagrams, ML) stay what they are in the web core: free
functions over existing layers, not new GL layers. They can live above the ABI
in each binding, or below it as `ph_plot_add_<chart>` — that call is Faz 4's.

## Roadmap

- **Faz 0 — done.** ABI, host contract, handle safety, interaction port, build.
- **Faz 1 — done.** GL 3.3 backend, line + scatter, the SDF text renderer,
  grid/axes/labels/title, theme and axis styling, offscreen readback, and the
  GLFW host with a four-panel gallery (`-DPHOTON_BUILD_GLFW_HOST=ON`).
- **Faz 2 — done.** Qt Quick (`QQuickFramebufferObject`) and Qt Widgets
  (`QOpenGLWidget`) hosts, both driving the same demo charts as GLFW from
  `hosts/common/panels.c`. *The second host is what proves the first host's
  abstraction was real* — it proved it was not, twice: see the locale note above
  and the `flip_y` note in the host contract.
- **Faz 3.** C# and Java bindings, generated from the header rather than
  hand-written.
- **Faz 4.** The remaining layers and the 3D family.

## Open questions

- **Colors are `uint32` RGBA, not CSS strings.** `ph_color_parse` still handles
  only the hex forms. The text work turned out not to need a CSS parser — a font
  is a size here, not a `font` shorthand — so `rgb()`, `rgba()` and named colors
  are still open, and are now plain backlog rather than blocked on anything.
- **Fonts are a size, not a family.** `ph_axis_config` takes `label_size` in
  logical pixels where the web takes a CSS `font` string. One family is embedded
  and no other can be loaded, so a family name would be a promise the library
  cannot keep. If host-supplied fonts are ever wanted, that is a new ABI call
  that hands over TTF bytes, not a string.
- **The left margin is fixed at 56px and does not measure its labels.** That is
  not an omission — `plot.ts` does the same, and a margin that measured would put
  the native and web plot regions in different places. It does mean a very wide
  y label overhangs on both.
- **Whether ordinal-time's calendar tick logic ports as-is.** It leans on JS
  `Date` for local-time calendar boundaries; the C++ side uses `localtime_r` and
  `mktime`, which are affected by `TZ` and are not thread-safe on every libc.
  Needs checking near DST boundaries on all three platforms.
