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
