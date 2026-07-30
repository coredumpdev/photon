/*
 * photon.h — the stable C ABI for Photon native.
 *
 * This header is the ONLY contract between the C++ engine and its hosts
 * (GLFW, Qt/QML, C#, Java). Everything a binding can see lives here.
 *
 * Rules this header obeys, and why:
 *
 *  - Pure C99. No C++ types, no exceptions, no inline templates crossing the
 *    boundary. Compiles clean as C and as C++.
 *  - Fixed-width scalars only (int32_t/int64_t/uint32_t/double/float). Never
 *    `int`, `long`, `size_t` or `bool` — their widths differ across the
 *    platforms and languages we bind to.
 *  - Every enum is `int32_t` via a typedef + anonymous enum, so the wire width
 *    is pinned regardless of how a compiler sizes enums.
 *  - Handles are 64-bit generation-tagged integers, not pointers. A stale or
 *    double-freed handle returns PH_E_INVALID_HANDLE instead of corrupting
 *    memory — which matters because two of our target hosts (Java, C#) free
 *    from a GC finalizer thread and will get this wrong eventually.
 *  - Descriptor structs start with `struct_size` so fields can be appended
 *    without breaking already-compiled bindings.
 *  - Zero means "default" for every optional field, so a zero-initialized
 *    struct is always valid. `ph_*_desc_init` fills the same defaults
 *    explicitly for hosts that prefer it.
 *  - Events are polled, not delivered by callback. Reverse-calling into a
 *    managed runtime (JNI upcalls, pinned C# delegates) is the single most
 *    fragile thing an FFI can do; a queue costs one function call per frame
 *    and works identically in all four hosts.
 *
 * Threading: a plot belongs to the thread that created it, and that thread
 * must have the GL context current for every ph_plot_render call. The library
 * is not internally threaded. Qt renders on its own render thread — create the
 * plot there too.
 */

#ifndef PHOTON_H
#define PHOTON_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------ */
/* Linkage                                                                    */
/* ------------------------------------------------------------------------ */

/*
 * Calling convention is pinned to cdecl. On 64-bit Windows there is only one
 * convention anyway, but 32-bit C# P/Invoke defaults to StdCall — bindings must
 * say Cdecl explicitly, so we make the C side unambiguous.
 */
#if defined(_WIN32)
#  define PH_CALL __cdecl
#  if defined(PHOTON_BUILD_SHARED)
#    define PH_API __declspec(dllexport)
#  elif defined(PHOTON_USE_SHARED)
#    define PH_API __declspec(dllimport)
#  else
#    define PH_API
#  endif
#else
#  define PH_CALL
#  if defined(PHOTON_BUILD_SHARED)
#    define PH_API __attribute__((visibility("default")))
#  else
#    define PH_API
#  endif
#endif

/* ------------------------------------------------------------------------ */
/* Versioning                                                                 */
/* ------------------------------------------------------------------------ */

/*
 * Bumped only on a breaking change to this header. `ph_init` rejects a caller
 * compiled against a different major ABI, which turns a silent struct-layout
 * mismatch into a clean error at startup.
 */
#define PHOTON_ABI_VERSION 1u

/* ------------------------------------------------------------------------ */
/* Scalars                                                                    */
/* ------------------------------------------------------------------------ */

/** 0 = false, non-zero = true. Never use C `bool` across the boundary. */
typedef int32_t ph_bool;

/** Opaque generation-tagged handles. 0 is always invalid. */
typedef uint64_t ph_plot;
typedef uint64_t ph_layer;
/** A parsed CSV. Owns its strings, and belongs to no plot. */
typedef uint64_t ph_table;

#define PH_NULL_HANDLE ((uint64_t)0)

/**
 * Packed RGBA, one byte per channel, red in the most significant byte:
 * 0xRRGGBBAA. Bindings can compute this without calling us.
 *
 * PH_COLOR_AUTO (0 — transparent black) means "let the theme or palette
 * decide". Fully transparent black is never a useful explicit color, so it is
 * free to spend as the sentinel.
 */
typedef uint32_t ph_color;

#define PH_COLOR_AUTO ((uint32_t)0)

/** Inclusive data-space interval. */
typedef struct ph_range {
  double lo;
  double hi;
} ph_range;

/* ------------------------------------------------------------------------ */
/* Result codes                                                               */
/* ------------------------------------------------------------------------ */

typedef int32_t ph_result;
enum {
  PH_OK                 = 0,
  PH_E_INVALID_HANDLE   = -1,  /* handle is stale, freed, or never existed */
  PH_E_INVALID_ARGUMENT = -2,
  PH_E_OUT_OF_MEMORY    = -3,
  PH_E_UNSUPPORTED      = -4,  /* valid request, not implemented in this build */
  PH_E_NOT_INITIALIZED  = -5,  /* ph_init was not called on this thread's process */
  PH_E_ABI_MISMATCH     = -6,
  PH_E_GL               = -7,  /* the GL context rejected something */
  PH_E_WRONG_THREAD     = -8,  /* plot touched from a thread that does not own it */
  PH_E_INTERNAL         = -9
};

/* ------------------------------------------------------------------------ */
/* Enums (mirroring @photonviz/core)                                          */
/* ------------------------------------------------------------------------ */

/** Mirrors core `ScaleType`. */
typedef int32_t ph_scale_type;
enum {
  PH_SCALE_LINEAR       = 0,
  PH_SCALE_LOG          = 1,
  PH_SCALE_TIME         = 2,
  PH_SCALE_CATEGORICAL  = 3,
  PH_SCALE_ORDINAL_TIME = 4
};

/** Mirrors core `InteractionMode`. */
typedef int32_t ph_mode;
enum {
  PH_MODE_PAN   = 0,
  PH_MODE_BOX   = 1,
  PH_MODE_BOX_X = 2,
  PH_MODE_BOX_Y = 3
};

/** Mirrors core `RenderType` — the GL buffer-usage hint. */
typedef int32_t ph_render_type;
enum {
  PH_RENDER_STATIC  = 0,
  PH_RENDER_DYNAMIC = 1
};

/** Mirrors core `LineJoin`. */
typedef int32_t ph_line_join;
enum {
  PH_JOIN_ROUND = 0,
  PH_JOIN_MITER = 1,
  PH_JOIN_BEVEL = 2,
  PH_JOIN_BUTT  = 3
};

/** Mirrors core `LineOptions.step`. */
typedef int32_t ph_step;
enum {
  PH_STEP_NONE   = 0,
  PH_STEP_BEFORE = 1,
  PH_STEP_AFTER  = 2,
  PH_STEP_CENTER = 3
};

/** Mirrors core `MarkerShape`. */
typedef int32_t ph_marker;
enum {
  PH_MARKER_CIRCLE   = 0,
  PH_MARKER_SQUARE   = 1,
  PH_MARKER_TRIANGLE = 2,
  PH_MARKER_DIAMOND  = 3,
  PH_MARKER_CROSS    = 4,
  PH_MARKER_PLUS     = 5
};

/** Mirrors core `PickMode` — how hover chooses the highlighted point. */
typedef int32_t ph_pick_mode;
enum {
  /** Nearest by horizontal distance — the classic crosshair-along-x. */
  PH_PICK_X  = 0,
  /** Nearest by vertical distance. */
  PH_PICK_Y  = 1,
  /** Nearest by true 2-D distance; right for point clouds. */
  PH_PICK_XY = 2
};

/** Which corner of the plot region the legend sits in. */
typedef int32_t ph_legend_position;
enum {
  PH_LEGEND_TOP_RIGHT    = 0,
  PH_LEGEND_TOP_LEFT     = 1,
  PH_LEGEND_BOTTOM_LEFT  = 2,
  PH_LEGEND_BOTTOM_RIGHT = 3
};

/** Horizontal text anchor, mirroring Canvas2D's textAlign. */
typedef int32_t ph_text_align;
enum {
  PH_ALIGN_LEFT   = 0,
  PH_ALIGN_CENTER = 1,
  PH_ALIGN_RIGHT  = 2
};

/** Vertical text anchor, mirroring Canvas2D's textBaseline. */
typedef int32_t ph_text_baseline;
enum {
  PH_BASELINE_ALPHABETIC = 0,
  PH_BASELINE_TOP        = 1,
  PH_BASELINE_MIDDLE     = 2,
  PH_BASELINE_BOTTOM     = 3
};

/** Which axis a value lies on. Mirrors core `Dim`. */
typedef int32_t ph_dim;
enum {
  PH_DIM_X = 0,
  PH_DIM_Y = 1
};

/** Mirrors core `Annotation["type"]`. */
typedef int32_t ph_annotation_type;
enum {
  /** A full-width or full-height guide at one value. */
  PH_ANNOTATION_SPAN  = 0,
  /** A shaded range between two values on one axis. */
  PH_ANNOTATION_BAND  = 1,
  /** A rectangle in data space, optionally filled, bordered and captioned. */
  PH_ANNOTATION_BOX   = 2,
  /** Text at a data-space point. */
  PH_ANNOTATION_LABEL = 3,
  /** A segment between two data-space points. */
  PH_ANNOTATION_LINE  = 4,
  /** The same, extended past its second point to the region's edge. */
  PH_ANNOTATION_RAY   = 5,
  /** Fibonacci retracement levels between `high` and `low` across x0..x1. */
  PH_ANNOTATION_FIB   = 6
};

typedef int32_t ph_theme;
enum {
  PH_THEME_DARK  = 0,
  PH_THEME_LIGHT = 1
};

/* ------------------------------------------------------------------------ */
/* Host interface                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Which GL flavour the host's context provides. The shaders are authored once
 * against GLSL ES 3.00 and emitted as 3.30 core when the host is desktop GL.
 */
typedef int32_t ph_gfx_api;
enum {
  PH_GFX_GL33   = 0,  /* desktop OpenGL 3.3 core (GLFW, Qt desktop, WGL, NSGL) */
  PH_GFX_GLES30 = 1   /* OpenGL ES 3.0 / ANGLE (mobile, WinUI, Qt-on-ANGLE)    */
};

/** GL entry-point resolver. GLFW: glfwGetProcAddress. Qt: QOpenGLContext::getProcAddress. */
typedef void* (PH_CALL* ph_proc_address_fn)(const char* name, void* user);

typedef int32_t ph_log_level;
enum {
  PH_LOG_ERROR = 0,
  PH_LOG_WARN  = 1,
  PH_LOG_INFO  = 2,
  PH_LOG_DEBUG = 3
};

/** Optional diagnostics sink. Called on the calling thread, never re-entrantly. */
typedef void (PH_CALL* ph_log_fn)(ph_log_level level, const char* message, void* user);

/**
 * What the host promises the library. Passed once to ph_init.
 *
 * `get_proc_address` may be NULL in a headless build (no rendering, layout and
 * interaction math only) — which is exactly how the test suite runs.
 */
typedef struct ph_host_desc {
  uint32_t           struct_size;
  ph_gfx_api         api;
  ph_proc_address_fn get_proc_address;
  void*              get_proc_address_user;
  ph_log_fn          log;
  void*              log_user;
} ph_host_desc;

/**
 * Where a single frame goes. The host makes its GL context current, then hands
 * over a framebuffer and a viewport rectangle in device pixels.
 *
 * This one struct is the whole reason the engine is host-agnostic:
 *   GLFW      framebuffer = 0, rect = the window
 *   Qt/QML    framebuffer = QQuickFramebufferObject's FBO, flip_y = 1
 *   Avalonia  framebuffer = the control's FBO
 *   LWJGL     framebuffer = 0
 * No copies in any of those. Hosts with no GL interop at all (JavaFX, WPF)
 * use ph_plot_render_pixels instead.
 */
typedef struct ph_frame_target {
  uint32_t struct_size;
  /** GL framebuffer object name. 0 = the host's default framebuffer. */
  uint32_t framebuffer;
  /** Viewport within that framebuffer, in device pixels, origin bottom-left. */
  int32_t  x;
  int32_t  y;
  int32_t  width;
  int32_t  height;
  /** Device pixel ratio — device px per logical px. 0 means 1.0. */
  float    dpr;
  /**
   * Set when the target's origin is top-left rather than GL's bottom-left.
   * Qt's FBOs need this; GLFW's default framebuffer does not.
   */
  ph_bool  flip_y;
} ph_frame_target;

/* ------------------------------------------------------------------------ */
/* Colormaps and palettes                                                     */
/* ------------------------------------------------------------------------ */

/**
 * How a layer asks for a continuous colormap.
 *
 * `name` is a built-in ("viridis", "plasma", "inferno", "magma", "cividis",
 * "turbo", "grayscale", "coolwarm", "RdBu", "BrBG", "spectral", "twilight") or
 * anything passed to ph_colormap_register. Unknown names — and NULL — resolve to
 * viridis rather than failing, because a chart that draws in the wrong colours
 * is easier to notice than one that does not draw.
 *
 * `stops` overrides the name with anchors given inline, spaced evenly and
 * interpolated linearly. Their alpha is ignored; a colormap carries no opacity.
 */
