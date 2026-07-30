#include "plot3d/layers3d.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

#include "color.hpp"
#include "gl/program.hpp"
#include "plot3d/marching_cubes.hpp"

namespace photon::plot3d {

using namespace photon::gl;

namespace {

/// A lit mesh: position, normal and colour per vertex, one directional light.
const char* kMeshVert = R"(#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
out vec3 vN;
void main() { vColor = aColor; vN = aNormal; gl_Position = uMVP * vec4(aPos, 1.0); }
)";

const char* kMeshFrag = R"(#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
uniform vec3 uLightDir;
uniform float uAmbient;
out vec4 outColor;
void main() {
  float d = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
  float shade = uAmbient + (1.0 - uAmbient) * d;
  outColor = vec4(vColor * shade, 1.0);
}
)";

/// Round points, sized in pixels. Needs GL_PROGRAM_POINT_SIZE on the desktop.
const char* kPointVert = R"(#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uMVP;
uniform float uSize;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
  gl_PointSize = uSize;
}
)";

const char* kPointFrag = R"(#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  outColor = vec4(vColor, 1.0);
}
)";

/// Per-vertex-coloured lines, unlit.
const char* kColorLineVert = R"(#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main() { vColor = aColor; gl_Position = uMVP * vec4(aPos, 1.0); }
)";

const char* kColorLineFrag = R"(#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }
)";

struct Rgb3 {
  float r, g, b;
};

Rgb3 unpack(ph_color color) {
  const Rgba c = unpack_color(color);
  return Rgb3{c.r, c.g, c.b};
}

/// The colormap a descriptor asks for, or viridis.
photon::color::Spec spec_of(const ph_colormap_spec* desc) {
  photon::color::Spec spec;
  if (!desc) return spec;
  if (desc->name) spec.name = desc->name;
  if (desc->stops && desc->stop_count > 0) {
    spec.stops.reserve(static_cast<size_t>(desc->stop_count));
    for (int32_t i = 0; i < desc->stop_count; ++i) {
      const Rgba c = unpack_color_exact(desc->stops[i]);
      spec.stops.push_back(photon::color::Rgb{c.r, c.g, c.b});
    }
  }
  spec.reverse = desc->reverse != 0;
  spec.discrete_steps = desc->discrete_steps;
  return spec;
}

/// The range a ramp covers: the caller's, or the data's own.
ph_range measure(const double* values, size_t count, ph_range given) {
  if (given.lo != given.hi) return given;
  double lo = std::numeric_limits<double>::infinity();
  double hi = -lo;
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(values[i])) continue;
    lo = std::min(lo, values[i]);
    hi = std::max(hi, values[i]);
  }
  if (!std::isfinite(lo)) return ph_range{0.0, 1.0};
  return ph_range{lo, hi == lo ? lo + 1.0 : hi};
}

Rgb3 sample(const photon::color::Lut& lut, ph_range domain, double value) {
  const double span = domain.hi - domain.lo;
  const photon::color::Rgb c =
      photon::color::sample(lut, span == 0.0 ? 0.0 : (value - domain.lo) / span);
  return Rgb3{c.r, c.g, c.b};
}

/// Grow a bounds by one point. `any` starts false and comes back true.
void extend(Bounds3& b, bool& any, double x, double y, double z) {
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return;
  if (!any) {
    b.x = ph_range{x, x};
    b.y = ph_range{y, y};
    b.z = ph_range{z, z};
    any = true;
    return;
  }
  b.x.lo = std::min(b.x.lo, x);
  b.x.hi = std::max(b.x.hi, x);
  b.y.lo = std::min(b.y.lo, y);
  b.y.hi = std::max(b.y.hi, y);
  b.z.lo = std::min(b.z.lo, z);
  b.z.hi = std::max(b.z.hi, z);
}

/// A degenerate axis would divide by zero in the normalize matrix.
void pad_degenerate(Bounds3& b) {
  const auto pad = [](ph_range& r) {
    if (r.lo == r.hi) {
      r.lo -= 0.5;
      r.hi += 0.5;
    }
  };
  pad(b.x);
  pad(b.y);
  pad(b.z);
}

