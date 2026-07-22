/**
 * Ear-clipping polygon triangulation with hole support.
 *
 * A faithful reimplementation of the well-known ear-clipping algorithm (as
 * popularized by mapbox/earcut, ISC). Input is a flat `[x0,y0,x1,y1,…]`
 * coordinate array with optional hole start-indices; output is a flat list of
 * triangle vertex indices into that array. Pure and unit-tested.
 *
 * For rings above {@link Z_ORDER_THRESHOLD} vertices it switches on the z-order
 * (Morton) curve acceleration: each node gets a 32-bit Morton code, the nodes
 * are merge-sorted into a secondary z-linked list, and the "is this an ear?"
 * test only scans candidate points whose Morton code falls in the ear's
 * bounding-box range — turning the inner loop from O(n) into ~O(1) amortized,
 * so the whole triangulation goes from O(n²) to ~O(n log n). Small rings (most
 * vector-tile polygons) skip the hashing entirely to avoid its setup cost.
 */

/** Below this vertex count, plain O(n²) clipping is cheaper than hashing. */
const Z_ORDER_THRESHOLD = 80;

class Node {
  prev: Node = this;
  next: Node = this;
  steiner = false;
  /** Morton (z-order) code; 0 until {@link indexCurve} assigns it. */
  z = 0;
  /** Neighbours in the z-order-sorted list (null outside the hashed path). */
  prevZ: Node | null = null;
  nextZ: Node | null = null;
  constructor(
    readonly i: number,
    readonly x: number,
    readonly y: number,
  ) {}
}

/**
 * Triangulate a polygon. `holeIndices[k]` is the vertex index (not coordinate
 * index) where hole `k` begins. Returns triangle vertex indices in groups of 3.
 */
export function earcut(data: number[], holeIndices?: number[], dim = 2): number[] {
  const hasHoles = holeIndices != null && holeIndices.length > 0;
  const outerLen = hasHoles ? holeIndices![0]! * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles: number[] = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices!, outerNode, dim);

  // Big rings: precompute the bbox so z-order codes map into a 15-bit grid.
  let minX = 0;
  let minY = 0;
  let invSize = 0;
  if (data.length > Z_ORDER_THRESHOLD * dim) {
    minX = Infinity;
    minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < outerLen; i += dim) {
      const x = data[i]!;
      const y = data[i + 1]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const size = Math.max(maxX - minX, maxY - minY);
    invSize = size !== 0 ? 32767 / size : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
  return triangles;
}

/** Build a circular doubly-linked list from a ring; enforce the given winding. */
function linkedList(
  data: number[],
  start: number,
  end: number,
  dim: number,
  clockwise: boolean,
): Node | null {
  let last: Node | null = null;
  if (clockwise === ringArea(data, start, end, dim) > 0) {
    for (let i = start; i < end; i += dim) last = insertNode(i, data[i]!, data[i + 1]!, last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i]!, data[i + 1]!, last);
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

/** Remove collinear or duplicate nodes between `start` and `end`. */
function filterPoints(start: Node | null, end?: Node): Node | null {
  if (!start) return start;
  let e = end ?? start;
  let p = start;
  let again: boolean;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = e = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== e);
  return e;
}

/** Main loop: clip ears off the linked list, escalating on failure. */
function earcutLinked(
  earStart: Node | null,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
  pass: number,
): void {
  if (!earStart) return;
  let ear: Node = earStart;
  // Build the z-order index once, on the first pass over a big ring.
  if (pass === 0 && invSize) indexCurve(ear, minX, minY, invSize);
  let stop: Node = earStart;
  while (ear.prev !== ear.next) {
    const prev: Node = ear.prev;
    const next: Node = ear.next;
    const found = invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear);
    if (found) {
      triangles.push((prev.i / dim) | 0, (ear.i / dim) | 0, (next.i / dim) | 0);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      // No ear found in a full pass — clean up and retry with more effort.
      if (pass === 0) earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      else if (pass === 1) {
        const cured = cureLocalIntersections(filterPoints(ear)!, triangles, dim);
        earcutLinked(cured, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) splitEarcut(ear, triangles, dim, minX, minY, invSize);
      break;
    }
  }
}

