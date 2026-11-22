import { canopyRadius, type CrownProfile } from './canopy';
import { mulberry32 } from './shuffle';
import type { BranchCfg, Habit } from './types';

type Vec3 = [number, number, number];

export interface BranchSegment {
  a: Vec3;
  b: Vec3;
  /** Radius at the start and at the end of the segment, in feet. */
  r0: number;
  r1: number;
  level: number;
}

export interface Skeleton {
  segments: BranchSegment[];
  /** The ends of the last twigs, where fruit hangs and leaves would be. */
  tips: Vec3[];
}

const between = (rng: () => number, [lo, hi]: [number, number]) => lo + rng() * (hi - lo);
const betweenInt = (rng: () => number, [lo, hi]: [number, number]) => lo + Math.floor(rng() * (hi - lo + 1));

/**
 * The bare branches of a leafless tree: limbs from the top of the trunk that fork twice, every tip kept inside the
 * canopy's outline. Positions are feet from the trunk, Z up. Deterministic for a seed, so a tree has the same
 * branches every winter.
 */
export function branchSkeleton(habit: Habit, r: number, base: number, canopyH: number, seed: number, cfg: BranchCfg, profile?: CrownProfile): Skeleton {
  const rng = mulberry32(seed);
  const segments: BranchSegment[] = [];
  const tips: Vec3[] = [];
  const grounded = base <= 0.02;
  const inside = (p: Vec3) => {
    const zf = (p[2] - base) / canopyH;
    if (zf < 0.02 || zf > 0.99) return false;
    return Math.hypot(p[0], p[1]) <= canopyRadius(habit, r, zf, grounded, profile) * cfg.inset + r * 0.02;
  };
  const reach = (from: Vec3, dir: Vec3, len: number): Vec3 | null => {
    for (let k = 0; k < 9; k++) {
      const l = len * 0.85 ** k;
      const p: Vec3 = [from[0] + dir[0] * l, from[1] + dir[1] * l, from[2] + dir[2] * l];
      if (inside(p)) return p;
    }
    return null;
  };
  const baseRadius = Math.max(cfg.radiusFrac * canopyH, cfg.minRadiusFt * 2);

  const grow = (from: Vec3, az: number, el: number, len: number, level: number, radius: number): boolean => {
    const dir: Vec3 = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    const to = reach(from, dir, len);
    if (!to) return false;
    const r1 = Math.max(radius * cfg.taper, cfg.minRadiusFt);
    segments.push({ a: from, b: to, r0: Math.max(radius, cfg.minRadiusFt), r1, level });
    let grew = false;
    if (level < cfg.levels - 1) {
      const n = betweenInt(rng, cfg.children);
      for (let c = 0; c < n; c++) {
        const spread = (cfg.childSpreadDeg * Math.PI) / 180;
        const childAz = az + (rng() - 0.5) * 2 * spread;
        const childEl = Math.min(1.35, Math.max(0.12, el + (rng() - 0.5) * 0.7));
        if (grow(to, childAz, childEl, len * cfg.lengthRatio, level + 1, r1)) grew = true;
      }
    }
    if (!grew) tips.push(to);
    return true;
  };

  const top: Vec3 = [0, 0, base];
  const limbs = Math.max(3, betweenInt(rng, cfg.limbs));
  for (let i = 0; i < limbs; i++) {
    const az = i * 2.399963229728653 + (rng() - 0.5) * 0.5;
    const el = (between(rng, cfg.elevationDeg) * Math.PI) / 180;
    grow(top, az, el, canopyH * cfg.firstLengthFrac * (0.8 + 0.4 * rng()), 0, baseRadius);
  }
  return { segments, tips };
}
