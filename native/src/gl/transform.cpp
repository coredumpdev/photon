#include "gl/transform.hpp"

#include <cmath>

namespace photon::gl {

// Byte-identical to TRANSFORM_GLSL in core/src/gl/transform.ts. Keep them in
// sync: a divergence here is a chart that renders differently on the web and
// natively, which is the one thing this port exists to prevent.
const char* const TRANSFORM_GLSL = R"(
uniform vec2 uDomainX;   // linear: (lo-ref, hi-ref) ; log: (log10 lo, log10 hi)
uniform vec2 uDomainY;
uniform float uXRef;
uniform float uYRef;
uniform float uLogX;     // >0.5 => log axis
uniform float uLogY;

vec2 dataToNorm(vec2 p) {
  float cx = (uLogX > 0.5) ? log(p.x + uXRef) / 2.302585092994046 : p.x;
  float cy = (uLogY > 0.5) ? log(p.y + uYRef) / 2.302585092994046 : p.y;
  float nx = (cx - uDomainX.x) / (uDomainX.y - uDomainX.x);
  float ny = (cy - uDomainY.x) / (uDomainY.y - uDomainY.x);
  return vec2(nx, ny);
}

vec2 dataToClip(vec2 p) {
  return dataToNorm(p) * 2.0 - 1.0;
}
)";

PixelTransform PixelTransform::of(int width, int height, bool flip_y) {
  PixelTransform t;
  const float w = width > 0 ? static_cast<float>(width) : 1.0f;
  const float h = height > 0 ? static_cast<float>(height) : 1.0f;
  t.sx = 2.0f / w;
  t.ox = -1.0f;
  // Without flip_y the target's origin is GL's, bottom-left, so pixel y has to
  // be inverted. With it the host already measures from the top and the two
  // agree — this is the only place that difference exists for the overlay.
  t.sy = flip_y ? 2.0f / h : -2.0f / h;
  t.oy = flip_y ? -1.0f : 1.0f;
  return t;
}

const std::vector<std::string>& transform_uniforms() {
  static const std::vector<std::string> names = {
      "uDomainX", "uDomainY", "uXRef", "uYRef", "uLogX", "uLogY",
  };
  return names;
}

std::vector<std::string> with_transform_uniforms(std::vector<std::string> names) {
  const auto& shared = transform_uniforms();
  names.insert(names.end(), shared.begin(), shared.end());
  return names;
}

void set_transform_uniforms(Api& api, const Program& program,
                            const AxisFrame& x, const AxisFrame& y,
                            double x_ref, double y_ref) {
  // On a log axis the domain goes to the shader already in log space and the
  // reference is added back before log10 in GLSL; on a linear axis the domain
  // is rebased by the same reference the attributes were, so the subtraction in
  // dataToNorm never suffers catastrophic cancellation.
  const double lox = x.log ? std::log10(x.lo) : x.lo - x_ref;
  const double hix = x.log ? std::log10(x.hi) : x.hi - x_ref;
  const double loy = y.log ? std::log10(y.lo) : y.lo - y_ref;
  const double hiy = y.log ? std::log10(y.hi) : y.hi - y_ref;

  api.Uniform2f(program.uniform("uDomainX"), static_cast<GLfloat>(lox), static_cast<GLfloat>(hix));
  api.Uniform2f(program.uniform("uDomainY"), static_cast<GLfloat>(loy), static_cast<GLfloat>(hiy));
  api.Uniform1f(program.uniform("uXRef"), static_cast<GLfloat>(x_ref));
  api.Uniform1f(program.uniform("uYRef"), static_cast<GLfloat>(y_ref));
  api.Uniform1f(program.uniform("uLogX"), x.log ? 1.0f : 0.0f);
  api.Uniform1f(program.uniform("uLogY"), y.log ? 1.0f : 0.0f);
}

}  // namespace photon::gl
