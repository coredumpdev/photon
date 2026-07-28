#include "plot.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace photon {
namespace {

/// A queue that grows without bound is a leak in a host that forgets to poll.
/// Coalescing keeps a drag from queuing one event per mouse move anyway; this is
/// the backstop for a host that never drains at all.
constexpr size_t kMaxQueuedEvents = 256;

const char* kPrimaryY = "y";

bool same_id(const char* a, const std::string& b) {
  return a && b == a;
}

/// Pad a data range for autoscaling — linearly, or multiplicatively on a log
/// axis. Mirrors padDomain in plot.ts.
ph_range pad_domain(double min, double max, bool log, double frac) {
  if (log) {
    const double lo = min > 0.0 ? min : (max > 0.0 ? max / 1000.0 : 1e-9);
    const double hi = max > lo ? max : lo * 10.0;
    const double f = std::pow(hi / lo, frac);
    return ph_range{lo / f, hi * f};
  }
  double pad = (max - min) * frac;
  if (pad == 0.0) pad = 1.0;
  return ph_range{min - pad, max + pad};
}

/// Translate [lo,hi] so it sits within `bounds` without changing its span, so
/// zoom level and aspect survive the clamp. Mirrors clampAxis in plot.ts.
ph_range clamp_axis(ph_range domain, ph_range bounds) {
  const double span = domain.hi - domain.lo;
  if (span >= bounds.hi - bounds.lo) {
    const double lo_min = bounds.hi - span;
    const double clamped = std::min(std::max(domain.lo, lo_min), bounds.lo);
    return ph_range{clamped, clamped + span};
  }
  double clamped = std::max(domain.lo, bounds.lo);
  if (clamped + span > bounds.hi) clamped = bounds.hi - span;
  return ph_range{clamped, clamped + span};
}

}  // namespace

Plot::Plot(const ph_plot_desc& desc) {
  if (desc.width > 0) width_ = desc.width;
  if (desc.height > 0) height_ = desc.height;
  theme_ = desc.theme;

  // An all-zero margin means "unset", which is how a zero-initialized descriptor
  // reaches us from a binding. Any non-zero field opts into the whole struct.
  if (desc.margin.top != 0.0f || desc.margin.right != 0.0f ||
      desc.margin.bottom != 0.0f || desc.margin.left != 0.0f) {
    margin_ = desc.margin;
  }

  scale_x_.configure(desc.x);
  auto_x_ = desc.x.domain.lo == desc.x.domain.hi;
  if (!auto_x_) {
    has_initial_x_ = true;
    initial_x_ = ph_range{scale_x_.lo, scale_x_.hi};
  }

  YAxis primary;
  primary.id = kPrimaryY;
  primary.scale.configure(desc.y);
  primary.automatic = desc.y.domain.lo == desc.y.domain.hi;
  if (!primary.automatic) {
    primary.has_initial = true;
    primary.initial = ph_range{primary.scale.lo, primary.scale.hi};
  }
  y_axes_.push_back(std::move(primary));

  mode_ = desc.mode;
  pick_ = desc.pick;
  equal_aspect_ = desc.equal_aspect != 0;
  bounded_pan_ = desc.bounded_pan != 0;
  // Negated in the descriptor so a zero-initialized struct means "core defaults".
  interactive_ = desc.no_interaction == 0;
  hover_enabled_ = desc.no_hover == 0;
  crosshair_ = desc.no_crosshair == 0;
}

// -- geometry ---------------------------------------------------------------

void Plot::set_size(int32_t width, int32_t height) {
  width_ = width > 0 ? width : 0;
  height_ = height > 0 ? height : 0;
  request_render();
}

void Plot::set_margin(const ph_margin& margin) {
  margin_ = margin;
  request_render();
}

PlotRegion Plot::region() const {
  PlotRegion r;
  r.left = margin_.left;
  r.top = margin_.top;
  r.width = std::max(0.0, static_cast<double>(width_) - margin_.left - margin_.right);
  r.height = std::max(0.0, static_cast<double>(height_) - margin_.top - margin_.bottom);
  return r;
}

// -- axes -------------------------------------------------------------------

YAxis* Plot::find_y_axis(const char* id) {
  if (!id || !*id) return &primary_y();
  for (auto& axis : y_axes_) {
    if (same_id(id, axis.id)) return &axis;
  }
  return nullptr;
}

