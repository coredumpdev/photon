/*
 * Regressions, filters and spectra.
 *
 * A transcription of packages/core/test/signal.test.ts, plus the histogram and
 * FFT cases from stats.test.ts that the native stats_test.cpp did not cover
 * because the layers did not need them until now.
 *
 * The Savitzky-Golay case is the one worth reading twice: a quadratic filter
 * must leave a quadratic *exactly* alone. That is a property no amount of
 * eyeballing a smoothed curve would tell you about, and it fails loudly if the
 * normal equations are solved even slightly wrong.
 */

#include <cmath>
#include <cstddef>
#include <vector>

#include "check.h"
#include "stats/regression.hpp"
#include "stats/signal.hpp"
#include "stats/stats.hpp"

namespace st = photon::stats;

namespace {

constexpr double kPi = 3.14159265358979323846;

std::vector<double> ramp(size_t n, double scale = 1.0) {
  std::vector<double> v(n);
  for (size_t i = 0; i < n; ++i) v[i] = static_cast<double>(i) * scale;
  return v;
}

size_t argmax(const std::vector<double>& v) {
  size_t best = 0;
  for (size_t i = 1; i < v.size(); ++i) {
    if (v[i] > v[best]) best = i;
  }
  return best;
}

// ---- windows --------------------------------------------------------------

void test_windows_taper_to_zero_at_the_edges() {
  for (const st::Window w : {st::Window::Hann, st::Window::Blackman, st::Window::Bartlett}) {
    const std::vector<double> t = st::window_function(w, 32);
    CHECK_NEAR(t[0], 0.0, 1e-6);
    CHECK_NEAR(t[31], 0.0, 1e-6);
    CHECK(t[16] > 0.9);
  }
  const std::vector<double> rect = st::window_function(st::Window::Rectangular, 4);
  for (size_t i = 0; i < 4; ++i) CHECK_NEAR(rect[i], 1.0, 1e-12);
  // Hamming is the exception — it stops short of zero.
  CHECK_NEAR(st::window_function(st::Window::Hamming, 32)[0], 0.08, 1e-6);
}

void test_windows_handle_degenerate_lengths() {
  CHECK(st::window_function(st::Window::Hann, 0).empty());
  const std::vector<double> one = st::window_function(st::Window::Hann, 1);
  CHECK_EQ(one.size(), 1);
  CHECK_NEAR(one[0], 1.0, 1e-12);
}

// ---- welch ----------------------------------------------------------------

void test_welch_puts_the_peak_at_the_tone() {
  const double sr = 256.0;
  const size_t n = 2048;
  const double freq = 32.0;
  std::vector<double> signal(n);
  for (size_t i = 0; i < n; ++i) {
    signal[i] = std::sin(2.0 * kPi * freq * static_cast<double>(i) / sr);
  }
  const st::Psd psd = st::welch(signal.data(), n, 256, 0.5, st::Window::Hann, sr);
  CHECK(!psd.power.empty());
  const size_t peak = argmax(psd.power);
  CHECK_NEAR(psd.frequencies[peak], freq, 1.0);
  CHECK_NEAR(psd.frequencies[0], 0.0, 1e-12);
  // One-sided: the bins span DC up to, but not including, Nyquist.
  CHECK(psd.frequencies.back() < sr / 2.0);
}

void test_welch_returns_nothing_for_a_signal_shorter_than_a_segment() {
  const double one = 0.0;
  CHECK(st::welch(&one, 1, 256).power.empty());
}

// ---- Savitzky-Golay -------------------------------------------------------

void test_savitzky_golay_reproduces_a_polynomial_of_its_own_order() {
  std::vector<double> x(40);
  for (size_t i = 0; i < x.size(); ++i) {
    const double t = static_cast<double>(i);
    x[i] = t * t * 0.5 - 3.0 * t + 7.0;
  }
  const std::vector<double> out = st::savitzky_golay(x.data(), x.size(), 9, 2);
  for (size_t i = 4; i < 36; ++i) CHECK_NEAR(out[i], x[i], 1e-6);
}

void test_savitzky_golay_keeps_a_peak_a_moving_average_would_flatten() {
  const size_t n = 61;
  std::vector<double> clean(n);
  for (size_t i = 0; i < n; ++i) {
    const double d = static_cast<double>(i) - 30.0;
    clean[i] = std::exp(-(d * d) / 20.0);
  }
  const std::vector<double> sg = st::savitzky_golay(clean.data(), n, 11, 2);
  double moving = 0.0;
  for (size_t k = 25; k <= 35; ++k) moving += clean[k];
  moving /= 11.0;
  // A quadratic fit still clips the very tip a little, but far less than a
  // boxcar of the same width does — which is the whole reason to use one.
  CHECK(sg[30] > moving);
  CHECK(sg[30] > 0.93 * clean[30]);
  CHECK(moving < 0.85 * clean[30]);
}

void test_savitzky_golay_passes_short_inputs_through() {
  const std::vector<double> two{1.0, 2.0};
  const std::vector<double> out = st::savitzky_golay(two.data(), 2, 9, 2);
  CHECK_NEAR(out[0], 1.0, 1e-12);
  CHECK_NEAR(out[1], 2.0, 1e-12);
  CHECK(st::savitzky_golay(nullptr, 0, 9, 2).empty());
}

// ---- cross-correlation ----------------------------------------------------

void test_cross_correlation_finds_the_lag() {
  const size_t n = 128;
  const int shift = 7;
  std::vector<double> a(n);
  std::vector<double> b(n);
  for (size_t i = 0; i < n; ++i) {
    a[i] = std::sin(static_cast<double>(i) / 5.0);
    b[i] = std::sin((static_cast<double>(i) - shift) / 5.0);
  }
  const st::Correlation c = st::cross_correlate(a.data(), b.data(), n, 20);
  const size_t best = argmax(c.values);
  // b is a delayed by `shift`, and the peak lag reads as "b lags a by k".
  CHECK_EQ(c.lags[best], shift);
  CHECK(c.values[best] > 0.9);
}

void test_autocorrelation_peaks_at_zero_lag() {
  const size_t n = 64;
  std::vector<double> a(n);
  for (size_t i = 0; i < n; ++i) {
    a[i] = std::sin(static_cast<double>(i) / 3.0) + static_cast<double>(i) * 0.01;
  }
  const st::Correlation c = st::cross_correlate(a.data(), a.data(), n, 10);
  size_t zero = 0;
  for (size_t i = 0; i < c.lags.size(); ++i) {
    if (c.lags[i] == 0) zero = i;
  }
  CHECK_NEAR(c.values[zero], 1.0, 1e-6);
  for (size_t i = 0; i < c.values.size(); ++i) CHECK(c.values[i] <= c.values[zero] + 1e-9);
}

// ---- regression -----------------------------------------------------------

void test_linear_regression_recovers_a_clean_line() {
  const std::vector<double> x = ramp(20);
  std::vector<double> y(20);
  for (size_t i = 0; i < 20; ++i) y[i] = 3.0 * x[i] - 4.0;
  const st::LinearFit fit = st::linear_regression(x.data(), y.data(), 20);
  CHECK_NEAR(fit.slope, 3.0, 1e-10);
  CHECK_NEAR(fit.intercept, -4.0, 1e-10);
  CHECK_NEAR(fit.r2, 1.0, 1e-10);
  CHECK_NEAR(fit.stderror, 0.0, 1e-10);
  CHECK_NEAR(fit.predict(100.0), 296.0, 1e-8);
}

void test_linear_regression_skips_non_finite_pairs() {
  const std::vector<double> x{0.0, 1.0, std::nan(""), 2.0};
  const std::vector<double> y{0.0, 2.0, 5.0, 4.0};
  const st::LinearFit fit = st::linear_regression(x.data(), y.data(), 4);
  CHECK_EQ(fit.n, 3);
  CHECK_NEAR(fit.slope, 2.0, 1e-10);
  CHECK_EQ(st::linear_regression(nullptr, nullptr, 0).n, 0);
  // A vertical cloud has no slope to find.
  const std::vector<double> flat{1.0, 1.0, 1.0};
  const std::vector<double> rise{0.0, 5.0, 9.0};
  CHECK_NEAR(st::linear_regression(flat.data(), rise.data(), 3).slope, 0.0, 1e-12);
}

void test_linear_trend_samples_the_fit_and_can_add_a_band() {
  const std::vector<double> x = ramp(30);
  std::vector<double> y(30);
  for (size_t i = 0; i < 30; ++i) y[i] = 2.0 * x[i] + (i % 2 ? 1.0 : -1.0);
  const st::Trend trend = st::linear_trend(x.data(), y.data(), 30, 2, 2.0);
  CHECK_NEAR(trend.x.front(), 0.0, 1e-12);
  CHECK_NEAR(trend.x.back(), 29.0, 1e-12);
  CHECK(trend.lower[0] < trend.y[0]);
  CHECK(trend.upper[0] > trend.y[0]);
  // Without a band the arrays are empty rather than zero-filled — the native
  // shape of the TypeScript's `undefined`.
  CHECK(st::linear_trend(x.data(), y.data(), 30).lower.empty());
}

void test_loess_tracks_a_curve_a_straight_line_would_miss() {
  const size_t n = 120;
  std::vector<double> x(n);
  std::vector<double> y(n);
  for (size_t i = 0; i < n; ++i) {
    x[i] = (static_cast<double>(i) / static_cast<double>(n - 1)) * 2.0 - 1.0;
    y[i] = x[i] * x[i];
  }
  const st::Trend fitted = st::loess(x.data(), y.data(), n, 0.3, 21);
  for (size_t i = 0; i < fitted.x.size(); ++i) {
    CHECK_NEAR(fitted.y[i], fitted.x[i] * fitted.x[i], 0.05);
  }
  // The OLS line through a symmetric parabola is flat, so it cannot.
  CHECK(std::abs(st::linear_regression(x.data(), y.data(), n).slope) < 1e-9);
}

void test_loess_on_empty_input_is_a_flat_grid() {
  const st::Trend out = st::loess(nullptr, nullptr, 0);
  for (const double v : out.y) CHECK_NEAR(v, 0.0, 1e-12);
}

void test_ecdf_steps_over_the_sorted_values() {
  const std::vector<double> v{3, 1, 2, 1};
  const st::Trend e = st::ecdf(v.data(), v.size());
  CHECK_NEAR(e.x[0], 1.0, 1e-12);
  CHECK_NEAR(e.x[1], 1.0, 1e-12);
  CHECK_NEAR(e.x[2], 2.0, 1e-12);
  CHECK_NEAR(e.x[3], 3.0, 1e-12);
  CHECK_NEAR(e.y[0], 0.25, 1e-12);
  CHECK_NEAR(e.y[3], 1.0, 1e-12);
}

void test_zscore_centres_and_scales_passing_nan_through() {
  const std::vector<double> v{1, 2, 3, 4, 5};
  const std::vector<double> z = st::zscore(v.data(), v.size());
  double mean = 0.0;
  for (const double t : z) mean += t;
  CHECK_NEAR(mean / static_cast<double>(z.size()), 0.0, 1e-10);
  CHECK_NEAR(z[4] - z[0], 2.828427, 1e-5);  // two sqrt(2) sd apart
  const std::vector<double> gap{1.0, std::nan(""), 3.0};
  CHECK(std::isnan(st::zscore(gap.data(), 3)[1]));
}

void test_correlation_is_plus_or_minus_one_for_exact_relationships() {
  const std::vector<double> a{1, 2, 3};
  const std::vector<double> up{2, 4, 6};
  const std::vector<double> down{6, 4, 2};
  const std::vector<double> flat{1, 1, 1};
  CHECK_NEAR(st::correlation(a.data(), up.data(), 3), 1.0, 1e-10);
  CHECK_NEAR(st::correlation(a.data(), down.data(), 3), -1.0, 1e-10);
  CHECK_NEAR(st::correlation(flat.data(), a.data(), 3), 0.0, 1e-12);
}

void test_corr_matrix_is_symmetric_with_a_unit_diagonal() {
  const std::vector<double> a{1, 2, 3, 4};
  const std::vector<double> b{2, 4, 6, 8};
  const std::vector<double> c{4, 3, 2, 1};
  const double* columns[3] = {a.data(), b.data(), c.data()};
  const std::vector<double> m = st::corr_matrix(columns, 3, 4);
  CHECK_EQ(m.size(), 9);
  for (size_t i = 0; i < 3; ++i) CHECK_NEAR(m[i * 3 + i], 1.0, 1e-10);
  for (size_t i = 0; i < 3; ++i) {
    for (size_t j = 0; j < 3; ++j) CHECK_NEAR(m[i * 3 + j], m[j * 3 + i], 1e-12);
  }
  CHECK_NEAR(m[1], 1.0, 1e-10);   // a against b
  CHECK_NEAR(m[2], -1.0, 1e-10);  // a against c
}

// ---- histograms and the FFT ----------------------------------------------

void test_histogram_bins_and_conserves_the_count() {
  const std::vector<double> v{1, 2, 2, 3, 4, 5, 5, 5};
  const st::Histogram h = st::histogram(v.data(), v.size(), 4);
  CHECK_EQ(h.counts.size(), 4);
  CHECK_EQ(h.edges.size(), 5);
  CHECK_NEAR(h.edges.front(), 1.0, 1e-12);
  CHECK_NEAR(h.edges.back(), 5.0, 1e-12);
  CHECK_NEAR(h.bin_width, 1.0, 1e-12);
  double total = 0.0;
  for (const double c : h.counts) total += c;
  CHECK_NEAR(total, 8.0, 1e-12);
  // The right edge belongs to the last bin, so the three 5s land beside the 4.
  CHECK_NEAR(h.counts.back(), 4.0, 1e-12);
  CHECK_NEAR(h.centers[0], 1.5, 1e-12);
}

void test_histogram_defaults_to_sturges_and_survives_a_constant_series() {
  const std::vector<double> v(16, 2.0);
  const st::Histogram h = st::histogram(v.data(), v.size());
  // log2(16) + 1 = 5 bins, over a range widened to +/- half a unit.
  CHECK_EQ(h.counts.size(), 5);
  CHECK_NEAR(h.edges.front(), 1.5, 1e-12);
  CHECK_NEAR(h.edges.back(), 2.5, 1e-12);
  double total = 0.0;
  for (const double c : h.counts) total += c;
  CHECK_NEAR(total, 16.0, 1e-12);
}

void test_histogram_over_explicit_edges() {
  const std::vector<double> v{0.5, 1.5, 2.5, 9.0};
  const std::vector<double> edges{0.0, 1.0, 2.0, 3.0};
  const st::Histogram h = st::histogram_edges(v.data(), v.size(), edges.data(), edges.size());
  CHECK_EQ(h.counts.size(), 3);
  CHECK_NEAR(h.counts[0], 1.0, 1e-12);
  CHECK_NEAR(h.counts[1], 1.0, 1e-12);
  CHECK_NEAR(h.counts[2], 1.0, 1e-12);  // the 9 is outside and simply dropped
}

void test_hist2d_bins_a_cloud_onto_a_grid() {
  const std::vector<double> x{0, 1, 0, 1};
  const std::vector<double> y{0, 0, 1, 1};
  const st::Histogram2D h = st::hist2d(x.data(), y.data(), 4, 2, 2);
  CHECK_EQ(h.cols, 2);
  CHECK_EQ(h.rows, 2);
  double total = 0.0;
  for (const double v : h.values) total += v;
  CHECK_NEAR(total, 4.0, 1e-12);
  // One point per cell, and row 0 is the bottom.
  for (const double v : h.values) CHECK_NEAR(v, 1.0, 1e-12);
  CHECK_NEAR(h.x0, 0.0, 1e-12);
  CHECK_NEAR(h.y1, 1.0, 1e-12);
}

void test_fft_finds_a_pure_tone() {
  const size_t n = 64;
  const size_t k = 5;
  std::vector<double> re(n);
  std::vector<double> im(n, 0.0);
  for (size_t i = 0; i < n; ++i) {
    re[i] = std::cos(2.0 * kPi * static_cast<double>(k * i) / static_cast<double>(n));
  }
  st::fft(re.data(), im.data(), n);
  // A real cosine of k cycles puts half the energy at bin k and half at n-k.
  CHECK_NEAR(std::hypot(re[k], im[k]), static_cast<double>(n) / 2.0, 1e-9);
  CHECK_NEAR(std::hypot(re[n - k], im[n - k]), static_cast<double>(n) / 2.0, 1e-9);
  CHECK_NEAR(std::hypot(re[1], im[1]), 0.0, 1e-9);
}

void test_spectrogram_puts_a_tone_in_the_right_row() {
  const double sr = 256.0;
  const size_t n = 1024;
  const double freq = 32.0;
  std::vector<double> signal(n);
  for (size_t i = 0; i < n; ++i) {
    signal[i] = std::sin(2.0 * kPi * freq * static_cast<double>(i) / sr);
  }
  const st::Spectrogram s = st::spectrogram(signal.data(), n, 256, 128, sr);
  CHECK_EQ(s.rows, 128);
  CHECK(s.cols > 1);
  CHECK_NEAR(s.y1, sr / 2.0, 1e-12);
  CHECK_NEAR(s.x1, static_cast<double>(n) / sr, 1e-12);
  // Bin b covers b * sr / fftSize Hz, so the tone belongs to row 32.
  size_t loudest = 0;
  for (size_t b = 1; b < s.rows; ++b) {
    if (s.values[b * s.cols] > s.values[loudest * s.cols]) loudest = b;
  }
  CHECK_EQ(loudest, 32);
}

}  // namespace

