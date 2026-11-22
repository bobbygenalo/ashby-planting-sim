import { distanceToPolygon, pointInPolygon } from './geometry';
import type { Pt } from './types';

/** A place a garden path should reach. */
export interface Hub {
  id: string;
  label: string;
  /** A door: where the entry is, and which way is out. */
  door?: { point: Pt; outward: Pt };
  /** A patio, lawn or deck: the path stops at its edge. */
  polygon?: Pt[];
  /** A tree to harvest from: the path stops this far from its trunk. */
  tree?: { x: number; y: number; stand: number };
}

export interface NetInput {
  lot: { width: number; depth: number };
  lotMarginFt: number;
  /** Half the path width, in feet. */
  halfWidth: number;
  gridFt: number;
  /** Outlines the centerline keeps `clear` away from. */
  blockers: { poly: Pt[]; clear: number }[];
  /** Round obstacles (canopies); `r` is the distance the centerline keeps from the center. */
  discs: { x: number; y: number; r: number }[];
  /** Paths already built (centerlines): new routes may join them. */
  seeds?: Pt[][];
  /** In priority order; the first one reachable is where the network starts. */
  hubs: Hub[];
  maxPaths: number;
  /** Cost of walking on an existing path, as a share of open ground. */
  reuse: number;
  /** Rounds a point to the plan's grid; door ends are left as they are. */
  snap?: (p: Pt) => Pt;
  /** Veto a finished path (for example when it hits something the grid did not know about). */
  accept?: (points: Pt[]) => boolean;
}

export interface NetPath {
  points: Pt[];
  /** The hub the path starts at, and what it ends at (a hub id, or 'path' for a junction). */
  from: string;
  to: string;
}

