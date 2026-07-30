// Largest-Triangle-Three-Buckets — port of core/src/data/downsample.ts.
//
// Reduces a series to `threshold` points while keeping its *shape*: peaks and
// troughs survive where a stride or an average would flatten them. The first
// and last points are always kept, so the line still starts and ends where the
// data does.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::data {

struct Downsampled {
  std::vector<double> x;
  std::vector<double> y;
};

/// A threshold at or above the input length, or of 2 or less, copies through.
Downsampled lttb(const double* x, const double* y, size_t count, size_t threshold);

}  // namespace photon::data
