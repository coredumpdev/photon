#include "layers/pick.hpp"

#include <algorithm>
#include <cmath>

namespace photon {
namespace {

/// Below this, a linear scan beats the setup a binary search needs.
constexpr size_t kBinarySearchMin = 64;

struct Best {
  int32_t index = -1;
  double dist = std::numeric_limits<double>::infinity();
};

/**
 * Index of the last point whose projected x is at or before the cursor.
 *
 * Searches the *projected* value rather than the data value, so a log scale or
 * a reversed domain works without a special case — all it needs is that the
 * projection be monotonic, which every scale here is.
 */
size_t locate(const std::vector<double>& xs, const PickProjection& project, double cursor_px,
              bool ascending) {
  size_t lo = 0;
  size_t hi = xs.size() - 1;
  while (lo < hi) {
    const size_t mid = (lo + hi) / 2;
    const bool before = ascending ? project.project_x(xs[mid]) < cursor_px
                                  : project.project_x(xs[mid]) > cursor_px;
    if (before) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

double metric(PickMode mode, double dx, double dy) {
  switch (mode) {
    case PickMode::X: return std::abs(dx);
    case PickMode::Y: return std::abs(dy);
    default: return std::hypot(dx, dy);
  }
}

/// Straight scan — the fallback for unsorted data, such as a scatter cloud.
Best scan(const std::vector<double>& xs, const std::vector<double>& ys, PickMode mode,
          double cursor_px, double cursor_py, const PickProjection& project) {
  Best best;
  for (size_t i = 0; i < xs.size(); ++i) {
    const double d = metric(mode, project.project_x(xs[i]) - cursor_px,
                            project.project_y(ys[i]) - cursor_py);
    if (d < best.dist) {
      best.dist = d;
      best.index = static_cast<int32_t>(i);
    }
  }
  return best;
}

/**
 * Sorted x: land on the cursor, then widen outwards. The x gap alone is a lower
 * bound on the distance, so the walk stops as soon as it exceeds the best found
 * — usually after a couple of points.
 */
Best sorted_search(const std::vector<double>& xs, const std::vector<double>& ys, PickMode mode,
                   double cursor_px, double cursor_py, const PickProjection& project,
                   bool ascending, double gate_px) {
  const size_t count = xs.size();
  const size_t start = locate(xs, project, cursor_px, ascending);
  Best best;
  // Anything past the gate is unpickable, so it bounds the walk from the start.
  // Without it an "xy" pick whose cursor sits off the data keeps a loose bound
  // and walks a large share of a dense series.
  best.dist = gate_px;

  const auto consider = [&](size_t i) {
    const double dx = project.project_x(xs[i]) - cursor_px;
    const double adx = std::abs(dx);
    if (mode == PickMode::X) {
      if (adx < best.dist) {
        best.dist = adx;
        best.index = static_cast<int32_t>(i);
      }
      return adx;
    }
    const double dy = project.project_y(ys[i]) - cursor_py;
    const double d = metric(mode, dx, dy);
    if (d < best.dist) {
      best.dist = d;
      best.index = static_cast<int32_t>(i);
    }
    return adx;
  };

  // Outwards from `start`, in both directions.
  for (size_t i = start; i < count; ++i) {
    if (consider(i) > best.dist) break;
  }
  for (size_t i = start; i-- > 0;) {
    if (consider(i) > best.dist) break;
  }
  if (best.index < 0) best.dist = std::numeric_limits<double>::infinity();
  return best;
}

}  // namespace

double PickProjection::project_x(double value) const {
  return x_left + (scale_x ? scale_x->norm(value) : value) * x_width;
}

double PickProjection::project_y(double value) const {
  // Pixels grow downward and data grows up, which is the whole of the flip.
  return y_top + (1.0 - (scale_y ? scale_y->norm(value) : value)) * y_height;
}

bool pick_nearest(const std::vector<double>& xs, const std::vector<double>& ys, PickMode mode,
                  double cursor_px, double cursor_py, const PickProjection& project,
                  double gate_px, bool sorted_x, Picked& out) {
  const size_t count = std::min(xs.size(), ys.size());
  if (count == 0) return false;

  // A "y" pick ranks purely on vertical distance, so no x bound can prune it.
  const bool can_bisect = sorted_x && mode != PickMode::Y && count >= kBinarySearchMin;
  const Best best =
      can_bisect
          ? sorted_search(xs, ys, mode, cursor_px, cursor_py, project,
                          project.project_x(xs[count - 1]) >= project.project_x(xs[0]), gate_px)
          : scan(xs, ys, mode, cursor_px, cursor_py, project);

  if (best.index < 0 || best.dist > gate_px) return false;
  out.x = xs[static_cast<size_t>(best.index)];
  out.y = ys[static_cast<size_t>(best.index)];
  out.index = best.index;
  return true;
}

}  // namespace photon