Scale* Plot::find_scale(const char* axis) {
  if (!axis || !*axis) return nullptr;
  if (std::strcmp(axis, "x") == 0) return &scale_x_;
  YAxis* y = find_y_axis(axis);
  return y ? &y->scale : nullptr;
}

bool Plot::set_scale(const char* axis, const ph_axis_desc& desc) {
  Scale* scale = find_scale(axis);
  if (!scale) return false;
  if (!scale->configure(desc)) return false;
  const bool automatic = desc.domain.lo == desc.domain.hi &&
                         desc.type != PH_SCALE_CATEGORICAL &&
                         desc.type != PH_SCALE_ORDINAL_TIME;
  if (std::strcmp(axis, "x") == 0) {
    auto_x_ = automatic;
  } else if (YAxis* y = find_y_axis(axis)) {
    y->automatic = automatic;
  }
  request_render();
  emit_view_changed();
  return true;
}

bool Plot::set_domain(const char* axis, ph_range domain) {
  Scale* scale = find_scale(axis);
  if (!scale) return false;
  scale->set_domain(domain.lo, domain.hi);
  // An explicit domain is a decision; the axis stops re-fitting itself.
  if (std::strcmp(axis, "x") == 0) {
    auto_x_ = false;
  } else if (YAxis* y = find_y_axis(axis)) {
    y->automatic = false;
  }
  request_render();
  emit_view_changed();
  return true;
}

bool Plot::get_domain(const char* axis, ph_range& out) const {
  const Scale* scale = const_cast<Plot*>(this)->find_scale(axis);
  if (!scale) return false;
  out = ph_range{scale->lo, scale->hi};
  return true;
}

bool Plot::add_y_axis(const char* id, const ph_axis_desc& desc, int32_t side) {
  if (!id || !*id) return false;
  if (find_y_axis(id)) return false;  // ids are unique, including "y"
  YAxis axis;
  axis.id = id;
  if (!axis.scale.configure(desc)) return false;
  axis.side = side;
  axis.automatic = desc.domain.lo == desc.domain.hi;
  if (!axis.automatic) {
    axis.has_initial = true;
    axis.initial = ph_range{axis.scale.lo, axis.scale.hi};
  }
  y_axes_.push_back(std::move(axis));
  request_render();
  return true;
}

bool Plot::remove_y_axis(const char* id) {
  if (!id || std::strcmp(id, kPrimaryY) == 0) return false;  // the primary stays
  auto it = std::find_if(y_axes_.begin(), y_axes_.end(),
                         [&](const YAxis& a) { return a.id == id; });
  if (it == y_axes_.end()) return false;
  // Layers bound to it fall back to the primary axis rather than becoming
  // orphans that no axis autoscales to and nothing ever draws.
  for (auto& layer : layers_) {
    if (layer->y_axis() == id) layer->set_y_axis(std::string());
  }
  y_axes_.erase(it);
  request_render();
  return true;
}

void Plot::autoscale() {
  const double frac = 0.05;

  if (auto_x_) {
    double lo = std::numeric_limits<double>::infinity();
    double hi = -lo;
    bool any = false;
    for (const auto& layer : layers_) {
      if (!layer->visible()) continue;
      ph_range x{}, y{};
      if (!layer->bounds(x, y)) continue;
      lo = std::min(lo, x.lo);
      hi = std::max(hi, x.hi);
      any = true;
    }
    if (any) {
      const ph_range padded = pad_domain(lo, hi, scale_x_.is_log(), frac);
      scale_x_.set_domain(padded.lo, padded.hi);
    }
  }

  for (auto& axis : y_axes_) {
    if (!axis.automatic) continue;
    double lo = std::numeric_limits<double>::infinity();
    double hi = -lo;
    bool any = false;
    for (const auto& layer : layers_) {
      if (!layer->visible()) continue;
      const bool primary = axis.id == kPrimaryY;
      const bool bound = layer->y_axis() == axis.id || (primary && layer->y_axis().empty());
      if (!bound) continue;
      ph_range x{}, y{};
      if (!layer->bounds(x, y)) continue;
      lo = std::min(lo, y.lo);
      hi = std::max(hi, y.hi);
      any = true;
    }
    if (any) {
      const ph_range padded = pad_domain(lo, hi, axis.scale.is_log(), frac);
      axis.scale.set_domain(padded.lo, padded.hi);
    }
  }

  request_render();
  emit_view_changed();
}

