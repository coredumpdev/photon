/*
 * The ABI as a *C* consumer sees it.
 *
 * This file is compiled as C99, which is the point: if photon.h ever grows a
 * C++-only construct, or a struct whose layout depends on the compiler, this
 * translation unit stops building. Every binding we ship — P/Invoke, Panama,
 * Qt — sees the ABI through the same lens as this file does.
 */

#include <photon/photon.h>
#include <stddef.h>
#include <string.h>

#include "check.h"

static void test_version_and_init(void) {
  int32_t major = -1, minor = -1, patch = -1;

  CHECK_EQ(ph_abi_version(), PHOTON_ABI_VERSION);

  ph_version(&major, &minor, &patch);
  CHECK(major >= 0 && minor >= 0 && patch >= 0);
  /* Every out-pointer is optional; a binding that wants one field says so. */
  ph_version(NULL, NULL, NULL);

  /* Calls before ph_init must be refused, not crash. */
  {
    ph_plot plot = PH_NULL_HANDLE;
    CHECK_EQ(ph_plot_create(NULL, &plot), PH_E_NOT_INITIALIZED);
  }

  /* A caller built against a different ABI is rejected by version, not by
   * discovering a struct-layout mismatch at runtime. */
  CHECK_EQ(ph_init(PHOTON_ABI_VERSION + 1u, NULL), PH_E_ABI_MISMATCH);
  CHECK(strlen(ph_last_error()) > 0);

  CHECK_EQ(ph_init(PHOTON_ABI_VERSION, NULL), PH_OK);
  CHECK_EQ(ph_init(PHOTON_ABI_VERSION, NULL), PH_OK); /* idempotent */
}

