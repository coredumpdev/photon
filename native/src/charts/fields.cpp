#include "charts/fields.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace photon::charts {

namespace {

constexpr double kPi = 3.14159265358979323846;

/**
 * Clip a polygon by a scalar half-space, interpolating along crossed edges.
 *
 * Sutherland-Hodgman with the scalar itself as the predicate: `keep_above`
 * selects v >= t, and clipping twice with both senses leaves the band. Writes
 * into caller scratch because isobands runs this a few times per straddling
 * cell, and the allocation would dominate at any real field size. The scratch
 * needs n + 2 entries — one half-plane can add at most one vertex.
 */
size_t clip_scalar_into(const double* px, const double* py, const double* pv, size_t n, double t,
                        bool keep_above, double* out_x, double* out_y, double* out_v) {
  size_t m = 0;
  for (size_t i = 0; i < n; ++i) {
    const size_t j = i + 1 == n ? 0 : i + 1;
    const double vi = pv[i];
    const double vj = pv[j];
    const bool in_i = keep_above ? vi >= t : vi <= t;
    const bool in_j = keep_above ? vj >= t : vj <= t;
    if (in_i) {
      out_x[m] = px[i];
      out_y[m] = py[i];
      out_v[m] = vi;
      ++m;
    }
    if (in_i != in_j) {
      const double denom = vj - vi;
      const double f = (t - vi) / (denom == 0.0 ? 1e-12 : denom);
      out_x[m] = px[i] + (px[j] - px[i]) * f;
      out_y[m] = py[i] + (py[j] - py[i]) * f;
      out_v[m] = t;
      ++m;
    }
  }
  return m;
}

}  // namespace

std::vector<double> auto_levels(const double* values, size_t count, int levels) {
  const int n = std::max(1, levels);
  double lo = std::numeric_limits<double>::infinity();
  double hi = -lo;
  for (size_t i = 0; values && i < count; ++i) {
    if (values[i] < lo) lo = values[i];
    if (values[i] > hi) hi = values[i];
  }
  if (!std::isfinite(lo) || !std::isfinite(hi)) return {0.0, 1.0};
  if (lo == hi) {
    lo -= 0.5;
    hi += 0.5;
  }
  std::vector<double> out;
  out.reserve(static_cast<size_t>(n) + 1);
  for (int i = 0; i <= n; ++i) {
    out.push_back(lo + (hi - lo) * static_cast<double>(i) / static_cast<double>(n));
  }
  return out;
}