typedef struct ph_colormap_spec {
  uint32_t        struct_size;
  const char*     name;
  const ph_color* stops;
  int32_t         stop_count;
  /** High values take the low end's colour. */
  ph_bool         reverse;
  /** 0 is continuous; otherwise the ramp is flattened into this many bands. */
  int32_t         discrete_steps;
} ph_colormap_spec;

PH_API void PH_CALL ph_colormap_spec_init(ph_colormap_spec* out);

/**
 * Register anchors under `name`, usable anywhere a colormap name is. Replaces
 * any existing entry. Needs at least two stops.
 */
PH_API ph_result PH_CALL ph_colormap_register(const char* name, const ph_color* stops,
                                              int32_t stop_count);

/** The colour at `t` (clamped to 0..1) — for a host drawing its own legend. */
PH_API ph_result PH_CALL ph_colormap_sample(const ph_colormap_spec* spec, double t,
                                            ph_color* out);

/** How many colormaps exist: built-ins first, then whatever was registered. */
PH_API int32_t PH_CALL ph_colormap_count(void);

/**
 * The `index`-th colormap name, or NULL when out of range. The pointer stays
 * valid for the life of the process — names are never unregistered.
 */
PH_API const char* PH_CALL ph_colormap_name(int32_t index);

/**
 * A domain centred on `center` that covers `values`, so a diverging colormap's
 * neutral midpoint lands on the reference value instead of drifting with the
 * data. Never returns an empty range: all-equal input gives center +/- 1.
 */
PH_API ph_result PH_CALL ph_symmetric_domain(const double* values, int32_t count,
                                             double center, ph_range* out);

/**
 * Register a categorical palette under `name` — the discrete counterpart to a
 * colormap, used for series and class colours. Needs at least one colour.
 */
PH_API ph_result PH_CALL ph_palette_register(const char* name, const ph_color* colors,
                                             int32_t count);

/** How many palettes exist. Built-ins: tableau10, okabe-ito, set2, bright. */
PH_API int32_t PH_CALL ph_palette_count(void);

/** The `index`-th palette name, or NULL when out of range. Valid for the process. */
PH_API const char* PH_CALL ph_palette_name(int32_t index);

/**
 * The `index`-th colour of a palette, cycling once it is exhausted. A NULL or
 * unknown name gives tableau10.
 */
PH_API ph_color PH_CALL ph_palette_color(const char* name, int32_t index);

/* ------------------------------------------------------------------------ */
/* Analysis — pure functions over arrays                                      */
/* ------------------------------------------------------------------------ */

/*
 * Indicators, transforms, regressions, filters and metrics. None of these
 * touch a plot: they take arrays and produce arrays, and what makes the result
 * a chart is what the caller does with it. That is exactly how the web core is
 * arranged, and keeping it that way here means a host can compute an RSI on a
 * worker thread and never involve the render thread at all.
 *
 * Two output shapes, and the difference is whether the length is known up front:
 *
 *   Fixed  — `out` holds `count` doubles, one per input sample. The leading
 *            run is NaN over the warm-up period; layers skip non-finite points,
 *            so an unfinished indicator simply does not draw.
 *   Counted — the result's length depends on the data (Renko bricks, P&F
 *            columns). Call with `capacity = 0` and a NULL buffer to learn the
 *            count, allocate, call again. `out_count` is always the number the
 *            function *would* have produced, never the number written, so a
 *            short buffer truncates rather than lying.
 *
 * A NULL output pointer means "I do not want this one" wherever a function
 * produces more than one series.
 */

/** Simple, weighted and exponential moving averages, and the rolling std dev. */
PH_API ph_result PH_CALL ph_fin_sma(const double* values, int32_t count, int32_t period,
                                    double* out);
PH_API ph_result PH_CALL ph_fin_wma(const double* values, int32_t count, int32_t period,
                                    double* out);
PH_API ph_result PH_CALL ph_fin_ema(const double* values, int32_t count, int32_t period,
                                    double* out);
PH_API ph_result PH_CALL ph_fin_rolling_std(const double* values, int32_t count, int32_t period,
                                            double* out);

/** Bollinger Bands: SMA(period) +/- k * rolling std. */
PH_API ph_result PH_CALL ph_fin_bollinger(const double* close, int32_t count, int32_t period,
                                          double k, double* out_middle, double* out_upper,
                                          double* out_lower);

/** Wilder's RSI. 0..100. */
PH_API ph_result PH_CALL ph_fin_rsi(const double* close, int32_t count, int32_t period,
                                    double* out);

/** MACD line, signal line and histogram. */
PH_API ph_result PH_CALL ph_fin_macd(const double* close, int32_t count, int32_t fast, int32_t slow,
                                     int32_t signal_period, double* out_macd, double* out_signal,
                                     double* out_histogram);

/** Cumulative volume-weighted average price. */
PH_API ph_result PH_CALL ph_fin_vwap(const double* high, const double* low, const double* close,
                                     const double* volume, int32_t count, double* out);

/** True range per bar, and Wilder's average of it. */
PH_API ph_result PH_CALL ph_fin_true_range(const double* high, const double* low,
                                           const double* close, int32_t count, double* out);
PH_API ph_result PH_CALL ph_fin_atr(const double* high, const double* low, const double* close,
                                    int32_t count, int32_t period, double* out);

/** Index of the first non-NaN value, or -1 — the end of an indicator's warm-up. */
PH_API int32_t PH_CALL ph_fin_first_finite(const double* values, int32_t count);

/** Stochastic oscillator: %K over `k_period`, %D = SMA(%K, d_period). */
PH_API ph_result PH_CALL ph_fin_stochastic(const double* high, const double* low,
                                           const double* close, int32_t count, int32_t k_period,
                                           int32_t d_period, double* out_k, double* out_d);

/** Keltner Channels: EMA(period) +/- mult * ATR(atr_period). */
PH_API ph_result PH_CALL ph_fin_keltner(const double* high, const double* low, const double* close,
                                        int32_t count, int32_t period, double mult,
                                        int32_t atr_period, double* out_middle, double* out_upper,
                                        double* out_lower);

/** On-Balance Volume — a running signed volume total, with no warm-up. */
PH_API ph_result PH_CALL ph_fin_obv(const double* close, const double* volume, int32_t count,
                                    double* out);

/**
 * Ichimoku lines. The spans come back *unshifted*: projecting the cloud forward
 * by `base_period` bars is a charting decision, and doing it here would hide it.
 */
PH_API ph_result PH_CALL ph_fin_ichimoku(const double* high, const double* low, int32_t count,
                                         int32_t conv_period, int32_t base_period,
                                         int32_t span_b_period, double* out_conversion,
                                         double* out_base, double* out_span_a, double* out_span_b);

/** Wilder's ADX and its two directional indicators. */
PH_API ph_result PH_CALL ph_fin_adx(const double* high, const double* low, const double* close,
                                    int32_t count, int32_t period, double* out_adx,
                                    double* out_plus_di, double* out_minus_di);

/** SuperTrend: the line, and +1/-1 for which side of price it sits on. */
PH_API ph_result PH_CALL ph_fin_supertrend(const double* high, const double* low,
                                           const double* close, int32_t count, int32_t period,
                                           double mult, double* out_trend, double* out_direction);

/** Commodity Channel Index, Money Flow Index and Williams %R. */
PH_API ph_result PH_CALL ph_fin_cci(const double* high, const double* low, const double* close,
                                    int32_t count, int32_t period, double* out);
PH_API ph_result PH_CALL ph_fin_mfi(const double* high, const double* low, const double* close,
                                    const double* volume, int32_t count, int32_t period,
                                    double* out);
PH_API ph_result PH_CALL ph_fin_williams_r(const double* high, const double* low,
                                           const double* close, int32_t count, int32_t period,
                                           double* out);

/** Aroon Up/Down and their oscillator. */
PH_API ph_result PH_CALL ph_fin_aroon(const double* high, const double* low, int32_t count,
                                      int32_t period, double* out_up, double* out_down,
                                      double* out_oscillator);

/** Donchian Channels: the rolling high, low and midline. */
PH_API ph_result PH_CALL ph_fin_donchian(const double* high, const double* low, int32_t count,
                                         int32_t period, double* out_middle, double* out_upper,
                                         double* out_lower);

/** Parabolic SAR — the trailing stop-and-reverse dots. Wilder's 0.02 / 0.2. */
PH_API ph_result PH_CALL ph_fin_parabolic_sar(const double* high, const double* low, int32_t count,
                                              double step, double max_step, double* out);

/**
 * The standard Fibonacci ratios — 0, .236, .382, .5, .618, .786, 1 — as a
 * pointer valid for the life of the process. Split from the retracement call
 * because the web core takes the ratios as an argument with these as its
 * default, and a host that wants its own set should not have to reinvent them.
 */
PH_API const double* PH_CALL ph_fin_fib_ratios(int32_t* out_count);

/**
 * Retracement prices for `count` ratios between a high and a low. `out_price`
 * holds `count` doubles; a NULL `ratios` uses the standard seven, in which case
 * `count` must be at least 7.
 */
PH_API ph_result PH_CALL ph_fin_fib_retracements(double high, double low, const double* ratios,
                                                 int32_t count, double* out_price);

/** Floor-trader pivots for the session after the one described. */
typedef struct ph_pivot_levels {
  double pivot;
  double r1;
  double r2;
  double r3;
  double s1;
  double s2;
  double s3;
} ph_pivot_levels;
PH_API ph_result PH_CALL ph_fin_pivot_points(double high, double low, double close,
                                             ph_pivot_levels* out);

/** Heikin-Ashi candles — smoothed OHLC, same length, for a candlestick layer. */
PH_API ph_result PH_CALL ph_fin_heikin_ashi(const double* open, const double* high,
                                            const double* low, const double* close, int32_t count,
                                            double* out_open, double* out_high, double* out_low,
                                            double* out_close);

/** One Renko / line-break brick: a wickless candle body at a sequential index. */
typedef struct ph_brick {
  double  open;
  double  close;
  int32_t x;
  ph_bool up;
} ph_brick;

/** Renko bricks, one per full `brick_size` move. Counted output. */
PH_API ph_result PH_CALL ph_fin_renko(const double* close, int32_t count, double brick_size,
                                      ph_brick* out, int32_t capacity, int32_t* out_count);

/** Line-break bricks over the last `lines` brick closes. Counted output. */
PH_API ph_result PH_CALL ph_fin_line_break(const double* close, int32_t count, int32_t lines,
                                           ph_brick* out, int32_t capacity, int32_t* out_count);

/**
 * One Point & Figure column. `kind` is 'X' (rising) or 'O' (falling) as a
 * character code. The box centres the web core also returns are omitted
 * deliberately: they are `min(from,to) + box_size/2` stepping by `box_size`,
 * and a nested variable-length array is the one shape this ABI has no good way
 * to hand back.
 */
typedef struct ph_pf_column {
  double  from;
  double  to;
  int32_t col;
  int32_t kind;
} ph_pf_column;

/** Point & Figure columns. Counted output. */
PH_API ph_result PH_CALL ph_fin_point_and_figure(const double* high, const double* low,
                                                 int32_t count, double box_size, int32_t reversal,
                                                 ph_pf_column* out, int32_t capacity,
                                                 int32_t* out_count);

/** What a volume profile found, beside the per-bin arrays. */
typedef struct ph_volume_profile {
  double  bin_size;
  double  price_min;
  double  price_max;
  /** Bin index of the highest-volume level — the Point of Control. */
  int32_t poc_index;
} ph_volume_profile;

/**
 * Volume by price level. `out_levels` and `out_volume` each hold `bins`
 * doubles; either may be NULL. Plot it as horizontal bars against `levels`.
 */
PH_API ph_result PH_CALL ph_fin_volume_profile(const double* price, const double* volume,
                                               int32_t count, int32_t bins, double* out_levels,
                                               double* out_volume, ph_volume_profile* out_info);

/**
 * Order-book depth curves from `[price, size]` given as two parallel arrays per
 * side. Each output holds as many doubles as its side has levels; the bid side
 * comes back with prices ascending toward the mid, so both plot left to right.
 */
PH_API ph_result PH_CALL ph_fin_depth(const double* bid_price, const double* bid_size,
                                      int32_t bid_count, const double* ask_price,
                                      const double* ask_size, int32_t ask_count,
                                      double* out_bid_price, double* out_bid_cum,
                                      double* out_ask_price, double* out_ask_cum);

/**
 * Roll bars up to a coarser timeframe — 1m into 1h, daily into weekly. Buckets
 * are aligned to multiples of `bucket_ms` from the epoch, so the same input
 * always gives the same boundaries, and empty buckets are skipped rather than
 * filled. Counted output: each non-NULL array receives `out_count` doubles.
 */
PH_API ph_result PH_CALL ph_fin_resample_ohlc(const double* time, const double* open,
                                              const double* high, const double* low,
                                              const double* close, const double* volume,
                                              int32_t count, double bucket_ms, double* out_time,
                                              double* out_open, double* out_high, double* out_low,
                                              double* out_close, double* out_volume,
                                              int32_t capacity, int32_t* out_count);

