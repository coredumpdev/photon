// Port of core/src/layers/pick.ts.
//
// Shared hover picking for the point/series layers. Distances are measured in
// *pixels* through a projection, so x and y are compared on the same footing
// whatever each axis's data range is.
//
// When x is sorted — which the line and stem layers already know, because
// decimation needs it — the cursor is located by binary search and only the
// handful of points that can still win are measured. That is what keeps hover
// interactive on a multi-million-point series.
#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

#include "photon/photon.h"
#include "scale.hpp"

namespace photon {

/// Which pixel distance a pick minimizes.
enum class PickMode {
  /// Horizontal distance only — the classic crosshair-along-x.
  X,
  /// Vertical distance only.
  Y,
  /// True 2-D distance; right for point clouds, where an x-only match would
  /// highlight the wrong point.
  XY,
};

struct Picked {
  double x = 0.0;
  double y = 0.0;
  int32_t index = -1;
};

/**
 * Data space to pixel space, one axis at a time.
 *
 * Two scalar calls rather than one returning a pair: a pair per point is an
 * allocation per point in the TypeScript, and here it would still be a copy on
 * the hottest loop in the library.
 */
struct PickProjection {
  /// region.left + norm_x(v) * region.width
  double x_left = 0.0;
  double x_width = 1.0;
  /// region.top + (1 - norm_y(v)) * region.height
  double y_top = 0.0;
  double y_height = 1.0;
  const Scale* scale_x = nullptr;
  const Scale* scale_y = nullptr;

  double project_x(double value) const;
  double project_y(double value) const;
};

/**
 * The nearest point to the cursor, or a miss.
 *
 * `gate_px` is the furthest a hit may be in the chosen metric — a scatter passes
 * its marker radius so a far-away point never highlights; a series layer passes
 * infinity. `sorted_x` unlocks the binary search.
 */
bool pick_nearest(const std::vector<double>& xs, const std::vector<double>& ys, PickMode mode,
                  double cursor_px, double cursor_py, const PickProjection& project,
                  double gate_px, bool sorted_x, Picked& out);

}  // namespace photon
