/*
 * The native gallery: four charts in one window, one GL context, one swap.
 *
 * It mirrors examples/vanilla in the TypeScript half — the point is that the two
 * can be put side by side and compared, which is the acceptance test for the
 * whole port. Each panel here exercises something specific: multiple series and
 * axis titles, a log axis, a scatter with per-point colour, and a streaming
 * series updated every frame.
 *
 *   drag             pan          wheel      zoom about the cursor
 *   B                box zoom     P          back to pan
 *   R                reset view   T          light / dark
 *   space            pause the streaming panel
 */

#define GLFW_INCLUDE_NONE
#include <GLFW/glfw3.h>
#include <math.h>
#include <photon/photon.h>
#include <stdio.h>
#include <stdlib.h>

#include "photon_glfw.h"

#define PANELS 4
#define SAMPLES 512
#define SCATTER_POINTS 1500
#define STREAM_POINTS 400

static ph_plot g_plots[PANELS];
static ph_layer g_stream_layer = PH_NULL_HANDLE;
static double g_stream_x[STREAM_POINTS];
static double g_stream_y[STREAM_POINTS];
static int g_theme = PH_THEME_DARK;
static int g_paused = 0;

/* glfwGetProcAddress takes one argument and the ABI's resolver takes two, so
 * this is a real function rather than a cast: calling a function pointer through
 * an incompatible type is undefined behaviour, and on some ABIs it really does
 * misbehave. */
static void* PH_CALL resolve_gl(const char* name, void* user) {
  (void)user;
  /* Every GL loader in existence hands entry points back as void*, but ISO C
   * does not promise a function pointer survives the trip through one — so the
   * conversion goes through a union rather than a cast. */
  union {
    GLFWglproc function;
    void* object;
  } bridge;
  bridge.function = glfwGetProcAddress(name);
  return bridge.object;
}

static ph_color color(const char* css) {
  ph_color out = PH_COLOR_AUTO;
  ph_color_parse(css, &out);
  return out;
}

/** Style one axis: a title plus, optionally, minor grid ticks. */
static void style_axis(ph_plot plot, const char* axis, const char* title, int minors) {
  ph_axis_config config;
  ph_axis_config_init(&config);
  config.title = title;
  config.minor_ticks = minors;
  ph_plot_set_axis_config(plot, axis, &config);
}

/* --------------------------------------------------------------------------
 * Panel 1 — two series against a shared x axis.
 * ------------------------------------------------------------------------ */

static void build_waves(ph_plot plot) {
  static double xs[SAMPLES], sine[SAMPLES], damped[SAMPLES];
  for (int i = 0; i < SAMPLES; i++) {
    const double t = i * 0.05;
    xs[i] = t;
    sine[i] = sin(t);
    damped[i] = exp(-t * 0.12) * cos(t * 1.6);
  }

  ph_plot_set_title(plot, "Waves");
  style_axis(plot, "x", "time (s)", 4);
  style_axis(plot, "y", "amplitude", 0);

  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = sine;
  line.count = SAMPLES;
  line.width = 2.0f;
  line.color = color("#38bdf8");
  line.name = "sin t";
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_line(plot, &line, &layer);

  static const float dash[2] = {6.0f, 4.0f};
  line.y = damped;
  line.color = color("#f472b6");
  line.name = "damped";
  line.dash = dash;
  line.dash_count = 2;
  line.join = PH_JOIN_MITER;
  ph_plot_add_line(plot, &line, &layer);
}

/* --------------------------------------------------------------------------
 * Panel 2 — a log y axis, where the tick labels are the whole point.
 * ------------------------------------------------------------------------ */

static void build_decay(ph_plot plot) {
  static double xs[SAMPLES], ys[SAMPLES];
  for (int i = 0; i < SAMPLES; i++) {
    xs[i] = i;
    ys[i] = 1.0e6 * exp(-i * 0.022) + 1.0;
  }

  ph_axis_desc axis;
  ph_axis_desc_init(&axis);
  axis.type = PH_SCALE_LOG;
  ph_plot_set_scale(plot, "y", &axis);

  ph_plot_set_title(plot, "Log decay");
  style_axis(plot, "x", "sample", 0);
  style_axis(plot, "y", "counts", 0);

  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = xs;
  line.y = ys;
  line.count = SAMPLES;
  line.width = 2.0f;
  line.color = color("#a3e635");
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_line(plot, &line, &layer);
}