static void test_zero_initialized_descriptors(void) {
  /* The central promise of the descriptor design: a struct a binding got from
   * `calloc`, `new ph_plot_desc()` or an arena allocator is already valid and
   * already means "core defaults". */
  ph_plot_desc zeroed;
  ph_plot_desc defaulted;
  ph_plot plot = PH_NULL_HANDLE;
  ph_range domain;

  memset(&zeroed, 0, sizeof(zeroed));
  ph_plot_desc_init(&defaulted);

  /* ph_plot_desc_init writes struct_size, width and height; every other field
   * must already be at its default when zeroed. */
  CHECK_EQ(defaulted.mode, PH_MODE_PAN);
  CHECK_EQ(defaulted.theme, PH_THEME_DARK);
  CHECK_EQ(defaulted.no_interaction, 0);
  CHECK_EQ(defaulted.no_hover, 0);
  CHECK_EQ(defaulted.x.type, PH_SCALE_LINEAR);
  CHECK_EQ(zeroed.mode, PH_MODE_PAN);
  CHECK_EQ(zeroed.no_interaction, defaulted.no_interaction);

  CHECK_EQ(ph_plot_create(&zeroed, &plot), PH_OK);
  CHECK(ph_plot_valid(plot));
  /* struct_size 0 is read as "the whole struct", so a zeroed desc is honoured. */
  CHECK_EQ(ph_plot_get_domain(plot, "x", &domain), PH_OK);
  CHECK_EQ(ph_plot_destroy(plot), PH_OK);

  /* NULL means all-defaults too. */
  CHECK_EQ(ph_plot_create(NULL, &plot), PH_OK);
  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

static void test_forward_compatible_descriptor(void) {
  /* A binding compiled against an older header sends a shorter struct. The
   * fields it never knew about have to stay at their defaults rather than
   * being read out of whatever memory followed. */
  ph_line_desc desc;
  ph_plot plot = PH_NULL_HANDLE;
  ph_layer layer = PH_NULL_HANDLE;
  double xs[3] = {0.0, 1.0, 2.0};
  double ys[3] = {10.0, 20.0, 30.0};

  ph_line_desc_init(&desc);
  desc.x = xs;
  desc.y = ys;
  desc.count = 3;
  /* Claim to be an older, shorter version of the struct. */
  desc.struct_size = (uint32_t)(offsetof(ph_line_desc, name));

  CHECK_EQ(ph_plot_create(NULL, &plot), PH_OK);
  CHECK_EQ(ph_plot_add_line(plot, &desc, &layer), PH_OK);
  CHECK(ph_layer_valid(layer));

  /* A struct_size larger than this build understands is the one direction we
   * cannot guess at, and it is rejected. */
  desc.struct_size = (uint32_t)(sizeof(ph_line_desc) + 64u);
  CHECK_EQ(ph_plot_add_line(plot, &desc, &layer), PH_E_INVALID_ARGUMENT);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

static void test_struct_layout_is_pinned(void) {
  /*
   * Bindings that are not C compute these offsets themselves — the C# structs
   * are [StructLayout(Sequential)], the Java ones are a hand-spelled
   * MemoryLayout with explicit padding. Reordering a descriptor field would
   * still compile everywhere and would silently feed the engine garbage, so
   * the layout is part of the ABI and is asserted here rather than assumed.
   *
   * The numbers are the LP64 layout (Linux/macOS x64 and arm64, Windows x64).
   */
  CHECK_EQ(sizeof(ph_range), 16);

  CHECK_EQ(offsetof(ph_line_desc, struct_size), 0);
  CHECK_EQ(offsetof(ph_line_desc, x), 8);   /* 4 bytes of padding after struct_size */
  CHECK_EQ(offsetof(ph_line_desc, y), 16);
  CHECK_EQ(offsetof(ph_line_desc, count), 24);
  CHECK_EQ(offsetof(ph_line_desc, color), 28);
  CHECK_EQ(offsetof(ph_line_desc, width), 32);

  CHECK_EQ(offsetof(ph_event, struct_size), 0);
  CHECK_EQ(offsetof(ph_event, type), 4);
  CHECK_EQ(offsetof(ph_event, layer), 8);
  CHECK_EQ(offsetof(ph_event, x), 16);
  CHECK_EQ(offsetof(ph_event, y), 32);
  CHECK_EQ(offsetof(ph_event, cursor_x), 48);
  CHECK_EQ(offsetof(ph_event, cursor_y), 56);
  CHECK_EQ(offsetof(ph_event, cursor_valid), 64);
  CHECK_EQ(offsetof(ph_event, mode), 68);
  CHECK_EQ(offsetof(ph_event, visible), 72);
  /* Trailing padding to the struct's 8-byte alignment; Panama needs it spelled. */
  CHECK_EQ(sizeof(ph_event), 80);

  CHECK_EQ(offsetof(ph_frame_target, framebuffer), 4);
  CHECK_EQ(offsetof(ph_frame_target, dpr), 24);
  CHECK_EQ(offsetof(ph_frame_target, flip_y), 28);
  CHECK_EQ(sizeof(ph_frame_target), 32);

  /* No enum may widen past int32: that would shift every struct after it. */
  CHECK_EQ(sizeof(ph_result), 4);
  CHECK_EQ(sizeof(ph_scale_type), 4);
  CHECK_EQ(sizeof(ph_event_type), 4);
  CHECK_EQ(sizeof(ph_bool), 4);
  CHECK_EQ(sizeof(ph_color), 4);
  CHECK_EQ(sizeof(ph_plot), 8);
  CHECK_EQ(sizeof(ph_layer), 8);
}

static void test_handle_safety(void) {
  /* The reason handles are generation-tagged integers instead of pointers: a
   * GC finalizer in C# or Java will eventually free twice, and it has to be an
   * error code rather than a corrupted heap. */
  ph_plot plot = PH_NULL_HANDLE;
  ph_plot stale;
  ph_layer layer = PH_NULL_HANDLE;
  ph_line_desc line;
  double xs[2] = {0.0, 1.0};
  double ys[2] = {0.0, 1.0};

  CHECK_EQ(ph_plot_create(NULL, &plot), PH_OK);
  stale = plot;

  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = 2;
  CHECK_EQ(ph_plot_add_line(plot, &line, &layer), PH_OK);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);

  /* Double free. */
  CHECK_EQ(ph_plot_destroy(stale), PH_E_INVALID_HANDLE);
  CHECK_EQ(ph_plot_valid(stale), 0);
  /* Use after free. */
  CHECK_EQ(ph_plot_set_size(stale, 100, 100), PH_E_INVALID_HANDLE);
  /* A layer handle outliving its plot is the subtle one, and it is caught. */
  CHECK_EQ(ph_layer_valid(layer), 0);
  CHECK_EQ(ph_layer_set_visible(layer, 0), PH_E_INVALID_HANDLE);

  /* A fabricated handle is just an invalid one. */
  CHECK_EQ(ph_plot_valid((ph_plot)0xdeadbeefULL), 0);
  CHECK_EQ(ph_plot_destroy(PH_NULL_HANDLE), PH_OK); /* freeing null is a no-op */
}

static void test_color_parsing(void) {
  ph_color color = 0;

  CHECK_EQ(ph_color_parse("#ff8800", &color), PH_OK);
  CHECK_EQ(color, 0xff8800ffu);

  CHECK_EQ(ph_color_parse("#f80", &color), PH_OK);
  CHECK_EQ(color, 0xff8800ffu); /* shorthand expands to the same value */

  CHECK_EQ(ph_color_parse("#12345678", &color), PH_OK);
  CHECK_EQ(color, 0x12345678u);

  /* #rgba is valid CSS Color 4 shorthand, alpha included. */
  CHECK_EQ(ph_color_parse("#f808", &color), PH_OK);
  CHECK_EQ(color, 0xff880088u);

  /* Only 3, 4, 6 and 8 digits are lengths CSS defines. */
  CHECK_EQ(ph_color_parse("#xyz", &color), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_color_parse("#ff888", &color), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_color_parse("#ff", &color), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_color_parse("#", &color), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_color_parse(NULL, &color), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_color_parse("rebeccapurple", &color), PH_E_UNSUPPORTED);
}

static void test_axis_styling_and_explicit_ticks(void) {
  ph_plot plot = PH_NULL_HANDLE;
  ph_axis_config config;
  ph_tick ticks[3];

  CHECK_EQ(ph_plot_create(NULL, &plot), PH_OK);

  /* Zero means default here too, so a calloc'd config is a valid one. */
  memset(&config, 0, sizeof(config));
  CHECK_EQ(ph_plot_set_axis_config(plot, "x", &config), PH_OK);

  ph_axis_config_init(&config);
  CHECK_EQ(config.struct_size, (uint32_t)sizeof(ph_axis_config));
  config.title = "time (s)";
  config.minor_ticks = 4;
  config.no_grid = 1;
  CHECK_EQ(ph_plot_set_axis_config(plot, "x", &config), PH_OK);
  CHECK_EQ(ph_plot_set_axis_config(plot, "y", &config), PH_OK);
  /* NULL restores the theme defaults rather than being an error. */
  CHECK_EQ(ph_plot_set_axis_config(plot, "y", NULL), PH_OK);
  CHECK_EQ(ph_plot_set_axis_config(plot, "nope", &config), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_set_axis_config(plot, NULL, &config), PH_E_INVALID_ARGUMENT);

  memset(ticks, 0, sizeof(ticks));
  ticks[0].value = 0.0;
  ticks[0].label = "start";
  ticks[1].value = 0.5;
  ticks[1].minor = 1;
  ticks[1].grid = PH_TOGGLE_ON; /* a minor tick that does draw a grid line */
  ticks[2].value = 1.0;
  CHECK_EQ(ph_plot_set_axis_ticks(plot, "x", ticks, 3), PH_OK);
  /* Zero restores the automatic ticks, and may pass a null array. */
  CHECK_EQ(ph_plot_set_axis_ticks(plot, "x", NULL, 0), PH_OK);
  CHECK_EQ(ph_plot_set_axis_ticks(plot, "x", NULL, 3), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_set_axis_ticks(plot, "x", ticks, -1), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_set_axis_ticks(plot, "missing", ticks, 3), PH_E_INVALID_ARGUMENT);

  /* A title, and clearing it again. */
  CHECK_EQ(ph_plot_set_title(plot, "Portfolio"), PH_OK);
  CHECK_EQ(ph_plot_set_title(plot, NULL), PH_OK);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

static void test_render_without_a_context_is_honest(void) {
  /* This test suite runs headless: ph_init got no get_proc_address, so there is
   * nothing to resolve GL against. Rendering must say exactly that rather than
   * silently succeeding and leaving a host wondering why the window is blank —
   * the failure mode v0.7.1 fixed across the Python bridge. */
  ph_plot plot = PH_NULL_HANDLE;
  ph_frame_target target;
  unsigned char pixels[16 * 16 * 4];

  CHECK_EQ(ph_plot_create(NULL, &plot), PH_OK);

  ph_frame_target_init(&target);
  target.width = 640;
  target.height = 400;
  CHECK_EQ(ph_plot_render(plot, &target), PH_E_GL);
  /* The message has to name the missing thing, not just "GL error". */
  CHECK(strstr(ph_last_error(), "get_proc_address") != NULL);

  /* Offscreen readback needs the same context, and fails the same way. */
  CHECK_EQ(ph_plot_render_pixels(plot, 16, 16, 1.0f, pixels, 16 * 4), PH_E_GL);
  CHECK(strstr(ph_last_error(), "get_proc_address") != NULL);
  /* Argument validation still runs ahead of both. */
  CHECK_EQ(ph_plot_render_pixels(plot, 16, 16, 1.0f, pixels, 8), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_render_pixels(plot, 0, 16, 1.0f, pixels, 64), PH_E_INVALID_ARGUMENT);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);
}

int main(void) {
  RUN(test_version_and_init);
  RUN(test_zero_initialized_descriptors);
  RUN(test_forward_compatible_descriptor);
  RUN(test_struct_layout_is_pinned);
  RUN(test_handle_safety);
  RUN(test_color_parsing);
  RUN(test_axis_styling_and_explicit_ticks);
  RUN(test_render_without_a_context_is_honest);
  ph_shutdown();
  return TEST_MAIN_RESULT();
}
