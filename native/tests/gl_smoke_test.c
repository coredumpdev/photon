/*
 * The renderer, on a real GL 3.3 core context, headless.
 *
 * This is the only test that can catch a broken shader: the layers' GLSL is
 * authored as `#version 300 es` and shared verbatim with the web core, then
 * rewritten to `#version 330 core` at load. Nothing else in the suite compiles
 * a shader, so without this a translation bug would sit undetected until the
 * first host window opened.
 *
 * It runs surfaceless through EGL, so it needs no display server and works in
 * CI. Where EGL or a 3.3 core context is unavailable it exits 77, which CMake
 * is told to treat as "skipped" rather than "failed" — a machine without a GPU
 * should not turn the suite red.
 */

#include <EGL/egl.h>
#include <photon/photon.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "check.h"

#define SKIP_EXIT 77
#define WIDTH 400
#define HEIGHT 300

static void* PH_CALL resolve_gl(const char* name, void* user) {
  (void)user;
  return (void*)eglGetProcAddress(name);
}

/* glReadPixels, fetched directly — the library keeps its own loader private. */
typedef void(PH_CALL* read_pixels_fn)(int, int, int, int, unsigned, unsigned, void*);

static int skip(const char* why) {
  printf("SKIP: %s\n", why);
  return SKIP_EXIT;
}

