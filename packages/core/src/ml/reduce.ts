/**
 * Pure, dependency-free dimensionality reduction for embedding projections.
 * {@link pca} projects an `n×d` matrix onto its top-`k` principal components via
 * covariance power-iteration with deflation — deterministic (no RNG), so tests
 * and re-renders are stable. Pair with {@link addEmbedding}. For t-SNE/UMAP,
 * feed precomputed 2-D coordinates straight into the builder.
 */

/** The result of {@link pca}: projected scores + the components they project onto. */
export interface PcaResult {
  /** Projected coordinates, row-major `n×k`. */
  scores: Float64Array;
  /** Principal-component directions, row-major `k×d` (unit vectors). */
  components: Float64Array;
  /** Explained-variance ratio per component, length `k`. */
  explained: Float64Array;
  /** Per-column mean subtracted before projection, length `d`. */
  mean: Float64Array;
  n: number;
  d: number;
  k: number;
}

/** Z-score each of the `d` columns of a row-major `n×d` matrix (unit variance). */
export function standardize(data: ArrayLike<number>, n: number, d: number): Float64Array {
  const out = new Float64Array(n * d);
  for (let j = 0; j < d; j++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += data[i * d + j]!;
    mean /= Math.max(1, n);
    let varsum = 0;
    for (let i = 0; i < n; i++) { const dv = data[i * d + j]! - mean; varsum += dv * dv; }
    const sd = Math.sqrt(varsum / Math.max(1, n - 1)) || 1;
    for (let i = 0; i < n; i++) out[i * d + j] = (data[i * d + j]! - mean) / sd;
  }
  return out;
}

/**
 * Principal component analysis of a row-major `n×d` matrix, projected to `k`
 * dims (default 2). Centers columns, forms the `d×d` covariance, then extracts
 * the top-`k` eigenvectors by power iteration + deflation. Deterministic.
 */
export function pca(data: ArrayLike<number>, n: number, d: number, k = 2): PcaResult {
  k = Math.max(1, Math.min(k, d));
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j]! += data[i * d + j]!;
  for (let j = 0; j < d; j++) mean[j]! /= Math.max(1, n);

  // Centered copy, then covariance = Xcᵀ·Xc / (n−1) (symmetric d×d).
  const Xc = new Float64Array(n * d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) Xc[i * d + j] = data[i * d + j]! - mean[j]!;
  const cov = new Float64Array(d * d);
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const row = i * d;
    for (let a = 0; a < d; a++) {
      const xa = Xc[row + a]!;
      if (xa === 0) continue;
      for (let b = a; b < d; b++) cov[a * d + b]! += xa * Xc[row + b]!;
    }
  }
  let totalVar = 0;
  for (let a = 0; a < d; a++) {
    for (let b = a; b < d; b++) { const v = cov[a * d + b]! / denom; cov[a * d + b] = v; cov[b * d + a] = v; }
    totalVar += cov[a * d + a]!;
  }

  const components = new Float64Array(k * d);
  const explained = new Float64Array(k);
  const v = new Float64Array(d), w = new Float64Array(d);
  for (let c = 0; c < k; c++) {
    // Deterministic non-degenerate seed, orthogonal-ish across components.
    for (let j = 0; j < d; j++) v[j] = Math.sin(1 + j * (c + 1)) + 0.5;
    normalize(v, d);
    let eig = 0;
    for (let iter = 0; iter < 256; iter++) {
      for (let a = 0; a < d; a++) { let s = 0; const ra = a * d; for (let b = 0; b < d; b++) s += cov[ra + b]! * v[b]!; w[a] = s; }
      const norm = normalize(w, d);
      let dot = 0;
      for (let a = 0; a < d; a++) dot += w[a]! * v[a]!;
      for (let a = 0; a < d; a++) v[a] = w[a]!;
      if (Math.abs(Math.abs(dot) - 1) < 1e-9) { eig = norm; break; }
      eig = norm;
    }
    for (let j = 0; j < d; j++) components[c * d + j] = v[j]!;
    explained[c] = totalVar > 0 ? eig / totalVar : 0;
    // Deflate: cov ← cov − eig·v·vᵀ so the next pass finds the next component.
    for (let a = 0; a < d; a++) { const va = eig * v[a]!; for (let b = 0; b < d; b++) cov[a * d + b]! -= va * v[b]!; }
  }

  // scores = Xc · componentsᵀ  (n×k)
  const scores = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    const row = i * d;
    for (let c = 0; c < k; c++) {
      let s = 0; const cr = c * d;
      for (let j = 0; j < d; j++) s += Xc[row + j]! * components[cr + j]!;
      scores[i * k + c] = s;
    }
  }
  return { scores, components, explained, mean, n, d, k };
}

/** L2-normalize `vec` in place; returns the original norm (0 → left as zeros). */
function normalize(vec: Float64Array, d: number): number {
  let s = 0;
  for (let j = 0; j < d; j++) s += vec[j]! * vec[j]!;
  const norm = Math.sqrt(s);
  if (norm > 0) for (let j = 0; j < d; j++) vec[j]! /= norm;
  return norm;
}
