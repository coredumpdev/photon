#include "plot3d/plot3d.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "axes/ticks.hpp"
#include "color.hpp"
#include "gl/program.hpp"
#include "render/theme.hpp"

namespace photon::plot3d {

using namespace photon::gl;

namespace {

constexpr double kPi = 3.14159265358979323846;
/// The elevation clamp, so the camera never passes through the poles and the
/// up vector never degenerates.
constexpr double kMaxElevation = 1.5;

/// The twelve edges of the unit cube, as line segments in cube space.
constexpr float kBoxEdges[] = {
    -1, -1, -1, 1,  -1, -1, 1,  -1, -1, 1,  1,  -1, 1,  1,  -1, -1, 1,  -1,
    -1, 1,  -1, -1, -1, -1, -1, -1, 1,  1,  -1, 1,  1,  -1, 1,  1,  1,  1,
    1,  1,  1,  -1, 1,  1,  -1, 1,  1,  -1, -1, 1,  -1, -1, -1, -1, -1, 1,
    1,  -1, -1, 1,  -1, 1,  1,  1,  -1, 1,  1,  1,  -1, 1,  -1, -1, 1,  1,
};

const char* kLineVert = R"(#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }
)";

const char* kLineFrag = R"(#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }
)";

std::string from_utf8(const char* text) { return text ? std::string(text) : std::string(); }

}  // namespace

Plot3D::Plot3D(const ph_plot3d_desc& desc) : owner_(std::this_thread::get_id()) {
  width_ = desc.width > 0 ? desc.width : 640;
  height_ = desc.height > 0 ? desc.height : 420;
  theme_ = desc.theme;
  background_ = desc.background;
  title_ = from_utf8(desc.title);
  label_x_ = from_utf8(desc.x_label);
  label_y_ = from_utf8(desc.y_label);
  label_z_ = from_utf8(desc.z_label);
  azimuth_ = desc.azimuth != 0.0 ? desc.azimuth : 0.7;
  elevation_ = desc.elevation != 0.0 ? desc.elevation : 0.5;
  distance_ = desc.distance > 0.0 ? desc.distance : 3.6;
  initial_azimuth_ = azimuth_;
  initial_elevation_ = elevation_;
  initial_distance_ = distance_;
  aspect_ = desc.aspect_mode == PH_ASPECT_DATA ? AspectMode::Data : AspectMode::Cube;
  projection_ =
      desc.projection == PH_PROJECTION_ORTHOGRAPHIC ? Projection::Orthographic : Projection::Perspective;
  grid_planes_ = desc.no_grid_planes == 0;
  show_axes_ = desc.no_axes == 0;
  interactive_ = desc.no_interaction == 0;
}

Plot3D::~Plot3D() = default;

void Plot3D::set_size(int32_t width, int32_t height) {
  if (width <= 0 || height <= 0) return;
  width_ = width;
  height_ = height;
  request_render();
}

void Plot3D::set_theme(ph_theme theme) {
  theme_ = theme;
  request_render();
}

void Plot3D::set_title(const char* title) {
  title_ = from_utf8(title);
  request_render();
}

void Plot3D::set_axis_labels(const char* x, const char* y, const char* z) {
  label_x_ = from_utf8(x);
  label_y_ = from_utf8(y);
  label_z_ = from_utf8(z);
  build_axes();
  request_render();
}

void Plot3D::set_camera(double azimuth, double elevation, double distance) {
  azimuth_ = azimuth;
  elevation_ = std::clamp(elevation, -kMaxElevation, kMaxElevation);
  if (distance > 0.0) distance_ = distance;
  request_render();
  ph_event event{};
  event.type = PH_EVENT_VIEW_CHANGED;
  emit(event);
}

void Plot3D::get_camera(double& azimuth, double& elevation, double& distance) const {
  azimuth = azimuth_;
  elevation = elevation_;
  distance = distance_;
}

