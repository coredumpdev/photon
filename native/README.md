# @photonviz native

The C++ port of `@photonviz/core`, exposed through one C ABI so a single engine
can drive GLFW, Qt/QML, C# and Java hosts.

**Faz 0 through Faz 3 are done.** The ABI, the host contract and the
interaction model are complete and tested; the OpenGL 3.3 backend draws line and
scatter series with a full chart around them — grid, axes, tick labels, axis
titles and a plot title, all rendered from an embedded SDF font.
`ph_plot_render_pixels` covers hosts with no GL interop. Three hosts drive the
same engine: GLFW, Qt Quick and Qt Widgets, all showing the same four charts
from `hosts/common/panels.c`. C# and Java bindings are generated from the header,
and the Java one is built and run by `ctest`. Next are the remaining layer types.
See [DESIGN.md](DESIGN.md) for the architecture and the reasoning behind it, and
[TODO.md](TODO.md) for what is still outstanding.

## Build

Requires CMake 3.24+ and a C++20 compiler. No external dependencies.

```bash
cmake --preset debug        # or: release, asan, msvc
cmake --build build/debug
ctest --preset debug
```

Presets: `debug`, `release`, `asan` (AddressSanitizer + UBSan, non-Windows),
`msvc` (Visual Studio 2022 x64). Tested on GCC, Clang and MSVC.

Useful options: `-DPHOTON_BUILD_SHARED=OFF` for a static library,
`-DPHOTON_BUILD_TESTS=OFF`, `-DPHOTON_WARNINGS_AS_ERRORS=ON` (already on in the
presets).

### The galleries

The same four charts, under three hosts. Both host options are off by default —
GLFW because it is fetched over the network, Qt because it is a large thing to
require of anyone building the library.

```bash
cmake -S . -B build/hosts -DPHOTON_BUILD_GLFW_HOST=ON -DPHOTON_BUILD_QT_HOST=ON
cmake --build build/hosts

./build/hosts/bin/photon_gallery            # GLFW
./build/hosts/bin/photon_gallery_qml        # Qt Quick
./build/hosts/bin/photon_gallery_widgets    # Qt Widgets
```

The GLFW gallery's keys:

```
drag    pan            wheel   zoom about the cursor
B       box zoom       P       back to pan
R       reset view     T       light / dark
space   pause the streaming panel
```

The Qt galleries put the same actions in a toolbar, and both take
`--grab <file.png>` to render one frame to disk — which is how the native output
gets compared against the web gallery as an image rather than by eye. See
[hosts/qt/README.md](hosts/qt/README.md) for what building the second host
turned up.

## Layout

```
include/photon/photon.h   the entire public surface — the only file bindings see
src/
  abi.cpp                 C entry points: validate, translate, delegate
  plot.{hpp,cpp}          layout, scale stack, autoscale, pan/zoom/box, frames
  layer.{hpp,cpp}         the layer contract; line + scatter, shaders and all
  scale.{hpp,cpp}         the five scale projections, ticks and label formats
  color.{hpp,cpp}         packed ABI colours unpacked
  axes/ticks.{hpp,cpp}    nice-number tick generation and number formatting
  axes/axis.{hpp,cpp}     tick configuration resolved against a scale
  gl/gl.{hpp,cpp}         the GL 3.3 loader — one X-macro list, no glad
  gl/program.{hpp,cpp}    shader compile/link/cache, GLSL ES 3.00 -> 3.30
  gl/transform.{hpp,cpp}  the shared data->clip transform every layer includes
  render/primitives.*     axis-aligned fills in device-pixel space
  render/theme.*          light/dark themes and resolved axis styling
  render/overlay.*        grid, axes, labels, title, crosshair, box select
  text/font.{hpp,cpp}     the embedded face and its SDF glyph cache
  text/text.{hpp,cpp}     the glyph shader and the per-frame batch
  text/stb_impl.cpp       the one TU that instantiates stb_truetype
  handle_table.hpp        generation-tagged handles
  registry.{hpp,cpp}      global state and handle resolution
  error.{hpp,cpp}         thread-local error strings
tests/
  abi_c_test.c            the ABI as a C consumer sees it
  interaction_test.cpp    the ported math, checked against plot.ts
  scale_test.cpp          scales and ticks, checked against the vitest suite
  overlay_test.cpp        margins, axis placement, tick resolution, themes
  text_test.cpp           font metrics, kerning and UTF-8 — widths pinned
  gl_smoke_test.c         a real headless GL context; the only shader compile
  abi_layout_test.c       generated: every field offset, asserted
hosts/
  common/panels.c         the demo charts, shared by every host
  glfw/                   window, input, a grid of plots in one context
  qt/                     a QQuickFramebufferObject item and a QOpenGLWidget
third_party/
  stb_truetype.h          public domain, v1.26
  fonts/                  Inter subset (OFL-1.1) + its license
tools/
  make_font.py            regenerates the font subset
  generate_bindings.py    emits the bindings and the layout check from the header
bindings/                 generated C# and Java, plus a test for each
cmake/                    package config, export-symbol lists, the font embedder
```

## Using it

```c
#include <photon/photon.h>

ph_init(PHOTON_ABI_VERSION, NULL);

ph_plot plot;
ph_plot_create(NULL, &plot);              /* NULL = core defaults */
ph_plot_set_title(plot, "Signal");

ph_axis_config axis;
ph_axis_config_init(&axis);
axis.title = "time (s)";
axis.minor_ticks = 4;
ph_plot_set_axis_config(plot, "x", &axis);

double xs[] = {0, 1, 2, 3};
double ys[] = {10, 20, 15, 30};
ph_line_desc line;
ph_line_desc_init(&line);
line.x = xs; line.y = ys; line.count = 4;
ph_color_parse("#4f9cff", &line.color);

ph_layer layer;
ph_plot_add_line(plot, &line, &layer);    /* the arrays are copied here */

/* per frame: make the GL context current, then */
ph_frame_target target;
ph_frame_target_init(&target);
target.width = 1280; target.height = 800; target.dpr = 2.0f;
ph_plot_render(plot, &target);

ph_event ev;
while (ph_plot_poll_event(plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
  /* PH_EVENT_REDRAW_REQUESTED -> schedule another frame */
}

ph_plot_destroy(plot);
ph_shutdown();
```

Consuming it from another CMake project:

```cmake
find_package(photon REQUIRED)
target_link_libraries(my_host PRIVATE photon::photon)
```

## Relationship to the TypeScript core

This is a port, not a reimplementation. The scales, the autoscale padding, the
pan/zoom math and the overlay's layout produce the same numbers as
`packages/core/src/plot.ts` and `render/overlay.ts` — the tests assert against
values derived from those files by hand. Where the native and web designs
diverge, DESIGN.md says so and why; the one deliberate divergence is the shared
WebGL context, which exists to work around a browser limit that native hosts do
not have.
