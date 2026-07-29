// The layout and styling the overlay draws from: margins, axis placement, tick
// resolution and theme fallbacks.
//
// Every number here is checked against core/src/plot.ts and
// core/src/render/overlay.ts, the same way tests/interaction_test.cpp is. If a
// chart drawn natively and the same chart on the web are to be comparable side
// by side — the acceptance test for this port — these have to agree first.

#include <photon/photon.h>

#include <string>
#include <vector>

#include "axes/axis.hpp"
#include "check.h"
#include "plot.hpp"
#include "render/overlay.hpp"
#include "render/theme.hpp"
#include "scale.hpp"

using photon::Axis;
using photon::Plot;
using photon::PlotRegion;
using photon::Scale;
using photon::Tick;
using photon::render::AxisConfig;
using photon::render::AxisStyle;

namespace {

ph_plot_desc default_desc() {
  ph_plot_desc desc;
  ph_plot_desc_init(&desc);
  desc.width = 640;
  desc.height = 400;
  return desc;
}

void test_the_default_region_matches_plot_ts() {
  // baseMargin is 16/16/40/56, so a 640x400 plot draws into 568x344 at (56,16).
  const Plot plot(default_desc());
  const PlotRegion r = plot.region();
  CHECK_NEAR(r.left, 56.0, 1e-9);
  CHECK_NEAR(r.top, 16.0, 1e-9);
  CHECK_NEAR(r.width, 568.0, 1e-9);
  CHECK_NEAR(r.height, 344.0, 1e-9);
}

void test_a_title_reserves_the_top_strip() {
  // TITLE_RESERVE is 28 in plot.ts, added to the top margin only when set.
  Plot plot(default_desc());
  plot.set_title("Portfolio");
  const PlotRegion r = plot.region();
  CHECK_NEAR(r.top, 44.0, 1e-9);
  CHECK_NEAR(r.height, 316.0, 1e-9);

  plot.set_title(nullptr);
  CHECK_NEAR(plot.region().top, 16.0, 1e-9);
}

void test_extra_y_axes_widen_the_margins() {
  // Y_AXIS_GAP is 52. The first left axis sits on the region's own edge, so
  // only the ones past it widen the left margin — computeMargin() uses
  // max(0, leftCount - 1) — while every right axis widens the right one.
  ph_axis_desc axis;
  ph_axis_desc_init(&axis);

  Plot plot(default_desc());
  CHECK(plot.add_y_axis("volume", axis, 1));
  CHECK_NEAR(plot.region().width, 568.0 - 52.0, 1e-9);
  CHECK_NEAR(plot.region().left, 56.0, 1e-9);

  CHECK(plot.add_y_axis("rsi", axis, 1));
  CHECK_NEAR(plot.region().width, 568.0 - 104.0, 1e-9);

  CHECK(plot.add_y_axis("spread", axis, 0));
  CHECK_NEAR(plot.region().left, 108.0, 1e-9);
  CHECK_NEAR(plot.region().width, 640.0 - 108.0 - 16.0 - 104.0, 1e-9);
}

void test_y_axes_are_placed_by_side_and_order() {
  ph_axis_desc axis;
  ph_axis_desc_init(&axis);
  Plot plot(default_desc());
  CHECK(plot.add_y_axis("second-left", axis, 0));
  CHECK(plot.add_y_axis("right", axis, 1));

  const PlotRegion r = plot.region();
  const auto places = plot.y_axis_placements(r);
  CHECK_EQ(places.size(), size_t{3});

  // Primary first, then the extra left axis 52px further out, then the right.
  CHECK_NEAR(places[0].x, r.left, 1e-9);
  CHECK(!places[0].right_side);
  CHECK_NEAR(places[0].title_x, r.left - 42.0, 1e-9);

  CHECK_NEAR(places[1].x, r.left - 52.0, 1e-9);
  CHECK(!places[1].right_side);

  CHECK_NEAR(places[2].x, r.left + r.width, 1e-9);
  CHECK(places[2].right_side);
  CHECK_NEAR(places[2].title_x, r.left + r.width + 42.0, 1e-9);
}

void test_pixel_projection() {
  const photon::render::Rect region{56.0, 16.0, 568.0, 344.0};
  CHECK_NEAR(photon::render::px_x(region, 0.0), 56.0, 1e-9);
  CHECK_NEAR(photon::render::px_x(region, 1.0), 624.0, 1e-9);
  CHECK_NEAR(photon::render::px_x(region, 0.5), 340.0, 1e-9);
  // t is normalized bottom-to-top while screen y grows down, so it inverts.
  CHECK_NEAR(photon::render::px_y(region, 0.0), 360.0, 1e-9);
  CHECK_NEAR(photon::render::px_y(region, 1.0), 16.0, 1e-9);
}

void test_theme_defaults_match_overlay_ts() {
  const AxisStyle dark = photon::render::resolve_axis_style(AxisConfig{}, PH_THEME_DARK);
  CHECK(dark.show_axis_line);
  CHECK(dark.show_ticks);
  CHECK(dark.show_grid);
  CHECK_NEAR(dark.axis_line_width, 1.0f, 1e-6);
  CHECK_NEAR(dark.tick_length, 5.0f, 1e-6);
  CHECK_NEAR(dark.tick_minor_length, 3.0f, 1e-6);
  CHECK_NEAR(dark.label_standoff, 3.0f, 1e-6);
  CHECK_NEAR(dark.label_size, 12.0f, 1e-6);
  CHECK(dark.grid_dash.empty());
  // darkTheme.axis is #cbd5e1 and darkTheme.text #94a3b8.
  CHECK_NEAR(dark.axis_line_color.r, 203.0f / 255.0f, 1e-4);
  CHECK_NEAR(dark.label_color.b, 184.0f / 255.0f, 1e-4);
  // The grid is translucent — rgba(148,163,184,0.16), rounded to 41/255.
  CHECK_NEAR(dark.grid_color.a, 41.0f / 255.0f, 1e-3);
  CHECK(dark.grid_minor_color.a < dark.grid_color.a);

  const AxisStyle light = photon::render::resolve_axis_style(AxisConfig{}, PH_THEME_LIGHT);
  CHECK_NEAR(light.axis_line_color.r, 51.0f / 255.0f, 1e-4);  // #334155
}

void test_axis_config_overrides_and_the_colour_fallback() {
  AxisConfig config;
  config.no_grid = true;
  config.tick_length = 9.0f;
  config.label_color = 0xff0000ffu;
  const AxisStyle style = photon::render::resolve_axis_style(config, PH_THEME_DARK);
  CHECK(!style.show_grid);
  CHECK_NEAR(style.tick_length, 9.0f, 1e-6);
  CHECK_NEAR(style.label_color.r, 1.0f, 1e-6);
  CHECK_NEAR(style.label_color.g, 0.0f, 1e-6);

  // An unstyled coloured axis tints its line, ticks, labels and title, but not
  // its grid — resolveAxisStyle() passes colorOverride to exactly those four.
  const AxisStyle tinted =
      photon::render::resolve_axis_style(AxisConfig{}, PH_THEME_DARK, 0x00ff00ffu);
  CHECK_NEAR(tinted.axis_line_color.g, 1.0f, 1e-6);
  CHECK_NEAR(tinted.label_color.g, 1.0f, 1e-6);
  CHECK_NEAR(tinted.grid_color.g, 163.0f / 255.0f, 1e-4);
}

void test_auto_ticks_are_labelled_and_clipped() {
  Scale scale;
  scale.set_domain(0.0, 10.0);
  Axis axis;
  const std::vector<Tick>& ticks = axis.resolve(scale);
  CHECK(ticks.size() >= 3);
  for (const Tick& tick : ticks) {
    CHECK(tick.value >= scale.lo);
    CHECK(tick.value <= scale.hi);
    CHECK(!tick.label.empty());  // a major tick always carries a label
    CHECK(tick.grid);
  }
  CHECK_STR(ticks.front().label, "0");

  // Narrowing the domain re-resolves rather than returning the stale list.
  scale.set_domain(2.0, 3.0);
  const std::vector<Tick>& narrowed = axis.resolve(scale);
  for (const Tick& tick : narrowed) {
    CHECK(tick.value >= 2.0);
    CHECK(tick.value <= 3.0);
  }
}

void test_minor_ticks_are_linear_only() {
  Scale linear;
  linear.set_domain(0.0, 10.0);
  Axis axis;
  AxisConfig config;
  config.minor_ticks = 4;
  axis.set_config(config);

  const size_t majors = Axis{}.resolve(linear).size();
  const std::vector<Tick>& with_minors = axis.resolve(linear);
  CHECK(with_minors.size() > majors);
  size_t labelled = 0;
  for (const Tick& tick : with_minors) {
    if (tick.minor) {
      CHECK(tick.label.empty());  // minor ticks never draw a label
      CHECK(!tick.grid);
    } else {
      ++labelled;
    }
  }
  CHECK_EQ(labelled, majors);

  // A log scale emits its own minors, so the setting is ignored there.
  Scale log;
  log.type = PH_SCALE_LOG;
  log.set_domain(1.0, 1000.0);
  Axis log_axis;
  log_axis.set_config(config);
  const size_t generated = log_axis.resolve(log).size();
  CHECK_EQ(generated, Axis{}.resolve(log).size());
}

void test_explicit_ticks_replace_the_generated_ones() {
  Scale scale;
  scale.set_domain(0.0, 10.0);
  Axis axis;

  std::vector<Tick> explicit_ticks;
  Tick labelled;
  labelled.value = 2.5;
  labelled.label = "target";
  explicit_ticks.push_back(labelled);
  Tick unlabelled;
  unlabelled.value = 7.0;  // empty label means "format with the scale's own"
  explicit_ticks.push_back(unlabelled);
  Tick outside;
  outside.value = 99.0;  // outside the domain, so it is dropped
  explicit_ticks.push_back(outside);
  axis.set_explicit_ticks(explicit_ticks);

  const std::vector<Tick>& resolved = axis.resolve(scale);
  CHECK_EQ(resolved.size(), size_t{2});
  CHECK_STR(resolved[0].label, "target");
  CHECK_STR(resolved[1].label, "7");

  // Clearing them restores the scale's own ticks.
  axis.set_explicit_ticks({});
  CHECK(axis.resolve(scale).size() > 2);
}

}  // namespace

int main() {
  RUN(test_the_default_region_matches_plot_ts);
  RUN(test_a_title_reserves_the_top_strip);
  RUN(test_extra_y_axes_widen_the_margins);
  RUN(test_y_axes_are_placed_by_side_and_order);
  RUN(test_pixel_projection);
  RUN(test_theme_defaults_match_overlay_ts);
  RUN(test_axis_config_overrides_and_the_colour_fallback);
  RUN(test_auto_ticks_are_labelled_and_clipped);
  RUN(test_minor_ticks_are_linear_only);
  RUN(test_explicit_ticks_replace_the_generated_ones);
  return TEST_MAIN_RESULT();
}
