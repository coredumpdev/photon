#include "charts/diagrams.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

namespace photon::charts {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kDeg = kPi / 180.0;

/// Worst aspect ratio of a row of areas laid across a strip of thickness `w`.
double worst(const std::vector<double>& row, double w, double sum) {
  if (row.empty() || w == 0.0) return std::numeric_limits<double>::infinity();
  double max = -std::numeric_limits<double>::infinity();
  double min = std::numeric_limits<double>::infinity();
  for (const double a : row) {
    max = std::max(max, a);
    min = std::min(min, a);
  }
  const double s2 = sum * sum;
  const double w2 = w * w;
  return std::max((w2 * max) / s2, s2 / (w2 * min));
}

/// A cubic bezier at `t` over four scalar controls.
double cubic(double t, double a, double b, double c, double d) {
  const double u = 1.0 - t;
  return u * u * u * a + 3.0 * u * u * t * b + 3.0 * u * t * t * c + t * t * t * d;
}

/// A quadratic bezier at `t` over three scalar controls.
double quad(double t, double a, double b, double c) {
  const double u = 1.0 - t;
  return u * u * a + 2.0 * u * t * b + t * t * c;
}

}  // namespace

std::vector<TreemapCell> treemap_layout(const double* values, size_t count, double x0, double y0,
                                        double x1, double y1) {
  std::vector<TreemapCell> cells;
  if (!values) return cells;

  // Only positive values take space; the index each survivor came from is kept
  // so the caller's labels and colours still line up.
  std::vector<size_t> order;
  order.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    if (values[i] > 0.0) order.push_back(i);
  }
  if (order.empty()) return cells;
  // Squarify assumes descending order. Stable, so equal values keep input order
  // and two runs of the same data draw the same picture.
  std::stable_sort(order.begin(), order.end(),
                   [values](size_t a, size_t b) { return values[a] > values[b]; });

  double total = 0.0;
  for (const size_t i : order) total += values[i];
  const double total_area = std::abs(x1 - x0) * std::abs(y1 - y0);
  std::vector<double> areas;
  areas.reserve(order.size());
  for (const size_t i : order) areas.push_back((values[i] / total) * total_area);

  size_t pos = 0;
  const auto layout_row = [&](const std::vector<double>& row, size_t start) {
    const double row_sum = std::accumulate(row.begin(), row.end(), 0.0);
    const double w = std::min(std::abs(x1 - x0), std::abs(y1 - y0));
    if (row_sum == 0.0 || w == 0.0) return;
    const bool horizontal = std::abs(y1 - y0) < std::abs(x1 - x0);
    if (horizontal) {
      // The row runs down the left edge, its thickness along x.
      const double row_w = row_sum / std::abs(y1 - y0);
      double cy = y0;
      for (size_t k = 0; k < row.size(); ++k) {
        const double h = (row[k] / row_sum) * std::abs(y1 - y0);
        cells.push_back(TreemapCell{order[start + k], x0, cy, x0 + row_w, cy + h});
        cy += h;
      }
      x0 += row_w;
    } else {
      const double row_h = row_sum / std::abs(x1 - x0);
      double cx = x0;
      for (size_t k = 0; k < row.size(); ++k) {
        const double width = (row[k] / row_sum) * std::abs(x1 - x0);
        cells.push_back(TreemapCell{order[start + k], cx, y0, cx + width, y0 + row_h});
        cx += width;
      }
      y0 += row_h;
    }
  };

  while (pos < areas.size()) {
    const double w = std::min(std::abs(x1 - x0), std::abs(y1 - y0));
    std::vector<double> row;
    double row_sum = 0.0;
    const size_t start = pos;
    // Grow the row while doing so improves — lowers — the worst aspect ratio.
    while (pos < areas.size()) {
      const double a = areas[pos];
      std::vector<double> with_new = row;
      with_new.push_back(a);
      if (!row.empty() && worst(with_new, w, row_sum + a) > worst(row, w, row_sum)) break;
      row.push_back(a);
      row_sum += a;
      ++pos;
    }
    layout_row(row, start);
  }
  return cells;
}

