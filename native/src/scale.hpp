// Port of core/src/scales/scale.ts.
//
// The TypeScript side models each scale as its own class behind a `Scale`
// interface. Here they collapse into one struct, because the only thing that
// actually varies in the projection is whether the mapping is logarithmic —
// `categorical` and `ordinal-time` are, as the TS comments say, plain linear
// scales over a band domain [-0.5, n-0.5], and `time` is linear over epoch ms.
// What differs between them is tick generation and label formatting, which
// arrives with the axis renderer in Faz 1.
#pragma once

#include <photon/photon.h>

#include <string>
#include <vector>

#include "axes/ticks.hpp"

namespace photon {

struct Scale {
  ph_scale_type type = PH_SCALE_LINEAR;
  double lo = 0.0;
  double hi = 1.0;

  /// Factor labels for PH_SCALE_CATEGORICAL.
  std::vector<std::string> factors;
  /// Per-index epoch-ms timestamps for PH_SCALE_ORDINAL_TIME.
  std::vector<double> times;

  /// True when the projection runs through log10.
  bool is_log() const { return type == PH_SCALE_LOG; }

  /// Data value to normalized [0,1].
  double norm(double value) const;
  /// Normalized [0,1] back to a data value.
  double invert(double t) const;

  /// Auto ticks appropriate for this scale type.
  std::vector<Tick> ticks(int target = 6) const;
  /// Default label for a tick value, when the tick carries none of its own.
  std::string format_tick(double value) const;

  /// Apply a domain, sanitizing it for log scales (which need lo > 0).
  void set_domain(double new_lo, double new_hi);

  /// Band domain [-0.5, n-0.5] for the two index-based scale types.
  void set_band_domain(size_t n);

  /// Reconfigure from an ABI descriptor. Returns false on a malformed one.
  bool configure(const ph_axis_desc& desc);

 private:
  /// The finance session axis: ticks land on calendar boundaries, not indices.
  std::vector<Tick> ordinal_time_ticks(int target) const;
};

}  // namespace photon
