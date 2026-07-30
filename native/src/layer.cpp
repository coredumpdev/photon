#include "layer.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_map>
#include <utility>

#include "color/colormap.hpp"
#include "geo/earcut.hpp"
#include "graph/force.hpp"
#include "stats/stats.hpp"
#include "gl/program.hpp"

namespace photon {
namespace {

using namespace photon::gl;

/// Non-finite samples are holes in a series, not data — the web core skips them
/// when autoscaling and so must this, or one NaN collapses the whole domain.
bool finite(double v) {
  return std::isfinite(v);
}

/// Turn a descriptor's colormap fields into the internal spec. NULL is viridis.
photon::color::Spec colormap_spec(const ph_colormap_spec* desc) {
  photon::color::Spec spec;
  if (!desc) return spec;
  if (desc->name) spec.name = desc->name;
  if (desc->stops && desc->stop_count > 0) {
    spec.stops.reserve(static_cast<size_t>(desc->stop_count));
    for (int32_t i = 0; i < desc->stop_count; ++i) {
      spec.stops.push_back(photon::color::to_rgb(desc->stops[i]));
    }
  }
  spec.reverse = desc->reverse != 0;
  spec.discrete_steps = desc->discrete_steps;
  return spec;
}


std::string from_utf8(const char* s) {
  return s ? std::string(s) : std::string();
}

/// Above this the line falls back to drawing everything; below, decimation runs.
long long upper_bound_index(const std::vector<double>& values, double v) {
  return static_cast<long long>(std::upper_bound(values.begin(), values.end(), v) - values.begin());
}

/**
 * Min/max decimation, ported from decimateIndices in layers/line-util.ts.
 *
 * Each pixel column keeps the sample with the lowest and the highest y, emitted
 * in index order so the envelope's shape survives, bracketed by the window
 * endpoints so the line still reaches the edges.
 */
std::vector<long long> decimate_indices(const std::vector<double>& ys, long long i0,
                                        long long i1, long long columns) {
  std::vector<long long> out;
  out.push_back(i0);
  const long long visible = i1 - i0;
  for (long long b = 0; b < columns; ++b) {
    const long long lo = i0 + (visible * b) / columns;
    const long long hi = i0 + (visible * (b + 1)) / columns;
    if (hi <= lo) continue;
    long long i_min = lo;
    long long i_max = lo;
    for (long long i = lo; i < hi; ++i) {
      const size_t k = static_cast<size_t>(i);
      if (ys[k] < ys[static_cast<size_t>(i_min)]) i_min = i;
      if (ys[k] > ys[static_cast<size_t>(i_max)]) i_max = i;
    }
    if (i_min < i_max) {
      out.push_back(i_min);
      out.push_back(i_max);
    } else {
      out.push_back(i_max);
      out.push_back(i_min);
    }
  }
  out.push_back(i1);
  return out;
}

/// Port of stepExpand in layers/line.ts.
void step_expand(std::vector<double>& xs, std::vector<double>& ys, ph_step mode) {
  const size_t n = xs.size();
  if (n < 2 || mode == PH_STEP_NONE) return;
  std::vector<double> ox;
  std::vector<double> oy;
  ox.reserve(n * 3);
  oy.reserve(n * 3);
  for (size_t i = 0; i + 1 < n; ++i) {
    const double x0 = xs[i], y0 = ys[i], x1 = xs[i + 1], y1 = ys[i + 1];
    if (mode == PH_STEP_CENTER) {
      const double xm = (x0 + x1) / 2.0;
      ox.push_back(x0); ox.push_back(xm); ox.push_back(xm);
      oy.push_back(y0); oy.push_back(y0); oy.push_back(y1);
    } else if (mode == PH_STEP_AFTER) {
      ox.push_back(x0); ox.push_back(x1);
      oy.push_back(y0); oy.push_back(y0);
    } else {  // PH_STEP_BEFORE
      ox.push_back(x0); ox.push_back(x0);
      oy.push_back(y0); oy.push_back(y1);
    }
  }
  ox.push_back(xs[n - 1]);
  oy.push_back(ys[n - 1]);
  xs = std::move(ox);
  ys = std::move(oy);
}

// -- shaders ---------------------------------------------------------------
// Verbatim from core/src/layers/line.ts and scatter.ts. The only change made
// anywhere in this file is the #version line, and that happens in
// gl::translate() rather than here, so a diff against the TypeScript source
// stays readable.

const char* const kLineVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;  // (along 0..1, side -1..1)
layout(location = 1) in vec2 aP0;
layout(location = 2) in vec2 aP1;
layout(location = 3) in float aDist;   // cumulative data-space length at P0
uniform vec2 uResolution;
uniform float uWidth;
uniform float uRound;
)";

const char* const kLineVertMain = R"(
out vec2 vPix;
out vec2 vS0;
out vec2 vS1;
out float vDash0;
void main() {
  vec2 s0 = (dataToClip(aP0) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aP1) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = uWidth * 0.5 + 1.5;                 // half width + AA margin
  float ext = uRound > 0.5 ? hw : 0.0;           // extend for round caps
  vec2 endpoint = mix(s0, s1, aCorner.x);
  vec2 outward = (aCorner.x < 0.5 ? -dir : dir) * ext;
  vec2 pos = endpoint + outward + nrm * (aCorner.y * hw);
  float dataLen = length(aP1 - aP0);
  vDash0 = dataLen > 1e-12 ? aDist * (len / dataLen) : 0.0;
  vPix = pos; vS0 = s0; vS1 = s1;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

const char* const kLineFrag = R"(#version 300 es
precision highp float;
in vec2 vPix;
in vec2 vS0;
in vec2 vS1;
in float vDash0;
uniform vec4 uColor;
uniform float uWidth;
uniform float uRound;
uniform float uDash[8];
uniform int uDashCount;
uniform float uDashPeriod;
out vec4 outColor;
void main() {
  vec2 pa = vPix - vS0;
  vec2 ba = vS1 - vS0;
  float bb = dot(ba, ba);
  float t = bb > 1e-6 ? dot(pa, ba) / bb : 0.0;
  float d;
  if (uRound > 0.5) {
    d = length(pa - ba * clamp(t, 0.0, 1.0));    // round caps/joins
  } else {
    if (t < 0.0 || t > 1.0) discard;             // butt caps
    d = length(pa - ba * t);
  }
  if (uDashCount > 0) {
    float phase = mod(vDash0 + clamp(t, 0.0, 1.0) * length(ba), uDashPeriod);
    float acc = 0.0;
    bool on = true;
    for (int i = 0; i < 8; i++) {
      if (i >= uDashCount) break;
      acc += uDash[i];
      if (phase < acc) { on = (i - (i / 2) * 2) == 0; break; }
    }
    if (!on) discard;
  }
  float hw = uWidth * 0.5;
  float alpha = 1.0 - smoothstep(hw - 1.0, hw + 1.0, d);
  if (alpha <= 0.0) discard;
  outColor = vec4(uColor.rgb * uColor.a, uColor.a) * alpha;
})";

const char* const kJoinVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aPrev;
layout(location = 1) in vec2 aP0;
layout(location = 2) in vec2 aNext;
uniform vec2 uResolution;
uniform float uWidth;
uniform float uMiter;        // >0.5 => miter, else bevel
uniform float uMiterLimit;
)";

const char* const kJoinVertMain = R"(
out vec2 vPix;
flat out vec2 vE0;
flat out vec2 vE1;
flat out vec2 vInner;
void main() {
  vec2 sp = (dataToClip(aPrev) * 0.5 + 0.5) * uResolution;
  vec2 s0 = (dataToClip(aP0)   * 0.5 + 0.5) * uResolution;
  vec2 sn = (dataToClip(aNext) * 0.5 + 0.5) * uResolution;
  vec2 din = s0 - sp;
  vec2 dout = sn - s0;
  float inl = length(din), outl = length(dout);
  vec2 inN = vec2(0.0), outN = vec2(0.0);
  float crs = 0.0;
  bool ok = inl > 1e-6 && outl > 1e-6;
  if (ok) {
    din /= inl; dout /= outl;
    inN = vec2(-din.y, din.x);
    outN = vec2(-dout.y, dout.x);
    crs = din.x * dout.y - din.y * dout.x;
    ok = abs(crs) > 1e-6;                         // collinear => no notch
  }
  if (!ok) {                                       // degenerate: cull the wedge
    vE0 = vec2(0.0); vE1 = vec2(0.0); vInner = vec2(0.0); vPix = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float hw = uWidth * 0.5;
  float outerSign = crs > 0.0 ? -1.0 : 1.0;
  vec2 A = s0 + inN * hw * outerSign;
  vec2 B = s0 + outN * hw * outerSign;
  vec2 apex = 0.5 * (A + B);                        // bevel midpoint
  if (uMiter > 0.5) {
    vec2 mN = inN + outN;
    float ml = length(mN);
    if (ml > 1e-6) {
      mN /= ml;
      float denom = dot(mN, outN);
      if (denom > 1e-3) {
        float miterLen = 1.0 / denom;
        if (miterLen <= uMiterLimit) apex = s0 + mN * outerSign * hw * miterLen;
      }
    }
  }
  int vid = gl_VertexID;
  vec2 pos;
  if (vid == 0 || vid == 3) pos = s0;
  else if (vid == 1) pos = A;
  else if (vid == 2 || vid == 4) pos = apex;
  else pos = B;                                    // vid == 5
  if (vid < 3) { vE0 = A; vE1 = apex; }            // triangle [s0, A, apex]
  else { vE0 = apex; vE1 = B; }                    // triangle [s0, apex, B]
  vInner = s0;
  vPix = pos;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

const char* const kJoinFrag = R"(#version 300 es
precision highp float;
in vec2 vPix;
flat in vec2 vE0;
flat in vec2 vE1;
flat in vec2 vInner;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  vec2 e = vE1 - vE0;
  float el = length(e);
  if (el < 1e-6) discard;
  vec2 n = vec2(-e.y, e.x) / el;
  float sideInner = dot(vInner - vE0, n) >= 0.0 ? 1.0 : -1.0;
  float d = dot(vPix - vE0, n) * sideInner;        // >0 inside the outer edge
  float alpha = clamp(d + 0.5, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  outColor = vec4(uColor.rgb * uColor.a, uColor.a) * alpha;
})";

const char* const kScatterVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;  // unit quad [-1,1]^2
layout(location = 1) in vec2 aPos;     // point (offset data space)
layout(location = 2) in vec4 aColor;   // per-point color
layout(location = 3) in float aSize;   // per-point diameter in CSS px
uniform vec2 uResolution;
uniform float uSize;                   // radius in device px
uniform float uDpr;
)";

const char* const kScatterVertMain = R"(
out vec2 vLocal;
out vec4 vColor;
void main() {
  vec2 center = (dataToClip(aPos) * 0.5 + 0.5) * uResolution;
  float radius = aSize > 0.0 ? aSize * 0.5 * uDpr : uSize;
  vec2 pos = center + aCorner * radius;
  vLocal = aCorner;
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

const char* const kScatterFrag = R"(#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
uniform vec4 uColor;
uniform float uUseVertexColor;
uniform int uMarker;
out vec4 outColor;

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdTri(vec2 p) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - 1.0;
  p.y = p.y + 1.0 / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  vec2 p = vLocal;
  if (uMarker == 0) {
    float r = length(p);
    if (r > 1.0) discard;
    float alpha = smoothstep(1.0, 1.0 - 0.15, r);
    vec4 c0 = uUseVertexColor > 0.5 ? vColor : uColor;
    outColor = vec4(c0.rgb * c0.a * alpha, c0.a * alpha);
    return;
  }
  float d;
  if (uMarker == 1) d = sdBox(p, vec2(0.88));
  else if (uMarker == 2) d = sdTri(p);
  else if (uMarker == 3) d = abs(p.x) + abs(p.y) - 1.0;
  else if (uMarker == 4) {
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.70710678;
    d = min(sdBox(q, vec2(1.0, 0.30)), sdBox(q, vec2(0.30, 1.0)));
  } else {
    d = min(sdBox(p, vec2(1.0, 0.30)), sdBox(p, vec2(0.30, 1.0)));
  }
  float aa = fwidth(d) + 1e-4;
  float alpha = 1.0 - smoothstep(-aa, aa, d);
  if (alpha <= 0.0) discard;
  vec4 c = uUseVertexColor > 0.5 ? vColor : uColor;
  outColor = vec4(c.rgb * c.a * alpha, c.a * alpha);
})";

constexpr double kPi = 3.14159265358979323846;

/// The core's ten-colour pie palette, from DEFAULT_COLORS in pie.ts.
constexpr size_t kPiePaletteSize = 10;
constexpr ph_color kPiePalette[kPiePaletteSize] = {
    0x3b82f6ffu, 0xf472b6ffu, 0x22d3eeffu, 0xa3e635ffu, 0xfbbf24ffu,
    0xa78bfaffu, 0x34d399ffu, 0xfb7185ffu, 0x60a5faffu, 0xf59e0bffu,
};

/// Stem: the line layer's segment quad, with one uniform colour and no dashes.
const char* const kStemVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
uniform vec2 uResolution;
uniform float uWidth;
)";

const char* const kStemVertMain = R"(
void main() {
  vec2 s0 = (dataToClip(aSeg.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aSeg.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = mix(s0, s1, aCorner.x) + nrm * (aCorner.y * uWidth * 0.5);
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

const char* const kStemFrag = R"(#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); })";

/// Stem tips: an instanced disc, the scatter marker with the shape fixed.
const char* const kStemMarkerVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aPoint;
uniform vec2 uResolution;
uniform float uSize;
out vec2 vLocal;
)";

const char* const kStemMarkerVertMain = R"(
void main() {
  vec2 centre = (dataToClip(aPoint) * 0.5 + 0.5) * uResolution;
  vLocal = aCorner;
  vec2 pos = centre + aCorner * uSize;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

const char* const kStemMarkerFrag = R"(#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float alpha = smoothstep(1.0, 1.0 - 0.15, r);
  outColor = vec4(uColor.rgb * uColor.a * alpha, uColor.a * alpha);
})";

/// OHLC segments: the stem quad with a per-instance colour, so one draw covers
/// a whole series whose colour changes bar by bar.
const char* const kOhlcSegVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
layout(location = 2) in vec4 aColor;
uniform vec2 uResolution;
uniform float uWidth;
)";

const char* const kOhlcSegVertMain = R"(
out vec4 vColor;
void main() {
  vec2 s0 = (dataToClip(aSeg.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aSeg.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = mix(s0, s1, aCorner.x) + nrm * (aCorner.y * uWidth * 0.5);
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

/// Error-bar caps: a pixel-sized tick centred on a data point. `orient` picks
/// the axis it lies along, so one program draws both the y and x caps.
const char* const kCapVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aCap;
uniform vec2 uResolution;
uniform float uCapSize;
uniform float uWidth;
)";

const char* const kCapVertMain = R"(
void main() {
  vec2 c = (dataToClip(aCap.xy) * 0.5 + 0.5) * uResolution;
  vec2 h = aCap.z < 0.5 ? vec2(uCapSize * 0.5, uWidth * 0.5) : vec2(uWidth * 0.5, uCapSize * 0.5);
  vec2 pos = c + aCorner * h;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

/// Box: one program for triangles, lines and points, with the point path
/// clipped to a disc in the fragment shader.
const char* const kBoxVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
uniform float uPointSize;
)";

const char* const kBoxVertMain = R"(
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = uPointSize;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
})";

const char* const kBoxFrag = R"(#version 300 es
precision highp float;
in vec4 vColor;
uniform float uIsPoint;
out vec4 outColor;
void main() {
  if (uIsPoint > 0.5) {
    vec2 d = gl_PointCoord - 0.5;
    if (length(d) > 0.5) discard;
  }
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
})";

/// The core's default area fill, rgba(59,130,246,0.4) — translucent on purpose,
/// because an area is drawn under something.
constexpr ph_color kDefaultAreaColor = 0x3b82f666u;

/// Unit rect corners, for the instanced bar quad.
const float kUnitCorners[12] = {0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1};

/// Area: a plain position attribute filled with one uniform colour.
const char* const kAreaVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aPos;
)";

const char* const kAreaVertMain = R"(
void main() { gl_Position = vec4(dataToClip(aPos), 0.0, 1.0); })";

const char* const kAreaFrag = R"(#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); })";

