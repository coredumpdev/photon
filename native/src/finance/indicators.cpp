#include "finance/indicators.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace photon::finance {

namespace {

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

Series warm(size_t n) { return Series(n, kNaN); }

/// Rolling extreme over a trailing window, NaN warm-up. O(n*period), which is
/// what the TypeScript does; a monotonic deque would be faster and would also
/// have to reproduce the >= / <= tie-breaks exactly, so it is not worth it at
/// the sizes an indicator runs on.
Series rolling_high(const double* v, size_t n, int period) {
  Series out = warm(n);
  if (period <= 0) return out;
  const size_t p = static_cast<size_t>(period);
  for (size_t i = p - 1; i < n; ++i) {
    double m = -std::numeric_limits<double>::infinity();
    for (size_t k = 0; k < p; ++k) m = std::max(m, v[i - k]);
    out[i] = m;
  }
  return out;
}

Series rolling_low(const double* v, size_t n, int period) {
  Series out = warm(n);
  if (period <= 0) return out;
  const size_t p = static_cast<size_t>(period);
  for (size_t i = p - 1; i < n; ++i) {
    double m = std::numeric_limits<double>::infinity();
    for (size_t k = 0; k < p; ++k) m = std::min(m, v[i - k]);
    out[i] = m;
  }
  return out;
}

}  // namespace

Series sma(const double* values, size_t count, int period) {
  Series out = warm(count);
  if (!values || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  double sum = 0.0;
  for (size_t i = 0; i < count; ++i) {
    sum += values[i];
    if (i >= p) sum -= values[i - p];
    if (i >= p - 1) out[i] = sum / static_cast<double>(p);
  }
  return out;
}

Series wma(const double* values, size_t count, int period) {
  Series out = warm(count);
  if (!values || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  const double denom = static_cast<double>(period * (period + 1)) / 2.0;
  for (size_t i = p - 1; i < count; ++i) {
    double acc = 0.0;
    for (size_t k = 0; k < p; ++k) acc += values[i - p + 1 + k] * static_cast<double>(k + 1);
    out[i] = acc / denom;
  }
  return out;
}

Series ema(const double* values, size_t count, int period) {
  Series out = warm(count);
  if (!values || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  const double alpha = 2.0 / (static_cast<double>(period) + 1.0);
  double seed = 0.0;
  for (size_t i = 0; i < p; ++i) seed += values[i];
  double prev = seed / static_cast<double>(p);
  out[p - 1] = prev;
  for (size_t i = p; i < count; ++i) {
    prev = values[i] * alpha + prev * (1.0 - alpha);
    out[i] = prev;
  }
  return out;
}

Series rolling_std(const double* values, size_t count, int period) {
  Series out = warm(count);
  if (!values || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  double sum = 0.0;
  double sum_sq = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double v = values[i];
    sum += v;
    sum_sq += v * v;
    if (i >= p) {
      const double old = values[i - p];
      sum -= old;
      sum_sq -= old * old;
    }
    if (i >= p - 1) {
      const double mean = sum / static_cast<double>(p);
      const double variance = std::max(0.0, sum_sq / static_cast<double>(p) - mean * mean);
      out[i] = std::sqrt(variance);
    }
  }
  return out;
}

Band bollinger(const double* close, size_t count, int period, double k) {
  Band out;
  out.middle = sma(close, count, period);
  const Series sd = rolling_std(close, count, period);
  out.upper = warm(count);
  out.lower = warm(count);
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(out.middle[i])) {
      out.upper[i] = out.middle[i] + k * sd[i];
      out.lower[i] = out.middle[i] - k * sd[i];
    }
  }
  return out;
}

Series rsi(const double* close, size_t count, int period) {
  Series out = warm(count);
  if (!close || period <= 0 || count <= static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  const double dp = static_cast<double>(period);
  double gain = 0.0;
  double loss = 0.0;
  for (size_t i = 1; i <= p; ++i) {
    const double ch = close[i] - close[i - 1];
    if (ch >= 0.0) {
      gain += ch;
    } else {
      loss -= ch;
    }
  }
  double avg_gain = gain / dp;
  double avg_loss = loss / dp;
  out[p] = avg_loss == 0.0 ? 100.0 : 100.0 - 100.0 / (1.0 + avg_gain / avg_loss);
  for (size_t i = p + 1; i < count; ++i) {
    const double ch = close[i] - close[i - 1];
    const double g = ch > 0.0 ? ch : 0.0;
    const double l = ch < 0.0 ? -ch : 0.0;
    avg_gain = (avg_gain * (dp - 1.0) + g) / dp;
    avg_loss = (avg_loss * (dp - 1.0) + l) / dp;
    out[i] = avg_loss == 0.0 ? 100.0 : 100.0 - 100.0 / (1.0 + avg_gain / avg_loss);
  }
  return out;
}

Macd macd(const double* close, size_t count, int fast, int slow, int signal_period) {
  Macd out;
  const Series ema_fast = ema(close, count, fast);
  const Series ema_slow = ema(close, count, slow);
  out.macd = warm(count);
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(ema_fast[i]) && !std::isnan(ema_slow[i])) out.macd[i] = ema_fast[i] - ema_slow[i];
  }
  // The signal is the EMA of the MACD line over its *valid* region only: run it
  // across the NaN prefix and the seed would be NaN and stay that way forever.
  out.signal = warm(count);
  const int first = first_finite(out.macd.data(), count);
  if (first >= 0) {
    const size_t offset = static_cast<size_t>(first);
    const Series sig = ema(out.macd.data() + offset, count - offset, signal_period);
    for (size_t i = 0; i < sig.size(); ++i) out.signal[offset + i] = sig[i];
  }
  out.histogram = warm(count);
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(out.macd[i]) && !std::isnan(out.signal[i])) {
      out.histogram[i] = out.macd[i] - out.signal[i];
    }
  }
  return out;
}

