#include "color.hpp"

#include <algorithm>

namespace photon {
namespace {

/// The core's default series colour, `#3b82f6`.
constexpr ph_color kDefaultSeriesColor = 0x3b82f6ffu;

Rgba split(ph_color c) {
  Rgba out;
  out.r = static_cast<float>((c >> 24) & 0xffu) / 255.0f;
  out.g = static_cast<float>((c >> 16) & 0xffu) / 255.0f;
  out.b = static_cast<float>((c >> 8) & 0xffu) / 255.0f;
  out.a = static_cast<float>(c & 0xffu) / 255.0f;
  return out;
}

}  // namespace

Rgba unpack_color(ph_color color) {
  return split(color == PH_COLOR_AUTO ? kDefaultSeriesColor : color);
}

Rgba unpack_color_exact(ph_color color) {
  return split(color);
}

Rgba with_alpha(Rgba color, float alpha) {
  color.a = std::clamp(color.a * alpha, 0.0f, 1.0f);
  return color;
}

}  // namespace photon
