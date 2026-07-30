// The diagram layouts — port of core/src/charts/.
//
// Seven charts that are not layers: a treemap, a funnel, a sunburst, a Sankey,
// a chord, a gauge and parallel coordinates. Every one of them is a *layout*
// that turns values into polygon rings, drawn afterwards by the patches layer
// that already exists. That is the web core's arrangement too, and it is the
// reason none of these needed a shader.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::charts {

/// One closed polygon ring in data space.
struct Ring {
  std::vector<double> x;
  std::vector<double> y;
};

// -- Treemap ----------------------------------------------------------------

/// A laid-out cell: the item's index in the caller's array, and its rectangle.
struct TreemapCell {
  size_t item = 0;
  double x0 = 0.0, y0 = 0.0, x1 = 0.0, y1 = 0.0;
};

/**
 * Squarified treemap: rectangles sized in proportion to `values`, packed into
 * the extent with aspect ratios kept near one. Items with a value of zero or
 * less are dropped, which is why a cell carries the index it came from.
 */
std::vector<TreemapCell> treemap_layout(const double* values, size_t count, double x0, double y0,
                                        double x1, double y1);

// -- Funnel -----------------------------------------------------------------

/**
 * Centred trapezoids stacked top to bottom: each stage's top width is
 * proportional to its value and its bottom width to the next stage's, with the
 * last tapering to `neck` of its own width. One ring per stage, in order.
 */
std::vector<Ring> funnel_layout(const double* values, size_t count, double width = 1.0,
                                double height = 1.0, double neck = 0.4);

// -- Sunburst ---------------------------------------------------------------

/**
 * A node of the input hierarchy, flattened for the ABI's sake: `parent` is an
 * index into the same array, or -1 for the root. Children must follow their
 * parent, which is what lets the value roll-up be a single reverse pass.
 */
struct SunburstNode {
  int parent = -1;
  /// Counts only for leaves; a node with children takes their sum.
  double value = 0.0;
};

/// One laid-out sector: an angular range and a radial ring.
struct SunburstArc {
  size_t node = 0;
  size_t depth = 0;
  double a0 = 0.0, a1 = 0.0, r0 = 0.0, r1 = 0.0;
};

std::vector<SunburstArc> sunburst_layout(const SunburstNode* nodes, size_t count,
                                         double ring_width = 1.0, double center = 0.0,
                                         double start_angle = 1.5707963267948966);

/// Tessellate an annular sector into a closed ring: outer arc out, inner back.
Ring arc_ring(double a0, double a1, double r0, double r1);

// -- Sankey -----------------------------------------------------------------

struct SankeyLink {
  int source = 0;
  int target = 0;
  double value = 0.0;
};

struct NodeRect {
  size_t node = 0;
  double x0 = 0.0, y0 = 0.0, x1 = 0.0, y1 = 0.0;
};

struct SankeyLayout {
  std::vector<NodeRect> nodes;
  /// One ribbon per *valid* link, in link order; `link` is the input index.
  std::vector<Ring> ribbons;
  std::vector<size_t> ribbon_link;
};

/**
 * Nodes are placed in columns by longest path from a source, stacked by
 * throughput; links become bezier ribbons whose thickness is their value.
 * Links naming a node that does not exist are skipped rather than fatal.
 */
SankeyLayout sankey_layout(size_t node_count, const SankeyLink* links, size_t link_count,
                           double x0 = 0.0, double y0 = 0.0, double x1 = 1.0, double y1 = 1.0,
                           double node_width = 0.02, double node_padding = 0.02);

// -- Chord ------------------------------------------------------------------

struct ChordLayout {
  /// One thin annular sector per group, in group order; `arc_group` names it.
  std::vector<Ring> arcs;
  std::vector<size_t> arc_group;
  /// One ribbon per unordered pair with any flow; `ribbon_from` is the source.
  std::vector<Ring> ribbons;
  std::vector<size_t> ribbon_from;
  std::vector<size_t> ribbon_to;
  /// The angular midpoint of each group, for placing a label outside it.
  std::vector<double> group_mid;
};

/// `matrix` is row-major `n * n`; `matrix[i * n + j]` flows from i to j.
ChordLayout chord_layout(const double* matrix, size_t n, double radius = 1.0,
                         double pad_angle = 0.6283185307179586, double arc_width = 0.06,
                         int samples = 24);

// -- Gauge ------------------------------------------------------------------

struct GaugeLayout {
  Ring track;
  Ring value;
  Ring needle;
};

/// Angles are in degrees and sweep from `start_angle` to `end_angle`.
GaugeLayout gauge_layout(double value, double min = 0.0, double max = 100.0,
                         double start_angle = 200.0, double end_angle = -20.0,
                         double radius = 1.0, double inner_radius = 0.7);

// -- Parallel coordinates ---------------------------------------------------

struct ParallelLayout {
  /// Per-dimension observed range, before normalisation.
  std::vector<double> min;
  std::vector<double> max;
  /// One polyline per row, each `dims` long: x is the axis index, y is 0..1.
  std::vector<std::vector<double>> lines;
};

/**
 * Each dimension is normalised to 0..1 by its own observed range; a flat or
 * empty dimension maps to the midpoint, and so does a non-finite value — a gap
 * in one dimension should not lose the whole row.
 */
ParallelLayout parallel_layout(const double* rows, size_t row_count, size_t dims);

}  // namespace photon::charts
