#include "layer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

#include "geo/earcut.hpp"
#include "gl/program.hpp"

namespace photon {
namespace {

using namespace photon::gl;

/// Non-finite samples are holes in a series, not data — the web core skips them
/// when autoscaling and so must this, or one NaN collapses the whole domain.
bool finite(double v) {
  return std::isfinite(v);
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
  // colorBy needs the colormap tables, which land with the colorbar in Faz 4;
  // until then a caller can pass explicit per-point colours and get the same
  // picture. Silently ignoring it would be the blank-chart failure mode, so the
  // ABI reports it instead — see ph_plot_add_scatter.
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

}  // namespace photon
