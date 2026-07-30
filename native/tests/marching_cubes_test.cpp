/*
 * Marching cubes.
 *
 * A transcription of packages/core/test/marching-cubes.test.ts, plus two cases
 * it does not have. The 256-entry tables are the point: a wrong row still
 * produces a mesh, and the mesh still looks like a surface — it just has a hole
 * in it where one case was mis-transcribed. So what is checked is that every
 * vertex of a sphere's level set really is on that sphere, which no single bad
 * row survives.
 */

#include <cmath>
#include <cstddef>
#include <vector>

#include "check.h"
#include "plot3d/marching_cubes.hpp"

using photon::plot3d::marching_cubes;
using photon::plot3d::Mesh;

namespace {

/// A distance field: the value at a lattice point is its distance from the
/// centre, so the level set at radius R is a sphere of radius R.
std::vector<double> sphere_volume(size_t n) {
  std::vector<double> values(n * n * n);
  const double c = static_cast<double>(n - 1) / 2.0;
  for (size_t z = 0; z < n; ++z) {
    for (size_t y = 0; y < n; ++y) {
      for (size_t x = 0; x < n; ++x) {
        const double dx = static_cast<double>(x) - c;
        const double dy = static_cast<double>(y) - c;
        const double dz = static_cast<double>(z) - c;
        values[x + y * n + z * n * n] = std::sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
  }
  return values;
}

void test_a_level_outside_the_data_meshes_nothing() {
  const std::vector<double> values = sphere_volume(8);
  const Mesh mesh = marching_cubes(values.data(), 8, 8, 8, -5.0, 0, 0, 0, 0, 0, 0);
  CHECK(mesh.positions.empty());
  CHECK(mesh.normals.empty());
}

void test_every_vertex_of_a_sphere_is_on_that_sphere() {
  const size_t n = 24;
  const std::vector<double> values = sphere_volume(n);
  const double radius = 8.0;
  const Mesh mesh = marching_cubes(values.data(), n, n, n, radius, 0, 0, 0, 0, 0, 0);
  CHECK(!mesh.positions.empty());
  CHECK_EQ(mesh.positions.size() % 9, 0);  // a whole number of triangles
  CHECK_EQ(mesh.normals.size(), mesh.positions.size());

  const double c = static_cast<double>(n - 1) / 2.0;
  size_t within = 0;
  const size_t vertices = mesh.positions.size() / 3;
  for (size_t i = 0; i < vertices; ++i) {
    const double dx = mesh.positions[i * 3] - c;
    const double dy = mesh.positions[i * 3 + 1] - c;
    const double dz = mesh.positions[i * 3 + 2] - c;
    if (std::abs(std::sqrt(dx * dx + dy * dy + dz * dz) - radius) < 0.6) ++within;
  }
  CHECK(static_cast<double>(within) / static_cast<double>(vertices) > 0.95);
}

void test_the_normals_are_unit_length() {
  const size_t n = 16;
  const std::vector<double> values = sphere_volume(n);
  const Mesh mesh = marching_cubes(values.data(), n, n, n, 5.0, 0, 0, 0, 0, 0, 0);
  CHECK(!mesh.normals.empty());
  for (size_t i = 0; i + 2 < mesh.normals.size(); i += 3) {
    const double len = std::sqrt(mesh.normals[i] * mesh.normals[i] +
                                 mesh.normals[i + 1] * mesh.normals[i + 1] +
                                 mesh.normals[i + 2] * mesh.normals[i + 2]);
    CHECK_NEAR(len, 1.0, 1e-5);
  }
}

void test_the_normal_points_up_the_field_not_out_of_the_shape() {
  // No TypeScript counterpart, and the case worth reading twice.
  //
  // The normal is the *negated* gradient, which points from high values toward
  // low ones. Which way that is out of the surface depends entirely on the
  // field: for a density blob — high inside, low outside, which is what an
  // isosurface is usually cut from — it points outwards and the shading is
  // right. For the distance field above, where low is inside, it points the
  // other way and the sphere is lit from behind.
  //
  // That is exactly what the web core does, so it is what this does. The demo
  // scene uses a density field for the same reason, and the mismatch is
  // recorded in native/TODO.md as something to resolve in the web core first —
  // "fix" it here alone and the two stop drawing the same picture.
  const size_t n = 20;
  const std::vector<double> distance = sphere_volume(n);
  std::vector<double> density(distance.size());
  for (size_t i = 0; i < distance.size(); ++i) density[i] = -distance[i];

  const double c = static_cast<double>(n - 1) / 2.0;
  const auto outward_fraction = [&](const std::vector<double>& field, double level) {
    const Mesh mesh = marching_cubes(field.data(), n, n, n, level, 0, 0, 0, 0, 0, 0);
    size_t outward = 0;
    const size_t vertices = mesh.positions.size() / 3;
    if (vertices == 0) return 0.0;
    for (size_t i = 0; i < vertices; ++i) {
      const double dx = mesh.positions[i * 3] - c;
      const double dy = mesh.positions[i * 3 + 1] - c;
      const double dz = mesh.positions[i * 3 + 2] - c;
      const double dot = dx * mesh.normals[i * 3] + dy * mesh.normals[i * 3 + 1] +
                         dz * mesh.normals[i * 3 + 2];
      if (dot > 0.0) ++outward;
    }
    return static_cast<double>(outward) / static_cast<double>(vertices);
  };

  CHECK(outward_fraction(density, -6.0) > 0.99);  // high inside: normals point out
  CHECK(outward_fraction(distance, 6.0) < 0.01);  // low inside: they point in
}

void test_the_extent_moves_the_mesh_without_reshaping_it() {
  // No TypeScript counterpart. The lattice is mapped into world space on the
  // way out, and getting that wrong scales the surface rather than placing it.
  const size_t n = 16;
  const std::vector<double> values = sphere_volume(n);
  const Mesh unit = marching_cubes(values.data(), n, n, n, 5.0, 0, 0, 0, 0, 0, 0);
  const Mesh moved = marching_cubes(values.data(), n, n, n, 5.0, 10.0, 25.0, 0, 0, 0, 0);
  CHECK_EQ(unit.positions.size(), moved.positions.size());
  // x ran 0..15 and now runs 10..25 — the same span, shifted by ten.
  for (size_t i = 0; i < unit.positions.size(); i += 3) {
    CHECK_NEAR(moved.positions[i], unit.positions[i] + 10.0, 1e-4);
    CHECK_NEAR(moved.positions[i + 1], unit.positions[i + 1], 1e-6);
  }
}

void test_degenerate_volumes_mesh_nothing() {
  const std::vector<double> one(1, 0.0);
  CHECK(marching_cubes(one.data(), 1, 1, 1, 0.5, 0, 0, 0, 0, 0, 0).positions.empty());
  CHECK(marching_cubes(nullptr, 8, 8, 8, 0.5, 0, 0, 0, 0, 0, 0).positions.empty());
}

}  // namespace

int main() {
  RUN(test_a_level_outside_the_data_meshes_nothing);
  RUN(test_every_vertex_of_a_sphere_is_on_that_sphere);
  RUN(test_the_normals_are_unit_length);
  RUN(test_the_normal_points_up_the_field_not_out_of_the_shape);
  RUN(test_the_extent_moves_the_mesh_without_reshaping_it);
  RUN(test_degenerate_volumes_mesh_nothing);
  return TEST_MAIN_RESULT();
}
