#include "graph/force.hpp"

#include <algorithm>
#include <cmath>

#include "graph/quadtree.hpp"

namespace photon::graph {
namespace {

/// Below this, all-pairs is cheaper than building a tree each iteration.
constexpr size_t kBarnesHutMin = 64;
constexpr double kPi = 3.14159265358979323846;

}  // namespace

Layout force_layout(size_t node_count, const std::vector<std::pair<int32_t, int32_t>>& edges,
                    const ForceOptions& opts) {
  Layout out;
  out.x.resize(node_count);
  out.y.resize(node_count);
  // Seeded on a unit circle, not at random: this is what makes the layout
  // reproducible, and what lets two hosts draw the same graph.
  for (size_t i = 0; i < node_count; ++i) {
    const double a = (static_cast<double>(i) / static_cast<double>(node_count)) * kPi * 2.0;
    out.x[i] = std::cos(a);
    out.y[i] = std::sin(a);
  }
  if (node_count < 2) return out;

  const double k = std::sqrt(opts.area / static_cast<double>(node_count));  // ideal edge length
  const double kk = k * k;
  std::vector<double> disp_x(node_count);
  std::vector<double> disp_y(node_count);
  double temp = 0.1;

  const bool use_tree = opts.theta > 0.0 && node_count >= kBarnesHutMin;
  Quadtree tree(node_count * 2);

  for (int32_t it = 0; it < opts.iterations; ++it) {
    std::fill(disp_x.begin(), disp_x.end(), 0.0);
    std::fill(disp_y.begin(), disp_y.end(), 0.0);

    // Repulsion: f = k^2 / d summed over pairs, approximated for large graphs.
    if (use_tree) {
      tree.build(out.x.data(), out.y.data(), node_count);
      for (size_t i = 0; i < node_count; ++i) {
        const Force f = tree.repulsion(out.x[i], out.y[i], static_cast<int32_t>(i), opts.theta, kk);
        disp_x[i] += f.x;
        disp_y[i] += f.y;
      }
    } else {
      for (size_t i = 0; i < node_count; ++i) {
        for (size_t j = i + 1; j < node_count; ++j) {
          const double dx = out.x[i] - out.x[j];
          const double dy = out.y[i] - out.y[j];
          double d = std::hypot(dx, dy);
          if (d == 0.0) d = 1e-6;
          const double f = kk / d;
          const double ux = dx / d;
          const double uy = dy / d;
          disp_x[i] += ux * f;
          disp_y[i] += uy * f;
          disp_x[j] -= ux * f;
          disp_y[j] -= uy * f;
        }
      }
    }

    // Attraction along edges: f = d^2 / k.
    for (const auto& edge : edges) {
      const size_t a = static_cast<size_t>(edge.first);
      const size_t b = static_cast<size_t>(edge.second);
      if (edge.first < 0 || edge.second < 0 || a >= node_count || b >= node_count) continue;
      const double dx = out.x[a] - out.x[b];
      const double dy = out.y[a] - out.y[b];
      double d = std::hypot(dx, dy);
      if (d == 0.0) d = 1e-6;
      const double f = (d * d) / k;
      const double ux = dx / d;
      const double uy = dy / d;
      disp_x[a] -= ux * f;
      disp_y[a] -= uy * f;
      disp_x[b] += ux * f;
      disp_y[b] += uy * f;
    }

    // Gravity, then move, capped by the current temperature.
    for (size_t i = 0; i < node_count; ++i) {
      disp_x[i] -= out.x[i] * opts.gravity;
      disp_y[i] -= out.y[i] * opts.gravity;
      double d = std::hypot(disp_x[i], disp_y[i]);
      if (d == 0.0) d = 1e-6;
      const double lim = std::min(d, temp);
      out.x[i] += (disp_x[i] / d) * lim;
      out.y[i] += (disp_y[i] / d) * lim;
    }
    temp *= 0.99;
  }
  return out;
}

}  // namespace photon::graph