int main() {
  RUN(test_windows_taper_to_zero_at_the_edges);
  RUN(test_windows_handle_degenerate_lengths);
  RUN(test_welch_puts_the_peak_at_the_tone);
  RUN(test_welch_returns_nothing_for_a_signal_shorter_than_a_segment);
  RUN(test_savitzky_golay_reproduces_a_polynomial_of_its_own_order);
  RUN(test_savitzky_golay_keeps_a_peak_a_moving_average_would_flatten);
  RUN(test_savitzky_golay_passes_short_inputs_through);
  RUN(test_cross_correlation_finds_the_lag);
  RUN(test_autocorrelation_peaks_at_zero_lag);
  RUN(test_linear_regression_recovers_a_clean_line);
  RUN(test_linear_regression_skips_non_finite_pairs);
  RUN(test_linear_trend_samples_the_fit_and_can_add_a_band);
  RUN(test_loess_tracks_a_curve_a_straight_line_would_miss);
  RUN(test_loess_on_empty_input_is_a_flat_grid);
  RUN(test_ecdf_steps_over_the_sorted_values);
  RUN(test_zscore_centres_and_scales_passing_nan_through);
  RUN(test_correlation_is_plus_or_minus_one_for_exact_relationships);
  RUN(test_corr_matrix_is_symmetric_with_a_unit_diagonal);
  RUN(test_histogram_bins_and_conserves_the_count);
  RUN(test_histogram_defaults_to_sturges_and_survives_a_constant_series);
  RUN(test_histogram_over_explicit_edges);
  RUN(test_hist2d_bins_a_cloud_onto_a_grid);
  RUN(test_fft_finds_a_pure_tone);
  RUN(test_spectrogram_puts_a_tone_in_the_right_row);
  return TEST_MAIN_RESULT();
}
