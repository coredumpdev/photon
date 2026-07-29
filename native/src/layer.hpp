// Port of the layer contract from core/src/layers/layer.ts, plus the GL
// resources each layer owns.
//
// One structural difference from the web core, forced by the ABI: there, a
// layer builds its GPU buffers in its constructor, because a canvas always has
// a live context. Here `ph_plot_add_line` may be called from a setup thread
// long before any context exists — so a layer holds its data on the CPU and
// uploads on the first draw that sees a context. `dirty_` is that latch.
//
// Data is rebased against an xRef/yRef (the first point) before it is narrowed
// to float32, exactly as the web core does: float32 has ~7 significant digits,
// which is not enough for epoch milliseconds, and the transform uniforms carry
// the reference back each frame.
#pragma once

#include <photon/photon.h>

#include <cstddef>
#include <string>
#include <vector>

#include "color.hpp"
#include "gl/gl.hpp"
#include "gl/transform.hpp"

namespace photon {

class Plot;

/// What a layer needs to draw itself for one frame.
struct DrawState {
  gl::Api* api = nullptr;
  ph_gfx_api gfx = PH_GFX_GL33;
  gl::AxisFrame x;
  gl::AxisFrame y;
  /// Plot-region size in device pixels.
  double pixel_width = 0.0;
  double pixel_height = 0.0;
  float dpr = 1.0f;
};

class Layer {
 public:
  virtual ~Layer() = default;

  /// Data-space extent, for autoscaling. False when the layer holds no data.
  virtual bool bounds(ph_range& x, ph_range& y) const = 0;

  /// Draw one frame. `error` is filled only when the layer could not draw.
  virtual bool draw(const DrawState& state, std::string& error) = 0;

  /// Release GL objects. Requires the owning context to be current.
  /// Never deletes a cached program — those are shared across every layer.
  virtual void release_gl(gl::Api& api) = 0;

  const std::string& y_axis() const { return y_axis_; }
  /// Rebind to another y axis. Used when the axis a layer pointed at is removed.
  void set_y_axis(std::string id) { y_axis_ = std::move(id); }
  const std::string& name() const { return name_; }
  ph_color color() const { return color_; }
  bool visible() const { return visible_; }
  void set_visible(bool on) { visible_ = on; }

  Plot* owner = nullptr;

 protected:
  std::string name_;
  std::string y_axis_;
  ph_color color_ = PH_COLOR_AUTO;
  bool visible_ = true;
};

/// A layer whose geometry is a parallel x/y pair — line, scatter, and most of
/// what follows in Faz 4.
class XYLayer : public Layer {
 public:
  bool bounds(ph_range& x, ph_range& y) const override;
  void set_xy(const double* xs, const double* ys, size_t count);

  size_t count() const { return x_.size(); }

 protected:
  /// Recompute bounds, monotonicity, the float32 buffer and its refs.
  void rebuild();

  std::vector<double> x_;
  std::vector<double> y_;
  /// Interleaved (x - x_ref, y - y_ref) float32 pairs, ready to upload.
  std::vector<float> packed_;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  ph_range x_bounds_{0.0, 0.0};
  ph_range y_bounds_{0.0, 0.0};
  bool has_bounds_ = false;
  /// True when x is non-decreasing — what decimation and hover both require.
  bool monotonic_ = true;
  /// Set whenever the CPU data changes; cleared once uploaded.
  bool dirty_ = true;
};

class LineLayer : public XYLayer {
 public:
  explicit LineLayer(const ph_line_desc& desc);
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  /// Rebuild the min/max-decimated buffer for the visible window if it moved.
  /// Returns the segment count to draw, or -1 to draw everything.
  long long decimate(gl::Api& api, const gl::AxisFrame& x, int columns);
  bool ensure_gl(gl::Api& api, std::string& error);

  float width_ = 1.5f;
  ph_step step_ = PH_STEP_NONE;
  ph_line_join join_ = PH_JOIN_ROUND;
  float miter_limit_ = 4.0f;
  std::vector<float> dash_;
  float dash_period_ = 0.0f;
  bool decimate_ = true;
  ph_render_type render_type_ = PH_RENDER_STATIC;

