#include "render/overlay.hpp"

#include <algorithm>
#include <cmath>

#include "scale.hpp"

namespace photon::render {
namespace {

constexpr double kPi = 3.14159265358979323846;

/// Distance from the plot's bottom edge to the x axis title, from drawXAxis().
constexpr double kXTitleOffset = 34.0;

/// The box-zoom rectangle, from the selectionDiv styling in plot.ts:
/// background rgba(59,130,246,0.15), border 1px rgba(59,130,246,0.9).
constexpr ph_color kSelectionFill = 0x3b82f626u;
constexpr ph_color kSelectionEdge = 0x3b82f6e6u;

/// The plot title's size and weight, from drawTitle()'s "600 15px system-ui".
constexpr double kTitleSize = 15.0;
/// The SDF outline offset that stands in for weight 600. See text::Style::bold.
constexpr float kTitleBold = 0.28f;

/// Canvas strokes a path centred on its coordinate, so a crisp hairline sits on
/// a half-integer. Every position below goes through this, exactly as the web's
/// `Math.round(x) + 0.5` does.
double crisp(double v) {
  return std::round(v) + 0.5;
}

}  // namespace

// -- Painter ----------------------------------------------------------------

void Painter::fill(double x, double y, double w, double h, Rgba color) {
  const double d = dpr_;
  const float x0 = static_cast<float>(std::round(x * d));
  const float y0 = static_cast<float>(std::round(y * d));
  const float x1 = static_cast<float>(std::round((x + w) * d));
  const float y1 = static_cast<float>(std::round((y + h) * d));
  shapes_->rect(x0, y0, x1 - x0, y1 - y0, color);
}

void Painter::hairline(bool vertical, double pos, double from, double to, double width,
                       Rgba color) {
  const double d = dpr_;
  shapes_->hairline(vertical, static_cast<float>(pos * d), static_cast<float>(from * d),
                    static_cast<float>(to * d), static_cast<float>(width * d), color);
}

void Painter::dashed(bool vertical, double pos, double from, double to, double width,
                     const std::vector<float>& dash, Rgba color) {
  const double d = dpr_;
  std::vector<float> scaled;
  scaled.reserve(dash.size());
  for (const float v : dash) scaled.push_back(v * static_cast<float>(d));
  shapes_->dashed_hairline(vertical, static_cast<float>(pos * d), static_cast<float>(from * d),
                           static_cast<float>(to * d), static_cast<float>(width * d), scaled,
                           color);
}

void Painter::label(const std::string& utf8, double x, double y, text::Align align,
                    text::Baseline baseline, Rgba color, double size, double rotation_degrees,
                    float bold) {
  if (utf8.empty() || size <= 0.0) return;
  text::Style style;
  style.px = static_cast<float>(size * dpr_);
  style.color = color;
  style.rotation = static_cast<float>(rotation_degrees * kPi / 180.0);
  style.bold = bold;
  labels_->add(utf8, static_cast<float>(x * dpr_), static_cast<float>(y * dpr_), align, baseline,
               style);
}

double Painter::measure(const std::string& utf8, double size) const {
  if (utf8.empty() || size <= 0.0) return 0.0;
  return static_cast<double>(text::measure(utf8, static_cast<float>(size * dpr_))) / dpr_;
}

// -- geometry ---------------------------------------------------------------

double px_x(const Rect& region, double t) {
  return region.left + t * region.width;
}

double px_y(const Rect& region, double t) {
  // t is normalized bottom->top; screen y grows downward.
  return region.top + (1.0 - t) * region.height;
}

// -- grid and axes ----------------------------------------------------------

void draw_grid(Painter& painter, const Rect& region, const Scale& scale_x, const Scale& scale_y,
               const std::vector<Tick>& ticks_x, const std::vector<Tick>& ticks_y,
               const AxisStyle& style_x, const AxisStyle& style_y) {
  if (style_x.show_grid) {
    for (const Tick& tick : ticks_x) {
      if (!tick.grid) continue;
      const Rgba color = tick.minor ? style_x.grid_minor_color : style_x.grid_color;
      painter.dashed(true, crisp(px_x(region, scale_x.norm(tick.value))), region.top,
                     region.bottom(), style_x.grid_width, style_x.grid_dash, color);
    }
  }
  if (style_y.show_grid) {
    for (const Tick& tick : ticks_y) {
      if (!tick.grid) continue;
      const Rgba color = tick.minor ? style_y.grid_minor_color : style_y.grid_color;
      painter.dashed(false, crisp(px_y(region, scale_y.norm(tick.value))), region.left,
                     region.right(), style_y.grid_width, style_y.grid_dash, color);
    }
  }
}

void draw_x_axis(Painter& painter, const Rect& region, const Scale& scale,
                 const std::vector<Tick>& ticks, const AxisStyle& style, const std::string& title) {
  const double bottom = region.bottom();

  if (style.show_axis_line) {
    painter.hairline(false, bottom + 0.5, region.left, region.right(), style.axis_line_width,
                     style.axis_line_color);
  }

  for (const Tick& tick : ticks) {
    const double x = crisp(px_x(region, scale.norm(tick.value)));
    const double length = tick.minor ? style.tick_minor_length : style.tick_length;
    if (style.show_ticks) {
      painter.hairline(true, x, bottom, bottom + length, style.tick_width, style.tick_color);
    }
    if (tick.label.empty()) continue;

    const double y = bottom + (style.show_ticks ? length : 0.0) + style.label_standoff;
    if (style.label_rotation != 0.0f) {
      // Rotated about the tick and right-aligned, so labels trail down-left and
      // a long one cannot collide with its neighbour.
      painter.label(tick.label, x, y, text::Align::Right, text::Baseline::Middle,
                    style.label_color, style.label_size, style.label_rotation);
    } else {
      painter.label(tick.label, x, y, text::Align::Center, text::Baseline::Top, style.label_color,
                    style.label_size);
    }
  }

  if (!title.empty()) {
    painter.label(title, region.left + region.width / 2.0, bottom + kXTitleOffset,
                  text::Align::Center, text::Baseline::Bottom, style.title_color, style.title_size);
  }
}

void draw_y_axis(Painter& painter, const Rect& region, const Scale& scale,
                 const std::vector<Tick>& ticks, const AxisStyle& style, const std::string& title,
                 const YAxisPlacement& placement) {
  const double ax = crisp(placement.x);
  const double dir = placement.right_side ? 1.0 : -1.0;

  if (style.show_axis_line) {
    painter.hairline(true, ax, region.top, region.bottom(), style.axis_line_width,
                     style.axis_line_color);
  }

  const text::Align align = placement.right_side ? text::Align::Left : text::Align::Right;
  for (const Tick& tick : ticks) {
    const double y = crisp(px_y(region, scale.norm(tick.value)));
    const double length = tick.minor ? style.tick_minor_length : style.tick_length;
    if (style.show_ticks) {
      painter.hairline(false, y, ax, ax + dir * length, style.tick_width, style.tick_color);
    }
    if (tick.label.empty()) continue;
    const double x = ax + dir * ((style.show_ticks ? length : 0.0) + style.label_standoff + 1.0);
    painter.label(tick.label, x, y, align, text::Baseline::Middle, style.label_color,
                  style.label_size);
  }

  if (!title.empty()) {
    const text::Baseline baseline =
        placement.right_side ? text::Baseline::Bottom : text::Baseline::Top;
    painter.label(title, placement.title_x, region.top + region.height / 2.0, text::Align::Center,
                  baseline, style.title_color, style.title_size, -90.0);
  }
}

void draw_title(Painter& painter, const Rect& region, const std::string& title, ph_theme theme) {
  if (title.empty()) return;
  const Rgba color = unpack_color_exact(theme_for(theme).title);
  painter.label(title, region.left + region.width / 2.0, region.top / 2.0, text::Align::Center,
                text::Baseline::Middle, color, kTitleSize, 0.0, kTitleBold);
}

void draw_crosshair_xy(Painter& painter, const Rect& region, double px, double py,
                       ph_theme theme) {
  if (px < region.left || px > region.right() || py < region.top || py > region.bottom()) return;
  const Rgba color = with_alpha(unpack_color_exact(theme_for(theme).text), 0.4f);
  const std::vector<float> dash{3.0f, 3.0f};
  painter.dashed(true, crisp(px), region.top, region.bottom(), 1.0, dash, color);
  painter.dashed(false, crisp(py), region.left, region.right(), 1.0, dash, color);
}

void draw_selection(Painter& painter, const Rect& region, double x0, double y0, double x1,
                    double y1, bool lock_x, bool lock_y) {
  const auto clamp = [](double v, double lo, double hi) { return std::max(lo, std::min(hi, v)); };

  double left = region.left;
  double width = region.width;
  if (lock_x) {
    const double a = clamp(x0, region.left, region.right());
    const double b = clamp(x1, region.left, region.right());
    left = std::min(a, b);
    width = std::abs(a - b);
  }
  double top = region.top;
  double height = region.height;
  if (lock_y) {
    const double a = clamp(y0, region.top, region.bottom());
    const double b = clamp(y1, region.top, region.bottom());
    top = std::min(a, b);
    height = std::abs(a - b);
  }
  if (width <= 0.0 || height <= 0.0) return;

  painter.fill(left, top, width, height, unpack_color_exact(kSelectionFill));
  const Rgba edge = unpack_color_exact(kSelectionEdge);
  painter.hairline(false, top + 0.5, left, left + width, 1.0, edge);
  painter.hairline(false, top + height - 0.5, left, left + width, 1.0, edge);
  painter.hairline(true, left + 0.5, top, top + height, 1.0, edge);
  painter.hairline(true, left + width - 0.5, top, top + height, 1.0, edge);
}

}  // namespace photon::render
