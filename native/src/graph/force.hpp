// Port of core/src/graph/force.ts.
//
// A tiny deterministic force-directed layout (Fruchterman-Reingold style).
// Nodes seed on a unit circle rather than at random, which is what makes it
// unit-testable and what makes two hosts draw the same graph.
#pragma once

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace photon::graph {

struct ForceOptions {
  int32_t iterations = 300;
  /// Layout area; the ideal edge length is sqrt(area / n).
  double area = 1.0;
  /// Pull toward the origin each step.
  double gravity = 0.05;
  /// Barnes-Hut opening angle. Smaller is more accurate and slower; 0 is exact.
  double theta = 0.9;
};

struct Layout {
  std::vector<double> x;
  std::vector<double> y;
};

/// Relax `node_count` nodes under repulsion, per-edge attraction and gravity.
Layout force_layout(size_t node_count, const std::vector<std::pair<int32_t, int32_t>>& edges,
                    const ForceOptions& opts = {});

}  // namespace photon::graph
