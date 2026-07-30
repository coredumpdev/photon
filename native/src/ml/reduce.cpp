#include "ml/reduce.hpp"

#include <algorithm>
#include <cmath>

namespace photon::ml {

namespace {

/// L2-normalise in place; returns the norm it had. A zero vector is left alone.
double normalize(std::vector<double>& vec, size_t d) {
  double s = 0.0;
  for (size_t j = 0; j < d; ++j) s += vec[j] * vec[j];
  const double norm = std::sqrt(s);
  if (norm > 0.0) {
    for (size_t j = 0; j < d; ++j) vec[j] /= norm;
  }
  return norm;
}

}  // namespace

std::vector<double> standardize(const double* data, size_t n, size_t d) {
  std::vector<double> out(n * d, 0.0);
  if (!data) return out;
  for (size_t j = 0; j < d; ++j) {
    double mean = 0.0;
    for (size_t i = 0; i < n; ++i) mean += data[i * d + j];
    mean /= static_cast<double>(std::max<size_t>(1, n));
    double var_sum = 0.0;
    for (size_t i = 0; i < n; ++i) {
      const double dv = data[i * d + j] - mean;
      var_sum += dv * dv;
    }
    double sd = std::sqrt(var_sum / static_cast<double>(std::max<size_t>(1, n - 1)));
    if (sd == 0.0) sd = 1.0;
    for (size_t i = 0; i < n; ++i) out[i * d + j] = (data[i * d + j] - mean) / sd;
  }
  return out;
}

PcaResult pca(const double* data, size_t n, size_t d, size_t k) {
  PcaResult out;
  if (!data || d == 0) return out;
  k = std::max<size_t>(1, std::min(k, d));
  out.n = n;
  out.d = d;
  out.k = k;

  out.mean.assign(d, 0.0);
  for (size_t i = 0; i < n; ++i) {
    for (size_t j = 0; j < d; ++j) out.mean[j] += data[i * d + j];
  }
  const double dn = static_cast<double>(std::max<size_t>(1, n));
  for (size_t j = 0; j < d; ++j) out.mean[j] /= dn;

  // Centred copy, then covariance = Xc' * Xc / (n - 1), symmetric d*d.
  std::vector<double> centered(n * d, 0.0);
  for (size_t i = 0; i < n; ++i) {
    for (size_t j = 0; j < d; ++j) centered[i * d + j] = data[i * d + j] - out.mean[j];
  }
  std::vector<double> cov(d * d, 0.0);
  const double denom = static_cast<double>(std::max<size_t>(1, n - 1));
  for (size_t i = 0; i < n; ++i) {
    const size_t row = i * d;
    for (size_t a = 0; a < d; ++a) {
      const double xa = centered[row + a];
      if (xa == 0.0) continue;
      for (size_t b = a; b < d; ++b) cov[a * d + b] += xa * centered[row + b];
    }
  }
  double total_var = 0.0;
  for (size_t a = 0; a < d; ++a) {
    for (size_t b = a; b < d; ++b) {
      const double v = cov[a * d + b] / denom;
      cov[a * d + b] = v;
      cov[b * d + a] = v;
    }
    total_var += cov[a * d + a];
  }

  out.components.assign(k * d, 0.0);
  out.explained.assign(k, 0.0);
  std::vector<double> v(d, 0.0);
  std::vector<double> w(d, 0.0);
  for (size_t c = 0; c < k; ++c) {
    // A deterministic seed that is non-degenerate and roughly orthogonal across
    // components — the reason two runs give the same embedding.
    for (size_t j = 0; j < d; ++j) {
      v[j] = std::sin(1.0 + static_cast<double>(j) * static_cast<double>(c + 1)) + 0.5;
    }
    normalize(v, d);
    double eig = 0.0;
    for (int iter = 0; iter < 256; ++iter) {
      for (size_t a = 0; a < d; ++a) {
        double s = 0.0;
        const size_t ra = a * d;
        for (size_t b = 0; b < d; ++b) s += cov[ra + b] * v[b];
        w[a] = s;
      }
      const double norm = normalize(w, d);
      double dot = 0.0;
      for (size_t a = 0; a < d; ++a) dot += w[a] * v[a];
      v = w;
      eig = norm;
      if (std::abs(std::abs(dot) - 1.0) < 1e-9) break;
    }
    for (size_t j = 0; j < d; ++j) out.components[c * d + j] = v[j];
    out.explained[c] = total_var > 0.0 ? eig / total_var : 0.0;
    // Deflate, so the next pass finds the next component rather than this one.
    for (size_t a = 0; a < d; ++a) {
      const double va = eig * v[a];
      for (size_t b = 0; b < d; ++b) cov[a * d + b] -= va * v[b];
    }
  }

  out.scores.assign(n * k, 0.0);
  for (size_t i = 0; i < n; ++i) {
    const size_t row = i * d;
    for (size_t c = 0; c < k; ++c) {
      double s = 0.0;
      const size_t cr = c * d;
      for (size_t j = 0; j < d; ++j) s += centered[row + j] * out.components[cr + j];
      out.scores[i * k + c] = s;
    }
  }
  return out;
}

}  // namespace photon::ml
