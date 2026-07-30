// Field charts — port of core/src/charts/fields.ts and _geom.ts.
//
// The gridded and vector-field half of matplotlib's gallery: filled contours, a
// non-uniform colour mesh, streamlines and wind barbs. All four are layouts
// over the patches and line layers that already exist — no new shaders, the
// same arrangement as the diagrams.
//
// What makes these worth porting rather than leaving to the caller is that each
// one has a real algorithm under it: isobands subdivides every straddling cell
// into four triangles to kill the saddle ambiguity, and streamlines integrate
// with RK4 and claim an occupancy lattice so they space themselves.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::charts {

/// One closed ring, as the diagram layouts also use.
struct FieldRing {
  std::vector<double> x;
  std::vector<double> y;
};

/// A filled band: the region of the field where lo <= v <= hi.
struct Isoband {
  double lo = 0.0;
  double hi = 0.0;
  FieldRing ring;
};

/**
 * Filled contour bands (matplotlib's `contourf`).
 *
 * Every cell that straddles a level is split into four triangles around its
 * centre before clipping, which is what removes the saddle ambiguity plain
 * marching squares has — a triangle's linear interpolant cannot produce two
 * disjoint regions. A cell wholly inside one band needs none of that, and runs
 * of those merge along a row into one rectangle, which is where most of the
 * polygon count goes on a smooth field.
 *
 * `levels` is a count of evenly spaced bands; `bounds`, when non-empty, is the
 * explicit boundary list and wins.
 */
std::vector<Isoband> isobands(const double* values, size_t cols, size_t rows, double x0, double y0,
                              double x1, double y1, int levels,
                              const std::vector<double>& bounds = {});

/// The boundaries `isobands` would use, which the caller needs for the domain.
std::vector<double> auto_levels(const double* values, size_t count, int levels);

/// One cell of a colour mesh: a quad ring and the value that colours it.
struct MeshCell {
  FieldRing ring;
  double value = 0.0;
};

/**
 * A colour mesh over unevenly spaced cells (matplotlib's `pcolormesh`).
 *
 * A heatmap is the faster choice when the grid is uniform — it is one textured
 * quad. This is for what a heatmap cannot express: bins of different widths, or
 * a curvilinear grid where every corner is placed independently.
 *
 * Rectilinear takes `cols + 1` and `rows + 1` edges; curvilinear takes the
 * flattened `(rows + 1) * (cols + 1)` corner grids and needs `cols`/`rows`
 * given, because a corner grid carries no shape of its own.
 */
std::vector<MeshCell> pcolormesh(const double* values, const double* x_edges,
                                 const double* y_edges, size_t cols, size_t rows,
                                 bool curvilinear);

/// One traced streamline in data space.
struct Streamline {
  std::vector<double> x;
  std::vector<double> y;
  /// Mean speed along the line, for colouring it.
  double speed = 0.0;
};

/**
 * Streamlines through a vector field, integrated with RK4.
 *
 * Seeds walk a lattice and a line stops when it re-enters a cell another line
 * already claimed, which is matplotlib's trick for spacing them evenly instead
 * of letting them bunch along attractors.
 */
std::vector<Streamline> streamlines(const double* u, const double* v, size_t cols, size_t rows,
                                    double x0, double y0, double x1, double y1,
                                    double density = 1.0, double step = 0.35,
                                    int max_steps = 400);

/// A thin quad along a segment — the stroke primitive for a patches layer.
FieldRing segment_quad(double ax, double ay, double bx, double by, double width);

/// The two polygon sets a wind-barb glyph needs.
struct Barbs {
  /// Staffs, ticks and calm crosses, all thin quads.
  std::vector<FieldRing> strokes;
  /// Filled pennants, one per ten increments.
  std::vector<FieldRing> pennants;
};

/**
 * Wind barbs (matplotlib's `barbs`) — the glyph where speed is read off the
 * ticks rather than the arrow length: a half tick per increment, a full tick
 * per two, a filled pennant per ten. The staff points *into* the wind, as the
 * convention requires.
 */
Barbs barbs(const double* x, const double* y, const double* u, const double* v, size_t count,
            double increment = 5.0, double length = 0.0, double width = 0.0);

}  // namespace photon::charts
