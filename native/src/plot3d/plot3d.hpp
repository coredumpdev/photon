// The 3-D plot — port of core/src/plot3d/.
//
// plot3d.ts is 1031 lines and about half of it is DOM: a canvas, two buttons, a
// DOM legend, a DOM colorbar, a tooltip div. None of that crosses over. What
// does is the part underneath — the orbit camera, the normalize matrix that
// maps a data extent into the [-1,1] cube, the bounding box with its ticks and
// back-wall grid planes, and the layers.
//
// A 3-D plot is its own type here rather than a mode on Plot, which is the
// opposite of the decision polar got. The reason is the same one in both cases:
// what actually differs. Polar differs in the grid and the projection and
// nothing else. This differs in every one of them — the camera, the depth test,
// the vertex format, what a "layer" even is — so sharing Plot would mean a
// Plot whose every method had two behaviours.
#pragma once

#include <photon/photon.h>

#include <cstddef>
#include <deque>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "gl/gl.hpp"
#include "gl/transform.hpp"
#include "layer.hpp"
#include "plot3d/mat4.hpp"
#include "render/overlay.hpp"
#include "render/primitives.hpp"
#include "text/text.hpp"

namespace photon::plot3d {

/// A layer's extent in data space.
struct Bounds3 {
  ph_range x{0.0, 0.0};
  ph_range y{0.0, 0.0};
  ph_range z{0.0, 0.0};
};

/// The scene's single directional light, shared by every lit layer.
struct Light {
  /// Direction *towards* the light, in cube space.
  float x = 0.5f;
  float y = 1.0f;
  float z = 0.35f;
  /// How much light a surface facing away still receives.
  float ambient = 0.35f;
};

/// A drawable in the scene. Positions are world (data) space; the plot supplies
/// the matrix that maps them into the cube and then to the screen.
class Layer3D {
 public:
  virtual ~Layer3D() = default;

  virtual bool bounds3(Bounds3& out) const = 0;
  /// The ramp and range a colorbar would draw. False for a solid-coloured layer.
  virtual bool color_info(photon::ColorInfo& /*out*/) const { return false; }
  virtual bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
                    std::string& error) = 0;
  virtual void release_gl(gl::Api& /*api*/) {}

  const std::string& name() const { return name_; }
  ph_color color() const { return color_; }
  bool visible() const { return visible_; }
  void set_visible(bool on) { visible_ = on; }

  ph_layer handle = 0;

 protected:
  std::string name_;
  ph_color color_ = PH_COLOR_AUTO;
  bool visible_ = true;
};

/// How a data extent is mapped into the view cube.
enum class AspectMode {
  /// Stretch each axis to fill [-1,1]. Best for a surface, where the shape
  /// matters more than the units.
  Cube,
  /// One shared scale, so a long thin scene stays long and thin.
  Data,
};

enum class Projection {
  Perspective,
  Orthographic,
};

class Plot3D {
 public:
  explicit Plot3D(const ph_plot3d_desc& desc);
  ~Plot3D();

  Plot3D(const Plot3D&) = delete;
  Plot3D& operator=(const Plot3D&) = delete;

  void set_size(int32_t width, int32_t height);
  int32_t width() const { return width_; }
  int32_t height() const { return height_; }
  void set_theme(ph_theme theme);
  void set_title(const char* title);
  void set_axis_labels(const char* x, const char* y, const char* z);
  void set_camera(double azimuth, double elevation, double distance);
  void get_camera(double& azimuth, double& elevation, double& distance) const;
  void set_light(const Light& light);
  const Light& light() const { return light_; }
  void reset_view();

  Layer3D* add_layer(std::unique_ptr<Layer3D> layer);
  bool remove_layer(Layer3D* layer, gl::Api* api);
  const std::vector<std::unique_ptr<Layer3D>>& layers() const { return layers_; }
  /// Handles minted for this plot's layers, so teardown can invalidate them.
  std::vector<ph_layer> layer_handles;

  /// Recompute the normalize matrix and the axis geometry from the layers.
  void refit();

  // -- interaction ---------------------------------------------------------

  void pointer_down(double px, double py);
  void pointer_move(double px, double py);
  void pointer_up();
  void wheel(double delta_y);

  // -- rendering -----------------------------------------------------------

  bool render(gl::Api& api, ph_gfx_api gfx, const ph_frame_target& target, std::string& error);
  bool render_pixels(gl::Api& api, ph_gfx_api gfx, int32_t width, int32_t height, float dpr,
                     uint8_t* out_rgba, int32_t stride_bytes, std::string& error);
  bool needs_redraw() const { return needs_redraw_; }
  void release_gl(gl::Api& api);

  std::thread::id owner() const { return owner_; }

  // -- events --------------------------------------------------------------

  bool poll_event(ph_event& out);
  void clear_events();

 private:
  struct CameraFrame {
    Mat4 vp;
    Mat4 mvp;
    Vec3 eye;
  };

  CameraFrame camera(double aspect) const;
  void build_axes();
  bool draw_scene(gl::Api& api, ph_gfx_api gfx, int viewport_x, int viewport_y, int viewport_w,
                  int viewport_h, float dpr, std::string& error);
  bool ensure_offscreen(gl::Api& api, int32_t width, int32_t height, std::string& error);
  void release_offscreen(gl::Api& api);
  void request_render();
  void emit(const ph_event& event);

  std::thread::id owner_;
  int32_t width_ = 640;
  int32_t height_ = 420;
  ph_theme theme_ = PH_THEME_DARK;
  ph_color background_ = PH_COLOR_AUTO;
  std::string title_;
  std::string label_x_;
  std::string label_y_;
  std::string label_z_;

  double azimuth_ = 0.7;
  double elevation_ = 0.5;
  double distance_ = 3.6;
  double initial_azimuth_ = 0.7;
  double initial_elevation_ = 0.5;
  double initial_distance_ = 3.6;
  AspectMode aspect_ = AspectMode::Cube;
  Projection projection_ = Projection::Perspective;
  bool grid_planes_ = true;
  bool show_axes_ = true;
  bool interactive_ = true;
  Light light_;

  std::vector<std::unique_ptr<Layer3D>> layers_;
  Mat4 normalize_ = identity();
  Bounds3 bounds_;
  bool has_bounds_ = false;

  /// Tick positions in cube space, per axis — the back-wall grid uses them too.
  std::vector<float> ticks_x_;
  std::vector<float> ticks_y_;
  std::vector<float> ticks_z_;
  /// Tick-mark line segments in cube space, three floats a vertex.
  std::vector<float> tick_lines_;
  struct CubeLabel {
    float x, y, z;
    std::string text;
    bool title;
  };
  std::vector<CubeLabel> labels_;

  bool dragging_ = false;
  double last_px_ = 0.0;
  double last_py_ = 0.0;
  bool needs_redraw_ = true;

  gl::GLuint line_vao_ = 0;
  gl::GLuint line_buffer_ = 0;
  gl::GLuint offscreen_fbo_ = 0;
  gl::GLuint offscreen_texture_ = 0;
  gl::GLuint offscreen_depth_ = 0;
  int32_t offscreen_width_ = 0;
  int32_t offscreen_height_ = 0;

  photon::render::Primitives shapes_;
  photon::text::Batch labels_batch_;

  std::deque<ph_event> events_;
};

}  // namespace photon::plot3d
