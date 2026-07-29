/*
 * Hover picking, checked against the properties the two search paths must share.
 *
 * The binary search exists because a linear scan over six million points costs
 * about 185 ms a frame — two hundred times the draw. So the thing worth testing
 * is not that it is fast but that it agrees with the scan it replaces: an
 * optimisation that picks a different point is a bug that only shows up as the
 * tooltip naming the wrong sample.
 */

#include <cmath>
#include <cstddef>
#include <limits>
#include <vector>

#include "check.h"
#include "layers/pick.hpp"
#include "scale.hpp"

using photon::PickMode;
using photon::PickProjection;
using photon::Picked;
using photon::pick_nearest;
using photon::Scale;

namespace {

/// A 100 x 100 pixel region over the unit square, so a data unit is a pixel.
PickProjection unit_projection(const Scale& sx, const Scale& sy) {
  PickProjection project;
  project.x_left = 0.0;
  project.x_width = 100.0;
  project.y_top = 0.0;
  project.y_height = 100.0;
  project.scale_x = &sx;
  project.scale_y = &sy;
  return project;
}

void test_projection_flips_y() {
  Scale sx;
  Scale sy;
  sx.set_domain(0.0, 1.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);
  CHECK_NEAR(project.project_x(0.0), 0.0, 1e-9);
  CHECK_NEAR(project.project_x(1.0), 100.0, 1e-9);
  // Data grows up and pixels grow down, which is the whole of the flip.
  CHECK_NEAR(project.project_y(0.0), 100.0, 1e-9);
  CHECK_NEAR(project.project_y(1.0), 0.0, 1e-9);
}

void test_nothing_to_pick() {
  Scale sx;
  Scale sy;
  sx.set_domain(0.0, 1.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);
  Picked out;
  CHECK(!pick_nearest({}, {}, PickMode::X, 50.0, 50.0, project,
                      std::numeric_limits<double>::infinity(), false, out));
}

void test_the_gate_rejects_a_far_point() {
  Scale sx;
  Scale sy;
  sx.set_domain(0.0, 1.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);
  const std::vector<double> xs{0.5};
  const std::vector<double> ys{0.5};
  Picked out;
  // The point is at pixel (50, 50); the cursor is 30 px away.
  CHECK(pick_nearest(xs, ys, PickMode::XY, 50.0, 80.0, project, 40.0, false, out));
  CHECK(out.index == 0);
  CHECK(!pick_nearest(xs, ys, PickMode::XY, 50.0, 80.0, project, 20.0, false, out));
}

void test_the_mode_decides_which_distance() {
  Scale sx;
  Scale sy;
  sx.set_domain(0.0, 1.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);
  // Point 0 is near in x and far in y; point 1 the other way round. Each mode
  // must pick a different one, which is the whole reason the mode exists.
  const std::vector<double> xs{0.50, 0.90};
  const std::vector<double> ys{0.90, 0.50};
  const double inf = std::numeric_limits<double>::infinity();
  Picked out;

  CHECK(pick_nearest(xs, ys, PickMode::X, 50.0, 50.0, project, inf, false, out));
  CHECK(out.index == 0);
  CHECK(pick_nearest(xs, ys, PickMode::Y, 50.0, 50.0, project, inf, false, out));
  CHECK(out.index == 1);
  // Equidistant in 2-D, so the first wins — ties go to draw order.
  CHECK(pick_nearest(xs, ys, PickMode::XY, 50.0, 50.0, project, inf, false, out));
  CHECK(out.index == 0);
}

/// The reference implementation: measure every point, keep the nearest.
int brute_force(const std::vector<double>& xs, const std::vector<double>& ys, PickMode mode,
                double cx, double cy, const PickProjection& project, double gate) {
  int best = -1;
  double best_dist = std::numeric_limits<double>::infinity();
  for (size_t i = 0; i < xs.size(); ++i) {
    const double dx = project.project_x(xs[i]) - cx;
    const double dy = project.project_y(ys[i]) - cy;
    const double d = mode == PickMode::X   ? std::abs(dx)
                     : mode == PickMode::Y ? std::abs(dy)
                                           : std::hypot(dx, dy);
    if (d < best_dist) {
      best_dist = d;
      best = static_cast<int>(i);
    }
  }
  return (best >= 0 && best_dist <= gate) ? best : -1;
}

void test_the_binary_search_agrees_with_the_scan() {
  // 4000 points, well past the 64 where the bisection kicks in, on a curve that
  // doubles back in y so the nearest in x is often not the nearest in xy.
  const size_t n = 4000;
  std::vector<double> xs(n);
  std::vector<double> ys(n);
  for (size_t i = 0; i < n; ++i) {
    xs[i] = static_cast<double>(i) / static_cast<double>(n - 1);
    ys[i] = 0.5 + 0.45 * std::sin(xs[i] * 40.0);
  }
  Scale sx;
  Scale sy;
  sx.set_domain(0.0, 1.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);
  const double inf = std::numeric_limits<double>::infinity();

  for (int step = 0; step <= 20; ++step) {
    const double cx = static_cast<double>(step) * 5.0;
    for (const double cy : {0.0, 25.0, 50.0, 75.0, 100.0}) {
      for (const PickMode mode : {PickMode::X, PickMode::XY}) {
        Picked fast;
        const bool hit = pick_nearest(xs, ys, mode, cx, cy, project, inf, true, fast);
        const int slow = brute_force(xs, ys, mode, cx, cy, project, inf);
        CHECK(hit == (slow >= 0));
        if (!hit) continue;
        // Distances, not indices: two points can be exactly equidistant and
        // either answer is right, but the distance never is.
        const double fast_d =
            mode == PickMode::X
                ? std::abs(project.project_x(fast.x) - cx)
                : std::hypot(project.project_x(fast.x) - cx, project.project_y(fast.y) - cy);
        const double slow_d =
            mode == PickMode::X
                ? std::abs(project.project_x(xs[static_cast<size_t>(slow)]) - cx)
                : std::hypot(project.project_x(xs[static_cast<size_t>(slow)]) - cx,
                             project.project_y(ys[static_cast<size_t>(slow)]) - cy);
        CHECK_NEAR(fast_d, slow_d, 1e-9);
      }
    }
  }
}

void test_a_descending_domain_still_bisects() {
  // The search runs on the *projected* value, so a reversed domain needs no
  // special case — but it is exactly the sort of thing that silently returns
  // the wrong end, so it gets its own case.
  const size_t n = 500;
  std::vector<double> xs(n);
  std::vector<double> ys(n);
  for (size_t i = 0; i < n; ++i) {
    xs[i] = static_cast<double>(i) / static_cast<double>(n - 1);
    ys[i] = 0.5;
  }
  Scale sx;
  Scale sy;
  sx.set_domain(1.0, 0.0);  // reversed
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);