/// Bar: one instanced unit quad per bar, stretched to a per-bar rectangle.
const char* const kBarVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aColor;
)";

const char* const kBarVertMain = R"(
out vec4 vColor;
void main() {
  vec2 p = mix(aRect.xy, aRect.zw, aCorner);
  vColor = aColor;
  gl_Position = vec4(dataToClip(p), 0.0, 1.0);
})";

const char* const kBarFrag = R"(#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); })";

/// A solid-fill program driven by a per-vertex colour triangle soup. Copied
/// from FILL_VERT/FILL_FRAG in layers/patches.ts, where pie shares it too.
const char* const kFillVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
)";

const char* const kFillVertMain = R"(
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
})";

const char* const kFillFrag = R"(#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); })";

/// Assemble a vertex shader: version, declarations, the shared transform, main.
std::string vertex_source(const char* body, const char* main) {
  return std::string("#version 300 es\n") + body + TRANSFORM_GLSL + main;
}

const float kLineCorners[12] = {0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1};
const float kQuadCorners[12] = {-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1};

}  // namespace

// -- XYLayer ----------------------------------------------------------------

bool XYLayer::bounds(ph_range& x, ph_range& y) const {
  if (!has_bounds_) return false;
  x = x_bounds_;
  y = y_bounds_;
  return true;
}

void XYLayer::set_xy(const double* xs, const double* ys, size_t count) {
  x_.assign(xs, xs + count);
  y_.assign(ys, ys + count);
  rebuild();
}

void XYLayer::rebuild() {
  const size_t n = x_.size();
  packed_.assign(n * 2, 0.0f);
  x_ref_ = n > 0 ? x_[0] : 0.0;
  y_ref_ = n > 0 ? y_[0] : 0.0;

  double x0 = std::numeric_limits<double>::infinity();
  double x1 = -x0;
  double y0 = x0;
  double y1 = x1;
  bool any = false;
  monotonic_ = true;

  for (size_t i = 0; i < n; ++i) {
    packed_[i * 2] = static_cast<float>(x_[i] - x_ref_);
    packed_[i * 2 + 1] = static_cast<float>(y_[i] - y_ref_);
    if (i > 0 && x_[i] < x_[i - 1]) monotonic_ = false;
    if (!finite(x_[i]) || !finite(y_[i])) continue;
    x0 = std::min(x0, x_[i]);
    x1 = std::max(x1, x_[i]);
    y0 = std::min(y0, y_[i]);
    y1 = std::max(y1, y_[i]);
    any = true;
  }

  has_bounds_ = any;
  if (any) {
    x_bounds_ = ph_range{x0, x1};
    y_bounds_ = ph_range{y0, y1};
  }
  dirty_ = true;
}

// -- LineLayer --------------------------------------------------------------

LineLayer::LineLayer(const ph_line_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  if (desc.width > 0.0f) width_ = desc.width;
  step_ = desc.step;
  join_ = desc.join;
  if (desc.miter_limit > 0.0f) miter_limit_ = desc.miter_limit;
  if (desc.dash && desc.dash_count > 0) {
    // The shader's pattern array is 8 entries; zero-length dashes are dropped.
    const int32_t n = std::min(desc.dash_count, 8);
    for (int32_t i = 0; i < n; ++i) {
      if (desc.dash[i] > 0.0f) dash_.push_back(desc.dash[i]);
    }
    for (const float d : dash_) dash_period_ += d;
  }
  // A dashed line is an annotation, not a million-point series: decimating it
  // would resample the very vertices the dash phase is measured from.
  decimate_ = !desc.no_decimate && dash_.empty();
  render_type_ = desc.render_type;

  if (desc.count > 0 && desc.x && desc.y) {
    x_.assign(desc.x, desc.x + desc.count);
    y_.assign(desc.y, desc.y + desc.count);
    step_expand(x_, y_, step_);
    rebuild();
  }
}

bool LineLayer::ensure_gl(Api& api, std::string& error) {
  if (full_vao_ == 0) {
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &point_buffer_);
    api.GenBuffers(1, &dist_buffer_);
    api.GenBuffers(1, &decimated_buffer_);
    api.GenVertexArrays(1, &full_vao_);
    api.GenVertexArrays(1, &decimated_vao_);
    api.GenVertexArrays(1, &join_full_vao_);
    api.GenVertexArrays(1, &join_decimated_vao_);
    if (full_vao_ == 0) {
      error = "failed to create line layer vertex arrays";
      return false;
    }

    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kLineCorners)),
                   kLineCorners, GL_STATIC_DRAW);

    // Segment instances read two consecutive points through overlapping
    // attribute offsets; join instances read three the same way.
    const auto configure_segments = [&](GLuint vao, GLuint points) {
      api.BindVertexArray(vao);
      api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
      api.EnableVertexAttribArray(0);
      api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
      api.BindBuffer(GL_ARRAY_BUFFER, points);
      api.EnableVertexAttribArray(1);
      api.VertexAttribPointer(1, 2, GL_FLOAT, 0, 8, nullptr);
      api.VertexAttribDivisor(1, 1);
      api.EnableVertexAttribArray(2);
      api.VertexAttribPointer(2, 2, GL_FLOAT, 0, 8, reinterpret_cast<const void*>(8));
      api.VertexAttribDivisor(2, 1);
      if (!dash_.empty()) {
        api.BindBuffer(GL_ARRAY_BUFFER, dist_buffer_);
        api.EnableVertexAttribArray(3);
        api.VertexAttribPointer(3, 1, GL_FLOAT, 0, 4, nullptr);
        api.VertexAttribDivisor(3, 1);
      }
      api.BindVertexArray(0);
    };
    const auto configure_joins = [&](GLuint vao, GLuint points) {
      api.BindVertexArray(vao);
      api.BindBuffer(GL_ARRAY_BUFFER, points);
      for (GLuint loc = 0; loc < 3; ++loc) {
        api.EnableVertexAttribArray(loc);
        api.VertexAttribPointer(loc, 2, GL_FLOAT, 0, 8,
                                reinterpret_cast<const void*>(static_cast<std::uintptr_t>(loc) * 8));
        api.VertexAttribDivisor(loc, 1);
      }
      api.BindVertexArray(0);
    };
    configure_segments(full_vao_, point_buffer_);
    configure_segments(decimated_vao_, decimated_buffer_);
    configure_joins(join_full_vao_, point_buffer_);
    configure_joins(join_decimated_vao_, decimated_buffer_);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, point_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(packed_.size() * sizeof(float)),
                   packed_.empty() ? nullptr : packed_.data(), usage);

    if (!dash_.empty()) {
      // Cumulative data-space arc length; the vertex shader scales it into
      // screen pixels per segment so the pattern stays continuous across joints.
      distances_.assign(count(), 0.0f);
      for (size_t i = 1; i < distances_.size(); ++i) {
        const float dx = packed_[i * 2] - packed_[(i - 1) * 2];
        const float dy = packed_[i * 2 + 1] - packed_[(i - 1) * 2 + 1];
        distances_[i] = distances_[i - 1] + std::hypot(dx, dy);
      }
      api.BindBuffer(GL_ARRAY_BUFFER, dist_buffer_);
      api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(distances_.size() * sizeof(float)),
                     distances_.empty() ? nullptr : distances_.data(), usage);
    }
    decimation_key_.clear();
    dirty_ = false;
  }
  return true;
}

long long LineLayer::decimate(Api& api, const AxisFrame& x, int columns) {
  const long long n = static_cast<long long>(count());
  if (!decimate_ || !monotonic_ || n < 4LL * columns) return -1;
  const long long target = std::max(2LL, static_cast<long long>(columns) * 2);

  // Visible index window, with a one-sample margin so the line reaches the edges.
  long long i0 = upper_bound_index(x_, x.lo) - 1;
  long long i1 = upper_bound_index(x_, x.hi);
  i0 = std::max(0LL, i0);
  i1 = std::min(n - 1, i1);
  if (i1 - i0 <= target * 3 / 2) return -1;

  const std::string key = std::to_string(i0) + ":" + std::to_string(i1) + ":" + std::to_string(target);
  if (key == decimation_key_) return decimated_segments_;
  decimation_key_ = key;

  const std::vector<long long> indices = decimate_indices(y_, i0, i1, columns);
  std::vector<float> out(indices.size() * 2);
  for (size_t k = 0; k < indices.size(); ++k) {
    const size_t i = static_cast<size_t>(indices[k]);
    out[k * 2] = static_cast<float>(x_[i] - x_ref_);
    out[k * 2 + 1] = static_cast<float>(y_[i] - y_ref_);
  }

  api.BindBuffer(GL_ARRAY_BUFFER, decimated_buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(out.size() * sizeof(float)),
                 out.data(), GL_DYNAMIC_DRAW);
  decimated_segments_ = static_cast<long long>(indices.size()) - 1;
  return decimated_segments_;
}

