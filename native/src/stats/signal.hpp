// Signal processing — port of core/src/stats/signal.ts.
//
// Windows, an averaged PSD, a smoother that preserves peaks, and correlation by
// lag. The FFT itself lives in stats.hpp beside the spectrogram that uses it.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace photon::stats {

/// The taper applied to a frame before an FFT, to suppress spectral leakage.
enum class Window {
  Rectangular,
  Hann,
  Hamming,
  Blackman,
  Bartlett,
};

/// Sample a window function over `n` points.
std::vector<double> window_function(Window name, size_t n);

/// A one-sided power spectral density estimate.
struct Psd {
  /// Hz, or cycles per sample when the sample rate is 1.
  std::vector<double> frequencies;
  /// Power per bin, in units squared per Hz.
  std::vector<double> power;
};

/**
 * Welch's method: average the periodograms of overlapping windowed segments.
 * Trades frequency resolution for far less variance than one FFT of the whole
 * signal, which is what makes a noisy spectrum readable.
 *
 * `segment` is rounded down to a power of two; `overlap` is a fraction.
 */
Psd welch(const double* signal, size_t count, int segment = 256, double overlap = 0.5,
          Window window = Window::Hann, double sample_rate = 1.0);

/**
 * Savitzky-Golay smoothing: a least-squares polynomial over a sliding window.
 * Unlike a moving average it preserves peak height and width, which is why
 * spectroscopy and sensor pipelines reach for it. `window` is rounded up to an
 * odd number; edges clamp to the nearest sample.
 */
std::vector<double> savitzky_golay(const double* values, size_t count, int window = 9,
                                   int order = 2);

/// A correlation sequence indexed by lag.
struct Correlation {
  std::vector<int32_t> lags;
  std::vector<double> values;
};

/**
 * Cross-correlation over +/- `max_lag`. Normalised, the result is a coefficient
 * in -1..1 and the peak lag reads directly as "b lags a by k". Pass the same
 * array twice for an autocorrelation. A negative `max_lag` means "as far as the
 * data allows", matching the TypeScript's default argument.
 */
Correlation cross_correlate(const double* a, const double* b, size_t count, int max_lag = -1,
                            bool normalize = true);

}  // namespace photon::stats
