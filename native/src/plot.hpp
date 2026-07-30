// Port of the imperative core plot, core/src/plot.ts.
//
// plot.ts is 2787 lines, and roughly half of it is DOM: three stacked canvases,
// pointer listeners, a toolbar, a context menu. None of that crosses over. What
// does cross over is the part underneath — layout, the scale stack, autoscaling,
// and the pan/zoom/box math — and that part is reproduced here numerically
// identically, so a native chart and a web chart respond to the same drag with
// the same domain.
#pragma once

#include <photon/photon.h>

#include <cstddef>
#include <deque>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "axes/axis.hpp"
#include "layer.hpp"
#include "render/overlay.hpp"
#include "scale.hpp"

namespace photon {

/// The drawable rectangle inside the margins, in logical pixels.
struct PlotRegion {
  double left = 0.0;
  double top = 0.0;
  double width = 0.0;
  double height = 0.0;
};

/// One named y axis. The primary axis always exists and is called "y".
struct YAxis {
  std::string id;
  Scale scale;
  /// Ticks and styling for this axis.
  Axis axis;
  /// 0 = left, 1 = right. Secondary axes default to the right.
  int32_t side = 0;
  /// True while the axis re-fits itself to the data; any explicit domain clears it.
  bool automatic = true;
  /// Domain at creation, for reset_view. Absent when the axis started automatic.
  bool has_initial = false;
  ph_range initial{0.0, 1.0};
  /// This axis's own tint. An unstyled coloured axis tints its line, ticks,
  /// labels and title, which is how a reader tells the two sides apart.
  ph_color color = PH_COLOR_AUTO;
};

class Plot {
 public:
  explicit Plot(const ph_plot_desc& desc);

  // -- geometry ----------------------------------------------------------
  void set_size(int32_t width, int32_t height);
  void set_margin(const ph_margin& margin);
  void set_theme(ph_theme theme) { theme_ = theme; request_render(); }
  void set_title(const char* title);
  /// The whole of what drawTitle accepts: text plus how it is drawn.
  void set_title_style(const render::TitleStyle& style) {
    title_style_ = style;
    request_render();
  }
  PlotRegion region() const;
  /// The base margin grown for the title strip and any extra y axes.
  ph_margin compute_margin() const;
  /// Re-run the hover pick and emit PH_EVENT_POINT_PICKED when it changed.
  void update_pick();
  /// True when the click landed on a legend row and toggled its series.
  bool legend_click(double px, double py);
  /// The colour scales the visible layers report, in draw order.
  std::vector<render::ColorbarEntry> color_scales() const;
  /// Where each y axis line sits, parallel to the axis list.
  std::vector<render::YAxisPlacement> y_axis_placements(const PlotRegion& r) const;

  // -- axes --------------------------------------------------------------
  /// Look up "x", "y", or a named y axis. nullptr when there is no such axis.
  Scale* find_scale(const char* axis);
  YAxis* find_y_axis(const char* id);
  bool set_scale(const char* axis, const ph_axis_desc& desc);
  bool set_domain(const char* axis, ph_range domain);
  bool get_domain(const char* axis, ph_range& out) const;
  bool add_y_axis(const char* id, const ph_axis_desc& desc, int32_t side);
  bool remove_y_axis(const char* id);
  /// Style one axis. A null descriptor restores the theme defaults.
  bool set_axis_config(const char* axis, const ph_axis_config* desc);
  /// Replace an axis's automatic ticks. `count == 0` restores automatic ticks.
  bool set_axis_ticks(const char* axis, const ph_tick* ticks, int32_t count);
  void autoscale();
  void reset_view();

  // -- layers ------------------------------------------------------------
  /// Takes ownership; returns a borrowed pointer for the handle table.
  Layer* add_layer(std::unique_ptr<Layer> layer);
  bool remove_layer(Layer* layer);
  const std::vector<std::unique_ptr<Layer>>& layers() const { return layers_; }