/* --------------------------------------------------------------------------
 * Panel 3 — per-point colour and size, and an explicit tick list.
 * ------------------------------------------------------------------------ */

static void build_scatter(ph_plot plot) {
  static double xs[SCATTER_POINTS], ys[SCATTER_POINTS];
  static float sizes[SCATTER_POINTS];
  static ph_color colors[SCATTER_POINTS];

  unsigned int seed = 12345u;
  const ph_color palette[4] = {0x60a5faffu, 0xf59e0bffu, 0x34d399ffu, 0xf87171ffu};
  for (int i = 0; i < SCATTER_POINTS; i++) {
    /* A plain LCG: the picture has to be identical on every machine and every
     * run, or comparing it to the web gallery means nothing. */
    seed = seed * 1664525u + 1013904223u;
    const double u = (double)(seed >> 8) / 16777216.0;
    seed = seed * 1664525u + 1013904223u;
    const double v = (double)(seed >> 8) / 16777216.0;

    const double radius = sqrt(-2.0 * log(u + 1e-12));
    const double angle = 6.283185307179586 * v;
    xs[i] = radius * cos(angle);
    ys[i] = radius * sin(angle) * 0.6 + xs[i] * 0.35;
    sizes[i] = 3.0f + (float)(u * 7.0);
    colors[i] = palette[i & 3];
  }

  ph_plot_set_title(plot, "Scatter");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  /* An explicit tick list — the ABI's answer to the web core's tick callback. */
  const ph_tick ticks[5] = {
      {-3.0, NULL, 0, PH_TOGGLE_DEFAULT}, {-1.5, NULL, 0, PH_TOGGLE_DEFAULT},
      {0.0, "origin", 0, PH_TOGGLE_DEFAULT}, {1.5, NULL, 0, PH_TOGGLE_DEFAULT},
      {3.0, NULL, 0, PH_TOGGLE_DEFAULT},
  };
  ph_plot_set_axis_ticks(plot, "x", ticks, 5);

  ph_scatter_desc scatter;
  ph_scatter_desc_init(&scatter);
  scatter.x = xs;
  scatter.y = ys;
  scatter.count = SCATTER_POINTS;
  scatter.sizes = sizes;
  scatter.colors = colors;
  scatter.marker = PH_MARKER_CIRCLE;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_scatter(plot, &scatter, &layer);
}

/* --------------------------------------------------------------------------
 * Panel 4 — a dynamic series rewritten every frame.
 * ------------------------------------------------------------------------ */

static void build_stream(ph_plot plot) {
  for (int i = 0; i < STREAM_POINTS; i++) {
    g_stream_x[i] = i;
    g_stream_y[i] = 0.0;
  }

  ph_plot_set_title(plot, "Streaming");
  style_axis(plot, "x", "tick", 0);
  style_axis(plot, "y", "value", 0);

  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = g_stream_x;
  line.y = g_stream_y;
  line.count = STREAM_POINTS;
  line.width = 1.5f;
  line.color = color("#c084fc");
  /* DYNAMIC tells the layer to allocate its buffers for repeated rewriting. */
  line.render_type = PH_RENDER_DYNAMIC;
  ph_plot_add_line(plot, &line, &g_stream_layer);

  ph_plot_set_domain(plot, "y", (ph_range){-2.2, 2.2});
}

static void advance_stream(double time) {
  for (int i = 0; i < STREAM_POINTS; i++) {
    const double phase = time * 2.0 + i * 0.035;
    g_stream_y[i] = sin(phase) + 0.4 * sin(phase * 3.1 + 1.0) + 0.15 * sin(phase * 7.7);
  }
  ph_layer_set_xy(g_stream_layer, g_stream_x, g_stream_y, STREAM_POINTS);
}

/* --------------------------------------------------------------------------
 * Keys, and the loop.
 * ------------------------------------------------------------------------ */

