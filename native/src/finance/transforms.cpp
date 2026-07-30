#include "finance/transforms.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace photon::finance {

OhlcArrays heikin_ashi(const double* open, const double* high, const double* low,
                       const double* close, size_t count) {
  OhlcArrays out;
  if (!open || !high || !low || !close) return out;
  out.open.resize(count);
  out.high.resize(count);
  out.low.resize(count);
  out.close.resize(count);
  for (size_t i = 0; i < count; ++i) {
    const double o = open[i];
    const double h = high[i];
    const double l = low[i];
    const double c = close[i];
    const double ha_close = (o + h + l + c) / 4.0;
    const double ha_open = i == 0 ? (o + c) / 2.0 : (out.open[i - 1] + out.close[i - 1]) / 2.0;
    out.close[i] = ha_close;
    out.open[i] = ha_open;
    out.high[i] = std::max({h, ha_open, ha_close});
    out.low[i] = std::min({l, ha_open, ha_close});
  }
  return out;
}

std::vector<Brick> renko(const double* close, size_t count, double brick_size) {
  std::vector<Brick> bricks;
  if (!close || count == 0 || !(brick_size > 0.0)) return bricks;
  double base = close[0];
  int x = 0;
  for (size_t i = 1; i < count; ++i) {
    double diff = close[i] - base;
    while (std::abs(diff) >= brick_size) {
      const bool up = diff > 0.0;
      const double next = base + (up ? brick_size : -brick_size);
      bricks.push_back(Brick{x++, base, next, up});
      base = next;
      diff = close[i] - base;
    }
  }
  return bricks;
}

std::vector<Brick> line_break(const double* close, size_t count, int lines) {
  std::vector<Brick> bricks;
  if (!close || count == 0) return bricks;
  // The closes of the bricks emitted so far, in order; only the last `lines` of
  // them ever matter, but keeping the whole run is simpler and costs nothing.
  std::vector<double> ends{close[0]};
  const size_t window = lines > 0 ? static_cast<size_t>(lines) : 0;
  int x = 0;
  for (size_t i = 1; i < count; ++i) {
    const double c = close[i];
    const size_t from = ends.size() > window ? ends.size() - window : 0;
    double hi = -std::numeric_limits<double>::infinity();
    double lo = std::numeric_limits<double>::infinity();
    for (size_t k = from; k < ends.size(); ++k) {
      hi = std::max(hi, ends[k]);
      lo = std::min(lo, ends[k]);
    }
    if (c > hi) {
      bricks.push_back(Brick{x++, ends.back(), c, true});
      ends.push_back(c);
    } else if (c < lo) {
      bricks.push_back(Brick{x++, ends.back(), c, false});
      ends.push_back(c);
    }
  }
  return bricks;
}

std::vector<PfColumn> point_and_figure(const double* high, const double* low, size_t count,
                                       double box_size, int reversal) {
  std::vector<PfColumn> cols;
  if (!high || !low || count == 0 || !(box_size > 0.0)) return cols;
  const auto quantise = [box_size](double p) { return std::floor(p / box_size) * box_size; };
  // 0 until the first bar decides which way the first column runs.
  char dir = 0;
  double top = quantise(high[0]);
  double bottom = quantise(low[0]);
  int col = 0;
  const auto push_col = [&](char kind, double from, double to) {
    PfColumn c;
    c.col = col;
    c.kind = kind;
    c.from = from;
    c.to = to;
    for (double b = std::min(from, to); b <= std::max(from, to) + 1e-9; b += box_size) {
      c.boxes.push_back(b + box_size / 2.0);
    }
    cols.push_back(std::move(c));
  };
  const double rev = static_cast<double>(reversal) * box_size;
  for (size_t i = 1; i < count; ++i) {
    const double h = quantise(high[i]);
    const double l = quantise(low[i]);
    if (dir == 0) dir = (h - bottom >= l - bottom) ? 'X' : 'O';
    if (dir == 'X') {
      if (h > top) {
        top = h;
      } else if (bottom - l >= rev || top - l >= rev) {
        push_col('X', bottom, top);
        ++col;
        dir = 'O';
        bottom = l;
      }
    } else {
      if (l < bottom) {
        bottom = l;
      } else if (h - top >= rev || h - bottom >= rev) {
        push_col('O', top, bottom);
        ++col;
        dir = 'X';
        top = h;
      }
    }
  }
  if (dir == 'X') {
    push_col('X', bottom, top);
  } else if (dir == 'O') {
    push_col('O', top, bottom);
  }
  return cols;
}

