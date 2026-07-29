#include "text/font.hpp"

#include <algorithm>
#include <cstring>

#include <stb_truetype.h>

namespace photon::text {

// Generated at build time from third_party/fonts/Inter-Regular-subset.ttf by
// cmake/embed_binary.cmake. Declared here rather than in a header because these
// two symbols are the whole interface to it.
extern const unsigned char kInterRegular[];
extern const std::size_t kInterRegular_size;

namespace {

/// Value a texel takes exactly on the outline. Distances run either side of it.
constexpr unsigned char kOnEdge = 128;

/// Texel units per glyph pixel of distance, so ±kSdfPadding fills 0..255.
constexpr float kDistScale = static_cast<float>(kOnEdge) / static_cast<float>(kSdfPadding);

/// One texel of empty space between packed glyphs, so linear sampling at a
/// quad's edge cannot pick up its neighbour.
constexpr int kGutter = 1;

}  // namespace

Font& Font::shared() {
  static Font instance;
  return instance;
}

Font::Font() : info_(std::make_unique<stbtt_fontinfo>()) {
  if (kInterRegular_size == 0 ||
      !stbtt_InitFont(info_.get(), kInterRegular, stbtt_GetFontOffsetForIndex(kInterRegular, 0))) {
    return;
  }

  // ScaleForMappingEmToPixels(1) is 1/unitsPerEm — the CSS font-size convention,
  // where "12px" sets the em square rather than the ascent-to-descent height.
  units_per_em_ = stbtt_ScaleForMappingEmToPixels(info_.get(), 1.0f);

  int ascent = 0, descent = 0, line_gap = 0;
  stbtt_GetFontVMetrics(info_.get(), &ascent, &descent, &line_gap);
  ascent_ = static_cast<float>(ascent);
  descent_ = static_cast<float>(descent);
  line_gap_ = static_cast<float>(line_gap);

  atlas_.assign(static_cast<size_t>(kAtlasSize) * kAtlasSize, 0);
  ok_ = true;
}

Font::~Font() = default;

float Font::scale_for(float px) const {
  return px * units_per_em_;
}

int Font::size_key(float px) {
  // Quarter-pixel buckets. Fine enough that a dpr of 1.25 or 1.5 gets its own
  // crisp raster, coarse enough that a resize does not fill the atlas.
  const int key = static_cast<int>(px * 4.0f + 0.5f);
  return std::max(1, key);
}

bool Font::pack(int w, int h, int& out_x, int& out_y) {
  if (w > kAtlasSize) return false;
  if (shelf_x_ + w > kAtlasSize) {  // start a new shelf
    shelf_y_ += shelf_height_ + kGutter;
    shelf_x_ = 0;
    shelf_height_ = 0;
  }
  if (shelf_y_ + h > kAtlasSize) return false;
  out_x = shelf_x_;
  out_y = shelf_y_;
  shelf_x_ += w + kGutter;
  shelf_height_ = std::max(shelf_height_, h);
  return true;
}

const Glyph* Font::glyph(uint32_t codepoint, float px) {
  if (!ok_) return nullptr;
  const int key = size_key(px);
  const uint64_t id = (static_cast<uint64_t>(key) << 32) | codepoint;
  const auto hit = glyphs_.find(id);
  if (hit != glyphs_.end()) return &hit->second;

  const float size = static_cast<float>(key) / 4.0f;
  const float scale = scale_for(size);

  Glyph g;
  int advance = 0, lsb = 0;
  stbtt_GetCodepointHMetrics(info_.get(), static_cast<int>(codepoint), &advance, &lsb);
  g.advance = static_cast<float>(advance) * scale;

  int w = 0, h = 0, xoff = 0, yoff = 0;
  unsigned char* bitmap =
      stbtt_GetCodepointSDF(info_.get(), scale, static_cast<int>(codepoint), kSdfPadding, kOnEdge,
                            kDistScale, &w, &h, &xoff, &yoff);
  if (bitmap && w > 0 && h > 0) {
    int ax = 0, ay = 0;
    if (!pack(w, h, ax, ay)) {
      // The atlas is full. Cache the blank so the failed raster is not retried
      // sixty times a second; the glyph is simply not drawn.
      stbtt_FreeSDF(bitmap, nullptr);
      return &(glyphs_[id] = g);
    }
    for (int row = 0; row < h; ++row) {
      std::memcpy(atlas_.data() + static_cast<size_t>(ay + row) * kAtlasSize +
                      static_cast<size_t>(ax),
                  bitmap + static_cast<size_t>(row) * static_cast<size_t>(w),
                  static_cast<size_t>(w));
    }
    dirty_y0_ = std::min(dirty_y0_, ay);
    dirty_y1_ = std::max(dirty_y1_, ay + h);
    ++revision_;

    constexpr float kInv = 1.0f / static_cast<float>(kAtlasSize);
    g.u0 = static_cast<float>(ax) * kInv;
    g.v0 = static_cast<float>(ay) * kInv;
    g.u1 = static_cast<float>(ax + w) * kInv;
    g.v1 = static_cast<float>(ay + h) * kInv;
    g.left = static_cast<float>(xoff);
    g.top = static_cast<float>(yoff);
    g.width = static_cast<float>(w);
    g.height = static_cast<float>(h);
    g.blank = false;
  }
  if (bitmap) stbtt_FreeSDF(bitmap, nullptr);
  return &(glyphs_[id] = g);
}

float Font::kerning(uint32_t left, uint32_t right, float px) const {
  if (!ok_) return 0.0f;
  const int kern = stbtt_GetCodepointKernAdvance(info_.get(), static_cast<int>(left),
                                                 static_cast<int>(right));
  if (kern == 0) return 0.0f;
  // Quantized to the same grid the glyph was rasterized on, so measure() and
  // draw() step the pen identically.
  const float size = static_cast<float>(size_key(px)) / 4.0f;
  return static_cast<float>(kern) * scale_for(size);
}

float Font::measure(const std::string& utf8, float px) {
  if (!ok_ || utf8.empty()) return 0.0f;
  float width = 0.0f;
  uint32_t previous = 0;
  size_t i = 0;
  while (i < utf8.size()) {
    const uint32_t cp = decode_utf8(utf8, i);
    if (previous != 0) width += kerning(previous, cp, px);
    const Glyph* g = glyph(cp, px);
    if (g) width += g->advance;
    previous = cp;
  }
  return width;
}

uint32_t Font::decode_utf8(const std::string& s, size_t& i) {
  const auto byte = [&](size_t k) { return static_cast<unsigned char>(s[k]); };
  const unsigned char c = byte(i);
  // Every malformed sequence yields U+FFFD and consumes exactly one byte, so a
  // truncated string can never spin the caller's loop.
  constexpr uint32_t kReplacement = 0xFFFDu;

  if (c < 0x80) {
    ++i;
    return c;
  }
  const auto cont = [&](size_t k) { return k < s.size() && (byte(k) & 0xC0) == 0x80; };
  if ((c & 0xE0) == 0xC0 && cont(i + 1)) {
    const uint32_t cp = (static_cast<uint32_t>(c & 0x1Fu) << 6) | (byte(i + 1) & 0x3Fu);
    i += 2;
    return cp < 0x80 ? kReplacement : cp;
  }
  if ((c & 0xF0) == 0xE0 && cont(i + 1) && cont(i + 2)) {
    const uint32_t cp = (static_cast<uint32_t>(c & 0x0Fu) << 12) |
                        (static_cast<uint32_t>(byte(i + 1) & 0x3Fu) << 6) | (byte(i + 2) & 0x3Fu);
    i += 3;
    return cp < 0x800 ? kReplacement : cp;
  }
  if ((c & 0xF8) == 0xF0 && cont(i + 1) && cont(i + 2) && cont(i + 3)) {
    const uint32_t cp = (static_cast<uint32_t>(c & 0x07u) << 18) |
                        (static_cast<uint32_t>(byte(i + 1) & 0x3Fu) << 12) |
                        (static_cast<uint32_t>(byte(i + 2) & 0x3Fu) << 6) | (byte(i + 3) & 0x3Fu);
    i += 4;
    return (cp < 0x10000 || cp > 0x10FFFF) ? kReplacement : cp;
  }
  ++i;
  return kReplacement;
}

}  // namespace photon::text
