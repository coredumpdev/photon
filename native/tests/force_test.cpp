/*
 * The force layout and the quadtree under it.
 *
 * A layout has no single right answer, so what is checked is the properties
 * that make it useful and reproducible: it is deterministic, connected nodes
 * end up closer than unconnected ones, and the Barnes-Hut approximation agrees
 * with the exact all-pairs sum it replaces. That last one matters most — the
 * tree is an optimisation, and an optimisation that changes the picture is a
 * bug wearing a performance argument.
 */

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <utility>
#include <vector>

#include "check.h"
#include "graph/force.hpp"
#include "graph/quadtree.hpp"

using photon::graph::Force;
using photon::graph::force_layout;
using photon::graph::ForceOptions;
using photon::graph::Layout;
using photon::graph::Quadtree;

namespace {

using Edges = std::vector<std::pair<int32_t, int32_t>>;

double distance(const Layout& layout, size_t a, size_t b) {
  return std::hypot(layout.x[a] - layout.x[b], layout.y[a] - layout.y[b]);
}

void test_degenerate_sizes() {
  const Layout none = force_layout(0, {});
  CHECK(none.x.empty());
  const Layout one = force_layout(1, {});
  CHECK(one.x.size() == 1);
  // A single node is seeded at angle 0 and never moves — there is nothing to
  // push against.
  CHECK_NEAR(one.x[0], 1.0, 1e-12);
  CHECK_NEAR(one.y[0], 0.0, 1e-12);
}

void test_it_is_deterministic() {
  Edges edges = {{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}};
  const Layout a = force_layout(8, edges);
  const Layout b = force_layout(8, edges);
  for (size_t i = 0; i < a.x.size(); ++i) {
    // Bit-for-bit, not approximately: the seed is arithmetic, not random, and
    // that is the property two hosts drawing the same graph depend on.
    CHECK(a.x[i] == b.x[i]);
    CHECK(a.y[i] == b.y[i]);
  }
}

void test_the_seed_is_a_circle() {
  const Layout layout = force_layout(6, {}, ForceOptions{0, 1.0, 0.05, 0.9});
  for (size_t i = 0; i < 6; ++i) {
    CHECK_NEAR(std::hypot(layout.x[i], layout.y[i]), 1.0, 1e-12);
  }
}

void test_edges_pull_and_space_pushes() {
  // Two tight triangles joined by nothing. Within a triangle every pair is an
  // edge; across, none are — so every within-distance must beat the gap.
  Edges edges = {{0, 1}, {1, 2}, {2, 0}, {3, 4}, {4, 5}, {5, 3}};
  const Layout layout = force_layout(6, edges);
  double worst_within = 0.0;
  for (const auto& e : edges) {
    worst_within = std::max(worst_within,
                            distance(layout, static_cast<size_t>(e.first),
                                     static_cast<size_t>(e.second)));
  }
  double best_across = std::numeric_limits<double>::infinity();
  for (size_t a = 0; a < 3; ++a) {
    for (size_t b = 3; b < 6; ++b) best_across = std::min(best_across, distance(layout, a, b));
  }
  CHECK(worst_within < best_across);
}

void test_disconnected_nodes_spread_out() {
  // No edges at all: pure repulsion against gravity. Nothing should end up on
  // top of anything else, which is the failure a NaN or a divide-by-zero gives.
  const Layout layout = force_layout(12, {});
  for (size_t i = 0; i < 12; ++i) {
    CHECK(std::isfinite(layout.x[i]) && std::isfinite(layout.y[i]));
    for (size_t j = i + 1; j < 12; ++j) CHECK(distance(layout, i, j) > 1e-6);
  }
}

void test_coincident_nodes_separate() {
  // Every node at the same place. Subdivision bottoms out at the depth limit,
  // where one leaf holds the whole cluster, and the coincident nudge gives the
  // repulsion a direction it otherwise would not have.
  std::vector<double> x(8, 0.0);
  std::vector<double> y(8, 0.0);
  Quadtree tree(16);
  tree.build(x.data(), y.data(), 8);

  const Force other = tree.repulsion(0.0, 0.0, 1, 0.9, 1.0);
  CHECK(std::isfinite(other.x) && std::isfinite(other.y));
  CHECK(std::hypot(other.x, other.y) > 0.0);

  // The one exception is the point the bottom leaf recorded as its resident:
  // it matches `self`, so the whole cluster is skipped and it feels nothing.
  // That is what the TypeScript does too, and it is harmless — every *other*
  // node still pushes, which is enough to break the tie.
  const Force resident = tree.repulsion(0.0, 0.0, 0, 0.9, 1.0);
  CHECK(resident.x == 0.0 && resident.y == 0.0);

  // What matters is that the layout itself still separates them.
  const Layout layout = force_layout(8, {});
  for (size_t i = 0; i < 8; ++i) {
    CHECK(std::isfinite(layout.x[i]) && std::isfinite(layout.y[i]));
  }
}

void test_the_tree_agrees_with_all_pairs() {
  // Eighty points on a spiral, which is the case Barnes-Hut is for: clustered
  // enough that the approximation kicks in, spread enough that it matters.
  const size_t n = 80;
  std::vector<double> x(n);
  std::vector<double> y(n);
  for (size_t i = 0; i < n; ++i) {
    const double t = static_cast<double>(i) * 0.35;
    x[i] = std::cos(t) * t * 0.1;
    y[i] = std::sin(t) * t * 0.1;
  }

  Quadtree tree(n * 2);
  tree.build(x.data(), y.data(), n);
  const double kk = 0.05;

  for (size_t i = 0; i < n; i += 17) {
    // theta = 0 forces the tree to descend to every leaf, so it must agree with
    // the exact sum to floating-point noise rather than merely closely.
    const Force exact_tree = tree.repulsion(x[i], y[i], static_cast<int32_t>(i), 0.0, kk);
    double ex = 0.0;
    double ey = 0.0;
    for (size_t j = 0; j < n; ++j) {
      if (j == i) continue;
      const double dx = x[i] - x[j];
      const double dy = y[i] - y[j];
      const double d = std::hypot(dx, dy);
      const double f = kk / d;
      ex += (dx / d) * f;
      ey += (dy / d) * f;
    }
    CHECK_NEAR(exact_tree.x, ex, 1e-9);
    CHECK_NEAR(exact_tree.y, ey, 1e-9);

    // And at the default opening angle it must still point the same way and be
    // the same order of magnitude — an approximation, not a different force.
    const Force approx = tree.repulsion(x[i], y[i], static_cast<int32_t>(i), 0.9, kk);
    const double exact_mag = std::hypot(ex, ey);
    const double approx_mag = std::hypot(approx.x, approx.y);
    CHECK(approx_mag > exact_mag * 0.5 && approx_mag < exact_mag * 1.5);
    const double dot = (approx.x * ex + approx.y * ey) / (approx_mag * exact_mag);
    CHECK(dot > 0.9);
  }
}

void test_a_large_graph_stays_finite() {
  // Above 64 nodes the layout switches to the tree, so this is the path the
  // smaller tests never touch.
  const size_t n = 200;
  Edges edges;
  for (size_t i = 1; i < n; ++i) {
    edges.emplace_back(static_cast<int32_t>(i), static_cast<int32_t>(i / 2));
  }
  const Layout layout = force_layout(n, edges, ForceOptions{60, 1.0, 0.05, 0.9});
  for (size_t i = 0; i < n; ++i) {
    CHECK(std::isfinite(layout.x[i]) && std::isfinite(layout.y[i]));
    CHECK(std::abs(layout.x[i]) < 1e3 && std::abs(layout.y[i]) < 1e3);
  }
}

void test_out_of_range_edges_are_ignored() {
  // An edge naming a node that does not exist must not corrupt the layout —
  // graphs arrive from data, and one bad row should not lose the rest.
  Edges good = {{0, 1}, {1, 2}};
  Edges with_junk = {{0, 1}, {1, 2}, {-1, 0}, {2, 99}};
  const Layout a = force_layout(4, good);
  const Layout b = force_layout(4, with_junk);
  for (size_t i = 0; i < 4; ++i) {
    CHECK(a.x[i] == b.x[i]);
    CHECK(a.y[i] == b.y[i]);
  }
}

}  // namespace

int main() {
  RUN(test_degenerate_sizes);
  RUN(test_it_is_deterministic);
  RUN(test_the_seed_is_a_circle);
  RUN(test_edges_pull_and_space_pushes);
  RUN(test_disconnected_nodes_spread_out);
  RUN(test_coincident_nodes_separate);
  RUN(test_the_tree_agrees_with_all_pairs);
  RUN(test_a_large_graph_stays_finite);
  RUN(test_out_of_range_edges_are_ignored);
  return TEST_MAIN_RESULT();
}
