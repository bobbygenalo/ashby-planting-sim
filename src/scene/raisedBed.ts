import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../engine/shuffle';
import type { Pt, RaisedBedFrameCfg } from '../engine/types';

export interface BedGeometry {
  /** Boards, corner posts and cap rail as one mesh, with a color per piece and UVs that run in feet along the wood. */
  wood: THREE.BufferGeometry | null;
  /** The soil surface, a flat shape at `soilZ`, UVs in feet. */
  soil: THREE.BufferGeometry | null;
  soilZ: number;
  /** How many boards stack up each side. */
  layers: number;
}

/** A box with its length along X, thickness along Y and height along Z; the grain's U runs along the length in tile units. */
function plank(len: number, thick: number, high: number, ftPerTile: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, thick, high);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) if (Math.abs(nrm.getX(i)) < 0.5) uv.setX(i, uv.getX(i) * (len / ftPerTile));
  return g;
}

function paint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * A raised bed as a wooden frame: stacked boards between corner posts, a flat cap rail along the top, posts standing a
 * little above it, and the soil a few inches below the rim. Works for any outline, either winding. The outside of the
 * boards sits exactly on the outline, so the bed takes the room it is drawn to take.
 */
export function raisedBedGeometry(poly: Pt[], height: number, soilZ: number, color: string, frame: RaisedBedFrameCfg, seed = 1): BedGeometry {
  if (poly.length < 3 || height <= 0) return { wood: null, soil: null, soilZ, layers: 0 };
  const rng = mulberry32(seed);
  // Which way the outline winds (the shoelace sum is positive for counter-clockwise).
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    twice += x1 * y2 - x2 * y1;
  }
  const ccw = twice >= 0;
  const base = new THREE.Color(color);
  const tone = (amount: number) => base.clone().offsetHSL(0, 0, (rng() - 0.5) * 2 * frame.colorJitter + amount);
  const wall = Math.max(height - frame.capThicknessFt, frame.boardHeightFt * 0.5);
  const layers = Math.max(1, Math.round(wall / frame.boardHeightFt));
  const boardH = wall / layers - frame.seamGapFt;
  const pieces: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const put = (g: THREE.BufferGeometry, cx: number, cy: number, cz: number, angle: number, c: THREE.Color) => {
    m.makeRotationZ(angle);
    m.setPosition(cx, cy, cz);
    g.applyMatrix4(m);
    pieces.push(paint(g.index ? g.toNonIndexed() : g, c));
  };

  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    // Inward is to the left of the edge for a counter-clockwise outline, and to the right for a clockwise one.
    const nx = ccw ? -uy : uy, ny = ccw ? ux : -ux;
    const angle = Math.atan2(uy, ux);
    // A board stops a post's width short of a convex corner, where a post stands; at an inside (reflex) corner of an L or U
    // the boards run to the corner and the post sits in the angle.
    const convexAt = (p: Pt, q: Pt, r: Pt) => ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) > 0) === ccw;
    const prev = poly[(i + n - 1) % n], after = poly[(i + 2) % n];
    const shortA = convexAt(prev, a, b) ? frame.postFt : 0, shortB = convexAt(a, b, after) ? frame.postFt : 0;
    const run = len - shortA - shortB;
    // The board's middle, moved along the edge when the two ends are trimmed by different amounts.
    const along = (shortA - shortB) / 2;
    const mx = (a[0] + b[0]) / 2 + ux * along, my = (a[1] + b[1]) / 2 + uy * along;
    if (run > 0.05) {
      for (let k = 0; k < layers; k++) {
        const z = k * (boardH + frame.seamGapFt) + boardH / 2;
        put(plank(run, frame.boardThicknessFt, boardH, frame.grainFtPerTile), mx + nx * frame.boardThicknessFt / 2, my + ny * frame.boardThicknessFt / 2, z, angle, tone(0));
      }
      // The cap: flat, wider than the boards, overhanging the outside a little and set on top of them.
      const off = frame.capWidthFt / 2 - frame.capOverhangFt;
      put(plank(run, frame.capWidthFt, frame.capThicknessFt, frame.grainFtPerTile), mx + nx * off, my + ny * off, wall + frame.capThicknessFt / 2, angle, tone(0.05));
    }
  }
  // A corner post at every vertex, flush with the outside, standing a little above the cap.
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n], cur = poly[i], next = poly[(i + 1) % n];
    const inward = (p: Pt, q: Pt): [number, number] => {
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      return ccw ? [-dy / l, dx / l] : [dy / l, -dx / l];
    };
    const n1 = inward(prev, cur), n2 = inward(cur, next);
    const px = cur[0] + (n1[0] + n2[0]) * frame.postFt / 2, py = cur[1] + (n1[1] + n2[1]) * frame.postFt / 2;
    const ang = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
    const h = height + frame.postRiseFt;
    put(plank(frame.postFt, frame.postFt, h, frame.grainFtPerTile), px, py, h / 2, ang, tone(-0.06));
  }

  const wood = pieces.length ? mergeGeometries(pieces.map((p) => { p.deleteAttribute('normal'); p.computeVertexNormals(); return p; }), false) : null;
  pieces.forEach((p) => p.dispose());
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const soil = new THREE.ShapeGeometry(shape);
  soil.translate(0, 0, soilZ);
  return { wood, soil, soilZ, layers };
}