/// Bind a VAO whose vertices are `floats_per_vertex` wide, with `attrs` sizes.
void bind_attributes(gl::Api& api, const std::vector<int>& attrs) {
  int stride = 0;
  for (const int n : attrs) stride += n;
  int offset = 0;
  for (size_t i = 0; i < attrs.size(); ++i) {
    api.EnableVertexAttribArray(static_cast<GLuint>(i));
    api.VertexAttribPointer(static_cast<GLuint>(i), attrs[i], GL_FLOAT, GL_FALSE_,
                            static_cast<GLsizei>(stride * static_cast<int>(sizeof(float))),
                            reinterpret_cast<const void*>(static_cast<size_t>(offset) *
                                                          sizeof(float)));
    offset += attrs[i];
  }
}

}  // namespace

// -- SurfaceLayer -----------------------------------------------------------

SurfaceLayer::SurfaceLayer(const ph_surface_desc& desc) {
  name_ = desc.name ? desc.name : "";
  wireframe_ = desc.wireframe != 0;
  render_type_ = desc.render_type;
  const size_t cols = static_cast<size_t>(std::max(0, desc.cols));
  const size_t rows = static_cast<size_t>(std::max(0, desc.rows));
  if (!desc.values || cols < 2 || rows < 2) return;

  const photon::color::Spec spec = spec_of(desc.colormap);
  lut_ = &photon::color::lut(spec);
  domain_ = measure(desc.values, cols * rows, desc.domain);

  const double x0 = desc.x.lo == desc.x.hi ? 0.0 : desc.x.lo;
  const double x1 = desc.x.lo == desc.x.hi ? static_cast<double>(cols - 1) : desc.x.hi;
  const double z0 = desc.z.lo == desc.z.hi ? 0.0 : desc.z.lo;
  const double z1 = desc.z.lo == desc.z.hi ? static_cast<double>(rows - 1) : desc.z.hi;

  const auto px = [&](size_t c) {
    return x0 + (x1 - x0) * static_cast<double>(c) / static_cast<double>(cols - 1);
  };
  const auto pz = [&](size_t r) {
    return z0 + (z1 - z0) * static_cast<double>(r) / static_cast<double>(rows - 1);
  };
  const auto height = [&](size_t c, size_t r) { return desc.values[r * cols + c]; };

  bool any = false;
  for (size_t r = 0; r < rows; ++r) {
    for (size_t c = 0; c < cols; ++c) extend(bounds_, any, px(c), height(c, r), pz(r));
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);

  if (wireframe_) {
    // One segment per grid edge, right and down, so each interior edge is drawn
    // once rather than twice.
    const auto push = [&](size_t c, size_t r) {
      const Rgb3 color = sample(*lut_, domain_, height(c, r));
      vertices_.insert(vertices_.end(), {static_cast<float>(px(c)), static_cast<float>(height(c, r)),
                                         static_cast<float>(pz(r)), color.r, color.g, color.b});
    };
    for (size_t r = 0; r < rows; ++r) {
      for (size_t c = 0; c < cols; ++c) {
        if (c + 1 < cols) {
          push(c, r);
          push(c + 1, r);
        }
        if (r + 1 < rows) {
          push(c, r);
          push(c, r + 1);
        }
      }
    }
    return;
  }

  // Per-vertex normals from the central difference of the height field, not one
  // face normal per triangle: a shared normal is what makes a coarse grid shade
  // as a surface rather than as a heap of facets, and it is what the web core
  // does — matching it is the difference between the same picture and a
  // recognisably different one.
  const double dx_world = (x1 - x0) / static_cast<double>(cols - 1);
  const double dz_world = (z1 - z0) / static_cast<double>(rows - 1);
  const auto normal_at = [&](size_t c, size_t r) {
    const size_t cr = std::min(cols - 1, c);
    const size_t rr = std::min(rows - 1, r);
    const double dydx = (height(std::min(cols - 1, cr + 1), rr) -
                         height(cr == 0 ? 0 : cr - 1, rr)) /
                        (2.0 * dx_world);
    const double dydz = (height(cr, std::min(rows - 1, rr + 1)) -
                         height(cr, rr == 0 ? 0 : rr - 1)) /
                        (2.0 * dz_world);
    const double len = std::sqrt(dydx * dydx + 1.0 + dydz * dydz);
    const double n = len == 0.0 ? 1.0 : len;
    return std::array<double, 3>{-dydx / n, 1.0 / n, -dydz / n};
  };

  vertices_.reserve((cols - 1) * (rows - 1) * 6 * 9);
  const auto vertex = [&](size_t c, size_t r) {
    const std::array<double, 3> n = normal_at(c, r);
    const Rgb3 color = sample(*lut_, domain_, height(c, r));
    vertices_.insert(vertices_.end(),
                     {static_cast<float>(px(c)), static_cast<float>(height(c, r)),
                      static_cast<float>(pz(r)), static_cast<float>(n[0]), static_cast<float>(n[1]),
                      static_cast<float>(n[2]), color.r, color.g, color.b});
  };
  for (size_t r = 0; r + 1 < rows; ++r) {
    for (size_t c = 0; c + 1 < cols; ++c) {
      vertex(c, r);
      vertex(c + 1, r);
      vertex(c + 1, r + 1);
      vertex(c, r);
      vertex(c + 1, r + 1);
      vertex(c, r + 1);
    }
  }
}