Series vwap(const double* high, const double* low, const double* close, const double* volume,
            size_t count) {
  Series out = warm(count);
  if (!high || !low || !close || !volume) return out;
  double cum_pv = 0.0;
  double cum_v = 0.0;
  for (size_t i = 0; i < count; ++i) {
    const double typical = (high[i] + low[i] + close[i]) / 3.0;
    cum_pv += typical * volume[i];
    cum_v += volume[i];
    out[i] = cum_v == 0.0 ? kNaN : cum_pv / cum_v;
  }
  return out;
}

Series true_range(const double* high, const double* low, const double* close, size_t count) {
  Series out(count, 0.0);
  if (!high || !low || !close || count == 0) return out;
  out[0] = high[0] - low[0];
  for (size_t i = 1; i < count; ++i) {
    const double pc = close[i - 1];
    out[i] = std::max({high[i] - low[i], std::abs(high[i] - pc), std::abs(low[i] - pc)});
  }
  return out;
}

Series atr(const double* high, const double* low, const double* close, size_t count, int period) {
  const Series tr = true_range(high, low, close, count);
  Series out = warm(count);
  if (period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  const double dp = static_cast<double>(period);
  double sum = 0.0;
  for (size_t i = 0; i < p; ++i) sum += tr[i];
  double prev = sum / dp;
  out[p - 1] = prev;
  for (size_t i = p; i < count; ++i) {
    prev = (prev * (dp - 1.0) + tr[i]) / dp;
    out[i] = prev;
  }
  return out;
}

int first_finite(const double* values, size_t count) {
  if (!values) return -1;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(values[i])) return static_cast<int>(i);
  }
  return -1;
}

Stochastic stochastic(const double* high, const double* low, const double* close, size_t count,
                      int k_period, int d_period) {
  Stochastic out;
  const Series hh = rolling_high(high, count, k_period);
  const Series ll = rolling_low(low, count, k_period);
  out.k = warm(count);
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(hh[i])) {
      const double range = hh[i] - ll[i];
      out.k[i] = range == 0.0 ? 50.0 : (100.0 * (close[i] - ll[i])) / range;
    }
  }
  out.d = sma(out.k.data(), count, d_period);
  return out;
}

