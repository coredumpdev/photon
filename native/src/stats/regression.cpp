#include "stats/regression.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace photon::stats {

LinearFit linear_regression(const double* x, const double* y, size_t count) {
  LinearFit fit;
  if (!x || !y) return fit;
  double sx = 0.0;
  double sy = 0.0;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(x[i]) || !std::isfinite(y[i])) continue;
    sx += x[i];
    sy += y[i];
    ++fit.n;
  }
  if (fit.n < 2) {
    // One point is a horizontal line through it; none is a line through zero.
    fit.intercept = fit.n == 1 ? sy : 0.0;
    return fit;
  }
  const double dn = static_cast<double>(fit.n);
  const double mx = sx / dn;
  const double my = sy / dn;
  double sxx = 0.0;
  double sxy = 0.0;
  double syy = 0.0;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(x[i]) || !std::isfinite(y[i])) continue;
    const double dx = x[i] - mx;
    const double dy = y[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  fit.slope = sxx == 0.0 ? 0.0 : sxy / sxx;
  fit.intercept = my - fit.slope * mx;
  const double ss_res = std::max(0.0, syy - fit.slope * sxy);
  fit.r2 = syy == 0.0 ? 1.0 : 1.0 - ss_res / syy;
  fit.stderror = fit.n > 2 ? std::sqrt(ss_res / (dn - 2.0)) : 0.0;
  return fit;
}

Trend linear_trend(const double* x, const double* y, size_t count, int points, double band) {
  const LinearFit fit = linear_regression(x, y, count);
  const size_t n = static_cast<size_t>(std::max(2, points));
  double lo = std::numeric_limits<double>::infinity();
  double hi = -lo;
  for (size_t i = 0; x && i < count; ++i) {
    if (!std::isfinite(x[i])) continue;
    lo = std::min(lo, x[i]);
    hi = std::max(hi, x[i]);
  }
  if (!std::isfinite(lo)) {
    lo = 0.0;
    hi = 1.0;
  }
  Trend out;
  out.x.resize(n);
  out.y.resize(n);
  for (size_t i = 0; i < n; ++i) {
    out.x[i] = lo + (hi - lo) * static_cast<double>(i) / static_cast<double>(n - 1);
    out.y[i] = fit.predict(out.x[i]);
  }
  if (band == 0.0) return out;
  out.lower.resize(n);
  out.upper.resize(n);
  for (size_t i = 0; i < n; ++i) {
    out.lower[i] = out.y[i] - band * fit.stderror;
    out.upper[i] = out.y[i] + band * fit.stderror;
  }
  return out;
}

Trend loess(const double* x, const double* y, size_t count, double bandwidth, int points) {
  std::vector<std::pair<double, double>> pairs;
  if (x && y) {
    pairs.reserve(count);
    for (size_t i = 0; i < count; ++i) {
      if (std::isfinite(x[i]) && std::isfinite(y[i])) pairs.emplace_back(x[i], y[i]);
    }
  }
  std::sort(pairs.begin(), pairs.end(),
            [](const auto& a, const auto& b) { return a.first < b.first; });
  const size_t n = pairs.size();
  const size_t grid = static_cast<size_t>(
      std::max(2, std::min(points > 0 ? points : 100, std::max(2, static_cast<int>(n)))));
  Trend out;
  out.x.assign(grid, 0.0);
  out.y.assign(grid, 0.0);
  if (n == 0) return out;

  const double dn = static_cast<double>(n);
  const double frac =
      std::min(1.0, std::max(2.0 / dn, bandwidth > 0.0 ? bandwidth : 0.3));
  const size_t span = std::max<size_t>(2, static_cast<size_t>(std::lround(frac * dn)));
  const size_t take = std::min(span, n);
  const double lo = pairs.front().first;
  const double hi = pairs.back().first;

  // Reused across grid points so the loop allocates nothing.
  std::vector<std::pair<double, size_t>> dists(n);
  for (size_t g = 0; g < grid; ++g) {
    const double x0 = lo + (hi - lo) * static_cast<double>(g) / static_cast<double>(grid - 1);
    out.x[g] = x0;
    for (size_t i = 0; i < n; ++i) dists[i] = {std::abs(pairs[i].first - x0), i};
    // Only the nearest `take` matter, and their order among themselves does
    // not — but the TypeScript sorts the whole array, and the k-th distance it
    // picks has to be the same one, so a partial sort by the same comparator is.
    std::partial_sort(dists.begin(), dists.begin() + static_cast<ptrdiff_t>(take), dists.end(),
                      [](const auto& a, const auto& b) { return a.first < b.first; });
    double max_dist = dists[take - 1].first;
    if (max_dist == 0.0) max_dist = 1e-12;

    double sw = 0.0, swx = 0.0, swy = 0.0, swxx = 0.0, swxy = 0.0;
    for (size_t k = 0; k < take; ++k) {
      const double u = dists[k].first / max_dist;
      if (u >= 1.0) continue;
      const double t = 1.0 - u * u * u;
      const double w = t * t * t;  // tricube
      if (w == 0.0) continue;
      const auto& p = pairs[dists[k].second];
      sw += w;
      swx += w * p.first;
      swy += w * p.second;
      swxx += w * p.first * p.first;
      swxy += w * p.first * p.second;
    }
    if (sw == 0.0) {
      out.y[g] = pairs[std::min(n - 1, g)].second;
      continue;
    }
    const double denom = sw * swxx - swx * swx;
    if (std::abs(denom) < 1e-12) {
      out.y[g] = swy / sw;
      continue;
    }
    const double slope = (sw * swxy - swx * swy) / denom;
    const double intercept = (swy - slope * swx) / sw;
    out.y[g] = slope * x0 + intercept;
  }
  return out;
}

