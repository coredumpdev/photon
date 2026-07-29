// Port of core/src/axes/axis.ts — the tick configuration for one axis and how it
// resolves against a scale.
#pragma once

#include <photon/photon.h>

#include <vector>

#include "axes/ticks.hpp"
#include "render/theme.hpp"

namespace photon {

struct Scale;

/**
 * Owns one axis's ticks and styling, and turns them into the concrete list the
 * overlay draws.
 *
 * The cache is the reason this is a class and not a function. A plot re-resolves
 * its ticks every frame, but the domain only moves when the user pans; without
 * the cache a streaming series re-formats the same six labels sixty times a
 * second. The web core caches on identity, which is the same idea.
 */
class Axis {
 public:
  render::AxisConfig config;

  /// Explicit ticks from the host. Empty means the scale generates its own.
  void set_explicit_ticks(std::vector<Tick> ticks);
  void set_config(render::AxisConfig new_config);

  /// The concrete tick list for `scale`'s current domain, labels filled in.
  const std::vector<Tick>& resolve(const Scale& scale);

 private:
  std::vector<Tick> explicit_;
  std::vector<Tick> resolved_;
  bool dirty_ = true;
  double cached_lo_ = 0.0;
  double cached_hi_ = 0.0;
  ph_scale_type cached_type_ = PH_SCALE_LINEAR;
};

}  // namespace photon
