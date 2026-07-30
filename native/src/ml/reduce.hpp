// Dimensionality reduction — port of core/src/ml/reduce.ts.
//
// PCA by covariance power-iteration with deflation. Deterministic on purpose:
// the seed vector is arithmetic rather than random, so an embedding plot is the
// same picture on every run and in every host. For t-SNE or UMAP, compute the
// coordinates elsewhere and hand them straight to a scatter.
#pragma once

#include <cstddef>
#include <vector>

namespace photon::ml {

struct PcaResult {
  /// Projected coordinates, row-major `n * k`.
  std::vector<double> scores;
  /// Principal-component directions, row-major `k * d`, unit vectors.
  std::vector<double> components;
  /// Explained-variance ratio per component.
  std::vector<double> explained;
  /// The per-column mean subtracted before projection.
  std::vector<double> mean;
  size_t n = 0;
  size_t d = 0;
  size_t k = 0;
};

/// Z-score each of the `d` columns of a row-major `n * d` matrix.
std::vector<double> standardize(const double* data, size_t n, size_t d);

/// PCA of a row-major `n * d` matrix, projected onto its top `k` components.
PcaResult pca(const double* data, size_t n, size_t d, size_t k = 2);

}  // namespace photon::ml
