// Font metrics, UTF-8 decoding and the glyph cache.
//
// This test exists because measure() decides the axis margins, which decide the
// plot region, which decides where every single thing on the chart is drawn. A
// silent regression in text metrics is a silent regression in the whole layout,
// so a few widths are pinned outright: if the embedded face is ever replaced,
// this is the test that says so.

#include <cstdio>
#include <string>
#include <vector>

#include "check.h"
#include "text/font.hpp"
#include "text/text.hpp"

using photon::text::Font;
using photon::text::Glyph;

namespace {

float width(const char* s, float px = 12.0f) {
  return photon::text::measure(s, px);
}

/// The same walk measure() does, spelled out: advance per glyph plus the kern
/// between each pair. Used to check measure() against its own definition.
float sum_of_parts(const std::string& s, float px = 12.0f) {
  Font& font = Font::shared();
  float total = 0.0f;
  uint32_t previous = 0;
  size_t i = 0;
  while (i < s.size()) {
    const uint32_t cp = Font::decode_utf8(s, i);
    if (previous != 0) total += font.kerning(previous, cp, px);
    total += font.glyph(cp, px)->advance;
    previous = cp;
  }
  return total;
}

void test_the_embedded_face_parses() {
  CHECK(Font::shared().ok());
  // Inter's metrics at 12px: an ascent close to the em size, a negative descent.
  const float ascent = Font::shared().ascent(12.0f);
  const float descent = Font::shared().descent(12.0f);
  CHECK(ascent > 9.0f && ascent < 14.0f);
  CHECK(descent < 0.0f && descent > -5.0f);
  CHECK(Font::shared().line_height(12.0f) > ascent - descent - 0.001f);
}

void test_measure_is_pinned() {
  // The numbers below come from the committed Inter subset at 12px, held to a
  // tenth of a pixel: tight enough to catch a different font or a broken scale,
  // loose enough that a rounding change inside stb does not fail the build.
  CHECK_NEAR(width("0"), 7.570f, 0.1f);
  CHECK_NEAR(width("1"), 4.881f, 0.1f);
  CHECK_NEAR(width("-12.5"), 28.295f, 0.15f);
  CHECK_NEAR(width("1.0e+7"), 37.635f, 0.2f);
  CHECK_EQ(width(""), 0.0f);
}

void test_measure_scales_with_size() {
  // Advances come from the font's own units, so twice the size is exactly twice
  // the width — the quarter-pixel cache key must not disturb that.
  const float small = width("2024-03-15", 12.0f);
  const float large = width("2024-03-15", 24.0f);
  CHECK_NEAR(large, small * 2.0f, 0.01f);
}

void test_a_string_is_the_sum_of_its_glyphs() {
  // Inter's figures are proportional, not tabular — the subset drops GSUB, so
  // the `tnum` feature is not there to ask for, and stb_truetype would not
  // apply it anyway. That matches system-ui on the web, where the digits are
  // proportional too, and it is exactly why every label is measured rather than
  // estimated from a character count.
  CHECK(width("1") < width("0") - 1.0f);

  const char* labels[] = {"123", "2024-03-15", "-12.5", "1.0e+7", "σ = 0.42"};
  for (const char* label : labels) {
    CHECK_NEAR(width(label), sum_of_parts(label), 0.001f);
  }
}

void test_kerning_is_live() {
  // The subset keeps GPOS's kern feature specifically so this holds; Inter has
  // no legacy `kern` table, so dropping GPOS would silently disable kerning and
  // nothing but a test like this would notice.
  const float kern = Font::shared().kerning('A', 'V', 12.0f);
  CHECK(kern < -0.2f);  // the pair pulls together, and by a visible amount
  CHECK_NEAR(width("AV"), width("A") + width("V") + kern, 0.001f);
  // Kerning scales with the size like everything else.
  CHECK_NEAR(Font::shared().kerning('A', 'V', 24.0f), kern * 2.0f, 0.001f);
}

void test_the_subset_covers_what_charts_need() {
  Font& font = Font::shared();
  // Turkish, Greek, a true minus and a few maths symbols: the reason the subset
  // is 418 code points rather than plain ASCII.
  const char* strings[] = {"ğışİĞŞ", "σμΔπ", "−≤×", "₺€", "10⁻³"};
  for (const char* s : strings) {
    CHECK(width(s) > 0.0f);
    std::string text(s);
    size_t i = 0;
    while (i < text.size()) {
      const uint32_t cp = Font::decode_utf8(text, i);
      const Glyph* glyph = font.glyph(cp, 12.0f);
      CHECK(glyph != nullptr);
      CHECK(!glyph->blank);  // a missing glyph would rasterize as nothing
    }
  }
}

void test_whitespace_advances_without_a_quad() {
  const Glyph* space = Font::shared().glyph(' ', 12.0f);
  CHECK(space != nullptr);
  CHECK(space->blank);
  CHECK(space->advance > 1.0f);
  CHECK_NEAR(width("a b"), width("ab") + space->advance, 0.001f);
}

void test_utf8_decoding() {
  struct Case {
    const char* input;
    uint32_t expected;
    size_t consumed;
  };
  const Case cases[] = {
      {"A", 0x41u, 1},
      {"\xC3\xA9", 0xE9u, 2},           // é
      {"\xC4\x9F", 0x11Fu, 2},          // ğ
      {"\xE2\x88\x92", 0x2212u, 3},     // − (true minus)
      {"\xF0\x9F\x93\x88", 0x1F4C8u, 4},// 📈, outside the subset but decodable
      // Malformed input yields U+FFFD and consumes exactly one byte, so a
      // truncated string can never spin the caller's loop.
      {"\xC3", 0xFFFDu, 1},
      {"\x80", 0xFFFDu, 1},
      {"\xE2\x88", 0xFFFDu, 1},
  };
  for (const Case& c : cases) {
    std::string s(c.input);
    size_t i = 0;
    const uint32_t cp = Font::decode_utf8(s, i);
    CHECK_EQ(cp, c.expected);
    CHECK_EQ(i, c.consumed);
  }

  // Every byte of a mixed string is consumed, in order.
  std::string mixed = "a\xC4\xB1\xE2\x89\xA4z";  // a, ı, ≤, z
  std::vector<uint32_t> points;
  size_t i = 0;
  while (i < mixed.size()) points.push_back(Font::decode_utf8(mixed, i));
  CHECK_EQ(points.size(), size_t{4});
  CHECK_EQ(points[0], uint32_t{'a'});
  CHECK_EQ(points[1], uint32_t{0x131});
  CHECK_EQ(points[2], uint32_t{0x2264});
  CHECK_EQ(points[3], uint32_t{'z'});
}

void test_the_atlas_fills_lazily() {
  Font& font = Font::shared();
  const uint64_t before = font.revision();
  // A code point nothing above has asked for, at a size nothing has used.
  CHECK(font.glyph('Q', 31.0f) != nullptr);
  CHECK(font.revision() > before);
  // Asking again is a cache hit and changes nothing.
  const uint64_t after = font.revision();
  CHECK(font.glyph('Q', 31.0f) != nullptr);
  CHECK_EQ(font.revision(), after);
}

}  // namespace

int main() {
  RUN(test_the_embedded_face_parses);
  RUN(test_measure_is_pinned);
  RUN(test_measure_scales_with_size);
  RUN(test_a_string_is_the_sum_of_its_glyphs);
  RUN(test_kerning_is_live);
  RUN(test_the_subset_covers_what_charts_need);
  RUN(test_whitespace_advances_without_a_quad);
  RUN(test_utf8_decoding);
  RUN(test_the_atlas_fills_lazily);
  return TEST_MAIN_RESULT();
}
