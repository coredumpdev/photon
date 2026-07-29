#include "stats/stats.hpp"

#include <algorithm>
#include <cmath>

namespace photon::stats {

double quantile_sorted(const std::vector<double>& sorted, double q) {
  const size_t n = sorted.size();
  if (n == 0) return std::nan("");
  if (n == 1) return sorted[0];
  // Linear interpolation between the two neighbouring order statistics, which
  // is what the TypeScript does and what numpy calls the "linear" method.
  const double pos = static_cast<double>(n - 1) * q;
  const size_t lo = static_cast<size_t>(std::floor(pos));
  const double frac = pos - static_cast<double>(lo);
  const double a = sorted[lo];
  const double b = sorted[std::min(n - 1, lo + 1)];
  return a + (b - a) * frac;
}

BoxStats box_stats(const double* values, size_t count) {
  BoxStats out;
  if (!values || count == 0) return out;

  std::vector<double> sorted;
  sorted.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    if (std::isfinite(values[i])) sorted.push_back(values[i]);
  }
  if (sorted.empty()) return out;
  std::sort(sorted.begin(), sorted.end());

  out.q1 = quantile_sorted(sorted, 0.25);
  out.median = quantile_sorted(sorted, 0.5);
  out.q3 = quantile_sorted(sorted, 0.75);
  const double iqr = out.q3 - out.q1;
  const double fence_lo = out.q1 - 1.5 * iqr;
  const double fence_hi = out.q3 + 1.5 * iqr;

  // The whiskers reach the furthest value still inside the fences — not the
  // fences themselves, which is the part people get wrong.
  out.whisker_lo = out.q1;
  out.whisker_hi = out.q3;
  for (const double v : sorted) {
    if (v < fence_lo || v > fence_hi) {
      out.outliers.push_back(v);
    } else {
      out.whisker_lo = std::min(out.whisker_lo, v);
      out.whisker_hi = std::max(out.whisker_hi, v);
    }
  }

  out.min = sorted.front();
  out.max = sorted.back();
  out.valid = true;
  return out;
}

namespace {

double stddev(const std::vector<double>& values, double mean) {
  if (values.empty()) return 0.0;
  double sum = 0.0;
  for (const double v : values) {
    const double d = v - mean;
    sum += d * d;
  }
  return std::sqrt(sum / static_cast<double>(values.size()));
}

}  // namespace

Density kde(const double* values, size_t count, double lo, double hi, size_t points) {
  Density out;
  if (points == 0) return out;
  std::vector<double> data;
  if (values) {
    data.reserve(count);
    for (size_t i = 0; i < count; ++i) {
      if (std::isfinite(values[i])) data.push_back(values[i]);
    }
  }

  double mean = 0.0;
  for (const double v : data) mean += v;
  mean /= static_cast<double>(std::max<size_t>(1, data.size()));
  double sd = stddev(data, mean);
  if (sd == 0.0) sd = 1.0;
  // Silverman's rule of thumb, the same bandwidth the TypeScript picks.
  const double h = 1.06 * sd * std::pow(static_cast<double>(std::max<size_t>(1, data.size())), -0.2);

  out.xs.resize(points);
  out.ys.resize(points);
  const double norm = 1.0 / (static_cast<double>(data.size()) * h * std::sqrt(2.0 * 3.14159265358979323846));
  const double span = points > 1 ? static_cast<double>(points - 1) : 1.0;
  for (size_t p = 0; p < points; ++p) {
    const double x = lo + (hi - lo) * static_cast<double>(p) / span;
    double sum = 0.0;
    for (const double v : data) {
      const double u = (x - v) / h;
      sum += std::exp(-0.5 * u * u);
    }
    out.xs[p] = x;
    out.ys[p] = data.empty() ? 0.0 : sum * norm;
  }
  return out;
}

}  // namespace photon::stats
