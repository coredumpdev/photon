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
  PH_PICK_X  = 0,
  PH_PICK_Y  = 1,
  PH_PICK_XY = 2
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
  ph_bool      no_colorbar;     /* auto colorbar off             */
  /* These are OFF by default, so they read positively. */
  ph_bool      equal_aspect;
  ph_bool      bounded_pan;
  ph_bool      legend;
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
  ph_render_type  render_type;
} ph_scatter_desc;

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
  PH_EVENT_REDRAW_REQUESTED = 5
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

/*
 * The remaining 24 layer types (bar, area, heatmap, box, hexbin, contour,
 * errorbar, stem, quiver, candlestick, ohlc, patches, pie, image, graph, and
 * the plot3d family) follow this exact shape: one `ph_<name>_desc` struct, one
 * `ph_<name>_desc_init`, one `ph_plot_add_<name>`. They land in Faz 4 and are
 * additive — appending them does not change this ABI version.
 */

/** Replace a layer's x/y data in place. Cheap on PH_RENDER_DYNAMIC layers. */
PH_API ph_result PH_CALL ph_layer_set_xy(ph_layer layer, const double* x, const double* y, int32_t count);

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
