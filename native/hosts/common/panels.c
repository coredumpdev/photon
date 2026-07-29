#include "panels.h"

#include <math.h>
#include <stdlib.h>

#define SAMPLES 512
#define SCATTER_POINTS 1500
#define STREAM_POINTS 400
#define MONTHS 12
/* A funnel stage is a trapezoid: four corners, and five of them. */
#define FUNNEL_STAGES 5
#define SLICES 5
#define IMPULSES 24
#define TRIALS 14
/* Five latency buckets of sixty samples each. */
#define BOXES 5
#define BOX_SAMPLES 60
/* A field big enough to look like data and small enough to read in the source. */
#define FIELD_COLS 96
#define FIELD_ROWS 72
/* The sprite is drawn by hand below, so its size is deliberately tiny. */
#define SPRITE 16
/* Enough sessions for the axis to collapse a few weekends, and few enough that
 * an OHLC bar's open and close ticks are still distinguishable in one cell. */
#define SESSIONS 34
/* Enough points that a plain scatter would be a solid blob — which is the
 * argument for binning them. */
#define DENSE_POINTS 24000
/* A 14x14 lattice of arrows: dense enough to read as a field, sparse enough
 * that the individual arrowheads are still visible. */
#define FLOW 14

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

  double month[MONTHS];
  double revenue[MONTHS];
  double band_low[MONTHS];
  double band_high[MONTHS];

  double funnel_x[FUNNEL_STAGES][4];
  double funnel_y[FUNNEL_STAGES][4];
  ph_patch funnel[FUNNEL_STAGES];

  double slice[SLICES];
  double impulse_x[IMPULSES];
  double impulse_y[IMPULSES];

  double trial_x[TRIALS];
  double trial_y[TRIALS];
  double trial_err[TRIALS];

  double latency[BOXES][BOX_SAMPLES];
  ph_box_group boxes[BOXES];

  double field[FIELD_COLS * FIELD_ROWS];
  unsigned char sprite[SPRITE * SPRITE * 4];

  double session_index[SESSIONS];
  double session_time[SESSIONS];
  double bar_open[SESSIONS];
  double bar_high[SESSIONS];
  double bar_low[SESSIONS];
  double bar_close[SESSIONS];

  double dense_x[DENSE_POINTS];
  double dense_y[DENSE_POINTS];

  double flow_x[FLOW * FLOW];
  double flow_y[FLOW * FLOW];
  double flow_u[FLOW * FLOW];
  double flow_v[FLOW * FLOW];
};

