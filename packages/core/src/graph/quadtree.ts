/**
 * A flat quadtree over 2-D points, for Barnes–Hut force approximation.
 *
 * Stored in typed arrays rather than objects: a force layout rebuilds the tree
 * every iteration, so allocating a node object per point would cost more than
 * the traversal it enables.
 *
 * Each node keeps its subtree's mass (point count) and centre of mass, which is
 * all Barnes–Hut needs to treat a distant cluster as one body.
 */

/** Children are stored as four consecutive slots; -1 means empty. */
const NO_CHILD = -1;

export class Quadtree {
  /** Node fields, parallel arrays indexed by node id. */
  private cx: Float64Array;      // cell centre
  private cy: Float64Array;
  private half: Float64Array;    // half-width of the cell
  private massX: Float64Array;   // sum of member x (divide by mass for the centroid)
  private massY: Float64Array;
  private mass: Float64Array;
  private child: Int32Array;     // 4 per node
  /** Index of the single point in a leaf, or -1 when the node is internal/empty. */
  private point: Int32Array;
  private count = 0;
  private capacity: number;

  constructor(capacity = 64) {
    this.capacity = Math.max(4, capacity);
    this.cx = new Float64Array(this.capacity);
    this.cy = new Float64Array(this.capacity);
    this.half = new Float64Array(this.capacity);
    this.massX = new Float64Array(this.capacity);
    this.massY = new Float64Array(this.capacity);
    this.mass = new Float64Array(this.capacity);
    this.child = new Int32Array(this.capacity * 4).fill(NO_CHILD);
    this.point = new Int32Array(this.capacity).fill(-1);
  }

  private grow(): void {
    const cap = this.capacity * 2;
    const f = (a: Float64Array): Float64Array => { const b = new Float64Array(cap); b.set(a); return b; };
    this.cx = f(this.cx); this.cy = f(this.cy); this.half = f(this.half);
    this.massX = f(this.massX); this.massY = f(this.massY); this.mass = f(this.mass);
    const c = new Int32Array(cap * 4).fill(NO_CHILD); c.set(this.child); this.child = c;
    const p = new Int32Array(cap).fill(-1); p.set(this.point); this.point = p;
    this.capacity = cap;
  }

  private newNode(cx: number, cy: number, half: number): number {
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    this.cx[i] = cx; this.cy[i] = cy; this.half[i] = half;
    this.massX[i] = 0; this.massY[i] = 0; this.mass[i] = 0;
    this.child[i * 4] = NO_CHILD; this.child[i * 4 + 1] = NO_CHILD;
    this.child[i * 4 + 2] = NO_CHILD; this.child[i * 4 + 3] = NO_CHILD;
    this.point[i] = -1;
    return i;
  }

  /** Rebuild the tree over `n` points. Reuses the existing arrays. */
  build(x: ArrayLike<number>, y: ArrayLike<number>, n: number): void {
    this.count = 0;
    if (n === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = x[i]!, py = y[i]!;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
    this.newNode((minX + maxX) / 2, (minY + maxY) / 2, half * 1.0001);
    for (let i = 0; i < n; i++) this.insert(0, i, x[i]!, y[i]!, 0);
  }

  /**
   * Insert point `i` under `node`. Recursion is bounded by `depth`: coincident
   * points would otherwise subdivide forever, so past the limit a leaf simply
   * accumulates them — which is harmless, since Barnes–Hut only reads mass and
   * centroid.
   */
  private insert(node: number, i: number, px: number, py: number, depth: number): void {
    this.mass[node]! += 1;
    this.massX[node]! += px;
    this.massY[node]! += py;

    const existing = this.point[node]!;
    const isLeaf = this.child[node * 4] === NO_CHILD;

    if (isLeaf && existing === -1 && this.mass[node] === 1) {
      this.point[node] = i;
      return;
    }
    if (depth >= 24) return; // coincident points: stop splitting, mass is enough

    if (isLeaf) {
      // Push the resident point down before adding the new one.
      this.point[node] = -1;
      if (existing >= 0) {
        const ex = this.massX[node]! - px;   // the resident's coordinates
        const ey = this.massY[node]! - py;
        this.descend(node, existing, ex, ey, depth);
      }
    }
    this.descend(node, i, px, py, depth);
  }

  /** Route a point into the right child quadrant, creating it if needed. */
  private descend(node: number, i: number, px: number, py: number, depth: number): void {
    const cx = this.cx[node]!, cy = this.cy[node]!, h = this.half[node]!;
    const q = (px >= cx ? 1 : 0) + (py >= cy ? 2 : 0);
    let c = this.child[node * 4 + q]!;
    if (c === NO_CHILD) {
      const qh = h / 2;
      c = this.newNode(cx + (q & 1 ? qh : -qh), cy + (q & 2 ? qh : -qh), qh);
      this.child[node * 4 + q] = c;
    }
    this.insert(c, i, px, py, depth + 1);
  }

  /**
   * Accumulate the repulsive force on point `i` at (px, py).
   *
   * A subtree is treated as a single body when its width over its distance is
   * below `theta` — the Barnes–Hut criterion. `force(d)` returns the magnitude
   * for one unit of mass at distance `d`; the caller supplies it so the tree
   * stays independent of the layout's force law.
   */
  repulsion(
    px: number, py: number, self: number, theta: number,
    force: (d: number) => number,
    out: { x: number; y: number },
  ): void {
    out.x = 0;
    out.y = 0;
    if (this.count === 0) return;
    // Explicit stack: recursion here is the hot path of every iteration.
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp]!;
      const m = this.mass[node]!;
      if (m === 0) continue;
      const ncx = this.massX[node]! / m;
      const ncy = this.massY[node]! / m;
      let dx = px - ncx, dy = py - ncy;
      let d = Math.sqrt(dx * dx + dy * dy);
      const leafPoint = this.point[node]!;

      if (leafPoint >= 0) {
        if (leafPoint === self) continue;
      } else if (this.half[node]! * 2 / (d || 1e-9) >= theta) {
        // Too close to approximate — descend, if there is anywhere to descend to.
        // A node at the depth limit holds coincident points and has no children;
        // it still carries mass, so it falls through and acts as one body.
        const base = node * 4;
        let pushed = false;
        for (let q = 0; q < 4; q++) {
          const c = this.child[base + q]!;
          if (c !== NO_CHILD && sp < stack.length) { stack[sp++] = c; pushed = true; }
        }
        if (pushed) continue;
      }
      if (d < 1e-9) {
        // Coincident: nudge along a fixed axis so the pair still separates.
        dx = 1e-6; dy = 0; d = 1e-6;
      }
      const f = force(d) * m;
      out.x += (dx / d) * f;
      out.y += (dy / d) * f;
    }
  }

  private stack = new Int32Array(4096);
}
