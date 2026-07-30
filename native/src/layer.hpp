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

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "color.hpp"
#include "color/colormap.hpp"
#include "layers/pick.hpp"
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

/**
 * A continuous colour scale a layer maps values through, so the plot can draw
 * the legend for it. Mirrors core `ColorInfo`.
 *
 * The table is a pointer rather than a copy because `color::lut` hands back a
 * reference into a cache that only ever grows — it stays valid for the life of
 * the process, which is longer than any layer.
 */
struct ColorInfo {
  const photon::color::Lut* lut = nullptr;
  ph_range domain{0.0, 1.0};
  std::string label;
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

  /// The colour scale this layer maps values through, if it maps any.
  virtual bool color_info(ColorInfo& out) const {
    (void)out;
    return false;
  }

  /**
   * The point nearest the cursor, in pixels. False when this layer has no
   * points to pick — a heatmap is a field, not a set of samples, and offering
   * a nearest texel would be inventing a reading the data does not support.
   */
  virtual bool pick(PickMode mode, double cursor_px, double cursor_py,
                    const PickProjection& project, Picked& out) const {
    (void)mode;
    (void)cursor_px;
    (void)cursor_py;
    (void)project;
    (void)out;
    return false;
  }

  const std::string& y_axis() const { return y_axis_; }
  /// Rebind to another y axis. Used when the axis a layer pointed at is removed.
  void set_y_axis(std::string id) { y_axis_ = std::move(id); }
  const std::string& name() const { return name_; }
  ph_color color() const { return color_; }
  bool visible() const { return visible_; }
  void set_visible(bool on) { visible_ = on; }

  Plot* owner = nullptr;
  /// The ph_layer this object is behind, so an event can name it. Set when the
  /// layer is registered; zero for a layer that never reached the ABI.
  ph_layer handle = 0;

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
  bool pick(PickMode mode, double cursor_px, double cursor_py, const PickProjection& project,
            Picked& out) const override;
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
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_area_desc& desc);
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
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_bar_desc& desc);
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

  /// Set only for a choropleth, which is what earns the layer a colorbar.
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range value_domain_{0.0, 1.0};

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
  bool pick(PickMode mode, double cursor_px, double cursor_py, const PickProjection& project,
            Picked& out) const override;
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
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_errorbar_desc& desc);
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

/**
 * Iso-lines through a scalar field, by marching squares.
 *
 * Sixteen corner cases, each naming which cell edges to join; the crossing on
 * each edge is linearly interpolated. Plain line segments out, so the layer is
 * a lookup table and a loop rather than a shader.
 */
class ContourLayer : public Layer {
 public:
  explicit ContourLayer(const ph_contour_desc& desc);
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_contour_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool color_info(ColorInfo& out) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// Position + colour, six floats per vertex, two vertices per segment.
  std::vector<float> vertices_;
  ph_range extent_x_{0.0, 1.0};
  ph_range extent_y_{0.0, 1.0};
  bool has_extent_ = false;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  /// Set only when the levels take their colours from a ramp.
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range value_domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
};

/**
 * A node-link graph: edges as segments, nodes as round points.
 *
 * When the caller gives no positions the layer lays the graph out itself with
 * the core's force algorithm, which is deterministic — so the same graph is the
 * same picture in every host.
 */