std::vector<Isoband> isobands(const double* values, size_t cols, size_t rows, double x0, double y0,
                              double x1, double y1, int levels,
                              const std::vector<double>& bounds_in) {
  std::vector<Isoband> out;
  if (!values || cols < 2 || rows < 2) return out;
  std::vector<double> bounds = bounds_in;
  if (bounds.empty()) {
    bounds = auto_levels(values, cols * rows, levels);
  } else {
    std::sort(bounds.begin(), bounds.end());
  }
  if (bounds.size() < 2) return out;
  const int band_count = static_cast<int>(bounds.size()) - 1;

  const auto gx = [&](size_t c) {
    return x0 + static_cast<double>(c) / static_cast<double>(cols - 1) * (x1 - x0);
  };
  const auto gy = [&](size_t r) {
    return y0 + static_cast<double>(r) / static_cast<double>(rows - 1) * (y1 - y0);
  };
  const auto at = [&](size_t c, size_t r) { return values[r * cols + c]; };

  /// The band a value falls in, clamped to the ends; -1 when it is not finite.
  const auto band_of = [&](double v) {
    if (!std::isfinite(v)) return -1;
    int lo = 0;
    int hi = band_count - 1;
    while (lo < hi) {
      const int mid = (lo + hi) / 2;
      if (v > bounds[static_cast<size_t>(mid) + 1]) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };

  // Scratch for the clipper: a triangle cut by two half-planes yields at most
  // five vertices, so eight is ample and the hot loop allocates only what it
  // keeps.
  double tx[8], ty[8], tv[8];
  double ax[8], ay[8], av[8];
  double bx[8], by[8], bv[8];

  const auto emit = [&](double lo, double hi) {
    const size_t na = clip_scalar_into(tx, ty, tv, 3, lo, true, ax, ay, av);
    if (na < 3) return;
    const size_t nb = clip_scalar_into(ax, ay, av, na, hi, false, bx, by, bv);
    if (nb < 3) return;
    Isoband band;
    band.lo = lo;
    band.hi = hi;
    band.ring.x.assign(bx, bx + nb);
    band.ring.y.assign(by, by + nb);
    out.push_back(std::move(band));
  };

  // One row of band indices, reused down the grid: each row's lower edge is the
  // next row's upper edge, so a value is classified once rather than four times.
  std::vector<int> band_row(cols);
  std::vector<int> next_row(cols);
  for (size_t c = 0; c < cols; ++c) band_row[c] = band_of(at(c, 0));

  for (size_t r = 0; r + 1 < rows; ++r) {
    for (size_t c = 0; c < cols; ++c) next_row[c] = band_of(at(c, r + 1));
    const double ya = gy(r);
    const double yb = gy(r + 1);

    int run_band = -1;
    size_t run_start = 0;
    const auto flush_run = [&](size_t end_col) {
      if (run_band < 0) return;
      Isoband band;
      band.lo = bounds[static_cast<size_t>(run_band)];
      band.hi = bounds[static_cast<size_t>(run_band) + 1];
      band.ring.x = {gx(run_start), gx(end_col), gx(end_col), gx(run_start)};
      band.ring.y = {ya, ya, yb, yb};
      out.push_back(std::move(band));
      run_band = -1;
    };

    for (size_t c = 0; c + 1 < cols; ++c) {
      const int b0 = band_row[c];
      const int b1 = band_row[c + 1];
      const int b2 = next_row[c + 1];
      const int b3 = next_row[c];
      if (b0 < 0 || b1 < 0 || b2 < 0 || b3 < 0) {
        flush_run(c);
        continue;
      }
      const double xa = gx(c);
      const double xb = gx(c + 1);

      // A whole cell inside one band extends the current run rather than
      // emitting a polygon of its own.
      if (b0 == b1 && b1 == b2 && b2 == b3) {
        if (run_band == b0) continue;
        flush_run(c);
        run_band = b0;
        run_start = c;
        continue;
      }
      flush_run(c);

      const double v0 = at(c, r);
      const double v1 = at(c + 1, r);
      const double v2 = at(c + 1, r + 1);
      const double v3 = at(c, r + 1);
      const double xc = (xa + xb) / 2.0;
      const double yc = (ya + yb) / 2.0;
      const double vc = (v0 + v1 + v2 + v3) / 4.0;
      const double corner_x[4] = {xa, xb, xb, xa};
      const double corner_y[4] = {ya, ya, yb, yb};
      const double corner_v[4] = {v0, v1, v2, v3};
      const int lowest = std::min({b0, b1, b2, b3});
      const int highest = std::max({b0, b1, b2, b3});

      for (int k = 0; k < 4; ++k) {
        const int j = (k + 1) & 3;
        tx[0] = corner_x[k];
        tx[1] = corner_x[j];
        tx[2] = xc;
        ty[0] = corner_y[k];
        ty[1] = corner_y[j];
        ty[2] = yc;
        tv[0] = corner_v[k];
        tv[1] = corner_v[j];
        tv[2] = vc;
        const double tmin = std::min({tv[0], tv[1], tv[2]});
        const double tmax = std::max({tv[0], tv[1], tv[2]});
        for (int b = lowest; b <= highest; ++b) {
          const double lo = bounds[static_cast<size_t>(b)];
          const double hi = bounds[static_cast<size_t>(b) + 1];
          if (tmax < lo || tmin > hi) continue;
          if (tmin >= lo && tmax <= hi) {
            // Wholly inside the band, so the clip would return it unchanged.
            Isoband band;
            band.lo = lo;
            band.hi = hi;
            band.ring.x = {tx[0], tx[1], tx[2]};
            band.ring.y = {ty[0], ty[1], ty[2]};
            out.push_back(std::move(band));
            continue;
          }
          emit(lo, hi);
        }
      }
    }
    flush_run(cols - 1);
    band_row = next_row;
  }
  return out;
}

std::vector<MeshCell> pcolormesh(const double* values, const double* x_edges,
                                 const double* y_edges, size_t cols, size_t rows,
                                 bool curvilinear) {
  std::vector<MeshCell> out;
  if (!values || !x_edges || !y_edges || cols == 0 || rows == 0) return out;
  out.reserve(cols * rows);

  for (size_t r = 0; r < rows; ++r) {
    for (size_t c = 0; c < cols; ++c) {
      MeshCell cell;
      cell.value = values[r * cols + c];
      if (curvilinear) {
        // Every corner is placed independently, so the quad is read from the
        // corner grid rather than from two edge vectors.
        const size_t stride = cols + 1;
        const size_t bl = r * stride + c;
        const size_t br = bl + 1;
        const size_t tl = (r + 1) * stride + c;
        const size_t tr = tl + 1;
        cell.ring.x = {x_edges[bl], x_edges[br], x_edges[tr], x_edges[tl]};
        cell.ring.y = {y_edges[bl], y_edges[br], y_edges[tr], y_edges[tl]};
      } else {
        const double xa = x_edges[c];
        const double xb = x_edges[c + 1];
        const double ya = y_edges[r];
        const double yb = y_edges[r + 1];
        cell.ring.x = {xa, xb, xb, xa};
        cell.ring.y = {ya, ya, yb, yb};
      }
      out.push_back(std::move(cell));
    }
  }
  return out;
}

std::vector<Streamline> streamlines(const double* u, const double* v, size_t cols, size_t rows,
                                    double x0, double y0, double x1, double y1, double density,
                                    double step, int max_steps) {
  std::vector<Streamline> out;
  if (!u || !v || cols < 2 || rows < 2) return out;
  const double dens = std::max(0.1, density);
  const int steps = std::max(10, max_steps);
  const double dx = (x1 - x0) / static_cast<double>(cols - 1);
  const double dy = (y1 - y0) / static_cast<double>(rows - 1);
  const double h = (step > 0.0 ? step : 0.35) * std::min(std::abs(dx), std::abs(dy));

  /// Bilinear sample of (u, v); false outside the field.
  const auto sample = [&](double px, double py, double& ou, double& ov) {
    const double fc = (px - x0) / (x1 - x0) * static_cast<double>(cols - 1);
    const double fr = (py - y0) / (y1 - y0) * static_cast<double>(rows - 1);
    if (!(fc >= 0.0 && fc <= static_cast<double>(cols - 1) && fr >= 0.0 &&
          fr <= static_cast<double>(rows - 1))) {
      return false;
    }
    const size_t c = std::min(cols - 2, static_cast<size_t>(fc));
    const size_t r = std::min(rows - 2, static_cast<size_t>(fr));
    const double tc = fc - static_cast<double>(c);
    const double tr = fr - static_cast<double>(r);
    const auto mix = [&](const double* a) {
      const double a00 = a[r * cols + c];
      const double a10 = a[r * cols + c + 1];
      const double a01 = a[(r + 1) * cols + c];
      const double a11 = a[(r + 1) * cols + c + 1];
      return (a00 * (1.0 - tc) + a10 * tc) * (1.0 - tr) + (a01 * (1.0 - tc) + a11 * tc) * tr;
    };
    ou = mix(u);
    ov = mix(v);
    return true;
  };

  // The occupancy lattice: one line per cell is what keeps the spacing even.
  const size_t gc = static_cast<size_t>(std::max(2.0, std::round(25.0 * dens)));
  const size_t gr = static_cast<size_t>(std::max(2.0, std::round(25.0 * dens)));
  std::vector<unsigned char> taken(gc * gr, 0);
  const auto cell_of = [&](double px, double py) {
    const double fc = (px - x0) / (x1 - x0) * static_cast<double>(gc);
    const double fr = (py - y0) / (y1 - y0) * static_cast<double>(gr);
    const size_t c = static_cast<size_t>(std::min(static_cast<double>(gc - 1), std::max(0.0, fc)));
    const size_t r = static_cast<size_t>(std::min(static_cast<double>(gr - 1), std::max(0.0, fr)));
    return r * gc + c;
  };

  struct Path {
    std::vector<double> x;
    std::vector<double> y;
    std::vector<double> speeds;
  };
  const auto trace = [&](double sx, double sy, double sign, std::vector<size_t>& claim) {
    Path path;
    path.x.push_back(sx);
    path.y.push_back(sy);
    double cx = sx;
    double cy = sy;
    for (int i = 0; i < steps; ++i) {
      double u1 = 0.0;
      double v1 = 0.0;
      if (!sample(cx, cy, u1, v1)) break;
      const double speed = std::hypot(u1, v1);
      if (!(speed > 1e-12)) break;
      path.speeds.push_back(speed);

      double u2 = 0.0, v2 = 0.0, u3 = 0.0, v3 = 0.0, u4 = 0.0, v4 = 0.0;
      const bool k2 = sample(cx + sign * h * u1 / (2.0 * speed),
                             cy + sign * h * v1 / (2.0 * speed), u2, v2);
      const double m2 = std::hypot(u2, v2 == 0.0 ? 1e-12 : v2);
      const bool k3 = k2 && sample(cx + sign * h * u2 / (2.0 * m2), cy + sign * h * v2 / (2.0 * m2),
                                   u3, v3);
      const double m3 = std::hypot(u3, v3 == 0.0 ? 1e-12 : v3);
      const bool k4 =
          k3 && sample(cx + sign * h * u3 / m3, cy + sign * h * v3 / m3, u4, v4);
      const double au = (k2 && k3 && k4) ? (u1 + 2.0 * u2 + 2.0 * u3 + u4) / 6.0 : u1;
      const double av = (k2 && k3 && k4) ? (v1 + 2.0 * v2 + 2.0 * v3 + v4) / 6.0 : v1;
      const double m = std::hypot(au, av) == 0.0 ? 1e-12 : std::hypot(au, av);
      cx += sign * h * au / m;
      cy += sign * h * av / m;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) break;
      const size_t cell = cell_of(cx, cy);
      if (taken[cell] && std::find(claim.begin(), claim.end(), cell) == claim.end()) break;
      claim.push_back(cell);
      path.x.push_back(cx);
      path.y.push_back(cy);
    }
    return path;
  };

  for (size_t r = 0; r < gr; ++r) {
    for (size_t c = 0; c < gc; ++c) {
      if (taken[r * gc + c]) continue;
      const double sx = x0 + (static_cast<double>(c) + 0.5) / static_cast<double>(gc) * (x1 - x0);
      const double sy = y0 + (static_cast<double>(r) + 0.5) / static_cast<double>(gr) * (y1 - y0);
      double su = 0.0;
      double sv = 0.0;
      if (!sample(sx, sy, su, sv)) continue;
      std::vector<size_t> claim{r * gc + c};
      const Path forward = trace(sx, sy, 1.0, claim);
      const Path backward = trace(sx, sy, -1.0, claim);

      Streamline line;
      for (size_t i = backward.x.size(); i-- > 1;) {
        line.x.push_back(backward.x[i]);
        line.y.push_back(backward.y[i]);
      }
      line.x.insert(line.x.end(), forward.x.begin(), forward.x.end());
      line.y.insert(line.y.end(), forward.y.begin(), forward.y.end());
      if (line.x.size() < 3) continue;
      for (const size_t cell : claim) taken[cell] = 1;
      double total = 0.0;
      size_t n = 0;
      for (const double s : backward.speeds) {
        total += s;
        ++n;
      }
      for (const double s : forward.speeds) {
        total += s;
        ++n;
      }
      line.speed = n ? total / static_cast<double>(n) : 0.0;
      out.push_back(std::move(line));
    }
  }
  return out;
}