/** Where the deepest drawdown of an equity curve started and bottomed. */
typedef struct ph_drawdown {
  /** The deepest drawdown as a negative fraction: -0.32 is -32%. */
  double  max_drawdown;
  int32_t trough_index;
  int32_t peak_index;
} ph_drawdown;

/**
 * The underwater curve of an equity series. `out_values` and `out_peak` each
 * hold `count` doubles; either may be NULL.
 */
PH_API ph_result PH_CALL ph_fin_drawdown(const double* equity, int32_t count, double* out_values,
                                         double* out_peak, ph_drawdown* out_info);

/* -- Statistics ----------------------------------------------------------- */

/** A regular grid's shape and the data-space rectangle it covers. */
typedef struct ph_grid_info {
  int32_t  cols;
  int32_t  rows;
  ph_range x;
  ph_range y;
} ph_grid_info;

/**
 * Bin `values` into equal-width buckets.
 *
 * `bins` of 0 means Sturges' rule, which is what the web core's omitted option
 * resolves to; `lo == hi` means "measure the range from the data". Counted,
 * because the bin count is only known after the rule runs: `out_edges` takes
 * `out_bins + 1` doubles, `out_counts` and `out_centers` take `out_bins`. Any
 * of the three may be NULL.
 */
PH_API ph_result PH_CALL ph_stat_histogram(const double* values, int32_t count, int32_t bins,
                                           double lo, double hi, double* out_edges,
                                           double* out_counts, double* out_centers,
                                           int32_t capacity, int32_t* out_bins);

/** The same over explicit edges. `out_counts`/`out_centers` take `edge_count - 1`. */
PH_API ph_result PH_CALL ph_stat_histogram_edges(const double* values, int32_t count,
                                                 const double* edges, int32_t edge_count,
                                                 double* out_counts, double* out_centers);

/**
 * Bin an (x, y) cloud onto a regular grid — matplotlib's `hist2d`, and the
 * shape `ph_plot_add_heatmap` takes. `cols`/`rows` of 0 means sqrt(n) either
 * way; a zero span on an axis is measured from the data. `capacity` is in
 * cells; `out_info` reports the grid actually chosen.
 */
PH_API ph_result PH_CALL ph_stat_hist2d(const double* x, const double* y, int32_t count,
                                        int32_t cols, int32_t rows, ph_range x_range,
                                        ph_range y_range, double* out_values, int32_t capacity,
                                        ph_grid_info* out_info);

/** Linear-interpolated quantile of an already-sorted array (NumPy's type 7). */
PH_API ph_result PH_CALL ph_stat_quantile(const double* sorted, int32_t count, double q,
                                          double* out);

/** The five-number summary a Tukey box draws, and what falls outside it. */
typedef struct ph_box_stats {
  double  min;
  double  q1;
  double  median;
  double  q3;
  double  max;
  /** The extreme values still inside the 1.5-IQR fences — not the fences. */
  double  whisker_lo;
  double  whisker_hi;
  /** How many outliers there were, whatever `capacity` allowed room for. */
  int32_t outlier_count;
  /** Zero when the input held no finite value, in which case nothing else is set. */
  ph_bool valid;
} ph_box_stats;

/** Quartiles, whiskers and outliers. `out_outliers` may be NULL. */
PH_API ph_result PH_CALL ph_stat_box(const double* values, int32_t count, ph_box_stats* out,
                                     double* out_outliers, int32_t capacity);

/** Gaussian KDE over [lo, hi] at `points` samples, Silverman's rule for h. */
PH_API ph_result PH_CALL ph_stat_kde(const double* values, int32_t count, double lo, double hi,
                                     int32_t points, double* out_x, double* out_y);

/** In-place radix-2 FFT. `count` must be a power of two. */
PH_API ph_result PH_CALL ph_stat_fft(double* re, double* im, int32_t count);

/**
 * Short-time Fourier transform as a time x frequency grid of decibels, ready
 * for a heatmap. `hop` of 0 means half the frame.
 */
PH_API ph_result PH_CALL ph_stat_spectrogram(const double* signal, int32_t count, int32_t fft_size,
                                             int32_t hop, double sample_rate, double* out_values,
                                             int32_t capacity, ph_grid_info* out_info);

/** An ordinary-least-squares fit of y = slope*x + intercept. */
typedef struct ph_linear_fit {
  double  slope;
  double  intercept;
  /** Coefficient of determination, 0..1. */
  double  r2;
  /** Standard error of the residuals. */
  double  stderror;
  /** Points used; non-finite pairs are skipped rather than poisoning the fit. */
  int32_t n;
} ph_linear_fit;

PH_API ph_result PH_CALL ph_stat_linear_regression(const double* x, const double* y, int32_t count,
                                                   ph_linear_fit* out);

/**
 * A linear fit sampled across the data range, with an optional +/- `band` *
 * stderr envelope. `points` of 0 means 2, which is all a straight line needs.
 * Each output takes `points` doubles; `out_lower`/`out_upper` stay untouched
 * when `band` is 0.
 */
PH_API ph_result PH_CALL ph_stat_linear_trend(const double* x, const double* y, int32_t count,
                                              int32_t points, double band, double* out_x,
                                              double* out_y, double* out_lower, double* out_upper);

/**
 * LOESS: locally-weighted linear regression with a tricube kernel. `bandwidth`
 * is the fraction of points in each neighbourhood (0 means 0.3); larger is
 * smoother. Counted, because the grid is capped by the number of finite points.
 */
PH_API ph_result PH_CALL ph_stat_loess(const double* x, const double* y, int32_t count,
                                       double bandwidth, int32_t points, double* out_x,
                                       double* out_y, int32_t capacity, int32_t* out_count);

/**
 * The empirical CDF as a step function. Counted: non-finite values are dropped,
 * so the result is at most `count` long.
 */
PH_API ph_result PH_CALL ph_stat_ecdf(const double* values, int32_t count, double* out_x,
                                      double* out_y, int32_t capacity, int32_t* out_count);

/** Standardize to zero mean and unit variance. Non-finite entries pass through. */
PH_API ph_result PH_CALL ph_stat_zscore(const double* values, int32_t count, double* out);

/** Pearson correlation of two series; 0 when either is constant. */
PH_API ph_result PH_CALL ph_stat_correlation(const double* a, const double* b, int32_t count,
                                             double* out);

/**
 * Row-major `k*k` correlation matrix over `k` equal-length columns — the shape
 * a heatmap with a diverging colormap takes. `columns` is an array of `k`
 * pointers, each `count` long.
 */
PH_API ph_result PH_CALL ph_stat_corr_matrix(const double* const* columns, int32_t k,
                                             int32_t count, double* out);

/** The taper applied to a frame before an FFT, to suppress spectral leakage. */
typedef int32_t ph_window;
enum {
  /** No window at all — right only when the frame holds whole periods. */
  PH_WINDOW_RECTANGULAR = 0,
  /** The sane default. */
  PH_WINDOW_HANN        = 1,
  /** A touch more leakage for a lower first sidelobe. */
  PH_WINDOW_HAMMING     = 2,
  /** Suppresses sidelobes hardest, at the cost of resolution. */
  PH_WINDOW_BLACKMAN    = 3,
  /** Triangular, and cheap. */
  PH_WINDOW_BARTLETT    = 4
};

/** Sample a window function over `count` points. */
PH_API ph_result PH_CALL ph_stat_window(ph_window window, int32_t count, double* out);

/**
 * Welch's method: the averaged periodogram of overlapping windowed segments.
 * Counted — the segment length is rounded down to a power of two and the bin
 * count follows from it, so ask first.
 */
PH_API ph_result PH_CALL ph_stat_welch(const double* signal, int32_t count, int32_t segment,
                                       double overlap, ph_window window, double sample_rate,
                                       double* out_frequencies, double* out_power,
                                       int32_t capacity, int32_t* out_bins);

/**
 * Savitzky-Golay smoothing — a least-squares polynomial over a sliding window,
 * which preserves peak height and width where a moving average flattens them.
 * `window` is rounded up to odd; `out` takes `count` doubles.
 */
PH_API ph_result PH_CALL ph_stat_savitzky_golay(const double* values, int32_t count,
                                                int32_t window, int32_t order, double* out);

/**
 * Cross-correlation over +/- `max_lag`, or as far as the data allows when
 * `max_lag` is negative. Normalised, the peak lag reads directly as "b lags a
 * by k". Pass the same array twice for an autocorrelation. Counted: the result
 * is `2 * lag + 1` long.
 */
PH_API ph_result PH_CALL ph_stat_cross_correlate(const double* a, const double* b, int32_t count,
                                                 int32_t max_lag, ph_bool normalize,
                                                 int32_t* out_lags, double* out_values,
                                                 int32_t capacity, int32_t* out_count);

/* -- Machine learning ----------------------------------------------------- */

/**
 * Confusion matrix of integer class labels. `classes` of 0 means max(label)+1,
 * which is only known after the pass, so this is counted: `out_counts` and
 * `out_normalized` take `out_classes * out_classes` doubles and `out_support`
 * takes `out_classes`. `capacity` is in classes, not cells.
 */
PH_API ph_result PH_CALL ph_ml_confusion_matrix(const double* y_true, const double* y_pred,
                                                int32_t count, int32_t classes, double* out_counts,
                                                double* out_normalized, double* out_support,
                                                int32_t capacity, int32_t* out_classes);

/**
 * ROC curve for binary labels ranked by score, higher meaning more positive.
 * Ties collapse to one vertex, so the vertex count is at most `count + 1` and
 * usually less — counted. `out_auc` is NaN when either class is absent, because
 * an area under a curve that never rises is not zero, it is undefined.
 */
PH_API ph_result PH_CALL ph_ml_roc_curve(const double* scores, const double* labels, int32_t count,
                                         double* out_fpr, double* out_tpr, double* out_thresholds,
                                         int32_t capacity, int32_t* out_count, double* out_auc);

/** Precision-recall curve. `out_ap` is NaN with no positives; `out_baseline` is the base rate. */
PH_API ph_result PH_CALL ph_ml_pr_curve(const double* scores, const double* labels, int32_t count,
                                        double* out_recall, double* out_precision,
                                        double* out_thresholds, int32_t capacity,
                                        int32_t* out_count, double* out_ap, double* out_baseline);

/**
 * Reliability diagram: predicted confidence against observed frequency, in
 * `bins` equal-width buckets. Empty bins come back NaN and simply do not draw.
 */
PH_API ph_result PH_CALL ph_ml_calibration_curve(const double* scores, const double* labels,
                                                 int32_t count, int32_t bins,
                                                 double* out_mean_predicted,
                                                 double* out_fraction_positive,
                                                 double* out_bin_count, double* out_ece);

/**
 * TensorBoard's debiased EMA over a noisy training curve. `weight` in [0,1) is
 * the momentum. Non-finite values pass through and do not advance the average.
 */
PH_API ph_result PH_CALL ph_ml_ema_smooth(const double* values, int32_t count, double weight,
                                          double* out);

/** The four regression scores, which are always read together. */
typedef struct ph_regression_metrics {
  double mse;
  /** The error in the target's own units. */
  double rmse;
  /** Less swayed by outliers than rmse. */
  double mae;
  /** 1 is perfect, 0 matches predicting the mean, negative is worse than that. */
  double r2;
} ph_regression_metrics;

PH_API ph_result PH_CALL ph_ml_regression_metrics(const double* y_true, const double* y_pred,
                                                  int32_t count, ph_regression_metrics* out);

/**
 * Log loss and Brier score of predicted probabilities. `eps` of 0 means 1e-15;
 * probabilities are clipped away from 0 and 1 by it, so one confident mistake
 * cannot return infinity.
 */
PH_API ph_result PH_CALL ph_ml_probability_scores(const double* probs, const double* labels,
                                                  int32_t count, double eps, double* out_log_loss,
                                                  double* out_brier);

/** Precision, recall, F1 and support for one class. */
typedef struct ph_class_score {
  double  precision;
  double  recall;
  double  f1;
  /** True instances of this class. */
  double  support;
  int32_t label;
} ph_class_score;

/** One averaging rule's view of a report. */
typedef struct ph_class_average {
  double precision;
  double recall;
  double f1;
} ph_class_average;

/** The scalars of a scikit-learn shaped classification report. */
typedef struct ph_classification_report {
  double            accuracy;
  /** Unweighted over classes — every class counts the same. */
  ph_class_average  macro;
  /** Support-weighted — dominated by the common classes. */
  ph_class_average  weighted;
  /** How many classes there were, whatever `capacity` allowed room for. */
  int32_t           classes;
} ph_classification_report;

/**
 * Per-class precision, recall and F1 plus the two averages. A class the model
 * never predicts scores 0 precision rather than NaN, so the macro average stays
 * comparable across runs.
 */
PH_API ph_result PH_CALL ph_ml_classification_report(const double* y_true, const double* y_pred,
                                                     int32_t count, int32_t classes,
                                                     ph_class_score* out_per_class,
                                                     int32_t capacity,
                                                     ph_classification_report* out);