void Plot3D::set_light(const Light& light) {
  // An all-zero direction would make every surface black; treat it as "leave it".
  if (light.x != 0.0f || light.y != 0.0f || light.z != 0.0f) {
    light_.x = light.x;
    light_.y = light.y;
    light_.z = light.z;
  }
  light_.ambient = std::clamp(light.ambient, 0.0f, 1.0f);
  request_render();
}

void Plot3D::reset_view() {
  azimuth_ = initial_azimuth_;
  elevation_ = initial_elevation_;
  distance_ = initial_distance_;
  request_render();
  ph_event event{};
  event.type = PH_EVENT_VIEW_CHANGED;
  emit(event);
}

Layer3D* Plot3D::add_layer(std::unique_ptr<Layer3D> layer) {
  layers_.push_back(std::move(layer));
  Layer3D* borrowed = layers_.back().get();
  refit();
  return borrowed;
}

bool Plot3D::remove_layer(Layer3D* layer, gl::Api* api) {
  const auto it = std::find_if(layers_.begin(), layers_.end(),
                               [layer](const std::unique_ptr<Layer3D>& l) { return l.get() == layer; });
  if (it == layers_.end()) return false;
  if (api && api->ready) (*it)->release_gl(*api);
  layers_.erase(it);
  refit();
  return true;
}

void Plot3D::refit() {
  Bounds3 merged;
  bool any = false;
  for (const std::unique_ptr<Layer3D>& layer : layers_) {
    Bounds3 b;
    if (!layer->bounds3(b)) continue;
    if (!any) {
      merged = b;
      any = true;
      continue;
    }
    merged.x.lo = std::min(merged.x.lo, b.x.lo);
    merged.x.hi = std::max(merged.x.hi, b.x.hi);
    merged.y.lo = std::min(merged.y.lo, b.y.lo);
    merged.y.hi = std::max(merged.y.hi, b.y.hi);
    merged.z.lo = std::min(merged.z.lo, b.z.lo);
    merged.z.hi = std::max(merged.z.hi, b.z.hi);
  }
  if (!any) return;
  bounds_ = merged;
  has_bounds_ = true;

  // "cube" stretches each axis to fill [-1,1]; "data" uses one shared scale, so
  // the longest axis fills the cube and the others keep their true proportion.
  const double longest = std::max({merged.x.hi - merged.x.lo, merged.y.hi - merged.y.lo,
                                   merged.z.hi - merged.z.lo});
  const double shared = aspect_ == AspectMode::Data ? 2.0 / (longest > 0.0 ? longest : 1.0) : 0.0;
  const auto axis = [shared](ph_range r) {
    if (shared != 0.0) return std::pair<double, double>{shared, -shared * (r.lo + r.hi) / 2.0};
    const double span = r.hi - r.lo;
    if (span == 0.0) return std::pair<double, double>{1.0, -r.lo};
    return std::pair<double, double>{2.0 / span, -(r.hi + r.lo) / span};
  };
  const auto [sx, tx] = axis(merged.x);
  const auto [sy, ty] = axis(merged.y);
  const auto [sz, tz] = axis(merged.z);
  normalize_ = scale_translate({sx, sy, sz}, {tx, ty, tz});
  build_axes();
  request_render();
}