bool LineLayer::draw(const DrawState& state, std::string& error) {
  if (count() < 2 || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms(
      {"uColor", "uResolution", "uWidth", "uRound", "uDash[0]", "uDashCount", "uDashPeriod"});
  const Program* program = get_program(api, "line", vertex_source(kLineVertBody, kLineVertMain),
                                       kLineFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  const int columns = std::max(1, static_cast<int>(std::lround(state.pixel_width)));
  const long long decimated = decimate(api, state.x, columns);
  const bool is_decimated = decimated >= 0;
  const long long segments = is_decimated ? decimated : static_cast<long long>(count()) - 1;
  if (segments < 1) return true;
  const long long points = segments + 1;

  const Rgba color = unpack_color(color_);
  const bool round = join_ == PH_JOIN_ROUND;

  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(program->uniform("uColor"), color.r, color.g, color.b, color.a);
  api.Uniform2f(program->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(program->uniform("uWidth"), width_ * state.dpr);
  // Round joins use the SDF cap extension; miter/bevel/butt draw plain rectangles.
  api.Uniform1f(program->uniform("uRound"), round ? 1.0f : 0.0f);
  api.Uniform1i(program->uniform("uDashCount"), static_cast<GLint>(dash_.size()));
  if (!dash_.empty()) {
    float scaled[8] = {0};
    for (size_t i = 0; i < dash_.size(); ++i) scaled[i] = dash_[i] * state.dpr;
    api.Uniform1fv(program->uniform("uDash[0]"), 8, scaled);
    api.Uniform1f(program->uniform("uDashPeriod"), dash_period_ * state.dpr);
  }
  api.BindVertexArray(is_decimated ? decimated_vao_ : full_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(segments));
  api.BindVertexArray(0);

  // Miter/bevel joins fill the outer notch left between the butt rectangles.
  if ((join_ == PH_JOIN_MITER || join_ == PH_JOIN_BEVEL) && points >= 3) {
    static const std::vector<std::string> kJoinUniforms = with_transform_uniforms(
        {"uColor", "uResolution", "uWidth", "uMiter", "uMiterLimit"});
    const Program* join = get_program(api, "line-join", vertex_source(kJoinVertBody, kJoinVertMain),
                                      kJoinFrag, kJoinUniforms, state.gfx, error);
    if (!join) return false;
    api.UseProgram(join->id);
    set_transform_uniforms(api, *join, state.x, state.y, x_ref_, y_ref_);
    api.Uniform4f(join->uniform("uColor"), color.r, color.g, color.b, color.a);
    api.Uniform2f(join->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                  static_cast<GLfloat>(state.pixel_height));
    api.Uniform1f(join->uniform("uWidth"), width_ * state.dpr);
    api.Uniform1f(join->uniform("uMiter"), join_ == PH_JOIN_MITER ? 1.0f : 0.0f);
    api.Uniform1f(join->uniform("uMiterLimit"), miter_limit_);
    api.BindVertexArray(is_decimated ? join_decimated_vao_ : join_full_vao_);
    api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(points - 2));
    api.BindVertexArray(0);
  }
  return true;
}

bool LineLayer::pick(PickMode mode, double cursor_px, double cursor_py,
                     const PickProjection& project, Picked& out) const {
  // No gate: a series is a continuous reading, so the nearest sample along the
  // cursor is always the answer even when it is far away vertically.
  return pick_nearest(x_, y_, mode, cursor_px, cursor_py, project,
                      std::numeric_limits<double>::infinity(), monotonic_, out);
}

void LineLayer::release_gl(Api& api) {
  if (full_vao_ == 0) return;
  const GLuint vaos[] = {full_vao_, decimated_vao_, join_full_vao_, join_decimated_vao_};
  api.DeleteVertexArrays(4, vaos);
  const GLuint buffers[] = {corner_buffer_, point_buffer_, dist_buffer_, decimated_buffer_};
  api.DeleteBuffers(4, buffers);
  full_vao_ = decimated_vao_ = join_full_vao_ = join_decimated_vao_ = 0;
  corner_buffer_ = point_buffer_ = dist_buffer_ = decimated_buffer_ = 0;
  dirty_ = true;
}

// -- ScatterLayer -----------------------------------------------------------

ScatterLayer::ScatterLayer(const ph_scatter_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  if (desc.size > 0.0f) size_ = desc.size;
  marker_ = desc.marker;
  render_type_ = desc.render_type;

  if (desc.count > 0 && desc.x && desc.y) {
    x_.assign(desc.x, desc.x + desc.count);
    y_.assign(desc.y, desc.y + desc.count);
    rebuild();
  }

  const size_t n = count();
  if (desc.sizes && n > 0) sizes_.assign(desc.sizes, desc.sizes + n);
  if (desc.colors && n > 0) {
    use_vertex_color_ = true;
    colors_.resize(n * 4);
    for (size_t i = 0; i < n; ++i) {
      const Rgba c = unpack_color(desc.colors[i]);
      colors_[i * 4] = c.r;
      colors_[i * 4 + 1] = c.g;
      colors_[i * 4 + 2] = c.b;
      colors_[i * 4 + 3] = c.a;
    }
  }
  // colorBy wins over explicit colours, the same way it does in the web core:
  // asking for both is contradictory, and the mapped one is the more specific
  // request.
  if (desc.color_by && n > 0) {
    use_vertex_color_ = true;
    double lo = desc.color_by_domain.lo;
    double hi = desc.color_by_domain.hi;
    if (!(hi > lo)) {
      lo = std::numeric_limits<double>::infinity();
      hi = -lo;
      for (size_t i = 0; i < n; ++i) {
        const double v = desc.color_by[i];
        if (!finite(v)) continue;
        lo = std::min(lo, v);
        hi = std::max(hi, v);
      }
      if (!finite(lo) || !finite(hi)) {
        lo = 0.0;
        hi = 1.0;
      }
    }
    color_domain_ = ph_range{lo, hi};
    const double span = (hi - lo) != 0.0 ? (hi - lo) : 1.0;
    const photon::color::Spec spec = colormap_spec(desc.color_map);
    const photon::color::Lut& table = photon::color::lut(spec);
    color_lut_ = &table;
    colors_.resize(n * 4);
    for (size_t i = 0; i < n; ++i) {
      const photon::color::Rgb c =
          photon::color::sample(table, (desc.color_by[i] - lo) / span);
      colors_[i * 4] = c.r;
      colors_[i * 4 + 1] = c.g;
      colors_[i * 4 + 2] = c.b;
      colors_[i * 4 + 3] = 1.0f;
    }
  }
}

bool ScatterLayer::color_info(ColorInfo& out) const {
  if (!color_lut_) return false;
  out.lut = color_lut_;
  out.domain = color_domain_;
  out.label = name_;
  return true;
}

bool ScatterLayer::pick(PickMode mode, double cursor_px, double cursor_py,
                        const PickProjection& project, Picked& out) const {
  // Only a hit when the cursor is within the marker plus a couple of pixels of
  // slack: a cloud has no "the point along x", so a far-away match would be a
  // highlight the reader cannot account for.
  double largest = size_;
  for (const float size : sizes_) largest = std::max(largest, static_cast<double>(size));
  const double gate = largest / 2.0 + 4.0;
  return pick_nearest(x_, y_, mode, cursor_px, cursor_py, project, gate, monotonic_, out);
}

bool ScatterLayer::ensure_gl(Api& api, std::string& error) {
  const size_t n = count();
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &point_buffer_);
    api.GenBuffers(1, &color_buffer_);
    api.GenBuffers(1, &size_buffer_);
    if (vao_ == 0) {
      error = "failed to create scatter layer vertex array";
      return false;
    }
    api.BindVertexArray(vao_);

    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kQuadCorners)),
                   kQuadCorners, GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);

    api.BindBuffer(GL_ARRAY_BUFFER, point_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 2, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);

    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);

    api.BindBuffer(GL_ARRAY_BUFFER, size_buffer_);
    api.EnableVertexAttribArray(3);
    api.VertexAttribPointer(3, 1, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(3, 1);

    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, point_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(packed_.size() * sizeof(float)),
                   packed_.empty() ? nullptr : packed_.data(), usage);

    // The colour and size attributes must cover every instance even when the
    // caller supplied neither, or the divisor reads past the end of the buffer.
    std::vector<float> colors = colors_;
    colors.resize(n * 4, 0.0f);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors.size() * sizeof(float)),
                   colors.empty() ? nullptr : colors.data(), usage);

    std::vector<float> sizes = sizes_;
    sizes.resize(n, 0.0f);
    api.BindBuffer(GL_ARRAY_BUFFER, size_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizes.size() * sizeof(float)),
                   sizes.empty() ? nullptr : sizes.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool ScatterLayer::draw(const DrawState& state, std::string& error) {
  if (count() == 0 || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms(
      {"uColor", "uResolution", "uSize", "uDpr", "uUseVertexColor", "uMarker"});
  const Program* program = get_program(api, "scatter",
                                       vertex_source(kScatterVertBody, kScatterVertMain),
                                       kScatterFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  const Rgba color = unpack_color(color_);
  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(program->uniform("uColor"), color.r, color.g, color.b, color.a);
  api.Uniform2f(program->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(program->uniform("uSize"), (size_ / 2.0f) * state.dpr);
  api.Uniform1f(program->uniform("uDpr"), state.dpr);
  api.Uniform1f(program->uniform("uUseVertexColor"), use_vertex_color_ ? 1.0f : 0.0f);
  api.Uniform1i(program->uniform("uMarker"), marker_);
  api.BindVertexArray(vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(count()));
  api.BindVertexArray(0);
  return true;
}

void ScatterLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  const GLuint buffers[] = {corner_buffer_, point_buffer_, color_buffer_, size_buffer_};
  api.DeleteBuffers(4, buffers);
  vao_ = 0;
  corner_buffer_ = point_buffer_ = color_buffer_ = size_buffer_ = 0;
  dirty_ = true;
}

// -- PatchesLayer -----------------------------------------------------------

PatchesLayer::PatchesLayer(const ph_patches_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  render_type_ = desc.render_type;
  const float opacity = desc.opacity > 0.0f ? std::min(desc.opacity, 1.0f) : 1.0f;

  const Rgba fallback = unpack_color(desc.color);
  const int32_t patch_count = desc.patches ? std::max(0, desc.patch_count) : 0;

  // A choropleth: one value per patch through a ramp. Resolved once here rather
  // than per patch, because `lut()` takes a lock and returns a reference the
  // layer then holds for its whole life.
  if (desc.values && patch_count > 0) {
    const photon::color::Spec spec = colormap_spec(desc.colormap);
    color_lut_ = &photon::color::lut(spec);
    value_domain_ = desc.domain;
    if (value_domain_.lo == value_domain_.hi) {
      double lo = std::numeric_limits<double>::infinity();
      double hi = -lo;
      for (int32_t i = 0; i < patch_count; ++i) {
        if (!finite(desc.values[i])) continue;
        lo = std::min(lo, desc.values[i]);
        hi = std::max(hi, desc.values[i]);
      }
      value_domain_ = std::isfinite(lo) ? ph_range{lo, hi == lo ? lo + 1.0 : hi}
                                        : ph_range{0.0, 1.0};
    }
  }

  // The first vertex of the first non-empty patch anchors the float32
  // reference, exactly as it does for a line — the same precision problem, and
  // a map's coordinates are just as capable of exhausting a float.
  for (int32_t i = 0; i < patch_count; ++i) {
    const ph_patch& patch = desc.patches[i];
    if (patch.count > 0 && patch.x && patch.y) {
      x_ref_ = patch.x[0];
      y_ref_ = patch.y[0];
      break;
    }
  }

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;

  for (int32_t p = 0; p < patch_count; ++p) {
    const ph_patch& patch = desc.patches[p];
    if (!patch.x || !patch.y || patch.count < 3) continue;
    const size_t n = static_cast<size_t>(patch.count);

    Rgba rgba = patch.color != PH_COLOR_AUTO ? unpack_color_exact(patch.color) : fallback;
    if (color_lut_) {
      // The ramp wins over the patch's own colour, the same way a scatter's
      // color_by wins over its per-point colours.
      const double span = value_domain_.hi - value_domain_.lo;
      const double t = span == 0.0 ? 0.0 : (desc.values[p] - value_domain_.lo) / span;
      const photon::color::Rgb c = photon::color::sample(*color_lut_, t);
      rgba = Rgba{c.r, c.g, c.b, 1.0f};
    }
    rgba.a *= opacity;

    // Flat [x0,y0,x1,y1,…] in raw coordinates for earcut; the reference is
    // subtracted on the way into the vertex buffer, not before triangulating,
    // because the ear tests are scale-sensitive and float32 is not involved yet.
    std::vector<double> flat(n * 2);
    for (size_t i = 0; i < n; ++i) {
      flat[i * 2] = patch.x[i];
      flat[i * 2 + 1] = patch.y[i];
    }

    std::vector<uint32_t> holes;
    if (patch.holes && patch.hole_count > 0) {
      holes.reserve(static_cast<size_t>(patch.hole_count));
      for (int32_t h = 0; h < patch.hole_count; ++h) {
        if (patch.holes[h] > 0 && static_cast<size_t>(patch.holes[h]) < n) {
          holes.push_back(static_cast<uint32_t>(patch.holes[h]));
        }
      }
    }

    for (const uint32_t index : geo::earcut(flat, holes)) {
      const size_t k = static_cast<size_t>(index) * 2;
      if (k + 1 >= flat.size()) continue;
      positions_.push_back(static_cast<float>(flat[k] - x_ref_));
      positions_.push_back(static_cast<float>(flat[k + 1] - y_ref_));
      colors_.push_back(rgba.r);
      colors_.push_back(rgba.g);
      colors_.push_back(rgba.b);
      colors_.push_back(rgba.a);
    }

    // Bounds come from the ring, not from the triangles: a patch whose
    // triangulation failed still occupies space on the axis.
    for (size_t i = 0; i < n; ++i) {
      if (!finite(patch.x[i]) || !finite(patch.y[i])) continue;
      min_x = std::min(min_x, patch.x[i]);
      max_x = std::max(max_x, patch.x[i]);
      min_y = std::min(min_y, patch.y[i]);
      max_y = std::max(max_y, patch.y[i]);
      has_bounds_ = true;
    }
  }

  if (has_bounds_) {
    x_bounds_ = ph_range{min_x, max_x};
    y_bounds_ = ph_range{min_y, max_y};
  }
}

bool PatchesLayer::color_info(ColorInfo& out) const {
  if (!color_lut_) return false;
  out.lut = color_lut_;
  out.domain = value_domain_;
  out.label = name_;
  return true;
}

bool PatchesLayer::bounds(ph_range& x, ph_range& y) const {
  if (!has_bounds_) return false;
  x = x_bounds_;
  y = y_bounds_;
  return true;
}

bool PatchesLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &position_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (vao_ == 0) {
      error = "failed to create patches layer vertex array";
      return false;
    }
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, position_buffer_);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, position_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(positions_.size() * sizeof(float)),
                   positions_.empty() ? nullptr : positions_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors_.size() * sizeof(float)),
                   colors_.empty() ? nullptr : colors_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool PatchesLayer::draw(const DrawState& state, std::string& error) {
  if (positions_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms({});
  const Program* program = get_program(api, "fill", vertex_source(kFillVertBody, kFillVertMain),
                                       kFillFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(positions_.size() / 2));
  api.BindVertexArray(0);
  return true;
}

void PatchesLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  const GLuint buffers[] = {position_buffer_, color_buffer_};
  api.DeleteBuffers(2, buffers);
  vao_ = 0;
  position_buffer_ = color_buffer_ = 0;
  dirty_ = true;
}

// -- AreaLayer --------------------------------------------------------------

AreaLayer::AreaLayer(const ph_area_desc& desc) {
  set_data(desc);
}

void AreaLayer::set_data(const ph_area_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  // The core's default is a translucent blue rather than the opaque series
  // colour: an area is drawn under something, and an opaque one hides it.
  color_ = desc.color != PH_COLOR_AUTO ? desc.color : kDefaultAreaColor;
  render_type_ = desc.render_type;
  base_value_ = desc.base_value;

  if (desc.count > 0 && desc.x && desc.y) {
    x_.assign(desc.x, desc.x + desc.count);
    y_.assign(desc.y, desc.y + desc.count);
    if (desc.base) base_.assign(desc.base, desc.base + desc.count);
  }
  build();
}

void AreaLayer::build() {
  const size_t n = std::min(x_.size(), y_.size());
  strip_.clear();
  area_bounds_ = false;
  if (n == 0) {
    dirty_ = true;
    return;
  }

  x_ref_ = x_[0];
  y_ref_ = y_[0];
  strip_.resize(n * 4);

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;

  for (size_t i = 0; i < n; ++i) {
    const double x = x_[i];
    const double base = i < base_.size() ? base_[i] : base_value_;
    const double top = y_[i];
    // Two vertices per sample, base then top: a strip drawn this way fills the
    // band without an index buffer or a second pass.
    strip_[i * 4] = static_cast<float>(x - x_ref_);
    strip_[i * 4 + 1] = static_cast<float>(base - y_ref_);
    strip_[i * 4 + 2] = static_cast<float>(x - x_ref_);
    strip_[i * 4 + 3] = static_cast<float>(top - y_ref_);
    if (!finite(x) || !finite(base) || !finite(top)) continue;
    min_x = std::min(min_x, x);
    max_x = std::max(max_x, x);
    min_y = std::min({min_y, base, top});
    max_y = std::max({max_y, base, top});
    area_bounds_ = true;
  }
  if (area_bounds_) {
    area_x_ = ph_range{min_x, max_x};
    area_y_ = ph_range{min_y, max_y};
  }
  dirty_ = true;
}

bool AreaLayer::bounds(ph_range& x, ph_range& y) const {
  if (!area_bounds_) return false;
  x = area_x_;
  y = area_y_;
  return true;
}

bool AreaLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0) {
      error = "failed to create area layer vertex array";
      return false;
    }
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindVertexArray(0);
  }
  if (dirty_) {
    api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(strip_.size() * sizeof(float)),
                   strip_.empty() ? nullptr : strip_.data(), buffer_usage(render_type_));
    dirty_ = false;
  }
  return true;
}

bool AreaLayer::draw(const DrawState& state, std::string& error) {
  if (strip_.size() < 8 || !state.api) return true;  // fewer than two samples
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms({"uColor"});
  const Program* program = get_program(api, "area", vertex_source(kAreaVertBody, kAreaVertMain),
                                       kAreaFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  const Rgba color = unpack_color_exact(color_);
  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(program->uniform("uColor"), color.r, color.g, color.b, color.a);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLE_STRIP, 0, static_cast<GLsizei>(strip_.size() / 2));
  api.BindVertexArray(0);
  return true;
}

void AreaLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- BarLayer ---------------------------------------------------------------

BarLayer::BarLayer(const ph_bar_desc& desc) {
  set_data(desc);
}

void BarLayer::set_data(const ph_bar_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  render_type_ = desc.render_type;
  base_value_ = desc.base_value;
  width_ = desc.width;
  offset_ = desc.offset;
  orientation_ = desc.orientation;

  if (desc.count > 0 && desc.x && desc.y) {
    x_.assign(desc.x, desc.x + desc.count);
    y_.assign(desc.y, desc.y + desc.count);
    if (desc.base) base_.assign(desc.base, desc.base + desc.count);
  }

  const size_t n = std::min(x_.size(), y_.size());
  const Rgba fallback = unpack_color(color_);
  bar_colors_.resize(n * 4);
  for (size_t i = 0; i < n; ++i) {
    const Rgba c = desc.colors ? unpack_color_exact(desc.colors[i]) : fallback;
    bar_colors_[i * 4] = c.r;
    bar_colors_[i * 4 + 1] = c.g;
    bar_colors_[i * 4 + 2] = c.b;
    bar_colors_[i * 4 + 3] = c.a;
  }
  build();
}

void BarLayer::build() {
  const size_t n = std::min(x_.size(), y_.size());
  rects_.clear();
  bar_bounds_ = false;
  if (n == 0) {
    dirty_ = true;
    return;
  }

  // Default width is 80% of the median spacing, so bars touch without merging.
  double width = width_;
  if (!(width > 0.0)) {
    if (n < 2) {
      width = 0.8;
    } else {
      std::vector<double> gaps;
      gaps.reserve(n - 1);
      for (size_t i = 1; i < n; ++i) gaps.push_back(std::abs(x_[i] - x_[i - 1]));
      std::sort(gaps.begin(), gaps.end());
      const double median = gaps[gaps.size() / 2];
      width = (median > 0.0 ? median : 1.0) * 0.8;
    }
  }

  const bool horizontal = orientation_ == PH_ORIENT_HORIZONTAL;
  // The position axis references x[0] and the value axis y[0]; which of the two
  // is the plot's x depends on the orientation.
  const double position_ref = x_[0];
  const double value_ref = y_[0];
  x_ref_ = horizontal ? value_ref : position_ref;
  y_ref_ = horizontal ? position_ref : value_ref;

  rects_.resize(n * 4);
  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;

  for (size_t i = 0; i < n; ++i) {
    const double centre = x_[i] + offset_;
    const double p0 = centre - width / 2.0;
    const double p1 = centre + width / 2.0;
    const double base = i < base_.size() ? base_[i] : base_value_;
    const double value = y_[i];

    const double ax0 = horizontal ? base : p0;
    const double ax1 = horizontal ? value : p1;
    const double ay0 = horizontal ? p0 : base;
    const double ay1 = horizontal ? p1 : value;

    rects_[i * 4] = static_cast<float>(ax0 - x_ref_);
    rects_[i * 4 + 1] = static_cast<float>(ay0 - y_ref_);
    rects_[i * 4 + 2] = static_cast<float>(ax1 - x_ref_);
    rects_[i * 4 + 3] = static_cast<float>(ay1 - y_ref_);

    if (!finite(ax0) || !finite(ax1) || !finite(ay0) || !finite(ay1)) continue;
    min_x = std::min({min_x, ax0, ax1});
    max_x = std::max({max_x, ax0, ax1});
    min_y = std::min({min_y, ay0, ay1});
    max_y = std::max({max_y, ay0, ay1});
    bar_bounds_ = true;
  }
  if (bar_bounds_) {
    bar_x_ = ph_range{min_x, max_x};
    bar_y_ = ph_range{min_y, max_y};
  }
  dirty_ = true;
}

bool BarLayer::bounds(ph_range& x, ph_range& y) const {
  if (!bar_bounds_) return false;
  x = bar_x_;
  y = bar_y_;
  return true;
}