/**
 * Cumulative gain and lift down a score-ranked list — "if I contact the top
 * X%, what share of the buyers do I get?". Each output takes `count + 1`
 * doubles: the curve starts at the origin.
 */
PH_API ph_result PH_CALL ph_ml_lift_curve(const double* scores, const double* labels, int32_t count,
                                          double* out_fraction, double* out_gain, double* out_lift,
                                          int32_t* out_positives);

/**
 * One-vs-rest ROC areas for a multiclass problem. `scores` is row-major
 * `count * classes`, `labels` the true class index; `out_auc` takes `classes`
 * doubles.
 *
 * The per-class *curves* are not returned: they have different vertex counts,
 * and a jagged array is the one shape this ABI has no honest way to hand back.
 * Extract a class's score column and call ph_ml_roc_curve on it — which is
 * exactly what this does internally.
 */
PH_API ph_result PH_CALL ph_ml_roc_ovr(const double* scores, const double* labels, int32_t count,
                                       int32_t classes, double* out_auc, double* out_macro_auc,
                                       double* out_micro_auc);

/** Z-score each of the `d` columns of a row-major `n * d` matrix. */
PH_API ph_result PH_CALL ph_ml_standardize(const double* data, int32_t n, int32_t d, double* out);

/**
 * PCA of a row-major `n * d` matrix onto its top `k` components, by covariance
 * power iteration with deflation. Deterministic — the seed vector is arithmetic
 * rather than random, so an embedding plot is the same picture on every run.
 *
 * `out_scores` takes `n * k`, `out_components` `k * d`, `out_explained` `k` and
 * `out_mean` `d` doubles. Any may be NULL.
 */
PH_API ph_result PH_CALL ph_ml_pca(const double* data, int32_t n, int32_t d, int32_t k,
                                   double* out_scores, double* out_components,
                                   double* out_explained, double* out_mean);

/* -- Data ----------------------------------------------------------------- */

/**
 * Largest-Triangle-Three-Buckets: reduce a series to `threshold` points while
 * keeping its shape. Peaks and troughs survive where a stride would drop them.
 * Counted, because a threshold at or above the input length copies through.
 */
PH_API ph_result PH_CALL ph_data_lttb(const double* x, const double* y, int32_t count,
                                      int32_t threshold, double* out_x, double* out_y,
                                      int32_t capacity, int32_t* out_count);

/** How to read a CSV. Zero means the defaults, as everywhere else. */
typedef struct ph_csv_options {
  uint32_t struct_size;
  /** Field delimiter as a character code. 0 means ','. */
  int32_t  delimiter;
  /** The first row is data, not headers — which are then named col0, col1, … */
  ph_bool  no_header;
  /** Keep blank lines instead of dropping them. */
  ph_bool  keep_empty_lines;
} ph_csv_options;

PH_API void PH_CALL ph_csv_options_init(ph_csv_options* out);

/**
 * Parse CSV text into a table. Quoted fields, doubled quotes as an escape, and
 * LF or CRLF endings; anything past that is a job for a real CSV library, and
 * this exists so the simple case needs no dependency at all.
 *
 * `length` of 0 with a non-NULL `text` means "measure it with strlen"; pass the
 * length explicitly when the text may hold embedded NULs.
 */
PH_API ph_result PH_CALL ph_csv_parse(const char* text, int32_t length,
                                      const ph_csv_options* options, ph_table* out);

/** Free a table and every string in it. Destroying PH_NULL_HANDLE is a no-op. */
PH_API ph_result PH_CALL ph_table_destroy(ph_table table);

/** Non-zero when the handle still refers to a live table. Never fails. */
PH_API ph_bool PH_CALL ph_table_valid(ph_table table);

/** Data rows, not counting the header row. -1 when the handle is invalid. */
PH_API int32_t PH_CALL ph_table_row_count(ph_table table);
PH_API int32_t PH_CALL ph_table_column_count(ph_table table);

/**
 * A header name, or one cell, as UTF-8. NULL when out of range.
 *
 * The pointer belongs to the table and stays valid until it is destroyed —
 * which is the whole reason a table is a handle rather than a struct of
 * pointers a caller would have to keep alive itself.
 */
PH_API const char* PH_CALL ph_table_header(ph_table table, int32_t column);
PH_API const char* PH_CALL ph_table_cell(ph_table table, int32_t row, int32_t column);

/** A column's index by header name, or -1. */
PH_API int32_t PH_CALL ph_table_column_index(ph_table table, const char* name);

/**
 * A column parsed to doubles, `min(capacity, row_count)` of them. A cell that
 * holds no number becomes NaN, which is what every layer already treats as a
 * hole in a series rather than as a zero.
 */
PH_API ph_result PH_CALL ph_table_numeric(ph_table table, int32_t column, double* out,
                                          int32_t capacity);

/* ------------------------------------------------------------------------ */
/* Descriptors                                                                */
/* ------------------------------------------------------------------------ */

/** Plot margins in logical pixels. All-zero means the core defaults (16/16/40/56). */
typedef struct ph_margin {
  float top;
  float right;
  float bottom;
  float left;
} ph_margin;

/** One axis's scale configuration. Mirrors core `AxisScaleOptions`. */
typedef struct ph_axis_desc {
  uint32_t      struct_size;
  ph_scale_type type;
  /** Fixed domain. Leave lo == hi to autoscale to the data. */
  ph_range      domain;
  /** Factor labels for PH_SCALE_CATEGORICAL. UTF-8, `factor_count` entries. */
  const char* const* factors;
  int32_t       factor_count;
  /** Per-index epoch-ms timestamps for PH_SCALE_ORDINAL_TIME. */
  const double* times;
  int32_t       time_count;
  /**
   * Tint for a secondary y axis added with ph_plot_add_y_axis: its line, ticks
   * and labels all take it, so a reader can tell at a glance which series
   * belongs to which side. PH_COLOR_AUTO keeps the theme's colour.
   */
  ph_color      color;
} ph_axis_desc;

/**
 * Three-state flag for fields whose default is neither on nor off but
 * "whatever the context implies". Zero is still the default, so the
 * zero-initialized rule holds.
 */
typedef int32_t ph_toggle;
enum {
  PH_TOGGLE_DEFAULT = 0,
  PH_TOGGLE_ON      = 1,
  PH_TOGGLE_OFF     = -1
};

/** One explicit axis tick. Mirrors core `Tick`. */
typedef struct ph_tick {
  double      value;
  /** UTF-8. NULL means "format with the scale's own formatter". */
  const char* label;
  ph_bool     minor;
  /** Grid line. Default is on for a major tick and off for a minor one. */
  ph_toggle   grid;
} ph_tick;

/**
 * How one axis is drawn. Mirrors the style half of core `AxisConfig`.
 *
 * Every field is zero-means-default, so an axis left alone looks exactly like
 * the web core's. Two consequences of that rule worth knowing: a zero `width`
 * or `length` reads as "use the default", so the smallest hairline you can ask
 * for is a fractional value rather than 0; and PH_COLOR_AUTO means "take the
 * theme's colour", which is why it is not spelled as transparent.
 *
 * Fonts are a size in logical pixels rather than a CSS `font` string: the
 * library embeds one family (see DESIGN.md) and cannot honour a family name.
 */
typedef struct ph_axis_config {
  uint32_t     struct_size;
  /* The axis line, its ticks and its grid are all ON in the core, so — as with
   * ph_plot_desc — the descriptor spells the negation. */
  ph_bool      no_axis_line;
  ph_bool      no_ticks;
  ph_bool      no_grid;

  ph_color     axis_line_color;
  float        axis_line_width;    /* 0 = 1  */
  ph_color     tick_color;
  float        tick_length;        /* 0 = 5  */
  float        tick_width;         /* 0 = 1  */

  ph_color     label_color;
  float        label_size;         /* 0 = 12 */
  float        label_rotation;     /* degrees, clockwise; x axis only */
  float        label_standoff;     /* 0 = 3  */

  const char*  title;              /* UTF-8, may be NULL */
  ph_color     title_color;
  float        title_size;         /* 0 = 12 */

  ph_color     grid_color;
  ph_color     grid_minor_color;
  float        grid_width;         /* 0 = 1 */
  /** Dash pattern in logical px, alternating on/off. NULL = solid. Max 8. */
  const float* grid_dash;
  int32_t      grid_dash_count;

  /** Minor ticks between each pair of majors. 0 = none; linear scales only. */
  int32_t      minor_ticks;
} ph_axis_config;

/** Mirrors core `PlotOptions` — the subset that is not host-specific. */
typedef struct ph_plot_desc {
  uint32_t     struct_size;
  /** Logical (CSS-equivalent) size. Device size is this times the frame dpr. */
  int32_t      width;
  int32_t      height;
  ph_theme     theme;
  ph_margin    margin;
  ph_axis_desc x;
  ph_axis_desc y;
  ph_color     background;   /* plot region fill; PH_COLOR_AUTO = transparent */
  ph_color     border;       /* full-canvas fill incl. margins               */
  const char*  title;        /* UTF-8, may be NULL                           */
  ph_mode      mode;
  ph_pick_mode pick;
  /*
   * The four features below are ON by default in the core, so the descriptor
   * spells the negation. That keeps the "zero-initialized struct == core
   * defaults" rule true, which is what lets a C# `new ph_plot_desc()` or a Java
   * `MemorySegment.allocate` be correct without calling ph_plot_desc_init.
   */
  ph_bool      no_interaction;  /* wheel-zoom and drag off      */
  ph_bool      no_hover;        /* hover crosshair + tooltip off */
  ph_bool      no_crosshair;    /* XY guide lines off            */
  ph_bool      no_tooltip;      /* the hover readout panel off   */
  ph_bool      no_colorbar;     /* auto colorbar off             */
  /* These are OFF by default, so they read positively. */
  ph_bool      equal_aspect;
  ph_bool      bounded_pan;
  ph_bool      legend;
  /** Where the legend goes. Ignored unless `legend` is set. */
  ph_legend_position legend_position;
  /** Lay the entries out in a row instead of a column. */
  ph_bool      legend_horizontal;
  /** Clicking an entry no longer toggles its series. On in the core. */
  ph_bool      legend_static;
} ph_plot_desc;

/**
 * Mirrors core `LineOptions`.
 *
 * x/y point at caller-owned arrays that are copied during the call — the engine
 * uploads to GPU buffers and never retains the pointers. That is what makes the
 * ABI safe to call from a GC'd language without pinning.
 */
typedef struct ph_line_desc {
  uint32_t       struct_size;
  const double*  x;
  const double*  y;
  int32_t        count;
  ph_color       color;
  /** Line width in logical px. 0 = core default. */
  float          width;
  const char*    name;       /* UTF-8 legend label, may be NULL */
  const char*    y_axis;     /* named y axis, NULL = primary    */
  ph_step        step;
  ph_line_join   join;
  /** For PH_JOIN_MITER. 0 = core default (4). */
  float          miter_limit;
  /** Dash pattern in logical px, alternating on/off. NULL = solid. Max 8. */
  const float*   dash;
  int32_t        dash_count;
  /** 0 = default (on). Set `no_decimate` to turn min/max decimation off. */
  ph_bool        no_decimate;
  ph_render_type render_type;
} ph_line_desc;

/** Mirrors core `ScatterOptions`. */
typedef struct ph_scatter_desc {
  uint32_t        struct_size;
  const double*   x;
  const double*   y;
  int32_t         count;
  ph_color        color;
  /** Marker diameter in logical px. 0 = core default. */
  float           size;
  /** Per-point diameter, `count` entries. NULL = uniform `size`. */
  const float*    sizes;
  /** Per-point color, `count` entries. NULL = uniform `color`. */
  const ph_color* colors;
  ph_marker       marker;
  const char*     name;
  const char*     y_axis;
  /** Per-point values driving a colormap. NULL = no color mapping. */
  const double*   color_by;
  /** Value range mapped to [0,1]. lo == hi = the data min/max. */
  ph_range        color_by_domain;
  /** The ramp `color_by` maps through. NULL is viridis, the core's default. */
  const ph_colormap_spec* color_map;
  ph_render_type  render_type;
} ph_scatter_desc;

/** Mirrors core `BarOptions.orientation`. */
typedef int32_t ph_orientation;
enum {
  /** Positions along x, values along y. */
  PH_ORIENT_VERTICAL   = 0,
  /** Positions along *y*, values along *x*; `width` becomes the thickness. */
  PH_ORIENT_HORIZONTAL = 1
};

/**
 * Mirrors core `AreaOptions`.
 *
 * A band between `y` and a base — a triangle strip alternating base and top at
 * each x. Pass cumulative values in `base` to stack several areas.
 */
