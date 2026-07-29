/*
 * The colormap and palette port, checked against the numbers the TypeScript
 * actually produces.
 *
 * Every expected value below was printed by `colormap(name)(t)` from
 * packages/core/dist — not derived by hand from the anchors, because the whole
 * risk here is that the sampling differs by one step and produces a colour that
 * still looks like viridis. A heatmap's meaning is its colours; "close enough"
 * is a different chart.
 */

#include <cmath>
#include <string>
#include <vector>

#include "check.h"
#include "color/colormap.hpp"

using photon::color::Rgb;
using photon::color::Spec;

namespace {

void check_at(const char* name, double t, double r, double g, double b) {
  Spec spec;
  spec.name = name;
  const Rgb c = photon::color::sample(spec, t);
  CHECK_NEAR(static_cast<double>(c.r), r, 1e-5);
  CHECK_NEAR(static_cast<double>(c.g), g, 1e-5);
  CHECK_NEAR(static_cast<double>(c.b), b, 1e-5);
}

void test_viridis_matches_the_web() {
  check_at("viridis", 0.0, 0.267000, 0.005000, 0.329000);
  check_at("viridis", 0.25, 0.231882, 0.315353, 0.540824);
  check_at("viridis", 0.5, 0.128706, 0.565118, 0.551137);
  check_at("viridis", 0.75, 0.370431, 0.784294, 0.380706);
  check_at("viridis", 1.0, 0.993000, 0.906000, 0.144000);
}

void test_the_other_families_match_too() {
  // One sequential with an odd anchor count, one diverging, one cyclic, and the
  // two-anchor case — the four shapes the interpolation has to get right.
  check_at("turbo", 0.25, 0.109176, 0.775882, 0.826176);
  check_at("coolwarm", 0.5, 0.867490, 0.868588, 0.870863);
  check_at("twilight", 0.75, 0.604275, 0.251078, 0.311196);
  check_at("grayscale", 0.25, 0.272353, 0.272353, 0.272353);
  // A cyclic map has to close: its two ends are the same colour.
  check_at("twilight", 0.0, 0.886000, 0.851000, 0.887000);
  check_at("twilight", 1.0, 0.886000, 0.851000, 0.887000);
}

void test_out_of_range_clamps() {
  Spec spec;
  spec.name = "viridis";
  const Rgb low = photon::color::sample(spec, -5.0);
  const Rgb high = photon::color::sample(spec, 5.0);
  CHECK_NEAR(static_cast<double>(low.r), 0.267, 1e-5);
  CHECK_NEAR(static_cast<double>(high.r), 0.993, 1e-5);
  // NaN is not clamped by a comparison, so it must not index out of the table.
  const Rgb nan = photon::color::sample(spec, std::nan(""));
  CHECK(std::isfinite(nan.r) && std::isfinite(nan.g) && std::isfinite(nan.b));
}

void test_an_unknown_name_is_viridis() {
  check_at("no-such-colormap", 0.5, 0.128706, 0.565118, 0.551137);
  check_at("", 0.5, 0.128706, 0.565118, 0.551137);
}

void test_reverse_and_discrete() {
  Spec reversed;
  reversed.name = "viridis";
  reversed.reverse = true;
  const Rgb c = photon::color::sample(reversed, 0.25);
  CHECK_NEAR(static_cast<double>(c.r), 0.378706, 1e-5);
  CHECK_NEAR(static_cast<double>(c.g), 0.787118, 1e-5);
  CHECK_NEAR(static_cast<double>(c.b), 0.375882, 1e-5);

  Spec banded;
  banded.name = "viridis";
  banded.discrete_steps = 5;
  const Rgb b = photon::color::sample(banded, 0.3);
  CHECK_NEAR(static_cast<double>(b.r), 0.231882, 1e-5);
  CHECK_NEAR(static_cast<double>(b.g), 0.315353, 1e-5);
  CHECK_NEAR(static_cast<double>(b.b), 0.540824, 1e-5);

  // Anything inside a band is that band's colour — that is what discrete means,
  // and it is the property a reader matching a colour to a legend relies on.
  const Rgb same = photon::color::sample(banded, 0.39);
  CHECK_NEAR(static_cast<double>(same.r), static_cast<double>(b.r), 1e-6);

  Spec one;
  one.name = "viridis";
  one.discrete_steps = 1;
  const Rgb flat = photon::color::sample(one, 0.0);
  const Rgb flat_hi = photon::color::sample(one, 1.0);
  CHECK_NEAR(static_cast<double>(flat.r), static_cast<double>(flat_hi.r), 1e-6);
}

void test_inline_stops() {
  Spec spec;
  spec.stops = {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}};
  // 0.5 lands on sample 127 of 255, not on 128 — the index truncates, which is
  // what the TypeScript's `| 0` does and is why this is 0.498 and not 0.502.
  const Rgb mid = photon::color::sample(spec, 0.5);
  CHECK_NEAR(static_cast<double>(mid.r), 127.0 / 255.0, 1e-5);
  CHECK_NEAR(static_cast<double>(mid.g), static_cast<double>(mid.r), 1e-9);
  // Stops win over the name, so a spec carrying both is not ambiguous.
  spec.name = "turbo";
  const Rgb still = photon::color::sample(spec, 0.0);
  CHECK_NEAR(static_cast<double>(still.r), 0.0, 1e-6);
}

