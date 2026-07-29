#include "axes/axis.hpp"

#include "scale.hpp"

namespace photon {

void Axis::set_explicit_ticks(std::vector<Tick> ticks) {
  explicit_ = std::move(ticks);
  dirty_ = true;
}

void Axis::set_config(render::AxisConfig new_config) {
  config = std::move(new_config);
  dirty_ = true;
}

const std::vector<Tick>& Axis::resolve(const Scale& scale) {
  if (!dirty_ && cached_lo_ == scale.lo && cached_hi_ == scale.hi && cached_type_ == scale.type) {
    return resolved_;
  }

  std::vector<Tick> source;
  if (!explicit_.empty()) {
    source = explicit_;
  } else {
    source = scale.ticks();
    // Auto minor ticks only make sense on a linear axis; log and time scales
    // already emit their own, which is why the web core gates it the same way.
    if (config.minor_ticks > 0 && scale.type == PH_SCALE_LINEAR) {
      source = with_minor_ticks(source, config.minor_ticks);
    }
  }

  resolved_.clear();
  resolved_.reserve(source.size());
  for (const Tick& tick : source) {
    // Ticks outside the visible domain are dropped rather than clamped, so a
    // pan does not pile labels up against the edge.
    if (tick.value < scale.lo || tick.value > scale.hi) continue;
    Tick out;
    out.value = tick.value;
    out.minor = tick.minor;
    out.grid = tick.grid;
    out.label = tick.minor ? std::string() : (tick.label.empty() ? scale.format_tick(tick.value)
                                                                : tick.label);
    resolved_.push_back(std::move(out));
  }

  dirty_ = false;
  cached_lo_ = scale.lo;
  cached_hi_ = scale.hi;
  cached_type_ = scale.type;
  return resolved_;
}

}  // namespace photon