function isEar(ear: Node): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;
  if (area(a, b, c) >= 0) return false; // reflex or collinear — not an ear tip
  let p = ear.next.next;
  while (p !== ear.prev) {
    if (
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
      area(p.prev, p, p.next) >= 0
    ) {
      return false;
    }
    p = p.next;
  }
  return true;
}

/**
 * The z-order-accelerated ear test: instead of scanning every other vertex,
 * only visit points whose Morton code lies within the ear triangle's
 * bounding-box z-range, walking outward along the z-linked list in both
 * directions from the ear.
 */
function isEarHashed(ear: Node, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;
  if (area(a, b, c) >= 0) return false; // reflex or collinear — not an ear tip

  const ax = a.x;
  const bx = b.x;
  const cx = c.x;
  const ay = a.y;
  const by = b.y;
  const cy = c.y;
  // Triangle bounding box.
  const x0 = Math.min(ax, bx, cx);
  const y0 = Math.min(ay, by, cy);
  const x1 = Math.max(ax, bx, cx);
  const y1 = Math.max(ay, by, cy);
  // Its z-order range.
  const minZ = zOrder(x0, y0, minX, minY, invSize);
  const maxZ = zOrder(x1, y1, minX, minY, invSize);

  let p = ear.prevZ;
  let n = ear.nextZ;

  const blocks = (q: Node): boolean =>
    q.x >= x0 &&
    q.x <= x1 &&
    q.y >= y0 &&
    q.y <= y1 &&
    q !== a &&
    q !== c &&
    pointInTriangle(ax, ay, bx, by, cx, cy, q.x, q.y) &&
    area(q.prev, q, q.next) >= 0;

  // Walk both directions while both stay inside the z-range.
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (blocks(p)) return false;
    p = p.prevZ;
    if (blocks(n)) return false;
    n = n.nextZ;
  }
  // Exhaust the remaining decreasing-z side.
  while (p && p.z >= minZ) {
    if (blocks(p)) return false;
    p = p.prevZ;
  }
  // Exhaust the remaining increasing-z side.
  while (n && n.z <= maxZ) {
    if (blocks(n)) return false;
    n = n.nextZ;
  }
  return true;
}

/** Merge holes into the outer ring by cutting bridges, leftmost hole first. */
function eliminateHoles(
  data: number[],
  holeIndices: number[],
  outerNode: Node,
  dim: number,
): Node {
  const queue: Node[] = [];
  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i]! * dim;
    const end = i < len - 1 ? holeIndices[i + 1]! * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (list) {
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
  }
  queue.sort((a, b) => a.x - b.x);
  let node = outerNode;
  for (const hole of queue) node = eliminateHole(hole, node);
  return node;
}

function eliminateHole(hole: Node, outerNode: Node): Node {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next)!;
}

/** Find a mutually-visible outer-ring vertex to bridge a hole to. */
function findHoleBridge(hole: Node, outerNode: Node): Node | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: Node | null = null;
  // Cast a ray to the left; find the outer edge it hits closest to the hole.
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) / (p.next.y - p.y)) * (p.next.x - p.x);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;

  // Refine: pick the reflex vertex inside the hole/edge triangle with the
  // smallest angle to the hole (guarantees visibility).
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (
      hx >= p.x &&
      p.x >= mx &&
      hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
    ) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (
        locallyInside(p, hole) &&
        (tan < tanMin ||
          (tan === tanMin && (p.x > m!.x || (p.x === m!.x && sectorContainsSector(m!, p)))))
      ) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

/** Clip away pairs of ears that form a self-intersection (repair pass). */
function cureLocalIntersections(start: Node, triangles: number[], dim: number): Node {
  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;
    if (
      !equals(a, b) &&
      intersects(a, p, p.next, b) &&
      locallyInside(a, b) &&
      locallyInside(b, a)
    ) {
      triangles.push((a.i / dim) | 0, (p.i / dim) | 0, (b.i / dim) | 0);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p)!;
}