std::vector<Ring> funnel_layout(const double* values, size_t count, double width, double height,
                                double neck) {
  std::vector<Ring> stages;
  if (!values || count == 0) return stages;
  double max_v = 0.0;
  for (size_t i = 0; i < count; ++i) max_v = std::max(max_v, values[i]);
  if (max_v == 0.0) max_v = 1.0;
  const auto half_w = [&](size_t i) {
    return (std::max(0.0, values[i]) / max_v) * width * 0.5;
  };

  const double stage_h = height / static_cast<double>(count);
  stages.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    const double top = height - static_cast<double>(i) * stage_h;
    const double bot = height - static_cast<double>(i + 1) * stage_h;
    const double w_top = half_w(i);
    const double w_bot = i + 1 < count ? half_w(i + 1) : w_top * neck;
    Ring r;
    r.x = {-w_top, w_top, w_bot, -w_bot};
    r.y = {top, top, bot, bot};
    stages.push_back(std::move(r));
  }
  return stages;
}

Ring arc_ring(double a0, double a1, double r0, double r1) {
  Ring ring;
  const double step = kPi / 90.0;  // about two degrees
  const int segs = std::max(1, static_cast<int>(std::ceil(std::abs(a1 - a0) / step)));
  ring.x.reserve(static_cast<size_t>(segs + 1) * 2);
  ring.y.reserve(static_cast<size_t>(segs + 1) * 2);
  for (int s = 0; s <= segs; ++s) {
    const double t = a0 + (a1 - a0) * static_cast<double>(s) / segs;
    ring.x.push_back(r1 * std::cos(t));
    ring.y.push_back(r1 * std::sin(t));
  }
  for (int s = segs; s >= 0; --s) {
    const double t = a0 + (a1 - a0) * static_cast<double>(s) / segs;
    ring.x.push_back(r0 * std::cos(t));
    ring.y.push_back(r0 * std::sin(t));
  }
  return ring;
}

std::vector<SunburstArc> sunburst_layout(const SunburstNode* nodes, size_t count,
                                         double ring_width, double center, double start_angle) {
  std::vector<SunburstArc> arcs;
  if (!nodes || count == 0) return arcs;

  // Roll leaf values up. Children follow their parent, so one reverse pass over
  // the array is enough — no recursion, and no stack for a deep hierarchy.
  std::vector<double> total(count, 0.0);
  std::vector<size_t> child_count(count, 0);
  for (size_t i = 0; i < count; ++i) {
    if (nodes[i].parent >= 0 && static_cast<size_t>(nodes[i].parent) < count) {
      ++child_count[static_cast<size_t>(nodes[i].parent)];
    }
  }
  for (size_t i = count; i-- > 0;) {
    if (child_count[i] == 0) total[i] = std::max(0.0, nodes[i].value);
    if (nodes[i].parent >= 0 && static_cast<size_t>(nodes[i].parent) < count) {
      total[static_cast<size_t>(nodes[i].parent)] += total[i];
    }
  }

  std::vector<size_t> depth(count, 0);
  std::vector<double> a0(count, 0.0);
  std::vector<double> a1(count, 0.0);
  std::vector<double> cursor(count, 0.0);
  arcs.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    const int parent = nodes[i].parent;
    if (parent < 0 || static_cast<size_t>(parent) >= count) {
      depth[i] = 0;
      a0[i] = start_angle;
      a1[i] = start_angle + kTwoPi;
    } else {
      const size_t p = static_cast<size_t>(parent);
      depth[i] = depth[p] + 1;
      const double parent_total = total[p] > 0.0 ? total[p] : 1.0;
      const double span = (a1[p] - a0[p]) * total[i] / parent_total;
      a0[i] = cursor[p];
      a1[i] = cursor[p] + span;
      cursor[p] = a1[i];
    }
    // Seeded here rather than lazily on first use: a sibling's arc can
    // legitimately end at angle zero, and a "not started yet" test against zero
    // would restart the whole ring when it did.
    cursor[i] = a0[i];
    const double r0 = center + static_cast<double>(depth[i]) * ring_width;
    arcs.push_back(SunburstArc{i, depth[i], a0[i], a1[i], r0, r0 + ring_width});
  }
  return arcs;
}

