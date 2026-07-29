// Port of the drawing half of core/src/render/overlay.ts.
//
// The web version strokes a 2D canvas; this fills rectangles and queues glyphs.
// Everything else is deliberately the same, down to the `Math.round(x) + 0.5`
// that makes a hairline crisp — the layout numbers have to match the web's for
// the two charts to be comparable side by side, which is the acceptance test
// for the whole port.
//
// Coordinates here are *logical* pixels, like the web core's CSS pixels. Painter
// is the only thing that knows about the device pixel ratio.
#pragma once

#include <photon/photon.h>

#include <string>
#include <vector>

#include "axes/ticks.hpp"
#include "color/colormap.hpp"
#include "render/primitives.hpp"
#include "render/theme.hpp"
#include "text/text.hpp"

namespace photon {
struct Scale;
}

namespace photon::render {

/// A rectangle in logical pixels, origin top-left.
struct Rect {
  double left = 0.0;
  double top = 0.0;
  double width = 0.0;
  double height = 0.0;

  double right() const { return left + width; }
  double bottom() const { return top + height; }
};

/// Where the overlay draws, and the one place logical pixels become device ones.
class Painter {
 public:
  Painter(Primitives& shapes, text::Batch& labels, float dpr)
      : shapes_(&shapes), labels_(&labels), dpr_(dpr) {}

  void fill(double x, double y, double w, double h, Rgba color);

  /**
   * A hairline centred on `pos`, running from `from` to `to`.
   *
   * `pos` is the stroke centre, which is why every call site passes
   * `std::round(v) + 0.5` — the same expression, for the same reason, as the
   * Canvas2D version.
   */
  void hairline(bool vertical, double pos, double from, double to, double width, Rgba color);
  void dashed(bool vertical, double pos, double from, double to, double width,
              const std::vector<float>& dash, Rgba color);

  /**
   * A segment at any angle. `dash` alternates on/off lengths in logical px; an
   * empty pattern draws it solid.
   */
  void segment(double x0, double y0, double x1, double y1, double width,
               const std::vector<float>& dash, Rgba color);

  void label(const std::string& utf8, double x, double y, text::Align align,
             text::Baseline baseline, Rgba color, double size, double rotation_degrees = 0.0,
             float bold = 0.0f);

  /// Advance width in logical pixels.
  double measure(const std::string& utf8, double size) const;

  float dpr() const { return dpr_; }

