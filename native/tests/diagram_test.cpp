/*
 * The seven diagram layouts.
 *
 * A transcription of the layout half of packages/core/test/charts.test.ts, plus
 * the properties the TypeScript checks by eye. These are the charts with no
 * shader — every one is polygon arithmetic, and the failure mode is not a blank
 * screen but a picture that looks plausible and encodes the wrong number. So
 * what is checked is conservation: a treemap's cells fill their extent, a
 * sunburst's children span exactly their parent, a Sankey's ribbons are as
 * thick as the flow they carry.
 */

#include <cmath>
#include <cstddef>
#include <vector>

#include "charts/diagrams.hpp"
#include "check.h"

namespace ch = photon::charts;

namespace {

double ring_area(const ch::Ring& r) {
  // The shoelace formula, unsigned — winding is the layout's business.
  double sum = 0.0;
  const size_t n = r.x.size();
  for (size_t i = 0; i < n; ++i) {
    const size_t j = (i + 1) % n;
    sum += r.x[i] * r.y[j] - r.x[j] * r.y[i];
  }
  return std::abs(sum) / 2.0;
}

void test_treemap_tiles_its_extent() {
  const std::vector<double> values{3, 1, 1};
  const std::vector<ch::TreemapCell> cells =
      ch::treemap_layout(values.data(), values.size(), 0.0, 0.0, 1.0, 1.0);
  CHECK_EQ(cells.size(), 3);
  double area = 0.0;
  for (const ch::TreemapCell& c : cells) {
    CHECK(c.x1 > c.x0);
    CHECK(c.y1 > c.y0);
    area += (c.x1 - c.x0) * (c.y1 - c.y0);
  }
  CHECK_NEAR(area, 1.0, 1e-9);
}

void test_treemap_areas_follow_the_values() {
  // Not in the TypeScript, which only checks the total. A cell whose area is
  // not its share is a treemap that lies, and it looks fine.
  const std::vector<double> values{5, 3, 2};
  const std::vector<ch::TreemapCell> cells =
      ch::treemap_layout(values.data(), values.size(), 0.0, 0.0, 2.0, 1.0);
  for (const ch::TreemapCell& c : cells) {
    const double share = values[c.item] / 10.0;
    CHECK_NEAR((c.x1 - c.x0) * (c.y1 - c.y0), share * 2.0, 1e-9);
  }
}

void test_treemap_drops_non_positive_values_and_keeps_the_index() {
  const std::vector<double> values{4, 0, -1, 4};
  const std::vector<ch::TreemapCell> cells =
      ch::treemap_layout(values.data(), values.size(), 0.0, 0.0, 1.0, 1.0);
  CHECK_EQ(cells.size(), 2);
  // The surviving cells still name where they came from, which is what keeps a
  // caller's labels and colours lined up.
  CHECK(cells[0].item == 0 || cells[0].item == 3);
  CHECK(cells[1].item == 0 || cells[1].item == 3);
  CHECK(cells[0].item != cells[1].item);
}

void test_funnel_stacks_one_trapezoid_per_stage() {
  const std::vector<double> values{100, 50};
  const std::vector<ch::Ring> stages = ch::funnel_layout(values.data(), values.size());
  CHECK_EQ(stages.size(), 2);
  CHECK_EQ(stages[0].x.size(), 4);
  // The top stage spans the full width; the second is half of it.
  CHECK_NEAR(stages[0].x[1] - stages[0].x[0], 1.0, 1e-12);
  CHECK_NEAR(stages[1].x[1] - stages[1].x[0], 0.5, 1e-12);
  // The first stage's bottom edge is the second's top edge, or the funnel has
  // a step in it.
  CHECK_NEAR(stages[0].x[2], stages[1].x[1], 1e-12);
  CHECK_NEAR(stages[0].y[2], stages[1].y[0], 1e-12);
}

void test_sunburst_children_span_exactly_their_parent() {
  // Root with two equal leaves: each takes half the circle.
  const std::vector<ch::SunburstNode> nodes{{-1, 0.0}, {0, 1.0}, {0, 1.0}};
  const std::vector<ch::SunburstArc> arcs =
      ch::sunburst_layout(nodes.data(), nodes.size());
  CHECK_EQ(arcs.size(), 3);
  for (const ch::SunburstArc& a : arcs) CHECK(a.r1 >= a.r0);
  CHECK_NEAR(arcs[0].a1 - arcs[0].a0, 2.0 * 3.14159265358979323846, 1e-12);
  CHECK_NEAR(arcs[1].a1 - arcs[1].a0, 3.14159265358979323846, 1e-12);
  CHECK_NEAR(arcs[2].a0, arcs[1].a1, 1e-12);
  CHECK_NEAR(arcs[2].a1, arcs[0].a1, 1e-12);
  CHECK_EQ(arcs[1].depth, 1);
  CHECK_NEAR(arcs[1].r0, 1.0, 1e-12);
}

void test_sunburst_weights_children_by_value() {
  // Three to one, so the first child takes three quarters of the sweep.
  const std::vector<ch::SunburstNode> nodes{{-1, 0.0}, {0, 3.0}, {0, 1.0}};
  const std::vector<ch::SunburstArc> arcs = ch::sunburst_layout(nodes.data(), nodes.size());
  const double full = 2.0 * 3.14159265358979323846;
  CHECK_NEAR(arcs[1].a1 - arcs[1].a0, full * 0.75, 1e-12);
  CHECK_NEAR(arcs[2].a1 - arcs[2].a0, full * 0.25, 1e-12);
}

void test_gauge_produces_three_polygons() {
  const ch::GaugeLayout g = ch::gauge_layout(50.0, 0.0, 100.0);
  CHECK(g.track.x.size() > 2);
  CHECK(g.value.x.size() > 2);
  CHECK_EQ(g.needle.x.size(), 3);
  // Half the range is half the sweep, so the value arc is about half the track.
  CHECK(ring_area(g.value) > ring_area(g.track) * 0.4);
  CHECK(ring_area(g.value) < ring_area(g.track) * 0.6);
}

void test_gauge_clamps_out_of_range_values() {
  // Not in the TypeScript. A needle past the end of the dial is a chart that
  // has silently stopped meaning anything.
  const ch::GaugeLayout under = ch::gauge_layout(-40.0, 0.0, 100.0);
  const ch::GaugeLayout over = ch::gauge_layout(500.0, 0.0, 100.0);
  CHECK_NEAR(ring_area(under.value), 0.0, 1e-9);
  CHECK_NEAR(ring_area(over.value), ring_area(over.track), 1e-9);
}

void test_sankey_places_a_rect_per_node_and_a_ribbon_per_link() {
  const std::vector<ch::SankeyLink> links{{0, 2, 5.0}, {1, 2, 3.0}};
  const ch::SankeyLayout r = ch::sankey_layout(3, links.data(), links.size());
  CHECK_EQ(r.nodes.size(), 3);
  CHECK_EQ(r.ribbons.size(), 2);
  // Nodes 0 and 1 are sources, so they share a column; node 2 is downstream.
  CHECK_NEAR(r.nodes[0].x0, r.nodes[1].x0, 1e-12);
  CHECK(r.nodes[2].x0 > r.nodes[0].x0);
  // Node 2 carries both flows, so it is as tall as the two sources together.
  const double sources = (r.nodes[0].y1 - r.nodes[0].y0) + (r.nodes[1].y1 - r.nodes[1].y0);
  CHECK_NEAR(r.nodes[2].y1 - r.nodes[2].y0, sources, 1e-9);
}

void test_sankey_skips_a_link_naming_a_node_that_is_not_there() {
  // A flow table arrives from data, and one bad row should not lose the rest.
  const std::vector<ch::SankeyLink> links{{0, 1, 5.0}, {0, 99, 5.0}, {-1, 1, 5.0}};
  const ch::SankeyLayout r = ch::sankey_layout(2, links.data(), links.size());
  CHECK_EQ(r.ribbons.size(), 1);
  CHECK_EQ(r.ribbon_link[0], 0);
}

void test_chord_arcs_and_ribbons() {
  const std::vector<double> matrix{0, 1, 2, 1, 0, 3, 2, 3, 0};
  const ch::ChordLayout r = ch::chord_layout(matrix.data(), 3);
  CHECK_EQ(r.arcs.size(), 3);
  // Three unordered pairs with flow: (0,1), (0,2), (1,2). The diagonal is zero.
  CHECK_EQ(r.ribbons.size(), 3);
  CHECK_EQ(r.group_mid.size(), 3);
  // Group 2 has the largest row sum, so its arc is the biggest.
  CHECK(ring_area(r.arcs[2]) > ring_area(r.arcs[0]));
}

void test_chord_with_no_flow_is_empty_rather_than_a_ring_of_nothing() {
  const std::vector<double> zeros(9, 0.0);
  const ch::ChordLayout r = ch::chord_layout(zeros.data(), 3);
  CHECK(r.arcs.empty());
  CHECK(r.ribbons.empty());
}

void test_parallel_normalises_each_dimension_by_its_own_range() {
  const std::vector<double> rows{0, 1, 2, 1, 0, 1, 0.5, 0.5, 0.5};
  const ch::ParallelLayout r = ch::parallel_layout(rows.data(), 3, 3);
  CHECK_EQ(r.lines.size(), 3);
  CHECK_EQ(r.lines[0].size(), 3);
  for (const std::vector<double>& line : r.lines) {
    for (const double y : line) CHECK(y >= 0.0 && y <= 1.0);
  }
  // Dimension 2 runs 0.5..2, so row 0's 2 is the top and row 1's 1 is a third.
  CHECK_NEAR(r.min[2], 0.5, 1e-12);
  CHECK_NEAR(r.max[2], 2.0, 1e-12);
  CHECK_NEAR(r.lines[0][2], 1.0, 1e-12);
  CHECK_NEAR(r.lines[1][2], (1.0 - 0.5) / 1.5, 1e-12);
}

void test_parallel_puts_a_flat_or_missing_dimension_at_the_midpoint() {
  const double nan = std::nan("");
  const std::vector<double> rows{7.0, nan, 7.0, nan};
  const ch::ParallelLayout r = ch::parallel_layout(rows.data(), 2, 2);
  // Dimension 0 is constant, dimension 1 has no finite value at all. Both are
  // drawn down the middle rather than as NaN, which would not draw at all.
  for (const std::vector<double>& line : r.lines) {
    for (const double y : line) CHECK_NEAR(y, 0.5, 1e-12);
  }
}

void test_the_degenerate_inputs() {
  CHECK(ch::treemap_layout(nullptr, 0, 0, 0, 1, 1).empty());
  CHECK(ch::funnel_layout(nullptr, 0).empty());
  CHECK(ch::sunburst_layout(nullptr, 0).empty());
  CHECK(ch::sankey_layout(0, nullptr, 0).nodes.empty());
  CHECK(ch::chord_layout(nullptr, 0).arcs.empty());
  CHECK(ch::parallel_layout(nullptr, 0, 0).lines.empty());
  // A gauge always draws: a dial with no reading is still a dial.
  CHECK(ch::gauge_layout(0.0).track.x.size() > 2);
}

}  // namespace

int main() {
  RUN(test_treemap_tiles_its_extent);
  RUN(test_treemap_areas_follow_the_values);
  RUN(test_treemap_drops_non_positive_values_and_keeps_the_index);
  RUN(test_funnel_stacks_one_trapezoid_per_stage);
  RUN(test_sunburst_children_span_exactly_their_parent);
  RUN(test_sunburst_weights_children_by_value);
  RUN(test_gauge_produces_three_polygons);
  RUN(test_gauge_clamps_out_of_range_values);
  RUN(test_sankey_places_a_rect_per_node_and_a_ribbon_per_link);
  RUN(test_sankey_skips_a_link_naming_a_node_that_is_not_there);
  RUN(test_chord_arcs_and_ribbons);
  RUN(test_chord_with_no_flow_is_empty_rather_than_a_ring_of_nothing);
  RUN(test_parallel_normalises_each_dimension_by_its_own_range);
  RUN(test_parallel_puts_a_flat_or_missing_dimension_at_the_midpoint);
  RUN(test_the_degenerate_inputs);
  return TEST_MAIN_RESULT();
}