bool SurfaceLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool SurfaceLayer::color_info(photon::ColorInfo& out) const {
  if (!lut_) return false;
  out.lut = lut_;
  out.domain = domain_;
  out.label = name_;
  return true;
}

bool SurfaceLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the surface buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, wireframe_ ? std::vector<int>{3, 3} : std::vector<int>{3, 3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool SurfaceLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                        std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  if (wireframe_) {
    const Program* program = get_program(api, "plot3d.colorline", kColorLineVert, kColorLineFrag,
                                         {"uMVP"}, gfx, error);
    if (!program) return false;
    api.UseProgram(program->id);
    api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
    api.BindVertexArray(vao_);
    api.DrawArrays(GL_LINES, 0, static_cast<GLsizei>(vertices_.size() / 6));
    api.BindVertexArray(0);
    return true;
  }
  const Program* program = get_program(api, "plot3d.mesh", kMeshVert, kMeshFrag,
                                       {"uMVP", "uLightDir", "uAmbient"}, gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.Uniform3f(program->uniform("uLightDir"), light.x, light.y, light.z);
  api.Uniform1f(program->uniform("uAmbient"), light.ambient);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertices_.size() / 9));
  api.BindVertexArray(0);
  return true;
}

void SurfaceLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- PointCloudLayer --------------------------------------------------------

PointCloudLayer::PointCloudLayer(const ph_pointcloud_desc& desc) {
  name_ = desc.name ? desc.name : "";
  color_ = desc.color;
  size_ = desc.size > 0.0f ? desc.size : 4.0f;
  render_type_ = desc.render_type;
  const size_t n = static_cast<size_t>(std::max(0, desc.count));
  if (!desc.x || !desc.y || !desc.z || n == 0) return;

  if (desc.values) {
    const photon::color::Spec spec = spec_of(desc.colormap);
    lut_ = &photon::color::lut(spec);
    domain_ = measure(desc.values, n, desc.domain);
  }
  const Rgb3 flat = unpack(desc.color);

  bool any = false;
  vertices_.reserve(n * 6);
  for (size_t i = 0; i < n; ++i) {
    extend(bounds_, any, desc.x[i], desc.y[i], desc.z[i]);
    const Rgb3 color = lut_ ? sample(*lut_, domain_, desc.values[i]) : flat;
    vertices_.insert(vertices_.end(),
                     {static_cast<float>(desc.x[i]), static_cast<float>(desc.y[i]),
                      static_cast<float>(desc.z[i]), color.r, color.g, color.b});
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);
}

bool PointCloudLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool PointCloudLayer::color_info(photon::ColorInfo& out) const {
  if (!lut_) return false;
  out.lut = lut_;
  out.domain = domain_;
  out.label = name_;
  return true;
}

bool PointCloudLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the point cloud buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, {3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool PointCloudLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                           std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  const Program* program =
      get_program(api, "plot3d.point", kPointVert, kPointFrag, {"uMVP", "uSize"}, gfx, error);
  if (!program) return false;
  // WebGL2 has this permanently on; a desktop core profile does not, and
  // without it gl_PointSize is ignored and every point is one pixel.
  if (gfx == PH_GFX_GL33) api.Enable(GL_PROGRAM_POINT_SIZE);
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.Uniform1f(program->uniform("uSize"), size_);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_POINTS, 0, static_cast<GLsizei>(vertices_.size() / 6));
  api.BindVertexArray(0);
  (void)light;
  return true;
}

void PointCloudLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- Line3DLayer ------------------------------------------------------------

Line3DLayer::Line3DLayer(const ph_line3d_desc& desc) {
  name_ = desc.name ? desc.name : "";
  color_ = desc.color;
  render_type_ = desc.render_type;
  mode_ = GL_LINE_STRIP;
  const size_t n = static_cast<size_t>(std::max(0, desc.count));
  if (!desc.x || !desc.y || !desc.z || n == 0) return;

  const Rgb3 color = unpack(desc.color);
  bool any = false;
  vertices_.reserve(n * 6);
  for (size_t i = 0; i < n; ++i) {
    extend(bounds_, any, desc.x[i], desc.y[i], desc.z[i]);
    vertices_.insert(vertices_.end(),
                     {static_cast<float>(desc.x[i]), static_cast<float>(desc.y[i]),
                      static_cast<float>(desc.z[i]), color.r, color.g, color.b});
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);
}

Line3DLayer::Line3DLayer(const ph_quiver3d_desc& desc) {
  name_ = desc.name ? desc.name : "";
  color_ = desc.color;
  render_type_ = desc.render_type;
  mode_ = GL_LINES;
  const size_t n = static_cast<size_t>(std::max(0, desc.count));
  if (!desc.x || !desc.y || !desc.z || !desc.u || !desc.v || !desc.w || n == 0) return;
  const double scale = desc.scale != 0.0 ? desc.scale : 1.0;

  std::vector<double> magnitude;
  if (desc.color_by_magnitude) {
    magnitude.resize(n);
    for (size_t i = 0; i < n; ++i) {
      magnitude[i] = std::sqrt(desc.u[i] * desc.u[i] + desc.v[i] * desc.v[i] +
                               desc.w[i] * desc.w[i]);
    }
    const photon::color::Spec spec = spec_of(desc.colormap);
    lut_ = &photon::color::lut(spec);
    domain_ = measure(magnitude.data(), n, ph_range{0.0, 0.0});
  }
  const Rgb3 flat = unpack(desc.color);

  bool any = false;
  vertices_.reserve(n * 12);
  for (size_t i = 0; i < n; ++i) {
    const double tip_x = desc.x[i] + desc.u[i] * scale;
    const double tip_y = desc.y[i] + desc.v[i] * scale;
    const double tip_z = desc.z[i] + desc.w[i] * scale;
    extend(bounds_, any, desc.x[i], desc.y[i], desc.z[i]);
    extend(bounds_, any, tip_x, tip_y, tip_z);
    const Rgb3 color = lut_ ? sample(*lut_, domain_, magnitude[i]) : flat;
    vertices_.insert(vertices_.end(),
                     {static_cast<float>(desc.x[i]), static_cast<float>(desc.y[i]),
                      static_cast<float>(desc.z[i]), color.r, color.g, color.b,
                      static_cast<float>(tip_x), static_cast<float>(tip_y),
                      static_cast<float>(tip_z), color.r, color.g, color.b});
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);
}

bool Line3DLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool Line3DLayer::color_info(photon::ColorInfo& out) const {
  if (!lut_) return false;
  out.lut = lut_;
  out.domain = domain_;
  out.label = name_;
  return true;
}