/** Split the polygon by the first valid diagonal, then triangulate both halves. */
function splitEarcut(
  start: Node,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c: Node | null = splitPolygon(a, b);
        const a2 = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a2, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

// ---- Geometry predicates -----------------------------------------------------

/** Signed area of triangle (p,q,r) × 2; < 0 for clockwise. */
function area(p: Node, q: Node, r: Node): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(a: Node, b: Node): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  return (
    (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0
  );
}

/** Is the diagonal a→b a valid, interior, non-crossing split? */
function isValidDiagonal(a: Node, b: Node): boolean {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
      (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0)) ||
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
  );
}

function onSegment(p: Node, q: Node, r: Node): boolean {
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) &&
    q.y >= Math.min(p.y, r.y)
  );
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Do segments p1p2 and q1q2 properly (or collinearly) intersect? */
function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/** Does diagonal a→b cross any polygon edge? */
function intersectsPolygon(a: Node, b: Node): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) {
      return true;
    }
    p = p.next;
  } while (p !== a);
  return false;
}

/** Is a→b inside the polygon corner at a? */
function locallyInside(a: Node, b: Node): boolean {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

/** Does the midpoint of a→b lie inside the polygon? */
function middleInside(a: Node, b: Node): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (
      p.y > py !== p.next.y > py &&
      p.next.y !== p.y &&
      px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x
    ) {
      inside = !inside;
    }
    p = p.next;
  } while (p !== a);
  return inside;
}

function sectorContainsSector(m: Node, p: Node): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

// ---- Linked-list plumbing ----------------------------------------------------

function splitPolygon(a: Node, b: Node): Node {
  const a2 = new Node(a.i, a.x, a.y);
  const b2 = new Node(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

function insertNode(i: number, x: number, y: number, last: Node | null): Node {
  const p = new Node(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function removeNode(p: Node): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  // Keep the z-order list consistent when hashing is in effect.
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function getLeftmost(start: Node): Node {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

/** Signed area of a raw coordinate range (used to detect winding). */
function ringArea(data: number[], start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j]! - data[i]!) * (data[i + 1]! + data[j + 1]!);
    j = i;
  }
  return sum;
}

// ---- Z-order (Morton curve) acceleration -------------------------------------

/** Assign a Morton code to every node and build the sorted z-linked list. */
function indexCurve(start: Node, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);

  // Break the ring into a linear list, then sort it by z.
  p.prevZ!.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

/**
 * Simon Tatham's in-place merge sort over the `nextZ` list, ordering nodes by
 * their Morton code. Stable, O(n log n), and allocation-free.
 */
function sortLinked(list: Node | null): void {
  let inSize = 1;
  let numMerges: number;
  do {
    let p: Node | null = list;
    list = null;
    let tail: Node | null = null;
    numMerges = 0;
    while (p) {
      numMerges++;
      let q: Node | null = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      let qSize = inSize;
      while (pSize > 0 || (qSize > 0 && q)) {
        let e: Node;
        if (pSize !== 0 && (qSize === 0 || !q || p!.z <= q.z)) {
          e = p!;
          p = p!.nextZ;
          pSize--;
        } else {
          e = q!;
          q = q!.nextZ;
          qSize--;
        }
        if (tail) tail.nextZ = e;
        else list = e;
        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }
    tail!.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);
}

/**
 * Interleave the bits of the 15-bit grid coordinates into a 32-bit Morton code,
 * so numerically close codes correspond to spatially close points.
 */
function zOrder(x: number, y: number, minX: number, minY: number, invSize: number): number {
  let ix = ((x - minX) * invSize) | 0;
  let iy = ((y - minY) * invSize) | 0;

  ix = (ix | (ix << 8)) & 0x00ff00ff;
  ix = (ix | (ix << 4)) & 0x0f0f0f0f;
  ix = (ix | (ix << 2)) & 0x33333333;
  ix = (ix | (ix << 1)) & 0x55555555;

  iy = (iy | (iy << 8)) & 0x00ff00ff;
  iy = (iy | (iy << 4)) & 0x0f0f0f0f;
  iy = (iy | (iy << 2)) & 0x33333333;
  iy = (iy | (iy << 1)) & 0x55555555;

  return ix | (iy << 1);
}