void test_registration() {
  CHECK(!photon::color::register_colormap("too-short", {{0.0f, 0.0f, 0.0f}}));
  CHECK(!photon::color::register_colormap("", {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}}));
  CHECK(photon::color::register_colormap("test-ramp",
                                         {{1.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f}}));
  check_at("test-ramp", 0.0, 1.0, 0.0, 0.0);
  check_at("test-ramp", 1.0, 0.0, 0.0, 1.0);

  const std::vector<std::string> names = photon::color::colormap_names();
  CHECK(names.size() >= 13);
  CHECK(names[0] == "viridis");
  bool found = false;
  for (const std::string& name : names) {
    if (name == "test-ramp") found = true;
  }
  CHECK(found);

  // Re-registering replaces rather than appends — and the cached table has to
  // notice, or the old colours outlive the registration.
  const size_t before = names.size();
  CHECK(photon::color::register_colormap("test-ramp",
                                         {{0.0f, 1.0f, 0.0f}, {0.0f, 1.0f, 0.0f}}));
  CHECK(photon::color::colormap_names().size() == before);
  check_at("test-ramp", 0.5, 0.0, 1.0, 0.0);
}

void test_symmetric_domain() {
  const double values[] = {-2.0, 1.0, 7.0};
  const ph_range domain = photon::color::symmetric_domain(values, 3, 0.0);
  CHECK_NEAR(domain.lo, -7.0, 1e-12);
  CHECK_NEAR(domain.hi, 7.0, 1e-12);

  const double flat[] = {3.0, 3.0, 3.0};
  const ph_range around = photon::color::symmetric_domain(flat, 3, 3.0);
  // Zero reach would be an empty domain, which no scale can use.
  CHECK_NEAR(around.lo, 2.0, 1e-12);
  CHECK_NEAR(around.hi, 4.0, 1e-12);

  const ph_range empty = photon::color::symmetric_domain(nullptr, 0, 5.0);
  CHECK_NEAR(empty.lo, 4.0, 1e-12);
  CHECK_NEAR(empty.hi, 6.0, 1e-12);
}

void test_palettes() {
  CHECK(photon::color::palette_color("tableau10", 0) == 0x4e79a7ffu);
  // Cycling in both directions: index 10 and index -10 of a ten-colour palette
  // are both the first colour.
  CHECK(photon::color::palette_color("tableau10", 10) == 0x4e79a7ffu);
  CHECK(photon::color::palette_color("tableau10", -10) == 0x4e79a7ffu);
  CHECK(photon::color::palette_color("tableau10", -1) ==
        photon::color::palette_color("tableau10", 9));
  CHECK(photon::color::palette_color("okabe-ito", 0) == 0x0072b2ffu);
  CHECK(photon::color::palette_color("no-such-palette", 0) == 0x4e79a7ffu);

  CHECK(!photon::color::register_palette("empty", {}));
  CHECK(photon::color::register_palette("test-two", {0x010203ffu, 0x040506ffu}));
  CHECK(photon::color::palette_color("test-two", 3) == 0x040506ffu);

  const std::vector<std::string> names = photon::color::palette_names();
  CHECK(names.size() >= 5);
  CHECK(names[0] == "tableau10");
}

}  // namespace

int main() {
  RUN(test_viridis_matches_the_web);
  RUN(test_the_other_families_match_too);
  RUN(test_out_of_range_clamps);
  RUN(test_an_unknown_name_is_viridis);
  RUN(test_reverse_and_discrete);
  RUN(test_inline_stops);
  RUN(test_registration);
  RUN(test_symmetric_domain);
  RUN(test_palettes);
  return TEST_MAIN_RESULT();
}
