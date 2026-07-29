// Port of core/src/color/colormap.ts and color/palettes.ts.
//
// A colormap is a 256-entry lookup table built from a handful of anchors, so
// the hot per-pixel path is one index rather than an interpolation. That is the
// TypeScript's design and it is the right one here too — a heatmap colours a
// texel per data point, and a heatmap is what this exists for.
//
// The registry is process-wide and mutable, which the web core gets away with
// because a page has one thread. Here a Qt host has one render thread per plot,
// so every entry point takes the lock.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "photon/photon.h"

namespace photon::color {

/// Samples per colormap, matching LUT_SIZE in the TypeScript.
constexpr size_t kLutSize = 256;

/// A linear-light RGB triple in 0..1, the form the anchors are written in.
struct Rgb {
  float r = 0.0f;
  float g = 0.0f;
  float b = 0.0f;
};

/// A resolved lookup table: kLutSize entries, r/g/b interleaved.
using Lut = std::array<float, kLutSize * 3>;

/**
 * How a caller asks for a colormap.
 *
 * `name` resolves through the registry and falls back to viridis; `stops`
 * overrides it with anchors given inline. `reverse` and `discrete_steps` are the
 * TypeScript's reverseColormap and discreteColormap, folded in here because
 * three entry points that differ only in a flag is three things to keep in sync.
 */
struct Spec {
  std::string name;
  std::vector<Rgb> stops;
  bool reverse = false;
  /// 0 means continuous; otherwise the number of flat bands.
  int32_t discrete_steps = 0;
};

/// Build (or fetch from the cache) the table for `spec`.
const Lut& lut(const Spec& spec);

/// The colour at `t`, clamped to 0..1.
Rgb sample(const Lut& table, double t);

/// Convenience for the one-off case: `sample(lut(spec), t)`.
Rgb sample(const Spec& spec, double t);

/// Register anchors under `name`. False when there are fewer than two.
bool register_colormap(const std::string& name, const std::vector<Rgb>& stops);

/// Every registered name, built-ins first, in registration order.
std::vector<std::string> colormap_names();

/// A domain centred on `center` that covers `values` — what a diverging map needs.
ph_range symmetric_domain(const double* values, size_t count, double center);

/// Register a categorical palette. False when empty.
bool register_palette(const std::string& name, const std::vector<ph_color>& colors);

/// Every registered palette name, built-ins first.
std::vector<std::string> palette_names();

/// The `index`-th colour of a palette, cycling. Unknown names give tableau10.
ph_color palette_color(const std::string& name, int32_t index);

/// A palette's colours. Unknown names give tableau10.
const std::vector<ph_color>& palette(const std::string& name);

/// Convert a ph_color's rgb to 0..1, discarding alpha — anchors have none.
Rgb to_rgb(ph_color color);

}  // namespace photon::color
