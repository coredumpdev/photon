// Marching cubes — port of core/src/plot3d/marching-cubes.ts.
//
// A triangle soup with smooth normals from a scalar volume. Pure: no GL, no
// layer, nothing to mock — which is what lets the tables be checked against
// their own definition rather than against a picture.
//
// The volume is indexed `x + y*nx + z*nx*ny`, and a corner counts as *inside*
// when its value is below the level. That is the convention the canonical
// Bourke/Bloyd tables were written for; flipping it turns every surface inside
// out, and the lighting is the only thing that would show it.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::plot3d {

struct Mesh {
  /// Three floats a vertex, three vertices a triangle.
  std::vector<float> positions;
  /// Parallel to `positions`; from the volume's gradient, so it shades smoothly.
  std::vector<float> normals;
};

/// `extent` maps the lattice into world space; an empty range means 0..n-1.
Mesh marching_cubes(const double* values, size_t nx, size_t ny, size_t nz, double level,
                    double x0, double x1, double y0, double y1, double z0, double z1);

}  // namespace photon::plot3d
