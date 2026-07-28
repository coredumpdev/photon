# Photon native — Faz 0 design

The native port of `@photonviz/core`, built so that one C++ engine drives GLFW,
Qt/QML, C# and Java hosts through a single C ABI.

This document is the Faz 0 deliverable: the ABI, the host contract, and the
decisions that are expensive to change later. It records *why*, not just what —
the what is in [`include/photon/photon.h`](include/photon/photon.h).

## Status

Faz 0 is complete. Faz 1 is in progress: the GL backend renders series, and the
axis furniture around them is what is left.

| Area | State |
| --- | --- |
| C ABI (48 entry points) | complete for plot, axes, view, input, events, line + scatter |
| Handle safety | generation-tagged, double-free and use-after-free tested |
| Scales | all five projections, ticks and label formatting — checked against the vitest suite |
| Interaction | pan, wheel zoom, box zoom, axis lock, bounded pan — verified against `plot.ts` |
| Autoscale | `padDomain` + non-finite skipping, verified against `plot.ts` |
| Event queue | polled, coalescing, bounded |
| GL loader | OpenGL 3.3 core, ~65 entry points, resolved via the host's `get_proc_address` |
| Line layer | ported incl. min/max decimation, dashes, miter/bevel joins |
| Scatter layer | ported incl. per-point size and colour, all six markers |
| Rendering | draws to the host's framebuffer, scissored to the plot region — **verified headless on a real GL 3.3 context** |
| Font pipeline | Inter subset to 418 codepoints (29 KB), stb_truetype parses it, SDFs rasterize |
| Text renderer | **next** — SDF atlas and the glyph shader |
| Grid, axes, labels | **next** — needs the text renderer |
| Offscreen readback | not started (`ph_plot_render_pixels`) |
| GLFW host | not started |

`tests/gl_smoke_test.c` is the one that matters most here: it creates a
surfaceless EGL context, renders a line and a scatter through the public ABI,
and reads the pixels back. It is the only test that compiles a shader, so it is
the only thing that can catch a broken GLSL ES 3.00 → 3.30 translation.

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
| Qt Quick / QML | `QQuickFramebufferObject::Renderer`'s FBO | `flip_y = 1`; pin the backend with `QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL)` |
| Qt Widgets | `QOpenGLWidget::defaultFramebufferObject()` | simplest Qt path |
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
`cmake/photon.symbols` on macOS). Verified: 48 exports, all `ph_*`.

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

**Reproduced numerically, rewritten structurally**: `plot.ts`. Layout,
autoscale, and the pan/zoom/box math are reproduced exactly — `tests/interaction_test.cpp`
checks them against values hand-derived from `plot.ts`, not from running this
code. The DOM half (three stacked canvases, pointer listeners, toolbar, context
menu) does not cross over.

**Deliberately not ported**: `gl/shared.ts`. See above.

**Has no equivalent and must be written**: text. The web core gets fonts free
from Canvas2D (~200 `ctx.` calls across `render/overlay.ts` and `plot.ts` for
tick labels, legend, tooltip, title). Natively that is an SDF atlas renderer
built on stb_truetype.

The font is **embedded**, not discovered from the system. A system font would
mean a chart's tick labels have different metrics on Windows, macOS and Linux —
different label widths, so different axis margins, so a different plot region
for the same data. Embedding is what makes a native chart and a web chart line
up. `third_party/fonts/` holds Inter, instanced to Regular and subset to the
418 codepoints a chart actually draws: ASCII, Latin-1 and Latin Extended-A (so
Turkish, Polish and Czech labels render), Greek, and the maths and currency
symbols scientific and finance charts need. That is 29 KB, down from 856 KB for
the full variable face. `tools/make_font.py` regenerates it.

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
- **Faz 1 — in progress.** Done: GL 3.3 backend, line + scatter, ticks and
  label formatting, the font pipeline, headless GL verification. Left: the SDF
  text renderer, grid/axes/labels, offscreen readback, and the GLFW host
  (`PHOTON_BUILD_GLFW_HOST`).
- **Faz 2.** Qt/QML host. *The second host is what proves the first host's
  abstraction was real.* Do not start Faz 3 before this lands.
- **Faz 3.** C# and Java bindings, generated from the header rather than
  hand-written.
- **Faz 4.** The remaining layers and the 3D family.

## Open questions

- **Colors are `uint32` RGBA, not CSS strings.** `ph_color_parse` handles the hex
  forms today; `rgb()`/`rgba()`/named colors arrive with the text renderer in
  Faz 1, which needs a real CSS parser anyway.
- **Tick generation and label formatting are not in the ABI yet.** They are
  `Scale`'s remaining half, and their shape depends on how the text renderer
  wants to be fed. Faz 1.
- **`equal_aspect` is accepted and stored but not applied.** It needs the
  layout, which needs the renderer.
- **Whether ordinal-time's calendar tick logic ports as-is.** It leans on JS
  `Date` for local-time calendar boundaries; `std::chrono`'s time zone support
  is the intended replacement, and needs checking on all three platforms.
