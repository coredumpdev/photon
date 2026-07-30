/*
 * The 3-D matrix helpers.
 *
 * Column-major arithmetic is the classic place for a transpose to hide: every
 * one of these is symmetric enough that a wrong index still produces a picture,
 * just one rotated or mirrored. So what is checked is what the matrices are
 * *for* — a look-at that puts the eye at the origin, a projection that maps the
 * near plane to -1 and the far plane to +1, a normalize that lands a data
 * extent exactly on the cube corners.
 */

#include <cmath>

#include "check.h"
#include "plot3d/mat4.hpp"

using photon::plot3d::identity;
using photon::plot3d::look_at;
using photon::plot3d::Mat4;
using photon::plot3d::multiply;
using photon::plot3d::orthographic;
using photon::plot3d::perspective;
using photon::plot3d::scale_translate;
using photon::plot3d::transform_point;
using photon::plot3d::Vec3;

namespace {

void test_identity_leaves_a_point_alone() {
  const std::array<double, 4> p = transform_point(identity(), 3.0, -2.0, 7.0);
  CHECK_NEAR(p[0], 3.0, 1e-12);
  CHECK_NEAR(p[1], -2.0, 1e-12);
  CHECK_NEAR(p[2], 7.0, 1e-12);
  CHECK_NEAR(p[3], 1.0, 1e-12);
}

void test_multiply_is_ordered() {
  // Scale by two, then shift by one: a * b applies b first, which is the order
  // every mvp = proj * view * model in this code depends on.
  const Mat4 scale = scale_translate({2.0, 2.0, 2.0}, {0.0, 0.0, 0.0});
  const Mat4 shift = scale_translate({1.0, 1.0, 1.0}, {1.0, 0.0, 0.0});
  const std::array<double, 4> scaled_then_shifted =
      transform_point(multiply(shift, scale), 3.0, 0.0, 0.0);
  CHECK_NEAR(scaled_then_shifted[0], 7.0, 1e-12);  // 3*2 + 1
  const std::array<double, 4> shifted_then_scaled =
      transform_point(multiply(scale, shift), 3.0, 0.0, 0.0);
  CHECK_NEAR(shifted_then_scaled[0], 8.0, 1e-12);  // (3+1)*2
}

void test_scale_translate_maps_a_data_extent_onto_the_cube() {
  // This is exactly what Plot3D::refit builds: 10..20 has to land on -1..1.
  //
  // The tolerance is 1e-6 rather than 1e-12 because these matrices are float32
  // — they end up in a uniform, and doing the arithmetic in double only to
  // narrow at the boundary would hide which precision the picture actually has.
  const double span = 20.0 - 10.0;
  const Mat4 m = scale_translate({2.0 / span, 1.0, 1.0}, {-(20.0 + 10.0) / span, 0.0, 0.0});
  CHECK_NEAR(transform_point(m, 10.0, 0.0, 0.0)[0], -1.0, 1e-6);
  CHECK_NEAR(transform_point(m, 20.0, 0.0, 0.0)[0], 1.0, 1e-6);
  CHECK_NEAR(transform_point(m, 15.0, 0.0, 0.0)[0], 0.0, 1e-6);
}

void test_look_at_puts_the_eye_at_the_origin() {
  const Vec3 eye{3.0, 4.0, 5.0};
  const Mat4 view = look_at(eye, {0.0, 0.0, 0.0}, {0.0, 1.0, 0.0});
  const std::array<double, 4> at_eye = transform_point(view, eye[0], eye[1], eye[2]);
  CHECK_NEAR(at_eye[0], 0.0, 1e-6);
  CHECK_NEAR(at_eye[1], 0.0, 1e-6);
  CHECK_NEAR(at_eye[2], 0.0, 1e-6);
  // The target sits straight down -z, at the eye's distance from it.
  const std::array<double, 4> at_center = transform_point(view, 0.0, 0.0, 0.0);
  CHECK_NEAR(at_center[0], 0.0, 1e-6);
  CHECK_NEAR(at_center[1], 0.0, 1e-6);
  CHECK_NEAR(at_center[2], -std::sqrt(9.0 + 16.0 + 25.0), 1e-6);
}

void test_perspective_maps_the_clip_planes() {
  const Mat4 p = perspective(1.0, 1.5, 1.0, 100.0);
  // A point on the near plane comes out at z/w = -1, one on the far plane at +1.
  const std::array<double, 4> near = transform_point(p, 0.0, 0.0, -1.0);
  CHECK_NEAR(near[2] / near[3], -1.0, 1e-6);
  const std::array<double, 4> far = transform_point(p, 0.0, 0.0, -100.0);
  CHECK_NEAR(far[2] / far[3], 1.0, 1e-6);
  // And w is the negated view-space depth, which is what makes it a divide.
  CHECK_NEAR(near[3], 1.0, 1e-6);
}

void test_perspective_narrows_with_the_aspect() {
  // The wider the viewport, the smaller the horizontal scale, or a wide window
  // would stretch the scene instead of showing more of it.
  const Mat4 square = perspective(1.0, 1.0, 0.1, 10.0);
  const Mat4 wide = perspective(1.0, 2.0, 0.1, 10.0);
  CHECK(std::abs(wide[0]) < std::abs(square[0]));
  CHECK_NEAR(wide[5], square[5], 1e-6);
}

void test_orthographic_has_no_divide() {
  const Mat4 o = orthographic(4.0, 2.0, -100.0, 100.0);
  const std::array<double, 4> p = transform_point(o, 8.0, 4.0, 0.0);
  // w stays 1: that is the whole difference from a perspective camera, and it
  // is why parallel edges stay parallel.
  CHECK_NEAR(p[3], 1.0, 1e-6);
  CHECK_NEAR(p[0], 1.0, 1e-6);  // half-width is 4 * 2
  CHECK_NEAR(p[1], 1.0, 1e-6);  // half-height is 4
}

}  // namespace

int main() {
  RUN(test_identity_leaves_a_point_alone);
  RUN(test_multiply_is_ordered);
  RUN(test_scale_translate_maps_a_data_extent_onto_the_cube);
  RUN(test_look_at_puts_the_eye_at_the_origin);
  RUN(test_perspective_maps_the_clip_planes);
  RUN(test_perspective_narrows_with_the_aspect);
  RUN(test_orthographic_has_no_divide);
  return TEST_MAIN_RESULT();
}
