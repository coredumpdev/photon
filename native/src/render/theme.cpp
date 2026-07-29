#include "render/theme.hpp"

#include <algorithm>

namespace photon::render {
namespace {

/// lightTheme, converted from overlay.ts:
///   axis #334155 · grid rgba(100,116,139,0.18) · gridMinor 0.08 · text #475569
/// and the light title colour #1e293b from drawTitle().
constexpr Theme kLight{0x334155ffu, 0x64748b2eu, 0x64748b14u, 0x475569ffu, 0x1e293bffu};

/// darkTheme: axis #cbd5e1 · grid rgba(148,163,184,0.16) · gridMinor 0.07 ·
/// text #94a3b8 · title #e2e8f0.
constexpr Theme kDark{0xcbd5e1ffu, 0x94a3b829u, 0x94a3b812u, 0x94a3b8ffu, 0xe2e8f0ffu};

/// The core's `??` chain: an explicit colour, else the axis's own colour, else
/// the theme's.
Rgba pick(ph_color explicit_color, ph_color override_color, ph_color theme_color) {
  if (explicit_color != PH_COLOR_AUTO) return unpack_color_exact(explicit_color);
  if (override_color != PH_COLOR_AUTO) return unpack_color_exact(override_color);
  return unpack_color_exact(theme_color);
}

float positive_or(float value, float fallback) {
  return value > 0.0f ? value : fallback;
}

}  // namespace

const Theme& theme_for(ph_theme theme) {
  return theme == PH_THEME_LIGHT ? kLight : kDark;
}

AxisConfig AxisConfig::from(const ph_axis_config& desc) {
  AxisConfig out;
  out.no_axis_line = desc.no_axis_line != 0;
  out.no_ticks = desc.no_ticks != 0;
  out.no_grid = desc.no_grid != 0;
  out.axis_line_color = desc.axis_line_color;
  out.axis_line_width = desc.axis_line_width;
  out.tick_color = desc.tick_color;
  out.tick_length = desc.tick_length;
  out.tick_width = desc.tick_width;
  out.label_color = desc.label_color;
  out.label_size = desc.label_size;
  out.label_rotation = desc.label_rotation;
  out.label_standoff = desc.label_standoff;
  if (desc.title) out.title = desc.title;
  out.title_color = desc.title_color;
  out.title_size = desc.title_size;
  out.grid_color = desc.grid_color;
  out.grid_minor_color = desc.grid_minor_color;
  out.grid_width = desc.grid_width;
  if (desc.grid_dash && desc.grid_dash_count > 0) {
    const int32_t n = std::min(desc.grid_dash_count, 8);
    out.grid_dash.assign(desc.grid_dash, desc.grid_dash + n);
  }
  out.minor_ticks = std::max(0, desc.minor_ticks);
  return out;
}

AxisStyle resolve_axis_style(const AxisConfig& config, ph_theme theme, ph_color color_override) {
  const Theme& palette = theme_for(theme);
  AxisStyle out;

  out.show_axis_line = !config.no_axis_line;
  out.axis_line_color = pick(config.axis_line_color, color_override, palette.axis);
  out.axis_line_width = positive_or(config.axis_line_width, 1.0f);

  out.show_ticks = !config.no_ticks;
  out.tick_color = pick(config.tick_color, color_override, palette.axis);
  out.tick_length = positive_or(config.tick_length, 5.0f);
  out.tick_minor_length = 3.0f;
  out.tick_width = positive_or(config.tick_width, 1.0f);

  out.label_color = pick(config.label_color, color_override, palette.text);
  out.label_size = positive_or(config.label_size, 12.0f);
  out.label_rotation = config.label_rotation;
  out.label_standoff = positive_or(config.label_standoff, 3.0f);

  out.title_color = pick(config.title_color, color_override, palette.text);
  out.title_size = positive_or(config.title_size, 12.0f);

  out.show_grid = !config.no_grid;
  out.grid_color = pick(config.grid_color, PH_COLOR_AUTO, palette.grid);
  out.grid_minor_color = pick(config.grid_minor_color, PH_COLOR_AUTO, palette.grid_minor);
  out.grid_width = positive_or(config.grid_width, 1.0f);
  out.grid_dash = config.grid_dash;
  return out;
}

}  // namespace photon::render
