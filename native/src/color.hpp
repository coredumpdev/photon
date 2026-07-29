// Packed ABI colors unpacked into floats, and the palette constants the overlay
// needs. Small enough to live at the top level rather than in a color/ folder —
// the colormaps that fill core/src/color/ arrive in Faz 4.
#pragma once

#include <photon/photon.h>

namespace photon {

/// Straight (non-premultiplied) RGBA in 0..1. Shaders premultiply on output,
/// because the frame blends with (GL_ONE, GL_ONE_MINUS_SRC_ALPHA).
struct Rgba {
  float r = 0.0f, g = 0.0f, b = 0.0f, a = 1.0f;

  bool visible() const { return a > 0.0f; }
};

/// Unpack 0xRRGGBBAA, falling back to the core's default series blue when the
/// caller left the color at PH_COLOR_AUTO.
Rgba unpack_color(ph_color color);

/// Unpack without the series-blue fallback: PH_COLOR_AUTO stays transparent.
Rgba unpack_color_exact(ph_color color);

/// Scale a color's alpha, for the overlay's translucent guides.
Rgba with_alpha(Rgba color, float alpha);

}  // namespace photon
