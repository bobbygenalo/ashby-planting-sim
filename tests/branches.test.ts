import { describe, expect, it } from 'vitest';
import { branchSkeleton } from '../src/engine/branches';
import { canopyRadius } from '../src/engine/canopy';
import { isLeafOff } from '../src/engine/growth';
import engine from '../src/data/engine.json';
import species from '../src/data/species.json';
import { branchGeometry } from '../src/scene/branchGeometry';
import type { Habit } from '../src/engine/types';

const cfg = (engine as any).branches;
const habits: Habit[] = ['round', 'vase', 'columnar', 'spreading', 'upright'] as Habit[];

describe('bare branches', () => {
  it('stay inside the canopy, are repeatable, taper, and have tips', () => {
    for (const habit of habits) {
      const a = branchSkeleton(habit, 6, 4, 14, 7, cfg);
      const b = branchSkeleton(habit, 6, 4, 14, 7, cfg);
      expect(a).toEqual(b);
      expect(a.segments.length).toBeGreaterThan(5);
      expect(a.tips.length).toBeGreaterThan(2);
      for (const s of a.segments) {
        expect(s.r1).toBeLessThanOrEqual(s.r0 + 1e-9);
        const zf = (s.b[2] - 4) / 14;
        expect(zf).toBeGreaterThan(0);
        expect(zf).toBeLessThan(1);
        expect(Math.hypot(s.b[0], s.b[1])).toBeLessThanOrEqual(canopyRadius(habit, 6, zf, false) + 0.2);
      }
      expect(branchGeometry(a)!.getAttribute('position').count).toBeGreaterThan(0);
    }
  });
  it('leaves no ripe fruit on a tree that is bare, except persimmon', () => {
    for (const s of (species as any).species) {
      if (!s.fruit || !s.leafOffMonths?.length || s.id.startsWith('diospyros')) continue;
      const ripe: number[] = s.fruit.ripeMonths ?? [];
      const clash = ripe.filter((m) => isLeafOff(s, m));
      expect(clash, s.id).toEqual([]);
    }
  });
});
