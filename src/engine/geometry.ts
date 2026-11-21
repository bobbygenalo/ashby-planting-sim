import type { Pt } from './types';

export function bbox(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Ray-casting point-in-polygon for any simple polygon. */
export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** True when (x, y) is inside or on a counter-clockwise convex polygon. */
export function pointInConvex(x: number, y: number, hull: Pt[]): boolean {
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    if ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) < 0) return false;
  }
  return true;
}

export function polylineLength(line: Pt[]): number {
  let len = 0;
  for (let i = 0; i < line.length - 1; i++) len += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  return len;
}

export function perimeter(poly: Pt[]): number {
  return poly.length < 2 ? 0 : polylineLength([...poly, poly[0]]);
}

/** Outline of a polyline thickened to `width`, with mitered joints (limited to 2x). */
export function lineToPolygon(line: Pt[], width: number): Pt[] {
  if (line.length < 2) return [];
  const h = width / 2;
  const dir = (i: number): Pt => {
    const [x1, y1] = line[i];
    const [x2, y2] = line[i + 1];
    const l = Math.hypot(x2 - x1, y2 - y1) || 1;
    return [(x2 - x1) / l, (y2 - y1) / l];
  };
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = line.length;
  for (let i = 0; i < n; i++) {
    let nx: number, ny: number, scale = 1;
    if (i === 0 || i === n - 1) {
      const d = dir(i === 0 ? 0 : n - 2);
      nx = -d[1];
      ny = d[0];
    } else {
      const d0 = dir(i - 1);
      const d1 = dir(i);
      const mx = -d0[1] - d1[1];
      const my = d0[0] + d1[0];
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) {
        nx = -d0[1];
        ny = d0[0];
      } else {
        nx = mx / ml;
        ny = my / ml;
        const cos = nx * -d0[1] + ny * d0[0];
        scale = Math.min(1 / Math.max(cos, 0.5), 2);
      }
    }
    left.push([line[i][0] + nx * h * scale, line[i][1] + ny * h * scale]);
    right.push([line[i][0] - nx * h * scale, line[i][1] - ny * h * scale]);
  }
  return [...left, ...right.reverse()];
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when two simple polygons share any area (edges cross, or one contains the other). */
export function polygonsIntersect(a: Pt[], b: Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return pointInPolygon(a[0][0], a[0][1], b) || pointInPolygon(b[0][0], b[0][1], a);
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): { dist: number; point: Pt } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const point: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { dist: Math.hypot(p[0] - point[0], p[1] - point[1]), point };
}

export function circleOverlapsPolygon(cx: number, cy: number, r: number, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  if (pointInPolygon(cx, cy, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (distanceToSegment([cx, cy], poly[i], poly[(i + 1) % poly.length]).dist <= r) return true;
  }
  return false;
}

export function isConvex(poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = orient(poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Ear-clipping triangulation of a simple polygon. Each triangle is convex, so it can cast a shadow. */
export function triangulate(poly: Pt[]): [Pt, Pt, Pt][] {
  if (poly.length < 3) return [];
  let signed = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    signed += x1 * y2 - x2 * y1;
  }
  const idx = poly.map((_, i) => i);
  if (signed < 0) idx.reverse();
  const tris: [Pt, Pt, Pt][] = [];
  let guard = poly.length * poly.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = poly[idx[(k + idx.length - 1) % idx.length]], b = poly[idx[k]], c = poly[idx[(k + 1) % idx.length]];
      if (orient(a, b, c) <= 1e-12) continue;
      const tri: Pt[] = [a, b, c];
      const blocked = idx.some((j) => {
        const q = poly[j];
        return q !== a && q !== b && q !== c && pointInConvex(q[0], q[1], tri);
      });
      if (blocked) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]]);
  return tris;
}
