/*
 * The ear-clipping port, checked against the assertions in the TypeScript
 * suite: packages/core/test/earcut.test.ts.
 *
 * These are the *same* expectations, transcribed. A triangulation is one of the
 * few things where "looks right" is genuinely unhelpful — a hole filled in, or
 * one sliver triangle wound backwards, is invisible in a picture and obvious in
 * a total area. So every case here checks the summed triangle area against a
 * shoelace computed independently of the algorithm.
 */

#include <cmath>
#include <vector>

#include "check.h"
#include "geo/earcut.hpp"

using photon::geo::earcut;

namespace {

/// Sum of |triangle| areas produced for a flat coord array and an index list.
double triangulated_area(const std::vector<double>& data,
                         const std::vector<uint32_t>& triangles) {
  double sum = 0.0;
  for (size_t i = 0; i + 2 < triangles.size(); i += 3) {
    const size_t a = static_cast<size_t>(triangles[i]) * 2;
    const size_t b = static_cast<size_t>(triangles[i + 1]) * 2;
    const size_t c = static_cast<size_t>(triangles[i + 2]) * 2;
    sum += std::abs((data[b] - data[a]) * (data[c + 1] - data[a + 1]) -
                    (data[c] - data[a]) * (data[b + 1] - data[a + 1])) /
           2.0;
  }
  return sum;
}

/// |shoelace| of a flat ring, for independent area checks.
double ring_area(const std::vector<double>& points) {
  double sum = 0.0;
  const size_t n = points.size();
  for (size_t i = 0; i < n; i += 2) {
    const size_t j = (i + 2) % n;
    sum += points[i] * points[j + 1] - points[j] * points[i + 1];
  }
  return std::abs(sum) / 2.0;
}

std::vector<double> circle(int n, double radius, bool clockwise = false) {
  std::vector<double> points;
  points.reserve(static_cast<size_t>(n) * 2);
  for (int k = 0; k < n; ++k) {
    const double angle = (clockwise ? -k : k) / static_cast<double>(n) * 2.0 * 3.14159265358979323846;
    points.push_back(std::cos(angle) * radius);
    points.push_back(std::sin(angle) * radius);
  }
  return points;
}

std::vector<double> concat(std::vector<double> a, const std::vector<double>& b) {
  a.insert(a.end(), b.begin(), b.end());
  return a;
}

void test_a_square_becomes_two_triangles() {
  const std::vector<double> data = {0, 0, 10, 0, 10, 10, 0, 10};
  const std::vector<uint32_t> triangles = earcut(data, {});
  CHECK_EQ(triangles.size(), size_t{6});
  CHECK_NEAR(triangulated_area(data, triangles), 100.0, 1e-9);
}

void test_a_concave_arrow() {
  // A chevron pointing right; the area is computed independently by shoelace.
  const std::vector<double> data = {0, 0, 6, 4, 0, 8, 2, 4};
  const std::vector<uint32_t> triangles = earcut(data, {});
  CHECK_NEAR(triangulated_area(data, triangles), 16.0, 1e-9);
}

void test_a_hole_is_cut_out() {
  // 10x10 outer, 4x4 hole, so 100 - 16 = 84. The hole winds the other way,
  // which is the convention earcut expects and enforces anyway.
  const std::vector<double> outer = {0, 0, 10, 0, 10, 10, 0, 10};
  const std::vector<double> hole = {3, 3, 3, 7, 7, 7, 7, 3};
  const std::vector<double> data = concat(outer, hole);
  const std::vector<uint32_t> triangles = earcut(data, {4});  // hole starts at vertex 4
  CHECK_NEAR(triangulated_area(data, triangles), 84.0, 1e-9);
}

void test_degenerate_rings_produce_nothing() {
  CHECK_EQ(earcut({0, 0, 1, 1}, {}).size(), size_t{0});
  CHECK_EQ(earcut({0, 0, 0, 0, 0, 0}, {}).size(), size_t{0});
  CHECK_EQ(earcut({}, {}).size(), size_t{0});
}

void test_the_z_order_path_stays_exact() {
  // Over 80 vertices, so the Morton-code acceleration takes over. It is a
  // different code path with the same contract, and this is the only test that
  // reaches it — a fan of 256 triangles either comes out whole or does not.
  const std::vector<double> points = circle(256, 100.0);
  const std::vector<uint32_t> triangles = earcut(points, {});
  CHECK_EQ(triangles.size(), size_t{(256 - 2) * 3});
  CHECK_NEAR(triangulated_area(points, triangles), ring_area(points), 1e-5);
}

void test_the_z_order_path_with_a_hole() {
  const std::vector<double> outer = circle(160, 100.0);
  const std::vector<double> hole = circle(64, 40.0, true);
  const std::vector<double> data = concat(outer, hole);
  const std::vector<uint32_t> triangles = earcut(data, {160});
  CHECK_NEAR(triangulated_area(data, triangles), ring_area(outer) - ring_area(hole), 1e-4);
}

void test_a_regular_octagon() {
  const int n = 8;
  const std::vector<double> points = circle(n, 100.0);
  const std::vector<uint32_t> triangles = earcut(points, {});
  CHECK_EQ(triangles.size(), size_t{(n - 2) * 3});
  CHECK_NEAR(triangulated_area(points, triangles), ring_area(points), 1e-9);
}

/// Not in the TypeScript suite: winding must not matter to the caller.
void test_winding_does_not_change_the_result() {
  const std::vector<double> counter = {0, 0, 10, 0, 10, 10, 0, 10};
  const std::vector<double> clockwise = {0, 10, 10, 10, 10, 0, 0, 0};
  CHECK_NEAR(triangulated_area(counter, earcut(counter, {})), 100.0, 1e-9);
  CHECK_NEAR(triangulated_area(clockwise, earcut(clockwise, {})), 100.0, 1e-9);
}

/// Two holes, so the leftmost-first bridge ordering is exercised.
void test_two_holes() {
  std::vector<double> data = {0, 0, 20, 0, 20, 10, 0, 10};
  const std::vector<double> left = {2, 2, 2, 8, 6, 8, 6, 2};   // 4x6 = 24
  const std::vector<double> right = {12, 3, 12, 7, 18, 7, 18, 3};  // 6x4 = 24
  data = concat(concat(data, left), right);
  const std::vector<uint32_t> triangles = earcut(data, {4, 8});
  CHECK_NEAR(triangulated_area(data, triangles), 200.0 - 24.0 - 24.0, 1e-9);
}

}  // namespace

int main() {
  RUN(test_a_square_becomes_two_triangles);
  RUN(test_a_concave_arrow);
  RUN(test_a_hole_is_cut_out);
  RUN(test_degenerate_rings_produce_nothing);
  RUN(test_the_z_order_path_stays_exact);
  RUN(test_the_z_order_path_with_a_hole);
  RUN(test_a_regular_octagon);
  RUN(test_winding_does_not_change_the_result);
  RUN(test_two_holes);
  return TEST_MAIN_RESULT();
}
