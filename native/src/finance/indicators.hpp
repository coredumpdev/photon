// Technical-analysis indicators — port of core/src/finance/indicators.ts.
//
// Pure array→array, with no GL and no plot anywhere near them: an indicator is
// arithmetic over a price series, and the only thing that makes it a chart is
// what the caller does with the result.
//
// Every function returns a vector the same length as its input, with a leading
// run of NaN for the warm-up period. That is the web core's convention and it
// is load-bearing — the line layer skips non-finite points, so a warm-up that
// is NaN simply does not draw, where a warm-up that is 0 draws a cliff.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::finance {

using Series = std::vector<double>;

/// Simple moving average over `period` samples.
Series sma(const double* values, size_t count, int period);

/// Weighted moving average (linear weights 1..period, newest heaviest).
Series wma(const double* values, size_t count, int period);

/// Exponential moving average, alpha = 2/(period+1), seeded with the first SMA.
Series ema(const double* values, size_t count, int period);

/// Rolling population standard deviation over `period` samples.
Series rolling_std(const double* values, size_t count, int period);

/// A middle line with a symmetric band either side of it.
struct Band {
  Series middle;
  Series upper;
  Series lower;
};

/// Bollinger Bands: SMA(period) +/- k * rolling_std(period).
Band bollinger(const double* close, size_t count, int period = 20, double k = 2.0);

/// Wilder's RSI over `period`. 0..100, NaN warm-up.
Series rsi(const double* close, size_t count, int period = 14);

struct Macd {
  Series macd;
  Series signal;
  Series histogram;
};

/// MACD: EMA(fast) - EMA(slow), its EMA(signal), and the difference of the two.
Macd macd(const double* close, size_t count, int fast = 12, int slow = 26, int signal_period = 9);

/// Cumulative volume-weighted average price over typical = (h+l+c)/3.
Series vwap(const double* high, const double* low, const double* close, const double* volume,
            size_t count);

/// True range per bar: max(H-L, |H-prevC|, |L-prevC|). The first bar is H-L.
Series true_range(const double* high, const double* low, const double* close, size_t count);

/// Wilder's Average True Range over `period`.
Series atr(const double* high, const double* low, const double* close, size_t count,
           int period = 14);

/// Index of the first finite value, or -1. Handy for trimming the warm-up.
int first_finite(const double* values, size_t count);

struct Stochastic {
  Series k;
  Series d;
};

/// Stochastic oscillator: %K over `k_period`, %D = SMA(%K, d_period).
Stochastic stochastic(const double* high, const double* low, const double* close, size_t count,
                      int k_period = 14, int d_period = 3);

/// Keltner Channels: EMA(period) +/- mult * ATR(atr_period).
Band keltner(const double* high, const double* low, const double* close, size_t count,
             int period = 20, double mult = 2.0, int atr_period = 10);

/// On-Balance Volume — a running signed volume total, no warm-up.
Series obv(const double* close, const double* volume, size_t count);

struct Ichimoku {
  Series conversion;  // Tenkan-sen
  Series base;        // Kijun-sen
  Series span_a;      // Senkou A, unshifted
  Series span_b;      // Senkou B, unshifted
};

/// Ichimoku lines. The spans are returned unshifted; projecting the cloud
/// forward by `base_period` bars is the caller's decision, as in the web core.
Ichimoku ichimoku(const double* high, const double* low, size_t count, int conv_period = 9,
                  int base_period = 26, int span_b_period = 52);

struct Adx {
  Series adx;
  Series plus_di;
  Series minus_di;
};

/// Wilder's ADX with its two directional indicators.
Adx adx(const double* high, const double* low, const double* close, size_t count, int period = 14);

struct SuperTrend {
  Series trend;
  /// +1 when the line is support below price, -1 when it is resistance above.
  Series direction;
};

SuperTrend super_trend(const double* high, const double* low, const double* close, size_t count,
                       int period = 10, double mult = 3.0);

/// Commodity Channel Index: distance from the typical price's own average,
/// scaled by mean deviation. +/-100 is the conventional band.
Series cci(const double* high, const double* low, const double* close, size_t count,
           int period = 20);

/// Money Flow Index — RSI weighted by volume, so a move on thin volume counts
/// for less. 0..100.
Series mfi(const double* high, const double* low, const double* close, const double* volume,
           size_t count, int period = 14);

/// Williams %R: where the close sits in the `period` range, as -100..0.
Series williams_r(const double* high, const double* low, const double* close, size_t count,
                  int period = 14);

struct Aroon {
  Series up;
  Series down;
  Series oscillator;
};

/// Aroon Up/Down — 100 means the extreme was set this bar, 0 means `period`
/// bars ago. The oscillator reads as trend strength and direction.
Aroon aroon(const double* high, const double* low, size_t count, int period = 25);

/// Donchian Channels: the rolling high/low and their midline.
Band donchian(const double* high, const double* low, size_t count, int period = 20);

/// Parabolic SAR — the trailing stop-and-reverse dots. Wilder's 0.02 / 0.2.
Series parabolic_sar(const double* high, const double* low, size_t count, double step = 0.02,
                     double max_step = 0.2);

struct PivotLevels {
  double pivot;
  double r1, r2, r3;
  double s1, s2, s3;
};

/// Floor-trader pivots from one session's high/low/close, for the next session.
PivotLevels pivot_points(double high, double low, double close);

}  // namespace photon::finance
