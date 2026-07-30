// The 3-D layers — port of core/src/plot3d/{surface,pointcloud,line3d,bar3d,quiver3d}.ts.
//
// Five layers over three programs: one lit mesh shader shared by the surface
// and the bars, one point shader, and one plain line shader the polyline and
// the quiver share. Everything is built on the CPU at construction and uploaded
// once — a 3-D scene's geometry does not change per frame, and the camera lives
// entirely in the MVP the plot hands down.
#pragma once

#include <photon/photon.h>

#include <vector>

#include "plot3d/plot3d.hpp"

namespace photon::plot3d {

/// A lit height field, or the same grid as a wireframe.
class SurfaceLayer : public Layer3D {
 public:
  explicit SurfaceLayer(const ph_surface_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool color_info(photon::ColorInfo& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// pos.xyz, normal.xyz, colour.rgb — nine floats a vertex.
  std::vector<float> vertices_;
  bool wireframe_ = false;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  const photon::color::Lut* lut_ = nullptr;
  ph_range domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/// A cloud of round points, flat-coloured or mapped through a ramp.
class PointCloudLayer : public Layer3D {
 public:
  explicit PointCloudLayer(const ph_pointcloud_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool color_info(photon::ColorInfo& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// pos.xyz, colour.rgb — six floats a point.
  std::vector<float> vertices_;
  float size_ = 4.0f;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  const photon::color::Lut* lut_ = nullptr;
  ph_range domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/// A polyline through space, and — with a different vertex list — a quiver.
class Line3DLayer : public Layer3D {
 public:
  explicit Line3DLayer(const ph_line3d_desc& desc);
  explicit Line3DLayer(const ph_quiver3d_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool color_info(photon::ColorInfo& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// pos.xyz, colour.rgb — six floats a vertex.
  std::vector<float> vertices_;
  /// GL_LINE_STRIP for a polyline, GL_LINES for the quiver's separate arrows.
  gl::GLenum mode_ = 0;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  const photon::color::Lut* lut_ = nullptr;
  ph_range domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/// Iso-height lines of a grid, each at its own level: a floating contour map.
class Contour3DLayer : public Layer3D {
 public:
  explicit Contour3DLayer(const ph_contour3d_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool color_info(photon::ColorInfo& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> vertices_;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  const photon::color::Lut* lut_ = nullptr;
  ph_range domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/// Lit cuboids, for a voxel scene or a schematic. Shares the mesh shader.
class Boxes3DLayer : public Layer3D {
 public:
  explicit Boxes3DLayer(const ph_boxes3d_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> vertices_;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/// The level set of a scalar volume, cut by marching cubes and lit.
class IsosurfaceLayer : public Layer3D {
 public:
  explicit IsosurfaceLayer(const ph_isosurface_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> vertices_;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/// One lit box per cell of a height grid. Shares the surface's mesh shader.
class Bar3DLayer : public Layer3D {
 public:
  explicit Bar3DLayer(const ph_bar3d_desc& desc);
  bool bounds3(Bounds3& out) const override;
  bool color_info(photon::ColorInfo& out) const override;
  bool draw(gl::Api& api, ph_gfx_api gfx, const Mat4& mvp, const Light& light,
            std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> vertices_;
  Bounds3 bounds_;
  bool has_bounds_ = false;
  const photon::color::Lut* lut_ = nullptr;
  ph_range domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;
  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

}  // namespace photon::plot3d
