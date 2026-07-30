// Fits and summaries — port of core/src/stats/regression.ts.
//
// What turns a scatter into a claim: a trend line with a band around it, a
// local-regression smoother, an ECDF, a correlation matrix. All pure, and all
// skipping non-finite pairs rather than propagating them, because a single
// missing sample should cost one point rather than the whole fit.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::stats {

/// An ordinary-least-squares fit of y = slope*x + intercept.
struct LinearFit {
  double slope = 0.0;
  double intercept = 0.0;
  /// Coefficient of determination, 0..1.
  double r2 = 0.0;
  /// Standard error of the residuals.
  double stderror = 0.0;
  /// Points used; non-finite pairs are skipped.
  size_t n = 0;

  double predict(double x) const { return slope * x + intercept; }
};

LinearFit linear_regression(const double* x, const double* y, size_t count);

/// A smoothed curve sampled on a grid, with an optional band around it.
struct Trend {
  std::vector<double> x;
  std::vector<double> y;
  /// Empty unless a band was asked for.
  std::vector<double> lower;
  std::vector<double> upper;
};

/// Sample a linear fit across the data range, with an optional +/- k*stderr
/// band. `points` of 0 means 2 — enough for the line itself.
Trend linear_trend(const double* x, const double* y, size_t count, int points = 2,
                   double band = 0.0);

/// LOESS: locally-weighted linear regression with a tricube kernel.
/// `bandwidth` is the fraction of points in each neighbourhood, 0 means 0.3.
Trend loess(const double* x, const double* y, size_t count, double bandwidth = 0.3,
            int points = 100);

/// The empirical CDF as a step function: sorted values against their cumulative
/// proportion. Non-finite values are dropped, so the result may be shorter.
Trend ecdf(const double* values, size_t count);

/// Standardize to zero mean and unit population variance. Non-finite entries
/// pass through untouched, which is how a gap stays a gap.
std::vector<double> zscore(const double* values, size_t count);

/// Pearson correlation of two series; 0 when either is constant.
double correlation(const double* a, const double* b, size_t count);

/// Row-major k*k Pearson correlation matrix over `k` equal-length columns.
std::vector<double> corr_matrix(const double* const* columns, size_t k, size_t count);

}  // namespace photon::stats