Band keltner(const double* high, const double* low, const double* close, size_t count, int period,
             double mult, int atr_period) {
  Band out;
  out.middle = ema(close, count, period);
  const Series a = atr(high, low, close, count, atr_period);
  out.upper = warm(count);
  out.lower = warm(count);
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(out.middle[i]) && !std::isnan(a[i])) {
      out.upper[i] = out.middle[i] + mult * a[i];
      out.lower[i] = out.middle[i] - mult * a[i];
    }
  }
  return out;
}

Series obv(const double* close, const double* volume, size_t count) {
  Series out(count, 0.0);
  if (!close || !volume) return out;
  for (size_t i = 1; i < count; ++i) {
    const double d = close[i] - close[i - 1];
    out[i] = out[i - 1] + (d > 0.0 ? volume[i] : d < 0.0 ? -volume[i] : 0.0);
  }
  return out;
}

Ichimoku ichimoku(const double* high, const double* low, size_t count, int conv_period,
                  int base_period, int span_b_period) {
  const auto mid = [&](int p) {
    const Series hi = rolling_high(high, count, p);
    const Series lo = rolling_low(low, count, p);
    Series o = warm(count);
    for (size_t i = 0; i < count; ++i) {
      if (!std::isnan(hi[i])) o[i] = (hi[i] + lo[i]) / 2.0;
    }
    return o;
  };
  Ichimoku out;
  out.conversion = mid(conv_period);
  out.base = mid(base_period);
  out.span_b = mid(span_b_period);
  out.span_a = warm(count);
  for (size_t i = 0; i < count; ++i) {
    if (!std::isnan(out.conversion[i]) && !std::isnan(out.base[i])) {
      out.span_a[i] = (out.conversion[i] + out.base[i]) / 2.0;
    }
  }
  return out;
}

