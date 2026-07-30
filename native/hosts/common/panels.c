#include "panels.h"

#include <math.h>
#include <stdio.h>
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
/* The contour shares the Field panel's grid resolution on purpose: the two are
 * the same data drawn two ways, which is what makes them worth putting side by
 * side. */
#define ISO_LEVELS 9
/* A small-world graph: enough nodes to need a layout, few enough to read. */
#define NODES 48
#define GRAPH_EDGES 72
/* Short enough that the bands cover most of the 34 sessions rather than warming
 * up through half of them. */
#define BOLLINGER_PERIOD 10
/* A noisy quadratic: enough points for LOESS to have something to average over,
 * few enough that the individual samples are still visible under the fit. */
#define FIT_POINTS 160
#define FIT_GRID 60
/* Two tones plus noise, sampled long enough for Welch to average eight
 * overlapping 256-sample segments. */
#define PSD_SAMPLES 2048
#define PSD_SEGMENT 256
#define PSD_BINS (PSD_SEGMENT / 2)
#define PSD_RATE 256.0
/* Enough samples for the ROC to be a curve rather than a staircase, and few
 * enough that the vertex array is a fixed size here. */
#define ROC_SAMPLES 240
/* Three Gaussian blobs in four dimensions, projected to two. Four so that the
 * projection is doing real work; three clusters so the picture has an answer. */
#define EMBED_POINTS 300
#define EMBED_DIMS 4
/* The composed charts are all small by nature: a treemap of eight products, a
 * three-level hierarchy, a five-node flow, four trading partners, and enough
 * rows for parallel coordinates to show a pattern rather than a haystack. */
#define TREEMAP_ITEMS 8
#define TREE_NODES 13
#define FLOW_NODES 6
#define FLOW_LINKS 6
#define CHORD_GROUPS 4
#define PARALLEL_DIMS 4
#define PARALLEL_ROWS 40
/* Three revenue streams over the same twelve months as the Revenue panel, so
 * the grouped and stacked forms of the same data sit side by side. */
#define STREAMS 3
/* A bimodal sample, big enough that the bin shape is the data's and not the
 * sampler's. */
#define HIST_SAMPLES 4000
/* A four-petal rose, sampled finely enough that the petals are curves rather
 * than polygons, plus twelve marks around it. */
#define ROSE_POINTS 361
#define ROSE_MARKS 12
/* A 48x48 height field: fine enough that the surface reads as a landscape,
 * coarse enough that the flat-shaded facets are still visible. */
#define TERRAIN 48
/* A helix plus a cloud around it — the two 3-D layers that are not a grid. */
#define HELIX_POINTS 400
#define CLOUD_POINTS 1200
/* A 12x12 lattice of bars, which is as many as read cleanly at panel size. */
#define BARS3D 12
/* A 40x40 lattice for the floating contour map, and a 32-cube volume for the
 * isosurface — enough for the level sets to be curves rather than staircases. */
#define ISOGRID 40
#define VOXELS 32

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
  ph_heatmap_desc field_desc;
  ph_colormap_spec field_map;
  ph_layer field_layer;
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

  ph_edge graph_edges[GRAPH_EDGES];

  /* Bollinger Bands over the session closes, computed once at build time.
   * The leading BOLLINGER_PERIOD-1 samples are NaN and simply do not draw. */
  double band_mid[SESSIONS];
  double band_up[SESSIONS];
  double band_dn[SESSIONS];

  double fit_x[FIT_POINTS];
  double fit_y[FIT_POINTS];
  double fit_grid_x[FIT_GRID];
  double fit_grid_y[FIT_GRID];
  double trend_x[2];
  double trend_y[2];

  double psd_signal[PSD_SAMPLES];
  double psd_freq[PSD_BINS];
  double psd_power[PSD_BINS];
  int psd_count;

  double roc_fpr[ROC_SAMPLES + 1];
  double roc_tpr[ROC_SAMPLES + 1];
  double roc_chance[2];
  int roc_count;
  double roc_auc;

  double embed_raw[EMBED_POINTS * EMBED_DIMS];
  double embed_x[EMBED_POINTS];
  double embed_y[EMBED_POINTS];
  ph_color embed_color[EMBED_POINTS];

  ph_chart_item treemap[TREEMAP_ITEMS];
  ph_tree_node tree[TREE_NODES];
  ph_flow_node flow_nodes[FLOW_NODES];
  ph_flow flow_links[FLOW_LINKS];
  double chord[CHORD_GROUPS * CHORD_GROUPS];
  double parallel[PARALLEL_ROWS * PARALLEL_DIMS];
  double parallel_class[PARALLEL_ROWS];
  ph_layer parallel_layers[PARALLEL_ROWS];

  double stream_series[STREAMS][MONTHS];
  ph_series streams[STREAMS];
  ph_layer stream_layers[STREAMS];
  double hist[HIST_SAMPLES];
  double funnel_value[FUNNEL_STAGES];

  double rose_theta[ROSE_POINTS];
  double rose_r[ROSE_POINTS];
  double mark_theta[ROSE_MARKS];
  double mark_r[ROSE_MARKS];

  double terrain[TERRAIN * TERRAIN];
  double helix_x[HELIX_POINTS];
  double helix_y[HELIX_POINTS];
  double helix_z[HELIX_POINTS];
  double cloud_x[CLOUD_POINTS];
  double cloud_y[CLOUD_POINTS];
  double cloud_z[CLOUD_POINTS];
  double cloud_value[CLOUD_POINTS];
  double bars3d[BARS3D * BARS3D];
  double iso_grid[ISOGRID * ISOGRID];
  double voxels[VOXELS * VOXELS * VOXELS];
  ph_box3d city[BARS3D * BARS3D];
};

static const char* kTitles[PH_PANEL_COUNT] = {"Waves",   "Log decay", "Scatter", "Streaming",
                                              "Revenue", "Funnel",    "Share",   "Impulse",
                                              "Yield",   "Latency",   "Field",   "Sprite",
                                              "Candles", "Bars",      "Density", "Flow",
                                              "Contour", "Network",   "Signals", "Fit",
                                              "Spectrum", "ROC",      "Embedding", "Treemap",
                                              "Sunburst", "Sankey",   "Chord",     "Gauge",
                                              "Parallel", "Grouped",  "Stacked",   "Histogram",
                                              "Spectrogram", "Polar"};