void Plot3D::build_axes() {
  ticks_x_.clear();
  ticks_y_.clear();
  ticks_z_.clear();
  tick_lines_.clear();
  labels_.clear();
  if (!has_bounds_) return;

  const auto cube = [](ph_range r, double v) {
    const double span = r.hi - r.lo;
    return static_cast<float>(2.0 * (v - r.lo) / (span == 0.0 ? 1.0 : span) - 1.0);
  };
  const auto mark = [this](float x0, float y0, float z0, float x1, float y1, float z1) {
    tick_lines_.insert(tick_lines_.end(), {x0, y0, z0, x1, y1, z1});
  };
  // An empty label means "format it yourself" — a 2-D axis asks its scale, and
  // a 3-D axis has no scale, so it asks the shared default the way drawTitle's
  // counterpart in the web core does.
  const auto label_of = [](const Tick& t) {
    return t.label.empty() ? default_format(t.value) : t.label;
  };

  for (const Tick& t : auto_ticks(bounds_.x.lo, bounds_.x.hi, 5)) {
    const float cx = cube(bounds_.x, t.value);
    ticks_x_.push_back(cx);
    mark(cx, -1.0f, -1.0f, cx, -1.0f, -1.06f);
    labels_.push_back(CubeLabel{cx, -1.0f, -1.16f, label_of(t), false});
  }
  for (const Tick& t : auto_ticks(bounds_.y.lo, bounds_.y.hi, 5)) {
    const float cy = cube(bounds_.y, t.value);
    ticks_y_.push_back(cy);
    mark(-1.0f, cy, -1.0f, -1.06f, cy, -1.0f);
    labels_.push_back(CubeLabel{-1.16f, cy, -1.0f, label_of(t), false});
  }
  for (const Tick& t : auto_ticks(bounds_.z.lo, bounds_.z.hi, 5)) {
    const float cz = cube(bounds_.z, t.value);
    ticks_z_.push_back(cz);
    mark(-1.0f, -1.0f, cz, -1.06f, -1.0f, cz);
    labels_.push_back(CubeLabel{-1.16f, -1.0f, cz, label_of(t), false});
  }
  if (!label_x_.empty()) labels_.push_back(CubeLabel{0.0f, -1.25f, -1.3f, label_x_, true});
  if (!label_y_.empty()) labels_.push_back(CubeLabel{-1.35f, 0.0f, -1.0f, label_y_, true});
  if (!label_z_.empty()) labels_.push_back(CubeLabel{-1.3f, -1.25f, 0.0f, label_z_, true});
}

Plot3D::CameraFrame Plot3D::camera(double aspect) const {
  // Orthographic reads `distance` as the visible half-height, so the eye is
  // parked well outside the scene instead — otherwise it would set the scale
  // twice and the two would fight.
  const Mat4 proj = projection_ == Projection::Orthographic
                        ? orthographic(distance_ / 2.0, aspect, -100.0, 100.0)
                        : perspective(50.0 * kPi / 180.0, aspect, 0.01, 100.0);
  const double el = std::clamp(elevation_, -kMaxElevation, kMaxElevation);
  const double radius = projection_ == Projection::Orthographic ? 8.0 : distance_;
  const Vec3 eye{radius * std::cos(el) * std::sin(azimuth_), radius * std::sin(el),
                 radius * std::cos(el) * std::cos(azimuth_)};
  const Mat4 view = look_at(eye, {0.0, 0.0, 0.0}, {0.0, 1.0, 0.0});
  CameraFrame frame;
  frame.vp = multiply(proj, view);
  frame.mvp = multiply(frame.vp, normalize_);
  frame.eye = eye;
  return frame;
}

void Plot3D::pointer_down(double px, double py) {
  if (!interactive_) return;
  dragging_ = true;
  last_px_ = px;
  last_py_ = py;
}

void Plot3D::pointer_move(double px, double py) {
  if (!interactive_ || !dragging_) {
    last_px_ = px;
    last_py_ = py;
    return;
  }
  // 0.01 radians a pixel: a full turn is roughly the width of a chart, which is
  // the same feel the web core's orbit has.
  azimuth_ -= (px - last_px_) * 0.01;
  elevation_ = std::clamp(elevation_ + (py - last_py_) * 0.01, -kMaxElevation, kMaxElevation);
  last_px_ = px;
  last_py_ = py;
  request_render();
  ph_event event{};
  event.type = PH_EVENT_VIEW_CHANGED;
  emit(event);
}

void Plot3D::pointer_up() { dragging_ = false; }

void Plot3D::wheel(double delta_y) {
  if (!interactive_) return;
  // The same exp(delta * 0.001) the 2-D wheel uses, so one notch feels the same
  // in both, and clamped so the camera cannot end up inside the cube.
  distance_ = std::clamp(distance_ * std::exp(delta_y * 0.001), 1.2, 40.0);
  request_render();
  ph_event event{};
  event.type = PH_EVENT_VIEW_CHANGED;
  emit(event);
}

