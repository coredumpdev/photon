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

void Painter::segment(double x0, double y0, double x1, double y1, double width,
                      const std::vector<float>& dash, Rgba color) {
  const float fx0 = static_cast<float>(x0 * dpr_);
  const float fy0 = static_cast<float>(y0 * dpr_);
  const float fx1 = static_cast<float>(x1 * dpr_);
  const float fy1 = static_cast<float>(y1 * dpr_);
  const float thickness = static_cast<float>(width * dpr_);
  if (dash.empty()) {
    shapes_->segment(fx0, fy0, fx1, fy1, thickness, color);
    return;
  }
  // Walk the pattern along the segment. The line is at an angle, so this cannot
  // reuse dashed_hairline, which steps along one axis.
  const double dx = fx1 - fx0;
  const double dy = fy1 - fy0;
  const double len = std::hypot(dx, dy);
  if (len <= 0.0) return;
  const double ux = dx / len;
  const double uy = dy / len;
  double at = 0.0;
  size_t i = 0;
  bool on = true;
  while (at < len) {
    const double step = std::max(0.5, static_cast<double>(dash[i % dash.size()]) * dpr_);
    const double next = std::min(len, at + step);
    if (on) {
      shapes_->segment(static_cast<float>(fx0 + ux * at), static_cast<float>(fy0 + uy * at),
                       static_cast<float>(fx0 + ux * next), static_cast<float>(fy0 + uy * next),
                       thickness, color);
    }
    at = next;
    on = !on;
    ++i;
  }
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

namespace {

/// The colorbar's own numbers, from ColorbarOptions' defaults in colorbar.ts.
constexpr double kBarWidth = 12.0;
constexpr double kBarHeightFraction = 0.72;
constexpr int kBarTickTarget = 5;
constexpr double kBarLabelSize = 10.0;
/// Gap between the region's right edge and the bar, and bar to its labels.
constexpr double kBarLeftGap = 12.0;
constexpr double kBarLabelGap = 4.0;
constexpr double kBarCaptionGap = 3.0;

/// Round tick values inside the domain — the same nice numbers an axis picks.
/// A very narrow domain can round every candidate away, so the ends stand in.
std::vector<double> bar_ticks(const ph_range& domain) {
  std::vector<double> out;
  if (!std::isfinite(domain.lo) || !std::isfinite(domain.hi)) return out;
  if (domain.lo == domain.hi) {
    out.push_back(domain.lo);
    return out;
  }
  for (const Tick& tick : auto_ticks(domain.lo, domain.hi, kBarTickTarget)) {
    if (tick.value >= domain.lo && tick.value <= domain.hi) out.push_back(tick.value);
  }
  if (out.size() < 2) {
    out.clear();
    out.push_back(domain.lo);
    out.push_back(domain.hi);
  }
  return out;
}

}  // namespace

void draw_colorbars(Painter& painter, const Rect& region,
                    const std::vector<ColorbarEntry>& entries, int extra_right_axes,
                    ph_theme theme) {
  if (entries.empty()) return;
  const Theme& colors = theme_for(theme);
  const Rgba text = with_alpha(unpack_color_exact(colors.text), 0.85f);
  const Rgba border = unpack_color_exact(colors.axis);

  const double left = region.right() + extra_right_axes * 52.0 + kBarLeftGap;
  // The stack shares the region's height, minus room for the captions when
  // there is more than one bar — the same arithmetic renderColorbars does.
  const double per = (region.height * kBarHeightFraction) / static_cast<double>(entries.size()) -
                     (entries.size() > 1 ? 22.0 : 0.0);
  const double bar_height = std::max(24.0, per);
  const double slot = region.height / static_cast<double>(entries.size());

  for (size_t i = 0; i < entries.size(); ++i) {
    const ColorbarEntry& entry = entries[i];
    if (!entry.lut) continue;
    double top = region.top + static_cast<double>(i) * slot;
    if (!entry.label.empty()) {
      painter.label(entry.label, left, top, text::Align::Left, text::Baseline::Top, text,
                    kBarLabelSize);
      top += kBarLabelSize + kBarCaptionGap;
    }

    // One filled row per device pixel: the ramp is a lookup, so a smooth
    // gradient costs the same as a banded one and reads better.
    const int rows = std::max(1, static_cast<int>(std::lround(bar_height * painter.dpr())));
    const double row_height = bar_height / static_cast<double>(rows);
    for (int r = 0; r < rows; ++r) {
      // Row 0 is the top of the bar and the top is the domain maximum, which is
      // what puts the minimum next to the lowest tick label.
      const double t = 1.0 - (static_cast<double>(r) + 0.5) / static_cast<double>(rows);
      const photon::color::Rgb c = photon::color::sample(*entry.lut, t);
      painter.fill(left, top + static_cast<double>(r) * row_height, kBarWidth,
                   row_height + 0.5, Rgba{c.r, c.g, c.b, 1.0f});
    }
    painter.hairline(true, crisp(left), top, top + bar_height, 1.0, border);
    painter.hairline(true, crisp(left + kBarWidth), top, top + bar_height, 1.0, border);
    painter.hairline(false, crisp(top), left, left + kBarWidth, 1.0, border);
    painter.hairline(false, crisp(top + bar_height), left, left + kBarWidth, 1.0, border);

    const double span = (entry.domain.hi - entry.domain.lo) != 0.0
                            ? (entry.domain.hi - entry.domain.lo)
                            : 1.0;
    for (const double value : bar_ticks(entry.domain)) {
      // Each label sits at its true fraction of the bar, so it names the exact
      // colour beside it — evenly spaced labels would lie whenever the nice
      // tick values are not evenly spaced inside the domain.
      const double y = top + (1.0 - (value - entry.domain.lo) / span) * bar_height;
      painter.label(compact_format(value), left + kBarWidth + kBarLabelGap, y, text::Align::Left,
                    text::Baseline::Middle, text, kBarLabelSize);
    }
  }
}

void draw_title(Painter& painter, const Rect& region, const std::string& title, ph_theme theme,
                const TitleStyle& style) {
  if (title.empty()) return;
  const Rgba color = style.color != PH_COLOR_AUTO ? unpack_color_exact(style.color)
                                                  : unpack_color_exact(theme_for(theme).title);
  // Left and right align to the plot region rather than the canvas, so a title
  // lines up with the data it names rather than with the axis labels.
  const double x = style.align == text::Align::Left    ? region.left
                   : style.align == text::Align::Right ? region.right()
                                                       : region.left + region.width / 2.0;
  painter.label(title, x, region.top / 2.0, style.align, text::Baseline::Middle, color,
                style.size > 0.0f ? style.size : kTitleSize, 0.0, kTitleBold);
}

void draw_crosshair_xy(Painter& painter, const Rect& region, double px, double py,
                       ph_theme theme) {
  if (px < region.left || px > region.right() || py < region.top || py > region.bottom()) return;
  const Rgba color = with_alpha(unpack_color_exact(theme_for(theme).text), 0.4f);
  const std::vector<float> dash{3.0f, 3.0f};
  painter.dashed(true, crisp(px), region.top, region.bottom(), 1.0, dash, color);
  painter.dashed(false, crisp(py), region.left, region.right(), 1.0, dash, color);
}

void draw_crosshair(Painter& painter, const Rect& region, double px, ph_theme theme) {
  if (px < region.left || px > region.right()) return;
  const Rgba color = with_alpha(unpack_color_exact(theme_for(theme).text), 0.4f);
  const std::vector<float> dash{3.0f, 3.0f};
  painter.dashed(true, crisp(px), region.top, region.bottom(), 1.0, dash, color);
}

void draw_marker(Painter& painter, double px, double py, Rgba color) {
  // A filled disc with a white rim, from drawMarker(): 4 px radius and a 1.5 px
  // stroke. There is no circle primitive here, so the disc is a stack of rows —
  // eight of them at this size, which is cheaper than a shader for one point.
  constexpr double kRadius = 4.0;
  constexpr double kRim = 1.5;
  const Rgba white{1.0f, 1.0f, 1.0f, 1.0f};
  const auto disc = [&](double radius, Rgba fill) {
    const int rows = static_cast<int>(std::ceil(radius * 2.0 * painter.dpr()));
    for (int i = 0; i < rows; ++i) {
      const double dy = -radius + (static_cast<double>(i) + 0.5) * (radius * 2.0 / rows);
      const double half = std::sqrt(std::max(0.0, radius * radius - dy * dy));
      if (half <= 0.0) continue;
      painter.fill(px - half, py + dy, half * 2.0, radius * 2.0 / rows + 0.5, fill);
    }
  };
  disc(kRadius + kRim / 2.0, white);
  disc(kRadius - kRim / 2.0, color);
}

namespace {

/// The legend's own numbers, from the DOM style in plot.ts: 6/8 px padding,
/// a 6 px corner radius, a 10 px swatch and 6 px between it and the label.
constexpr double kLegendPadX = 8.0;
constexpr double kLegendPadY = 6.0;
constexpr double kLegendRadius = 6.0;
constexpr double kLegendSwatch = 10.0;
constexpr double kLegendSwatchGap = 6.0;
constexpr double kLegendRowGap = 3.0;
constexpr double kLegendColumnGap = 12.0;
constexpr double kLegendFontSize = 12.0;
constexpr double kLegendLineHeight = 18.0;  // 12px * 1.5
constexpr double kLegendInset = 8.0;
/// A hidden series keeps its row but fades, as the web core's 0.45 opacity does.
constexpr float kLegendDimmed = 0.45f;

/// One row's full width: swatch, gap, label.
double row_width(const LegendEntry& entry, const Painter& painter) {
  return kLegendSwatch + kLegendSwatchGap + painter.measure(entry.label, kLegendFontSize);
}

}  // namespace

void fill_panel(Painter& painter, const Rect& panel, double radius, Rgba fill, Rgba border) {
  const double r = std::min(radius, std::min(panel.width, panel.height) / 2.0);
  // The body, then the corners cut off it row by row. Four rows at a 6 px
  // radius, which is why this is not worth a shader.
  painter.fill(panel.left, panel.top + r, panel.width, panel.height - 2.0 * r, fill);
  const int steps = std::max(1, static_cast<int>(std::ceil(r)));
  for (int i = 0; i < steps; ++i) {
    const double dy = r - (static_cast<double>(i) + 0.5) * (r / steps);
    const double inset = r - std::sqrt(std::max(0.0, r * r - dy * dy));
    const double h = r / steps + 0.5;
    painter.fill(panel.left + inset, panel.top + r - dy - h / 2.0, panel.width - 2.0 * inset, h,
                 fill);
    painter.fill(panel.left + inset, panel.bottom() - r + dy - h / 2.0, panel.width - 2.0 * inset,
                 h, fill);
  }
  // A square border on a rounded panel would show at the corners, so the edges
  // stop short of them — which is all a 1 px rounded outline needs to read.
  painter.hairline(true, crisp(panel.left), panel.top + r, panel.bottom() - r, 1.0, border);
  painter.hairline(true, crisp(panel.right()), panel.top + r, panel.bottom() - r, 1.0, border);
  painter.hairline(false, crisp(panel.top), panel.left + r, panel.right() - r, 1.0, border);
  painter.hairline(false, crisp(panel.bottom()), panel.left + r, panel.right() - r, 1.0, border);
}

Rect legend_row_rect(const Rect& panel, size_t index, size_t count, bool horizontal,
                     const std::vector<LegendEntry>& entries, const Painter& painter) {
  (void)count;
  Rect row;
  row.height = kLegendLineHeight;
  if (horizontal) {
    double x = panel.left + kLegendPadX;
    for (size_t i = 0; i < index && i < entries.size(); ++i) {
      x += row_width(entries[i], painter) + kLegendColumnGap;
    }
    row.left = x;
    row.top = panel.top + kLegendPadY;
    row.width = index < entries.size() ? row_width(entries[index], painter) : 0.0;
  } else {
    row.left = panel.left + kLegendPadX;
    row.top = panel.top + kLegendPadY +
              static_cast<double>(index) * (kLegendLineHeight + kLegendRowGap);
    row.width = panel.width - 2.0 * kLegendPadX;
  }
  return row;
}

Rect draw_legend(Painter& painter, const Rect& region, const std::vector<LegendEntry>& entries,
                 ph_legend_position position, bool horizontal, ph_theme theme) {
  Rect panel;
  if (entries.empty()) return panel;

  double content_w = 0.0;
  double content_h = 0.0;
  if (horizontal) {
    for (size_t i = 0; i < entries.size(); ++i) {
      content_w += row_width(entries[i], painter);
      if (i + 1 < entries.size()) content_w += kLegendColumnGap;
    }
    content_h = kLegendLineHeight;
  } else {
    for (const LegendEntry& entry : entries) {
      content_w = std::max(content_w, row_width(entry, painter));
    }
    content_h = static_cast<double>(entries.size()) * kLegendLineHeight +
                static_cast<double>(entries.size() - 1) * kLegendRowGap;
  }
  panel.width = content_w + 2.0 * kLegendPadX;
  panel.height = content_h + 2.0 * kLegendPadY;

  const bool left = position == PH_LEGEND_TOP_LEFT || position == PH_LEGEND_BOTTOM_LEFT;
  const bool top = position == PH_LEGEND_TOP_LEFT || position == PH_LEGEND_TOP_RIGHT;
  panel.left = left ? region.left + kLegendInset
                    : region.right() - panel.width - kLegendInset;
  panel.top = top ? region.top + kLegendInset : region.bottom() - panel.height - kLegendInset;
  panel.left = std::max(0.0, panel.left);
  panel.top = std::max(0.0, panel.top);

  const bool dark = theme == PH_THEME_DARK;
  const Rgba fill = dark ? Rgba{15.0f / 255.0f, 23.0f / 255.0f, 42.0f / 255.0f, 0.85f}
                         : Rgba{1.0f, 1.0f, 1.0f, 0.9f};
  const Rgba border = dark
                          ? Rgba{148.0f / 255.0f, 163.0f / 255.0f, 184.0f / 255.0f, 0.25f}
                          : Rgba{100.0f / 255.0f, 116.0f / 255.0f, 139.0f / 255.0f, 0.2f};
  const Rgba text = dark ? Rgba{226.0f / 255.0f, 232.0f / 255.0f, 240.0f / 255.0f, 1.0f}
                         : Rgba{30.0f / 255.0f, 41.0f / 255.0f, 59.0f / 255.0f, 1.0f};
  fill_panel(painter, panel, kLegendRadius, fill, border);

  for (size_t i = 0; i < entries.size(); ++i) {
    const LegendEntry& entry = entries[i];
    const Rect row = legend_row_rect(panel, i, entries.size(), horizontal, entries, painter);
    const double mid = row.top + row.height / 2.0;
    const double swatch_top = mid - kLegendSwatch / 2.0;
    // A hidden series shows its outline but not its fill, so the legend says
    // both what the series is and that it is off.
    if (entry.visible) {
      painter.fill(row.left, swatch_top, kLegendSwatch, kLegendSwatch, entry.color);
    }
    painter.hairline(true, crisp(row.left), swatch_top, swatch_top + kLegendSwatch, 1.0,
                     entry.color);
    painter.hairline(true, crisp(row.left + kLegendSwatch), swatch_top,
                     swatch_top + kLegendSwatch, 1.0, entry.color);
    painter.hairline(false, crisp(swatch_top), row.left, row.left + kLegendSwatch, 1.0,
                     entry.color);
    painter.hairline(false, crisp(swatch_top + kLegendSwatch), row.left,
                     row.left + kLegendSwatch, 1.0, entry.color);

    painter.label(entry.label, row.left + kLegendSwatch + kLegendSwatchGap, mid,
                  text::Align::Left, text::Baseline::Middle,
                  entry.visible ? text : with_alpha(text, kLegendDimmed), kLegendFontSize);
  }
  return panel;
}

namespace {

/// The tooltip's own numbers, from the DOM style in plot.ts.
constexpr double kTipPadX = 8.0;
constexpr double kTipPadY = 6.0;
constexpr double kTipRadius = 6.0;
constexpr double kTipFontSize = 12.0;
constexpr double kTipLineHeight = 18.0;
constexpr double kTipDot = 8.0;
constexpr double kTipDotGap = 6.0;
constexpr double kTipHeaderGap = 3.0;
constexpr double kTipCursorGap = 14.0;
/// The header is dimmer than the rows, as the web's 0.7 opacity makes it.
constexpr float kTipHeaderAlpha = 0.7f;

}  // namespace

void draw_tooltip(Painter& painter, const Rect& bounds, double cursor_px, double cursor_py,
                  const std::vector<TooltipRow>& rows, ph_theme theme) {
  if (rows.empty()) return;

  double width = 0.0;
  double height = 0.0;
  for (const TooltipRow& row : rows) {
    double w = painter.measure(row.text, kTipFontSize);
    if (row.swatch) w += kTipDot + kTipDotGap;
    width = std::max(width, w);
    height += kTipLineHeight;
    if (!row.swatch) height += kTipHeaderGap;
  }

  Rect panel;
  panel.width = width + 2.0 * kTipPadX;
  panel.height = height + 2.0 * kTipPadY;
  // Near the cursor, flipped to whichever side keeps it inside — the same rule
  // the web uses, and the reason a tooltip at the right edge does not vanish.
  panel.left = cursor_px + kTipCursorGap;
  if (panel.left + panel.width > bounds.right()) {
    panel.left = cursor_px - panel.width - kTipCursorGap;
  }
  panel.top = cursor_py + kTipCursorGap;
  if (panel.top + panel.height > bounds.bottom()) {
    panel.top = cursor_py - panel.height - kTipCursorGap;
  }
  panel.left = std::max(0.0, panel.left);
  panel.top = std::max(0.0, panel.top);

  const bool dark = theme == PH_THEME_DARK;
  const Rgba fill = dark ? Rgba{15.0f / 255.0f, 23.0f / 255.0f, 42.0f / 255.0f, 0.92f}
                         : Rgba{1.0f, 1.0f, 1.0f, 0.95f};
  const Rgba border = dark
                          ? Rgba{148.0f / 255.0f, 163.0f / 255.0f, 184.0f / 255.0f, 0.25f}
                          : Rgba{100.0f / 255.0f, 116.0f / 255.0f, 139.0f / 255.0f, 0.2f};
  const Rgba text = dark ? Rgba{226.0f / 255.0f, 232.0f / 255.0f, 240.0f / 255.0f, 1.0f}
                         : Rgba{30.0f / 255.0f, 41.0f / 255.0f, 59.0f / 255.0f, 1.0f};
  fill_panel(painter, panel, kTipRadius, fill, border);

  double y = panel.top + kTipPadY;
  for (const TooltipRow& row : rows) {
    const double mid = y + kTipLineHeight / 2.0;
    double x = panel.left + kTipPadX;
    if (row.swatch) {
      // A disc, so a series reads the same here as it does under the cursor.
      const int steps = std::max(1, static_cast<int>(std::ceil(kTipDot * painter.dpr())));
      const double r = kTipDot / 2.0;
      for (int i = 0; i < steps; ++i) {
        const double dy = -r + (static_cast<double>(i) + 0.5) * (kTipDot / steps);
        const double half = std::sqrt(std::max(0.0, r * r - dy * dy));
        if (half <= 0.0) continue;
        painter.fill(x + r - half, mid + dy, half * 2.0, kTipDot / steps + 0.5, row.color);
      }
      x += kTipDot + kTipDotGap;
    }
    painter.label(row.text, x, mid, text::Align::Left, text::Baseline::Middle,
                  row.swatch ? text : with_alpha(text, kTipHeaderAlpha), kTipFontSize);
    y += kTipLineHeight + (row.swatch ? 0.0 : kTipHeaderGap);
  }
}

namespace {

/// The classic seven retracement levels, from the TypeScript's default.
const std::vector<double>& default_fib_ratios() {
  static const std::vector<double> kRatios = {0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0};
  return kRatios;
}

/// The core's default band fill, rgba(59,130,246,0.15).
constexpr ph_color kBandColor = 0x3b82f626u;
constexpr double kAnnotationLabelSize = 12.0;

}  // namespace

void draw_annotation(Painter& painter, const Rect& region, const Annotation& a,
                     const AnnotationScales& scales, ph_theme theme) {
  if (!scales.x || !scales.y) return;
  const Theme& colors = theme_for(theme);
  const Rgba stroke =
      a.color != PH_COLOR_AUTO ? unpack_color_exact(a.color) : unpack_color_exact(colors.axis);
  const Rgba text_color =
      a.color != PH_COLOR_AUTO ? unpack_color_exact(a.color) : unpack_color_exact(colors.text);
  const auto px = [&](double v) { return px_x(region, scales.x->norm(v)); };
  const auto py = [&](double v) { return px_y(region, scales.y->norm(v)); };

  switch (a.type) {
    case PH_ANNOTATION_SPAN: {
      const double width = a.width > 0.0f ? a.width : 1.0;
      if (a.dim == PH_DIM_X) {
        const double x = crisp(px(a.x0));
        if (a.dash.empty()) {
          painter.hairline(true, x, region.top, region.bottom(), width, stroke);
        } else {
          painter.dashed(true, x, region.top, region.bottom(), width, a.dash, stroke);
        }
      } else {
        const double y = crisp(py(a.y0));
        if (a.dash.empty()) {
          painter.hairline(false, y, region.left, region.right(), width, stroke);
        } else {
          painter.dashed(false, y, region.left, region.right(), width, a.dash, stroke);
        }
      }
      break;
    }
    case PH_ANNOTATION_BAND: {
      const Rgba fill =
          a.color != PH_COLOR_AUTO ? unpack_color_exact(a.color) : unpack_color_exact(kBandColor);
      if (a.dim == PH_DIM_X) {
        const double p0 = px(a.x0);
        const double p1 = px(a.x1);
        painter.fill(std::min(p0, p1), region.top, std::abs(p1 - p0), region.height, fill);
      } else {
        const double p0 = py(a.y0);
        const double p1 = py(a.y1);
        painter.fill(region.left, std::min(p0, p1), region.width, std::abs(p1 - p0), fill);
      }
      break;
    }
    case PH_ANNOTATION_BOX: {
      const double bx0 = px(a.x0);
      const double bx1 = px(a.x1);
      const double by0 = py(a.y0);
      const double by1 = py(a.y1);
      const double rx = std::min(bx0, bx1);
      const double ry = std::min(by0, by1);
      const double rw = std::abs(bx1 - bx0);
      const double rh = std::abs(by1 - by0);
      if (a.color != PH_COLOR_AUTO) painter.fill(rx, ry, rw, rh, unpack_color_exact(a.color));
      if (a.border != PH_COLOR_AUTO) {
        const Rgba edge = unpack_color_exact(a.border);
        painter.hairline(true, crisp(rx), ry, ry + rh, 1.0, edge);
        painter.hairline(true, crisp(rx + rw), ry, ry + rh, 1.0, edge);
        painter.hairline(false, crisp(ry), rx, rx + rw, 1.0, edge);
        painter.hairline(false, crisp(ry + rh), rx, rx + rw, 1.0, edge);
      }
      if (!a.label.empty()) {
        const Rgba caption = a.border != PH_COLOR_AUTO   ? unpack_color_exact(a.border)
                             : a.color != PH_COLOR_AUTO  ? unpack_color_exact(a.color)
                                                         : unpack_color_exact(colors.text);
        painter.label(a.label, rx + 4.0, ry - 3.0, text::Align::Left, text::Baseline::Bottom,
                      caption, kAnnotationLabelSize);
      }
      break;
    }
    case PH_ANNOTATION_LABEL: {
      const text::Align align = a.align == PH_ALIGN_CENTER  ? text::Align::Center
                                : a.align == PH_ALIGN_RIGHT ? text::Align::Right
                                                            : text::Align::Left;
      const text::Baseline baseline = a.baseline == PH_BASELINE_TOP      ? text::Baseline::Top
                                      : a.baseline == PH_BASELINE_BOTTOM ? text::Baseline::Bottom
                                      : a.baseline == PH_BASELINE_ALPHABETIC
                                          ? text::Baseline::Alphabetic
                                          : text::Baseline::Middle;
      painter.label(a.text, px(a.x0) + a.dx, py(a.y0) + a.dy, align, baseline, text_color,
                    a.size > 0.0f ? a.size : kAnnotationLabelSize);
      break;
    }
    case PH_ANNOTATION_LINE:
    case PH_ANNOTATION_RAY: {
      const double width = a.width > 0.0f ? a.width : 1.5;
      const double sx0 = px(a.x0);
      const double sy0 = py(a.y0);
      double sx1 = px(a.x1);
      double sy1 = py(a.y1);
      if (a.type == PH_ANNOTATION_RAY) {
        // Extended far past the second point; the region clip trims it to the
        // edge, which is cheaper than solving for the intersection.
        const double dx = sx1 - sx0;
        const double dy = sy1 - sy0;
        double len = std::hypot(dx, dy);
        if (len == 0.0) len = 1.0;
        const double f = 8000.0 / len;
        sx1 = sx0 + dx * f;
        sy1 = sy0 + dy * f;
      }
      painter.segment(sx0, sy0, sx1, sy1, width, a.dash, stroke);
      if (!a.label.empty()) {
        painter.label(a.label, px(a.x1) + 7.0, py(a.y1) - 4.0, text::Align::Left,
                      text::Baseline::Bottom, text_color, kAnnotationLabelSize);
      }
      break;
    }
    default: {
      const std::vector<double>& ratios = a.ratios.empty() ? default_fib_ratios() : a.ratios;
      const double span = a.high - a.low;
      const double fx0 = std::min(px(a.x0), px(a.x1));
      const double fx1 = std::max(px(a.x0), px(a.x1));
      std::vector<double> ys;
      ys.reserve(ratios.size());
      for (const double r : ratios) ys.push_back(py(a.high - span * r));
      if (a.fill) {
        for (size_t i = 0; i + 1 < ys.size(); ++i) {
          const float alpha = (i % 2 == 0) ? 0.06f : 0.12f;
          painter.fill(fx0, std::min(ys[i], ys[i + 1]), fx1 - fx0, std::abs(ys[i + 1] - ys[i]),
                       Rgba{96.0f / 255.0f, 165.0f / 255.0f, 250.0f / 255.0f, alpha});
        }
      }
      for (size_t i = 0; i < ratios.size(); ++i) {
        painter.hairline(false, crisp(ys[i]), fx0, fx1, 1.0, stroke);
        // "38.2% · 104.71" — the same shape the TypeScript writes, with the
        // middle dot spelled in UTF-8 because the source file is ASCII.
        painter.label(fixed_format(ratios[i] * 100.0, 1) + "% \xc2\xb7 " +
                          fixed_format(a.high - span * ratios[i], 2),
                      fx0 + 4.0, ys[i] - 2.0, text::Align::Left, text::Baseline::Bottom, stroke,
                      kAnnotationLabelSize);
      }
      if (!a.label.empty() && !ys.empty()) {
        painter.label(a.label, fx0 + 4.0, *std::min_element(ys.begin(), ys.end()) - 4.0,
                      text::Align::Left, text::Baseline::Bottom, stroke, kAnnotationLabelSize);
      }
      break;
    }
  }
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
