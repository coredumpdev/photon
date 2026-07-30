#include "data/downsample.hpp"

#include <algorithm>
#include <cmath>

namespace photon::data {

Downsampled lttb(const double* x, const double* y, size_t count, size_t threshold) {
  Downsampled out;
  if (!x || !y) count = 0;
  if (threshold >= count || threshold <= 2) {
    out.x.assign(x, x + count);
    out.y.assign(y, y + count);
    return out;
  }

  out.x.assign(threshold, 0.0);
  out.y.assign(threshold, 0.0);
  const double bucket = static_cast<double>(count - 2) / static_cast<double>(threshold - 2);
  size_t previous = 0;  // index of the last point kept
  out.x[0] = x[0];
  out.y[0] = y[0];
  size_t at = 1;

  for (size_t i = 0; i + 2 < threshold; ++i) {
    // The next bucket's average is the triangle's third vertex.
    const size_t range_start =
        static_cast<size_t>(std::floor(static_cast<double>(i + 1) * bucket)) + 1;
    const size_t range_end = std::min(
        static_cast<size_t>(std::floor(static_cast<double>(i + 2) * bucket)) + 1, count);
    const double span = static_cast<double>(range_end > range_start ? range_end - range_start : 1);
    double avg_x = 0.0;
    double avg_y = 0.0;
    for (size_t k = range_start; k < range_end; ++k) {
      avg_x += x[k];
      avg_y += y[k];
    }
    avg_x /= span;
    avg_y /= span;

    // The point in this bucket that makes the largest triangle with the last
    // kept point and that average — which is what preserves a spike.
    size_t cursor = static_cast<size_t>(std::floor(static_cast<double>(i) * bucket)) + 1;
    const size_t stop = static_cast<size_t>(std::floor(static_cast<double>(i + 1) * bucket)) + 1;
    const double ax = x[previous];
    const double ay = y[previous];
    double max_area = -1.0;
    size_t chosen = cursor;
    for (; cursor < stop && cursor < count; ++cursor) {
      const double area =
          std::abs((ax - avg_x) * (y[cursor] - ay) - (ax - x[cursor]) * (avg_y - ay));
      if (area > max_area) {
        max_area = area;
        chosen = cursor;
      }
    }
    out.x[at] = x[chosen];
    out.y[at] = y[chosen];
    ++at;
    previous = chosen;
  }

  out.x[at] = x[count - 1];
  out.y[at] = y[count - 1];
  return out;
}

}  // namespace photon::data
