// Port of the Theme / resolveAxisStyle half of core/src/render/overlay.ts.
//
// The colours are the web core's, converted from their CSS spellings to packed
// RGBA once, here — `rgba(148,163,184,0.16)` is 0x94a3b829 and nothing else in
// the port has to know that.
#pragma once

#include <photon/photon.h>

#include <string>
#include <vector>

#include "color.hpp"

namespace photon::render {

/// Mirrors `Theme` in overlay.ts, plus the title colour plot.ts picks inline.
struct Theme {
  ph_color axis;
  ph_color grid;
  ph_color grid_minor;
  ph_color text;
  ph_color title;
};

const Theme& theme_for(ph_theme theme);

/**
 * An owning copy of ph_axis_config.
 *
 * The ABI's struct borrows its `title` and `grid_dash` pointers for the duration
 * of the call — the same contract the data descriptors have — so a plot keeps
 * this instead.
 */
struct AxisConfig {
  bool no_axis_line = false;
  bool no_ticks = false;
  bool no_grid = false;

  ph_color axis_line_color = PH_COLOR_AUTO;
  float axis_line_width = 0.0f;
  ph_color tick_color = PH_COLOR_AUTO;
  float tick_length = 0.0f;
  float tick_width = 0.0f;

  ph_color label_color = PH_COLOR_AUTO;
  float label_size = 0.0f;
  float label_rotation = 0.0f;
  float label_standoff = 0.0f;

  std::string title;
  ph_color title_color = PH_COLOR_AUTO;
  float title_size = 0.0f;

  ph_color grid_color = PH_COLOR_AUTO;
  ph_color grid_minor_color = PH_COLOR_AUTO;
  float grid_width = 0.0f;
  std::vector<float> grid_dash;

  int32_t minor_ticks = 0;

  static AxisConfig from(const ph_axis_config& desc);
};

/// Port of `ResolvedAxisStyle`. Lengths and sizes are in logical pixels.
struct AxisStyle {
  bool show_axis_line = true;
  Rgba axis_line_color;
  float axis_line_width = 1.0f;

  bool show_ticks = true;
  Rgba tick_color;
  float tick_length = 5.0f;
  float tick_minor_length = 3.0f;
  float tick_width = 1.0f;

  Rgba label_color;
  float label_size = 12.0f;
  float label_rotation = 0.0f;
  float label_standoff = 3.0f;

  Rgba title_color;
  float title_size = 12.0f;

  bool show_grid = true;
  Rgba grid_color;
  Rgba grid_minor_color;
  float grid_width = 1.0f;
  std::vector<float> grid_dash;
};

/**
 * Fold a config's optional fields onto the theme defaults.
 *
 * `color_override` is a secondary y axis's own colour: an unstyled coloured axis
 * still tints its line, ticks, labels and title, matching resolveAxisStyle().
 * Pass PH_COLOR_AUTO for no override.
 */
AxisStyle resolve_axis_style(const AxisConfig& config, ph_theme theme,
                             ph_color color_override = PH_COLOR_AUTO);

}  // namespace photon::render