Trend ecdf(const double* values, size_t count) {
  Trend out;
  if (!values) return out;
  std::vector<double> xs;
  xs.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    if (std::isfinite(values[i])) xs.push_back(values[i]);
  }
  std::sort(xs.begin(), xs.end());
  const size_t n = xs.size();
  out.x.resize(n);
  out.y.resize(n);
  for (size_t i = 0; i < n; ++i) {
    out.x[i] = xs[i];
    out.y[i] = static_cast<double>(i + 1) / static_cast<double>(n);
  }
  return out;
}

std::vector<double> zscore(const double* values, size_t count) {
  std::vector<double> out(count, 0.0);
  if (!values) return out;
  size_t used = 0;
  double mean = 0.0;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(values[i])) continue;
    mean += values[i];
    ++used;
  }
  if (used == 0) return out;
  mean /= static_cast<double>(used);
  double var_sum = 0.0;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(values[i])) continue;
    const double d = values[i] - mean;
    var_sum += d * d;
  }
  double sd = std::sqrt(var_sum / static_cast<double>(used));
  if (sd == 0.0) sd = 1.0;
  for (size_t i = 0; i < count; ++i) {
    out[i] = std::isfinite(values[i]) ? (values[i] - mean) / sd : values[i];
  }
  return out;
}

double correlation(const double* a, const double* b, size_t count) {
  if (!a || !b) return 0.0;
  double ma = 0.0;
  double mb = 0.0;
  size_t used = 0;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(a[i]) || !std::isfinite(b[i])) continue;
    ma += a[i];
    mb += b[i];
    ++used;
  }
  if (used < 2) return 0.0;
  ma /= static_cast<double>(used);
  mb /= static_cast<double>(used);
  double saa = 0.0, sbb = 0.0, sab = 0.0;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(a[i]) || !std::isfinite(b[i])) continue;
    const double da = a[i] - ma;
    const double db = b[i] - mb;
    saa += da * da;
    sbb += db * db;
    sab += da * db;
  }
  const double denom = std::sqrt(saa * sbb);
  return denom == 0.0 ? 0.0 : sab / denom;
}

std::vector<double> corr_matrix(const double* const* columns, size_t k, size_t count) {
  std::vector<double> out(k * k, 0.0);
  if (!columns) return out;
  for (size_t i = 0; i < k; ++i) {
    out[i * k + i] = 1.0;
    for (size_t j = i + 1; j < k; ++j) {
      const double r = correlation(columns[i], columns[j], count);
      out[i * k + j] = r;
      out[j * k + i] = r;
    }
  }
  return out;
}

}  // namespace photon::stats