bool Line3DLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the 3-D line buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, {3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool Line3DLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                       std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  const Program* program = get_program(api, "plot3d.colorline", kColorLineVert, kColorLineFrag,
                                       {"uMVP"}, gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.BindVertexArray(vao_);
  api.DrawArrays(mode_, 0, static_cast<GLsizei>(vertices_.size() / 6));
  api.BindVertexArray(0);
  (void)light;
  return true;
}

void Line3DLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- Contour3DLayer ---------------------------------------------------------

namespace {

/// Marching squares: which edge pairs each of the sixteen corner-sign cases
/// joins. e0 is the bottom edge, then right, top, left.
constexpr int kSquareCases[16][5] = {
    {-1},          {3, 0, -1},    {0, 1, -1},    {3, 1, -1},
    {1, 2, -1},    {3, 0, 1, 2, -1}, {0, 2, -1}, {3, 2, -1},
    {2, 3, -1},    {2, 0, -1},    {0, 1, 2, 3, -1}, {2, 1, -1},
    {1, 3, -1},    {1, 0, -1},    {0, 3, -1},    {-1},
};

}  // namespace

Contour3DLayer::Contour3DLayer(const ph_contour3d_desc& desc) {
  name_ = desc.name ? desc.name : "";
  color_ = desc.color;
  render_type_ = desc.render_type;
  const size_t cols = static_cast<size_t>(std::max(0, desc.cols));
  const size_t rows = static_cast<size_t>(std::max(0, desc.rows));
  if (!desc.values || cols < 2 || rows < 2) return;

  const ph_range span = measure(desc.values, cols * rows, ph_range{0.0, 0.0});
  const double vmin = span.lo;
  const double vspan = span.hi - span.lo == 0.0 ? 1.0 : span.hi - span.lo;

  std::vector<double> levels;
  if (desc.level_values && desc.level_count > 0) {
    levels.assign(desc.level_values, desc.level_values + desc.level_count);
  } else {
    const int count = desc.levels > 0 ? desc.levels : 10;
    for (int i = 0; i < count; ++i) {
      levels.push_back(vmin + vspan * static_cast<double>(i + 1) / static_cast<double>(count + 1));
    }
  }

  const bool fixed = desc.color != PH_COLOR_AUTO;
  if (!fixed) {
    const photon::color::Spec spec = spec_of(desc.colormap);
    lut_ = &photon::color::lut(spec);
    domain_ = span;
  }
  const Rgb3 flat = unpack(desc.color);

  const double x0 = desc.x.lo == desc.x.hi ? 0.0 : desc.x.lo;
  const double x1 = desc.x.lo == desc.x.hi ? static_cast<double>(cols - 1) : desc.x.hi;
  const double z0 = desc.z.lo == desc.z.hi ? 0.0 : desc.z.lo;
  const double z1 = desc.z.lo == desc.z.hi ? static_cast<double>(rows - 1) : desc.z.hi;
  const auto wx = [&](size_t c) {
    return x0 + (x1 - x0) * static_cast<double>(c) / static_cast<double>(cols - 1);
  };
  const auto wz = [&](size_t r) {
    return z0 + (z1 - z0) * static_cast<double>(r) / static_cast<double>(rows - 1);
  };
  const auto at = [&](size_t c, size_t r) { return desc.values[r * cols + c]; };

  for (const double level : levels) {
    const Rgb3 color = fixed ? flat : sample(*lut_, domain_, level);
    for (size_t r = 0; r + 1 < rows; ++r) {
      for (size_t c = 0; c + 1 < cols; ++c) {
        const double v0 = at(c, r);
        const double v1 = at(c + 1, r);
        const double v2 = at(c + 1, r + 1);
        const double v3 = at(c, r + 1);
        const int index = (v0 >= level ? 1 : 0) | (v1 >= level ? 2 : 0) | (v2 >= level ? 4 : 0) |
                          (v3 >= level ? 8 : 0);
        if (kSquareCases[index][0] < 0) continue;
        const auto crossing = [&](int e) {
          const auto lerp = [](double t, double ax, double az, double bx, double bz) {
            return std::array<double, 2>{ax + (bx - ax) * t, az + (bz - az) * t};
          };
          if (e == 0) return lerp((level - v0) / ((v1 - v0) == 0.0 ? 1e-9 : v1 - v0), wx(c), wz(r), wx(c + 1), wz(r));
          if (e == 1) return lerp((level - v1) / ((v2 - v1) == 0.0 ? 1e-9 : v2 - v1), wx(c + 1), wz(r), wx(c + 1), wz(r + 1));
          if (e == 2) return lerp((level - v2) / ((v3 - v2) == 0.0 ? 1e-9 : v3 - v2), wx(c + 1), wz(r + 1), wx(c), wz(r + 1));
          return lerp((level - v3) / ((v0 - v3) == 0.0 ? 1e-9 : v0 - v3), wx(c), wz(r + 1), wx(c), wz(r));
        };
        for (int i = 0; kSquareCases[index][i] >= 0; i += 2) {
          const std::array<double, 2> pa = crossing(kSquareCases[index][i]);
          const std::array<double, 2> pb = crossing(kSquareCases[index][i + 1]);
          // The line sits at its own level's height, which is what stacks the
          // levels into a floating map instead of flattening them onto a plane.
          vertices_.insert(vertices_.end(),
                           {static_cast<float>(pa[0]), static_cast<float>(level),
                            static_cast<float>(pa[1]), color.r, color.g, color.b,
                            static_cast<float>(pb[0]), static_cast<float>(level),
                            static_cast<float>(pb[1]), color.r, color.g, color.b});
        }
      }
    }
  }

  bounds_.x = ph_range{x0, x1};
  bounds_.y = span;
  bounds_.z = ph_range{z0, z1};
  has_bounds_ = true;
  pad_degenerate(bounds_);
}

bool Contour3DLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool Contour3DLayer::color_info(photon::ColorInfo& out) const {
  if (!lut_) return false;
  out.lut = lut_;
  out.domain = domain_;
  out.label = name_;
  return true;
}

bool Contour3DLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the 3-D contour buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, {3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool Contour3DLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                          std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  const Program* program = get_program(api, "plot3d.colorline", kColorLineVert, kColorLineFrag,
                                       {"uMVP"}, gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_LINES, 0, static_cast<GLsizei>(vertices_.size() / 6));
  api.BindVertexArray(0);
  (void)light;
  return true;
}

void Contour3DLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- Boxes3DLayer -----------------------------------------------------------

namespace {

/// A unit cube centred on the origin, six faces with their own normals.
struct CubeFace {
  float nx, ny, nz;
  float v[6][3];
};

constexpr CubeFace kCubeFaces[6] = {
    {1, 0, 0, {{0.5f, -0.5f, -0.5f}, {0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, 0.5f},
               {0.5f, -0.5f, -0.5f}, {0.5f, 0.5f, 0.5f}, {0.5f, -0.5f, 0.5f}}},
    {-1, 0, 0, {{-0.5f, -0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, -0.5f},
                {-0.5f, -0.5f, 0.5f}, {-0.5f, 0.5f, -0.5f}, {-0.5f, -0.5f, -0.5f}}},
    {0, 1, 0, {{-0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, 0.5f},
               {-0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f}}},
    {0, -1, 0, {{-0.5f, -0.5f, 0.5f}, {0.5f, -0.5f, 0.5f}, {0.5f, -0.5f, -0.5f},
                {-0.5f, -0.5f, 0.5f}, {0.5f, -0.5f, -0.5f}, {-0.5f, -0.5f, -0.5f}}},
    {0, 0, 1, {{-0.5f, -0.5f, 0.5f}, {0.5f, -0.5f, 0.5f}, {0.5f, 0.5f, 0.5f},
               {-0.5f, -0.5f, 0.5f}, {0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f}}},
    {0, 0, -1, {{0.5f, -0.5f, -0.5f}, {-0.5f, -0.5f, -0.5f}, {-0.5f, 0.5f, -0.5f},
                {0.5f, -0.5f, -0.5f}, {-0.5f, 0.5f, -0.5f}, {0.5f, 0.5f, -0.5f}}},
};

}  // namespace

Boxes3DLayer::Boxes3DLayer(const ph_boxes3d_desc& desc) {
  name_ = desc.name ? desc.name : "";
  color_ = desc.color;
  render_type_ = desc.render_type;
  const size_t n = static_cast<size_t>(std::max(0, desc.count));
  if (!desc.boxes || n == 0) return;

  const Rgb3 fallback = unpack(desc.color);
  // Opacity multiplies the colour rather than the alpha: the mesh shader writes
  // an opaque fragment, so a translucent box is one that is drawn dimmer. That
  // is a real difference from the web core, which blends — and blending without
  // depth sorting composites out of order anyway.
  const float opacity = desc.opacity > 0.0f ? std::min(desc.opacity, 1.0f) : 1.0f;

  bool any = false;
  vertices_.reserve(n * 36 * 9);
  for (size_t i = 0; i < n; ++i) {
    const ph_box3d& box = desc.boxes[i];
    const Rgb3 base = box.color != PH_COLOR_AUTO ? unpack(box.color) : fallback;
    const Rgb3 color{base.r * opacity, base.g * opacity, base.b * opacity};
    extend(bounds_, any, box.x - box.w / 2.0, box.y - box.h / 2.0, box.z - box.d / 2.0);
    extend(bounds_, any, box.x + box.w / 2.0, box.y + box.h / 2.0, box.z + box.d / 2.0);
    for (const CubeFace& face : kCubeFaces) {
      for (int v = 0; v < 6; ++v) {
        vertices_.insert(vertices_.end(),
                         {static_cast<float>(box.x + face.v[v][0] * box.w),
                          static_cast<float>(box.y + face.v[v][1] * box.h),
                          static_cast<float>(box.z + face.v[v][2] * box.d), face.nx, face.ny,
                          face.nz, color.r, color.g, color.b});
      }
    }
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);
}

bool Boxes3DLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool Boxes3DLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the 3-D box buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, {3, 3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool Boxes3DLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                        std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  const Program* program = get_program(api, "plot3d.mesh", kMeshVert, kMeshFrag,
                                       {"uMVP", "uLightDir", "uAmbient"}, gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.Uniform3f(program->uniform("uLightDir"), light.x, light.y, light.z);
  api.Uniform1f(program->uniform("uAmbient"), light.ambient);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertices_.size() / 9));
  api.BindVertexArray(0);
  return true;
}

