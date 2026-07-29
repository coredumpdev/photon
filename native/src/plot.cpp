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

/// Horizontal room each extra y axis takes, and the strip a title reserves
/// above the plot. Both are Y_AXIS_GAP / TITLE_RESERVE from plot.ts.
constexpr double kYAxisGap = 52.0;
constexpr double kTitleReserve = 28.0;
/// Offset from an axis line to its rotated title, from yAxisPositions().
constexpr double kYTitleOffset = 42.0;

/**
 * How far a view may be zoomed out, as a multiple of the data's own extent.
 *
 * A chart a billion times wider than its data is already a blank rectangle with
 * a hairline in it, so nothing is lost. What is gained is the way back.
 *
 * Zooming about the centre keeps the centre fixed, which means any rounding
 * error introduced in it is kept too — as an absolute offset that later
 * zoom-ins cannot shrink. Each step costs about an eps of the endpoints'
 * magnitude, so a view a billion times too wide leaves a centre error of about
 * 1e-7 of the data extent: invisible. Left unbounded it is not: reported from
 * the Qt gallery, zooming a long way out and back left the series gone for
 * good, and at that point the domain had reached 1e133 wide with a centre that
 * had drifted to 1e117 — so that when the span finally came back down to ten,
 * `lo` and `hi` rounded to the same double.
 */
constexpr double kMaxZoomOut = 1e9;

/**
 * How narrow a view may get, as a fraction of its own magnitude.
 *
 * The same collapse from the other side. Doubles near a value v are spaced
 * about v * 2.2e-16 apart, so a view narrower than that has both ends on the
 * same double — and from there `invert(t) = lo + t * 0` returns `lo` for every
 * t, so no amount of zooming back out ever moves it again. This floor leaves
 * some forty distinct values across the view: far past being able to see
 * anything, and still nowhere near a legitimate deep zoom. One millisecond on
 * an epoch-ms time axis is 6e-13 of its magnitude, comfortably above.
 */
constexpr double kMinZoomIn = 1e-14;

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

  if (desc.title) title_ = desc.title;
  background_ = desc.background;
  border_ = desc.border;

  mode_ = desc.mode;
  pick_ = desc.pick;
  equal_aspect_ = desc.equal_aspect != 0;
  bounded_pan_ = desc.bounded_pan != 0;
  // Negated in the descriptor so a zero-initialized struct means "core defaults".
  interactive_ = desc.no_interaction == 0;
  hover_enabled_ = desc.no_hover == 0;
  crosshair_ = desc.no_crosshair == 0;
  tooltip_ = desc.no_tooltip == 0;
  colorbar_ = desc.no_colorbar == 0;
  legend_ = desc.legend != 0;
  legend_position_ = desc.legend_position;
  legend_horizontal_ = desc.legend_horizontal != 0;
  legend_interactive_ = desc.legend_static == 0;
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

void Plot::set_title(const char* title) {
  title_ = title ? title : "";
  request_render();
}

ph_annotation_id Plot::add_annotation(const ph_annotation& in) {
  render::Annotation out;
  out.type = in.type;
  out.dim = in.dim;
  out.x0 = in.x0;
  out.y0 = in.y0;
  out.x1 = in.x1;
  out.y1 = in.y1;
  out.high = in.high;
  out.low = in.low;
  if (in.ratios && in.ratio_count > 0) {
    out.ratios.assign(in.ratios, in.ratios + in.ratio_count);
  }
  out.color = in.color;
  out.border = in.border;
  out.width = in.width;
  if (in.dash && in.dash_count > 0) out.dash.assign(in.dash, in.dash + in.dash_count);
  if (in.label) out.label = in.label;
  if (in.text) out.text = in.text;
  out.dx = in.dx;
  out.dy = in.dy;
  out.align = in.align;
  out.baseline = in.baseline;
  out.size = in.size;
  out.fill = in.fill != 0;
  if (in.y_axis) out.y_axis = in.y_axis;
  out.id = next_annotation_id_++;
  annotations_.push_back(std::move(out));
  request_render();
  return annotations_.back().id;
}

