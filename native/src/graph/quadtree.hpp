// Port of core/src/graph/quadtree.ts.
//
// A flat quadtree over 2-D points, for Barnes-Hut force approximation. Stored
// in parallel arrays rather than nodes, because a force layout rebuilds the
// tree every iteration and a node object per point would cost more than the
// traversal it enables.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace photon::graph {

/// Accumulated force, so `repulsion` returns two numbers without allocating.
struct Force {
  double x = 0.0;
  double y = 0.0;
};

class Quadtree {
 public:
  explicit Quadtree(size_t capacity = 64);

  /// Rebuild over `n` points. Reuses the existing arrays.
  void build(const double* x, const double* y, size_t n);

  /**
   * Accumulate the repulsive force on the point `self` at (px, py).
   *
   * A subtree acts as one body when its width over its distance is below
   * `theta` — the Barnes-Hut criterion. `k_squared` is the layout's force
   * constant: the magnitude for one unit of mass at distance d is k^2 / d.
   */
  Force repulsion(double px, double py, int32_t self, double theta, double k_squared) const;

 private:
  int32_t new_node(double cx, double cy, double half);
  void insert(int32_t node, int32_t i, double px, double py, int32_t depth);
  void descend(int32_t node, int32_t i, double px, double py, int32_t depth);

  std::vector<double> cx_;
  std::vector<double> cy_;
  std::vector<double> half_;
  std::vector<double> mass_x_;
  std::vector<double> mass_y_;
  std::vector<double> mass_;
  /// Four child ids per node; -1 is empty.
  std::vector<int32_t> child_;
  /// The single point in a leaf, or -1 when the node is internal or empty.
  std::vector<int32_t> point_;
  size_t count_ = 0;
  /// The traversal stack, reused across calls; repulsion() is the hot path.
  mutable std::vector<int32_t> stack_;
};

}  // namespace photon::graph