  /// Cumulative arc length per point, only built when dashing.
  std::vector<float> distances_;

  gl::GLuint corner_buffer_ = 0;
  gl::GLuint point_buffer_ = 0;
  gl::GLuint dist_buffer_ = 0;
  gl::GLuint decimated_buffer_ = 0;
  gl::GLuint full_vao_ = 0;
  gl::GLuint decimated_vao_ = 0;
  gl::GLuint join_full_vao_ = 0;
  gl::GLuint join_decimated_vao_ = 0;

  /// Identifies the decimated window currently in decimated_buffer_.
  std::string decimation_key_;
  long long decimated_segments_ = 0;
};

/**
 * Filled polygons — the layer every composed chart is built on.
 *
 * Each ring is triangulated once, on the CPU, by ear clipping, and the result
 * is a per-vertex-coloured triangle soup that never changes again: only the
 * transform uniforms move between frames. That is why a treemap or a sankey in
 * the web core is a free function over addPatches rather than a layer of its
 * own, and why porting this one unblocks the most.
 */
/**
 * A filled band between a series and a base.
 *
 * A triangle strip alternating base and top at each x, which is why it is not
 * an XYLayer: the vertex buffer holds two points per sample, not one. Stacking
 * is the caller's job — pass cumulative values as the base, exactly as the web
 * core's addStackedArea does.
 */
class AreaLayer : public XYLayer {
 public:
  explicit AreaLayer(const ph_area_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);
  /// Rebuild the strip, the refs and the bounds from x_/y_/base_.
  void build();

  std::vector<double> base_;
  double base_value_ = 0.0;
  /// Interleaved (x, base) and (x, top) float32 pairs — two vertices per sample.
  std::vector<float> strip_;
  ph_range area_x_{0.0, 0.0};
  ph_range area_y_{0.0, 0.0};
  bool area_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;

  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/**
 * Rectangles, one per sample, instanced from a unit quad.
 *
 * `x` is the bar centre along the *position* axis and `y` its extent along the
 * *value* axis. Which of those is the horizontal one is `orientation`, and the
 * whole of the difference between vertical and horizontal bars is which way
 * round the rectangle is written — the shader does not know.
 */
class BarLayer : public XYLayer {
 public:
  explicit BarLayer(const ph_bar_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);
  void build();

  std::vector<double> base_;
  double base_value_ = 0.0;
  double width_ = 0.0;
  double offset_ = 0.0;
  ph_orientation orientation_ = PH_ORIENT_VERTICAL;
  /// Four floats per bar: (x0, y0, x1, y1) in offset data space.
  std::vector<float> rects_;
  /// Four floats per bar, straight RGBA.
  std::vector<float> bar_colors_;
  ph_range bar_x_{0.0, 0.0};
  ph_range bar_y_{0.0, 0.0};
  bool bar_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;

