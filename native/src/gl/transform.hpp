// Port of core/src/gl/transform.ts — the shared data→clip transform every
// layer's vertex shader includes.
//
// The GLSL is byte-identical to the web core's. Two subtleties it carries over:
// log axes are transformed on the GPU, and coordinates are uploaded relative to
// a per-layer reference point so float32 attributes do not lose precision on
// large absolute values such as epoch milliseconds.
#pragma once

#include <string>
#include <vector>

#include "gl/program.hpp"

namespace photon::gl {

extern const char* const TRANSFORM_GLSL;

/// The uniform names TRANSFORM_GLSL declares; every layer program requests these.
const std::vector<std::string>& transform_uniforms();

/**
 * Device-pixel space to clip space.
 *
 * Grid lines, ticks and labels are laid out in pixels measured from the frame
 * target's top-left, the way every 2D toolkit measures them — and the way the
 * web core's Canvas2D overlay does, so the two layouts can be compared number
 * for number. This folds the y flip into the projection, which is also where
 * `ph_frame_target.flip_y` gets handled for everything but the layers.
 */
struct PixelTransform {
  float sx = 0.0f, sy = 0.0f, ox = 0.0f, oy = 0.0f;

  /// `width`/`height` are the target rectangle in device pixels.
  static PixelTransform of(int width, int height, bool flip_y);
};

/// Per-axis view state handed to a layer each frame. lo/hi are raw data space.
struct AxisFrame {
  double lo = 0.0;
  double hi = 1.0;
  bool log = false;
};

/// Set the shared transform uniforms for a layer given its per-axis references.
void set_transform_uniforms(Api& api, const Program& program,
                            const AxisFrame& x, const AxisFrame& y,
                            double x_ref, double y_ref);

/// Append `names` to the shared transform uniform list — the usual way a layer
/// builds its own uniform-name vector.
std::vector<std::string> with_transform_uniforms(std::vector<std::string> names);

}  // namespace photon::gl
