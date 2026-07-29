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
 * The web core can also colour patches by a per-patch `value` through a
 * colormap (choropleth). That needs the colormap tables, which are not ported
 * yet, so those two fields are absent rather than accepted and ignored —
 * appending them later does not change this ABI version.
 */
typedef struct ph_patches_desc {
  uint32_t        struct_size;
  const ph_patch* patches;
  int32_t         patch_count;
  /** Fill for patches that do not carry their own colour. */
  ph_color        color;
  /** Fill opacity, 0..1. 0 means the core default of 1. */
  float           opacity;
  const char*     name;
  const char*     y_axis;
  ph_render_type  render_type;
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