void Plot::reset_view() {
  if (has_initial_x_) {
    scale_x_.set_domain(initial_x_.lo, initial_x_.hi);
  } else {
    auto_x_ = true;
  }
  for (auto& axis : y_axes_) {
    if (axis.has_initial) {
      axis.scale.set_domain(axis.initial.lo, axis.initial.hi);
    } else {
      axis.automatic = true;
    }
  }
  autoscale();
}

// -- layers -----------------------------------------------------------------

Layer* Plot::add_layer(std::unique_ptr<Layer> layer) {
  layer->owner = this;
  Layer* borrowed = layer.get();
  layers_.push_back(std::move(layer));
  autoscale();
  return borrowed;
}

bool Plot::remove_layer(Layer* layer) {
  auto it = std::find_if(layers_.begin(), layers_.end(),
                         [&](const std::unique_ptr<Layer>& l) { return l.get() == layer; });
  if (it == layers_.end()) return false;
  layers_.erase(it);
  autoscale();
  return true;
}

// -- interaction ------------------------------------------------------------

Plot::AxisLock Plot::axis_lock() const {
  if (mode_ == PH_MODE_BOX_X) return {true, false};
  if (mode_ == PH_MODE_BOX_Y) return {false, true};
  return {true, true};
}

void Plot::set_mode(ph_mode mode) {
  if (mode_ == mode) return;
  mode_ = mode;
  panning_ = false;
  selecting_ = false;
  ph_event ev{};
  ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
  ev.type = PH_EVENT_MODE_CHANGED;
  ev.mode = mode;
  push_event(ev);
  request_render();
}

void Plot::pan_x(double dx_px, const PlotRegion& r) {
  if (r.width <= 0.0) return;
  // Pan in *transformed* space so a log axis pans by a constant ratio rather
  // than a constant value — same trick as panX in plot.ts.
  const double f = dx_px / r.width;
  scale_x_.set_domain(scale_x_.invert(-f), scale_x_.invert(1.0 - f));
  auto_x_ = false;
}

void Plot::pan_y(const char* id, double dy_px, const PlotRegion& r) {
  if (r.height <= 0.0) return;
  const double f = dy_px / r.height;
  for (auto& axis : y_axes_) {
    if (id && *id && axis.id != id) continue;
    axis.scale.set_domain(axis.scale.invert(f), axis.scale.invert(1.0 + f));
    axis.automatic = false;
  }
}

void Plot::pan_pixels(double dx, double dy) {
  const PlotRegion r = region();
  const AxisLock lock = axis_lock();
  if (lock.x) pan_x(dx, r);
  if (lock.y) pan_y(nullptr, dy, r);
  apply_bounds_clamp();
  request_render();
  emit_view_changed();
}

void Plot::zoom_around(double nx, double ny, double factor) {
  const AxisLock lock = axis_lock();
  if (lock.x) {
    const double t = nx * (1.0 - factor);
    scale_x_.set_domain(scale_x_.invert(t), scale_x_.invert(t + factor));
    auto_x_ = false;
  }
  if (lock.y) {
    const double t = ny * (1.0 - factor);
    for (auto& axis : y_axes_) {
      axis.scale.set_domain(axis.scale.invert(t), axis.scale.invert(t + factor));
      axis.automatic = false;
    }
  }
  apply_bounds_clamp();
  request_render();
  emit_view_changed();
}

void Plot::wheel(double px, double py, double delta_y, ph_modifiers) {
  if (!interactive_) return;
  const PlotRegion r = region();
  if (r.width <= 0.0 || r.height <= 0.0) return;
  const double nx = (px - r.left) / r.width;
  const double ny = 1.0 - (py - r.top) / r.height;
  zoom_around(nx, ny, std::exp(delta_y * 0.001));
}

void Plot::pointer_down(double px, double py, ph_button button, ph_modifiers) {
  if (!interactive_ || button != PH_BUTTON_LEFT) return;
  last_px_ = px;
  last_py_ = py;
  if (mode_ == PH_MODE_PAN) {
    panning_ = true;
  } else {
    selecting_ = true;
    select_x0_ = px;
    select_y0_ = py;
  }
  request_render();
}

