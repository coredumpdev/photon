// Port of the parts of core/src/stats/index.ts the layers need.
//
// Pure array→array, like the rest of stats/: no GL, no plot, nothing to mock.
// The layers that use these are the ones whose *shape* is a summary rather than
// the data — a box plot draws five numbers per group, not the group.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::stats {

/// The five-number summary a Tukey box plot draws, plus what falls outside it.
struct BoxStats {
  double min = 0.0;
  double q1 = 0.0;
  double median = 0.0;
  double q3 = 0.0;
  double max = 0.0;
  /// The whisker ends: the extreme values still inside the 1.5-IQR fences.
  double whisker_lo = 0.0;
  double whisker_hi = 0.0;
  std::vector<double> outliers;
  bool valid = false;
};

/// Linear-interpolated quantile of an already-sorted array.
double quantile_sorted(const std::vector<double>& sorted, double q);

/// Quartiles, whiskers and outliers. Copies and sorts; the input is untouched.
BoxStats box_stats(const double* values, size_t count);

/// A kernel density estimate sampled on a regular grid: the violin's outline.
struct Density {
  std::vector<double> xs;
  std::vector<double> ys;
};

/// Gaussian KDE over [lo, hi] at `points` samples, Silverman's rule for h.
Density kde(const double* values, size_t count, double lo, double hi, size_t points = 64);

}  // namespace photon::stats