void Boxes3DLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- IsosurfaceLayer --------------------------------------------------------

IsosurfaceLayer::IsosurfaceLayer(const ph_isosurface_desc& desc) {
  name_ = desc.name ? desc.name : "";
  color_ = desc.color;
  render_type_ = desc.render_type;
  const size_t nx = static_cast<size_t>(std::max(0, desc.nx));
  const size_t ny = static_cast<size_t>(std::max(0, desc.ny));
  const size_t nz = static_cast<size_t>(std::max(0, desc.nz));
  if (!desc.values || nx < 2 || ny < 2 || nz < 2) return;

  const Mesh mesh = marching_cubes(desc.values, nx, ny, nz, desc.level, desc.x.lo, desc.x.hi,
                                   desc.y.lo, desc.y.hi, desc.z.lo, desc.z.hi);
  const Rgb3 color = unpack(desc.color);
  bool any = false;
  vertices_.reserve(mesh.positions.size() * 3);
  for (size_t i = 0; i + 2 < mesh.positions.size(); i += 3) {
    extend(bounds_, any, mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
    vertices_.insert(vertices_.end(),
                     {mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2],
                      mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2], color.r, color.g,
                      color.b});
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);
}

bool IsosurfaceLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool IsosurfaceLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the isosurface buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, {3, 3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool IsosurfaceLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                           std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  const Program* program = get_program(api, "plot3d.mesh", kMeshVert, kMeshFrag,
                                       {"uMVP", "uLightDir", "uAmbient"}, gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.Uniform3f(program->uniform("uLightDir"), light.x, light.y, light.z);
  api.Uniform1f(program->uniform("uAmbient"), light.ambient);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertices_.size() / 9));
  api.BindVertexArray(0);
  return true;
}

void IsosurfaceLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

// -- Bar3DLayer -------------------------------------------------------------

Bar3DLayer::Bar3DLayer(const ph_bar3d_desc& desc) {
  name_ = desc.name ? desc.name : "";
  render_type_ = desc.render_type;
  const size_t cols = static_cast<size_t>(std::max(0, desc.cols));
  const size_t rows = static_cast<size_t>(std::max(0, desc.rows));
  if (!desc.values || cols == 0 || rows == 0) return;

  const photon::color::Spec spec = spec_of(desc.colormap);
  lut_ = &photon::color::lut(spec);
  domain_ = measure(desc.values, cols * rows, desc.domain);

  const double x0 = desc.x.lo == desc.x.hi ? 0.0 : desc.x.lo;
  const double x1 = desc.x.lo == desc.x.hi ? static_cast<double>(cols) : desc.x.hi;
  const double z0 = desc.z.lo == desc.z.hi ? 0.0 : desc.z.lo;
  const double z1 = desc.z.lo == desc.z.hi ? static_cast<double>(rows) : desc.z.hi;
  const double cell_x = (x1 - x0) / static_cast<double>(cols);
  const double cell_z = (z1 - z0) / static_cast<double>(rows);
  const double fill = desc.fill > 0.0 ? std::min(desc.fill, 1.0) : 0.8;

  bool any = false;
  // Five faces a bar — the bottom is never visible from above the floor, and
  // leaving it out is a fifth of the geometry for nothing lost.
  vertices_.reserve(cols * rows * 5 * 6 * 9);
  for (size_t r = 0; r < rows; ++r) {
    for (size_t c = 0; c < cols; ++c) {
      const double value = desc.values[r * cols + c];
      if (!std::isfinite(value)) continue;
      const double cx = x0 + (static_cast<double>(c) + 0.5) * cell_x;
      const double cz = z0 + (static_cast<double>(r) + 0.5) * cell_z;
      const double hx = cell_x * fill / 2.0;
      const double hz = cell_z * fill / 2.0;
      const double lo = std::min(0.0, value);
      const double hi = std::max(0.0, value);
      extend(bounds_, any, cx - hx, lo, cz - hz);
      extend(bounds_, any, cx + hx, hi, cz + hz);
      const Rgb3 color = sample(*lut_, domain_, value);

      const double xs[2] = {cx - hx, cx + hx};
      const double zs[2] = {cz - hz, cz + hz};
      const auto quad = [&](double ax, double ay, double az, double bx, double by, double bz,
                            double dx, double dy, double dz, double ex, double ey, double ez,
                            float nx, float ny, float nz) {
        const double px[6] = {ax, bx, dx, ax, dx, ex};
        const double py[6] = {ay, by, dy, ay, dy, ey};
        const double pz[6] = {az, bz, dz, az, dz, ez};
        for (int i = 0; i < 6; ++i) {
          vertices_.insert(vertices_.end(),
                           {static_cast<float>(px[i]), static_cast<float>(py[i]),
                            static_cast<float>(pz[i]), nx, ny, nz, color.r, color.g, color.b});
        }
      };
      // Top.
      quad(xs[0], hi, zs[0], xs[1], hi, zs[0], xs[1], hi, zs[1], xs[0], hi, zs[1], 0, 1, 0);
      // The four sides, each with its own outward normal.
      quad(xs[0], lo, zs[0], xs[1], lo, zs[0], xs[1], hi, zs[0], xs[0], hi, zs[0], 0, 0, -1);
      quad(xs[1], lo, zs[1], xs[0], lo, zs[1], xs[0], hi, zs[1], xs[1], hi, zs[1], 0, 0, 1);
      quad(xs[0], lo, zs[1], xs[0], lo, zs[0], xs[0], hi, zs[0], xs[0], hi, zs[1], -1, 0, 0);
      quad(xs[1], lo, zs[0], xs[1], lo, zs[1], xs[1], hi, zs[1], xs[1], hi, zs[0], 1, 0, 0);
    }
  }
  has_bounds_ = any;
  if (has_bounds_) pad_degenerate(bounds_);
}

