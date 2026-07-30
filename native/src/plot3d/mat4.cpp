#include "plot3d/mat4.hpp"

#include <cmath>

namespace photon::plot3d {

namespace {

Vec3 sub(const Vec3& a, const Vec3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }

Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}

Vec3 normalize(const Vec3& v) {
  const double len = std::hypot(std::hypot(v[0], v[1]), v[2]);
  const double d = len == 0.0 ? 1.0 : len;
  return {v[0] / d, v[1] / d, v[2] / d};
}

}  // namespace

Mat4 identity() {
  Mat4 m{};
  m[0] = m[5] = m[10] = m[15] = 1.0f;
  return m;
}

Mat4 multiply(const Mat4& a, const Mat4& b) {
  Mat4 out{};
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      float s = 0.0f;
      for (int k = 0; k < 4; ++k) s += a[static_cast<size_t>(k * 4 + r)] * b[static_cast<size_t>(c * 4 + k)];
      out[static_cast<size_t>(c * 4 + r)] = s;
    }
  }
  return out;
}

Mat4 perspective(double fovy, double aspect, double near, double far) {
  const double f = 1.0 / std::tan(fovy / 2.0);
  const double nf = 1.0 / (near - far);
  Mat4 m{};
  m[0] = static_cast<float>(f / aspect);
  m[5] = static_cast<float>(f);
  m[10] = static_cast<float>((far + near) * nf);
  m[11] = -1.0f;
  m[14] = static_cast<float>(2.0 * far * near * nf);
  return m;
}

Mat4 orthographic(double half_height, double aspect, double near, double far) {
  Mat4 m = identity();
  const double half_width = half_height * aspect;
  m[0] = static_cast<float>(1.0 / half_width);
  m[5] = static_cast<float>(1.0 / half_height);
  m[10] = static_cast<float>(2.0 / (near - far));
  m[14] = static_cast<float>((far + near) / (near - far));
  return m;
}

Mat4 look_at(const Vec3& eye, const Vec3& center, const Vec3& up) {
  const Vec3 z = normalize(sub(eye, center));
  const Vec3 x = normalize(cross(up, z));
  const Vec3 y = cross(z, x);
  Mat4 m = identity();
  m[0] = static_cast<float>(x[0]);
  m[4] = static_cast<float>(x[1]);
  m[8] = static_cast<float>(x[2]);
  m[1] = static_cast<float>(y[0]);
  m[5] = static_cast<float>(y[1]);
  m[9] = static_cast<float>(y[2]);
  m[2] = static_cast<float>(z[0]);
  m[6] = static_cast<float>(z[1]);
  m[10] = static_cast<float>(z[2]);
  m[12] = static_cast<float>(-(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]));
  m[13] = static_cast<float>(-(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]));
  m[14] = static_cast<float>(-(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]));
  return m;
}

Mat4 scale_translate(const Vec3& scale, const Vec3& translate) {
  Mat4 m = identity();
  m[0] = static_cast<float>(scale[0]);
  m[5] = static_cast<float>(scale[1]);
  m[10] = static_cast<float>(scale[2]);
  m[12] = static_cast<float>(translate[0]);
  m[13] = static_cast<float>(translate[1]);
  m[14] = static_cast<float>(translate[2]);
  return m;
}

std::array<double, 4> transform_point(const Mat4& m, double x, double y, double z) {
  return {
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
      m[3] * x + m[7] * y + m[11] * z + m[15],
  };
}

}  // namespace photon::plot3d