SankeyLayout sankey_layout(size_t node_count, const SankeyLink* links, size_t link_count,
                           double x0, double y0, double x1, double y1, double node_width,
                           double node_padding) {
  SankeyLayout out;
  if (node_count == 0) return out;
  if (!links) link_count = 0;
  const double y_height = y1 - y0;
  const double pad = node_padding * y_height;

  const auto in_range = [&](int i) { return i >= 0 && static_cast<size_t>(i) < node_count; };

  // Layer assignment: the longest path from a source, relaxed at most n times
  // so a cycle costs a bounded number of passes rather than hanging.
  std::vector<int> layer(node_count, 0);
  for (size_t iter = 0; iter < node_count; ++iter) {
    bool changed = false;
    for (size_t k = 0; k < link_count; ++k) {
      const SankeyLink& l = links[k];
      if (!in_range(l.source) || !in_range(l.target)) continue;
      if (layer[static_cast<size_t>(l.target)] < layer[static_cast<size_t>(l.source)] + 1) {
        layer[static_cast<size_t>(l.target)] = layer[static_cast<size_t>(l.source)] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const size_t layers = static_cast<size_t>(*std::max_element(layer.begin(), layer.end())) + 1;

  std::vector<double> in_sum(node_count, 0.0);
  std::vector<double> out_sum(node_count, 0.0);
  for (size_t k = 0; k < link_count; ++k) {
    const SankeyLink& l = links[k];
    if (!in_range(l.source) || !in_range(l.target)) continue;
    const double v = std::max(0.0, l.value);
    out_sum[static_cast<size_t>(l.source)] += v;
    in_sum[static_cast<size_t>(l.target)] += v;
  }
  std::vector<double> flow(node_count, 0.0);
  for (size_t i = 0; i < node_count; ++i) flow[i] = std::max(in_sum[i], out_sum[i]);

  std::vector<std::vector<size_t>> columns(layers);
  for (size_t i = 0; i < node_count; ++i) columns[static_cast<size_t>(layer[i])].push_back(i);

  // One value-to-height scale for the whole diagram, set by the tallest column.
  double k_scale = std::numeric_limits<double>::infinity();
  for (const std::vector<size_t>& col : columns) {
    double sum = 0.0;
    for (const size_t i : col) sum += flow[i];
    const double avail = y_height - static_cast<double>(col.size() - 1) * pad;
    if (sum > 0.0 && avail > 0.0) k_scale = std::min(k_scale, avail / sum);
  }
  if (!std::isfinite(k_scale) || k_scale <= 0.0) k_scale = 0.0;

  std::vector<NodeRect> rect_of(node_count);
  std::vector<bool> placed(node_count, false);
  for (size_t li = 0; li < layers; ++li) {
    const std::vector<size_t>& col = columns[li];
    const double frac =
        layers > 1 ? static_cast<double>(li) / static_cast<double>(layers - 1) : 0.5;
    const double cx = x0 + (x1 - x0 - node_width) * frac;
    double col_h = static_cast<double>(col.size() - 1) * pad;
    for (const size_t i : col) col_h += k_scale * flow[i];
    double depth = std::max(0.0, (y_height - col_h) / 2.0);
    for (const size_t i : col) {
      const double h = k_scale * flow[i];
      const double top = y1 - depth;
      NodeRect r{i, cx, top - h, cx + node_width, top};
      out.nodes.push_back(r);
      rect_of[i] = r;
      placed[i] = true;
      depth += h + pad;
    }
  }

  constexpr int kRibbonSamples = 20;
  std::vector<double> src_off(node_count, 0.0);
  std::vector<double> tgt_off(node_count, 0.0);
  for (size_t k = 0; k < link_count; ++k) {
    const SankeyLink& l = links[k];
    if (!in_range(l.source) || !in_range(l.target)) continue;
    if (!placed[static_cast<size_t>(l.source)] || !placed[static_cast<size_t>(l.target)]) continue;
    const NodeRect& sr = rect_of[static_cast<size_t>(l.source)];
    const NodeRect& tr = rect_of[static_cast<size_t>(l.target)];
    const double thick = k_scale * std::max(0.0, l.value);
    const double s_top = sr.y1 - src_off[static_cast<size_t>(l.source)];
    src_off[static_cast<size_t>(l.source)] += thick;
    const double t_top = tr.y1 - tgt_off[static_cast<size_t>(l.target)];
    tgt_off[static_cast<size_t>(l.target)] += thick;
    const double s_bot = s_top - thick;
    const double t_bot = t_top - thick;
    const double sx = sr.x1;
    const double tx = tr.x0;
    const double mx = (sx + tx) / 2.0;

    Ring ring;
    ring.x.reserve(static_cast<size_t>(kRibbonSamples + 1) * 2);
    ring.y.reserve(static_cast<size_t>(kRibbonSamples + 1) * 2);
    for (int s = 0; s <= kRibbonSamples; ++s) {
      const double t = static_cast<double>(s) / kRibbonSamples;
      ring.x.push_back(cubic(t, sx, mx, mx, tx));
      ring.y.push_back(cubic(t, s_top, s_top, t_top, t_top));
    }
    for (int s = 0; s <= kRibbonSamples; ++s) {
      const double t = static_cast<double>(s) / kRibbonSamples;
      ring.x.push_back(cubic(t, tx, mx, mx, sx));
      ring.y.push_back(cubic(t, t_bot, t_bot, s_bot, s_bot));
    }
    out.ribbons.push_back(std::move(ring));
    out.ribbon_link.push_back(k);
  }
  return out;
}

ChordLayout chord_layout(const double* matrix, size_t n, double radius, double pad_angle,
                         double arc_width, int samples) {
  ChordLayout out;
  if (!matrix || n == 0) return out;
  const double width = arc_width * radius;
  const int segs = std::max(2, samples);
  const double inner = radius - width;

  std::vector<double> row_sums(n, 0.0);
  double total = 0.0;
  for (size_t i = 0; i < n; ++i) {
    for (size_t j = 0; j < n; ++j) row_sums[i] += std::max(0.0, matrix[i * n + j]);
    total += row_sums[i];
  }
  if (total <= 0.0) return out;

  const double gaps = std::min(pad_angle, 0.9 * kTwoPi);
  const double usable = kTwoPi - gaps;
  const double gap = gaps / static_cast<double>(n);

  std::vector<double> group_start(n, 0.0);
  std::vector<double> group_end(n, 0.0);
  std::vector<double> sub_start(n * n, 0.0);
  std::vector<double> sub_end(n * n, 0.0);
  double angle = 0.0;
  out.group_mid.resize(n);
  for (size_t i = 0; i < n; ++i) {
    group_start[i] = angle;
    double a = angle;
    for (size_t j = 0; j < n; ++j) {
      const double w = std::max(0.0, matrix[i * n + j]);
      const double span = (w / total) * usable;
      sub_start[i * n + j] = a;
      sub_end[i * n + j] = a + span;
      a += span;
    }
    group_end[i] = a;
    out.group_mid[i] = (group_start[i] + group_end[i]) / 2.0;
    angle = a + gap;
  }

  for (size_t i = 0; i < n; ++i) {
    if (group_end[i] <= group_start[i]) continue;
    Ring ring;
    for (int s = 0; s <= segs; ++s) {
      const double t = group_start[i] + (group_end[i] - group_start[i]) * s / segs;
      ring.x.push_back(radius * std::cos(t));
      ring.y.push_back(radius * std::sin(t));
    }
    for (int s = segs; s >= 0; --s) {
      const double t = group_start[i] + (group_end[i] - group_start[i]) * s / segs;
      ring.x.push_back(inner * std::cos(t));
      ring.y.push_back(inner * std::sin(t));
    }
    out.arcs.push_back(std::move(ring));
    out.arc_group.push_back(i);
  }

  // One ribbon per unordered pair, so a chord is drawn once rather than twice.
  for (size_t i = 0; i < n; ++i) {
    for (size_t j = i; j < n; ++j) {
      const double wij = std::max(0.0, matrix[i * n + j]);
      const double wji = std::max(0.0, matrix[j * n + i]);
      if (wij <= 0.0 && wji <= 0.0) continue;
      const double ia0 = sub_start[i * n + j];
      const double ia1 = sub_end[i * n + j];
      const double ja0 = sub_start[j * n + i];
      const double ja1 = sub_end[j * n + i];
      Ring ring;
      for (int s = 0; s <= segs; ++s) {
        const double t = ia0 + (ia1 - ia0) * s / segs;
        ring.x.push_back(inner * std::cos(t));
        ring.y.push_back(inner * std::sin(t));
      }
      // Through the centre, which is what makes a chord read as a connection
      // rather than as a second arc.
      for (int s = 1; s <= segs; ++s) {
        const double t = static_cast<double>(s) / segs;
        ring.x.push_back(quad(t, inner * std::cos(ia1), 0.0, inner * std::cos(ja0)));
        ring.y.push_back(quad(t, inner * std::sin(ia1), 0.0, inner * std::sin(ja0)));
      }
      for (int s = 0; s <= segs; ++s) {
        const double t = ja0 + (ja1 - ja0) * s / segs;
        ring.x.push_back(inner * std::cos(t));
        ring.y.push_back(inner * std::sin(t));
      }
      for (int s = 1; s <= segs; ++s) {
        const double t = static_cast<double>(s) / segs;
        ring.x.push_back(quad(t, inner * std::cos(ja1), 0.0, inner * std::cos(ia0)));
        ring.y.push_back(quad(t, inner * std::sin(ja1), 0.0, inner * std::sin(ia0)));
      }
      out.ribbons.push_back(std::move(ring));
      out.ribbon_from.push_back(i);
      out.ribbon_to.push_back(j);
    }
  }
  return out;
}

GaugeLayout gauge_layout(double value, double min, double max, double start_angle,
                         double end_angle, double radius, double inner_radius) {
  const double a0 = start_angle * kDeg;
  const double a1 = end_angle * kDeg;
  double span = max - min;
  if (span == 0.0) span = 1.0;
  const double t = std::min(1.0, std::max(0.0, (value - min) / span));
  const double a_val = a0 + (a1 - a0) * t;

  GaugeLayout out;
  out.track = arc_ring(a0, a1, inner_radius, radius);
  out.value = arc_ring(a0, a_val, inner_radius, radius);

  // The needle is a thin triangle from the hub to the value angle.
  const double len = radius * 0.95;
  const double hw = (radius - inner_radius) * 0.12;
  const double px = std::cos(a_val + kPi / 2.0);
  const double py = std::sin(a_val + kPi / 2.0);
  out.needle.x = {len * std::cos(a_val), hw * px, -hw * px};
  out.needle.y = {len * std::sin(a_val), hw * py, -hw * py};
  return out;
}

ParallelLayout parallel_layout(const double* rows, size_t row_count, size_t dims) {
  ParallelLayout out;
  if (dims == 0) return out;
  out.min.assign(dims, std::numeric_limits<double>::infinity());
  out.max.assign(dims, -std::numeric_limits<double>::infinity());
  if (!rows) row_count = 0;
  for (size_t r = 0; r < row_count; ++r) {
    for (size_t i = 0; i < dims; ++i) {
      const double v = rows[r * dims + i];
      if (!std::isfinite(v)) continue;
      out.min[i] = std::min(out.min[i], v);
      out.max[i] = std::max(out.max[i], v);
    }
  }
  // A dimension with no finite value collapses to 0..1, so normalising stays
  // finite rather than producing NaN for every row.
  for (size_t i = 0; i < dims; ++i) {
    if (!std::isfinite(out.min[i])) {
      out.min[i] = 0.0;
      out.max[i] = 1.0;
    }
  }

  out.lines.reserve(row_count);
  for (size_t r = 0; r < row_count; ++r) {
    std::vector<double> y(dims, 0.5);
    for (size_t i = 0; i < dims; ++i) {
      const double span = out.max[i] - out.min[i];
      const double v = rows[r * dims + i];
      y[i] = (!std::isfinite(v) || span == 0.0) ? 0.5 : (v - out.min[i]) / span;
    }
    out.lines.push_back(std::move(y));
  }
  return out;
}

}  // namespace photon::charts
