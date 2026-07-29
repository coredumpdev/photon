/*
 * The quantile and box-summary port, checked against the assertions in
 * packages/core/test/stats.test.ts and against hand-computed quartiles.
 *
 * A box plot is five numbers and the whole chart is those five numbers, so an
 * off-by-one in the quantile interpolation moves a line that still looks like a
 * perfectly reasonable box. There is nothing to eyeball; only arithmetic.
 */

#include <cmath>
#include <vector>

#include "check.h"
#include "stats/stats.hpp"

using photon::stats::box_stats;
using photon::stats::kde;
using photon::stats::quantile_sorted;

namespace {

void test_quantiles_interpolate_linearly() {
  const std::vector<double> v = {1, 2, 3, 4};
  CHECK_NEAR(quantile_sorted(v, 0.0), 1.0, 1e-12);
  CHECK_NEAR(quantile_sorted(v, 1.0), 4.0, 1e-12);
  // (n-1)*q = 1.5, so halfway between the second and third values.
  CHECK_NEAR(quantile_sorted(v, 0.5), 2.5, 1e-12);
  CHECK_NEAR(quantile_sorted(v, 0.25), 1.75, 1e-12);
  CHECK_NEAR(quantile_sorted(v, 0.75), 3.25, 1e-12);
}

void test_quantiles_of_degenerate_input() {
  CHECK(std::isnan(quantile_sorted({}, 0.5)));
  CHECK_NEAR(quantile_sorted({7.0}, 0.0), 7.0, 1e-12);
  CHECK_NEAR(quantile_sorted({7.0}, 0.9), 7.0, 1e-12);
}

void test_the_five_number_summary() {
  const double v[] = {1, 2, 3, 4, 5, 6, 7, 8, 9};
  const auto s = box_stats(v, 9);
  CHECK(s.valid);
  CHECK_NEAR(s.min, 1.0, 1e-12);
  CHECK_NEAR(s.q1, 3.0, 1e-12);
  CHECK_NEAR(s.median, 5.0, 1e-12);
  CHECK_NEAR(s.q3, 7.0, 1e-12);
  CHECK_NEAR(s.max, 9.0, 1e-12);
  // No value is outside the 1.5-IQR fences, so the whiskers reach the extremes.
  CHECK_NEAR(s.whisker_lo, 1.0, 1e-12);
  CHECK_NEAR(s.whisker_hi, 9.0, 1e-12);
  CHECK(s.outliers.empty());
}

void test_outliers_stop_the_whiskers() {
  // Same nine values plus a 100. The quartiles barely move, the fences land at
  // -3.5 and 13.5, and only the 100 is outside them.
  const double v[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 100};
  const auto s = box_stats(v, 10);
  CHECK(s.valid);
  CHECK_NEAR(s.max, 100.0, 1e-12);
  CHECK_NEAR(s.whisker_hi, 9.0, 1e-12);
  CHECK_NEAR(s.whisker_lo, 1.0, 1e-12);
  CHECK(s.outliers.size() == 1);
  CHECK_NEAR(s.outliers[0], 100.0, 1e-12);
}

void test_the_input_order_does_not_matter() {
  const double shuffled[] = {9, 100, 4, 1, 7, 2, 8, 3, 6, 5};
  const auto s = box_stats(shuffled, 10);
  CHECK_NEAR(s.median, 5.5, 1e-12);
  CHECK_NEAR(s.whisker_hi, 9.0, 1e-12);
  CHECK(s.outliers.size() == 1);
}

void test_a_constant_group_has_no_spread() {
  const double v[] = {4, 4, 4, 4};
  const auto s = box_stats(v, 4);
  CHECK(s.valid);
  // Zero IQR means zero-width fences, and every value sits exactly on them —
  // so nothing is an outlier and the box collapses to a line, which is right.
  CHECK_NEAR(s.q1, 4.0, 1e-12);
  CHECK_NEAR(s.q3, 4.0, 1e-12);
  CHECK_NEAR(s.whisker_lo, 4.0, 1e-12);
  CHECK_NEAR(s.whisker_hi, 4.0, 1e-12);
  CHECK(s.outliers.empty());
}

void test_empty_and_non_finite_input() {
  CHECK(!box_stats(nullptr, 0).valid);
  const double v[] = {1, 2, 3};
  CHECK(!box_stats(v, 0).valid);
  // A NaN in the samples must not turn the whole summary into NaN — the rest of
  // the group is perfectly good data.
  const double with_nan[] = {std::nan(""), 1, 2, 3, 4, 5};
  const auto s = box_stats(with_nan, 6);
  CHECK(s.valid);
  CHECK_NEAR(s.median, 3.0, 1e-12);
}

void test_the_density_integrates_to_one() {
  // Ten samples on a line. A KDE is a probability density, so the trapezoid
  // rule over a range that covers the mass should come back close to 1.
  std::vector<double> v;
  for (int i = 0; i < 10; ++i) v.push_back(static_cast<double>(i));
  const auto d = kde(v.data(), v.size(), -20.0, 30.0, 512);
  CHECK(d.xs.size() == 512);
  double area = 0.0;
  for (size_t i = 0; i + 1 < d.ys.size(); ++i) {
    area += (d.ys[i] + d.ys[i + 1]) * 0.5 * (d.xs[i + 1] - d.xs[i]);
  }
  CHECK_NEAR(area, 1.0, 0.01);
  for (const double y : d.ys) CHECK(y >= 0.0);
}

void test_the_density_peaks_where_the_data_is() {
  const double v[] = {5, 5, 5, 5, 5};
  const auto d = kde(v, 5, 0.0, 10.0, 101);
  size_t peak = 0;
  for (size_t i = 1; i < d.ys.size(); ++i) {
    if (d.ys[i] > d.ys[peak]) peak = i;
  }
  CHECK_NEAR(d.xs[peak], 5.0, 0.1);
}

}  // namespace

int main() {
  RUN(test_quantiles_interpolate_linearly);
  RUN(test_quantiles_of_degenerate_input);
  RUN(test_the_five_number_summary);
  RUN(test_outliers_stop_the_whiskers);
  RUN(test_the_input_order_does_not_matter);
  RUN(test_a_constant_group_has_no_spread);
  RUN(test_empty_and_non_finite_input);
  RUN(test_the_density_integrates_to_one);
  RUN(test_the_density_peaks_where_the_data_is);
  return TEST_MAIN_RESULT();
}
