/*
 * The technical indicators and the chart transforms.
 *
 * A transcription of packages/core/test/finance.test.ts, case for case, because
 * the value of these functions is that the two cores agree: an RSI that is
 * three tenths off is not wrong in any way a chart shows, and is exactly the
 * sort of drift that only a shared test catches.
 *
 * A handful of cases here have no TypeScript counterpart — the ones marked as
 * such — and they cover the paths the vitest suite happens not to reach.
 */

#include <cmath>
#include <cstddef>
#include <vector>

#include "check.h"
#include "finance/indicators.hpp"
#include "finance/transforms.hpp"

using photon::finance::Series;

namespace fin = photon::finance;

namespace {

bool is_nan(const Series& s, size_t i) { return std::isnan(s[i]); }

Series call(Series (*fn)(const double*, size_t, int), const std::vector<double>& v, int period) {
  return fn(v.data(), v.size(), period);
}

// ---- indicators -----------------------------------------------------------

void test_sma_is_a_trailing_mean_with_a_nan_warm_up() {
  const std::vector<double> v{1, 2, 3, 4, 5};
  const Series s = call(fin::sma, v, 3);
  CHECK(is_nan(s, 0));
  CHECK(is_nan(s, 1));
  CHECK_NEAR(s[2], 2.0, 1e-12);
  CHECK_NEAR(s[3], 3.0, 1e-12);
  CHECK_NEAR(s[4], 4.0, 1e-12);
}

void test_ema_is_sma_seeded_then_exponential() {
  const std::vector<double> v{1, 1, 1, 10};  // alpha = 2/3, seed 1 at index 1
  const Series e = call(fin::ema, v, 2);
  CHECK(is_nan(e, 0));
  CHECK_NEAR(e[1], 1.0, 1e-12);
  CHECK_NEAR(e[2], 1.0, 1e-12);
  CHECK_NEAR(e[3], 7.0, 1e-12);  // 10*2/3 + 1*1/3
}

void test_wma_weights_the_newest_heaviest() {
  const std::vector<double> v{1, 2, 3};
  const Series w = call(fin::wma, v, 3);  // (1*1 + 2*2 + 3*3)/6
  CHECK(is_nan(w, 1));
  CHECK_NEAR(w[2], 14.0 / 6.0, 1e-12);
}

void test_rolling_std_is_the_population_deviation() {
  const std::vector<double> v{2, 4, 6};  // mean 4, var (4+0+4)/3
  const Series s = call(fin::rolling_std, v, 3);
  CHECK_NEAR(s[2], std::sqrt(8.0 / 3.0), 1e-12);
}

void test_bollinger_is_the_sma_with_symmetric_bands() {
  const std::vector<double> close{1, 2, 3, 4, 5, 6, 7, 8};
  const fin::Band b = fin::bollinger(close.data(), close.size(), 4, 2.0);
  const Series m = call(fin::sma, close, 4);
  for (size_t i = 3; i < close.size(); ++i) {
    CHECK_NEAR(b.middle[i], m[i], 1e-12);
    CHECK_NEAR(b.upper[i] - b.middle[i], b.middle[i] - b.lower[i], 1e-12);
  }
}

void test_rsi_pins_at_100_on_a_monotonic_rise() {
  std::vector<double> up(20);
  for (size_t i = 0; i < up.size(); ++i) up[i] = static_cast<double>(i) + 1.0;
  const Series r = fin::rsi(up.data(), up.size(), 14);
  CHECK(is_nan(r, 13));
  CHECK_NEAR(r[14], 100.0, 1e-9);
  for (size_t i = 14; i < r.size(); ++i) CHECK(r[i] >= 0.0 && r[i] <= 100.0);
}

void test_macd_histogram_is_the_difference_of_its_two_lines() {
  std::vector<double> close(60);
  for (size_t i = 0; i < close.size(); ++i) {
    close[i] = 100.0 + std::sin(static_cast<double>(i) / 5.0) * 10.0;
  }
  const fin::Macd m = fin::macd(close.data(), close.size(), 12, 26, 9);
  CHECK_EQ(m.macd.size(), close.size());
  for (size_t i = 0; i < close.size(); ++i) {
    if (!std::isnan(m.histogram[i])) CHECK_NEAR(m.histogram[i], m.macd[i] - m.signal[i], 1e-12);
  }
}

void test_vwap_is_cumulative() {
  const std::vector<double> hlc{10, 20};
  const std::vector<double> vol{1, 1};
  const Series v = fin::vwap(hlc.data(), hlc.data(), hlc.data(), vol.data(), hlc.size());
  CHECK_NEAR(v[0], 10.0, 1e-12);
  CHECK_NEAR(v[1], 15.0, 1e-12);
}

void test_true_range_and_atr() {
  const std::vector<double> h{11, 12, 13, 14, 15};
  const std::vector<double> l{9, 10, 11, 12, 13};
  const std::vector<double> c{10, 11, 12, 13, 14};
  const Series tr = fin::true_range(h.data(), l.data(), c.data(), h.size());
  CHECK_NEAR(tr[0], 2.0, 1e-12);
  const Series a = fin::atr(h.data(), l.data(), c.data(), h.size(), 3);
  CHECK(is_nan(a, 1));
  CHECK(a[2] > 0.0);
}

void test_first_finite_finds_the_warm_up_boundary() {
  const std::vector<double> v{1, 2, 3, 4};
  const Series s = call(fin::sma, v, 3);
  CHECK_EQ(fin::first_finite(s.data(), s.size()), 2);
  const double all_nan[2] = {std::nan(""), std::nan("")};
  CHECK_EQ(fin::first_finite(all_nan, 2), -1);
}

// ---- the advanced set -----------------------------------------------------

const std::vector<double> kHigh{11, 12, 13, 14, 15, 16, 17, 18};
const std::vector<double> kLow{9, 10, 11, 12, 13, 14, 15, 16};
const std::vector<double> kClose{10, 11, 12, 13, 14, 15, 16, 17};

void test_stochastic_is_bounded_and_high_on_a_steady_rise() {
  const fin::Stochastic s =
      fin::stochastic(kHigh.data(), kLow.data(), kClose.data(), kClose.size(), 5, 3);
  for (size_t i = 4; i < s.k.size(); ++i) CHECK(s.k[i] >= 0.0 && s.k[i] <= 100.0);
  CHECK(s.k.back() > 60.0);
  CHECK_EQ(s.d.size(), s.k.size());
}

void test_keltner_brackets_its_middle() {
  const fin::Band b =
      fin::keltner(kHigh.data(), kLow.data(), kClose.data(), kClose.size(), 4, 2.0, 4);
  CHECK(b.upper[7] > b.middle[7]);
  CHECK(b.middle[7] > b.lower[7]);
}

void test_obv_accumulates_signed_volume() {
  const std::vector<double> close{1, 2, 3, 2};
  const std::vector<double> vol{10, 10, 10, 10};
  const Series o = fin::obv(close.data(), vol.data(), close.size());
  CHECK_NEAR(o[0], 0.0, 1e-12);
  CHECK_NEAR(o[1], 10.0, 1e-12);
  CHECK_NEAR(o[2], 20.0, 1e-12);
  CHECK_NEAR(o[3], 10.0, 1e-12);
}

void test_ichimoku_span_a_is_the_mean_of_its_two_lines() {
  const fin::Ichimoku i = fin::ichimoku(kHigh.data(), kLow.data(), kHigh.size(), 3, 5, 7);
  CHECK_NEAR(i.span_a[7], (i.conversion[7] + i.base[7]) / 2.0, 1e-12);
  CHECK(is_nan(i.span_b, 5));  // span B needs seven bars
}

void test_adx_is_bounded_with_a_nan_warm_up() {
  std::vector<double> hi(40);
  std::vector<double> lo(40);
  std::vector<double> cl(40);
  for (size_t i = 0; i < hi.size(); ++i) {
    hi[i] = 100.0 + static_cast<double>(i) + std::sin(static_cast<double>(i));
    lo[i] = hi[i] - 2.0;
    cl[i] = hi[i] - 1.0;
  }
  const fin::Adx a = fin::adx(hi.data(), lo.data(), cl.data(), hi.size(), 14);
  CHECK(is_nan(a.adx, 10));
  for (size_t i = 30; i < a.adx.size(); ++i) CHECK(a.adx[i] >= 0.0 && a.adx[i] <= 100.0);
  CHECK(fin::first_finite(a.plus_di.data(), a.plus_di.size()) >= 0);
  CHECK(fin::first_finite(a.minus_di.data(), a.minus_di.size()) >= 0);
}

void test_supertrend_direction_is_plus_or_minus_one() {
  const std::vector<double> hi{10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 8, 9, 10, 11, 12};
  std::vector<double> lo(hi.size());
  std::vector<double> cl(hi.size());
  for (size_t i = 0; i < hi.size(); ++i) {
    lo[i] = hi[i] - 1.0;
    cl[i] = hi[i] - 0.5;
  }
  const fin::SuperTrend st = fin::super_trend(hi.data(), lo.data(), cl.data(), hi.size(), 3, 2.0);
  int seen = 0;
  for (size_t i = 0; i < st.direction.size(); ++i) {
    if (std::isnan(st.direction[i])) continue;
    CHECK(st.direction[i] == 1.0 || st.direction[i] == -1.0);
    ++seen;
  }
  CHECK(seen > 0);
  CHECK(fin::first_finite(st.trend.data(), st.trend.size()) >= 0);
}

void test_pivot_points_bracket_the_pivot() {
  // No TypeScript counterpart: the web suite covers fibRetracements but not
  // this, and an off-by-one in r3/s3 would be invisible without it.
  const fin::PivotLevels p = fin::pivot_points(110.0, 90.0, 100.0);
  CHECK_NEAR(p.pivot, 100.0, 1e-12);
  CHECK_NEAR(p.r1, 110.0, 1e-12);
  CHECK_NEAR(p.s1, 90.0, 1e-12);
  CHECK_NEAR(p.r2, 120.0, 1e-12);
  CHECK_NEAR(p.s2, 80.0, 1e-12);
  CHECK_NEAR(p.r3, 130.0, 1e-12);
  CHECK_NEAR(p.s3, 70.0, 1e-12);
}

void test_the_bounded_oscillators_stay_in_their_bands() {
  // No TypeScript counterpart. CCI, MFI and Williams %R are all newer than the
  // vitest suite; what is checked is the property each one's band depends on.
  std::vector<double> hi(60);
  std::vector<double> lo(60);
  std::vector<double> cl(60);
  std::vector<double> vol(60);
  for (size_t i = 0; i < hi.size(); ++i) {
    const double t = static_cast<double>(i);
    hi[i] = 100.0 + std::sin(t / 4.0) * 5.0 + 1.0;
    lo[i] = hi[i] - 2.0;
    cl[i] = hi[i] - 1.0;
    vol[i] = 1000.0 + t * 10.0;
  }
  const Series w = fin::williams_r(hi.data(), lo.data(), cl.data(), hi.size(), 14);
  for (size_t i = 13; i < w.size(); ++i) CHECK(w[i] >= -100.0 && w[i] <= 0.0);

  const Series m = fin::mfi(hi.data(), lo.data(), cl.data(), vol.data(), hi.size(), 14);
  for (size_t i = 14; i < m.size(); ++i) CHECK(m[i] >= 0.0 && m[i] <= 100.0);

  const Series c = fin::cci(hi.data(), lo.data(), cl.data(), hi.size(), 20);
  CHECK(fin::first_finite(c.data(), c.size()) == 19);
  for (size_t i = 19; i < c.size(); ++i) CHECK(std::isfinite(c[i]));
}

void test_aroon_and_donchian_track_the_extremes() {
  // No TypeScript counterpart.
  std::vector<double> hi(30);
  std::vector<double> lo(30);
  for (size_t i = 0; i < hi.size(); ++i) {
    hi[i] = 10.0 + static_cast<double>(i);  // a new high every bar
    lo[i] = hi[i] - 1.0;
  }
  const fin::Aroon a = fin::aroon(hi.data(), lo.data(), hi.size(), 25);
  // The high is set this bar every bar, so Aroon Up pins at 100; the low is
  // always the oldest bar in the window, which is what puts Down at zero.
  CHECK_NEAR(a.up[29], 100.0, 1e-12);
  CHECK_NEAR(a.down[29], 0.0, 1e-12);
  CHECK_NEAR(a.oscillator[29], a.up[29] - a.down[29], 1e-12);

  const fin::Band d = fin::donchian(hi.data(), lo.data(), hi.size(), 20);
  CHECK_NEAR(d.upper[29], 39.0, 1e-12);
  CHECK_NEAR(d.lower[29], 19.0, 1e-12);
  CHECK_NEAR(d.middle[29], 29.0, 1e-12);
}

void test_parabolic_sar_trails_the_trend() {
  // No TypeScript counterpart. What matters is that the stop sits under a rise
  // and never inside the last two bars' range.
  std::vector<double> hi(20);
  std::vector<double> lo(20);
  for (size_t i = 0; i < hi.size(); ++i) {
    hi[i] = 10.0 + static_cast<double>(i);
    lo[i] = hi[i] - 1.0;
  }
  const Series sar = fin::parabolic_sar(hi.data(), lo.data(), hi.size(), 0.02, 0.2);
  CHECK(is_nan(sar, 0));
  for (size_t i = 2; i < sar.size(); ++i) {
    CHECK(std::isfinite(sar[i]));
    CHECK(sar[i] <= lo[i - 1] + 1e-12);
  }
}

// ---- chart transforms -----------------------------------------------------

void test_heikin_ashi_matches_the_definition_on_one_bar() {
  const double o = 10, h = 12, l = 9, c = 11;
  const fin::OhlcArrays ha = fin::heikin_ashi(&o, &h, &l, &c, 1);
  CHECK_NEAR(ha.close[0], 10.5, 1e-12);  // (10+12+9+11)/4
  CHECK_NEAR(ha.open[0], 10.5, 1e-12);   // (10+11)/2
  CHECK_NEAR(ha.high[0], 12.0, 1e-12);
  CHECK_NEAR(ha.low[0], 9.0, 1e-12);
}

void test_renko_emits_one_brick_per_full_rise() {
  const std::vector<double> close{100, 101, 102, 103};
  const std::vector<fin::Brick> bricks = fin::renko(close.data(), close.size(), 1.0);
  CHECK_EQ(bricks.size(), 3);
  for (size_t i = 0; i < bricks.size(); ++i) {
    CHECK(bricks[i].up);
    CHECK_EQ(bricks[i].x, static_cast<int>(i));
  }
  CHECK_NEAR(bricks[2].close, 103.0, 1e-12);
}

void test_renko_emits_several_bricks_on_a_jump() {
  const std::vector<double> close{100, 103};
  CHECK_EQ(fin::renko(close.data(), close.size(), 1.0).size(), 3);
}

void test_line_break_breaks_to_new_highs() {
  const std::vector<double> close{1, 2, 3, 2.5, 4};
  const std::vector<fin::Brick> bricks = fin::line_break(close.data(), close.size(), 3);
  CHECK(!bricks.empty());
  CHECK(bricks[0].up);
}

void test_point_and_figure_produces_columns() {
  const std::vector<double> high{10, 11, 12, 11, 8, 9};
  const std::vector<double> low{9, 10, 11, 8, 7, 8};
  const std::vector<fin::PfColumn> cols =
      fin::point_and_figure(high.data(), low.data(), high.size(), 1.0, 3);
  CHECK(!cols.empty());
  CHECK(cols[0].kind == 'X' || cols[0].kind == 'O');
  // Every column's boxes step by the box size and stay inside from..to.
  for (const fin::PfColumn& c : cols) {
    const double lo = std::min(c.from, c.to);
    const double hi = std::max(c.from, c.to);
    for (size_t i = 0; i < c.boxes.size(); ++i) {
      CHECK_NEAR(c.boxes[i], lo + 0.5 + static_cast<double>(i), 1e-9);
      CHECK(c.boxes[i] > lo - 1e-9 && c.boxes[i] < hi + 1.0 + 1e-9);
    }
  }
}

void test_volume_profile_conserves_volume_and_finds_the_poc() {
  const std::vector<double> price{1, 2, 3};
  const std::vector<double> vol{10, 20, 30};
  const fin::VolumeProfile vp = fin::volume_profile(price.data(), vol.data(), price.size(), 3);
  double total = 0.0;
  for (const double v : vp.volume) total += v;
  CHECK_NEAR(total, 60.0, 1e-12);
  CHECK_EQ(vp.poc_index, 2);
  CHECK_EQ(vp.levels.size(), 3);
}

void test_depth_returns_cumulative_curves_with_ascending_prices() {
  const std::vector<double> bp{10, 9};
  const std::vector<double> bs{5, 3};
  const std::vector<double> ap{11, 12};
  const std::vector<double> as_{4, 2};
  const fin::DepthCurves d = fin::depth(bp.data(), bs.data(), 2, ap.data(), as_.data(), 2);
  CHECK_NEAR(d.bid_price[0], 9.0, 1e-12);
  CHECK_NEAR(d.bid_price[1], 10.0, 1e-12);
  CHECK_NEAR(d.bid_cum[0], 8.0, 1e-12);  // cumulative toward the mid
  CHECK_NEAR(d.bid_cum[1], 5.0, 1e-12);
  CHECK_NEAR(d.ask_price[0], 11.0, 1e-12);
  CHECK_NEAR(d.ask_price[1], 12.0, 1e-12);
  CHECK_NEAR(d.ask_cum[0], 4.0, 1e-12);
  CHECK_NEAR(d.ask_cum[1], 6.0, 1e-12);
}

void test_resample_rolls_bars_into_aligned_buckets() {
  // No TypeScript counterpart. Three minute bars into one five-minute bucket
  // and one that starts the next: the boundary is the arithmetic, not the data.
  const std::vector<double> time{0, 60000, 120000, 300000};
  const std::vector<double> open{1, 2, 3, 4};
  const std::vector<double> high{5, 9, 6, 7};
  const std::vector<double> low{0.5, 1.0, 0.2, 3.0};
  const std::vector<double> close{2, 3, 4, 5};
  const std::vector<double> vol{10, 10, 10, 10};
  const fin::ResampledOhlc r = fin::resample_ohlc(time.data(), open.data(), high.data(), low.data(),
                                                  close.data(), vol.data(), time.size(), 300000.0);
  CHECK_EQ(r.time.size(), 2);
  CHECK_NEAR(r.time[0], 0.0, 1e-12);
  CHECK_NEAR(r.time[1], 300000.0, 1e-12);
  CHECK_NEAR(r.open[0], 1.0, 1e-12);   // the first bar's open
  CHECK_NEAR(r.close[0], 4.0, 1e-12);  // the last bar's close
  CHECK_NEAR(r.high[0], 9.0, 1e-12);
  CHECK_NEAR(r.low[0], 0.2, 1e-12);
  CHECK_NEAR(r.volume[0], 30.0, 1e-12);
  CHECK_NEAR(r.open[1], 4.0, 1e-12);
}

void test_drawdown_finds_the_deepest_stretch() {
  // No TypeScript counterpart.
  const std::vector<double> equity{100, 120, 90, 130, 65};
  const fin::Drawdown d = fin::drawdown(equity.data(), equity.size());
  CHECK_NEAR(d.peak[2], 120.0, 1e-12);
  CHECK_NEAR(d.values[0], 0.0, 1e-12);
  CHECK_NEAR(d.values[4], 65.0 / 130.0 - 1.0, 1e-12);
  CHECK_NEAR(d.max_drawdown, 65.0 / 130.0 - 1.0, 1e-12);
  CHECK_EQ(d.trough_index, 4);
  CHECK_EQ(d.peak_index, 3);
}

void test_degenerate_inputs_return_empty_rather_than_crash() {
  // No TypeScript counterpart: the web core is protected by its own bounds
  // checks, and this half is not.
  CHECK(fin::sma(nullptr, 0, 3).empty());
  CHECK(std::isnan(call(fin::sma, {1.0, 2.0}, 5)[0]));
  CHECK(call(fin::ema, {1.0, 2.0}, 0).size() == 2);
  CHECK(fin::renko(nullptr, 0, 1.0).empty());
  const std::vector<double> one{5.0};
  CHECK(fin::renko(one.data(), 1, 0.0).empty());   // a zero brick size cannot terminate
  CHECK(fin::line_break(one.data(), 1, 3).empty());
  CHECK(fin::volume_profile(one.data(), one.data(), 1, 0).levels.empty());
  CHECK(fin::drawdown(nullptr, 0).values.empty());
}

}  // namespace

