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
  ph_shutdown();

  eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroySurface(display, surface);
  eglDestroyContext(display, context);
  eglTerminate(display);

  return TEST_MAIN_RESULT();
}