  gl::GLuint vao_ = 0;
  gl::GLuint corner_buffer_ = 0;
  gl::GLuint rect_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

/**
 * A pie or donut, as a triangle soup sharing the patches fill program.
 *
 * Wedges are fans when solid and quad strips when there is an inner radius, at
 * one segment per ~3 degrees. Not an XYLayer: the input is a list of magnitudes,
 * not a pair of coordinate arrays.
 */
class PieLayer : public Layer {
 public:
  explicit PieLayer(const ph_pie_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> positions_;
  std::vector<float> colors_;
  double centre_x_ = 0.0;
  double centre_y_ = 0.0;
  double radius_ = 1.0;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint vao_ = 0;
  gl::GLuint position_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

/**
 * Stems from a baseline to each sample, with a disc at the tip.
 *
 * Two draws over the same points: the line program's segment quad for the
 * stalks, and the scatter program's disc for the tips. Both are pixel-width, so
 * neither changes with the zoom.
 */
class StemLayer : public XYLayer {
 public:
  explicit StemLayer(const ph_stem_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);
  void build();

  double baseline_ = 0.0;
  float width_ = 1.5f;
  float marker_size_ = 6.0f;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  /// Four floats per stem: (x, baseline, x, y) in offset data space.
  std::vector<float> segments_;
  ph_range stem_x_{0.0, 0.0};
  ph_range stem_y_{0.0, 0.0};
  bool stem_bounds_ = false;

  gl::GLuint stem_vao_ = 0;
  gl::GLuint marker_vao_ = 0;
  gl::GLuint corner_buffer_ = 0;
  gl::GLuint quad_buffer_ = 0;
  gl::GLuint segment_buffer_ = 0;
  gl::GLuint tip_buffer_ = 0;
};

/**
 * Whiskers, caps and an optional band around each point.
 *
 * Three programs over one point set: the band as a triangle strip in data
 * space, the whiskers as pixel-thick segments, the caps as pixel-sized ticks.
 * Everything but the band is measured in pixels, so an error bar keeps its
 * weight at any zoom.
 */
class ErrorBarLayer : public XYLayer {
 public:
  explicit ErrorBarLayer(const ph_errorbar_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  float width_ = 1.5f;
  float cap_size_ = 6.0f;
  float band_opacity_ = 0.2f;
  bool whiskers_ = true;
  bool show_band_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;

  /// Four floats per whisker: (x0, y0, x1, y1) in offset data space.
  std::vector<float> segments_;
  /// Three floats per cap: (x, y, orient), orient 0 horizontal / 1 vertical.
  std::vector<float> caps_;
  /// Interleaved high/low pairs, drawn as one triangle strip.
  std::vector<float> band_strip_;
  ph_range err_x_{0.0, 0.0};
  ph_range err_y_{0.0, 0.0};
  bool err_bounds_ = false;
  bool dirty_ = true;

  gl::GLuint seg_vao_ = 0;
  gl::GLuint cap_vao_ = 0;
  gl::GLuint band_vao_ = 0;
  gl::GLuint seg_corner_buffer_ = 0;
  gl::GLuint quad_corner_buffer_ = 0;
  gl::GLuint seg_buffer_ = 0;
  gl::GLuint cap_buffer_ = 0;
  gl::GLuint band_buffer_ = 0;
};

/**
 * Tukey boxes, one per group, optionally as violins.
 *
 * The quartiles are computed here rather than asked for, so a caller hands over
 * samples. Three primitives share one program and one buffer: triangles for the
 * bodies, lines for the outlines, medians and whiskers, and points for the
 * outliers.
 */
class BoxLayer : public Layer {
 public:
  explicit BoxLayer(const ph_box_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// Position + colour, six floats per vertex, in three consecutive runs:
  /// triangles, then lines, then points.
  std::vector<float> vertices_;
  size_t triangle_count_ = 0;
  size_t line_start_ = 0;
  size_t line_count_ = 0;
  size_t point_start_ = 0;
  size_t point_count_ = 0;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  ph_range box_x_{0.0, 0.0};
  ph_range box_y_{0.0, 0.0};
  bool box_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

class PatchesLayer : public Layer {
 public:
  explicit PatchesLayer(const ph_patches_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// Interleaved (x - x_ref, y - y_ref) float32 pairs, one per triangle vertex.
  std::vector<float> positions_;
  /// Straight RGBA per vertex; the shader premultiplies on output.
  std::vector<float> colors_;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  ph_range x_bounds_{0.0, 0.0};
  ph_range y_bounds_{0.0, 0.0};
  bool has_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint vao_ = 0;
  gl::GLuint position_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

class ScatterLayer : public XYLayer {
 public:
  explicit ScatterLayer(const ph_scatter_desc& desc);
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  float size_ = 5.0f;
  std::vector<float> sizes_;
  /// Per-point RGBA, four floats per point. Empty means the uniform colour.
  std::vector<float> colors_;
  ph_marker marker_ = PH_MARKER_CIRCLE;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool use_vertex_color_ = false;

  gl::GLuint vao_ = 0;
  gl::GLuint corner_buffer_ = 0;
  gl::GLuint point_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
  gl::GLuint size_buffer_ = 0;
};

}  // namespace photon
