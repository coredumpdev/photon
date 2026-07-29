// Port of core/src/geo/earcut.ts — ear-clipping polygon triangulation with
// hole support.
//
// A faithful reimplementation of the well-known algorithm (as popularized by
// mapbox/earcut, ISC). Input is a flat [x0,y0,x1,y1,…] coordinate array with
// optional hole start-indices; output is a flat list of triangle vertex indices
// into that array.
//
// The one structural difference from the TypeScript is memory. There, nodes are
// garbage-collected objects and a node is simply `new`ed whenever a polygon is
// split. Here they live in a std::deque owned by the triangulation, because
// deque is the container whose element addresses survive growth — and growth
// happens *during* triangulation, while dozens of raw pointers into it are
// live. A vector would reallocate and invalidate every one of them.
#pragma once

#include <cstdint>
#include <vector>

namespace photon::geo {

/**
 * Triangulate a polygon.
 *
 * `hole_indices[k]` is the vertex index (not the coordinate index) where hole
 * `k` begins. Returns triangle vertex indices in groups of three; empty when
 * the ring is degenerate.
 */
std::vector<uint32_t> earcut(const std::vector<double>& data,
                             const std::vector<uint32_t>& hole_indices, int dim = 2);

}  // namespace photon::geo