VolumeProfile volume_profile(const double* price, const double* volume, size_t count, int bins) {
  VolumeProfile out;
  if (!price || !volume || bins <= 0) return out;
  double lo = std::numeric_limits<double>::infinity();
  double hi = -std::numeric_limits<double>::infinity();
  for (size_t i = 0; i < count; ++i) {
    const double p = price[i];
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  if (!std::isfinite(lo) || !std::isfinite(hi)) return out;
  if (hi == lo) hi = lo + 1.0;
  const size_t n_bins = static_cast<size_t>(bins);
  out.bin_size = (hi - lo) / static_cast<double>(bins);
  out.price_min = lo;
  out.price_max = hi;
  out.levels.resize(n_bins);
  out.volume.assign(n_bins, 0.0);
  for (size_t b = 0; b < n_bins; ++b) {
    out.levels[b] = lo + (static_cast<double>(b) + 0.5) * out.bin_size;
  }
  for (size_t i = 0; i < count; ++i) {
    double idx = std::floor((price[i] - lo) / out.bin_size);
    if (!(idx >= 0.0)) idx = 0.0;
    size_t b = static_cast<size_t>(idx);
    if (b >= n_bins) b = n_bins - 1;
    out.volume[b] += volume[i];
  }
  out.poc_index = 0;
  for (size_t b = 1; b < n_bins; ++b) {
    if (out.volume[b] > out.volume[static_cast<size_t>(out.poc_index)]) out.poc_index = static_cast<int>(b);
  }
  return out;
}

DepthCurves depth(const double* bid_price, const double* bid_size, size_t bid_count,
                  const double* ask_price, const double* ask_size, size_t ask_count) {
  DepthCurves out;
  std::vector<std::pair<double, double>> bids;
  std::vector<std::pair<double, double>> asks;
  if (bid_price && bid_size) {
    bids.reserve(bid_count);
    for (size_t i = 0; i < bid_count; ++i) bids.emplace_back(bid_price[i], bid_size[i]);
  }
  if (ask_price && ask_size) {
    asks.reserve(ask_count);
    for (size_t i = 0; i < ask_count; ++i) asks.emplace_back(ask_price[i], ask_size[i]);
  }
  std::sort(bids.begin(), bids.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
  std::sort(asks.begin(), asks.end(), [](const auto& a, const auto& b) { return a.first < b.first; });

  out.bid_price.resize(bids.size());
  out.bid_cum.resize(bids.size());
  double cum = 0.0;
  for (size_t i = 0; i < bids.size(); ++i) {
    cum += bids[i].second;
    out.bid_price[i] = bids[i].first;
    out.bid_cum[i] = cum;
  }
  // Reverse the bid side so prices run ascending left to right, toward the mid.
  std::reverse(out.bid_price.begin(), out.bid_price.end());
  std::reverse(out.bid_cum.begin(), out.bid_cum.end());

  out.ask_price.resize(asks.size());
  out.ask_cum.resize(asks.size());
  cum = 0.0;
  for (size_t i = 0; i < asks.size(); ++i) {
    cum += asks[i].second;
    out.ask_price[i] = asks[i].first;
    out.ask_cum[i] = cum;
  }
  return out;
}

ResampledOhlc resample_ohlc(const double* time, const double* open, const double* high,
                            const double* low, const double* close, const double* volume,
                            size_t count, double bucket_ms) {
  ResampledOhlc out;
  if (!time || !open || !high || !low || !close || count == 0 || !(bucket_ms > 0.0)) return out;
  double bucket = std::numeric_limits<double>::quiet_NaN();
  for (size_t i = 0; i < count; ++i) {
    const double b = std::floor(time[i] / bucket_ms) * bucket_ms;
    if (!(b == bucket)) {  // NaN on the first bar takes this branch, as intended.
      bucket = b;
      out.time.push_back(b);
      out.open.push_back(open[i]);
      out.high.push_back(high[i]);
      out.low.push_back(low[i]);
      out.close.push_back(close[i]);
      if (volume) out.volume.push_back(volume[i]);
      continue;
    }
    const size_t k = out.time.size() - 1;
    if (high[i] > out.high[k]) out.high[k] = high[i];
    if (low[i] < out.low[k]) out.low[k] = low[i];
    out.close[k] = close[i];
    if (volume) out.volume[k] += volume[i];
  }
  return out;
}

Drawdown drawdown(const double* equity, size_t count) {
  Drawdown out;
  if (!equity) return out;
  out.values.resize(count);
  out.peak.resize(count);
  double high = -std::numeric_limits<double>::infinity();
  int high_idx = -1;
  for (size_t i = 0; i < count; ++i) {
    const double e = equity[i];
    if (e > high) {
      high = e;
      high_idx = static_cast<int>(i);
    }
    out.peak[i] = high;
    const double dd = high == 0.0 ? 0.0 : e / high - 1.0;
    out.values[i] = dd;
    if (dd < out.max_drawdown) {
      out.max_drawdown = dd;
      out.trough_index = static_cast<int>(i);
      out.peak_index = high_idx;
    }
  }
  return out;
}

}  // namespace photon::finance
