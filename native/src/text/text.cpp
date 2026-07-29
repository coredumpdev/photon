#include "text/text.hpp"

#include <cmath>
#include <cstdint>

#include "gl/program.hpp"
#include "text/font.hpp"

namespace photon::text {
namespace {

using namespace photon::gl;

constexpr int kFloatsPerVertex = 9;

const char* const kVert = R"(#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aBold;
uniform vec2 uPixelScale;
uniform vec2 uPixelOffset;
out vec2 vUv;
out vec4 vColor;
out float vBold;

void main() {
  vUv = aUv;
  vColor = aColor;
  vBold = aBold;
  gl_Position = vec4(aPos * uPixelScale + uPixelOffset, 0.0, 1.0);
})";

// The canonical distance-field resolve: convert the sampled distance into screen
// pixels using the uv derivative, then take a one-pixel-wide linear ramp across
// the outline. Doing it from the derivative rather than a uniform is what keeps
// rotated and non-uniformly scaled text as clean as upright text.
const char* const kFrag = R"(#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
in float vBold;
uniform sampler2D uAtlas;
uniform float uPxRange;
out vec4 outColor;

void main() {
  vec2 unitRange = vec2(uPxRange) / vec2(textureSize(uAtlas, 0));
  vec2 screenTexSize = vec2(1.0) / fwidth(vUv);
  float range = max(0.5 * dot(unitRange, screenTexSize), 1.0);
  float distance = texture(uAtlas, vUv).r - 0.5;
  float alpha = clamp(range * distance + 0.5 + vBold, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  outColor = vec4(vColor.rgb * vColor.a * alpha, vColor.a * alpha);
})";

/**
 * The one atlas texture, shared by every plot.
 *
 * Process-global for the same reason the program cache is: there is one GL
 * context, and a per-plot atlas would rasterize the digits 0-9 once per chart on
 * a page holding twenty of them.
 */
struct AtlasTexture {
  GLuint id = 0;
  uint64_t uploaded_revision = 0;
};

AtlasTexture& atlas() {
  static AtlasTexture instance;
  return instance;
}

/// Create the texture if needed and push whatever rows the font has added.
void sync_atlas(Api& api) {
  Font& font = Font::shared();
  AtlasTexture& tex = atlas();

  if (tex.id == 0) {
    api.GenTextures(1, &tex.id);
    api.BindTexture(GL_TEXTURE_2D, tex.id);
    api.TexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(GL_R8), kAtlasSize, kAtlasSize, 0, GL_RED,
                   GL_UNSIGNED_BYTE, nullptr);
    api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, static_cast<GLint>(GL_LINEAR));
    api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, static_cast<GLint>(GL_LINEAR));
    api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, static_cast<GLint>(GL_CLAMP_TO_EDGE));
    api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, static_cast<GLint>(GL_CLAMP_TO_EDGE));
    tex.uploaded_revision = 0;
  } else {
    api.BindTexture(GL_TEXTURE_2D, tex.id);
  }

  if (tex.uploaded_revision == font.revision()) return;
  const int y0 = font.dirty_y0();
  const int y1 = font.dirty_y1();
  if (y1 > y0) {
    // Whole rows, not the exact glyph rectangles: one upload of a few kilobytes
    // beats one call per glyph, and new glyphs cluster into the same shelf.
    api.PixelStorei(GL_UNPACK_ALIGNMENT, 1);
    api.TexSubImage2D(GL_TEXTURE_2D, 0, 0, y0, kAtlasSize, y1 - y0, GL_RED, GL_UNSIGNED_BYTE,
                      font.pixels() + static_cast<size_t>(y0) * kAtlasSize);
  }
  font.clear_dirty();
  tex.uploaded_revision = font.revision();
}

}  // namespace

float measure(const std::string& utf8, float px) {
  return Font::shared().measure(utf8, px);
}