int main() {
  RUN(test_sma_is_a_trailing_mean_with_a_nan_warm_up);
  RUN(test_ema_is_sma_seeded_then_exponential);
  RUN(test_wma_weights_the_newest_heaviest);
  RUN(test_rolling_std_is_the_population_deviation);
  RUN(test_bollinger_is_the_sma_with_symmetric_bands);
  RUN(test_rsi_pins_at_100_on_a_monotonic_rise);
  RUN(test_macd_histogram_is_the_difference_of_its_two_lines);
  RUN(test_vwap_is_cumulative);
  RUN(test_true_range_and_atr);
  RUN(test_first_finite_finds_the_warm_up_boundary);
  RUN(test_stochastic_is_bounded_and_high_on_a_steady_rise);
  RUN(test_keltner_brackets_its_middle);
  RUN(test_obv_accumulates_signed_volume);
  RUN(test_ichimoku_span_a_is_the_mean_of_its_two_lines);
  RUN(test_adx_is_bounded_with_a_nan_warm_up);
  RUN(test_supertrend_direction_is_plus_or_minus_one);
  RUN(test_pivot_points_bracket_the_pivot);
  RUN(test_the_bounded_oscillators_stay_in_their_bands);
  RUN(test_aroon_and_donchian_track_the_extremes);
  RUN(test_parabolic_sar_trails_the_trend);
  RUN(test_heikin_ashi_matches_the_definition_on_one_bar);
  RUN(test_renko_emits_one_brick_per_full_rise);
  RUN(test_renko_emits_several_bricks_on_a_jump);
  RUN(test_line_break_breaks_to_new_highs);
  RUN(test_point_and_figure_produces_columns);
  RUN(test_volume_profile_conserves_volume_and_finds_the_poc);
  RUN(test_depth_returns_cumulative_curves_with_ascending_prices);
  RUN(test_resample_rolls_bars_into_aligned_buckets);
  RUN(test_drawdown_finds_the_deepest_stretch);
  RUN(test_degenerate_inputs_return_empty_rather_than_crash);
  return TEST_MAIN_RESULT();
}
