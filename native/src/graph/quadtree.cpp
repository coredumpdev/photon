#include "graph/quadtree.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace photon::graph {
namespace {

constexpr int32_t kNoChild = -1;
/// Coincident points would subdivide forever; past this a leaf just accumulates
/// them, which is harmless because Barnes-Hut only reads mass and centroid.
constexpr int32_t kMaxDepth = 24;

}  // namespace

Quadtree::Quadtree(size_t capacity) {
  const size_t cap = std::max<size_t>(4, capacity);
  cx_.resize(cap);
  cy_.resize(cap);
  half_.resize(cap);
  mass_x_.resize(cap);
  mass_y_.resize(cap);
  mass_.resize(cap);
  child_.assign(cap * 4, kNoChild);
  point_.assign(cap, -1);
  stack_.resize(4096);
}

int32_t Quadtree::new_node(double cx, double cy, double half) {
  if (count_ == cx_.size()) {
    const size_t cap = cx_.size() * 2;
    cx_.resize(cap);
    cy_.resize(cap);
    half_.resize(cap);
    mass_x_.resize(cap);
    mass_y_.resize(cap);
    mass_.resize(cap);
    child_.resize(cap * 4, kNoChild);
    point_.resize(cap, -1);
  }
  const size_t i = count_++;
  cx_[i] = cx;
  cy_[i] = cy;
  half_[i] = half;
  mass_x_[i] = 0.0;
  mass_y_[i] = 0.0;
  mass_[i] = 0.0;
  child_[i * 4] = kNoChild;
  child_[i * 4 + 1] = kNoChild;
  child_[i * 4 + 2] = kNoChild;
  child_[i * 4 + 3] = kNoChild;
  point_[i] = -1;
  return static_cast<int32_t>(i);
}

void Quadtree::build(const double* x, const double* y, size_t n) {
  count_ = 0;
  if (n == 0 || !x || !y) return;

  double min_x = std::numeric_limits<double>::infinity();
  double min_y = min_x;
  double max_x = -min_x;
  double max_y = -min_x;
  for (size_t i = 0; i < n; ++i) {
    min_x = std::min(min_x, x[i]);
    max_x = std::max(max_x, x[i]);
    min_y = std::min(min_y, y[i]);
    max_y = std::max(max_y, y[i]);
  }
  double half = std::max(max_x - min_x, max_y - min_y) / 2.0;
  if (!(half > 0.0)) half = 1.0;
  new_node((min_x + max_x) / 2.0, (min_y + max_y) / 2.0, half * 1.0001);
  for (size_t i = 0; i < n; ++i) insert(0, static_cast<int32_t>(i), x[i], y[i], 0);
}

void Quadtree::insert(int32_t node, int32_t i, double px, double py, int32_t depth) {
  const size_t at = static_cast<size_t>(node);
  mass_[at] += 1.0;
  mass_x_[at] += px;
  mass_y_[at] += py;

  const int32_t existing = point_[at];
  const bool is_leaf = child_[at * 4] == kNoChild;

  if (is_leaf && existing == -1 && mass_[at] == 1.0) {
    point_[at] = i;
    return;
  }
  if (depth >= kMaxDepth) return;

  if (is_leaf) {
    // Push the resident point down before adding the new one. Its coordinates
    // come back out of the accumulated mass, which is why they were added first.
    point_[at] = -1;
    if (existing >= 0) {
      descend(node, existing, mass_x_[at] - px, mass_y_[at] - py, depth);
    }
  }
  descend(node, i, px, py, depth);
}

void Quadtree::descend(int32_t node, int32_t i, double px, double py, int32_t depth) {
  const size_t at = static_cast<size_t>(node);
  const double cx = cx_[at];
  const double cy = cy_[at];
  const double h = half_[at];
  const int32_t q = (px >= cx ? 1 : 0) + (py >= cy ? 2 : 0);
  int32_t c = child_[at * 4 + static_cast<size_t>(q)];
  if (c == kNoChild) {
    const double qh = h / 2.0;
    c = new_node(cx + ((q & 1) ? qh : -qh), cy + ((q & 2) ? qh : -qh), qh);
    child_[at * 4 + static_cast<size_t>(q)] = c;
  }
  insert(c, i, px, py, depth + 1);
}

Force Quadtree::repulsion(double px, double py, int32_t self, double theta,
                          double k_squared) const {
  Force out;
  if (count_ == 0) return out;

  // An explicit stack: recursion here is the hot path of every iteration.
  size_t sp = 0;
  stack_[sp++] = 0;
  while (sp > 0) {
    const size_t node = static_cast<size_t>(stack_[--sp]);
    const double m = mass_[node];
    if (m == 0.0) continue;
    const double ncx = mass_x_[node] / m;
    const double ncy = mass_y_[node] / m;
    double dx = px - ncx;
    double dy = py - ncy;
    double d = std::sqrt(dx * dx + dy * dy);
    const int32_t leaf_point = point_[node];

    if (leaf_point >= 0) {
      if (leaf_point == self) continue;
    } else if (half_[node] * 2.0 / (d != 0.0 ? d : 1e-9) >= theta) {
      // Too close to approximate — descend, if there is anywhere to descend to.
      // A node at the depth limit holds coincident points and has no children;
      // it still carries mass, so it falls through and acts as one body.
      bool pushed = false;
      for (size_t q = 0; q < 4; ++q) {
        const int32_t c = child_[node * 4 + q];
        if (c != kNoChild && sp < stack_.size()) {
          stack_[sp++] = c;
          pushed = true;
        }
      }
      if (pushed) continue;
    }
    if (d < 1e-9) {
      // Coincident: nudge along a fixed axis so the pair still separates.
      dx = 1e-6;
      dy = 0.0;
      d = 1e-6;
    }
    const double f = (k_squared / d) * m;
    out.x += (dx / d) * f;
    out.y += (dy / d) * f;
  }
  return out;
}

}  // namespace photon::graph