void Plot::pointer_move(double px, double py, ph_modifiers) {
  if (panning_) {
    pan_pixels(px - last_px_, py - last_py_);
    last_px_ = px;
    last_py_ = py;
    return;
  }
  if (selecting_) {
    last_px_ = px;
    last_py_ = py;
    request_render();  // the host draws the selection rectangle
    return;
  }
  if (!hover_enabled_) return;

  ph_event ev{};
  ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
  ev.type = PH_EVENT_CURSOR_MOVED;
  data_at_pixel(px, py, ev.cursor_x, ev.cursor_y);
  const PlotRegion r = region();
  ev.cursor_valid = (px >= r.left && px <= r.left + r.width &&
                     py >= r.top && py <= r.top + r.height) ? 1 : 0;
  push_event(ev);
  if (crosshair_) request_render();
}

void Plot::pointer_up(double px, double py, ph_button button, ph_modifiers) {
  if (button != PH_BUTTON_LEFT) return;
  if (panning_) {
    panning_ = false;
    request_render();
    return;
  }
  if (!selecting_) return;
  selecting_ = false;

  const PlotRegion r = region();
  const double dx = std::abs(px - select_x0_);
  const double dy = std::abs(py - select_y0_);
  // A click, not a drag: zooming into a 2px box would throw the view away.
  if ((dx < 3.0 && dy < 3.0) || r.width <= 0.0 || r.height <= 0.0) {
    request_render();
    return;
  }

  const AxisLock lock = axis_lock();
  if (lock.x) {
    const double n0 = (std::min(select_x0_, px) - r.left) / r.width;
    const double n1 = (std::max(select_x0_, px) - r.left) / r.width;
    scale_x_.set_domain(scale_x_.invert(n0), scale_x_.invert(n1));
    auto_x_ = false;
  }
  if (lock.y) {
    // Screen y grows downwards, data y upwards, so the larger pixel is the lower bound.
    const double n0 = 1.0 - (std::max(select_y0_, py) - r.top) / r.height;
    const double n1 = 1.0 - (std::min(select_y0_, py) - r.top) / r.height;
    for (auto& axis : y_axes_) {
      axis.scale.set_domain(axis.scale.invert(n0), axis.scale.invert(n1));
      axis.automatic = false;
    }
  }
  apply_bounds_clamp();
  request_render();
  emit_view_changed();
}

void Plot::pointer_leave() {
  panning_ = false;
  selecting_ = false;
  if (hover_enabled_) {
    ph_event ev{};
    ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
    ev.type = PH_EVENT_CURSOR_MOVED;
    ev.cursor_valid = 0;
    push_event(ev);
  }
  request_render();
}

void Plot::data_at_pixel(double px, double py, double& out_x, double& out_y) const {
  const PlotRegion r = region();
  const double nx = r.width > 0.0 ? (px - r.left) / r.width : 0.0;
  const double ny = r.height > 0.0 ? 1.0 - (py - r.top) / r.height : 0.0;
  out_x = scale_x_.invert(nx);
  out_y = primary_y().scale.invert(ny);
}

void Plot::pixel_at_data(double x, double y, double& out_px, double& out_py) const {
  const PlotRegion r = region();
  out_px = r.left + scale_x_.norm(x) * r.width;
  out_py = r.top + (1.0 - primary_y().scale.norm(y)) * r.height;
}

// -- bounds -----------------------------------------------------------------

bool Plot::data_bounds(ph_range& x, ph_range& y) const {
  double x0 = std::numeric_limits<double>::infinity();
  double x1 = -x0;
  double y0 = x0;
  double y1 = x1;
  bool any = false;
  for (const auto& layer : layers_) {
    if (!layer->visible()) continue;
    ph_range lx{}, ly{};
    if (!layer->bounds(lx, ly)) continue;
    x0 = std::min(x0, lx.lo);
    x1 = std::max(x1, lx.hi);
    y0 = std::min(y0, ly.lo);
    y1 = std::max(y1, ly.hi);
    any = true;
  }
  if (!any) return false;
  x = ph_range{x0, x1};
  y = ph_range{y0, y1};
  return true;
}

void Plot::apply_bounds_clamp() {
  if (!bounded_pan_) return;
  ph_range bx{}, by{};
  if (!data_bounds(bx, by)) return;
  const ph_range cx = clamp_axis(ph_range{scale_x_.lo, scale_x_.hi}, bx);
  scale_x_.set_domain(cx.lo, cx.hi);
  for (auto& axis : y_axes_) {
    const ph_range cy = clamp_axis(ph_range{axis.scale.lo, axis.scale.hi}, by);
    axis.scale.set_domain(cy.lo, cy.hi);
  }
}

// -- frames and events ------------------------------------------------------