/** The interference field at time `t`. Shared by the initial bake and the clock. */
static void fill_field(ph_panels* p, double t) {
  for (int row = 0; row < FIELD_ROWS; row++) {
    for (int col = 0; col < FIELD_COLS; col++) {
      const double x = (col - FIELD_COLS * 0.5) * 0.12;
      const double y = (row - FIELD_ROWS * 0.5) * 0.12;
      const double r1 = sqrt((x + 2.0) * (x + 2.0) + y * y);
      const double r2 = sqrt((x - 2.0) * (x - 2.0) + y * y);
      p->field[row * FIELD_COLS + col] = sin(r1 * 3.0 - t) + sin(r2 * 3.0 - t);
    }
  }
}

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
  p->field_layer = PH_NULL_HANDLE;

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
   * squeezed into a small cell, which is what makes it worth colouring. It
   * travels; ph_panels_advance re-bakes it from the same function. */
  fill_field(p, 0.0);

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

  /* A ring plus chords: every node has two neighbours and some have a shortcut,
   * which is the shape a force layout actually has something to say about. */
  seed = 99887766u;
  for (int i = 0; i < NODES; i++) {
    p->graph_edges[i].a = i;
    p->graph_edges[i].b = (i + 1) % NODES;
  }
  for (int i = NODES; i < GRAPH_EDGES; i++) {
    seed = seed * 1664525u + 1013904223u;
    const int a = (int)((seed >> 8) % NODES);
    seed = seed * 1664525u + 1013904223u;
    const int b = (int)((seed >> 8) % NODES);
    p->graph_edges[i].a = a;
    p->graph_edges[i].b = b == a ? (a + NODES / 2) % NODES : b;
  }

  /* The indicators are ordinary arithmetic over the session closes, so they are
   * baked here with the rest of the data rather than recomputed per frame. */
  ph_fin_bollinger(p->bar_close, SESSIONS, BOLLINGER_PERIOD, 2.0, p->band_mid, p->band_up,
                   p->band_dn);

  /* A parabola with noise on it. The OLS line through a symmetric parabola is
   * flat, which is exactly what makes it worth drawing both fits: the straight
   * line says nothing and the local one says everything. */
  seed = 24681357u;
  for (int i = 0; i < FIT_POINTS; i++) {
    const double x = -3.0 + i * (6.0 / (FIT_POINTS - 1));
    seed = seed * 1664525u + 1013904223u;
    const double noise = ((double)(seed >> 8) / 16777216.0 - 0.5) * 2.4;
    p->fit_x[i] = x;
    p->fit_y[i] = 0.6 * x * x - 0.4 * x + 1.0 + noise;
  }
  int fit_grid = 0;
  ph_stat_loess(p->fit_x, p->fit_y, FIT_POINTS, 0.3, FIT_GRID, p->fit_grid_x, p->fit_grid_y,
                FIT_GRID, &fit_grid);
  ph_stat_linear_trend(p->fit_x, p->fit_y, FIT_POINTS, 2, 0.0, p->trend_x, p->trend_y, NULL, NULL);

  /* Two tones and broadband noise. Welch averages the noise down and leaves the
   * tones standing, which is the whole reason to prefer it to one long FFT. */
  seed = 31415926u;
  for (int i = 0; i < PSD_SAMPLES; i++) {
    const double t = i / PSD_RATE;
    seed = seed * 1664525u + 1013904223u;
    const double noise = ((double)(seed >> 8) / 16777216.0 - 0.5) * 0.8;
    p->psd_signal[i] = sin(2.0 * 3.14159265358979323846 * 24.0 * t) +
                       0.5 * sin(2.0 * 3.14159265358979323846 * 61.0 * t) + noise;
  }
  ph_stat_welch(p->psd_signal, PSD_SAMPLES, PSD_SEGMENT, 0.5, PH_WINDOW_HANN, PSD_RATE, p->psd_freq,
                p->psd_power, PSD_BINS, &p->psd_count);

  /* A classifier that is good but not perfect: the two classes' scores overlap
   * in the middle, which is what gives the curve its shape. */
  {
    double scores[ROC_SAMPLES];
    double labels[ROC_SAMPLES];
    seed = 55443322u;
    for (int i = 0; i < ROC_SAMPLES; i++) {
      const int positive = (i % 2) == 0;
      seed = seed * 1664525u + 1013904223u;
      const double u = (double)(seed >> 8) / 16777216.0;
      seed = seed * 1664525u + 1013904223u;
      const double v = (double)(seed >> 8) / 16777216.0;
      /* Box-Muller, so the two score distributions are Gaussian and overlap. */
      const double g = sqrt(-2.0 * log(u + 1e-12)) * cos(6.283185307179586 * v);
      labels[i] = positive ? 1.0 : 0.0;
      scores[i] = (positive ? 1.1 : -1.1) + g * 0.9;
    }
    ph_ml_roc_curve(scores, labels, ROC_SAMPLES, p->roc_fpr, p->roc_tpr, NULL, ROC_SAMPLES + 1,
                    &p->roc_count, &p->roc_auc);
    p->roc_chance[0] = 0.0;
    p->roc_chance[1] = 1.0;
  }

  /* Three Gaussian clusters in four dimensions, projected to two by PCA. The
   * projection is deterministic, so this panel is the same picture everywhere. */
  {
    static const double centres[3][EMBED_DIMS] = {
        {2.5, 0.0, -1.0, 0.5}, {-2.0, 2.0, 0.5, -1.0}, {0.0, -2.5, 2.0, 1.5}};
    static const ph_color class_color[3] = {0x60a5faffu, 0xf59e0bffu, 0x34d399ffu};
    seed = 77665544u;
    for (int i = 0; i < EMBED_POINTS; i++) {
      const int cluster = i % 3;
      for (int d = 0; d < EMBED_DIMS; d++) {
        seed = seed * 1664525u + 1013904223u;
        const double u = (double)(seed >> 8) / 16777216.0;
        seed = seed * 1664525u + 1013904223u;
        const double v = (double)(seed >> 8) / 16777216.0;
        const double g = sqrt(-2.0 * log(u + 1e-12)) * cos(6.283185307179586 * v);
        p->embed_raw[i * EMBED_DIMS + d] = centres[cluster][d] + g * 0.55;
      }
      p->embed_color[i] = class_color[cluster];
    }
    double scores[EMBED_POINTS * 2];
    ph_ml_pca(p->embed_raw, EMBED_POINTS, EMBED_DIMS, 2, scores, NULL, NULL, NULL);
    for (int i = 0; i < EMBED_POINTS; i++) {
      p->embed_x[i] = scores[i * 2];
      p->embed_y[i] = scores[i * 2 + 1];
    }
  }

  /* The composed charts. All of them are small fixed tables — the point of
   * these panels is the layout, not the data volume. */
  {
    static const char* products[TREEMAP_ITEMS] = {"Search", "Cloud",  "Ads",   "Devices",
                                                  "Media",  "Support", "Labs", "Other"};
    static const double share[TREEMAP_ITEMS] = {38, 24, 16, 9, 6, 4, 2, 1};
    for (int i = 0; i < TREEMAP_ITEMS; i++) {
      p->treemap[i].label = products[i];
      p->treemap[i].value = share[i];
    }

    /* A root, three regions, and their cities. Children follow their parent,
     * which is what the flattened hierarchy requires. */
    static const char* tree_names[TREE_NODES] = {
        "world", "EMEA", "APAC", "AMER", "London", "Berlin", "Paris",
        "Tokyo", "Seoul", "Sydney", "NYC",  "SF",    "Toronto"};
    static const int tree_parent[TREE_NODES] = {-1, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3};
    static const double tree_value[TREE_NODES] = {0, 0, 0, 0, 5, 4, 3, 6, 3, 2, 7, 5, 2};
    for (int i = 0; i < TREE_NODES; i++) {
      p->tree[i].name = tree_names[i];
      p->tree[i].parent = tree_parent[i];
      p->tree[i].value = tree_value[i];
    }

    static const char* flow_names[FLOW_NODES] = {"coal", "gas", "grid", "loss", "homes", "works"};
    static const ph_flow wiring[FLOW_LINKS] = {{0, 2, 30.0}, {1, 2, 45.0}, {2, 3, 18.0},
                                               {2, 4, 34.0}, {2, 5, 23.0}, {1, 5, 6.0}};
    for (int i = 0; i < FLOW_NODES; i++) p->flow_nodes[i].name = flow_names[i];
    for (int i = 0; i < FLOW_LINKS; i++) p->flow_links[i] = wiring[i];

    /* A trade matrix: rows export, columns import. The diagonal is zero, so a
     * group's arc is what it sends elsewhere. */
    static const double trade[CHORD_GROUPS * CHORD_GROUPS] = {
        0, 12, 7, 4, 9, 0, 11, 3, 5, 8, 0, 14, 6, 2, 10, 0};
    for (int i = 0; i < CHORD_GROUPS * CHORD_GROUPS; i++) p->chord[i] = trade[i];

    /* Two classes with different profiles across four measurements, so the
     * colouring separates the bundles rather than decorating them. */
    seed = 19283746u;
    for (int r = 0; r < PARALLEL_ROWS; r++) {
      const int cls = r % 2;
      p->parallel_class[r] = cls;
      for (int d = 0; d < PARALLEL_DIMS; d++) {
        seed = seed * 1664525u + 1013904223u;
        const double noise = ((double)(seed >> 8) / 16777216.0 - 0.5) * 0.6;
        const double base = cls ? 1.0 + d * 0.4 : 3.0 - d * 0.5;
        p->parallel[r * PARALLEL_DIMS + d] = base + noise;
      }
    }

    /* Three streams that add up to the Revenue panel's total, so the grouped
     * and stacked forms are the same data seen two ways. */
    static const char* stream_names[STREAMS] = {"licence", "services", "support"};
    static const ph_color stream_color[STREAMS] = {0x60a5faffu, 0xf59e0bffu, 0x34d399ffu};
    static const double weight[STREAMS] = {0.55, 0.3, 0.15};
    for (int s = 0; s < STREAMS; s++) {
      for (int m = 0; m < MONTHS; m++) {
        p->stream_series[s][m] = p->revenue[m] * weight[s];
      }
      p->streams[s].y = p->stream_series[s];
      p->streams[s].color = stream_color[s];
      p->streams[s].name = stream_names[s];
    }

    /* Two Gaussian modes, so the histogram has a shape worth binning. */
    seed = 44556677u;
    for (int i = 0; i < HIST_SAMPLES; i++) {
      seed = seed * 1664525u + 1013904223u;
      const double u = (double)(seed >> 8) / 16777216.0;
      seed = seed * 1664525u + 1013904223u;
      const double v = (double)(seed >> 8) / 16777216.0;
      const double g = sqrt(-2.0 * log(u + 1e-12)) * cos(6.283185307179586 * v);
      p->hist[i] = (i % 3 == 0 ? 6.0 : 2.0) + g * (i % 3 == 0 ? 0.8 : 1.2);
    }

    /* The funnel stages' own values, so the panel can colour them by value
     * through a colormap rather than by index through a palette. */
    for (int i = 0; i < FUNNEL_STAGES; i++) {
      p->funnel_value[i] = (double)(FUNNEL_STAGES - i);
    }

    /* r = |cos 2t|, which is a four-petal rose. The absolute value keeps the
     * radius positive, so the petals point outwards rather than folding back
     * through the origin. */
    for (int i = 0; i < ROSE_POINTS; i++) {
      const double deg = i;
      p->rose_theta[i] = deg;
      p->rose_r[i] = fabs(cos(2.0 * deg * 3.14159265358979323846 / 180.0));
    }
    for (int i = 0; i < ROSE_MARKS; i++) {
      p->mark_theta[i] = i * 30.0;
      p->mark_r[i] = 0.55 + 0.35 * sin(i * 0.9);
    }

    /* Two interfering ripples, the 3-D counterpart of the Field panel. */
    for (int r = 0; r < TERRAIN; r++) {
      for (int c = 0; c < TERRAIN; c++) {
        const double x = (c - TERRAIN * 0.5) * 0.22;
        const double z = (r - TERRAIN * 0.5) * 0.22;
        const double d1 = sqrt((x + 2.0) * (x + 2.0) + z * z);
        const double d2 = sqrt((x - 2.0) * (x - 2.0) + z * z);
        p->terrain[r * TERRAIN + c] = sin(d1 * 1.6) + sin(d2 * 1.6);
      }
    }

    /* A helix, and a Gaussian cloud around it coloured by height. */
    for (int i = 0; i < HELIX_POINTS; i++) {
      const double t = i * 0.06;
      p->helix_x[i] = cos(t) * 2.0;
      p->helix_y[i] = t * 0.25 - 3.0;
      p->helix_z[i] = sin(t) * 2.0;
    }
    seed = 86428642u;
    for (int i = 0; i < CLOUD_POINTS; i++) {
      seed = seed * 1664525u + 1013904223u;
      const double u = (double)(seed >> 8) / 16777216.0;
      seed = seed * 1664525u + 1013904223u;
      const double v = (double)(seed >> 8) / 16777216.0;
      const double g = sqrt(-2.0 * log(u + 1e-12));
      const double a = 6.283185307179586 * v;
      const double t = i * 0.02;
      p->cloud_x[i] = cos(t) * 2.0 + g * cos(a) * 0.45;
      p->cloud_y[i] = t * 0.25 - 3.0 + g * sin(a) * 0.45;
      p->cloud_z[i] = sin(t) * 2.0 + g * cos(a + 1.0) * 0.45;
      p->cloud_value[i] = p->cloud_y[i];
    }

    /* A dome of bars, so the heights vary in both directions at once. */
    for (int r = 0; r < BARS3D; r++) {
      for (int c = 0; c < BARS3D; c++) {
        const double x = (c - BARS3D * 0.5 + 0.5) / (BARS3D * 0.5);
        const double z = (r - BARS3D * 0.5 + 0.5) / (BARS3D * 0.5);
        p->bars3d[r * BARS3D + c] = 4.0 * exp(-(x * x + z * z) * 1.6) + 0.3;
      }
    }

    /* The same ripples the Terrain scene draws as a surface, at a resolution
     * the contour lines can follow. */
    for (int r = 0; r < ISOGRID; r++) {
      for (int c = 0; c < ISOGRID; c++) {
        const double x = (c - ISOGRID * 0.5) * 0.26;
        const double z = (r - ISOGRID * 0.5) * 0.26;
        p->iso_grid[r * ISOGRID + c] = sin(sqrt(x * x + z * z) * 1.4) * 2.0;
      }
    }

    /* Three metaballs: a density field, high inside, which is the convention
     * marching cubes' negated gradient shades correctly. */
    {
      static const double ball[3][4] = {
          {-0.35, 0.0, 0.0, 0.30}, {0.35, 0.15, 0.0, 0.26}, {0.0, -0.3, 0.25, 0.22}};
      for (int z = 0; z < VOXELS; z++) {
        for (int y = 0; y < VOXELS; y++) {
          for (int x = 0; x < VOXELS; x++) {
            const double px = (x / (double)(VOXELS - 1)) * 2.0 - 1.0;
            const double py = (y / (double)(VOXELS - 1)) * 2.0 - 1.0;
            const double pz = (z / (double)(VOXELS - 1)) * 2.0 - 1.0;
            double density = 0.0;
            for (int b = 0; b < 3; b++) {
              const double dx = px - ball[b][0];
              const double dy = py - ball[b][1];
              const double dz = pz - ball[b][2];
              const double r2 = dx * dx + dy * dy + dz * dz + 1e-6;
              density += ball[b][3] * ball[b][3] / r2;
            }
            p->voxels[x + y * VOXELS + z * VOXELS * VOXELS] = density;
          }
        }
      }
    }

    /* The bar dome again, as free-standing cuboids rather than a grid. */
    for (int r = 0; r < BARS3D; r++) {
      for (int c = 0; c < BARS3D; c++) {
        const int i = r * BARS3D + c;
        const double height = p->bars3d[i];
        p->city[i].x = (c - BARS3D * 0.5 + 0.5) * 0.5;
        p->city[i].z = (r - BARS3D * 0.5 + 0.5) * 0.5;
        p->city[i].y = height / 2.0;
        p->city[i].w = 0.32;
        p->city[i].h = height;
        p->city[i].d = 0.32;
        p->city[i].color = ((r + c) % 2) ? 0x38bdf8ffu : 0x818cf8ffu;
      }
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
  /* Two named series, so this is the panel with something to legend. Click an
   * entry to hide its series; the y axis re-fits to what is left. */
  ph_legend_config legend;
  ph_legend_config_init(&legend);
  legend.enabled = 1;
  legend.position = PH_LEGEND_BOTTOM_LEFT;
  ph_plot_set_legend(plot, &legend);
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
  /* A cloud has no "the point at this x", so an x-only pick would highlight
   * something the cursor is nowhere near. */
  ph_plot_set_pick_mode(plot, PH_PICK_XY);
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
  /* A choropleth: one value per patch through a ramp, which beats each patch's
   * own colour and earns the panel a colorbar. */
  desc.values = p->funnel_value;
  ph_colormap_spec ramp;
  ph_colormap_spec_init(&ramp);
  ramp.name = "cividis";
  desc.colormap = &ramp;
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

  ph_colormap_spec_init(&p->field_map);
  /* Diverging, because the field is signed and its zero means something —
   * paired with a domain centred on it, which is what symmetric_domain is for. */
  p->field_map.name = "RdBu";

  ph_heatmap_desc_init(&p->field_desc);
  p->field_desc.values = p->field;
  p->field_desc.cols = FIELD_COLS;
  p->field_desc.rows = FIELD_ROWS;
  p->field_desc.x.lo = -6.0;
  p->field_desc.x.hi = 6.0;
  p->field_desc.y.lo = -4.5;
  p->field_desc.y.hi = 4.5;
  p->field_desc.colormap = &p->field_map;
  /* A fixed domain, so the colours mean the same thing from frame to frame —
   * an auto-fit one would rescale as the waves move and hide the motion. */
  p->field_desc.domain.lo = -2.0;
  p->field_desc.domain.hi = 2.0;
  /* DYNAMIC, because ph_panels_advance re-bakes this every frame. */
  p->field_desc.render_type = PH_RENDER_DYNAMIC;
  ph_plot_add_heatmap(plot, &p->field_desc, &p->field_layer);
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

  /* Annotations are what a price chart is usually marked up with, so this is
   * where they belong: a value area, the level it is measured from, and a
   * trendline through the low. All in data space, so they pan and zoom. */
  ph_annotation_id id = 0;
  ph_annotation note;
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_BAND;
  note.dim = PH_DIM_Y;
  note.y0 = 96.0;
  note.y1 = 100.0;
  note.color = parse("#38bdf826");
  ph_plot_add_annotation(plot, &note, &id);

  static const float dash[2] = {5.0f, 4.0f};
  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_SPAN;
  note.dim = PH_DIM_Y;
  note.y0 = 100.0;
  note.color = parse("#94a3b8");
  note.dash = dash;
  note.dash_count = 2;
  ph_plot_add_annotation(plot, &note, &id);

  ph_annotation_init(&note);
  note.type = PH_ANNOTATION_LINE;
  note.x0 = 12.0;
  note.y0 = 91.0;
  note.x1 = 33.0;
  note.y1 = 103.0;
  note.width = 1.5f;
  note.color = parse("#a3e635");
  ph_plot_add_annotation(plot, &note, &id);
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

/* Panel 16 — the Field panel's scalar field again, as iso-lines. */
static void build_contour(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Contour");
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  ph_colormap_spec cmap;
  ph_colormap_spec_init(&cmap);
  cmap.name = "turbo";

  ph_contour_desc iso;
  ph_contour_desc_init(&iso);
  iso.values = p->field;
  iso.cols = FIELD_COLS;
  iso.rows = FIELD_ROWS;
  iso.x.lo = -6.0;
  iso.x.hi = 6.0;
  iso.y.lo = -4.5;
  iso.y.hi = 4.5;
  iso.level_count = ISO_LEVELS;
  /* color left at PH_COLOR_AUTO, so each level takes its own colour and the
   * lines can be read without a key beside them. */
  iso.colormap = &cmap;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_contour(plot, &iso, &layer);
}

/* Panel 17 — a graph with no positions, laid out by the core. */
static void build_network(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Network");
  /* A force layout's axes are arbitrary units, so the numbers on them mean
   * nothing; the grid would only be decoration. */
  ph_axis_config bare;
  ph_axis_config_init(&bare);
  bare.no_ticks = 1;
  bare.no_grid = 1;
  ph_plot_set_axis_config(plot, "x", &bare);
  ph_plot_set_axis_config(plot, "y", &bare);

  ph_graph_desc graph;
  ph_graph_desc_init(&graph);
  /* No x or y: the layer lays it out, deterministically, so this panel is the
   * same picture in every host and on every run. */
  graph.node_count = NODES;
  graph.edges = p->graph_edges;
  graph.edge_count = GRAPH_EDGES;
  graph.node_size = 9.0f;
  graph.node_color = parse("#f472b6");
  graph.edge_color = parse("#94a3b866");
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_graph(plot, &graph, &layer);
}

/* Panel 18 — the same sessions with Bollinger Bands over them.
 *
 * The indicator is not a layer and not a chart type: `ph_fin_bollinger` turns
 * one array into three, and three ordinary line layers draw them. That is the
 * whole argument for keeping the analysis half pure — nothing here knows it is
 * being plotted. */
static void build_signals(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Signals");
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

  static const float dash[2] = {4.0f, 3.0f};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->session_index;
  line.count = SESSIONS;
  line.width = 1.25f;

  line.y = p->band_mid;
  line.name = "SMA 10";
  line.color = parse("#facc15");
  ph_plot_add_line(plot, &line, &layer);

  /* The two edges share a colour and a dash: they are one band, drawn twice. */
  line.color = parse("#38bdf8");
  line.dash = dash;
  line.dash_count = 2;
  line.y = p->band_up;
  line.name = "+2 sigma";
  ph_plot_add_line(plot, &line, &layer);
  line.y = p->band_dn;
  line.name = "-2 sigma";
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 19 — a noisy parabola under two fits.
 *
 * The straight line is what ordinary least squares has to say about a symmetric
 * parabola, which is nothing: its slope is zero by construction. LOESS, fitting
 * locally, recovers the curve. Drawing both is the point. */
static void build_fit(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Fit");
  ph_plot_set_pick_mode(plot, PH_PICK_XY);
  style_axis(plot, "x", "x", 0);
  style_axis(plot, "y", "y", 0);

  ph_layer layer = PH_NULL_HANDLE;
  ph_scatter_desc points;
  ph_scatter_desc_init(&points);
  points.x = p->fit_x;
  points.y = p->fit_y;
  points.count = FIT_POINTS;
  points.size = 4.0f;
  points.color = parse("#64748b");
  points.marker = PH_MARKER_CIRCLE;
  ph_plot_add_scatter(plot, &points, &layer);

  static const float dash[2] = {6.0f, 4.0f};
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->trend_x;
  line.y = p->trend_y;
  line.count = 2;
  line.width = 1.5f;
  line.color = parse("#f87171");
  line.dash = dash;
  line.dash_count = 2;
  line.name = "least squares";
  ph_plot_add_line(plot, &line, &layer);

  ph_line_desc_init(&line);
  line.x = p->fit_grid_x;
  line.y = p->fit_grid_y;
  line.count = FIT_GRID;
  line.width = 2.5f;
  line.color = parse("#22d3ee");
  line.name = "loess";
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 20 — a power spectral density on a log axis.
 *
 * Two tones buried in broadband noise. Welch averages eight overlapping
 * segments, which pushes the noise floor down and leaves the tones standing —
 * the reason to prefer it to one long FFT, and visible here as two spikes. */
static void build_spectrum(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Spectrum");
  style_axis(plot, "x", "frequency (Hz)", 0);
  style_axis(plot, "y", "power", 0);

  /* Power spans four decades, so a linear axis would show one spike and a flat
   * line where the noise floor is. */
  ph_axis_desc axis;
  ph_axis_desc_init(&axis);
  axis.type = PH_SCALE_LOG;
  ph_plot_set_scale(plot, "y", &axis);

  ph_layer layer = PH_NULL_HANDLE;
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->psd_freq;
  line.y = p->psd_power;
  line.count = p->psd_count;
  line.width = 1.5f;
  line.color = parse("#a3e635");
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 21 — a ROC curve with the chance diagonal behind it. */
static void build_roc(ph_panels* p, ph_plot plot) {
  /* The AUC goes in the title because a ROC curve without it is half a chart.
   * Formatted from integers rather than with %f: Qt calls setlocale, and a
   * locale with a comma decimal separator would print "ROC 0,93". */
  char title[32];
  const int hundredths = (int)(p->roc_auc * 100.0 + 0.5);
  snprintf(title, sizeof title, "ROC %d.%02d", hundredths / 100, hundredths % 100);
  ph_plot_set_title(plot, title);
  style_axis(plot, "x", "false positive rate", 0);
  style_axis(plot, "y", "true positive rate", 0);

  static const float dash[2] = {5.0f, 5.0f};
  ph_layer layer = PH_NULL_HANDLE;
  ph_line_desc line;
  ph_line_desc_init(&line);
  line.x = p->roc_chance;
  line.y = p->roc_chance;
  line.count = 2;
  line.width = 1.0f;
  line.color = parse("#64748b");
  line.dash = dash;
  line.dash_count = 2;
  line.name = "chance";
  ph_plot_add_line(plot, &line, &layer);

  ph_line_desc_init(&line);
  line.x = p->roc_fpr;
  line.y = p->roc_tpr;
  line.count = p->roc_count;
  line.width = 2.0f;
  line.color = parse("#f472b6");
  line.name = "model";
  ph_plot_add_line(plot, &line, &layer);
}

/* Panel 22 — three four-dimensional clusters projected to two by PCA.
 *
 * The colours are the true classes, which the projection never saw: the
 * clusters separating is the projection's doing, not the palette's. */
static void build_embedding(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Embedding");
  ph_plot_set_pick_mode(plot, PH_PICK_XY);
  style_axis(plot, "x", "PC 1", 0);
  style_axis(plot, "y", "PC 2", 0);

  ph_layer layer = PH_NULL_HANDLE;
  ph_scatter_desc points;
  ph_scatter_desc_init(&points);
  points.x = p->embed_x;
  points.y = p->embed_y;
  points.count = EMBED_POINTS;
  points.size = 5.0f;
  points.colors = p->embed_color;
  points.marker = PH_MARKER_CIRCLE;
  ph_plot_add_scatter(plot, &points, &layer);
}

/* A plot whose axes carry no meaning: the composed charts are pictures in an
 * arbitrary coordinate system, and a grid behind one is decoration. */
static void bare_axes(ph_plot plot) {
  ph_axis_config bare;
  ph_axis_config_init(&bare);
  bare.no_ticks = 1;
  bare.no_grid = 1;
  ph_plot_set_axis_config(plot, "x", &bare);
  ph_plot_set_axis_config(plot, "y", &bare);
}

/* Panel 23 — a squarified treemap of eight products. */
static void build_treemap(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Treemap");
  bare_axes(plot);

  ph_treemap_desc desc;
  ph_treemap_desc_init(&desc);
  desc.items = p->treemap;
  desc.item_count = TREEMAP_ITEMS;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_treemap(plot, &desc, &layer);
}

/* Panel 24 — the same kind of data as a hierarchy, drawn radially. */
static void build_sunburst(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Sunburst");
  bare_axes(plot);
  /* The rings are circles only if one data unit is the same length on both
   * axes, which is the whole job of the equal-aspect lock. */
  ph_plot_set_equal_aspect(plot, 1);

  ph_sunburst_desc desc;
  ph_sunburst_desc_init(&desc);
  desc.nodes = p->tree;
  desc.node_count = TREE_NODES;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_sunburst(plot, &desc, &layer);
}

/* Panel 25 — where the energy goes. */
static void build_sankey(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Sankey");
  bare_axes(plot);

  ph_sankey_desc desc;
  ph_sankey_desc_init(&desc);
  desc.nodes = p->flow_nodes;
  desc.node_count = FLOW_NODES;
  desc.links = p->flow_links;
  desc.link_count = FLOW_LINKS;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_sankey(plot, &desc, &layer);
}

/* Panel 26 — a trade matrix as a chord diagram. */
static void build_chord(ph_panels* p, ph_plot plot) {
  static const char* regions[CHORD_GROUPS] = {"EU", "US", "CN", "JP"};
  ph_plot_set_title(plot, "Chord");
  bare_axes(plot);
  ph_plot_set_equal_aspect(plot, 1);

  ph_chord_desc desc;
  ph_chord_desc_init(&desc);
  desc.matrix = p->chord;
  desc.count = CHORD_GROUPS;
  desc.labels = regions;
  desc.label_count = CHORD_GROUPS;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_chord(plot, &desc, &layer);
}

/* Panel 27 — a gauge with two threshold bands. */
static void build_gauge(ph_panels* p, ph_plot plot) {
  static const ph_gauge_threshold bands[2] = {{50.0, 0xf59e0bffu}, {80.0, 0xef4444ffu}};
  (void)p;
  ph_plot_set_title(plot, "Gauge");
  bare_axes(plot);
  ph_plot_set_equal_aspect(plot, 1);

  ph_gauge_desc desc;
  ph_gauge_desc_init(&desc);
  desc.value = 62.0;
  desc.thresholds = bands;
  desc.threshold_count = 2;
  desc.track_color = 0x33415566u;
  desc.needle_color = 0xe2e8f0ffu;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_gauge(plot, &desc, &layer);
}

/* Panel 28 — parallel coordinates over two classes.
 *
 * The one builder that returns several layers, because a row is a line and a
 * line is a layer: forty rows, forty handles. */
static void build_parallel(ph_panels* p, ph_plot plot) {
  static const char* dims[PARALLEL_DIMS] = {"sepal", "petal", "weight", "score"};
  ph_plot_set_title(plot, "Parallel");
  ph_axis_config bare;
  ph_axis_config_init(&bare);
  bare.no_ticks = 1;
  bare.no_grid = 1;
  ph_plot_set_axis_config(plot, "x", &bare);
  style_axis(plot, "y", "normalised", 0);

  ph_parallel_desc desc;
  ph_parallel_desc_init(&desc);
  desc.dimensions = dims;
  desc.dim_count = PARALLEL_DIMS;
  desc.rows = p->parallel;
  desc.row_count = PARALLEL_ROWS;
  desc.color_by = p->parallel_class;
  desc.width = 1.5f;
  int written = 0;
  ph_plot_add_parallel(plot, &desc, p->parallel_layers, PARALLEL_ROWS, &written);
}

/* Panel 29 — the same three streams as clusters. */
static void build_grouped(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Grouped");
  style_axis(plot, "x", "month", 0);
  style_axis(plot, "y", "revenue", 0);

  ph_grouped_bar_desc desc;
  ph_grouped_bar_desc_init(&desc);
  desc.x = p->month;
  desc.count = MONTHS;
  desc.series = p->streams;
  desc.series_count = STREAMS;
  int written = 0;
  ph_plot_add_grouped_bars(plot, &desc, p->stream_layers, STREAMS, &written);
}

/* Panel 30 — and stacked, which is the same numbers reading as a total. */
static void build_stacked(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Stacked");
  style_axis(plot, "x", "month", 0);
  style_axis(plot, "y", "revenue", 0);
  ph_legend_config legend;
  ph_legend_config_init(&legend);
  /* `enabled` is the one field that is off by default — an omitted legend in
   * the TypeScript means no legend, not a legend in the default corner. */
  legend.enabled = 1;
  legend.position = PH_LEGEND_TOP_LEFT;
  ph_plot_set_legend(plot, &legend);

  ph_stacked_desc desc;
  ph_stacked_desc_init(&desc);
  desc.x = p->month;
  desc.count = MONTHS;
  desc.series = p->streams;
  desc.series_count = STREAMS;
  int written = 0;
  ph_plot_add_stacked_area(plot, &desc, p->stream_layers, STREAMS, &written);
}

/* Panel 31 — a bimodal sample binned into bars. */
static void build_histogram(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Histogram");
  style_axis(plot, "x", "value", 0);
  style_axis(plot, "y", "count", 0);

  ph_histogram_desc desc;
  ph_histogram_desc_init(&desc);
  desc.values = p->hist;
  desc.count = HIST_SAMPLES;
  desc.bins = 40;
  desc.color = parse("#38bdf8");
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_histogram(plot, &desc, &layer);
}

/* Panel 32 — the Spectrum panel's signal as a time-frequency image.
 *
 * The same two tones, seen the other way round: the PSD says what frequencies
 * are there, the spectrogram says when. */
static void build_spectrogram(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Spectrogram");
  style_axis(plot, "x", "time (s)", 0);
  style_axis(plot, "y", "frequency (Hz)", 0);

  ph_spectrogram_desc desc;
  ph_spectrogram_desc_init(&desc);
  desc.signal = p->psd_signal;
  desc.count = PSD_SAMPLES;
  desc.fft_size = 128;
  desc.sample_rate = PSD_RATE;
  desc.name = "dB";
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot_add_spectrogram(plot, &desc, &layer);
}

/* Panel 33 — a polar plot, which is a mode rather than a type.
 *
 * The same plot handle, the same render, the same events: what differs is that
 * the grid is rings and spokes, the two axes share a square domain, and
 * (theta, r) is projected on the way in. */
static void build_polar(ph_panels* p, ph_plot plot) {
  ph_plot_set_title(plot, "Polar");

  ph_polar_config polar;
  ph_polar_config_init(&polar);
  polar.enabled = 1;
  polar.degrees = 1;
  ph_plot_set_polar(plot, &polar);

  ph_layer layer = PH_NULL_HANDLE;
  ph_polar_line_desc rose;
  ph_polar_line_desc_init(&rose);
  rose.theta = p->rose_theta;
  rose.r = p->rose_r;
  rose.count = ROSE_POINTS;
  rose.color = parse("#22d3ee");
  rose.width = 2.0f;
  rose.closed = 1;
  ph_plot_add_polar_line(plot, &rose, &layer);

  ph_polar_scatter_desc marks;
  ph_polar_scatter_desc_init(&marks);
  marks.theta = p->mark_theta;
  marks.r = p->mark_r;
  marks.count = ROSE_MARKS;
  marks.color = parse("#f472b6");
  marks.size = 7.0f;
  marks.marker = PH_MARKER_CIRCLE;
  ph_plot_add_polar_scatter(plot, &marks, &layer);
}

static const char* kTitles3D[PH_PANEL_3D_COUNT] = {"Terrain", "Helix",  "Towers",
                                                   "Isolines", "Blobs", "City"};

const char* ph_panels_title_3d(int index) {
  return kTitles3D[((index % PH_PANEL_3D_COUNT) + PH_PANEL_3D_COUNT) % PH_PANEL_3D_COUNT];
}

/* 3-D scene 0 — two interfering ripples as a lit surface. */
static void build_terrain(ph_panels* p, ph_plot3d plot) {
  ph_plot3d_set_title(plot, "Terrain");
  ph_plot3d_set_axis_labels(plot, "x", "height", "z");

  ph_colormap_spec ramp;
  ph_colormap_spec_init(&ramp);
  ramp.name = "viridis";

  ph_surface_desc surface;
  ph_surface_desc_init(&surface);
  surface.values = p->terrain;
  surface.cols = TERRAIN;
  surface.rows = TERRAIN;
  surface.x.lo = -5.0;
  surface.x.hi = 5.0;
  surface.z.lo = -5.0;
  surface.z.hi = 5.0;
  surface.colormap = &ramp;
  surface.name = "height";
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot3d_add_surface(plot, &surface, &layer);
}

/* 3-D scene 1 — a helix through a cloud of the points it was drawn from. */
static void build_helix(ph_panels* p, ph_plot3d plot) {
  ph_plot3d_set_title(plot, "Helix");
  ph_plot3d_set_axis_labels(plot, "x", "t", "z");

  ph_colormap_spec ramp;
  ph_colormap_spec_init(&ramp);
  ramp.name = "plasma";

  ph_layer layer = PH_NULL_HANDLE;
  ph_pointcloud_desc cloud;
  ph_pointcloud_desc_init(&cloud);
  cloud.x = p->cloud_x;
  cloud.y = p->cloud_y;
  cloud.z = p->cloud_z;
  cloud.count = CLOUD_POINTS;
  cloud.size = 3.0f;
  cloud.values = p->cloud_value;
  cloud.colormap = &ramp;
  cloud.name = "t";
  ph_plot3d_add_pointcloud(plot, &cloud, &layer);

  ph_line3d_desc line;
  ph_line3d_desc_init(&line);
  line.x = p->helix_x;
  line.y = p->helix_y;
  line.z = p->helix_z;
  line.count = HELIX_POINTS;
  line.color = parse("#e2e8f0");
  line.name = "path";
  ph_plot3d_add_line(plot, &line, &layer);
}

/* 3-D scene 2 — a dome of lit bars, and the arrows of its own gradient. */
static void build_towers(ph_panels* p, ph_plot3d plot) {
  ph_plot3d_set_title(plot, "Towers");
  ph_plot3d_set_axis_labels(plot, "x", "value", "z");
  ph_plot3d_set_camera(plot, 0.9, 0.6, 3.4);

  ph_colormap_spec ramp;
  ph_colormap_spec_init(&ramp);
  ramp.name = "turbo";

  ph_bar3d_desc bars;
  ph_bar3d_desc_init(&bars);
  bars.values = p->bars3d;
  bars.cols = BARS3D;
  bars.rows = BARS3D;
  bars.x.lo = -3.0;
  bars.x.hi = 3.0;
  bars.z.lo = -3.0;
  bars.z.hi = 3.0;
  bars.fill = 0.7;
  bars.colormap = &ramp;
  bars.name = "value";
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot3d_add_bars(plot, &bars, &layer);
}

/* 3-D scene 3 — the same ripples as stacked iso-height lines. */
static void build_isolines(ph_panels* p, ph_plot3d plot) {
  ph_plot3d_set_title(plot, "Isolines");
  ph_plot3d_set_axis_labels(plot, "x", "height", "z");

  ph_colormap_spec ramp;
  ph_colormap_spec_init(&ramp);
  ramp.name = "turbo";

  ph_contour3d_desc iso;
  ph_contour3d_desc_init(&iso);
  iso.values = p->iso_grid;
  iso.cols = ISOGRID;
  iso.rows = ISOGRID;
  iso.x.lo = -5.0;
  iso.x.hi = 5.0;
  iso.z.lo = -5.0;
  iso.z.hi = 5.0;
  iso.levels = 14;
  iso.colormap = &ramp;
  iso.name = "height";
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot3d_add_contour(plot, &iso, &layer);
}

/* 3-D scene 4 — three metaballs as one isosurface, over a bed of cuboids.
 *
 * The density field is high inside, which is the convention the marching-cubes
 * normal is right for; a distance field would light the surface from behind. */
static void build_blobs(ph_panels* p, ph_plot3d plot) {
  ph_plot3d_set_title(plot, "Blobs");
  ph_plot3d_set_axis_labels(plot, "x", "y", "z");
  ph_plot3d_set_camera(plot, 0.8, 0.35, 3.2);

  ph_layer layer = PH_NULL_HANDLE;
  ph_isosurface_desc iso;
  ph_isosurface_desc_init(&iso);
  iso.values = p->voxels;
  iso.nx = VOXELS;
  iso.ny = VOXELS;
  iso.nz = VOXELS;
  iso.x.lo = -1.0;
  iso.x.hi = 1.0;
  iso.y.lo = -1.0;
  iso.y.hi = 1.0;
  iso.z.lo = -1.0;
  iso.z.hi = 1.0;
  iso.level = 1.6;
  iso.color = parse("#f472b6");
  iso.name = "surface";
  ph_plot3d_add_isosurface(plot, &iso, &layer);
}

/* 3-D scene 5 — the Towers data again, as free-standing cuboids.
 *
 * Same numbers, different layer: bar3d builds a grid of boxes from a height
 * field, boxes3d takes the boxes themselves. Side by side they show which one a
 * caller wants — a lattice, or an arbitrary set of solids. */
static void build_city(ph_panels* p, ph_plot3d plot) {
  ph_plot3d_set_title(plot, "City");
  ph_plot3d_set_axis_labels(plot, "x", "height", "z");
  ph_plot3d_set_camera(plot, 0.6, 0.35, 3.2);

  ph_boxes3d_desc boxes;
  ph_boxes3d_desc_init(&boxes);
  boxes.boxes = p->city;
  boxes.count = BARS3D * BARS3D;
  ph_layer layer = PH_NULL_HANDLE;
  ph_plot3d_add_boxes(plot, &boxes, &layer);
}

void ph_panels_build_3d(ph_panels* panels, ph_plot3d plot, int index) {
  if (!panels) return;
  const int which = ((index % PH_PANEL_3D_COUNT) + PH_PANEL_3D_COUNT) % PH_PANEL_3D_COUNT;
  switch (which) {
    case 0: build_terrain(panels, plot); break;
    case 1: build_helix(panels, plot); break;
    case 2: build_towers(panels, plot); break;
    case 3: build_isolines(panels, plot); break;
    case 4: build_blobs(panels, plot); break;
    default: build_city(panels, plot); break;
  }
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
    case 15: build_flow(panels, plot); break;
    case 16: build_contour(panels, plot); break;
    case 17: build_network(panels, plot); break;
    case 18: build_signals(panels, plot); break;
    case 19: build_fit(panels, plot); break;
    case 20: build_spectrum(panels, plot); break;
    case 21: build_roc(panels, plot); break;
    case 22: build_embedding(panels, plot); break;
    case 23: build_treemap(panels, plot); break;
    case 24: build_sunburst(panels, plot); break;
    case 25: build_sankey(panels, plot); break;
    case 26: build_chord(panels, plot); break;
    case 27: build_gauge(panels, plot); break;
    case 28: build_parallel(panels, plot); break;
    case 29: build_grouped(panels, plot); break;
    case 30: build_stacked(panels, plot); break;
    case 31: build_histogram(panels, plot); break;
    case 32: build_spectrogram(panels, plot); break;
    default: build_polar(panels, plot); break;
  }
}

void ph_panels_advance(ph_panels* panels, double seconds) {
  if (!panels) return;
  if (panels->field_layer != PH_NULL_HANDLE) {
    /* Two circular waves travelling outwards — the case a heatmap setter is
     * for, and the reason the layer keeps its texture instead of being
     * destroyed and re-added sixty times a second. */
    fill_field(panels, seconds * 2.0);
    ph_layer_set_heatmap(panels->field_layer, &panels->field_desc);
  }
  if (panels->stream_layer == PH_NULL_HANDLE) return;
  for (int i = 0; i < STREAM_POINTS; i++) {
    const double phase = seconds * 2.0 + i * 0.035;
    panels->stream_y[i] =
        sin(phase) + 0.4 * sin(phase * 3.1 + 1.0) + 0.15 * sin(phase * 7.7);
  }
  ph_layer_set_xy(panels->stream_layer, panels->stream_x, panels->stream_y, STREAM_POINTS);
}
