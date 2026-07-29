#include "render/primitives.hpp"

#include <algorithm>
#include <cmath>

#include "gl/program.hpp"

namespace photon::render {
namespace {

using namespace photon::gl;

constexpr int kFloatsPerVertex = 6;

const char* const kVert = R"(#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
uniform vec2 uPixelScale;
uniform vec2 uPixelOffset;
out vec4 vColor;

void main() {
  vColor = aColor;
  gl_Position = vec4(aPos * uPixelScale + uPixelOffset, 0.0, 1.0);
})";

const char* const kFrag = R"(#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;

void main() {
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
})";

}  // namespace

void Primitives::rect(float x, float y, float w, float h, Rgba color) {
  if (w <= 0.0f || h <= 0.0f || !color.visible()) return;
  const float x1 = x + w;
  const float y1 = y + h;
  const float cx[6] = {x, x1, x1, x, x1, x};
  const float cy[6] = {y, y, y1, y, y1, y1};
  for (int i = 0; i < 6; ++i) {
    vertices_.push_back(cx[i]);
    vertices_.push_back(cy[i]);
    vertices_.push_back(color.r);
    vertices_.push_back(color.g);
    vertices_.push_back(color.b);
    vertices_.push_back(color.a);
  }
}

void Primitives::hairline(bool vertical, float pos, float from, float to, float thickness,
                          Rgba color) {
  // Round the thickness to whole device pixels and never below one, then place
  // the near edge so the rectangle covers exactly those pixels. That is what
  // `Math.round(x) + 0.5` buys on a 2D canvas, minus the half-pixel dance.
  const float t = std::max(1.0f, std::round(thickness));
  const float start = std::round(pos - t * 0.5f);
  const float a = std::round(std::min(from, to));
  const float b = std::round(std::max(from, to));
  if (b <= a) return;
  if (vertical) {
    rect(start, a, t, b - a, color);
  } else {
    rect(a, start, b - a, t, color);
  }
}

void Primitives::segment(float x0, float y0, float x1, float y1, float thickness, Rgba color) {
  if (!color.visible()) return;
  const float dx = x1 - x0;
  const float dy = y1 - y0;
  const float len = std::sqrt(dx * dx + dy * dy);
  if (len <= 0.0f) return;
  const float nx = -dy / len * thickness * 0.5f;
  const float ny = dx / len * thickness * 0.5f;
  // Two triangles round the quad's four corners, in the same winding rect()
  // uses so the two share one draw.
  const float cx[6] = {x0 + nx, x1 + nx, x1 - nx, x0 + nx, x1 - nx, x0 - nx};
  const float cy[6] = {y0 + ny, y1 + ny, y1 - ny, y0 + ny, y1 - ny, y0 - ny};
  for (int i = 0; i < 6; ++i) {
    vertices_.push_back(cx[i]);
    vertices_.push_back(cy[i]);
    vertices_.push_back(color.r);
    vertices_.push_back(color.g);
    vertices_.push_back(color.b);
    vertices_.push_back(color.a);
  }
}

void Primitives::dashed_hairline(bool vertical, float pos, float from, float to, float thickness,
                                 const std::vector<float>& dash, Rgba color) {
  if (dash.empty()) {
    hairline(vertical, pos, from, to, thickness, color);
    return;
  }
  float period = 0.0f;
  for (const float d : dash) period += std::max(0.0f, d);
  // Below half a device pixel a dash pattern is a solid line anyway, and
  // treating it as one is also what keeps the loop below finite.
  if (period < 0.5f) {
    hairline(vertical, pos, from, to, thickness, color);
    return;
  }

  const float a = std::min(from, to);
  const float b = std::max(from, to);
  // Odd-length patterns repeat with the phase inverted, exactly as CSS and
  // Canvas2D's setLineDash do — [5] is on 5, off 5.
  const size_t cycle = dash.size() % 2 == 0 ? dash.size() : dash.size() * 2;
  // Each full cycle advances by `period`, so this bounds the loop even when
  // individual entries in the pattern are zero.
  const size_t limit = (static_cast<size_t>((b - a) / period) + 2) * cycle;

  float at = a;
  size_t i = 0;
  for (size_t step = 0; at < b && step < limit; ++step) {
    const float length = std::max(0.0f, dash[i % dash.size()]);
    const float end = std::min(b, at + length);
    if (i % 2 == 0 && end > at) hairline(vertical, pos, at, end, thickness, color);
    at = end;
    i = (i + 1) % cycle;
  }
}

bool Primitives::ensure_gl(Api& api, std::string& error) {
  if (vao_ != 0) return true;
  api.GenVertexArrays(1, &vao_);
  api.GenBuffers(1, &buffer_);
  if (vao_ == 0 || buffer_ == 0) {
    error = "failed to create the overlay vertex array";
    return false;
  }
  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  const GLsizei stride = kFloatsPerVertex * static_cast<GLsizei>(sizeof(float));
  const auto at = [](size_t index) { return reinterpret_cast<const void*>(index * sizeof(float)); };
  api.EnableVertexAttribArray(0);
  api.VertexAttribPointer(0, 2, GL_FLOAT, 0, stride, at(0));
  api.EnableVertexAttribArray(1);
  api.VertexAttribPointer(1, 4, GL_FLOAT, 0, stride, at(2));
  api.BindVertexArray(0);
  return true;
}

bool Primitives::flush(Api& api, ph_gfx_api gfx, const PixelTransform& transform,
                       std::string& error) {
  if (vertices_.empty()) return true;
  if (!ensure_gl(api, error)) return false;

  static const std::vector<std::string> kUniforms = {"uPixelScale", "uPixelOffset"};
  const Program* program = get_program(api, "primitives", kVert, kFrag, kUniforms, gfx, error);
  if (!program) return false;

  api.BindVertexArray(vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, buffer_);
  const size_t bytes = vertices_.size() * sizeof(float);
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
  api.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertices_.size() / kFloatsPerVertex));
  api.BindVertexArray(0);
  vertices_.clear();
  return true;
}

void Primitives::release_gl(Api& api) {
  if (vao_ == 0) return;
  api.DeleteVertexArrays(1, &vao_);
  api.DeleteBuffers(1, &buffer_);
  vao_ = 0;
  buffer_ = 0;
  capacity_ = 0;
}

}  // namespace photon::render
