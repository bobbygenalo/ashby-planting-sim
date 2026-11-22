import type { Habit } from './types';

/** A species' own crown outline: [share of canopy height, share of canopy radius] points from the bottom to the top. */
export type CrownProfile = [number, number][];

/**
 * The outline of a plant's canopy, shared by the 3D shapes and the fruit hung on them so the two always agree.
 * `r` is the canopy radius and zf a share of the canopy height (0 at the bottom, 1 at the top). Returns the radius
 * at that height. Vases and columns are smooth outlines with a rounded top; spreading plants are domes; the rest
 * are ellipsoids.
 */

/**
 * A vase: narrow where the stems leave the trunk, widest about two thirds of the way up, then a rounded top, so it
 * reads as a full crown and not a spinning top.
 */
const VASE_PROFILE: CrownProfile = [[0, 0.28], [0.15, 0.5], [0.35, 0.8], [0.55, 0.96], [0.7, 1], [0.82, 0.93], [0.92, 0.72], [0.98, 0.4], [1, 0]];
const COLUMN_TOP_START = 0.8;
const COLUMN_TOP = 0.55;

/** Where a trunkless round plant is widest, as a share of its height. Below that it narrows only to a broad base. */
const GROUNDED_WIDEST = 0.45;

/**
 * `grounded` is a plant with no trunk (a shrub): it sits on the ground with a broad base instead of balancing on a
 * point like a ball.
 */
export function canopyRadius(habit: Habit, r: number, zf: number, grounded = false, profile?: CrownProfile): number {
  const z = Math.min(1, Math.max(0, zf));
  if (profile && profile.length >= 2) return r * profileShare(profile, z);
  switch (habit) {
    case 'vase':
      return r * profileShare(VASE_PROFILE, z);
    case 'columnar': {
      if (z <= COLUMN_TOP_START) return r * (1 - (1 - COLUMN_TOP) * (z / COLUMN_TOP_START));
      const u = (z - COLUMN_TOP_START) / (1 - COLUMN_TOP_START);
      return r * COLUMN_TOP * Math.sqrt(Math.max(0, 1 - u * u));
    }
    case 'spreading':
    case 'weeping':
      return r * Math.sqrt(Math.max(0, 1 - z * z));
    default:
      // One ellipse whose widest point sits low; cut off at the ground, so the base keeps most of the width.
      if (grounded) return r * Math.sqrt(Math.max(0, 1 - ((z - GROUNDED_WIDEST) / (1 - GROUNDED_WIDEST)) ** 2));
      return r * Math.sqrt(Math.max(0, 1 - (2 * z - 1) ** 2));
  }
}

/**
 * The radius share at a height along a species' own profile: a monotone cubic through its points, so the outline is
 * smooth and never swells between two points (a plain spline would overshoot near the rounded top).
 */
export function profileShare(profile: CrownProfile, z: number): number {
  const n = profile.length;
  if (z <= profile[0][0]) return profile[0][1];
  if (z >= profile[n - 1][0]) return profile[n - 1][1];
  let i = 0;
  while (i < n - 2 && z > profile[i + 1][0]) i++;
  const [x0, y0] = profile[i], [x1, y1] = profile[i + 1];
  const h = x1 - x0;
  const slope = (k: number) => (profile[k + 1][1] - profile[k][1]) / (profile[k + 1][0] - profile[k][0]);
  // Tangents: the average of the neighboring slopes, flattened where the outline turns around (Fritsch-Carlson).
  const tangent = (k: number) => {
    if (k === 0) return slope(0);
    if (k === n - 1) return slope(n - 2);
    const a = slope(k - 1), b = slope(k);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const m0 = tangent(i), m1 = tangent(i + 1);
  const t = (z - x0) / h, t2 = t * t, t3 = t2 * t;
  return Math.max(0, (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1);
}

/**
 * Horizontal sections of a plant's canopy, `levels` of them from the bottom to the top, as [height, radius] in feet
 * above the ground: the one description the drawn shape, the shadow it casts and the conflict outline all share.
 */
export function crownSections(habit: Habit, r: number, base: number, canopyH: number, levels: number, grounded = false, profile?: CrownProfile): [number, number][] {
  return Array.from({ length: levels }, (_, i) => {
    const zf = i / (levels - 1);
    return [base + zf * canopyH, canopyRadius(habit, r, zf, grounded, profile)];
  });
}