void Plot3D::request_render() {
  if (needs_redraw_) return;
  needs_redraw_ = true;
  ph_event event{};
  event.type = PH_EVENT_REDRAW_REQUESTED;
  emit(event);
}

void Plot3D::emit(const ph_event& event) {
  // The same bound the 2-D queue uses: a host that never polls must not grow
  // the process without limit.
  constexpr size_t kMaxEvents = 256;
  if (events_.size() >= kMaxEvents) events_.pop_front();
  events_.push_back(event);
}

bool Plot3D::poll_event(ph_event& out) {
  if (events_.empty()) {
    out = ph_event{};
    out.type = PH_EVENT_NONE;
    return true;
  }
  out = events_.front();
  events_.pop_front();
  return true;
}

void Plot3D::clear_events() { events_.clear(); }

bool Plot3D::draw_scene(gl::Api& api, ph_gfx_api gfx, int vx, int vy, int vw, int vh, float dpr,
                        std::string& error) {
  if (vw <= 0 || vh <= 0) return true;

  api.Viewport(vx, vy, vw, vh);
  api.Disable(GL_SCISSOR_TEST);
  api.Enable(GL_DEPTH_TEST);
  api.DepthFunc(GL_LEQUAL);
  api.Enable(GL_BLEND);
  api.BlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);

  const render::Theme& theme = render::theme_for(theme_);
  // The core's own 3-D default, #0a0f21 — darker than a 2-D plot's region,
  // because a lit scene needs the contrast a flat chart does not.
  const ph_color fallback = theme_ == PH_THEME_LIGHT ? 0xf8fafcffu : 0x0a0f21ffu;
  const Rgba bg = unpack_color_exact(background_ != PH_COLOR_AUTO ? background_ : fallback);
  api.ClearColor(bg.r * bg.a, bg.g * bg.a, bg.b * bg.a, bg.a);
  api.Clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

  const CameraFrame frame = camera(static_cast<double>(vw) / std::max(1, vh));

  const Program* line = get_program(api, "plot3d.line", kLineVert, kLineFrag, {"uVP", "uColor"},
                                    gfx, error);
  if (!line) return false;
  if (line_vao_ == 0) {
    api.GenVertexArrays(1, &line_vao_);
    api.GenBuffers(1, &line_buffer_);
    if (line_vao_ == 0 || line_buffer_ == 0) {
      error = "failed to create the 3-D line buffers";
      return false;
    }
  }

  api.UseProgram(line->id);
  api.UniformMatrix4fv(line->uniform("uVP"), 1, GL_FALSE_, frame.vp.data());
  api.BindVertexArray(line_vao_);
  api.BindBuffer(GL_ARRAY_BUFFER, line_buffer_);
  api.EnableVertexAttribArray(0);
  api.VertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE_, 0, nullptr);

  const auto stroke = [&](const std::vector<float>& segments, float r, float g, float b, float a) {
    if (segments.empty()) return;
    api.BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(segments.size() * sizeof(float)),
                   segments.data(), GL_DYNAMIC_DRAW);
    api.Uniform4f(line->uniform("uColor"), r, g, b, a);
    api.DrawArrays(GL_LINES, 0, static_cast<GLsizei>(segments.size() / 3));
  };

  if (grid_planes_ && has_bounds_) {
    // The grid goes on the far walls, so it never sits in front of the data.
    const float sx = frame.eye[0] > 0.0 ? -1.0f : 1.0f;
    const float sy = frame.eye[1] > 0.0 ? -1.0f : 1.0f;
    const float sz = frame.eye[2] > 0.0 ? -1.0f : 1.0f;
    std::vector<float> grid;
    const auto seg = [&grid](float x0, float y0, float z0, float x1, float y1, float z1) {
      grid.insert(grid.end(), {x0, y0, z0, x1, y1, z1});
    };
    for (const float cy : ticks_y_) seg(sx, cy, -1.0f, sx, cy, 1.0f);
    for (const float cz : ticks_z_) seg(sx, -1.0f, cz, sx, 1.0f, cz);
    for (const float cx : ticks_x_) seg(cx, sy, -1.0f, cx, sy, 1.0f);
    for (const float cz : ticks_z_) seg(-1.0f, sy, cz, 1.0f, sy, cz);
    for (const float cx : ticks_x_) seg(cx, -1.0f, sz, cx, 1.0f, sz);
    for (const float cy : ticks_y_) seg(-1.0f, cy, sz, 1.0f, cy, sz);
    stroke(grid, 0.55f, 0.6f, 0.72f, 0.22f);
  }

  if (show_axes_) {
    const std::vector<float> box(std::begin(kBoxEdges), std::end(kBoxEdges));
    stroke(box, 0.6f, 0.65f, 0.75f, 0.4f);
    stroke(tick_lines_, 0.75f, 0.8f, 0.9f, 0.8f);
  }
  api.BindVertexArray(0);

  for (const std::unique_ptr<Layer3D>& layer : layers_) {
    if (!layer->visible()) continue;
    if (!layer->draw(api, gfx, frame.mvp, light_, error)) return false;
  }

  // The chrome is 2-D and sits on top, so the depth test comes off for it.
  api.Disable(GL_DEPTH_TEST);
  const PixelTransform pixels = PixelTransform::of(vw, vh);
  render::Painter painter(shapes_, labels_batch_, dpr);
  const double w = static_cast<double>(vw) / dpr;
  const double h = static_cast<double>(vh) / dpr;

  if (show_axes_) {
    for (const CubeLabel& label : labels_) {
      const std::array<double, 4> c = transform_point(frame.vp, label.x, label.y, label.z);
      if (c[3] <= 0.0) continue;  // behind the eye
      const double sx = (c[0] / c[3] * 0.5 + 0.5) * w;
      const double sy = (1.0 - (c[1] / c[3] * 0.5 + 0.5)) * h;
      const Rgba color = unpack_color_exact(label.title ? theme.title : theme.text);
      painter.label(label.text, sx, sy, text::Align::Center, text::Baseline::Middle, color,
                    label.title ? 13.0 : 11.0);
    }
  }
  if (!title_.empty()) {
    painter.label(title_, w / 2.0, 16.0, text::Align::Center, text::Baseline::Middle,
                  unpack_color_exact(theme.title), 15.0, 0.0, 0.35f);
  }

  // A colorbar for every layer that maps values to colours. The scene has no
  // plot region to hang it off, so the whole canvas stands in for one, inset by
  // the space the bar and its labels need.
  std::vector<render::ColorbarEntry> bars;
  for (const std::unique_ptr<Layer3D>& layer : layers_) {
    if (!layer->visible()) continue;
    photon::ColorInfo info;
    if (!layer->color_info(info)) continue;
    bars.push_back(render::ColorbarEntry{info.lut, info.domain, info.label});
  }
  if (!bars.empty()) {
    const render::Rect rect{0.0, 30.0, w - render::kColorbarGap, h - 60.0};
    render::draw_colorbars(painter, rect, bars, 0, theme_);
  }

  if (!shapes_.flush(api, gfx, pixels, error)) return false;
  if (!labels_batch_.flush(api, gfx, pixels, error)) return false;
  return true;
}