bool Plot::remove_annotation(ph_annotation_id id) {
  for (size_t i = 0; i < annotations_.size(); ++i) {
    if (annotations_[i].id != id) continue;
    annotations_.erase(annotations_.begin() + static_cast<ptrdiff_t>(i));
    request_render();
    return true;
  }
  return false;
}

void Plot::clear_annotations() {
  if (annotations_.empty()) return;
  annotations_.clear();
  request_render();
}

std::vector<Layer*> Plot::legend_layers() const {
  std::vector<Layer*> out;
  if (!legend_) return out;
  // Only layers the caller named: an unnamed one is a builder's helper — a
  // fill under a line, a raw series behind a smoothed one — and listing it
  // would be clutter the caller never asked for.
  for (const std::unique_ptr<Layer>& layer : layers_) {
    if (layer && !layer->name().empty()) out.push_back(layer.get());
  }
  return out;
}

std::vector<render::ColorbarEntry> Plot::color_scales() const {
  std::vector<render::ColorbarEntry> out;
  if (!colorbar_) return out;
  for (const std::unique_ptr<Layer>& layer : layers_) {
    if (!layer || !layer->visible()) continue;
    ColorInfo info;
    if (!layer->color_info(info)) continue;
    out.push_back(render::ColorbarEntry{info.lut, info.domain, std::move(info.label)});
  }
  return out;
}

ph_margin Plot::compute_margin() const {
  int left_count = 0;
  int right_count = 0;
  for (const YAxis& axis : y_axes_) {
    if (axis.side == 0) {
      ++left_count;
    } else {
      ++right_count;
    }
  }
  // Port of computeMargin(): the first left axis sits on the region's own edge,
  // so only the ones beyond it widen the margin.
  ph_margin out = margin_;
  out.top += title_.empty() ? 0.0f : static_cast<float>(kTitleReserve);
  out.left += static_cast<float>(std::max(0, left_count - 1) * kYAxisGap);
  out.right += static_cast<float>(right_count * kYAxisGap);
  if (!color_scales().empty()) out.right += static_cast<float>(render::kColorbarGap);
  return out;
}

PlotRegion Plot::region() const {
  const ph_margin margin = compute_margin();
  PlotRegion r;
  r.left = margin.left;
  r.top = margin.top;
  r.width = std::max(0.0, static_cast<double>(width_) - margin.left - margin.right);
  r.height = std::max(0.0, static_cast<double>(height_) - margin.top - margin.bottom);
  return r;
}

std::vector<render::YAxisPlacement> Plot::y_axis_placements(const PlotRegion& r) const {
  std::vector<render::YAxisPlacement> out;
  out.reserve(y_axes_.size());
  int left_index = 0;
  int right_index = 0;
  for (const YAxis& axis : y_axes_) {
    render::YAxisPlacement place;
    if (axis.side == 0) {
      place.x = r.left - left_index * kYAxisGap;
      place.title_x = place.x - kYTitleOffset;
      place.right_side = false;
      ++left_index;
    } else {
      place.x = r.left + r.width + right_index * kYAxisGap;
      place.title_x = place.x + kYTitleOffset;
      place.right_side = true;
      ++right_index;
    }
    out.push_back(place);
  }
  return out;
}

void Plot::apply_aspect(const PlotRegion& r) {
  // Port of applyAspect(). A log axis has no constant units-per-pixel, so the
  // whole idea is undefined there and the web core bails out the same way.
  if (scale_x_.is_log()) return;
  YAxis& primary = primary_y();
  if (primary.scale.is_log()) return;
  if (r.width <= 0.0 || r.height <= 0.0) return;

  const double upp_x = (scale_x_.hi - scale_x_.lo) / r.width;
  const double upp_y = (primary.scale.hi - primary.scale.lo) / r.height;
  if (upp_x <= 0.0 || upp_y <= 0.0) return;
  if (std::abs(upp_x - upp_y) <= 1e-9 * std::max(upp_x, upp_y)) return;  // already balanced

  if (upp_x > upp_y) {
    const double target = upp_x * r.height;
    const double centre = (primary.scale.lo + primary.scale.hi) / 2.0;
    primary.scale.set_domain(centre - target / 2.0, centre + target / 2.0);
  } else {
    const double target = upp_y * r.width;
    const double centre = (scale_x_.lo + scale_x_.hi) / 2.0;
    scale_x_.set_domain(centre - target / 2.0, centre + target / 2.0);
  }
}