bool BarLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &rect_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (vao_ == 0) {
      error = "failed to create bar layer vertex array";
      return false;
    }
    api.BindVertexArray(vao_);

    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kUnitCorners)), kUnitCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);

    api.BindBuffer(GL_ARRAY_BUFFER, rect_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);

    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);

    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, rect_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(rects_.size() * sizeof(float)),
                   rects_.empty() ? nullptr : rects_.data(), usage);
    // The colour attribute must cover every instance even when the caller gave
    // none, or the divisor reads past the end of the buffer.
    std::vector<float> colors = bar_colors_;
    colors.resize(rects_.size(), 0.0f);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors.size() * sizeof(float)),
                   colors.empty() ? nullptr : colors.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool BarLayer::draw(const DrawState& state, std::string& error) {
  if (rects_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms({});
  const Program* program = get_program(api, "bar", vertex_source(kBarVertBody, kBarVertMain),
                                       kBarFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.BindVertexArray(vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(rects_.size() / 4));
  api.BindVertexArray(0);
  return true;
}

void BarLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  const GLuint buffers[] = {corner_buffer_, rect_buffer_, color_buffer_};
  api.DeleteBuffers(3, buffers);
  vao_ = 0;
  corner_buffer_ = rect_buffer_ = color_buffer_ = 0;
  dirty_ = true;
}

// -- PieLayer ---------------------------------------------------------------

PieLayer::PieLayer(const ph_pie_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;
  centre_x_ = desc.center_x;
  centre_y_ = desc.center_y;
  radius_ = desc.radius > 0.0 ? desc.radius : 1.0;
  const double inner = std::max(0.0, desc.inner_radius);
  // Zero means twelve o'clock rather than three, because that is where a pie
  // chart starts and because it keeps the zero-initialized rule true.
  const double start = desc.start_angle != 0.0 ? desc.start_angle : kPi / 2.0;

  const int32_t n = desc.values ? std::max(0, desc.count) : 0;
  double total = 0.0;
  for (int32_t i = 0; i < n; ++i) total += std::max(0.0, desc.values[i]);
  if (!(total > 0.0)) total = 1.0;

  const auto push = [&](double x, double y, const Rgba& c) {
    positions_.push_back(static_cast<float>(x - centre_x_));
    positions_.push_back(static_cast<float>(y - centre_y_));
    colors_.push_back(c.r);
    colors_.push_back(c.g);
    colors_.push_back(c.b);
    colors_.push_back(c.a);
  };

  double a0 = start;
  for (int32_t i = 0; i < n; ++i) {
    const double span = std::max(0.0, desc.values[i]) / total * 2.0 * kPi;
    if (span <= 0.0) continue;
    const double a1 = a0 - span;  // clockwise
    const Rgba colour = desc.colors ? unpack_color_exact(desc.colors[i])
                                    : unpack_color_exact(kPiePalette[static_cast<size_t>(i) % kPiePaletteSize]);

    // One segment per ~3 degrees, so even a thin slice has a straight edge and
    // a fat one does not show its polygon.
    const int segments = std::max(2, static_cast<int>(std::ceil(span / (kPi / 64.0))));
    for (int s = 0; s < segments; ++s) {
      const double t0 = a0 + (a1 - a0) * s / segments;
      const double t1 = a0 + (a1 - a0) * (s + 1) / segments;
      const double ox0 = centre_x_ + radius_ * std::cos(t0);
      const double oy0 = centre_y_ + radius_ * std::sin(t0);
      const double ox1 = centre_x_ + radius_ * std::cos(t1);
      const double oy1 = centre_y_ + radius_ * std::sin(t1);
      if (inner <= 0.0) {
        push(centre_x_, centre_y_, colour);
        push(ox0, oy0, colour);
        push(ox1, oy1, colour);
      } else {
        const double ix0 = centre_x_ + inner * std::cos(t0);
        const double iy0 = centre_y_ + inner * std::sin(t0);
        const double ix1 = centre_x_ + inner * std::cos(t1);
        const double iy1 = centre_y_ + inner * std::sin(t1);
        push(ix0, iy0, colour);
        push(ox0, oy0, colour);
        push(ox1, oy1, colour);
        push(ix0, iy0, colour);
        push(ox1, oy1, colour);
        push(ix1, iy1, colour);
      }
    }
    a0 = a1;
  }
}

bool PieLayer::bounds(ph_range& x, ph_range& y) const {
  if (positions_.empty()) return false;
  x = ph_range{centre_x_ - radius_, centre_x_ + radius_};
  y = ph_range{centre_y_ - radius_, centre_y_ + radius_};
  return true;
}

bool PieLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &position_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (vao_ == 0) {
      error = "failed to create pie layer vertex array";
      return false;
    }
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, position_buffer_);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.BindVertexArray(0);
  }
  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, position_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(positions_.size() * sizeof(float)),
                   positions_.empty() ? nullptr : positions_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors_.size() * sizeof(float)),
                   colors_.empty() ? nullptr : colors_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool PieLayer::draw(const DrawState& state, std::string& error) {
  if (positions_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms({});
  const Program* program = get_program(api, "fill", vertex_source(kFillVertBody, kFillVertMain),
                                       kFillFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, centre_x_, centre_y_);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(positions_.size() / 2));
  api.BindVertexArray(0);
  return true;
}

void PieLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  const GLuint buffers[] = {position_buffer_, color_buffer_};
  api.DeleteBuffers(2, buffers);
  vao_ = 0;
  position_buffer_ = color_buffer_ = 0;
  dirty_ = true;
}

// -- StemLayer --------------------------------------------------------------

StemLayer::StemLayer(const ph_stem_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  render_type_ = desc.render_type;
  baseline_ = desc.baseline;
  if (desc.width > 0.0f) width_ = desc.width;
  // Negative hides the tip; zero is the default, which keeps a zero-initialized
  // struct meaning "the core's defaults" rather than "no markers".
  if (desc.marker_size != 0.0f) marker_size_ = std::max(0.0f, desc.marker_size);

  if (desc.count > 0 && desc.x && desc.y) {
    x_.assign(desc.x, desc.x + desc.count);
    y_.assign(desc.y, desc.y + desc.count);
  }
  build();
}

void StemLayer::build() {
  const size_t n = std::min(x_.size(), y_.size());
  segments_.clear();
  packed_.clear();
  stem_bounds_ = false;
  // Stems fill their own buffers rather than going through XYLayer::rebuild, so
  // the sortedness the binary-search pick relies on has to be worked out here —
  // left at its default it would claim sorted for data that is not.
  monotonic_ = true;
  for (size_t i = 1; i < n; ++i) {
    if (x_[i] < x_[i - 1]) {
      monotonic_ = false;
      break;
    }
  }
  if (n == 0) {
    dirty_ = true;
    return;
  }

  x_ref_ = x_[0];
  y_ref_ = y_[0];
  segments_.resize(n * 4);
  packed_.resize(n * 2);

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;

  for (size_t i = 0; i < n; ++i) {
    const float x = static_cast<float>(x_[i] - x_ref_);
    segments_[i * 4] = x;
    segments_[i * 4 + 1] = static_cast<float>(baseline_ - y_ref_);
    segments_[i * 4 + 2] = x;
    segments_[i * 4 + 3] = static_cast<float>(y_[i] - y_ref_);
    packed_[i * 2] = x;
    packed_[i * 2 + 1] = static_cast<float>(y_[i] - y_ref_);

    if (!finite(x_[i]) || !finite(y_[i])) continue;
    min_x = std::min(min_x, x_[i]);
    max_x = std::max(max_x, x_[i]);
    min_y = std::min({min_y, y_[i], baseline_});
    max_y = std::max({max_y, y_[i], baseline_});
    stem_bounds_ = true;
  }
  if (stem_bounds_) {
    stem_x_ = ph_range{min_x, max_x};
    stem_y_ = ph_range{min_y, max_y};
  }
  dirty_ = true;
}

bool StemLayer::bounds(ph_range& x, ph_range& y) const {
  if (!stem_bounds_) return false;
  x = stem_x_;
  y = stem_y_;
  return true;
}

bool StemLayer::pick(PickMode mode, double cursor_px, double cursor_py,
                     const PickProjection& project, Picked& out) const {
  return pick_nearest(x_, y_, mode, cursor_px, cursor_py, project,
                      std::numeric_limits<double>::infinity(), monotonic_, out);
}