static const char* kTitles[PH_PANEL_COUNT] = {"Waves",   "Log decay",    "Scatter", "Streaming",
                                              "Revenue", "Funnel",       "Share",   "Impulse",
                                              "Yield",   "Latency",      "Field",   "Sprite",
                                              "Candles", "Bars",         "Density", "Flow"};

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

  /* Twelve months of revenue with a confidence band around it. Fixed numbers
   * rather than generated ones: the band has to sit around the bars in a way a
   * reader recognizes, which noise does not reliably do. */
  static const double revenue[MONTHS] = {42, 47, 51, 49, 58, 63, 61, 68, 72, 70, 78, 84};
  for (int i = 0; i < MONTHS; i++) {
    p->month[i] = i;
    p->revenue[i] = revenue[i];
    p->band_low[i] = revenue[i] * 0.82;
    p->band_high[i] = revenue[i] * 1.14;
  }

  /* Five funnel stages, each a trapezoid narrowing as it descends. This is the
   * shape patches exists for — the web core's funnel, treemap and sankey are
   * all free functions that emit polygons and hand them to addPatches. */
  static const double reach[FUNNEL_STAGES + 1] = {1.0, 0.72, 0.46, 0.28, 0.15, 0.09};
  for (int i = 0; i < FUNNEL_STAGES; i++) {
    const double top = (double)(FUNNEL_STAGES - i);
    const double bottom = top - 0.86; /* a gap between stages */
    const double half_top = reach[i] / 2.0;
    const double half_bottom = reach[i + 1] / 2.0;
    p->funnel_x[i][0] = 0.5 - half_top;
    p->funnel_y[i][0] = top;
    p->funnel_x[i][1] = 0.5 + half_top;
    p->funnel_y[i][1] = top;
    p->funnel_x[i][2] = 0.5 + half_bottom;
    p->funnel_y[i][2] = bottom;
    p->funnel_x[i][3] = 0.5 - half_bottom;
    p->funnel_y[i][3] = bottom;

    p->funnel[i].x = p->funnel_x[i];
    p->funnel[i].y = p->funnel_y[i];
    p->funnel[i].count = 4;
    p->funnel[i].holes = NULL;
    p->funnel[i].hole_count = 0;
  }
  p->funnel[0].color = parse("#38bdf8");
  p->funnel[1].color = parse("#22d3ee");
  p->funnel[2].color = parse("#34d399");
  p->funnel[3].color = parse("#a3e635");
  p->funnel[4].color = parse("#facc15");

  static const double slices[SLICES] = {38.0, 24.0, 18.0, 12.0, 8.0};
  for (int i = 0; i < SLICES; i++) p->slice[i] = slices[i];

  /* A decaying oscillation sampled coarsely — what a stem plot is for: the
   * samples are the data, and joining them with a line would imply something
   * about the space between them that is not there. */
  for (int i = 0; i < IMPULSES; i++) {
    p->impulse_x[i] = i;
    p->impulse_y[i] = exp(-i * 0.12) * cos(i * 0.7);
  }

  /* A measured curve with an uncertainty that grows with the reading — the
   * shape an error bar exists to show, and one a line alone would hide. */
  for (int i = 0; i < TRIALS; i++) {
    const double dose = i * 0.5;
    p->trial_x[i] = dose;
    p->trial_y[i] = 90.0 / (1.0 + exp(-(dose - 3.2) * 1.1));
    p->trial_err[i] = 3.0 + p->trial_y[i] * 0.09;
  }

  /* Five services' latencies. Same LCG as the scatter, for the same reason:
   * the quartiles have to be identical in every host or comparing the pictures
   * proves nothing. A lognormal shape, because latency is never symmetric. */
  seed = 987654321u;
  static const double centre[BOXES] = {1.6, 2.0, 2.35, 1.85, 2.6};
  static const double spread[BOXES] = {0.28, 0.34, 0.22, 0.55, 0.30};
  for (int b = 0; b < BOXES; b++) {
    for (int i = 0; i < BOX_SAMPLES; i++) {
      seed = seed * 1664525u + 1013904223u;
      const double u = (double)(seed >> 8) / 16777216.0;
      seed = seed * 1664525u + 1013904223u;
      const double v = (double)(seed >> 8) / 16777216.0;
      const double gauss = sqrt(-2.0 * log(u + 1e-12)) * cos(6.283185307179586 * v);
      p->latency[b][i] = exp(centre[b] + spread[b] * gauss);
    }
    p->boxes[b].position = b;
    p->boxes[b].values = p->latency[b];
    p->boxes[b].count = BOX_SAMPLES;
    p->boxes[b].label = NULL;
  }
  p->boxes[0].color = parse("#38bdf8");
  p->boxes[1].color = parse("#22d3ee");
  p->boxes[2].color = parse("#34d399");
  p->boxes[3].color = parse("#facc15");
  p->boxes[4].color = parse("#f472b6");

  /* Two interfering circular waves — a field whose structure survives being
   * squeezed into a small cell, which is what makes it worth colouring. */
  for (int row = 0; row < FIELD_ROWS; row++) {
    for (int col = 0; col < FIELD_COLS; col++) {
      const double x = (col - FIELD_COLS * 0.5) * 0.12;
      const double y = (row - FIELD_ROWS * 0.5) * 0.12;
      const double r1 = sqrt((x + 2.0) * (x + 2.0) + y * y);
      const double r2 = sqrt((x - 2.0) * (x - 2.0) + y * y);
      p->field[row * FIELD_COLS + col] = sin(r1 * 3.0) + sin(r2 * 3.0);
    }
  }

  /* A 16x16 RGBA sprite: a soft disc with a hard ring, written top row first
   * the way a decoded image arrives, so the layer's default orientation is the
   * one being exercised. */
  for (int row = 0; row < SPRITE; row++) {
    for (int col = 0; col < SPRITE; col++) {
      const double dx = col - (SPRITE - 1) / 2.0;
      const double dy = row - (SPRITE - 1) / 2.0;
      const double d = sqrt(dx * dx + dy * dy) / (SPRITE / 2.0);
      unsigned char* px = &p->sprite[(row * SPRITE + col) * 4];
      const double ring = d > 0.78 && d < 0.98 ? 1.0 : 0.0;
      const double disc = d < 0.62 ? 1.0 - d : 0.0;
      px[0] = (unsigned char)(255.0 * (ring + disc * 0.2));
      px[1] = (unsigned char)(255.0 * disc * 0.9);
      px[2] = (unsigned char)(255.0 * (ring * 0.3 + disc));
      px[3] = (unsigned char)(255.0 * (ring > 0.0 || disc > 0.0 ? 1.0 : 0.0));
    }
  }

  /* A random walk with an intraday range, dated onto weekdays only — so the
   * session axis has real gaps to collapse, which is the whole reason that
   * scale exists. Fixed seed, same reason as everywhere else here. */
  seed = 24681357u;
  double price = 100.0;
  /* 2024-01-01T00:00:00Z, a Monday. */
  double day = 1704067200000.0;
  for (int i = 0; i < SESSIONS; i++) {
    seed = seed * 1664525u + 1013904223u;
    const double drift = ((double)(seed >> 8) / 16777216.0 - 0.48) * 3.2;
    seed = seed * 1664525u + 1013904223u;
    const double reach = (double)(seed >> 8) / 16777216.0 * 2.4 + 0.4;

    const double open = price;
    const double close = price + drift;
    p->session_index[i] = i;
    p->session_time[i] = day;
    p->bar_open[i] = open;
    p->bar_close[i] = close;
    p->bar_high[i] = (open > close ? open : close) + reach;
    p->bar_low[i] = (open < close ? open : close) - reach;
    price = close;

    /* Skip the weekend, so consecutive indices are consecutive *sessions*. */
    day += 86400000.0;
    const int weekday = (i + 1) % 7;
    if (weekday == 4) day += 2.0 * 86400000.0;
  }

  /* Two overlapping Gaussian blobs, twenty-four thousand points. Drawn as a
   * scatter this is a shape with no interior; binned, the interior is the
   * whole message. */
  seed = 13572468u;
  for (int i = 0; i < DENSE_POINTS; i++) {
    seed = seed * 1664525u + 1013904223u;
    const double u = (double)(seed >> 8) / 16777216.0;
    seed = seed * 1664525u + 1013904223u;
    const double v = (double)(seed >> 8) / 16777216.0;
    const double radius = sqrt(-2.0 * log(u + 1e-12));
    const double angle = 6.283185307179586 * v;
    const double cx = (i % 3 == 0) ? 2.2 : -1.4;
    const double cy = (i % 3 == 0) ? 1.1 : -0.7;
    p->dense_x[i] = cx + radius * cos(angle) * 1.15;
    p->dense_y[i] = cy + radius * sin(angle) * 0.85;
  }

  /* A rotational field with a sink at the centre: the arrows curl, and their
   * magnitude falls off, so colouring by magnitude actually says something. */
  for (int row = 0; row < FLOW; row++) {
    for (int col = 0; col < FLOW; col++) {
      const double x = -3.0 + col * (6.0 / (FLOW - 1));
      const double y = -3.0 + row * (6.0 / (FLOW - 1));
      const double r2 = x * x + y * y + 0.6;
      const int i = row * FLOW + col;
      p->flow_x[i] = x;
      p->flow_y[i] = y;
      p->flow_u[i] = (-y - x * 0.35) / r2 * 4.0;
      p->flow_v[i] = (x - y * 0.35) / r2 * 4.0;
    }
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

/* Panel 4 — bars with a band behind them: area and bar on one plot. */
static void build_revenue(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Revenue");
  style_axis(plot, "x", "month", 0);
  style_axis(plot, "y", "k$", 0);

  ph_layer layer = PH_NULL_HANDLE;

  /* The band goes first so the bars land on top of it. Layers draw in the
   * order they were added, which is the only z-ordering the core has. */
  ph_area_desc area;
  ph_area_desc_init(&area);
  area.x = p->month;
  area.y = p->band_high;
  area.base = p->band_low;
  area.count = MONTHS;
  area.color = parse("#38bdf83d");
  ph_plot_add_area(plot, &area, &layer);

  ph_bar_desc bar;
  ph_bar_desc_init(&bar);
  bar.x = p->month;
  bar.y = p->revenue;
  bar.count = MONTHS;
  bar.width = 0.62;
  bar.color = parse("#3b82f6");
  ph_plot_add_bar(plot, &bar, &layer);
}

/* Panel 5 — five filled trapezoids, one patches layer. */
static void build_funnel(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Funnel");
  style_axis(plot, "x", "share", 0);
  style_axis(plot, "y", "stage", 0);

  ph_patches_desc desc;
  ph_patches_desc_init(&desc);
  desc.patches = p->funnel;
  desc.patch_count = FUNNEL_STAGES;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_patches(plot, &desc, &layer);
}

/* Panel 6 — a donut, which is the pie layer with an inner radius. */
static void build_share(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Share");
  /* A pie has no axes worth reading, and the grid behind it is noise. */
  ph_axis_config bare;
  ph_axis_config_init(&bare);
  bare.no_axis_line = 1;
  bare.no_ticks = 1;
  bare.no_grid = 1;
  ph_plot_set_axis_config(plot, "x", &bare);
  ph_plot_set_axis_config(plot, "y", &bare);

  ph_pie_desc pie;
  ph_pie_desc_init(&pie);
  pie.values = p->slice;
  pie.count = SLICES;
  pie.radius = 1.0;
  pie.inner_radius = 0.55;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_pie(plot, &pie, &layer);
}

/* Panel 7 — stems from zero, with a disc at each tip. */
static void build_impulse(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Impulse");
  style_axis(plot, "x", "n", 0);
  style_axis(plot, "y", "h[n]", 0);

  ph_stem_desc stem;
  ph_stem_desc_init(&stem);
  stem.x = p->impulse_x;
  stem.y = p->impulse_y;
  stem.count = IMPULSES;
  stem.color = parse("#22d3ee");
  stem.width = 2.0f;
  stem.marker_size = 7.0f;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_stem(plot, &stem, &layer);
}

/* Panel 8 — a measured curve with its uncertainty, as a band and whiskers. */
static void build_yield(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Yield");
  style_axis(plot, "x", "dose (mg)", 0);
  style_axis(plot, "y", "yield (%)", 0);

  ph_layer layer = PH_NULL_HANDLE;

  /* Band first, then the line, then the whiskers on top: the reading is the
   * thing in focus and the uncertainty is the context behind it. */
  ph_errorbar_desc err;
  ph_errorbar_desc_init(&err);
  err.x = p->trial_x;
  err.y = p->trial_y;
  err.count = TRIALS;
  err.y_err_array = p->trial_err;
  err.band = 1;
  err.color = parse("#f59e0b");
  ph_plot_add_errorbar(plot, &err, &layer);

  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->trial_x;
  line.y = p->trial_y;
  line.count = TRIALS;
  line.width = 2.0f;
  line.color = parse("#f59e0b");
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 9 — five Tukey boxes, quartiles computed by the core. */
static void build_latency(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Latency");
  style_axis(plot, "x", "service", 0);
  style_axis(plot, "y", "ms", 0);

  /* Named ticks, because the x axis is five categories and not five numbers.
   * Short names on purpose: the core does not rotate labels, so in a narrow
   * cell long ones would run into each other. */
  const ph_tick ticks[BOXES] = {
      {0.0, "api", 0, PH_TOGGLE_DEFAULT}, {1.0, "auth", 0, PH_TOGGLE_DEFAULT},
      {2.0, "db", 0, PH_TOGGLE_DEFAULT},  {3.0, "cdn", 0, PH_TOGGLE_DEFAULT},
      {4.0, "ui", 0, PH_TOGGLE_DEFAULT},
  };
  ph_plot_set_axis_ticks(plot, "x", ticks, BOXES);

  ph_box_desc box;
  ph_box_desc_init(&box);
  box.groups = p->boxes;
  box.group_count = BOXES;
  box.width = 0.62;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_box(plot, &box, &layer);
}

/* Panel 10 — a scalar field, coloured by the core rather than by the caller. */
static void build_field(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Field");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  ph_colormap_spec cmap;
  ph_colormap_spec_init(&cmap);
  /* Diverging, because the field is signed and its zero means something —
   * paired with a domain centred on it, which is what symmetric_domain is for. */
  cmap.name = "RdBu";
  ph_range domain;
  ph_symmetric_domain(p->field, FIELD_COLS * FIELD_ROWS, 0.0, &domain);

  ph_heatmap_desc heat;
  ph_heatmap_desc_init(&heat);
  heat.values = p->field;
  heat.cols = FIELD_COLS;
  heat.rows = FIELD_ROWS;
  heat.x.lo = -6.0;
  heat.x.hi = 6.0;
  heat.y.lo = -4.5;
  heat.y.hi = 4.5;
  heat.colormap = &cmap;
  heat.domain = domain;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_heatmap(plot, &heat, &layer);
}

/* Panel 11 — RGBA pixels placed in data space, with a line for scale. */
static void build_sprite(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Sprite");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  ph_layer layer = PH_NULL_HANDLE;

  /* Nearest filtering, because at this size the point is the pixels: a smooth
   * one would only prove the sampler works. */
  ph_image_desc image;
  ph_image_desc_init(&image);
  image.pixels = p->sprite;
  image.width = SPRITE;
  image.height = SPRITE;
  image.x.lo = 0.0;
  image.x.hi = 4.0;
  image.y.lo = 0.0;
  image.y.hi = 4.0;
  image.no_smooth = 1;
  ph_plot_add_image(plot, &image, &layer);

  /* The same sprite again, smoothed, half-transparent and overlapping — so the
   * two filters and the opacity are all visible in one cell. */
  image.x.lo = 2.5;
  image.x.hi = 6.5;
  image.y.lo = 1.5;
  image.y.hi = 5.5;
  image.no_smooth = 0;
  image.opacity = 0.65f;
  ph_plot_add_image(plot, &image, &layer);
}

/* The session axis: integer indices, dated back into calendar ticks. */
static void session_axis(ph_panels* p, ph_plot plot) {
  ph_axis_desc axis;
  ph_axis_desc_init(&axis);
  axis.type = PH_SCALE_ORDINAL_TIME;
  /* The x values are indices; `times` is what turns them back into dates for
   * the tick labels. Without it the axis would read 0..59. */
  axis.times = p->session_time;
  axis.time_count = SESSIONS;
  ph_plot_set_scale(plot, "x", &axis);
}

/* Panel 12 — candlesticks on a session axis. */
static void build_candles(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Candles");
  session_axis(p, plot);
  style_axis(plot, "x", "session", 0);
  style_axis(plot, "y", "price", 0);

  ph_candlestick_desc candles;
  ph_candlestick_desc_init(&candles);
  candles.x = p->session_index;
  candles.open = p->bar_open;
  candles.high = p->bar_high;
  candles.low = p->bar_low;
  candles.close = p->bar_close;
  candles.count = SESSIONS;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_candlestick(plot, &candles, &layer);
}

/* Panel 13 — the same sessions as OHLC bars, so the two are comparable. */
static void build_bars(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Bars");
  session_axis(p, plot);
  style_axis(plot, "x", "session", 0);
  style_axis(plot, "y", "price", 0);

  ph_ohlc_desc bars;
  ph_ohlc_desc_init(&bars);
  bars.x = p->session_index;
  bars.open = p->bar_open;
  bars.high = p->bar_high;
  bars.low = p->bar_low;
  bars.close = p->bar_close;
  bars.count = SESSIONS;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_ohlc(plot, &bars, &layer);
}

/* Panel 14 — twenty-four thousand points as a few hundred hexagons. */
static void build_density(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Density");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  ph_colormap_spec cmap;
  ph_colormap_spec_init(&cmap);
  cmap.name = "magma";

  ph_hexbin_desc hexes;
  ph_hexbin_desc_init(&hexes);
  hexes.x = p->dense_x;
  hexes.y = p->dense_y;
  hexes.count = DENSE_POINTS;
  hexes.radius = 0.16;
  hexes.colormap = &cmap;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_hexbin(plot, &hexes, &layer);
}

/* Panel 15 — a vector field, each arrow coloured by its own magnitude. */
static void build_flow(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Flow");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  ph_colormap_spec cmap;
  ph_colormap_spec_init(&cmap);
  cmap.name = "turbo";

  ph_quiver_desc arrows;
  ph_quiver_desc_init(&arrows);
  arrows.x = p->flow_x;
  arrows.y = p->flow_y;
  arrows.u = p->flow_u;
  arrows.v = p->flow_v;
  arrows.count = FLOW * FLOW;
  /* No values given, so the colour follows each arrow's own magnitude. */
  arrows.color_by = 1;
  arrows.color_map = &cmap;
  arrows.width = 2.0f;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_quiver(plot, &arrows, &layer);
}

void ph_panels_build(ph_panels* panels, ph_plot plot, int index) {
  if (!panels) return;
  const int which = ((index % PH_PANEL_COUNT) + PH_PANEL_COUNT) % PH_PANEL_COUNT;
  switch (which) {
    case 0: build_waves(panels, plot); break;
    case 1: build_decay(panels, plot); break;
    case 2: build_scatter(panels, plot); break;
    case 3: build_stream(panels, plot); break;
    case 4: build_revenue(panels, plot); break;
    case 5: build_funnel(panels, plot); break;
    case 6: build_share(panels, plot); break;
    case 7: build_impulse(panels, plot); break;
    case 8: build_yield(panels, plot); break;
    case 9: build_latency(panels, plot); break;
    case 10: build_field(panels, plot); break;
    case 11: build_sprite(panels, plot); break;
    case 12: build_candles(panels, plot); break;
    case 13: build_bars(panels, plot); break;
    case 14: build_density(panels, plot); break;
    default: build_flow(panels, plot); break;
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
