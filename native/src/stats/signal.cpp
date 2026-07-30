#include "stats/signal.hpp"

#include <algorithm>
#include <cmath>

#include "stats/stats.hpp"

namespace photon::stats {

namespace {
constexpr double kPi = 3.14159265358979323846;
}  // namespace

std::vector<double> window_function(Window name, size_t n) {
  std::vector<double> w(n, 0.0);
  if (n == 0) return w;
  if (n == 1) {
    w[0] = 1.0;
    return w;
  }
  const double d = static_cast<double>(n - 1);
  for (size_t i = 0; i < n; ++i) {
    const double t = 2.0 * kPi * static_cast<double>(i) / d;
    switch (name) {
      case Window::Rectangular:
        w[i] = 1.0;
        break;
      case Window::Hamming:
        w[i] = 0.54 - 0.46 * std::cos(t);
        break;
      case Window::Blackman:
        w[i] = 0.42 - 0.5 * std::cos(t) + 0.08 * std::cos(2.0 * t);
        break;
      case Window::Bartlett:
        w[i] = 1.0 - std::abs((static_cast<double>(i) - d / 2.0) / (d / 2.0));
        break;
      case Window::Hann:
      default:
        w[i] = 0.5 - 0.5 * std::cos(t);
        break;
    }
  }
  return w;
}

Psd welch(const double* signal, size_t count, int segment, double overlap, Window window,
          double sample_rate) {
  Psd out;
  if (!signal) count = 0;
  const size_t requested = segment > 0 ? static_cast<size_t>(segment) : 256;
  // The radix-2 FFT needs a power-of-two frame.
  size_t size = 1;
  while (size * 2 <= std::min(requested, count)) size *= 2;
  const size_t bins = size >> 1;
  if (bins < 1) return out;

  const double frac = std::min(0.95, std::max(0.0, overlap));
  const size_t step =
      std::max<size_t>(1, static_cast<size_t>(std::lround(static_cast<double>(size) * (1.0 - frac))));
  const std::vector<double> win = window_function(window, size);
  // Normalisation, so the estimate is a density independent of window shape.
  double win_power = 0.0;
  for (size_t i = 0; i < size; ++i) win_power += win[i] * win[i];
  const double norm = 1.0 / (sample_rate * win_power);

  out.power.assign(bins, 0.0);
  std::vector<double> re(size);
  std::vector<double> im(size);
  size_t segments = 0;
  for (size_t start = 0; start + size <= count; start += step) {
    for (size_t i = 0; i < size; ++i) {
      re[i] = signal[start + i] * win[i];
      im[i] = 0.0;
    }
    fft(re.data(), im.data(), size);
    for (size_t b = 0; b < bins; ++b) {
      // Every bin but DC doubles, to fold the negative frequencies in.
      const double scale = b == 0 ? 1.0 : 2.0;
      out.power[b] += (re[b] * re[b] + im[b] * im[b]) * norm * scale;
    }
    ++segments;
  }
  if (segments > 1) {
    for (size_t b = 0; b < bins; ++b) out.power[b] /= static_cast<double>(segments);
  }

  out.frequencies.resize(bins);
  for (size_t b = 0; b < bins; ++b) {
    out.frequencies[b] = static_cast<double>(b) * sample_rate / static_cast<double>(size);
  }
  return out;
}

std::vector<double> savitzky_golay(const double* values, size_t count, int window, int order) {
  std::vector<double> out(count, 0.0);
  if (!values || count == 0) return out;
  int m = std::max(3, window);
  if (m % 2 == 0) m += 1;
  const size_t width = static_cast<size_t>(m);
  const size_t half = (width - 1) / 2;
  const size_t size = static_cast<size_t>(std::max(0, std::min(order, m - 1))) + 1;
  if (count < width) {
    for (size_t i = 0; i < count; ++i) out[i] = values[i];
    return out;
  }

  // Normal equations for the polynomial fit at the window centre (t = 0). Only
  // the centre coefficient is needed, so the answer is one row of the inverse,
  // which is why the augmented column is e0 rather than a full identity.
  std::vector<double> aug(size * (size + 1), 0.0);
  std::vector<double> powers(size);
  for (int t = -static_cast<int>(half); t <= static_cast<int>(half); ++t) {
    powers[0] = 1.0;
    for (size_t p = 1; p < size; ++p) powers[p] = powers[p - 1] * static_cast<double>(t);
    for (size_t r = 0; r < size; ++r) {
      for (size_t c = 0; c < size; ++c) aug[r * (size + 1) + c] += powers[r] * powers[c];
    }
  }
  aug[0 * (size + 1) + size] = 1.0;

  for (size_t c = 0; c < size; ++c) {
    size_t pivot = c;
    for (size_t r = c + 1; r < size; ++r) {
      if (std::abs(aug[r * (size + 1) + c]) > std::abs(aug[pivot * (size + 1) + c])) pivot = r;
    }
    if (std::abs(aug[pivot * (size + 1) + c]) < 1e-12) continue;
    if (pivot != c) {
      for (size_t k = 0; k <= size; ++k) {
        std::swap(aug[c * (size + 1) + k], aug[pivot * (size + 1) + k]);
      }
    }
    const double p = aug[c * (size + 1) + c];
    for (size_t k = c; k <= size; ++k) aug[c * (size + 1) + k] /= p;
    for (size_t r = 0; r < size; ++r) {
      if (r == c) continue;
      const double f = aug[r * (size + 1) + c];
      if (f == 0.0) continue;
      for (size_t k = c; k <= size; ++k) {
        aug[r * (size + 1) + k] -= f * aug[c * (size + 1) + k];
      }
    }
  }

  std::vector<double> weights(width, 0.0);
  {
    size_t i = 0;
    for (int t = -static_cast<int>(half); t <= static_cast<int>(half); ++t, ++i) {
      double w = 0.0;
      double tp = 1.0;
      for (size_t p = 0; p < size; ++p) {
        w += aug[p * (size + 1) + size] * tp;
        tp *= static_cast<double>(t);
      }
      weights[i] = w;
    }
  }

  for (size_t i = 0; i < count; ++i) {
    double acc = 0.0;
    for (size_t k = 0; k < width; ++k) {
      const ptrdiff_t raw = static_cast<ptrdiff_t>(i + k) - static_cast<ptrdiff_t>(half);
      const size_t idx = static_cast<size_t>(
          std::min<ptrdiff_t>(static_cast<ptrdiff_t>(count) - 1, std::max<ptrdiff_t>(0, raw)));
      acc += weights[k] * values[idx];
    }
    out[i] = acc;
  }
  return out;
}

Correlation cross_correlate(const double* a, const double* b, size_t count, int max_lag,
                            bool normalize) {
  Correlation out;
  if (!a || !b || count == 0) return out;
  const int limit = static_cast<int>(count) - 1;
  const int lag = std::max(0, std::min(max_lag < 0 ? limit : max_lag, limit));

  double mean_a = 0.0;
  double mean_b = 0.0;
  for (size_t i = 0; i < count; ++i) {
    mean_a += a[i];
    mean_b += b[i];
  }
  mean_a /= static_cast<double>(count);
  mean_b /= static_cast<double>(count);

  double var_a = 0.0;
  double var_b = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double da = a[i] - mean_a;
    const double db = b[i] - mean_b;
    var_a += da * da;
    var_b += db * db;
  }
  double denom = 1.0;
  if (normalize) {
    denom = std::sqrt(var_a * var_b);
    if (denom == 0.0) denom = 1.0;
  }

  const size_t n = static_cast<size_t>(2 * lag + 1);
  out.lags.resize(n);
  out.values.resize(n);
  size_t j = 0;
  for (int k = -lag; k <= lag; ++k, ++j) {
    double acc = 0.0;
    for (size_t i = 0; i < count; ++i) {
      const ptrdiff_t bi = static_cast<ptrdiff_t>(i) + k;
      if (bi < 0 || bi >= static_cast<ptrdiff_t>(count)) continue;
      acc += (a[i] - mean_a) * (b[static_cast<size_t>(bi)] - mean_b);
    }
    out.lags[j] = k;
    out.values[j] = acc / denom;
  }
  return out;
}

}  // namespace photon::stats
