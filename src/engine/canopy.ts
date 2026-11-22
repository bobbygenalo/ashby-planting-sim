import type { Habit } from './types';

/**
 * The outline of a plant's canopy, shared by the 3D shapes and the fruit hung on them so the two always agree.
 * `r` is the canopy radius and zf a share of the canopy height (0 at the bottom, 1 at the top). Returns the radius
 * at that height. Vases and columns are smooth outlines with a rounded top; spreading plants are domes; the rest
 * are ellipsoids.
 */

/** Where a vase stops widening and its rounded top begins, as a share of canopy height. */
const VASE_TOP_START = 0.78;
const VASE_BOTTOM = 0.32;
const COLUMN_TOP_START = 0.8;
const COLUMN_TOP = 0.55;

/** Where a trunkless round plant is widest, as a share of its height. Below that it narrows only to a broad base. */
const GROUNDED_WIDEST = 0.45;

/**
 * `grounded` is a plant with no trunk (a shrub): it sits on the ground with a broad base instead of balancing on a
 * point like a ball.
 */
export function canopyRadius(habit: Habit, r: number, zf: number, grounded = false): number {
  const z = Math.min(1, Math.max(0, zf));
  switch (habit) {
    case 'vase': {
      if (z <= VASE_TOP_START) return r * (VASE_BOTTOM + (1 - VASE_BOTTOM) * Math.sin((z / VASE_TOP_START) * (Math.PI / 2)));
      const u = (z - VASE_TOP_START) / (1 - VASE_TOP_START);
      return r * Math.sqrt(Math.max(0, 1 - u * u));
    }
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
