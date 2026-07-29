#include "panels.h"

#include <math.h>
#include <stdlib.h>

#define SAMPLES 512
#define SCATTER_POINTS 1500
#define STREAM_POINTS 400

struct ph_panels {
  double wave_x[SAMPLES];
  double wave_sine[SAMPLES];
  double wave_damped[SAMPLES];

  double decay_x[SAMPLES];
  double decay_y[SAMPLES];

  double scatter_x[SCATTER_POINTS];
  double scatter_y[SCATTER_POINTS];
  float scatter_size[SCATTER_POINTS];
  ph_color scatter_color[SCATTER_POINTS];

  double stream_x[STREAM_POINTS];
  double stream_y[STREAM_POINTS];
  ph_layer stream_layer;
};

static const char* kTitles[PH_PANEL_COUNT] = {"Waves", "Log decay", "Scatter", "Streaming"};

static ph_color parse(const char* css) {
  ph_color out = PH_COLOR_AUTO;
  ph_color_parse(css, &out);
  return out;
}

/** Give one axis a title and, optionally, minor ticks between its majors. */
static void style_axis(ph_plot plot, const char* axis, const char* title, int minors) {
  ph_axis_config config;
  ph_axis_config_init(&config);
  config.title = title;
  config.minor_ticks = minors;
  ph_plot_set_axis_config(plot, axis, &config);
}

ph_panels* ph_panels_create(void) {
  ph_panels* p = (ph_panels*)calloc(1, sizeof(ph_panels));
  if (!p) return NULL;
  p->stream_layer = PH_NULL_HANDLE;

  for (int i = 0; i < SAMPLES; i++) {
    const double t = i * 0.05;
    p->wave_x[i] = t;
    p->wave_sine[i] = sin(t);
    p->wave_damped[i] = exp(-t * 0.12) * cos(t * 1.6);

    p->decay_x[i] = i;
    p->decay_y[i] = 1.0e6 * exp(-i * 0.022) + 1.0;
  }

  /* A plain LCG rather than rand(): the picture has to be identical on every
   * machine, in every host and on every run, or comparing them means nothing. */
  unsigned int seed = 12345u;
  const ph_color palette[4] = {0x60a5faffu, 0xf59e0bffu, 0x34d399ffu, 0xf87171ffu};
  for (int i = 0; i < SCATTER_POINTS; i++) {
    seed = seed * 1664525u + 1013904223u;
    const double u = (double)(seed >> 8) / 16777216.0;
    seed = seed * 1664525u + 1013904223u;
    const double v = (double)(seed >> 8) / 16777216.0;

    const double radius = sqrt(-2.0 * log(u + 1e-12));
    const double angle = 6.283185307179586 * v;
    p->scatter_x[i] = radius * cos(angle);
    p->scatter_y[i] = radius * sin(angle) * 0.6 + p->scatter_x[i] * 0.35;
    p->scatter_size[i] = 3.0f + (float)(u * 7.0);
    p->scatter_color[i] = palette[i & 3];
  }

  for (int i = 0; i < STREAM_POINTS; i++) {
    p->stream_x[i] = i;
    p->stream_y[i] = 0.0;
  }
  return p;
}

void ph_panels_free(ph_panels* panels) {
  free(panels);
}

const char* ph_panels_title(int index) {
  return kTitles[((index % PH_PANEL_COUNT) + PH_PANEL_COUNT) % PH_PANEL_COUNT];
}

