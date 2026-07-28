// Port of core/src/axes/ticks.ts.
#pragma once

#include <string>
#include <vector>

namespace photon {

/// A single axis tick. Mirrors the `Tick` interface in core/src/types.ts.
struct Tick {
  double value = 0.0;
  /// Empty means "use the scale's formatTick".
  std::string label;
  bool minor = false;
  /// Whether this tick draws a grid line. Major defaults true, minor false.
  bool grid = true;
};

/// "Nice" step for an interval: 1, 2, 5 x 10^n. Wilkinson-style rounding.
double nice_step(double raw_step);

/// Auto ticks for a linear axis. Majors only; minors are added separately.
std::vector<Tick> auto_ticks(double min, double max, int target = 6);

/// Insert `count` evenly spaced minor ticks between each pair of majors.
std::vector<Tick> with_minor_ticks(const std::vector<Tick>& major, int count);

/// Default number formatter: compact, avoids noisy trailing decimals.
std::string default_format(double value);

}  // namespace photon
