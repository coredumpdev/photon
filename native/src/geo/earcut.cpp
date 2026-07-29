#include "geo/earcut.hpp"

#include <algorithm>
#include <cmath>
#include <deque>
#include <limits>

namespace photon::geo {
namespace {

/// Below this vertex count, plain O(n^2) clipping is cheaper than hashing.
constexpr int kZOrderThreshold = 80;

struct Node {
  Node(uint32_t index, double px, double py) : i(index), x(px), y(py) {}

  uint32_t i;
  double x;
  double y;
  Node* prev = nullptr;
  Node* next = nullptr;
  bool steiner = false;
  /// Morton (z-order) code; 0 until index_curve() assigns it.
  uint32_t z = 0;
  /// Neighbours in the z-order-sorted list; null outside the hashed path.
  Node* prev_z = nullptr;
  Node* next_z = nullptr;
};

/// Signed area of triangle (p,q,r) x 2; < 0 for clockwise.
double area(const Node* p, const Node* q, const Node* r) {
  return (q->y - p->y) * (r->x - q->x) - (q->x - p->x) * (r->y - q->y);
}

bool equals(const Node* a, const Node* b) {
  return a->x == b->x && a->y == b->y;
}

bool point_in_triangle(double ax, double ay, double bx, double by, double cx, double cy, double px,
                       double py) {
  return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0.0 &&
         (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0.0 &&
         (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0.0;
}

bool on_segment(const Node* p, const Node* q, const Node* r) {
  return q->x <= std::max(p->x, r->x) && q->x >= std::min(p->x, r->x) &&
         q->y <= std::max(p->y, r->y) && q->y >= std::min(p->y, r->y);
}

int sign_of(double n) {
  return n > 0.0 ? 1 : (n < 0.0 ? -1 : 0);
}

/// Do segments p1q1 and p2q2 properly (or collinearly) intersect?
bool intersects(const Node* p1, const Node* q1, const Node* p2, const Node* q2) {
  const int o1 = sign_of(area(p1, q1, p2));
  const int o2 = sign_of(area(p1, q1, q2));
  const int o3 = sign_of(area(p2, q2, p1));
  const int o4 = sign_of(area(p2, q2, q1));
  if (o1 != o2 && o3 != o4) return true;
  if (o1 == 0 && on_segment(p1, p2, q1)) return true;
  if (o2 == 0 && on_segment(p1, q2, q1)) return true;
  if (o3 == 0 && on_segment(p2, p1, q2)) return true;
  if (o4 == 0 && on_segment(p2, q1, q2)) return true;
  return false;
}

/// Is a->b inside the polygon corner at a?
bool locally_inside(const Node* a, const Node* b) {
  return area(a->prev, a, a->next) < 0.0
             ? area(a, b, a->next) >= 0.0 && area(a, a->prev, b) >= 0.0
             : area(a, b, a->prev) < 0.0 || area(a, a->next, b) < 0.0;
}

/// Does the midpoint of a->b lie inside the polygon?
bool middle_inside(const Node* a, const Node* b) {
  const Node* p = a;
  bool inside = false;
  const double px = (a->x + b->x) / 2.0;
  const double py = (a->y + b->y) / 2.0;
  do {
    if (((p->y > py) != (p->next->y > py)) && p->next->y != p->y &&
        px < (p->next->x - p->x) * (py - p->y) / (p->next->y - p->y) + p->x) {
      inside = !inside;
    }
    p = p->next;
  } while (p != a);
  return inside;
}

/// Does diagonal a->b cross any polygon edge?
bool intersects_polygon(const Node* a, const Node* b) {
  const Node* p = a;
  do {
    if (p->i != a->i && p->next->i != a->i && p->i != b->i && p->next->i != b->i &&
        intersects(p, p->next, a, b)) {
      return true;
    }
    p = p->next;
  } while (p != a);
  return false;
}

/// Is the diagonal a->b a valid, interior, non-crossing split?
bool is_valid_diagonal(const Node* a, const Node* b) {
  return a->next->i != b->i && a->prev->i != b->i && !intersects_polygon(a, b) &&
         ((locally_inside(a, b) && locally_inside(b, a) && middle_inside(a, b) &&
           (area(a->prev, a, b->prev) != 0.0 || area(a, b->prev, b) != 0.0)) ||
          (equals(a, b) && area(a->prev, a, a->next) > 0.0 && area(b->prev, b, b->next) > 0.0));
}

bool sector_contains_sector(const Node* m, const Node* p) {
  return area(m->prev, m, p->prev) < 0.0 && area(p->next, m, m->next) < 0.0;
}

void remove_node(Node* p) {
  p->next->prev = p->prev;
  p->prev->next = p->next;
  // Keep the z-order list consistent when hashing is in effect.
  if (p->prev_z) p->prev_z->next_z = p->next_z;
  if (p->next_z) p->next_z->prev_z = p->prev_z;
}

Node* get_leftmost(Node* start) {
  Node* p = start;
  Node* leftmost = start;
  do {
    if (p->x < leftmost->x || (p->x == leftmost->x && p->y < leftmost->y)) leftmost = p;
    p = p->next;
  } while (p != start);
  return leftmost;
}

/// Signed area of a raw coordinate range, used to detect winding.
double ring_area(const std::vector<double>& data, size_t start, size_t end, size_t step) {
  double sum = 0.0;
  for (size_t i = start, j = end - step; i < end; i += step) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

/**
 * Interleave the bits of the 15-bit grid coordinates into a 32-bit Morton code,
 * so numerically close codes correspond to spatially close points.
 */
uint32_t z_order(double x, double y, double min_x, double min_y, double inv_size) {
  uint32_t ix = static_cast<uint32_t>(static_cast<int32_t>((x - min_x) * inv_size));
  uint32_t iy = static_cast<uint32_t>(static_cast<int32_t>((y - min_y) * inv_size));

  ix = (ix | (ix << 8)) & 0x00ff00ffu;
  ix = (ix | (ix << 4)) & 0x0f0f0f0fu;
  ix = (ix | (ix << 2)) & 0x33333333u;
  ix = (ix | (ix << 1)) & 0x55555555u;

  iy = (iy | (iy << 8)) & 0x00ff00ffu;
  iy = (iy | (iy << 4)) & 0x0f0f0f0fu;
  iy = (iy | (iy << 2)) & 0x33333333u;
  iy = (iy | (iy << 1)) & 0x55555555u;

  return ix | (iy << 1);
}

/**
 * The triangulation, and the arena its nodes live in.
 *
 * A class only because the node storage has to outlive every function holding a
 * pointer into it — the TypeScript leaves that to the garbage collector.
 */
class Earcut {
 public:
  std::vector<uint32_t> run(const std::vector<double>& data,
                            const std::vector<uint32_t>& hole_indices, size_t step);

 private:
  Node* create(uint32_t i, double x, double y) {
    nodes_.emplace_back(i, x, y);
    return &nodes_.back();
  }

  Node* insert_node(uint32_t i, double x, double y, Node* last);
  Node* linked_list(const std::vector<double>& data, size_t start, size_t end, size_t step,
                    bool clockwise);
  Node* filter_points(Node* start, Node* end = nullptr);
  void earcut_linked(Node* ear, uint32_t step, double min_x, double min_y, double inv_size,
                     int pass);
  bool is_ear(const Node* ear) const;
  bool is_ear_hashed(const Node* ear, double min_x, double min_y, double inv_size) const;
  Node* eliminate_holes(const std::vector<double>& data,
                        const std::vector<uint32_t>& hole_indices, Node* outer, size_t step);
  Node* eliminate_hole(Node* hole, Node* outer);
  Node* find_hole_bridge(Node* hole, Node* outer);
  Node* cure_local_intersections(Node* start, uint32_t step);
  void split_earcut(Node* start, uint32_t step, double min_x, double min_y, double inv_size);
  Node* split_polygon(Node* a, Node* b);
  static void index_curve(Node* start, double min_x, double min_y, double inv_size);
  static void sort_linked(Node* list);

  /// Deque, not vector: nodes are created while pointers into the storage are
  /// live, and a vector would move them out from under the algorithm.
  std::deque<Node> nodes_;
  std::vector<uint32_t> triangles_;
};

Node* Earcut::insert_node(uint32_t i, double x, double y, Node* last) {
  Node* p = create(i, x, y);
  if (!last) {
    p->prev = p;
    p->next = p;
  } else {
    p->next = last->next;
    p->prev = last;
    last->next->prev = p;
    last->next = p;
  }
  return p;
}

Node* Earcut::split_polygon(Node* a, Node* b) {
  Node* a2 = create(a->i, a->x, a->y);
  Node* b2 = create(b->i, b->x, b->y);
  Node* an = a->next;
  Node* bp = b->prev;
  a->next = b;
  b->prev = a;
  a2->next = an;
  an->prev = a2;
  b2->next = a2;
  a2->prev = b2;
  bp->next = b2;
  b2->prev = bp;
  return b2;
}

/// Build a circular doubly-linked list from a ring; enforce the given winding.
Node* Earcut::linked_list(const std::vector<double>& data, size_t start, size_t end, size_t step,
                          bool clockwise) {
  if (end <= start) return nullptr;
  Node* last = nullptr;
  if (clockwise == (ring_area(data, start, end, step) > 0.0)) {
    for (size_t i = start; i < end; i += step) {
      last = insert_node(static_cast<uint32_t>(i), data[i], data[i + 1], last);
    }
  } else {
    // Counting down from `end` rather than up, and with size_t rather than a
    // signed index, so the loop terminates at `start` instead of wrapping.
    for (size_t i = end; i > start; i -= step) {
      const size_t k = i - step;
      last = insert_node(static_cast<uint32_t>(k), data[k], data[k + 1], last);
    }
  }
  if (last && equals(last, last->next)) {
    remove_node(last);
    last = last->next;
  }
  return last;
}

/// Remove collinear or duplicate nodes between `start` and `end`.
Node* Earcut::filter_points(Node* start, Node* end) {
  if (!start) return start;
  Node* e = end ? end : start;
  Node* p = start;
  bool again = false;
  do {
    again = false;
    if (!p->steiner && (equals(p, p->next) || area(p->prev, p, p->next) == 0.0)) {
      remove_node(p);
      p = e = p->prev;
      if (p == p->next) break;
      again = true;
    } else {
      p = p->next;
    }
  } while (again || p != e);
  return e;
}

bool Earcut::is_ear(const Node* ear) const {
  const Node* a = ear->prev;
  const Node* b = ear;
  const Node* c = ear->next;
  if (area(a, b, c) >= 0.0) return false;  // reflex or collinear — not an ear tip
  const Node* p = ear->next->next;
  while (p != ear->prev) {
    if (point_in_triangle(a->x, a->y, b->x, b->y, c->x, c->y, p->x, p->y) &&
        area(p->prev, p, p->next) >= 0.0) {
      return false;
    }
    p = p->next;
  }
  return true;
}

/**
 * The z-order-accelerated ear test: instead of scanning every other vertex,
 * only visit points whose Morton code lies within the ear triangle's
 * bounding-box z-range, walking outward along the z-linked list in both
 * directions from the ear.
 */
bool Earcut::is_ear_hashed(const Node* ear, double min_x, double min_y, double inv_size) const {
  const Node* a = ear->prev;
  const Node* b = ear;
  const Node* c = ear->next;
  if (area(a, b, c) >= 0.0) return false;  // reflex or collinear — not an ear tip

  const double ax = a->x, bx = b->x, cx = c->x;
  const double ay = a->y, by = b->y, cy = c->y;
  const double x0 = std::min({ax, bx, cx});
  const double y0 = std::min({ay, by, cy});
  const double x1 = std::max({ax, bx, cx});
  const double y1 = std::max({ay, by, cy});

  const uint32_t min_z = z_order(x0, y0, min_x, min_y, inv_size);
  const uint32_t max_z = z_order(x1, y1, min_x, min_y, inv_size);

  const auto blocks = [&](const Node* q) {
    return q->x >= x0 && q->x <= x1 && q->y >= y0 && q->y <= y1 && q != a && q != c &&
           point_in_triangle(ax, ay, bx, by, cx, cy, q->x, q->y) &&
           area(q->prev, q, q->next) >= 0.0;
  };

  const Node* p = ear->prev_z;
  const Node* n = ear->next_z;

  // Walk both directions while both stay inside the z-range.
  while (p && p->z >= min_z && n && n->z <= max_z) {
    if (blocks(p)) return false;
    p = p->prev_z;
    if (blocks(n)) return false;
    n = n->next_z;
  }
  while (p && p->z >= min_z) {
    if (blocks(p)) return false;
    p = p->prev_z;
  }
  while (n && n->z <= max_z) {
    if (blocks(n)) return false;
    n = n->next_z;
  }
  return true;
}

/// Find a mutually-visible outer-ring vertex to bridge a hole to.
Node* Earcut::find_hole_bridge(Node* hole, Node* outer) {
  Node* p = outer;
  const double hx = hole->x;
  const double hy = hole->y;
  double qx = -std::numeric_limits<double>::infinity();
  Node* m = nullptr;

  // Cast a ray to the left; find the outer edge it hits closest to the hole.
  do {
    if (hy <= p->y && hy >= p->next->y && p->next->y != p->y) {
      const double x = p->x + (hy - p->y) / (p->next->y - p->y) * (p->next->x - p->x);
      if (x <= hx && x > qx) {
        qx = x;
        m = p->x < p->next->x ? p : p->next;
        if (x == hx) return m;
      }
    }
    p = p->next;
  } while (p != outer);
  if (!m) return nullptr;

  // Refine: pick the reflex vertex inside the hole/edge triangle with the
  // smallest angle to the hole, which guarantees visibility.
  const Node* stop = m;
  const double mx = m->x;
  const double my = m->y;
  double tan_min = std::numeric_limits<double>::infinity();
  p = m;
  do {
    if (hx >= p->x && p->x >= mx && hx != p->x &&
        point_in_triangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p->x, p->y)) {
      const double tangent = std::abs(hy - p->y) / (hx - p->x);
      if (locally_inside(p, hole) &&
          (tangent < tan_min ||
           (tangent == tan_min &&
            (p->x > m->x || (p->x == m->x && sector_contains_sector(m, p)))))) {
        m = p;
        tan_min = tangent;
      }
    }
    p = p->next;
  } while (p != stop);
  return m;
}

Node* Earcut::eliminate_hole(Node* hole, Node* outer) {
  Node* bridge = find_hole_bridge(hole, outer);
  if (!bridge) return outer;
  Node* bridge_reverse = split_polygon(bridge, hole);
  filter_points(bridge_reverse, bridge_reverse->next);
  return filter_points(bridge, bridge->next);
}

/// Merge holes into the outer ring by cutting bridges, leftmost hole first.
Node* Earcut::eliminate_holes(const std::vector<double>& data,
                              const std::vector<uint32_t>& hole_indices, Node* outer,
                              size_t step) {
  std::vector<Node*> queue;
  const size_t count = hole_indices.size();
  for (size_t i = 0; i < count; ++i) {
    const size_t start = static_cast<size_t>(hole_indices[i]) * step;
    const size_t end =
        i + 1 < count ? static_cast<size_t>(hole_indices[i + 1]) * step : data.size();
    Node* list = linked_list(data, start, end, step, false);
    if (!list) continue;
    if (list == list->next) list->steiner = true;
    queue.push_back(get_leftmost(list));
  }
  std::sort(queue.begin(), queue.end(), [](const Node* a, const Node* b) { return a->x < b->x; });
  Node* node = outer;
  for (Node* hole : queue) node = eliminate_hole(hole, node);
  return node;
}

/// Clip away pairs of ears that form a self-intersection (repair pass).
Node* Earcut::cure_local_intersections(Node* start, uint32_t step) {
  Node* p = start;
  do {
    Node* a = p->prev;
    Node* b = p->next->next;
    if (!equals(a, b) && intersects(a, p, p->next, b) && locally_inside(a, b) &&
        locally_inside(b, a)) {
      triangles_.push_back(a->i / step);
      triangles_.push_back(p->i / step);
      triangles_.push_back(b->i / step);
      remove_node(p);
      remove_node(p->next);
      p = start = b;
    }
    p = p->next;
  } while (p != start);
  return filter_points(p);
}

/// Split the polygon by the first valid diagonal, then triangulate both halves.
void Earcut::split_earcut(Node* start, uint32_t step, double min_x, double min_y,
                          double inv_size) {
  Node* a = start;
  do {
    Node* b = a->next->next;
    while (b != a->prev) {
      if (a->i != b->i && is_valid_diagonal(a, b)) {
        Node* c = split_polygon(a, b);
        Node* a2 = filter_points(a, a->next);
        c = filter_points(c, c->next);
        earcut_linked(a2, step, min_x, min_y, inv_size, 0);
        earcut_linked(c, step, min_x, min_y, inv_size, 0);
        return;
      }
      b = b->next;
    }
    a = a->next;
  } while (a != start);
}

/// Main loop: clip ears off the linked list, escalating on failure.
void Earcut::earcut_linked(Node* ear_start, uint32_t step, double min_x, double min_y,
                           double inv_size, int pass) {
  if (!ear_start) return;
  Node* ear = ear_start;
  // Build the z-order index once, on the first pass over a big ring.
  if (pass == 0 && inv_size != 0.0) index_curve(ear, min_x, min_y, inv_size);
  Node* stop = ear_start;

  while (ear->prev != ear->next) {
    Node* prev = ear->prev;
    Node* next = ear->next;
    const bool found = inv_size != 0.0 ? is_ear_hashed(ear, min_x, min_y, inv_size) : is_ear(ear);
    if (found) {
      triangles_.push_back(prev->i / step);
      triangles_.push_back(ear->i / step);
      triangles_.push_back(next->i / step);
      remove_node(ear);
      ear = next->next;
      stop = next->next;
      continue;
    }
    ear = next;
    if (ear == stop) {
      // No ear found in a full pass — clean up and retry with more effort.
      if (pass == 0) {
        earcut_linked(filter_points(ear), step, min_x, min_y, inv_size, 1);
      } else if (pass == 1) {
        Node* cured = cure_local_intersections(filter_points(ear), step);
        earcut_linked(cured, step, min_x, min_y, inv_size, 2);
      } else if (pass == 2) {
        split_earcut(ear, step, min_x, min_y, inv_size);
      }
      break;
    }
  }
}

/// Assign a Morton code to every node and build the sorted z-linked list.
void Earcut::index_curve(Node* start, double min_x, double min_y, double inv_size) {
  Node* p = start;
  do {
    if (p->z == 0) p->z = z_order(p->x, p->y, min_x, min_y, inv_size);
    p->prev_z = p->prev;
    p->next_z = p->next;
    p = p->next;
  } while (p != start);

  // Break the ring into a linear list, then sort it by z.
  p->prev_z->next_z = nullptr;
  p->prev_z = nullptr;
  sort_linked(p);
}

/**
 * Simon Tatham's in-place merge sort over the next_z list, ordering nodes by
 * their Morton code. Stable, O(n log n) and allocation-free.
 */
void Earcut::sort_linked(Node* list) {
  int in_size = 1;
  int num_merges = 0;
  do {
    Node* p = list;
    list = nullptr;
    Node* tail = nullptr;
    num_merges = 0;
    while (p) {
      ++num_merges;
      Node* q = p;
      int p_size = 0;
      for (int i = 0; i < in_size; ++i) {
        ++p_size;
        q = q->next_z;
        if (!q) break;
      }
      int q_size = in_size;
      while (p_size > 0 || (q_size > 0 && q)) {
        Node* e = nullptr;
        if (p_size != 0 && (q_size == 0 || !q || p->z <= q->z)) {
          e = p;
          p = p->next_z;
          --p_size;
        } else {
          e = q;
          q = q->next_z;
          --q_size;
        }
        if (tail) {
          tail->next_z = e;
        } else {
          list = e;
        }
        e->prev_z = tail;
        tail = e;
      }
      p = q;
    }
    if (tail) tail->next_z = nullptr;
    in_size *= 2;
  } while (num_merges > 1);
}

std::vector<uint32_t> Earcut::run(const std::vector<double>& data,
                                  const std::vector<uint32_t>& hole_indices, size_t step) {
  const bool has_holes = !hole_indices.empty();
  const size_t outer_len = has_holes ? static_cast<size_t>(hole_indices[0]) * step : data.size();
  if (outer_len > data.size()) return triangles_;

  Node* outer = linked_list(data, 0, outer_len, step, true);
  if (!outer || outer->next == outer->prev) return triangles_;
  if (has_holes) outer = eliminate_holes(data, hole_indices, outer, step);

  // Big rings: precompute the bounding box so z-order codes map into a 15-bit grid.
  double min_x = 0.0, min_y = 0.0, inv_size = 0.0;
  if (data.size() > static_cast<size_t>(kZOrderThreshold) * step) {
    min_x = std::numeric_limits<double>::infinity();
    min_y = min_x;
    double max_x = -min_x;
    double max_y = -min_x;
    for (size_t i = 0; i < outer_len; i += step) {
      min_x = std::min(min_x, data[i]);
      min_y = std::min(min_y, data[i + 1]);
      max_x = std::max(max_x, data[i]);
      max_y = std::max(max_y, data[i + 1]);
    }
    const double size = std::max(max_x - min_x, max_y - min_y);
    inv_size = size != 0.0 ? 32767.0 / size : 0.0;
  }

  earcut_linked(outer, static_cast<uint32_t>(step), min_x, min_y, inv_size, 0);
  return triangles_;
}

}  // namespace

std::vector<uint32_t> earcut(const std::vector<double>& data,
                             const std::vector<uint32_t>& hole_indices, int dim) {
  if (dim < 2) return {};
  const size_t step = static_cast<size_t>(dim);
  if (data.size() < step * 3) return {};
  Earcut state;
  return state.run(data, hole_indices, step);
}

}  // namespace photon::geo