class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(cost: number, id: number) {
    const a = this.a;
    a.push([cost, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Garden paths that join the places people go: doors, patios and lawns, and fruit trees. The network grows like a
 * minimum spanning tree: from what is already connected it finds the cheapest route to the nearest unconnected place,
 * walks around everything in the way, and may end on an earlier path, so places share routes instead of each getting
 * a spur. Places that cannot be reached from the network (the front yard, say) start their own. Deterministic; the grid is the only approximation, and `accept` can check the finished outline exactly.
 */
export function routePaths(inp: NetInput): NetPath[] {
  const g = inp.gridFt;
  const cols = Math.ceil(inp.lot.width / g), rows = Math.ceil(inp.lot.depth / g);
  const N = cols * rows;
  const cx = (i: number) => ((i % cols) + 0.5) * g;
  const cy = (i: number) => (Math.floor(i / cols) + 0.5) * g;
  const edge = inp.lotMarginFt + inp.halfWidth + 0.4;

  const blocked = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = cx(i), y = cy(i);
    if (x < edge || y < edge || x > inp.lot.width - edge || y > inp.lot.depth - edge) { blocked[i] = 1; continue; }
    if (inp.discs.some((d) => Math.hypot(x - d.x, y - d.y) < d.r)) { blocked[i] = 1; continue; }
    for (const b of inp.blockers) {
      if (pointInPolygon(x, y, b.poly) || distanceToPolygon(x, y, b.poly) < b.clear) { blocked[i] = 1; break; }
    }
  }
  const nearestFree = (p: Pt, within: number): number => {
    let best = -1, bd = within;
    const r = Math.ceil(within / g);
    const ci = Math.floor(p[0] / g), cj = Math.floor(p[1] / g);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      if (blocked[k]) continue;
      const d = Math.hypot(cx(k) - p[0], cy(k) - p[1]);
      if (d <= bd) { bd = d; best = k; }
    }
    return best;
  };

  // The cells at which each hub can be joined.
  const goals = new Map<string, number[]>();
  for (const h of inp.hubs) {
    const cells: number[] = [];
    if (h.door) {
      const k = nearestFree([h.door.point[0] + h.door.outward[0] * 3.5, h.door.point[1] + h.door.outward[1] * 3.5], 1.6 * g + 0.5);
      if (k >= 0) cells.push(k);
    } else if (h.polygon) {
      const clear = inp.blockers.find((b) => b.poly === h.polygon)?.clear ?? 0;
      for (let i = 0; i < N; i++) if (!blocked[i] && distanceToPolygon(cx(i), cy(i), h.polygon) <= clear + g * 1.5) cells.push(i);
    } else if (h.tree) {
      const r = inp.discs.find((d) => d.x === h.tree!.x && d.y === h.tree!.y)?.r ?? h.tree.stand;
      for (let i = 0; i < N; i++) if (!blocked[i] && Math.hypot(cx(i) - h.tree.x, cy(i) - h.tree.y) <= r + g * 1.5) cells.push(i);
    }
    goals.set(h.id, cells);
  }

  const tags = new Map<number, string[]>(); // source cell -> hubs, or 'path'
  const isPath = new Uint8Array(N);
  const hubById = new Map(inp.hubs.map((h) => [h.id, h]));
  const connected = new Set<string>();
  const pending = new Set(inp.hubs.filter((h) => (goals.get(h.id) ?? []).length > 0).map((h) => h.id));
  const connect = (id: string) => {
    connected.add(id);
    pending.delete(id);
    for (const k of goals.get(id)!) tags.set(k, [...(tags.get(k) ?? []), id]);
  };
  for (const line of inp.seeds ?? []) {
    for (let n = 0; n + 1 < line.length; n++) {
      const a = line[n], b = line[n + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g * 0.5)));
      for (let t = 0; t <= steps; t++) {
        const i = Math.floor((a[0] + ((b[0] - a[0]) * t) / steps) / g), j = Math.floor((a[1] + ((b[1] - a[1]) * t) / steps) / g);
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        isPath[j * cols + i] = 1;
        tags.set(j * cols + i, ['path']);
      }
    }
  }
  if (tags.size === 0) {
    const first = inp.hubs.find((h) => pending.has(h.id));
    if (!first) return [];
    connect(first.id);
  }

  const smooth = (cells: number[]): Pt[] => {
    const pts: Pt[] = cells.map((k) => [cx(k), cy(k)]);
    const clearLine = (a: Pt, b: Pt) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / (g * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / steps, y = a[1] + ((b[1] - a[1]) * s) / steps;
        const i = Math.floor(x / g), j = Math.floor(y / g);
        if (i < 0 || j < 0 || i >= cols || j >= rows || blocked[j * cols + i]) return false;
      }
      return true;
    };
    const out: Pt[] = [pts[0]];
    let at = 0;
    while (at < pts.length - 1) {
      let to = pts.length - 1;
      while (to > at + 1 && !clearLine(pts[at], pts[to])) to--;
      out.push(pts[to]);
      at = to;
    }
    return out;
  };

  /** Points from the end of a route to its hub: for a door, straight out from the wall and then to the entry, so the path arrives square on. */
  const extend = (hub: Hub, from: Pt, toward: Pt): Pt[] => {
    if (hub.door) {
      const { point, outward } = hub.door;
      return [[point[0] + outward[0] * 3.5, point[1] + outward[1] * 3.5], [point[0] + outward[0] * 0.4, point[1] + outward[1] * 0.4]];
    }
    if (hub.tree) {
      const d = Math.hypot(hub.tree.x - from[0], hub.tree.y - from[1]);
      if (d <= hub.tree.stand) return [];
      const f = (d - hub.tree.stand) / d;
      return [[from[0] + (hub.tree.x - from[0]) * f, from[1] + (hub.tree.y - from[1]) * f]];
    }
    if (hub.polygon) {
      const poly = hub.polygon;
      const mx = poly.reduce((a, p) => a + p[0], 0) / poly.length, my = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const len = Math.hypot(mx - from[0], my - from[1]) || 1;
      const ux = (mx - from[0]) / len, uy = (my - from[1]) / len;
      for (let t = 0; t < len; t += 0.25) {
        if (pointInPolygon(from[0] + ux * t, from[1] + uy * t, poly)) return [[from[0] + ux * (t + 0.5), from[1] + uy * (t + 0.5)]];
      }
    }
    void toward;
    return [];
  };

  const out: NetPath[] = [];
  while (out.length < inp.maxPaths && pending.size > 0) {
    // Cheapest route from everything connected to every cell.
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new Heap();
    for (const k of tags.keys()) { dist[k] = 0; heap.push(0, k); }
    while (heap.size > 0) {
      const [d, k] = heap.pop();
      if (d > dist[k]) continue;
      const i = k % cols, j = Math.floor(k / cols);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
        const n = b * cols + a;
        if (blocked[n]) continue;
        const step = (di && dj ? Math.SQRT2 : 1) * g * (isPath[n] ? inp.reuse : 1);
        if (d + step < dist[n]) { dist[n] = d + step; prev[n] = k; heap.push(d + step, n); }
      }
    }
    let bestHub = '', bestCell = -1, bestCost = Infinity;
    for (const id of pending) {
      for (const k of goals.get(id)!) if (dist[k] < bestCost) { bestCost = dist[k]; bestCell = k; bestHub = id; }
    }
    if (bestCell < 0) {
      // Nothing left is reachable from what is connected (for example the front yard, cut off from the back by the house):
      // start a second network from the next place in priority order.
      const next = inp.hubs.find((h) => pending.has(h.id));
      if (!next) break;
      connect(next.id);
      continue;
    }
    const cells: number[] = [];
    for (let k = bestCell; k >= 0; k = prev[k]) cells.push(k);
    const end = cells[cells.length - 1];
    const endTag = (tags.get(end) ?? ['path'])[0];
    const pts = smooth(cells);
    const startHub = hubById.get(bestHub)!;
    // Read from the start hub: [its entry, ...the route, the entry of what it joins].
    const pre = extend(startHub, pts[0], pts[1] ?? pts[0]).reverse();
    const post = endTag === 'path' ? [] : extend(hubById.get(endTag)!, pts[pts.length - 1], pts[pts.length - 2] ?? pts[0]);
    const doorTips = new Set<Pt>();
    if (startHub.door) doorTips.add(pre[0]);
    if (endTag !== 'path' && hubById.get(endTag)!.door) doorTips.add(post[post.length - 1]);
    const raw: Pt[] = [...pre, ...pts, ...post];
    const line: Pt[] = inp.snap ? raw.map((q) => (doorTips.has(q) ? q : inp.snap!(q))) : raw;
    if (line.length >= 2 && (!inp.accept || inp.accept(line))) {
      out.push({ points: line, from: bestHub, to: endTag });
      for (const k of cells) { isPath[k] = 1; tags.set(k, [...(tags.get(k) ?? []), 'path']); }
      connect(bestHub);
    } else {
      pending.delete(bestHub);
    }
  }
  return out;
}
