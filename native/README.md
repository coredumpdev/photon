# @photonviz native

The C++ port of `@photonviz/core`, exposed through one C ABI so a single engine
can drive GLFW, Qt/QML, C# and Java hosts.

**Faz 0 done, Faz 1 in progress.** The ABI, the host contract and the
interaction model are complete and tested. The OpenGL 3.3 backend renders line
and scatter series — verified headless against a real GL context. Still to come
in Faz 1: the SDF text renderer, then grid, axes and labels on top of it, then
the GLFW host. See [DESIGN.md](DESIGN.md) for the architecture and the reasoning
behind it, and [TODO.md](TODO.md) for everything still outstanding.

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

## Layout

```
include/photon/photon.h   the entire public surface — the only file bindings see
src/
  abi.cpp                 C entry points: validate, translate, delegate
  plot.{hpp,cpp}          layout, scale stack, autoscale, pan/zoom/box, frames
  layer.{hpp,cpp}         the layer contract; line + scatter, shaders and all
  scale.{hpp,cpp}         the five scale projections, ticks and label formats
  axes/ticks.{hpp,cpp}    nice-number tick generation and number formatting
  gl/gl.{hpp,cpp}         the GL 3.3 loader — one X-macro list, no glad
  gl/program.{hpp,cpp}    shader compile/link/cache, GLSL ES 3.00 -> 3.30
  gl/transform.{hpp,cpp}  the shared data->clip transform every layer includes
  handle_table.hpp        generation-tagged handles
  registry.{hpp,cpp}      global state and handle resolution
  error.{hpp,cpp}         thread-local error strings
tests/
  abi_c_test.c            the ABI as a C consumer sees it
  interaction_test.cpp    the ported math, checked against plot.ts
  scale_test.cpp          scales and ticks, checked against the vitest suite
  gl_smoke_test.c         a real headless GL context; the only shader compile
third_party/
  stb_truetype.h          public domain, v1.26
  fonts/                  Inter subset (OFL-1.1) + its license
tools/make_font.py        regenerates the font subset
bindings/                 reference sketches (not built)
cmake/                    package config and export-symbol lists
```

## Using it

```c
#include <photon/photon.h>

ph_init(PHOTON_ABI_VERSION, NULL);

ph_plot plot;
ph_plot_create(NULL, &plot);              /* NULL = core defaults */

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

This is a port, not a reimplementation. The scales, the autoscale padding and
the pan/zoom math produce the same numbers as `packages/core/src/plot.ts` — the
tests assert against values derived from that file by hand. Where the native and
web designs diverge, DESIGN.md says so and why; the one deliberate divergence so
far is the shared WebGL context, which exists to work around a browser limit
that native hosts do not have.