Adx adx(const double* high, const double* low, const double* close, size_t count, int period) {
  Adx out;
  out.adx = warm(count);
  out.plus_di = warm(count);
  out.minus_di = warm(count);
  if (!high || !low || !close || period <= 0 || count <= static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  const double dp = static_cast<double>(period);

  Series tr(count, 0.0);
  Series pdm(count, 0.0);
  Series mdm(count, 0.0);
  for (size_t i = 1; i < count; ++i) {
    const double up = high[i] - high[i - 1];
    const double down = low[i - 1] - low[i];
    pdm[i] = (up > down && up > 0.0) ? up : 0.0;
    mdm[i] = (down > up && down > 0.0) ? down : 0.0;
    const double pc = close[i - 1];
    tr[i] = std::max({high[i] - low[i], std::abs(high[i] - pc), std::abs(low[i] - pc)});
  }

  // Wilder-smoothed sums, seeded over the first `period` changes.
  double s_tr = 0.0;
  double s_p = 0.0;
  double s_m = 0.0;
  for (size_t i = 1; i <= p; ++i) {
    s_tr += tr[i];
    s_p += pdm[i];
    s_m += mdm[i];
  }
  Series dx = warm(count);
  const auto di_at = [&](size_t i) {
    const double plus = s_tr == 0.0 ? 0.0 : (100.0 * s_p) / s_tr;
    const double minus = s_tr == 0.0 ? 0.0 : (100.0 * s_m) / s_tr;
    out.plus_di[i] = plus;
    out.minus_di[i] = minus;
    const double sum = plus + minus;
    dx[i] = sum == 0.0 ? 0.0 : (100.0 * std::abs(plus - minus)) / sum;
  };
  di_at(p);
  for (size_t i = p + 1; i < count; ++i) {
    s_tr = s_tr - s_tr / dp + tr[i];
    s_p = s_p - s_p / dp + pdm[i];
    s_m = s_m - s_m / dp + mdm[i];
    di_at(i);
  }

  // ADX is the Wilder-smoothed DX, starting `period` bars after the first DX.
  const size_t adx_start = p + p;
  if (adx_start < count) {
    double acc = 0.0;
    for (size_t i = p + 1; i <= adx_start; ++i) acc += dx[i];
    double prev = acc / dp;
    out.adx[adx_start] = prev;
    for (size_t i = adx_start + 1; i < count; ++i) {
      prev = (prev * (dp - 1.0) + dx[i]) / dp;
      out.adx[i] = prev;
    }
  }
  return out;
}

SuperTrend super_trend(const double* high, const double* low, const double* close, size_t count,
                       int period, double mult) {
  SuperTrend out;
  out.trend = warm(count);
  out.direction = warm(count);
  if (!high || !low || !close) return out;
  const Series a = atr(high, low, close, count, period);
  Series final_upper(count, 0.0);
  Series final_lower(count, 0.0);
  int dir = 1;
  for (size_t i = 0; i < count; ++i) {
    if (std::isnan(a[i])) continue;
    const double hl2 = (high[i] + low[i]) / 2.0;
    const double basic_upper = hl2 + mult * a[i];
    const double basic_lower = hl2 - mult * a[i];
    const bool prev_valid = i > 0 && !std::isnan(a[i - 1]);
    final_upper[i] =
        prev_valid && (basic_upper < final_upper[i - 1] || close[i - 1] > final_upper[i - 1])
            ? basic_upper
            : (prev_valid ? final_upper[i - 1] : basic_upper);
    final_lower[i] =
        prev_valid && (basic_lower > final_lower[i - 1] || close[i - 1] < final_lower[i - 1])
            ? basic_lower
            : (prev_valid ? final_lower[i - 1] : basic_lower);
    if (!prev_valid) {
      dir = close[i] >= hl2 ? 1 : -1;
    } else if (dir == 1 && close[i] < final_lower[i]) {
      dir = -1;
    } else if (dir == -1 && close[i] > final_upper[i]) {
      dir = 1;
    }
    out.direction[i] = dir;
    out.trend[i] = dir == 1 ? final_lower[i] : final_upper[i];
  }
  return out;
}

Series cci(const double* high, const double* low, const double* close, size_t count, int period) {
  Series out = warm(count);
  if (!high || !low || !close || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  Series tp(count, 0.0);
  for (size_t i = 0; i < count; ++i) tp[i] = (high[i] + low[i] + close[i]) / 3.0;
  const Series avg = sma(tp.data(), count, period);
  for (size_t i = p - 1; i < count; ++i) {
    double dev = 0.0;
    for (size_t k = i - p + 1; k <= i; ++k) dev += std::abs(tp[k] - avg[i]);
    dev /= static_cast<double>(p);
    out[i] = dev == 0.0 ? 0.0 : (tp[i] - avg[i]) / (0.015 * dev);
  }
  return out;
}

Series mfi(const double* high, const double* low, const double* close, const double* volume,
           size_t count, int period) {
  Series out = warm(count);
  if (!high || !low || !close || !volume || period <= 0 || count <= static_cast<size_t>(period)) {
    return out;
  }
  const size_t p = static_cast<size_t>(period);
  Series tp(count, 0.0);
  for (size_t i = 0; i < count; ++i) tp[i] = (high[i] + low[i] + close[i]) / 3.0;
  for (size_t i = p; i < count; ++i) {
    double pos = 0.0;
    double neg = 0.0;
    for (size_t k = i - p + 1; k <= i; ++k) {
      const double flow = tp[k] * volume[k];
      if (tp[k] > tp[k - 1]) {
        pos += flow;
      } else if (tp[k] < tp[k - 1]) {
        neg += flow;
      }
    }
    out[i] = neg == 0.0 ? 100.0 : 100.0 - 100.0 / (1.0 + pos / neg);
  }
  return out;
}

Series williams_r(const double* high, const double* low, const double* close, size_t count,
                  int period) {
  Series out = warm(count);
  if (!high || !low || !close || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  for (size_t i = p - 1; i < count; ++i) {
    double hh = -std::numeric_limits<double>::infinity();
    double ll = std::numeric_limits<double>::infinity();
    for (size_t k = i - p + 1; k <= i; ++k) {
      if (high[k] > hh) hh = high[k];
      if (low[k] < ll) ll = low[k];
    }
    const double span = hh - ll;
    out[i] = span == 0.0 ? 0.0 : ((hh - close[i]) / span) * -100.0;
  }
  return out;
}

Aroon aroon(const double* high, const double* low, size_t count, int period) {
  Aroon out;
  out.up = warm(count);
  out.down = warm(count);
  out.oscillator = warm(count);
  if (!high || !low || period <= 0 || count <= static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  const double dp = static_cast<double>(period);
  for (size_t i = p; i < count; ++i) {
    double hi = -std::numeric_limits<double>::infinity();
    double lo = std::numeric_limits<double>::infinity();
    size_t h_idx = i;
    size_t l_idx = i;
    for (size_t k = i - p; k <= i; ++k) {
      if (high[k] >= hi) {
        hi = high[k];
        h_idx = k;
      }
      if (low[k] <= lo) {
        lo = low[k];
        l_idx = k;
      }
    }
    out.up[i] = ((dp - static_cast<double>(i - h_idx)) / dp) * 100.0;
    out.down[i] = ((dp - static_cast<double>(i - l_idx)) / dp) * 100.0;
    out.oscillator[i] = out.up[i] - out.down[i];
  }
  return out;
}

Band donchian(const double* high, const double* low, size_t count, int period) {
  Band out;
  out.middle = warm(count);
  out.upper = warm(count);
  out.lower = warm(count);
  if (!high || !low || period <= 0 || count < static_cast<size_t>(period)) return out;
  const size_t p = static_cast<size_t>(period);
  for (size_t i = p - 1; i < count; ++i) {
    double hh = -std::numeric_limits<double>::infinity();
    double ll = std::numeric_limits<double>::infinity();
    for (size_t k = i - p + 1; k <= i; ++k) {
      if (high[k] > hh) hh = high[k];
      if (low[k] < ll) ll = low[k];
    }
    out.upper[i] = hh;
    out.lower[i] = ll;
    out.middle[i] = (hh + ll) / 2.0;
  }
  return out;
}

Series parabolic_sar(const double* high, const double* low, size_t count, double step,
                     double max_step) {
  Series out = warm(count);
  if (!high || !low || count < 2) return out;
  bool rising = high[1] >= high[0];
  double sar = rising ? low[0] : high[0];
  double extreme = rising ? high[1] : low[1];
  double accel = step;
  out[1] = sar;
  for (size_t i = 2; i < count; ++i) {
    sar += accel * (extreme - sar);
    // The stop may never enter the previous two bars' range.
    if (rising) {
      sar = std::min({sar, low[i - 1], low[i - 2]});
    } else {
      sar = std::max({sar, high[i - 1], high[i - 2]});
    }
    if (rising ? low[i] < sar : high[i] > sar) {
      // Reverse: the stop becomes the extreme and a fresh trend starts.
      rising = !rising;
      sar = extreme;
      extreme = rising ? high[i] : low[i];
      accel = step;
    } else if (rising ? high[i] > extreme : low[i] < extreme) {
      extreme = rising ? high[i] : low[i];
      accel = std::min(max_step, accel + step);
    }
    out[i] = sar;
  }
  return out;
}

PivotLevels pivot_points(double high, double low, double close) {
  const double pivot = (high + low + close) / 3.0;
  const double range = high - low;
  PivotLevels out{};
  out.pivot = pivot;
  out.r1 = 2.0 * pivot - low;
  out.s1 = 2.0 * pivot - high;
  out.r2 = pivot + range;
  out.s2 = pivot - range;
  out.r3 = high + 2.0 * (pivot - low);
  out.s3 = low - 2.0 * (high - pivot);
  return out;
}

}  // namespace photon::finance
