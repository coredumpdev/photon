/*
 * The scale and tick port, checked against the assertions in the TypeScript
 * suite: packages/core/test/ticks.test.ts and packages/core/test/scales.test.ts.
 *
 * These are the *same* expectations, transcribed — not new ones invented for
 * C++. A tick that reads "1.0e+7" on the web and "1.0e+07" natively is a
 * user-visible divergence, and the axis is the part of a chart people read
 * numbers off.
 *
 * This links the sources directly rather than the shared library: Scale and the
 * tick helpers are internal, and the .so exports only ph_*.
 */

#include <string>

#include "axes/ticks.hpp"
#include "check.h"
#include "scale.hpp"

using photon::auto_ticks;
using photon::default_format;
using photon::Scale;
using photon::Tick;
using photon::with_minor_ticks;

namespace {

constexpr double kEps = 1e-9;

Scale linear(double lo, double hi) {
  Scale s;
  s.type = PH_SCALE_LINEAR;
  s.set_domain(lo, hi);
  return s;
}

Scale logarithmic(double lo, double hi) {
  Scale s;
  s.type = PH_SCALE_LOG;
  s.set_domain(lo, hi);
  return s;
}

Scale categorical(std::vector<std::string> factors) {
  Scale s;
  s.type = PH_SCALE_CATEGORICAL;
  s.factors = std::move(factors);
  s.set_band_domain(s.factors.size());
  return s;
}

Scale ordinal_time(std::vector<double> times) {
  Scale s;
  s.type = PH_SCALE_ORDINAL_TIME;
  s.times = std::move(times);
  s.set_band_domain(s.times.size());
  return s;
}

// -- ticks.test.ts ----------------------------------------------------------

void test_auto_ticks_produces_nice_round_values() {
  const std::vector<Tick> ticks = auto_ticks(0.0, 100.0);
  CHECK_EQ(ticks.size(), 6);
  const double expected[] = {0.0, 20.0, 40.0, 60.0, 80.0, 100.0};
  for (size_t i = 0; i < ticks.size() && i < 6; ++i) {
    CHECK_NEAR(ticks[i].value, expected[i], kEps);
    CHECK(!ticks[i].minor);
    CHECK(ticks[i].grid);
  }
}

void test_auto_ticks_handles_negatives_and_snaps_zero() {
  bool has_zero = false;
  for (const Tick& t : auto_ticks(-5.0, 5.0)) {
    if (t.value == 0.0) has_zero = true;  // exact: the snap must produce a clean 0
  }
  CHECK(has_zero);
}

void test_auto_ticks_rejects_degenerate_ranges() {
  CHECK_EQ(auto_ticks(3.0, 3.0).size(), 0);
  CHECK_EQ(auto_ticks(std::nan(""), 1.0).size(), 0);
  CHECK_EQ(auto_ticks(0.0, std::nan("")).size(), 0);
  CHECK_EQ(auto_ticks(-INFINITY, INFINITY).size(), 0);
}

void test_with_minor_ticks() {
  const std::vector<Tick> major = {Tick{0.0, "", false, true}, Tick{10.0, "", false, true}};
  const std::vector<Tick> all = with_minor_ticks(major, 4);
  CHECK_EQ(all.size(), 6);

  std::vector<double> minors;
  for (const Tick& t : all) {
    if (!t.minor) continue;
    minors.push_back(t.value);
    CHECK(!t.grid);  // minors never draw a grid line
  }
  CHECK_EQ(minors.size(), 4);
  const double expected[] = {2.0, 4.0, 6.0, 8.0};
  for (size_t i = 0; i < minors.size() && i < 4; ++i) CHECK_NEAR(minors[i], expected[i], kEps);

  // A single major has nothing to interpolate between.
  CHECK_EQ(with_minor_ticks({Tick{0.0, "", false, true}}, 4).size(), 1);
  CHECK_EQ(with_minor_ticks(major, 0).size(), 2);
}

void test_default_format() {
  CHECK_STR(default_format(0.0), "0");
  CHECK_STR(default_format(1234.5), "1234.5");

  // JS `toExponential(1)` prints the shortest exponent; C's `%e` pads to two
  // digits. The port normalizes, and this is the assertion that proves it.
  CHECK_STR(default_format(1e7), "1.0e+7");
  CHECK_STR(default_format(1e-5), "1.0e-5");
  CHECK_STR(default_format(-2.5e8), "-2.5e+8");

  // Inside [1e-4, 1e6) it is six significant digits with trailing zeros trimmed.
  CHECK_STR(default_format(0.3), "0.3");
  CHECK_STR(default_format(1.0), "1");
  CHECK_STR(default_format(0.0001), "0.0001");
  CHECK_STR(default_format(999999.0), "999999");
  CHECK_STR(default_format(-42.0), "-42");
}

// -- scales.test.ts ---------------------------------------------------------

void test_linear_scale() {
  const Scale s = linear(0.0, 10.0);
  CHECK_NEAR(s.norm(5.0), 0.5, kEps);
  CHECK_NEAR(s.invert(0.5), 5.0, kEps);
  CHECK(!s.is_log());
  CHECK_STR(s.format_tick(1234.5), "1234.5");
}

void test_log_scale_maps_decades_linearly() {
  const Scale s = logarithmic(1.0, 1000.0);
  CHECK_NEAR(s.norm(1.0), 0.0, kEps);
  CHECK_NEAR(s.norm(1000.0), 1.0, kEps);
  CHECK_NEAR(s.norm(10.0), 1.0 / 3.0, kEps);
  CHECK_NEAR(s.invert(1.0 / 3.0), 10.0, 1e-9);
  CHECK(s.is_log());
}

void test_log_scale_ticks() {
  const std::vector<Tick> ticks = logarithmic(1.0, 100.0).ticks();
  bool has1 = false, has10 = false, has100 = false, has_minor_50 = false;
  for (const Tick& t : ticks) {
    if (!t.minor) {
      if (std::fabs(t.value - 1.0) < kEps) has1 = true;
      if (std::fabs(t.value - 10.0) < kEps) has10 = true;
      if (std::fabs(t.value - 100.0) < kEps) has100 = true;
    } else if (std::fabs(t.value - 50.0) < kEps) {
      has_minor_50 = true;
      CHECK(!t.grid);
    }
  }
  CHECK(has1);
  CHECK(has10);
  CHECK(has100);
  CHECK(has_minor_50);
}

void test_log_scale_sanitizes_non_positive_bounds() {
  const Scale s = logarithmic(0.0, 100.0);
  CHECK(s.lo > 0.0);
  CHECK(s.hi > s.lo);
  // A negative lower bound is the same mistake and gets the same treatment.
  const Scale neg = logarithmic(-10.0, 100.0);
  CHECK(neg.lo > 0.0);
}

void test_log_scale_format_tick() {
  const Scale s = logarithmic(1.0, 1e9);
  CHECK_STR(s.format_tick(1e6), "1e6");   // |exponent| >= 5 -> compact form
  CHECK_STR(s.format_tick(1e-5), "1e-5");
  CHECK_STR(s.format_tick(100.0), "100");
}

void test_time_scale() {
  Scale s;
  s.type = PH_SCALE_TIME;
  s.set_domain(0.0, 1000.0);
  CHECK_NEAR(s.norm(500.0), 0.5, kEps);

  const double day = 86400000.0;
  s.set_domain(0.0, day);
  const std::vector<Tick> ticks = s.ticks();
  CHECK(!ticks.empty());
  for (const Tick& t : ticks) {
    CHECK(t.value >= 0.0);
    CHECK(t.value <= day);
  }
}

void test_categorical_scale() {
  const Scale s = categorical({"a", "b", "c"});
  CHECK_NEAR(s.lo, -0.5, kEps);
  CHECK_NEAR(s.hi, 2.5, kEps);
  CHECK(!s.is_log());

  // Factors sit at band centres.
  CHECK_NEAR(s.norm(0.0), 1.0 / 6.0, kEps);
  CHECK_NEAR(s.norm(1.0), 0.5, kEps);
  CHECK_NEAR(s.norm(2.0), 5.0 / 6.0, kEps);

  // invert stays continuous; rounding picks the nearest factor.
  CHECK_NEAR(s.invert(0.5), 1.0, kEps);
  CHECK_NEAR(s.invert(1.0 / 6.0), 0.0, kEps);
  CHECK_EQ(static_cast<long long>(std::lround(s.invert(0.83))), 2);

  const std::vector<Tick> ticks = s.ticks();
  CHECK_EQ(ticks.size(), 3);
  const char* labels[] = {"a", "b", "c"};
  for (size_t i = 0; i < ticks.size() && i < 3; ++i) {
    CHECK_NEAR(ticks[i].value, static_cast<double>(i), kEps);
    CHECK_STR(ticks[i].label, labels[i]);
    CHECK(!ticks[i].grid);  // a categorical axis draws no grid lines
  }

  CHECK_STR(s.format_tick(1.0), "b");
  CHECK_STR(s.format_tick(0.4), "a");
  CHECK_STR(s.format_tick(2.4), "c");
  // Out of range is empty, not a crash and not a clamp.
  CHECK_STR(s.format_tick(9.0), "");
  CHECK_STR(s.format_tick(-3.0), "");
}

void test_empty_categorical_scale() {
  const Scale s = categorical({});
  CHECK_NEAR(s.lo, -0.5, kEps);
  CHECK_NEAR(s.hi, 0.5, kEps);
  CHECK_EQ(s.ticks().size(), 0);
  CHECK_STR(s.format_tick(0.0), "");
}

void test_ordinal_time_scale() {
  const double DAY = 86400000.0;
  const double HOUR = 3600000.0;
  // Six bars over three calendar days, two per day, with big overnight gaps.
  const double base = 1704099600000.0;  // 2024-01-01T09:00:00Z
  const std::vector<double> times = {
      base, base + HOUR, base + DAY, base + DAY + HOUR, base + 2 * DAY, base + 2 * DAY + HOUR,
  };

  const Scale s = ordinal_time(times);
  CHECK_NEAR(s.lo, -0.5, kEps);
  CHECK_NEAR(s.hi, 5.5, kEps);
  CHECK(!s.is_log());

  // The point of the scale: gaps collapse. A wildly irregular series of the same
  // length maps every index to the same position.
  std::vector<double> irregular;
  for (const double k : {0.0, 1.0, 2.0, 100.0, 101.0, 5000.0}) irregular.push_back(base + k * HOUR);
  const Scale other = ordinal_time(irregular);
  for (int i = 0; i < 6; ++i) {
    CHECK_NEAR(s.norm(i), other.norm(i), kEps);
  }
  CHECK_NEAR(s.norm(0.0), 1.0 / 12.0, kEps);
  CHECK_NEAR(s.norm(2.0), (2.0 + 0.5) / 6.0, kEps);

  // Ticks land on integer indices inside the window and always carry a label.
  const std::vector<Tick> ticks = s.ticks();
  CHECK(!ticks.empty());
  for (const Tick& t : ticks) {
    CHECK_NEAR(t.value, std::floor(t.value), kEps);
    CHECK(t.value >= 0.0);
    CHECK(t.value <= 5.0);
    CHECK(!t.label.empty());
  }

  CHECK(!s.format_tick(0.0).empty());
  // Out-of-range indices clamp rather than read past the array.
  CHECK(!s.format_tick(-10.0).empty());
  CHECK(!s.format_tick(99.0).empty());
}

void test_empty_ordinal_time_scale() {
  const Scale s = ordinal_time({});
  CHECK_NEAR(s.lo, -0.5, kEps);
  CHECK_NEAR(s.hi, 0.5, kEps);
  CHECK_EQ(s.ticks().size(), 0);
  CHECK_STR(s.format_tick(0.0), "");
}

void test_ordinal_time_zoomed_into_one_period() {
  // Every bar inside the same minute: no calendar boundary exists to snap to,
  // and the fallback must still produce evenly spaced, labelled ticks rather
  // than nothing.
  const double base = 1704099600000.0;
  std::vector<double> times;
  for (int i = 0; i < 20; ++i) times.push_back(base + i * 100.0);  // 100ms apart

  const Scale s = ordinal_time(times);
  const std::vector<Tick> ticks = s.ticks();
  CHECK(!ticks.empty());
  for (const Tick& t : ticks) CHECK(!t.label.empty());
}

}  // namespace

int main() {
  RUN(test_auto_ticks_produces_nice_round_values);
  RUN(test_auto_ticks_handles_negatives_and_snaps_zero);
  RUN(test_auto_ticks_rejects_degenerate_ranges);
  RUN(test_with_minor_ticks);
  RUN(test_default_format);
  RUN(test_linear_scale);
  RUN(test_log_scale_maps_decades_linearly);
  RUN(test_log_scale_ticks);
  RUN(test_log_scale_sanitizes_non_positive_bounds);
  RUN(test_log_scale_format_tick);
  RUN(test_time_scale);
  RUN(test_categorical_scale);
  RUN(test_empty_categorical_scale);
  RUN(test_ordinal_time_scale);
  RUN(test_empty_ordinal_time_scale);
  RUN(test_ordinal_time_zoomed_into_one_period);
  return TEST_MAIN_RESULT();
}