class GraphLayer : public Layer {
 public:
  explicit GraphLayer(const ph_graph_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> nodes_;
  std::vector<float> edges_;
  Rgba node_color_{};
  Rgba edge_color_{};
  float node_size_ = 10.0f;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  ph_range graph_x_{0.0, 0.0};
  ph_range graph_y_{0.0, 0.0};
  bool graph_bounds_ = false;
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint node_vao_ = 0;
  gl::GLuint edge_vao_ = 0;
  gl::GLuint node_buffer_ = 0;
  gl::GLuint edge_buffer_ = 0;
};

/**
 * Points binned onto a hex lattice, each cell coloured by its count.
 *
 * The binning is d3-hexbin's, simplified: round to the nearest lattice row,
 * then to the nearest column offset by half on odd rows. One instanced hexagon
 * per occupied cell, so a million points cost a few thousand instances.
 */
class HexbinLayer : public Layer {
 public:
  explicit HexbinLayer(const ph_hexbin_desc& desc);
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_hexbin_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool color_info(ColorInfo& out) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<float> centers_;
  std::vector<float> colors_;
  double radius_ = 1.0;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  ph_range hex_x_{0.0, 0.0};
  ph_range hex_y_{0.0, 0.0};
  bool hex_bounds_ = false;
  /// The ramp and the count range it spans.
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range count_domain_{1.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint vao_ = 0;
  gl::GLuint hex_buffer_ = 0;
  gl::GLuint center_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

/**
 * An arrow per sample: a data-space shaft with a screen-space head.
 *
 * The head is three vertices generated from gl_VertexID rather than a buffer,
 * because its shape is entirely a function of the shaft it sits on.
 */
class QuiverLayer : public Layer {
 public:
  explicit QuiverLayer(const ph_quiver_desc& desc);
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_quiver_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool color_info(ColorInfo& out) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// (base x, base y, tip x, tip y) per arrow, in offset data space.
  std::vector<float> arrows_;
  std::vector<float> colors_;
  bool vertex_color_ = false;
  float width_ = 1.5f;
  float head_size_ = 9.0f;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  ph_range quiver_x_{0.0, 0.0};
  ph_range quiver_y_{0.0, 0.0};
  bool quiver_bounds_ = false;
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range value_domain_{0.0, 1.0};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  gl::GLuint shaft_vao_ = 0;
  gl::GLuint head_vao_ = 0;
  gl::GLuint corner_buffer_ = 0;
  gl::GLuint arrow_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

/**
 * The two OHLC chart types, which differ only in what they emit per period.
 *
 * Both retain the five input arrays because both stream: a live candle is
 * rewritten many times before it closes, and rebuilding from the source is what
 * makes the width and the bounds recompute correctly when it does.
 */
class OhlcSeries : public Layer {
 public:
  bool bounds(ph_range& x, ph_range& y) const override;
  void release_gl(gl::Api& api) override;

 protected:
  /// Copy the arrays and derive the width, refs, bounds and vertex data.
  void ingest(const double* x, const double* open, const double* high, const double* low,
              const double* close, int32_t count);
  /// Fill the per-period vertex arrays. Implemented by each shape.
  virtual void emit() = 0;

  std::vector<double> x_;
  std::vector<double> open_;
  std::vector<double> high_;
  std::vector<double> low_;
  std::vector<double> close_;
  double explicit_width_ = 0.0;
  double body_width_ = 1.0;
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  Rgba up_{};
  Rgba down_{};
  ph_render_type render_type_ = PH_RENDER_STATIC;
  bool dirty_ = true;

  ph_range ohlc_x_{0.0, 0.0};
  ph_range ohlc_y_{0.0, 0.0};
  bool ohlc_bounds_ = false;

  /// Four floats per instance, and one RGBA per instance beside it.
  std::vector<float> segments_;
  std::vector<float> colors_;

  gl::GLuint vao_ = 0;
  gl::GLuint corner_buffer_ = 0;
  gl::GLuint segment_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

/// Body rectangles plus wicks: two programs over one colour buffer.
class CandlestickLayer : public OhlcSeries {
 public:
  explicit CandlestickLayer(const ph_candlestick_desc& desc);
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_candlestick_desc& desc);
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 protected:
  void emit() override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  float wick_width_ = 1.5f;
  /// (x0, y0, x1, y1) per body, in offset data space.
  std::vector<float> bodies_;
  gl::GLuint body_vao_ = 0;
  gl::GLuint rect_corner_buffer_ = 0;
  gl::GLuint body_buffer_ = 0;
};

/// Three pixel-thick segments per period: the range, and a tick either side.
class OhlcLayer : public OhlcSeries {
 public:
  explicit OhlcLayer(const ph_ohlc_desc& desc);
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_ohlc_desc& desc);
  bool draw(const DrawState& state, std::string& error) override;

 protected:
  void emit() override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  float line_width_ = 1.5f;
};

/**
 * A regular grid coloured through a colormap, drawn as one textured quad.
 *
 * The colouring happens once, on the CPU, when the layer is built: the values
 * are baked into an RGBA texture. That is why a heatmap costs one draw call
 * whatever its resolution, and why re-colouring means re-uploading.
 */
class HeatmapLayer : public Layer {
 public:
  explicit HeatmapLayer(const ph_heatmap_desc& desc);
  /// Replace everything the descriptor carries and re-upload next frame.
  /// The constructor is a call to this, so the two cannot drift apart.
  void set_data(const ph_heatmap_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool color_info(ColorInfo& out) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  /// The baked RGBA8 texels, cols * rows * 4.
  std::vector<uint8_t> texels_;
  int32_t cols_ = 0;
  int32_t rows_ = 0;
  ph_range extent_x_{0.0, 1.0};
  ph_range extent_y_{0.0, 1.0};
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  bool smooth_ = true;
  /// The ramp and the value range it spans, after any auto-fit.
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range value_domain_{0.0, 1.0};
  std::array<float, 24> quad_{};

  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
  gl::GLuint texture_ = 0;
};

/**
 * RGBA8 pixels over a data-space rectangle.
 *
 * The same textured quad as the heatmap with the colouring left out, because
 * the caller has already done it. A URL source is deliberately absent: fetching
 * and decoding belongs to the host.
 */
class ImageLayer : public Layer {
 public:
  explicit ImageLayer(const ph_image_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool draw(const DrawState& state, std::string& error) override;
  void release_gl(gl::Api& api) override;

 private:
  bool ensure_gl(gl::Api& api, std::string& error);

  std::vector<uint8_t> texels_;
  int32_t width_ = 0;
  int32_t height_ = 0;
  ph_range extent_x_{0.0, 1.0};
  ph_range extent_y_{0.0, 1.0};
  double x_ref_ = 0.0;
  double y_ref_ = 0.0;
  bool smooth_ = true;
  float opacity_ = 1.0f;
  std::array<float, 24> quad_{};

  gl::GLuint vao_ = 0;
  gl::GLuint buffer_ = 0;
  gl::GLuint texture_ = 0;
};

class PatchesLayer : public Layer {
 public:
  explicit PatchesLayer(const ph_patches_desc& desc);
  bool bounds(ph_range& x, ph_range& y) const override;
  bool color_info(ColorInfo& out) const override;
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

  /// Set only for a choropleth, which is what earns the layer a colorbar.
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range value_domain_{0.0, 1.0};

  gl::GLuint vao_ = 0;
  gl::GLuint position_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
};

class ScatterLayer : public XYLayer {
 public:
  explicit ScatterLayer(const ph_scatter_desc& desc);
  bool color_info(ColorInfo& out) const override;
  bool pick(PickMode mode, double cursor_px, double cursor_py, const PickProjection& project,
            Picked& out) const override;
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
  /// Set only when `color_by` was given: the ramp and the range it spans.
  const photon::color::Lut* color_lut_ = nullptr;
  ph_range color_domain_{0.0, 1.0};

  gl::GLuint vao_ = 0;
  gl::GLuint corner_buffer_ = 0;
  gl::GLuint point_buffer_ = 0;
  gl::GLuint color_buffer_ = 0;
  gl::GLuint size_buffer_ = 0;
};

}  // namespace photon
