import * as THREE from 'three';
import type { Body } from '../engine/anatomy';

/** A cross-section of a body part: an ellipse of half-width `ry` (side to side) and `rx` (front to back) at height `z`, its center `dx` forward. */
export interface Section {
  z: number;
  rx: number;
  ry: number;
  dx?: number;
}

/**
 * A smooth solid through a stack of elliptical sections, closed at both ends (z up, x forward, y to the left). Torsos,
 * limbs, heads and hair are all made this way, so every part has its true length and width and no hard edges.
 */
export function loft(sections: Section[], segs = 14): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of sections) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push((s.dx ?? 0) + s.rx * Math.cos(a), s.ry * Math.sin(a), s.z);
    }
  }
  const n = sections.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = (i + 1) * segs + j, d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Close each end with a fan to the middle of its first and last section.
  for (const [i, flip] of [[0, true], [n - 1, false]] as [number, boolean][]) {
    const s = sections[i];
    const c = pos.length / 3;
    pos.push(s.dx ?? 0, 0, s.z);
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs);
      idx.push(...(flip ? [c, a, b] : [c, b, a]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Resample a stack of sections along a smooth curve through them (Catmull-Rom on each measure), so profiles flow instead of stepping. */
export function smooth(sections: Section[], subdiv = 3): Section[] {
  const n = sections.length;
  if (n < 3) return sections;
  const out: Section[] = [];
  const at = (i: number) => sections[Math.min(n - 1, Math.max(0, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < subdiv; k++) {
      const t = k / subdiv;
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      out.push({
        z: b.z + (c.z - b.z) * t,
        rx: Math.max(0.0005, cr(a.rx, b.rx, c.rx, d.rx, t)),
        ry: Math.max(0.0005, cr(a.ry, b.ry, c.ry, d.ry, t)),
        dx: cr(a.dx ?? 0, b.dx ?? 0, c.dx ?? 0, d.dx ?? 0, t),
      });
    }
  }
  out.push(sections[n - 1]);
  return out;
}

/** A limb hanging down from its joint at z = 0: soft round ends and a gentle swell, smoothed. */
export function limb(len: number, r0: number, rMid: number, r1: number, mid = 0.42): THREE.BufferGeometry {
  return loft(smooth([
    { z: r0 * 0.1, rx: r0 * 0.55, ry: r0 * 0.55 },
    { z: -len * 0.02, rx: r0 * 0.98, ry: r0 * 0.98 },
    { z: -len * mid * 0.5, rx: (r0 + rMid) * 0.52, ry: (r0 + rMid) * 0.5 },
    { z: -len * mid, rx: rMid * 1.04, ry: rMid },
    { z: -len * 0.8, rx: (rMid + r1) * 0.5, ry: (rMid + r1) * 0.48 },
    { z: -len * 0.97, rx: r1 * 1.02, ry: r1 },
    { z: -len, rx: r1 * 0.55, ry: r1 * 0.55 },
  ]), 14);
}

/** The trunk from just below the hip joints (z = 0 is the hip joint) to the base of the neck: hips, waist, ribs, chest, then shoulders sloping to the neck. */
export function torso(b: Body): THREE.BufferGeometry {
  const T = b.trunkL, sh = b.shoulderHalf + b.r.upperArm * 0.55;
  return loft(smooth([
    { z: -b.height * 0.06, rx: b.hipD * 0.3, ry: b.hipW * 0.3 },
    { z: -b.height * 0.03, rx: b.hipD * 0.47, ry: b.hipW * 0.47 },
    { z: T * 0.04, rx: b.hipD * 0.5, ry: b.hipW * 0.5 },
    { z: T * 0.22, rx: b.waistD * 0.52, ry: b.waistW * 0.5 },
    { z: T * 0.42, rx: b.waistD * 0.5, ry: b.waistW * 0.49 },
    { z: T * 0.62, rx: b.chestD * 0.53, ry: b.chestW * 0.52 },
    { z: T * 0.8, rx: b.chestD * 0.5, ry: Math.max(b.chestW * 0.5, sh * 0.82) },
    { z: T * 0.9, rx: b.chestD * 0.42, ry: sh },
    { z: T * 0.96, rx: b.chestD * 0.3, ry: sh * 0.55 },
    { z: T * 0.99, rx: b.r.neck * 1.7, ry: b.r.neck * 2.0 },
    { z: T + b.r.neck * 0.4, rx: b.r.neck * 1.25, ry: b.r.neck * 1.3 },
  ], 2), 26);
}

/** A head from the chin (z = 0) to the crown: a skull, cheeks that taper to a rounded jaw and chin, a face a little forward of the back. */
export function head(b: Body): THREE.BufferGeometry {
  const H = b.headH, D = b.headD / 2, W = b.headW / 2;
  const ring = (t: number, width: number, depth: number, shift: number): Section => ({ z: t * H, rx: D * depth, ry: W * width, dx: D * shift });
  return loft(smooth([
    ring(0.0, 0.18, 0.2, 0.52),
    ring(0.05, 0.42, 0.42, 0.42),
    ring(0.14, 0.7, 0.7, 0.26),
    ring(0.3, 0.9, 0.9, 0.08),
    ring(0.5, 1.0, 1.0, -0.02),
    ring(0.68, 1.0, 1.0, -0.06),
    ring(0.84, 0.88, 0.9, -0.08),
    ring(0.95, 0.6, 0.66, -0.07),
    ring(1.0, 0.18, 0.2, -0.06),
  ], 3), 24);
}

/** Hair: a cap from the forehead line over the crown, down the sides and back; `long` lets it hang behind to the shoulders. */
export function hair(b: Body, long: boolean): THREE.BufferGeometry {
  const H = b.headH, D = b.headD / 2, W = b.headW / 2;
  const ring = (t: number, width: number, depth: number, shift: number): Section => ({ z: t * H, rx: D * depth, ry: W * width, dx: D * shift });
  const cap = [
    ring(0.46, 0.98, 0.8, -0.24), ring(0.58, 1.08, 0.98, -0.14), ring(0.74, 1.1, 1.06, -0.1), ring(0.86, 1.0, 1.0, -0.1), ring(0.95, 0.72, 0.74, -0.08), ring(1.02, 0.2, 0.22, -0.06),
  ];
  if (!long) return loft(smooth(cap, 3), 24);
  return loft(smooth([
    ring(-0.9, 0.5, 0.3, -0.66), ring(-0.5, 0.7, 0.36, -0.7), ring(0.0, 0.9, 0.5, -0.56), ring(0.3, 1.02, 0.84, -0.3), ...cap,
  ], 2), 24);
}

/** A shoe or foot lying along +x, ankle at the origin, its sole `ankleH` below: a toe that rounds and narrows, a heel behind. */
export function shoe(b: Body): THREE.BufferGeometry {
  const L = b.footL, W = b.footW / 2, A = b.ankleH;
  // Built along z (heel to toe), then turned onto x: its x radius becomes the height, centered `A / 2` below the ankle.
  const ring = (u: number, w: number, h: number): Section => ({ z: u * L - L * 0.25, rx: h, ry: W * w, dx: A * 0.5 });
  const g = loft(smooth([
    ring(0.0, 0.35, A * 0.25),
    ring(0.06, 0.7, A * 0.42),
    ring(0.25, 0.85, A * 0.5),
    ring(0.55, 1.0, A * 0.42),
    ring(0.82, 0.88, A * 0.3),
    ring(0.96, 0.55, A * 0.2),
    ring(1.0, 0.2, A * 0.12),
  ], 3), 16);
  g.rotateY(Math.PI / 2);
  return g;
}

/** A hand hanging from the wrist (z = 0 down): a wrist, a flat palm, fingers that taper and curl a little toward the body. */
export function hand(b: Body): THREE.BufferGeometry {
  const L = b.handL, w = L * 0.22, t = L * 0.1;
  const g = loft(smooth([
    { z: 0, rx: b.r.wrist * 0.95, ry: b.r.wrist * 1.0 },
    { z: -L * 0.12, rx: t * 1.05, ry: w * 0.95 },
    { z: -L * 0.4, rx: t * 1.0, ry: w * 1.05, dx: L * 0.01 },
    { z: -L * 0.62, rx: t * 0.85, ry: w * 0.92, dx: L * 0.03 },
    { z: -L * 0.85, rx: t * 0.6, ry: w * 0.72, dx: L * 0.07 },
    { z: -L, rx: t * 0.3, ry: w * 0.4, dx: L * 0.1 },
  ], 3), 12);
  return g;
}

/** A thumb: a small tapered finger angled from the side of the palm. */
export function thumb(b: Body): THREE.BufferGeometry {
  const L = b.handL * 0.42, r = b.handL * 0.065;
  return loft(smooth([{ z: 0, rx: r * 1.1, ry: r * 1.1 }, { z: -L * 0.5, rx: r, ry: r }, { z: -L, rx: r * 0.55, ry: r * 0.55 }], 3), 8);
}

/** A bare unit sphere, shared by the nose, ears, eyes and joint blends, each scaled to size where it is used. */
export const unitSphere = new THREE.SphereGeometry(1, 12, 10);
