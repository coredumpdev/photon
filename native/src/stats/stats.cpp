#include "stats/stats.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

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

namespace {

/// The data's own extent, or a fallback half-unit either side when there is
/// none — which is what the TypeScript's `(lo || 0) - 0.5` does, including its
/// treatment of an empty input as a range around zero.
void measure(const double* values, size_t count, double& lo, double& hi) {
  lo = std::numeric_limits<double>::infinity();
  hi = -lo;
  for (size_t i = 0; i < count; ++i) {
    if (values[i] < lo) lo = values[i];
    if (values[i] > hi) hi = values[i];
  }
  if (!std::isfinite(lo) || !std::isfinite(hi) || lo == hi) {
    const double a = std::isfinite(lo) ? lo : 0.0;
    const double b = std::isfinite(hi) ? hi : 0.0;
    lo = a - 0.5;
    hi = b + 0.5;
  }
}

/// Fill a histogram's counts and centres once the edges are decided.
void bin_into(Histogram& out, const double* values, size_t count) {
  const size_t bins = out.edges.size() - 1;
  out.counts.assign(bins, 0.0);
  const double lo = out.edges.front();
  const double hi = out.edges.back();
  out.bin_width = (hi - lo) / static_cast<double>(bins);
  for (size_t i = 0; i < count; ++i) {
    const double v = values[i];
    if (!(v >= lo) || v > hi) continue;  // NaN fails the first test, as it should
    size_t b = static_cast<size_t>((v - lo) / out.bin_width);
    if (b >= bins) b = bins - 1;  // the right edge belongs to the last bin
    out.counts[b] += 1.0;
  }
  out.centers.resize(bins);
  for (size_t i = 0; i < bins; ++i) out.centers[i] = (out.edges[i] + out.edges[i + 1]) / 2.0;
}

}  // namespace

Histogram histogram(const double* values, size_t count, int bins, double lo, double hi) {
  Histogram out;
  if (!values) count = 0;
  if (lo == hi) {
    measure(values, count, lo, hi);
  } else if (lo > hi) {
    std::swap(lo, hi);
  }
  size_t n_bins;
  if (bins > 0) {
    n_bins = static_cast<size_t>(bins);
  } else {
    // Sturges' rule, the default the TypeScript applies when `bins` is omitted.
    const double k = std::ceil(std::log2(static_cast<double>(std::max<size_t>(1, count))) + 1.0);
    n_bins = static_cast<size_t>(std::max(1.0, k));
  }
  out.edges.resize(n_bins + 1);
  for (size_t i = 0; i <= n_bins; ++i) {
    out.edges[i] = lo + (hi - lo) * static_cast<double>(i) / static_cast<double>(n_bins);
  }
  bin_into(out, values, count);
  return out;
}

Histogram histogram_edges(const double* values, size_t count, const double* edges,
                          size_t edge_count) {
  Histogram out;
  if (!edges || edge_count < 2) return out;
  out.edges.assign(edges, edges + edge_count);
  bin_into(out, values ? values : nullptr, values ? count : 0);
  return out;
}

Histogram2D hist2d(const double* x, const double* y, size_t count, int cols, int rows, double x0,
                   double x1, double y0, double y1) {
  Histogram2D out;
  if (!x || !y) count = 0;
  // The TypeScript's default is sqrt(n) bins on each axis.
  const double root = std::ceil(std::sqrt(static_cast<double>(std::max<size_t>(1, count))));
  out.cols = cols > 0 ? static_cast<size_t>(cols) : static_cast<size_t>(std::max(1.0, root));
  out.rows = rows > 0 ? static_cast<size_t>(rows) : static_cast<size_t>(std::max(1.0, root));
  if (x0 == x1) measure(x, count, x0, x1);
  if (y0 == y1) measure(y, count, y0, y1);
  out.x0 = x0;
  out.x1 = x1;
  out.y0 = y0;
  out.y1 = y1;

  out.values.assign(out.cols * out.rows, 0.0);
  const double dx = (x1 - x0) / static_cast<double>(out.cols);
  const double dy = (y1 - y0) / static_cast<double>(out.rows);
  for (size_t i = 0; i < count; ++i) {
    const double xv = x[i];
    const double yv = y[i];
    if (!(xv >= x0) || xv > x1 || !(yv >= y0) || yv > y1) continue;
    size_t c = static_cast<size_t>((xv - x0) / dx);
    if (c >= out.cols) c = out.cols - 1;
    size_t r = static_cast<size_t>((yv - y0) / dy);
    if (r >= out.rows) r = out.rows - 1;
    out.values[r * out.cols + c] += 1.0;
  }
  return out;
}

void fft(double* re, double* im, size_t n) {
  if (!re || !im || n < 2) return;
  // Bit-reversal permutation.
  for (size_t i = 1, j = 0; i < n; ++i) {
    size_t bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      std::swap(re[i], re[j]);
      std::swap(im[i], im[j]);
    }
  }
  for (size_t len = 2; len <= n; len <<= 1) {
    const double ang = -2.0 * 3.14159265358979323846 / static_cast<double>(len);
    const double w_re = std::cos(ang);
    const double w_im = std::sin(ang);
    for (size_t i = 0; i < n; i += len) {
      double cur_re = 1.0;
      double cur_im = 0.0;
      for (size_t k = 0; k < len / 2; ++k) {
        const size_t a = i + k;
        const size_t b = a + len / 2;
        const double t_re = re[b] * cur_re - im[b] * cur_im;
        const double t_im = re[b] * cur_im + im[b] * cur_re;
        re[b] = re[a] - t_re;
        im[b] = im[a] - t_im;
        re[a] = re[a] + t_re;
        im[a] = im[a] + t_im;
        const double next_re = cur_re * w_re - cur_im * w_im;
        cur_im = cur_re * w_im + cur_im * w_re;
        cur_re = next_re;
      }
    }
  }
}

Spectrogram spectrogram(const double* signal, size_t count, int fft_size, int hop,
                        double sample_rate) {
  Spectrogram out;
  if (fft_size < 2) return out;
  const size_t size = static_cast<size_t>(fft_size);
  const size_t step = hop > 0 ? static_cast<size_t>(hop) : size >> 1;
  const size_t bins = size >> 1;
  if (bins == 0) return out;
  const size_t frames =
      count >= size ? (count - size) / step + 1 : 1;  // at least one frame, zero-padded

  out.values.assign(bins * frames, 0.0);
  out.cols = frames;
  out.rows = bins;
  out.x0 = 0.0;
  out.x1 = static_cast<double>(count) / sample_rate;
  out.y0 = 0.0;
  out.y1 = sample_rate / 2.0;

  std::vector<double> re(size);
  std::vector<double> im(size);
  for (size_t f = 0; f < frames; ++f) {
    const size_t start = f * step;
    for (size_t i = 0; i < size; ++i) {
      const double w = 0.5 - 0.5 * std::cos(2.0 * 3.14159265358979323846 *
                                            static_cast<double>(i) / static_cast<double>(size - 1));
      const size_t at = start + i;
      re[i] = (signal && at < count ? signal[at] : 0.0) * w;
      im[i] = 0.0;
    }
    fft(re.data(), im.data(), size);
    for (size_t b = 0; b < bins; ++b) {
      const double mag = std::hypot(re[b], im[b]) / static_cast<double>(size);
      out.values[b * frames + f] = 20.0 * std::log10(mag + 1e-9);
    }
  }
  return out;
}

}  // namespace photon::stats