// -- axes -------------------------------------------------------------------

YAxis* Plot::find_y_axis(const char* id) {
  if (!id || !*id) return &primary_y();
  for (auto& axis : y_axes_) {
    if (same_id(id, axis.id)) return &axis;
  }
  return nullptr;
}

Axis* Plot::find_axis(const char* id) {
  if (!id || !*id) return nullptr;
  if (std::strcmp(id, "x") == 0) return &axis_x_;
  YAxis* y = find_y_axis(id);
  return y ? &y->axis : nullptr;
}

bool Plot::set_axis_config(const char* axis, const ph_axis_config* desc) {
  Axis* target = find_axis(axis);
  if (!target) return false;
  target->set_config(desc ? render::AxisConfig::from(*desc) : render::AxisConfig{});
  request_render();
  return true;
}

bool Plot::set_axis_ticks(const char* axis, const ph_tick* ticks, int32_t count) {
  Axis* target = find_axis(axis);
  if (!target) return false;
  std::vector<Tick> out;
  if (ticks && count > 0) {
    out.reserve(static_cast<size_t>(count));
    for (int32_t i = 0; i < count; ++i) {
      Tick tick;
      tick.value = ticks[i].value;
      if (ticks[i].label) tick.label = ticks[i].label;
      tick.minor = ticks[i].minor != 0;
      // The default follows the tick's own weight, which is what `?? !t.minor`
      // does in the web core; the toggle exists to override it either way.
      tick.grid = ticks[i].grid == PH_TOGGLE_DEFAULT ? !tick.minor
                                                     : ticks[i].grid == PH_TOGGLE_ON;
      out.push_back(std::move(tick));
    }
  }
  target->set_explicit_ticks(std::move(out));
  request_render();
  return true;
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
  if (!scale->set_domain(domain.lo, domain.hi)) return false;
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
  // The two fractions differ, and the asymmetry is deliberate rather than a
  // typo in plot.ts: an x axis is usually time or an index and wants to fill
  // the width, while a value axis wants headroom above and below the series so
  // a peak does not touch the frame. Getting this wrong is invisible in a unit
  // test — the padding cascades into a different tick step, and the chart is
  // simply *different* rather than broken, which is how it survived until the
  // native and web galleries were compared as images.
  constexpr double kPadX = 0.02;
  constexpr double kPadY = 0.05;

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
      const ph_range padded = pad_domain(lo, hi, scale_x_.is_log(), kPadX);
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
      const ph_range padded = pad_domain(lo, hi, axis.scale.is_log(), kPadY);
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

bool Plot::zoom_fits(const Scale& scale, double lo, double hi, const ph_range* data) {
  if (!std::isfinite(lo) || !std::isfinite(hi) || !std::isfinite(hi - lo)) return false;

  const double span = std::abs(hi - lo);
  const double magnitude = std::max(std::abs(lo), std::abs(hi));
  if (!(span > magnitude * kMinZoomIn)) return false;

  // A log axis zooms in log space, where the numbers stay within a few hundred
  // and precision is not the problem. Its failure mode is pow() overflowing,
  // which the finite check above already catches.
  if (scale.is_log() || !data) return true;
  const double extent = data->hi - data->lo;
  if (!(extent > 0.0)) return true;
  return span <= kMaxZoomOut * extent;
}

void Plot::zoom_around(double nx, double ny, double factor) {
  const AxisLock lock = axis_lock();
  ph_range data_x{}, data_y{};
  const bool have_data = data_bounds(data_x, data_y);

  if (lock.x) {
    const double t = nx * (1.0 - factor);
    const double lo = scale_x_.invert(t);
    const double hi = scale_x_.invert(t + factor);
    if (zoom_fits(scale_x_, lo, hi, have_data ? &data_x : nullptr)) {
      scale_x_.set_domain(lo, hi);
      auto_x_ = false;
    }
  }
  if (lock.y) {
    const double t = ny * (1.0 - factor);
    for (auto& axis : y_axes_) {
      const double lo = axis.scale.invert(t);
      const double hi = axis.scale.invert(t + factor);
      if (zoom_fits(axis.scale, lo, hi, have_data ? &data_y : nullptr)) {
        axis.scale.set_domain(lo, hi);
        axis.automatic = false;
      }
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

bool Plot::legend_click(double px, double py) {
  if (!legend_ || !legend_interactive_) return false;
  if (px < legend_panel_.left || px > legend_panel_.right()) return false;
  if (py < legend_panel_.top || py > legend_panel_.bottom()) return false;

  const std::vector<Layer*> layers = legend_layers();
  if (layers.empty()) return false;
  std::vector<render::LegendEntry> entries;
  for (const Layer* layer : layers) {
    entries.push_back(
        render::LegendEntry{layer->name(), unpack_color(layer->color()), layer->visible()});
  }
  // The panel was laid out against the same measurements last frame, so
  // measuring the rows again reproduces it — the alternative is caching a
  // rectangle per row, which is more state to keep honest for no benefit. The
  // painter here draws nothing; it is only asked for text widths.
  render::Primitives shapes;
  text::Batch labels;
  render::Painter painter(shapes, labels, 1.0f);
  for (size_t i = 0; i < layers.size(); ++i) {
    const render::Rect row = render::legend_row_rect(legend_panel_, i, layers.size(),
                                                     legend_horizontal_, entries, painter);
    if (px < row.left || px > row.left + row.width) continue;
    if (py < row.top || py > row.top + row.height) continue;
    layers[i]->set_visible(!layers[i]->visible());
    // The axes re-fit to what is left, which is what the web core does and what
    // makes hiding the tall series useful rather than merely tidy.
    autoscale();
    ph_event ev{};
    ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
    ev.type = PH_EVENT_LAYER_VISIBILITY;
    ev.layer = layers[i]->handle;
    ev.visible = layers[i]->visible() ? 1 : 0;
    push_event(ev);
    request_render();
    return true;
  }
  // Inside the panel but between rows: still the legend's click, not the plot's.
  return true;
}

void Plot::pointer_down(double px, double py, ph_button button, ph_modifiers) {
  if (button == PH_BUTTON_LEFT && legend_click(px, py)) return;
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

  hover_px_ = px;
  hover_py_ = py;
  hover_inside_ = ev.cursor_valid != 0;
  update_pick();
  // The hover crosshair and its markers are drawn, so every move is a frame.
  request_render();
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
    hover_inside_ = false;
    update_pick();
  }
  request_render();
}

std::vector<Plot::Hit> Plot::hover_hits() const {
  std::vector<Hit> hits;
  if (!hover_enabled_ || !hover_inside_) return hits;
  const PlotRegion r = region();
  if (r.width <= 0.0 || r.height <= 0.0) return hits;

  const PickMode mode = pick_ == PH_PICK_Y   ? PickMode::Y
                        : pick_ == PH_PICK_XY ? PickMode::XY
                                              : PickMode::X;
  for (const std::unique_ptr<Layer>& layer : layers_) {
    if (!layer || !layer->visible()) continue;
    const YAxis* axis = &primary_y();
    if (!layer->y_axis().empty()) {
      for (const YAxis& candidate : y_axes_) {
        if (candidate.id == layer->y_axis()) {
          axis = &candidate;
          break;
        }
      }
    }
    PickProjection project;
    project.x_left = r.left;
    project.x_width = r.width;
    project.y_top = r.top;
    project.y_height = r.height;
    project.scale_x = &scale_x_;
    project.scale_y = &axis->scale;

    Picked hit;
    if (!layer->pick(mode, hover_px_, hover_py_, project, hit)) continue;
    hits.push_back(Hit{layer.get(), hit, project.project_x(hit.x), project.project_y(hit.y)});
  }
  return hits;
}

void Plot::update_pick() {
  if (!hover_enabled_) return;
  const std::vector<Hit> hits = hover_hits();

  // The first layer to report wins, which is draw order — the same rule the web
  // core's tooltip header uses.
  ph_layer layer_handle = 0;
  int32_t index = -1;
  double x = 0.0;
  double y = 0.0;
  if (!hits.empty()) {
    layer_handle = hits.front().layer->handle;
    index = hits.front().point.index;
    x = hits.front().point.x;
    y = hits.front().point.y;
  }
  // Only on a change: a host drawing a tooltip should not have to filter a
  // stream of identical events, and a mouse move is many events a second.
  if (layer_handle == picked_layer_ && index == picked_index_) return;
  picked_layer_ = layer_handle;
  picked_index_ = index;

  ph_event ev{};
  ev.struct_size = static_cast<uint32_t>(sizeof(ph_event));
  ev.type = PH_EVENT_POINT_PICKED;
  ev.layer = layer_handle;
  ev.point_x = x;
  ev.point_y = y;
  ev.point_index = index;
  ev.point_valid = index >= 0 ? 1 : 0;
  push_event(ev);
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

/**
 * The whole of `ph_frame_target.flip_y`, in one place.
 *
 * Faz 0 assumed Qt would need this, and split the handling across the plot
 * region's placement and the overlay's pixel transform. Faz 2 proved the
 * assumption wrong twice over: Qt's FBOs are ordinary bottom-left-origin GL
 * framebuffers (what it needs is `QQuickFramebufferObject::setMirrorVertically`,
 * its own knob), and the split handling was *incorrect* anyway — it flipped the
 * axes and labels while the layers went on drawing upright, which would have
 * produced right-way-up axes over upside-down data.
 *
 * So the frame is drawn upright into a private target and blitted out flipped.
 * One GL call, no shader knows about it, and no layer added in Faz 4 can forget
 * to honour it. The blit overwrites rather than blends, which is right for the
 * only case that asks for a flip: a framebuffer the host handed us outright.
 */
bool Plot::render(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target, std::string& error) {
  using namespace photon::gl;

  if (!target.flip_y) return render_upright(api, gfx, target, error);
  if (target.width <= 0 || target.height <= 0) return true;

  if (!ensure_offscreen(api, target.width, target.height, error)) return false;

  ph_frame_target upright = target;
  upright.framebuffer = offscreen_fbo_;
  upright.x = 0;
  upright.y = 0;
  upright.flip_y = 0;

  api.BindFramebuffer(GL_FRAMEBUFFER, offscreen_fbo_);
  api.Disable(GL_SCISSOR_TEST);
  api.Viewport(0, 0, target.width, target.height);
  api.ClearColor(0.0f, 0.0f, 0.0f, 0.0f);
  api.Clear(GL_COLOR_BUFFER_BIT);
  if (!render_upright(api, gfx, upright, error)) return false;

  // Reading the source bottom-to-top is what performs the flip.
  api.BindFramebuffer(GL_READ_FRAMEBUFFER, offscreen_fbo_);
  api.BindFramebuffer(GL_DRAW_FRAMEBUFFER, target.framebuffer);
  api.BlitFramebuffer(0, target.height, target.width, 0, target.x, target.y,
                      target.x + target.width, target.y + target.height, GL_COLOR_BUFFER_BIT,
                      GL_NEAREST);
  api.BindFramebuffer(GL_FRAMEBUFFER, target.framebuffer);
  return true;
}

bool Plot::render_upright(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target,
                          std::string& error) {
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
  api.Disable(GL_SCISSOR_TEST);
  api.Enable(GL_BLEND);
  // Premultiplied alpha, matching begin2D() in the web core's gl/shared.ts.
  api.BlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);

  // Same order as render() in plot.ts: aspect, bounds clamp, then ticks and
  // styles resolved once and reused by the grid and the axes.
  PlotRegion r = region();
  if (equal_aspect_) {
    apply_aspect(r);
    r = region();
  }
  if (bounded_pan_) apply_bounds_clamp();

  YAxis& primary = primary_y();
  const std::vector<Tick>& ticks_x = axis_x_.resolve(scale_x_);
  const std::vector<Tick>& ticks_y = primary.axis.resolve(primary.scale);
  const render::AxisStyle style_x = render::resolve_axis_style(axis_x_.config, theme_);
  const render::AxisStyle style_y = render::resolve_axis_style(primary.axis.config, theme_);

  const render::Rect rect{r.left, r.top, r.width, r.height};
  const PixelTransform pixels = PixelTransform::of(vw, vh);
  render::Painter painter(shapes_, labels_, dpr);

  // 1. Behind the data: the two fills and the grid.
  if (border_ != PH_COLOR_AUTO) {
    painter.fill(0.0, 0.0, static_cast<double>(width_), static_cast<double>(height_),
                 unpack_color_exact(border_));
  }
  if (background_ != PH_COLOR_AUTO) {
    painter.fill(r.left, r.top, r.width, r.height, unpack_color_exact(background_));
  }
  // Only the x and primary-y grids are drawn, so a secondary axis does not
  // double the lines — the same choice the web core makes.
  render::draw_grid(painter, rect, scale_x_, primary.scale, ticks_x, ticks_y, style_x, style_y);
  if (!shapes_.flush(api, gfx, pixels, error)) return false;

  // 2. The data itself, scissored to the plot region.
  const int rx = vx + static_cast<int>(std::lround(r.left * dpr));
  const int rw = static_cast<int>(std::lround(r.width * dpr));
  const int rh = static_cast<int>(std::lround(r.height * dpr));
  // The layout measures from the top, GL's viewport from the bottom.
  const int ry = vy + vh - static_cast<int>(std::lround((r.top + r.height) * dpr));
  bool ok = true;
  if (rw > 0 && rh > 0) {
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

    for (auto& layer : layers_) {
      if (!layer->visible()) continue;
      // Each layer projects against the y axis it is bound to, which is what
      // makes a secondary axis mean anything.
      const YAxis* axis = &primary;
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

    // Annotations sit above the data and below the axis chrome, and they get
    // their own flush *inside* the scissor: a ray is deliberately extended
    // 8000 px past its second point, so without the clip one would paint over
    // the axes, the title and everything else on the canvas.
    api.Viewport(vx, vy, vw, vh);
    if (!annotations_.empty()) {
      for (const render::Annotation& annotation : annotations_) {
        const YAxis* axis = &primary;
        if (!annotation.y_axis.empty()) {
          for (const YAxis& candidate : y_axes_) {
            if (candidate.id == annotation.y_axis) {
              axis = &candidate;
              break;
            }
          }
        }
        render::AnnotationScales scales;
        scales.x = &scale_x_;
        scales.y = &axis->scale;
        render::draw_annotation(painter, rect, annotation, scales, theme_);
      }
      if (!shapes_.flush(api, gfx, pixels, error)) return false;
      if (!labels_.flush(api, gfx, pixels, error)) return false;
    }

    api.Disable(GL_SCISSOR_TEST);
  }
  if (!ok) return false;

  // 3. Over the data: axes, guides and the title.
  render::draw_x_axis(painter, rect, scale_x_, ticks_x, style_x, axis_x_.config.title);

  const std::vector<render::YAxisPlacement> placements = y_axis_placements(r);
  for (size_t i = 0; i < y_axes_.size(); ++i) {
    YAxis& axis = y_axes_[i];
    const std::vector<Tick>& ticks = axis.axis.resolve(axis.scale);
    const render::AxisStyle style =
        &axis == &primary ? style_y : render::resolve_axis_style(axis.axis.config, theme_);
    render::draw_y_axis(painter, rect, axis.scale, ticks, style, axis.axis.config.title,
                        placements[i]);
  }

  if (selecting_) {
    const AxisLock lock = axis_lock();
    render::draw_selection(painter, rect, select_x0_, select_y0_, last_px_, last_py_, lock.x,
                           lock.y);
  } else if (crosshair_ && panning_) {
    render::draw_crosshair_xy(painter, rect, last_px_, last_py_, theme_);
  } else if (hover_enabled_ && hover_inside_) {
    // Hover: the full crosshair when it is on, the vertical guide otherwise —
    // and a marker on whatever each layer says is nearest.
    if (crosshair_) {
      render::draw_crosshair_xy(painter, rect, hover_px_, hover_py_, theme_);
    } else {
      render::draw_crosshair(painter, rect, hover_px_, theme_);
    }
    const std::vector<Hit> hits = hover_hits();
    for (const Hit& hit : hits) {
      render::draw_marker(painter, hit.px, hit.py, unpack_color(hit.layer->color()));
    }
    if (tooltip_) {
      // The header is the cursor's x through the axis's own formatter, so a
      // time axis reads as a date and a categorical one as its factor.
      double data_x = 0.0;
      double data_y = 0.0;
      data_at_pixel(hover_px_, hover_py_, data_x, data_y);
      std::vector<render::TooltipRow> rows;
      rows.push_back(render::TooltipRow{"x = " + scale_x_.format_tick(data_x), Rgba{}, false});
      for (const Hit& hit : hits) {
        // Unnamed layers are builder helpers; naming one "line-3" in a tooltip
        // would be worse than leaving it out.
        if (hit.layer->name().empty()) continue;
        const YAxis* axis = &primary_y();
        for (const YAxis& candidate : y_axes_) {
          if (candidate.id == hit.layer->y_axis()) {
            axis = &candidate;
            break;
          }
        }
        rows.push_back(render::TooltipRow{
            hit.layer->name() + ": " + axis->scale.format_tick(hit.point.y),
            unpack_color(hit.layer->color()), true});
      }
      const render::Rect bounds{0.0, 0.0, static_cast<double>(width_),
                                static_cast<double>(height_)};
      render::draw_tooltip(painter, bounds, hover_px_, hover_py_, rows, theme_);
    }
  }

  int right_axes = 0;
  for (const YAxis& axis : y_axes_) {
    if (axis.side != 0) ++right_axes;
  }
  render::draw_colorbars(painter, rect, color_scales(), right_axes, theme_);

  legend_panel_ = render::Rect{};
  if (legend_) {
    std::vector<render::LegendEntry> entries;
    for (const Layer* layer : legend_layers()) {
      entries.push_back(
          render::LegendEntry{layer->name(), unpack_color(layer->color()), layer->visible()});
    }
    legend_panel_ =
        render::draw_legend(painter, rect, entries, legend_position_, legend_horizontal_, theme_);
  }

  render::draw_title(painter, rect, title_, theme_);

  if (!shapes_.flush(api, gfx, pixels, error)) return false;
  if (!labels_.flush(api, gfx, pixels, error)) return false;
  return true;
}

bool Plot::ensure_offscreen(gl::Api& api, int32_t width, int32_t height, std::string& error) {
  using namespace photon::gl;

  if (offscreen_fbo_ == 0) {
    api.GenFramebuffers(1, &offscreen_fbo_);
    api.GenTextures(1, &offscreen_texture_);
    if (offscreen_fbo_ == 0 || offscreen_texture_ == 0) {
      error = "failed to create the offscreen framebuffer";
      return false;
    }
  }
  if (width == offscreen_width_ && height == offscreen_height_) return true;

  api.BindTexture(GL_TEXTURE_2D, offscreen_texture_);
  api.TexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(GL_RGBA8), width, height, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, static_cast<GLint>(GL_NEAREST));
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, static_cast<GLint>(GL_NEAREST));
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, static_cast<GLint>(GL_CLAMP_TO_EDGE));
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, static_cast<GLint>(GL_CLAMP_TO_EDGE));
  api.BindFramebuffer(GL_FRAMEBUFFER, offscreen_fbo_);
  api.FramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, offscreen_texture_,
                           0);
  // No depth or stencil: the 2D path disables the depth test, and a renderbuffer
  // nobody reads is a few megabytes of nothing at 4K.
  if (api.CheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    api.BindFramebuffer(GL_FRAMEBUFFER, 0);
    offscreen_width_ = offscreen_height_ = 0;
    error = "the offscreen framebuffer is incomplete — RGBA8 render targets may be unsupported";
    return false;
  }
  offscreen_width_ = width;
  offscreen_height_ = height;
  return true;
}