FieldRing segment_quad(double ax, double ay, double bx, double by, double width) {
  const double dx = bx - ax;
  const double dy = by - ay;
  const double m = std::hypot(dx, dy) == 0.0 ? 1e-12 : std::hypot(dx, dy);
  const double nx = -dy / m * width / 2.0;
  const double ny = dx / m * width / 2.0;
  FieldRing ring;
  ring.x = {ax + nx, bx + nx, bx - nx, ax - nx};
  ring.y = {ay + ny, by + ny, by - ny, ay - ny};
  return ring;
}

Barbs barbs(const double* x, const double* y, const double* u, const double* v, size_t count,
            double increment, double length, double width) {
  Barbs out;
  if (!x || !y || !u || !v || count == 0) return out;
  const double inc = increment > 0.0 ? increment : 5.0;

  double xlo = std::numeric_limits<double>::infinity();
  double xhi = -xlo;
  for (size_t i = 0; i < count; ++i) {
    xlo = std::min(xlo, x[i]);
    xhi = std::max(xhi, x[i]);
  }
  double len = length;
  if (!(len > 0.0)) len = (std::isfinite(xhi - xlo) && xhi > xlo) ? (xhi - xlo) / 12.0 : 1.0;
  const double stroke = width > 0.0 ? width : len * 0.06;
  const double tick = len * 0.42;

  for (size_t i = 0; i < count; ++i) {
    const double px = x[i];
    const double py = y[i];
    const double speed = std::hypot(u[i], v[i]);
    if (!std::isfinite(speed)) continue;
    if (speed < inc / 2.0) {
      // Calm. matplotlib draws a small open circle; a short cross reads the
      // same at this size and needs no curve.
      out.strokes.push_back(segment_quad(px - tick * 0.2, py, px + tick * 0.2, py, stroke));
      out.strokes.push_back(segment_quad(px, py - tick * 0.2, px, py + tick * 0.2, stroke));
      continue;
    }
    // The staff points *into* the wind, as the convention requires.
    const double dx = -u[i] / speed;
    const double dy = -v[i] / speed;
    const double tip_x = px + dx * len;
    const double tip_y = py + dy * len;
    out.strokes.push_back(segment_quad(px, py, tip_x, tip_y, stroke));

    // The ticks hang off the tip end, sixty degrees back along the staff.
    const double bx = -dx * std::cos(kPi / 3.0) - dy * std::sin(kPi / 3.0);
    const double by = -dy * std::cos(kPi / 3.0) + dx * std::sin(kPi / 3.0);

    int left = static_cast<int>(std::lround(speed / inc));
    double slot = 0.0;
    const double spacing = len * 0.16;
    const auto anchor_x = [&](double k) { return tip_x - dx * spacing * k; };
    const auto anchor_y = [&](double k) { return tip_y - dy * spacing * k; };

    while (left >= 10) {
      FieldRing pennant;
      pennant.x = {anchor_x(slot), anchor_x(slot) + bx * tick, anchor_x(slot + 1.0)};
      pennant.y = {anchor_y(slot), anchor_y(slot) + by * tick, anchor_y(slot + 1.0)};
      out.pennants.push_back(std::move(pennant));
      left -= 10;
      slot += 1.4;
    }
    while (left >= 2) {
      out.strokes.push_back(segment_quad(anchor_x(slot), anchor_y(slot),
                                         anchor_x(slot) + bx * tick, anchor_y(slot) + by * tick,
                                         stroke));
      left -= 2;
      slot += 1.0;
    }
    if (left >= 1) {
      // A lone half-barb sits one slot in, so it is never read as a full one.
      const double k = slot == 0.0 ? 1.0 : slot;
      out.strokes.push_back(segment_quad(anchor_x(k), anchor_y(k), anchor_x(k) + bx * tick * 0.5,
                                         anchor_y(k) + by * tick * 0.5, stroke));
    }
  }
  return out;
}

}  // namespace photon::charts