bool Plot::render(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target, std::string& error) {
  using namespace photon::gl;

  const float dpr = target.dpr > 0.0f ? target.dpr : 1.0f;
  api.BindFramebuffer(GL_FRAMEBUFFER, target.framebuffer);

  // The full widget area, then the plot region inside its margins. Both are in
  // device pixels; GL's viewport origin is bottom-left while the layout is
  // measured from the top, hence the flip when placing the region.
  const int vx = target.x;
  const int vy = target.y;
  const int vw = target.width;
  const int vh = target.height;
  if (vw <= 0 || vh <= 0) return true;

  api.Viewport(vx, vy, vw, vh);
  api.Disable(GL_DEPTH_TEST);
  api.Enable(GL_BLEND);
  // Premultiplied alpha, matching begin2D() in the web core's gl/shared.ts.
  api.BlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);

  const PlotRegion r = region();
  const int rx = vx + static_cast<int>(std::lround(r.left * dpr));
  const int rw = static_cast<int>(std::lround(r.width * dpr));
  const int rh = static_cast<int>(std::lround(r.height * dpr));
  // flip_y hosts (Qt's FBOs) measure from the top, GL from the bottom.
  const int ry = target.flip_y
                     ? vy + static_cast<int>(std::lround(r.top * dpr))
                     : vy + vh - static_cast<int>(std::lround((r.top + r.height) * dpr));
  if (rw <= 0 || rh <= 0) return true;

  // Layers draw in normalized device coords over the plot region only; the
  // scissor is what keeps a panned series out of the axis margins.
  api.Viewport(rx, ry, rw, rh);
  api.Enable(GL_SCISSOR_TEST);
  api.Scissor(rx, ry, rw, rh);

  DrawState state;
  state.api = &api;
  state.gfx = gfx;
  state.pixel_width = static_cast<double>(rw);
  state.pixel_height = static_cast<double>(rh);
  state.dpr = dpr;
  state.x = gl::AxisFrame{scale_x_.lo, scale_x_.hi, scale_x_.is_log()};

  bool ok = true;
  for (auto& layer : layers_) {
    if (!layer->visible()) continue;
    // Each layer projects against the y axis it is bound to, which is what
    // makes a secondary axis mean anything.
    const YAxis* axis = &primary_y();
    if (!layer->y_axis().empty()) {
      for (const YAxis& candidate : y_axes_) {
        if (candidate.id == layer->y_axis()) {
          axis = &candidate;
          break;
        }
      }
    }
    state.y = gl::AxisFrame{axis->scale.lo, axis->scale.hi, axis->scale.is_log()};
    if (!layer->draw(state, error)) {
      ok = false;
      break;  // the error names the layer; carrying on would overwrite it
    }
  }

  api.Disable(GL_SCISSOR_TEST);
  api.Viewport(vx, vy, vw, vh);
  return ok;
}

void Plot::release_gl(gl::Api& api) {
  for (auto& layer : layers_) layer->release_gl(api);
}

void Plot::request_render() {
  needs_redraw_ = true;
  ph_event ev{};
  ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
  ev.type = PH_EVENT_REDRAW_REQUESTED;
  push_event(ev);
}

void Plot::emit_view_changed() {
  ph_event ev{};
  ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
  ev.type = PH_EVENT_VIEW_CHANGED;
  ev.x = ph_range{scale_x_.lo, scale_x_.hi};
  ev.y = ph_range{primary_y().scale.lo, primary_y().scale.hi};
  push_event(ev);
}

void Plot::push_event(const ph_event& event) {
  // Coalesce the three high-rate kinds: a drag produces one view change per
  // mouse move, and a host only ever cares about the latest.
  const bool coalescing = event.type == PH_EVENT_VIEW_CHANGED ||
                          event.type == PH_EVENT_CURSOR_MOVED ||
                          event.type == PH_EVENT_REDRAW_REQUESTED;
  if (coalescing) {
    for (auto it = events_.rbegin(); it != events_.rend(); ++it) {
      if (it->type == event.type) {
        *it = event;
        return;
      }
    }
  }
  if (events_.size() >= kMaxQueuedEvents) events_.pop_front();
  events_.push_back(event);
}

bool Plot::poll_event(ph_event& out) {
  if (events_.empty()) {
    out = ph_event{};
    out.struct_size = static_cast<uint32_t>(sizeof(ph_event));
    out.type = PH_EVENT_NONE;
    return false;
  }
  out = events_.front();
  events_.pop_front();
  return true;
}

}  // namespace photon