 private:
  Primitives* shapes_;
  text::Batch* labels_;
  float dpr_;
};

/// x = region.left + t * region.width, for a normalized t. Port of pxX().
double px_x(const Rect& region, double t);
/// y measured from the top, for a t normalized bottom-to-top. Port of pxY().
double px_y(const Rect& region, double t);

/// Vertical (x) and horizontal (primary y) grid lines, each styled separately.
void draw_grid(Painter& painter, const Rect& region, const Scale& scale_x, const Scale& scale_y,
               const std::vector<Tick>& ticks_x, const std::vector<Tick>& ticks_y,
               const AxisStyle& style_x, const AxisStyle& style_y);

/// The bottom axis: line, ticks, labels and an optional title.
void draw_x_axis(Painter& painter, const Rect& region, const Scale& scale,
                 const std::vector<Tick>& ticks, const AxisStyle& style, const std::string& title);

/// Where one y axis sits. Mirrors `YAxisDraw` plus yAxisPositions() in plot.ts.
struct YAxisPlacement {
  /// Pixel x of the axis line.
  double x = 0.0;
  bool right_side = false;
  /// Pixel x of the rotated title.
  double title_x = 0.0;
};

void draw_y_axis(Painter& painter, const Rect& region, const Scale& scale,
                 const std::vector<Tick>& ticks, const AxisStyle& style,
                 const std::string& title, const YAxisPlacement& placement);

/// One colour scale to draw a bar for. Mirrors core `ColorInfo`, resolved.
struct ColorbarEntry {
  const photon::color::Lut* lut = nullptr;
  ph_range domain{0.0, 1.0};
  std::string label;
};

/// Right-margin space a colorbar needs: the bar plus its tick labels.
constexpr double kColorbarGap = 62.0;

/**
 * The colorbar stack, in the right margin the plot reserved for it.
 *
 * The web builds this out of DOM and a CSS gradient; here the gradient is one
 * filled rect per device pixel row, which is smoother than the 24 stops a
 * browser interpolates between and costs nothing at this size.
 */
void draw_colorbars(Painter& painter, const Rect& region,
                    const std::vector<ColorbarEntry>& entries, int extra_right_axes,
                    ph_theme theme);

/// The plot title, centred in the strip reserved above the region.
void draw_title(Painter& painter, const Rect& region, const std::string& title, ph_theme theme);

/// Dashed guide lines through (px, py) while the pointer is down.
void draw_crosshair_xy(Painter& painter, const Rect& region, double px, double py, ph_theme theme);

/// The vertical-only hover guide, for when the XY crosshair is switched off.
void draw_crosshair(Painter& painter, const Rect& region, double px, ph_theme theme);

/// The disc drawn on the picked point: filled in the series colour, white-rimmed.
void draw_marker(Painter& painter, double px, double py, Rgba color);

/**
 * A filled panel with a 1 px border and rounded corners, for the legend and the
 * tooltip. There is no rounded-rect primitive, so the corners are cut with a
 * short stack of rows — six pixels of radius is four rows, which is cheaper
 * than teaching the shader about radii for two call sites.
 */
void fill_panel(Painter& painter, const Rect& panel, double radius, Rgba fill, Rgba border);

/// One legend row: a series name and the swatch that toggles it.
struct LegendEntry {
  std::string label;
  Rgba color;
  bool visible = true;
};

/**
 * The legend panel, inset from a corner of the plot region.
 *
 * Returns the rectangle it occupied, so the plot can hit-test clicks against it
 * without laying it out twice.
 */
Rect draw_legend(Painter& painter, const Rect& region, const std::vector<LegendEntry>& entries,
                 ph_legend_position position, bool horizontal, ph_theme theme);

/**
 * An owning copy of ph_annotation.
 *
 * The ABI's struct borrows its pointers for the duration of the call — the same
 * contract the data descriptors have — so the plot keeps this instead.
 */
struct Annotation {
  ph_annotation_type type = PH_ANNOTATION_SPAN;
  ph_dim dim = PH_DIM_X;
  double x0 = 0.0;
  double y0 = 0.0;
  double x1 = 0.0;
  double y1 = 0.0;
  double high = 0.0;
  double low = 0.0;
  std::vector<double> ratios;
  ph_color color = PH_COLOR_AUTO;
  ph_color border = PH_COLOR_AUTO;
  float width = 0.0f;
  std::vector<float> dash;
  std::string label;
  std::string text;
  float dx = 0.0f;
  float dy = 0.0f;
  ph_text_align align = PH_ALIGN_LEFT;
  ph_text_baseline baseline = PH_BASELINE_MIDDLE;
  float size = 0.0f;
  bool fill = false;
  std::string y_axis;
  /// Identifies it for removal; assigned by the plot.
  ph_annotation_id id = 0;
};

/// One annotation's projection: the x scale and whichever y axis it named.
struct AnnotationScales {
  const Scale* x = nullptr;
  const Scale* y = nullptr;
};

/// Draw one annotation, clipped by the caller to the plot region.
void draw_annotation(Painter& painter, const Rect& region, const Annotation& annotation,
                     const AnnotationScales& scales, ph_theme theme);

/// One tooltip line: an optional swatch, then text. A header row has no swatch.
struct TooltipRow {
  std::string text;
  Rgba color{};
  bool swatch = false;
};

/**
 * The hover tooltip, near the cursor and flipped to stay inside `bounds`.
 *
 * `bounds` is the whole canvas, not the plot region: the web core positions
 * against the container, so a tooltip near the right edge flips to the cursor's
 * left rather than being clipped by the axis.
 */
void draw_tooltip(Painter& painter, const Rect& bounds, double cursor_px, double cursor_py,
                  const std::vector<TooltipRow>& rows, ph_theme theme);

/// Row `index`'s rectangle inside a legend panel laid out at `panel`.
Rect legend_row_rect(const Rect& panel, size_t index, size_t count, bool horizontal,
                     const std::vector<LegendEntry>& entries, const Painter& painter);

/// The box-zoom rectangle. `lock_x`/`lock_y` follow the interaction mode: an
/// axis that is not locked spans the whole region, as in drawSelection().
void draw_selection(Painter& painter, const Rect& region, double x0, double y0, double x1,
                    double y1, bool lock_x, bool lock_y);

}  // namespace photon::render