bool Plot3D::render(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target,
                    std::string& error) {
  const float dpr = target.dpr > 0.0f ? target.dpr : 1.0f;
  const bool ok = draw_scene(api, gfx, target.x, target.y, target.width, target.height, dpr, error);
  if (ok) needs_redraw_ = false;
  return ok;
}

bool Plot3D::ensure_offscreen(gl::Api& api, int32_t width, int32_t height, std::string& error) {
  if (offscreen_fbo_ == 0) {
    api.GenFramebuffers(1, &offscreen_fbo_);
    api.GenTextures(1, &offscreen_texture_);
    api.GenRenderbuffers(1, &offscreen_depth_);
    if (offscreen_fbo_ == 0 || offscreen_texture_ == 0 || offscreen_depth_ == 0) {
      error = "failed to create the offscreen framebuffer";
      return false;
    }
  }
  if (width == offscreen_width_ && height == offscreen_height_) return true;

  api.BindTexture(GL_TEXTURE_2D, offscreen_texture_);
  api.TexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(GL_RGBA8), width, height, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, static_cast<GLint>(GL_NEAREST));
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, static_cast<GLint>(GL_NEAREST));
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, static_cast<GLint>(GL_CLAMP_TO_EDGE));
  api.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, static_cast<GLint>(GL_CLAMP_TO_EDGE));
  api.BindFramebuffer(GL_FRAMEBUFFER, offscreen_fbo_);
  api.FramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, offscreen_texture_,
                           0);
  // Unlike the 2-D plot's, this one needs depth: that is the whole difference
  // between a scene and a stack of flat layers.
  api.BindRenderbuffer(GL_RENDERBUFFER, offscreen_depth_);
  api.RenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width, height);
  api.FramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER,
                              offscreen_depth_);
  if (api.CheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    api.BindFramebuffer(GL_FRAMEBUFFER, 0);
    offscreen_width_ = offscreen_height_ = 0;
    error = "the offscreen framebuffer is incomplete — a depth attachment may be unsupported";
    return false;
  }
  offscreen_width_ = width;
  offscreen_height_ = height;
  return true;
}

