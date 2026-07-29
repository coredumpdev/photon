// Solid rectangles in device-pixel space — the whole of the overlay's geometry.
//
// Everything the web core strokes on its 2D canvas is axis-aligned: grid lines,
// axis lines, tick marks, crosshair segments, the box-select rectangle, the
// plot background. A "1px line" there is a 1px rectangle here, which is why
// there is no line primitive: one shader that fills quads covers all of it, and
// a dashed line is a run of quads.
//
// Snapping is the reason this is not simply the line layer with a fixed
// transform. Canvas2D gets a crisp hairline from `Math.round(x) + 0.5` with
// lineWidth 1; the equivalent here is a rectangle whose edges land on integer
// device pixels — see snap().
#pragma once

#include <photon/photon.h>

#include <string>
#include <vector>

#include "color.hpp"
#include "gl/gl.hpp"
#include "gl/transform.hpp"

namespace photon::render {

class Primitives {
 public:
  void clear() { vertices_.clear(); }
  bool empty() const { return vertices_.empty(); }

  /// Fill a rectangle given in device pixels, origin top-left.
  void rect(float x, float y, float w, float h, Rgba color);

  /**
   * A hairline of `thickness` logical pixels, snapped to the device grid.
   *
   * `pos` is the line's centre on the axis it crosses and `from`/`to` its
   * extent, both in device pixels. `vertical` picks which is which.
   */
  void hairline(bool vertical, float pos, float from, float to, float thickness, Rgba color);

  /// A dashed hairline. `dash` alternates on/off lengths in device pixels.
  void dashed_hairline(bool vertical, float pos, float from, float to, float thickness,
                       const std::vector<float>& dash, Rgba color);

  bool flush(gl::Api& api, ph_gfx_api gfx, const gl::PixelTransform& transform, std::string& error);
  void release_gl(gl::Api& api);

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// pos.xy, color.rgba — six floats, six vertices per rectangle.
  std::vector<float> vertices_;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
  size_t capacity_ = 0;
};

}  // namespace photon::render