bool StemLayer::ensure_gl(Api& api, std::string& error) {
  if (stem_vao_ == 0) {
    api.GenVertexArrays(1, &stem_vao_);
    api.GenVertexArrays(1, &marker_vao_);
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &quad_buffer_);
    api.GenBuffers(1, &segment_buffer_);
    api.GenBuffers(1, &tip_buffer_);
    if (stem_vao_ == 0 || marker_vao_ == 0) {
      error = "failed to create stem layer vertex arrays";
      return false;
    }

    api.BindVertexArray(stem_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kLineCorners)), kLineCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, segment_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);

    api.BindVertexArray(marker_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, quad_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kQuadCorners)), kQuadCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, tip_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 2, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);

    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, segment_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(segments_.size() * sizeof(float)),
                   segments_.empty() ? nullptr : segments_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, tip_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(packed_.size() * sizeof(float)),
                   packed_.empty() ? nullptr : packed_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool StemLayer::draw(const DrawState& state, std::string& error) {
  if (segments_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  const Rgba colour = unpack_color(color_);
  const GLsizei count = static_cast<GLsizei>(segments_.size() / 4);

  static const std::vector<std::string> kStemUniforms =
      with_transform_uniforms({"uColor", "uResolution", "uWidth"});
  const Program* stem = get_program(api, "stem", vertex_source(kStemVertBody, kStemVertMain),
                                    kStemFrag, kStemUniforms, state.gfx, error);
  if (!stem) return false;
  api.UseProgram(stem->id);
  set_transform_uniforms(api, *stem, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(stem->uniform("uColor"), colour.r, colour.g, colour.b, colour.a);
  api.Uniform2f(stem->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(stem->uniform("uWidth"), width_ * state.dpr);
  api.BindVertexArray(stem_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, count);
  api.BindVertexArray(0);

  if (marker_size_ <= 0.0f) return true;

  // The tips reuse the scatter program with a fixed circle marker: a disc at
  // the end of a stalk is exactly a one-marker scatter, and a second shader
  // would be the same arithmetic written twice.
  static const std::vector<std::string> kMarkerUniforms = with_transform_uniforms(
      {"uColor", "uResolution", "uSize", "uDpr", "uUseVertexColor", "uMarker"});
  const Program* marker = get_program(api, "stem-marker",
                                      vertex_source(kStemMarkerVertBody, kStemMarkerVertMain),
                                      kStemMarkerFrag, kMarkerUniforms, state.gfx, error);
  if (!marker) return false;
  api.UseProgram(marker->id);
  set_transform_uniforms(api, *marker, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(marker->uniform("uColor"), colour.r, colour.g, colour.b, colour.a);
  api.Uniform2f(marker->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(marker->uniform("uSize"), (marker_size_ / 2.0f) * state.dpr);
  api.BindVertexArray(marker_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, count);
  api.BindVertexArray(0);
  return true;
}

void StemLayer::release_gl(Api& api) {
  if (stem_vao_ == 0) return;
  const GLuint vaos[] = {stem_vao_, marker_vao_};
  api.DeleteVertexArrays(2, vaos);
  const GLuint buffers[] = {corner_buffer_, quad_buffer_, segment_buffer_, tip_buffer_};
  api.DeleteBuffers(4, buffers);
  stem_vao_ = marker_vao_ = 0;
  corner_buffer_ = quad_buffer_ = segment_buffer_ = tip_buffer_ = 0;
  dirty_ = true;
}

// -- ErrorBarLayer ----------------------------------------------------------

ErrorBarLayer::ErrorBarLayer(const ph_errorbar_desc& desc) {
  set_data(desc);
}

void ErrorBarLayer::set_data(const ph_errorbar_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  render_type_ = desc.render_type;
  if (desc.width > 0.0f) width_ = desc.width;
  // Negative hides the caps; zero keeps a zero-initialized struct meaning the
  // core's default rather than "no caps".
  if (desc.cap_size != 0.0f) cap_size_ = std::max(0.0f, desc.cap_size);
  if (desc.band_opacity > 0.0f) band_opacity_ = std::min(desc.band_opacity, 1.0f);
  whiskers_ = desc.no_whiskers == 0;
  show_band_ = desc.band != 0;

  const size_t n =
      (desc.count > 0 && desc.x && desc.y) ? static_cast<size_t>(desc.count) : 0;
  if (n == 0) return;
  x_.assign(desc.x, desc.x + n);
  y_.assign(desc.y, desc.y + n);
  x_ref_ = x_[0];
  y_ref_ = y_[0];

  // An error is a per-point array when one is given and a single number
  // otherwise; the asymmetric arrays win over the symmetric one, which is how
  // the core resolves the same four options.
  const auto err_at = [](const double* array, double scalar, size_t i) {
    return array ? array[i] : scalar;
  };
  const bool has_y = desc.y_err_array || desc.y_err_low_array || desc.y_err_high_array ||
                     desc.y_err != 0.0;
  const bool has_x = desc.x_err_array || desc.x_err != 0.0;

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;

  segments_.reserve(n * 8);
  caps_.reserve(n * 6);
  band_strip_.reserve(n * 4);
  for (size_t i = 0; i < n; ++i) {
    const double x = x_[i];
    const double y = y_[i];
    const double e_lo = desc.y_err_low_array ? desc.y_err_low_array[i]
                                             : err_at(desc.y_err_array, desc.y_err, i);
    const double e_hi = desc.y_err_high_array ? desc.y_err_high_array[i]
                                              : err_at(desc.y_err_array, desc.y_err, i);
    const double e_x = err_at(desc.x_err_array, desc.x_err, i);
    const double y_lo = y - e_lo;
    const double y_hi = y + e_hi;
    const double x_lo = x - e_x;
    const double x_hi = x + e_x;

    const float ox = static_cast<float>(x - x_ref_);
    const float oy = static_cast<float>(y - y_ref_);
    const float oy_lo = static_cast<float>(y_lo - y_ref_);
    const float oy_hi = static_cast<float>(y_hi - y_ref_);

    if (has_y) {
      segments_.insert(segments_.end(), {ox, oy_lo, ox, oy_hi});
      caps_.insert(caps_.end(), {ox, oy_lo, 0.0f, ox, oy_hi, 0.0f});
    }
    if (has_x) {
      const float ox_lo = static_cast<float>(x_lo - x_ref_);
      const float ox_hi = static_cast<float>(x_hi - x_ref_);
      segments_.insert(segments_.end(), {ox_lo, oy, ox_hi, oy});
      caps_.insert(caps_.end(), {ox_lo, oy, 1.0f, ox_hi, oy, 1.0f});
    }
    // The band is a strip alternating high/low along x, so it exists whether or
    // not it is drawn — cheap, and it means toggling `band` needs no rebuild.
    band_strip_.insert(band_strip_.end(), {ox, oy_hi, ox, oy_lo});

    if (!finite(x_lo) || !finite(x_hi) || !finite(y_lo) || !finite(y_hi)) continue;
    min_x = std::min(min_x, x_lo);
    max_x = std::max(max_x, x_hi);
    min_y = std::min(min_y, y_lo);
    max_y = std::max(max_y, y_hi);
    err_bounds_ = true;
  }
  if (err_bounds_) {
    err_x_ = ph_range{min_x, max_x};
    err_y_ = ph_range{min_y, max_y};
  }
}

bool ErrorBarLayer::bounds(ph_range& x, ph_range& y) const {
  if (!err_bounds_) return false;
  x = err_x_;
  y = err_y_;
  return true;
}

bool ErrorBarLayer::ensure_gl(Api& api, std::string& error) {
  if (seg_vao_ == 0) {
    api.GenVertexArrays(1, &seg_vao_);
    api.GenVertexArrays(1, &cap_vao_);
    api.GenVertexArrays(1, &band_vao_);
    api.GenBuffers(1, &seg_corner_buffer_);
    api.GenBuffers(1, &quad_corner_buffer_);
    api.GenBuffers(1, &seg_buffer_);
    api.GenBuffers(1, &cap_buffer_);
    api.GenBuffers(1, &band_buffer_);
    if (seg_vao_ == 0 || cap_vao_ == 0 || band_vao_ == 0) {
      error = "failed to create error bar vertex arrays";
      return false;
    }

    api.BindVertexArray(seg_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, seg_corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kLineCorners)), kLineCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, seg_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);

    api.BindVertexArray(cap_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, quad_corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kQuadCorners)), kQuadCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, cap_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 3, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);

    api.BindVertexArray(band_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, band_buffer_);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);

    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, seg_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(segments_.size() * sizeof(float)),
                   segments_.empty() ? nullptr : segments_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, cap_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(caps_.size() * sizeof(float)),
                   caps_.empty() ? nullptr : caps_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, band_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(band_strip_.size() * sizeof(float)),
                   band_strip_.empty() ? nullptr : band_strip_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool ErrorBarLayer::draw(const DrawState& state, std::string& error) {
  if (!err_bounds_ || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  const Rgba colour = unpack_color(color_);

  if (show_band_ && band_strip_.size() >= 8) {
    // The band is the area layer's program: a triangle strip in data space
    // under one colour, which is what an area already is.
    static const std::vector<std::string> kBandUniforms = with_transform_uniforms({"uColor"});
    const Program* band = get_program(api, "area", vertex_source(kAreaVertBody, kAreaVertMain),
                                      kAreaFrag, kBandUniforms, state.gfx, error);
    if (!band) return false;
    api.UseProgram(band->id);
    set_transform_uniforms(api, *band, state.x, state.y, x_ref_, y_ref_);
    api.Uniform4f(band->uniform("uColor"), colour.r, colour.g, colour.b,
                  colour.a * band_opacity_);
    api.BindVertexArray(band_vao_);
    api.DrawArrays(GL_TRIANGLE_STRIP, 0, static_cast<GLsizei>(band_strip_.size() / 2));
    api.BindVertexArray(0);
  }

  if (!whiskers_ || segments_.empty()) return true;

  // The whiskers are the stem layer's program, for the same reason: a whisker
  // and a stem are both a data-space segment given a pixel width.
  static const std::vector<std::string> kSegUniforms =
      with_transform_uniforms({"uColor", "uResolution", "uWidth"});
  const Program* seg = get_program(api, "stem", vertex_source(kStemVertBody, kStemVertMain),
                                   kStemFrag, kSegUniforms, state.gfx, error);
  if (!seg) return false;
  api.UseProgram(seg->id);
  set_transform_uniforms(api, *seg, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(seg->uniform("uColor"), colour.r, colour.g, colour.b, colour.a);
  api.Uniform2f(seg->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(seg->uniform("uWidth"), width_ * state.dpr);
  api.BindVertexArray(seg_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(segments_.size() / 4));
  api.BindVertexArray(0);

  if (cap_size_ <= 0.0f || caps_.empty()) return true;

  static const std::vector<std::string> kCapUniforms =
      with_transform_uniforms({"uColor", "uResolution", "uCapSize", "uWidth"});
  const Program* cap = get_program(api, "errorbar-cap", vertex_source(kCapVertBody, kCapVertMain),
                                   kStemFrag, kCapUniforms, state.gfx, error);
  if (!cap) return false;
  api.UseProgram(cap->id);
  set_transform_uniforms(api, *cap, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(cap->uniform("uColor"), colour.r, colour.g, colour.b, colour.a);
  api.Uniform2f(cap->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(cap->uniform("uCapSize"), cap_size_ * state.dpr);
  api.Uniform1f(cap->uniform("uWidth"), width_ * state.dpr);
  api.BindVertexArray(cap_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(caps_.size() / 3));
  api.BindVertexArray(0);
  return true;
}

void ErrorBarLayer::release_gl(Api& api) {
  if (seg_vao_ == 0) return;
  const GLuint vaos[] = {seg_vao_, cap_vao_, band_vao_};
  api.DeleteVertexArrays(3, vaos);
  const GLuint buffers[] = {seg_corner_buffer_, quad_corner_buffer_, seg_buffer_, cap_buffer_,
                            band_buffer_};
  api.DeleteBuffers(5, buffers);
  seg_vao_ = cap_vao_ = band_vao_ = 0;
  seg_corner_buffer_ = quad_corner_buffer_ = seg_buffer_ = cap_buffer_ = band_buffer_ = 0;
  dirty_ = true;
}

// -- BoxLayer ---------------------------------------------------------------

BoxLayer::BoxLayer(const ph_box_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;
  const double half = (desc.width > 0.0 ? desc.width : 0.6) / 2.0;
  const bool show_box = desc.no_box == 0;
  const bool show_violin = desc.violin != 0;

  const size_t groups =
      desc.groups && desc.group_count > 0 ? static_cast<size_t>(desc.group_count) : 0;
  if (groups == 0) return;
  x_ref_ = desc.groups[0].position;
  y_ref_ = desc.groups[0].values && desc.groups[0].count > 0 ? desc.groups[0].values[0] : 0.0;
  if (!finite(x_ref_)) x_ref_ = 0.0;
  if (!finite(y_ref_)) y_ref_ = 0.0;

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;
  const auto track = [&](double x, double y) {
    if (!finite(x) || !finite(y)) return;
    min_x = std::min(min_x, x);
    max_x = std::max(max_x, x);
    min_y = std::min(min_y, y);
    max_y = std::max(max_y, y);
    box_bounds_ = true;
  };

  std::vector<float> triangles;
  std::vector<float> lines;
  std::vector<float> points;
  const auto push = [&](std::vector<float>& into, double x, double y, const Rgba& c) {
    into.push_back(static_cast<float>(x - x_ref_));
    into.push_back(static_cast<float>(y - y_ref_));
    into.push_back(c.r);
    into.push_back(c.g);
    into.push_back(c.b);
    into.push_back(c.a);
  };

  for (size_t g = 0; g < groups; ++g) {
    const ph_box_group& group = desc.groups[g];
    // A non-finite position makes every vertex in the group NaN, and a plot
    // that silently draws nothing is worse to debug than one that draws the
    // rest — so this group is skipped and the others still appear.
    if (!finite(group.position)) continue;
    const stats::BoxStats box = stats::box_stats(
        group.values, group.count > 0 ? static_cast<size_t>(group.count) : 0);
    if (!box.valid) continue;

    const Rgba stroke = unpack_color(group.color);
    Rgba fill = stroke;
    fill.a = 0.35f;

    const double cx = group.position;
    track(cx - half, box.whisker_lo);
    track(cx + half, box.whisker_hi);

    if (show_violin) {
      const stats::Density d = stats::kde(group.values,
                                          group.count > 0 ? static_cast<size_t>(group.count) : 0,
                                          box.min, box.max, 48);
      double peak = 0.0;
      for (const double v : d.ys) peak = std::max(peak, v);
      if (peak <= 0.0) peak = 1.0;
      for (size_t i = 0; i + 1 < d.xs.size(); ++i) {
        const double w0 = (d.ys[i] / peak) * half;
        const double w1 = (d.ys[i + 1] / peak) * half;
        const double y0 = d.xs[i];
        const double y1 = d.xs[i + 1];
        push(triangles, cx - w0, y0, fill);
        push(triangles, cx + w0, y0, fill);
        push(triangles, cx + w1, y1, fill);
        push(triangles, cx - w0, y0, fill);
        push(triangles, cx + w1, y1, fill);
        push(triangles, cx - w1, y1, fill);
      }
      track(cx - half, box.min);
      track(cx + half, box.max);
    }

    if (!show_box) continue;

    const double x0 = cx - half;
    const double x1 = cx + half;
    // A violin already fills the middle; drawing the body over it would only
    // darken the same pixels.
    if (!show_violin) {
      push(triangles, x0, box.q1, fill);
      push(triangles, x1, box.q1, fill);
      push(triangles, x1, box.q3, fill);
      push(triangles, x0, box.q1, fill);
      push(triangles, x1, box.q3, fill);
      push(triangles, x0, box.q3, fill);
    }

    const double edges[4][4] = {{x0, box.q1, x1, box.q1},
                                {x1, box.q1, x1, box.q3},
                                {x1, box.q3, x0, box.q3},
                                {x0, box.q3, x0, box.q1}};
    for (const auto& e : edges) {
      push(lines, e[0], e[1], stroke);
      push(lines, e[2], e[3], stroke);
    }
    push(lines, x0, box.median, stroke);
    push(lines, x1, box.median, stroke);
    push(lines, cx, box.q3, stroke);
    push(lines, cx, box.whisker_hi, stroke);
    push(lines, cx, box.q1, stroke);
    push(lines, cx, box.whisker_lo, stroke);
    const double cap_half = half * 0.5;
    push(lines, cx - cap_half, box.whisker_hi, stroke);
    push(lines, cx + cap_half, box.whisker_hi, stroke);
    push(lines, cx - cap_half, box.whisker_lo, stroke);
    push(lines, cx + cap_half, box.whisker_lo, stroke);

    for (const double outlier : box.outliers) {
      push(points, cx, outlier, stroke);
      track(cx, outlier);
    }
  }

  // One buffer, three runs: triangles, then lines, then points, so drawing is
  // three calls into one binding rather than three bindings.
  triangle_count_ = triangles.size() / 6;
  line_start_ = triangle_count_;
  line_count_ = lines.size() / 6;
  point_start_ = line_start_ + line_count_;
  point_count_ = points.size() / 6;
  vertices_.reserve(triangles.size() + lines.size() + points.size());
  vertices_.insert(vertices_.end(), triangles.begin(), triangles.end());
  vertices_.insert(vertices_.end(), lines.begin(), lines.end());
  vertices_.insert(vertices_.end(), points.begin(), points.end());

  if (box_bounds_) {
    box_x_ = ph_range{min_x, max_x};
    box_y_ = ph_range{min_y, max_y};
  }
}

bool BoxLayer::bounds(ph_range& x, ph_range& y) const {
  if (!box_bounds_) return false;
  x = box_x_;
  y = box_y_;
  return true;
}

bool BoxLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0) {
      error = "failed to create box layer vertex array";
      return false;
    }
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
    const GLsizei stride = 6 * static_cast<GLsizei>(sizeof(float));
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, stride, nullptr);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, stride,
                            reinterpret_cast<const void*>(2 * sizeof(float)));
    api.BindVertexArray(0);
  }
  if (dirty_) {
    api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                   vertices_.empty() ? nullptr : vertices_.data(), buffer_usage(render_type_));
    dirty_ = false;
  }
  return true;
}

bool BoxLayer::draw(const DrawState& state, std::string& error) {
  if (vertices_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms =
      with_transform_uniforms({"uPointSize", "uIsPoint"});
  const Program* program = get_program(api, "box", vertex_source(kBoxVertBody, kBoxVertMain),
                                       kBoxFrag, kUniforms, state.gfx, error);
  if (!program) return false;

  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.Uniform1f(program->uniform("uPointSize"), 5.0f * state.dpr);
  api.BindVertexArray(vao_);

  api.Uniform1f(program->uniform("uIsPoint"), 0.0f);
  if (triangle_count_ > 0) {
    api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(triangle_count_));
  }
  if (line_count_ > 0) {
    api.DrawArrays(GL_LINES, static_cast<GLint>(line_start_),
                   static_cast<GLsizei>(line_count_));
  }
  if (point_count_ > 0) {
    // gl_PointSize is always live in WebGL2 and gated in a desktop core
    // profile. Without this enable the outliers come out as single pixels,
    // which reads as a rendering artefact rather than a missing GL state.
    api.Enable(GL_PROGRAM_POINT_SIZE);
    api.Uniform1f(program->uniform("uIsPoint"), 1.0f);
    api.DrawArrays(GL_POINTS, static_cast<GLint>(point_start_),
                   static_cast<GLsizei>(point_count_));
    api.Disable(GL_PROGRAM_POINT_SIZE);
  }
  api.BindVertexArray(0);
  return true;
}

void BoxLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}


// -- textured quads (heatmap, image) ----------------------------------------

namespace {

/// The six vertices of the extent quad: (x, y, u, v), with v following the
/// texture's row order. `flip_v` puts the first row at the top instead.
std::array<float, 24> extent_quad(const ph_range& x, const ph_range& y, double x_ref,
                                  double y_ref, bool flip_v) {
  const float x0 = static_cast<float>(x.lo - x_ref);
  const float x1 = static_cast<float>(x.hi - x_ref);
  const float y0 = static_cast<float>(y.lo - y_ref);
  const float y1 = static_cast<float>(y.hi - y_ref);
  const float v0 = flip_v ? 1.0f : 0.0f;
  const float v1 = flip_v ? 0.0f : 1.0f;
  return {x0, y0, 0.0f, v0, x1, y0, 1.0f, v0, x1, y1, 1.0f, v1,
          x0, y0, 0.0f, v0, x1, y1, 1.0f, v1, x0, y1, 0.0f, v1};
}

/// The textured-quad program, shared by both layers. The fragment shader
/// premultiplies, because that is the blend mode the whole renderer is in.
const char* const kTexVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;
out vec2 vUV;
)";

const char* const kTexVertMain = R"(
void main() {
  vUV = aUV;
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
})";

const char* const kTexFrag = R"(#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  float a = c.a * uOpacity;
  outColor = vec4(c.rgb * a, a);
})";

/// Create the VAO, buffer and texture a quad layer needs. Shared because the
/// two layers differ in what they put in the texture, not in how they bind it.
bool make_quad(Api& api, const std::array<float, 24>& quad, const std::vector<uint8_t>& texels,
               int32_t width, int32_t height, bool smooth, GLuint& vao, GLuint& buffer,
               GLuint& texture, std::string& error) {
  api.GenVertexArrays(1, &vao);
  api.GenBuffers(1, &buffer);
  api.GenTextures(1, &texture);
  if (vao == 0 || texture == 0) {
    error = "failed to create texture layer resources";
    return false;
  }

  api.BindVertexArray(vao);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(quad.size() * sizeof(float)),
                 quad.data(), GL_STATIC_DRAW);
  const GLsizei stride = 4 * static_cast<GLsizei>(sizeof(float));
  api.EnableVertexAttribArray(0);
  api.VertexAttribPointer(0, 2, GL_FLOAT, 0, stride, nullptr);
  api.EnableVertexAttribArray(1);
  api.VertexAttribPointer(1, 2, GL_FLOAT, 0, stride,
                          reinterpret_cast<const void*>(2 * sizeof(float)));
  api.BindVertexArray(0);

  const GLint filter = smooth ? GL_LINEAR : GL_NEAREST;
  api.BindTexture(GL_TEXTURE_2D, texture);
  // Rows are tightly packed and a grid is rarely a multiple of four wide, so
  // the default four-byte row alignment would shear the picture.
  api.PixelStorei(GL_UNPACK_ALIGNMENT, 1);
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  api.TexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                 texels.empty() ? nullptr : texels.data());
  api.BindTexture(GL_TEXTURE_2D, 0);
  return true;
}

/// Bind the shared program and draw the quad. `opacity` is the only thing the
/// two layers disagree about at draw time.
bool draw_quad(const DrawState& state, GLuint vao, GLuint texture, double x_ref, double y_ref,
               float opacity, std::string& error) {
  Api& api = *state.api;
  static const std::vector<std::string> kUniforms =
      with_transform_uniforms({"uTex", "uOpacity"});
  const Program* program = get_program(api, "textured-quad",
                                       vertex_source(kTexVertBody, kTexVertMain), kTexFrag,
                                       kUniforms, state.gfx, error);
  if (!program) return false;

  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref, y_ref);
  api.ActiveTexture(GL_TEXTURE0);
  api.BindTexture(GL_TEXTURE_2D, texture);
  api.Uniform1i(program->uniform("uTex"), 0);
  api.Uniform1f(program->uniform("uOpacity"), opacity);
  api.BindVertexArray(vao);
  api.DrawArrays(GL_TRIANGLES, 0, 6);
  api.BindVertexArray(0);
  api.BindTexture(GL_TEXTURE_2D, 0);
  return true;
}

}  // namespace

// -- HeatmapLayer -----------------------------------------------------------

HeatmapLayer::HeatmapLayer(const ph_heatmap_desc& desc) {
  set_data(desc);
}

void HeatmapLayer::set_data(const ph_heatmap_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  smooth_ = desc.no_smooth == 0;
  cols_ = std::max(0, desc.cols);
  rows_ = std::max(0, desc.rows);
  extent_x_ = desc.x;
  extent_y_ = desc.y;
  // An all-zero extent is not a rectangle, so fall back to the unit square
  // rather than drawing a quad of zero area and looking like nothing happened.
  if (!(extent_x_.hi > extent_x_.lo)) extent_x_ = ph_range{0.0, static_cast<double>(cols_)};
  if (!(extent_y_.hi > extent_y_.lo)) extent_y_ = ph_range{0.0, static_cast<double>(rows_)};
  x_ref_ = extent_x_.lo;
  y_ref_ = extent_y_.lo;

  const size_t count = static_cast<size_t>(cols_) * static_cast<size_t>(rows_);
  if (count == 0 || !desc.values) {
    cols_ = rows_ = 0;
    return;
  }

  const photon::color::Spec spec = colormap_spec(desc.colormap);
  const photon::color::Lut& table = photon::color::lut(spec);
  color_lut_ = &table;

  double lo = desc.domain.lo;
  double hi = desc.domain.hi;
  if (!(hi > lo)) {
    lo = std::numeric_limits<double>::infinity();
    hi = -lo;
    for (size_t i = 0; i < count; ++i) {
      const double v = desc.values[i];
      if (!finite(v)) continue;
      lo = std::min(lo, v);
      hi = std::max(hi, v);
    }
    if (!finite(lo) || !finite(hi)) {
      lo = 0.0;
      hi = 1.0;
    }
  }
  value_domain_ = ph_range{lo, hi};
  const double span = (hi - lo) != 0.0 ? (hi - lo) : 1.0;

  texels_.resize(count * 4);
  for (size_t i = 0; i < count; ++i) {
    const photon::color::Rgb c = photon::color::sample(table, (desc.values[i] - lo) / span);
    texels_[i * 4] = static_cast<uint8_t>(c.r * 255.0f + 0.5f);
    texels_[i * 4 + 1] = static_cast<uint8_t>(c.g * 255.0f + 0.5f);
    texels_[i * 4 + 2] = static_cast<uint8_t>(c.b * 255.0f + 0.5f);
    texels_[i * 4 + 3] = 255;
  }

  // Row 0 is the bottom of the extent, which is also GL's texture row order —
  // so no flip.
  quad_ = extent_quad(extent_x_, extent_y_, x_ref_, y_ref_, false);
}