void Plot3D::release_offscreen(gl::Api& api) {
  if (offscreen_fbo_ == 0) return;
  api.DeleteFramebuffers(1, &offscreen_fbo_);
  api.DeleteTextures(1, &offscreen_texture_);
  api.DeleteRenderbuffers(1, &offscreen_depth_);
  offscreen_fbo_ = 0;
  offscreen_texture_ = 0;
  offscreen_depth_ = 0;
  offscreen_width_ = offscreen_height_ = 0;
}

bool Plot3D::render_pixels(gl::Api& api, ph_gfx_api gfx, int32_t width, int32_t height, float dpr,
                           uint8_t* out_rgba, int32_t stride_bytes, std::string& error) {
  GLint previous = 0;
  api.GetIntegerv(GL_FRAMEBUFFER_BINDING, &previous);
  if (!ensure_offscreen(api, width, height, error)) return false;
  api.BindFramebuffer(GL_FRAMEBUFFER, offscreen_fbo_);

  const int32_t saved_width = width_;
  const int32_t saved_height = height_;
  width_ = static_cast<int32_t>(std::lround(static_cast<double>(width) / dpr));
  height_ = static_cast<int32_t>(std::lround(static_cast<double>(height) / dpr));
  const bool ok = draw_scene(api, gfx, 0, 0, width, height, dpr, error);
  width_ = saved_width;
  height_ = saved_height;
  if (!ok) {
    api.BindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(previous));
    return false;
  }

  api.PixelStorei(GL_PACK_ALIGNMENT, 1);
  // Bottom row first out of GL; the caller wants top row first, so the rows are
  // written in reverse.
  std::vector<uint8_t> row(static_cast<size_t>(width) * 4);
  for (int32_t y = 0; y < height; ++y) {
    api.ReadPixels(0, height - 1 - y, width, 1, GL_RGBA, GL_UNSIGNED_BYTE, row.data());
    std::memcpy(out_rgba + static_cast<size_t>(y) * static_cast<size_t>(stride_bytes), row.data(),
                row.size());
  }
  api.BindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(previous));
  needs_redraw_ = false;
  return true;
}

void Plot3D::release_gl(gl::Api& api) {
  for (const std::unique_ptr<Layer3D>& layer : layers_) layer->release_gl(api);
  if (line_vao_ != 0) {
    api.DeleteVertexArrays(1, &line_vao_);
    api.DeleteBuffers(1, &line_buffer_);
    line_vao_ = 0;
    line_buffer_ = 0;
  }
  release_offscreen(api);
  shapes_.release_gl(api);
  labels_batch_.release_gl(api);
}

}  // namespace photon::plot3d