int main(void) {
  EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  if (display == EGL_NO_DISPLAY) return skip("no EGL display");
  if (!eglInitialize(display, NULL, NULL)) return skip("eglInitialize failed");
  if (!eglBindAPI(EGL_OPENGL_API)) return skip("EGL cannot bind desktop OpenGL");

  const EGLint config_attribs[] = {
      EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
      EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
  EGLConfig config;
  EGLint config_count = 0;
  if (!eglChooseConfig(display, config_attribs, &config, 1, &config_count) || config_count < 1) {
    return skip("no suitable EGL config");
  }

  const EGLint context_attribs[] = {
      EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 3,
      EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
  EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, context_attribs);
  if (context == EGL_NO_CONTEXT) return skip("no OpenGL 3.3 core context");

  const EGLint surface_attribs[] = {EGL_WIDTH, WIDTH, EGL_HEIGHT, HEIGHT, EGL_NONE};
  EGLSurface surface = eglCreatePbufferSurface(display, config, surface_attribs);
  if (surface == EGL_NO_SURFACE) return skip("no pbuffer surface");
  if (!eglMakeCurrent(display, surface, surface, context)) return skip("eglMakeCurrent failed");

  /* ---- the library, driven exactly as a host would ---- */

  ph_host_desc host;
  ph_host_desc_init(&host);
  host.api = PH_GFX_GL33;
  host.get_proc_address = resolve_gl;
  CHECK_EQ(ph_init(PHOTON_ABI_VERSION, &host), PH_OK);

  ph_plot_desc plot_desc;
  ph_plot_desc_init(&plot_desc);
  plot_desc.width = WIDTH;
  plot_desc.height = HEIGHT;
  ph_plot plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&plot_desc, &plot), PH_OK);

  /* A zigzag: every segment turns, so joins and caps are exercised too. */
  double xs[64], ys[64];
  for (int i = 0; i < 64; i++) {
    xs[i] = i;
    ys[i] = (i % 2) ? 10.0 : -10.0;
  }

  ph_line_desc line_desc;
  ph_line_desc_init(&line_desc);
  line_desc.x = xs;
  line_desc.y = ys;
  line_desc.count = 64;
  line_desc.width = 3.0f;
  CHECK_EQ(ph_color_parse("#ff0000", &line_desc.color), PH_OK);
  ph_layer line = PH_NULL_HANDLE;
  if (ph_plot_add_line(plot, &line_desc, &line) != PH_OK) {
    printf("  FAIL add_line: %s\n", ph_last_error());
    return 1;
  }

  ph_scatter_desc scatter_desc;
  ph_scatter_desc_init(&scatter_desc);
  scatter_desc.x = xs;
  scatter_desc.y = ys;
  scatter_desc.count = 64;
  scatter_desc.size = 9.0f;
  scatter_desc.marker = PH_MARKER_DIAMOND;
  CHECK_EQ(ph_color_parse("#00ff00", &scatter_desc.color), PH_OK);
  ph_layer scatter = PH_NULL_HANDLE;
  if (ph_plot_add_scatter(plot, &scatter_desc, &scatter) != PH_OK) {
    printf("  FAIL add_scatter: %s\n", ph_last_error());
    return 1;
  }

  ph_frame_target target;
  ph_frame_target_init(&target);
  target.framebuffer = 0;
  target.width = WIDTH;
  target.height = HEIGHT;
  target.dpr = 1.0f;

  /* This is the line that compiles and links every shader. */
  const ph_result rendered = ph_plot_render(plot, &target);
  if (rendered != PH_OK) {
    printf("  FAIL render (%d): %s\n", rendered, ph_last_error());
    return 1;
  }
  CHECK_EQ(ph_plot_needs_redraw(plot), 0);

  /* ---- did anything actually land on the framebuffer? ---- */

  read_pixels_fn read_pixels = (read_pixels_fn)eglGetProcAddress("glReadPixels");
  if (!read_pixels) return skip("glReadPixels unavailable");

  unsigned char* pixels = (unsigned char*)malloc((size_t)WIDTH * HEIGHT * 4);
  if (!pixels) return 1;
  memset(pixels, 0, (size_t)WIDTH * HEIGHT * 4);
  read_pixels(0, 0, WIDTH, HEIGHT, 0x1908 /* GL_RGBA */, 0x1401 /* GL_UNSIGNED_BYTE */, pixels);

  /* The default margins are top 16, right 16, bottom 40, left 56, so the plot
   * region's bottom edge is 40 logical px up — framebuffer row 40, since row 0
   * is the bottom. The x tick labels sit just below the tick marks, entirely
   * inside rows 0..33; the y tick labels sit left of column 45. */
  const int region_bottom_row = 40;
  const int x_label_rows = 34;
  const int y_label_columns = 45;

  long opaque = 0, reds = 0, greens = 0;
  long series_bleed = 0, x_labels = 0, y_labels = 0;
  for (int y = 0; y < HEIGHT; y++) {
    for (int x = 0; x < WIDTH; x++) {
      const unsigned char* p = pixels + ((size_t)y * WIDTH + x) * 4;
      if (p[3] == 0) continue;
      opaque++;
      /* One dominant channel, not just a majority: the tick labels are a pale
       * slate blue whose green component alone would pass a looser test. */
      const int red = p[0] > 120 && p[1] < 40 && p[2] < 40;
      const int green = p[1] > 120 && p[0] < 40 && p[2] < 40;
      if (red) reds++;
      if (green) greens++;
      /* A series pixel outside the plot region means the scissor let it out. */
      if ((red || green) && (y < region_bottom_row || x < 56)) series_bleed++;
      if (y < x_label_rows) x_labels++;
      if (x < y_label_columns && y >= region_bottom_row && y < HEIGHT - 16) y_labels++;
    }
  }
  free(pixels);

  printf("  opaque=%ld red(line)=%ld green(markers)=%ld bleed=%ld x-labels=%ld y-labels=%ld\n",
         opaque, reds, greens, series_bleed, x_labels, y_labels);

  CHECK(opaque > 500);      /* something was drawn at all           */
  CHECK(reds > 100);        /* the line layer                       */
  CHECK(greens > 100);      /* the scatter layer                    */
  CHECK_EQ(series_bleed, 0); /* the scissor kept the data inside     */
  /* Nothing but tick labels reaches those bands, so a non-zero count is the
   * whole text pipeline — atlas upload, glyph shader and all — proving itself. */
  CHECK(x_labels > 50);
  CHECK(y_labels > 50);

  /* ---- flip_y: the same frame, upside down ---- */

  /* A host with a top-left-origin target sets this. Faz 0 handled it by moving
   * the plot region and leaving the layers alone, which would have drawn
   * right-way-up axes over upside-down data; it is now one flipped blit, so the
   * only thing worth asserting is that the result is an exact mirror. */
  typedef void(PH_CALL * clear_color_fn)(float, float, float, float);
  typedef void(PH_CALL * clear_fn)(unsigned);
  clear_color_fn set_clear_color = (clear_color_fn)eglGetProcAddress("glClearColor");
  clear_fn clear = (clear_fn)eglGetProcAddress("glClear");
  if (!set_clear_color || !clear) return skip("glClear unavailable");

  unsigned char* flipped = (unsigned char*)malloc((size_t)WIDTH * HEIGHT * 4);
  unsigned char* upright = (unsigned char*)malloc((size_t)WIDTH * HEIGHT * 4);
  if (!flipped || !upright) return 1;

  set_clear_color(0.0f, 0.0f, 0.0f, 0.0f);
  clear(0x00004000u /* GL_COLOR_BUFFER_BIT */);
  CHECK_EQ(ph_plot_render(plot, &target), PH_OK);
  read_pixels(0, 0, WIDTH, HEIGHT, 0x1908, 0x1401, upright);

  target.flip_y = 1;
  clear(0x00004000u);
  CHECK_EQ(ph_plot_render(plot, &target), PH_OK);
  read_pixels(0, 0, WIDTH, HEIGHT, 0x1908, 0x1401, flipped);
  target.flip_y = 0;

  /* Compared with a tolerance of two levels rather than byte-for-byte. The two
   * frames are blended into different buffers — one the window's own, one our
   * RGBA8 texture — and drivers are entitled to round the last bit of an
   * anti-aliased edge differently between them. A broken flip would not miss by
   * one level on a few edge pixels; it would miss by everything, everywhere. */
  long off = 0;
  int worst = 0;
  for (int y = 0; y < HEIGHT; y++) {
    const unsigned char* a = upright + (size_t)y * WIDTH * 4;
    const unsigned char* b = flipped + (size_t)(HEIGHT - 1 - y) * WIDTH * 4;
    for (int i = 0; i < WIDTH * 4; i++) {
      const int delta = a[i] > b[i] ? a[i] - b[i] : b[i] - a[i];
      if (delta > worst) worst = delta;
      if (delta > 2) off++;
    }
  }
  free(flipped);
  free(upright);
  printf("  flip_y: %ld samples off by more than two, worst delta %d\n", off, worst);
  CHECK_EQ(off, 0);

  /* ---- the offscreen path, which is all JavaFX and WPF can use ---- */

  const int small_w = 320, small_h = 200;
  unsigned char* image = (unsigned char*)malloc((size_t)small_w * small_h * 4);
  if (!image) return 1;
  memset(image, 0xAB, (size_t)small_w * small_h * 4);
  const ph_result read_back =
      ph_plot_render_pixels(plot, small_w, small_h, 1.0f, image, small_w * 4);
  if (read_back != PH_OK) {
    printf("  FAIL render_pixels (%d): %s\n", read_back, ph_last_error());
    return 1;
  }
  long image_opaque = 0, image_top_rows = 0;
  for (int y = 0; y < small_h; y++) {
    for (int x = 0; x < small_w; x++) {
      const unsigned char* p = image + ((size_t)y * small_w + x) * 4;
      if (p[3] == 0) continue;
      image_opaque++;
      if (y < 20) image_top_rows++;
    }
  }
  free(image);
  printf("  offscreen opaque=%ld top-rows=%ld\n", image_opaque, image_top_rows);
  CHECK(image_opaque > 200);
  /* Rows come back top-first. The top 20 rows are inside the 16px top margin
   * plus the first pixels of the plot, so they must be nearly empty — if the
   * flip were missing they would hold the x axis and its labels instead. */
  CHECK(image_top_rows < image_opaque / 8);

  CHECK_EQ(ph_plot_destroy(plot), PH_OK);

  /* ---- patches: does the triangulation reach the framebuffer? ---- */

  /* Its own plot with fixed domains, so the filled fraction of the region is
   * arithmetic rather than a guess. A 6x6 square with a 2x2 hole over a 10x10
   * view covers (36 - 4) / 100 of the plot region. Counting those pixels checks
   * the ear clipping, the hole bridging and the fill shader at once — none of
   * which any other test reaches. */
  ph_plot_desc patch_plot_desc;
  ph_plot_desc_init(&patch_plot_desc);
  patch_plot_desc.width = 200;
  patch_plot_desc.height = 200;
  patch_plot_desc.x.domain.lo = 0.0;
  patch_plot_desc.x.domain.hi = 10.0;
  patch_plot_desc.y.domain.lo = 0.0;
  patch_plot_desc.y.domain.hi = 10.0;
  ph_plot patch_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &patch_plot), PH_OK);

  /* Outer ring counter-clockwise, hole clockwise — earcut enforces winding
   * anyway, but writing it correctly is what a caller would do. */
  const double patch_x[8] = {2, 8, 8, 2,  4, 4, 6, 6};
  const double patch_y[8] = {2, 2, 8, 8,  4, 6, 6, 4};
  const int32_t patch_holes[1] = {4};
  ph_patch patch;
  memset(&patch, 0, sizeof(patch));
  patch.x = patch_x;
  patch.y = patch_y;
  patch.count = 8;
  patch.holes = patch_holes;
  patch.hole_count = 1;
  CHECK_EQ(ph_color_parse("#00ffff", &patch.color), PH_OK);

  ph_patches_desc patches_desc;
  ph_patches_desc_init(&patches_desc);
  patches_desc.patches = &patch;
  patches_desc.patch_count = 1;
  ph_layer patches_layer = PH_NULL_HANDLE;
  if (ph_plot_add_patches(patch_plot, &patches_desc, &patches_layer) != PH_OK) {
    printf("  FAIL add_patches: %s\n", ph_last_error());
    return 1;
  }

  const int patch_w = 200, patch_h = 200;
  unsigned char* patch_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!patch_pixels) return 1;
  const ph_result patch_result =
      ph_plot_render_pixels(patch_plot, patch_w, patch_h, 1.0f, patch_pixels, patch_w * 4);
  if (patch_result != PH_OK) {
    printf("  FAIL patches render (%d): %s\n", patch_result, ph_last_error());
    return 1;
  }
  long cyan = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = patch_pixels + (size_t)i * 4;
    if (p[3] > 200 && p[0] < 40 && p[1] > 200 && p[2] > 200) cyan++;
  }
  free(patch_pixels);

  /* Region is (200 - 56 - 16) x (200 - 16 - 40) = 128 x 144 = 18432 px, and the
   * fill covers 32% of it. */
  const double expected = 18432.0 * 0.32;
  printf("  patch fill=%ld px, expected about %.0f\n", cyan, expected);
  CHECK(cyan > expected * 0.95);
  CHECK(cyan < expected * 1.05);

  CHECK_EQ(ph_plot_destroy(patch_plot), PH_OK);

  /* ---- area and bars: fixed domains, so the coverage is arithmetic ---- */

  ph_plot fill_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &fill_plot), PH_OK);

  /* A band from y=0 to y=3 across the whole width: 30% of the region. */
  const double area_x[2] = {0.0, 10.0};
  const double area_y[2] = {3.0, 3.0};
  ph_area_desc area_desc;
  ph_area_desc_init(&area_desc);
  area_desc.x = area_x;
  area_desc.y = area_y;
  area_desc.count = 2;
  area_desc.base_value = 0.0;
  CHECK_EQ(ph_color_parse("#ffff00", &area_desc.color), PH_OK);
  ph_layer area_layer = PH_NULL_HANDLE;
  if (ph_plot_add_area(fill_plot, &area_desc, &area_layer) != PH_OK) {
    printf("  FAIL add_area: %s\n", ph_last_error());
    return 1;
  }

  /* Four bars a tenth of the width each, from y=5 to y=9: 16% of the region. */
  const double bar_x[4] = {2.0, 4.0, 6.0, 8.0};
  const double bar_y[4] = {9.0, 9.0, 9.0, 9.0};
  ph_bar_desc bar_desc;
  ph_bar_desc_init(&bar_desc);
  bar_desc.x = bar_x;
  bar_desc.y = bar_y;
  bar_desc.count = 4;
  bar_desc.base_value = 5.0;
  bar_desc.width = 1.0;
  CHECK_EQ(ph_color_parse("#ff00ff", &bar_desc.color), PH_OK);
  ph_layer bar_layer = PH_NULL_HANDLE;
  if (ph_plot_add_bar(fill_plot, &bar_desc, &bar_layer) != PH_OK) {
    printf("  FAIL add_bar: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* fill_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!fill_pixels) return 1;
  const ph_result fill_result =
      ph_plot_render_pixels(fill_plot, patch_w, patch_h, 1.0f, fill_pixels, patch_w * 4);
  if (fill_result != PH_OK) {
    printf("  FAIL area/bar render (%d): %s\n", fill_result, ph_last_error());
    return 1;
  }
  long yellow = 0, magenta = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = fill_pixels + (size_t)i * 4;
    if (p[3] < 200) continue;
    if (p[0] > 200 && p[1] > 200 && p[2] < 40) yellow++;
    if (p[0] > 200 && p[1] < 40 && p[2] > 200) magenta++;
  }
  free(fill_pixels);

  printf("  area=%ld px (expect ~%.0f), bars=%ld px (expect ~%.0f)\n",
         yellow, 18432.0 * 0.30, magenta, 18432.0 * 0.16);
  CHECK(yellow > 18432.0 * 0.30 * 0.95);
  CHECK(yellow < 18432.0 * 0.30 * 1.05);
  CHECK(magenta > 18432.0 * 0.16 * 0.95);
  CHECK(magenta < 18432.0 * 0.16 * 1.05);

  CHECK_EQ(ph_plot_destroy(fill_plot), PH_OK);
  ph_shutdown();

  eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroySurface(display, surface);
  eglDestroyContext(display, context);
  eglTerminate(display);

  return TEST_MAIN_RESULT();
}
