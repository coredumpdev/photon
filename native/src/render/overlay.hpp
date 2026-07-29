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

/// The box-zoom rectangle. `lock_x`/`lock_y` follow the interaction mode: an
/// axis that is not locked spans the whole region, as in drawSelection().
void draw_selection(Painter& painter, const Rect& region, double x0, double y0, double x1,
                    double y1, bool lock_x, bool lock_y);

}  // namespace photon::render