bool HeatmapLayer::bounds(ph_range& x, ph_range& y) const {
  if (cols_ == 0 || rows_ == 0) return false;
  x = extent_x_;
  y = extent_y_;
  return true;
}

bool HeatmapLayer::color_info(ColorInfo& out) const {
  if (!color_lut_) return false;
  out.lut = color_lut_;
  out.domain = value_domain_;
  out.label = name_;
  return true;
}

bool HeatmapLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ != 0) return true;
  return make_quad(api, quad_, texels_, cols_, rows_, smooth_, vao_, buffer_, texture_, error);
}

bool HeatmapLayer::draw(const DrawState& state, std::string& error) {
  if (texels_.empty() || !state.api) return true;
  if (!ensure_gl(*state.api, error)) return false;
  return draw_quad(state, vao_, texture_, x_ref_, y_ref_, 1.0f, error);
}

void HeatmapLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  api.DeleteTextures(1, &texture_);
  vao_ = buffer_ = texture_ = 0;
}

// -- ImageLayer -------------------------------------------------------------

ImageLayer::ImageLayer(const ph_image_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  smooth_ = desc.no_smooth == 0;
  opacity_ = desc.opacity > 0.0f ? std::min(desc.opacity, 1.0f) : 1.0f;
  width_ = std::max(0, desc.width);
  height_ = std::max(0, desc.height);
  extent_x_ = desc.x;
  extent_y_ = desc.y;
  if (!(extent_x_.hi > extent_x_.lo)) extent_x_ = ph_range{0.0, static_cast<double>(width_)};
  if (!(extent_y_.hi > extent_y_.lo)) extent_y_ = ph_range{0.0, static_cast<double>(height_)};
  x_ref_ = extent_x_.lo;
  y_ref_ = extent_y_.lo;

  const size_t count = static_cast<size_t>(width_) * static_cast<size_t>(height_);
  if (count == 0 || !desc.pixels) {
    width_ = height_ = 0;
    return;
  }
  texels_.assign(desc.pixels, desc.pixels + count * 4);

  // Desktop GL has no UNPACK_FLIP_Y, so the flip the web core does on upload
  // happens in the texture coordinates instead — free, and it leaves the
  // caller's buffer untouched.
  quad_ = extent_quad(extent_x_, extent_y_, x_ref_, y_ref_, desc.bottom_up == 0);
}

bool ImageLayer::bounds(ph_range& x, ph_range& y) const {
  if (width_ == 0 || height_ == 0) return false;
  x = extent_x_;
  y = extent_y_;
  return true;
}

bool ImageLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ != 0) return true;
  return make_quad(api, quad_, texels_, width_, height_, smooth_, vao_, buffer_, texture_, error);
}

bool ImageLayer::draw(const DrawState& state, std::string& error) {
  if (texels_.empty() || !state.api) return true;
  if (!ensure_gl(*state.api, error)) return false;
  return draw_quad(state, vao_, texture_, x_ref_, y_ref_, opacity_, error);
}

void ImageLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  api.DeleteTextures(1, &texture_);
  vao_ = buffer_ = texture_ = 0;
}

// -- OhlcSeries -------------------------------------------------------------

namespace {

/// The core's up/down defaults, from candlestick.ts.
constexpr ph_color kUpColor = 0x26a69affu;
constexpr ph_color kDownColor = 0xef5350ffu;

/// Median gap between consecutive positions — the width a period gets when the
/// caller does not say. Sessions are not evenly spaced (weekends, holidays), so
/// the median is the one that survives a gap; a mean would not.
double median_spacing(const std::vector<double>& x) {
  if (x.size() < 2) return 1.0;
  std::vector<double> diffs;
  diffs.reserve(x.size() - 1);
  for (size_t i = 1; i < x.size(); ++i) diffs.push_back(std::abs(x[i] - x[i - 1]));
  std::sort(diffs.begin(), diffs.end());
  const double median = diffs[diffs.size() / 2];
  return median != 0.0 ? median : 1.0;
}

}  // namespace

void OhlcSeries::ingest(const double* x, const double* open, const double* high,
                        const double* low, const double* close, int32_t count) {
  const size_t n = (count > 0 && x && open && high && low && close)
                       ? static_cast<size_t>(count)
                       : 0;
  x_.assign(x, x + n);
  open_.assign(open, open + n);
  high_.assign(high, high + n);
  low_.assign(low, low + n);
  close_.assign(close, close + n);

  body_width_ = explicit_width_ > 0.0 ? explicit_width_ : median_spacing(x_) * 0.7;
  x_ref_ = n > 0 ? x_[0] : 0.0;
  y_ref_ = n > 0 ? open_[0] : 0.0;
  if (!finite(x_ref_)) x_ref_ = 0.0;
  if (!finite(y_ref_)) y_ref_ = 0.0;

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;
  ohlc_bounds_ = false;
  for (size_t i = 0; i < n; ++i) {
    if (!finite(x_[i]) || !finite(low_[i]) || !finite(high_[i])) continue;
    min_x = std::min(min_x, x_[i] - body_width_ / 2.0);
    max_x = std::max(max_x, x_[i] + body_width_ / 2.0);
    min_y = std::min(min_y, low_[i]);
    max_y = std::max(max_y, high_[i]);
    ohlc_bounds_ = true;
  }
  if (ohlc_bounds_) {
    ohlc_x_ = ph_range{min_x, max_x};
    ohlc_y_ = ph_range{min_y, max_y};
  }

  emit();
  dirty_ = true;
}

bool OhlcSeries::bounds(ph_range& x, ph_range& y) const {
  if (!ohlc_bounds_) return false;
  x = ohlc_x_;
  y = ohlc_y_;
  return true;
}

void OhlcSeries::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  const GLuint buffers[] = {corner_buffer_, segment_buffer_, color_buffer_};
  api.DeleteBuffers(3, buffers);
  vao_ = 0;
  corner_buffer_ = segment_buffer_ = color_buffer_ = 0;
  dirty_ = true;
}

// -- CandlestickLayer -------------------------------------------------------

CandlestickLayer::CandlestickLayer(const ph_candlestick_desc& desc) {
  set_data(desc);
}

void CandlestickLayer::set_data(const ph_candlestick_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;
  explicit_width_ = desc.width;
  if (desc.wick_width > 0.0f) wick_width_ = desc.wick_width;
  up_ = unpack_color_exact(desc.up_color != PH_COLOR_AUTO ? desc.up_color : kUpColor);
  down_ = unpack_color_exact(desc.down_color != PH_COLOR_AUTO ? desc.down_color : kDownColor);
  ingest(desc.x, desc.open, desc.high, desc.low, desc.close, desc.count);
}

void CandlestickLayer::emit() {
  const size_t n = x_.size();
  bodies_.resize(n * 4);
  segments_.resize(n * 4);
  colors_.resize(n * 4);
  const double half = body_width_ / 2.0;
  for (size_t i = 0; i < n; ++i) {
    const float cx = static_cast<float>(x_[i] - x_ref_);
    bodies_[i * 4] = static_cast<float>(x_[i] - half - x_ref_);
    bodies_[i * 4 + 1] = static_cast<float>(open_[i] - y_ref_);
    bodies_[i * 4 + 2] = static_cast<float>(x_[i] + half - x_ref_);
    bodies_[i * 4 + 3] = static_cast<float>(close_[i] - y_ref_);
    segments_[i * 4] = cx;
    segments_[i * 4 + 1] = static_cast<float>(low_[i] - y_ref_);
    segments_[i * 4 + 2] = cx;
    segments_[i * 4 + 3] = static_cast<float>(high_[i] - y_ref_);
    const Rgba& c = close_[i] >= open_[i] ? up_ : down_;
    colors_[i * 4] = c.r;
    colors_[i * 4 + 1] = c.g;
    colors_[i * 4 + 2] = c.b;
    colors_[i * 4 + 3] = c.a;
  }
}

bool CandlestickLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenVertexArrays(1, &body_vao_);
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &rect_corner_buffer_);
    api.GenBuffers(1, &segment_buffer_);
    api.GenBuffers(1, &body_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (vao_ == 0 || body_vao_ == 0) {
      error = "failed to create candlestick vertex arrays";
      return false;
    }

    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kLineCorners)), kLineCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, segment_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);

    api.BindVertexArray(body_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, rect_corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kUnitCorners)), kUnitCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, body_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);

    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, segment_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(segments_.size() * sizeof(float)),
                   segments_.empty() ? nullptr : segments_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, body_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(bodies_.size() * sizeof(float)),
                   bodies_.empty() ? nullptr : bodies_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors_.size() * sizeof(float)),
                   colors_.empty() ? nullptr : colors_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool CandlestickLayer::draw(const DrawState& state, std::string& error) {
  if (x_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;
  const GLsizei count = static_cast<GLsizei>(x_.size());

  // Wicks first, so a body always covers the part of the wick inside it — the
  // order the web core draws them in, and the reason a doji does not show a
  // line through its own middle.
  static const std::vector<std::string> kWickUniforms =
      with_transform_uniforms({"uResolution", "uWidth"});
  const Program* wick = get_program(api, "ohlc-seg",
                                    vertex_source(kOhlcSegVertBody, kOhlcSegVertMain), kBarFrag,
                                    kWickUniforms, state.gfx, error);
  if (!wick) return false;
  api.UseProgram(wick->id);
  set_transform_uniforms(api, *wick, state.x, state.y, x_ref_, y_ref_);
  api.Uniform2f(wick->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(wick->uniform("uWidth"), wick_width_ * state.dpr);
  api.BindVertexArray(vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, count);
  api.BindVertexArray(0);

  static const std::vector<std::string> kBodyUniforms = with_transform_uniforms({});
  const Program* body = get_program(api, "bar", vertex_source(kBarVertBody, kBarVertMain),
                                    kBarFrag, kBodyUniforms, state.gfx, error);
  if (!body) return false;
  api.UseProgram(body->id);
  set_transform_uniforms(api, *body, state.x, state.y, x_ref_, y_ref_);
  api.BindVertexArray(body_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, count);
  api.BindVertexArray(0);
  return true;
}

void CandlestickLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &body_vao_);
  const GLuint buffers[] = {rect_corner_buffer_, body_buffer_};
  api.DeleteBuffers(2, buffers);
  body_vao_ = 0;
  rect_corner_buffer_ = body_buffer_ = 0;
  OhlcSeries::release_gl(api);
}

// -- OhlcLayer --------------------------------------------------------------

OhlcLayer::OhlcLayer(const ph_ohlc_desc& desc) {
  set_data(desc);
}

void OhlcLayer::set_data(const ph_ohlc_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;
  explicit_width_ = desc.width;
  if (desc.line_width > 0.0f) line_width_ = desc.line_width;
  up_ = unpack_color_exact(desc.up_color != PH_COLOR_AUTO ? desc.up_color : kUpColor);
  down_ = unpack_color_exact(desc.down_color != PH_COLOR_AUTO ? desc.down_color : kDownColor);
  ingest(desc.x, desc.open, desc.high, desc.low, desc.close, desc.count);
}

void OhlcLayer::emit() {
  constexpr size_t kSegsPerBar = 3;
  const size_t n = x_.size();
  segments_.resize(n * kSegsPerBar * 4);
  colors_.resize(n * kSegsPerBar * 4);
  const double half = body_width_ / 2.0;
  for (size_t i = 0; i < n; ++i) {
    const float cx = static_cast<float>(x_[i] - x_ref_);
    const float o = static_cast<float>(open_[i] - y_ref_);
    const float c = static_cast<float>(close_[i] - y_ref_);
    const size_t b = i * kSegsPerBar * 4;
    // The range, then the open tick to the left and the close tick to the
    // right — which side each is on is the whole convention of the chart.
    segments_[b] = cx;
    segments_[b + 1] = static_cast<float>(low_[i] - y_ref_);
    segments_[b + 2] = cx;
    segments_[b + 3] = static_cast<float>(high_[i] - y_ref_);
    segments_[b + 4] = static_cast<float>(x_[i] - half - x_ref_);
    segments_[b + 5] = o;
    segments_[b + 6] = cx;
    segments_[b + 7] = o;
    segments_[b + 8] = cx;
    segments_[b + 9] = c;
    segments_[b + 10] = static_cast<float>(x_[i] + half - x_ref_);
    segments_[b + 11] = c;
    const Rgba& colour = close_[i] >= open_[i] ? up_ : down_;
    for (size_t k = 0; k < kSegsPerBar; ++k) {
      const size_t o4 = (i * kSegsPerBar + k) * 4;
      colors_[o4] = colour.r;
      colors_[o4 + 1] = colour.g;
      colors_[o4 + 2] = colour.b;
      colors_[o4 + 3] = colour.a;
    }
  }
}

bool OhlcLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &segment_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (vao_ == 0) {
      error = "failed to create ohlc vertex array";
      return false;
    }
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kLineCorners)), kLineCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, segment_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);
    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, segment_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(segments_.size() * sizeof(float)),
                   segments_.empty() ? nullptr : segments_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors_.size() * sizeof(float)),
                   colors_.empty() ? nullptr : colors_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool OhlcLayer::draw(const DrawState& state, std::string& error) {
  if (x_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms =
      with_transform_uniforms({"uResolution", "uWidth"});
  const Program* program = get_program(api, "ohlc-seg",
                                       vertex_source(kOhlcSegVertBody, kOhlcSegVertMain),
                                       kBarFrag, kUniforms, state.gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.Uniform2f(program->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(program->uniform("uWidth"), line_width_ * state.dpr);
  api.BindVertexArray(vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, static_cast<GLsizei>(segments_.size() / 4));
  api.BindVertexArray(0);
  return true;
}

// -- HexbinLayer ------------------------------------------------------------

namespace {

/// A pointy-top unit hexagon as six triangles fanned from the centre. Written
/// out rather than computed at startup so it is a constant the linker can put
/// in rodata, and so the vertex order is visible.
std::array<float, 36> unit_hexagon() {
  std::array<float, 36> out{};
  for (int i = 0; i < 6; ++i) {
    const double a0 = (kPi / 3.0) * i + kPi / 6.0;
    const double a1 = (kPi / 3.0) * (i + 1) + kPi / 6.0;
    out[static_cast<size_t>(i) * 6] = 0.0f;
    out[static_cast<size_t>(i) * 6 + 1] = 0.0f;
    out[static_cast<size_t>(i) * 6 + 2] = static_cast<float>(std::cos(a0));
    out[static_cast<size_t>(i) * 6 + 3] = static_cast<float>(std::sin(a0));
    out[static_cast<size_t>(i) * 6 + 4] = static_cast<float>(std::cos(a1));
    out[static_cast<size_t>(i) * 6 + 5] = static_cast<float>(std::sin(a1));
  }
  return out;
}

/// Hexagon: an instanced lattice cell scaled by a shared radius.
const char* const kHexVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aCenter;
layout(location = 2) in vec4 aColor;
uniform float uRadius;
)";

const char* const kHexVertMain = R"(
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = vec4(dataToClip(aCenter + aCorner * uRadius), 0.0, 1.0);
})";

/// Quiver shaft: the OHLC segment quad by another name.
const char* const kQuiverShaftVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aArrow;
layout(location = 2) in vec4 aColor;
uniform vec2 uResolution;
uniform float uWidth;
)";

