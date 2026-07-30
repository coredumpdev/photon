// Chart-type transforms — port of core/src/finance/transforms.ts.
//
// These turn raw OHLC(V) into the geometry a specialist finance chart needs.
// None of them draw: each returns plain arrays a candlestick, bar or area layer
// renders, which is why a Renko chart needs no Renko layer.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::finance {

struct OhlcArrays {
  std::vector<double> open;
  std::vector<double> high;
  std::vector<double> low;
  std::vector<double> close;
};

/// Heikin-Ashi candles — a smoothed OHLC that filters noise out of a trend.
OhlcArrays heikin_ashi(const double* open, const double* high, const double* low,
                       const double* close, size_t count);

/// One brick / box for Renko and line-break, drawn as a wickless candle body.
struct Brick {
  /// Sequential column index; bricks are evenly spaced and time is discarded.
  int x;
  double open;
  double close;
  bool up;
};

/// Renko bricks: one per full `brick_size` move from the last brick's close,
/// several when price jumps. Time is discarded.
std::vector<Brick> renko(const double* close, size_t count, double brick_size);

/// Three-line-break, generalised to `lines`: a brick only when the close clears
/// the highest or lowest close of the last `lines` bricks.
std::vector<Brick> line_break(const double* close, size_t count, int lines = 3);

/// One Point & Figure column: a run of X's (rising) or O's (falling).
struct PfColumn {
  int col;
  /// 'X' or 'O' — a char rather than an enum so the ABI can pass it as one.
  char kind;
  double from;
  double to;
  /// Box centres filled in this column, for plotting the glyphs.
  std::vector<double> boxes;
};

/// Point & Figure columns. Price is quantised to `box_size`; a column flips
/// only after a `reversal`-box move against it. Time is discarded.
std::vector<PfColumn> point_and_figure(const double* high, const double* low, size_t count,
                                       double box_size, int reversal = 3);

struct VolumeProfile {
  std::vector<double> levels;
  std::vector<double> volume;
  double bin_size = 0.0;
  double price_min = 0.0;
  double price_max = 0.0;
  /// Bin index of the highest-volume level — the Point of Control.
  int poc_index = -1;
};

/// A histogram of traded volume by price level, for horizontal bars.
VolumeProfile volume_profile(const double* price, const double* volume, size_t count,
                             int bins = 24);

struct DepthCurves {
  /// Bid side, prices ascending toward the mid, cumulative volume.
  std::vector<double> bid_price;
  std::vector<double> bid_cum;
  /// Ask side, prices ascending away from the mid, cumulative volume.
  std::vector<double> ask_price;
  std::vector<double> ask_cum;
};

/// Order-book depth curves from `[price, size]` pairs in any order.
DepthCurves depth(const double* bid_price, const double* bid_size, size_t bid_count,
                  const double* ask_price, const double* ask_size, size_t ask_count);

struct ResampledOhlc : OhlcArrays {
  /// Bucket start time, epoch ms.
  std::vector<double> time;
  /// Summed volume per bucket; empty when no volume was supplied.
  std::vector<double> volume;
};

/// Roll bars up to a coarser timeframe. Buckets are aligned to multiples of
/// `bucket_ms` from the epoch, so the same input always gives the same
/// boundaries; empty buckets are skipped rather than filled, which is what a
/// market calendar wants.
ResampledOhlc resample_ohlc(const double* time, const double* open, const double* high,
                            const double* low, const double* close, const double* volume,
                            size_t count, double bucket_ms);

struct Drawdown {
  /// Fractional drawdown from the running peak at each point, <= 0.
  std::vector<double> values;
  std::vector<double> peak;
  double max_drawdown = 0.0;
  int trough_index = -1;
  int peak_index = -1;
};

/// The underwater curve of an equity series — how far below its own high-water
/// mark the strategy sat, which is the standard companion to an equity curve.
Drawdown drawdown(const double* equity, size_t count);

}  // namespace photon::finance