void Plot::release_offscreen(gl::Api& api) {
  if (offscreen_fbo_ == 0) return;
  api.DeleteFramebuffers(1, &offscreen_fbo_);
  api.DeleteTextures(1, &offscreen_texture_);
  offscreen_fbo_ = 0;
  offscreen_texture_ = 0;
  offscreen_width_ = offscreen_height_ = 0;
}

bool Plot::render_pixels(gl::Api& api, ph_gfx_api gfx, int32_t width, int32_t height, float dpr,
                         uint8_t* out_rgba, int32_t stride_bytes, std::string& error) {
  using namespace photon::gl;

  const float scale = dpr > 0.0f ? dpr : 1.0f;
  if (!ensure_offscreen(api, width, height, error)) return false;

  // The layout runs at the logical size the caller implied, then is restored:
  // asking for an image must not resize the plot the host is interacting with.
  const int32_t saved_width = width_;
  const int32_t saved_height = height_;
  width_ = static_cast<int32_t>(std::lround(static_cast<double>(width) / scale));
  height_ = static_cast<int32_t>(std::lround(static_cast<double>(height) / scale));

  api.BindFramebuffer(GL_FRAMEBUFFER, offscreen_fbo_);
  api.Disable(GL_SCISSOR_TEST);
  api.Viewport(0, 0, width, height);
  api.ClearColor(0.0f, 0.0f, 0.0f, 0.0f);
  api.Clear(GL_COLOR_BUFFER_BIT);

  ph_frame_target target{};
  target.struct_size = static_cast<uint32_t>(sizeof(ph_frame_target));
  target.framebuffer = offscreen_fbo_;
  target.width = width;
  target.height = height;
  target.dpr = scale;
  target.flip_y = 0;  // a plain GL target; the rows are flipped on the way out
  const bool ok = render(api, gfx, target, error);

  width_ = saved_width;
  height_ = saved_height;
  if (!ok) {
    api.BindFramebuffer(GL_FRAMEBUFFER, 0);
    return false;
  }

  const size_t row_bytes = static_cast<size_t>(width) * 4;
  std::vector<uint8_t> pixels(row_bytes * static_cast<size_t>(height));
  api.PixelStorei(GL_PACK_ALIGNMENT, 1);
  api.ReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
  api.BindFramebuffer(GL_FRAMEBUFFER, 0);

  // GL hands back the bottom row first; every image consumer wants the top one.
  for (int32_t y = 0; y < height; ++y) {
    const size_t source = static_cast<size_t>(height - 1 - y) * row_bytes;
    std::memcpy(out_rgba + static_cast<size_t>(y) * static_cast<size_t>(stride_bytes),
                pixels.data() + source, row_bytes);
  }
  return true;
}

void Plot::release_gl(gl::Api& api) {
  for (auto& layer : layers_) layer->release_gl(api);
  shapes_.release_gl(api);
  labels_.release_gl(api);
  release_offscreen(api);
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