const char* const kQuiverShaftVertMain = R"(
out vec4 vColor;
void main() {
  vec2 s0 = (dataToClip(aArrow.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aArrow.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = mix(s0, s1, aCorner.x) + nrm * (aCorner.y * uWidth * 0.5);
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

/// Quiver head: three vertices from gl_VertexID, no corner buffer at all.
const char* const kQuiverHeadVertBody = R"(
precision highp float;
layout(location = 1) in vec4 aArrow;
layout(location = 2) in vec4 aColor;
uniform vec2 uResolution;
uniform float uHeadSize;
)";

const char* const kQuiverHeadVertMain = R"(
out vec4 vColor;
void main() {
  vec2 s0 = (dataToClip(aArrow.xy) * 0.5 + 0.5) * uResolution;
  vec2 s1 = (dataToClip(aArrow.zw) * 0.5 + 0.5) * uResolution;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uHeadSize * 0.6;
  vec2 pos;
  if (gl_VertexID == 0) pos = s1;
  else if (gl_VertexID == 1) pos = s1 - dir * uHeadSize + nrm * w;
  else pos = s1 - dir * uHeadSize - nrm * w;
  vColor = aColor;
  gl_Position = vec4((pos / uResolution) * 2.0 - 1.0, 0.0, 1.0);
})";

/// One colour source or the other, chosen by a uniform rather than a program.
const char* const kVertexOrUniformFrag = R"(#version 300 es
precision highp float;
in vec4 vColor;
uniform vec4 uColor;
uniform float uUseVertexColor;
out vec4 outColor;
void main() {
  vec4 c = uUseVertexColor > 0.5 ? vColor : uColor;
  outColor = vec4(c.rgb * c.a, c.a);
})";

}  // namespace

HexbinLayer::HexbinLayer(const ph_hexbin_desc& desc) {
  set_data(desc);
}

void HexbinLayer::set_data(const ph_hexbin_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;

  const size_t n = (desc.count > 0 && desc.x && desc.y) ? static_cast<size_t>(desc.count) : 0;
  if (n == 0) return;

  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;
  for (size_t i = 0; i < n; ++i) {
    if (!finite(desc.x[i]) || !finite(desc.y[i])) continue;
    min_x = std::min(min_x, desc.x[i]);
    max_x = std::max(max_x, desc.x[i]);
    min_y = std::min(min_y, desc.y[i]);
    max_y = std::max(max_y, desc.y[i]);
    hex_bounds_ = true;
  }
  if (!hex_bounds_) return;
  hex_x_ = ph_range{min_x, max_x};
  hex_y_ = ph_range{min_y, max_y};

  radius_ = desc.radius > 0.0 ? desc.radius : ((max_x - min_x) / 30.0);
  if (!(radius_ > 0.0)) radius_ = 1.0;
  const double dx = radius_ * 2.0 * std::sin(kPi / 3.0);
  const double dy = radius_ * 1.5;

  // Insertion-ordered so the instance order is the order cells were first
  // touched — deterministic across runs and platforms, which a hash order
  // would not be, and which the cross-host pixel comparison depends on.
  struct Cell {
    double cx;
    double cy;
    int64_t count;
  };
  std::unordered_map<int64_t, size_t> index;
  std::vector<Cell> cells;
  int64_t max_count = 1;
  for (size_t i = 0; i < n; ++i) {
    const double px = desc.x[i];
    const double py = desc.y[i];
    if (!finite(px) || !finite(py)) continue;
    const int64_t pj = static_cast<int64_t>(std::llround(py / dy));
    const int64_t odd = pj & 1;
    const int64_t pi =
        static_cast<int64_t>(std::llround(px / dx - static_cast<double>(odd) / 2.0));
    // Two 32-bit lattice coordinates packed into one key, which is what the
    // TypeScript's `${pi},${pj}` string is doing more expensively.
    const int64_t key = (pi << 32) ^ (pj & 0xFFFFFFFF);
    const auto found = index.find(key);
    size_t slot;
    if (found == index.end()) {
      slot = cells.size();
      index.emplace(key, slot);
      cells.push_back(Cell{(static_cast<double>(pi) + static_cast<double>(odd) / 2.0) * dx,
                           static_cast<double>(pj) * dy, 0});
    } else {
      slot = found->second;
    }
    ++cells[slot].count;
    max_count = std::max(max_count, cells[slot].count);
  }

  x_ref_ = min_x;
  y_ref_ = min_y;
  double lo = desc.domain.lo;
  double hi = desc.domain.hi;
  if (!(hi > lo)) {
    lo = 1.0;
    hi = static_cast<double>(max_count);
  }
  count_domain_ = ph_range{lo, hi};
  const double span = (hi - lo) != 0.0 ? (hi - lo) : 1.0;

  const photon::color::Spec spec = colormap_spec(desc.colormap);
  const photon::color::Lut& table = photon::color::lut(spec);
  color_lut_ = &table;
  centers_.resize(cells.size() * 2);
  colors_.resize(cells.size() * 4);
  for (size_t k = 0; k < cells.size(); ++k) {
    centers_[k * 2] = static_cast<float>(cells[k].cx - x_ref_);
    centers_[k * 2 + 1] = static_cast<float>(cells[k].cy - y_ref_);
    const photon::color::Rgb c =
        photon::color::sample(table, (static_cast<double>(cells[k].count) - lo) / span);
    colors_[k * 4] = c.r;
    colors_[k * 4 + 1] = c.g;
    colors_[k * 4 + 2] = c.b;
    colors_[k * 4 + 3] = 1.0f;
  }
}

bool HexbinLayer::bounds(ph_range& x, ph_range& y) const {
  if (!hex_bounds_) return false;
  x = hex_x_;
  y = hex_y_;
  return true;
}

bool HexbinLayer::color_info(ColorInfo& out) const {
  if (!color_lut_) return false;
  out.lut = color_lut_;
  out.domain = count_domain_;
  out.label = name_;
  return true;
}

bool HexbinLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &hex_buffer_);
    api.GenBuffers(1, &center_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (vao_ == 0) {
      error = "failed to create hexbin vertex array";
      return false;
    }
    const std::array<float, 36> hexagon = unit_hexagon();
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, hex_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(hexagon.size() * sizeof(float)),
                   hexagon.data(), GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, center_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 2, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);
    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, center_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(centers_.size() * sizeof(float)),
                   centers_.empty() ? nullptr : centers_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors_.size() * sizeof(float)),
                   colors_.empty() ? nullptr : colors_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool HexbinLayer::draw(const DrawState& state, std::string& error) {
  if (centers_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms({"uRadius"});
  const Program* program = get_program(api, "hexbin", vertex_source(kHexVertBody, kHexVertMain),
                                       kBarFrag, kUniforms, state.gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.Uniform1f(program->uniform("uRadius"), static_cast<GLfloat>(radius_));
  api.BindVertexArray(vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 18, static_cast<GLsizei>(centers_.size() / 2));
  api.BindVertexArray(0);
  return true;
}

void HexbinLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  const GLuint buffers[] = {hex_buffer_, center_buffer_, color_buffer_};
  api.DeleteBuffers(3, buffers);
  vao_ = 0;
  hex_buffer_ = center_buffer_ = color_buffer_ = 0;
  dirty_ = true;
}

// -- QuiverLayer ------------------------------------------------------------

QuiverLayer::QuiverLayer(const ph_quiver_desc& desc) {
  set_data(desc);
}

void QuiverLayer::set_data(const ph_quiver_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  color_ = desc.color;
  render_type_ = desc.render_type;
  vertex_color_ = desc.color_by != 0;
  if (desc.width > 0.0f) width_ = desc.width;
  if (desc.head_size > 0.0f) head_size_ = desc.head_size;

  const size_t n = (desc.count > 0 && desc.x && desc.y && desc.u && desc.v)
                       ? static_cast<size_t>(desc.count)
                       : 0;
  if (n == 0) return;
  x_ref_ = desc.x[0];
  y_ref_ = desc.y[0];
  if (!finite(x_ref_)) x_ref_ = 0.0;
  if (!finite(y_ref_)) y_ref_ = 0.0;

  double scale = desc.scale;
  if (!(scale > 0.0)) {
    // Auto-fit: the longest arrow spans about 90% of a nominal grid cell, where
    // the cell is the field's diagonal divided by the square root of the count.
    // Without it a field in metres per second over a domain in kilometres draws
    // one arrow across the whole plot.
    double max_mag = 0.0;
    double min_x = std::numeric_limits<double>::infinity();
    double max_x = -min_x;
    double min_y = min_x;
    double max_y = -min_x;
    for (size_t i = 0; i < n; ++i) {
      max_mag = std::max(max_mag, std::hypot(desc.u[i], desc.v[i]));
      min_x = std::min(min_x, desc.x[i]);
      max_x = std::max(max_x, desc.x[i]);
      min_y = std::min(min_y, desc.y[i]);
      max_y = std::max(max_y, desc.y[i]);
    }
    double diag = std::hypot(max_x - min_x, max_y - min_y);
    if (!(diag > 0.0) || !finite(diag)) diag = 1.0;
    const double cell = diag / std::max(1.0, std::sqrt(static_cast<double>(n)));
    scale = max_mag > 0.0 ? (0.9 * cell) / max_mag : 1.0;
  }

  double lo = desc.color_domain.lo;
  double hi = desc.color_domain.hi;
  if (vertex_color_ && !(hi > lo)) {
    lo = std::numeric_limits<double>::infinity();
    hi = -lo;
    for (size_t i = 0; i < n; ++i) {
      const double value = desc.color_values ? desc.color_values[i]
                                             : std::hypot(desc.u[i], desc.v[i]);
      if (!finite(value)) continue;
      lo = std::min(lo, value);
      hi = std::max(hi, value);
    }
    if (!finite(lo) || !finite(hi)) {
      lo = 0.0;
      hi = 1.0;
    }
  }
  value_domain_ = ph_range{lo, hi};
  const double span = (hi - lo) != 0.0 ? (hi - lo) : 1.0;
  const photon::color::Spec spec = colormap_spec(desc.color_map);
  const photon::color::Lut& table = photon::color::lut(spec);
  if (vertex_color_) color_lut_ = &table;

  arrows_.resize(n * 4);
  colors_.resize(n * 4);
  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;
  for (size_t i = 0; i < n; ++i) {
    const double xi = desc.x[i];
    const double yi = desc.y[i];
    const double tx = xi + desc.u[i] * scale;
    const double ty = yi + desc.v[i] * scale;
    arrows_[i * 4] = static_cast<float>(xi - x_ref_);
    arrows_[i * 4 + 1] = static_cast<float>(yi - y_ref_);
    arrows_[i * 4 + 2] = static_cast<float>(tx - x_ref_);
    arrows_[i * 4 + 3] = static_cast<float>(ty - y_ref_);
    if (vertex_color_) {
      const double value = desc.color_values ? desc.color_values[i]
                                             : std::hypot(desc.u[i], desc.v[i]);
      const photon::color::Rgb c = photon::color::sample(table, (value - lo) / span);
      colors_[i * 4] = c.r;
      colors_[i * 4 + 1] = c.g;
      colors_[i * 4 + 2] = c.b;
      colors_[i * 4 + 3] = 1.0f;
    }
    if (!finite(xi) || !finite(yi) || !finite(tx) || !finite(ty)) continue;
    min_x = std::min({min_x, xi, tx});
    max_x = std::max({max_x, xi, tx});
    min_y = std::min({min_y, yi, ty});
    max_y = std::max({max_y, yi, ty});
    quiver_bounds_ = true;
  }
  if (quiver_bounds_) {
    quiver_x_ = ph_range{min_x, max_x};
    quiver_y_ = ph_range{min_y, max_y};
  }
}

bool QuiverLayer::bounds(ph_range& x, ph_range& y) const {
  if (!quiver_bounds_) return false;
  x = quiver_x_;
  y = quiver_y_;
  return true;
}

bool QuiverLayer::color_info(ColorInfo& out) const {
  if (!color_lut_) return false;
  out.lut = color_lut_;
  out.domain = value_domain_;
  out.label = name_;
  return true;
}

bool QuiverLayer::ensure_gl(Api& api, std::string& error) {
  if (shaft_vao_ == 0) {
    api.GenVertexArrays(1, &shaft_vao_);
    api.GenVertexArrays(1, &head_vao_);
    api.GenBuffers(1, &corner_buffer_);
    api.GenBuffers(1, &arrow_buffer_);
    api.GenBuffers(1, &color_buffer_);
    if (shaft_vao_ == 0 || head_vao_ == 0) {
      error = "failed to create quiver vertex arrays";
      return false;
    }

    api.BindVertexArray(shaft_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, corner_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(sizeof(kLineCorners)), kLineCorners,
                   GL_STATIC_DRAW);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindBuffer(GL_ARRAY_BUFFER, arrow_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);

    // The head has no corner attribute at all — its three vertices come from
    // gl_VertexID, so attribute 0 stays disabled here on purpose.
    api.BindVertexArray(head_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, arrow_buffer_);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(1, 1);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.EnableVertexAttribArray(2);
    api.VertexAttribPointer(2, 4, GL_FLOAT, 0, 0, nullptr);
    api.VertexAttribDivisor(2, 1);

    api.BindVertexArray(0);
  }

  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, arrow_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(arrows_.size() * sizeof(float)),
                   arrows_.empty() ? nullptr : arrows_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, color_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(colors_.size() * sizeof(float)),
                   colors_.empty() ? nullptr : colors_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool QuiverLayer::draw(const DrawState& state, std::string& error) {
  if (arrows_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  const Rgba colour = unpack_color(color_);
  const GLfloat use_vertex_color = vertex_color_ ? 1.0f : 0.0f;
  const GLsizei count = static_cast<GLsizei>(arrows_.size() / 4);

  static const std::vector<std::string> kShaftUniforms =
      with_transform_uniforms({"uColor", "uResolution", "uWidth", "uUseVertexColor"});
  const Program* shaft = get_program(api, "quiver-shaft",
                                     vertex_source(kQuiverShaftVertBody, kQuiverShaftVertMain),
                                     kVertexOrUniformFrag, kShaftUniforms, state.gfx, error);
  if (!shaft) return false;
  api.UseProgram(shaft->id);
  set_transform_uniforms(api, *shaft, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(shaft->uniform("uColor"), colour.r, colour.g, colour.b, colour.a);
  api.Uniform2f(shaft->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(shaft->uniform("uWidth"), width_ * state.dpr);
  api.Uniform1f(shaft->uniform("uUseVertexColor"), use_vertex_color);
  api.BindVertexArray(shaft_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 6, count);
  api.BindVertexArray(0);

  if (head_size_ <= 0.0f) return true;

  static const std::vector<std::string> kHeadUniforms =
      with_transform_uniforms({"uColor", "uResolution", "uHeadSize", "uUseVertexColor"});
  const Program* head = get_program(api, "quiver-head",
                                    vertex_source(kQuiverHeadVertBody, kQuiverHeadVertMain),
                                    kVertexOrUniformFrag, kHeadUniforms, state.gfx, error);
  if (!head) return false;
  api.UseProgram(head->id);
  set_transform_uniforms(api, *head, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(head->uniform("uColor"), colour.r, colour.g, colour.b, colour.a);
  api.Uniform2f(head->uniform("uResolution"), static_cast<GLfloat>(state.pixel_width),
                static_cast<GLfloat>(state.pixel_height));
  api.Uniform1f(head->uniform("uHeadSize"), head_size_ * state.dpr);
  api.Uniform1f(head->uniform("uUseVertexColor"), use_vertex_color);
  api.BindVertexArray(head_vao_);
  api.DrawArraysInstanced(GL_TRIANGLES, 0, 3, count);
  api.BindVertexArray(0);
  return true;
}

void QuiverLayer::release_gl(Api& api) {
  if (shaft_vao_ == 0) return;
  const GLuint vaos[] = {shaft_vao_, head_vao_};
  api.DeleteVertexArrays(2, vaos);
  const GLuint buffers[] = {corner_buffer_, arrow_buffer_, color_buffer_};
  api.DeleteBuffers(3, buffers);
  shaft_vao_ = head_vao_ = 0;
  corner_buffer_ = arrow_buffer_ = color_buffer_ = 0;
  dirty_ = true;
}

// -- ContourLayer -----------------------------------------------------------

namespace {

/// Marching squares: corner mask -> the cell edges to join. Edge 0 is the
/// bottom, 1 the right, 2 the top, 3 the left. Cases 5 and 10 are the saddles,
/// and the pair of segments they list is the choice this table makes about
/// which way the ridge runs.
struct MarchingCase {
  int8_t count;
  int8_t edges[4];
};

constexpr MarchingCase kMarchingCases[16] = {
    {0, {0, 0, 0, 0}}, {1, {3, 0, 0, 0}}, {1, {0, 1, 0, 0}}, {1, {3, 1, 0, 0}},
    {1, {1, 2, 0, 0}}, {2, {3, 0, 1, 2}}, {1, {0, 2, 0, 0}}, {1, {3, 2, 0, 0}},
    {1, {2, 3, 0, 0}}, {1, {2, 0, 0, 0}}, {2, {0, 1, 2, 3}}, {1, {2, 1, 0, 0}},
    {1, {1, 3, 0, 0}}, {1, {1, 0, 0, 0}}, {1, {0, 3, 0, 0}}, {0, {0, 0, 0, 0}},
};

/// Nodes: a round point sized in device pixels.
const char* const kNodeVertBody = R"(
precision highp float;
layout(location = 0) in vec2 aPos;
uniform float uSize;
)";

const char* const kNodeVertMain = R"(
void main() {
  gl_Position = vec4(dataToClip(aPos), 0.0, 1.0);
  gl_PointSize = uSize;
})";

const char* const kNodeFrag = R"(#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.82, r);
  outColor = vec4(uColor.rgb * uColor.a * a, uColor.a * a);
})";

/// The core's graph defaults: a blue node and a translucent slate edge.
constexpr ph_color kNodeColor = 0x60a5faffu;
constexpr ph_color kEdgeColor = 0x94a3b880u;

}  // namespace

ContourLayer::ContourLayer(const ph_contour_desc& desc) {
  set_data(desc);
}

void ContourLayer::set_data(const ph_contour_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;

  const int32_t cols = desc.cols;
  const int32_t rows = desc.rows;
  const size_t cells = (cols > 1 && rows > 1 && desc.values)
                           ? static_cast<size_t>(cols) * static_cast<size_t>(rows)
                           : 0;
  extent_x_ = desc.x;
  extent_y_ = desc.y;
  if (!(extent_x_.hi > extent_x_.lo)) extent_x_ = ph_range{0.0, static_cast<double>(cols)};
  if (!(extent_y_.hi > extent_y_.lo)) extent_y_ = ph_range{0.0, static_cast<double>(rows)};
  x_ref_ = extent_x_.lo;
  y_ref_ = extent_y_.lo;
  // Even an empty grid has a rectangle it would occupy, which is what the web
  // core reports too — a contour of a flat field draws nothing but is still
  // somewhere.
  has_extent_ = cells > 0;
  if (cells == 0) return;

  double vmin = std::numeric_limits<double>::infinity();
  double vmax = -vmin;
  for (size_t i = 0; i < cells; ++i) {
    const double v = desc.values[i];
    if (!finite(v)) continue;
    vmin = std::min(vmin, v);
    vmax = std::max(vmax, v);
  }
  if (!finite(vmin) || !finite(vmax)) {
    vmin = 0.0;
    vmax = 1.0;
  }
  value_domain_ = ph_range{vmin, vmax};

  std::vector<double> levels;
  if (desc.levels && desc.level_count > 0) {
    levels.assign(desc.levels, desc.levels + desc.level_count);
  } else {
    // Evenly spaced *between* the extremes, not including them: a level exactly
    // at the minimum traces the grid's border and says nothing.
    const int32_t count = desc.level_count > 0 ? desc.level_count : 8;
    levels.reserve(static_cast<size_t>(count));
    for (int32_t i = 0; i < count; ++i) {
      levels.push_back(vmin + (vmax - vmin) * static_cast<double>(i + 1) /
                                  static_cast<double>(count + 1));
    }
  }

  const bool fixed_color = desc.color != PH_COLOR_AUTO;
  const Rgba fixed = unpack_color_exact(desc.color);
  const photon::color::Spec spec = colormap_spec(desc.colormap);
  const photon::color::Lut& table = photon::color::lut(spec);
  // One flat colour means there is nothing for a colorbar to say.
  if (!fixed_color) color_lut_ = &table;
  const double level_span = (vmax - vmin) != 0.0 ? (vmax - vmin) : 1.0;

  const double x_step = (extent_x_.hi - extent_x_.lo) / static_cast<double>(cols - 1);
  const double y_step = (extent_y_.hi - extent_y_.lo) / static_cast<double>(rows - 1);
  const auto gx = [&](int32_t c) {
    return extent_x_.lo + static_cast<double>(c) * x_step - x_ref_;
  };
  const auto gy = [&](int32_t r) {
    return extent_y_.lo + static_cast<double>(r) * y_step - y_ref_;
  };
  const auto at = [&](int32_t c, int32_t r) {
    return desc.values[static_cast<size_t>(r) * static_cast<size_t>(cols) +
                       static_cast<size_t>(c)];
  };

  for (const double level : levels) {
    Rgba colour = fixed;
    if (!fixed_color) {
      const photon::color::Rgb c =
          photon::color::sample(table, (level - vmin) / level_span);
      colour = Rgba{c.r, c.g, c.b, 1.0f};
    }
    for (int32_t r = 0; r + 1 < rows; ++r) {
      for (int32_t c = 0; c + 1 < cols; ++c) {
        const double v0 = at(c, r);
        const double v1 = at(c + 1, r);
        const double v2 = at(c + 1, r + 1);
        const double v3 = at(c, r + 1);
        const int index = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) |
                          (v2 >= level ? 4 : 0) | (v3 >= level ? 8 : 0);
        const MarchingCase& segments = kMarchingCases[index];
        if (segments.count == 0) continue;

        // Where the level crosses each of the cell's four edges. The 1e-9 guard
        // is for a flat edge, where the crossing is undefined and any point on
        // it is as good as another.
        const auto crossing = [&](int8_t edge) -> std::pair<double, double> {
          const auto lerp = [](double t, double ax, double ay, double bx, double by) {
            return std::pair<double, double>{ax + (bx - ax) * t, ay + (by - ay) * t};
          };
          switch (edge) {
            case 0:
              return lerp((level - v0) / ((v1 - v0) != 0.0 ? (v1 - v0) : 1e-9), gx(c), gy(r),
                          gx(c + 1), gy(r));
            case 1:
              return lerp((level - v1) / ((v2 - v1) != 0.0 ? (v2 - v1) : 1e-9), gx(c + 1),
                          gy(r), gx(c + 1), gy(r + 1));
            case 2:
              return lerp((level - v2) / ((v3 - v2) != 0.0 ? (v3 - v2) : 1e-9), gx(c + 1),
                          gy(r + 1), gx(c), gy(r + 1));
            default:
              return lerp((level - v3) / ((v0 - v3) != 0.0 ? (v0 - v3) : 1e-9), gx(c),
                          gy(r + 1), gx(c), gy(r));
          }
        };

        for (int8_t s = 0; s < segments.count; ++s) {
          const std::pair<double, double> pa = crossing(segments.edges[s * 2]);
          const std::pair<double, double> pb = crossing(segments.edges[s * 2 + 1]);
          for (const auto& point : {pa, pb}) {
            vertices_.push_back(static_cast<float>(point.first));
            vertices_.push_back(static_cast<float>(point.second));
            vertices_.push_back(colour.r);
            vertices_.push_back(colour.g);
            vertices_.push_back(colour.b);
            vertices_.push_back(colour.a);
          }
        }
      }
    }
  }
}

bool ContourLayer::bounds(ph_range& x, ph_range& y) const {
  if (!has_extent_) return false;
  x = extent_x_;
  y = extent_y_;
  return true;
}

bool ContourLayer::color_info(ColorInfo& out) const {
  if (!color_lut_) return false;
  out.lut = color_lut_;
  out.domain = value_domain_;
  out.label = name_;
  return true;
}

bool ContourLayer::ensure_gl(Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0) {
      error = "failed to create contour vertex array";
      return false;
    }
    api.BindVertexArray(vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
    const GLsizei stride = 6 * static_cast<GLsizei>(sizeof(float));
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, stride, nullptr);
    api.EnableVertexAttribArray(1);
    api.VertexAttribPointer(1, 4, GL_FLOAT, 0, stride,
                            reinterpret_cast<const void*>(2 * sizeof(float)));
    api.BindVertexArray(0);
  }
  if (dirty_) {
    api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                   vertices_.empty() ? nullptr : vertices_.data(), buffer_usage(render_type_));
    dirty_ = false;
  }
  return true;
}

