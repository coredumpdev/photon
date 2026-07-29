// The embedded typeface and its signed-distance-field glyph cache.
//
// Two decisions worth stating, because both had a defensible alternative.
//
// **Signed distance fields, not coverage bitmaps.** A chart rotates text (the y
// axis title, rotated tick labels) and emboldens it (the plot title, where the
// web core asks for weight 600 and the subset only carries Regular). An SDF does
// both from one sample: rotation stays smooth because the field is resampled
// rather than the coverage, and weight is a constant added to the distance
// threshold. A coverage bitmap can do neither without re-rasterizing.
//
// **Rasterized at the device size, keyed by it.** The usual SDF trick is one
// atlas entry scaled to every size, which is where SDF text gets its reputation
// for soft corners at 12px. Keying the cache on the quantized device size costs
// a handful of extra entries — a chart uses two or three text sizes — and the
// field is then sampled at 1:1, where it reproduces the outline as sharply as a
// coverage bitmap would. A dpr change just adds entries; nothing is re-uploaded.
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

/// Forward-declared so stb_truetype.h stays out of every file that measures a
/// string. C++ gives struct types no separate C linkage, so this is the same
/// type stb defines.
struct stbtt_fontinfo;

namespace photon::text {

/// Side length of the square R8 atlas, in texels. One megabyte on the GPU.
constexpr int kAtlasSize = 1024;

/// SDF spread in glyph pixels either side of the outline. The shader's pxRange
/// is twice this — see kPxRange.
constexpr int kSdfPadding = 4;

/// Distance range the 0..255 texel values span, in glyph pixels.
constexpr float kPxRange = 2.0f * static_cast<float>(kSdfPadding);

/// One cached glyph. Offsets and sizes are in device pixels; uv is normalized.
struct Glyph {
  float u0 = 0.0f, v0 = 0.0f, u1 = 0.0f, v1 = 0.0f;
  /// Quad's top-left relative to the pen position on the baseline, y down.
  float left = 0.0f, top = 0.0f;
  float width = 0.0f, height = 0.0f;
  /// Pen advance, unrounded — rounding here is what makes long strings drift.
  float advance = 0.0f;
  /// Whitespace and unmapped codepoints: advance only, no quad.
  bool blank = true;
};

/**
 * The embedded Inter subset, its glyph cache and the CPU side of the atlas.
 *
 * Process-global and not thread-safe, like everything else behind the ABI: a
 * plot belongs to one thread and rendering happens there.
 */
class Font {
 public:
  /// The one instance. Parses the embedded face on first use.
  static Font& shared();

  /// False when the embedded face failed to parse — the text renderer then
  /// draws nothing rather than drawing garbage.
  bool ok() const { return ok_; }

  /**
   * Look up (rasterizing on demand) one glyph at `px`, the em size in device
   * pixels. Returns nullptr only when the embedded face failed to parse; a
   * full atlas yields a blank glyph that still advances the pen.
   */
  const Glyph* glyph(uint32_t codepoint, float px);

  /// Advance width of a UTF-8 string at `px`, kerning included, in device px.
  float measure(const std::string& utf8, float px);

  /// Kerning adjustment between two codepoints, in device pixels.
  float kerning(uint32_t left, uint32_t right, float px) const;

  /// Vertical metrics at `px`. ascent is positive, descent negative, y down.
  float ascent(float px) const { return ascent_ * scale_for(px); }
  float descent(float px) const { return descent_ * scale_for(px); }
  float line_height(float px) const { return (ascent_ - descent_ + line_gap_) * scale_for(px); }

  // -- atlas ---------------------------------------------------------------

  const unsigned char* pixels() const { return atlas_.data(); }
  /// Bumped whenever a glyph is added, so the GL side knows to re-upload.
  uint64_t revision() const { return revision_; }
  /// Rows [dirty_y0, dirty_y1) changed since the last clear_dirty().
  int dirty_y0() const { return dirty_y0_; }
  int dirty_y1() const { return dirty_y1_; }
  void clear_dirty() {
    dirty_y0_ = kAtlasSize;
    dirty_y1_ = 0;
  }
  /// Mark the whole atlas dirty — after a GL context is lost and recreated, so
  /// the glyphs already rasterized are re-uploaded instead of re-rasterized.
  void mark_all_dirty() {
    dirty_y0_ = 0;
    dirty_y1_ = kAtlasSize;
    ++revision_;
  }

  /// Decode one UTF-8 code point, advancing `i`. Invalid bytes yield U+FFFD.
  static uint32_t decode_utf8(const std::string& s, size_t& i);

 private:
  Font();
  ~Font();

  /// Em units to device pixels at size `px`.
  float scale_for(float px) const;
  /// Quantize a size to the cache's resolution — quarter pixels.
  static int size_key(float px);

  /// Reserve a `w` x `h` rect in the shelf packer. False when the atlas is full.
  bool pack(int w, int h, int& out_x, int& out_y);

  bool ok_ = false;
  std::unique_ptr<::stbtt_fontinfo> info_;
  /// Em units to pixels at size 1 — i.e. 1/unitsPerEm.
  float units_per_em_ = 0.001f;
  float ascent_ = 0.0f, descent_ = 0.0f, line_gap_ = 0.0f;

  /// (size_key << 32) | codepoint.
  std::unordered_map<uint64_t, Glyph> glyphs_;
  std::vector<unsigned char> atlas_;
  int shelf_x_ = 0, shelf_y_ = 0, shelf_height_ = 0;
  uint64_t revision_ = 1;
  int dirty_y0_ = kAtlasSize;
  int dirty_y1_ = 0;
};

}  // namespace photon::text