bool Bar3DLayer::bounds3(Bounds3& out) const {
  if (!has_bounds_) return false;
  out = bounds_;
  return true;
}

bool Bar3DLayer::color_info(photon::ColorInfo& out) const {
  if (!lut_) return false;
  out.lut = lut_;
  out.domain = domain_;
  out.label = name_;
  return true;
}

bool Bar3DLayer::ensure_gl(gl::Api& api, std::string& error) {
  if (vao_ == 0) {
    api.GenVertexArrays(1, &vao_);
    api.GenBuffers(1, &buffer_);
    if (vao_ == 0 || buffer_ == 0) {
      error = "failed to create the 3-D bar buffers";
      return false;
    }
  }
  if (!dirty_) return true;
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices_.size() * sizeof(float)),
                 vertices_.data(), buffer_usage(render_type_));
  bind_attributes(api, {3, 3, 3});
  api.BindVertexArray(0);
  dirty_ = false;
  return true;
}

bool Bar3DLayer::draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                      std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;
  const Program* program = get_program(api, "plot3d.mesh", kMeshVert, kMeshFrag,
                                       {"uMVP", "uLightDir", "uAmbient"}, gfx, error);
  if (!program) return false;
  api.UseProgram(program->id);
  api.UniformMatrix4fv(program->uniform("uMVP"), 1, GL_FALSE_, mvp.data());
  api.Uniform3f(program->uniform("uLightDir"), light.x, light.y, light.z);
  api.Uniform1f(program->uniform("uAmbient"), light.ambient);
  api.BindVertexArray(vao_);
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertices_.size() / 9));
  api.BindVertexArray(0);
  return true;
}

void Bar3DLayer::release_gl(gl::Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  dirty_ = true;
}

}  // namespace photon::plot3d
