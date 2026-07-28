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

#include "layer.hpp"
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
  /// 0 = left, 1 = right. Secondary axes default to the right.
  int32_t side = 0;
  /// True while the axis re-fits itself to the data; any explicit domain clears it.
  bool automatic = true;
  /// Domain at creation, for reset_view. Absent when the axis started automatic.
  bool has_initial = false;
  ph_range initial{0.0, 1.0};
};

class Plot {
 public:
  explicit Plot(const ph_plot_desc& desc);

  // -- geometry ----------------------------------------------------------
  void set_size(int32_t width, int32_t height);
  void set_margin(const ph_margin& margin);
  void set_theme(ph_theme theme) { theme_ = theme; request_render(); }
  PlotRegion region() const;

  // -- axes --------------------------------------------------------------
  /// Look up "x", "y", or a named y axis. nullptr when there is no such axis.
  Scale* find_scale(const char* axis);
  YAxis* find_y_axis(const char* id);
  bool set_scale(const char* axis, const ph_axis_desc& desc);
  bool set_domain(const char* axis, ph_range domain);
  bool get_domain(const char* axis, ph_range& out) const;
  bool add_y_axis(const char* id, const ph_axis_desc& desc, int32_t side);
  bool remove_y_axis(const char* id);
  void autoscale();
  void reset_view();

  // -- layers ------------------------------------------------------------
  /// Takes ownership; returns a borrowed pointer for the handle table.
  Layer* add_layer(std::unique_ptr<Layer> layer);
  bool remove_layer(Layer* layer);
  const std::vector<std::unique_ptr<Layer>>& layers() const { return layers_; }

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

  YAxis& primary_y() { return y_axes_.front(); }
  const YAxis& primary_y() const { return y_axes_.front(); }

  void pan_x(double dx_px, const PlotRegion& r);
  void pan_y(const char* id, double dy_px, const PlotRegion& r);

  /// Union of every visible layer's extent. False when nothing has data.
  bool data_bounds(ph_range& x, ph_range& y) const;
  /// Keep the view inside the data when bounded_pan is on.
  void apply_bounds_clamp();

  void emit_view_changed();
  void push_event(const ph_event& event);

  int32_t width_ = 640;
  int32_t height_ = 400;
  ph_margin margin_{16.0f, 16.0f, 40.0f, 56.0f};
  ph_theme theme_ = PH_THEME_DARK;

  Scale scale_x_;
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
  bool crosshair_ = true;
  bool equal_aspect_ = false;
  bool bounded_pan_ = false;

  bool panning_ = false;
  bool selecting_ = false;
  double last_px_ = 0.0;
  double last_py_ = 0.0;
  double select_x0_ = 0.0;
  double select_y0_ = 0.0;

  bool needs_redraw_ = true;
  std::deque<ph_event> events_;
  std::thread::id owner_thread_ = std::this_thread::get_id();
};

}  // namespace photon