typedef struct ph_area_desc {
  uint32_t       struct_size;
  const double*  x;
  const double*  y;
  int32_t        count;
  /** Per-point lower edge, `count` entries. NULL uses `base_value`. */
  const double*  base;
  /** The lower edge when `base` is NULL. Zero is the usual baseline. */
  double         base_value;
  /** PH_COLOR_AUTO is the core's translucent blue, rgba(59,130,246,0.4). */
  ph_color       color;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_area_desc;

/**
 * Mirrors core `BarOptions`.
 *
 * `x` is the bar *centre* along the position axis and `y` its extent along the
 * value axis; which of those is horizontal depends on `orientation`.
 */
typedef struct ph_bar_desc {
  uint32_t        struct_size;
  const double*   x;
  const double*   y;
  int32_t         count;
  /** Per-bar baseline, `count` entries. NULL uses `base_value`. */
  const double*   base;
  double          base_value;
  /** Bar width in data units. 0 = 80% of the median spacing, as in the core. */
  double          width;
  /** Shift every bar along the position axis — how grouped bars are built. */
  double          offset;
  ph_orientation  orientation;
  ph_color        color;
  /** Per-bar colour, `count` entries. NULL = uniform `color`. */
  const ph_color* colors;
  const char*     name;
  const char*     y_axis;
  ph_render_type  render_type;
} ph_bar_desc;

/**
 * Mirrors core `PieOptions`.
 *
 * Slices sweep clockwise from `start_angle`, and the values need not sum to
 * anything — they are normalized. Set `equal_aspect` on the plot or the circle
 * comes out an ellipse.
 */
typedef struct ph_pie_desc {
  uint32_t        struct_size;
  /** Slice magnitudes. */
  const double*   values;
  int32_t         count;
  /** Per-slice colour, `count` entries. NULL uses the core's ten-colour palette. */
  const ph_color* colors;
  double          center_x;
  double          center_y;
  /** Outer radius in data units. 0 = 1. */
  double          radius;
  /** Inner radius. Greater than zero makes a donut. */
  double          inner_radius;
  /** First slice edge in radians. 0 = pi/2, twelve o'clock, as in the core. */
  double          start_angle;
  const char*     name;
  const char*     y_axis;
  ph_render_type  render_type;
} ph_pie_desc;

/**
 * Mirrors core `StemOptions`.
 *
 * A vertical line from `baseline` to each y, with a disc at the tip — a lollipop
 * chart, and the usual way to draw a discrete signal.
 */
typedef struct ph_stem_desc {
  uint32_t       struct_size;
  const double*  x;
  const double*  y;
  int32_t        count;
  /** Where the stems start. Zero is the usual baseline. */
  double         baseline;
  ph_color       color;
  /** Stem thickness in logical px. 0 = 1.5. */
  float          width;
  /** Tip marker diameter in logical px. Negative hides it; 0 = 6. */
  float          marker_size;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_stem_desc;

/**
 * Mirrors core `ErrorBarOptions`.
 *
 * Whiskers through each point, with caps, and optionally a shaded band joining
 * the low and high bounds. Errors may be symmetric (`y_err`) or asymmetric
 * (`y_err_low`/`y_err_high`), and each may be one number for every point or an
 * array of `count`.
 */
typedef struct ph_errorbar_desc {
  uint32_t       struct_size;
  const double*  x;
  const double*  y;
  int32_t        count;
  /** Symmetric half-height. Per-point when the array is set, else `y_err`. */
  const double*  y_err_array;
  double         y_err;
  /** Asymmetric below/above y. Either array overrides the symmetric value. */
  const double*  y_err_low_array;
  const double*  y_err_high_array;
  /** Symmetric half-width along x. */
  const double*  x_err_array;
  double         x_err;
  ph_color       color;
  /** Whisker and cap thickness in logical px. 0 = 1.5. */
  float          width;
  /** Cap length in logical px. Negative hides them; 0 = 6. */
  float          cap_size;
  /** Suppress the I-beam whiskers, which are on in the core. */
  ph_bool        no_whiskers;
  /** Fill a band between the low and high bounds. Off in the core. */
  ph_bool        band;
  /** Band opacity. 0 = 0.2. */
  float          band_opacity;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_errorbar_desc;

/** One box in a box plot: a position on the axis and the samples at it. */
typedef struct ph_box_group {
  double        position;
  const double* values;
  int32_t       count;
  /** PH_COLOR_AUTO uses the core's default blue. */
  ph_color      color;
  const char*   label;
} ph_box_group;

/**
 * Mirrors core `BoxOptions`.
 *
 * A Tukey box per group: the interquartile body, the median, whiskers out to
 * the furthest sample inside the 1.5-IQR fences, and a point for everything
 * beyond them. The quartiles are computed here, so the caller passes samples
 * rather than a summary.
 */
typedef struct ph_box_desc {
  uint32_t             struct_size;
  const ph_box_group*  groups;
  int32_t              group_count;
  /** Box width in data units. 0 = 0.6. */
  double               width;
  /** Suppress the Tukey box, which is on in the core. */
  ph_bool              no_box;
  /** Add a kernel-density violin. Off in the core; it replaces the box body. */
  ph_bool              violin;
  const char*          name;
  const char*          y_axis;
  ph_render_type       render_type;
} ph_box_desc;

/**
 * Mirrors core `ContourOptions`.
 *
 * Iso-lines through a scalar field by marching squares, drawn as plain
 * segments. Same grid layout as the heatmap — row-major, row 0 at the bottom —
 * so the two layer over each other without the caller reshaping anything.
 */
typedef struct ph_contour_desc {
  uint32_t                struct_size;
  const double*           values;
  int32_t                 cols;
  int32_t                 rows;
  /** The data-space rectangle the grid spans. */
  ph_range                x;
  ph_range                y;
  /** Explicit iso levels. NULL spaces `level_count` of them evenly. */
  const double*           levels;
  /** How many evenly-spaced levels, when `levels` is NULL. 0 = 8. */
  int32_t                 level_count;
  /**
   * One colour for every line. PH_COLOR_AUTO colours each level through the
   * colormap instead, which is what makes a contour plot readable without a
   * key beside it.
   */
  ph_color                color;
  /** Used when `color` is PH_COLOR_AUTO. NULL is viridis. */
  const ph_colormap_spec* colormap;
  const char*             name;
  const char*             y_axis;
  ph_render_type          render_type;
} ph_contour_desc;

/** One graph edge: two indices into the node arrays. */
typedef struct ph_edge {
  int32_t a;
  int32_t b;
} ph_edge;

/**
 * Mirrors core `GraphOptions`.
 *
 * Edges as line segments, nodes as round points. When `x` and `y` are NULL the
 * layer runs the core's force layout over `node_count` and the edges — seeded
 * on a unit circle rather than at random, so the same graph comes out the same
 * way in every host.
 */
typedef struct ph_graph_desc {
  uint32_t       struct_size;
  /** Node positions. Both NULL runs the force layout instead. */
  const double*  x;
  const double*  y;
  int32_t        node_count;
  const ph_edge* edges;
  int32_t        edge_count;
  ph_color       node_color;
  ph_color       edge_color;
  /** Node diameter in logical px. 0 = 10. */
  float          node_size;
  /** Force-layout relaxation steps, when the layer is laying out. 0 = 300. */
  int32_t        layout_iterations;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_graph_desc;

/**
 * Mirrors core `HexbinOptions`.
 *
 * A million-point scatter turned into a few thousand hexagons: the points are
 * binned on a hex lattice and each cell is coloured by how many landed in it.
 * The answer to overplotting, and the reason the layer counts rather than draws.
 */
typedef struct ph_hexbin_desc {
  uint32_t                struct_size;
  const double*           x;
  const double*           y;
  int32_t                 count;
  /** Hex radius in data units. 0 = about a thirtieth of the x extent. */
  double                  radius;
  /** NULL is viridis, the core's default. */
  const ph_colormap_spec* colormap;
  /** Count range mapped across the colormap. Empty means [1, the busiest cell]. */
  ph_range                domain;
  const char*             name;
  const char*             y_axis;
  ph_render_type          render_type;
} ph_hexbin_desc;

/**
 * Mirrors core `QuiverOptions`.
 *
 * An arrow per sample: a pixel-thick shaft to the tip and a screen-space head,
 * so the arrowheads stay the same size at any zoom while the field itself
 * scales with the data.
 */
typedef struct ph_quiver_desc {
  uint32_t                struct_size;
  const double*           x;
  const double*           y;
  /** The vector components at each anchor. */
  const double*           u;
  const double*           v;
  int32_t                 count;
  /**
   * Multiplier applied to (u, v) in data units. 0 auto-fits so the longest
   * arrow spans about 90% of a nominal grid cell.
   */
  double                  scale;
  ph_color                color;
  /** Shaft thickness in logical px. 0 = 1.5. */
  float                   width;
  /** Arrowhead length in logical px. 0 = 9. */
  float                   head_size;
  /**
   * Colour each arrow through a colormap instead of one flat colour. Off
   * unless `color_by` is set; the values default to each arrow's magnitude.
   */
  ph_bool                 color_by;
  /** Per-arrow values for `color_by`. NULL uses the magnitude. */
  const double*           color_values;
  const ph_colormap_spec* color_map;
  /** Value range mapped across the colormap. Empty means fit to the values. */
  ph_range                color_domain;
  const char*             name;
  const char*             y_axis;
  ph_render_type          render_type;
} ph_quiver_desc;

/**
 * Mirrors core `CandlestickOptions`.
 *
 * One body rectangle and one low-to-high wick per period, coloured by
 * direction. The x positions are data-space: epoch milliseconds on a time
 * axis, or integer indices on the ordinal-time axis that collapses the gaps
 * between sessions.
 */
typedef struct ph_candlestick_desc {
  uint32_t       struct_size;
  const double*  x;
  const double*  open;
  const double*  high;
  const double*  low;
  const double*  close;
  int32_t        count;
  /** Body width in data units. 0 = 70% of the median spacing. */
  double         width;
  /** close >= open. PH_COLOR_AUTO is the core's teal. */
  ph_color       up_color;
  /** close < open. PH_COLOR_AUTO is the core's red. */
  ph_color       down_color;
  /** Wick thickness in logical px. 0 = 1.5. */
  float          wick_width;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_candlestick_desc;

/**
 * Mirrors core `OhlcOptions` — the western cousin of the candlestick.
 *
 * Each period is a vertical low-to-high line with a tick left at the open and
 * right at the close. Same five arrays, three segments instead of a box.
 */
typedef struct ph_ohlc_desc {
  uint32_t       struct_size;
  const double*  x;
  const double*  open;
  const double*  high;
  const double*  low;
  const double*  close;
  int32_t        count;
  /** Total tick span in data units; each tick is half. 0 = 70% of the spacing. */
  double         width;
  ph_color       up_color;
  ph_color       down_color;
  /** Line thickness in logical px. 0 = 1.5. */
  float          line_width;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_ohlc_desc;

/**
 * Mirrors the core `Annotation` union, flattened.
 *
 * Flat rather than tagged because C# and Java marshal a plain struct for free
 * and a union not at all — the same reason `ph_event` is flat. Which fields
 * matter depends on `type`; the rest are ignored, so a zeroed struct plus two
 * or three assignments is the whole of a call.
 *
 * All coordinates are data space, so an annotation pans and zooms with the
 * chart. Pointers are borrowed for the duration of the call and copied.
 */
typedef struct ph_annotation {
  uint32_t           struct_size;
  ph_annotation_type type;
  /** SPAN and BAND: which axis the value(s) lie on. */
  ph_dim             dim;
  /**
   * SPAN: the value.  BAND: from `x0` to `x1` on `dim`.  BOX: two corners.
   * LABEL: the anchor.  LINE and RAY: the two ends.  FIB: the x extent.
   */
  double             x0;
  double             y0;
  double             x1;
  double             y1;
  /** FIB: the two prices the levels are measured between. */
  double             high;
  double             low;
  /** FIB: the retracement ratios. NULL uses the classic seven. */
  const double*      ratios;
  int32_t            ratio_count;
  /** Line or fill colour. PH_COLOR_AUTO takes the theme's axis colour. */
  ph_color           color;
  /** BOX: the outline, drawn only when set. */
  ph_color           border;
  /** Stroke width in logical px. 0 = 1 for a span, 1.5 for a line or ray. */
  float              width;
  /** Dash pattern in logical px, or NULL for solid. */
  const float*       dash;
  int32_t            dash_count;
  /** BOX, LINE, RAY and FIB: a caption beside the shape. */
  const char*        label;
  /** LABEL: the text itself. */
  const char*        text;
  /** LABEL: nudge in screen px after projection, so a stack keeps its spacing. */
  float              dx;
  float              dy;
  ph_text_align      align;
  ph_text_baseline   baseline;
  /** LABEL: em size in logical px. 0 = the theme's label size. */
  float              size;
  /** FIB: shade alternate bands between the levels. */
  ph_bool            fill;
  const char*        y_axis;
} ph_annotation;

/** Identifies one annotation within its plot, for removal. */
typedef int32_t ph_annotation_id;

/**
 * Mirrors core `LegendOptions`, plus the on/off the descriptor also carries.
 *
 * The same four knobs as `ph_plot_desc`'s legend fields, so a caller can set
 * them at creation or change them later without learning two vocabularies.
 */
typedef struct ph_legend_config {
  uint32_t           struct_size;
  ph_bool            enabled;
  ph_legend_position position;
  /** Lay the entries out in a row instead of a column. */
  ph_bool            horizontal;
  /** Clicking an entry no longer toggles its series. On in the core. */
  ph_bool            no_toggle;
} ph_legend_config;

/**
 * Mirrors core `HeatmapOptions`.
 *
 * A regular grid coloured through a colormap and drawn as one textured quad —
 * so a 2000x2000 field costs one draw call, not four million. `values` is
 * row-major with row 0 at the *bottom*, the orientation a scientific grid is
 * usually built in.
 */
typedef struct ph_heatmap_desc {
  uint32_t                struct_size;
  const double*           values;
  int32_t                 cols;
  int32_t                 rows;
  /** The data-space rectangle the grid spans. */
  ph_range                x;
  ph_range                y;
  /** NULL is viridis, the core's default. */
  const ph_colormap_spec* colormap;
  /**
   * The value range mapped across the colormap. An empty range (lo == hi, so
   * also all-zero) means fit to the data.
   */
  ph_range                domain;
  /** Draw hard cells instead of bilinear-filtering between them. */
  ph_bool                 no_smooth;
  const char*             name;
  const char*             y_axis;
  ph_render_type          render_type;
} ph_heatmap_desc;

/**
 * Mirrors core `ImageOptions`, minus the URL.
 *
 * The web layer accepts anything `texImage2D` does, including a URL it fetches.
 * Here the source is always decoded RGBA8 the caller already has — loading and
 * decoding an image is the host's job, not a chart library's, and it is the one
 * place where pretending otherwise would drag in a network stack.
 */
typedef struct ph_image_desc {
  uint32_t       struct_size;
  /** width * height * 4 bytes, RGBA8, not premultiplied. */
  const uint8_t* pixels;
  int32_t        width;
  int32_t        height;
  /** The data-space rectangle the image spans. */
  ph_range       x;
  ph_range       y;
  /**
   * The first row of `pixels` is the bottom of the extent. Off by default,
   * because a decoded image's first row is its top — which is what the web core
   * assumes when it flips on upload.
   */
  ph_bool        bottom_up;
  /** Draw hard pixels instead of bilinear-filtering between them. */
  ph_bool        no_smooth;
  /** Overall opacity. 0 = 1.0, so a zeroed struct is a visible image. */
  float          opacity;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_image_desc;

/**
 * One filled polygon: a ring of x/y, with optional holes.
 *
 * `holes[k]` is the *vertex* index where hole ring k begins — the same
 * convention earcut and mapbox use, and not a coordinate index. A polygon with
 * no holes leaves both fields zero.
 */
typedef struct ph_patch {
  const double*  x;
  const double*  y;
  int32_t        count;
  const int32_t* holes;
  int32_t        hole_count;
  /** Explicit fill. PH_COLOR_AUTO falls back to the layer's colour. */
  ph_color       color;
} ph_patch;

/**
 * Mirrors core `PatchesOptions`.
 *
 * Each ring is triangulated once on the CPU by ear clipping and then drawn as a
 * per-vertex-coloured triangle soup, so only the transform uniforms change from
 * frame to frame. Everything the patch arrays point at is copied during the
 * call, like every other descriptor.
 *
 * A choropleth is `values` plus `colormap`: one number per patch, mapped
 * through the ramp. It beats a patch's own `color`, the same way a scatter's
 * `color_by` beats its per-point colours, and it contributes a colorbar.
 */
typedef struct ph_patches_desc {
  uint32_t                struct_size;
  const ph_patch*         patches;
  int32_t                 patch_count;
  /** Fill for patches that do not carry their own colour. */
  ph_color                color;
  /** Fill opacity, 0..1. 0 means the core default of 1. */
  float                   opacity;
  const char*             name;
  const char*             y_axis;
  ph_render_type          render_type;
  /** One value per patch, mapped through `colormap`. NULL for a flat fill. */
  const double*           values;
  /** NULL with `values` set means viridis. */
  const ph_colormap_spec* colormap;
  /** Value range the ramp covers. Leave empty to measure it from `values`. */
  ph_range                domain;
} ph_patches_desc;

/* ------------------------------------------------------------------------ */
/* Events                                                                     */
/* ------------------------------------------------------------------------ */

typedef int32_t ph_event_type;
enum {
  PH_EVENT_NONE            = 0,
  /** The x or a y domain changed (pan, zoom, autoscale, setView). */
  PH_EVENT_VIEW_CHANGED    = 1,
  /** The hover cursor moved; `cursor_valid` is 0 when it left the plot. */
  PH_EVENT_CURSOR_MOVED    = 2,
  PH_EVENT_MODE_CHANGED    = 3,
  PH_EVENT_LAYER_VISIBILITY = 4,
  /**
   * The plot's contents changed and the host should schedule a frame —
   * Qt: update(), GLFW: wake the loop, Avalonia: RequestNextFrameRendering().
   */
  PH_EVENT_REDRAW_REQUESTED = 5,
  /**
   * The hover cursor moved onto — or off — a data point. `layer` and
   * `point_index` name it, `point_x`/`point_y` are its data coordinates, and
   * `point_valid` is 0 when nothing is under the cursor.
   *
   * Emitted only when the picked point changes, not on every mouse move: a host
   * that shows a tooltip should not have to filter a stream of identical
   * events.
   */
  PH_EVENT_POINT_PICKED    = 6
};

/**
 * A flat, union-free event record. Fields not relevant to `type` are zero.
 *
 * Flat rather than tagged-union because C# and Java marshal a plain struct for
 * free and a union not at all.
 */
typedef struct ph_event {
  uint32_t      struct_size;
  ph_event_type type;
  ph_layer      layer;        /* LAYER_VISIBILITY               */
  ph_range      x;            /* VIEW_CHANGED                   */
  ph_range      y;            /* VIEW_CHANGED (primary y axis)   */
  double        cursor_x;     /* CURSOR_MOVED, data space        */
  double        cursor_y;
  ph_bool       cursor_valid;
  ph_mode       mode;         /* MODE_CHANGED                    */
  ph_bool       visible;      /* LAYER_VISIBILITY                */
  double        point_x;      /* POINT_PICKED, data space        */
  double        point_y;
  int32_t       point_index;  /* POINT_PICKED, -1 when none      */
  ph_bool       point_valid;
} ph_event;

/* Pointer input ----------------------------------------------------------- */

typedef int32_t ph_button;
enum {
  PH_BUTTON_LEFT   = 0,
  PH_BUTTON_MIDDLE = 1,
  PH_BUTTON_RIGHT  = 2
};

typedef int32_t ph_modifiers;
enum {
  PH_MOD_NONE  = 0,
  PH_MOD_SHIFT = 1 << 0,
  PH_MOD_CTRL  = 1 << 1,
  PH_MOD_ALT   = 1 << 2,
  PH_MOD_SUPER = 1 << 3
};

/* ------------------------------------------------------------------------ */
/* Library lifecycle                                                          */
/* ------------------------------------------------------------------------ */

/** The ABI version this binary was built against. Compare to PHOTON_ABI_VERSION. */
PH_API uint32_t PH_CALL ph_abi_version(void);

/** Human-facing library version, tracking the npm package. Any pointer may be NULL. */
PH_API void PH_CALL ph_version(int32_t* major, int32_t* minor, int32_t* patch);

/**
 * Initialize the library. Idempotent: calling it again with a compatible ABI
 * version succeeds and leaves the existing host descriptor in place.
 *
 * Returns PH_E_ABI_MISMATCH if `abi_version` differs from this binary's.
 */
PH_API ph_result PH_CALL ph_init(uint32_t abi_version, const ph_host_desc* desc);

/** Destroy every live plot and release global state. Safe to call twice. */
PH_API void PH_CALL ph_shutdown(void);

/**
 * The last error message on the *calling thread*, or "" when there is none.
 * The pointer stays valid until the next failing call on that same thread.
 */
PH_API const char* PH_CALL ph_last_error(void);

/** Parse a CSS color string ("#rrggbb", "#rgb", "rgba(...)") into packed RGBA. */
PH_API ph_result PH_CALL ph_color_parse(const char* css, ph_color* out);

/* ------------------------------------------------------------------------ */
/* Descriptor defaults                                                        */
/* ------------------------------------------------------------------------ */

/*
 * Each fills `struct_size` plus the same defaults the TypeScript core applies
 * when an option is omitted. A zero-initialized struct is also valid — these
 * exist so a host can see what the defaults actually are.
 */
PH_API void PH_CALL ph_host_desc_init(ph_host_desc* out);
PH_API void PH_CALL ph_frame_target_init(ph_frame_target* out);
PH_API void PH_CALL ph_plot_desc_init(ph_plot_desc* out);
PH_API void PH_CALL ph_axis_desc_init(ph_axis_desc* out);
PH_API void PH_CALL ph_axis_config_init(ph_axis_config* out);
PH_API void PH_CALL ph_line_desc_init(ph_line_desc* out);
PH_API void PH_CALL ph_scatter_desc_init(ph_scatter_desc* out);
PH_API void PH_CALL ph_patches_desc_init(ph_patches_desc* out);
PH_API void PH_CALL ph_area_desc_init(ph_area_desc* out);
PH_API void PH_CALL ph_bar_desc_init(ph_bar_desc* out);
PH_API void PH_CALL ph_pie_desc_init(ph_pie_desc* out);
PH_API void PH_CALL ph_stem_desc_init(ph_stem_desc* out);
PH_API void PH_CALL ph_errorbar_desc_init(ph_errorbar_desc* out);
PH_API void PH_CALL ph_box_desc_init(ph_box_desc* out);
PH_API void PH_CALL ph_annotation_init(ph_annotation* out);
PH_API void PH_CALL ph_legend_config_init(ph_legend_config* out);
PH_API void PH_CALL ph_contour_desc_init(ph_contour_desc* out);
PH_API void PH_CALL ph_graph_desc_init(ph_graph_desc* out);
PH_API void PH_CALL ph_hexbin_desc_init(ph_hexbin_desc* out);
PH_API void PH_CALL ph_quiver_desc_init(ph_quiver_desc* out);
PH_API void PH_CALL ph_candlestick_desc_init(ph_candlestick_desc* out);
PH_API void PH_CALL ph_ohlc_desc_init(ph_ohlc_desc* out);
PH_API void PH_CALL ph_heatmap_desc_init(ph_heatmap_desc* out);
PH_API void PH_CALL ph_image_desc_init(ph_image_desc* out);

/*
 * The composed charts, the CSV reader and the colormaps each declare their own
 * `_init` beside the descriptor it fills, rather than in this list. The list is
 * for the layers, where a host reads them one after another; a chart's default
 * only makes sense next to the chart.
 */

/* ------------------------------------------------------------------------ */
/* Plot lifecycle                                                             */
/* ------------------------------------------------------------------------ */

/** Create a plot. `desc` may be NULL for an all-defaults plot. */
PH_API ph_result PH_CALL ph_plot_create(const ph_plot_desc* desc, ph_plot* out);

/** Destroy a plot and every layer it owns. Destroying PH_NULL_HANDLE is a no-op. */
PH_API ph_result PH_CALL ph_plot_destroy(ph_plot plot);

/** Non-zero when the handle still refers to a live plot. Never fails. */
PH_API ph_bool PH_CALL ph_plot_valid(ph_plot plot);

/** Resize in logical pixels. */
PH_API ph_result PH_CALL ph_plot_set_size(ph_plot plot, int32_t width, int32_t height);

PH_API ph_result PH_CALL ph_plot_set_margin(ph_plot plot, const ph_margin* margin);
PH_API ph_result PH_CALL ph_plot_set_theme(ph_plot plot, ph_theme theme);

/** Set (or clear, with NULL) the plot title drawn in the reserved top strip. */
PH_API ph_result PH_CALL ph_plot_set_title(ph_plot plot, const char* title);

/**
 * Lock one data unit to the same number of pixels on both axes, or unlock it.
 * Also settable once through `ph_plot_desc.equal_aspect`; this is the runtime
 * half, and it re-fits either way — turning it on should balance the data
 * extent, not whatever the free-aspect view happened to be.
 *
 * Anything whose shape carries meaning needs it: a pie, a sunburst, a chord
 * diagram and a gauge are all circles, and without this they are ellipses.
 */
PH_API ph_result PH_CALL ph_plot_set_equal_aspect(ph_plot plot, ph_bool enabled);

/** How the plot title is drawn. All-zero is the theme's own styling. */
typedef struct ph_title_config {
  uint32_t      struct_size;
  /** The text. NULL clears the title, the same as ph_plot_set_title(NULL). */
  const char*   text;
  ph_color      color;
  /** Em size in logical px. 0 means 15. */
  float         size;
  /** Where the text sits across the top strip. 0 is centred. */
  ph_text_align align;
} ph_title_config;

PH_API void PH_CALL ph_title_config_init(ph_title_config* out);

/**
 * Set the title and how it is drawn. `ph_plot_set_title` is the short form and
 * leaves the styling alone; this is the whole of what `drawTitle` accepts.
 */
PH_API ph_result PH_CALL ph_plot_set_title_config(ph_plot plot, const ph_title_config* config);

/**
 * Show or hide the colorbar stack. On by default, as in the core.
 *
 * Every layer that maps values to colours — heatmap, hexbin, contour, and a
 * scatter or quiver coloured by value — contributes one bar, drawn in a right
 * margin the plot reserves for it. Turning it off gives that margin back.
 */
PH_API ph_result PH_CALL ph_plot_set_colorbar(ph_plot plot, ph_bool enabled);

/**
 * How hover chooses the highlighted point. PH_PICK_X by default, as in the core.
 *
 * A series wants x — the reader is asking "what is the value here". A point
 * cloud wants PH_PICK_XY, because there is no "the point at this x" and an
 * x-only match highlights something the cursor is nowhere near.
 */
PH_API ph_result PH_CALL ph_plot_set_pick_mode(ph_plot plot, ph_pick_mode mode);

/**
 * Show or hide the hover readout panel. On by default, as in the core.
 *
 * A host that would rather draw its own — a themed Qt popup, say — turns this
 * off and builds one from PH_EVENT_POINT_PICKED, which is the same argument
 * DESIGN.md makes about the toolbar.
 */
PH_API ph_result PH_CALL ph_plot_set_tooltip(ph_plot plot, ph_bool enabled);

/**
 * Add an annotation, drawn above the data and clipped to the plot region.
 *
 * `out` receives an id that identifies it for removal — the native equivalent of
 * the unsubscribe closure `addAnnotation` returns in the TypeScript.
 */
PH_API ph_result PH_CALL ph_plot_add_annotation(ph_plot plot, const ph_annotation* annotation,
                                                ph_annotation_id* out);

/** Remove one annotation. PH_E_INVALID_ARGUMENT when the id is not live. */
PH_API ph_result PH_CALL ph_plot_remove_annotation(ph_plot plot, ph_annotation_id id);

PH_API ph_result PH_CALL ph_plot_clear_annotations(ph_plot plot);

/**
 * Show, place and configure the legend.
 *
 * Only layers the caller *named* appear: an unnamed layer is a builder's helper
 * — a fill under a line, a raw series behind a smoothed one — and listing it
 * would be clutter nobody asked for. A NULL config restores the defaults.
 */
PH_API ph_result PH_CALL ph_plot_set_legend(ph_plot plot, const ph_legend_config* config);

/* ------------------------------------------------------------------------ */
/* Axes and view                                                              */
/* ------------------------------------------------------------------------ */

/** `axis` is "x", "y", or a named y axis id added with ph_plot_add_y_axis. */
PH_API ph_result PH_CALL ph_plot_set_scale(ph_plot plot, const char* axis, const ph_axis_desc* desc);

/** Set a fixed domain, which also turns that axis's autoscaling off. */
PH_API ph_result PH_CALL ph_plot_set_domain(ph_plot plot, const char* axis, ph_range domain);

PH_API ph_result PH_CALL ph_plot_get_domain(ph_plot plot, const char* axis, ph_range* out);

/** Add a secondary y axis. `side` is 0 for left, 1 for right. */
PH_API ph_result PH_CALL ph_plot_add_y_axis(ph_plot plot, const char* id, const ph_axis_desc* desc, int32_t side);

PH_API ph_result PH_CALL ph_plot_remove_y_axis(ph_plot plot, const char* id);

/**
 * Style one axis. `desc` may be NULL to restore the theme defaults. The pointers
 * inside it (title, grid_dash) are copied during the call, like every other
 * descriptor's.
 */
PH_API ph_result PH_CALL ph_plot_set_axis_config(ph_plot plot, const char* axis,
                                                 const ph_axis_config* desc);

/**
 * Replace an axis's automatic ticks with an explicit list, or restore automatic
 * ticks with `count == 0`.
 *
 * The web core also accepts a generator callback here. This does not: calling
 * back into a managed runtime is exactly what the polled event queue exists to
 * avoid, and a host that wants generated ticks can generate them and pass the
 * array.
 */
PH_API ph_result PH_CALL ph_plot_set_axis_ticks(ph_plot plot, const char* axis,
                                                const ph_tick* ticks, int32_t count);

/** Re-fit every auto axis to the union of its layers' bounds. */
PH_API ph_result PH_CALL ph_plot_autoscale(ph_plot plot);

/** Restore the domains the plot was created with. */
PH_API ph_result PH_CALL ph_plot_reset_view(ph_plot plot);

/* ------------------------------------------------------------------------ */
/* Layers                                                                     */
/* ------------------------------------------------------------------------ */

PH_API ph_result PH_CALL ph_plot_add_line(ph_plot plot, const ph_line_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_scatter(ph_plot plot, const ph_scatter_desc* desc, ph_layer* out);

/**
 * Filled polygons. The layer every composed chart is built on: the treemaps,
 * funnels, sankeys and candlestick bodies in the web core are all free
 * functions over `addPatches` rather than layers of their own.
 */
PH_API ph_result PH_CALL ph_plot_add_patches(ph_plot plot, const ph_patches_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_area(ph_plot plot, const ph_area_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_bar(ph_plot plot, const ph_bar_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_pie(ph_plot plot, const ph_pie_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_stem(ph_plot plot, const ph_stem_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_errorbar(ph_plot plot, const ph_errorbar_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_box(ph_plot plot, const ph_box_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_contour(ph_plot plot, const ph_contour_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_graph(ph_plot plot, const ph_graph_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_hexbin(ph_plot plot, const ph_hexbin_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_quiver(ph_plot plot, const ph_quiver_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_candlestick(ph_plot plot, const ph_candlestick_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_ohlc(ph_plot plot, const ph_ohlc_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_heatmap(ph_plot plot, const ph_heatmap_desc* desc, ph_layer* out);
PH_API ph_result PH_CALL ph_plot_add_image(ph_plot plot, const ph_image_desc* desc, ph_layer* out);

/* ------------------------------------------------------------------------ */
/* Composed charts                                                            */
/* ------------------------------------------------------------------------ */

/*
 * One series of a multi-series builder. `y` is `count` long, parallel to the
 * builder's shared `x`.
 */
typedef struct ph_series {
  const double* y;
  ph_color      color;
  const char*   name;
} ph_series;

/**
 * Grouped (clustered) bars: one bar layer per series, each shifted inside its
 * category so they sit side by side. Counted, like every other builder that
 * returns more than one layer.
 */
typedef struct ph_grouped_bar_desc {
  uint32_t         struct_size;
  const double*    x;
  int32_t          count;
  const ph_series* series;
  int32_t          series_count;
  /** Data-space width of one whole cluster. 0 means 0.8. */
  double           group_width;
  /** Fraction of each slot left empty between bars. 0 means 0.1. */
  double           gap;
  ph_orientation   orientation;
  const char*      y_axis;
  ph_render_type   render_type;
} ph_grouped_bar_desc;

PH_API void PH_CALL ph_grouped_bar_desc_init(ph_grouped_bar_desc* out);
PH_API ph_result PH_CALL ph_plot_add_grouped_bars(ph_plot plot, const ph_grouped_bar_desc* desc,
                                                  ph_layer* out_layers, int32_t capacity,
                                                  int32_t* out_count);

/**
 * Stacked bars or a stacked area: each series is drawn from the running total
 * of the ones before it, so they stack. Returned bottom to top.
 */
typedef struct ph_stacked_desc {
  uint32_t         struct_size;
  const double*    x;
  int32_t          count;
  const ph_series* series;
  int32_t          series_count;
  /** Bar width in data units; ignored by the area form. 0 is the core default. */
  double           width;
  ph_orientation   orientation;
  const char*      y_axis;
  ph_render_type   render_type;
} ph_stacked_desc;

PH_API void PH_CALL ph_stacked_desc_init(ph_stacked_desc* out);
PH_API ph_result PH_CALL ph_plot_add_stacked_bars(ph_plot plot, const ph_stacked_desc* desc,
                                                  ph_layer* out_layers, int32_t capacity,
                                                  int32_t* out_count);
PH_API ph_result PH_CALL ph_plot_add_stacked_area(ph_plot plot, const ph_stacked_desc* desc,
                                                  ph_layer* out_layers, int32_t capacity,
                                                  int32_t* out_count);

/** Bin raw values and draw the result as bars. */
typedef struct ph_histogram_desc {
  uint32_t       struct_size;
  const double*  values;
  int32_t        count;
  /** 0 means Sturges' rule, as in the core. */
  int32_t        bins;
  /** Range to bin over. Leave empty to measure it from the data. */
  ph_range       range;
  ph_color       color;
  const char*    name;
  const char*    y_axis;
  ph_render_type render_type;
} ph_histogram_desc;

PH_API void PH_CALL ph_histogram_desc_init(ph_histogram_desc* out);
PH_API ph_result PH_CALL ph_plot_add_histogram(ph_plot plot, const ph_histogram_desc* desc,
                                               ph_layer* out);

/** A short-time Fourier transform drawn as a heatmap: time across, frequency up. */
typedef struct ph_spectrogram_desc {
  uint32_t                struct_size;
  const double*           signal;
  int32_t                 count;
  /** Frame size, a power of two. 0 means 256. */
  int32_t                 fft_size;
  /** Samples between frames. 0 means half the frame. */
  int32_t                 hop;
  /** 0 means 1, which makes the axes read in cycles per sample. */
  double                  sample_rate;
  /** NULL means plasma, which is the core's default for this chart. */
  const ph_colormap_spec* colormap;
  const char*             name;
  const char*             y_axis;
  ph_render_type          render_type;
} ph_spectrogram_desc;

PH_API void PH_CALL ph_spectrogram_desc_init(ph_spectrogram_desc* out);
PH_API ph_result PH_CALL ph_plot_add_spectrogram(ph_plot plot, const ph_spectrogram_desc* desc,
                                                 ph_layer* out);

/*
 * Seven diagrams that are not layers.
 *
 * A treemap, a funnel, a sunburst, a Sankey, a chord, a gauge and parallel
 * coordinates are all *layouts*: they turn values into polygon rings, which the
 * patches layer then draws. None of them needed a shader, and none of them adds
 * a layer type — ph_plot_add_treemap returns an ordinary ph_layer holding
 * ordinary patches, which is why it can be hidden, destroyed and legended like
 * anything else.
 *
 * Where a chart names its parts, the names are drawn as label annotations on
 * the plot rather than being part of the layer. Destroying the layer therefore
 * leaves the labels; ph_plot_clear_annotations removes them. That is the same
 * split the web core has, for the same reason: a label is a note about a chart,
 * not a piece of one.
 */

/** One weighted, labelled item. PH_COLOR_AUTO cycles the palette. */
typedef struct ph_chart_item {
  const char* label;
  double      value;
  ph_color    color;
} ph_chart_item;

/**
 * Squarified treemap: rectangles sized in proportion to value, packed with
 * aspect ratios near one. Items with a value of zero or less take no space.
 */
typedef struct ph_treemap_desc {
  uint32_t             struct_size;
  const ph_chart_item* items;
  int32_t              item_count;
  /** The rectangle to fill. An empty range on either axis means 0..1. */
  ph_range             x;
  ph_range             y;
  /** Palette cycled by item index. NULL means tableau10. */
  const char*          palette;
  float                opacity;
  const char*          name;
  ph_render_type       render_type;
  /** Suppress the per-cell labels, which are on by default. */
  ph_bool              no_labels;
} ph_treemap_desc;

PH_API void PH_CALL ph_treemap_desc_init(ph_treemap_desc* out);
PH_API ph_result PH_CALL ph_plot_add_treemap(ph_plot plot, const ph_treemap_desc* desc,
                                             ph_layer* out);

/**
 * Centred trapezoids stacked top to bottom, each stage's top width proportional
 * to its value and its bottom width to the next stage's.
 */
typedef struct ph_funnel_desc {
  uint32_t             struct_size;
  const ph_chart_item* items;
  int32_t              item_count;
  /** Full width the largest stage spans. 0 means 1. */
  double               width;
  /** Total stack height. 0 means 1. */
  double               height;
  /** The last stage's bottom width as a fraction of its own. 0 means 0.4. */
  double               neck;
  const char*          palette;
  float                opacity;
  const char*          name;
  ph_render_type       render_type;
  ph_bool              no_labels;
} ph_funnel_desc;

PH_API void PH_CALL ph_funnel_desc_init(ph_funnel_desc* out);
PH_API ph_result PH_CALL ph_plot_add_funnel(ph_plot plot, const ph_funnel_desc* desc,
                                            ph_layer* out);

/**
 * One node of a hierarchy, flattened: `parent` indexes the same array, or is -1
 * for a root. A child must come after its parent — which is what lets the value
 * roll-up be one pass rather than a recursion with a stack depth nobody bounds.
 */
typedef struct ph_tree_node {
  const char* name;
  int32_t     parent;
  /** Counts only for a leaf; a node with children takes their sum. */
  double      value;
  ph_color    color;
} ph_tree_node;

/** A radial icicle: one ring per depth, angular span by summed leaf value. */
typedef struct ph_sunburst_desc {
  uint32_t            struct_size;
  const ph_tree_node* nodes;
  int32_t             node_count;
  /** Radial thickness of each ring. 0 means 1. */
  double              ring_width;
  /** Inner radius of the root ring — the hole in the middle. */
  double              center;
  /** Angle of the first edge, radians. 0 means twelve o'clock. */
  double              start_angle;
  const char*         palette;
  float               opacity;
  const char*         name;
  ph_render_type      render_type;
} ph_sunburst_desc;

PH_API void PH_CALL ph_sunburst_desc_init(ph_sunburst_desc* out);
PH_API ph_result PH_CALL ph_plot_add_sunburst(ph_plot plot, const ph_sunburst_desc* desc,
                                              ph_layer* out);

/** A flow from one node index to another. */
typedef struct ph_flow {
  int32_t source;
  int32_t target;
  double  value;
} ph_flow;

/** A node in a flow diagram. */
typedef struct ph_flow_node {
  const char* name;
  ph_color    color;
} ph_flow_node;

/**
 * Sankey: nodes in columns by longest path from a source, stacked by
 * throughput, joined by bezier ribbons whose thickness is their value. A link
 * naming a node that does not exist is skipped rather than refused — a flow
 * table usually arrives from data, and one bad row should not lose the rest.
 */
typedef struct ph_sankey_desc {
  uint32_t             struct_size;
  const ph_flow_node*  nodes;
  int32_t              node_count;
  const ph_flow*       links;
  int32_t              link_count;
  /** The drawing box. An empty range on either axis means 0..1. */
  ph_range             x;
  ph_range             y;
  /** Node rectangle width along x. 0 means 0.02. */
  double               node_width;
  /** Gap between stacked nodes as a fraction of the y extent. 0 means 0.02. */
  double               node_padding;
  const char*          palette;
  float                opacity;
  /** Ribbon alpha, so overlapping flows read through each other. 0 means 0.5. */
  float                ribbon_opacity;
  const char*          name;
  ph_render_type       render_type;
  ph_bool              no_labels;
} ph_sankey_desc;

PH_API void PH_CALL ph_sankey_desc_init(ph_sankey_desc* out);
PH_API ph_result PH_CALL ph_plot_add_sankey(ph_plot plot, const ph_sankey_desc* desc,
                                            ph_layer* out);

/**
 * Chord: groups around a circle with spans by row sum, joined by ribbons that
 * curve through the centre. `matrix` is row-major `count * count`.
 *
 * Set the plot to an equal aspect, or the circle is an ellipse.
 */
typedef struct ph_chord_desc {
  uint32_t           struct_size;
  const double*      matrix;
  int32_t            count;
  /** Group labels placed just outside each arc. NULL for none. */
  const char* const* labels;
  int32_t            label_count;
  /** Outer radius. 0 means 1. */
  double             radius;
  /** Total angular gap split between the groups, radians. 0 means 0.1 * 2pi. */
  double             pad_angle;
  /** Arc thickness as a fraction of the radius. 0 means 0.06. */
  double             arc_width;
  const char*        palette;
  /** Ribbon alpha. 0 means 0.65. */
  float              ribbon_opacity;
  const char*        name;
  ph_render_type     render_type;
} ph_chord_desc;

PH_API void PH_CALL ph_chord_desc_init(ph_chord_desc* out);
PH_API ph_result PH_CALL ph_plot_add_chord(ph_plot plot, const ph_chord_desc* desc, ph_layer* out);

/** A `{value, colour}` band; the arc takes the colour of the highest one reached. */
typedef struct ph_gauge_threshold {
  double   value;
  ph_color color;
} ph_gauge_threshold;

/** A radial gauge: a background track, a value arc and a needle, centred at 0,0. */
typedef struct ph_gauge_desc {
  uint32_t                  struct_size;
  double                    value;
  /** Value at the start of the sweep. */
  double                    min;
  /** Value at the end of the sweep. 0 means 100. */
  double                    max;
  const ph_gauge_threshold* thresholds;
  int32_t                   threshold_count;
  /** Value-arc colour when no threshold applies. */
  ph_color                  color;
  ph_color                  track_color;
  ph_color                  needle_color;
  /** Sweep start in degrees. 0 means 200. */
  double                    start_angle;
  /** Sweep end in degrees. 0 means -20. */
  double                    end_angle;
  /** Outer radius. 0 means 1. Inner radius 0 means 0.7. */
  double                    radius;
  double                    inner_radius;
  /** Centre caption. NULL prints the value; `no_label` omits it entirely. */
  const char*               label;
  ph_bool                   no_label;
  const char*               name;
  ph_render_type            render_type;
} ph_gauge_desc;

PH_API void PH_CALL ph_gauge_desc_init(ph_gauge_desc* out);
PH_API ph_result PH_CALL ph_plot_add_gauge(ph_plot plot, const ph_gauge_desc* desc, ph_layer* out);

/**
 * Parallel coordinates: one polyline per row across `dim_count` vertical axes,
 * each dimension normalised to 0..1 by its own observed range.
 *
 * Counted, and the only builder that is: a row is a line and a line is a layer,
 * so this returns one handle per row. Call with `capacity = 0` to learn how
 * many — which is simply `row_count`, but asking keeps the shape the same as
 * every other counted call.
 */
typedef struct ph_parallel_desc {
  uint32_t           struct_size;
  const char* const* dimensions;
  int32_t            dim_count;
  /** Row-major `row_count * dim_count`. */
  const double*      rows;
  int32_t            row_count;
  /** Optional per-row value banded through the palette. NULL cycles by index. */
  const double*      color_by;
  const char*        palette;
  /** Polyline width in logical px. 0 means 1. */
  float              width;
  /** Line alpha, so a crowded plot still reads. 0 means 0.7. */
  float              opacity;
  /** Names the first row's layer, so one entry appears in the legend. */
  const char*        name;
  ph_render_type     render_type;
  /** Suppress the axis guides and their names. */
  ph_bool            no_axes;
} ph_parallel_desc;

PH_API void PH_CALL ph_parallel_desc_init(ph_parallel_desc* out);
PH_API ph_result PH_CALL ph_plot_add_parallel(ph_plot plot, const ph_parallel_desc* desc,
                                              ph_layer* out_layers, int32_t capacity,
                                              int32_t* out_count);

/*
 * Every 2-D layer the web core has is here. The plot3d and polar families
 * follow the same shape when they land — one `ph_<name>_desc` struct, one
 * `ph_<name>_desc_init`, one `ph_plot_add_<name>` — and are additive, so
 * appending them will not change this ABI version.
 */

/** Replace a layer's x/y data in place. Cheap on PH_RENDER_DYNAMIC layers. */
PH_API ph_result PH_CALL ph_layer_set_xy(ph_layer layer, const double* x, const double* y, int32_t count);

/*
 * Replace a layer's data in place, keeping its handle and its GPU objects.
 *
 * `ph_layer_set_xy` fits a line or a scatter and nothing else: an area has a
 * base, a bar has a width and per-bar colours, a candle has five arrays. So the
 * layers a live feed drives take their own descriptor here — the same one that
 * created them, and the constructor is a call to the same code, so the two
 * cannot drift apart. Everything the descriptor carries is replaced, not just
 * the arrays.
 *
 * The layers left out — pie, patches, box, image and graph — are not driven per
 * frame by anything, and destroying and re-adding one costs a few GL objects
 * once. Adding setters for them later is additive.
 */
PH_API ph_result PH_CALL ph_layer_set_area(ph_layer layer, const ph_area_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_bar(ph_layer layer, const ph_bar_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_errorbar(ph_layer layer, const ph_errorbar_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_candlestick(ph_layer layer, const ph_candlestick_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_ohlc(ph_layer layer, const ph_ohlc_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_heatmap(ph_layer layer, const ph_heatmap_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_hexbin(ph_layer layer, const ph_hexbin_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_quiver(ph_layer layer, const ph_quiver_desc* desc);
PH_API ph_result PH_CALL ph_layer_set_contour(ph_layer layer, const ph_contour_desc* desc);

PH_API ph_result PH_CALL ph_layer_set_visible(ph_layer layer, ph_bool visible);
PH_API ph_bool   PH_CALL ph_layer_valid(ph_layer layer);

/** Data-space extent of a layer. Returns PH_E_UNSUPPORTED when it holds no data. */
PH_API ph_result PH_CALL ph_layer_bounds(ph_layer layer, ph_range* x, ph_range* y);

/** Remove a layer from its plot and free its GPU resources. */
PH_API ph_result PH_CALL ph_layer_destroy(ph_layer layer);

/* ------------------------------------------------------------------------ */
/* Interaction                                                                */
/* ------------------------------------------------------------------------ */

/*
 * Input is host-driven on purpose. A mouse event is three different types in
 * GLFW, Qt and WPF; only the *response* to one is shared, and that is what
 * lives here. Coordinates are logical pixels relative to the plot's top-left,
 * matching every toolkit's own convention.
 */

PH_API ph_result PH_CALL ph_plot_set_mode(ph_plot plot, ph_mode mode);
PH_API ph_result PH_CALL ph_plot_get_mode(ph_plot plot, ph_mode* out);

PH_API ph_result PH_CALL ph_plot_pointer_down(ph_plot plot, double px, double py, ph_button button, ph_modifiers mods);
PH_API ph_result PH_CALL ph_plot_pointer_move(ph_plot plot, double px, double py, ph_modifiers mods);
PH_API ph_result PH_CALL ph_plot_pointer_up(ph_plot plot, double px, double py, ph_button button, ph_modifiers mods);

/** The cursor left the plot: clears hover state. */
PH_API ph_result PH_CALL ph_plot_pointer_leave(ph_plot plot);

/**
 * Wheel input. `delta_y` follows the browser convention the core was written
 * against: positive scrolls down and zooms out, factor = exp(delta_y * 0.001).
 * GLFW's yoffset is inverted and scaled by roughly -100 to match.
 */
PH_API ph_result PH_CALL ph_plot_wheel(ph_plot plot, double px, double py, double delta_y, ph_modifiers mods);

/** Pan by a pixel delta, as a drag would. */
PH_API ph_result PH_CALL ph_plot_pan_pixels(ph_plot plot, double dx, double dy);

/**
 * Zoom about a point given in normalized plot-region coordinates: (0,0) is the
 * bottom-left of the plot region, (1,1) the top-right. `factor` > 1 zooms out.
 */
PH_API ph_result PH_CALL ph_plot_zoom_around(ph_plot plot, double nx, double ny, double factor);

/** Convert logical pixels within the plot to data space, and back. */
PH_API ph_result PH_CALL ph_plot_data_at_pixel(ph_plot plot, double px, double py, double* out_x, double* out_y);
PH_API ph_result PH_CALL ph_plot_pixel_at_data(ph_plot plot, double x, double y, double* out_px, double* out_py);

/* ------------------------------------------------------------------------ */
/* Rendering                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Draw one frame into the host's framebuffer. The host's GL context must be
 * current on the calling thread. Zero copies.
 */
PH_API ph_result PH_CALL ph_plot_render(ph_plot plot, const ph_frame_target* target);

/**
 * Fallback for hosts with no GL interop (JavaFX, classic WPF): render offscreen
 * and read back into `out_rgba`, which must hold at least
 * `stride_bytes * height` bytes with `stride_bytes >= width * 4`.
 *
 * `width` and `height` are the output image in pixels, top row first, RGBA8
 * with premultiplied alpha. The chart is laid out at `width / dpr` by
 * `height / dpr` logical pixels — so a 2x image of a 400x300 chart is
 * `(800, 600, dpr = 2)`. The plot's own size is not changed.
 *
 * The host's GL context must still be current: this renders, it does not
 * rasterize on the CPU.
 *
 * This is the native descendant of the browser core's shared-context blit: on
 * the web that readback is mandatory, here it is the compatibility path.
 */
PH_API ph_result PH_CALL ph_plot_render_pixels(ph_plot plot, int32_t width, int32_t height,
                                               float dpr, uint8_t* out_rgba, int32_t stride_bytes);

/** Non-zero when state changed since the last render and a frame is owed. */
PH_API ph_bool PH_CALL ph_plot_needs_redraw(ph_plot plot);

/* ------------------------------------------------------------------------ */
/* Event queue                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Pop one queued event. Returns PH_OK with `out->type == PH_EVENT_NONE` when
 * the queue is empty, so a host can drain it with a plain loop:
 *
 *     ph_event ev;
 *     while (ph_plot_poll_event(plot, &ev) == PH_OK && ev.type != PH_EVENT_NONE) {
 *         ...
 *     }
 */
PH_API ph_result PH_CALL ph_plot_poll_event(ph_plot plot, ph_event* out);

/** Drop every queued event without processing it. */
PH_API ph_result PH_CALL ph_plot_clear_events(ph_plot plot);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* PHOTON_H */