void Batch::add(const std::string& utf8, float x, float y, Align align, Baseline baseline,
                const Style& style) {
  Font& font = Font::shared();
  if (!font.ok() || utf8.empty() || !style.color.visible() || style.px <= 0.0f) return;

  float pen_x = 0.0f;
  switch (align) {
    case Align::Left: break;
    case Align::Center: pen_x = -0.5f * font.measure(utf8, style.px); break;
    case Align::Right: pen_x = -font.measure(utf8, style.px); break;
  }

  // Canvas2D's baselines, expressed against the font's vertical metrics: "top"
  // sits the ascent above the baseline, "bottom" the descent below it, "middle"
  // splits the difference. Browsers do the same thing with the same numbers.
  float pen_y = 0.0f;
  switch (baseline) {
    case Baseline::Alphabetic: break;
    case Baseline::Top: pen_y = font.ascent(style.px); break;
    case Baseline::Middle: pen_y = 0.5f * (font.ascent(style.px) + font.descent(style.px)); break;
    case Baseline::Bottom: pen_y = font.descent(style.px); break;
  }

  const bool upright = style.rotation == 0.0f;
  const float cos_r = upright ? 1.0f : std::cos(style.rotation);
  const float sin_r = upright ? 0.0f : std::sin(style.rotation);
  // Upright text lands on the pixel grid the glyph was rasterized on, which is
  // the whole reason the atlas is keyed by device size. Rotated text cannot, and
  // does not need to — the field resolves a fractional offset correctly.
  const float ax = upright ? std::round(x) : x;
  const float ay = upright ? std::round(y) : y;

  uint32_t previous = 0;
  size_t i = 0;
  while (i < utf8.size()) {
    const uint32_t cp = Font::decode_utf8(utf8, i);
    if (previous != 0) pen_x += font.kerning(previous, cp, style.px);
    previous = cp;

    const Glyph* g = font.glyph(cp, style.px);
    if (!g) break;  // the atlas is full; the rest of this run is dropped
    if (!g->blank) {
      const float x0 = pen_x + g->left;
      const float y0 = pen_y + g->top;
      const float x1 = x0 + g->width;
      const float y1 = y0 + g->height;

      const float cx[4] = {x0, x1, x1, x0};
      const float cy[4] = {y0, y0, y1, y1};
      const float cu[4] = {g->u0, g->u1, g->u1, g->u0};
      const float cv[4] = {g->v0, g->v0, g->v1, g->v1};

      static const int kOrder[6] = {0, 1, 2, 0, 2, 3};
      for (const int k : kOrder) {
        vertices_.push_back(ax + cx[k] * cos_r - cy[k] * sin_r);
        vertices_.push_back(ay + cx[k] * sin_r + cy[k] * cos_r);
        vertices_.push_back(cu[k]);
        vertices_.push_back(cv[k]);
        vertices_.push_back(style.color.r);
        vertices_.push_back(style.color.g);
        vertices_.push_back(style.color.b);
        vertices_.push_back(style.color.a);
        vertices_.push_back(style.bold);
      }
    }
    pen_x += g->advance;
  }
}

bool Batch::ensure_gl(Api& api, std::string& error) {
  if (vao_ != 0) return true;
  api.GenVertexArrays(1, &vao_);
  api.GenBuffers(1, &buffer_);
  if (vao_ == 0 || buffer_ == 0) {
    error = "failed to create the text vertex array";
    return false;
  }
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  const GLsizei stride = kFloatsPerVertex * static_cast<GLsizei>(sizeof(float));
  const auto at = [](size_t index) { return reinterpret_cast<const void*>(index * sizeof(float)); };
  api.EnableVertexAttribArray(0);
  api.VertexAttribPointer(0, 2, GL_FLOAT, 0, stride, at(0));
  api.EnableVertexAttribArray(1);
  api.VertexAttribPointer(1, 2, GL_FLOAT, 0, stride, at(2));
  api.EnableVertexAttribArray(2);
  api.VertexAttribPointer(2, 4, GL_FLOAT, 0, stride, at(4));
  api.EnableVertexAttribArray(3);
  api.VertexAttribPointer(3, 1, GL_FLOAT, 0, stride, at(8));
  api.BindVertexArray(0);
  return true;
}

bool Batch::flush(Api& api, ph_gfx_api gfx, const PixelTransform& transform, std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = {"uPixelScale", "uPixelOffset", "uAtlas",
                                                     "uPxRange"};
  const Program* program = get_program(api, "text", kVert, kFrag, kUniforms, gfx, error);
  if (!program) return false;

  sync_atlas(api);

  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  const size_t bytes = vertices_.size() * sizeof(float);
  // Orphan-and-refill while the buffer is big enough; only grow reallocates.
  if (bytes > capacity_) {
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(bytes), vertices_.data(),
                   GL_DYNAMIC_DRAW);
    capacity_ = bytes;
  } else {
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(capacity_), nullptr, GL_DYNAMIC_DRAW);
    api.BufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(bytes), vertices_.data());
  }

  api.UseProgram(program->id);
  api.Uniform2f(program->uniform("uPixelScale"), transform.sx, transform.sy);
  api.Uniform2f(program->uniform("uPixelOffset"), transform.ox, transform.oy);
  api.ActiveTexture(GL_TEXTURE0);
  api.BindTexture(GL_TEXTURE_2D, atlas().id);
  api.Uniform1i(program->uniform("uAtlas"), 0);
  api.Uniform1f(program->uniform("uPxRange"), kPxRange);

  const GLsizei count = static_cast<GLsizei>(vertices_.size() / kFloatsPerVertex);
  api.DrawArrays(GL_TRIANGLES, 0, count);
  api.BindVertexArray(0);
  vertices_.clear();
  return true;
}

void Batch::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  capacity_ = 0;
}

void release_atlas_gl(Api& api) {
  AtlasTexture& tex = atlas();
  if (tex.id == 0) return;
  api.DeleteTextures(1, &tex.id);
  tex.id = 0;
  tex.uploaded_revision = 0;
  // The next context re-uploads from the CPU copy, which the font still holds —
  // so a host that drops and recreates its context does not re-rasterize.
  Font::shared().mark_all_dirty();
}

}  // namespace photon::text