  Picked out;
  CHECK(pick_nearest(xs, ys, PickMode::X, 10.0, 50.0, project,
                     std::numeric_limits<double>::infinity(), true, out));
  // Pixel 10 of a reversed domain is data 0.9.
  CHECK_NEAR(out.x, 0.9, 0.01);
}

void test_a_log_scale_bisects_too() {
  const size_t n = 300;
  std::vector<double> xs(n);
  std::vector<double> ys(n);
  for (size_t i = 0; i < n; ++i) {
    xs[i] = 1.0 + static_cast<double>(i) * 10.0;
    ys[i] = 0.5;
  }
  Scale sx;
  Scale sy;
  sx.type = PH_SCALE_LOG;
  sx.set_domain(1.0, 3000.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);

  Picked fast;
  CHECK(pick_nearest(xs, ys, PickMode::X, 50.0, 50.0, project,
                     std::numeric_limits<double>::infinity(), true, fast));
  const int slow = brute_force(xs, ys, PickMode::X, 50.0, 50.0, project,
                               std::numeric_limits<double>::infinity());
  CHECK(slow >= 0);
  CHECK_NEAR(std::abs(project.project_x(fast.x) - 50.0),
             std::abs(project.project_x(xs[static_cast<size_t>(slow)]) - 50.0), 1e-9);
}

void test_unsorted_data_falls_back_to_the_scan() {
  // Claiming sorted when the data is not would let the bisection land anywhere;
  // this is the honest path, and it must still find the true nearest.
  const std::vector<double> xs{0.9, 0.1, 0.5, 0.3, 0.7};
  const std::vector<double> ys{0.5, 0.5, 0.5, 0.5, 0.5};
  Scale sx;
  Scale sy;
  sx.set_domain(0.0, 1.0);
  sy.set_domain(0.0, 1.0);
  const PickProjection project = unit_projection(sx, sy);

  Picked out;
  CHECK(pick_nearest(xs, ys, PickMode::X, 32.0, 50.0, project,
                     std::numeric_limits<double>::infinity(), false, out));
  CHECK(out.index == 3);
  CHECK_NEAR(out.x, 0.3, 1e-9);
}

}  // namespace

int main() {
  RUN(test_projection_flips_y);
  RUN(test_nothing_to_pick);
  RUN(test_the_gate_rejects_a_far_point);
  RUN(test_the_mode_decides_which_distance);
  RUN(test_the_binary_search_agrees_with_the_scan);
  RUN(test_a_descending_domain_still_bisects);
  RUN(test_a_log_scale_bisects_too);
  RUN(test_unsorted_data_falls_back_to_the_scan);
  return TEST_MAIN_RESULT();
}
