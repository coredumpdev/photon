// Batched SDF text. Everything here is in device pixels, origin top-left.
//
// A frame's labels are accumulated into one vertex buffer and drawn in a single
// call — a chart with three axes puts forty short strings on screen, and forty
// draw calls for forty labels is the kind of cost that shows up on a 4K display
// with a dozen plots on it.
#pragma once

#include <photon/photon.h>

#include <string>
#include <vector>

#include "color.hpp"
#include "gl/gl.hpp"
#include "gl/transform.hpp"

namespace photon::text {

/// Horizontal anchor, mirroring Canvas2D's textAlign.
enum class Align { Left, Center, Right };

/// Vertical anchor, mirroring Canvas2D's textBaseline.
enum class Baseline { Alphabetic, Top, Middle, Bottom };

struct Style {
  /// Em size in device pixels.
  float px = 12.0f;
  Rgba color;
  /// Radians, positive clockwise — the same sense as ctx.rotate() with y down.
  float rotation = 0.0f;
  /**
   * Outline offset in pixels, an SDF's version of a heavier weight.
   *
   * The embedded subset carries Regular only, and the web core asks for weight
   * 600 on the plot title. Pushing the distance threshold out by a fraction of a
   * pixel is not a real semibold — the letterforms do not change — but it reads
   * as one at 15px and costs nothing.
   */
  float bold = 0.0f;
};

/// Width of a string in device pixels at `px`, kerning included.
float measure(const std::string& utf8, float px);

class Batch {
 public:
  void clear() { vertices_.clear(); }
  bool empty() const { return vertices_.empty(); }

  /// Queue one string anchored at (x, y) in device pixels.
  void add(const std::string& utf8, float x, float y, Align align, Baseline baseline,
           const Style& style);

  /// Draw and clear. Returns false with `error` set if the program failed.
  bool flush(gl::Api& api, ph_gfx_api gfx, const gl::PixelTransform& transform,
             std::string& error);

  void release_gl(gl::Api& api);

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// pos.xy, uv.xy, color.rgba, bold — nine floats, six vertices per glyph.
  std::vector<float> vertices_;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
  size_t capacity_ = 0;
};

/// Free the process-wide glyph atlas texture. Requires the context to be current.
void release_atlas_gl(gl::Api& api);

}  // namespace photon::text
