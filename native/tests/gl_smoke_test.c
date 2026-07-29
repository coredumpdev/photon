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

  /* ---- error bars: the band is a strip whose area is arithmetic ---- */

  ph_plot band_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &band_plot), PH_OK);

  /* Two points spanning the width at y=5 with a symmetric error of 2, drawn as
   * an opaque band: y runs 3 to 7, so 40% of the region. The whiskers are off
   * so nothing else contributes to the count. */
  const double err_x[2] = {0.0, 10.0};
  const double err_y[2] = {5.0, 5.0};
  ph_errorbar_desc err_desc;
  ph_errorbar_desc_init(&err_desc);
  err_desc.x = err_x;
  err_desc.y = err_y;
  err_desc.count = 2;
  err_desc.y_err = 2.0;
  err_desc.band = 1;
  err_desc.band_opacity = 1.0f;
  err_desc.no_whiskers = 1;
  CHECK_EQ(ph_color_parse("#00ffff", &err_desc.color), PH_OK);
  ph_layer err_layer = PH_NULL_HANDLE;
  if (ph_plot_add_errorbar(band_plot, &err_desc, &err_layer) != PH_OK) {
    printf("  FAIL add_errorbar: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* band_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!band_pixels) return 1;
  const ph_result band_result =
      ph_plot_render_pixels(band_plot, patch_w, patch_h, 1.0f, band_pixels, patch_w * 4);
  if (band_result != PH_OK) {
    printf("  FAIL errorbar render (%d): %s\n", band_result, ph_last_error());
    return 1;
  }
  long band_px = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = band_pixels + (size_t)i * 4;
    if (p[3] > 200 && p[0] < 40 && p[1] > 200 && p[2] > 200) band_px++;
  }
  free(band_pixels);
  printf("  errorbar band=%ld px (expect ~%.0f)\n", band_px, 18432.0 * 0.40);
  CHECK(band_px > 18432.0 * 0.40 * 0.95);
  CHECK(band_px < 18432.0 * 0.40 * 1.05);
  CHECK_EQ(ph_plot_destroy(band_plot), PH_OK);

  /* ---- box: the body area, and that an outlier is a disc and not a pixel ---- */

  ph_plot box_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &box_plot), PH_OK);

  /* Five values chosen so the quartiles are exact: q1 = 2.5, q3 = 7.5. With a
   * width of 4 the body is 40% of the region across and 50% down. */
  const double box_values[5] = {0.0, 2.5, 5.0, 7.5, 10.0};
  ph_box_group box_group;
  memset(&box_group, 0, sizeof(box_group));
  box_group.position = 5.0;
  box_group.values = box_values;
  box_group.count = 5;
  CHECK_EQ(ph_color_parse("#ff0000", &box_group.color), PH_OK);

  ph_box_desc box_desc;
  ph_box_desc_init(&box_desc);
  box_desc.groups = &box_group;
  box_desc.group_count = 1;
  box_desc.width = 4.0;
  ph_layer box_layer = PH_NULL_HANDLE;
  if (ph_plot_add_box(box_plot, &box_desc, &box_layer) != PH_OK) {
    printf("  FAIL add_box: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* box_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!box_pixels) return 1;
  const ph_result box_result =
      ph_plot_render_pixels(box_plot, patch_w, patch_h, 1.0f, box_pixels, patch_w * 4);
  if (box_result != PH_OK) {
    printf("  FAIL box render (%d): %s\n", box_result, ph_last_error());
    return 1;
  }
  /* The body is 35% red on a transparent background, so both the colour and
   * the alpha come back at about a third — premultiplied, hence red > 60 with
   * nothing in the other channels rather than a solid 255. */
  long reddish = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = box_pixels + (size_t)i * 4;
    if (p[3] > 60 && p[0] > 60 && p[0] > p[1] + 20 && p[2] + 20 < p[0]) reddish++;
  }
  free(box_pixels);
  /* 20% of the region for the body, plus the whiskers reaching the extremes. */
  printf("  box body=%ld px (expect ~%.0f)\n", reddish, 18432.0 * 0.20);
  CHECK(reddish > 18432.0 * 0.20 * 0.95);
  CHECK(reddish < 18432.0 * 0.20 * 1.15);
  CHECK_EQ(ph_layer_destroy(box_layer), PH_OK);

  /* Now a group with one outlier well above the fence. It is drawn with
   * gl_PointSize, which a desktop core profile ignores unless
   * GL_PROGRAM_POINT_SIZE is enabled — and an ignored point size is one pixel,
   * not an error. So this counts the disc. */
  const double outlier_values[6] = {4.0, 4.5, 5.0, 5.5, 6.0, 9.5};
  box_group.values = outlier_values;
  box_group.count = 6;
  if (ph_plot_add_box(box_plot, &box_desc, &box_layer) != PH_OK) {
    printf("  FAIL add_box (outlier): %s\n", ph_last_error());
    return 1;
  }
  unsigned char* outlier_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!outlier_pixels) return 1;
  if (ph_plot_render_pixels(box_plot, patch_w, patch_h, 1.0f, outlier_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL box outlier render: %s\n", ph_last_error());
    return 1;
  }
  /* Rows 16..50 are the top of the region. The whisker cap reaches y=6, which
   * is row 74 — so nothing but the outlier at y=9.5 is up there. */
  long disc = 0;
  for (int row = 16; row < 50; row++) {
    for (int col = 56; col < 184; col++) {
      const unsigned char* p = outlier_pixels + ((size_t)row * patch_w + col) * 4;
      if (p[3] > 60 && p[0] > 60 && p[0] > p[1] + 20 && p[2] + 20 < p[0]) disc++;
    }
  }
  free(outlier_pixels);
  printf("  box outlier disc=%ld px\n", disc);
  CHECK(disc >= 8);

  CHECK_EQ(ph_plot_destroy(box_plot), PH_OK);

  /* ---- heatmap and image: four quadrants, so the orientation is checkable ---- */

  ph_plot grid_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &grid_plot), PH_OK);
  /* A heatmap reports a colour scale, and a colour scale widens the right
   * margin — which would move every pixel this section names. The colorbar has
   * its own check below; here it is in the way. */
  CHECK_EQ(ph_plot_set_colorbar(grid_plot, 0), PH_OK);

  /* A 2x2 grid over the left half of a 10x10 view, coloured through a
   * two-stop black-to-white ramp. Row 0 is the bottom, so the bright cell is
   * bottom-right — which is what distinguishes a correct upload from one that
   * is upside down or mirrored, and neither of those is an error. */
  const double grid[4] = {0.0, 1.0, 0.0, 0.0};
  const ph_color ramp[2] = {0x000000ffu, 0xffffffffu};
  ph_colormap_spec cmap;
  ph_colormap_spec_init(&cmap);
  cmap.stops = ramp;
  cmap.stop_count = 2;

  ph_heatmap_desc heat;
  ph_heatmap_desc_init(&heat);
  heat.values = grid;
  heat.cols = 2;
  heat.rows = 2;
  heat.x.lo = 0.0;
  heat.x.hi = 5.0;
  heat.y.lo = 0.0;
  heat.y.hi = 10.0;
  heat.colormap = &cmap;
  heat.no_smooth = 1;
  ph_layer heat_layer = PH_NULL_HANDLE;
  if (ph_plot_add_heatmap(grid_plot, &heat, &heat_layer) != PH_OK) {
    printf("  FAIL add_heatmap: %s\n", ph_last_error());
    return 1;
  }

  /* An opaque red 1x1 image over the top-right quadrant. */
  const unsigned char red[4] = {255, 0, 0, 255};
  ph_image_desc bitmap;
  ph_image_desc_init(&bitmap);
  bitmap.pixels = red;
  bitmap.width = 1;
  bitmap.height = 1;
  bitmap.x.lo = 5.0;
  bitmap.x.hi = 10.0;
  bitmap.y.lo = 5.0;
  bitmap.y.hi = 10.0;
  bitmap.opacity = 0.5f;
  ph_layer image_layer = PH_NULL_HANDLE;
  if (ph_plot_add_image(grid_plot, &bitmap, &image_layer) != PH_OK) {
    printf("  FAIL add_image: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* grid_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!grid_pixels) return 1;
  if (ph_plot_render_pixels(grid_plot, patch_w, patch_h, 1.0f, grid_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL grid render: %s\n", ph_last_error());
    return 1;
  }

  /* The region is x 56..184, y 16..160. The heatmap's bright cell is the
   * bottom-right of its half: x 88..120, y 88..160. Sample the middle of each
   * of the four heatmap cells and check only one of them is white. */
  long bright = 0;
  int bright_row = -1, bright_col = -1;
  for (int cell_row = 0; cell_row < 2; cell_row++) {
    for (int cell_col = 0; cell_col < 2; cell_col++) {
      const int col = 56 + 16 + cell_col * 32;
      const int row = 16 + 36 + cell_row * 72;
      const unsigned char* p = grid_pixels + ((size_t)row * patch_w + col) * 4;
      if (p[0] > 200 && p[1] > 200 && p[2] > 200) {
        bright++;
        bright_row = cell_row;
        bright_col = cell_col;
      }
    }
  }
  printf("  heatmap bright cell at row %d col %d (of %ld)\n", bright_row, bright_col, bright);
  CHECK(bright == 1);
  /* Rows come back top-first, so the bottom row of the grid is the bottom row
   * of the bitmap: cell_row 1. */
  CHECK(bright_row == 1);
  CHECK(bright_col == 1);

  /* The image is red at half opacity over a transparent background, so it
   * arrives premultiplied at about 128. */
  const unsigned char* mid = grid_pixels + ((size_t)50 * patch_w + 150) * 4;
  printf("  image pixel %d %d %d %d\n", mid[0], mid[1], mid[2], mid[3]);
  CHECK(mid[3] > 120 && mid[3] < 136);
  CHECK(mid[0] > 120 && mid[0] < 136);
  CHECK(mid[1] < 10 && mid[2] < 10);
  free(grid_pixels);

  CHECK_EQ(ph_plot_destroy(grid_plot), PH_OK);

  /* ---- candlesticks: the up/down colours, and that a body is a rectangle ---- */

  ph_plot ohlc_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &ohlc_plot), PH_OK);

  /* Two candles in a 10x10 view: the first rises 2..8 at x=2.5, the second
   * falls 8..2 at x=7.5. With an explicit width of 5 each body is a quarter of
   * the region — so counting them checks the direction colouring, the body
   * geometry and the instancing in one pass. */
  const double candle_x[2] = {2.5, 7.5};
  const double candle_open[2] = {2.0, 8.0};
  const double candle_high[2] = {9.0, 9.0};
  const double candle_low[2] = {1.0, 1.0};
  const double candle_close[2] = {8.0, 2.0};
  ph_candlestick_desc candles;
  ph_candlestick_desc_init(&candles);
  candles.x = candle_x;
  candles.open = candle_open;
  candles.high = candle_high;
  candles.low = candle_low;
  candles.close = candle_close;
  candles.count = 2;
  candles.width = 5.0;
  CHECK_EQ(ph_color_parse("#00ff00", &candles.up_color), PH_OK);
  CHECK_EQ(ph_color_parse("#ff0000", &candles.down_color), PH_OK);
  ph_layer candle_layer = PH_NULL_HANDLE;
  if (ph_plot_add_candlestick(ohlc_plot, &candles, &candle_layer) != PH_OK) {
    printf("  FAIL add_candlestick: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* candle_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!candle_pixels) return 1;
  if (ph_plot_render_pixels(ohlc_plot, patch_w, patch_h, 1.0f, candle_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL candlestick render: %s\n", ph_last_error());
    return 1;
  }
  long up_px = 0, down_px = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = candle_pixels + (size_t)i * 4;
    if (p[3] < 200) continue;
    if (p[1] > 200 && p[0] < 40 && p[2] < 40) up_px++;
    if (p[0] > 200 && p[1] < 40 && p[2] < 40) down_px++;
  }
  /* Each body is 5/10 of the width by 6/10 of the height: 30% of the region,
   * plus a wick 1px wide over the rest of its 1..9 range. */
  const double body = 18432.0 * 0.30;
  printf("  candles up=%ld down=%ld (expect ~%.0f each)\n", up_px, down_px, body);
  CHECK(up_px > body * 0.95 && up_px < body * 1.10);
  CHECK(down_px > body * 0.95 && down_px < body * 1.10);
  free(candle_pixels);
  CHECK_EQ(ph_layer_destroy(candle_layer), PH_OK);

  /* The same two periods as OHLC bars. Three thin segments each, so the ink is
   * a small fraction of what the bodies cover — which is the difference between
   * the two chart types, and worth asserting rather than assuming. */
  ph_ohlc_desc bars;
  ph_ohlc_desc_init(&bars);
  bars.x = candle_x;
  bars.open = candle_open;
  bars.high = candle_high;
  bars.low = candle_low;
  bars.close = candle_close;
  bars.count = 2;
  bars.width = 5.0;
  bars.line_width = 3.0f;
  CHECK_EQ(ph_color_parse("#00ff00", &bars.up_color), PH_OK);
  CHECK_EQ(ph_color_parse("#ff0000", &bars.down_color), PH_OK);
  ph_layer ohlc_layer = PH_NULL_HANDLE;
  if (ph_plot_add_ohlc(ohlc_plot, &bars, &ohlc_layer) != PH_OK) {
    printf("  FAIL add_ohlc: %s\n", ph_last_error());
    return 1;
  }
  unsigned char* bar_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!bar_pixels) return 1;
  if (ph_plot_render_pixels(ohlc_plot, patch_w, patch_h, 1.0f, bar_pixels, patch_w * 4) != PH_OK) {
    printf("  FAIL ohlc render: %s\n", ph_last_error());
    return 1;
  }
  long bar_green = 0, bar_red = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = bar_pixels + (size_t)i * 4;
    if (p[3] < 200) continue;
    if (p[1] > 200 && p[0] < 40 && p[2] < 40) bar_green++;
    if (p[0] > 200 && p[1] < 40 && p[2] < 40) bar_red++;
  }
  free(bar_pixels);
  /* One 3px vertical over 8/10 of the height plus two 3px ticks each half the
   * 5-unit span: about 3*115 + 2*3*32 = 537 px per bar. */
  printf("  ohlc green=%ld red=%ld\n", bar_green, bar_red);
  CHECK(bar_green > 300 && bar_green < 900);
  CHECK(bar_red > 300 && bar_red < 900);

  CHECK_EQ(ph_plot_destroy(ohlc_plot), PH_OK);

  /* ---- hexbin and quiver: the two layers that colour themselves ---- */

  ph_plot field_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &field_plot), PH_OK);
  /* Same reason as the heatmap: the hexbin's colour scale would move the region
   * out from under the arithmetic below. */
  CHECK_EQ(ph_plot_set_colorbar(field_plot, 0), PH_OK);

  /* Three points at the same place and one far away: two cells, and with a
   * black-to-white ramp over a [1,3] count domain the busy one comes out white
   * and the lonely one nearly black. That checks the binning and the colouring
   * together — a wrong bin would give two grey cells or one. */
  const double hex_x[4] = {3.0, 3.0, 3.0, 7.0};
  const double hex_y[4] = {5.0, 5.0, 5.0, 5.0};
  ph_colormap_spec hex_map;
  ph_colormap_spec_init(&hex_map);
  hex_map.stops = ramp;
  hex_map.stop_count = 2;

  ph_hexbin_desc hexes;
  ph_hexbin_desc_init(&hexes);
  hexes.x = hex_x;
  hexes.y = hex_y;
  hexes.count = 4;
  hexes.radius = 1.0;
  hexes.colormap = &hex_map;
  hexes.domain.lo = 1.0;
  hexes.domain.hi = 3.0;
  ph_layer hex_layer = PH_NULL_HANDLE;
  if (ph_plot_add_hexbin(field_plot, &hexes, &hex_layer) != PH_OK) {
    printf("  FAIL add_hexbin: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* hex_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!hex_pixels) return 1;
  if (ph_plot_render_pixels(field_plot, patch_w, patch_h, 1.0f, hex_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL hexbin render: %s\n", ph_last_error());
    return 1;
  }
  long white = 0, dark_cell = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = hex_pixels + (size_t)i * 4;
    if (p[3] < 200) continue;
    if (p[0] > 240 && p[1] > 240 && p[2] > 240) white++;
    /* Opaque but nearly black is the one-point cell, not the background —
     * the background is transparent here. */
    if (p[0] < 20 && p[1] < 20 && p[2] < 20) dark_cell++;
  }
  free(hex_pixels);
  /* A radius-1 hexagon is 2.598 square data units; the region is 128x144 px
   * over a 10x10 view, so each cell is about 479 px. */
  printf("  hexbin busy=%ld lonely=%ld (expect ~479 each)\n", white, dark_cell);
  CHECK(white > 380 && white < 580);
  CHECK(dark_cell > 380 && dark_cell < 580);
  CHECK_EQ(ph_layer_destroy(hex_layer), PH_OK);

  /* Two arrows from the same base, one twice as long. Flat colour, so the ink
   * is countable: shafts of 4 and 8 data units at 4px wide, plus two heads. */
  const double arrow_x[2] = {1.0, 1.0};
  const double arrow_y[2] = {2.0, 7.0};
  const double arrow_u[2] = {4.0, 8.0};
  const double arrow_v[2] = {0.0, 0.0};
  ph_quiver_desc arrows;
  ph_quiver_desc_init(&arrows);
  arrows.x = arrow_x;
  arrows.y = arrow_y;
  arrows.u = arrow_u;
  arrows.v = arrow_v;
  arrows.count = 2;
  arrows.scale = 1.0;
  arrows.width = 4.0f;
  arrows.head_size = 12.0f;
  CHECK_EQ(ph_color_parse("#ffff00", &arrows.color), PH_OK);
  ph_layer quiver_layer = PH_NULL_HANDLE;
  if (ph_plot_add_quiver(field_plot, &arrows, &quiver_layer) != PH_OK) {
    printf("  FAIL add_quiver: %s\n", ph_last_error());
    return 1;
  }
  unsigned char* quiver_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!quiver_pixels) return 1;
  if (ph_plot_render_pixels(field_plot, patch_w, patch_h, 1.0f, quiver_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL quiver render: %s\n", ph_last_error());
    return 1;
  }
  long yellow_px = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = quiver_pixels + (size_t)i * 4;
    if (p[3] > 200 && p[0] > 200 && p[1] > 200 && p[2] < 40) yellow_px++;
  }
  free(quiver_pixels);
  /* Shafts: (4 + 8) data units is 12/10 of 128 px = 154 px of length at 4 px
   * wide, so about 614; two heads of 12x14 px add roughly 170. */
  printf("  quiver ink=%ld px\n", yellow_px);
  CHECK(yellow_px > 600 && yellow_px < 950);

  CHECK_EQ(ph_plot_destroy(field_plot), PH_OK);

  /* ---- contour and graph: the last two, and the two that derive geometry ---- */

  ph_plot iso_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &iso_plot), PH_OK);

  /* A 2x2 grid rising left to right over the whole 10x10 view. One explicit
   * level at 0.5 crosses exactly halfway, so the iso-line is a single vertical
   * at x = 5 — a contour whose position is arithmetic rather than a guess. */
  const double iso_values[4] = {0.0, 1.0, 0.0, 1.0};
  const double iso_levels[1] = {0.5};
  ph_contour_desc iso;
  ph_contour_desc_init(&iso);
  iso.values = iso_values;
  iso.cols = 2;
  iso.rows = 2;
  iso.x.lo = 0.0;
  iso.x.hi = 10.0;
  iso.y.lo = 0.0;
  iso.y.hi = 10.0;
  iso.levels = iso_levels;
  iso.level_count = 1;
  CHECK_EQ(ph_color_parse("#00ff00", &iso.color), PH_OK);
  ph_layer iso_layer = PH_NULL_HANDLE;
  if (ph_plot_add_contour(iso_plot, &iso, &iso_layer) != PH_OK) {
    printf("  FAIL add_contour: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* iso_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!iso_pixels) return 1;
  if (ph_plot_render_pixels(iso_plot, patch_w, patch_h, 1.0f, iso_pixels, patch_w * 4) != PH_OK) {
    printf("  FAIL contour render: %s\n", ph_last_error());
    return 1;
  }
  long iso_px = 0;
  int iso_min_col = patch_w, iso_max_col = -1;
  for (int row = 0; row < patch_h; row++) {
    for (int col = 0; col < patch_w; col++) {
      const unsigned char* p = iso_pixels + ((size_t)row * patch_w + col) * 4;
      if (p[3] < 200 || p[1] < 200 || p[0] > 40 || p[2] > 40) continue;
      iso_px++;
      if (col < iso_min_col) iso_min_col = col;
      if (col > iso_max_col) iso_max_col = col;
    }
  }
  free(iso_pixels);
  /* The region is x 56..184, so the halfway point is column 120. */
  printf("  contour ink=%ld px, columns %d..%d\n", iso_px, iso_min_col, iso_max_col);
  CHECK(iso_px > 100);
  CHECK(iso_min_col >= 118 && iso_max_col <= 122);
  CHECK_EQ(ph_layer_destroy(iso_layer), PH_OK);

  /* A triangle of three nodes. The node discs are drawn with gl_PointSize, the
   * same desktop-versus-WebGL2 gate the box outliers need — so counting them
   * is what proves the enable is there. */
  const double node_x[3] = {2.0, 8.0, 5.0};
  const double node_y[3] = {2.0, 2.0, 8.0};
  const ph_edge triangle[3] = {{0, 1}, {1, 2}, {2, 0}};
  ph_graph_desc graph;
  ph_graph_desc_init(&graph);
  graph.x = node_x;
  graph.y = node_y;
  graph.node_count = 3;
  graph.edges = triangle;
  graph.edge_count = 3;
  graph.node_size = 20.0f;
  CHECK_EQ(ph_color_parse("#ff00ff", &graph.node_color), PH_OK);
  CHECK_EQ(ph_color_parse("#00ffff", &graph.edge_color), PH_OK);
  ph_layer graph_layer = PH_NULL_HANDLE;
  if (ph_plot_add_graph(iso_plot, &graph, &graph_layer) != PH_OK) {
    printf("  FAIL add_graph: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* graph_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!graph_pixels) return 1;
  if (ph_plot_render_pixels(iso_plot, patch_w, patch_h, 1.0f, graph_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL graph render: %s\n", ph_last_error());
    return 1;
  }
  long node_px = 0, edge_px = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = graph_pixels + (size_t)i * 4;
    if (p[3] < 200) continue;
    if (p[0] > 200 && p[1] < 40 && p[2] > 200) node_px++;
    if (p[0] < 40 && p[1] > 200 && p[2] > 200) edge_px++;
  }
  free(graph_pixels);
  /* Three discs 20 px across is about 3 * pi * 100 = 942 px, less the
   * antialiased rim the smoothstep fades out. A missing GL_PROGRAM_POINT_SIZE
   * would give 3 pixels, which is the point of counting. The edges are
   * one-pixel lines with their ends under those discs, so a triangle of about
   * 460 px of perimeter shows rather less than that. */
  printf("  graph nodes=%ld px edges=%ld px\n", node_px, edge_px);
  CHECK(node_px > 700 && node_px < 1100);
  CHECK(edge_px > 150 && edge_px < 460);

  CHECK_EQ(ph_plot_destroy(iso_plot), PH_OK);

  /* ---- the colorbar: a reserved margin, and a gradient that runs the right way ---- */

  ph_plot legend_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &legend_plot), PH_OK);

  /* A 1x2 grid of 0 and 1 through a black-to-white ramp. The bar is the legend
   * for it: black at the bottom, white at the top, in a margin the plot has to
   * have widened by itself. */
  const double legend_values[2] = {0.0, 1.0};
  ph_colormap_spec legend_map;
  ph_colormap_spec_init(&legend_map);
  legend_map.stops = ramp;
  legend_map.stop_count = 2;

  ph_heatmap_desc legend_heat;
  ph_heatmap_desc_init(&legend_heat);
  legend_heat.values = legend_values;
  legend_heat.cols = 1;
  legend_heat.rows = 2;
  legend_heat.x.lo = 0.0;
  legend_heat.x.hi = 10.0;
  legend_heat.y.lo = 0.0;
  legend_heat.y.hi = 10.0;
  legend_heat.colormap = &legend_map;
  ph_layer legend_heat_layer = PH_NULL_HANDLE;
  if (ph_plot_add_heatmap(legend_plot, &legend_heat, &legend_heat_layer) != PH_OK) {
    printf("  FAIL colorbar heatmap: %s\n", ph_last_error());
    return 1;
  }

  unsigned char* legend_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!legend_pixels) return 1;
  if (ph_plot_render_pixels(legend_plot, patch_w, patch_h, 1.0f, legend_pixels, patch_w * 4) != PH_OK) {
    printf("  FAIL colorbar render: %s\n", ph_last_error());
    return 1;
  }

  /* The reserved margin is 62 px on top of the usual 16, so the bar sits past
   * column 200 - 16 - 62 = 122. Look for a column out there that is a gradient:
   * bright near the top of its run and dark near the bottom. */
  int legend_col = -1;
  for (int col = 130; col < patch_w && legend_col < 0; col++) {
    long light = 0, dark = 0;
    for (int row = 16; row < 160; row++) {
      const unsigned char* p = legend_pixels + ((size_t)row * patch_w + col) * 4;
      if (p[3] < 200) continue;
      if (p[0] > 200 && p[1] > 200 && p[2] > 200) light++;
      if (p[0] < 60 && p[1] < 60 && p[2] < 60) dark++;
    }
    if (light > 8 && dark > 8) legend_col = col;
  }
  printf("  colorbar gradient column %d\n", legend_col);
  CHECK(legend_col >= 130);

  /* And it runs the right way up: the top of the bar is the domain maximum. */
  long top_light = 0, bottom_light = 0;
  for (int row = 16; row < 160; row++) {
    const unsigned char* p = legend_pixels + ((size_t)row * patch_w + legend_col) * 4;
    if (p[3] < 200 || p[0] < 180) continue;
    if (row < 88) top_light++;
    else bottom_light++;
  }
  printf("  colorbar light rows: top %ld, bottom %ld\n", top_light, bottom_light);
  CHECK(top_light > bottom_light);

  long narrow_opaque = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    if (legend_pixels[(size_t)i * 4 + 3] > 200) narrow_opaque++;
  }
  free(legend_pixels);

  /* Turning it off gives the margin back, so the plot region grows again. */
  CHECK_EQ(ph_plot_set_colorbar(legend_plot, 0), PH_OK);
  unsigned char* wide_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!wide_pixels) return 1;
  if (ph_plot_render_pixels(legend_plot, patch_w, patch_h, 1.0f, wide_pixels, patch_w * 4) != PH_OK) {
    printf("  FAIL colorbar-off render: %s\n", ph_last_error());
    return 1;
  }
  long wide_opaque = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    if (wide_pixels[(size_t)i * 4 + 3] > 200) wide_opaque++;
  }
  free(wide_pixels);
  /* The heatmap covers the whole region, so its pixel count *is* the region:
   * 128 x 144 = 18432 without the bar, 66 x 144 = 9504 with it (plus the bar's
   * own ink, which is why the narrow figure is not simply half). That the wide
   * one reaches the full region is what says the reservation was real and was
   * given back. */
  printf("  colorbar off: %ld opaque px, on: %ld\n", wide_opaque, narrow_opaque);
  CHECK(wide_opaque > 18432 * 0.95 && wide_opaque < 18432 * 1.05);
  CHECK(narrow_opaque < 18432 * 0.8);

  CHECK_EQ(ph_plot_destroy(legend_plot), PH_OK);

  /* ---- hover: a guide line and a marker on the point under the cursor ---- */

  ph_plot hover_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &hover_plot), PH_OK);

  /* Three points at y = 5 across a 10x10 view. The cursor goes on the middle
   * one, so the marker has to land at the region's centre. */
  const double hover_x[3] = {2.0, 5.0, 8.0};
  const double hover_y[3] = {5.0, 5.0, 5.0};
  ph_line_desc hover_line;
  ph_line_desc_init(&hover_line);
  hover_line.x = hover_x;
  hover_line.y = hover_y;
  hover_line.count = 3;
  hover_line.width = 1.0f;
  CHECK_EQ(ph_color_parse("#00ff00", &hover_line.color), PH_OK);
  ph_layer hover_layer = PH_NULL_HANDLE;
  if (ph_plot_add_line(hover_plot, &hover_line, &hover_layer) != PH_OK) {
    printf("  FAIL hover line: %s\n", ph_last_error());
    return 1;
  }

  /* The region is x 56..184, y 16..160, so its centre is (120, 88). */
  ph_plot_pointer_move(hover_plot, 120.0, 88.0, PH_MOD_NONE);

  /* The move should have reported the point, once. */
  ph_event ev;
  int picked = 0;
  memset(&ev, 0, sizeof(ev));
  ev.struct_size = (uint32_t)sizeof(ev);
  while (ph_plot_poll_event(hover_plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type != PH_EVENT_POINT_PICKED) continue;
    picked++;
    CHECK(ev.point_valid == 1);
    CHECK(ev.point_index == 1);
    CHECK(ev.point_x == 5.0 && ev.point_y == 5.0);
    CHECK(ev.layer == hover_layer);
  }
  printf("  hover picked %d point(s)\n", picked);
  CHECK(picked == 1);

  unsigned char* hover_pixels = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!hover_pixels) return 1;
  if (ph_plot_render_pixels(hover_plot, patch_w, patch_h, 1.0f, hover_pixels, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL hover render: %s\n", ph_last_error());
    return 1;
  }
  /* The marker is a white-rimmed disc about 11 px across, centred on the point.
   * Count its white rim; the series line is green and one pixel tall, so it
   * cannot be mistaken for it. */
  long rim = 0;
  for (int row = 78; row < 99; row++) {
    for (int col = 110; col < 131; col++) {
      const unsigned char* p = hover_pixels + ((size_t)row * patch_w + col) * 4;
      if (p[3] > 200 && p[0] > 230 && p[1] > 230 && p[2] > 230) rim++;
    }
  }
  printf("  hover marker rim=%ld px\n", rim);
  CHECK(rim > 20);

  /* The tooltip is a panel near the cursor. It reads "x = 5" and one row per
   * named series; this line has no name, so the panel is the header alone.
   * Count its fill: at 14 px right and down from (120, 88), on a transparent
   * background, it is the only opaque thing over there. */
  long tip = 0;
  for (int row = 100; row < 140; row++) {
    for (int col = 132; col < 200; col++) {
      const unsigned char* p = hover_pixels + ((size_t)row * patch_w + col) * 4;
      if (p[3] > 180) tip++;
    }
  }
  printf("  tooltip ink=%ld px\n", tip);
  CHECK(tip > 200);
  free(hover_pixels);

  /* Moving to the same point again must not repeat the event — a host drawing
   * a tooltip should not have to filter a stream of identical ones. */
  ph_plot_pointer_move(hover_plot, 121.0, 89.0, PH_MOD_NONE);
  int repeats = 0;
  while (ph_plot_poll_event(hover_plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type == PH_EVENT_POINT_PICKED) repeats++;
  }
  printf("  hover repeats=%d\n", repeats);
  CHECK(repeats == 0);

  /* Leaving reports the loss of the pick. */
  ph_plot_pointer_leave(hover_plot);
  int cleared = 0;
  while (ph_plot_poll_event(hover_plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type != PH_EVENT_POINT_PICKED) continue;
    cleared++;
    CHECK(ev.point_valid == 0);
    CHECK(ev.point_index == -1);
  }
  CHECK(cleared == 1);

  CHECK_EQ(ph_plot_destroy(hover_plot), PH_OK);

  /* ---- the legend: named series only, and a click that hides one ---- */

  ph_plot legend_plot2 = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &legend_plot2), PH_OK);

  const double flat_x[2] = {0.0, 10.0};
  const double low_y[2] = {2.0, 2.0};
  const double high_y[2] = {8.0, 8.0};
  ph_line_desc named;
  ph_line_desc_init(&named);
  named.x = flat_x;
  named.y = low_y;
  named.count = 2;
  named.width = 3.0f;
  named.name = "low";
  CHECK_EQ(ph_color_parse("#00ff00", &named.color), PH_OK);
  ph_layer low_layer = PH_NULL_HANDLE;
  if (ph_plot_add_line(legend_plot2, &named, &low_layer) != PH_OK) {
    printf("  FAIL legend line: %s\n", ph_last_error());
    return 1;
  }
  named.y = high_y;
  named.name = "high";
  CHECK_EQ(ph_color_parse("#ff00ff", &named.color), PH_OK);
  ph_layer high_layer = PH_NULL_HANDLE;
  if (ph_plot_add_line(legend_plot2, &named, &high_layer) != PH_OK) {
    printf("  FAIL legend line 2: %s\n", ph_last_error());
    return 1;
  }
  /* An unnamed third series must stay out of the legend: an unnamed layer is a
   * builder's helper, and listing it would be clutter nobody asked for. */
  named.name = NULL;
  ph_layer anonymous = PH_NULL_HANDLE;
  if (ph_plot_add_line(legend_plot2, &named, &anonymous) != PH_OK) {
    printf("  FAIL legend line 3: %s\n", ph_last_error());
    return 1;
  }

  ph_legend_config legend_cfg;
  ph_legend_config_init(&legend_cfg);
  legend_cfg.enabled = 1;
  legend_cfg.position = PH_LEGEND_TOP_LEFT;
  CHECK_EQ(ph_plot_set_legend(legend_plot2, &legend_cfg), PH_OK);

  unsigned char* legend_px = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!legend_px) return 1;
  if (ph_plot_render_pixels(legend_plot2, patch_w, patch_h, 1.0f, legend_px, patch_w * 4) !=
      PH_OK) {
    printf("  FAIL legend render: %s\n", ph_last_error());
    return 1;
  }
  /* Two swatches, 10x10 each, in the panel at the region's top-left corner
   * (56 + 8 + 8 = 72 across, 16 + 8 + 6 = 30 down). Count them by colour. */
  long swatch_green = 0, swatch_magenta = 0;
  for (int row = 16; row < 80; row++) {
    for (int col = 56; col < 130; col++) {
      const unsigned char* p = legend_px + ((size_t)row * patch_w + col) * 4;
      if (p[3] < 200) continue;
      if (p[1] > 200 && p[0] < 40 && p[2] < 40) swatch_green++;
      if (p[0] > 200 && p[1] < 40 && p[2] > 200) swatch_magenta++;
    }
  }
  free(legend_px);
  printf("  legend swatches: green=%ld magenta=%ld\n", swatch_green, swatch_magenta);
  /* A 10x10 swatch plus its 1px outline, and nothing else that colour up there
   * — the series themselves are flat lines at y = 2 and y = 8, well below. */
  CHECK(swatch_green > 80 && swatch_green < 200);
  CHECK(swatch_magenta > 80 && swatch_magenta < 200);

  /* Clicking the first row hides its series and says so. */
  CHECK_EQ(ph_plot_clear_events(legend_plot2), PH_OK);
  ph_plot_pointer_down(legend_plot2, 78.0, 33.0, PH_BUTTON_LEFT, PH_MOD_NONE);
  ph_plot_pointer_up(legend_plot2, 78.0, 33.0, PH_BUTTON_LEFT, PH_MOD_NONE);
  int toggles = 0;
  while (ph_plot_poll_event(legend_plot2, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
    if (ev.type != PH_EVENT_LAYER_VISIBILITY) continue;
    toggles++;
    CHECK(ev.layer == low_layer);
    CHECK(ev.visible == 0);
  }
  printf("  legend toggles=%d\n", toggles);
  CHECK(toggles == 1);
  CHECK(high_layer != PH_NULL_HANDLE && anonymous != PH_NULL_HANDLE);

  CHECK_EQ(ph_plot_destroy(legend_plot2), PH_OK);

  /* ---- annotations: a band, a span and a diagonal, all in data space ---- */

  ph_plot note_plot = PH_NULL_HANDLE;
  CHECK_EQ(ph_plot_create(&patch_plot_desc, &note_plot), PH_OK);

  /* A band over y 2..4 of a 0..10 view: 20% of the region, in green. */
  ph_annotation note;
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_BAND;
  note.dim = PH_DIM_Y;
  note.y0 = 2.0;
  note.y1 = 4.0;
  CHECK_EQ(ph_color_parse("#00ff00", &note.color), PH_OK);
  ph_annotation_id band_id = 0;
  if (ph_plot_add_annotation(note_plot, &note, &band_id) != PH_OK) {
    printf("  FAIL add band: %s\n", ph_last_error());
    return 1;
  }

  /* A vertical span at x = 5, four logical px wide. */
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_SPAN;
  note.dim = PH_DIM_X;
  note.x0 = 5.0;
  note.width = 4.0f;
  CHECK_EQ(ph_color_parse("#ff00ff", &note.color), PH_OK);
  ph_annotation_id span_id = 0;
  CHECK_EQ(ph_plot_add_annotation(note_plot, &note, &span_id), PH_OK);

  /* A diagonal from corner to corner — the case the axis-aligned hairline
   * cannot draw, and the reason Primitives grew a rotated quad. */
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_LINE;
  note.x0 = 0.0;
  note.y0 = 0.0;
  note.x1 = 10.0;
  note.y1 = 10.0;
  note.width = 4.0f;
  CHECK_EQ(ph_color_parse("#ffff00", &note.color), PH_OK);
  ph_annotation_id line_id = 0;
  CHECK_EQ(ph_plot_add_annotation(note_plot, &note, &line_id), PH_OK);

  unsigned char* note_px = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!note_px) return 1;
  if (ph_plot_render_pixels(note_plot, patch_w, patch_h, 1.0f, note_px, patch_w * 4) != PH_OK) {
    printf("  FAIL annotation render: %s\n", ph_last_error());
    return 1;
  }
  long note_band = 0, note_span = 0, note_diag = 0;
  for (int i = 0; i < patch_w * patch_h; i++) {
    const unsigned char* p = note_px + (size_t)i * 4;
    if (p[3] < 200) continue;
    if (p[1] > 200 && p[0] < 40 && p[2] < 40) note_band++;
    if (p[0] > 200 && p[1] < 40 && p[2] > 200) note_span++;
    if (p[0] > 200 && p[1] > 200 && p[2] < 40) note_diag++;
  }
  free(note_px);
  /* The band is 20% of a 128x144 region; the span is 4 px by 144; the diagonal
   * runs corner to corner at 4 px wide, so about sqrt(128^2+144^2) * 4. */
  printf("  annotations band=%ld span=%ld diagonal=%ld\n", note_band, note_span, note_diag);
  CHECK(note_band > 18432 * 0.20 * 0.9 && note_band < 18432 * 0.20 * 1.1);
  CHECK(note_span > 400 && note_span < 700);
  CHECK(note_diag > 600 && note_diag < 1000);

  /* A ray is deliberately extended 8000 px past its second point, so the only
   * thing keeping it off the axes and the title is the region clip. Point one
   * straight up out of the view and check nothing reached the margins. */
  CHECK_EQ(ph_plot_clear_annotations(note_plot), PH_OK);
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_RAY;
  note.x0 = 5.0;
  note.y0 = 5.0;
  note.x1 = 5.0;
  note.y1 = 6.0;
  note.width = 6.0f;
  CHECK_EQ(ph_color_parse("#ff0000", &note.color), PH_OK);
  ph_annotation_id ray_id = 0;
  CHECK_EQ(ph_plot_add_annotation(note_plot, &note, &ray_id), PH_OK);

  unsigned char* ray_px = (unsigned char*)malloc((size_t)patch_w * patch_h * 4);
  if (!ray_px) return 1;
  if (ph_plot_render_pixels(note_plot, patch_w, patch_h, 1.0f, ray_px, patch_w * 4) != PH_OK) {
    printf("  FAIL ray render: %s\n", ph_last_error());
    return 1;
  }
  long inside = 0, outside = 0;
  for (int row = 0; row < patch_h; row++) {
    for (int col = 0; col < patch_w; col++) {
      const unsigned char* p = ray_px + ((size_t)row * patch_w + col) * 4;
      if (p[3] < 200 || p[0] < 200 || p[1] > 40 || p[2] > 40) continue;
      const int in_region = row >= 16 && row < 160 && col >= 56 && col < 184;
      if (in_region) inside++; else outside++;
    }
  }
  free(ray_px);
  printf("  ray inside=%ld outside=%ld\n", inside, outside);
  CHECK(inside > 200);
  CHECK(outside == 0);

  CHECK_EQ(ph_plot_clear_annotations(note_plot), PH_OK);
  CHECK_EQ(ph_plot_add_annotation(note_plot, &note, &band_id), PH_OK);
  CHECK_EQ(ph_plot_remove_annotation(note_plot, band_id), PH_OK);
  CHECK_EQ(ph_plot_remove_annotation(note_plot, band_id), PH_E_INVALID_ARGUMENT);
  CHECK_EQ(ph_plot_clear_annotations(note_plot), PH_OK);

  CHECK_EQ(ph_plot_destroy(note_plot), PH_OK);
  ph_shutdown();

  eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroySurface(display, surface);
  eglDestroyContext(display, context);
  eglTerminate(display);

  return TEST_MAIN_RESULT();
}