static void on_key(GLFWwindow* window, int key, int scancode, int action, int mods) {
  (void)scancode;
  (void)mods;
  if (action != GLFW_PRESS) return;
  switch (key) {
    case GLFW_KEY_ESCAPE:
      glfwSetWindowShouldClose(window, GLFW_TRUE);
      break;
    case GLFW_KEY_R:
      for (int i = 0; i < PANELS; i++) ph_plot_reset_view(g_plots[i]);
      break;
    case GLFW_KEY_B:
      for (int i = 0; i < PANELS; i++) ph_plot_set_mode(g_plots[i], PH_MODE_BOX);
      break;
    case GLFW_KEY_P:
      for (int i = 0; i < PANELS; i++) ph_plot_set_mode(g_plots[i], PH_MODE_PAN);
      break;
    case GLFW_KEY_T:
      g_theme = g_theme == PH_THEME_DARK ? PH_THEME_LIGHT : PH_THEME_DARK;
      for (int i = 0; i < PANELS; i++) ph_plot_set_theme(g_plots[i], g_theme);
      break;
    case GLFW_KEY_SPACE:
      g_paused = !g_paused;
      break;
    default:
      break;
  }
}

static void on_glfw_error(int code, const char* description) {
  fprintf(stderr, "glfw error %d: %s\n", code, description);
}

int main(void) {
  glfwSetErrorCallback(on_glfw_error);
  if (!glfwInit()) {
    fprintf(stderr, "could not initialize GLFW\n");
    return 1;
  }

  glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
  glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
  glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
  glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
  glfwWindowHint(GLFW_SCALE_TO_MONITOR, GLFW_TRUE);
  /* The plots blend with premultiplied alpha onto whatever is already there, so
   * the window needs an alpha channel and a cleared framebuffer. */
  glfwWindowHint(GLFW_SAMPLES, 0);

  GLFWwindow* window = glfwCreateWindow(1280, 800, "Photon — native gallery", NULL, NULL);
  if (!window) {
    fprintf(stderr, "could not create a GL 3.3 core window\n");
    glfwTerminate();
    return 1;
  }
  glfwMakeContextCurrent(window);
  glfwSwapInterval(1);
  glfwSetKeyCallback(window, on_key);

  ph_host_desc host_desc;
  ph_host_desc_init(&host_desc);
  host_desc.api = PH_GFX_GL33;
  host_desc.get_proc_address = resolve_gl;
  if (ph_init(PHOTON_ABI_VERSION, &host_desc) != PH_OK) {
    fprintf(stderr, "ph_init failed: %s\n", ph_last_error());
    return 1;
  }

  ph_plot_desc plot_desc;
  ph_plot_desc_init(&plot_desc);
  plot_desc.theme = g_theme;
  plot_desc.background = color("#0f172a");
  for (int i = 0; i < PANELS; i++) {
    if (ph_plot_create(&plot_desc, &g_plots[i]) != PH_OK) {
      fprintf(stderr, "ph_plot_create failed: %s\n", ph_last_error());
      return 1;
    }
  }

  build_waves(g_plots[0]);
  build_decay(g_plots[1]);
  build_scatter(g_plots[2]);
  build_stream(g_plots[3]);

  ph_glfw_host* host = ph_glfw_host_create(window, g_plots, PANELS, 2);
  if (!host) {
    fprintf(stderr, "could not attach the plots to the window\n");
    return 1;
  }

  while (!glfwWindowShouldClose(window)) {
    if (!g_paused) advance_stream(glfwGetTime());

    if (!ph_glfw_host_draw(host)) {
      fprintf(stderr, "render failed: %s\n", ph_last_error());
      break;
    }

    /* An animating panel means there is always another frame owed; when it is
     * paused the loop goes to sleep until something actually happens. */
    if (g_paused && !ph_glfw_host_dirty(host)) {
      glfwWaitEvents();
    } else {
      glfwPollEvents();
    }
  }

  ph_glfw_host_destroy(host);
  ph_shutdown();
  glfwDestroyWindow(window);
  glfwTerminate();
  return 0;
}
