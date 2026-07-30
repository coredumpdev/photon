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

/// A one-dimensional histogram: bin edges, the count in each, and the centres.
struct Histogram {
  std::vector<double> edges;
  std::vector<double> counts;
  std::vector<double> centers;
  double bin_width = 0.0;
};

/**
 * Bin `values` into equal-width buckets.
 *
 * `bins` of 0 means Sturges' rule, which is what the TypeScript's omitted
 * option resolves to. `lo == hi` means "measure the range from the data";
 * anything else pins it, and values outside are dropped rather than clamped.
 */
Histogram histogram(const double* values, size_t count, int bins = 0, double lo = 0.0,
                    double hi = 0.0);

/// The same over explicit edges, which is the other half of the TS signature.
Histogram histogram_edges(const double* values, size_t count, const double* edges,
                          size_t edge_count);

/// A two-dimensional histogram — a point cloud binned onto a regular grid.
struct Histogram2D {
  /// Row-major counts, `cols * rows`, row 0 at the bottom.
  std::vector<double> values;
  size_t cols = 0;
  size_t rows = 0;
  double x0 = 0.0, x1 = 0.0, y0 = 0.0, y1 = 0.0;
};

/// matplotlib's `hist2d`. A zero span on either axis is measured from the data.
Histogram2D hist2d(const double* x, const double* y, size_t count, int cols = 0, int rows = 0,
                   double x0 = 0.0, double x1 = 0.0, double y0 = 0.0, double y1 = 0.0);

/// In-place iterative radix-2 Cooley-Tukey FFT. `n` must be a power of two.
void fft(double* re, double* im, size_t n);

/// A short-time Fourier transform as a time x frequency grid of decibels.
struct Spectrogram {
  /// Row-major, rows = frequency bins with the lowest at row 0, cols = frames.
  std::vector<double> values;
  size_t cols = 0;
  size_t rows = 0;
  double x0 = 0.0, x1 = 0.0, y0 = 0.0, y1 = 0.0;
};

Spectrogram spectrogram(const double* signal, size_t count, int fft_size = 256, int hop = 0,
                        double sample_rate = 1.0);

}  // namespace photon::stats