  /// One layer's answer to the hover cursor, with the pixel it lands on.
  struct Hit {
    Layer* layer = nullptr;
    Picked point;
    double px = 0.0;
    double py = 0.0;
  };
  /// Every visible layer's nearest point to the hover cursor, in draw order.
  std::vector<Hit> hover_hits() const;

  /// The layers that belong in the legend: the ones the caller named.
  std::vector<Layer*> legend_layers() const;

  /// Turn the colorbar stack off. On by default, as in the web core.
  void set_colorbar(bool on) { colorbar_ = on; }
  bool colorbar() const { return colorbar_; }

  void set_pick_mode(ph_pick_mode mode) { pick_ = mode; }
  /// Add an annotation and return its id. Copies everything it points at.
  ph_annotation_id add_annotation(const ph_annotation& annotation);

  /// Turn the equal-aspect lock on or off, re-fitting either way — switching it
  /// on should balance the data extent rather than whatever the free-aspect
  /// view happened to be.
  void set_equal_aspect(bool on);
  bool remove_annotation(ph_annotation_id id);
  void clear_annotations();

  void set_tooltip(bool on) {
    tooltip_ = on;
    request_render();
  }

  void set_legend(bool on, ph_legend_position position, bool horizontal, bool interactive) {
    legend_ = on;
    legend_position_ = position;
    legend_horizontal_ = horizontal;
    legend_interactive_ = interactive;
    request_render();
  }

  /// Handles minted for this plot's layers, so teardown can invalidate them.
  std::vector<uint64_t> layer_handles;

  // -- interaction -------------------------------------------------------
  void set_mode(ph_mode mode);
  ph_mode mode() const { return mode_; }

  void pointer_down(double px, double py, ph_button button, ph_modifiers mods);
  void pointer_move(double px, double py, ph_modifiers mods);
  void pointer_up(double px, double py, ph_button button, ph_modifiers mods);
  void pointer_leave();
  void wheel(double px, double py, double delta_y, ph_modifiers mods);

  void pan_pixels(double dx, double dy);
  void zoom_around(double nx, double ny, double factor);

  void data_at_pixel(double px, double py, double& out_x, double& out_y) const;
  void pixel_at_data(double x, double y, double& out_px, double& out_py) const;

  // -- frames ------------------------------------------------------------
  /**
   * Draw one frame into `target`. The caller must have made the GL context
   * current and loaded `api`. Returns false with `error` set on a GL failure.
   */
  bool render(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target, std::string& error);
  /**
   * Render into a private framebuffer and read the pixels back, top row first.
   *
   * `width`/`height` are the output image in pixels; the layout runs at
   * width/dpr by height/dpr logical pixels, so a 2x readback of a 400x300 chart
   * asks for 800x600 with dpr 2.
   */
  bool render_pixels(gl::Api& api, ph_gfx_api gfx, int32_t width, int32_t height, float dpr,
                     uint8_t* out_rgba, int32_t stride_bytes, std::string& error);
  /// Release the offscreen target without touching anything else.
  void release_offscreen(gl::Api& api);
  /// Release every layer's GL objects. Requires the context to be current.
  void release_gl(gl::Api& api);
  bool needs_redraw() const { return needs_redraw_; }
  void mark_drawn() { needs_redraw_ = false; }
  void request_render();

  // -- events ------------------------------------------------------------
  bool poll_event(ph_event& out);
  void clear_events() { events_.clear(); }

  /// The thread that created the plot; ph_plot_render refuses any other, since
  /// the GL context is only current on this one.
  std::thread::id owner_thread() const { return owner_thread_; }

 private:
  /// Which axes a drag or wheel is allowed to touch, per the current mode.
  struct AxisLock {
    bool x;
    bool y;
  };
  AxisLock axis_lock() const;

  /// "x", "y" or a named y axis, as an Axis rather than a Scale.
  Axis* find_axis(const char* id);
  /// Equalize the data-units-per-pixel of both axes. Port of applyAspect().
  void apply_aspect(const PlotRegion& r);