/* Panel 0 — two series on a shared x axis, one of them dashed. */
static void build_waves(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Waves");
  style_axis(plot, "x", "time (s)", 4);
  style_axis(plot, "y", "amplitude", 0);

  ph_layer layer = PH_NULL_HANDLE;
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->wave_x;
  line.y = p->wave_sine;
  line.count = SAMPLES;
  line.width = 2.0f;
  line.color = parse("#38bdf8");
  line.name = "sin t";
  ph_plot_add_line(plot, &line, &layer);

  static const float dash[2] = {6.0f, 4.0f};
  line.y = p->wave_damped;
  line.color = parse("#f472b6");
  line.name = "damped";
  line.dash = dash;
  line.dash_count = 2;
  line.join = PH_JOIN_MITER;
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 1 — a log y axis, where the tick labels are the whole point. */
static void build_decay(ph_panels* p, ph_plot plot) {
  ph_axis_desc axis;
  ph_axis_desc_init(&axis);
  axis.type = PH_SCALE_LOG;
  ph_plot_set_scale(plot, "y", &axis);

  ph_plot_set_title(plot, "Log decay");
  style_axis(plot, "x", "sample", 0);
  style_axis(plot, "y", "counts", 0);

  ph_layer layer = PH_NULL_HANDLE;
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->decay_x;
  line.y = p->decay_y;
  line.count = SAMPLES;
  line.width = 2.0f;
  line.color = parse("#a3e635");
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 2 — per-point colour and size, and an explicit tick list. */
static void build_scatter(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Scatter");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  /* Explicit ticks are the ABI's answer to the web core's tick callback. */
  const ph_tick ticks[5] = {
      {-3.0, NULL, 0, PH_TOGGLE_DEFAULT},    {-1.5, NULL, 0, PH_TOGGLE_DEFAULT},
      {0.0, "origin", 0, PH_TOGGLE_DEFAULT}, {1.5, NULL, 0, PH_TOGGLE_DEFAULT},
      {3.0, NULL, 0, PH_TOGGLE_DEFAULT},
  };
  ph_plot_set_axis_ticks(plot, "x", ticks, 5);

  ph_layer layer = PH_NULL_HANDLE;
  ph_scatter_desc scatter;
  ph_scatter_desc_init(&scatter);
  scatter.x = p->scatter_x;
  scatter.y = p->scatter_y;
  scatter.count = SCATTER_POINTS;
  scatter.sizes = p->scatter_size;
  scatter.colors = p->scatter_color;
  scatter.marker = PH_MARKER_CIRCLE;
  ph_plot_add_scatter(plot, &scatter, &layer);
}

/* Panel 3 — a dynamic series rewritten every frame. */
static void build_stream(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Streaming");
  style_axis(plot, "x", "tick", 0);
  style_axis(plot, "y", "value", 0);

  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->stream_x;
  line.y = p->stream_y;
  line.count = STREAM_POINTS;
  line.width = 1.5f;
  line.color = parse("#c084fc");
  /* DYNAMIC hints the layer's buffers for repeated rewriting. */
  line.render_type = PH_RENDER_DYNAMIC;
  ph_plot_add_line(plot, &line, &p->stream_layer);

  /* A fixed y domain, so the trace moves rather than the axis. */
  ph_range domain;
  domain.lo = -2.2;
  domain.hi = 2.2;
  ph_plot_set_domain(plot, "y", domain);
}

void ph_panels_build(ph_panels* panels, ph_plot plot, int index) {
  if (!panels) return;
  const int which = ((index % PH_PANEL_COUNT) + PH_PANEL_COUNT) % PH_PANEL_COUNT;
  switch (which) {
    case 0: build_waves(panels, plot); break;
    case 1: build_decay(panels, plot); break;
    case 2: build_scatter(panels, plot); break;
    default: build_stream(panels, plot); break;
  }
}

void ph_panels_advance(ph_panels* panels, double seconds) {
  if (!panels || panels->stream_layer == PH_NULL_HANDLE) return;
  for (int i = 0; i < STREAM_POINTS; i++) {
    const double phase = seconds * 2.0 + i * 0.035;
    panels->stream_y[i] =
        sin(phase) + 0.4 * sin(phase * 3.1 + 1.0) + 0.15 * sin(phase * 7.7);
  }
  ph_layer_set_xy(panels->stream_layer, panels->stream_x, panels->stream_y, STREAM_POINTS);
}