bool ContourLayer::draw(const DrawState& state, std::string& error) {
  if (vertices_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = with_transform_uniforms({});
  const Program* program = get_program(api, "fill", vertex_source(kFillVertBody, kFillVertMain),
                                       kFillFrag, kUniforms, state.gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  set_transform_uniforms(api, *program, state.x, state.y, x_ref_, y_ref_);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_LINES, 0, static_cast<GLsizei>(vertices_.size() / 6));
  api.BindVertexArray(0);
  return true;
}

void ContourLayer::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- GraphLayer -------------------------------------------------------------

GraphLayer::GraphLayer(const ph_graph_desc& desc) {
  name_ = from_utf8(desc.name);
  y_axis_ = from_utf8(desc.y_axis);
  render_type_ = desc.render_type;
  node_color_ =
      unpack_color_exact(desc.node_color != PH_COLOR_AUTO ? desc.node_color : kNodeColor);
  edge_color_ =
      unpack_color_exact(desc.edge_color != PH_COLOR_AUTO ? desc.edge_color : kEdgeColor);
  if (desc.node_size > 0.0f) node_size_ = desc.node_size;

  const size_t n = desc.node_count > 0 ? static_cast<size_t>(desc.node_count) : 0;
  if (n == 0) return;

  std::vector<std::pair<int32_t, int32_t>> edges;
  if (desc.edges && desc.edge_count > 0) {
    edges.reserve(static_cast<size_t>(desc.edge_count));
    for (int32_t i = 0; i < desc.edge_count; ++i) {
      edges.emplace_back(desc.edges[i].a, desc.edges[i].b);
    }
  }

  // No positions means "lay it out". The force layout is deterministic, so this
  // is a chart the caller can reproduce rather than one that moves each run.
  std::vector<double> laid_x;
  std::vector<double> laid_y;
  const double* xs = desc.x;
  const double* ys = desc.y;
  if (!xs || !ys) {
    photon::graph::ForceOptions opts;
    if (desc.layout_iterations > 0) opts.iterations = desc.layout_iterations;
    photon::graph::Layout layout = photon::graph::force_layout(n, edges, opts);
    laid_x = std::move(layout.x);
    laid_y = std::move(layout.y);
    xs = laid_x.data();
    ys = laid_y.data();
  }

  x_ref_ = xs[0];
  y_ref_ = ys[0];
  if (!finite(x_ref_)) x_ref_ = 0.0;
  if (!finite(y_ref_)) y_ref_ = 0.0;

  nodes_.resize(n * 2);
  double min_x = std::numeric_limits<double>::infinity();
  double max_x = -min_x;
  double min_y = min_x;
  double max_y = -min_x;
  for (size_t i = 0; i < n; ++i) {
    nodes_[i * 2] = static_cast<float>(xs[i] - x_ref_);
    nodes_[i * 2 + 1] = static_cast<float>(ys[i] - y_ref_);
    if (!finite(xs[i]) || !finite(ys[i])) continue;
    min_x = std::min(min_x, xs[i]);
    max_x = std::max(max_x, xs[i]);
    min_y = std::min(min_y, ys[i]);
    max_y = std::max(max_y, ys[i]);
    graph_bounds_ = true;
  }
  if (graph_bounds_) {
    graph_x_ = ph_range{min_x, max_x};
    graph_y_ = ph_range{min_y, max_y};
  }

  // An edge naming a node that does not exist is skipped rather than rejected:
  // graphs arrive from data, and one dangling reference should not lose the
  // other ten thousand.
  edges_.reserve(edges.size() * 4);
  for (const auto& edge : edges) {
    const size_t a = static_cast<size_t>(edge.first);
    const size_t b = static_cast<size_t>(edge.second);
    if (edge.first < 0 || edge.second < 0 || a >= n || b >= n) continue;
    edges_.push_back(static_cast<float>(xs[a] - x_ref_));
    edges_.push_back(static_cast<float>(ys[a] - y_ref_));
    edges_.push_back(static_cast<float>(xs[b] - x_ref_));
    edges_.push_back(static_cast<float>(ys[b] - y_ref_));
  }
}

bool GraphLayer::bounds(ph_range& x, ph_range& y) const {
  if (!graph_bounds_) return false;
  x = graph_x_;
  y = graph_y_;
  return true;
}

bool GraphLayer::ensure_gl(Api& api, std::string& error) {
  if (node_vao_ == 0) {
    api.GenVertexArrays(1, &node_vao_);
    api.GenVertexArrays(1, &edge_vao_);
    api.GenBuffers(1, &node_buffer_);
    api.GenBuffers(1, &edge_buffer_);
    if (node_vao_ == 0 || edge_vao_ == 0) {
      error = "failed to create graph vertex arrays";
      return false;
    }
    api.BindVertexArray(node_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, node_buffer_);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindVertexArray(edge_vao_);
    api.BindBuffer(GL_ARRAY_BUFFER, edge_buffer_);
    api.EnableVertexAttribArray(0);
    api.VertexAttribPointer(0, 2, GL_FLOAT, 0, 0, nullptr);
    api.BindVertexArray(0);
  }
  if (dirty_) {
    const GLenum usage = buffer_usage(render_type_);
    api.BindBuffer(GL_ARRAY_BUFFER, node_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(nodes_.size() * sizeof(float)),
                   nodes_.empty() ? nullptr : nodes_.data(), usage);
    api.BindBuffer(GL_ARRAY_BUFFER, edge_buffer_);
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(edges_.size() * sizeof(float)),
                   edges_.empty() ? nullptr : edges_.data(), usage);
    dirty_ = false;
  }
  return true;
}

bool GraphLayer::draw(const DrawState& state, std::string& error) {
  if (nodes_.empty() || !state.api) return true;
  Api& api = *state.api;
  if (!ensure_gl(api, error)) return false;

  // Edges first, nodes on top — a node is a thing and an edge is a relation
  // between things, so the thing wins where they overlap.
  if (!edges_.empty()) {
    static const std::vector<std::string> kEdgeUniforms = with_transform_uniforms({"uColor"});
    const Program* edge = get_program(api, "area", vertex_source(kAreaVertBody, kAreaVertMain),
                                      kAreaFrag, kEdgeUniforms, state.gfx, error);
    if (!edge) return false;
    api.UseProgram(edge->id);
    set_transform_uniforms(api, *edge, state.x, state.y, x_ref_, y_ref_);
    api.Uniform4f(edge->uniform("uColor"), edge_color_.r, edge_color_.g, edge_color_.b,
                  edge_color_.a);
    api.BindVertexArray(edge_vao_);
    api.DrawArrays(GL_LINES, 0, static_cast<GLsizei>(edges_.size() / 2));
    api.BindVertexArray(0);
  }

  static const std::vector<std::string> kNodeUniforms =
      with_transform_uniforms({"uColor", "uSize"});
  const Program* node = get_program(api, "graph-node",
                                    vertex_source(kNodeVertBody, kNodeVertMain), kNodeFrag,
                                    kNodeUniforms, state.gfx, error);
  if (!node) return false;
  api.UseProgram(node->id);
  set_transform_uniforms(api, *node, state.x, state.y, x_ref_, y_ref_);
  api.Uniform4f(node->uniform("uColor"), node_color_.r, node_color_.g, node_color_.b,
                node_color_.a);
  api.Uniform1f(node->uniform("uSize"), node_size_ * state.dpr);
  // Same desktop-versus-WebGL2 gate the box layer's outliers need.
  api.Enable(GL_PROGRAM_POINT_SIZE);
  api.BindVertexArray(node_vao_);
  api.DrawArrays(GL_POINTS, 0, static_cast<GLsizei>(nodes_.size() / 2));
  api.BindVertexArray(0);
  api.Disable(GL_PROGRAM_POINT_SIZE);
  return true;
}

void GraphLayer::release_gl(Api& api) {
  if (node_vao_ == 0) return;
  const GLuint vaos[] = {node_vao_, edge_vao_};
  api.DeleteVertexArrays(2, vaos);
  const GLuint buffers[] = {node_buffer_, edge_buffer_};
  api.DeleteBuffers(2, buffers);
  node_vao_ = edge_vao_ = 0;
  node_buffer_ = edge_buffer_ = 0;
  dirty_ = true;
}

}  // namespace photon