  /// Draw one frame into an ordinary bottom-left-origin target.
  bool render_upright(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target,
                      std::string& error);
  /// Size (creating if needed) the private colour target render_pixels and the
  /// flipped path both draw into.
  bool ensure_offscreen(gl::Api& api, int32_t width, int32_t height, std::string& error);

  YAxis& primary_y() { return y_axes_.front(); }
  const YAxis& primary_y() const { return y_axes_.front(); }

  void pan_x(double dx_px, const PlotRegion& r);
  void pan_y(const char* id, double dy_px, const PlotRegion& r);

  /// Union of every visible layer's extent. False when nothing has data.
  bool data_bounds(ph_range& x, ph_range& y) const;
  /**
   * Whether a proposed domain is one the view can come back from.
   *
   * `data` is the axis's data extent, or null when nothing is plotted.
   */
  static bool zoom_fits(const Scale& scale, double lo, double hi, const ph_range* data);
  /// Keep the view inside the data when bounded_pan is on.
  void apply_bounds_clamp();

  void emit_view_changed();
  void push_event(const ph_event& event);

  int32_t width_ = 640;
  int32_t height_ = 400;
  ph_margin margin_{16.0f, 16.0f, 40.0f, 56.0f};
  ph_theme theme_ = PH_THEME_DARK;
  std::string title_;
  render::TitleStyle title_style_;
  /// Plot-region fill and full-canvas fill. PH_COLOR_AUTO leaves both clear.
  ph_color background_ = PH_COLOR_AUTO;
  ph_color border_ = PH_COLOR_AUTO;

  Scale scale_x_;
  Axis axis_x_;
  bool auto_x_ = true;
  bool has_initial_x_ = false;
  ph_range initial_x_{0.0, 1.0};

  /// Front element is the primary axis; the rest are secondaries in insert order.
  std::vector<YAxis> y_axes_;
  std::vector<std::unique_ptr<Layer>> layers_;

  ph_mode mode_ = PH_MODE_PAN;
  ph_pick_mode pick_ = PH_PICK_X;
  bool interactive_ = true;
  bool hover_enabled_ = true;
  /// Where the hover cursor is, in logical pixels, and whether it is inside.
  double hover_px_ = 0.0;
  double hover_py_ = 0.0;
  bool hover_inside_ = false;
  /// The last point reported picked, so an unchanged pick emits no event.
  ph_layer picked_layer_ = 0;
  int32_t picked_index_ = -1;
  bool crosshair_ = true;
  bool colorbar_ = true;
  bool tooltip_ = true;
  std::vector<render::Annotation> annotations_;
  ph_annotation_id next_annotation_id_ = 1;
  bool legend_ = false;
  ph_legend_position legend_position_ = PH_LEGEND_TOP_RIGHT;
  bool legend_horizontal_ = false;
  bool legend_interactive_ = true;
  /// Where the legend last drew, so a click can be tested against it without
  /// laying it out a second time.
  render::Rect legend_panel_{};
  bool equal_aspect_ = false;
  bool bounded_pan_ = false;

  bool panning_ = false;
  bool selecting_ = false;
  double last_px_ = 0.0;
  double last_py_ = 0.0;
  double select_x0_ = 0.0;
  double select_y0_ = 0.0;

  /// The overlay's GL buffers. Per-plot because the vertex data is per-frame;
  /// the programs and the glyph atlas behind them are process-wide.
  render::Primitives shapes_;
  text::Batch labels_;

  /// The offscreen target for render_pixels, reallocated only when the size
  /// changes — a host that streams frames to an image view calls this per frame.
  gl::GLuint offscreen_fbo_ = 0;
  gl::GLuint offscreen_texture_ = 0;
  int32_t offscreen_width_ = 0;
  int32_t offscreen_height_ = 0;

  bool needs_redraw_ = true;
  std::deque<ph_event> events_;
  std::thread::id owner_thread_ = std::this_thread::get_id();
};

}  // namespace photon
