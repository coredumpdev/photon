// Column-major 4x4 matrices — port of core/src/plot3d/mat4.ts.
//
// Column-major because that is what GL's uniform upload expects with
// `transpose = false`, and transposing on the way in would be one more place
// for a sign to go missing. Everything here is `float` for the same reason: it
// ends up in a uniform, and doing the arithmetic in double and narrowing at the
// boundary would hide which precision the picture actually has.
#pragma once

#include <array>

namespace photon::plot3d {

using Mat4 = std::array<float, 16>;
using Vec3 = std::array<double, 3>;

Mat4 identity();

/// a * b, in that order.
Mat4 multiply(const Mat4& a, const Mat4& b);

Mat4 perspective(double fovy, double aspect, double near, double far);

/**
 * A symmetric orthographic projection: the view volume is `2 * half_height`
 * tall and `2 * half_height * aspect` wide, with no perspective divide — so
 * parallel edges stay parallel, which is what a diagram wants and a surface
 * does not.
 */
Mat4 orthographic(double half_height, double aspect, double near, double far);

Mat4 look_at(const Vec3& eye, const Vec3& center, const Vec3& up);

/// p' = scale * p + translate, per axis. What maps a data extent into the cube.
Mat4 scale_translate(const Vec3& scale, const Vec3& translate);

/// A homogeneous point through a column-major matrix: x, y, z, w.
std::array<double, 4> transform_point(const Mat4& m, double x, double y, double z);

}  // namespace photon::plot3d
